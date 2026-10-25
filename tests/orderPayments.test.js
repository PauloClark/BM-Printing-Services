import request from 'supertest';
import express from 'express';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup.js';
import { AuditLog, Order, OrderFile, Product, Production, User } from '../server/db.js';
import orderFileRoutes from '../server/routes/orderFiles.js';
import orderPaymentRoutes from '../server/routes/orderPayments.js';
import orderRoutes from '../server/routes/orders.js';

jest.mock('../server/utils.js', () => {
  const { saveDesignFile } = jest.requireActual('../server/designFiles.js');
  return {
    safeText: value => typeof value === 'string' ? value : '',
    serializeOrder: order => ({
      ...order.serialize(),
      paymentMethod: order.paymentMethod,
      payment_method: order.paymentMethod,
      orderSource: order.orderSource || 'online',
      createdBy: order.createdBy || '',
      specificationDetails: order.specificationDetails || {},
      cashPayment: order.cashPayment?.toObject?.() || order.cashPayment || null
    }),
    uploadDesignFile: data => saveDesignFile(data, process.env.ORDER_UPLOAD_DIR)
  };
});
jest.mock('../server/reportService.js', () => ({
  generateDailyReport: jest.fn().mockResolvedValue({}),
  getDefaultReportDate: jest.fn().mockReturnValue('2026-10-23')
}));

