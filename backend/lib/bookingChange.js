/**
 * Booking change: MỌI thay đổi trên lịch đã có (từ nhân viên, AI) đi qua module này — xem spec #8.
 */
const { toMinutes, endTime } = require('./timeOfDay');
const { placeBookings } = require('./bookingEngine');
const { isHoldBooking } = require('./holds');

// Field không gửi (undefined) → giữ giá trị cũ của lịch
const pick = (change, booking, key) => (change[key] !== undefined ? change[key] : booking[key]);

/**
 * Bước lên kế hoạch (thuần, không đụng DB): lịch + dịch vụ + thay đổi → trạng thái đích của từng lịch.
 * @returns {{ targets: { id, set, placementChanged }[] }}
 *   placementChanged: NV / chi nhánh / ngày / giờ thật sự đổi → phải qua booking engine;
 *   không đổi (VD chỉ sửa ghi chú) → ghi thẳng, lịch vốn đã chồng nhau vẫn lưu được.
 */
function planChange({ booking, service, change }) {
  const start_time = pick(change, booking, 'start_time');
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
    || toMinutes(start_time) !== toMinutes(booking.start_time)
    || toMinutes(end_time) !== toMinutes(booking.end_time);
  return { targets: [{ id: booking.id, set, placementChanged }] };
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
 * → đọc lại + broadcast. Hiện chỉ có scope 'booking'; 'group' làm ở #10.
 *
 * @param opts.source   'staff' | 'ai'
 * @param opts.change   service_id, branch_id, employee_id, booking_date, start_time, end_time, notes,
 *                      internal_note, customer_id, temporary_name, customer_update ({ name, phone, email, habits })
 * @param opts.confirm  true = đã bấm "Vẫn lưu" cho vướng mắc
 * @returns { ok: true, booking, before } | { ok: false, code: 'BOOKING_CONFLICT', conflicts } | { ok: false, status, error }
 */
async function changeBooking(supabase, { source, bookingId, scope = 'booking', change, confirm = false, broadcast = () => { } }) {
  if (scope !== 'booking') throw new Error(`Scope chưa hỗ trợ: ${scope}`);
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

  const [target] = planChange({ booking, service, change }).targets;
  const { set } = target;

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
  try {
    if (target.placementChanged) {
      const item = { ref: booking.id, start: set.start_time, end: set.end_time, employeeId: set.employee_id, bedId: booking.bed_id, name: set.temporary_name };
      const result = await placeBookings(supabase, {
        source,
        branchId: set.branch_id,
        date: set.booking_date,
        items: [item],
        excludeIds: [booking.id],
        lockDates: [booking.booking_date],
        override: confirm === true,
        build: (assignments) => ({ updates: assignments.map(a => ({ id: a.ref, set: { ...set, bed_id: a.bed_id } })) })
      });
      if (!result.ok) {
        await rollbackCustomer();
        return { ok: false, code: 'BOOKING_CONFLICT', conflicts: result.conflicts };
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

  return { ok: true, booking: updated, before: booking };
}

module.exports = { planChange, changeBooking };
