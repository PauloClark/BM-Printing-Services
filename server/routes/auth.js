import bcrypt from 'bcryptjs';
import { User } from '../db.js';
import { generateToken, requireOrderAuth } from '../middleware/auth.js';
import { userRegister, userLogin } from '../middleware/validate.js';
import { safeText } from '../utils.js';

export default function authRoutes(app, authLimiter) {
  app.get('/api/auth/me', requireOrderAuth, (req, res) => {
    res.set('Cache-Control', 'no-store');
    const { id, email, name, phone, address, avatar, role } = req.user;
    res.json({ user: { id, email, name, phone, address, avatar, role, authProvider: req.authProvider } });
  });
  app.patch('/api/auth/profile', requireOrderAuth, async (req, res) => {
    if (req.authProvider !== 'jwt') return res.status(400).json({ error: 'Update your profile using Supabase Auth.' });
    const { name, phone = '', address = '' } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof phone !== 'string' || phone.length > 30 || typeof address !== 'string' || address.length > 500) {
      return res.status(400).json({ error: 'Enter a valid name, phone and address.' });
    }
    if (Object.keys(req.body).some(key => !['name', 'phone', 'address'].includes(key))) return res.status(400).json({ error: 'Only name, phone and address can be updated.' });
    try {
      const user = await User.findOneAndUpdate({ id: req.user.id }, { $set: { name: name.trim(), phone, address } }, { new: true, runValidators: true });
      res.json({ user: { id: user.id, email: user.email, name: user.name, phone: user.phone, address: user.address, role: user.role } });
    } catch { res.status(503).json({ error: 'Unable to save your profile.' }); }
  });
  app.patch('/api/auth/password', authLimiter, requireOrderAuth, async (req, res) => {
    if (req.authProvider !== 'jwt') return res.status(400).json({ error: 'Update your password using Supabase Auth.' });
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 100) return res.status(400).json({ error: 'Enter your current password and a new password of 8–100 characters.' });
    try {
      const user = await User.findOne({ id: req.user.id });
      if (!await bcrypt.compare(currentPassword, user.password)) return res.status(401).json({ error: 'Current password is incorrect.' });
      user.password = await bcrypt.hash(newPassword, 10);
      await user.save();
      res.json({ success: true });
    } catch { res.status(503).json({ error: 'Unable to update your password.' }); }
  });
  app.post('/api/auth/register', authLimiter, userRegister, async (req, res) => {
    if (process.env.ALLOW_LEGACY_AUTH === 'false') return res.status(410).json({ error: 'Please register using Supabase on the Registration page.' });
    try {
      const body = req.body || {};
      const email = safeText(body.email).toLowerCase();
      const password = safeText(body.password);
      const name = safeText(body.name);
      const phone = safeText(body.phone);

      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
      }

      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }

      const existing = await User.findOne({ email });
      if (existing) {
        return res.status(409).json({ error: 'Email already registered.' });
      }

      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await User.create({
        id: `user-${Date.now()}`,
        name,
        email,
        phone,
        password: hashedPassword,
        role: 'customer'
      });

      if (user.role === 'staff') return res.status(403).json({ error: 'Staff accounts must use Supabase login.' });
      const token = generateToken(user);
      res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, token });
    } catch (error) {
      console.error('Register failed:', error);
      res.status(500).json({ error: 'Unable to register user.' });
    }
  });

  app.post('/api/auth/login', authLimiter, userLogin, async (req, res) => {
    if (process.env.ALLOW_LEGACY_AUTH === 'false') return res.status(401).json({ error: 'Invalid email or password. Use your Supabase account.' });
    try {
      const body = req.body || {};
      const email = safeText(body.email).toLowerCase();
      const password = safeText(body.password);

      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      let match = false;
      if (user.password && (user.password.startsWith('$2b$') || user.password.startsWith('$2a$'))) {
        match = await bcrypt.compare(password, user.password);
      }

      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }

      if (user.role === 'staff') return res.status(403).json({ error: 'Staff accounts must use Supabase login.' });
      const token = generateToken(user);
      res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, token });
    } catch (error) {
      console.error('Login failed:', error);
      res.status(500).json({ error: 'Unable to log in.' });
    }
  });
}
