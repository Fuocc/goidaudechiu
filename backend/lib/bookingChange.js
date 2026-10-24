/**
 * Booking change: MỌI thay đổi trên lịch đã có (từ nhân viên, AI) đi qua module này — xem spec #8.
 */
const { toMinutes, toHHMM, endTime } = require('./timeOfDay');
const { placeBookings } = require('./bookingEngine');
const { isHoldBooking } = require('./holds');

// Field không gửi (undefined) → giữ giá trị cũ của lịch
const pick = (change, booking, key) => (change[key] !== undefined ? change[key] : booking[key]);

/**
 * Bước lên kế hoạch (thuần, không đụng DB): lịch + dịch vụ + thay đổi → trạng thái đích của từng lịch.
 * @param scope  'booking' | 'group' | undefined; group = các lịch cùng nhóm (có thể gồm cả lịch đã hủy)
 * @returns {{ targets: { id, set, placementChanged }[] } | { scopeRequired: true, groupSize } | { refused }}
 *   targets[0] luôn là lịch đang sửa; các phần tử sau là khách cùng nhóm (chỉ đổi ngày / giờ).
 *   placementChanged: NV / chi nhánh / ngày / giờ thật sự đổi → phải qua booking engine;
 *   không đổi (VD chỉ sửa ghi chú) → ghi thẳng, lịch vốn đã chồng nhau vẫn lưu được.
 */
function planChange({ booking, service, change, scope, group = [] }) {
  const start_time = pick(change, booking, 'start_time');
  const booking_date = pick(change, booking, 'booking_date');
  const startChanged = toMinutes(start_time) !== toMinutes(booking.start_time);
  const timingChanged = booking_date !== booking.booking_date || startChanged;

  // Lịch thuộc nhóm đổi ngày / giờ bắt đầu mà không nói rõ phạm vi → hỏi lại (backend không tự đoán)
  const others = group.filter(g => g.id !== booking.id && g.status !== 'cancelled');
  if (others.length && timingChanged && !scope) return { scopeRequired: true, groupSize: others.length + 1 };

  // Dashboard gửi end_time (kéo dài / rút ngắn trên lịch) thì dùng đúng giờ đó
  const end_time = change.end_time || endTime(start_time, service.duration_minutes || 60);
  const set = {
    service_id: pick(change, booking, 'service_id'),
    branch_id: pick(change, booking, 'branch_id'),
    employee_id: pick(change, booking, 'employee_id'),
    customer_id: pick(change, booking, 'customer_id'),
    temporary_name: pick(change, booking, 'temporary_name'),
    booking_date: pick(change, booking, 'booking_date'),
    start_time,
    end_time,
    total_price: service.price || 0, // như luồng tạo lịch: giá dịch vụ, không nhân số khách
    notes: pick(change, booking, 'notes'),
    internal_note: pick(change, booking, 'internal_note')
  };
  const placementChanged = set.employee_id !== booking.employee_id
    || set.branch_id !== booking.branch_id
    || set.booking_date !== booking.booking_date
    || startChanged
    || toMinutes(end_time) !== toMinutes(booking.end_time);
  const targets = [{ id: booking.id, set, placementChanged }];

  // Cả nhóm (ADR 0001): khách còn lại cùng giờ bắt đầu mới, mỗi người giữ thời lượng đang đặt + NV của mình.
  // Field khác (dịch vụ, ghi chú, chi nhánh…) vẫn chỉ cho khách này (#12 mới áp cho cả nhóm).
  // Chỉ đổi ngày → mỗi người giữ giờ bắt đầu của mình.
  if (scope === 'group' && timingChanged) {
    for (const g of others) {
      const length = toMinutes(g.end_time) - toMinutes(g.start_time);
      const start = startChanged ? start_time : toHHMM(toMinutes(g.start_time));
      if (toMinutes(start) + length > 24 * 60) {
        return { refused: 'Dời cả nhóm làm lịch của khách khác trong nhóm vượt qua nửa đêm. Hãy chọn giờ khác hoặc "Chỉ khách này".' };
      }
      targets.push({
        id: g.id,
        set: { booking_date, start_time: start, end_time: endTime(start, length) },
        placementChanged: true
      });
    }
  }
  return { targets };
}
/**
 * Bước lên kế hoạch check-in (thuần): khách đến → bắt đầu từ "bây giờ", giữ thời lượng dịch vụ, status = arrived.
 * @param booking  lịch được bấm check-in, kèm services(duration_minutes)
 * @param group    các lịch cùng nhóm (kèm services; có thể gồm cả lịch đã hủy)
 * @param scope    'booking' | 'group' | undefined (lịch thuộc nhóm mà không gửi → hỏi)
 * @param start    "HH:MM" giờ check-in (đã làm tròn)
 * @returns {{ targets: { id, start, end }[] } | { scopeRequired: true, groupSize }}
 */
