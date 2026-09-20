import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, seedTestCustomer, seedTestProduct, generateAdminToken, generateCustomerToken } from './setup.js';

let app;
let adminToken;
let customerToken;
let customerUser;
let testProduct;

const VALID_TRANSITIONS = {
  'Pending': ['Quoted', 'Confirmed', 'Cancelled'],
  'Quoted': ['Confirmed', 'Cancelled'],
  'Confirmed': ['Payment Pending', 'Cancelled'],
  'Payment Pending': ['Paid', 'Cancelled'],
  'Paid': ['Queued'],
  'Queued': ['In Production'],
  'In Production': ['Quality Check'],
  'Quality Check': ['In Production', 'Ready'],
  'Ready': ['Completed'],
  'Completed': [],
  'Cancelled': []
};

function isValidTransition(from, to) {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

beforeAll(async () => {
  await setupTestDB();
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const crypto = await import('crypto');
  const { User, Product, Order } = await import('../server/db.js');
  const { requireAuth, requireAdmin } = await import('../server/middleware/auth.js');

  app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(cors());

  app.get('/api/customers/orders', requireAuth, async (req, res) => {
    const user = req.user;
    let query = {};
    if (user.role === 'customer') {
      query = { customerId: user.id };
    }
    const orders = await Order.find(query).sort({ createdAt: -1 });
    res.json({ orders, count: orders.length });
  });

  app.post('/api/orders', requireAuth, async (req, res) => {
    try {
      const { customerName, customerEmail, contactNumber, items, paymentMethod, notes, designNotes } = req.body;
      if (!customerName || !customerEmail || !contactNumber || !items?.length) {
        return res.status(400).json({ error: 'customerName, customerEmail, contactNumber, and items are required.' });
      }
      const orderId = `ORD-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
      const orderItems = items.map(item => ({
        productId: item.productId,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subtotal: item.quantity * item.unitPrice
      }));
      const totalAmount = orderItems.reduce((sum, item) => sum + item.subtotal, 0);
      const order = await Order.create({
        orderId,
        customerId: req.user.id,
        customerName,
        customerEmail,
        contactNumber,
        items: orderItems,
        totalAmount,
        paymentMethod: paymentMethod || 'gcash',
        status: 'Pending',
        notes: notes || '',
        designNotes: designNotes || ''
      });
      res.json({ success: true, order, orderId });
    } catch (error) {
      res.status(500).json({ error: 'Unable to place order.', details: error.message });
    }
  });

  app.patch('/api/orders/:orderId/status', requireAuth, async (req, res) => {
    try {
      const { status } = req.body;
      const { orderId } = req.params;
      const allowedStatuses = ['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Cancelled'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status.' });
      }
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (order.status === 'Completed' || order.status === 'Cancelled') {
        return res.status(400).json({ error: 'Order is already finalized.' });
      }
      if (!isValidTransition(order.status, status)) {
        return res.status(400).json({ error: `Cannot transition from '${order.status}' to '${status}'.` });
      }
      order.status = status;
      await order.save();
      res.json({ success: true, order });
    } catch (error) {
      res.status(500).json({ error: 'Unable to update status.' });
    }
  });

  app.get('/api/orders/:orderId', requireAuth, async (req, res) => {
    const { orderId } = req.params;
    const order = await Order.findOne({ orderId });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    res.json({ order });
  });
});

afterAll(async () => {
  await teardownTestDB();
});

beforeEach(async () => {
  await clearTestDB();
  const admin = await seedTestAdmin();
  adminToken = generateAdminToken(admin);
  customerUser = await seedTestCustomer();
  customerToken = generateCustomerToken(customerUser);
  testProduct = await seedTestProduct();
});

describe('Orders', () => {
  const createOrder = (token) =>
    request(app)
      .post('/api/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({
        customerName: 'Test Customer',
        customerEmail: 'testcustomer@test.com',
        contactNumber: '09123456789',
        items: [{ productId: 1, productName: 'Test T-Shirt', quantity: 2, unitPrice: 180 }],
        paymentMethod: 'gcash'
      });

  describe('POST /api/orders', () => {
    it('should create order with valid data', async () => {
      const res = await createOrder(customerToken);
      expect(res.status).toBe(200);
      expect(res.body.order).toBeDefined();
      expect(res.body.order.orderId).toMatch(/^ORD-/);
    });

    it('should reject order without items', async () => {
      const res = await request(app)
        .post('/api/orders')
        .set('Authorization', `Bearer ${customerToken}`)
        .send({ customerName: 'Test', customerEmail: 't@t.com', contactNumber: '09123', items: [] });
      expect(res.status).toBe(400);
    });

    it('should require authentication', async () => {
      const res = await request(app)
        .post('/api/orders')
        .send({ customerName: 'Test', customerEmail: 't@t.com', contactNumber: '09123', items: [{ productId: 1, productName: 'X', quantity: 1, unitPrice: 100 }] });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/customers/orders', () => {
    it('should return customer orders', async () => {
      await createOrder(customerToken);
      const res = await request(app)
        .get('/api/customers/orders')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.orders.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('GET /api/orders/:orderId', () => {
    it('should return specific order', async () => {
      const createRes = await createOrder(customerToken);
      const orderId = createRes.body.order.orderId;
      const res = await request(app)
        .get(`/api/orders/${orderId}`)
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.order.orderId).toBe(orderId);
    });

    it('should return 404 for non-existent order', async () => {
      const res = await request(app)
        .get('/api/orders/NONEXISTENT')
        .set('Authorization', `Bearer ${customerToken}`);
      expect(res.status).toBe(404);
    });
  });

  describe('PATCH /api/orders/:orderId/status', () => {
    it('should transition Pending to Confirmed', async () => {
      const createRes = await createOrder(customerToken);
      const orderId = createRes.body.order.orderId;
      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'Confirmed' });
      expect(res.status).toBe(200);
      expect(res.body.order.status).toBe('Confirmed');
    });

    it('should reject invalid transition (Pending to Completed)', async () => {
      const createRes = await createOrder(customerToken);
      const orderId = createRes.body.order.orderId;
      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'Completed' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('Cannot transition');
    });

    it('should reject invalid status value', async () => {
      const createRes = await createOrder(customerToken);
      const orderId = createRes.body.order.orderId;
      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'bogus' });
      expect(res.status).toBe(400);
    });

    it('should not allow modification of completed orders', async () => {
      const createRes = await createOrder(customerToken);
      const orderId = createRes.body.order.orderId;
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Confirmed' });
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Payment Pending' });
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Paid' });
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Queued' });
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'In Production' });
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Quality Check' });
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Ready' });
      await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: 'Completed' });

      const res = await request(app)
        .patch(`/api/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'Pending' });
      expect(res.status).toBe(400);
      expect(res.body.error).toContain('finalized');
    });
  });

  describe('Status Transition Validation', () => {
    const allTransitions = [
      { from: 'Pending', to: 'Confirmed', valid: true },
      { from: 'Pending', to: 'Cancelled', valid: true },
      { from: 'Pending', to: 'Completed', valid: false },
      { from: 'Confirmed', to: 'Payment Pending', valid: true },
      { from: 'Confirmed', to: 'Cancelled', valid: true },
      { from: 'Payment Pending', to: 'Paid', valid: true },
      { from: 'Paid', to: 'Queued', valid: true },
      { from: 'Queued', to: 'In Production', valid: true },
      { from: 'In Production', to: 'Quality Check', valid: true },
      { from: 'Quality Check', to: 'Ready', valid: true },
      { from: 'Quality Check', to: 'In Production', valid: true },
      { from: 'Ready', to: 'Completed', valid: true },
      { from: 'Completed', to: 'Pending', valid: false },
      { from: 'Cancelled', to: 'Pending', valid: false }
    ];

    allTransitions.forEach(({ from, to, valid }) => {
      it(`should ${valid ? 'allow' : 'reject'} ${from} -> ${to}`, async () => {
        const createRes = await createOrder(customerToken);
        const orderId = createRes.body.order.orderId;
        const pathToFrom = getPathToStatus(from);
        for (const s of pathToFrom) {
          await request(app).patch(`/api/orders/${orderId}/status`).set('Authorization', `Bearer ${adminToken}`).send({ status: s });
        }
        const res = await request(app)
          .patch(`/api/orders/${orderId}/status`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ status: to });
        if (valid) {
          expect(res.status).toBe(200);
        } else {
          expect(res.status).toBe(400);
        }
      });
    });
  });
});

function getPathToStatus(target) {
  const paths = {
    'Pending': [],
    'Quoted': ['Quoted'],
    'Confirmed': ['Confirmed'],
    'Payment Pending': ['Confirmed', 'Payment Pending'],
    'Paid': ['Confirmed', 'Payment Pending', 'Paid'],
    'Queued': ['Confirmed', 'Payment Pending', 'Paid', 'Queued'],
    'In Production': ['Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production'],
    'Quality Check': ['Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check'],
    'Ready': ['Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready'],
    'Completed': ['Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed'],
    'Cancelled': ['Cancelled']
  };
  return paths[target] || [];
}
