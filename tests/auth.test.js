import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, seedTestCustomer, generateAdminToken, generateCustomerToken } from './setup.js';

let app;
let adminToken;
let customerToken;

beforeAll(async () => {
  await setupTestDB();
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const bcrypt = (await import('bcryptjs')).default;
  const { User, AuditLog } = await import('../server/db.js');
  const { generateToken, requireAuth, requireAdmin } = await import('../server/middleware/auth.js');

  app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(cors());

  app.post('/api/auth/register', async (req, res) => {
    try {
      const { email, password, name, phone } = req.body;
      if (!email || !password || !name) {
        return res.status(400).json({ error: 'Name, email, and password are required.' });
      }
      if (password.length < 6) {
        return res.status(400).json({ error: 'Password must be at least 6 characters.' });
      }
      const existing = await User.findOne({ email: email.toLowerCase() });
      if (existing) {
        return res.status(409).json({ error: 'Email already registered.' });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await User.create({
        id: `user-${Date.now()}`,
        name,
        email: email.toLowerCase(),
        phone: phone || '',
        password: hashedPassword,
        role: 'customer'
      });
      const token = generateToken(user);
      res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, token });
    } catch (error) {
      res.status(500).json({ error: 'Unable to register user.' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) {
        return res.status(400).json({ error: 'Email and password are required.' });
      }
      const user = await User.findOne({ email: email.toLowerCase() });
      if (!user) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      let match = false;
      if (user.password && (user.password.startsWith('$2b$') || user.password.startsWith('$2a$'))) {
        match = await bcrypt.compare(password, user.password);
      } else {
        match = password === user.password;
      }
      if (!match) {
        return res.status(401).json({ error: 'Invalid email or password.' });
      }
      const token = generateToken(user);
      res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role }, token });
    } catch (error) {
      res.status(500).json({ error: 'Unable to log in.' });
    }
  });

  app.get('/api/auth/me', requireAuth, async (req, res) => {
    res.json({ user: { id: req.user.id, name: req.user.name, email: req.user.email, role: req.user.role } });
  });

  app.get('/api/admin/users', requireAdmin, async (req, res) => {
    const users = await User.find({}).select('-password');
    res.json({ users });
  });
});

afterAll(async () => {
  await teardownTestDB();
});

beforeEach(async () => {
  await clearTestDB();
});

describe('Authentication', () => {
  describe('POST /api/auth/register', () => {
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'John Doe', email: 'john@test.com', password: 'password123', phone: '09123456789' });
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.user.email).toBe('john@test.com');
      expect(res.body.user.role).toBe('customer');
      expect(res.body.token).toBeDefined();
      expect(res.body.user.password).toBeUndefined();
    });

    it('should reject duplicate registration', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'John Doe', email: 'john@test.com', password: 'password123' });
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'John Doe', email: 'john@test.com', password: 'password123' });
      expect(res.status).toBe(409);
      expect(res.body.error).toContain('already registered');
    });

    it('should reject short password', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ name: 'John Doe', email: 'john@test.com', password: '123' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('6 characters');
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({ email: 'john@test.com' });
      expect(res.status).toBe(400);
    });

    it('should hash the password with bcrypt', async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'John Doe', email: 'john@test.com', password: 'password123' });
      const { User } = await import('../server/db.js');
      const user = await User.findOne({ email: 'john@test.com' });
      expect(user.password).toMatch(/^\$2[ab]\$/);
    });
  });

  describe('POST /api/auth/login', () => {
    beforeEach(async () => {
      await request(app)
        .post('/api/auth/register')
        .send({ name: 'John Doe', email: 'john@test.com', password: 'password123' });
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@test.com', password: 'password123' });
      expect(res.status).toBe(200);
      expect(res.body.user).toBeDefined();
      expect(res.body.token).toBeDefined();
    });

    it('should reject wrong password', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@test.com', password: 'wrongpassword' });
      expect(res.status).toBe(401);
      expect(res.body.error).toContain('Invalid');
    });

    it('should reject non-existent user', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'nonexistent@test.com', password: 'password123' });
      expect(res.status).toBe(401);
    });

    it('should reject missing fields', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email: 'john@test.com' });
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/auth/me', () => {
    it('should return user with valid token', async () => {
      const regRes = await request(app)
        .post('/api/auth/register')
        .send({ name: 'John Doe', email: 'john@test.com', password: 'password123' });
      const token = regRes.body.token;

      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.user.email).toBe('john@test.com');
    });

    it('should reject request without token', async () => {
      const res = await request(app).get('/api/auth/me');
      expect(res.status).toBe(401);
    });

    it('should reject invalid token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalidtoken123');
      expect(res.status).toBe(401);
    });
  });

  describe('Admin Authorization', () => {
    it('should allow admin access', async () => {
      const admin = await seedTestAdmin();
      const token = generateAdminToken(admin);

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.users).toBeDefined();
    });

    it('should deny customer access to admin routes', async () => {
      const customer = await seedTestCustomer();
      const token = generateCustomerToken(customer);

      const res = await request(app)
        .get('/api/admin/users')
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });
  });
});
