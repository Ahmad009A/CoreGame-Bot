/**
 * Core Game Bot — Auth Middleware
 * Protects dashboard routes — requires Discord OAuth2 login
 */

function requireAuth(req, res, next) {
  if (req.session && req.session.user) {
    return next();
  }

  // API requests get JSON error
  if (req.path.startsWith('/api')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Page requests redirect to login
  return res.redirect('/login');
}

/**
 * Check if user is an admin of the guild
 */
function requireAdmin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Check if user has admin permissions from their guilds
  const user = req.session.user;
  if (!user.isAdmin) {
    return res.status(403).json({ error: 'Forbidden — Admin access required' });
  }

  next();
}

module.exports = { requireAuth, requireAdmin };