let app;
let directory;
let legacyDirectory;
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
  legacyDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-order-payments-legacy-'));
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
  orderRoutes(app);
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
  if (path.dirname(legacyDirectory) !== os.tmpdir() || !path.basename(legacyDirectory).startsWith('bm-order-payments-legacy-')) {
    throw new Error('Unexpected legacy receipt test directory.');
  }
  await fs.rm(directory, { recursive: true, force: true });
  await fs.rm(legacyDirectory, { recursive: true, force: true });
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
    const submittedOrder = await Order.findOne({ orderId }).lean();
    expect(submittedOrder.notificationOutbox).toContainEqual(expect.objectContaining({ recipientId: '*', recipientRole: 'admin', type: 'payment_submitted', state: 'PENDING' }));

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

    const designFileLookup = jest.spyOn(OrderFile, 'findOne');
    const receiptResponse = await request(app).get(`/api/admin/orders/${orderId}/payments/${payment.id}/receipt`).set(auth('admin'));
    expect(designFileLookup).not.toHaveBeenCalled();
    designFileLookup.mockRestore();
    expect(receiptResponse.status).toBe(200);
    expect(receiptResponse.headers['content-disposition']).toContain('attachment');
    expect(receiptResponse.headers['content-type']).toContain('image/png');
    expect(receiptResponse.body.toString()).toBe('test');
    expect((await request(app).get(`/api/admin/orders/${orderId}/payments/${payment.id}/receipt`).set(auth('staff'))).status).toBe(403);
    expect((await request(app).get(`/api/admin/orders/${orderId}/payments/${payment.id}/receipt`).set(auth('customer'))).status).toBe(403);

    const reviewed = await request(app).patch(`/api/admin/orders/${orderId}/payments/${payment.id}/review`)
      .set(auth('admin')).send({ action: 'approve', transactionConfirmed: true });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.order.paymentStatus).toBe('Verified');
    expect(reviewed.body.order.status).toBe('Pending');
    const persisted = await Order.findOne({ orderId });
    expect(persisted.paymentStatus).toBe('Verified');
    expect(persisted.status).toBe('Pending');
    expect(persisted.paymentSubmissions[0].verifiedBy).toBe('admin-a');
    expect(persisted.paymentSubmissions[0].verifiedAt).toBeTruthy();
    expect((await Order.findOne({ orderId }).lean()).notificationOutbox).toContainEqual(expect.objectContaining({ recipientId: 'customer-a', recipientRole: 'customer', type: 'payment_verified', relatedOrderId: orderId, state: 'PENDING' }));
    const audit = await AuditLog.findOne({ action: 'VERIFY_PAYMENT', resourceId: orderId }).lean();
    expect(audit.newValue).toMatchObject({
      paymentId: String(persisted.paymentSubmissions[0]._id),
      paymentMethod: 'GCash',
      amount: 5000,
      referenceNumber: 'GC-REF-1001',
      transactionConfirmed: true,
      orderStatus: 'Pending'
    });
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
    const response = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`).set(auth('admin')).send({ action: 'approve', transactionConfirmed: true });
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
      request(app).patch(endpoint).set(auth('admin')).send({ action: 'approve', transactionConfirmed: true }),
      request(app).patch(endpoint).set(auth('admin')).send({ action: 'approve', transactionConfirmed: true })
    ]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const saved = await Order.findOne({ orderId });
    expect(saved.paymentSubmissions.filter(payment => payment.status === 'Verified')).toHaveLength(1);
    expect(saved.paymentStatus).toBe('Verified');
    expect(saved.status).toBe('Pending');
    expect((await Order.findOne({ orderId }).lean()).notificationOutbox.filter(item => item.type === 'payment_verified')).toHaveLength(1);
  });

  it('records Admin-verified cash without changing the independent order status', async () => {
    await Order.updateOne({ orderId }, { $set: { paymentMethod: 'cash', paymentStatus: 'pending' } });
    const denied = await request(app).post(`/api/admin/orders/${orderId}/cash`)
      .set(auth('staff')).send({ amount: 5000, received: true });
    expect(denied.status).toBe(403);

    const notReceived = await request(app).post(`/api/admin/orders/${orderId}/cash`)
      .set(auth('admin')).send({ amount: 5000, received: false });
    expect(notReceived.status).toBe(400);
    const incorrectAmount = await request(app).post(`/api/admin/orders/${orderId}/cash`)
      .set(auth('admin')).send({ amount: 4999, received: true });
    expect(incorrectAmount.status).toBe(422);

    const response = await request(app).post(`/api/admin/orders/${orderId}/cash`)
      .set(auth('admin')).send({ amount: 5000, received: true });
    expect(response.status).toBe(200);
    expect(response.body.order.paymentStatus).toBe('Verified');
    expect(response.body.order.status).toBe('Pending');
    expect(response.body.order.cashPayment).toMatchObject({ amount: 5000, verifiedBy: 'admin-a' });
    expect(response.body.order.cashPayment.verifiedAt).toBeTruthy();
    expect(await AuditLog.exists({ action: 'VERIFY_CASH_PAYMENT', userId: 'admin-a', resourceId: orderId })).toBeTruthy();
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
    const rejectionNotice = (await Order.findOne({ orderId }).lean()).notificationOutbox.find(item => item.type === 'payment_rejected');
    expect(rejectionNotice).toMatchObject({ recipientId: 'customer-a', state: 'PENDING' });
    expect(rejectionNotice.message).not.toContain('Reference could not be verified.');

    const resubmitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer'))
      .send(paymentPayload({ referenceNumber: 'GC-REF-1002', receipt: receipt('receipt-again.png') }));
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.order.paymentStatus).toBe('For Verification');
    expect((await Order.findOne({ orderId })).paymentSubmissions).toHaveLength(2);
  });

  it('does not reopen a cancelled order during payment review', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    await Order.updateOne({ orderId }, { status: 'Cancelled' });
    const queue = await request(app).get('/api/admin/payments/verification').set(auth('admin'));
    expect(queue.body.payments[0]).toMatchObject({ orderId, orderStatus: 'Cancelled', archived: false });
    const response = await request(app).patch(`/api/admin/orders/${orderId}/payments/${submitted.body.order.latestPayment.id}/review`)
      .set(auth('admin')).send({ action: 'approve', transactionConfirmed: true });
    expect(response.status).toBe(409);

    const paymentId = submitted.body.order.latestPayment.id;
    expect((await request(app).post(`/api/admin/orders/${orderId}/payments/${paymentId}/reconcile`)
      .set(auth('staff')).send({ note: 'Review transaction' })).status).toBe(403);
    const reconciliation = await request(app).post(`/api/admin/orders/${orderId}/payments/${paymentId}/reconcile`)
      .set(auth('admin')).send({ note: 'Check GCash transaction and determine settlement.' });
    expect(reconciliation.status).toBe(200);
    expect(reconciliation.body.order.status).toBe('Cancelled');
    expect(reconciliation.body.order.paymentStatus).toBe('For Verification');
    expect(reconciliation.body.payment.reconciliationBy).toBe('admin-a');
    expect(reconciliation.body.payment.reconciliationNote).toContain('Check GCash');
    expect((await request(app).post(`/api/admin/orders/${orderId}/payments/${paymentId}/reconcile`)
      .set(auth('admin')).send({ note: 'Duplicate flag' })).status).toBe(409);

    const saved = await Order.findOne({ orderId });
    expect(saved.status).toBe('Cancelled');
    expect(saved.paymentStatus).toBe('For Verification');
    expect(saved.paymentSubmissions[0].status).toBe('For Verification');
    expect(saved.paymentSubmissions[0].reconciliationBy).toBe('admin-a');
    expect(saved.paymentAudit.at(-1)).toMatchObject({
      action: 'FLAG_PAYMENT_RECONCILIATION',
      userId: 'admin-a',
      paymentMethod: 'GCash',
      amount: 5000,
      referenceNumber: 'GC-REF-1001',
      transactionConfirmed: false,
      orderStatus: 'Cancelled'
    });
    expect(await AuditLog.exists({
      action: 'FLAG_PAYMENT_RECONCILIATION',
      userId: 'admin-a',
      resourceId: orderId,
      'newValue.paymentStatus': 'For Verification',
      'newValue.orderStatus': 'Cancelled'
    })).toBeTruthy();
  });

  it('requires explicit transaction confirmation before approving an eligible payment', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    const paymentId = submitted.body.order.latestPayment.id;
    for (const token of ['staff', 'customer']) {
      const unauthorized = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`)
        .set(auth(token)).send({ action: 'approve', transactionConfirmed: true });
      expect(unauthorized.status).toBe(403);
    }
    const response = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`)
      .set(auth('admin')).send({ action: 'approve' });
    expect(response.status).toBe(400);
    expect(response.body.error).toMatch(/actual transaction/i);
    const saved = await Order.findOne({ orderId });
    expect(saved.status).toBe('Pending');
    expect(saved.paymentStatus).toBe('For Verification');
    expect(saved.paymentSubmissions[0].status).toBe('For Verification');
  });

  it('allows completed orders awaiting payment to be flagged for reconciliation without changing either status', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    await Order.updateOne({ orderId }, { status: 'Completed' });
    const paymentId = submitted.body.order.latestPayment.id;
    const blocked = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`)
      .set(auth('admin')).send({ action: 'approve', transactionConfirmed: true });
    expect(blocked.status).toBe(409);
    const reconciled = await request(app).post(`/api/admin/orders/${orderId}/payments/${paymentId}/reconcile`)
      .set(auth('admin')).send({ note: 'Confirm settlement against provider records.' });
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.order.status).toBe('Completed');
    expect(reconciled.body.order.paymentStatus).toBe('For Verification');
  });

  it('requires archived picked-up orders to use the reconciliation route', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    await Order.updateOne({ orderId }, { status: 'Picked Up', archived: true });
    const paymentId = submitted.body.order.latestPayment.id;
    const blocked = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`)
      .set(auth('admin')).send({ action: 'approve', transactionConfirmed: true });
    expect(blocked.status).toBe(409);
    const reconciled = await request(app).post(`/api/admin/orders/${orderId}/payments/${paymentId}/reconcile`)
      .set(auth('admin')).send({ note: 'Confirm archived order payment status.' });
    expect(reconciled.status).toBe(200);
    expect(reconciled.body.order.status).toBe('Picked Up');
    expect(reconciled.body.order.archived).toBe(true);
    expect(reconciled.body.order.paymentStatus).toBe('For Verification');
  });

  it('serves a valid receipt from a legacy local path outside the configured upload directory', async () => {
    const legacyFilename = 'legacy-receipt.jpg';
    const legacyFile = path.join(legacyDirectory, legacyFilename);
    await fs.writeFile(legacyFile, Buffer.from('legacy receipt bytes'));
    const order = await Order.findOne({ orderId });
    order.paymentStatus = 'For Verification';
    order.paymentSubmissions.push({
      customerId: 'customer-a',
      paymentMethod: 'GCash',
      amount: 5000,
      referenceNumber: 'LEGACY-REF-1',
      receiptFileName: legacyFilename,
      receiptFilePath: legacyFile,
      receiptOriginalName: legacyFilename,
      receiptFileType: 'image/jpeg',
      status: 'For Verification'
    });
    await order.save();
    const paymentId = String(order.paymentSubmissions.at(-1)._id);
    const response = await request(app).get(`/api/admin/orders/${orderId}/payments/${paymentId}/receipt`).set(auth('admin'));
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('image/jpeg');
    expect(response.body.toString()).toBe('legacy receipt bytes');
  });

  it('securely downloads a legacy non-image receipt as an attachment', async () => {
    const legacyFilename = 'legacy-receipt.pdf';
    const legacyFile = path.join(legacyDirectory, legacyFilename);
    await fs.writeFile(legacyFile, Buffer.from('legacy pdf bytes'));
    const order = await Order.findOne({ orderId });
    order.paymentStatus = 'For Verification';
    order.paymentSubmissions.push({
      customerId: 'customer-a',
      paymentMethod: 'GCash',
      amount: 5000,
      referenceNumber: 'LEGACY-REF-PDF',
      receiptFileName: legacyFilename,
      receiptFilePath: legacyFile,
      receiptOriginalName: legacyFilename,
      receiptFileType: 'application/pdf',
      status: 'For Verification'
    });
    await order.save();
    const paymentId = String(order.paymentSubmissions.at(-1)._id);
    const response = await request(app).get(`/api/admin/orders/${orderId}/payments/${paymentId}/receipt`).set(auth('admin'));
    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('attachment');
    expect(response.body.toString()).toBe('legacy pdf bytes');
  });

  it('reports a missing receipt without invoking the design-file lookup', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    const payment = (await Order.findOne({ orderId })).paymentSubmissions[0];
    await fs.unlink(payment.receiptFilePath);
    const designFileLookup = jest.spyOn(OrderFile, 'findOne');
    const response = await request(app).get(`/api/admin/orders/${orderId}/payments/${payment._id}/receipt`).set(auth('admin'));
    expect(designFileLookup).not.toHaveBeenCalled();
    designFileLookup.mockRestore();
    expect(response.status).toBe(404);
    expect(response.body.error).toBe('Receipt unavailable - file missing.');
    expect((await Order.findOne({ orderId })).paymentStatus).toBe('For Verification');
    expect(submitted.status).toBe(200);
  });

  const cancel = body => request(app).patch(`/api/orders/${orderId}/status`).set(auth('admin'))
    .send({ status: 'Cancelled', cancellationReason: 'Customer requested cancellation.', ...body });
  const verifiedSubmission = (method = 'GCash') => ({
    customerId: 'customer-a', paymentMethod: method, amount: 5000,
    referenceNumber: `${method}-VERIFIED-1`, receiptFileName: 'verified.png',
    receiptFilePath: 'verified.png', receiptOriginalName: 'verified.png',
    receiptFileType: 'image/png', status: 'Verified', verifiedAt: new Date(), verifiedBy: 'admin-a'
  });

  it('requires a cancellation reason and allows an unpaid unassigned order to be cancelled atomically', async () => {
    expect((await cancel({ cancellationReason: '   ' })).status).toBe(400);
    const response = await cancel({});
    expect(response.status).toBe(200);
    expect(response.body.order.status).toBe('Cancelled');
    const saved = await Order.findOne({ orderId });
    expect(saved.cancellationAudit).toHaveLength(1);
    expect(saved.cancellationAudit[0]).toMatchObject({ action: 'CANCEL_ORDER', actorId: 'admin-a', reason: 'Customer requested cancellation.' });
    expect(saved.stockReleaseStatus).toBe('COMPLETED');
  });

  it('blocks cancellation while electronic payment proof is awaiting review', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    expect(submitted.status).toBe(200);
    expect((await cancel({})).status).toBe(409);
    expect((await Order.findOne({ orderId })).status).toBe('Pending');
  });

  it('allows cancellation after a payment is rejected and preserves its evidence history', async () => {
    const submitted = await request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload());
    const paymentId = submitted.body.order.latestPayment.id;
    const rejected = await request(app).patch(`/api/admin/orders/${orderId}/payments/${paymentId}/review`).set(auth('admin'))
      .send({ action: 'reject', rejectionReason: 'The transfer could not be verified.' });
    expect(rejected.status).toBe(200);
    expect((await cancel({})).status).toBe(200);
    const saved = await Order.findOne({ orderId });
    expect(saved.paymentSubmissions).toHaveLength(1);
    expect(saved.paymentSubmissions[0].status).toBe('Rejected');
    expect(saved.status).toBe('Cancelled');
  });

  it('recovers a failed stock release on retry without duplicating the cancellation event', async () => {
    await Product.create({ id: 2, name: 'Polo Shirt', price: 500, trackStock: true, stock: 0, stockReservations: [{ orderId, quantity: 10 }] });
    const update = jest.spyOn(Product, 'updateOne').mockRejectedValueOnce(new Error('temporary stock write failure'));
    const first = await cancel({});
    expect(first.status).toBe(503);
    let saved = await Order.findOne({ orderId });
    expect(saved.status).toBe('Cancelled');
    expect(saved.stockReleaseStatus).toBe('PENDING');
    update.mockRestore();

    const retry = await cancel({});
    expect(retry.status).toBe(200);
    expect(retry.body.recoveredStockRelease).toBe(true);
    saved = await Order.findOne({ orderId });
    const product = await Product.findOne({ id: 2 });
    expect(saved.stockReleaseStatus).toBe('COMPLETED');
    expect(saved.cancellationAudit).toHaveLength(1);
    expect(product.stock).toBe(10);
    expect(product.stockReservations).toHaveLength(0);
  });

  it.each(['GCash', 'Maya', 'BPI', 'GoTyme'])('blocks direct cancellation of verified %s payments', async method => {
    await Order.updateOne({ orderId }, { $set: { paymentStatus: 'Verified', paymentSubmissions: [verifiedSubmission(method)] } });
    const response = await cancel({});
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/financial resolution/i);
    expect((await Order.findOne({ orderId })).status).toBe('Pending');
  });

  it('blocks direct cancellation of verified cash and preserves the receipt', async () => {
    await Order.updateOne({ orderId }, { $set: { paymentMethod: 'cash', paymentStatus: 'Verified', cashPayment: { amount: 5000, verifiedBy: 'admin-a', verifiedAt: new Date() } } });
    expect((await cancel({})).status).toBe(409);
    const saved = await Order.findOne({ orderId });
    expect(saved.status).toBe('Pending');
    expect(saved.cashPayment.amount).toBe(5000);
  });

  it('requires a complete refund resolution and rejects pending or partial refund states', async () => {
    await Order.updateOne({ orderId }, { $set: { paymentStatus: 'Verified', paymentSubmissions: [verifiedSubmission()] } });
    const url = `/api/admin/orders/${orderId}/financial-resolution`;
    const required = await request(app).post(url).set(auth('admin')).send({ action: 'require_refund', reason: 'Customer cancelled before production.' });
    expect(required.status).toBe(200);
    expect(required.body.financialResolution.status).toBe('REFUND_REQUIRED');
    expect((await cancel({})).status).toBe(409);

    const pending = await request(app).post(url).set(auth('admin')).send({ action: 'refund_pending', reason: 'Refund request submitted to the bank.' });
    expect(pending.status).toBe(200);
    expect(pending.body.financialResolution.status).toBe('REFUND_PENDING');
    expect((await cancel({})).status).toBe(409);

    const partial = await request(app).post(url).set(auth('admin')).send({
      action: 'refund_completed', amount: 4999, referenceNumber: 'RF-1', resolutionDate: '2026-10-23', transactionConfirmed: true
    });
    expect(partial.status).toBe(409);
    expect((await Order.findOne({ orderId })).financialResolution.status).toBe('REFUND_PENDING');
  });

  it('requires actual refund confirmation, prevents duplicate completion, then permits final cancellation', async () => {
    await Order.updateOne({ orderId }, { $set: { paymentStatus: 'Verified', paymentSubmissions: [verifiedSubmission()] } });
    const url = `/api/admin/orders/${orderId}/financial-resolution`;
    await request(app).post(url).set(auth('admin')).send({ action: 'require_refund', reason: 'Customer cancelled before production.' }).expect(200);
    const incomplete = await request(app).post(url).set(auth('admin')).send({
      action: 'refund_completed', amount: 5000, referenceNumber: 'RF-100', resolutionDate: '2026-10-23'
    });
    expect(incomplete.status).toBe(400);
    const completed = await request(app).post(url).set(auth('admin')).send({
      action: 'refund_completed', amount: 5000, referenceNumber: 'RF-100', resolutionDate: '2026-10-23', transactionConfirmed: true
    });
    expect(completed.status).toBe(200);
    expect(completed.body.financialResolution).toMatchObject({ status: 'REFUND_COMPLETED', accountedAmountCents: 500000, resolvedBy: 'admin-a' });
    expect((await request(app).post(url).set(auth('admin')).send({ action: 'refund_completed', amount: 5000, referenceNumber: 'RF-101', resolutionDate: '2026-10-23', transactionConfirmed: true })).status).toBe(409);
    expect((await cancel({})).status).toBe(200);
    const saved = await Order.findOne({ orderId });
    expect(saved.paymentSubmissions[0].status).toBe('Verified');
    expect(saved.cancellationAudit).toHaveLength(1);
  });

  it('requires full value and customer agreement for credit, and an explicit reason for no-refund exceptions', async () => {
    await Order.updateOne({ orderId }, { $set: { paymentStatus: 'Verified', paymentSubmissions: [verifiedSubmission()] } });
    const url = `/api/admin/orders/${orderId}/financial-resolution`;
    const badException = await request(app).post(url).set(auth('admin')).send({ action: 'no_refund_applicable', reason: 'No refund.', exceptionApproved: true });
    expect(badException.status).toBe(400);
    await request(app).post(url).set(auth('admin')).send({ action: 'require_refund', reason: 'Customer requested store credit.' }).expect(200);
    const partialCredit = await request(app).post(url).set(auth('admin')).send({ action: 'credit_issued', amount: 10, referenceNumber: 'CR-1', resolutionDate: '2026-10-23', customerAgreed: true });
    expect(partialCredit.status).toBe(409);
    const credit = await request(app).post(url).set(auth('admin')).send({ action: 'credit_issued', amount: 5000, referenceNumber: 'CR-1', resolutionDate: '2026-10-23', customerAgreed: true });
    expect(credit.status).toBe(200);
    expect(credit.body.financialResolution.status).toBe('CREDIT_ISSUED');
    expect((await cancel({})).status).toBe(200);
  });

  it('records a justified no-refund exception as a fully accounted Admin disposition', async () => {
    await Order.updateOne({ orderId }, { $set: { paymentStatus: 'Verified', paymentSubmissions: [verifiedSubmission()] } });
    const response = await request(app).post(`/api/admin/orders/${orderId}/financial-resolution`).set(auth('admin')).send({
      action: 'no_refund_applicable',
      reason: 'Customer explicitly agreed to retain the completed custom setup charge.',
      exceptionApproved: true
    });
    expect(response.status).toBe(200);
    expect(response.body.financialResolution).toMatchObject({ status: 'NO_REFUND_APPLICABLE', accountedAmountCents: 500000, resolvedBy: 'admin-a' });
    expect((await cancel({})).status).toBe(200);
  });

  it('protects financial resolution endpoints from Staff and Customers', async () => {
    for (const token of ['staff', 'customer']) {
      expect((await request(app).post(`/api/admin/orders/${orderId}/financial-resolution`).set(auth(token)).send({ action: 'require_refund', reason: 'Unauthorized request.' })).status).toBe(403);
    }
  });

  it('blocks assigned production and terminal or archived orders from cancellation', async () => {
    await Production.create({ orderId, assignedEmployee: 'staff-a', assignedEmployeeName: 'Staff A', status: 'Queued' });
    expect((await cancel({})).status).toBe(409);
    await Production.deleteMany({ orderId });
    for (const patch of [{ status: 'Picked Up' }, { status: 'Completed' }, { archived: true }]) {
      await Order.updateOne({ orderId }, { $set: patch });
      expect((await cancel({})).status).toBe(409);
      await Order.updateOne({ orderId }, { $set: { status: 'Pending', archived: false } });
    }
  });

  it('does not let payment submission race through a successful cancellation', async () => {
    const [submission, cancellation] = await Promise.all([
      request(app).post(`/api/orders/${orderId}/payments`).set(auth('customer')).send(paymentPayload()),
      cancel({})
    ]);
    const saved = await Order.findOne({ orderId });
    if (saved.status === 'Cancelled') {
      expect(saved.paymentStatus).not.toBe('For Verification');
      expect(submission.status).toBe(409);
    } else {
      expect(saved.paymentStatus).toBe('For Verification');
      expect(cancellation.status).toBe(409);
    }
  });
});
