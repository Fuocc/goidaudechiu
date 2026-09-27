// Tiền tố backend gắn vào internal_note của lịch giữ chỗ tạm thời (khách đang đặt online).
// Job dọn giữ chỗ ở backend lọc bằng LIKE '[GIỮ CHỖ TẠM THỜI]%' → frontend phải nhận diện theo đúng điều kiện này.
export const HOLD_NOTE_PREFIX = '[GIỮ CHỖ TẠM THỜI]';

export const isHoldBooking = (booking) =>
  booking?.status === 'pending' &&
  typeof booking.internal_note === 'string' &&
  booking.internal_note.startsWith(HOLD_NOTE_PREFIX);

// Nhãn tiếng Việt của trạng thái lịch hẹn (class CSS vẫn dùng mã gốc: badge-<status>)
export const BOOKING_STATUS_LABELS = {
  pending: 'Chờ xác nhận',
  confirmed: 'Đã xác nhận',
  arrived: 'Đã đến',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy'
};
export const bookingStatusLabel = (status) => BOOKING_STATUS_LABELS[status] || status || '';

// Lịch "pending" có ghi chú nội bộ (cảnh báo spam...) nhưng KHÔNG phải giữ chỗ tạm thời
export const isSpamWarningBooking = (booking) =>
  booking?.status === 'pending' && !!booking.internal_note && !isHoldBooking(booking);