function planCheckIn({ booking, group = [], scope, start }) {
  const others = group.filter(g => g.id !== booking.id && g.status !== 'cancelled');
  if (others.length && !scope) return { scopeRequired: true, groupSize: others.length + 1 };

  const arriving = scope === 'group' ? [booking, ...others] : [booking];
  return {
    targets: arriving.map(b => ({ id: b.id, start, end: endTime(start, b.services?.duration_minutes || 60) }))
  };
}

const UPDATED_SELECT = `
  *,
  customers(name, phone, email, habits),
  services(name, duration_minutes, price),
  employees(name),
  beds(name),
  branches(name)
`;

/**
 * Đổi 1 lịch đã có: kiểm tra → (tùy chọn) cập nhật hồ sơ khách → ghi (đổi vị trí thì qua booking engine)
 * → đọc lại + broadcast. Lịch thuộc nhóm: scope 'group' dời ngày / giờ cho cả nhóm, 'booking' chỉ khách này.
 *
 * @param opts.source   'staff' | 'ai'
 * @param opts.scope    'booking' | 'group' | undefined (lịch thuộc nhóm đổi ngày / giờ mà không gửi → SCOPE_REQUIRED)
 * @param opts.change   service_id, branch_id, employee_id, booking_date, start_time, end_time, notes,
 *                      internal_note, customer_id, temporary_name, customer_update ({ name, phone, email, habits })
 * @param opts.confirm  true = đã bấm "Vẫn lưu" cho vướng mắc
 * @returns { ok: true, booking, before, groupUpdatedIds } | { ok: false, code: 'SCOPE_REQUIRED', groupSize }
 *        | { ok: false, code: 'BOOKING_CONFLICT', conflicts } | { ok: false, status, error }
 */
