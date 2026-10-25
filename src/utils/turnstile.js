export const TURNSTILE_ERRORS = {
  missing: 'Please complete the security verification.',
  unavailable: 'Security verification is temporarily unavailable. Please try again.',
  hostname: 'Security verification is not configured for this website address. Contact the administrator.'
};

export const turnstileStatusMessage = status => status === 'hostname-not-authorized'
  ? TURNSTILE_ERRORS.hostname
  : status === 'unavailable' ? TURNSTILE_ERRORS.unavailable : TURNSTILE_ERRORS.missing;

export function requireTurnstileToken(token, status) {
  if (status !== 'ready' || typeof token !== 'string' || !token.trim()) throw new Error(turnstileStatusMessage(status));
  return token;
}

// A synchronous lock is needed before React commits the disabled button state.
// Keep the consumed token after completion so a stale callback cannot reuse it.
export function createTurnstileAttempt() {
  let pending = false;
  let consumedToken;
  return {
    take(token, status) {
      if (pending) return null;
      const verified = requireTurnstileToken(token, status);
      if (verified === consumedToken) throw new Error(TURNSTILE_ERRORS.missing);
      consumedToken = verified;
      pending = true;
      return verified;
    },
    finish(reset) {
      try { reset(); } finally { pending = false; }
    }
  };
}
