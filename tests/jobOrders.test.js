import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuditLog, Employee, Notification, Order, Production, Inventory, User } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import orderRoutes from '../server/routes/orders.js';
import phase3Routes from '../server/routes/jobOrders.js';
import { verifyAssignableStaff } from '../server/staffDirectory.js';

jest.mock('../server/utils.js', () => ({
  safeText: value => typeof value === 'string' ? value : '',
  serializeOrder: order => typeof order.serialize === 'function' ? order.serialize() : ({ ...order, id: order.orderId, total: order.totalAmount, customer: order.customerName, product: order.items?.[0]?.productName, quantity: order.items?.[0]?.quantity }),
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
let mongoServer;
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

async function seedJob({ orderId, jobOrderId, assignedEmployee, status = 'Assigned' }) {
  await Order.create({
    orderId,
    jobOrderId,
    customerId: assignedEmployee === 'staff-a' ? 'customer-a' : 'customer-b',
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
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
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
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
  await Inventory.create({ _id: '000000000000000000000001', material: 'Polo shirt blank', type: 'T-shirts', quantity: 30, reservedQuantity: 10, unit: 'pcs' });
  await seedJob({ orderId: 'ORD-JOB-A', jobOrderId: 'JO-0001', assignedEmployee: 'staff-a' });
  await seedJob({ orderId: 'ORD-JOB-B', jobOrderId: 'JO-0002', assignedEmployee: 'staff-b' });
  anotherJobId = 'JO-0002';
  verifyAssignableStaff.mockResolvedValue({ id: 'staff-a', name: 'Staff A', email: 'staff-a@example.com' });
  await User.create({ id: 'admin-a', name: 'Admin A', email: 'admin@example.com', role: 'admin' });
});

describe('Phase 4 job order production workflow', () => {
  it('lists a verified unassigned order and assigns it without materials or a replica set', async () => {
    await Employee.create({ name: 'Bobby Abar Marces', email: 'staff-a@example.com', position: 'Manager', active: true, supabaseUserId: 'staff-a', permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: 'admin-a' });
    await Order.create({ orderId: 'ORD-ELIGIBLE', customerId: 'customer-a', customerName: 'Customer A', customerEmail: 'customer@example.com', items: [{ productId: 1, productName: 'Print', quantity: 2, unitPrice: 100, subtotal: 200 }], totalAmount: 200, paymentStatus: 'Verified', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 200, referenceNumber: 'REF-1', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', status: 'Verified', verifiedAt: new Date(), verifiedBy: 'admin-a' }], status: 'Confirmed' });
    const queue = await request(app).get('/api/job-orders/eligible').set(headers(adminToken));
    expect(queue.status).toBe(200);
    expect(queue.body.orders.map(order => order.id)).toContain('ORD-ELIGIBLE');
    const assigned = await request(app).post('/api/job-orders').set(headers(adminToken)).send({ orderId: 'ORD-ELIGIBLE', assignedEmployeeId: 'staff-a', jobInstructions: 'Follow the approved design.', priority: 'high' });
    expect(assigned.status).toBe(201);
    expect(assigned.body.job.status).toBe('Assigned');
    expect(assigned.body.job.assignedEmployeeName).toBe('Bobby Abar Marces');
    expect(await Notification.countDocuments({ recipientId: 'staff-a', type: 'job_assigned' })).toBe(1);
    expect(assigned.body.job.reservedMaterials).toEqual([]);
    expect((await request(app).post('/api/job-orders').set(headers(adminToken)).send({ orderId: 'ORD-ELIGIBLE', assignedEmployeeId: 'staff-a' })).status).toBe(409);
  });

  it('does not list or assign an order whose verified payment mismatches its stored total', async () => {
    await Employee.create({ name: 'Bobby Abar Marces', email: 'staff-a@example.com', position: 'Manager', active: true, supabaseUserId: 'staff-a', permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: 'admin-a' });
    await Order.create({ orderId: 'ORD-UNDERPAID', customerId: 'customer-a', customerName: 'Customer A', customerEmail: 'customer@example.com', items: [{ productId: 1, productName: 'Print', quantity: 2, unitPrice: 100, subtotal: 200 }], totalAmount: 200, paymentStatus: 'Verified', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 1, referenceNumber: 'REF-BAD', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', status: 'Verified', verifiedAt: new Date(), verifiedBy: 'admin-a' }], status: 'Confirmed' });
    const queue = await request(app).get('/api/job-orders/eligible').set(headers(adminToken));
    expect(queue.status).toBe(200);
    expect(queue.body.orders.map(order => order.id)).not.toContain('ORD-UNDERPAID');
    const assigned = await request(app).post('/api/job-orders').set(headers(adminToken)).send({ orderId: 'ORD-UNDERPAID', assignedEmployeeId: 'staff-a' });
    expect(assigned.status).toBe(409);
    expect(await Production.exists({ orderId: 'ORD-UNDERPAID' })).toBeNull();
    expect((await Order.findOne({ orderId: 'ORD-UNDERPAID' })).jobOrderId).toBeUndefined();
  });

  it('lists only assigned jobs to staff and denies access to another employee job', async () => {
    const ownJobs = await request(app).get('/api/job-orders').set(headers(staffAToken));
    expect(ownJobs.status).toBe(200);
    expect(ownJobs.body.jobs.map(job => job.jobOrderId)).toEqual(['JO-0001']);
    expect((await request(app).get(`/api/job-orders/${anotherJobId}`).set(headers(staffAToken))).status).toBe(404);
    expect((await request(app).get('/api/job-orders').set(headers(customerToken))).status).toBe(403);
    const adminJobs = await request(app).get('/api/job-orders').set(headers(adminToken));
    expect(adminJobs.body.jobs).toHaveLength(2);
  });

  it('enforces staff submission and admin review before pickup readiness', async () => {
    const route = `/api/job-orders/JO-0001/status`;
    const skip = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Assigned', status: 'Submitted for Review' });
    expect(skip.status).toBe(400);
    const wrongStaff = await request(app).patch(`/api/job-orders/${anotherJobId}/status`).set(headers(staffAToken))
      .send({ expectedStatus: 'Assigned', status: 'Acknowledged' });
    expect(wrongStaff.status).toBe(409);

    const acknowledge = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Assigned', status: 'Acknowledged' });
    expect(acknowledge.status).toBe(200);
    const start = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Acknowledged', status: 'In Progress' });
    expect(start.status).toBe(200);
    expect(start.body.job.status).toBe('In Progress');
    expect(start.body.job.productionStartedAt).toBeTruthy();
    expect(start.body.job.productionStartedBy).toBe('staff-a');
    expect(start.body.job.order.status).toBe('Processing');
    expect((await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Acknowledged', status: 'In Progress' })).status).toBe(409);

    const complete = await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'In Progress', status: 'Submitted for Review' });
    expect(complete.status).toBe(200);
    expect(complete.body.job.productionCompletedAt).toBeTruthy();
    expect(complete.body.job.order.status).toBe('Processing');
    expect(await Notification.countDocuments({ recipientId: 'admin-a', type: 'job_review_required' })).toBe(1);

    expect((await request(app).post('/api/job-orders/JO-0001/ready-for-pickup').set(headers(adminToken))).status).toBe(409);
    const returned = await request(app).post('/api/job-orders/JO-0001/review').set(headers(adminToken)).send({ action: 'return', notes: 'Align the back print.' });
    expect(returned.status).toBe(200);
    expect(await Notification.countDocuments({ recipientId: 'staff-a', type: 'job_correction_required' })).toBe(1);
    expect(await Notification.countDocuments({ recipientId: 'staff-b', type: 'job_correction_required' })).toBe(0);
    expect((await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'Correction Required', status: 'In Progress' })).status).toBe(200);
    expect((await request(app).patch(route).set(headers(staffAToken)).send({ expectedStatus: 'In Progress', status: 'Submitted for Review' })).status).toBe(200);
    const approved = await request(app).post('/api/job-orders/JO-0001/review').set(headers(adminToken)).send({ action: 'approve' });
    expect(approved.status).toBe(200);
    const ready = await request(app).post('/api/job-orders/JO-0001/ready-for-pickup').set(headers(adminToken));
    expect(ready.status).toBe(200);
    expect(ready.body.job.readyForPickupAt).toBeTruthy();
    expect(ready.body.job.readyForPickupBy).toBe('admin-a');
    expect(await Notification.countDocuments({ recipientId: 'customer-a', type: 'ready_for_pickup' })).toBe(1);
    expect(ready.body.order.status).toBe('Ready for Pickup');

    const stock = await Inventory.findOne({ material: 'Polo shirt blank' });
    expect(stock.quantity).toBe(30);
    expect(stock.reservedQuantity).toBe(10);
    const storedJob = await Production.findOne({ jobOrderId: 'JO-0001' });
    expect(storedJob.dateAssigned).toEqual(new Date('2026-10-01T10:00:00.000Z'));
    expect(storedJob.productionHistory.map(entry => entry.status)).toEqual(['Acknowledged', 'In Progress', 'Submitted for Review', 'Correction Required', 'In Progress', 'Submitted for Review', 'Approved', 'Ready for Pickup']);
  });

  it('exposes actual production progress only with the authenticated customer-owned order', async () => {
    const started = await request(app).patch('/api/job-orders/JO-0001/status').set(headers(staffAToken))
      .send({ expectedStatus: 'Assigned', status: 'Acknowledged' });
    expect(started.status).toBe(200);
    const inProgress = await request(app).patch('/api/job-orders/JO-0001/status').set(headers(staffAToken))
      .send({ expectedStatus: 'Acknowledged', status: 'In Progress' });
    expect(inProgress.status).toBe(200);
    const ownOrder = await request(app).get('/api/customers/orders/ORD-JOB-A').set(headers(customerToken));
    expect(ownOrder.status).toBe(200);
    expect(ownOrder.body.order.production.status).toBe('In Progress');
    expect(ownOrder.body.order.production.productionStartedAt).toBeTruthy();
    expect(ownOrder.body.order.production.productionHistory.map(event => event.status)).toEqual(['Acknowledged', 'In Progress']);
    expect((await request(app).get('/api/customers/orders/ORD-JOB-B').set(headers(customerToken))).status).toBe(404);
  });

  it('confirms pickup once for a material-free approved job and rejects unverified payment', async () => {
    await Order.create({ orderId: 'ORD-PICKUP', jobOrderId: 'JO-PICKUP', customerId: 'customer-a', customerName: 'Customer A', customerEmail: 'customer@example.com', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, paymentStatus: 'Verified', status: 'Ready for Pickup' });
    await Production.create({ phase3: true, jobOrderId: 'JO-PICKUP', orderId: 'ORD-PICKUP', assignedEmployee: 'staff-a', assignedEmployeeName: 'Staff A', assignedBy: 'admin-a', status: 'Ready for Pickup', reservedMaterials: [] });
    const readyList = await request(app).get('/api/pickup/orders').set(headers(adminToken));
    expect(readyList.status).toBe(200);
    expect(readyList.body.orders.map(order => order.id)).toContain('ORD-PICKUP');
    const missingReceiver = await request(app).post('/api/orders/ORD-PICKUP/confirm-pickup').set(headers(adminToken)).send({});
    expect(missingReceiver.status).toBe(400);
    expect(missingReceiver.body.error).toMatch(/received by name is required/i);
    expect((await Order.findOne({ orderId: 'ORD-PICKUP' }).lean()).status).toBe('Ready for Pickup');

    const pickup = await request(app).post('/api/orders/ORD-PICKUP/confirm-pickup').set(headers(adminToken)).send({ receivedByName: '  Customer A  ' });
    expect(pickup.status).toBe(200);
    expect(pickup.body.order.status).toBe('Picked Up');
    expect(pickup.body.receivedByName).toBe('Customer A');
    expect(pickup.body.movements).toEqual([]);
    expect(await Notification.countDocuments({ recipientId: 'customer-a', type: 'order_picked_up' })).toBe(1);
    expect(await AuditLog.countDocuments({ action: 'CONFIRM_PICKUP', resourceId: 'ORD-PICKUP', userId: 'admin-a' })).toBe(1);
    expect((await request(app).post('/api/orders/ORD-PICKUP/confirm-pickup').set(headers(adminToken)).send({ receivedByName: 'Customer A' })).status).toBe(409);

    await Order.updateOne({ orderId: 'ORD-JOB-A' }, { $set: { status: 'Ready for Pickup', paymentStatus: 'For Verification' } });
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'Ready for Pickup' } });
    const unverified = await request(app).post('/api/orders/ORD-JOB-A/confirm-pickup').set(headers(adminToken));
    expect(unverified.status).toBe(409);
    expect(unverified.body.error).toMatch(/payment is verified/i);
  });
});
