/**
 * Phần chuyển đổi (thuần) cho tool AI → Booking change. Xem ROADMAP.md › "Group rules" (AI tools).
 */
const { toMinutes, endTime } = require('./timeOfDay');

// Field model được phép đổi qua update_booking; mọi tham số khác (giường, giá, giờ kết thúc…) bị bỏ, không ghi
const AI_CHANGE_FIELDS = ['booking_date', 'start_time', 'service_id', 'branch_id', 'employee_id', 'notes'];

// Không gửi / giá trị lạ → cả nhóm (AI mặc định cả nhóm, trừ khi người dùng chỉ rõ 1 khách)
const normalizeScope = (scope) => (scope === 'booking' ? 'booking' : 'group');

// Lời có nói giờ: "18h50", "6g", "18:50", "30p", "2 tiếng", "bây giờ", "chiều", "dời"…
// Số phải đứng riêng và chữ giờ không phải đầu 1 từ → SĐT "4050", "4050 gội", "2 phòng" không tính
const TIME_PATTERN = new RegExp([
  String.raw`(?<!\d)\d{1,2}\s*(h|g|giờ)(?!\p{L})`,
  String.raw`(?<!\d)\d{1,2}:\d{2}`,
  String.raw`(?<!\d)\d+\s*(p|phút|tiếng)(?!\p{L})`,
  String.raw`(?<!\p{L})(bây giờ|now|liền|sớm|muộn|trễ|lùi|dời|đẩy|sáng|trưa|chiều|tối|đêm|tiếng|phút)(?!\p{L})`
].join('|'), 'u');
const mentionsTime = (text) => TIME_PATTERN.test(String(text || '').normalize('NFC').toLowerCase());

/**
 * Tham số update_booking của model → { scope, change } cho changeBooking.
 * @param params    tham số model gửi
 * @param booking   lịch đang lưu
 * @param userTexts lời người dùng (lệnh này + lượt trước); không lời nào nói giờ → bỏ start_time model tự đặt
 * @param contact   kết quả matchContact khi model gửi customer_name: gắn hồ sơ hoặc tên riêng (không bao giờ vào ghi chú)
 */
function toBookingChange(params, booking, { userTexts, contact } = {}) {
  const change = {};
  for (const key of AI_CHANGE_FIELDS) {
    if (params[key] !== undefined) change[key] = params[key];
  }
  if (contact?.customerId) Object.assign(change, { customer_id: contact.customerId, temporary_name: null });
  else if (contact?.temporaryName) Object.assign(change, { customer_id: null, temporary_name: contact.temporaryName });
  // Lời người dùng không nói giờ → bỏ giờ model tự đặt, báo lại để AI nói lý do. "Vẫn lưu" gửi lại cũng lọc y vậy
  // (token được cấp trên tham số đã lọc → phải lọc giống vậy mới khớp)
  let ignoredStartTime;
  if (change.start_time !== undefined && userTexts && !userTexts.some(mentionsTime)) {
    ignoredStartTime = change.start_time;
    delete change.start_time;
  }
  // Không đổi dịch vụ → giữ thời lượng đang đặt (module mặc định tính theo dịch vụ → lịch đã kéo dài bị rút ngắn)
  if (change.service_id === undefined) {
    const start = change.start_time || booking.start_time;
    change.end_time = endTime(start, toMinutes(booking.end_time) - toMinutes(booking.start_time));
  }
  return { scope: normalizeScope(params.scope), change, ignoredStartTime };
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

// Danh xưng đứng đầu tên, phải là chữ riêng ("Anhthư" không có danh xưng); "c." / "a." viết tắt của chị / anh
const TITLE_PATTERN = /^(chị|anh|cô|em|c\.|a\.)\s+/;
const TITLE_ALIAS = { 'c.': 'chị', 'a.': 'anh' };
const plainName = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();
// "Chị Linh" / "Cô Mai" / "a. Nam" → "linh" / "mai" / "nam"
const bareName = (s) => plainName(s).replace(TITLE_PATTERN, '');
const titleOf = (s) => {
  const t = plainName(s).match(TITLE_PATTERN)?.[1];
  return t ? (TITLE_ALIAS[t] || t) : null;
};

/**
 * Tên (+ vài số trong SĐT) người dùng nói → khách đặt (Contact) của lịch. Xem ROADMAP.md › "Group rules" (AI tools).
 * @param name      tên người dùng nói, VD "Chị Linh"
 * @param phoneHint vài số trong SĐT, VD "4050" (không bắt buộc)
 * @param customers hồ sơ khách tìm theo tên [{ id, name, phone }]
 * @returns {{ customerId } | { temporaryName } | { candidates: { customer_id, name, phone }[] }}
 *   Có số: khớp tên + số đúng 1 → gắn; từ 2 → hỏi lại; không có → tên riêng.
 *   Chỉ có tên: đúng 1 hồ sơ cùng tên → gắn; còn lại → tên riêng.
 *   Danh xưng: khác danh xưng (Cô Mai / Chị Mai) → khác người; 1 bên không có danh xưng → chỉ tính khi chỉ có đúng 1 người tên đó.
 */
function matchContact({ name, phoneHint, customers = [] }) {
  const sameName = customers.filter(c => bareName(c.name) === bareName(name));
  const title = titleOf(name);
  const byName = sameName.filter(c => {
    const t = titleOf(c.name);
    if (t && title) return t === title;
    if (!t && !title) return true;
    return sameName.length === 1;
  });
  const digits = String(phoneHint || '').replace(/\D/g, '');
  const matches = digits ? byName.filter(c => String(c.phone || '').replace(/\D/g, '').includes(digits)) : byName;
  if (matches.length === 1) return { customerId: matches[0].id };
  if (digits && matches.length > 1) {
    return { candidates: matches.map(c => ({ customer_id: c.id, name: c.name, phone: c.phone })) };
  }
  return { temporaryName: String(name).trim() };
}

module.exports = { toBookingChange, normalizeScope, guestChoice, matchContact, bareName };
