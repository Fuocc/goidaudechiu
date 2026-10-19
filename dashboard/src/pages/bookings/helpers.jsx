// Hàm thuần + hằng số của trang Lịch hẹn (tách từ Bookings.jsx, giữ nguyên logic)
import { CALENDAR_OPEN_HOUR, CALENDAR_CLOSE_HOUR, LOGICAL_DAY_CUTOFF, WALK_IN_CUSTOMER_NAME, PLACEHOLDER_SERVICE_NAME } from '../../config/business';

export { toDateStr } from '../../utils/time';
export { normalizeName } from '../../utils/format';

export const OPEN_HOUR = CALENDAR_OPEN_HOUR;
export const CLOSE_HOUR = CALENDAR_CLOSE_HOUR;
export const HOURS = Array.from({ length: CLOSE_HOUR - OPEN_HOUR }, (_, i) => OPEN_HOUR + i);

// Lưới lịch: 100px mỗi giờ → 25px mỗi ô 15 phút
export const ROW_HEIGHT = 25; // pixels per 15-min slot
// Cột lưới lịch cho lịch chưa xếp nhân viên (employee_id null) — không phải id nhân viên thật
export const UNASSIGNED_COLUMN_ID = '__unassigned__';
export const SNAP_MINUTES = 15;

export function timeToMinutes(t) {
  if (!t) return 0;
  // Handle AM/PM if present
  let timeStr = t.toLowerCase();
  let isPM = timeStr.includes('pm');
  let isAM = timeStr.includes('am');

  // Clean string to get HH:mm
  let cleanTime = timeStr.replace(/am|pm/g, '').trim();
  let [h, m] = cleanTime.split(':').map(Number);

  if (isPM && h < 12) h += 12;
  if (isAM && h === 12) h = 0;

  return (h || 0) * 60 + (m || 0);
}

const STATUS_COLORS = {
  confirmed: { bg: '#e6f4ec', border: '#0d8a3f', text: '#0d8a3f' },
  pending: { bg: '#fef3e2', border: '#e67e22', text: '#e67e22' },
  completed: { bg: '#eff6ff', border: '#2563eb', text: '#2563eb' }
};

export const normalize = (str) => (str || '').normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export const WALK_IN_NORMALIZED = normalize(WALK_IN_CUSTOMER_NAME);       // 'khach la'
export const PLACEHOLDER_NORMALIZED = normalize(PLACEHOLDER_SERVICE_NAME); // 'giu cho'

export const getBookingColor = (booking) => {
  if (booking.status === 'pending' && booking.internal_note) {
    return STATUS_COLORS.pending.bg;
  }

  const name = normalize(booking.temporary_name || booking.customers?.name || '');
  if (name === WALK_IN_NORMALIZED) {
    return '#F1F1EF'; // Grey
  }

  return booking.services?.color || '#EDF4EB';
};

export const formatPrice = (v) => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(v || 0);

// "14:00" → "02:00 PM" (giờ đệm khoảng trắng: " 9:00 AM")
export const formatTime = (t) => {
  if (!t) return '-';
  const cleanTime = t.substring(0, 5);
  const [hStr, mStr] = cleanTime.split(':');
  const h = parseInt(hStr);
  if (isNaN(h)) return cleanTime;
  const period = h < 12 ? 'AM' : 'PM';
  let h12 = h % 12;
  if (h12 === 0) h12 = 12;
  return `${String(h12).padStart(2)}:${mStr} ${period}`;
};

// "Hôm nay" của spa: sau mốc LOGICAL_DAY_CUTOFF (22:15) coi như sang ngày mai
export const getLogicalDate = () => {
  const d = new Date();
  const { hour, minute } = LOGICAL_DAY_CUTOFF;
  if (d.getHours() > hour || (d.getHours() === hour && d.getMinutes() >= minute)) {
    d.setDate(d.getDate() + 1);
  }
  return d;
};

export const formatDateVietnamese = (date) => {
  const days = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
  const dayName = days[date.getDay()];
  const d = date.getDate();
  const m = date.getMonth() + 1;
  const y = date.getFullYear();

  return (
    <>
      {dayName}, {d}/{m} <span style={{ color: '#A8A29E' }}>{y}</span>
    </>
  );
};

// Toạ độ Y trên cột lịch → "HH:mm"
export const convertYToTime = (y) => {
  const totalMins = (y / ROW_HEIGHT) * SNAP_MINUTES;
  const hours = Math.floor(totalMins / 60) + OPEN_HOUR;
  const mins = Math.floor(totalMins % 60);
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

// "HH:mm" + số phút → "HH:mm" giờ kết thúc ('--:--' nếu thiếu dữ liệu)
export const calculateEndTime = (startTime, duration) => {
  if (!startTime || startTime === '--:--' || !duration) return '--:--';
  const [h, m] = startTime.split(':').map(Number);
  const totalMinutes = h * 60 + m + duration;
  const endH = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const endM = String(totalMinutes % 60).padStart(2, '0');
  return `${endH}:${endM}`;
};

// Rê chuột vào 1 lịch của nhóm khách → tô sáng mọi lịch cùng nhóm (các cột nhân viên khác / các dòng khác).
// Đổi class trực tiếp trên DOM thay vì state để không render lại cả lưới lịch mỗi lần rê chuột.
export const setGroupHighlight = (groupId, on) => {
  if (!groupId) return;
  document.querySelectorAll(`[data-group-id="${groupId}"]`)
    .forEach(el => el.classList.toggle('is-group-highlight', on));
};
