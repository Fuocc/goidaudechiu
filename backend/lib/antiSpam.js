/**
 * Chống phá hoại "đặt ảo cho hết slot" từ landing page (chỉ áp dụng cho request CHƯA đăng nhập).
 *  - S1: đặt online tối đa MAX_ONLINE_GUESTS khách / lần.
 *  - S2: đếm theo SỐ SLOT đang chiếm chứ không theo số lần gửi:
 *        mỗi IP tối đa IP_SLOT_LIMIT slot tạo trong 1 giờ, mỗi SĐT tối đa PHONE_SLOT_LIMIT slot trong 24 giờ.
 *        Giữ chỗ đã nhả / hết hạn bị xóa khỏi DB nên không bị tính → khách thật đổi giờ nhiều lần không sao.
 *  - S3: mỗi IP chỉ có 1 bộ giữ chỗ tại một thời điểm (giữ chỗ mới → nhả bộ cũ).
 *  - S4: chỉ nhận SĐT di động Việt Nam.
 *  - S5: gắn cờ "Chờ xác nhận" khi cùng 1 IP đặt lịch với nhiều SĐT khác nhau.
 * S2 (theo IP), S3, S5 cần cột bookings.client_ip (backend/sql/2026-09-28_bookings_client_ip.sql).
 * Chưa có cột → các phần đó tự tắt, S5 quay về quy tắc cũ (SĐT đã đặt trong 30 phút).
 */

const MAX_ONLINE_GUESTS = 4;
const IP_SLOT_LIMIT = 6;
const IP_SLOT_WINDOW_MS = 60 * 60 * 1000;
const PHONE_SLOT_LIMIT = 6;
const PHONE_SLOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const SPAM_WINDOW_MS = 60 * 60 * 1000;
const SPAM_DISTINCT_PHONES = 2; // cùng IP, từ 2 SĐT khác nhau trở lên trong 1 giờ → gắn cờ
const LEGACY_SPAM_WINDOW_MS = 30 * 60 * 1000;

const HOLD_NOTE_PREFIX = '[GIỮ CHỖ TẠM THỜI]';
const PLACEHOLDER_PHONE = '0000000000';

const OVER_GUEST_LIMIT_MESSAGE =
  `Đặt online tối đa ${MAX_ONLINE_GUESTS} khách mỗi lần. Nhóm đông hơn vui lòng liên hệ Zalo hoặc Fanpage để Ý hỗ trợ nhé.`;
const IP_LIMIT_MESSAGE =
  'Thiết bị này đã đặt quá nhiều lịch trong 1 giờ qua. Vui lòng liên hệ hotline/Zalo để được hỗ trợ.';
const PHONE_LIMIT_MESSAGE =
  'Số điện thoại này đã đặt quá nhiều lịch trong hôm nay. Vui lòng liên hệ hotline/Zalo để được hỗ trợ.';

// "+84 912 345 678", "84912345678", "0912.345.678" → "0912345678". Không phải số di động VN → null.
function normalizeVnPhone(raw) {
  if (typeof raw !== 'string') return null;
  const compact = raw.trim().replace(/[\s().-]/g, '');
  const match = compact.match(/^(?:\+?84|0)([35789]\d{8})$/);
  return match ? `0${match[1]}` : null;
}

// ---- Cột bookings.client_ip đã được tạo chưa? (kiểm tra 1 lần, chưa có thì 10 phút thử lại) ----
let clientIpSupported = null;
let clientIpCheckedAt = 0;

async function supportsClientIp(supabase) {
  if (clientIpSupported === true) return true;
  if (clientIpSupported === false && Date.now() - clientIpCheckedAt < 10 * 60 * 1000) return false;

  const { error } = await supabase.from('bookings').select('client_ip').limit(1);
  clientIpCheckedAt = Date.now();
  clientIpSupported = !error;
  return clientIpSupported;
}

const sinceIso = (ms) => new Date(Date.now() - ms).toISOString();
const isUsableIp = (ip) => typeof ip === 'string' && ip && ip !== 'unknown';

// S3: nhả các giữ chỗ còn hiệu lực của IP này. Trả về danh sách id đã xóa.
async function releaseActiveHoldsForIp(supabase, ip) {
  if (!isUsableIp(ip) || !(await supportsClientIp(supabase))) return [];
  const { data, error } = await supabase
    .from('bookings')
    .delete()
    .eq('client_ip', ip)
    .eq('status', 'pending')
    .like('internal_note', `${HOLD_NOTE_PREFIX}%`)
    .select('id');
  if (error) return [];
  return (data || []).map(r => r.id);
}

