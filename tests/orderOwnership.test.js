import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin } from './setup.js';
import { Order } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import orderRoutes from '../server/routes/orders.js';

jest.mock('../server/reportService.js', () => ({
  generateDailyReport: jest.fn().mockResolvedValue({}),
  getDefaultReportDate: jest.fn().mockReturnValue('2026-09-28')
}));

jest.mock('../server/utils.js', () => ({
  safeText: value => typeof value === 'string' ? value : '',
  serializeOrder: order => order.serialize(),
  uploadDesignFile: jest.fn()
}));

let app;
let originalFetch;
let originalSupabaseUrl;
let originalSupabaseKey;
let adminToken;

const supabaseUsers = {
  'supabase-user-a-token': {
    id: 'supabase-user-a',
    email: 'account-a@example.com',
    user_metadata: { full_name: 'Account A' }
  },
  'supabase-user-b-token': {
    id: 'supabase-user-b',
    email: 'account-b@example.com',
    user_metadata: { full_name: 'Account B' }
  }
};

const createStoredOrder = (orderId, customerId, customerEmail) => Order.create({
  orderId,
  customerId,
  customerName: customerEmail.split('@')[0],
  customerEmail,
  contactNumber: '09171234567',
  items: [{ productId: 1, productName: 'Custom T-Shirt Printing', quantity: 1, unitPrice: 180, subtotal: 180 }],
  totalAmount: 180,
  paymentMethod: 'GCash',
  status: 'Pending'
});

beforeAll(async () => {
  await setupTestDB();
  originalFetch = global.fetch;
  originalSupabaseUrl = process.env.VITE_SUPABASE_URL;
  originalSupabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
  process.env.VITE_SUPABASE_URL = 'https://supabase.test';
  process.env.VITE_SUPABASE_ANON_KEY = 'public-test-anon-key';

  global.fetch = jest.fn(async (url, options = {}) => {
    const token = options.headers?.Authorization?.replace(/^Bearer /, '');
    const user = supabaseUsers[token];
    return {
      ok: Boolean(user),
      json: async () => user || {}
    };
  });

  app = express();
  app.use(express.json());
  orderRoutes(app);
});

afterAll(async () => {
  global.fetch = originalFetch;
  if (originalSupabaseUrl === undefined) delete process.env.VITE_SUPABASE_URL;
  else process.env.VITE_SUPABASE_URL = originalSupabaseUrl;
  if (originalSupabaseKey === undefined) delete process.env.VITE_SUPABASE_ANON_KEY;
  else process.env.VITE_SUPABASE_ANON_KEY = originalSupabaseKey;
  await teardownTestDB();
});

beforeEach(async () => {
  await clearTestDB();
  const admin = await seedTestAdmin();
  adminToken = generateToken(admin);
  await createStoredOrder('ORD-A', 'supabase-user-a', 'account-a@example.com');
  await createStoredOrder('ORD-B', 'supabase-user-b', 'account-b@example.com');
  await createStoredOrder('ORD-LEGACY-A', 'legacy-mongo-user-a', 'account-a@example.com');
  await createStoredOrder('ORD-LEGACY-B', 'legacy-mongo-user-b', 'account-b@example.com');
});

describe('Supabase customer order ownership', () => {
  it('isolates customer orders and keeps legacy email-only orders scoped to that identity', async () => {
    const accountA = await request(app)
      .get('/api/customers/orders?email=account-b%40example.com&userId=supabase-user-b')
      .set('Authorization', 'Bearer supabase-user-a-token');
    const accountB = await request(app)
      .get('/api/customers/orders')
      .set('Authorization', 'Bearer supabase-user-b-token');

    expect(accountA.status).toBe(200);
    expect(accountA.body.orders.map(order => order.id).sort()).toEqual(['ORD-A', 'ORD-LEGACY-A']);
    expect(accountB.status).toBe(200);
    expect(accountB.body.orders.map(order => order.id).sort()).toEqual(['ORD-B', 'ORD-LEGACY-B']);
  });

  it('uses verified Supabase identity instead of client-supplied owner or email when creating an order', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer supabase-user-a-token')
      .send({
        customer: 'Account A',
        email: 'account-b@example.com',
        userId: 'supabase-user-b',
        customerId: 'supabase-user-b',
        phone: '09171234567',
        address: 'Davao City',
        product: 'Custom T-Shirt Printing',
        productId: 1,
        quantity: 1,
        unitPrice: 180,
        total: 180,
        payment: 'GCash'
      });

    expect(response.status).toBe(200);
    const saved = await Order.findOne({ orderId: response.body.order.id });
    expect(saved.customerId).toBe('supabase-user-a');
    expect(saved.customerEmail).toBe('account-a@example.com');
  });

  it('does not return another customer order by its order ID', async () => {
    const response = await request(app)
      .get('/api/customers/orders/ORD-B')
      .set('Authorization', 'Bearer supabase-user-a-token');

    expect(response.status).toBe(404);
  });

  it('returns all orders to an authenticated admin', async () => {
    const response = await request(app)
      .get('/api/orders')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.orders).toHaveLength(4);
  });
});