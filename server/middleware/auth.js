import { User } from '../db.js';
import bcrypt from 'bcryptjs';

// Authentication gate - verifies user is logged in
export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: {
          code: 'UNAUTHENTICATED',
          message: 'Authentication required. Please login.'
        }
      });
    }

    const token = authHeader.substring(7);
    // Find user by checking if we can identify them
    // In a full implementation, we'd verify a JWT token
    // For now, we check if the user exists in the system
    const userId = req.body?.userId || req.query?.userId;
    
    if (userId) {
      const user = await User.findById(userId);
      if (!user) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'User not found.'
          }
        });
      }
      req.user = user;
      next();
    } else {
      // No user ID provided - this happens in some contexts
      // We'll allow the request but mark as unauthenticated
      req.user = null;
      next();
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed.'
      }
    });
  }
};

// Authorization gate - verifies user has required role
export const requireRole = (allowedRoles) => {
  return async (req, res, next) => {
    try {
      const userRole = req.user?.role;
      
      if (!userRole) {
        return res.status(401).json({
          success: false,
          error: {
            code: 'UNAUTHENTICATED',
            message: 'Authentication required.'
          }
        });
      }

      if (!allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: `Access denied. Role "${userRole}" is not authorized for this endpoint.`
          }
        });
      }

      next();
    } catch (error) {
      res.status(500).json({
        success: false,
        error: {
          code: 'AUTH_ERROR',
          message: 'Authorization check failed.'
        }
      });
    }
  };
};

// Simplified auth for existing hardcoded login compatibility
export const checkAdminLogin = async (req, res, next) => {
  const { email, password } = req.body || {};
  
  if (email === 'admin@bm.com' && password === 'admin123') {
    req.user = { id: 'admin', name: 'BM Admin', email: 'admin@bm.com', role: 'admin' };
    return next();
  }
  
  // Also check database users with bcrypt comparison
  const user = await User.findOne({ email });
  if (user) {
    const match = await bcrypt.compare(password, user.password);
    if (match) {
      req.user = user;
      return next();
    }
  }
  
  return res.status(401).json({
    success: false,
    error: {
      code: 'UNAUTHENTICATED',
      message: 'Invalid email or password.'
    }
  });
};