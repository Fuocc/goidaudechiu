const supabase = require('../supabaseClient');
const { getClientIp } = require('./security');
const { normalizeVnPhone, maskPhone } = require('../lib/antiSpam');

// In-memory store for IP rate limiting
// Key: IP, Value: Array of timestamps of booking attempts
const ipStore = new Map();

const WINDOW_MS = 5 * 60 * 1000; // 5 minutes
const MAX_LIMIT = 3;

/**
 * Custom Rate Limiter Middleware
 * Protects booking creation from spam by restricting attempts per IP and Phone number.
 */
async function bookingRateLimiter(req, res, next) {
  // Chỉ bỏ qua giới hạn cho người đã ĐĂNG NHẬP dashboard (req.auth do accessControl xác thực).
  // Trước đây bỏ qua theo header X-Dashboard-Source: ai cũng tự gửi header đó được.
  if (req.auth) {
    return next();
  }

  const ip = getClientIp(req);
  // Chỉ nhận chuỗi — dữ liệu lạ (object/array) trước đây làm .trim() ném lỗi và treo request
  const customer_phone = typeof req.body?.customer_phone === 'string' ? req.body.customer_phone : '';
  const now = Date.now();

  // 0) --- Bypasses for Development & Testing ---

  // A. Environment Variable / Dev Mode Bypass
  // if (process.env.DISABLE_RATE_LIMITER === 'true' || process.env.NODE_ENV === 'development') {
  //   console.log('⚡ Rate limiter bypassed: Development mode or DISABLE_RATE_LIMITER=true');
  //   return next();
  // }

  // B. Localhost Loopback Bypass (127.0.0.1, ::1)
  // const isLocalIp = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  // if (isLocalIp) {
  //   console.log(`⚡ Rate limiter bypassed: Localhost developer IP (${ip})`);
  //   return next();
  // }

  // C. Tester Phone Numbers Bypass — chỉ khi chạy local (trên Render ai cũng dùng số 0999... để lách được)
  if (!process.env.RENDER && typeof customer_phone === 'string' && customer_phone.trim().startsWith('0999')) {
    return next();
  }

  // 1) --- IP-based Rate Limiting ---
  if (!ipStore.has(ip)) {
    ipStore.set(ip, []);
  }

  const ipTimestamps = ipStore.get(ip);
  // Filter out timestamps older than 5 minutes
  const recentIpAttempts = ipTimestamps.filter(t => now - t < WINDOW_MS);

  if (recentIpAttempts.length >= MAX_LIMIT) {
    console.warn(`[rateLimit] Chặn IP ${ip}: quá ${MAX_LIMIT} lần đặt lịch / 5 phút`);
    return res.status(429).json({
      error: 'Bạn đã đặt lịch quá 3 lần trong vòng 5 phút từ thiết bị này. Vui lòng đợi 5 phút hoặc liên hệ hotline/Zalo để được hỗ trợ nhanh nhất.'
    });
  }

  // 2) --- Phone-based Rate Limiting ---
  if (customer_phone) {
    // So theo dạng đã chuẩn hóa (route lưu SĐT dạng 0xxxxxxxxx) → '0912 345 678' và '0912345678' là cùng 1 số
    const cleanPhone = normalizeVnPhone(customer_phone) || customer_phone.trim();
    // Do not rate limit placeholder walk-in phones (e.g. 0000000000)
    const isWalkIn = /^0+$/.test(cleanPhone);

    if (!isWalkIn) {
      try {
        const fiveMinAgo = new Date(now - WINDOW_MS).toISOString();

        // Query bookings created in the last 5 minutes associated with this phone number
        const { data: recentBookings, error } = await supabase
          .from('bookings')
          .select('id, created_at, customers!inner(phone)')
          .eq('customers.phone', cleanPhone)
          .gte('created_at', fiveMinAgo);

        if (error) {
          // Do not block the booking if database error occurs during check
          console.error('[rateLimit] Không kiểm tra được giới hạn theo SĐT:', error.message);
        } else if (recentBookings && recentBookings.length >= MAX_LIMIT) {
          console.warn(`[rateLimit] Chặn SĐT ${maskPhone(cleanPhone)} (IP ${ip}): đã có ${recentBookings.length} lịch / 5 phút`);
          return res.status(429).json({
            error: 'Số điện thoại này đã đặt 3 lịch hẹn trong 5 phút qua. Vui lòng đợi 5 phút hoặc liên hệ hotline/Zalo để được hỗ trợ nhanh nhất.'
          });
        }
      } catch (err) {

      }
    }
  }

  // Record successful request pass for IP
  recentIpAttempts.push(now);
  ipStore.set(ip, recentIpAttempts);

  next();
}

// Clean up expired IP entries every 10 minutes to prevent memory leaks
setInterval(() => {
  const now = Date.now();
  for (const [ip, timestamps] of ipStore.entries()) {
    const validTimestamps = timestamps.filter(t => now - t < WINDOW_MS);
    if (validTimestamps.length === 0) {
      ipStore.delete(ip);
    } else {
      ipStore.set(ip, validTimestamps);
    }
  }
}, 10 * 60 * 1000);

module.exports = bookingRateLimiter;
