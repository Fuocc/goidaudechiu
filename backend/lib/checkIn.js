const toHHMM = (total) => `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

// Giờ VN hiện tại làm tròn tới mốc 5 phút gần nhất (4:01/4:02 → 4:00, 4:03 → 4:05); không vượt quá 23:55
function roundedVnTime(now = new Date()) {
  const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000 + now.getTimezoneOffset() * 60000);
  const totalMinutes = vnNow.getHours() * 60 + vnNow.getMinutes();
  return toHHMM(Math.min(Math.round(totalMinutes / 5) * 5, 23 * 60 + 55));
}

/**
 * Khách đã đến: start_time = giờ hiện tại (làm tròn 5 phút), tính lại end_time theo dịch vụ, status = arrived.
 * Lịch thuộc nhóm → check-in cả nhóm. Dùng chung cho AI (check_in_booking) và nút "Khách đến" trên dashboard.
 */
async function checkInBooking(bookingId, broadcast = () => { }) {
  const supabase = require('../supabaseClient'); // require lười: test roundedVnTime không cần env Supabase
  const newStartTime = roundedVnTime();

  const { data: booking, error: fetchError } = await supabase
    .from('bookings')
    .select('*, services(duration_minutes)')
    .eq('id', bookingId)
    .single();

  if (fetchError || !booking) return { error: 'Không tìm thấy lịch hẹn.' };

  let bookingsToUpdate = [booking];
  if (booking.group_booking_id) {
    const { data: siblings } = await supabase
      .from('bookings')
      .select('*, services(duration_minutes)')
      .eq('group_booking_id', booking.group_booking_id)
      .neq('status', 'cancelled');
    if (siblings?.length) bookingsToUpdate = siblings;
  }

  // Snapshot trước khi check-in để có thể hoàn tác (khôi phục giờ + trạng thái cũ)
  const snapshot = bookingsToUpdate.map(({ services, ...row }) => row);

  const [h, m] = newStartTime.split(':').map(Number);
  const updates = await Promise.all(
    bookingsToUpdate.map(async (b) => {
      const duration = b.services?.duration_minutes || 60;
      const { data: updated, error } = await supabase
        .from('bookings')
        .update({
          status: 'arrived',
          start_time: newStartTime,
          end_time: toHHMM(h * 60 + m + duration)
        })
        .eq('id', b.id)
        .select('*, employees(name), services(name), branches(name)')
        .single();

      if (!error) broadcast('booking.updated', updated);
      return updated;
    })
  );

  return {
    success: true,
    checked_in: updates.filter(Boolean).length,
    start_time: newStartTime,
    bookings: updates.filter(Boolean),
    snapshot
  };
}

module.exports = { checkInBooking, roundedVnTime };
