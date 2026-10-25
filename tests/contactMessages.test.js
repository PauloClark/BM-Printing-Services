import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup.js';
import { ContactMessage, Employee, Notification, User } from '../server/db.js';
import { generateToken } from '../server/middleware/auth.js';
import contactMessageRoutes from '../server/routes/contactMessages.js';

let app;
let originalFetch;
let originalUrl;
let originalKey;
let verifyCaptcha;

// Mirrors the existing suite convention: server/utils.js pulls in Node-only
// storage helpers, so only the text normalizer is exercised here.
jest.mock('../server/utils.js', () => ({
  safeText: value => (typeof value === 'string' ? value : '')
}));
jest.mock('../server/staffDirectory.js', () => ({
  listNotificationAdmins: jest.fn().mockResolvedValue([{ id: 'admin-1', role: 'admin' }]),
  isAuthorizedNotificationRecipient: jest.fn().mockResolvedValue(true)
}));

const users = {
  'customer-token': { id: 'customer-1', email: 'customer@example.com', app_metadata: {}, user_metadata: { full_name: 'Real Customer' } },
  'customer-two-token': { id: 'customer-2', email: 'customer2@example.com', app_metadata: {}, user_metadata: { full_name: 'Second Customer' } },
  'staff-token': { id: 'staff-1', email: 'staff@example.com', app_metadata: { role: 'staff' } },
  'admin-token': { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } },
  'forged-token': { id: 'forged-1', email: 'forged@example.com', user_metadata: { role: 'admin' } },
  'manager-token': { id: 'staff-manager', email: 'manager@example.com', app_metadata: { role: 'staff' } },
  'secretary-token': { id: 'staff-secretary', email: 'secretary@example.com', app_metadata: { role: 'staff' } },
  'marketing-token': { id: 'staff-marketing', email: 'marketing@example.com', app_metadata: { role: 'staff' } },
  'printing-token': { id: 'staff-printing', email: 'printing@example.com', app_metadata: { role: 'staff' } },
  'layout-token': { id: 'staff-layout', email: 'layout@example.com', app_metadata: { role: 'staff' } },
  'utility-token': { id: 'staff-utility', email: 'utility@example.com', app_metadata: { role: 'staff' } }
};

const validGuest = {
  name: 'Juan Dela Cruz',
  email: 'juan@example.com',
  subject: 'Question about bulk shirts',
  message: 'Do you accept bulk orders for our company shirts?'
};

beforeAll(async () => { await setupTestDB(); });
afterAll(async () => { await teardownTestDB(); });

beforeEach(async () => {
  await clearTestDB();
  await Employee.create({ name: 'Roland Sewing', email: 'staff@example.com', position: 'Sewing Worker', active: true, supabaseUserId: 'staff-1', permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: 'admin-1' });
  jest.clearAllMocks();
  originalFetch = global.fetch;
  originalUrl = process.env.SUPABASE_URL;
  originalKey = process.env.SUPABASE_ANON_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  global.fetch = jest.fn(async (_url, options = {}) => {
    const token = String(options.headers?.Authorization || '').replace('Bearer ', '');
    const user = users[token];
    if (!user) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, json: async () => user };
  });

  verifyCaptcha = jest.fn(async token => token === 'valid-captcha'
    ? { success: true, hostname: 'localhost' }
    : { success: false, 'error-codes': [token === 'reused-captcha' ? 'timeout-or-duplicate' : 'invalid-input-response'] });
  app = express();
  app.use(express.json());
  contactMessageRoutes(app, verifyCaptcha, { secret: 'test-secret', expectedHostnames: ['localhost'] });
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalKey;
});

