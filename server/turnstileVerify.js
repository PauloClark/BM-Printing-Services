// Shared Cloudflare Turnstile Siteverify helper.
//
// The public Contact form must not duplicate verification logic, so this is
// extracted from the /api/turnstile/verify route and reused by any endpoint
// that needs to gate a public submission. The secret is read from the
// server-side environment only and is never returned to the browser.

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyWithCloudflare(token, secret) {
  const response = await fetch(TURNSTILE_SITEVERIFY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ secret, response: token }),
    signal: AbortSignal.timeout(10000)
  });

  if (!response.ok) {
    const error = new Error('Cloudflare Siteverify request failed.');
    error.status = response.status;
    throw error;
  }

  return response.json();
}

// Verifies a caller-supplied token against the server-side secret.
// Returns { ok: true } or { ok: false, status, message } with safe copy only.
export async function verifyTurnstileServerToken(
  token,
  { verifyToken = verifyWithCloudflare, secret = process.env.TURNSTILE_SECRET_KEY } = {}
) {
  const unavailable = { ok: false, status: 503, message: 'Security verification is temporarily unavailable. Please try again.' };

  if (typeof token !== 'string' || !token.trim()) {
    return { ok: false, status: 400, message: 'Please complete the security verification.' };
  }
  if (!secret) return unavailable;

  try {
    const result = await verifyToken(token.trim(), secret);
    if (result?.success === true) return { ok: true };
    return { ok: false, status: 400, message: 'Security verification failed. Please try again.' };
  } catch (error) {
    const status = Number.isInteger(error?.status) ? `HTTP ${error.status}` : 'HTTP unknown';
    const name = String(error?.name || 'Error').replace(/[^a-z0-9_-]/gi, '').slice(0, 40) || 'Error';
    console.error(`[Turnstile] Siteverify request failed: ${status} ${name}`);
    return unavailable;
  }
}