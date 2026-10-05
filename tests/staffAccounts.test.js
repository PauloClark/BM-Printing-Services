import request from 'supertest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin } from './setup.js';
import { Order, OrderFile, User } from '../server/db.js';
import { generateToken, requireAdmin } from '../server/middleware/auth.js';
import authRoutes from '../server/routes/auth.js';
import orderFileRoutes from '../server/routes/orderFiles.js';
import { saveDesignFile } from '../server/designFiles.js';
import { roleFromSupabaseUser, dashboardForRole, canOpenDashboard } from '../shared/roles.js';
import { signInAccount, registerCustomer } from '../src/utils/authActions.js';

jest.mock('../server/utils.js', () => ({ safeText: value => typeof value === 'string' ? value : '' }));

let app, directory, originalFetch, oldUrl, oldKey, adminToken;
const users = {
  customer: { id: 'customer-a', email: 'a@example.com', app_metadata: { role: 'customer' } },
  other: { id: 'customer-b', email: 'b@example.com' },
  staff: { id: 'staff-a', email: 'staff@example.com', app_metadata: { role: 'staff' } },
  admin: { id: 'admin-a', email: 'admin@example.com', app_metadata: { role: 'admin' } },
  forged: { id: 'customer-c', email: 'c@example.com', user_metadata: { role: 'admin' } }
};
beforeAll(async () => {
  await setupTestDB();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-files-test-'));
  originalFetch = global.fetch;
  oldUrl = process.env.SUPABASE_URL; oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test'; process.env.SUPABASE_ANON_KEY = 'public-test-key';
  global.fetch = jest.fn(async (url, options) => {
    const user = users[options.headers.Authorization.replace('Bearer ', '')];
    return { ok: Boolean(user), json: async () => user || {} };
  });
  app = express(); app.use(express.json());
  authRoutes(app, (req, res, next) => next());
  orderFileRoutes(app, directory);
  app.get('/test/admin', requireAdmin, (req, res) => res.json({ ok: true }));
});
afterAll(async () => {
  global.fetch = originalFetch;
  if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  // Remove only this test's verified temp directory.
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('bm-files-test-')) throw new Error('Unexpected test directory');
  await fs.rm(directory, { recursive: true, force: true });
  await teardownTestDB();
});
beforeEach(async () => {
  await clearTestDB();
  adminToken = generateToken(await seedTestAdmin());
  users.staff.app_metadata.role = 'staff';
  await fs.writeFile(path.join(directory, 'design-test.png'), Buffer.from('test-design'));
  await Order.create({ orderId: 'ORD-FILE', customerId: 'customer-a', customerName: 'Customer A',
    customerEmail: 'a@example.com', totalAmount: 500,
    items: [{ productId: 1, productName: 'Shirt', quantity: 1, unitPrice: 500, subtotal: 500 }],
    designFileName: 'design-test.png', designOriginalName: 'Reference.png', designFileType: 'image/png' });
});

