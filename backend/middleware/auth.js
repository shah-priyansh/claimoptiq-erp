const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

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

    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      include: {
        role: { include: { modulePermissions: true } },
        hospital: { select: { id: true, name: true } },
      },
    });

    if (!user || !user.isActive) {
      return res.status(401).json({ message: 'Not authorized, user not found or inactive' });
    }

    if (!user.role || !user.role.isActive) {
      return res.status(403).json({ message: 'Your role has been deactivated. Contact admin.' });
    }

    user._id = user.id;
    if (user.hospital) user.hospital._id = user.hospital.id;

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

module.exports = { protect, checkPermission, checkAnyPermission, authorize };
