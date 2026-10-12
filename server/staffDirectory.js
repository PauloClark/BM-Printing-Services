import { createClient } from '@supabase/supabase-js';
import { roleFromSupabaseUser } from '../shared/roles.js';

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw Object.assign(new Error('Staff directory is missing its Supabase project URL.'), { status: 503, code: 'SUPABASE_URL_MISSING' });
  if (!key) throw Object.assign(new Error('Staff directory is not configured. Set SUPABASE_SERVICE_ROLE_KEY in the backend environment only.'), { status: 503, code: 'SUPABASE_ADMIN_KEY_MISSING' });
  try { new URL(url); } catch { throw Object.assign(new Error('The configured Supabase project URL is invalid.'), { status: 503, code: 'SUPABASE_URL_INVALID' }); }
  // Supabase JS accepts both current sb_secret_ keys and legacy service_role JWTs.
  // Do not parse or expose the credential; let the Auth Admin API authenticate it.
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
function adminApiError(error, fallback) {
  const status = Number(error?.status || error?.code || 0);
  const message = String(error?.message || '').toLowerCase();
  if (status === 401 || message.includes('invalid api key') || message.includes('invalid jwt')) {
    return Object.assign(new Error('Supabase rejected the staff directory credentials. Verify the project URL and server secret belong to the same project.'), { status: 503, code: 'SUPABASE_ADMIN_CREDENTIALS_INVALID' });
  }
  if (status === 403 || message.includes('permission')) {
    return Object.assign(new Error('The configured Supabase credential does not have Auth Admin permission.'), { status: 503, code: 'SUPABASE_ADMIN_PERMISSION_DENIED' });
  }
  if (message.includes('fetch') || message.includes('network') || message.includes('timeout')) {
    return Object.assign(new Error('The Supabase Auth Admin API is currently unreachable.'), { status: 503, code: 'SUPABASE_ADMIN_UNREACHABLE' });
  }
  return Object.assign(new Error(fallback), { status: 503, code: 'SUPABASE_ADMIN_API_ERROR' });
}
const eligible = user => user && roleFromSupabaseUser(user) === 'staff' && user.email_confirmed_at &&
  !user.deleted_at && !(user.banned_until && new Date(user.banned_until) > new Date());
const summary = user => ({ id: user.id, name: user.user_metadata?.full_name || user.user_metadata?.name || user.email, email: user.email });
export async function listAssignableStaff() {
  const client = adminClient(), staff = [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw adminApiError(error, 'Supabase returned an error while listing authorized staff accounts.');
    staff.push(...data.users.filter(eligible).map(summary));
    if (data.users.length < 100) break;
  }
  return staff;
}
export async function verifyAssignableStaff(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw Object.assign(new Error('Select a valid staff account.'), { status: 400 });
  const { data, error } = await adminClient().auth.admin.getUserById(id);
  if (error) throw adminApiError(error, 'Supabase returned an error while verifying the staff account.');
  if (!eligible(data.user)) throw Object.assign(new Error('The selected account is not an active, confirmed staff account.'), { status: 400 });
  return summary(data.user);
}

export async function updateStaffPassword(id, password) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw Object.assign(new Error('Invalid staff account.'), { status: 400 });
  if (typeof password !== 'string' || password.length < 8 || password.length > 100) throw Object.assign(new Error('Password must contain 8–100 characters.'), { status: 400 });
  const { data, error } = await adminClient().auth.admin.updateUserById(id, { password });
  if (error || !data?.user?.id) throw adminApiError(error, 'Supabase could not update the staff password. Check the project password policy and try again.');
  return summary(data.user);
}
