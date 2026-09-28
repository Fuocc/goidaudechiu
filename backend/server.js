const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();
const { startAutoScheduler } = require('./autoScheduler');
const {
  accessControl,
  globalLimiter,
  securityHeaders,
  hideInternalErrors,
  auditTrail,
  issueSseTicket,
  verifySseTicket
} = require('./middleware/security');
const { getTurnstileSiteKey } = require('./lib/turnstile');

const app = express();
const PORT = process.env.PORT || 3000;

// Render đứng sau 1 lớp proxy → để Express đọc đúng giao thức/IP
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ---- SSE (Server-Sent Events) client management ----
const sseClients = new Set();
const MAX_SSE_CLIENTS = 100;

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of [...sseClients]) {
    try {
      res.write(payload);
    } catch (err) {
      sseClients.delete(res);
    }
  }

  // Tự động gửi Web Push thông báo khi có sự kiện đặt lịch mới thành công (booking.created)
  if (event === 'booking.created') {
    try {
      const bookingsRouter = require('./routes/bookings');
      if (bookingsRouter && typeof bookingsRouter.notifyNewBooking === 'function') {
        bookingsRouter.notifyNewBooking(data).catch(err => console.error('❌ Web Push notify error:', err));
      }
    } catch (err) {
      console.error('❌ Web Push notify error:', err);
    }
  }
}

// Make broadcastSSE available globally for route modules
app.set('broadcastSSE', broadcastSSE);

// ---- CORS ----
// Đổi domain → cập nhật biến môi trường ALLOWED_ORIGINS trên Render (phân tách bằng dấu phẩy), không cần sửa code.
const DEFAULT_ORIGINS = [
  'https://yoi-dashboard.netlify.app',
  'https://goidaudechiu-dev.netlify.app'
];
const envOrigins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
const allowedOrigins = [...(envOrigins.length ? envOrigins : DEFAULT_ORIGINS)];
if (process.env.RENDER_EXTERNAL_URL) allowedOrigins.push(process.env.RENDER_EXTERNAL_URL); // landing phục vụ trực tiếp từ Render

// Chỉ khi chạy máy local (không phải Render): cho phép localhost & IP Wi-Fi nội bộ để test trên điện thoại
const devOriginPatterns = process.env.RENDER ? [] : [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/,
  /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,
  /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/
];

const corsOptions = {
  origin(origin, callback) {
    // Request không có Origin (cùng domain, server-to-server) → cho qua; quyền truy cập do accessControl quyết định
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.includes(origin) || devOriginPatterns.some(p => p.test(origin));
    if (allowed) return callback(null, true);
    const err = new Error('Not allowed by CORS');
    err.status = 403;
    callback(err);
  },
  credentials: false, // dùng Bearer token, không dùng cookie
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Dashboard-Source', 'x-dashboard-source'],
  maxAge: 600
};

// ---- Middleware (thứ tự quan trọng) ----
app.use(securityHeaders);
app.use(cors(corsOptions));
// Ảnh chi nhánh gửi dạng base64 (tối đa ~1MB) → riêng /api/branches cho phép body lớn hơn
app.use('/api/branches', express.json({ limit: '2mb' }));
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ limit: '100kb', extended: true }));
app.use('/api', hideInternalErrors);
app.use('/api', accessControl);   // xác thực + phân quyền theo bảng ACCESS_RULES
app.use('/api', globalLimiter);
app.use('/api', auditTrail);

// API Routes
app.use('/api/branches', require('./routes/branches'));
app.use('/api/services', require('./routes/services'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/beds', require('./routes/beds'));
app.use('/api/bookings/command-v2', require('./routes/bookingCommandsV2'));
const bookingsRouter = require('./routes/bookings');
app.use('/api/bookings', bookingsRouter);
app.use('/api/availability', require('./routes/availability'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/employee-schedules', require('./routes/employeeSchedules'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/notifications', require('./routes/notifications'));

// Endpoint /api/events/trigger đã bị xóa: không có hệ thống nào gọi, và nó cho phép bất kỳ ai
// phát sự kiện/push giả tới dashboard.

// ---- SSE: lấy vé (cần đăng nhập — accessControl đã kiểm tra) ----
app.get('/api/events/ticket', (req, res) => {
  res.json({ ticket: issueSseTicket(req.auth) });
});

// ---- SSE Endpoint for Dashboard Live Updates ----
app.get('/api/events', (req, res) => {
  const viewer = verifySseTicket(req.query.ticket);
  if (!viewer) {
    return res.status(401).json({ success: false, error: 'Vé kết nối realtime không hợp lệ hoặc đã hết hạn.' });
  }
  if (sseClients.size >= MAX_SSE_CLIENTS) {
    return res.status(503).json({ success: false, error: 'Quá nhiều kết nối realtime.' });
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no'
  });

  // Send initial connection event
  res.write('event: connected\ndata: {"status":"connected"}\n\n');

  sseClients.add(res);
  // Heartbeat every 30s to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      res.write('event: heartbeat\ndata: {}\n\n');
    } catch (_) {
      clearInterval(heartbeat);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Landing page lấy site key Turnstile (công khai). null → Turnstile đang tắt, không hiện widget.
app.get('/api/turnstile/config', (req, res) => {
  res.json({ site_key: getTurnstileSiteKey() });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Fallback to serve frontend HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

app.get('/en', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'en.html'));
});

app.get('/booking', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'booking.html'));
});

app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'booking.html'));
});

app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

// ---- Error handler cuối cùng: không bao giờ trả stack trace ra ngoài ----
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({ success: false, error: 'Nguồn truy cập không được phép.' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, error: 'Dữ liệu gửi lên quá lớn.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, error: 'Dữ liệu gửi lên không hợp lệ.' });
  }
  console.error('[unhandled]', req.method, req.originalUrl, err);
  res.status(500).json({ success: false, error: 'Lỗi hệ thống, vui lòng thử lại.' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
  // Bật bộ tự động xếp lịch mỗi ngày
  startAutoScheduler();
});
