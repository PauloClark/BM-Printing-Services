import { createTurnstileAttempt, requireTurnstileToken } from '../src/utils/turnstile.js';
import { signInAccount, registerCustomer } from '../src/utils/authActions.js';

const user = { id: 'qa-admin', email: 'admin@example.test', app_metadata: { role: 'admin' } };

describe('password authentication CAPTCHA lifecycle', () => {
  let attempt, reset, client;
  beforeEach(() => {
    attempt = createTurnstileAttempt();
    reset = jest.fn();
    client = { auth: {
      signInWithPassword: jest.fn().mockResolvedValue({ data: { user }, error: null }),
      signUp: jest.fn().mockResolvedValue({ data: { user, session: null }, error: null })
    } };
  });

  const login = async (attempt, client, token, status, reset) => {
    const freshToken = attempt.take(token, status);
    if (freshToken === null) return;
    try { return await signInAccount(client, ' admin@example.test ', 'password', freshToken); }
    finally { attempt.finish(reset); }
  };

  it('forwards the exact response once and preserves the Admin role', async () => {
    await expect(login(attempt, client, 'fresh-response', 'ready', reset)).resolves.toMatchObject({ role: 'admin' });
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'admin@example.test', password: 'password', options: { captchaToken: 'fresh-response' }
    });
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['', 'ready'], ['   ', 'ready'], [undefined, 'ready'],
    ['stale-response', 'loading'], ['stale-response', 'expired'],
    ['stale-response', 'unavailable'], ['stale-response', 'hostname-not-authorized']
  ])('blocks an invalid challenge (%p, %p) before authentication', async (token, status) => {
    await expect(login(attempt, client, token, status, reset)).rejects.toThrow();
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled();
    expect(reset).not.toHaveBeenCalled();
  });

  it('blocks a second request synchronously while the first is pending', async () => {
    let resolve;
    client.auth.signInWithPassword.mockReturnValue(new Promise(done => { resolve = done; }));
    const first = login(attempt, client, 'fresh-response', 'ready', reset);
    await login(attempt, client, 'fresh-response', 'ready', reset);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    resolve({ data: { user }, error: null });
    await first;
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it.each(['invalid_credentials', 'captcha protection: request disallowed (invalid-input-response)',
    'captcha protection: request disallowed (timeout-or-duplicate)'])('resets after %s and retries only with a new response', async message => {
    client.auth.signInWithPassword.mockResolvedValueOnce({ data: {}, error: new Error(message) });
    await expect(login(attempt, client, 'consumed-response', 'ready', reset)).rejects.toThrow(message);
    expect(reset).toHaveBeenCalledTimes(1);
    await expect(login(attempt, client, 'consumed-response', 'ready', reset)).rejects.toThrow();
    await expect(login(attempt, client, '', 'loading', reset)).rejects.toThrow();
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(1);
    await login(attempt, client, 'new-response', 'ready', reset);
    expect(client.auth.signInWithPassword).toHaveBeenCalledTimes(2);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('resets on a network exception and rejects reuse after success', async () => {
    client.auth.signInWithPassword.mockRejectedValueOnce(new Error('Network unavailable'));
    await expect(login(attempt, client, 'network-response', 'ready', reset)).rejects.toThrow('Network unavailable');
    await login(attempt, client, 'success-response', 'ready', reset);
    await expect(login(attempt, client, 'success-response', 'ready', reset)).rejects.toThrow();
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('preserves registration options and consumes the signup token', async () => {
    const token = attempt.take('signup-response', 'ready');
    try {
      await registerCustomer(client, { email: ' customer@example.test ', password: 'password', name: ' Customer ' },
        'https://bm-printing-services.vercel.app/auth/confirm', token);
    } finally { attempt.finish(reset); }
    expect(client.auth.signUp).toHaveBeenCalledWith({
      email: 'customer@example.test', password: 'password', options: {
        captchaToken: 'signup-response', emailRedirectTo: 'https://bm-printing-services.vercel.app/auth/confirm',
        data: { full_name: 'Customer', phone: '' }
      }
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(() => attempt.take('signup-response', 'ready')).toThrow();
    expect(requireTurnstileToken('new-signup-response', 'ready')).toBe('new-signup-response');
  });
});
