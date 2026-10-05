import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { ROLES } from '../shared/roles.js';

// Admin-operated tool, never imported by browser/server request code.
const args = process.argv.slice(2);
const option = name => args[args.indexOf(name) + 1];
if (args.includes('--help') || !args.length) {
  console.log('Usage: node scripts/assign-supabase-role.mjs --user-id UUID --email existing@example.com --role customer|staff|admin');
  console.log('Requires SUPABASE_SERVICE_ROLE_KEY in this trusted terminal environment. Does not create accounts.');
  process.exit(0);
}
const id = args.includes('--user-id') ? option('--user-id') : '';
const email = args.includes('--email') ? option('--email').toLowerCase() : '';
const role = args.includes('--role') ? option('--role') : '';
try {
  if (!/^[a-f0-9-]{36}$/i.test(id) || !email.includes('@') || !ROLES.includes(role)) throw new Error('Provide the existing Supabase user UUID, matching email, and a valid role.');
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Configure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in this trusted environment. Never use a VITE_ prefix for the service key.');
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.admin.getUserById(id);
  if (error) throw error;
  if (data.user.email?.toLowerCase() !== email) throw new Error('UUID and email do not match; no role changed.');
  if (!data.user.email_confirmed_at) throw new Error('The account must confirm its email before role assignment.');
  const { error: updateError } = await client.auth.admin.updateUserById(id, {
    app_metadata: { ...data.user.app_metadata, role }
  });
  if (updateError) throw updateError;
  console.log(`Assigned ${role} to verified Supabase user ${id}. Sign out/in to refresh dashboard navigation.`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
