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
const isPlaceholder = value => /^(your[_-]|change[_-]this|replace[_-]|https:\/\/YOUR_|mongodb:\/\/127\.0\.0\.1)|<[^>]+>/i.test(String(value || '').trim());
const publicVariables = new Set([
  'VITE_API_BASE_URL', 'VITE_PUBLIC_APP_URL', 'VITE_BASE_PATH', 'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY', 'VITE_TURNSTILE_SITE_KEY', 'VITE_TURNSTILE_USE_TEST_KEYS'
]);
const isLocalHostname = host => /^(?:localhost|.*\.localhost|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|172\.(?:1[6-9]|2\d|3[01])\..*|\[.*\])$/i.test(host);
const validHostname = host => typeof host === 'string' && host.length <= 253 && host.includes('.') &&
  host.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) && !isLocalHostname(host);
const httpsOrigin = value => {
  try {
    if (String(value || '') !== String(value || '').trim()) return null;
    const normalized = String(value || '').trim().replace(/\/$/, '');
    const url = new URL(normalized);
    return url.protocol === 'https:' && url.origin === normalized && !url.username && !url.password && validHostname(url.hostname)
      ? url.origin.toLowerCase() : null;
  } catch { return null; }
};

// Shape/role validation is not signature verification or a live credential check.
const supabaseKeyHasRole = (key, role) => {
  if (typeof key !== 'string') return false;
  const prefix = role === 'anon' ? 'sb_publishable_' : 'sb_secret_';
  if (key.startsWith(prefix)) return /^[A-Za-z0-9_-]{20,}$/.test(key.slice(prefix.length));
  try {
    if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)) return false;
    return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role === role;
  } catch { return false; }
};
const isDummyTurnstileKey = key => /^[123]x0{10,}/i.test(key || '');

export function deploymentRuntime(env = process.env, target = 'backend') {
  return Boolean(env.DEPLOYMENT_ENVIRONMENT || env.VERCEL || env.RENDER ||
    (target !== 'frontend' && env.NODE_ENV === 'production'));
}

export function assertDeploymentEnvironment(env, target) {
  const errors = validateDeploymentEnvironment(env, 'deployment', target);
  if (errors.length) throw new Error(`Deployment environment validation failed (${target}):\n${errors.map(error => `- ${error}`).join('\n')}`);
}

function validateAtlas(env, errors) {
  if (!present(env, 'MONGODB_URI')) return;
  try {
    const uri = new URL(env.MONGODB_URI);
    if (env.MONGODB_URI !== env.MONGODB_URI.trim() || uri.hash || uri.protocol !== 'mongodb+srv:' || uri.port || !validHostname(uri.hostname) || !uri.hostname.endsWith('.mongodb.net')) {
      throw new Error('Invalid Atlas host');
    }
    const database = decodeURIComponent(uri.pathname.slice(1));
    if (database && database !== env.MONGODB_DB_NAME) errors.push('MONGODB_URI database path must match MONGODB_DB_NAME.');
    const seen = new Set();
    for (const [key, value] of uri.searchParams) {
      const name = key.toLowerCase(), setting = value.toLowerCase();
      if (seen.has(name)) errors.push('MONGODB_URI must not contain duplicate connection options.');
      seen.add(name);
      if (name === 'dbname' && value !== env.MONGODB_DB_NAME) errors.push('MONGODB_URI dbName option must match MONGODB_DB_NAME.');
      if ((['tls', 'ssl'].includes(name) && setting !== 'true') ||
          (['tlsinsecure', 'tlsallowinvalidcertificates', 'tlsallowinvalidhostnames', 'directconnection'].includes(name) && setting !== 'false')) {
        errors.push('MONGODB_URI must not disable TLS/certificate validation or enable direct connections.');
      }
    }
  } catch {
    errors.push('MONGODB_URI must be a valid remote Atlas mongodb+srv URI on a mongodb.net hostname, without a port.');
  }
  for (const key of ['MONGODB_MAX_POOL_SIZE', 'MONGODB_SERVER_SELECTION_TIMEOUT_MS']) {
    if (env[key] !== undefined && (!/^[1-9]\d*$/.test(env[key]) || !Number.isSafeInteger(Number(env[key])))) {
      errors.push(`${key} must be a positive safe integer.`);
    }
  }
}

