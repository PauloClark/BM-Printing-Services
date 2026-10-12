import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, seedTestCustomer, generateAdminToken, generateCustomerToken } from './setup.js';
import employeeRoutes from '../server/routes/employees.js';
import { Employee } from '../server/db.js';
import { User } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';

let app, adminToken, customerToken;
beforeAll(async () => {
  await setupTestDB();
  app = express(); app.use(express.json()); employeeRoutes(app);
});
afterAll(async () => teardownTestDB());
beforeEach(async () => {
  await clearTestDB();
  adminToken = generateAdminToken(await seedTestAdmin());
  customerToken = generateCustomerToken(await seedTestCustomer());
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
