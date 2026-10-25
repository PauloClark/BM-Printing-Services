import fs from 'node:fs/promises';
import path from 'node:path';

export { QA_DATABASE_NAME } from '../../server/qaMongoGuard.js';
export { validateQaReplicaSetHello } from '../../server/qaMongoGuard.js';
import { QA_DATABASE_NAME } from '../../server/qaMongoGuard.js';
const requiredKeys = [
  'BM_QA_SUPABASE_URL', 'BM_QA_SUPABASE_ANON_KEY', 'BM_QA_SUPABASE_SERVICE_ROLE_KEY', 'BM_QA_STORAGE_BUCKET',
  'BM_QA_ADMIN_USER_ID', 'BM_QA_ADMIN_EMAIL',
  'BM_QA_STAFF_A_USER_ID', 'BM_QA_STAFF_A_EMAIL',
  'BM_QA_STAFF_B_USER_ID', 'BM_QA_STAFF_B_EMAIL',
  'BM_QA_CUSTOMER_A_USER_ID', 'BM_QA_CUSTOMER_A_EMAIL',
  'BM_QA_CUSTOMER_B_USER_ID', 'BM_QA_CUSTOMER_B_EMAIL'
];
const bucketPattern = /^[a-z0-9][a-z0-9._-]{0,61}[a-z0-9]$/;
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateQaConfig(config, protectedProjectUrls = []) {
  const missing = requiredKeys.filter(key => !String(config[key] || '').trim());
  if (missing.length) throw new Error(`QA configuration is incomplete (${missing.length} required settings missing). Copy .env.qa.example to .env.qa.local and fill it using the dedicated QA Supabase project.`);
  if (requiredKeys.some(key => /^YOUR_|example\.test$/i.test(String(config[key])))) {
    throw new Error('QA configuration still contains example placeholders.');
  }
  let project;
  try { project = new URL(config.BM_QA_SUPABASE_URL); }
  catch { throw new Error('BM_QA_SUPABASE_URL must be a valid dedicated QA Supabase URL.'); }
  if (project.protocol !== 'https:' || !project.hostname.endsWith('.supabase.co') || project.pathname !== '/') {
    throw new Error('BM_QA_SUPABASE_URL must be an HTTPS Supabase project URL.');
  }
  if (protectedProjectUrls.some(value => sameProject(config.BM_QA_SUPABASE_URL, value))) {
    throw new Error('The configured QA Supabase URL matches a project in the normal environment files. Use a separate QA project.');
  }
  if (!bucketPattern.test(String(config.BM_QA_STORAGE_BUCKET).trim())) throw new Error('BM_QA_STORAGE_BUCKET is invalid.');
  for (const key of ['BM_QA_ADMIN_USER_ID', 'BM_QA_STAFF_A_USER_ID', 'BM_QA_STAFF_B_USER_ID', 'BM_QA_CUSTOMER_A_USER_ID', 'BM_QA_CUSTOMER_B_USER_ID']) {
    if (!uuidPattern.test(String(config[key]))) throw new Error(`${key} must be the UUID of a synthetic account in the QA project.`);
  }
  for (const key of ['BM_QA_ADMIN_EMAIL', 'BM_QA_STAFF_A_EMAIL', 'BM_QA_STAFF_B_EMAIL', 'BM_QA_CUSTOMER_A_EMAIL', 'BM_QA_CUSTOMER_B_EMAIL']) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(config[key]))) throw new Error(`${key} must be a QA account email address.`);
  }
  return Object.freeze({ ...config, BM_QA_STORAGE_BUCKET: config.BM_QA_STORAGE_BUCKET.trim() });
}

function sameProject(left, right) {
  try { return new URL(left).hostname.toLowerCase() === new URL(right).hostname.toLowerCase(); }
  catch { return false; }
}

export { validateQaMongoConfig as validateMongoTarget } from '../../server/qaMongoGuard.js';

