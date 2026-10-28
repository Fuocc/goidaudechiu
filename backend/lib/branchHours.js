/**
 * Giờ mở cửa của chi nhánh theo ngày — dùng chung cho booking engine, lịch trống online và AI.
 * Last booking time (giờ nhận khách muộn nhất) = `close` của thứ đó cho tới khi có setting riêng.
 * Closing time coi như "sau khách cuối" → không kiểm tra giờ kết thúc. Xem ROADMAP.md › "Time limits".
 */

// Chi nhánh chưa cài giờ cho ngày đó → cùng mặc định với dashboard (config/business.js › DEFAULT_DAY_HOURS)
const DEFAULT_OPEN = '08:00';
const DEFAULT_CLOSE = '20:00';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// "YYYY-MM-DD" → giờ của thứ đó: { isOpen, open, close, lastBookingTime }
function branchDayHours(openingHours, date) {
  const weekday = WEEKDAYS[new Date(`${date}T00:00:00Z`).getUTCDay()];
  const day = openingHours?.[weekday];
  if (day && (day.isOpen === false || day.closed === true)) {
    return { isOpen: false, open: null, close: null, lastBookingTime: null };
  }
  const open = day?.open || DEFAULT_OPEN;
  const close = day?.close || DEFAULT_CLOSE;
  return { isOpen: true, open, close, lastBookingTime: close };
}

module.exports = { branchDayHours, DEFAULT_OPEN, DEFAULT_CLOSE };
