import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, seedTestCustomer, generateAdminToken, generateCustomerToken } from './setup.js';
import customerRoutes from '../server/routes/customers.js';
import { mapSupabaseCustomer } from '../server/customerDirectory.js';
import { Order, User } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';

let app, adminToken, customerToken;
const auth = token => ({ Authorization: `Bearer ${token}` });
beforeAll(async () => { await setupTestDB(); app = express(); app.use(express.json()); customerRoutes(app); });
afterAll(async () => teardownTestDB());
beforeEach(async () => {
  await clearTestDB();
  adminToken = generateAdminToken(await seedTestAdmin());
  customerToken = generateCustomerToken(await seedTestCustomer());
});

it('lists legacy and authenticated order customers once with reliable order totals', async () => {
  await Order.create({ orderId: 'ORD-DIRECTORY-A', customerId: 'customer-test-001', customerName: 'Test Customer', customerEmail: 'customer@test.com', contactNumber: '09123456789', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, status: 'Pending' });
  await Order.create({ orderId: 'ORD-DIRECTORY-B', customerId: 'supabase-customer-1', customerName: 'OAuth Customer', customerEmail: 'oauth@example.com', contactNumber: '09990000000', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, status: 'Pending' });
  const response = await request(app).get('/api/search/customers').set(auth(adminToken));
  expect(response.status).toBe(200);
  expect(response.body.customers).toHaveLength(2);
  expect(response.body.customers.find(customer => customer.id === 'customer-test-001').totalOrders).toBe(1);
  expect(response.body.customers.find(customer => customer.id === 'supabase-customer-1')).toMatchObject({ name: 'OAuth Customer', totalOrders: 1, status: 'Order-linked' });
});

it('searches by name or email and never merges accounts by a shared display name', async () => {
  await User.create({ id: 'customer-two', name: 'Test Customer', email: 'second@example.com', role: 'customer' });
  expect((await request(app).get('/api/search/customers?query=second%40example.com').set(auth(adminToken))).body.customers.map(customer => customer.id)).toEqual(['customer-two']);
  expect((await request(app).get('/api/search/customers?query=Test%20Customer').set(auth(adminToken))).body.customers).toHaveLength(2);
});

it('rejects unauthenticated, customer and staff directory access', async () => {
  const staff = await User.create({ id: 'staff-directory', name: 'Staff', email: 'staff-directory@example.com', role: 'staff' });
  expect((await request(app).get('/api/search/customers')).status).toBe(401);
  expect((await request(app).get('/api/search/customers').set(auth(customerToken))).status).toBe(403);
  expect((await request(app).get('/api/search/customers').set(auth(generateToken(staff)))).status).toBe(403);
});

it('maps Google customer metadata without changing the stable Supabase ID', () => {
  expect(mapSupabaseCustomer({ id: 'google-stable-id', email: 'google@example.com', email_confirmed_at: '2026-01-01', created_at: '2026-01-01', app_metadata: { providers: ['google'] }, user_metadata: { full_name: 'Google Customer' } })).toMatchObject({ id: 'google-stable-id', name: 'Google Customer', accountType: 'Google account', role: 'customer' });
});
