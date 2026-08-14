const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

// Per-user cache for the `protect` middleware. Every authenticated request
// was doing a `user.findUnique` with a nested include on `role.modulePermissions`
// + `hospital` — several JOINs on the hot path of every API call. That single
// query dominated wall-clock time on the /claims page (3 near-simultaneous
// requests × ~800ms of auth lookup each, queued through the connection pool).
//
// 30s TTL: short enough that role/hospital changes propagate quickly; long
// enough to collapse burst traffic (dashboard mount, list pages, dropdown
// fan-out) into a single DB roundtrip per user.
const _userCache = new Map();
const USER_CACHE_TTL = 30 * 1000;
const invalidateUserCache = (userId) => {
  if (userId) _userCache.delete(userId);
  else _userCache.clear();
};

const hasPermission = (role, moduleName, action) => {
  const mod = (role.modulePermissions || []).find((m) => m.module === moduleName);
  if (!mod) return false;
  return mod[action] === true;
};

const getAllowedModules = (role) => {
  return (role.modulePermissions || [])
    .filter((m) => m.view)
    .map((m) => m.module);
};

const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    // File-streaming endpoints are hit by <img src>/<a href>, which can't send
    // an Authorization header — accept a short-lived JWT via ?token= as well.
    let token = null;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.split(' ')[1];
    } else if (req.query && req.query.token) {
      token = String(req.query.token);
    }
    if (!token) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    let user;
    const cached = _userCache.get(decoded.id);
    if (cached && cached.expiry > Date.now()) {
      user = cached.user;
    } else {
      user = await prisma.user.findUnique({
        where: { id: decoded.id },
        include: {
          role: { include: { modulePermissions: true } },
          hospital: { select: { id: true, name: true } },
          reference: { select: { id: true, name: true } },
        },
      });
      if (user) {
        user._id = user.id;
        if (user.hospital) user.hospital._id = user.hospital.id;
        if (user.reference) user.reference._id = user.reference.id;
        _userCache.set(decoded.id, { user, expiry: Date.now() + USER_CACHE_TTL });
      }
    }

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Not authorized, user not found or inactive' });
    }

    if (!user.role || !user.role.isActive) {
      return res.status(403).json({ message: 'Your role has been deactivated. Contact admin.' });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ message: 'Not authorized, token failed' });
  }
};

const checkPermission = (moduleName, action) => {
  return (req, res, next) => {
    const role = req.user.role;
    if (role.slug === 'super_admin') return next();
    if (!hasPermission(role, moduleName, action)) {
      return res.status(403).json({
        message: `You don't have permission to ${action} ${moduleName}`,
      });
    }
    next();
  };
};

const checkAnyPermission = (permissionPairs) => {
  return (req, res, next) => {
    const role = req.user.role;
    if (role.slug === 'super_admin') return next();
    const anyMatch = permissionPairs.some(([mod, action]) => hasPermission(role, mod, action));
    if (!anyMatch) {
      return res.status(403).json({ message: "You don't have permission for this action" });
    }
    next();
  };
};

const authorize = (...roleSlugs) => {
  return (req, res, next) => {
    if (!roleSlugs.includes(req.user.role.slug)) {
      return res.status(403).json({ message: 'Not authorized for this action' });
    }
    next();
  };
};

module.exports = { protect, checkPermission, checkAnyPermission, authorize, invalidateUserCache };
