import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB } from './setup.js';
import { ContactMessage } from '../server/db.js';
import contactMessageRoutes from '../server/routes/contactMessages.js';

let app;
let originalFetch;
let originalUrl;
let originalKey;
let originalSecret;
const verifyToken = jest.fn();

// Mirrors the existing suite convention: server/utils.js pulls in Node-only
// storage helpers, so only the text normalizer is exercised here.
jest.mock('../server/utils.js', () => ({
  safeText: value => (typeof value === 'string' ? value : '')
}));

const users = {
  'customer-token': { id: 'customer-1', email: 'customer@example.com', app_metadata: {}, user_metadata: { full_name: 'Real Customer' } },
  'staff-token': { id: 'staff-1', email: 'staff@example.com', app_metadata: { role: 'staff' } },
  'admin-token': { id: 'admin-1', email: 'admin@example.com', app_metadata: { role: 'admin' } },
  'forged-token': { id: 'forged-1', email: 'forged@example.com', user_metadata: { role: 'admin' } }
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
  jest.clearAllMocks();
  originalFetch = global.fetch;
  originalUrl = process.env.SUPABASE_URL;
  originalKey = process.env.SUPABASE_ANON_KEY;
  originalSecret = process.env.TURNSTILE_SECRET_KEY;
  process.env.SUPABASE_URL = 'https://supabase.test';
  process.env.SUPABASE_ANON_KEY = 'public-test-key';
  process.env.TURNSTILE_SECRET_KEY = 'server-only-test-secret';
  verifyToken.mockResolvedValue({ success: true });
  global.fetch = jest.fn(async (_url, options = {}) => {
    const token = String(options.headers?.Authorization || '').replace('Bearer ', '');
    const user = users[token];
    if (!user) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, json: async () => user };
  });

  app = express();
  app.use(express.json());
  contactMessageRoutes(app, { verifyToken });
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
  if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalKey;
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY; else process.env.TURNSTILE_SECRET_KEY = originalSecret;
});

// supertest applies `.set()` to a request test object, so headers are attached
// after selecting the HTTP method.
const authed = (token, method, url) => {
  const call = request(app)[method](url);
  return token ? call.set('Authorization', `Bearer ${token}`) : call;
};
const submit = (body, token) => authed(token, 'post', '/api/contact/messages').send(body);
describe('Contact Us submissions', () => {
  it('stores a guest inquiry and labels it Guest with no account', async () => {
    const response = await submit({ ...validGuest, turnstileToken: 'guest-token' }).expect(201);

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
    const first = await submit({ ...validGuest, subject: 'First question', turnstileToken: 't' }).expect(201);
    await ContactMessage.findByIdAndUpdate(first.body.message._id, { createdAt: new Date('2026-01-01T00:00:00Z') });
    await submit({ ...validGuest, subject: 'Second question', turnstileToken: 't' }).expect(201);

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

  it('skips Turnstile for authenticated customers but enforces it for guests', async () => {
    await submit({ ...validGuest }, 'customer-token').expect(201);
    expect(verifyToken).not.toHaveBeenCalled();

    // A guest without a token is rejected before Cloudflare is contacted.
    await submit({ ...validGuest }).expect(400);
    expect(verifyToken).not.toHaveBeenCalled();

    // A guest with a token is verified server-side against the secret.
    await submit({ ...validGuest, turnstileToken: 'guest-token' }).expect(201);
    expect(verifyToken).toHaveBeenCalledWith('guest-token', 'server-only-test-secret');
  });

  it('rejects a guest whose Turnstile check fails', async () => {
    verifyToken.mockResolvedValue({ success: false });
    await submit({ ...validGuest, turnstileToken: 'bad' }).expect(400);
    expect(await ContactMessage.countDocuments()).toBe(0);
  });

  it('rejects invalid guest email, empty message and oversized input', async () => {
    await submit({ ...validGuest, email: 'not-an-email', turnstileToken: 't' }).expect(400);
    await submit({ ...validGuest, message: '', turnstileToken: 't' }).expect(400);
    await submit({ ...validGuest, subject: '', turnstileToken: 't' }).expect(400);
    await submit({ ...validGuest, name: '', turnstileToken: 't' }).expect(400);
    await submit({ ...validGuest, message: 'x'.repeat(5000), turnstileToken: 't' }).expect(400);
    expect(await ContactMessage.countDocuments()).toBe(0);
  });

  it('treats submitted HTML as plain text and never strips or executes it', async () => {
    const payload = '<script>window.alert("xss")</script><img src=x onerror=alert(1)>';
    const response = await submit({ ...validGuest, message: payload, turnstileToken: 't' }).expect(201);

    expect(response.body.message.message).toBe(payload);
    const saved = await ContactMessage.findOne({ id: response.body.message.id });
    expect(saved.message).toBe(payload);
  });

  it('rate-limits repeated submissions from one client', async () => {
    for (let i = 0; i < 5; i++) {
      await submit({ ...validGuest, subject: `Spam ${i}`, turnstileToken: 't' }).expect(201);
    }
    const blocked = await submit({ ...validGuest, subject: 'Spam 6', turnstileToken: 't' }).expect(429);
    expect(blocked.body.error).toMatch(/Too many messages/i);
    expect(await ContactMessage.countDocuments()).toBe(5);
  });
});

describe('Contact Us staff authorization', () => {
  it('denies the message list, detail and status endpoints to guests and customers', async () => {
    const created = await submit({ ...validGuest, turnstileToken: 't' }).expect(201);
    const id = created.body.message.id;

    for (const token of ['', 'customer-token', 'forged-token']) {
      const headers = token ? { Authorization: `Bearer ${token}` } : {};
      expect((await request(app).get('/api/staff/messages').set(headers)).status).toBe(token ? 403 : 401);
      expect((await request(app).get(`/api/staff/messages/${id}`).set(headers)).status).toBe(token ? 403 : 401);
      expect((await request(app).patch(`/api/staff/messages/${id}/status`).set(headers).send({ status: 'read' })).status).toBe(token ? 403 : 401);
    }
  });

  it('lets staff read the full message and mark it read then resolved', async () => {
    const created = await submit({ ...validGuest, turnstileToken: 't' }).expect(201);
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
    const created = await submit({ ...validGuest, turnstileToken: 't' }).expect(201);
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

    for (const forbidden of ['password', 'app_metadata', 'access_token', 'refresh_token', 'TURNSTILE_SECRET', 'SUPABASE_ANON']) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(Object.keys(created.body.message).sort()).toEqual([
      'createdAt', 'id', 'isRegisteredCustomer', 'message', 'readAt', 'resolvedAt',
      'senderEmail', 'senderName', 'senderType', 'status', 'subject', 'userId'
    ]);
  });
});