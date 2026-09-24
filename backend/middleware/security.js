const crypto = require('crypto');
const supabase = require('../supabaseClient');
const { authenticate, hasRole, AuthError } = require('./auth');

/* ============================================================
 * 1. BẢNG PHÂN QUYỀN (path tính sau tiền tố /api)
 * Duyệt từ trên xuống, luật đầu tiên khớp sẽ được áp dụng.
 * Route KHÔNG có trong bảng → mặc định cần 'admin' (deny by default).
 * ============================================================ */
const ID = '[^/]+';
const ACCESS_RULES = [
  // ---- Staff (đặt trước các luật public trùng tiền tố) ----
  { method: 'GET', path: /^\/services\/all$/, role: 'staff' },
  { method: 'GET', path: /^\/events\/ticket$/, role: 'staff' },

  // ---- Public: landing page + tiện ích ----
  { method: 'GET', path: /^\/health$/, role: 'public' },
  { method: 'GET', path: new RegExp(`^/branches(/${ID})?$`), role: 'public' },
  { method: 'GET', path: new RegExp(`^/services(/${ID})?$`), role: 'public' },
  { method: 'GET', path: /^\/availability(\/merged)?$/, role: 'public' },
  { method: 'POST', path: /^\/bookings$/, role: 'public' },          // landing: route tự giới hạn field khi chưa đăng nhập
  { method: 'POST', path: /^\/bookings\/hold$/, role: 'public' },
  { method: 'DELETE', path: /^\/bookings\/hold$/, role: 'public' },
  { method: 'GET', path: /^\/notifications\/vapid-public-key$/, role: 'public' },
  { method: 'GET', path: /^\/events$/, role: 'public' },            // route tự kiểm tra vé SSE

  // ---- Staff: vận hành hằng ngày ----
  { method: 'POST', path: /^\/bookings\/command-v2$/, role: 'staff' },
  { method: 'POST', path: /^\/bookings\/undo$/, role: 'staff' },
  { method: 'GET', path: new RegExp(`^/bookings(/${ID})?$`), role: 'staff' },
  { method: 'PUT', path: new RegExp(`^/bookings/${ID}(/status)?$`), role: 'staff' },
  { method: 'DELETE', path: new RegExp(`^/bookings/${ID}$`), role: 'staff' },
  { method: 'GET', path: new RegExp(`^/customers(/${ID})?$`), role: 'staff' },
  { method: 'POST', path: /^\/customers$/, role: 'staff' },
  { method: 'PUT', path: new RegExp(`^/customers/${ID}$`), role: 'staff' },
  { method: 'DELETE', path: new RegExp(`^/customers/${ID}$`), role: 'staff' },
  { method: 'GET', path: new RegExp(`^/employees(/${ID})?$`), role: 'staff' },
  { method: 'GET', path: /^\/employee-schedules$/, role: 'staff' },
  { method: 'GET', path: /^\/beds$/, role: 'staff' },
  { method: 'GET', path: /^\/settings$/, role: 'staff' },
  { method: 'POST', path: /^\/notifications\/(subscribe|unsubscribe)$/, role: 'staff' },
  { method: '*', path: /^\/notifications\/dashboard(\/.*)?$/, role: 'staff' },

  // ---- Dev ----
  { method: '*', path: /^\/dev(\/.*)?$/, role: 'dev' }
];

function requiredRoleFor(method, path) {
  const rule = ACCESS_RULES.find(r => (r.method === '*' || r.method === method) && r.path.test(path));
  return rule ? rule.role : 'admin';
}

async function accessControl(req, res, next) {
  if (req.method === 'OPTIONS') return next();
  const needed = requiredRoleFor(req.method, req.path);

  try {
    // Luôn xác thực nếu có gửi token (kể cả route public) để route biết ai đang gọi
    req.auth = await authenticate(req);
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 401;
    return res.status(status).json({ success: false, error: err.message });
  }

  if (needed === 'public') return next();
  if (!req.auth) return res.status(401).json({ success: false, error: 'Vui lòng đăng nhập.' });
  if (!hasRole(req.auth, needed)) {
    return res.status(403).json({ success: false, error: 'Bạn không có quyền thực hiện thao tác này.' });
  }
  next();
}

/* ============================================================
 * 2. IP THẬT CỦA CLIENT
 * Landing page đi qua proxy Netlify → Render. Netlify gắn IP thật vào
 * x-nf-client-connection-ip; nếu không có thì lấy IP đầu tiên của x-forwarded-for.
 * (Header có thể bị giả mạo khi gọi thẳng vào Render — chỉ dùng cho rate limit, không dùng để cấp quyền.)
 * ============================================================ */
function getClientIp(req) {
  const nf = req.headers['x-nf-client-connection-ip'];
  if (typeof nf === 'string' && nf) return nf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff) return xff.split(',')[0].trim();
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/* ============================================================
 * 3. RATE LIMIT (bộ nhớ trong — reset khi Render khởi động lại)
 * ============================================================ */
function createRateLimiter({ name, windowMs, max, keyFn, message, skip }) {
  const hits = new Map();

  setInterval(() => {
    const now = Date.now();
    for (const [key, list] of hits.entries()) {
      const recent = list.filter(t => now - t < windowMs);
      if (recent.length) hits.set(key, recent); else hits.delete(key);
    }
  }, Math.max(windowMs, 60 * 1000)).unref();

  return function rateLimiter(req, res, next) {
    if (skip && skip(req)) return next();
    const key = `${name}:${keyFn(req)}`;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter(t => now - t < windowMs);
    if (recent.length >= max) {
      res.setHeader('Retry-After', Math.ceil(windowMs / 1000));
      return res.status(429).json({ success: false, error: message });
    }
    recent.push(now);
    hits.set(key, recent);
    next();
  };
}

