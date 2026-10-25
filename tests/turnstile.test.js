import { requireTurnstileToken, TURNSTILE_ERRORS } from '../src/utils/turnstile.js';
import { verifyTurnstileServerToken, verifyWithCloudflare, TURNSTILE_SITEVERIFY_URL } from '../server/turnstileVerify.js';
import { readFileSync } from 'node:fs';

describe('Turnstile security integration', () => {
  it('blocks missing, expired, and unavailable client challenges', () => {
    expect(() => requireTurnstileToken('', 'expired')).toThrow(TURNSTILE_ERRORS.missing);
    expect(() => requireTurnstileToken('', 'unavailable')).toThrow(TURNSTILE_ERRORS.unavailable);
    expect(requireTurnstileToken('one-time-token', 'ready')).toBe('one-time-token');
  });

  it('accepts only a successful Siteverify response for an allowed hostname', async () => {
    const valid = jest.fn().mockResolvedValue({ success: true, hostname: 'staging.example.com' });
    await expect(verifyTurnstileServerToken('token', { verifyToken: valid, secret: 'server-secret', expectedHostnames: ['staging.example.com'] })).resolves.toEqual({ ok: true });
    await expect(verifyTurnstileServerToken('token', { verifyToken: valid, secret: 'server-secret', expectedHostnames: ['other.example.com'] })).resolves.toMatchObject({ ok: false, status: 400 });
    for (const token of ['', 'x'.repeat(2049)]) await expect(verifyTurnstileServerToken(token, { secret: 'server-secret' })).resolves.toMatchObject({ ok: false, status: 400 });
  });

  it('rejects invalid, expired, reused, and unavailable server challenges safely', async () => {
    for (const code of ['invalid-input-response', 'timeout-or-duplicate']) {
      const verifyToken = jest.fn().mockResolvedValue({ success: false, 'error-codes': [code] });
      await expect(verifyTurnstileServerToken('token', { verifyToken, secret: 'server-secret' })).resolves.toMatchObject({ ok: false, status: 400 });
    }
    await expect(verifyTurnstileServerToken('token', { verifyToken: jest.fn().mockRejectedValue(new Error('provider detail')), secret: 'server-secret' })).resolves.toMatchObject({ ok: false, status: 503 });
    await expect(verifyTurnstileServerToken('token', { secret: '' })).resolves.toMatchObject({ ok: false, status: 503 });
  });

  it('posts the token and backend secret directly to Cloudflare Siteverify', async () => {
    const originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
    try {
      await verifyWithCloudflare('browser-token', 'backend-secret');
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toBe(TURNSTILE_SITEVERIFY_URL);
      expect(options.body.get('response')).toBe('browser-token');
      expect(options.body.get('secret')).toBe('backend-secret');
    } finally { global.fetch = originalFetch; }
  });

  it('resets widgets after attempts and forwards CAPTCHA through Supabase actions', () => {
    const widget = readFileSync('src/components/Common/TurnstileWidget.jsx', 'utf8');
    const login = readFileSync('src/components/Pages/LoginPage.jsx', 'utf8');
    const register = readFileSync('src/components/Pages/RegisterPage.jsx', 'utf8');
    const phone = readFileSync('src/components/Common/PhoneOtpPanel.jsx', 'utf8');
    const actions = readFileSync('src/utils/authActions.js', 'utf8');
    expect(widget).toContain('window.turnstile?.reset');
    for (const source of [login, register, phone]) expect(source).toMatch(/setCaptchaReset/);
    expect(actions.match(/captchaToken/g).length).toBeGreaterThanOrEqual(3);
  });
});
