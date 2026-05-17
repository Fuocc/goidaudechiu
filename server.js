const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

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
    // Allow requests with no origin (like mobile apps or curl requests)
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
app.use('/api/customers', require('./routes/customers'));
app.use('/api/bookings', require('./routes/bookings'));
app.use('/api/availability', require('./routes/availability'));
app.use('/api/employees', require('./routes/employees'));
app.use('/api/settings', require('./routes/settings'));

// Static files
// Serve files from root directory
app.use(express.static(__dirname));

// Custom routes for HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/booking', (req, res) => {
  res.sendFile(path.join(__dirname, 'booking.html'));
});

// Fallback for SPA-like behavior if needed
app.get('/book', (req, res) => {
  res.sendFile(path.join(__dirname, 'booking.html'));
});

// 404 for API
app.use('/api/*', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

if (require.main === module) {
  const os = require('os');
  
  // Helper to discover all active local IPv4 addresses
  function getLocalIps() {
    const interfaces = os.networkInterfaces();
    const results = [];
    
    for (const name of Object.keys(interfaces)) {
      const lowerName = name.toLowerCase();
      // Skip loopback and VM adapters if possible, but keep list of all just in case
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
    console.log(`✅ YOi Landing Page + Booking API running on port ${PORT}`);
    console.log(`🏠 Host Machine: http://localhost:${PORT}`);
    console.log(`📅 Booking Page: http://localhost:${PORT}/booking`);
    console.log(`------------------------------------------------------`);
    console.log(`📱 Access from Mobile/Tablet on the SAME Wi-Fi network:`);
    
    if (localIps.length === 0) {
      console.log(`   (Không tìm thấy mạng WiFi, hãy kiểm tra kết nối)`);
    } else {
      localIps.forEach(ip => {
        console.log(`   👉 Mạng [${ip.name}]:`);
        console.log(`      🏠 Landing Page: http://${ip.address}:${PORT}`);
        console.log(`      📅 Booking Page: http://${ip.address}:${PORT}/booking`);
      });
    }
    console.log(`======================================================\n`);
  });
}

module.exports = app;
