import { supabaseAppUser } from '../../shared/roles';
import { normalizePhoneNumber, phoneOtpErrorMessage, PHONE_OTP_ERRORS } from './phoneAuth';

export async function signInAccount(client, email, password, legacyLogin) {
  const { data, error } = await client.auth.signInWithPassword({ email: email.trim(), password });
  if (!error && data.user) return supabaseAppUser(data.user);
  // Only legacy credentials may fall back. Never bypass MFA, unconfirmed email,
  // rate limits or a provider outage via the compatibility endpoint.
  if (error?.code !== 'invalid_credentials' || !legacyLogin) throw error || new Error('Unable to login.');
  return legacyLogin();
}

export async function registerCustomer(client, form, redirectTo) {
  const { data, error } = await client.auth.signUp({
    email: form.email.trim(), password: form.password,
    options: { emailRedirectTo: redirectTo,
      data: { full_name: form.name.trim(), phone: (form.phone || '').trim() } }
  });
  if (error) throw error;
  return data;
}

// Supabase Phone Auth. GoTrue generates, expires and verifies the OTP; the code
// is never created, stored or checked in the browser. Returns the E.164 number
// actually sent so the UI can display exactly what the provider received.
export async function requestPhoneOtp(client, rawPhone) {
  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized.ok) throw new Error(PHONE_OTP_ERRORS.invalidPhone);

  const { error } = await client.auth.signInWithOtp({
    phone: normalized.e164,
    options: { shouldCreateUser: true }
  });
  if (error) throw new Error(phoneOtpErrorMessage(error, 'send'));

  return normalized.e164;
}

export async function verifyPhoneOtp(client, rawPhone, token) {
  const normalized = normalizePhoneNumber(rawPhone);
  if (!normalized.ok) throw new Error(PHONE_OTP_ERRORS.invalidPhone);

  const code = String(token || '').trim();
  if (!/^\d{6}$/.test(code)) throw new Error(PHONE_OTP_ERRORS.missingCode);

  const { data, error } = await client.auth.verifyOtp({
    phone: normalized.e164,
    token: code,
    type: 'sms'
  });
  if (error) throw new Error(phoneOtpErrorMessage(error, 'verify'));
  if (!data?.user) throw new Error(PHONE_OTP_ERRORS.invalidCode);

  return supabaseAppUser(data.user);
}