export function validateDisposablePath(candidate, qaRoot, systemTemp = requireTempRoot()) {
  const resolvedCandidate = path.resolve(candidate);
  const resolvedRoot = path.resolve(qaRoot);
  const resolvedTemp = path.resolve(systemTemp);
  const relativeRoot = path.relative(resolvedTemp, resolvedRoot);
  const relativeCandidate = path.relative(resolvedRoot, resolvedCandidate);
  if (!relativeRoot || relativeRoot.startsWith('..') || path.isAbsolute(relativeRoot) ||
      relativeCandidate.startsWith('..') || path.isAbsolute(relativeCandidate)) {
    throw new Error('Refusing filesystem target outside this run’s disposable temporary directory.');
  }
  return true;
}

export async function removeMarkedQaDirectory({ qaRoot, systemTemp, markerName, markerValue }) {
  const resolvedRoot = path.resolve(qaRoot);
  if (!path.basename(resolvedRoot).startsWith('bmprinting-qa-run-') || path.basename(markerName) !== markerName) {
    throw new Error('Refusing cleanup: this is not a marked QA run directory.');
  }
  validateDisposablePath(resolvedRoot, resolvedRoot, systemTemp);
  const marker = await fs.readFile(path.join(resolvedRoot, markerName), 'utf8').catch(() => '');
  if (!markerValue || marker !== markerValue) throw new Error('Refusing cleanup: disposable directory marker did not match.');
  await fs.rm(resolvedRoot, { recursive: true, force: true });
}

function requireTempRoot() {
  return process.env.TEMP || process.env.TMP || '/tmp';
}

export function makeBackendEnvironment({ config, mongoUri, mongoAddress, apiPort, frontendOrigin, artifactRoot, jwtSecret }) {
  return {
    ...platformEnvironment(),
    BM_QA_MODE: 'true', NODE_ENV: 'development',
    MONGODB_URI: mongoUri, MONGODB_DB_NAME: QA_DATABASE_NAME,
    BM_QA_MONGO_ADDRESS: mongoAddress,
    MONGODB_SERVER_SELECTION_TIMEOUT_MS: '8000', MONGODB_MAX_POOL_SIZE: '5',
    PORT: String(apiPort), FRONTEND_ORIGINS: frontendOrigin,
    JWT_SECRET: jwtSecret, JWT_EXPIRES_IN: '1h',
    ALLOW_LEGACY_AUTH: 'false', ALLOW_LEGACY_REGISTRATION: 'false', ALLOW_IN_MEMORY_DB: 'false', SEED_DEFAULT_ADMIN: 'false',
    SUPABASE_URL: config.BM_QA_SUPABASE_URL, SUPABASE_ANON_KEY: config.BM_QA_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: config.BM_QA_SUPABASE_SERVICE_ROLE_KEY,
    SUPABASE_STORAGE_BUCKET: config.BM_QA_STORAGE_BUCKET,
    TURNSTILE_USE_TEST_KEYS: 'true',
    VITE_SUPABASE_URL: config.BM_QA_SUPABASE_URL, VITE_SUPABASE_ANON_KEY: config.BM_QA_SUPABASE_ANON_KEY,
    ORDER_UPLOAD_DIR: path.join(artifactRoot, 'uploads'), ORDER_REPORTS_DIR: path.join(artifactRoot, 'reports')
  };
}

export function makeFrontendEnvironment({ config, apiOrigin }) {
  return {
    ...platformEnvironment(),
    BM_QA_MODE: 'true', NODE_ENV: 'development',
    VITE_SUPABASE_URL: config.BM_QA_SUPABASE_URL,
    VITE_SUPABASE_ANON_KEY: config.BM_QA_SUPABASE_ANON_KEY,
    VITE_TURNSTILE_USE_TEST_KEYS: 'true',
    BM_API_PROXY_TARGET: apiOrigin, VITE_BASE_PATH: '/', VITE_PUBLIC_APP_URL: 'http://127.0.0.1:3300'
  };
}

function platformEnvironment() {
  const env = {};
  for (const key of ['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE', 'HOME', 'APPDATA', 'LOCALAPPDATA']) {
    if (process.env[key]) env[key] = process.env[key];
  }
  return env;
}