// Chống quét dữ liệu / spam chung cho toàn bộ API
const globalLimiter = createRateLimiter({
  name: 'global',
  windowMs: 60 * 1000,
  max: 300,
  keyFn: (req) => req.auth ? `user:${req.auth.id}` : `ip:${getClientIp(req)}`,
  message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau ít phút.'
});

// Giữ chỗ tạm từ landing page (trước đây không giới hạn → có thể khóa hết khung giờ)
const holdLimiter = createRateLimiter({
  name: 'hold',
  windowMs: 5 * 60 * 1000,
  max: 12,
  keyFn: (req) => getClientIp(req),
  skip: (req) => !!req.auth,
  message: 'Bạn đã giữ chỗ quá nhiều lần, vui lòng đợi vài phút hoặc liên hệ hotline/Zalo.'
});

// AI chat: bảo vệ quota Gemini miễn phí
const aiLimiter = createRateLimiter({
  name: 'ai',
  windowMs: 10 * 60 * 1000,
  max: 40,
  keyFn: (req) => req.auth?.id || getClientIp(req),
  message: 'Bạn đã gửi quá nhiều lệnh AI trong 10 phút, vui lòng đợi một chút.'
});

/* ============================================================
 * 4. HEADER BẢO MẬT (thay cho thư viện helmet — không thêm dependency)
 * ============================================================ */
function securityHeaders(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

/* ============================================================
 * 5. ẨN LỖI 500 (không lộ tên bảng/cột/câu lỗi DB ra ngoài)
 * Lỗi gốc vẫn được ghi vào log Render kèm mã tra cứu.
 * ============================================================ */
function hideInternalErrors(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode === 500 && body && typeof body === 'object' && body.error) {
      const ref = crypto.randomBytes(4).toString('hex');
      console.error(`[500 ${ref}] ${req.method} ${req.originalUrl}:`, body.error);
      return originalJson({ success: false, error: `Lỗi hệ thống, vui lòng thử lại (mã ${ref}).` });
    }
    return originalJson(body);
  };
  next();
}

/* ============================================================
 * 6. NHẬT KÝ THAO TÁC (audit_log) — mọi thao tác ghi của người đã đăng nhập
 * Không ghi nội dung body (tránh lưu dữ liệu khách).
 * ============================================================ */
let auditWarned = false;
function writeAudit(entry) {
  supabase.from('audit_log').insert(entry).then(({ error }) => {
    if (error && !auditWarned) {
      auditWarned = true;
      console.warn('[audit] Không ghi được audit_log (đã chạy SQL Bước 3 chưa?):', error.message);
    }
  }, () => {});
}

function auditTrail(req, res, next) {
  if (req.method === 'GET' || req.method === 'OPTIONS') return next();
  res.on('finish', () => {
    if (!req.auth) return;
    const segments = req.path.split('/').filter(Boolean);
    writeAudit({
      actor_id: req.auth.id,
      actor_role: req.auth.role,
      action: `${req.method} /api${req.path}`,
      entity: segments[0] || null,
      entity_id: segments[1] || null,
      details: { status: res.statusCode },
      ip: getClientIp(req)
    });
  });
  next();
}

/* ============================================================
 * 7. VÉ SSE — EventSource không gửi được header Authorization,
 * nên client lấy vé ngắn hạn (60s, dùng 1 lần) qua API có xác thực rồi mới mở kết nối.
 * ============================================================ */
const SSE_SECRET = crypto.randomBytes(32);
const SSE_TICKET_TTL_MS = 60 * 1000;
const usedTickets = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [nonce, exp] of usedTickets.entries()) {
    if (exp <= now) usedTickets.delete(nonce);
  }
}, 60 * 1000).unref();

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function issueSseTicket(auth) {
  const payload = `${auth.id}|${auth.role}|${Date.now() + SSE_TICKET_TTL_MS}|${crypto.randomBytes(12).toString('hex')}`;
  const sig = crypto.createHmac('sha256', SSE_SECRET).update(payload).digest();
  return `${b64url(payload)}.${b64url(sig)}`;
}

function verifySseTicket(ticket) {
  if (typeof ticket !== 'string' || !ticket.includes('.')) return null;
  const [payloadPart, sigPart] = ticket.split('.');
  let payload;
  try {
    payload = Buffer.from(payloadPart, 'base64url').toString('utf8');
  } catch (e) {
    return null;
  }
  const expected = crypto.createHmac('sha256', SSE_SECRET).update(payload).digest();
  const given = Buffer.from(sigPart || '', 'base64url');
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;

  const [userId, role, expStr, nonce] = payload.split('|');
  const exp = parseInt(expStr, 10);
  if (!exp || exp < Date.now() || usedTickets.has(nonce)) return null;
  usedTickets.set(nonce, exp);
  return { id: userId, role };
}

module.exports = {
  accessControl,
  requiredRoleFor,
  getClientIp,
  createRateLimiter,
  globalLimiter,
  holdLimiter,
  aiLimiter,
  securityHeaders,
  hideInternalErrors,
  auditTrail,
  writeAudit,
  issueSseTicket,
  verifySseTicket
};
