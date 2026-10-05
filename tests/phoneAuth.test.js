import { normalizePhoneNumber, phoneOtpErrorMessage, PHONE_OTP_ERRORS } from '../src/utils/phoneAuth.js';
import { requestPhoneOtp, verifyPhoneOtp } from '../src/utils/authActions.js';
import { supabaseAppUser, dashboardForRole, canOpenDashboard } from '../shared/roles.js';
import express from 'express';
import request from 'supertest';
import { requireOrderAuth } from '../server/middleware/auth.js';

describe('normalizePhoneNumber', () => {
  it('normalizes common Philippine mobile input to E.164', () => {
    for (const input of ['09171234567', '+639171234567', '639171234567', '9171234567', '0917 123 4567', '+63 917 123 4567', '(0917) 123-4567', ' 09171234567 ']) {
      expect(normalizePhoneNumber(input)).toEqual({ ok: true, e164: '+639171234567' });
    }
  });

  it('rejects text, letters, short, long and non-PH numbers', () => {
    for (const input of ['', '   ', 'abc', '0917123456', '091712345678', '+63917123456', '+6391712345678',
      '+12025550123', '0917abc4567', '0917-1234-567a', null, undefined, 9171234567, {}]) {
      expect(normalizePhoneNumber(input).ok).toBe(false);
    }
  });
});

describe('phoneOtpErrorMessage', () => {
  it('maps provider failures to safe copy and never leaks raw provider text', () => {
    const cases = [
      [{ code: 'otp_expired' }, PHONE_OTP_ERRORS.expiredCode],
      [{ code: 'invalid_token' }, PHONE_OTP_ERRORS.invalidCode],
      [{ code: 'over_sms_send_rate_limit' }, PHONE_OTP_ERRORS.rateLimited],
      [{ code: 'sms_provider_unavailable' }, PHONE_OTP_ERRORS.providerUnavailable],
      [{ code: 'phone_signups_disabled' }, PHONE_OTP_ERRORS.notEnabled],
      [{ message: 'Failed to fetch' }, PHONE_OTP_ERRORS.network]
    ];
    for (const [error, expected] of cases) {
      expect(phoneOtpErrorMessage(error)).toBe(expected);
      expect(phoneOtpErrorMessage(error)).not.toContain(error.code ?? 'x');
    }
    expect(phoneOtpErrorMessage({ code: 'unknown', message: 'smtp secret 12345 failed at twilio' })).toBe(PHONE_OTP_ERRORS.sendFailed);
  });
});

describe('Supabase Phone Auth actions', () => {
  it('sends the OTP to the normalized E.164 number and allows user creation', async () => {
    const signInWithOtp = jest.fn().mockResolvedValue({ error: null });
    await expect(requestPhoneOtp({ auth: { signInWithOtp } }, '09171234567')).resolves.toBe('+639171234567');
    expect(signInWithOtp).toHaveBeenCalledWith({ phone: '+639171234567', options: { shouldCreateUser: true } });
  });

  it('never calls Supabase for an invalid number', async () => {
    const signInWithOtp = jest.fn();
    await expect(requestPhoneOtp({ auth: { signInWithOtp } }, '0917')).rejects.toThrow(PHONE_OTP_ERRORS.invalidPhone);
    expect(signInWithOtp).not.toHaveBeenCalled();
  });

  it('surfaces a safe message when the send fails', async () => {
    const client = { auth: { signInWithOtp: jest.fn().mockResolvedValue({ error: { code: 'over_request_rate_limit', message: 'rate limited' } }) } };
    await expect(requestPhoneOtp(client, '09171234567')).rejects.toThrow(PHONE_OTP_ERRORS.rateLimited);
  });

  it('delegates verification to Supabase and maps the signed-in user', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({
      error: null,
      data: { user: { id: 'phone-user', phone: '+639171234567', app_metadata: {}, user_metadata: {} } }
    });
    const user = await verifyPhoneOtp({ auth: { verifyOtp } }, '+639171234567', '123456');
    expect(verifyOtp).toHaveBeenCalledWith({ phone: '+639171234567', token: '123456', type: 'sms' });
    expect(user).toMatchObject({ id: 'phone-user', phone: '+639171234567', authProvider: 'supabase' });
  });

  it('rejects malformed codes locally and incorrect codes via Supabase', async () => {
    const verifyOtp = jest.fn().mockResolvedValue({ error: { code: 'otp_verification_failed', message: 'Token has expired or is invalid' } });
    const client = { auth: { verifyOtp } };
    await expect(verifyPhoneOtp(client, '09171234567', '12ab')).rejects.toThrow(PHONE_OTP_ERRORS.missingCode);
    expect(verifyOtp).not.toHaveBeenCalled();
    await expect(verifyPhoneOtp(client, '09171234567', '000000')).rejects.toThrow(PHONE_OTP_ERRORS.invalidCode);
  });
});

describe('phone-authenticated session and roles', () => {
  const phoneUser = { id: 'phone-user', phone: '+639171234567', app_metadata: {}, user_metadata: {} };
  let originalFetch;
  let originalUrl;
  let originalKey;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalUrl = process.env.SUPABASE_URL;
    originalKey = process.env.SUPABASE_ANON_KEY;
    process.env.SUPABASE_URL = 'https://supabase.test';
    process.env.SUPABASE_ANON_KEY = 'public-test-key';
  });

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalUrl === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = originalUrl;
    if (originalKey === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = originalKey;
  });

  it('maps a phone-only identity to a customer session', () => {
    const appUser = supabaseAppUser(phoneUser);
    expect(appUser.email).toBe('');
    expect(appUser.phone).toBe('+639171234567');
    expect(appUser.role).toBe('customer');
    expect(appUser.authProvider).toBe('supabase');
  });

  it('never lets phone metadata grant a privileged role', () => {
    const spoofed = { ...phoneUser, user_metadata: { role: 'admin', full_name: 'Spoof' } };
    expect(supabaseAppUser(spoofed).role).toBe('customer');
    expect(canOpenDashboard(supabaseAppUser(spoofed).role, 'staff')).toBe(false);
    expect(canOpenDashboard(supabaseAppUser(spoofed).role, 'admin')).toBe(false);
    expect(dashboardForRole(supabaseAppUser(spoofed).role)).toBe('home');
  });

  it('still honours a role assigned through trusted app_metadata', () => {
    expect(supabaseAppUser({ ...phoneUser, app_metadata: { role: 'admin' } }).role).toBe('admin');
  });

  it('authenticates a phone-only Supabase identity as a customer session', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'phone-user', phone: '+639171234567', app_metadata: {}, user_metadata: {} })
    });

    const app = express();
    app.get('/api/me', requireOrderAuth, (req, res) => res.json({ user: req.user, provider: req.authProvider }));

    const response = await request(app).get('/api/me').set('Authorization', 'Bearer phone-session-token');
    expect(response.status).toBe(200);
    expect(response.body.user).toMatchObject({ id: 'phone-user', role: 'customer', authProvider: 'supabase' });
    expect(response.body.provider).toBe('supabase');
  });

  it('still rejects a Supabase identity with neither email nor phone', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'no-contact' }) });

    const app = express();
    app.get('/api/me', requireOrderAuth, (req, res) => res.json({ user: req.user }));

    await request(app).get('/api/me').set('Authorization', 'Bearer bad-token').expect(401);
  });
});