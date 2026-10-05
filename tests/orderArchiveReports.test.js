import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import ExcelJS from 'exceljs';
import { Order, Production, StockMovement } from '../server/db.js';
import orderArchiveRoutes from '../server/routes/orderArchives.js';

jest.mock('../server/utils.js', () => ({
  safeText: value => typeof value === 'string' ? value : '',
  serializeOrder: order => order.serialize(),
  uploadDesignFile: jest.fn()
}));

let app;
let replicaSet;
let originalFetch;
let oldUrl;
let oldKey;
const users = {
  admin: { id: 'admin-a', email: 'admin@example.com', app_metadata: { role: 'admin' } },
  staff: { id: 'staff-a', email: 'staff@example.com', app_metadata: { role: 'staff' } },
  customer: { id: 'customer-a', email: 'customer@example.com', app_metadata: { role: 'customer' } }
};
const auth = token => ({ Authorization: `Bearer ${token}` });
const makeOrderId = value => `ORD-ARCH-${value}`;

async function seedFinalizedOrder(suffix, options = {}) {
  const orderId = makeOrderId(suffix);
  const inventoryId = new mongoose.Types.ObjectId();
  const jobOrderId = `JO-ARCH-${suffix}`;
  const productionCompletedAt = options.productionCompletedAt || new Date('2026-10-08T12:00:00.000Z');
  const order = await Order.create({
    orderId,
    jobOrderId,
    customerId: 'customer-a',
    customerName: `Customer ${suffix}`,
    customerEmail: 'customer@example.com',
    contactNumber: '09171234567',
    items: [{ productId: 2, productName: options.product || 'Polo Shirt', quantity: 10, unitPrice: 500, subtotal: 5000 }],
    totalAmount: options.total || 5000,
    paymentMethod: 'GCash',
    paymentStatus: 'Verified',
    paymentSubmissions: [{
      customerId: 'customer-a', paymentMethod: 'GCash', amount: options.amountPaid || 2500,
      referenceNumber: `REF-${suffix}`, receiptFileName: `payment-${suffix}.png`, receiptFilePath: `/private/payment-${suffix}.png`,
      receiptOriginalName: `payment-${suffix}.png`, receiptFileType: 'image/png', receiptFileSize: 4,
      status: 'Verified', submittedAt: new Date('2026-10-01T08:00:00.000Z'), verifiedAt: new Date('2026-10-01T09:00:00.000Z'), verifiedBy: 'admin-a'
    }],
    status: 'Picked Up',
    pickedUpAt: new Date('2026-10-09T14:00:00.000Z'),
    releasedBy: 'staff-a',
    releasedByName: 'Staff A',
    receivedByName: 'Customer'
  });
  const job = await Production.create({
    phase3: true,
    jobOrderId,
    orderId,
    assignedEmployee: 'staff-a',
    assignedEmployeeName: 'Staff A',
    assignedBy: 'admin-a',
    dateAssigned: new Date('2026-10-01T10:00:00.000Z'),
    status: 'Ready for Pickup',
    productionStartedAt: new Date('2026-10-02T09:00:00.000Z'),
    productionCompletedAt,
    readyForPickupAt: new Date('2026-10-09T10:00:00.000Z'),
    reservedMaterials: [{ inventoryId, material: 'Polo Shirt Blank', unit: 'pcs', quantity: 10, reservationStatus: options.consumed === false ? 'reserved' : 'consumed' }]
  });
  if (options.withMovement !== false) {
    await StockMovement.create({
      orderId,
      jobOrderId,
      inventoryId,
      material: 'Polo Shirt Blank',
      materialType: 'T-shirts',
      unit: 'pcs',
      quantity: options.movementQuantity || 10,
      movementType: 'OUT',
      reason: 'ORDER_PICKUP',
      performedBy: 'staff-a',
      performedByName: 'Staff A',
      receivedByName: 'Customer',
      createdAt: new Date('2026-10-09T14:00:00.000Z')
    });
  }
  return { orderId, jobOrderId, order, job };
}

beforeAll(async () => {
  replicaSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replicaSet.getUri());
  originalFetch = global.fetch;
  oldUrl = process.env.SUPABASE_URL;
  oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  global.fetch = jest.fn(async (_url, options = {}) => {
    const token = options.headers?.Authorization?.replace(/^Bearer /, '');
    const user = users[token];
    return { ok: Boolean(user), json: async () => user || {} };
  });
  app = express();
  app.use(express.json());
  orderArchiveRoutes(app);
});

afterAll(async () => {
  global.fetch = originalFetch;
  if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl;
  if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey;
  await mongoose.disconnect();
  await replicaSet.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
});