async function changeBooking(supabase, { source, bookingId, scope, change, confirm = false, broadcast = () => { } }) {
  if (scope !== undefined && scope !== 'booking' && scope !== 'group') throw new Error(`Scope không hợp lệ: ${scope}`);
  const fail = (status, error) => ({ ok: false, status, error });

  const { data: booking, error: bkErr } = await supabase.from('bookings').select('*').eq('id', bookingId).single();
  if (bkErr || !booking) return fail(404, 'Booking not found');

  // Lịch giữ chỗ tạm thời do khách đang đặt online: không cho sửa (xóa internal_note sẽ làm job dọn giữ chỗ bỏ sót)
  if (isHoldBooking(booking)) {
    return fail(409, 'Đây là lịch giữ chỗ tạm thời của khách đang đặt online, không thể chỉnh sửa.');
  }

  const serviceId = pick(change, booking, 'service_id');
  const branchId = pick(change, booking, 'branch_id');
  const employeeId = pick(change, booking, 'employee_id');

  const { data: service, error: svcErr } = await supabase.from('services').select('id, duration_minutes, price').eq('id', serviceId).single();
  if (svcErr || !service) return fail(404, 'Service not found');

  const { data: branch, error: brErr } = await supabase.from('branches').select('id').eq('id', branchId).single();
  if (brErr || !branch) return fail(404, 'Branch not found');

  if (employeeId) {
    const { data: emp, error: empErr } = await supabase.from('employees').select('id, branch_id, is_active').eq('id', employeeId).single();
    if (empErr || !emp) return fail(404, 'Employee not found');
    if (!emp.is_active) return fail(409, 'Employee is inactive');
    if (emp.branch_id !== branchId) return fail(409, 'Employee does not belong to selected branch');
  }

  // Khách cùng nhóm (kể cả đã hủy — bước lên kế hoạch tự bỏ qua)
  let group = [];
  if (booking.group_booking_id) {
    const { data: members, error: grpErr } = await supabase.from('bookings').select('*')
      .eq('group_booking_id', booking.group_booking_id).neq('id', booking.id);
    if (grpErr) throw grpErr;
    group = members || [];
  }

  const plan = planChange({ booking, service, change, scope, group });
  if (plan.scopeRequired) return { ok: false, code: 'SCOPE_REQUIRED', groupSize: plan.groupSize };
  if (plan.refused) return fail(400, plan.refused);

  const [target, ...siblingTargets] = plan.targets;
  const { set } = target;
  const siblings = siblingTargets.map(t => ({ ...t, from: group.find(g => g.id === t.id) }));
  // Booking engine xếp NV + giường theo 1 chi nhánh → nhóm ở nhiều chi nhánh không dời chung được (tất cả hoặc không)
  if (siblings.some(s => s.from.branch_id !== set.branch_id)) {
    // Đổi chi nhánh cho cả nhóm làm ở #12; giờ chỉ đổi được chi nhánh cho khách này
    return fail(409, set.branch_id !== booking.branch_id
      ? 'Chưa đổi được chi nhánh khi dời cả nhóm. Hãy chọn "Chỉ khách này", hoặc dời giờ và đổi chi nhánh ở 2 lần lưu.'
      : 'Nhóm đang ở nhiều chi nhánh, hãy dời từng khách ("Chỉ khách này").');
  }

  // Cập nhật hồ sơ khách trong CÙNG lệnh — làm trước (hay lỗi nhất, VD trùng SĐT);
  // ghi lịch lỗi / bị chặn vì trùng lịch thì ghi lại thông tin khách cũ.
  let customerRollback = null;
  const rollbackCustomer = async () => {
    if (!customerRollback) return;
    const { error: rbErr } = await supabase.from('customers').update(customerRollback.data).eq('id', customerRollback.id);
    if (rbErr) console.error('[bookingChange] Không hoàn lại được thông tin khách:', rbErr.message);
  };
  const customerUpdate = change.customer_update;
  if (customerUpdate && typeof customerUpdate === 'object' && set.customer_id) {
    const { data: oldCustomer, error: oldCustErr } = await supabase
      .from('customers').select('id, name, phone, email, habits').eq('id', set.customer_id).single();
    if (oldCustErr || !oldCustomer) return fail(404, 'Customer not found');

    // Cùng cách ghi với PUT /customers/:id
    const { name, phone, email, habits } = customerUpdate;
    const { error: custErr } = await supabase.from('customers').update({ name, phone, email, habits: habits || null }).eq('id', set.customer_id);
    if (custErr) return fail(400, `Không cập nhật được thông tin khách: ${custErr.message}`);

    customerRollback = {
      id: oldCustomer.id,
      data: { name: oldCustomer.name, phone: oldCustomer.phone, email: oldCustomer.email, habits: oldCustomer.habits }
    };
  }

  // Đổi vị trí → qua booking engine: NV bận / ngoài ca / hết giường → BOOKING_CONFLICT để hỏi "Vẫn lưu?".
  // Giường cũ bận ở giờ mới → tự đổi sang giường trống khác.
  // Cả nhóm: mọi khách trong CÙNG 1 lệnh → vướng mắc của mọi người báo chung, xác nhận 1 lần, không lưu nửa vời.
  try {
    if (target.placementChanged) {
      // Giờ nhận khách muộn nhất chỉ xét khi đặt giờ bắt đầu mới (đổi ngày / giờ / chi nhánh); chỉ đổi NV / kéo dài → không hỏi lại
      const startMoved = set.booking_date !== booking.booking_date || set.branch_id !== booking.branch_id
        || toMinutes(set.start_time) !== toMinutes(booking.start_time);
      const items = [
        { ref: booking.id, start: set.start_time, end: set.end_time, employeeId: set.employee_id, bedId: booking.bed_id, name: set.temporary_name, skipStartLimit: !startMoved },
        ...siblings.map(s => ({ ref: s.id, start: s.set.start_time, end: s.set.end_time, employeeId: s.from.employee_id, bedId: s.from.bed_id, name: s.from.temporary_name }))
      ];
      const setOf = new Map([[booking.id, set], ...siblings.map(s => [s.id, s.set])]);
      const result = await placeBookings(supabase, {
        source,
        branchId: set.branch_id,
        date: set.booking_date,
        items,
        excludeIds: items.map(it => it.ref),
        lockDates: [booking.booking_date, ...siblings.map(s => s.from.booking_date)],
        override: confirm === true,
        build: (assignments) => ({ updates: assignments.map(a => ({ id: a.ref, set: { ...setOf.get(a.ref), bed_id: a.bed_id } })) })
      });
      if (!result.ok) {
        await rollbackCustomer();
        if (result.refused) return { ok: false, status: 400, code: result.refused.code, error: result.refused.message };
        // Nhiều khách → ghi kèm tên khách để "Vẫn lưu?" nói rõ vướng mắc của ai
        const guestName = new Map(items.map(it => [it.ref, it.name]));
        const conflicts = siblings.length
          ? result.conflicts.map(c => ({ ...c, guest_name: guestName.get(c.ref) || null }))
          : result.conflicts;
        return { ok: false, code: 'BOOKING_CONFLICT', conflicts };
      }
    } else {
      // Ngoại lệ có chủ ý với quy tắc "mọi vị trí qua booking engine": nhánh này chỉ chạy khi vị trí KHÔNG đổi
      // (NV / chi nhánh / ngày / giờ ghi lại đúng giá trị cũ) → không cần khóa + kiểm tra trùng
      const { error: upErr } = await supabase.from('bookings').update(set).eq('id', booking.id);
      if (upErr) throw upErr;
    }
  } catch (writeErr) {
    await rollbackCustomer();
    throw writeErr;
  }

  const { data: updated, error: selErr } = await supabase.from('bookings').select(UPDATED_SELECT).eq('id', booking.id).single();
  if (selErr) throw selErr;
  broadcast('booking.updated', updated);

  const groupUpdatedIds = siblings.map(s => s.id);
  if (groupUpdatedIds.length) {
    const { data: moved, error: movedErr } = await supabase.from('bookings').select(UPDATED_SELECT).in('id', groupUpdatedIds);
    if (movedErr) throw movedErr;
    (moved || []).forEach(m => broadcast('booking.updated', m));
  }

  return { ok: true, booking: updated, before: booking, groupUpdatedIds };
}

module.exports = { planChange, planCheckIn, changeBooking };
