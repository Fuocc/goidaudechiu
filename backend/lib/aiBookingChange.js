/**
 * Phần chuyển đổi (thuần) cho tool AI → Booking change. Xem ROADMAP.md › "Group rules" (AI tools).
 */
const { toMinutes, endTime } = require('./timeOfDay');

// Field model được phép đổi qua update_booking; mọi tham số khác (giường, giá, giờ kết thúc…) bị bỏ, không ghi
const AI_CHANGE_FIELDS = ['booking_date', 'start_time', 'service_id', 'branch_id', 'employee_id', 'notes'];

// Không gửi / giá trị lạ → cả nhóm (AI mặc định cả nhóm, trừ khi người dùng chỉ rõ 1 khách)
const normalizeScope = (scope) => (scope === 'booking' ? 'booking' : 'group');

/**
 * Tham số update_booking của model → { scope, change } cho changeBooking.
 * @param params  tham số model gửi
 * @param booking lịch đang lưu
 */
function toBookingChange(params, booking) {
  const change = {};
  for (const key of AI_CHANGE_FIELDS) {
    if (params[key] !== undefined) change[key] = params[key];
  }
  // Không đổi dịch vụ → giữ thời lượng đang đặt (module mặc định tính theo dịch vụ → lịch đã kéo dài bị rút ngắn)
  if (change.service_id === undefined) {
    const start = change.start_time || booking.start_time;
    change.end_time = endTime(start, toMinutes(booking.end_time) - toMinutes(booking.start_time));
  }
  return { scope: normalizeScope(params.scope), change };
}

const displayName = (b) => b.temporary_name || b.customers?.name || '';
const sameName = (x, y) => x.trim().replace(/\s+/g, ' ').toLowerCase() === y.trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Người dùng chỉ 1 khách (scope booking) nhưng lịch trùng tên khách khác trong nhóm (VD cả nhóm "Miss Mia")
 * → chưa biết khách nào: trả danh sách khách chưa hủy (NV / giờ / dịch vụ) để AI hỏi lại.
 * @param booking        lịch model chọn, kèm employees(name), services(name), customers(name)
 * @param group          các khách khác trong nhóm (cùng dạng, có thể gồm khách đã hủy)
 * @param guestConfirmed model đã hỏi và người dùng đã chọn đúng khách này
 * @returns danh sách khách để hỏi, hoặc null = không cần hỏi
 */
function guestChoice({ booking, group = [], scope, guestConfirmed = false }) {
  if (scope !== 'booking' || guestConfirmed === true) return null;
  const others = group.filter(g => g.id !== booking.id && g.status !== 'cancelled');
  if (!others.some(g => sameName(displayName(g), displayName(booking)))) return null;
  return [booking, ...others].map(g => ({
    booking_id: g.id,
    name: displayName(g),
    therapist: g.employees?.name || 'Chưa xếp NV',
    start_time: String(g.start_time).slice(0, 5),
    service: g.services?.name || null
  }));
}

module.exports = { toBookingChange, normalizeScope, guestChoice };
