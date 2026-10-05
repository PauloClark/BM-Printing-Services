import { createHash } from 'node:crypto';
import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin } from './setup.js';
import { Order, User } from '../server/db.js';
import { generateDailyReport } from '../server/reportService.js';
import { generateToken } from '../server/middleware/auth.js';
import orderRoutes from '../server/routes/orders.js';
import { uploadDesignFile } from '../server/utils.js';

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
  'supabase-staff-token': {
    id: 'supabase-staff', email: 'staff@example.com', app_metadata: { role: 'staff' }
  },
  'forged-staff-token': {
    id: 'forged-staff', email: 'forged@example.com', user_metadata: { role: 'admin' }
  },
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

describe('Saved staff processing workflow', () => {
  const payload = {
    customer: 'Account A', email: 'account-a@example.com', phone: '09171234567',
    product: 'Polo Shirt', productId: 2, quantity: 12, unitPrice: 500,
    total: 6000, payment: 'GCash', specs: 'Size: XL\nPrint: Front logo', notes: 'Call before pickup'
  };
  it('saves authenticated checkout and exposes the same order and specifications to staff', async () => {
    const created = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token')
      .send({ ...payload, status: 'Completed' });
    expect(created.status).toBe(200);
    expect(created.body.order.status).toBe('Pending');
    expect(created.body.order.specs).toBe(payload.specs);
    const list = await request(app).get('/api/staff/orders').set('Authorization', 'Bearer supabase-staff-token');
    expect(list.status).toBe(200);
    expect(list.body.orders.some(o => o.id === created.body.order.id)).toBe(true);
    const id = created.body.order.id;
    for (const status of ['Confirmed', 'Processing', 'Ready for Pickup', 'Completed']) {
      const update = await request(app).patch(`/api/orders/${id}/status`)
        .set('Authorization', 'Bearer supabase-staff-token').send({ status });
      expect(update.status).toBe(200);
      expect(update.body.order.status).toBe(status);
      const tracking = await request(app).get(`/api/customers/orders/${id}`).set('Authorization', 'Bearer supabase-user-a-token');
      expect(tracking.body.order.status).toBe(status);
      const mine = await request(app).get('/api/customers/orders').set('Authorization', 'Bearer supabase-user-a-token');
      expect(mine.body.orders.find(o => o.id === id).status).toBe(status);
    }
    expect((await Order.findOne({ orderId: id })).completedAt).toBeTruthy();
    const reopen = await request(app).patch(`/api/orders/${id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Cancelled' });
    expect(reopen.status).toBe(400);
  });
  it('persists uploaded design metadata with the customer order for staff access', async () => {
    uploadDesignFile.mockReturnValueOnce({
      fileName: 'design-reference.png', originalName: 'shirt-reference.png', fileType: 'image/png',
      fileSize: 4, filePath: '/uploads/orders/design-reference.png'
    });
    const created = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token')
      .send({ ...payload, designFile: { filename: 'shirt-reference.png', base64: 'data:image/png;base64,AAAA' } });
    expect(created.status).toBe(200);
    expect(created.body.order.designFilePath).toBe('/uploads/orders/design-reference.png');
    expect(created.body.order.designFileName).toBe('design-reference.png');
    expect(created.body.order.designOriginalName).toBe('shirt-reference.png');
    expect(created.body.order.designFileOriginalName).toBe('shirt-reference.png');
    const staff = await request(app).get('/api/staff/orders').set('Authorization', 'Bearer supabase-staff-token');
    const savedOrder = staff.body.orders.find(order => order.id === created.body.order.id);
    expect(savedOrder.designFilePath).toBe(created.body.order.designFilePath);
    expect(savedOrder.designFileOriginalName).toBe('shirt-reference.png');
  });
  it('rejects unauthenticated, customer and user-metadata role forgery access', async () => {
    for (const token of ['', 'supabase-user-a-token', 'forged-staff-token']) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      expect((await request(app).get('/api/staff/orders').set(headers)).status).toBe(token ? 403 : 401);
      expect((await request(app).patch('/api/orders/ORD-A/status').set(headers).send({ status: 'Confirmed' })).status).toBe(token ? 403 : 401);
    }
  });
  it('honors database admin roles and revocation for legacy sign-in', async () => {
    const staff = await User.create({ id: 'staff-1', name: 'Staff', email: 'staff@test.com', role: 'admin' });
    const token = generateToken(staff);
    expect((await request(app).get('/api/staff/orders').set('Authorization', `Bearer ${token}`)).status).toBe(200);
    await User.updateOne({ id: staff.id }, { role: 'customer' });
    expect((await request(app).get('/api/staff/orders').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });
  it('rejects jumps and stale updates, and keeps cancellation final', async () => {
    const patch = body => request(app).patch('/api/orders/ORD-A/status').set('Authorization', `Bearer ${adminToken}`).send(body);
    expect((await patch({ status: 'Completed' })).status).toBe(400);
    expect((await patch({ status: 'Confirmed', expectedStatus: 'Processing' })).status).toBe(409);
    expect((await patch({ status: 'Cancelled', expectedStatus: 'Pending' })).status).toBe(200);
    expect((await patch({ status: 'Confirmed' })).status).toBe(400);
  });
  it('allows only one competing transition to save', async () => {
    const responses = await Promise.all(['Confirmed', 'Cancelled'].map(status => request(app)
      .patch('/api/orders/ORD-A/status').set('Authorization', `Bearer ${adminToken}`).send({ status, expectedStatus: 'Pending' })));
    expect(responses.filter(r => r.status === 200)).toHaveLength(1);
    expect(responses.filter(r => [400, 409].includes(r.status))).toHaveLength(1);
  });
  it('rejects guest checkout including forged ownership and role fields before writing data', async () => {
    const count = await Order.countDocuments();
    for (const body of [payload, { ...payload, userId: 'supabase-user-a', customerId: 'supabase-user-a', role: 'admin' }]) {
      const response = await request(app).post('/api/orders').send(body);
      expect(response.status).toBe(401);
    }
    expect(await Order.countDocuments()).toBe(count);
  });
  it('binds new orders to the verified token rather than submitted identity', async () => {
    const response = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token')
      .send({ ...payload, userId: 'supabase-user-b', customerId: 'supabase-user-b', email: 'account-b@example.com', role: 'admin' });
    expect(response.status).toBe(200);
    const saved = await Order.findOne({ orderId: response.body.order.id });
    expect(saved.customerId).toBe('supabase-user-a');
    expect(saved.customerEmail).toBe('account-a@example.com');
  });
  it('preserves private-token tracking for historical guest orders', async () => {
    const token = 'b'.repeat(64);
    const order = await createStoredOrder('ORD-HISTORICAL-GUEST', null, 'guest@example.com');
    await Order.updateOne({ _id: order._id }, { guestTokenHash: createHash('sha256').update(token).digest('hex') });
    expect((await request(app).get('/api/guest/orders/ORD-HISTORICAL-GUEST')).status).toBe(404);
    const tracked = await request(app).get('/api/guest/orders/ORD-HISTORICAL-GUEST').set('X-Order-Token', token);
    expect(tracked.status).toBe(200);
    expect(tracked.body.order.guestTokenHash).toBeUndefined();
  });
  it('never treats invalid authentication as a guest checkout', async () => {
    const response = await request(app).post('/api/orders').set('Authorization', 'Bearer invalid').send(payload);
    expect(response.status).toBe(401);
    expect(await Order.countDocuments()).toBe(4);
  });
  it('does not report a saved order as failed when spreadsheet generation fails', async () => {
    generateDailyReport.mockRejectedValueOnce(new Error('Report disk unavailable'));
    const response = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token').send(payload);
    expect(response.status).toBe(200);
    expect(await Order.findOne({ orderId: response.body.order.id })).toBeTruthy();
  });
  it('moves legacy production status forward without rewriting existing records', async () => {
    await Order.updateOne({ orderId: 'ORD-A' }, { status: 'In Production' });
    const response = await request(app).patch('/api/orders/ORD-A/status').set('Authorization', `Bearer ${adminToken}`).send({ status: 'Ready for Pickup' });
    expect(response.status).toBe(200);
  });
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
  await createStoredOrder('ORD-LEGACY-A', null, 'account-a@example.com');
  await createStoredOrder('ORD-LEGACY-B', null, 'account-b@example.com');
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


describe('Phase 1 identity and safe failures', () => {
  it('does not use an email match to expose an order assigned to another user ID', async () => {
    await createStoredOrder('ORD-REUSED-EMAIL', 'another-user', 'account-a@example.com');
    const response = await request(app).get('/api/customers/orders').set('Authorization', 'Bearer supabase-user-a-token');
    expect(response.body.orders.some(order => order.id === 'ORD-REUSED-EMAIL')).toBe(false);
    expect((await request(app).get('/api/orders/ORD-REUSED-EMAIL').set('Authorization', 'Bearer supabase-user-a-token')).status).toBe(404);
  });
  it('returns a useful support reference without leaking database error contents', async () => {
    const failure = jest.spyOn(Order, 'create').mockRejectedValueOnce(new Error('private-database-connection-string'));
    const logger = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token').send({customer: 'Account A', email: 'account-a@example.com', phone: '09171234567', productId: 1, product: 'T-Shirt', quantity: 1, total: 400, payment: 'GCash'});
      expect(response.status).toBe(500);
      expect(response.body.reference).toMatch(/^[a-f0-9]{12}$/);
      expect(response.body.error).toContain('Check My Orders');
      expect(JSON.stringify(response.body)).not.toContain('private-database');
      expect(logger).toHaveBeenCalled();
    } finally { failure.mockRestore(); logger.mockRestore(); }
  });
});
