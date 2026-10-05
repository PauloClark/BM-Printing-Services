export const TURNSTILE_ERRORS = {
  missing: 'Please complete the security verification.',
  failed: 'Security verification failed. Please try again.',
  unavailable: 'Security verification is temporarily unavailable. Please try again.'
};

export async function verifyTurnstileToken(token) {
  let response;
  try {
    response = await fetch('/api/turnstile/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
  } catch {
    throw new Error(TURNSTILE_ERRORS.unavailable);
  }

  const result = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(response.status === 400
      ? TURNSTILE_ERRORS.failed
      : TURNSTILE_ERRORS.unavailable);
  }
  if (result?.success !== true) {
    throw new Error(TURNSTILE_ERRORS.failed);
  }
}