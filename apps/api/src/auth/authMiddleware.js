const AuthService = require('./AuthService');

const authService = new AuthService();

// Middleware to verify JWT token
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Access token required'
      });
    }

    const user = await authService.getUserByToken(token);
    req.user = {
      id: user.id || user.customerId,
      email: user.email,
      role: user.role || 'customer',
      name: user.name
    };

    next();
  } catch (error) {
    return res.status(403).json({
      success: false,
      message: error.message
    });
  }
};

// Middleware to check user roles
const authorizeRoles = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Access denied. Required roles: ${roles.join(', ')}`
      });
    }

    next();
  };
};

// Middleware for admin only
const adminOnly = authorizeRoles('admin');

// Middleware for manager and admin
const managerOrAdmin = authorizeRoles('admin', 'manager');

// Middleware for customer access
const customerOnly = authorizeRoles('customer');

// Middleware for yard operations
const yardAccess = authorizeRoles('admin', 'manager', 'supervisor', 'yard');

// Middleware for rake planning
const rakePlannerAccess = authorizeRoles('admin', 'manager', 'rake_planner');

module.exports = {
  authenticateToken,
  authorizeRoles,
  adminOnly,
  managerOrAdmin,
  customerOnly,
  yardAccess,
  rakePlannerAccess
};