describe('Phase 6 order archive and completion reports', () => {
  it('allows only admins to archive or query archived orders and reports', async () => {
    const { orderId } = await seedFinalizedOrder('SECURITY');
    for (const token of ['customer', 'staff']) {
      expect((await request(app).post(`/api/admin/orders/${orderId}/archive`).set(auth(token))).status).toBe(403);
      expect((await request(app).get('/api/admin/archived-orders').set(auth(token))).status).toBe(403);
      expect((await request(app).get('/api/admin/reports/completed-orders?from=2026-10-01&to=2026-10-31').set(auth(token))).status).toBe(403);
    }
  });

  it('rejects archiving unless pickup, verified payment, production and inventory finalization are recorded', async () => {
    const missingPayment = await seedFinalizedOrder('PAYMENT');
    await Order.updateOne({ orderId: missingPayment.orderId }, { paymentStatus: 'Rejected' });
    expect((await request(app).post(`/api/admin/orders/${missingPayment.orderId}/archive`).set(auth('admin'))).status).toBe(409);

    const missingMovement = await seedFinalizedOrder('MOVEMENT', { withMovement: false });
    expect((await request(app).post(`/api/admin/orders/${missingMovement.orderId}/archive`).set(auth('admin'))).status).toBe(409);

    const unconsumed = await seedFinalizedOrder('RESERVED', { consumed: false });
    expect((await request(app).post(`/api/admin/orders/${unconsumed.orderId}/archive`).set(auth('admin'))).status).toBe(409);

    const notPickedUp = await seedFinalizedOrder('NOTPICKED');
    await Order.updateOne({ orderId: notPickedUp.orderId }, { status: 'Ready for Pickup', pickedUpAt: null, releasedBy: '' });
    expect((await request(app).post(`/api/admin/orders/${notPickedUp.orderId}/archive`).set(auth('admin'))).status).toBe(409);
  });

  it('archives the original order once and preserves joined payment, production and movement history', async () => {
    const { orderId } = await seedFinalizedOrder('VALID');
    const archived = await request(app).post(`/api/admin/orders/${orderId}/archive`).set(auth('admin'));
    expect(archived.status).toBe(200);
    expect(archived.body.order.archived).toBe(true);
    expect(archived.body.order.archivedAt).toBeTruthy();
    expect(archived.body.order.archivedBy).toBe('admin-a');
    expect((await Order.countDocuments({ orderId }))).toBe(1);

    expect((await request(app).post(`/api/admin/orders/${orderId}/archive`).set(auth('admin'))).status).toBe(409);
    const archivedOrders = await request(app).get('/api/admin/archived-orders').set(auth('admin'));
    expect(archivedOrders.body.orders.map(order => order.id)).toContain(orderId);
    const detail = await request(app).get(`/api/admin/archived-orders/${orderId}`).set(auth('admin'));
    expect(detail.status).toBe(200);
    expect(detail.body.payments[0].referenceNumber).toBe('REF-VALID');
    expect(detail.body.job.jobOrderId).toBe('JO-ARCH-VALID');
    expect(detail.body.movements).toHaveLength(1);
    expect(detail.body.order.status).toBe('Picked Up');
  });

  it('filters by production completion date, returns each order once, and exports actual XLSX totals', async () => {
    const inRangeA = await seedFinalizedOrder('RANGE-A');
    const inRangeB = await seedFinalizedOrder('RANGE-B', { productionCompletedAt: new Date('2026-10-20T16:30:00.000Z') });
    await seedFinalizedOrder('OUTSIDE', { productionCompletedAt: new Date('2026-11-01T01:00:00.000Z') });
    await Order.updateOne({ orderId: inRangeA.orderId }, { archived: true, archivedAt: new Date(), archivedBy: 'admin-a' });

    const report = await request(app).get('/api/admin/reports/completed-orders?from=2026-10-01&to=2026-10-31').set(auth('admin'));
    expect(report.status).toBe(200);
    expect(report.body.completedOrders).toBe(2);
    expect(report.body.totalSales).toBe(10000);
    expect(report.body.rows.map(row => row.orderId).sort()).toEqual([inRangeA.orderId, inRangeB.orderId].sort());
    expect(new Set(report.body.rows.map(row => row.orderId)).size).toBe(2);

    const outside = await request(app).get('/api/admin/reports/completed-orders?from=2026-11-02&to=2026-11-30').set(auth('admin'));
    expect(outside.body.completedOrders).toBe(0);
    expect(outside.body.rows).toHaveLength(0);

    const exported = await request(app).get('/api/admin/reports/completed-orders/export?from=2026-10-01&to=2026-10-31').set(auth('admin'));
    expect(exported.status).toBe(200);
    expect(exported.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(exported.headers['content-disposition']).toContain('BM_Printing_Completed_Orders_2026-10-01_to_2026-10-31.xlsx');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(exported.body);
    const sheet = workbook.getWorksheet('Completed Orders');
    expect(sheet.getCell('A1').value).toBe('BM PRINTING SERVICES');
    expect(sheet.getCell('A2').value).toBe('COMPLETED ORDERS REPORT');
    expect(sheet.getRow(6).getCell(10).value).toBe('Production Completed / Manufacture Date');
    expect(sheet.getRow(7).getCell(1).value).toBeTruthy();
    expect(sheet.getRow(sheet.rowCount).getCell(1).value).toContain('Total Completed Orders: 2');
  });
});
