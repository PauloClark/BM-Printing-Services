import '../server/loadEnv.js';

const required = [
  'MONGODB_URI', 'MONGODB_DB_NAME', 'JWT_SECRET', 'FRONTEND_ORIGINS',
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
  'VITE_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAMES'
];
const placeholders = /^(your_|change-this|https:\/\/YOUR_|mongodb:\/\/127\.0\.0\.1)/i;
const missing = required.filter(name => !process.env[name]?.trim());
const unsafe = required.filter(name => process.env[name] && placeholders.test(process.env[name]));
const errors = [];
if (missing.length) errors.push(`Missing: ${missing.join(', ')}`);
if (unsafe.length) errors.push(`Placeholder/development values: ${unsafe.join(', ')}`);
if (process.env.ALLOW_IN_MEMORY_DB !== 'false') errors.push('ALLOW_IN_MEMORY_DB must be false.');
if (process.env.SEED_DEFAULT_ADMIN !== 'false') errors.push('SEED_DEFAULT_ADMIN must be false.');
if (!['true', 'false'].includes(process.env.ALLOW_LEGACY_AUTH || '')) errors.push('ALLOW_LEGACY_AUTH must be explicitly true or false.');
if (process.env.ALLOW_LEGACY_AUTH === 'true' && process.env.LEGACY_ADMIN_AUTH_APPROVED !== 'true') errors.push('Legacy Admin login requires LEGACY_ADMIN_AUTH_APPROVED=true until the Admin account is migrated to Supabase.');
if (process.env.ALLOW_LEGACY_REGISTRATION !== 'false') errors.push('ALLOW_LEGACY_REGISTRATION must be false; customer registration is handled by Supabase.');
if (process.env.TURNSTILE_USE_TEST_KEYS === 'true' || process.env.VITE_TURNSTILE_USE_TEST_KEYS === 'true') errors.push('Turnstile test keys must be disabled.');
if (process.env.MONGODB_URI && !/^mongodb\+srv:\/\//i.test(process.env.MONGODB_URI)) errors.push('Staging MONGODB_URI must use an Atlas mongodb+srv connection string.');
if (process.env.MONGODB_DB_NAME !== 'bmprinting') errors.push('MONGODB_DB_NAME must be bmprinting.');
if (process.env.TURNSTILE_HOSTNAMES && process.env.TURNSTILE_HOSTNAMES.split(',').some(value => /:\/\/|\/|:\d/.test(value.trim()))) errors.push('TURNSTILE_HOSTNAMES must contain hostnames only, without schemes, paths, or ports.');
if (errors.length) {
  console.error('Deployment environment validation failed.');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log('Deployment environment validation passed. Secret values were not printed.');
