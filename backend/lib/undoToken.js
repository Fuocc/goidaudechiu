/**
 * Ký số dữ liệu hoàn tác (undo) của AI chat.
 *
 * Trước đây client gửi lại nguyên `snapshot` và backend ghi thẳng vào DB → bất kỳ tài khoản staff nào
 * cũng sửa được giá/trạng thái của mọi lịch qua /bookings/undo. Giờ:
 *  - Khi AI thực hiện thao tác, server gắn vào action: `after` (dấu vân tay trạng thái SAU thao tác của
 *    từng lịch), `iat`, `uid` và `sig` = HMAC(toàn bộ action). Client chỉ lưu và gửi lại nguyên văn.
 *  - Khi hoàn tác: chữ ký sai / quá hạn / khác người tạo → từ chối. Lịch nào có dấu vân tay hiện tại
 *    khác `after` (đã bị sửa sau đó, hoặc đã hoàn tác rồi) → bỏ qua, không ghi đè.
 * Không cần thêm bảng DB. Khóa ký: UNDO_SIGNING_SECRET, chưa đặt thì suy ra từ CLERK_SECRET_KEY.
 */
const crypto = require('crypto');
const supabase = require('../supabaseClient');

// Các trường được khôi phục khi hoàn tác (cũng là các trường dùng để tính dấu vân tay)
const { RESTORE_FIELDS: UNDO_RESTORE_FIELDS } = require('./bookingChange');
const UNDO_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let cachedKey = null;
function signingKey() {
  if (cachedKey) return cachedKey;
  if (process.env.UNDO_SIGNING_SECRET) {
    cachedKey = Buffer.from(process.env.UNDO_SIGNING_SECRET, 'utf8');
  } else if (process.env.CLERK_SECRET_KEY) {
    // Suy ra một khóa con (không dùng trực tiếp khóa Clerk làm khóa ký)
    cachedKey = crypto.createHmac('sha256', process.env.CLERK_SECRET_KEY).update('yoi-undo-signing-v1').digest();
    console.warn('[undo] Chưa đặt UNDO_SIGNING_SECRET — đang dùng khóa suy ra từ CLERK_SECRET_KEY.');
  } else {
    throw new Error('Thiếu UNDO_SIGNING_SECRET để ký dữ liệu hoàn tác');
  }
  return cachedKey;
}

// JSON ổn định (sắp xếp key, bỏ key undefined như JSON.stringify) để chữ ký không đổi sau khi
// action đi một vòng qua client (JSON.parse/stringify, localStorage).
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(v => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter(k => value[k] !== undefined).sort();
    return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value === undefined ? null : value);
}

function fingerprintRow(row) {
  if (!row) return null;
  const picked = {};
  for (const field of UNDO_RESTORE_FIELDS) picked[field] = row[field] ?? null;
  return crypto.createHash('sha256').update(stableStringify(picked)).digest('base64url');
}

function computeSig(action) {
  const { type, booking_ids, snapshot, after, iat, uid } = action;
  return crypto.createHmac('sha256', signingKey())
    .update(stableStringify({ type, booking_ids, snapshot, after, iat, uid }))
    .digest('base64url');
}

// Đọc trạng thái hiện tại của các lịch → { id: dấu vân tay | null nếu không còn }
async function fingerprintsFor(ids) {
  const result = Object.fromEntries(ids.map(id => [id, null]));
  if (ids.length === 0) return result;
  const { data, error } = await supabase.from('bookings').select('*').in('id', ids);
  if (error) throw error;
  for (const row of data || []) result[row.id] = fingerprintRow(row);
  return result;
}

/**
 * Gắn after/iat/uid/sig vào action vừa thực hiện. Phải gọi NGAY sau khi tool chạy xong (trước tool kế
 * tiếp) để `after` là trạng thái sau đúng thao tác này — nếu 1 lệnh sửa cùng lịch 2 lần, hoàn tác theo
 * thứ tự ngược vẫn khớp từng bước. Lỗi khi ký → trả action chưa ký (hoàn tác sẽ bị từ chối), không làm
 * hỏng lệnh AI.
 */
async function signUndoAction(action, userId) {
  try {
    const ids = Array.isArray(action.booking_ids) ? action.booking_ids : [];
    const signed = { ...action, after: await fingerprintsFor(ids), iat: Date.now(), uid: userId || null };
    signed.sig = computeSig(signed);
    return signed;
  } catch (err) {
    console.error('[undo] Không ký được dữ liệu hoàn tác:', err.message);
    return action;
  }
}

/** Kiểm tra chữ ký + hạn + người tạo. Trả { ok: true } hoặc { ok: false, error } */
function verifyUndoAction(action, userId) {
  if (!action || typeof action.sig !== 'string' || !action.after || typeof action.iat !== 'number') {
    return { ok: false, error: 'Thao tác này được tạo trước bản cập nhật bảo mật nên không thể hoàn tác tự động. Vui lòng sửa lịch thủ công.' };
  }
  let expected;
  try {
    expected = computeSig(action);
  } catch (err) {
    return { ok: false, error: 'Máy chủ chưa cấu hình khóa hoàn tác.' };
  }
  const a = Buffer.from(action.sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Dữ liệu hoàn tác không hợp lệ.' };
  }
  if (Date.now() - action.iat > UNDO_MAX_AGE_MS) {
    return { ok: false, error: 'Thao tác đã quá 24 giờ, không thể hoàn tác.' };
  }
  if (action.uid && userId && action.uid !== userId) {
    return { ok: false, error: 'Chỉ người đã ra lệnh mới hoàn tác được thao tác này.' };
  }
  return { ok: true };
}

module.exports = {
  UNDO_MAX_AGE_MS,
  fingerprintRow,
  signUndoAction,
  verifyUndoAction,
  signingKey,       // dùng chung cho token xác nhận của AI (lib/confirmToken.js)
  stableStringify
};
