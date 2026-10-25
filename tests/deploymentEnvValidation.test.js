import { validateDeploymentEnvironment } from '../scripts/deploymentEnvValidation.js';

const deploymentEnv = overrides => ({
  DEPLOYMENT_ENVIRONMENT: 'production',
  DEPLOYMENT_HOSTING_MODE: 'split',
  MONGODB_URI: 'mongodb+srv://cluster.example.net/bmprinting', MONGODB_DB_NAME: 'bmprinting',
  JWT_SECRET: 'a'.repeat(48), FRONTEND_ORIGINS: 'https://printing.example.com',
  SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'public-anon-key',
  VITE_SUPABASE_URL: 'https://project.supabase.co', VITE_SUPABASE_ANON_KEY: 'public-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'server-only-service-role-key', SUPABASE_STORAGE_BUCKET: 'private-order-files',
  ALLOW_IN_MEMORY_DB: 'false', SEED_DEFAULT_ADMIN: 'false', ALLOW_LEGACY_AUTH: 'false',
  LEGACY_ADMIN_AUTH_APPROVED: 'false', ALLOW_LEGACY_REGISTRATION: 'false',
  VITE_API_BASE_URL: 'https://api.printing.example.com', VITE_PUBLIC_APP_URL: 'https://printing.example.com',
  NOTIFICATION_WORKER_ENABLED: 'true',
  VITE_TURNSTILE_SITE_KEY: 'public-turnstile-site-key', TURNSTILE_SECRET_KEY: 'server-turnstile-secret',
  TURNSTILE_HOSTNAMES: 'printing.example.com', TURNSTILE_USE_TEST_KEYS: 'false', VITE_TURNSTILE_USE_TEST_KEYS: 'false',
  ...overrides
});

describe('deployment environment validation', () => {
  it('does not require production settings in local development mode', () => {
    expect(validateDeploymentEnvironment({}, 'local')).toEqual([]);
  });

  it('requires a storage bucket and server Supabase credentials for deployment', () => {
    const env = deploymentEnv({ SUPABASE_STORAGE_BUCKET: '', SUPABASE_SERVICE_ROLE_KEY: '' });
    const errors = validateDeploymentEnvironment(env);
    expect(errors.join('\n')).toContain('SUPABASE_STORAGE_BUCKET');
    expect(errors.join('\n')).toContain('SUPABASE_SERVICE_ROLE_KEY');
  });

  it('requires deployment CAPTCHA settings and rejects test credentials', () => {
    expect(validateDeploymentEnvironment(deploymentEnv({ VITE_TURNSTILE_SITE_KEY: '' }), 'deployment', 'frontend').join('\n')).toContain('VITE_TURNSTILE_SITE_KEY');
    expect(validateDeploymentEnvironment(deploymentEnv({ TURNSTILE_SECRET_KEY: '' }), 'deployment', 'backend').join('\n')).toContain('TURNSTILE_SECRET_KEY');
    expect(validateDeploymentEnvironment(deploymentEnv({ TURNSTILE_HOSTNAMES: 'https://printing.example.com/path' }), 'deployment', 'backend').join('\n')).toContain('hostnames only');
    expect(validateDeploymentEnvironment(deploymentEnv({ TURNSTILE_USE_TEST_KEYS: 'true' })).join('\n')).toContain('test keys must be disabled');
  });

  it('accepts complete production configuration without printing or returning secret values', () => {
    const env = deploymentEnv();
    expect(validateDeploymentEnvironment(env)).toEqual([]);
  });

  it('requires an environment-specific database and never accepts production as staging', () => {
    const staging = deploymentEnv({ DEPLOYMENT_ENVIRONMENT: 'staging', MONGODB_DB_NAME: 'bmprinting_staging' });
    expect(validateDeploymentEnvironment(staging, 'deployment', 'backend')).toEqual([]);
    expect(validateDeploymentEnvironment({ ...staging, MONGODB_DB_NAME: 'bmprinting' }, 'deployment', 'backend').join('\n')).toContain('bmprinting_staging for staging');
    expect(validateDeploymentEnvironment(deploymentEnv({ MONGODB_DB_NAME: 'bmprinting_staging' }), 'deployment', 'backend').join('\n')).toContain('bmprinting for production');
    expect(validateDeploymentEnvironment(deploymentEnv({ DEPLOYMENT_ENVIRONMENT: '' }), 'deployment', 'backend').join('\n')).toContain('DEPLOYMENT_ENVIRONMENT');
  });

  it('validates the static frontend and persistent backend independently', () => {
    expect(validateDeploymentEnvironment(deploymentEnv(), 'deployment', 'frontend')).toEqual([]);
    expect(validateDeploymentEnvironment(deploymentEnv(), 'deployment', 'backend')).toEqual([]);
    expect(validateDeploymentEnvironment(deploymentEnv({ VITE_API_BASE_URL: 'http://127.0.0.1:4000' }), 'deployment', 'frontend').join('\n')).toContain('exact HTTPS API origin');
    expect(validateDeploymentEnvironment(deploymentEnv({ NOTIFICATION_WORKER_ENABLED: 'false' }), 'deployment', 'backend').join('\n')).toContain('must be true');
    expect(validateDeploymentEnvironment(deploymentEnv({ VERCEL: '1' }), 'deployment', 'backend').join('\n')).toContain('persistent API host');
  });

  it('rejects mismatched Supabase projects and unsafe client-prefixed service keys', () => {
    const env = deploymentEnv({ VITE_SUPABASE_URL: 'https://different-project.supabase.co', VITE_SUPABASE_SERVICE_ROLE_KEY: 'must-not-be-client-visible' });
    const errors = validateDeploymentEnvironment(env).join('\n');
    expect(errors).toContain('same Supabase project');
    expect(errors).toContain('must not be set');
    expect(errors).not.toContain('must-not-be-client-visible');
  });

  it('rejects mismatched server and browser public keys without echoing either key', () => {
    const env = deploymentEnv({ SUPABASE_ANON_KEY: 'private-looking-server-value', VITE_SUPABASE_ANON_KEY: 'different-public-value' });
    const errors = validateDeploymentEnvironment(env).join('\n');
    expect(errors).toContain('must match');
    expect(errors).not.toContain('private-looking-server-value');
    expect(errors).not.toContain('different-public-value');
  });

  it('requires explicit approval for legacy authentication and keeps registration disabled', () => {
    const env = deploymentEnv({ ALLOW_LEGACY_AUTH: 'true', ALLOW_LEGACY_REGISTRATION: 'true' });
    const errors = validateDeploymentEnvironment(env).join('\n');
    expect(errors).toContain('LEGACY_ADMIN_AUTH_APPROVED');
    expect(errors).toContain('ALLOW_LEGACY_REGISTRATION');
  });
});
