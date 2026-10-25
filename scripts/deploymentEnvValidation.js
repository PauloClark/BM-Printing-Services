const frontendRequired = [
  'DEPLOYMENT_ENVIRONMENT', 'DEPLOYMENT_HOSTING_MODE', 'VITE_API_BASE_URL', 'VITE_PUBLIC_APP_URL',
  'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_TURNSTILE_SITE_KEY'
];
const backendRequired = [
  'DEPLOYMENT_ENVIRONMENT', 'DEPLOYMENT_HOSTING_MODE', 'MONGODB_URI', 'MONGODB_DB_NAME', 'JWT_SECRET',
  'FRONTEND_ORIGINS', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_STORAGE_BUCKET', 'TURNSTILE_SECRET_KEY', 'TURNSTILE_HOSTNAMES', 'NOTIFICATION_WORKER_ENABLED'
];

const present = (env, key) => typeof env[key] === 'string' && env[key].trim().length > 0;
const isPlaceholder = value => /^(your_|change-this|https:\/\/YOUR_|mongodb:\/\/127\.0\.0\.1)/i.test(String(value || '').trim());
const httpsOrigin = value => {
  try {
    const normalized = String(value || '').trim().replace(/\/$/, '');
    const url = new URL(normalized);
    return url.protocol === 'https:' && url.origin === normalized && !url.username && !url.password
      ? url.origin.toLowerCase() : null;
  } catch { return null; }
};

