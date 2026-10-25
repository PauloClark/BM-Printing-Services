// Offline fixtures only. These values cannot authenticate to any service.
export function syntheticDeploymentEnvironment(environment = 'staging') {
  const database = environment === 'staging' ? 'bmprinting_staging' : 'bmprinting';
  return {
    BM_QA_MODE: 'true', NODE_ENV: 'production', DEPLOYMENT_ENVIRONMENT: environment,
    DEPLOYMENT_HOSTING_MODE: 'split',
    MONGODB_URI: `mongodb+srv://offline.example.mongodb.net/${database}?retryWrites=true&w=majority`,
    MONGODB_DB_NAME: database, MONGODB_MAX_POOL_SIZE: '10', MONGODB_SERVER_SELECTION_TIMEOUT_MS: '10000',
    JWT_SECRET: 'ci-only-jwt-canary-not-a-real-credential',
    FRONTEND_ORIGINS: 'https://printing.example.com',
    SUPABASE_URL: 'https://offline-project.supabase.co', VITE_SUPABASE_URL: 'https://offline-project.supabase.co',
    SUPABASE_ANON_KEY: `sb_publishable_${'c'.repeat(32)}`, VITE_SUPABASE_ANON_KEY: `sb_publishable_${'c'.repeat(32)}`,
    SUPABASE_SERVICE_ROLE_KEY: `sb_secret_${'s'.repeat(32)}`, SUPABASE_STORAGE_BUCKET: 'private-ci-files',
    TURNSTILE_SECRET_KEY: 'ci-only-turnstile-canary-not-a-real-key',
    GEMINI_API_KEY: 'ci-only-gemini-canary-not-a-real-key',
    VITE_TURNSTILE_SITE_KEY: `0x4${'c'.repeat(20)}`, TURNSTILE_HOSTNAMES: 'printing.example.com',
    TURNSTILE_USE_TEST_KEYS: 'false', VITE_TURNSTILE_USE_TEST_KEYS: 'false',
    VITE_API_BASE_URL: 'https://api.printing.example.com', VITE_PUBLIC_APP_URL: 'https://printing.example.com', VITE_BASE_PATH: '/',
    ALLOW_IN_MEMORY_DB: 'false', SEED_DEFAULT_ADMIN: 'false', ALLOW_LEGACY_AUTH: 'false',
    LEGACY_ADMIN_AUTH_APPROVED: 'false', ALLOW_LEGACY_REGISTRATION: 'false', NOTIFICATION_WORKER_ENABLED: 'true'
  };
}

// Preserve OS/tool paths, but never inherit application credentials or targets.
export function isolatedCheckEnvironment(parent = process.env) {
  const clean = Object.fromEntries(Object.entries(parent).filter(([key]) =>
    !/^(?:VITE_|SUPABASE_|BM_|MONGODB_|MONGO_|TURNSTILE_|JWT_|GEMINI_|GOOGLE_|ADMIN_|ALLOW_|SEED_|LEGACY_|NOTIFICATION_|FRONTEND_|DEPLOYMENT_|VERCEL|RENDER|PORT$|NODE_ENV$)/i.test(key)));
  return { ...clean, BM_QA_MODE: 'true', NODE_ENV: 'test', JWT_SECRET: 'ci-test-only-jwt-not-a-real-credential' };
}
