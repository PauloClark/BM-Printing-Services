import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, seedTestCustomer, generateAdminToken, generateCustomerToken } from './setup.js';
import employeeRoutes from '../server/routes/employees.js';
import { Employee, User, AuditLog } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import { createClient } from '@supabase/supabase-js';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

let app, adminToken, customerToken, authUsers, oldSupabaseUrl, oldServiceKey;
beforeAll(async () => {
  await setupTestDB();
  oldSupabaseUrl = process.env.SUPABASE_URL; oldServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL = 'https://staff-link.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-server-only-key';
  app = express(); app.use(express.json()); employeeRoutes(app);
});
afterAll(async () => {
  if (oldSupabaseUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldSupabaseUrl;
  if (oldServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = oldServiceKey;
  await teardownTestDB();
});
beforeEach(async () => {
  await clearTestDB();
  adminToken = generateAdminToken(await seedTestAdmin());
  customerToken = generateCustomerToken(await seedTestCustomer());
  authUsers = [];
  createClient.mockReturnValue({ auth: { admin: {
    listUsers: jest.fn(async ({ page, perPage }) => ({ data: { users: authUsers.slice((page - 1) * perPage, page * perPage) }, error: null })),
    getUserById: jest.fn(async id => ({ data: { user: authUsers.find(user => user.id === id) || null }, error: null })),
    updateUserById: jest.fn(async (id, attributes) => {
      const user = authUsers.find(item => item.id === id);
      if (!user) return { data: {}, error: new Error('Not found') };
      user.app_metadata = attributes.app_metadata;
      return { data: { user }, error: null };
    })
  } } });
});
const auth = token => ({ Authorization: `Bearer ${token}` });

it('allows admins to add, edit and deactivate employee records without creating credentials', async () => {
  const created = await request(app).post('/api/employees').set(auth(adminToken)).send({ name: 'Print Operator', email: 'operator@example.com', phone: '09170000000', position: 'Press Operator' });
  expect(created.status).toBe(201); expect(created.body.employee.linked).toBe(false); expect(created.body.employee.active).toBe(true);
  const id = created.body.employee.id;
  const edited = await request(app).patch(`/api/employees/${id}`).set(auth(adminToken)).send({ position: 'Senior Press Operator', permissions: ['view_assigned_jobs'] });
  expect(edited.status).toBe(200); expect(edited.body.employee.position).toBe('Senior Press Operator'); expect(edited.body.employee.permissions).toEqual(['view_assigned_jobs']);
  const deactivated = await request(app).patch(`/api/employees/${id}`).set(auth(adminToken)).send({ active: false });
  expect(deactivated.status).toBe(200); expect(deactivated.body.employee.active).toBe(false);
  const list = await request(app).get('/api/employees').set(auth(adminToken));
  expect(list.status).toBe(200); expect(list.body.employees).toHaveLength(1); expect(list.body.employees[0].linked).toBe(false);
});

it('repairs legacy employees missing createdBy when an admin links an existing staff account', async () => {
  const employee = await Employee.collection.insertOne({
    name: 'Legacy Employee', email: 'legacy@example.com', phone: '', position: 'Production Staff',
    active: true, supabaseUserId: null, mustChangePassword: false,
    permissions: ['view_assigned_jobs', 'update_job_progress'], createdAt: new Date(), updatedAt: new Date()
  });
  const linkedAccount = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'legacy@example.com',
    email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { role: 'staff' }, user_metadata: { full_name: 'Legacy Employee' }
  };
  authUsers = [linkedAccount];

  const result = await request(app).patch(`/api/employees/${employee.insertedId}`)
    .set(auth(adminToken)).send({ supabaseUserId: linkedAccount.id, mustChangePassword: true });

  expect(result.status).toBe(200);
  expect(result.body.employee).toMatchObject({ linked: true, supabaseUserId: linkedAccount.id, mustChangePassword: true });
  const saved = await Employee.findById(employee.insertedId).lean();
  expect(saved.createdBy).toBe('admin-test-001');
});

it('protects employee management from customers and rejects duplicates', async () => {
  expect((await request(app).get('/api/employees').set(auth(customerToken))).status).toBe(403);
  expect((await request(app).post('/api/employees').send({ name: 'No Auth', email: 'none@example.com' })).status).toBe(401);
  expect((await request(app).post('/api/employees').set(auth(adminToken)).send({ name: 'One', email: 'same@example.com' })).status).toBe(201);
  expect((await request(app).post('/api/employees').set(auth(adminToken)).send({ name: 'Two', email: 'same@example.com' })).status).toBe(409);
});

it('restricts roster restoration to admins', async () => {
  const staff = await User.create({ id: 'staff-test-001', name: 'Test Staff', email: 'staff@test.com', role: 'staff' });
  const route = '/api/employees/restore-roster';
  expect((await request(app).post(route).send({ employees: [] })).status).toBe(401);
  expect((await request(app).post(route).set(auth(customerToken)).send({ employees: [] })).status).toBe(403);
  expect((await request(app).post(route).set(auth(generateToken(staff))).send({ employees: [] })).status).toBe(403);
});

it('lets only admins flag a linked employee for a first-login password change', async () => {
  const created = await request(app).post('/api/employees').set(auth(adminToken)).send({ name: 'Linked Staff', email: 'linked@example.com' });
  await Employee.findByIdAndUpdate(created.body.employee.id, { supabaseUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  expect((await request(app).patch(`/api/employees/${created.body.employee.id}`).set(auth(customerToken)).send({ mustChangePassword: true })).status).toBe(403);
  const flagged = await request(app).patch(`/api/employees/${created.body.employee.id}`).set(auth(adminToken)).send({ mustChangePassword: true });
  expect(flagged.status).toBe(200); expect(flagged.body.employee.mustChangePassword).toBe(true);
});

it('authorizes and links all seven existing accounts without creating credentials', async () => {
  const roster = [
    ['Bobby Abar Marces', 'bobby@example.com'], ['Concepcion Nisperos Marces', 'concepcion@example.com'],
    ['Marian Hanginon', 'marian@example.com'], ['Angelica Dumalat', 'angelica@example.com'],
    ['Jillian Abar Marces', 'jillian@example.com'], ['Eddie Abar Marces Jr.', 'eddie@example.com'],
    ['Roland Plaza', 'roland@example.com']
  ];
  const employees = await Promise.all(roster.map(([name, email]) => Employee.create({ name, email, position: 'Production Staff', createdBy: 'admin-test-001', mustChangePassword: true })));
  authUsers = roster.map(([, email], index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`, email,
    email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { provider: 'email', role: 'customer' }, user_metadata: { full_name: roster[index][0] }
  }));

  const candidates = await request(app).get('/api/employees/auth-account-candidates').set(auth(adminToken));
  expect(candidates.status).toBe(200);
  expect(candidates.body.accounts).toHaveLength(7);
  for (let index = 0; index < roster.length; index += 1) {
    const account = candidates.body.accounts[index];
    const authorized = await request(app).post('/api/employees/auth-accounts/authorize').set(auth(adminToken)).send({ userId: account.id, email: account.email });
    expect(authorized.status).toBe(200);
    expect(authUsers[index].app_metadata).toMatchObject({ provider: 'email', role: 'staff' });
    const linked = await request(app).patch(`/api/employees/${employees[index].id}`).set(auth(adminToken)).send({ supabaseUserId: account.id, mustChangePassword: true });
    expect(linked.status).toBe(200);
    expect(linked.body.employee).toMatchObject({ linked: true, supabaseUserId: account.id, mustChangePassword: true });
  }
  expect((await request(app).get('/api/employees').set(auth(adminToken))).body.employees.filter(employee => employee.linked)).toHaveLength(7);
  expect(await AuditLog.countDocuments({ action: 'STAFF_ACCOUNT_AUTHORIZED' })).toBe(7);
});

it('recognizes an existing legacy employee-to-Supabase link without writing or relinking it', async () => {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await Employee.collection.insertOne({
    name: 'Legacy Staff', employeeRole: 'Manager', linkedEmail: 'legacy@example.com', linkedUserId: id,
    active: true, archived: false, mustChangePassword: false, createdAt: new Date(), updatedAt: new Date()
  });
  authUsers = [{ id, email: 'legacy@example.com', email_confirmed_at: '2026-01-01T00:00:00Z', app_metadata: { role: 'staff' } }];

  const before = await Employee.collection.findOne({ name: 'Legacy Staff' });
  const listed = await request(app).get('/api/employees').set(auth(adminToken)).expect(200);
  const accountList = await request(app).get('/api/employees/auth-accounts').set(auth(adminToken)).expect(200);
  const after = await Employee.collection.findOne({ name: 'Legacy Staff' });

  expect(listed.body.employees[0]).toMatchObject({
    name: 'Legacy Staff', email: 'legacy@example.com', position: 'Manager', linked: true,
    supabaseUserId: id, active: true
  });
  expect(accountList.body.accounts[0].linkedEmployee).toMatchObject({ employeeName: 'Legacy Staff' });
  expect(String(before.linkedUserId)).toBe(String(after.linkedUserId));
  expect(after.supabaseUserId).toBeUndefined();
  expect(after.createdBy).toBeUndefined();
});