// Số slot (dòng lịch) IP này đã tạo trong 1 giờ qua và vẫn còn tồn tại.
async function countIpSlots(supabase, ip) {
  if (!isUsableIp(ip) || !(await supportsClientIp(supabase))) return 0;
  const { count, error } = await supabase
    .from('bookings')
    .select('id', { count: 'exact', head: true })
    .eq('client_ip', ip)
    .neq('status', 'cancelled')
    .gte('created_at', sinceIso(IP_SLOT_WINDOW_MS));
  if (error) return 0; // lỗi DB → không chặn khách
  return count || 0;
}

// Số slot (dòng lịch) của SĐT này tạo trong 24 giờ qua.
async function countPhoneSlots(supabase, phone) {
  if (!phone) return 0;
  const { data, error } = await supabase
    .from('bookings')
    .select('id, customers!inner(phone)')
    .eq('customers.phone', phone)
    .neq('status', 'cancelled')
    .gte('created_at', sinceIso(PHONE_SLOT_WINDOW_MS));
  if (error) return 0;
  return (data || []).length;
}

/**
 * S2: kiểm tra còn "ngân sách slot" cho nhóm sắp tạo không.
 * checkIp = false khi chốt giữ chỗ: các slot đó đã được tính lúc giữ chỗ.
 * @returns {Promise<string|null>} thông báo lỗi nếu vượt giới hạn
 */
async function checkSlotBudget(supabase, { ip, phone, guestCount, checkIp = true }) {
  if (checkIp && (await countIpSlots(supabase, ip)) + guestCount > IP_SLOT_LIMIT) return IP_LIMIT_MESSAGE;
  if (phone && (await countPhoneSlots(supabase, phone)) + guestCount > PHONE_SLOT_LIMIT) return PHONE_LIMIT_MESSAGE;
  return null;
}

/**
 * S5: trạng thái + cảnh báo cho CẢ NHÓM (gọi 1 lần trước khi tạo, áp dụng chung cho mọi khách trong nhóm —
 * trước đây kiểm tra trong vòng lặp nên khách 2..n "thấy" lịch khách 1 vừa tạo và bị gắn cờ oan).
 * @returns {Promise<{ status: 'confirmed' | 'pending', internalNote: string | null }>}
 */
async function computeSpamFlag(supabase, { ip, phone }) {
  const clean = { status: 'confirmed', internalNote: null };
  if (!phone) return clean;

  try {
    if (isUsableIp(ip) && (await supportsClientIp(supabase))) {
      const { data, error } = await supabase
        .from('bookings')
        .select('id, customers(phone)')
        .eq('client_ip', ip)
        .neq('status', 'cancelled')
        .gte('created_at', sinceIso(SPAM_WINDOW_MS));
      if (error) throw error;

      const phones = new Set([phone]);
      for (const row of data || []) {
        const p = row.customers?.phone;
        if (p && p !== PLACEHOLDER_PHONE) phones.add(p);
      }
      if (phones.size >= SPAM_DISTINCT_PHONES) {
        return {
          status: 'pending',
          internalNote: `⚠️ Thiết bị này đã đặt lịch với ${phones.size} SĐT khác nhau trong 1 giờ qua (${[...phones].slice(0, 4).join(', ')}). Vui lòng gọi xác nhận trước khi giữ lịch.`
        };
      }
      return clean;
    }

    // Chưa có cột client_ip → quy tắc cũ: SĐT mới (chưa từng đặt trước đó) mà đã có đơn trong 30 phút qua
    const since = sinceIso(LEGACY_SPAM_WINDOW_MS);
    const { data: olderBookings } = await supabase
      .from('bookings')
      .select('id, customers!inner(phone)')
      .eq('customers.phone', phone)
      .lt('created_at', since)
      .limit(1);
    if (olderBookings && olderBookings.length > 0) return clean;

    const { data: recentBookings, error: recentErr } = await supabase
      .from('bookings')
      .select('id, customers!inner(phone)')
      .eq('customers.phone', phone)
      .gte('created_at', since);
    if (!recentErr && recentBookings && recentBookings.length > 0) {
      return {
        status: 'pending',
        internalNote: `⚠️ Khách hàng ${phone} đã có ${recentBookings.length} đơn trong 30 phút qua. Vui lòng xác nhận qua điện thoại.`
      };
    }
  } catch {
    // Kiểm tra spam lỗi → không gắn cờ, không chặn khách
  }
  return clean;
}

module.exports = {
  MAX_ONLINE_GUESTS,
  IP_SLOT_LIMIT,
  PHONE_SLOT_LIMIT,
  OVER_GUEST_LIMIT_MESSAGE,
  normalizeVnPhone,
  supportsClientIp,
  releaseActiveHoldsForIp,
  checkSlotBudget,
  computeSpamFlag
};
