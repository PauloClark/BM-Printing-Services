import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuditLog, Employee, Notification, Order, Production, Inventory, StockMovement, User } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import orderRoutes from '../server/routes/orders.js';
import phase3Routes from '../server/routes/jobOrders.js';
import legacyStaffAccessRoutes from '../server/routes/legacyStaffAccess.js';
import { serializeOrder } from '../server/utils.js';
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
  verifyAssignableStaff: jest.fn(),
  listNotificationAdmins: jest.fn().mockResolvedValue([{ id: 'admin-a', role: 'admin' }]),
  isAuthorizedNotificationRecipient: jest.fn().mockResolvedValue(true)
}));

let app;
let mongoServer;
let originalFetch;
let oldUrl;
let oldKey;
let customerToken;
let staffAToken;
let staffBToken;
let staffCToken;
let adminToken;
let anotherJobId;

const staffCId = 'c1234567-1234-4234-8234-123456789abc';
const users = {
  staffC: { id: staffCId, email: 'staff-c@example.com', app_metadata: { role: 'staff' } },
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
  legacyStaffAccessRoutes(app, serializeOrder);
  customerToken = 'customer';
  staffAToken = 'staffA';
  staffBToken = 'staffB';
  staffCToken = 'staffC';
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
  await Employee.create([
    { name: 'Staff A', email: 'staff-a@example.com', position: 'Manager', active: true, supabaseUserId: 'staff-a', permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: 'admin-a' },
    { name: 'Staff B', email: 'staff-b@example.com', position: 'Production Staff', active: true, supabaseUserId: 'staff-b', permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: 'admin-a' },
    { name: 'Staff C', email: 'staff-c@example.com', position: 'Production Staff', active: true, supabaseUserId: staffCId, permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: 'admin-a' }
  ]);
  await Inventory.create({ _id: '000000000000000000000001', material: 'Polo shirt blank', type: 'T-shirts', quantity: 30, reservedQuantity: 10, unit: 'pcs' });
  await seedJob({ orderId: 'ORD-JOB-A', jobOrderId: 'JO-0001', assignedEmployee: 'staff-a' });
  await seedJob({ orderId: 'ORD-JOB-B', jobOrderId: 'JO-0002', assignedEmployee: 'staff-b' });
  anotherJobId = 'JO-0002';
  verifyAssignableStaff.mockImplementation(async id => ({ id, name: id === staffCId ? 'Staff C' : id === 'staff-b' ? 'Staff B' : 'Staff A', email: id === staffCId ? 'staff-c@example.com' : id === 'staff-b' ? 'staff-b@example.com' : 'staff-a@example.com' }));
  await User.create({ id: 'admin-a', name: 'Admin A', email: 'admin@example.com', role: 'admin' });
});