// supertest applies `.set()` to a request test object, so headers are attached
// after selecting the HTTP method.
const authed = (token, method, url) => {
  const call = request(app)[method](url);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
};
const submit = (body, token) => authed(token, 'post', '/api/contact/messages').send(token ? body : { turnstileToken: 'valid-captcha', ...body });
describe('Contact Us submissions', () => {
  it('stores a guest inquiry and labels it Guest with no account', async () => {
    const response = await submit({ ...validGuest }).expect(201);

    expect(response.body.success).toBe(true);
    expect(response.body.message.senderType).toBe('guest');
    expect(response.body.message.userId).toBeNull();
    expect(response.body.message.status).toBe('new');
    expect(response.body.message.isRegisteredCustomer).toBe(false);

    const saved = await ContactMessage.findOne({ id: response.body.message.id });
    expect(saved.senderName).toBe('Juan Dela Cruz');
    expect(saved.senderEmail).toBe('juan@example.com');
    expect(saved.userId).toBeNull();
  });

  it('shows the guest inquiry to staff, newest first', async () => {
    const first = await submit({ ...validGuest, subject: 'First question' }).expect(201);
    await ContactMessage.findByIdAndUpdate(first.body.message._id, { createdAt: new Date('2026-01-01T00:00:00Z') });
    await submit({ ...validGuest, subject: 'Second question' }).expect(201);

    const list = await authed('staff-token', 'get', '/api/staff/messages').expect(200);
    expect(list.body.messages).toHaveLength(2);
    expect(list.body.messages[0].subject).toBe('Second question');
    expect(list.body.unread).toBe(2);
  });

  it('associates an authenticated sender with the verified session ID, not the browser', async () => {
    const response = await submit({ ...validGuest, userId: 'attacker-chosen-id' }, 'customer-token').expect(201);

    expect(response.body.message.senderType).toBe('customer');
    expect(response.body.message.userId).toBe('customer-1');
    expect(response.body.message.isRegisteredCustomer).toBe(true);
    const saved = await ContactMessage.findOne({ id: response.body.message.id });
    expect(saved.userId).toBe('customer-1');
  });

  it('lets a customer list, read and reply only to their own verified inquiries', async () => {
    const own = await submit({ ...validGuest, subject: 'My private inquiry' }, 'customer-token').expect(201);
    await submit({ ...validGuest, subject: 'Another account inquiry' }, 'customer-two-token').expect(201);
    await authed('customer-token', 'get', '/api/customers/inquiries').expect(200).then(response => {
      expect(response.body.messages.map(message => message.id)).toEqual([own.body.message.id]);
      expect(JSON.stringify(response.body)).not.toContain('senderEmail');
    });
    await authed('customer-token', 'get', `/api/customers/inquiries/${own.body.message.id}`).expect(200);
    await authed('customer-token', 'get', '/api/customers/inquiries/MSG-not-owned').expect(404);
    await authed('customer-token', 'post', `/api/customers/inquiries/${own.body.message.id}/replies`).send({ requestId: 'customer-request-0001', message: 'Following up.' }).expect(201);
    await authed('customer-token', 'post', '/api/customers/inquiries/MSG-not-owned/replies').send({ requestId: 'customer-request-0002', message: 'Private data?' }).expect(404);
    const saved = await ContactMessage.findOne({ id: own.body.message.id });
    expect(saved.replies[0].authorRole).toBe('customer');
    expect(saved.status).toBe('awaiting_staff');
  });

  it('prevents guests from reading/replying by guessed IDs and keeps internal notes private', async () => {
    const created = await submit({ ...validGuest }).expect(201), id = created.body.message.id;
    await request(app).get(`/api/customers/inquiries/${id}`).expect(401);
    await request(app).post(`/api/customers/inquiries/${id}/replies`).send({ requestId: 'guest-request-0001', message: 'Hello' }).expect(401);
    await authed('staff-token', 'post', `/api/staff/messages/${id}/replies`).send({ requestId: 'staff-public-reply-1', message: 'This cannot be delivered.' }).expect(409);
    const note = await authed('staff-token', 'post', `/api/staff/messages/${id}/internal-notes`).send({ requestId: 'staff-note-request-01', message: 'Call the guest during business hours.' }).expect(201);
    expect(note.body.deliveryState).toBe('INTERNAL_ONLY');
    expect(note.body.message.internalNotes).toHaveLength(1);
    const exposed = await authed('staff-token', 'get', `/api/staff/messages/${id}`).expect(200);
    expect(exposed.body.message.internalNotes[0].message).toContain('Call the guest');
    expect((await ContactMessage.findOne({ id })).replies).toHaveLength(0);
  });

  it('supports admin and active staff replies, with idempotent insertion and expected status transitions', async () => {
    await User.create({ id: 'admin-1', name: 'Admin', email: 'admin@example.com', role: 'admin' });
    const created = await submit({ ...validGuest }, 'customer-token').expect(201), id = created.body.message.id;
    const first = await authed('admin-token', 'post', `/api/staff/messages/${id}/replies`).send({ requestId: 'admin-request-000001', message: 'We can help with that.' }).expect(201);
    expect(first.body.message.status).toBe('awaiting_customer');
    await authed('admin-token', 'post', `/api/staff/messages/${id}/replies`).send({ requestId: 'admin-request-000001', message: 'We can help with that.' }).expect(200).then(response => expect(response.body.duplicate).toBe(true));
    await authed('staff-token', 'post', `/api/staff/messages/${id}/replies`).send({ requestId: 'staff-request-000001', message: 'Additional detail.' }).expect(201);
    const saved = await ContactMessage.findOne({ id });
    expect(saved.replies).toHaveLength(2);
    expect(saved.replies[0].replyId).toBeTruthy();
    expect(saved.replies[0].createdAt).toBeTruthy();
    expect(saved.notificationOutbox).toHaveLength(2);
    expect(saved.notificationOutbox[0].recipientId).toBe('customer-1');
    await authed('customer-token', 'post', `/api/customers/inquiries/${id}/replies`).send({ requestId: 'customer-followup-001', message: 'Thank you.' }).expect(201);
    const afterCustomerReply = await ContactMessage.findOne({ id });
    expect(afterCustomerReply.status).toBe('awaiting_staff');
    const staffAlerts = afterCustomerReply.notificationOutbox.filter(item => item.recipientRole === 'admin');
    expect(staffAlerts).toHaveLength(1);
    expect(staffAlerts[0].recipientId).toBe('*');
  });

  it('uses atomic request IDs for concurrent duplicate replies and rejects invalid payloads', async () => {
    const created = await submit({ ...validGuest }, 'customer-token').expect(201), id = created.body.message.id;
    const send = () => authed('customer-token', 'post', `/api/customers/inquiries/${id}/replies`).send({ requestId: 'concurrent-request-01', message: '<b>Hello</b>' });
    const responses = await Promise.all([send(), send()]);
    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([200, 201]);
    expect(await ContactMessage.findOne({ id }).then(doc => doc.replies)).toHaveLength(1);
    await authed('customer-token', 'post', `/api/customers/inquiries/${id}/replies`).send({ requestId: 'short', message: 'Hello' }).expect(400);
    await authed('customer-token', 'post', `/api/customers/inquiries/${id}/replies`).send({ requestId: 'long-request-id-0001', message: 'x'.repeat(3001) }).expect(400);
  });

  it('keeps a visible pending notification intent when notification persistence fails', async () => {
    const created = await submit({ ...validGuest }, 'customer-token').expect(201), id = created.body.message.id;
    const original = Notification.findOneAndUpdate;
    Notification.findOneAndUpdate = async () => { throw new Error('simulated notification outage'); };
    try {
      await authed('staff-token', 'post', `/api/staff/messages/${id}/replies`).send({ requestId: 'pending-notification-01', message: 'We received your question.' }).expect(201);
    } finally { Notification.findOneAndUpdate = original; }
    const saved = await ContactMessage.findOne({ id });
    expect(saved.replies).toHaveLength(1);
    expect(saved.notificationOutbox[0].state).toBe('PENDING');
    expect(saved.notificationOutbox[0].lastError).toMatch(/simulated notification outage/);
    const detail = await authed('admin-token', 'get', `/api/staff/messages/${id}`).expect(200);
    expect(detail.body.message.notificationOutbox[0].state).toBe('PENDING');
  });

  it('server-verifies guests while authenticated customers do not need a challenge', async () => {
    await submit({ ...validGuest }, 'customer-token').expect(201);
    const guest = await submit({ ...validGuest }).expect(201);
    expect(guest.body.message.senderType).toBe('guest');
    expect(await ContactMessage.countDocuments()).toBe(2);
    expect(verifyCaptcha).toHaveBeenCalledTimes(1);
  });

  it('rejects missing, invalid, and replayed guest challenges', async () => {
    await request(app).post('/api/contact/messages').send(validGuest).expect(400);
    await submit({ ...validGuest, turnstileToken: 'invalid-captcha' }).expect(400);
    await submit({ ...validGuest, turnstileToken: 'reused-captcha' }).expect(400);
    expect(await ContactMessage.countDocuments()).toBe(0);
  });

  it('rejects invalid guest email, empty message and oversized input', async () => {
    await submit({ ...validGuest, email: 'not-an-email' }).expect(400);
    await submit({ ...validGuest, message: '' }).expect(400);
    await submit({ ...validGuest, subject: '' }).expect(400);
    await submit({ ...validGuest, name: '' }).expect(400);
    await submit({ ...validGuest, message: 'x'.repeat(5000) }).expect(400);
    expect(await ContactMessage.countDocuments()).toBe(0);
  });

  it('treats submitted HTML as plain text and never strips or executes it', async () => {
    const payload = '<script>window.alert("xss")</script><img src=x onerror=alert(1)>';
    const response = await submit({ ...validGuest, message: payload }).expect(201);

    expect(response.body.message.message).toBe(payload);
    const saved = await ContactMessage.findOne({ id: response.body.message.id });
    expect(saved.message).toBe(payload);
  });

  it('rate-limits repeated submissions from one client', async () => {
    for (let i = 0; i < 5; i++) {
      await submit({ ...validGuest, subject: `Spam ${i}` }).expect(201);
    }
    const blocked = await submit({ ...validGuest, subject: 'Spam 6' }).expect(429);
    expect(blocked.body.error).toMatch(/Too many messages/i);
    expect(await ContactMessage.countDocuments()).toBe(5);
  });
});

