import jwt from 'jsonwebtoken';
import { User } from '../db.js';

const isProduction = process.env.NODE_ENV === 'production';

if (isProduction && !process.env.JWT_SECRET) {
  console.error('FATAL: JWT_SECRET environment variable is not set. Refusing to start in production.');
  process.exit(1);
}

const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-do-not-use-in-production';

export function generateToken(user) {
  return jwt.sign(
    { id: user.id, email: user.email, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

export const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required. Please login.' });
    }
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    const user = await User.findOne({ id: decoded.id }).select('-password');
    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }
    req.user = user;
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired. Please login again.' });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
};

export const requireAdmin = async (req, res, next) => {
  requireAuth(req, res, () => {
    if (req.user && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
  });
};

export const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const decoded = verifyToken(token);
      const user = await User.findOne({ id: decoded.id }).select('-password');
      if (user) req.user = user;
    }
  } catch {}
  next();
};

export const requireOrderAuth = async (req, res, next) => {
  const authorization = req.headers.authorization || '';
  if (!authorization.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required. Please login.' });
  }

  const token = authorization.slice(7);
  let jwtUser = null;
  try {
    const decoded = verifyToken(token);
    jwtUser = await User.findOne({ id: decoded.id }).select('-password');
  } catch {}

  if (jwtUser) {
    req.user = jwtUser;
    req.authProvider = 'jwt';
    return next();
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(401).json({ error: 'Unable to verify customer session.' });
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    const supabaseUser = await response.json();
    if (!supabaseUser.id || !supabaseUser.email) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    const metadata = supabaseUser.user_metadata || {};
    req.user = {
      id: supabaseUser.id,
      email: supabaseUser.email.toLowerCase(),
      name: metadata.full_name || metadata.name || supabaseUser.email.split('@')[0],
      role: 'customer'
    };
    req.authProvider = 'supabase';
    return next();
  } catch {
    return res.status(401).json({ error: 'Unable to verify customer session.' });
  }
};
