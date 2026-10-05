import { supabaseAppUser } from '../../shared/roles.js';
import { isOrderStaff } from '../../shared/orderWorkflow.js';
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

export const requireAuth = (req, res, next) => requireOrderAuth(req, res, next);

export const requireAdmin = async (req, res, next) => {
  return requireOrderAuth(req, res, () => {
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
    if (process.env.ALLOW_LEGACY_AUTH === 'false') throw new Error('Legacy login disabled');
    const decoded = verifyToken(token);
    jwtUser = await User.findOne({ id: decoded.id }).select('-password');
  } catch {}

  if (jwtUser) {
    if (jwtUser.role === 'staff') return res.status(403).json({ error: 'Staff accounts must sign in with Supabase. Ask an administrator to assign your Supabase account.' });
    req.user = jwtUser;
    req.authProvider = 'jwt';
    return next();
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return res.status(401).json({ error: 'Unable to verify customer session.' });
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, {
      signal: AbortSignal.timeout(10000),
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    const supabaseUser = await response.json();
    // Phone-only Supabase identities legitimately have no email. Accept either
    // verified contact so OTP customers get the same customer session.
    if (!supabaseUser.id || (!supabaseUser.email && !supabaseUser.phone)) {
      return res.status(401).json({ error: 'Invalid authentication token.' });
    }

    req.user = supabaseAppUser(supabaseUser);
    req.authProvider = 'supabase';
    return next();
  } catch {
    return res.status(401).json({ error: 'Unable to verify customer session.' });
  }
};

export const requireOrderStaff = (req, res, next) => requireOrderAuth(req, res, () => {
  if (!isOrderStaff(req.user)) return res.status(403).json({ error: 'Staff or admin access required.' });
  return next();
});
// Invalid supplied credentials must never silently become a guest order.
export const optionalOrderAuth = (req, res, next) => req.headers.authorization
  ? requireOrderAuth(req, res, next) : next();
