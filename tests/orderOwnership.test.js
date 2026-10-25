import { createHash } from 'node:crypto';
import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin } from './setup.js';
import { Employee, Order, Product, Production, User } from '../server/db.js';
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
  serializeOrder: order => ({
    ...order.serialize(),
    paymentMethod: order.paymentMethod,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus === 'Verified' ? 'paid' : order.paymentStatus === 'For Verification' ? 'for_verification' : 'pending',
    orderSource: order.orderSource || 'online',
    order_source: order.orderSource || 'online',
    createdBy: order.createdBy || '',
    specificationDetails: order.specificationDetails || {},
    cashPayment: order.cashPayment?.toObject?.() || order.cashPayment || null
  }),
  uploadDesignFile: jest.fn().mockReturnValue({
    fileName: 'design-test.png', originalName: 'design-test.png', fileType: 'image/png',
    fileSize: 4, filePath: '/uploads/orders/design-test.png'
  })
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
const testDesignFile = { filename: 'design-test.png', base64: 'data:image/png;base64,dGVzdA==' };

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

describe('Saved order ownership workflow', () => {
  const payload = {
    customer: 'Account A', email: 'account-a@example.com', phone: '09171234567',
    product: 'Polo Shirt', productId: 2, quantity: 12, unitPrice: 500,
    total: 6000, payment: 'GCash', specs: 'Size: XL\nColor: Black', notes: 'Call before pickup',
    specificationDetails: { size: 'XL', color: 'Black' },
    designFile: testDesignFile
  };
  it('saves authenticated checkout, hides unassigned orders from staff, and exposes admin updates to the customer', async () => {
    const created = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token')
      .send({ ...payload, status: 'Completed' });
    expect(created.status).toBe(200);
    expect(created.body.order.status).toBe('Pending');
    expect(created.body.order.specs).toBe(payload.specs);
    const list = await request(app).get('/api/staff/orders').set('Authorization', 'Bearer supabase-staff-token');
    expect(list.status).toBe(200);
    expect(list.body.orders.some(o => o.id === created.body.order.id)).toBe(false);
    const id = created.body.order.id;
    expect((await request(app).patch(`/api/orders/${id}/status`).set('Authorization', 'Bearer supabase-staff-token').send({ status: 'Confirmed' })).status).toBe(403);
    expect((await request(app).patch(`/api/orders/${id}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Confirmed' })).status).toBe(409);
    const tracking = await request(app).get(`/api/customers/orders/${id}`).set('Authorization', 'Bearer supabase-user-a-token');
    expect(tracking.body.order.status).toBe('Pending');
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
    await Production.create({ phase3: true, jobOrderId: 'JO-DESIGN', orderId: created.body.order.id, assignedEmployee: 'supabase-staff', assignedEmployeeName: 'Staff', assignedBy: 'admin', status: 'Assigned' });
    const staff = await request(app).get('/api/staff/orders').set('Authorization', 'Bearer supabase-staff-token');
    const savedOrder = staff.body.orders.find(order => order.id === created.body.order.id);
    expect(savedOrder.designFilePath).toBe(created.body.order.designFilePath);
    expect(savedOrder.designFileOriginalName).toBe('shirt-reference.png');
  });
  it('creates authenticated Admin walk-in orders without a customer account and holds cash payment pending', async () => {
    await Product.create({
      id: 21, name: 'Walk-in Hoodie', price: 600, minQty: 1, active: true, trackStock: true,
      stock: 2, specificationType: 'hoodie'
    });
    const response = await request(app).post('/api/admin/orders/walk-in')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        customer: 'Walk-in Customer', phone: '', email: '', fulfillmentMethod: 'pickup',
        productId: 21, quantity: 1, payment: 'cash',
        specificationDetails: { size: 'Large', color: 'Blue' },
        designFile: { filename: 'design-test.png', base64: 'data:image/png;base64,dGVzdA==' }
      });
    expect(response.status).toBe(200);
    expect(response.body.order).toMatchObject({
      customer: 'Walk-in Customer', orderSource: 'walk_in', paymentMethod: 'cash',
      paymentStatus: 'pending', status: 'Pending', userId: null, createdBy: 'admin-test-001',
      total: 600, specificationDetails: { size: 'Large', color: 'Blue' }
    });
    expect(response.body.order.id).toMatch(/^ORD-/);
    expect((await Product.findOne({ id: 21 })).stock).toBe(1);
    expect(await User.countDocuments({ role: 'customer' })).toBe(0);
    expect((await Order.findOne({ orderId: response.body.order.id })).customerId).toBeNull();
  });
  it('rejects customer access to Admin walk-in order creation', async () => {
    const response = await request(app).post('/api/admin/orders/walk-in')
      .set('Authorization', 'Bearer supabase-user-a-token')
      .send({ customer: 'Walk-in Customer' });
    expect(response.status).toBe(403);
  });
  it('keeps payment verification separate from Admin order confirmation', async () => {
    await Order.updateOne({ orderId: 'ORD-A' }, { $set: { paymentStatus: 'Verified' } });
    const unchanged = await Order.findOne({ orderId: 'ORD-A' });
    expect(unchanged.status).toBe('Pending');

    const customer = await request(app).patch('/api/orders/ORD-A/status')
      .set('Authorization', 'Bearer supabase-user-a-token').send({ status: 'Confirmed' });
    expect(customer.status).toBe(403);

    const confirmed = await request(app).patch('/api/orders/ORD-A/status')
      .set('Authorization', `Bearer ${adminToken}`).send({ status: 'Confirmed', expectedStatus: 'Pending' });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.order.status).toBe('Confirmed');
    expect(confirmed.body.order.paymentStatus).toBe('Verified');
  });
  it('rejects unauthenticated, customer and user-metadata role forgery access', async () => {
    for (const token of ['', 'supabase-user-a-token', 'forged-staff-token']) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      expect((await request(app).get('/api/staff/orders').set(headers)).status).toBe(token ? 403 : 401);
      expect((await request(app).patch('/api/orders/ORD-A/status').set(headers).send({ status: 'Confirmed' })).status).toBe(token ? 403 : 401);
    }
  });
  it('denies staff-only order access when a managed employee roster has no matching active link', async () => {
    await Employee.updateOne({ supabaseUserId: 'supabase-staff' }, { $set: { active: false } });

    const response = await request(app)
      .get('/api/staff/orders')
      .set('Authorization', 'Bearer supabase-staff-token');

    expect(response.status).toBe(403);
    expect(response.body.error).toMatch(/not linked to an active employee/i);
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
    expect((await patch({ status: 'Completed' })).status).toBe(409);
    expect((await patch({ status: 'Confirmed', expectedStatus: 'Processing' })).status).toBe(409);
    expect((await patch({ status: 'Cancelled', expectedStatus: 'Pending', cancellationReason: 'Customer changed the order.' })).status).toBe(200);
    expect((await patch({ status: 'Confirmed' })).status).toBe(409);
  });
  it('allows only one competing transition to save', async () => {
    const responses = await Promise.all(['Confirmed', 'Cancelled'].map(status => request(app)
      .patch('/api/orders/ORD-A/status').set('Authorization', `Bearer ${adminToken}`).send({ status, expectedStatus: 'Pending', ...(status === 'Cancelled' ? { cancellationReason: 'Customer cancelled.' } : {}) })));
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
    await Order.updateOne({ orderId: 'ORD-A' }, { status: 'In Production', paymentStatus: 'Verified' });
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
  await Employee.create({ name: 'Staff', email: 'staff@example.com', active: true,
    supabaseUserId: 'supabase-staff', permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: admin.id });
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
        payment: 'GCash',
        specificationDetails: { size: 'Large', color: 'Black' },
        designFile: testDesignFile
      });

    expect(response.status).toBe(200);
    const saved = await Order.findOne({ orderId: response.body.order.id });
    expect(saved.customerId).toBe('supabase-user-a');
    expect(saved.customerEmail).toBe('account-a@example.com');
  });

  it('uses the server catalog price and name instead of client-submitted values', async () => {
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer supabase-user-a-token')
      .send({
        customer: 'Account A',
        phone: '09171234567',
        product: 'Free Product',
        productId: 2,
        quantity: 12,
        unitPrice: 1,
        total: 1,
        payment: 'GCash',
        specificationDetails: { size: 'Large', color: 'Black' },
        designFile: testDesignFile
      });

    expect(response.status).toBe(200);
    const saved = await Order.findOne({ orderId: response.body.order.id });
    expect(saved.items[0].productName).toBe('Polo Shirt');
    expect(saved.items[0].unitPrice).toBe(500);
    expect(saved.items[0].subtotal).toBe(6000);
    expect(saved.totalAmount).toBe(6000);
  });

  it('uses the managed price and preserves the order snapshot after later catalog edits', async () => {
    await Product.create({ id: 2, name: 'Managed Polo', price: 725, minQty: 1, active: true });
    const response = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token').send({ customer: 'Account A', phone: '09171234567', product: 'Fake', productId: 2, quantity: 2, unitPrice: 1, payment: 'GCash', specificationDetails: { size: 'Large', color: 'Black' }, designFile: testDesignFile });
    expect(response.status).toBe(200);
    await Product.updateOne({ id: 2 }, { price: 900, name: 'Renamed Polo' });
    const saved = await Order.findOne({ orderId: response.body.order.id }).lean();
    expect(saved.items[0]).toMatchObject({ productName: 'Managed Polo', unitPrice: 725, subtotal: 1450 });
    expect(saved.totalAmount).toBe(1450);
  });

  it('rejects inactive and unknown products once the managed catalog is configured', async () => {
    await Product.create({ id: 1, name: 'Inactive Shirt', price: 400, active: false });
    const before = await Order.countDocuments();
    const send = productId => request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token').send({ customer: 'Account A', phone: '09171234567', product: 'Fake', productId, quantity: 1, unitPrice: 1, payment: 'GCash' });
    expect((await send(1)).status).toBe(400);
    expect((await send(2)).status).toBe(400);
    expect(await Order.countDocuments()).toBe(before);
  });

  it('rejects unavailable quantities for tracked-stock products', async () => {
    const send = quantity => request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token')
      .send({ customer: 'Account A', phone: '09171234567', product: 'Tracked Shirt', productId: 1, quantity, unitPrice: 400, payment: 'GCash', specificationDetails: { size: 'Large', color: 'Black' }, designFile: testDesignFile });
    await Product.create({ id: 1, name: 'Tracked Shirt', price: 400, minQty: 1, active: true, trackStock: true, stock: 0 });
    expect((await send(1)).status).toBe(409);
    await Product.updateOne({ id: 1 }, { stock: 2 });
    expect((await send(3)).status).toBe(409);
    expect((await send(2)).status).toBe(200);
  });

  it('rejects product IDs that are absent from both the database and catalog', async () => {
    const before = await Order.countDocuments();
    const response = await request(app)
      .post('/api/orders')
      .set('Authorization', 'Bearer supabase-user-a-token')
      .send({
        customer: 'Account A',
        phone: '09171234567',
        product: 'Unknown Product',
        productId: 999,
        quantity: 1,
        unitPrice: 1,
        total: 1,
        payment: 'GCash'
      });

    expect(response.status).toBe(400);
    expect(await Order.countDocuments()).toBe(before);
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
      const response = await request(app).post('/api/orders').set('Authorization', 'Bearer supabase-user-a-token').send({customer: 'Account A', email: 'account-a@example.com', phone: '09171234567', productId: 1, product: 'T-Shirt', quantity: 1, total: 400, payment: 'GCash', specificationDetails: { size: 'Large', color: 'Black' }, designFile: testDesignFile});
      expect(response.status).toBe(500);
      expect(response.body.reference).toMatch(/^[a-f0-9]{12}$/);
      expect(response.body.error).toContain('Check My Orders');
      expect(JSON.stringify(response.body)).not.toContain('private-database');
      expect(logger).toHaveBeenCalled();
    } finally { failure.mockRestore(); logger.mockRestore(); }
  });
});
