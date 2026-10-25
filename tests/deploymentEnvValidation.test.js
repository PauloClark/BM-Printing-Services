import { validateDeploymentEnvironment, assertDeploymentEnvironment, deploymentRuntime } from '../scripts/deploymentEnvValidation.js';
import { syntheticDeploymentEnvironment, isolatedCheckEnvironment } from '../scripts/ci-environment.js';

const deploymentEnv = overrides => ({ ...syntheticDeploymentEnvironment('production'), ...overrides });

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
    const staging = syntheticDeploymentEnvironment('staging');
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

  it.each([
    'mongodb+srv://cluster.example.net/bmprinting',
    'mongodb+srv://localhost/bmprinting',
    'mongodb+srv://cluster.mongodb.net.attacker.example/bmprinting',
    'mongodb+srv://cluster.mongodb.net:27017/bmprinting',
    'mongodb+srv://cluster.mongodb.net/bmprinting_staging',
    'mongodb+srv://cluster.mongodb.net/bmprinting?tls=false',
    'mongodb+srv://cluster.mongodb.net/bmprinting?SSL=false',
    'mongodb+srv://cluster.mongodb.net/bmprinting?tlsAllowInvalidCertificates=true',
    'mongodb+srv://cluster.mongodb.net/bmprinting?tlsAllowInvalidHostnames=true',
    'mongodb+srv://cluster.mongodb.net/bmprinting?directConnection=true',
    'mongodb+srv://cluster.mongodb.net/bmprinting?dbName=bmprinting_staging',
    'mongodb+srv://cluster.mongodb.net/bmprinting#unexpected',
    'mongodb+srv://cluster.mongodb.net/bmprinting?tls=true&TLS=false'
  ])('rejects malformed, unapproved or insecure Atlas settings: %s', uri => {
    expect(validateDeploymentEnvironment(deploymentEnv({ MONGODB_URI: uri }), 'deployment', 'backend').join('\n')).toContain('MONGODB_URI');
  });

  it('accepts Atlas SRV with explicit TLS and rejects invalid optional pool/timeout values', () => {
    expect(validateDeploymentEnvironment(deploymentEnv({ MONGODB_URI: 'mongodb+srv://cluster.mongodb.net/bmprinting?tls=true&retryWrites=true&w=majority' }))).toEqual([]);
    for (const key of ['MONGODB_MAX_POOL_SIZE', 'MONGODB_SERVER_SELECTION_TIMEOUT_MS']) {
      for (const value of ['NaN', '0', '-1', '1.5', 'Infinity', '']) {
        expect(validateDeploymentEnvironment(deploymentEnv({ [key]: value })).join('\n')).toContain(key);
      }
    }
  });

  it('accepts independent frontend/backend inputs without requiring the other service credentials', () => {
    const env = deploymentEnv();
    const frontendNames = ['DEPLOYMENT_ENVIRONMENT', 'DEPLOYMENT_HOSTING_MODE', 'VITE_API_BASE_URL', 'VITE_PUBLIC_APP_URL', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY', 'VITE_TURNSTILE_SITE_KEY'];
    expect(validateDeploymentEnvironment(Object.fromEntries(frontendNames.map(key => [key, env[key]])), 'deployment', 'frontend')).toEqual([]);
    const backend = Object.fromEntries(Object.entries(env).filter(([key]) => !key.startsWith('VITE_')));
    expect(validateDeploymentEnvironment(backend, 'deployment', 'backend')).toEqual([]);
    expect(validateDeploymentEnvironment({ ...backend, NODE_ENV: '' }, 'deployment', 'backend').join('\n')).toContain('NODE_ENV');
  });

  it('blocks server secrets under any client prefix, including an apparently public variable', () => {
    const env = deploymentEnv();
    for (const key of ['VITE_GEMINI_API_KEY', 'VITE_JWT_SECRET', 'VITE_MONGODB_URI', 'VITE_SUPABASE_SERVICE_ROLE_KEY']) {
      const errors = validateDeploymentEnvironment({ ...env, [key]: 'private-canary-value-not-to-log' });
      expect(errors.join('\n')).toContain(key);
      expect(errors.join('\n')).not.toContain('private-canary-value-not-to-log');
    }
    expect(validateDeploymentEnvironment({ ...env, VITE_SUPABASE_ANON_KEY: env.SUPABASE_SERVICE_ROLE_KEY }).join('\n')).toContain('server-only');
    expect(validateDeploymentEnvironment({ VITE_GEMINI_API_KEY: 'private-canary' }, 'local', 'frontend').length).toBeGreaterThan(0);
  });

  it('checks Supabase key scope for modern and legacy credentials without authenticating', () => {
    const jwt = role => [Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'), Buffer.from(JSON.stringify({ role })).toString('base64url'), 'synthetic-signature'].join('.');
    expect(validateDeploymentEnvironment(deploymentEnv({ SUPABASE_ANON_KEY: jwt('anon'), VITE_SUPABASE_ANON_KEY: jwt('anon'), SUPABASE_SERVICE_ROLE_KEY: jwt('service_role') }))).toEqual([]);
    for (const value of ['invalid-key', jwt('service_role')]) {
      expect(validateDeploymentEnvironment(deploymentEnv({ VITE_SUPABASE_ANON_KEY: value })).join('\n')).toContain('correctly scoped');
    }
    expect(validateDeploymentEnvironment(deploymentEnv({ SUPABASE_SERVICE_ROLE_KEY: jwt('anon') })).join('\n')).toContain('correctly scoped');
  });

  it('rejects dummy CAPTCHA keys even when test switches are absent or false', () => {
    expect(validateDeploymentEnvironment(deploymentEnv({ VITE_TURNSTILE_SITE_KEY: '1x00000000000000000000AA' })).join('\n')).toContain('test keys');
    expect(validateDeploymentEnvironment(deploymentEnv({ TURNSTILE_USE_TEST_KEYS: 'TRUE' })).join('\n')).toContain('must be true or false');
    expect(validateDeploymentEnvironment(deploymentEnv({ TURNSTILE_HOSTNAMES: '..bad-host..' })).join('\n')).toContain('hostnames only');
  });

  it('rejects local HTTPS origins, credential-bearing URLs and incomplete deployed configuration', () => {
    for (const origin of ['https://localhost', 'https://127.0.0.1', 'https://192.168.1.10', 'https://[::1]', 'https://person:password@printing.example.com', 'https://printing.example.com/path', ' https://printing.example.com ']) {
      expect(validateDeploymentEnvironment(deploymentEnv({ VITE_PUBLIC_APP_URL: origin })).join('\n')).toContain('VITE_PUBLIC_APP_URL');
    }
    expect(() => assertDeploymentEnvironment({ NODE_ENV: 'production' }, 'backend')).toThrow('Missing:');
    expect(deploymentRuntime({ NODE_ENV: 'production' })).toBe(true);
    expect(deploymentRuntime({ VERCEL: '1' }, 'frontend')).toBe(true);
    expect(deploymentRuntime({ NODE_ENV: 'production' }, 'frontend')).toBe(false);
  });

  it('does not let test subprocesses inherit deployment credentials, targets or dangerous feature flags', () => {
    const clean = isolatedCheckEnvironment({ PATH: 'tool-path', SUPABASE_SERVICE_ROLE_KEY: 'private', MONGODB_URI: 'persistent', VITE_SUPABASE_URL: 'live', SEED_DEFAULT_ADMIN: 'true', ALLOW_LEGACY_AUTH: 'false', DEPLOYMENT_ENVIRONMENT: 'production', NODE_ENV: 'production' });
    expect(clean).toMatchObject({ PATH: 'tool-path', NODE_ENV: 'test', BM_QA_MODE: 'true' });
    for (const key of ['SUPABASE_SERVICE_ROLE_KEY', 'MONGODB_URI', 'VITE_SUPABASE_URL', 'SEED_DEFAULT_ADMIN', 'ALLOW_LEGACY_AUTH', 'DEPLOYMENT_ENVIRONMENT']) expect(clean[key]).toBeUndefined();
  });
});
