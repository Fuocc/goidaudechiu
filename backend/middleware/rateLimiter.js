const supabase = require('../supabaseClient');

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
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
  const { customer_phone } = req.body;
  const now = Date.now();

  // 0) --- Bypasses for Development & Testing ---

  // A. Environment Variable / Dev Mode Bypass
  if (process.env.DISABLE_RATE_LIMITER === 'true' || process.env.NODE_ENV === 'development') {
    console.log('⚡ Rate limiter bypassed: Development mode or DISABLE_RATE_LIMITER=true');
    return next();
  }

  // B. Localhost Loopback Bypass (127.0.0.1, ::1)
  const isLocalIp = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  if (isLocalIp) {
    console.log(`⚡ Rate limiter bypassed: Localhost developer IP (${ip})`);
    return next();
  }

  // C. Tester Phone Numbers Bypass
  // Any phone number starting with '0999' is designated for testing and won't be rate-limited
  if (customer_phone && customer_phone.trim().startsWith('0999')) {
    console.log(`⚡ Rate limiter bypassed: Tester phone number detected (${customer_phone})`);
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
    console.warn(`🛑 Rate limit triggered: IP ${ip} has made ${recentIpAttempts.length} attempts in the last 5 minutes.`);
    return res.status(429).json({
      error: 'Bạn đã đặt lịch quá 3 lần trong vòng 5 phút từ thiết bị này. Vui lòng đợi 5 phút hoặc liên hệ hotline/Zalo để được hỗ trợ nhanh nhất.'
    });
  }

  // 2) --- Phone-based Rate Limiting ---
  if (customer_phone) {
    const cleanPhone = customer_phone.trim();
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
          console.error('❌ Error querying bookings for phone rate limit:', error);
          // Do not block the booking if database error occurs during check
        } else if (recentBookings && recentBookings.length >= MAX_LIMIT) {
          console.warn(`🛑 Rate limit triggered: Phone ${cleanPhone} has ${recentBookings.length} bookings in the last 5 minutes.`);
          return res.status(429).json({
            error: 'Số điện thoại này đã đặt 3 lịch hẹn trong 5 phút qua. Vui lòng đợi 5 phút hoặc liên hệ hotline/Zalo để được hỗ trợ nhanh nhất.'
          });
        }
      } catch (err) {
        console.error('❌ Exception in phone rate limiter:', err);
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