export function validateDeploymentEnvironment(env = process.env, mode = 'deployment', target = 'all') {
  const errors = [];
  if (!['local', 'deployment'].includes(mode)) return [`Unknown validation mode: ${mode}. Use local or deployment.`];
  if (!['all', 'frontend', 'backend'].includes(target)) return [`Unknown validation target: ${target}. Use frontend, backend, or all.`];
  if (present(env, 'VITE_SUPABASE_SERVICE_ROLE_KEY')) {
    errors.push('VITE_SUPABASE_SERVICE_ROLE_KEY must not be set; service-role credentials must remain server-only.');
  }
  if (mode === 'local') return errors;

  const required = target === 'frontend' ? frontendRequired
    : target === 'backend' ? backendRequired
      : [...new Set([...frontendRequired, ...backendRequired])];
  const missing = required.filter(key => !present(env, key));
  if (missing.length) errors.push(`Missing: ${missing.join(', ')}`);
  const unsafe = required.filter(key => present(env, key) && isPlaceholder(env[key]));
  if (unsafe.length) errors.push(`Placeholder/development values: ${unsafe.join(', ')}`);
  if (present(env, 'DEPLOYMENT_HOSTING_MODE') && env.DEPLOYMENT_HOSTING_MODE !== 'split') {
    errors.push('DEPLOYMENT_HOSTING_MODE must be split for the approved Vercel frontend and persistent API architecture.');
  }
  if (present(env, 'DEPLOYMENT_ENVIRONMENT') && !['staging', 'production'].includes(env.DEPLOYMENT_ENVIRONMENT)) {
    errors.push('DEPLOYMENT_ENVIRONMENT must be staging or production.');
  }
  if (env.TURNSTILE_USE_TEST_KEYS === 'true' || env.VITE_TURNSTILE_USE_TEST_KEYS === 'true') errors.push('Turnstile test keys must be disabled in deployment environments.');

  if (target !== 'backend') {
    const apiOrigin = httpsOrigin(env.VITE_API_BASE_URL);
    const appOrigin = httpsOrigin(env.VITE_PUBLIC_APP_URL);
    if (present(env, 'VITE_API_BASE_URL') && !apiOrigin) errors.push('VITE_API_BASE_URL must be an exact HTTPS API origin without a path or credentials.');
    if (present(env, 'VITE_PUBLIC_APP_URL') && !appOrigin) errors.push('VITE_PUBLIC_APP_URL must be an exact HTTPS frontend origin without a path or credentials.');
    if (apiOrigin && appOrigin && apiOrigin === appOrigin) errors.push('VITE_API_BASE_URL must use the separate persistent API origin.');
  }

  if (target !== 'frontend') {
    if (present(env, 'VERCEL')) errors.push('The backend target must run on the persistent API host, not a Vercel function runtime.');
    const uri = String(env.MONGODB_URI || '').trim();
    if (uri && !/^mongodb\+srv:\/\//i.test(uri)) errors.push('MONGODB_URI must use the configured remote Atlas mongodb+srv connection string.');
    const requiredDatabase = env.DEPLOYMENT_ENVIRONMENT === 'staging' ? 'bmprinting_staging'
      : env.DEPLOYMENT_ENVIRONMENT === 'production' ? 'bmprinting' : null;
    if (requiredDatabase && env.MONGODB_DB_NAME !== requiredDatabase) {
      errors.push(`MONGODB_DB_NAME must be ${requiredDatabase} for ${env.DEPLOYMENT_ENVIRONMENT}.`);
    }
    if (present(env, 'SUPABASE_STORAGE_BUCKET') && !/^[a-z0-9][a-z0-9._-]{0,61}[a-z0-9]$/.test(env.SUPABASE_STORAGE_BUCKET.trim())) errors.push('SUPABASE_STORAGE_BUCKET must be a valid bucket name.');
    if (present(env, 'JWT_SECRET') && env.JWT_SECRET.length < 32) errors.push('JWT_SECRET must contain at least 32 characters.');
    if (present(env, 'FRONTEND_ORIGINS')) {
      const origins = env.FRONTEND_ORIGINS.split(',').map(origin => origin.trim()).filter(Boolean);
      if (!origins.length || origins.some(origin => !httpsOrigin(origin))) errors.push('FRONTEND_ORIGINS must contain exact HTTPS origins without paths or credentials.');
      if (origins.some(origin => /localhost|127\.0\.0\.1/i.test(origin))) errors.push('FRONTEND_ORIGINS must not include local development origins in a deployment environment.');
    }
    if (present(env, 'TURNSTILE_HOSTNAMES') && env.TURNSTILE_HOSTNAMES.split(',').some(value => !/^[a-z0-9.-]+$/i.test(value.trim()))) errors.push('TURNSTILE_HOSTNAMES must contain hostnames only, without schemes, ports, or paths.');
    if (env.NOTIFICATION_WORKER_ENABLED !== 'true') errors.push('NOTIFICATION_WORKER_ENABLED must be true on the persistent API host.');
    if (env.ALLOW_IN_MEMORY_DB !== 'false') errors.push('ALLOW_IN_MEMORY_DB must be false.');
    if (env.SEED_DEFAULT_ADMIN !== 'false') errors.push('SEED_DEFAULT_ADMIN must be false.');
    if (!['true', 'false'].includes(env.ALLOW_LEGACY_AUTH || '')) errors.push('ALLOW_LEGACY_AUTH must be explicitly true or false.');
    if (env.ALLOW_LEGACY_AUTH === 'true' && env.LEGACY_ADMIN_AUTH_APPROVED !== 'true') errors.push('Legacy JWT authentication requires LEGACY_ADMIN_AUTH_APPROVED=true for a documented deployment exception.');
    if (env.ALLOW_LEGACY_AUTH !== 'true' && env.LEGACY_ADMIN_AUTH_APPROVED === 'true') errors.push('LEGACY_ADMIN_AUTH_APPROVED must be false unless ALLOW_LEGACY_AUTH is true.');
    if (env.ALLOW_LEGACY_REGISTRATION !== 'false') errors.push('ALLOW_LEGACY_REGISTRATION must be false; customer registration is handled by Supabase.');
  }

  const serverSupabaseUrl = present(env, 'SUPABASE_URL') ? httpsOrigin(env.SUPABASE_URL) : null;
  const browserSupabaseUrl = present(env, 'VITE_SUPABASE_URL') ? httpsOrigin(env.VITE_SUPABASE_URL) : null;
  if (present(env, 'SUPABASE_URL') && !serverSupabaseUrl) errors.push('SUPABASE_URL must be a valid HTTPS Supabase project URL.');
  if (present(env, 'VITE_SUPABASE_URL') && !browserSupabaseUrl) errors.push('VITE_SUPABASE_URL must be a valid HTTPS Supabase project URL.');
  if (serverSupabaseUrl && browserSupabaseUrl && serverSupabaseUrl !== browserSupabaseUrl) errors.push('SUPABASE_URL and VITE_SUPABASE_URL must refer to the same Supabase project.');
  if (present(env, 'SUPABASE_ANON_KEY') && present(env, 'VITE_SUPABASE_ANON_KEY') && env.SUPABASE_ANON_KEY !== env.VITE_SUPABASE_ANON_KEY) errors.push('SUPABASE_ANON_KEY and VITE_SUPABASE_ANON_KEY must match for the same Supabase project.');
  return errors;
}
