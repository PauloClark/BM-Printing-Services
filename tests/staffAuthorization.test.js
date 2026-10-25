import request from 'supertest';
import express from 'express';
import { Employee, Order, OrderFile, Production } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import legacyStaffAccessRoutes from '../server/routes/legacyStaffAccess.js';
import orderFileRoutes from '../server/routes/orderFiles.js';
import orderRoutes from '../server/routes/orders.js';
import phase3Routes from '../server/routes/jobOrders.js';
import { serializeOrder } from '../server/utils.js';
import { clearTestDB, seedTestAdmin, setupTestDB, teardownTestDB } from './setup.js';

jest.mock('../server/utils.js', () => ({
  safeText: value => typeof value === 'string' ? value : '',
  serializeOrder: order => typeof order.serialize === 'function'
    ? order.serialize()
    : { ...order, id: order.orderId, orderId: order.orderId, customer: order.customerName, total: order.totalAmount },
  uploadDesignFile: jest.fn()
}));
jest.mock('../server/reportService.js', () => ({
  generateDailyReport: jest.fn().mockResolvedValue({}),
  getDefaultReportDate: jest.fn().mockReturnValue('2026-10-23')
}));
jest.mock('../server/staffDirectory.js', () => ({
  listAssignableStaff: jest.fn().mockResolvedValue([]),
  verifyAssignableStaff: jest.fn(),
  listNotificationAdmins: jest.fn().mockResolvedValue([{ id: 'admin-test-001', role: 'admin' }]),
  isAuthorizedNotificationRecipient: jest.fn().mockResolvedValue(true)
}));

let app;
let adminToken;
let originalFetch;
let originalSupabaseUrl;
let originalSupabaseKey;

const users = {
  staffA: { id: 'staff-a', email: 'staff-a@example.com', app_metadata: { role: 'staff' }, user_metadata: { full_name: 'Staff A' } },
  staffB: { id: 'staff-b', email: 'staff-b@example.com', app_metadata: { role: 'staff' }, user_metadata: { full_name: 'Staff B' } },
  inactive: { id: 'staff-inactive', email: 'inactive@example.com', app_metadata: { role: 'staff' } },
  unlinked: { id: 'staff-unlinked', email: 'unlinked@example.com', app_metadata: { role: 'staff' } },
  customerA: { id: 'customer-a', email: 'customer-a@example.com', app_metadata: { role: 'customer' } },
  customerB: { id: 'customer-b', email: 'customer-b@example.com', app_metadata: { role: 'customer' } }
};

const auth = token => ({ Authorization: `Bearer ${token}` });

async function createOrder(orderId, customerId, designFileName) {
  return Order.create({
    orderId,
    customerId,
    customerName: customerId === 'customer-a' ? 'Customer A' : 'Customer B',
    customerEmail: `${customerId}@example.com`,
    items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 100, subtotal: 100 }],
    totalAmount: 100,
    paymentStatus: 'Verified',
    status: 'Confirmed',
    designFileName,
    designOriginalName: designFileName,
    designFileType: 'image/png',
    designFileSize: 10,
    designFilePath: `/private/${designFileName}`
  });
}

async function createProduction(orderId, assignedEmployee, phase3 = false) {
  return Production.create({
    phase3: phase3 || undefined,
    ...(phase3 ? { jobOrderId: `JO-${orderId}` } : {}),
    orderId,
    assignedEmployee: assignedEmployee || '',
    assignedEmployeeName: assignedEmployee || '',
    assignedBy: 'admin-test-001',
    status: phase3 ? 'Assigned' : 'Queued'
  });
}

beforeAll(async () => {
  await setupTestDB();
  originalFetch = global.fetch;
  originalSupabaseUrl = process.env.SUPABASE_URL;
  originalSupabaseKey = process.env.SUPABASE_ANON_KEY;
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
  orderFileRoutes(app, process.cwd());
  legacyStaffAccessRoutes(app, serializeOrder);
});

