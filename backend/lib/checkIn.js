const { toHHMM } = require('./timeOfDay');
const { planCheckIn } = require('./bookingChange');

// Giờ VN hiện tại làm tròn tới mốc 5 phút gần nhất (4:01/4:02 → 4:00, 4:03 → 4:05); không vượt quá 23:55
function roundedVnTime(now = new Date()) {
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60000);
  const totalMinutes = vnNow.getHours() * 60 + vnNow.getMinutes();
  return toHHMM(Math.min(Math.round(totalMinutes / 5) * 5, 23 * 60 + 55));
}

/**
 * Khách đã đến: start_time = giờ hiện tại (làm tròn 5 phút), tính lại end_time theo dịch vụ, status = arrived.
 * Lịch thuộc nhóm: scope 'group' check-in cả nhóm, 'booking' chỉ khách này; không gửi → SCOPE_REQUIRED.
 * Dùng chung cho AI (check_in_booking) và nút "Khách đến" trên dashboard.
 *
 * Giờ mới có thể chồng lên lịch kế tiếp của NV (khách đến trễ) hoặc trễ hơn Last booking time + Late arrival grace
 * → đi qua booking engine: vướng mắc mà chưa xác nhận → { blocked: true, conflicts }, chưa ghi gì.
 * Giường cũ bận → tự đổi giường trống.
 *
 * @param opts.source   'staff' | 'ai'
 * @param opts.scope    'booking' | 'group' | undefined
 * @param opts.override true / (conflicts) => boolean — đã xác nhận "Vẫn lưu"
 * @returns { success: true, ... } | { scopeRequired: true, groupSize } | { blocked: true, conflicts } | { error }
 */
async function checkInBooking(bookingId, broadcast = () => { }, { source = 'staff', scope, override = false } = {}) {
  if (scope !== undefined && scope !== 'booking' && scope !== 'group') throw new Error(`Scope không hợp lệ: ${scope}`);
  const supabase = require('../supabaseClient'); // require lười: test roundedVnTime không cần env Supabase
  const { placeBookings } = require('./bookingEngine');
  const newStartTime = roundedVnTime();

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('*, services(duration_minutes)')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) return { error: 'Không tìm thấy lịch hẹn.' };

  let group = [];
  if (booking.group_booking_id) {
    const { data: members, error: grpErr } = await supabase
      .from('bookings')
      .select('*, services(duration_minutes)')
      .eq('group_booking_id', booking.group_booking_id)
      .neq('id', booking.id);
    if (grpErr) throw grpErr;
    group = members || [];
  }

  const plan = planCheckIn({ booking, group, scope, start: newStartTime });
  if (plan.scopeRequired) return { scopeRequired: true, groupSize: plan.groupSize };

  const rowsById = new Map([booking, ...group].map(b => [b.id, b]));
  const bookingsToUpdate = plan.targets.map(t => rowsById.get(t.id));

  // Snapshot trước khi check-in để có thể hoàn tác (khôi phục giờ + trạng thái cũ)
  const snapshot = bookingsToUpdate.map(({ services, ...row }) => row);

  const items = plan.targets.map(t => {
    const b = rowsById.get(t.id);
    return {
      ref: t.id,
      start: t.start,
      end: t.end,
      employeeId: b.employee_id,
      bedId: b.bed_id,
      name: b.temporary_name,
      checkIn: true // giới hạn = Last booking time + Late arrival grace
    };
  });
  const ids = items.map(it => it.ref);

  const result = await placeBookings(supabase, {
    source,
    branchId: booking.branch_id,
    date: booking.booking_date,
    items,
    excludeIds: ids,
    override,
    build: (assignments) => ({
      updates: assignments.map(a => {
        const it = items.find(i => i.ref === a.ref);
        return { id: a.ref, set: { status: 'arrived', start_time: it.start, end_time: it.end, bed_id: a.bed_id } };
      })
    })
  });
  if (!result.ok) {
    return { success: false, blocked: true, code: result.refused?.code || 'BOOKING_CONFLICT', conflicts: result.conflicts, refused: result.refused };
  }

  const { data: updated, error } = await supabase
    .from('bookings')
    .select('*, employees(name), services(name), branches(name)')
    .in('id', ids);
  if (error) throw error;
  (updated || []).forEach(b => broadcast('booking.updated', b));

  return {
    success: true,
    checked_in: (updated || []).length,
    start_time: newStartTime,
    bookings: updated || [],
    snapshot
  };
}

module.exports = { checkInBooking, roundedVnTime };
