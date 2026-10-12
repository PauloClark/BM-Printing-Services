import request from 'supertest';
import express from 'express';
import { jest } from '@jest/globals';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup.js';
import { Employee } from '../server/db.js';
import { requireOrderAuth, requireOrderStaff } from '../server/middleware/auth.js';
import staffPasswordRoutes from '../server/routes/staffPassword.js';

const staffId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
let app, updatePassword, originalFetch, oldUrl, oldKey;

beforeAll(async () => {
  await setupTestDB();
  originalFetch = global.fetch; oldUrl = process.env.VITE_SUPABASE_URL; oldKey = process.env.VITE_SUPABASE_ANON_KEY;
  process.env.VITE_SUPABASE_URL = 'https://supabase.test'; process.env.VITE_SUPABASE_ANON_KEY = 'public-anon-key';
});
afterAll(async () => {
  global.fetch = originalFetch;
  if (oldUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY; else process.env.VITE_SUPABASE_ANON_KEY = oldKey;
  await teardownTestDB();
});
beforeEach(async () => {
  await clearTestDB(); updatePassword = jest.fn().mockResolvedValue({ id: staffId });
  global.fetch = jest.fn().mockImplementation(async () => new Response(JSON.stringify({ id: staffId, email: 'staff@example.test', email_confirmed_at: new Date().toISOString(), app_metadata: { role: 'staff', provider: 'email', providers: ['email'] }, user_metadata: { full_name: 'Staff Member' } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
  await Employee.create({ name: 'Staff Member', email: 'staff@example.test', position: 'Operator', active: true, supabaseUserId: staffId, mustChangePassword: true, createdBy: 'admin' });
  app = express(); app.use(express.json());
  app.get('/api/auth/me', requireOrderAuth, (req, res) => res.json({ user: req.user }));
  staffPasswordRoutes(app, (_req, _res, next) => next(), { updateStaffPasswordFn: updatePassword });
  app.get('/protected-staff-operation', requireOrderStaff, (_req, res) => res.json({ success: true }));
});
const auth = { Authorization: 'Bearer supabase-access-token' };

test('reports the server-controlled requirement and blocks direct staff operations', async () => {
  const me = await request(app).get('/api/auth/me').set(auth);
  expect(me.status).toBe(200); expect(me.body.user.mustChangePassword).toBe(true);
  const protectedResponse = await request(app).get('/protected-staff-operation').set(auth);
  expect(protectedResponse.status).toBe(428); expect(protectedResponse.body.code).toBe('PASSWORD_CHANGE_REQUIRED');
});

test('updates Supabase first and clears the requirement only after success', async () => {
  expect((await request(app).patch('/api/auth/staff/password').set(auth).send({ newPassword: 'short' })).status).toBe(400);
  expect(updatePassword).not.toHaveBeenCalled();
  const changed = await request(app).patch('/api/auth/staff/password').set(auth).send({ newPassword: 'private-password' });
  expect(changed.status).toBe(200); expect(updatePassword).toHaveBeenCalledWith(staffId, 'private-password');
  expect((await Employee.findOne({ supabaseUserId: staffId })).mustChangePassword).toBe(false);
  expect((await request(app).get('/protected-staff-operation').set(auth)).status).toBe(200);
});

test('keeps the requirement when Supabase rejects the password update', async () => {
  updatePassword.mockRejectedValueOnce(Object.assign(new Error('Supabase rejected the password.'), { status: 503 }));
  expect((await request(app).patch('/api/auth/staff/password').set(auth).send({ newPassword: 'private-password' })).status).toBe(503);
  expect((await Employee.findOne({ supabaseUserId: staffId })).mustChangePassword).toBe(true);
});
