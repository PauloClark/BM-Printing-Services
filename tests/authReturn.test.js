import { rememberOrderReturn, hasOrderReturn, consumeAuthDestination, authCallbackUrl } from '../src/utils/authReturn';

beforeEach(() => {
  const values = new Map();
  global.sessionStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
  global.window = { location: { origin: 'https://bm.example', href: 'https://bm.example/#login', search: '' }, history: { replaceState: jest.fn() } };
});
afterEach(() => { delete global.window; delete global.sessionStorage; });
it('returns customers to orders once and preserves OAuth/verification callback intent', () => {
  rememberOrderReturn();
  expect(authCallbackUrl()).toBe('https://bm.example/?authReturn=order');
  expect(consumeAuthDestination('customer')).toBe('order');
  expect(hasOrderReturn()).toBe(false);
  expect(consumeAuthDestination('customer')).toBe('home');
});
it('supports verification opened in another tab', () => {
  window.location.search = '?authReturn=order';
  window.location.href = 'https://bm.example/?authReturn=order';
  expect(consumeAuthDestination('customer')).toBe('order');
  expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/');
});
it('rejects arbitrary redirects and preserves staff/admin destinations', () => {
  sessionStorage.setItem('bm-auth-return', 'https://evil.example');
  window.location.search = '?authReturn=https://evil.example';
  expect(consumeAuthDestination('customer')).toBe('home');
  for (const role of ['staff', 'admin']) { rememberOrderReturn(); expect(consumeAuthDestination(role)).toBe(role); }
});
