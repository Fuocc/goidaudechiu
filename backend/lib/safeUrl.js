const dns = require('dns').promises;
const net = require('net');

/**
 * Chống SSRF cho webhook: chỉ cho phép gọi tới địa chỉ https công khai.
 * Chặn localhost, IP nội bộ, link-local (169.254.x.x — nơi chứa metadata của cloud), multicast...
 */

function ipv4ToInt(ip) {
  return ip.split('.').reduce((acc, part) => (acc << 8) + parseInt(part, 10), 0) >>> 0;
}

const BLOCKED_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
].map(([base, bits]) => ({ base: ipv4ToInt(base), mask: bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0 }));

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const value = ipv4ToInt(ip);
    return BLOCKED_V4.some(({ base, mask }) => (value & mask) === (base & mask));
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateIp(mapped[1]);
    return lower === '::' || lower === '::1' ||
      lower.startsWith('fc') || lower.startsWith('fd') ||   // unique local
      lower.startsWith('fe8') || lower.startsWith('fe9') || lower.startsWith('fea') || lower.startsWith('feb') || // link-local
      lower.startsWith('ff');                               // multicast
  }
  return true;
}

async function assertSafeWebhookUrl(rawUrl) {
  let url;
  try {
    url = new URL(String(rawUrl || '').trim());
  } catch (e) {
    throw new Error('URL webhook không hợp lệ.');
  }
  if (url.protocol !== 'https:') throw new Error('Webhook chỉ chấp nhận địa chỉ https://');
  if (url.username || url.password) throw new Error('URL webhook không được chứa tài khoản/mật khẩu.');

  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (/^localhost$/i.test(host) || /\.(local|internal|localhost)$/i.test(host)) {
    throw new Error('Không được dùng địa chỉ nội bộ cho webhook.');
  }

  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new Error('Không phân giải được tên miền webhook.');
  if (addresses.some(a => isPrivateIp(a.address))) {
    throw new Error('Không được dùng địa chỉ nội bộ cho webhook.');
  }
  return url.toString();
}

// fetch có kiểm tra địa chỉ + timeout 5s + không tự đi theo redirect (tránh redirect vào mạng nội bộ)
async function safeWebhookFetch(rawUrl, options = {}) {
  const url = await assertSafeWebhookUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    return await fetch(url, { ...options, redirect: 'manual', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { assertSafeWebhookUrl, safeWebhookFetch, isPrivateIp };
