import request from 'supertest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup.js';
import { Notification, Order, User } from '../server/db.js';
import orderFileRoutes from '../server/routes/orderFiles.js';
import orderPaymentRoutes from '../server/routes/orderPayments.js';

jest.mock('../server/utils.js', () => {
  const { saveDesignFile } = jest.requireActual('../server/designFiles.js');
  return {
    safeText: value => typeof value === 'string' ? value : '',
    serializeOrder: order => order.serialize(),
    uploadDesignFile: data => saveDesignFile(data, process.env.ORDER_UPLOAD_DIR)
  };
});

let app;
let directory;
let originalFetch;
let originalUploadDirectory;
let originalSupabaseUrl;
let originalSupabaseKey;

const users = {
  customer: { id: 'customer-a', email: 'a@example.com', app_metadata: { role: 'customer' } },
  other: { id: 'customer-b', email: 'b@example.com', app_metadata: { role: 'customer' } },
  staff: { id: 'staff-a', email: 'staff@example.com', app_metadata: { role: 'staff' } },
  admin: { id: 'admin-a', email: 'admin@example.com', app_metadata: { role: 'admin' } },
  forged: { id: 'customer-c', email: 'c@example.com', user_metadata: { role: 'admin' } }
};

const auth = token => ({ Authorization: `Bearer ${token}` });
const receipt = (filename = 'receipt.png') => ({ filename, base64: 'data:image/png;base64,dGVzdA==' });
const paymentPayload = overrides => ({
  paymentMethod: 'GCash',
  amount: 5000,
  referenceNumber: 'GC-REF-1001',
  receipt: receipt(),
  ...overrides
});
const orderId = 'ORD-PAY-1';

beforeAll(async () => {
  await setupTestDB();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-order-payments-'));
  originalFetch = global.fetch;
  originalUploadDirectory = process.env.ORDER_UPLOAD_DIR;
  originalSupabaseUrl = process.env.SUPABASE_URL;
  originalSupabaseKey = process.env.SUPABASE_ANON_KEY;
  process.env.ORDER_UPLOAD_DIR = directory;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  global.fetch = jest.fn(async (_url, options = {}) => {
    const token = options.headers?.Authorization?.replace(/^Bearer /, '');
    const user = users[token];
    return { ok: Boolean(user), json: async () => user || {} };
  });
  app = express();
  app.use(express.json({ limit: '50mb' }));
  orderPaymentRoutes(app);
  orderFileRoutes(app, directory);
});

afterAll(async () => {
  global.fetch = originalFetch;
  if (originalUploadDirectory === undefined) delete process.env.ORDER_UPLOAD_DIR;
  else process.env.ORDER_UPLOAD_DIR = originalUploadDirectory;
  if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL;
  else process.env.SUPABASE_URL = originalSupabaseUrl;
  if (originalSupabaseKey === undefined) delete process.env.SUPABASE_ANON_KEY;
  else process.env.SUPABASE_ANON_KEY = originalSupabaseKey;
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith('bm-order-payments-')) {
    throw new Error('Unexpected payment test directory.');
  }
  await fs.rm(directory, { recursive: true, force: true });
  await teardownTestDB();
});

beforeEach(async () => {
  await clearTestDB();
  await User.create({ id: 'admin-a', name: 'Admin A', email: 'admin@example.com', role: 'admin' });
  await Order.create({
    orderId,
    customerId: 'customer-a',
    customerName: 'Customer A',
    customerEmail: 'a@example.com',
    contactNumber: '09171234567',
    items: [{ productId: 2, productName: 'Polo Shirt', quantity: 10, unitPrice: 500, subtotal: 5000 }],
    totalAmount: 5000,
    paymentMethod: 'GCash',
    status: 'Pending'
  });
});

