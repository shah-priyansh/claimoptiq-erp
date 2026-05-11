const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect route - verify JWT and attach user + populated role
const protect = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Not authorized, no token' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id)
      .select('-password')
      .populate('role')
      .populate('hospital', 'name');

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

// Dynamic permission check: checkPermission('claims', 'create')
// Checks if the user's role has the specified permission on the module
const checkPermission = (moduleName, action) => {
  return (req, res, next) => {
    const role = req.user.role;

    // System super_admin role always has full access
    if (role.slug === 'super_admin') {
      return next();
    }

    if (!role.hasPermission(moduleName, action)) {
      return res.status(403).json({
        message: `You don't have permission to ${action} ${moduleName}`
      });
    }
    next();
  };
};

// Check if user has ANY of the listed permissions (OR logic)
// e.g. checkAnyPermission([['claims','view'], ['claims','create']])
const checkAnyPermission = (permissionPairs) => {
  return (req, res, next) => {
    const role = req.user.role;

    if (role.slug === 'super_admin') {
      return next();
    }

    const hasAny = permissionPairs.some(([mod, action]) => role.hasPermission(mod, action));
    if (!hasAny) {
      return res.status(403).json({ message: 'You don\'t have permission for this action' });
    }
    next();
  };
};

// ---- LEGACY SUPPORT (kept for backward compat during transition) ----
// authorize('super_admin', 'admin') → checks if role slug matches
const authorize = (...roleSlugs) => {
  return (req, res, next) => {
    if (!roleSlugs.includes(req.user.role.slug)) {
      return res.status(403).json({ message: 'Not authorized for this action' });
    }
    next();
  };
};

module.exports = { protect, checkPermission, checkAnyPermission, authorize };