describe('Contact Us staff authorization', () => {
  it('allows every active linked staff position to access inquiries', async () => {
    const roster = [
      ['manager-token', 'Manager', 'staff-manager', 'manager@example.com'],
      ['secretary-token', 'Secretary', 'staff-secretary', 'secretary@example.com'],
      ['marketing-token', 'Marketing', 'staff-marketing', 'marketing@example.com'],
      ['staff-token', 'Sewing Worker', 'staff-1', 'staff@example.com'],
      ['printing-token', 'Printing Worker', 'staff-printing', 'printing@example.com'],
      ['layout-token', 'Layout Artist', 'staff-layout', 'layout@example.com'],
      ['utility-token', 'Utility Worker', 'staff-utility', 'utility@example.com']
    ];
    await Employee.insertMany(roster.filter(([token]) => token !== 'staff-token').map(([, position, supabaseUserId, email]) => ({
      name: `${position} Test`, email, position, active: true, supabaseUserId,
      permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: 'admin-1'
    })));

    for (const [token] of roster) await authed(token, 'get', '/api/staff/messages').expect(200);
  });

  it('denies inactive, unlinked, and password-change-required staff', async () => {
    await Employee.updateOne({ supabaseUserId: 'staff-1' }, { active: false });
    await authed('staff-token', 'get', '/api/staff/messages').expect(403);

    await Employee.updateOne({ supabaseUserId: 'staff-1' }, { active: true, mustChangePassword: true });
    await authed('staff-token', 'get', '/api/staff/messages').expect(428);

    await Employee.deleteOne({ supabaseUserId: 'staff-1' });
    await authed('staff-token', 'get', '/api/staff/messages').expect(403);
  });

  it('denies legacy JWT staff even when a legacy staff record still exists', async () => {
    const legacy = await User.create({ id: 'legacy-staff', name: 'Legacy Staff', email: 'legacy@example.com', role: 'staff' });
    await authed(generateToken(legacy), 'get', '/api/staff/messages').expect(403);
  });

  it('denies the message list, detail and status endpoints to guests and customers', async () => {
    const created = await submit({ ...validGuest }).expect(201);
    const id = created.body.message.id;

    for (const token of ['', 'customer-token', 'forged-token']) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      expect((await request(app).get('/api/staff/messages').set(headers)).status).toBe(token ? 403 : 401);
      expect((await request(app).get(`/api/staff/messages/${id}`).set(headers)).status).toBe(token ? 403 : 401);
      expect((await request(app).patch(`/api/staff/messages/${id}/status`).set(headers).send({ status: 'read' })).status).toBe(token ? 403 : 401);
      expect((await request(app).post(`/api/staff/messages/${id}/replies`).set(headers).send({ requestId: 'denied-staff-reply-01', message: 'No access.' })).status).toBe(token ? 403 : 401);
    }
  });

  it('lets staff read the full message and mark it read then resolved', async () => {
    const created = await submit({ ...validGuest }).expect(201);
    const id = created.body.message.id;

    const detail = await authed('staff-token', 'get', `/api/staff/messages/${id}`).expect(200);
    expect(detail.body.message.message).toBe(validGuest.message);
    expect(detail.body.message.senderType).toBe('guest');

    const read = await authed('staff-token', 'patch', `/api/staff/messages/${id}/status`).send({ status: 'read' }).expect(200);
    expect(read.body.message.status).toBe('read');
    expect(read.body.message.readAt).toBeTruthy();

    const resolved = await authed('staff-token', 'patch', `/api/staff/messages/${id}/status`).send({ status: 'resolved' }).expect(200);
    expect(resolved.body.message.status).toBe('resolved');
    expect(resolved.body.message.resolvedAt).toBeTruthy();

    const list = await authed('staff-token', 'get', '/api/staff/messages').expect(200);
    expect(list.body.unread).toBe(0);
  });

  it('allows admin status updates and rejects an unknown status', async () => {
    const created = await submit({ ...validGuest }).expect(201);
    const id = created.body.message.id;

    await authed('admin-token', 'patch', `/api/staff/messages/${id}/status`).send({ status: 'resolved' }).expect(200);
    await authed('staff-token', 'patch', `/api/staff/messages/${id}/status`).send({ status: 'deleted' }).expect(400);
  });

  it('returns 404 for an unknown message instead of leaking other records', async () => {
    await authed('staff-token', 'get', '/api/staff/messages/MSG-does-not-exist').expect(404);
    await authed('staff-token', 'patch', '/api/staff/messages/MSG-does-not-exist/status').send({ status: 'read' }).expect(404);
  });

  it('never returns auth metadata, tokens or secrets to staff', async () => {
    const created = await submit({ ...validGuest }, 'customer-token').expect(201);
    const list = await authed('staff-token', 'get', '/api/staff/messages').expect(200);
    const serialized = JSON.stringify(list.body);

    for (const forbidden of ['password', 'app_metadata', 'access_token', 'refresh_token', 'SUPABASE_ANON']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(created.body.message).toMatchObject({ replies: [], internalNotes: [], lastActivityAt: expect.any(String) });
    expect(created.body.message).not.toHaveProperty('notificationOutbox');
  });
});