it('returns current trusted roles and denies staff access to admin operations', async () => {
  for (const [token, role] of [['customer', 'customer'], ['staff', 'staff'], ['admin', 'admin'], ['forged', 'customer']]) {
    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200); expect(me.body.user.role).toBe(role);
    const admin = await request(app).get('/test/admin').set('Authorization', `Bearer ${token}`);
    expect(admin.status).toBe(role === 'admin' ? 200 : 403);
  }
  expect((await request(app).get('/api/auth/me')).status).toBe(401);
  expect((await request(app).get('/test/admin').set('Authorization', `Bearer ${adminToken}`)).status).toBe(200);
});
it('uses the latest Auth role, so revocation is effective without trusting old browser state', async () => {
  expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer staff')).body.user.role).toBe('staff');
  users.staff.app_metadata.role = 'customer';
  expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer staff')).body.user.role).toBe('customer');
});
it('does not use legacy tokens for staff and can disable legacy authentication entirely', async () => {
  const staff = await User.create({ id: 'legacy-staff', name: 'Legacy Staff', email: 'legacy-staff@example.com', role: 'staff' });
  const token = generateToken(staff);
  expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  const previous = process.env.ALLOW_LEGACY_AUTH;
  process.env.ALLOW_LEGACY_AUTH = 'false';
  try {
    expect((await request(app).get('/test/admin').set('Authorization', `Bearer ${adminToken}`)).status).toBe(401);
    expect((await request(app).get('/test/admin').set('Authorization', 'Bearer admin')).status).toBe(200);
  } finally {
    if (previous === undefined) delete process.env.ALLOW_LEGACY_AUTH; else process.env.ALLOW_LEGACY_AUTH = previous;
  }
});
it('routes roles separately and rejects dashboard access for forged or unknown roles', () => {
  expect(dashboardForRole('staff')).toBe('staff'); expect(dashboardForRole('admin')).toBe('admin');
  expect(dashboardForRole('customer')).toBe('home');
  expect(canOpenDashboard('customer', 'staff')).toBe(false);
  expect(canOpenDashboard('staff', 'admin')).toBe(false);
  expect(canOpenDashboard('admin', 'staff')).toBe(true);
  expect(roleFromSupabaseUser(users.forged)).toBe('customer');
  expect(roleFromSupabaseUser({ app_metadata: { role: 'manager' } })).toBe('customer');
});
it('public Supabase registration whitelists profile data and never sends a requested role', async () => {
  const client = { auth: { signUp: jest.fn().mockResolvedValue({ data: { session: null }, error: null }) } };
  const data = await registerCustomer(client, { email: ' a@example.com ', password: 'secret123', name: 'Customer', phone: '09171234567', role: 'admin', app_metadata: { role: 'staff' } }, 'https://bm.test');
  expect(data.session).toBeNull();
  expect(client.auth.signUp).toHaveBeenCalledWith({ email: 'a@example.com', password: 'secret123', options: {
    emailRedirectTo: 'https://bm.test', data: { full_name: 'Customer', phone: '09171234567' }
  } });
});
it('uses Supabase password login for staff and never falls back for provider failures', async () => {
  const legacy = jest.fn();
  const client = { auth: { signInWithPassword: jest.fn().mockResolvedValue({ data: { user: users.staff }, error: null }) } };
  expect((await signInAccount(client, 'staff@example.com', 'password', legacy)).role).toBe('staff');
  expect(legacy).not.toHaveBeenCalled();
  for (const code of ['email_not_confirmed', 'over_request_rate_limit', 'mfa_verification_required', 'unexpected_failure']) {
    client.auth.signInWithPassword.mockResolvedValue({ data: {}, error: { code } });
    await expect(signInAccount(client, 'x@example.com', 'password', legacy)).rejects.toEqual({ code });
  }
  expect(legacy).not.toHaveBeenCalled();
});
it('retains existing legacy sign-in only as a compatibility fallback', async () => {
  const legacy = jest.fn().mockResolvedValue({ id: 'legacy', role: 'customer', authProvider: 'jwt' });
  const client = { auth: { signInWithPassword: jest.fn().mockResolvedValue({ data: {}, error: { code: 'invalid_credentials' } }) } };
  expect((await signInAccount(client, 'old@example.com', 'password', legacy)).id).toBe('legacy');
  expect(legacy).toHaveBeenCalledTimes(1);
});
it('legacy registration cannot assign a privileged role and profile updates cannot escalate it', async () => {
  const registered = await request(app).post('/api/auth/register').send({ name: 'New Customer', email: 'new@example.com', password: 'secret123', role: 'admin' });
  expect(registered.status).toBe(200); expect(registered.body.user.role).toBe('customer');
  const auth = `Bearer ${registered.body.token}`;
  expect((await request(app).patch('/api/auth/profile').set('Authorization', auth).send({ name: 'New Name', role: 'staff' })).status).toBe(400);
  const updated = await request(app).patch('/api/auth/profile').set('Authorization', auth).send({ name: 'New Name', phone: '09171234567', address: 'Davao' });
  expect(updated.status).toBe(200); expect(updated.body.user.role).toBe('customer');
  expect((await User.findOne({ email: 'new@example.com' })).name).toBe('New Name');
});
it('staff and the owner can read design files; another customer or an anonymous caller cannot', async () => {
  for (const token of ['customer', 'staff', 'admin', 'other', 'forged', '']) {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const permitted = ['customer', 'staff', 'admin'].includes(token);
    const list = await request(app).get('/api/orders/ORD-FILE/files').set(headers);
    expect(list.status).toBe(permitted ? 200 : 404);
    const file = await request(app).get('/api/orders/ORD-FILE/files/design').set(headers);
    expect(file.status).toBe(permitted ? 200 : 404);
    if (permitted) {
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(file.headers['cache-control']).toBe('private, no-store');
    }
  }
});
it('guards legacy file URLs and cannot read another order file by changing its ID', async () => {
  const file = await OrderFile.create({ orderId: 'ORD-OTHER', filename: 'design-test.png', originalName: 'Other.png', fileType: 'PNG', storagePath: '/uploads/orders/design-test.png' });
  expect((await request(app).get(`/api/orders/ORD-FILE/files/${file._id}`).set('Authorization', 'Bearer customer')).status).toBe(404);
  expect((await request(app).get('/uploads/orders/design-test.png').set('Authorization', 'Bearer other')).status).toBe(404);
  expect((await request(app).get('/uploads/orders/design-test.png').set('Authorization', 'Bearer staff')).status).toBe(200);
});
it('rejects unsafe file types and returns exactly the fields the order route persists', () => {
  const invalid = saveDesignFile({ filename: 'evil.html', base64: 'data:text/html;base64,PGgxPkJNPC9oMT4=' }, directory);
  expect(invalid.error).toBeTruthy();
  const saved = saveDesignFile({ filename: 'logo.png', base64: 'data:image/png;base64,dGVzdA==' }, directory);
  expect(saved.fileName).toMatch(/^design-.*\.png$/); expect(saved.originalName).toBe('logo.png');
  expect(saved.fileType).toBe('image/png'); expect(saved.fileSize).toBe(4); expect(saved.filePath).toBe(path.join(directory, saved.fileName));
});
