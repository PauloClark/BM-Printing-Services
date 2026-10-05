import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Order, Production, Inventory } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import orderRoutes from '../server/routes/orders.js';
import phase3Routes from '../server/routes/jobOrders.js';

jest.mock('../server/utils.js', () => ({
  safeText: value => typeof value === 'string' ? value : '',
  serializeOrder: order => order.serialize(),
  uploadDesignFile: jest.fn()
}));
jest.mock('../server/reportService.js', () => ({
  generateDailyReport: jest.fn().mockResolvedValue({}),
  getDefaultReportDate: jest.fn().mockReturnValue('2026-10-01')
}));
jest.mock('../server/staffDirectory.js', () => ({
  listAssignableStaff: jest.fn().mockResolvedValue([]),
  verifyAssignableStaff: jest.fn()
}));

let app;
let replicaSet;
let originalFetch;
let oldUrl;
let oldKey;
let customerToken;
let staffAToken;
let staffBToken;
let adminToken;
let anotherJobId;

const users = {
  customer: { id: 'customer-a', email: 'customer@example.com', app_metadata: { role: 'customer' } },
  staffA: { id: 'staff-a', email: 'staff-a@example.com', app_metadata: { role: 'staff' }, user_metadata: { full_name: 'Staff A' } },
  staffB: { id: 'staff-b', email: 'staff-b@example.com', app_metadata: { role: 'staff' } },
  admin: { id: 'admin-a', email: 'admin@example.com', app_metadata: { role: 'admin' } }
};
const headers = token => ({ Authorization: `Bearer ${token}` });

async function seedJob({ orderId, jobOrderId, assignedEmployee, status = 'Queueing' }) {
  await Order.create({
    orderId,
    jobOrderId,
    customerId: 'customer-a',
    customerName: 'Customer A',
    customerEmail: 'customer@example.com',
    contactNumber: '09171234567',
    specs: 'Size: Large\nColor: Black\nAdditional Notes: Front print',
    notes: 'Use the submitted reference.',
    items: [{ productId: 2, productName: 'Polo Shirt', quantity: 10, unitPrice: 500, subtotal: 5000 }],
    totalAmount: 5000,
    paymentStatus: 'Verified',
    status: 'Confirmed'
  });
  return Production.create({
    phase3: true,
    jobOrderId,
    orderId,
    assignedEmployee,
    assignedEmployeeName: assignedEmployee === 'staff-a' ? 'Staff A' : 'Staff B',
    assignedBy: 'admin-a',
    dateAssigned: new Date('2026-10-01T10:00:00.000Z'),
    status,
    reservedMaterials: [{ inventoryId: '000000000000000000000001', material: 'Polo shirt blank', unit: 'pcs', quantity: 10 }]
  });
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
  orderRoutes(app);
  phase3Routes(app);
  customerToken = 'customer';
  staffAToken = 'staffA';
  staffBToken = 'staffB';
  adminToken = 'admin';
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
  await Inventory.create({ _id: '000000000000000000000001', material: 'Polo shirt blank', type: 'T-shirts', quantity: 30, reservedQuantity: 10, unit: 'pcs' });
  await seedJob({ orderId: 'ORD-JOB-A', jobOrderId: 'JO-0001', assignedEmployee: 'staff-a' });
  await seedJob({ orderId: 'ORD-JOB-B', jobOrderId: 'JO-0002', assignedEmployee: 'staff-b' });
  anotherJobId = 'JO-0002';
});

describe('Phase 4 job order production workflow', () => {
  it('lists only assigned jobs to staff and denies access to another employee job', async () => {
    const ownJobs = await request(app).get('/api/job-orders').set(headers(staffAToken));
    expect(ownJobs.status).toBe(200);
    expect(ownJobs.body.jobs.map(job => job.jobOrderId)).toEqual(['JO-0001']);
    expect((await request(app).get(`/api/job-orders/${anotherJobId}`).set(headers(staffAToken))).status).toBe(404);
    expect((await request(app).get('/api/job-orders').set(headers(customerToken))).status).toBe(403);
    const adminJobs = await request(app).get('/api/job-orders').set(headers(adminToken));
    expect(adminJobs.body.jobs).toHaveLength(2);
  });

  it('enforces strict transitions, synchronizes the parent order and preserves reserved stock', async () => {
    const route = `/api/job-orders/JO-0001/status`;
    const skip = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Queueing', status: 'Completed' });
    expect(skip.status).toBe(400);
    const wrongStaff = await request(app).patch(`/api/job-orders/${anotherJobId}/status`).set(headers(staffAToken))
      .send({ expectedStatus: 'Queueing', status: 'In Progress' });
    expect(wrongStaff.status).toBe(404);

    const start = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Queueing', status: 'In Progress' });
    expect(start.status).toBe(200);
    expect(start.body.job.status).toBe('In Progress');
    expect(start.body.job.productionStartedAt).toBeTruthy();
    expect(start.body.job.productionStartedBy).toBe('staff-a');
    expect(start.body.order.status).toBe('Processing');
    expect((await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Queueing', status: 'In Progress' })).status).toBe(409);

    const complete = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'In Progress', status: 'Completed' });
    expect(complete.status).toBe(200);
    expect(complete.body.job.productionCompletedAt).toBeTruthy();
    expect(complete.body.order.status).toBe('Processing');

    const ready = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Completed', status: 'Ready for Pickup' });
    expect(ready.status).toBe(200);
    expect(ready.body.job.readyForPickupAt).toBeTruthy();
    expect(ready.body.job.readyForPickupBy).toBe('staff-a');
    expect(ready.body.order.status).toBe('Ready for Pickup');

    const stock = await Inventory.findOne({ material: 'Polo shirt blank' });
    expect(stock.quantity).toBe(30);
    expect(stock.reservedQuantity).toBe(10);
    const storedJob = await Production.findOne({ jobOrderId: 'JO-0001' });
    expect(storedJob.dateAssigned).toEqual(new Date('2026-10-01T10:00:00.000Z'));
    expect(storedJob.productionHistory.map(entry => entry.status)).toEqual(['In Progress', 'Completed', 'Ready for Pickup']);
  });

  it('exposes actual production progress only with the authenticated customer-owned order', async () => {
    const started = await request(app).patch('/api/job-orders/JO-0001/status').set(headers(staffAToken))
      .send({ expectedStatus: 'Queueing', status: 'In Progress' });
    expect(started.status).toBe(200);
    const ownOrder = await request(app).get('/api/customers/orders/ORD-JOB-A').set(headers(customerToken));
    expect(ownOrder.status).toBe(200);
    expect(ownOrder.body.order.production.status).toBe('In Progress');
    expect(ownOrder.body.order.production.productionStartedAt).toBeTruthy();
    expect((await request(app).get('/api/customers/orders/ORD-JOB-B').set(headers(customerToken))).status).toBe(404);
  });
});
