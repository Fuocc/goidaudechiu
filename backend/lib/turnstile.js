/**
 * Cloudflare Turnstile (captcha miễn phí, thường vô hình với khách thật) cho giữ chỗ + đặt lịch từ landing page.
 * Bật bằng 2 biến môi trường trên Render: TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY.
 * Thiếu 1 trong 2 → tắt hẳn (landing không hiện widget, backend không kiểm tra) để không chặn nhầm khách.
 */
const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const TURNSTILE_FAILED_MESSAGE = 'Không xác minh được thiết bị của bạn. Vui lòng tải lại trang và thử lại.';

function isTurnstileEnabled() {
  return !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
}

// Site key là thông tin công khai — landing lấy qua GET /api/turnstile/config
function getTurnstileSiteKey() {
  return isTurnstileEnabled() ? process.env.TURNSTILE_SITE_KEY : null;
}

/**
 * @returns {Promise<boolean>} true nếu hợp lệ (hoặc Turnstile đang tắt)
 * Không gọi được Cloudflare (mạng lỗi / timeout) → cho qua, để sự cố phía Cloudflare không chặn khách thật.
 */
async function verifyTurnstile(token, ip) {
  if (!isTurnstileEnabled()) return true;
  if (typeof token !== 'string' || !token || token.length > 2048) return false;

  try {
    const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
    if (ip && ip !== 'unknown') body.set('remoteip', ip);
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
    const data = await res.json();
    if (data.success !== true) {
      console.warn('[turnstile] Token không hợp lệ:', (data['error-codes'] || []).join(', '));
    }
    return data.success === true;
  } catch (err) {
    console.warn('[turnstile] Không gọi được Cloudflare, tạm cho qua:', err.message);
    return true;
  }
}

module.exports = { TURNSTILE_FAILED_MESSAGE, isTurnstileEnabled, getTurnstileSiteKey, verifyTurnstile };
