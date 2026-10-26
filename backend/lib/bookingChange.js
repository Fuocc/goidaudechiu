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
 * @param customer hồ sơ khách đặt hiện tại { name, phone, email, habits } (khi có customer_update)
 * @returns {{ targets: { id, set, placementChanged }[], customerUpdate: { id, data } | null } | { scopeRequired: true, groupSize } | { refused }}
 *   targets[0] luôn là lịch đang sửa; các phần tử sau là khách cùng nhóm (chỉ các field áp cho cả nhóm đã đổi).
 *   customerUpdate: hồ sơ khách đặt cần sửa (null = không sửa).
 *   placementChanged: NV / chi nhánh / ngày / giờ thật sự đổi → phải qua booking engine;
 *   không đổi (VD chỉ sửa ghi chú) → ghi thẳng, lịch vốn đã chồng nhau vẫn lưu được.
 */
function planChange({ booking, service, change, scope, group = [], customer = null }) {
  const start_time = pick(change, booking, 'start_time');
  const booking_date = pick(change, booking, 'booking_date');
  const startChanged = toMinutes(start_time) !== toMinutes(booking.start_time);
  const timingChanged = booking_date !== booking.booking_date || startChanged;

  // Field áp cho cả nhóm (ROADMAP › "Group rules"); NV và giờ kết thúc luôn chỉ cho khách này
  // Dashboard luôn gửi lại mọi field: "" và null cùng nghĩa là trống → không tính là đổi
  const changed = (key) => change[key] !== undefined && (change[key] || null) !== (booking[key] || null);
  const serviceChanged = changed('service_id');
  const branchChanged = changed('branch_id');
  const notesChanged = changed('notes');
  const internalNoteChanged = changed('internal_note');
  // Đổi khách đặt (chọn khách khác / đổi tên) → gắn lại mọi khách; chỉ sửa SĐT / email / thói quen → chỉ sửa hồ sơ
  const contactLinkChanged = changed('customer_id') || changed('temporary_name')
    || (!!change.customer_update && (change.customer_update.name || null) !== (customer?.name || null));
  const contactChanged = contactLinkChanged || !!change.customer_update;
  const groupWideChanged = timingChanged || serviceChanged || branchChanged || notesChanged || internalNoteChanged || contactChanged;

  // Lịch thuộc nhóm đổi field áp cho cả nhóm mà không nói rõ phạm vi → hỏi lại (backend không tự đoán)
  const others = group.filter(g => g.id !== booking.id && g.status !== 'cancelled');
  if (others.length && groupWideChanged && !scope) return { scopeRequired: true, groupSize: others.length + 1 };

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
  // Sửa hồ sơ khách đặt (cùng cách ghi với PUT /customers/:id). Nhóm + "Chỉ khách này": đổi tên → khách này
  // có tên riêng (tách khỏi khách đặt, hồ sơ giữ nguyên); SĐT / email / thói quen là của cả nhóm → từ chối.
  let customerUpdate = null;
  const cu = change.customer_update;
  if (cu && typeof cu === 'object' && set.customer_id) {
    const data = { name: cu.name, phone: cu.phone, email: cu.email, habits: cu.habits || null };
    if (others.length && scope === 'booking') {
      const same = (k) => (data[k] || null) === (customer?.[k] || null);
      if (!same('phone') || !same('email') || !same('habits')) {
        return { refused: 'SĐT / email / thói quen là của khách đặt (cả nhóm) — hãy chọn "Cả nhóm".' };
      }
      if (!same('name')) Object.assign(set, { customer_id: null, temporary_name: data.name });
    } else {
      customerUpdate = { id: set.customer_id, data };
    }
  }

  const targets = [{ id: booking.id, set, placementChanged }];

  // Cả nhóm: field áp cho cả nhóm đã đổi → chép sang mọi khách chưa hủy; NV mỗi người giữ nguyên.
  // Giờ (ADR 0001): cùng giờ bắt đầu mới, mỗi người giữ thời lượng đang đặt; chỉ đổi ngày → giữ giờ bắt đầu của mình.
  if (scope === 'group' && groupWideChanged) {
    for (const g of others) {
      const s = {};
      let moved = false;
      if (timingChanged || serviceChanged) {
        // Đổi dịch vụ → thời lượng của dịch vụ mới; không thì giữ thời lượng đang đặt của khách đó
        const length = serviceChanged ? (service.duration_minutes || 60) : toMinutes(g.end_time) - toMinutes(g.start_time);
        const start = startChanged ? start_time : toHHMM(toMinutes(g.start_time));
        if (toMinutes(start) + length > 24 * 60) {
          return { refused: 'Áp cho cả nhóm làm lịch của khách khác trong nhóm vượt qua nửa đêm. Hãy chọn giờ khác hoặc "Chỉ khách này".' };
        }
        const end = endTime(start, length);
        if (timingChanged) Object.assign(s, { booking_date, start_time: start });
        s.end_time = end;
        moved = timingChanged || toMinutes(end) !== toMinutes(g.end_time);
      }
      if (branchChanged) { s.branch_id = set.branch_id; moved = true; }
      if (serviceChanged) Object.assign(s, { service_id: set.service_id, total_price: set.total_price });
      // Mỗi field chỉ chép khi chính nó đổi (dashboard không gửi ghi chú nội bộ khi sửa ghi chú)
      if (notesChanged) s.notes = set.notes;
      if (internalNoteChanged) s.internal_note = set.internal_note;
      // Khách có tên riêng cũng về lại khách đặt chung
      if (contactLinkChanged) Object.assign(s, { customer_id: set.customer_id, temporary_name: set.temporary_name });
      targets.push({ id: g.id, set: s, placementChanged: moved });
    }
  }
  return { targets, customerUpdate };
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

/**
 * Bước lên kế hoạch đổi trạng thái (thuần, không đụng DB): hủy, hoàn thành, khôi phục lịch đã hủy…
 * @param scope  'booking' | 'group' | undefined; group = các lịch cùng nhóm (kể cả đã hủy)
 * @returns {{ targets: { id, set, placementChanged }[] } | { scopeRequired: true, groupSize } | { refused }}
 *   placementChanged: rời trạng thái hủy → lịch chiếm lại chỗ, phải qua booking engine.
 */
function planStatusChange({ booking, status, scope, group = [] }) {
  if (status === booking.status) return { refused: 'Lịch hẹn đã ở trạng thái này rồi.' };

  // Khách cùng nhóm mà thay đổi này áp được:
  //  - rời trạng thái hủy (khôi phục) → các khách cũng đã hủy
  //  - hủy → khách chưa hủy, chưa đến, chưa xong (không hủy khách đang / đã làm)
  //  - còn lại → khách chưa hủy
  const leavingCancelled = booking.status === 'cancelled';
  const applies = leavingCancelled
    ? (g) => g.status === 'cancelled'
    : status === 'cancelled'
      ? (g) => !['cancelled', 'arrived', 'completed'].includes(g.status)
      : (g) => g.status !== 'cancelled';
  // Khách đã ở đúng trạng thái đích → bỏ qua (không ghi lại, không xoay tour lần nữa)
  const others = group.filter(g => g.id !== booking.id && g.status !== status && applies(g));
  if (others.length && !scope) return { scopeRequired: true, groupSize: others.length + 1 };

  if (scope !== 'group') return { targets: [{ id: booking.id, set: { status }, placementChanged: leavingCancelled }] };

  // Hủy cả nhóm bắt đầu từ khách đã đến / đã xong → bỏ qua cả khách đó (báo lại cho người gọi)
  const skipSelf = status === 'cancelled' && ['arrived', 'completed'].includes(booking.status);
  const inScope = skipSelf ? others : [booking, ...others];
  if (!inScope.length) return { refused: 'Khách đã đến / đã hoàn thành, không hủy cả nhóm được. Hãy chọn "Chỉ khách này" nếu vẫn muốn hủy khách này.' };
  return {
    targets: inScope.map(b => ({ id: b.id, set: { status }, placementChanged: leavingCancelled })),
    skippedIds: skipSelf ? [booking.id] : []
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
 * → đọc lại + broadcast. Lịch thuộc nhóm: scope 'group' áp field áp cho cả nhóm (ngày / giờ, chi nhánh,
 * dịch vụ, ghi chú, ghi chú nội bộ, khách đặt) cho mọi khách chưa hủy, 'booking' chỉ khách này. NV luôn chỉ cho khách này.
 *
 * @param opts.source   'staff' | 'ai'
 * @param opts.scope    'booking' | 'group' | undefined (lịch thuộc nhóm đổi field áp cho cả nhóm mà không gửi → SCOPE_REQUIRED)
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
  // NV được CHỌN trong lần sửa này (khác NV đang xếp) → giữ đúng người cho khách này, bận / ngoài ca thì hỏi "Vẫn lưu?"
  const employeeChosen = change.employee_id !== undefined && (change.employee_id || null) !== (booking.employee_id || null);

  const { data: service, error: svcErr } = await supabase.from('services').select('id, duration_minutes, price').eq('id', serviceId).single();
  if (svcErr || !service) return fail(404, 'Service not found');

  const { data: branch, error: brErr } = await supabase.from('branches').select('id').eq('id', branchId).single();
  if (brErr || !branch) return fail(404, 'Branch not found');

  if (employeeChosen && employeeId) {
    const { data: emp, error: empErr } = await supabase.from('employees').select('id, branch_id, is_active').eq('id', employeeId).single();
    if (empErr || !emp) return fail(404, 'Employee not found');
    if (!emp.is_active) return fail(409, 'Employee is inactive');
    if (emp.branch_id !== branchId) return fail(409, 'Nhân viên được chọn không làm ở chi nhánh này. Hãy chọn nhân viên khác hoặc để trống để tự xếp.');
  }

  // Khách cùng nhóm (kể cả đã hủy — bước lên kế hoạch tự bỏ qua)
  let group = [];
  if (booking.group_booking_id) {
    const { data: members, error: grpErr } = await supabase.from('bookings').select('*')
      .eq('group_booking_id', booking.group_booking_id).neq('id', booking.id);
    if (grpErr) throw grpErr;
    group = members || [];
  }

  // Hồ sơ khách đặt hiện tại — để biết lần sửa hồ sơ có đổi tên / SĐT… không
  let customer = null;
  const customerId = pick(change, booking, 'customer_id');
  if (change.customer_update && customerId) {
    const { data: cust, error: custLoadErr } = await supabase
      .from('customers').select('id, name, phone, email, habits').eq('id', customerId).single();
    if (custLoadErr || !cust) return fail(404, 'Customer not found');
    customer = cust;
  }

  const plan = planChange({ booking, service, change, scope, group, customer });
  if (plan.scopeRequired) return { ok: false, code: 'SCOPE_REQUIRED', groupSize: plan.groupSize };
  if (plan.refused) return fail(400, plan.refused);

  // Mỗi lịch trong lệnh: trạng thái cũ (from) + phần đổi (set) → vị trí đích (eff)
  const rows = plan.targets.map(t => {
    const from = t.id === booking.id ? booking : group.find(g => g.id === t.id);
    return { ...t, from, eff: { ...from, ...t.set } };
  });
  const [target] = rows;
  const siblings = rows.slice(1);
  const placed = rows.filter(r => r.placementChanged);
  // Booking engine xếp NV + giường theo 1 chi nhánh, 1 ngày → nhóm ở nhiều chi nhánh / ngày không đổi vị trí chung được
  if (placed.some(r => r.eff.branch_id !== target.eff.branch_id || r.eff.booking_date !== target.eff.booking_date)) {
    return fail(409, 'Nhóm đang ở nhiều chi nhánh / ngày, hãy đổi từng khách ("Chỉ khách này").');
  }

  // Đổi chi nhánh: NV đang xếp làm ở chi nhánh mới thì giữ (bận / ngoài ca → tự xếp người rảnh khác), không thì tự xếp
  let newBranchStaff = new Set();
  if (placed.some(r => r.eff.branch_id !== r.from.branch_id)) {
    const { data: staff, error: staffErr } = await supabase.from('employees').select('id')
      .eq('branch_id', target.eff.branch_id).eq('is_active', true);
    if (staffErr) throw staffErr;
    newBranchStaff = new Set((staff || []).map(e => e.id));
  }

  // Cập nhật hồ sơ khách trong CÙNG lệnh — làm trước (hay lỗi nhất, VD trùng SĐT);
  // ghi lịch lỗi / bị chặn vì trùng lịch thì ghi lại thông tin khách cũ.
  let customerRollback = null;
  const rollbackCustomer = async () => {
    if (!customerRollback) return;
    const { error: rbErr } = await supabase.from('customers').update(customerRollback.data).eq('id', customerRollback.id);
    if (rbErr) console.error('[bookingChange] Không hoàn lại được thông tin khách:', rbErr.message);
  };
  if (plan.customerUpdate) {
    const { error: custErr } = await supabase.from('customers').update(plan.customerUpdate.data).eq('id', plan.customerUpdate.id);
    if (custErr) return fail(400, `Không cập nhật được thông tin khách: ${custErr.message}`);
    customerRollback = {
      id: customer.id,
      data: { name: customer.name, phone: customer.phone, email: customer.email, habits: customer.habits }
    };
  }

  // Đổi vị trí → qua booking engine: NV bận / ngoài ca / hết giường / không ai rảnh → BOOKING_CONFLICT để hỏi "Vẫn lưu?".
  // Giường cũ bận ở giờ mới → tự đổi sang giường trống khác; đổi chi nhánh → luôn lấy giường của chi nhánh mới.
  // Cả nhóm: mọi khách trong CÙNG 1 lệnh (cả khách chỉ đổi ghi chú / khách đặt) → vướng mắc báo chung, xác nhận 1 lần,
  // ghi trong 1 transaction, không lưu nửa vời.
  try {
    if (placed.length || siblings.length) {
      const items = placed.map(r => {
        const { eff, from } = r;
        const branchMoved = eff.branch_id !== from.branch_id;
        // Giờ nhận khách muộn nhất chỉ xét khi đặt giờ bắt đầu mới (đổi ngày / giờ / chi nhánh); chỉ đổi NV / kéo dài → không hỏi lại
        const startMoved = branchMoved || eff.booking_date !== from.booking_date || toMinutes(eff.start_time) !== toMinutes(from.start_time);
        // NV được chọn → giữ đúng người; đổi chi nhánh mà để trống NV → tự xếp người rảnh của chi nhánh mới
        const chosen = r.id === booking.id && employeeChosen && eff.employee_id;
        const kept = !(r.id === booking.id && employeeChosen) && newBranchStaff.has(from.employee_id) ? from.employee_id : null;
        const employee = !branchMoved || chosen
          ? { employeeId: eff.employee_id }
          : { employeeId: kept, fallbackAuto: true, autoEmployee: true };
        return {
          ref: r.id, start: eff.start_time, end: eff.end_time, ...employee,
          bedId: branchMoved ? null : from.bed_id, name: eff.temporary_name, skipStartLimit: !startMoved
        };
      });
      const result = await placeBookings(supabase, {
        source,
        branchId: target.eff.branch_id,
        date: target.eff.booking_date,
        items,
        excludeIds: items.map(it => it.ref),
        lockDates: [...new Set(rows.flatMap(r => [r.from.booking_date, r.eff.booking_date]))],
        override: confirm === true,
        // Lịch đổi vị trí → gắn NV + giường do engine xếp; lịch chỉ đổi ghi chú / khách đặt… → ghi đúng phần đổi
        build: (assignments) => {
          const byRef = new Map(assignments.map(a => [a.ref, a]));
          return {
            updates: rows.map(r => {
              const a = byRef.get(r.id);
              return { id: r.id, set: a ? { ...r.set, employee_id: a.employee_id, bed_id: a.bed_id } : r.set };
            })
          };
        }
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
      // (NV / chi nhánh / ngày / giờ ghi lại đúng giá trị cũ) và chỉ 1 lịch → không cần khóa + kiểm tra trùng
      const { error: upErr } = await supabase.from('bookings').update(target.set).eq('id', booking.id);
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

/**
 * Đổi trạng thái 1 lịch / cả nhóm (hủy = status cancelled, không xóa). Rời trạng thái hủy → lịch chiếm lại chỗ
 * ở đúng giờ + NV cũ, qua booking engine (tất cả hoặc không, 1 lần "Vẫn lưu?"). Hoàn thành → NV xuống cuối tour.
 *
 * @param opts.source  'staff' | 'ai'
 * @param opts.scope   'booking' | 'group' | undefined (lịch thuộc nhóm mà không gửi → SCOPE_REQUIRED)
 * @param opts.status  'pending' | 'confirmed' | 'completed' | 'cancelled'
 * @param opts.confirm true = đã bấm "Vẫn lưu" cho vướng mắc khi khôi phục
 * @returns { ok: true, booking, before, updatedIds, skippedIds, snapshot } | { ok: false, code: 'SCOPE_REQUIRED', groupSize }
 *        | { ok: false, code: 'BOOKING_CONFLICT', conflicts } | { ok: false, status, error }
 */
async function changeStatus(supabase, { source, bookingId, scope, status, confirm = false, broadcast = () => { } }) {
  if (scope !== undefined && scope !== 'booking' && scope !== 'group') throw new Error(`Scope không hợp lệ: ${scope}`);
  const fail = (code, error) => ({ ok: false, status: code, error });

  const { data: booking, error: bkErr } = await supabase.from('bookings').select('*').eq('id', bookingId).maybeSingle();
  if (bkErr) throw bkErr;
  if (!booking) return fail(404, 'Booking not found');
  // Giữ chỗ tạm thời của khách đang đặt online: job dọn giữ chỗ tự xóa khi hết hạn
  if (isHoldBooking(booking)) return fail(409, 'Đây là lịch giữ chỗ tạm thời của khách đang đặt online, không thể đổi trạng thái.');

  let group = [];
  if (booking.group_booking_id) {
    const { data: members, error: grpErr } = await supabase.from('bookings').select('*')
      .eq('group_booking_id', booking.group_booking_id).neq('id', booking.id);
    if (grpErr) throw grpErr;
    group = members || [];
  }

  const plan = planStatusChange({ booking, group, status, scope });
  if (plan.scopeRequired) return { ok: false, code: 'SCOPE_REQUIRED', groupSize: plan.groupSize };
  if (plan.refused) return fail(400, plan.refused);

  const rowOf = new Map([booking, ...group].map(b => [b.id, b]));
  const targets = plan.targets.map(t => ({ ...t, from: rowOf.get(t.id) }));
  const ids = targets.map(t => t.id);

  if (targets[0].placementChanged) {
    // Khôi phục: chiếm lại chỗ ở đúng giờ + NV cũ; giường cũ bận → tự đổi giường khác.
    // Booking engine xếp theo 1 chi nhánh + 1 ngày → nhóm đã tách ra nhiều ngày / chi nhánh thì khôi phục từng khách.
    if (new Set(targets.map(t => `${t.from.branch_id}|${t.from.booking_date}`)).size > 1) {
      return fail(409, 'Các khách trong nhóm đang ở nhiều ngày / chi nhánh, hãy khôi phục từng khách ("Chỉ khách này").');
    }
    const items = targets.map(t => ({
      ref: t.id, start: t.from.start_time, end: t.from.end_time, employeeId: t.from.employee_id,
      bedId: t.from.bed_id, name: t.from.temporary_name, skipStartLimit: true
    }));
    const result = await placeBookings(supabase, {
      source,
      branchId: booking.branch_id,
      date: booking.booking_date,
      items,
      excludeIds: ids,
      override: confirm === true,
      build: (assignments) => ({ updates: assignments.map(a => ({ id: a.ref, set: { status, bed_id: a.bed_id } })) })
    });
    if (!result.ok) {
      if (result.refused) return { ok: false, status: 400, code: result.refused.code, error: result.refused.message };
      const guestName = new Map(items.map(it => [it.ref, it.name]));
      const conflicts = targets.length > 1
        ? result.conflicts.map(c => ({ ...c, guest_name: guestName.get(c.ref) || null }))
        : result.conflicts;
      return { ok: false, code: 'BOOKING_CONFLICT', conflicts };
    }
  } else {
    // Ngoại lệ có chủ ý với "mọi vị trí qua booking engine": chỉ ghi status, vị trí không đổi
    // (hủy thì giải phóng chỗ — booking engine và lịch trống đã bỏ qua lịch cancelled)
    const { error: upErr } = await supabase.from('bookings').update({ status }).in('id', ids);
    if (upErr) throw upErr;
  }

  // Hoàn thành → NV xuống cuối thứ tự tour của chi nhánh (mỗi khách 1 lần)
  if (status === 'completed') {
    for (const t of targets) {
      if (t.from.employee_id && t.from.branch_id) await rotateTour(supabase, t.from.branch_id, t.from.employee_id);
    }
  }

  const { data: rows, error: selErr } = await supabase.from('bookings').select(UPDATED_SELECT).in('id', ids);
  if (selErr) throw selErr;
  (rows || []).forEach(r => broadcast('booking.updated', r));

  return {
    ok: true,
    // Hủy cả nhóm bỏ qua chính khách đã đến → trả về khách đầu tiên được đổi
    booking: (rows || []).find(r => r.id === booking.id) || (rows || [])[0],
    before: booking,
    updatedIds: ids,
    skippedIds: plan.skippedIds || [],
    snapshot: targets.map(t => t.from) // các dòng trước khi đổi — để AI hoàn tác
  };
}

async function rotateTour(supabase, branchId, employeeId) {
  const tourKey = `tour_order_${branchId}`;
  const { data: settingData } = await supabase.from('settings').select('value').eq('key', tourKey).maybeSingle();
  if (!settingData || !Array.isArray(settingData.value)) return;
  const tour = settingData.value.filter(id => id !== employeeId);
  if (tour.length === settingData.value.length) return;
  tour.push(employeeId);
  await supabase.from('settings').upsert({ key: tourKey, value: tour }, { onConflict: 'key' });
}

module.exports = { planChange, planCheckIn, planStatusChange, changeBooking, changeStatus };
