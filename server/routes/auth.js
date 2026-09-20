import bcrypt from 'bcryptjs';
import { User } from '../db.js';
import { generateToken } from './middleware/auth.js';
import { userRegister, userLogin } from './middleware/validate.js';
import { safeText } from './utils.js';

export default function authRoutes(app, authLimiter) {
  app.post('/api/auth/register', authLimiter, userRegister, async (req, res) => {
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

      const token = generateToken(user);
      res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, token });
    } catch (error) {
      console.error('Register failed:', error);
      res.status(500).json({ error: 'Unable to register user.' });
    }
  });

  app.post('/api/auth/login', authLimiter, userLogin, async (req, res) => {
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

      const token = generateToken(user);
      res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, token });
    } catch (error) {
      console.error('Login failed:', error);
      res.status(500).json({ error: 'Unable to log in.' });
    }
  });
}
