import { deploymentHostnames } from './deploymentOrigins.js';

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const TEST_SECRET = '1x0000000000000000000000000000000AA';
const configuredSecret = () => process.env.NODE_ENV !== 'production' && process.env.TURNSTILE_USE_TEST_KEYS === 'true'
  ? TEST_SECRET : process.env.TURNSTILE_SECRET_KEY;
const configuredHostnames = () => String(process.env.TURNSTILE_HOSTNAMES || '').split(',')
  .map(value => value.trim().toLowerCase()).filter(Boolean).concat(deploymentHostnames())
  .filter((value, index, all) => all.indexOf(value) === index);

export async function verifyWithCloudflare(token, secret) {
  const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }), signal: AbortSignal.timeout(10000)
  });
  if (!response.ok) throw Object.assign(new Error('Cloudflare Siteverify request failed.'), { status: response.status });
  return response.json();
}

export async function verifyTurnstileServerToken(token, {
  verifyToken = verifyWithCloudflare, secret = configuredSecret(), expectedHostnames = configuredHostnames()
} = {}) {
  const unavailable = { ok: false, status: 503, message: 'Security verification is temporarily unavailable. Please try again.' };
  if (typeof token !== 'string' || !token.trim() || token.length > 2048) return { ok: false, status: 400, message: 'Please complete the security verification.' };
  if (!secret) return unavailable;
  try {
    const result = await verifyToken(token.trim(), secret);
    if (result?.success !== true) return { ok: false, status: 400, message: 'Security verification failed. Please try again.' };
    if (expectedHostnames.length && !expectedHostnames.includes(String(result.hostname || '').toLowerCase())) return { ok: false, status: 400, message: 'Security verification failed. Please try again.' };
    if (process.env.NODE_ENV === 'production' && !expectedHostnames.length) return unavailable;
    return { ok: true };
  } catch (error) {
    const status = Number.isInteger(error?.status) ? `HTTP ${error.status}` : 'HTTP unknown';
    const name = String(error?.name || 'Error').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'Error';
    console.error(`[Turnstile] Siteverify request failed: ${status} ${name}`);
    return unavailable;
  }
}