describe('Phase 4 job order production workflow', () => {
  it('allows the assigned Staff member to report one blocking exception and lets Admin resolve it safely', async () => {
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'In Progress', materialPlanVersion: 1, materialPlanMode: 'MATERIALS', materialOperationState: 'RESERVED' } });
    const beforeJob = await Production.findOne({ jobOrderId: 'JO-0001' }).lean();
    const beforeStock = await Inventory.findById('000000000000000000000001').lean();
    const body = { type: 'BLOCKED', reason: 'Printer requires technician repair', notes: 'Do not use until checked.', requestId: '82345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 0 };
    expect((await request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(customerToken)).send(body)).status).toBe(403);
    expect((await request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(staffBToken)).send(body)).status).toBe(404);
    expect((await request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(staffAToken)).send({ ...body, reason: '' })).status).toBe(400);
    expect((await request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(staffAToken)).send({ ...body, type: 'OTHER' })).status).toBe(400);
    const report = await request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(staffAToken)).send(body);
    expect(report.status).toBe(201);
    expect(report.body.job.status).toBe('In Progress');
    expect(report.body.job.exceptionHistory[0]).toMatchObject({ type: 'BLOCKED', reason: body.reason, reportedBy: 'staff-a', resolutionStatus: 'ACTIVE' });
    expect(report.body.notifications).toHaveLength(1);
    expect(report.body.notifications[0]).toMatchObject({ recipientId: 'admin-a', recipientRole: 'admin', state: 'DELIVERED' });
    const duplicate = await request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(staffAToken)).send(body);
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect((await request(app).patch('/api/job-orders/JO-0001/status').set(headers(staffAToken)).send({ expectedStatus: 'In Progress', status: 'Submitted for Review' })).status).toBe(409);
    expect((await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send({ newAssignedEmployeeId: staffCId, reason: 'Coverage change', requestId: '92345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 0 })).status).toBe(409);
    const activeJob = await Production.findOne({ jobOrderId: 'JO-0001' }).lean();
    expect(activeJob.reservedMaterials).toEqual(beforeJob.reservedMaterials);
    expect(activeJob.materialUsage).toEqual(beforeJob.materialUsage);
    expect((await Inventory.findById('000000000000000000000001').lean()).quantity).toBe(beforeStock.quantity);
    expect((await Inventory.findById('000000000000000000000001').lean()).reservedQuantity).toBe(beforeStock.reservedQuantity);

    const id = report.body.exception.exceptionId;
    expect((await request(app).patch(`/api/job-orders/JO-0001/exceptions/${id}/resolve`).set(headers(staffAToken)).send({ action: 'RESUME', notes: 'Fixed' })).status).toBe(403);
    const resolved = await request(app).patch(`/api/job-orders/JO-0001/exceptions/${id}/resolve`).set(headers(adminToken)).send({ action: 'RESUME', notes: 'Technician repaired the printer.', expectedAssignmentVersion: 0, expectedStatus: 'In Progress' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.job.status).toBe('In Progress');
    expect(resolved.body.exception).toMatchObject({ resolutionStatus: 'RESOLVED', resolvedBy: 'admin-a', resolutionAction: 'RESUME', resolvedToStatus: 'In Progress' });
    expect(resolved.body.notifications).toEqual(expect.arrayContaining([
      expect.objectContaining({ recipientId: 'admin-a', recipientRole: 'admin', state: 'DELIVERED' }),
      expect.objectContaining({ recipientId: 'staff-a', recipientRole: 'staff', state: 'DELIVERED' })
    ]));
    expect((await request(app).patch(`/api/job-orders/JO-0001/exceptions/${id}/resolve`).set(headers(adminToken)).send({ action: 'RESUME', notes: 'Duplicate', expectedAssignmentVersion: 0, expectedStatus: 'In Progress' })).status).toBe(409);
  });

  it('uses a single-document compare-and-set to reject concurrent active exception reports', async () => {
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'In Progress' } });
    const reports = await Promise.all(['a2345678-1234-4234-8234-123456789abc', 'b2345678-1234-4234-8234-123456789abc'].map(requestId =>
      request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(staffAToken)).send({ type: 'DELAYED', reason: 'Material delivery is late', requestId, expectedAssignmentVersion: 0 })
    ));
    expect(reports.map(result => result.status).sort()).toEqual([201, 409]);
    expect(await Production.countDocuments({ jobOrderId: 'JO-0001', 'exceptionHistory.resolutionStatus': 'ACTIVE' })).toBe(1);
  });

  it('serializes a reassignment race against an exception report on the same job document', async () => {
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'In Progress' } });
    const [reported, reassigned] = await Promise.all([
      request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(staffAToken)).send({ type: 'PAUSED', reason: 'Operator needs safety review', requestId: 'f2345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 0 }),
      request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send({ newAssignedEmployeeId: staffCId, reason: 'Coverage change', requestId: 'a3345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 0 })
    ]);
    expect([reported.status, reassigned.status].filter(status => status === 201 || status === 200)).toHaveLength(1);
    const current = await Production.findOne({ jobOrderId: 'JO-0001' }).lean();
    if (current.assignedEmployee === staffCId) {
      expect(current.exceptionHistory || []).toHaveLength(0);
      expect([404, 409]).toContain(reported.status);
      expect(reassigned.status).toBe(200);
    } else {
      expect(current.assignedEmployee).toBe('staff-a');
      expect(current.exceptionHistory.filter(item => item.resolutionStatus === 'ACTIVE')).toHaveLength(1);
      expect(reassigned.status).toBe(409);
    }
  });

  it('blocks approval, ready status, and pickup while an exception is active and requires correction after failure', async () => {
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'Submitted for Review' } });
    const report = await request(app).post('/api/job-orders/JO-0001/exceptions').set(headers(adminToken)).send({ type: 'FAILED', reason: 'Output failed quality inspection', requestId: 'c2345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 0 });
    expect(report.status).toBe(201);
    expect((await request(app).post('/api/job-orders/JO-0001/review').set(headers(adminToken)).send({ action: 'approve' })).status).toBe(409);
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'Approved' } });
    expect((await request(app).post('/api/job-orders/JO-0001/ready-for-pickup').set(headers(adminToken))).status).toBe(409);
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'Ready for Pickup' } });
    await Order.updateOne({ orderId: 'ORD-JOB-A' }, { $set: { status: 'Ready for Pickup' } });
    expect((await request(app).post('/api/orders/ORD-JOB-A/confirm-pickup').set(headers(adminToken)).send({ receivedByName: 'Customer A' })).status).toBe(409);
    const id = report.body.exception.exceptionId;
    const unsafe = await request(app).patch(`/api/job-orders/JO-0001/exceptions/${id}/resolve`).set(headers(adminToken)).send({ action: 'RESUME', notes: 'Done', expectedAssignmentVersion: 0, expectedStatus: 'Ready for Pickup' });
    expect(unsafe.status).toBe(409);
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'Submitted for Review' } });
    const resolved = await request(app).patch(`/api/job-orders/JO-0001/exceptions/${id}/resolve`).set(headers(adminToken)).send({ action: 'RETURN_FOR_CORRECTION', notes: 'Reprint and check alignment.', expectedAssignmentVersion: 0, expectedStatus: 'Submitted for Review' });
    expect(resolved.status).toBe(200);
    expect(resolved.body.job.status).toBe('Correction Required');
    expect(resolved.body.exception.resolutionAction).toBe('RETURN_FOR_CORRECTION');
  });

  it('allows only Admin to atomically reassign an active job and makes retries idempotent', async () => {
    const requestId = '12345678-1234-4234-8234-123456789abc';
    const staffAttempt = await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(staffAToken))
      .send({ newAssignedEmployeeId: staffCId, reason: 'Shift coverage changed', requestId, expectedAssignmentVersion: 0 });
    expect(staffAttempt.status).toBe(403);
    const before = await Production.findOne({ jobOrderId: 'JO-0001' }).lean();
    const stockBefore = await Inventory.findOne({ material: 'Polo shirt blank' }).lean();
    const reassigned = await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken))
      .send({ newAssignedEmployeeId: staffCId, reason: 'Shift coverage changed', requestId, expectedAssignmentVersion: 0 });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.job.assignedEmployee).toBe(staffCId);
    expect(reassigned.body.job.assignmentVersion).toBe(1);
    expect(reassigned.body.job.jobOrderId).toBe('JO-0001');
    expect(reassigned.body.job.orderId).toBe(before.orderId);
    expect(reassigned.body.job.assignmentHistory).toHaveLength(1);
    expect(reassigned.body.job.assignmentHistory[0]).toMatchObject({ previousAssignedEmployee: 'staff-a', newAssignedEmployee: staffCId, reason: 'Shift coverage changed', actorId: 'admin-a' });
    expect(reassigned.body.notifications).toHaveLength(2);
    expect(reassigned.body.notifications.every(item => item.state === 'DELIVERED')).toBe(true);
    const after = await Production.findOne({ jobOrderId: 'JO-0001' }).lean();
    expect(after.reservedMaterials).toEqual(before.reservedMaterials);
    expect((await Inventory.findOne({ material: 'Polo shirt blank' }).lean()).quantity).toBe(stockBefore.quantity);
    expect(await Production.countDocuments({ jobOrderId: 'JO-0001' })).toBe(1);
    expect((await request(app).get('/api/job-orders/JO-0001').set(headers(staffAToken))).status).toBe(404);
    expect((await request(app).get('/api/files/ORD-JOB-A').set(headers(staffAToken))).status).toBe(404);
    expect((await request(app).get('/api/job-orders/JO-0001').set(headers(staffCToken))).status).toBe(200);
    expect((await request(app).get('/api/files/ORD-JOB-A').set(headers(staffCToken))).status).toBe(200);
    expect((await request(app).get('/api/files/ORD-JOB-A').set(headers(adminToken))).status).toBe(200);

    const duplicate = await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken))
      .send({ newAssignedEmployeeId: staffCId, reason: 'Shift coverage changed', requestId, expectedAssignmentVersion: 0 });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect((await Production.findOne({ jobOrderId: 'JO-0001' })).assignmentVersion).toBe(1);
    expect(await Notification.countDocuments({ type: { $in: ['job_reassigned_from', 'job_reassigned_to'] } })).toBe(2);
  });

  it('rejects stale versions, ineligible replacements, and jobs in protected workflow states', async () => {
    const base = { newAssignedEmployeeId: staffCId, reason: 'Coverage change', requestId: '22345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 99 };
    expect((await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send(base)).status).toBe(409);
    await Employee.updateOne({ supabaseUserId: staffCId }, { $set: { active: false } });
    expect((await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send({ ...base, expectedAssignmentVersion: 0, requestId: '32345678-1234-4234-8234-123456789abc' })).status).toBe(400);
    await Employee.updateOne({ supabaseUserId: staffCId }, { $set: { active: true, permissions: [] } });
    expect((await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send({ ...base, expectedAssignmentVersion: 0, requestId: '42345678-1234-4234-8234-123456789abc' })).status).toBe(400);
    await Employee.updateOne({ supabaseUserId: staffCId }, { $unset: { permissions: 1 } });
    expect((await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send({ ...base, expectedAssignmentVersion: 0, requestId: '72345678-1234-4234-8234-123456789abc' })).status).toBe(400);
    await Employee.updateOne({ supabaseUserId: staffCId }, { $set: { permissions: ['view_assigned_jobs', 'update_job_progress'] } });
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'Submitted for Review' } });
    expect((await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send({ ...base, expectedAssignmentVersion: 0, requestId: '52345678-1234-4234-8234-123456789abc' })).status).toBe(409);
  });

  it('preserves prior material usage and requires the replacement Staff member to review it', async () => {
    const submittedAt = new Date('2026-10-02T09:00:00.000Z');
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: {
      materialPlanVersion: 1, materialPlanMode: 'MATERIALS', materialOperationState: 'RESERVED', status: 'In Progress',
      reservedMaterials: [{ inventoryId: '000000000000000000000001', reservationId: 'reservation-1', operationId: 'op-1', material: 'Polo shirt blank', unit: 'pcs', quantity: 10, reservationStatus: 'reserved' }],
      materialUsage: [{ reservationId: 'reservation-1', usedQuantity: 8, wastedQuantity: 0, unusedQuantity: 2, wasteReason: '', notes: 'First pass' }],
      materialUsageSubmittedAt: submittedAt, materialUsageSubmittedBy: 'staff-a'
    } });
    const reassigned = await request(app).post('/api/job-orders/JO-0001/reassign').set(headers(adminToken)).send({
      newAssignedEmployeeId: staffCId, reason: 'Original operator unavailable', requestId: '62345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 0
    });
    expect(reassigned.status).toBe(200);
    expect(reassigned.body.job.materialUsageReviewRequired).toBe(true);
    expect(reassigned.body.job.materialUsage).toEqual([{ reservationId: 'reservation-1', usedQuantity: 8, wastedQuantity: 0, unusedQuantity: 2, wasteReason: '', notes: 'First pass' }]);
    expect(reassigned.body.job.assignmentHistory[0]).toMatchObject({ materialUsageSubmittedBy: 'staff-a', materialUsageSubmittedAt: submittedAt.toISOString() });
    await Production.updateOne({ jobOrderId: 'JO-0001' }, { $set: { status: 'In Progress' } });
    const usage = [{ reservationId: 'reservation-1', usedQuantity: 7, wastedQuantity: 1, unusedQuantity: 2, wasteReason: 'Damaged during setup', notes: 'Reviewed earlier log' }];
    const withoutReview = await request(app).put('/api/job-orders/JO-0001/material-usage').set(headers(staffCToken)).send({ materials: usage });
    expect(withoutReview.status).toBe(409);
    const reviewed = await request(app).put('/api/job-orders/JO-0001/material-usage').set(headers(staffCToken)).send({ materials: usage, reviewPreviousUsage: true });
    expect(reviewed.status).toBe(200);
    expect(reviewed.body.job.materialUsageReviewRequired).toBe(false);
    expect(reviewed.body.job.materialUsageReviewedBy).toBe(staffCId);
    expect(reviewed.body.job.materialUsageSubmittedBy).toBe(staffCId);
  });

  it('lists a verified unassigned order and assigns it without materials or a replica set', async () => {
    await Order.create({ orderId: 'ORD-ELIGIBLE', customerId: 'customer-a', customerName: 'Customer A', customerEmail: 'customer@example.com', items: [{ productId: 1, productName: 'Print', quantity: 2, unitPrice: 100, subtotal: 200 }], totalAmount: 200, paymentStatus: 'Verified', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 200, referenceNumber: 'REF-1', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', status: 'Verified', verifiedAt: new Date(), verifiedBy: 'admin-a' }], status: 'Confirmed' });
    const queue = await request(app).get('/api/job-orders/eligible').set(headers(adminToken));
    expect(queue.status).toBe(200);
    expect(queue.body.orders.map(order => order.id)).toContain('ORD-ELIGIBLE');
    const assigned = await request(app).post('/api/job-orders').set(headers(adminToken)).send({ assignmentRequestId: 'abcdef01-2345-6789-abcd-ef0123456789', orderId: 'ORD-ELIGIBLE', assignedEmployeeId: 'staff-a', jobInstructions: 'Follow the approved design.', priority: 'high', noManagedMaterials: true, noMaterialsReason: 'Service-only work' });
    expect(assigned.status).toBe(201);
    expect(assigned.body.job.status).toBe('Assigned');
    expect(assigned.body.job.assignedEmployeeName).toBe('Staff A');
    expect(await Notification.countDocuments({ recipientId: 'staff-a', type: 'job_assigned' })).toBe(1);
    expect(assigned.body.job.reservedMaterials).toEqual([]);
    expect(assigned.body.job.materialOperationState).toBe('NOT_REQUIRED');
    expect((await request(app).post('/api/job-orders').set(headers(adminToken)).send({ assignmentRequestId: 'abcdef01-2345-6789-abcd-ef0123456790', orderId: 'ORD-ELIGIBLE', assignedEmployeeId: 'staff-a', noManagedMaterials: true, noMaterialsReason: 'Service-only work' })).status).toBe(409);
  });

  it('does not list or assign an order whose verified payment mismatches its stored total', async () => {
    await Order.create({ orderId: 'ORD-UNDERPAID', customerId: 'customer-a', customerName: 'Customer A', customerEmail: 'customer@example.com', items: [{ productId: 1, productName: 'Print', quantity: 2, unitPrice: 100, subtotal: 200 }], totalAmount: 200, paymentStatus: 'Verified', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 1, referenceNumber: 'REF-BAD', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', status: 'Verified', verifiedAt: new Date(), verifiedBy: 'admin-a' }], status: 'Confirmed' });
    const queue = await request(app).get('/api/job-orders/eligible').set(headers(adminToken));
    expect(queue.status).toBe(200);
    expect(queue.body.orders.map(order => order.id)).not.toContain('ORD-UNDERPAID');
    const assigned = await request(app).post('/api/job-orders').set(headers(adminToken)).send({ assignmentRequestId: 'abcdef01-2345-6789-abcd-ef0123456791', orderId: 'ORD-UNDERPAID', assignedEmployeeId: 'staff-a', noManagedMaterials: true, noMaterialsReason: 'Service-only work' });
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

  it('reserves manually selected stock atomically and rejects an insufficient assignment without leaving a hold', async () => {
    const paper = await Inventory.create({ material: 'Phase 3 Paper', type: 'Paper', quantity: 10, reservedQuantity: 2, unit: 'sheet', costPerUnit: 2, costBasisKnown: true });
    await Order.create({ orderId: 'ORD-MATERIAL-1', customerId: 'customer-a', customerName: 'Customer A', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, paymentStatus: 'Verified', status: 'Confirmed', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 100, referenceNumber: 'REF-M1', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', message: 'Paid', status: 'Verified', verifiedBy: 'admin-a' }] });
    const assigned = await request(app).post('/api/job-orders').set(headers(adminToken)).send({
      assignmentRequestId: '12345678-1234-5678-1234-567812345678', orderId: 'ORD-MATERIAL-1', assignedEmployeeId: 'staff-a',
      materials: [{ inventoryId: String(paper._id), quantity: 5 }]
    });
    if (assigned.status !== 201) throw new Error(JSON.stringify(assigned.body));
    expect(assigned.body.job.materialOperationState).toBe('RESERVED');
    expect(assigned.body.job.reservedMaterials[0]).toMatchObject({ material: 'Phase 3 Paper', unit: 'sheet', quantity: 5, reservationStatus: 'reserved' });
    expect((await Inventory.findById(paper._id)).reservedQuantity).toBe(7);
    expect(await StockMovement.countDocuments({ jobOrderId: assigned.body.job.jobOrderId, movementType: 'RESERVE' })).toBe(1);
    const duplicate = await request(app).post('/api/job-orders').set(headers(adminToken)).send({
      assignmentRequestId: '12345678-1234-5678-1234-567812345678', orderId: 'ORD-MATERIAL-1', assignedEmployeeId: 'staff-a',
      materials: [{ inventoryId: String(paper._id), quantity: 5 }]
    });
    expect(duplicate.status).toBe(200);
    expect(duplicate.body.duplicate).toBe(true);
    expect((await Inventory.findById(paper._id)).reservedQuantity).toBe(7);

    await Order.create({ orderId: 'ORD-MATERIAL-2', customerId: 'customer-a', customerName: 'Customer A', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, paymentStatus: 'Verified', status: 'Confirmed', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 100, referenceNumber: 'REF-M2', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', message: 'Paid', status: 'Verified', verifiedBy: 'admin-a' }] });
    const shortage = await request(app).post('/api/job-orders').set(headers(adminToken)).send({
      assignmentRequestId: '12345678-1234-5678-1234-567812345679', orderId: 'ORD-MATERIAL-2', assignedEmployeeId: 'staff-a',
      materials: [{ inventoryId: String(paper._id), quantity: 4 }]
    });
    expect(shortage.status).toBe(409);
    expect((await Inventory.findById(paper._id)).reservedQuantity).toBe(7);
    expect((await Order.findOne({ orderId: 'ORD-MATERIAL-2' })).jobOrderId).toBeUndefined();
  });

  it('validates assigned-staff usage, finalizes use/waste/release once, and never deducts again at pickup', async () => {
    const paper = await Inventory.create({ material: 'Usage Paper', type: 'Paper', quantity: 10, reservedQuantity: 0, unit: 'sheet', costPerUnit: 2, costBasisKnown: true });
    await Order.create({ orderId: 'ORD-USAGE', customerId: 'customer-a', customerName: 'Customer A', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, paymentStatus: 'Verified', status: 'Confirmed', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 100, referenceNumber: 'REF-U1', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', message: 'Paid', status: 'Verified', verifiedBy: 'admin-a' }] });
    const created = await request(app).post('/api/job-orders').set(headers(adminToken)).send({
      assignmentRequestId: '22345678-1234-5678-1234-567812345678', orderId: 'ORD-USAGE', assignedEmployeeId: 'staff-a',
      materials: [{ inventoryId: String(paper._id), quantity: 5 }]
    }).expect(201);
    const id = created.body.job.jobOrderId, route = `/api/job-orders/${id}`;
    await request(app).patch(`${route}/status`).set(headers(staffAToken)).send({ expectedStatus: 'Assigned', status: 'Acknowledged' }).expect(200);
    await request(app).patch(`${route}/status`).set(headers(staffAToken)).send({ expectedStatus: 'Acknowledged', status: 'In Progress' }).expect(200);
    const material = created.body.job.reservedMaterials[0];
    const usage = { reservationId: material.reservationId, usedQuantity: 3, wastedQuantity: 1, unusedQuantity: 1, wasteReason: 'Damaged during trim' };
    expect((await request(app).put(`${route}/material-usage`).set(headers(staffBToken)).send({ materials: [usage] })).status).toBe(409);
    expect((await request(app).put(`${route}/material-usage`).set(headers(staffAToken)).send({ materials: [{ ...usage, wasteReason: '' }] })).status).toBe(400);
    expect((await request(app).put(`${route}/material-usage`).set(headers(staffAToken)).send({ materials: [{ ...usage, unusedQuantity: 0 }] })).status).toBe(400);
    await request(app).put(`${route}/material-usage`).set(headers(staffAToken)).send({ materials: [usage] }).expect(200);
    await request(app).patch(`${route}/status`).set(headers(staffAToken)).send({ expectedStatus: 'In Progress', status: 'Submitted for Review' }).expect(200);
    const movementFailure = jest.spyOn(StockMovement, 'findOneAndUpdate').mockRejectedValueOnce(new Error('temporary ledger write failure'));
    await request(app).post(`${route}/review`).set(headers(adminToken)).send({ action: 'approve' }).expect(503);
    movementFailure.mockRestore();
    expect((await Production.findOne({ jobOrderId: id })).materialOperationState).toBe('RECONCILIATION_REQUIRED');
    await request(app).post(`${route}/material-reconcile`).set(headers(adminToken)).expect(200);
    let stock = await Inventory.findById(paper._id);
    expect(stock.quantity).toBe(6);
    expect(stock.reservedQuantity).toBe(0);
    expect(stock.materialReservations[0]).toMatchObject({ status: 'FINALIZED', usedQuantity: 3, wastedQuantity: 1, releasedQuantity: 1, unitCostSnapshot: 2 });
    let job = await Production.findOne({ jobOrderId: id });
    expect(job.materialOperationState).toBe('FINALIZED');
    expect(job.reservedMaterials[0]).toMatchObject({ quantity: 4, reservationStatus: 'consumed', directCostCents: 800 });
    expect(await StockMovement.countDocuments({ jobOrderId: id, idempotencyKey: { $exists: true } })).toBe(4);
    expect((await request(app).post(`${route}/review`).set(headers(adminToken)).send({ action: 'approve' })).status).toBe(409);
    await request(app).post(`${route}/ready-for-pickup`).set(headers(adminToken)).expect(200);
    const beforePickup = (await Inventory.findById(paper._id)).quantity;
    await request(app).post('/api/orders/ORD-USAGE/confirm-pickup').set(headers(adminToken)).send({ receivedByName: 'Customer A' }).expect(200);
    stock = await Inventory.findById(paper._id);
    expect(stock.quantity).toBe(beforePickup);
    expect(await StockMovement.countDocuments({ jobOrderId: id, movementType: 'OUT', reason: 'ORDER_PICKUP' })).toBe(1);
  });

  it('prevents concurrent assignments from oversubscribing one material', async () => {
    const vinyl = await Inventory.create({ material: 'Concurrent Vinyl', type: 'Vinyl', quantity: 10, reservedQuantity: 0, unit: 'sqm', costPerUnit: 1, costBasisKnown: true });
    for (const orderId of ['ORD-CONCURRENT-A', 'ORD-CONCURRENT-B']) await Order.create({ orderId, customerId: 'customer-a', customerName: 'Customer A', items: [{ productId: 1, productName: 'Sign', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, paymentStatus: 'Verified', status: 'Confirmed', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 100, referenceNumber: orderId, receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', message: 'Paid', status: 'Verified', verifiedBy: 'admin-a' }] });
    const [a, b] = await Promise.all(['ORD-CONCURRENT-A', 'ORD-CONCURRENT-B'].map((orderId, index) => request(app).post('/api/job-orders').set(headers(adminToken)).send({
      assignmentRequestId: `32345678-1234-5678-1234-56781234567${index}`, orderId, assignedEmployeeId: 'staff-a', materials: [{ inventoryId: String(vinyl._id), quantity: 6 }]
    })));
    expect([a.status, b.status].filter(status => status === 201)).toHaveLength(1);
    expect([a.status, b.status].filter(status => status === 409)).toHaveLength(1);
    expect((await Inventory.findById(vinyl._id)).reservedQuantity).toBe(6);
  });

  it('compensates a partial multi-material reservation failure without leaving an assigned job', async () => {
    const first = await Inventory.create({ material: 'Available Paper', type: 'Paper', quantity: 10, reservedQuantity: 0, unit: 'sheet' });
    const second = await Inventory.create({ material: 'Short Ink', type: 'Ink', quantity: 1, reservedQuantity: 0, unit: 'ml' });
    await Order.create({ orderId: 'ORD-PARTIAL', customerId: 'customer-a', customerName: 'Customer A', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, paymentStatus: 'Verified', status: 'Confirmed', paymentSubmissions: [{ customerId: 'customer-a', paymentMethod: 'GCash', amount: 100, referenceNumber: 'REF-PARTIAL', receiptFileName: 'receipt.png', receiptFilePath: 'private/receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', message: 'Paid', status: 'Verified', verifiedBy: 'admin-a' }] });
    const response = await request(app).post('/api/job-orders').set(headers(adminToken)).send({
      assignmentRequestId: '42345678-1234-5678-1234-567812345678', orderId: 'ORD-PARTIAL', assignedEmployeeId: 'staff-a',
      materials: [{ inventoryId: String(first._id), quantity: 4 }, { inventoryId: String(second._id), quantity: 2 }]
    });
    expect(response.status).toBe(409);
    expect((await Inventory.findById(first._id)).reservedQuantity).toBe(0);
    expect((await Inventory.findById(second._id)).reservedQuantity).toBe(0);
    const order = await Order.findOne({ orderId: 'ORD-PARTIAL' });
    expect(order.jobOrderId).toBeUndefined();
    expect(await Production.exists({ orderId: 'ORD-PARTIAL', phase3: true })).toBeNull();
    expect(await StockMovement.countDocuments({ orderId: 'ORD-PARTIAL', movementType: 'RELEASE' })).toBe(1);
  });

  it('recovers a persisted reservation claim after interruption and keeps additional reservations Admin-only', async () => {
    const original = await Inventory.create({ material: 'Recovered Stock', type: 'Paper', quantity: 10, reservedQuantity: 4, unit: 'sheet', materialReservations: [{
      reservationId: 'JO-RECOVER:original', operationId: 'JO-RECOVER', jobOrderId: 'JO-RECOVER', orderId: 'ORD-RECOVER', quantity: 4,
      status: 'RESERVED', actorId: 'admin-a', movementKeys: ['JO-RECOVER:original:reserve']
    }] });
    const extra = await Inventory.create({ material: 'Extra Stock', type: 'Vinyl', quantity: 5, reservedQuantity: 0, unit: 'sqm' });
    await Order.create({ orderId: 'ORD-RECOVER', customerId: 'customer-a', customerName: 'Customer A', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }], totalAmount: 100, paymentStatus: 'Verified', status: 'Confirmed' });
    await Production.create({
      phase3: true, assignmentRequestId: '52345678-1234-5678-1234-567812345678', jobOrderId: 'JO-RECOVER', orderId: 'ORD-RECOVER',
      assignedEmployee: 'staff-a', assignedEmployeeName: 'Staff A', assignedBy: 'admin-a', status: 'Assigned', materialPlanVersion: 1,
      materialPlanMode: 'MATERIALS', materialOperationState: 'RESERVATION_PENDING', materialOperationKind: 'ASSIGNMENT', materialOperationId: 'JO-RECOVER',
      reservedMaterials: [{ inventoryId: original._id, reservationId: 'JO-RECOVER:original', operationId: 'JO-RECOVER', material: 'Recovered Stock', unit: 'sheet', quantity: 4, reservationStatus: 'pending' }]
    });
    const recovered = await request(app).post('/api/job-orders/JO-RECOVER/material-reconcile').set(headers(adminToken));
    expect(recovered.status).toBe(200);
    expect(recovered.body.job.materialOperationState).toBe('RESERVED');
    expect((await Order.findOne({ orderId: 'ORD-RECOVER' })).jobOrderId).toBe('JO-RECOVER');
    expect(await StockMovement.countDocuments({ jobOrderId: 'JO-RECOVER', movementType: 'RESERVE' })).toBe(1);
    expect((await request(app).post('/api/job-orders/JO-RECOVER/materials').set(headers(staffAToken)).send({ requestId: '62345678-1234-5678-1234-567812345678', materials: [{ inventoryId: String(extra._id), quantity: 2 }] })).status).toBe(403);
    const additional = await request(app).post('/api/job-orders/JO-RECOVER/materials').set(headers(adminToken)).send({ requestId: '62345678-1234-5678-1234-567812345678', materials: [{ inventoryId: String(extra._id), quantity: 2 }] });
    expect(additional.status).toBe(201);
    expect(additional.body.job.reservedMaterials).toHaveLength(2);
    expect((await Inventory.findById(extra._id)).reservedQuantity).toBe(2);
    expect((await request(app).post('/api/job-orders/JO-RECOVER/materials').set(headers(adminToken)).send({ requestId: '72345678-1234-5678-1234-567812345678', materials: [{ inventoryId: String(extra._id), quantity: 1 }] })).status).toBe(409);

    await Order.create({ orderId: 'ORD-NO-MAT-RECOVER', customerId: 'customer-a', customerName: 'Customer A', totalAmount: 100, paymentStatus: 'Verified', status: 'Confirmed' });
    await Production.create({ phase3: true, assignmentRequestId: '82345678-1234-5678-1234-567812345678', jobOrderId: 'JO-NO-MAT-RECOVER', orderId: 'ORD-NO-MAT-RECOVER', assignedEmployee: 'staff-a', assignedBy: 'admin-a', status: 'Assigned', materialPlanVersion: 1, materialPlanMode: 'NO_MANAGED_MATERIALS', noMaterialsReason: 'Service-only work', materialOperationState: 'PREPARING', materialOperationId: 'JO-NO-MAT-RECOVER', reservedMaterials: [] });
    const noMaterialRecovery = await request(app).post('/api/job-orders/JO-NO-MAT-RECOVER/material-reconcile').set(headers(adminToken));
    expect(noMaterialRecovery.status).toBe(200);
    expect(noMaterialRecovery.body.job.materialOperationState).toBe('NOT_REQUIRED');
  });
});
