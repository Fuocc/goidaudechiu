const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ---- SSE (Server-Sent Events) client management ----
const sseClients = [];

function broadcastSSE(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((res, index) => {
    try {
      res.write(payload);
    } catch (err) {
      sseClients.splice(index, 1);
    }
  });
}

// Make broadcastSSE available globally for route modules
app.set('broadcastSSE', broadcastSSE);

// CORS configuration
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3000',
  /^http:\/\/192\.168\.\d+\.\d+(:\d+)?$/, // Allow local 192.168.x.x Wi-Fi IPs
  /^http:\/\/10\.\d+\.\d+\.\d+(:\d+)?$/,   // Allow local 10.x.x.x Wi-Fi IPs
  /^http:\/\/172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+(:\d+)?$/, // Allow local 172.16.x.x-172.31.x.x Wi-Fi IPs
  /\.netlify\.app$/,
  'https://spa-booking-system-v2.netlify.app/'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return allowedOrigin === origin;
    });

    if (isAllowed || origin.endsWith('.netlify.app')) {
      callback(null, true);
    } else {
      console.log('CORS Blocked Origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

// API Routes
app.use('/api/branches', require('./routes/branches'));
app.use('/api/services', require('./routes/services'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/customers', require('./routes/customers'));
app.use('/api/beds', require('./routes/beds'));
const bookingsRouter = require('./routes/bookings');
app.use('/api/bookings', bookingsRouter);
app.use('/api/availability', require('./routes/availability'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/employee-schedules', require('./routes/employeeSchedules'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/settings', require('./routes/settings'));
app.use('/api/notifications', require('./routes/notifications'));


// Trigger endpoint to broadcast SSE events from external servers (e.g. landing page backend)
app.post('/api/events/trigger', (req, res) => {
  const { event, data } = req.body;
  if (event) {
    broadcastSSE(event, data);
    console.log(`📡 SSE Triggered externally: event=${event}`);
    
    // Nếu là sự kiện tạo đặt lịch mới từ Landing Page, tự động kích hoạt Web Push
    if (event === 'booking.created' && typeof bookingsRouter.notifyNewBooking === 'function') {
      console.log('🌸 Triggering Web Push for external guest booking...');
      bookingsRouter.notifyNewBooking(data).catch(err => console.error('Web Push notify error:', err));
    }
    
    return res.json({ success: true });
  }
  res.status(400).json({ error: 'Missing event name' });
});

// ---- SSE Endpoint for Dashboard Live Updates ----
app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });

  // Send initial connection event
  res.write('event: connected\ndata: {"status":"connected"}\n\n');

  sseClients.push(res);
  console.log(`📡 SSE client connected. Total: ${sseClients.length}`);

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
    const idx = sseClients.indexOf(res);
    if (idx !== -1) sseClients.splice(idx, 1);
    console.log(`📡 SSE client disconnected. Total: ${sseClients.length}`);
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

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

const os = require('os');

// Helper to discover all active local IPv4 addresses
function getLocalIps() {
  const interfaces = os.networkInterfaces();
  const results = [];

  for (const name of Object.keys(interfaces)) {
    const lowerName = name.toLowerCase();
    if (lowerName.includes('loopback')) {
      continue;
    }

    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        results.push({ name, address: net.address });
      }
    }
  }
  return results;
}

const localIps = getLocalIps();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n======================================================`);
  console.log(`✅ YOi Booking API running on port ${PORT}`);
  console.log(`🏠 Host Machine: http://localhost:${PORT}`);
  console.log(`📋 Frontend: http://localhost:${PORT}`);
  console.log(`------------------------------------------------------`);
  console.log(`📱 Access from Mobile/Tablet on the SAME Wi-Fi network:`);

  if (localIps.length === 0) {
    console.log(`   (Không tìm thấy mạng WiFi, hãy kiểm tra kết nối)`);
  } else {
    localIps.forEach(ip => {
      console.log(`   👉 Mạng [${ip.name}]:`);
      console.log(`      🏠 API Base: http://${ip.address}:${PORT}`);
      console.log(`      📋 Frontend: http://${ip.address}:${PORT}`);
    });
  }
  console.log(`======================================================\n`);
});
