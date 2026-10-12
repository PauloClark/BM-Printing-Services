import request from 'supertest';
import express from 'express';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Notification, User } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import notificationRoutes from '../server/routes/notifications.js';
import { createNotification, notifyAdmins } from '../server/notificationService.js';

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
