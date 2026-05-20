const { clerkClient } = require('@clerk/express');

/**
 * Middleware to verify admin authentication via Clerk Auth.
 * Expects Authorization: Bearer <access_token> header.
 */
async function requireAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];

  // Bypass authentication check during initial setup if Clerk secret is missing
  if (!process.env.CLERK_SECRET_KEY) {
    console.warn('⚠️ [Clerk Auth] CLERK_SECRET_KEY is not defined in backend/.env!');
    return res.status(401).json({ error: 'System configuration error: CLERK_SECRET_KEY missing' });
  }

  try {
    // 1) Verify the token signature and claims
    const verifiedToken = await clerkClient.verifyToken(token);
    if (!verifiedToken) {
      return res.status(401).json({ error: 'Unauthorized: Invalid token' });
    }

    // 2) Fetch complete user profile from Clerk to verify metadata role
    const user = await clerkClient.users.getUser(verifiedToken.sub);
    if (!user) {
      return res.status(401).json({ error: 'Unauthorized: User not found' });
    }

    // 3) Authorize access based on roles defined in Clerk publicMetadata
    const userRole = user.publicMetadata?.role || 'admin'; // Default to admin for initial setup/onboarding
    if (userRole !== 'admin') {
      return res.status(403).json({ error: 'Forbidden: Admin access required' });
    }

    // Attach verified user context to request
    req.user = user;
    next();
  } catch (err) {
    console.error('❌ [Clerk Auth Error]:', err.message || err);
    return res.status(401).json({ error: 'Unauthorized: Token validation failed' });
  }
}

module.exports = { requireAdmin };