describe('Phase 2 order payment verification', () => {
  it('starts unpaid, scopes submissions to the authenticated customer, and blocks staff', async () => {
    const saved = await Order.findOne({ orderId });
    expect(saved.status).toBe('Pending');
    expect(saved.paymentStatus).toBe('Unpaid');

    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('other')).send(paymentPayload())).status).toBe(404);
    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('staff')).send(paymentPayload())).status).toBe(403);
    expect((await request(app).post(`/api/orders/${orderId}/payments`).send(paymentPayload())).status).toBe(401);
  });

  it('validates required details, amount, method and receipt before saving', async () => {
    const incomplete = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ receipt: undefined }));
    expect(incomplete.status).toBe(400);
    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ amount: 0 }))).status).toBe(400);
    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ amount: -1 }))).status).toBe(400);
    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ amount: 'not-a-number' }))).status).toBe(400);
    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ amount: 5000.001 }))).status).toBe(400);
    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ paymentMethod: 'Cash' }))).status).toBe(400);
    expect((await Order.findOne({ orderId })).paymentStatus).toBe('Unpaid');
  });

  it('stores a private receipt and keeps order Pending until an admin verifies it', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    expect(submitted.status).toBe(200);
    expect(submitted.body.order.paymentStatus).toBe('For Verification');
    expect(submitted.body.order.status).toBe('Pending');
    expect(submitted.body.order.latestPayment.referenceNumber).toBe('GC-REF-1001');
    expect(await Notification.countDocuments({ recipientId: 'admin-a', type: 'payment_submitted' })).toBe(1);

    const saved = await Order.findOne({ orderId });
    const payment = saved.paymentSubmissions[0];
    expect(payment.customerId).toBe('customer-a');
    expect(await fs.readFile(payment.receiptFilePath, 'utf8')).toBe('test');
    expect((await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload())).status).toBe(409);

    expect((await request(app).get('/api/admin/payments/verification').set(auth('customer'))).status).toBe(403);
    expect((await request(app).get('/api/admin/payments/verification').set(auth('staff'))).status).toBe(403);
    const queue = await request(app).get('/api/admin/payments/verification').set(auth('admin'));
    expect(queue.status).toBe(200);
    expect(queue.body.payments[0].orderId).toBe(orderId);
    expect(queue.body.payments[0].payment.amount).toBe(5000);
    expect(queue.body.payments[0].amountMatchesOrderTotal).toBe(true);

    const receiptResponse = await request(app).get(`/api/admin/orders/${orderId}/payments/${payment.id}/receipt`).set(auth('admin'));
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.headers['content-disposition']).toContain('attachment');
    expect((await request(app).get(`/api/admin/orders/${orderId}/payments/${payment.id}/receipt`).set(auth('staff'))).status).toBe(403);
    expect((await request(app).get(`/api/admin/orders/${orderId}/payments/${payment.id}/receipt`).set(auth('customer'))).status).toBe(403);

    const reviewed = await request(app).patch(`/api/admin/orders/${orderId}/payments/${payment.id}/review`)
      .set(auth('admin')).send({ action: 'approve' });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.order.paymentStatus).toBe('Verified');
    expect(reviewed.body.order.status).toBe('Confirmed');
    const persisted = await Order.findOne({ orderId });
    expect(persisted.paymentStatus).toBe('Verified');
    expect(persisted.status).toBe('Confirmed');
    expect(persisted.paymentSubmissions[0].verifiedBy).toBe('admin-a');
    expect(await Notification.countDocuments({ recipientId: 'customer-a', type: 'payment_verified', relatedOrderId: orderId })).toBe(1);
  });

  it('requires the exact historical order total and rejects underpayments and overpayments', async () => {
    const under = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ amount: 4999.99 }));
    expect(under.status).toBe(422);
    expect(under.body.error).toMatch(/full payment/i);
    const over = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ amount: 5000.01 }));
    expect(over.status).toBe(422);
    const saved = await Order.findOne({ orderId });
    expect(saved.totalAmount).toBe(5000);
    expect(saved.paymentStatus).toBe('Unpaid');
    expect(saved.paymentSubmissions).toHaveLength(0);
  });

  it('handles valid decimal-cent totals without floating-point equality errors', async () => {
    await Order.updateOne({ orderId }, { $set: { totalAmount: 2800.10 } });
    const response = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload({ amount: 2800.10 }));
    expect(response.status).toBe(200);
    expect(response.body.order.latestPayment.amount).toBe(2800.10);
  });

  it('blocks approval of an existing mismatched submission without changing either state', async () => {
    const mismatched = {
      customerId: 'customer-a', paymentMethod: 'GCash', amount: 1, referenceNumber: 'LEGACY-MISMATCH',
      receiptFileName: 'legacy.png', receiptFilePath: path.join(directory, 'legacy.png'), receiptOriginalName: 'legacy.png',
      receiptFileType: 'image/png', status: 'For Verification', submittedAt: new Date()
    };
    await Order.updateOne({ orderId }, { $push: { paymentSubmissions: mismatched }, $set: { paymentStatus: 'For Verification' } });
    const saved = await Order.findOne({ orderId });
    const paymentId = saved.paymentSubmissions.at(-1)._id;
    const response = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`).set(auth('admin')).send({ action: 'approve' });
    expect(response.status).toBe(409);
    const unchanged = await Order.findOne({ orderId });
    expect(unchanged.status).toBe('Pending');
    expect(unchanged.paymentStatus).toBe('For Verification');
    expect(unchanged.paymentSubmissions.at(-1).status).toBe('For Verification');
    expect(unchanged.totalAmount).toBe(5000);
  });

  it('allows only one of two concurrent approval attempts to take effect', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    const endpoint = `/api/admin/orders/${orderId}/payments/${submitted.body.order.latestPayment.id}/review`;
    const responses = await Promise.all([
      request(app).patch(endpoint).set(auth('admin')).send({ action: 'approve' }),
      request(app).patch(endpoint).set(auth('admin')).send({ action: 'approve' })
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const saved = await Order.findOne({ orderId });
    expect(saved.paymentSubmissions.filter(payment => payment.status === 'Verified')).toHaveLength(1);
    expect(saved.paymentStatus).toBe('Verified');
    expect(saved.status).toBe('Confirmed');
    expect(await Notification.countDocuments({ recipientId: 'customer-a', type: 'payment_verified', relatedOrderId: orderId })).toBe(1);
  });

  it('rejects a receipt with a reason and allows another payment submission', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    const paymentId = submitted.body.order.latestPayment.id;
    const rejected = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`)
      .set(auth('admin')).send({ action: 'reject', rejectionReason: 'Reference could not be verified.' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.order.status).toBe('Pending');
    expect(rejected.body.order.paymentStatus).toBe('Rejected');
    expect(rejected.body.order.paymentRejectionReason).toBe('Reference could not be verified.');
    const rejectionNotice = await Notification.findOne({ recipientId: 'customer-a', type: 'payment_rejected', relatedOrderId: orderId }).lean();
    expect(rejectionNotice.message).toContain('Reference could not be verified.');

    const resubmitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer'))
      .send(paymentPayload({ referenceNumber: 'GC-REF-1002', receipt: receipt('receipt-again.png') }));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.order.paymentStatus).toBe('For Verification');
    expect((await Order.findOne({ orderId })).paymentSubmissions).toHaveLength(2);
  });

  it('does not reopen a cancelled order during payment review', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    await Order.updateOne({ orderId }, { status: 'Cancelled' });
    const response = await request(app).patch(`/api/admin/orders/${orderId}/payments/${submitted.body.order.latestPayment.id}/review`)
      .set(auth('admin')).send({ action: 'approve' });
    expect(response.status).toBe(409);
    const saved = await Order.findOne({ orderId });
    expect(saved.status).toBe('Cancelled');
    expect(saved.paymentStatus).toBe('For Verification');
  });
});
