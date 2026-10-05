import express from 'express';
import request from 'supertest';
import turnstileRoutes from '../server/routes/turnstile.js';
import { TURNSTILE_ERRORS, verifyTurnstileToken } from '../src/utils/turnstile.js';

let app;
let originalSecret;
let originalFetch;

beforeEach(() => {
  originalSecret = process.env.TURNSTILE_SECRET_KEY;
  originalFetch = global.fetch;
  process.env.TURNSTILE_SECRET_KEY = 'server-only-test-secret';
  app = express();
  app.use(express.json());
});

afterEach(() => {
  jest.restoreAllMocks();
  global.fetch = originalFetch;
  if (originalSecret === undefined) delete process.env.TURNSTILE_SECRET_KEY;
  else process.env.TURNSTILE_SECRET_KEY = originalSecret;
});

test('rejects missing and oversized tokens without contacting Cloudflare', async () => {
  const verifyToken = jest.fn();
  turnstileRoutes(app, verifyToken);

  await request(app).post('/api/turnstile/verify').send({}).expect(400, { success: false });
  await request(app).post('/api/turnstile/verify').send({ token: 'x'.repeat(2049) }).expect(400, { success: false });
  expect(verifyToken).not.toHaveBeenCalled();
});

test('only returns success when Siteverify confirms the token', async () => {
  const verifyToken = jest.fn().mockResolvedValue({ success: true, hostname: 'example.com' });
  turnstileRoutes(app, verifyToken);

  await request(app)
    .post('/api/turnstile/verify')
    .send({ token: 'temporary-token' })
    .expect(200, { success: true });

  expect(verifyToken).toHaveBeenCalledWith('temporary-token', 'server-only-test-secret');
});

test('rejects invalid Cloudflare tokens without returning provider details', async () => {
  turnstileRoutes(app, jest.fn().mockResolvedValue({ success: false, 'error-codes': ['invalid-input-response'] }));

  const response = await request(app)
    .post('/api/turnstile/verify')
    .send({ token: 'fake-token' })
    .expect(400);

  expect(response.body).toEqual({ success: false });
  expect(JSON.stringify(response.body)).not.toContain('invalid-input-response');
});

test('calls Cloudflare Siteverify with the server-side secret and temporary token', async () => {
  const fetchSpy = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
  global.fetch = fetchSpy;
  turnstileRoutes(app);

  await request(app)
    .post('/api/turnstile/verify')
    .send({ token: 'temporary-token' })
    .expect(200, { success: true });

  const [url, options] = fetchSpy.mock.calls[0];
  expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  expect(options.method).toBe('POST');
  expect(new URLSearchParams(options.body).get('secret')).toBe('server-only-test-secret');
  expect(new URLSearchParams(options.body).get('response')).toBe('temporary-token');
});

test('returns a safe unavailable response when Cloudflare cannot be reached', async () => {
  const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
  turnstileRoutes(app, jest.fn().mockRejectedValue(Object.assign(new Error('private provider detail'), { status: 503 })));

  const response = await request(app)
    .post('/api/turnstile/verify')
    .send({ token: 'temporary-token' })
    .expect(503);

  expect(response.body).toEqual({ success: false, error: 'Security verification is temporarily unavailable. Please try again.' });
  expect(JSON.stringify(response.body)).not.toContain('private provider detail');
  expect(logError).toHaveBeenCalledWith('[Turnstile] Siteverify request failed: HTTP 503 Error');
});

test('shared client verifier accepts only successful backend responses', async () => {
  global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ success: true }) });
  await expect(verifyTurnstileToken('temporary-token')).resolves.toBeUndefined();
  expect(global.fetch).toHaveBeenCalledWith('/api/turnstile/verify', expect.objectContaining({
    method: 'POST',
    body: JSON.stringify({ token: 'temporary-token' })
  }));

  global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 400, json: async () => ({ success: false }) });
  await expect(verifyTurnstileToken('invalid-token')).rejects.toThrow(TURNSTILE_ERRORS.failed);

  global.fetch = jest.fn().mockRejectedValue(new Error('network unavailable'));
  await expect(verifyTurnstileToken('temporary-token')).rejects.toThrow(TURNSTILE_ERRORS.unavailable);
});