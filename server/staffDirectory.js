import { createClient } from '@supabase/supabase-js';
import { roleFromSupabaseUser } from '../shared/roles.js';

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Object.assign(new Error('Staff directory is not configured. Set SUPABASE_SERVICE_ROLE_KEY in the backend environment only.'), { status: 503 });
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
const eligible = user => user && roleFromSupabaseUser(user) === 'staff' && user.email_confirmed_at &&
  !user.deleted_at && !(user.banned_until && new Date(user.banned_until) > new Date());
const summary = user => ({ id: user.id, name: user.user_metadata?.full_name || user.user_metadata?.name || user.email, email: user.email });
export async function listAssignableStaff() {
  const client = adminClient(), staff = [];
  for (let page = 1; ; page++) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw Object.assign(new Error('Unable to retrieve authorized staff accounts.'), { status: 503 });
    staff.push(...data.users.filter(eligible).map(summary));
    if (data.users.length < 100) break;
  }
  return staff;
}
export async function verifyAssignableStaff(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) throw Object.assign(new Error('Select a valid staff account.'), { status: 400 });
  const { data, error } = await adminClient().auth.admin.getUserById(id);
  if (error) throw Object.assign(new Error('Staff verification failed. Refresh the employee list.'), { status: 503 });
  if (!eligible(data.user)) throw Object.assign(new Error('The selected account is not an active, confirmed staff account.'), { status: 400 });
  return summary(data.user);
}
