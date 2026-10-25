import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { ContactMessage, Employee, Notification, Order, Production, User } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import notificationRoutes from '../server/routes/notifications.js';
import { createNotification, notifyAdmins } from '../server/notificationService.js';
import { makeNotificationIntent } from '../server/notificationService.js';
import { runNotificationBatch, retryFailedNotification } from '../server/notificationWorker.js';
import { listNotificationAdmins, isAuthorizedNotificationRecipient } from '../server/staffDirectory.js';

jest.mock('../server/staffDirectory.js', () => ({
  listNotificationAdmins: jest.fn().mockResolvedValue([{ id: 'admin-a', role: 'admin' }]),
  isAuthorizedNotificationRecipient: jest.fn().mockResolvedValue(true)
}));

let mongo, app, adminToken, customerToken, originalFetch, oldUrl, oldKey;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create(); await mongoose.connect(mongo.getUri());
  originalFetch = global.fetch; oldUrl = process.env.SUPABASE_URL; oldKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test'; process.env.SUPABASE_ANON_KEY = 'anon-test';
  global.fetch = jest.fn(async (_url, options = {}) => {
    const token = options.headers?.Authorization?.replace('Bearer ', '');
    const users = { 'staff-a-token': { id: 'staff-a', email: 'a@staff.test', email_confirmed_at: new Date().toISOString(), app_metadata: { role: 'staff' } }, 'staff-b-token': { id: 'staff-b', email: 'b@staff.test', email_confirmed_at: new Date().toISOString(), app_metadata: { role: 'staff' } } };
    return { ok: Boolean(users[token]), json: async () => users[token] || {} };
  });
  app = express(); app.use(express.json()); notificationRoutes(app);
});
afterAll(async () => { global.fetch = originalFetch; if (oldUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = oldKey; await mongoose.disconnect(); await mongo.stop(); });
beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
  const admin = await User.create({ id: 'admin-a', name: 'Admin', email: 'admin@test.com', role: 'admin' });
  const customer = await User.create({ id: 'customer-a', name: 'Customer', email: 'customer@test.com', role: 'customer' });
  adminToken = generateToken(admin); customerToken = generateToken(customer);
});
const auth = token => ({ Authorization: `Bearer ${token}` });

it('isolates customer and staff notifications and persists read state', async () => {
  const customerNotice = await createNotification({ recipientId: 'customer-a', recipientRole: 'customer', type: 'payment_verified', title: 'Payment verified', message: 'Order ORD-1 was verified.', relatedOrderId: 'ORD-1', targetPage: 'myorders', eventKey: 'payment:ORD-1' });
  await createNotification({ recipientId: 'staff-a', recipientRole: 'staff', type: 'job_assigned', title: 'New job', message: 'Job JO-1 assigned.', relatedJobId: 'JO-1', targetPage: 'staff', eventKey: 'assignment:JO-1' });
  const customer = await request(app).get('/api/notifications').set(auth(customerToken));
  expect(customer.status).toBe(200); expect(customer.body.unreadCount).toBe(1); expect(customer.body.notifications.map(item => item.relatedOrderId)).toEqual(['ORD-1']);
  expect((await request(app).patch(`/api/notifications/${customerNotice._id}/read`).set(auth('staff-b-token'))).status).toBe(404);
  const marked = await request(app).patch(`/api/notifications/${customerNotice._id}/read`).set(auth(customerToken));
  expect(marked.status).toBe(200); expect(marked.body.notification.read).toBe(true); expect(marked.body.notification.readAt).toBeTruthy();
  expect((await request(app).get('/api/notifications').set(auth(customerToken))).body.unreadCount).toBe(0);
  const staffA = await request(app).get('/api/notifications').set(auth('staff-a-token'));
  const staffB = await request(app).get('/api/notifications').set(auth('staff-b-token'));
  expect(staffA.body.notifications).toHaveLength(1); expect(staffB.body.notifications).toHaveLength(0);
});

