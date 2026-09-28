const { verifyToken, clerkClient } = require('@clerk/express');

/**
 * Xác thực Clerk + phân quyền theo role.
 *
 * Role hợp lệ (Clerk → Users → Public metadata → { "role": "..." }):
 *   staff < admin < dev   (dev có toàn quyền admin + trang dành riêng cho dev)
 * Tài khoản không có role hoặc role lạ → BỊ TỪ CHỐI (deny by default).
 */
const ROLE_LEVEL = { public: 0, staff: 1, admin: 2, dev: 3 };

class AuthError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Domain được phép "sở hữu" token đăng nhập (claim `azp` của Clerk).
// Đổi domain dashboard → cập nhật biến môi trường CLERK_AUTHORIZED_PARTIES trên Render, không cần sửa code.
function getAuthorizedParties() {
  const fromEnv = (process.env.CLERK_AUTHORIZED_PARTIES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const parties = fromEnv.length ? fromEnv : ['https://yoi-dashboard.netlify.app'];
  if (!process.env.RENDER) parties.push('http://localhost:5173', 'http://localhost:3000');
  return parties;
}
const AUTHORIZED_PARTIES = getAuthorizedParties();

// Cache role 60s: đổi/thu hồi role trên Clerk sẽ có hiệu lực trong tối đa 1 phút,
// đồng thời tránh gọi Clerk API ở mọi request.
const ROLE_CACHE_MS = 60 * 1000;
const roleCache = new Map();

async function resolveRole(payload) {
  // Nếu đã cấu hình custom session token trên Clerk ({"role": "{{user.public_metadata.role}}"}) thì đọc thẳng từ token
  const claimRole = payload.role || payload.metadata?.role || payload.public_metadata?.role;
  if (typeof claimRole === 'string' && claimRole) return claimRole;

  const cached = roleCache.get(payload.sub);
  if (cached && cached.expiresAt > Date.now()) return cached.role;

  const user = await clerkClient.users.getUser(payload.sub);
  if (user?.banned || user?.locked) {
    roleCache.set(payload.sub, { role: null, expiresAt: Date.now() + ROLE_CACHE_MS });
    return null;
  }
  const role = typeof user?.publicMetadata?.role === 'string' ? user.publicMetadata.role : null;
  roleCache.set(payload.sub, { role, expiresAt: Date.now() + ROLE_CACHE_MS });
  return role;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of roleCache.entries()) {
    if (value.expiresAt <= now) roleCache.delete(key);
  }
}, 5 * 60 * 1000).unref();

/**
 * Đọc & xác thực Bearer token.
 * @returns {Promise<null | { id: string, role: string, level: number }>} null nếu không gửi token
 * @throws {AuthError} token sai / hết hạn / không có quyền
 */
async function authenticate(req) {
  const header = req.headers.authorization || '';
  if (!header) return null;
  if (!header.startsWith('Bearer ')) throw new AuthError(401, 'Phiên đăng nhập không hợp lệ.');

  if (!process.env.CLERK_SECRET_KEY) {
    throw new AuthError(503, 'Hệ thống chưa cấu hình xác thực.');
  }

  const token = header.slice(7).trim();
  let payload;
  try {
    const result = await verifyToken(token, {
      secretKey: process.env.CLERK_SECRET_KEY,
      authorizedParties: AUTHORIZED_PARTIES
    });
    // Tương thích cả 2 kiểu trả về của Clerk SDK: payload trực tiếp hoặc { data, errors }
    if (result?.errors) throw result.errors[0] || new Error('invalid token');
    payload = result?.data || result;
  } catch (err) {
    throw new AuthError(401, 'Phiên đăng nhập đã hết hạn, vui lòng tải lại trang.');
  }
  if (!payload?.sub) throw new AuthError(401, 'Phiên đăng nhập không hợp lệ.');

  let role;
  try {
    role = await resolveRole(payload);
  } catch {
    throw new AuthError(503, 'Không kiểm tra được quyền truy cập, vui lòng thử lại.');
  }

  const level = ROLE_LEVEL[role];
  if (!level) throw new AuthError(403, 'Tài khoản chưa được cấp quyền truy cập.');

  return { id: payload.sub, role, level };
}

function hasRole(auth, minRole) {
  return (auth?.level || 0) >= ROLE_LEVEL[minRole];
}

module.exports = { authenticate, hasRole, AuthError, ROLE_LEVEL, AUTHORIZED_PARTIES };
