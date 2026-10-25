export const TURNSTILE_ERRORS = {
  missing: 'Please complete the security verification.',
  unavailable: 'Security verification is temporarily unavailable. Please try again.',
  hostname: 'Security verification is not configured for this website address. Contact the administrator.'
};

export const turnstileStatusMessage = status => status === 'hostname-not-authorized'
  ? TURNSTILE_ERRORS.hostname
  : status === 'unavailable' ? TURNSTILE_ERRORS.unavailable : TURNSTILE_ERRORS.missing;

export function requireTurnstileToken(token, status) {
  if (!token) throw new Error(turnstileStatusMessage(status));
  return token;
}