it('deduplicates event keys, notifies admins, supports read-all and rejects unauthenticated access', async () => {
  const event = { recipientId: 'customer-a', recipientRole: 'customer', type: 'ready', title: 'Ready', message: 'Ready.', eventKey: 'ready:ORD-1' };
  await Promise.all([createNotification(event), createNotification(event)]);
  expect(await Notification.countDocuments({ eventKey: event.eventKey })).toBe(1);
  await notifyAdmins({ type: 'review', title: 'Review required', message: 'Review JO-1.', relatedJobId: 'JO-1', targetPage: 'admin', eventKey: 'review:JO-1' });
  const admin = await request(app).get('/api/notifications').set(auth(adminToken));
  expect(admin.body.unreadCount).toBe(1); expect(admin.body.notifications[0].relatedJobId).toBe('JO-1');
  expect((await request(app).patch('/api/notifications/read-all').set(auth(adminToken))).status).toBe(200);
  expect((await request(app).get('/api/notifications').set(auth(adminToken))).body.unreadCount).toBe(0);
  expect((await request(app).get('/api/notifications')).status).toBe(401);
});

it('includes an authorized Supabase-only Admin in Admin broadcasts', async () => {
  listNotificationAdmins.mockResolvedValue([{ id: 'admin-a', role: 'admin' }, { id: 'supabase-admin-only', role: 'admin' }]);
  await notifyAdmins({ type: 'new_order', title: 'New order', message: 'Order ORD-9 was submitted.', relatedOrderId: 'ORD-9', eventKey: 'new-order:ORD-9' });
  const notices = await Notification.find({ relatedOrderId: 'ORD-9' }).lean();
  expect(notices.map(item => item.recipientId).sort()).toEqual(['admin-a', 'supabase-admin-only']);
});

const orderWithIntent = async (intent, orderId = 'ORD-OUTBOX-1') => Order.create({
  orderId, customerId: 'customer-a', customerName: 'Customer', customerEmail: 'customer@test.com',
  totalAmount: 100, notificationOutbox: [intent]
});

it('delivers embedded intents once, records delivery history, and suppresses duplicate notifications', async () => {
  const order = await orderWithIntent(makeNotificationIntent({ eventKey: 'outbox:success:1', recipientId: 'customer-a', recipientRole: 'customer', type: 'order_confirmed', title: 'Confirmed', message: 'Order ORD-OUTBOX-1 confirmed.' }));
  expect(await runNotificationBatch()).toMatchObject({ processed: 1 });
  expect(await runNotificationBatch()).toMatchObject({ processed: 0 });
  const saved = await Order.findById(order._id).lean();
  expect(saved.notificationOutbox[0]).toMatchObject({ state: 'DELIVERED', attempts: 1, lastAttemptAt: expect.any(Date), deliveredAt: expect.any(Date) });
  expect(saved.notificationOutbox[0].deliveryHistory).toHaveLength(1);
  expect(await Notification.countDocuments({ eventKey: { $regex: /^outbox:success:1:/ } })).toBe(1);
});

it('fails closed when a Staff recipient has been deactivated or unlinked', async () => {
  isAuthorizedNotificationRecipient.mockResolvedValueOnce(false);
  const order = await orderWithIntent(makeNotificationIntent({
    eventKey: 'outbox:revoked-staff:1', recipientId: 'staff-a', recipientRole: 'staff',
    type: 'job_assigned', title: 'Job assigned', message: 'A production job was assigned.'
  }), 'ORD-OUTBOX-REVOKED-STAFF');
  await runNotificationBatch();
  const saved = await Order.findById(order._id).lean();
  expect(saved.notificationOutbox[0]).toMatchObject({ state: 'FAILED', attempts: 1 });
  expect(saved.notificationOutbox[0].lastError).toContain('no longer an active authorized account');
  expect(await Notification.countDocuments({ eventKey: { $regex: /^outbox:revoked-staff:1:/ } })).toBe(0);
});

it('retries transient failures with backoff and preserves attempt history', async () => {
  const order = await orderWithIntent(makeNotificationIntent({ eventKey: 'outbox:retry:1', recipientId: 'customer-a', recipientRole: 'customer', type: 'payment_verified', title: 'Verified', message: 'Payment verified.' }), 'ORD-OUTBOX-2');
  const original = Notification.findOneAndUpdate;
  Notification.findOneAndUpdate = async () => { throw new Error('temporary notification database outage'); };
  try { await runNotificationBatch(); } finally { Notification.findOneAndUpdate = original; }
  let saved = await Order.findById(order._id).lean();
  expect(saved.notificationOutbox[0]).toMatchObject({ state: 'PENDING', attempts: 1, lastError: expect.stringContaining('temporary notification database outage') });
  expect(saved.notificationOutbox[0].nextAttemptAt).toBeInstanceOf(Date);
  await runNotificationBatch({ now: new Date(Date.now() + 20_000) });
  saved = await Order.findById(order._id).lean();
  expect(saved.notificationOutbox[0]).toMatchObject({ state: 'DELIVERED', attempts: 2 });
  expect(saved.notificationOutbox[0].deliveryHistory).toHaveLength(2);
  expect(await Notification.countDocuments({ eventKey: { $regex: /^outbox:retry:1:/ } })).toBe(1);
});

