import { dashboardForRole } from '../../shared/roles';

const KEY = 'bm-auth-return';
// A single allowlisted destination, never a caller-supplied URL.
export function rememberOrderReturn() {
  try { sessionStorage.setItem(KEY, 'order'); } catch { /* URL callback is a fallback. */ }
}
export function hasOrderReturn() {
  try {
    return sessionStorage.getItem(KEY) === 'order' || new URLSearchParams(window.location.search).get('authReturn') === 'order';
  } catch { return false; }
}
export function authCallbackUrl() {
  return window.location.origin + (hasOrderReturn() ? '/?authReturn=order' : '');
}
export function consumeAuthDestination(role) {
  const returnToOrder = hasOrderReturn();
  try { sessionStorage.removeItem(KEY); } catch { /* Storage may be disabled. */ }
  const url = new URL(window.location.href);
  url.searchParams.delete('authReturn');
  window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  return role === 'customer' && returnToOrder ? 'order' : dashboardForRole(role);
}
