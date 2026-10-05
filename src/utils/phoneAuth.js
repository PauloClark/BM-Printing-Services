// Philippine phone helpers for Supabase Phone Auth.
//
// Security notes:
// - OTP codes are never generated, stored, logged or validated here. Supabase
//   GoTrue owns code generation, expiry, resend limits and verification.
// - No SMS provider secret is read or referenced in this file (or any file
//   under src/). Supabase holds provider credentials in its own dashboard.

export const PHONE_OTP_ERRORS = {
  invalidPhone: 'Enter a valid Philippine mobile number, e.g. 0917 123 4567.',
  sendFailed: 'Unable to send your verification code right now. Please try again.',
  invalidCode: 'That verification code is incorrect. Please check and try again.',
  expiredCode: 'That verification code has expired. Please request a new one.',
  rateLimited: 'Too many requests. Please wait a moment before requesting another code.',
  providerUnavailable: 'Text messaging is temporarily unavailable. Please try again later.',
  notEnabled: 'Phone sign-in is not enabled yet. Please use email or Google to sign in.',
  network: 'Network error. Please check your connection and try again.',
  missingCode: 'Enter the verification code from your SMS message.'
};

// Supabase enforces a 60s OTP expiry/resend window by default.
export const PHONE_OTP_RESEND_SECONDS = 60;

/**
 * Normalizes common Philippine mobile input to E.164 (+639XXXXXXXXX).
 * Accepts 09171234567, +639171234567, 639171234567 and 9171234567.
 * Rejects letters, unsupported country codes and wrong subscriber lengths.
 */
export function normalizePhoneNumber(input) {
  if (typeof input !== 'string') return { ok: false, reason: 'invalid' };

  const cleaned = input.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d+$/.test(cleaned)) return { ok: false, reason: 'invalid' };

  let digits = cleaned.startsWith('+') ? cleaned.slice(1) : cleaned;
  if (digits.startsWith('63')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);

  // Philippine mobile subscriber numbers are 10 digits beginning with 9.
  if (!/^9\d{9}$/.test(digits)) return { ok: false, reason: 'invalid' };

  return { ok: true, e164: `+63${digits}` };
}

// Maps provider/transport failures to safe, customer-facing copy. Raw provider
// errors are never surfaced to the browser. Explicit Supabase codes are matched
// first because GoTrue reuses one message ("Token has expired or is invalid")
// for both an expired code and a wrong code.
export function phoneOtpErrorMessage(error, action = 'send') {
  const code = String(error?.code || '').toLowerCase();
  const message = String(error?.message || '').toLowerCase();

  if (code === 'otp_expired') return PHONE_OTP_ERRORS.expiredCode;
  if (code === 'invalid_token' || code === 'otp_verification_failed' || code === 'email_otp_verification_failed') {
    return PHONE_OTP_ERRORS.invalidCode;
  }
  if (code === 'over_request_rate_limit' || code === 'over_sms_send_rate_limit' || code === 'over_email_send_rate_limit') {
    return PHONE_OTP_ERRORS.rateLimited;
  }
  if (code === 'sms_provider_unavailable' || code === 'sms_send_failed') return PHONE_OTP_ERRORS.providerUnavailable;
  if (code === 'sms_signups_disabled' || code === 'phone_signups_disabled' || code === 'phone_provider_disabled') {
    return PHONE_OTP_ERRORS.notEnabled;
  }

  // Fall back to message heuristics only when the provider gave no specific code.
  if (message.includes('expired')) return PHONE_OTP_ERRORS.expiredCode;
  if (message.includes('rate limit') || message.includes('too many')) return PHONE_OTP_ERRORS.rateLimited;
  if (message.includes('provider')) return PHONE_OTP_ERRORS.providerUnavailable;
  if (message.includes('not enabled') || message.includes('disabled')) return PHONE_OTP_ERRORS.notEnabled;
  if (message.includes('fetch') || message.includes('network') || message.includes('timeout')) {
    return PHONE_OTP_ERRORS.network;
  }

  return action === 'verify' ? PHONE_OTP_ERRORS.invalidCode : PHONE_OTP_ERRORS.sendFailed;
}