it('claims concurrent work once and recovers an expired processing lease', async () => {
  const concurrent = await orderWithIntent(makeNotificationIntent({ eventKey: 'outbox:concurrent:1', recipientId: 'customer-a', recipientRole: 'customer', type: 'order_confirmed', title: 'Confirmed', message: 'Confirmed.' }), 'ORD-OUTBOX-3');
  const [first, second] = await Promise.all([runNotificationBatch(), runNotificationBatch()]);
  expect(first.processed + second.processed).toBe(1);
  expect((await Order.findById(concurrent._id).lean()).notificationOutbox[0].attempts).toBe(1);

  const abandoned = await orderWithIntent({ ...makeNotificationIntent({ eventKey: 'outbox:lease:1', recipientId: 'customer-a', recipientRole: 'customer', type: 'order_confirmed', title: 'Confirmed', message: 'Confirmed.' }), state: 'PROCESSING', attempts: 1, lockToken: 'dead-worker', lockedUntil: new Date(Date.now() - 1000) }, 'ORD-OUTBOX-4');
  await runNotificationBatch();
  expect((await Order.findById(abandoned._id).lean()).notificationOutbox[0]).toMatchObject({ state: 'DELIVERED', attempts: 2 });
});

it('marks exhausted events failed and allows an Admin-only manual retry', async () => {
  const order = await orderWithIntent({ ...makeNotificationIntent({ eventKey: 'outbox:max:1', recipientId: 'customer-a', recipientRole: 'customer', type: 'order_confirmed', title: 'Confirmed', message: 'Confirmed.' }), attempts: 7 }, 'ORD-OUTBOX-5');
  const original = Notification.findOneAndUpdate;
  Notification.findOneAndUpdate = async () => { throw new Error('database unavailable'); };
  try { await runNotificationBatch(); } finally { Notification.findOneAndUpdate = original; }
  let saved = await Order.findById(order._id).lean();
  expect(saved.notificationOutbox[0]).toMatchObject({ state: 'FAILED', attempts: 8 });
  expect(await retryFailedNotification({ sourceType: 'order', sourceId: order.orderId, eventKey: 'outbox:max:1', actorId: 'admin-a' })).toBe(true);
  saved = await Order.findById(order._id).lean();
  expect(saved.notificationOutbox[0]).toMatchObject({ state: 'PENDING', attempts: 0 });
  expect(saved.notificationOutbox[0].deliveryHistory.at(-1).state).toBe('MANUAL_RETRY');
});

it('restricts delivery monitoring and manual retry to Admin', async () => {
  const order = await orderWithIntent({ ...makeNotificationIntent({ eventKey: 'outbox:admin-retry:1', recipientId: 'customer-a', recipientRole: 'customer', type: 'order_confirmed', title: 'Confirmed', message: 'Confirmed.' }), state: 'FAILED', attempts: 8, lastError: 'temporary issue' }, 'ORD-OUTBOX-6');
  expect((await request(app).get('/api/admin/notification-delivery').set(auth(customerToken))).status).toBe(403);
  const adminView = await request(app).get('/api/admin/notification-delivery').set(auth(adminToken));
  expect(adminView.status).toBe(200);
  expect(adminView.body.totals.FAILED).toBe(1);
  expect(adminView.body.events[0]).toMatchObject({ sourceType: 'order', sourceId: order.orderId, state: 'FAILED', attempts: 8 });
  expect((await request(app).post('/api/admin/notification-delivery/retry').set(auth(customerToken)).send({ sourceType: 'order', sourceId: order.orderId, eventKey: 'outbox:admin-retry:1' })).status).toBe(403);
  expect((await request(app).post('/api/admin/notification-delivery/retry').set(auth(adminToken)).send({ sourceType: 'order', sourceId: order.orderId, eventKey: 'outbox:admin-retry:1' })).status).toBe(200);
});
