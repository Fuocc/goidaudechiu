/**
 * Các giá trị nghiệp vụ dùng chung của dashboard — gom về một chỗ thay vì rải rác trong từng trang.
 * Đang giữ ĐÚNG giá trị trước đây của từng nơi (chưa đổi hành vi). Sửa ở đây là đổi hành vi toàn app.
 */

// ---- Lưới lịch hẹn (trang Lịch hẹn) ----
export const CALENDAR_OPEN_HOUR = 9;   // hàng giờ đầu tiên của lưới
export const CALENDAR_CLOSE_HOUR = 23; // lưới hiển thị tới trước giờ này
// Ngày thường (T2–T6): phần lưới trước giờ này bị khóa (xám), kể cả khi chi nhánh mở sớm hơn
export const WEEKDAY_MIN_OPEN_MINUTES = 10 * 60;
// Sau mốc này, "Hôm nay" trên trang Lịch hẹn nhảy sang ngày mai (đã hết ca)
export const LOGICAL_DAY_CUTOFF = { hour: 22, minute: 15 };

// ---- Ô chọn giờ trong form lịch hẹn ----
export const TIME_PICKER_MIN_HOUR = 10; // cũng là giờ mặc định khi ô giờ đang trống
export const TIME_PICKER_MAX_HOUR = 22; // tối đa 22:00

// ---- Tên dữ liệu đặc biệt (tìm theo tên) ----
export const WALK_IN_CUSTOMER_NAME = 'Khách lạ'; // khách mặc định khi tạo lịch không nhập khách
export const PLACEHOLDER_SERVICE_NAME = 'Giữ chỗ'; // dịch vụ mặc định khi tạo lịch không chọn dịch vụ

// ---- Lịch làm việc nhân viên ----
export const DEFAULT_SHIFT = { start: '09:00', end: '22:00' };

// ---- Chi nhánh ----
// Giờ mở cửa mặc định khi tạo chi nhánh mới / ngày chưa cấu hình trong form sửa
export const DEFAULT_OPENING_HOURS = {
  Monday: { isOpen: true, open: '08:00', close: '20:00' },
  Tuesday: { isOpen: true, open: '08:00', close: '20:00' },
  Wednesday: { isOpen: true, open: '08:00', close: '20:00' },
  Thursday: { isOpen: true, open: '08:00', close: '20:00' },
  Friday: { isOpen: true, open: '08:00', close: '20:00' },
  Saturday: { isOpen: true, open: '08:00', close: '20:00' },
  Sunday: { isOpen: true, open: '08:00', close: '20:00' }
};
export const DEFAULT_DAY_HOURS = { isOpen: true, open: '08:00', close: '20:00' };
// Hiển thị trên thẻ chi nhánh khi ngày đó chưa có dữ liệu giờ mở cửa
export const DISPLAY_FALLBACK_DAY_HOURS = { isOpen: true, open: '09:00', close: '22:00' };

// ---- Dịch vụ ----
export const SERVICE_CATEGORIES = ['Gội Đầu', 'Massage', 'Combo', '4 Tay', 'Dịch vụ thêm'];
export const SERVICE_COLORS = [
  '#EDF4EB', // Green
  '#F8EDDD', // Orange
  '#F1F1EF', // Grey
  '#F8F3EC', // Light Yellow
  '#ECF5F8', // Blue
  '#EEECF8', // Purple
  '#F8ECF4', // Pink
  '#FEECEC'  // Light Pink
];

// ---- Avatar trong panel thông báo ----
// Nhân viên có màu riêng: khớp khi tên (viết thường) bắt đầu bằng `prefix` hoặc chứa `contains`
export const EMPLOYEE_AVATAR_OVERRIDES = [
  { prefix: 'thủy', contains: 'thuy', letter: 'T', bg: '#ff9f43', color: '#ffffff' },   // Cam
  { prefix: 'hannie', contains: 'hannie', letter: 'H', bg: '#fd79a8', color: '#ffffff' }, // Hồng
  { prefix: 'phụng', contains: 'phung', letter: 'P', bg: '#9b59b6', color: '#ffffff' }   // Tím
];
// Màu avatar khách (chọn theo chữ cái đầu)
export const CUSTOMER_AVATAR_COLORS = [
  { bg: '#386665', color: '#ffffff' }, // Y Oi Teal
  { bg: '#edd3a9', color: '#603813' }, // Y Oi Accent Gold
  { bg: '#10ac84', color: '#ffffff' },
  { bg: '#2e86de', color: '#ffffff' },
  { bg: '#ee5253', color: '#ffffff' },
  { bg: '#ff9f43', color: '#ffffff' }
];