export function validateDeploymentEnvironment(env = process.env, mode = 'deployment', target = 'all') {
  const errors = [];
  if (!['local', 'deployment'].includes(mode)) return [`Unknown validation mode: ${mode}. Use local or deployment.`];
  if (!['all', 'frontend', 'backend'].includes(target)) return [`Unknown validation target: ${target}. Use frontend, backend, or all.`];
  for (const key of Object.keys(env)) {
    if (key.startsWith('VITE_') && present(env, key) && !publicVariables.has(key)) {
      errors.push(`${key.replace(/[^A-Z0-9_]/g, '')} must not be set; only approved public VITE_ variables may enter the frontend bundle.`);
    }
  }
  for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'JWT_SECRET', 'GEMINI_API_KEY', 'TURNSTILE_SECRET_KEY', 'MONGODB_URI']) {
    if (present(env, key) && Object.keys(env).some(name => name.startsWith('VITE_') && present(env, name) && env[name] === env[key])) {
      errors.push(`${key} must remain server-only; it matches a frontend variable.`);
    }
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
  for (const key of ['TURNSTILE_USE_TEST_KEYS', 'VITE_TURNSTILE_USE_TEST_KEYS']) {
    if (env[key] !== undefined && !['true', 'false'].includes(env[key])) errors.push(`${key} must be true or false when provided.`);
  }
  if (env.TURNSTILE_USE_TEST_KEYS === 'true' || env.VITE_TURNSTILE_USE_TEST_KEYS === 'true' ||
      isDummyTurnstileKey(env.VITE_TURNSTILE_SITE_KEY) || isDummyTurnstileKey(env.TURNSTILE_SECRET_KEY)) {
    errors.push('Turnstile test keys must be disabled in deployment environments.');
  }
  for (const key of target === 'frontend' ? ['VITE_TURNSTILE_SITE_KEY'] : target === 'backend' ? ['TURNSTILE_SECRET_KEY'] : ['VITE_TURNSTILE_SITE_KEY', 'TURNSTILE_SECRET_KEY']) {
    if (present(env, key) && !/^[A-Za-z0-9_-]{20,}$/.test(env[key])) errors.push(`${key} must have a valid Turnstile key format.`);
  }

  if (target !== 'backend') {
    const apiOrigin = httpsOrigin(env.VITE_API_BASE_URL);
    const appOrigin = httpsOrigin(env.VITE_PUBLIC_APP_URL);
    if (present(env, 'VITE_API_BASE_URL') && !apiOrigin) errors.push('VITE_API_BASE_URL must be an exact HTTPS API origin without a path or credentials.');
    if (present(env, 'VITE_PUBLIC_APP_URL') && !appOrigin) errors.push('VITE_PUBLIC_APP_URL must be an exact HTTPS frontend origin without a path or credentials.');
    if (apiOrigin && appOrigin && apiOrigin === appOrigin) errors.push('VITE_API_BASE_URL must use the separate persistent API origin.');
  }

  if (target !== 'frontend') {
    if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production on the deployed backend.');
    if (present(env, 'VERCEL')) errors.push('The backend target must run on the persistent API host, not a Vercel function runtime.');
    validateAtlas(env, errors);
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
    if (present(env, 'TURNSTILE_HOSTNAMES') && env.TURNSTILE_HOSTNAMES.split(',').some(value => !validHostname(value.trim()))) errors.push('TURNSTILE_HOSTNAMES must contain valid public hostnames only, without schemes, ports, or paths.');
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
  for (const key of target === 'frontend' ? ['VITE_SUPABASE_ANON_KEY'] : target === 'backend' ? ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'] : ['VITE_SUPABASE_ANON_KEY', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    if (present(env, key) && !supabaseKeyHasRole(env[key], key === 'SUPABASE_SERVICE_ROLE_KEY' ? 'service_role' : 'anon')) {
      errors.push(`${key} must be a correctly scoped Supabase key (publishable/anon for public use, secret/service_role for server use).`);
    }
  }
  return errors;
}