afterAll(async () => {
  global.fetch = originalFetch;
  if (originalSupabaseUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalSupabaseUrl;
  if (originalSupabaseKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalSupabaseKey;
  await teardownTestDB();
});

beforeEach(async () => {
  await clearTestDB();
  adminToken = generateToken(await seedTestAdmin());
  await Employee.create([
    { name: 'Staff A', email: 'staff-a@example.com', active: true, supabaseUserId: 'staff-a', createdBy: 'admin-test-001' },
    { name: 'Staff B', email: 'staff-b@example.com', active: true, supabaseUserId: 'staff-b', createdBy: 'admin-test-001' },
    { name: 'Inactive Staff', email: 'inactive@example.com', active: false, supabaseUserId: 'staff-inactive', createdBy: 'admin-test-001' }
  ]);

  await Promise.all([
    createOrder('ORD-A-MODERN', 'customer-a', 'a-modern.png'),
    createOrder('ORD-B-MODERN', 'customer-b', 'b-modern.png'),
    createOrder('ORD-A-LEGACY', 'customer-a', 'a-legacy.png'),
    createOrder('ORD-B-LEGACY', 'customer-b', 'b-legacy.png'),
    createOrder('ORD-UNASSIGNED', 'customer-b', 'unassigned.png')
  ]);
  await Promise.all([
    createProduction('ORD-A-MODERN', 'staff-a', true),
    createProduction('ORD-B-MODERN', 'staff-b', true),
    createProduction('ORD-A-LEGACY', 'staff-a'),
    createProduction('ORD-B-LEGACY', 'staff-b'),
    createProduction('ORD-UNASSIGNED', '')
  ]);
  await OrderFile.create([
    { orderId: 'ORD-A-LEGACY', filename: 'a-proof.png', originalName: 'A Proof.png', fileType: 'PNG', storagePath: '/private/a-proof.png' },
    { orderId: 'ORD-B-LEGACY', filename: 'b-proof.png', originalName: 'B Proof.png', fileType: 'PNG', storagePath: '/private/b-proof.png' },
    { orderId: 'ORD-UNASSIGNED', filename: 'unassigned-proof.png', originalName: 'Unassigned Proof.png', fileType: 'PNG', storagePath: '/private/unassigned-proof.png' }
  ]);
});

describe('Staff production and file assignment authorization', () => {
  it('returns 401 without authentication and rejects customer, unlinked, and deactivated staff', async () => {
    expect((await request(app).get('/api/production')).status).toBe(401);
    expect((await request(app).get('/api/production').set(auth('customerA'))).status).toBe(403);
    expect((await request(app).get('/api/production').set(auth('unlinked'))).status).toBe(403);
    expect((await request(app).get('/api/files/ORD-A-LEGACY')).status).toBe(401);
    expect((await request(app).get('/api/files/ORD-A-LEGACY').set(auth('inactive'))).status).toBe(403);
    expect((await request(app).get('/api/files/ORD-A-LEGACY').set(auth('unlinked'))).status).toBe(403);
  });

  it('keeps complete production, search, and legacy file visibility for Admin', async () => {
    const production = await request(app).get('/api/production/ORD-B-LEGACY').set(auth(adminToken));
    expect(production.status).toBe(200);
    expect(production.body.order.orderId).toBe('ORD-B-LEGACY');

    const list = await request(app).get('/api/production').set(auth(adminToken));
    expect(list.status).toBe(200);
    expect(list.body.productions).toHaveLength(5);

    const files = await request(app).get('/api/files/ORD-UNASSIGNED').set(auth(adminToken));
    expect(files.status).toBe(200);
    expect(files.body.files[0].originalName).toBe('Unassigned Proof.png');

    const search = await request(app).get('/api/search/orders?query=ORD-').set(auth(adminToken));
    expect(search.status).toBe(200);
    expect(search.body.data).toHaveLength(5);
  });

  it('limits legacy details, lists, search, and metadata to Staff A assignments', async () => {
    expect((await request(app).get('/api/production/ORD-A-LEGACY').set(auth('staffA'))).status).toBe(200);
    expect((await request(app).get('/api/production/ORD-B-LEGACY').set(auth('staffA'))).status).toBe(404);
    expect((await request(app).get('/api/production/ORD-UNASSIGNED').set(auth('staffA'))).status).toBe(404);

    const list = await request(app).get('/api/production').set(auth('staffA'));
    expect(list.status).toBe(200);
    expect(list.body.productions.map(item => item.orderId).sort()).toEqual(['ORD-A-LEGACY', 'ORD-A-MODERN']);
    expect(JSON.stringify(list.body)).not.toContain('ORD-B-');
    expect(JSON.stringify(list.body)).not.toContain('unassigned-proof.png');

    const search = await request(app).get('/api/search/orders?query=ORD-').set(auth('staffA'));
    expect(search.status).toBe(200);
    expect(search.body.data.map(order => order.orderId).sort()).toEqual(['ORD-A-LEGACY', 'ORD-A-MODERN']);

    expect((await request(app).get('/api/files/ORD-A-LEGACY').set(auth('staffA'))).status).toBe(200);
    expect((await request(app).get('/api/files/ORD-B-LEGACY').set(auth('staffA'))).status).toBe(404);
    expect((await request(app).get('/api/files/ORD-UNASSIGNED').set(auth('staffA'))).status).toBe(404);

    expect((await request(app).get('/api/files/ORD-A-LEGACY').set(auth('customerA'))).status).toBe(200);
    expect((await request(app).get('/api/files/ORD-B-LEGACY').set(auth('customerA'))).status).toBe(404);
  });

  it('conceals another employee design file and metadata on modern secure file routes', async () => {
    const own = await request(app).get('/api/orders/ORD-A-MODERN/files').set(auth('staffA'));
    expect(own.status).toBe(200);
    expect(own.body.files).toEqual([{ id: 'design', name: 'a-modern.png', type: 'image/png', size: 10 }]);

    expect((await request(app).get('/api/orders/ORD-B-MODERN/files').set(auth('staffA'))).status).toBe(404);
    expect((await request(app).get('/api/orders/ORD-B-MODERN/files/design').set(auth('staffA'))).status).toBe(404);
    expect((await request(app).get('/api/orders/ORD-A-MODERN/files').set(auth('inactive'))).status).toBe(404);
    expect((await request(app).get('/api/orders/ORD-A-MODERN/files').set(auth('unlinked'))).status).toBe(404);
  });

  it('preserves customer ownership while denying another customer order', async () => {
    expect((await request(app).get('/api/orders/ORD-A-MODERN').set(auth('customerA'))).status).toBe(200);
    expect((await request(app).get('/api/orders/ORD-B-MODERN').set(auth('customerA'))).status).toBe(404);
  });

  it('rejects exception reports from customers, inactive Staff, and unlinked Staff', async () => {
    const payload = { type: 'BLOCKED', reason: 'Machine needs service', requestId: 'd2345678-1234-4234-8234-123456789abc', expectedAssignmentVersion: 0 };
    await Production.updateOne({ orderId: 'ORD-A-MODERN' }, { $set: { status: 'In Production' } });
    expect((await request(app).post('/api/job-orders/JO-ORD-A-MODERN/exceptions').set(auth('customerA')).send(payload)).status).toBe(403);
    expect((await request(app).post('/api/job-orders/JO-ORD-A-MODERN/exceptions').set(auth('inactive')).send(payload)).status).toBe(403);
    expect((await request(app).post('/api/job-orders/JO-ORD-A-MODERN/exceptions').set(auth('unlinked')).send(payload)).status).toBe(403);
  });

  it('keeps reassignment and exception notification metadata out of Staff production responses', async () => {
    await Production.updateOne({ orderId: 'ORD-A-MODERN' }, { $set: {
      assignmentHistory: [{ requestId: 'e2345678-1234-4234-8234-123456789abc', previousAssignedEmployee: 'staff-b', newAssignedEmployee: 'staff-a', reason: 'Coverage', actorId: 'admin-test-001', timestamp: new Date(), fromVersion: 0, toVersion: 1 }],
      reassignmentNotificationOutbox: [{ requestId: 'e2345678-1234-4234-8234-123456789abc', eventKey: 'private-event', recipientKind: 'previous', recipientId: 'staff-b', recipientRole: 'staff', type: 'reassigned', title: 'Private', message: 'Private', createdAt: new Date() }],
      exceptionNotificationOutbox: [{ exceptionId: 'exception-a', eventKey: 'private-exception-event', recipientId: 'admin-test-001', recipientRole: 'admin', type: 'reported', title: 'Private', message: 'Internal report', createdAt: new Date() }]
    } });
    const staff = await request(app).get('/api/production/ORD-A-MODERN').set(auth('staffA'));
    expect(staff.status).toBe(200);
    expect(staff.body.production.assignmentHistory).toBeUndefined();
    expect(staff.body.production.reassignmentNotificationOutbox).toBeUndefined();
    expect(staff.body.production.exceptionNotificationOutbox).toBeUndefined();
    const admin = await request(app).get('/api/production/ORD-A-MODERN').set(auth(adminToken));
    expect(admin.body.production.exceptionNotificationOutbox).toHaveLength(1);
  });

  it('limits pickup list, detail, and confirmation to the assigned staff member', async () => {
    await Order.updateMany({ orderId: { $in: ['ORD-A-MODERN', 'ORD-B-MODERN'] } }, { $set: { status: 'Ready for Pickup' } });
    await Production.updateMany({ orderId: { $in: ['ORD-A-MODERN', 'ORD-B-MODERN'] } }, { $set: { status: 'Ready for Pickup', reservedMaterials: [] } });

    const list = await request(app).get('/api/pickup/orders').set(auth('staffA'));
    expect(list.status).toBe(200);
    expect(list.body.orders.map(order => order.orderId)).toEqual(['ORD-A-MODERN']);
    expect((await request(app).get('/api/orders/ORD-B-MODERN/pickup-details').set(auth('staffA'))).status).toBe(404);
    expect((await request(app).post('/api/orders/ORD-B-MODERN/confirm-pickup').set(auth('staffA')).send({ receivedByName: 'Customer B' })).status).toBe(404);

    const adminList = await request(app).get('/api/pickup/orders').set(auth(adminToken));
    expect(adminList.body.orders.map(order => order.orderId).sort()).toEqual(['ORD-A-MODERN', 'ORD-B-MODERN']);
  });
});
