import { createClient } from '@supabase/supabase-js';
import { roleFromSupabaseUser } from '../shared/roles.js';
import { Employee, User } from './db.js';

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
const legacyEmail = () => (process.env.LEGACY_STAFF_ACCOUNT_EMAIL || 'staff@bmprinting.com').trim().toLowerCase();
const isLegacySharedAccount = user => user?.email?.trim().toLowerCase() === legacyEmail();
const activeConfirmed = user => user?.email && user.email_confirmed_at && !user.deleted_at &&
  !(user.banned_until && new Date(user.banned_until) > new Date());
const activeVerifiedIdentity = user => Boolean(user && !user.deleted_at &&
  !(user.banned_until && new Date(user.banned_until) > new Date()) &&
  (user.email_confirmed_at || user.phone_confirmed_at));
const canAuthorize = user => activeConfirmed(user) && !isLegacySharedAccount(user) &&
  !['staff', 'admin'].includes(roleFromSupabaseUser(user));
const summary = user => ({ id: user.id, name: user.user_metadata?.full_name || user.user_metadata?.name || user.email, email: user.email });
async function listAllAuthUsers(client = adminClient()) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw adminApiError(error, 'Supabase returned an error while listing staff accounts.');
    users.push(...data.users);
    if (data.users.length < 100) return users;
  }
}
export async function listNotificationAdmins() {
  const legacyAdmins = await User.find({ role: 'admin' }).select('id name email').lean();
  const recipients = new Map(legacyAdmins.map(user => [user.id, { id: user.id, role: 'admin' }]));
  for (let page = 1; page <= 100; page++) {
    const { data, error } = await adminClient().auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw adminApiError(error, 'Supabase returned an error while resolving Admin notification recipients.');
    for (const user of data.users) {
      if (roleFromSupabaseUser(user) === 'admin' && activeVerifiedIdentity(user)) recipients.set(user.id, { id: user.id, role: 'admin' });
    }
    if (data.users.length < 100) return [...recipients.values()];
  }
  throw Object.assign(new Error('Admin recipient directory exceeded its safe page limit.'), { code: 'ADMIN_DIRECTORY_LIMIT' });
}

export async function isAuthorizedNotificationRecipient(role, id) {
  if (!id || !['admin', 'staff', 'customer'].includes(role)) return false;
  if (role === 'admin' || role === 'customer') {
    const legacy = await User.findOne({ id, role }).select('id').lean();
    if (legacy) return true;
  }
  if (role === 'staff') {
    const employee = await Employee.findOne({ active: true, archived: { $ne: true }, $or: [{ supabaseUserId: id }, { linkedUserId: id }] }).select('supabaseUserId linkedUserId').lean();
    if (!employee) return false;
  }
  const { data, error } = await adminClient().auth.admin.getUserById(id);
  if (error && Number(error.status) === 404) return false;
  if (error) throw adminApiError(error, 'Supabase could not verify a notification recipient.');
  const user = data?.user;
  return activeVerifiedIdentity(user) && roleFromSupabaseUser(user) === role;
}
export async function listAssignableStaff() {
  return (await listAllAuthUsers()).filter(user => eligible(user) && !isLegacySharedAccount(user)).map(summary);
}
export async function listStaffAccountCandidates() {
  return (await listAllAuthUsers()).filter(canAuthorize).map(user => ({ ...summary(user), role: roleFromSupabaseUser(user) }));
}
export async function authorizeExistingStaffAccount({ id, email }) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id) || typeof email !== 'string' || !/^\S+@\S+\.\S+$/.test(email.trim())) {
    throw Object.assign(new Error('Select an existing account and confirm its email.'), { status: 400 });
  }
  const client = adminClient();
  const { data, error } = await client.auth.admin.getUserById(id);
  if (error || !data?.user) throw adminApiError(error, 'Unable to verify the selected account. Refresh the account list.');
  const user = data.user;
  if (user.email?.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw Object.assign(new Error('The selected account email changed. Refresh the account list.'), { status: 409 });
  }
  if (!canAuthorize(user)) throw Object.assign(new Error('Only confirmed, active, non-admin accounts can be authorized as staff.'), { status: 400 });
  const { data: updated, error: updateError } = await client.auth.admin.updateUserById(id, {
    app_metadata: { ...user.app_metadata, role: 'staff' }
  });
  if (updateError || !updated?.user?.id) throw adminApiError(updateError, 'Unable to authorize the selected account as staff.');
  return { ...summary(updated.user), previousRole: roleFromSupabaseUser(user) };
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
