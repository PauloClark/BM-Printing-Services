import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { createClient } from '@supabase/supabase-js';
import { seedQaFixtures } from './seed.js';
import {
  QA_DATABASE_NAME, makeBackendEnvironment, makeFrontendEnvironment,
  removeMarkedQaDirectory, validateDisposablePath, validateMongoTarget, validateQaConfig, validateQaReplicaSetHello
} from './environment.js';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const qaEnvFile = path.join(projectRoot, '.env.qa.local');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const databaseMarker = '.bmprinting-disposable-qa';
const apiPort = 4300;
const frontendPort = 3300;

function parseEnvFile(file) {
  return fs.readFile(file, 'utf8').then(value => dotenv.parse(value)).catch(error => {
    if (error.code === 'ENOENT') return {};
    throw error;
  });
}

async function readQaConfig() {
  const raw = await parseEnvFile(qaEnvFile);
  const protectedFiles = await Promise.all(['.env', 'env'].map(file => parseEnvFile(path.join(projectRoot, file))));
  const protectedUrls = protectedFiles.flatMap(file => [file.SUPABASE_URL, file.VITE_SUPABASE_URL]).filter(Boolean);
  return validateQaConfig(raw, protectedUrls);
}

async function verifyQaSupabase(config) {
  const client = createClient(config.BM_QA_SUPABASE_URL, config.BM_QA_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const roles = [
    ['ADMIN', 'admin'], ['STAFF_A', 'staff'], ['STAFF_B', 'staff'],
    ['CUSTOMER_A', 'customer'], ['CUSTOMER_B', 'customer']
  ];
  for (const [suffix, expectedRole] of roles) {
    const id = config[`BM_QA_${suffix}_USER_ID`];
    const email = config[`BM_QA_${suffix}_EMAIL`].toLowerCase();
    const { data, error } = await client.auth.admin.getUserById(id);
    if (error || !data?.user || data.user.id !== id || data.user.email?.toLowerCase() !== email ||
        (data.user.app_metadata?.role || 'customer') !== expectedRole) {
      throw new Error(`QA Supabase account check failed for ${suffix}; no account or role was changed.`);
    }
  }
  const { data: bucket, error: bucketError } = await client.storage.getBucket(config.BM_QA_STORAGE_BUCKET);
  if (bucketError || !bucket || bucket.public) throw new Error('The configured QA Storage bucket is missing or public. It must exist and remain private.');
}

async function reservePort(port) {
  const net = await import('node:net');
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise(resolve => server.close(resolve));
}

async function waitFor(url, child, label) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error(`${label} stopped during startup.`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
    } catch {}
    await delay(200);
  }
  throw new Error(`${label} did not become ready. No service logs or secret values were printed.`);
}

function stopChild(child) {
  if (!child || child.exitCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      const forceTimer = setTimeout(() => resolve(child.exitCode !== null), 3000);
      child.once('exit', () => { clearTimeout(forceTimer); resolve(true); });
    }, 5000);
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
    child.kill('SIGTERM');
  });
}

async function main() {
  let requestShutdown;
  const shutdownRequested = new Promise(resolve => { requestShutdown = resolve; });
  const onSignal = () => requestShutdown();
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const config = await readQaConfig();
  await reservePort(apiPort);
  await reservePort(frontendPort);
  await verifyQaSupabase(config);

  const tempRoot = path.resolve(os.tmpdir());
  const qaRoot = await fs.mkdtemp(path.join(tempRoot, 'bmprinting-qa-run-'));
  validateDisposablePath(qaRoot, qaRoot, tempRoot);
  const markerValue = crypto.randomUUID();
  await fs.writeFile(path.join(qaRoot, databaseMarker), markerValue, { flag: 'wx' });
  const mongoPath = path.join(qaRoot, 'mongo');

  let replicaSet;
  let backend;
  let frontend;
  try {
    await fs.mkdir(mongoPath);
    replicaSet = await MongoMemoryReplSet.create({
      binary: { version: '7.0.14' },
      replSet: { name: 'bmprinting_qa_rs', count: 1 },
      instanceOpts: [{ dbPath: mongoPath, ip: '127.0.0.1', storageEngine: 'wiredTiger' }]
    });
    const instance = replicaSet.servers[0].instanceInfo;
    const dbPath = path.resolve(instance.dbPath);
    validateDisposablePath(dbPath, qaRoot, tempRoot);
    if (dbPath !== path.resolve(mongoPath)) throw new Error('MongoDB started outside its unique disposable data directory.');
    const address = `${instance.ip}:${instance.port}`;
    const mongoUri = replicaSet.getUri(QA_DATABASE_NAME);
    validateMongoTarget(mongoUri, QA_DATABASE_NAME, address);

    const verifier = new MongoClient(mongoUri, { serverSelectionTimeoutMS: 5000 });
    try {
      await verifier.connect();
      const hello = await verifier.db('admin').command({ hello: 1 });
      validateQaReplicaSetHello(hello, address);
    } finally { await verifier.close(); }
    await seedQaFixtures(mongoUri, address, config);

    const apiOrigin = `http://127.0.0.1:${apiPort}`;
    const frontendOrigin = `http://127.0.0.1:${frontendPort}`;
    const backendEnv = makeBackendEnvironment({
      config, mongoUri, mongoAddress: address, apiPort, frontendOrigin, artifactRoot: qaRoot,
      jwtSecret: crypto.randomBytes(32).toString('base64url')
    });
    backend = spawn(process.execPath, ['server.js'], { cwd: projectRoot, env: backendEnv, windowsHide: true, stdio: 'ignore' });
    await waitFor(`${apiOrigin}/api/health`, backend, 'QA backend');

    const frontendEnv = makeFrontendEnvironment({ config, apiOrigin });
    frontend = spawn(process.execPath, [path.join(projectRoot, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], {
      cwd: projectRoot, env: frontendEnv, windowsHide: true, stdio: 'ignore'
    });
    await waitFor(frontendOrigin, frontend, 'QA frontend');
    console.log('Isolated QA stack ready at http://127.0.0.1:3300.');
    console.log('MongoDB is a disposable replica set in a unique temporary directory; database name: bmprinting_qa.');
    console.log('Synthetic users, two pending QA orders, one QA product, one QA material, and linked QA employees were seeded.');
    console.log('Press Ctrl+C to stop. Only this run’s temporary database and artifact directory will be removed.');
    await shutdownRequested;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    let safeToRemove = await stopChild(frontend);
    safeToRemove = (await stopChild(backend)) && safeToRemove;
    if (replicaSet) {
      try { safeToRemove = (await replicaSet.stop({ doCleanup: false })) === true && safeToRemove; }
      catch { safeToRemove = false; }
    }
    if (safeToRemove) {
      await removeMarkedQaDirectory({ qaRoot, systemTemp: tempRoot, markerName: databaseMarker, markerValue });
    } else {
      console.error('A QA process did not stop cleanly; its temporary data was retained for safety.');
    }
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
