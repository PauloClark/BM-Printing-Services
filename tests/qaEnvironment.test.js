import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { seedQaFixtures } from '../scripts/qa/seed.js';
import {
  QA_DATABASE_NAME, makeBackendEnvironment, makeFrontendEnvironment, removeMarkedQaDirectory,
  validateDisposablePath, validateMongoTarget, validateQaConfig
} from '../scripts/qa/environment.js';
import { validateQaReplicaSetHello } from '../server/qaMongoGuard.js';

const config = {
  BM_QA_SUPABASE_URL: 'https://qa-project.supabase.co',
  BM_QA_SUPABASE_ANON_KEY: 'qa-anon-key',
  BM_QA_SUPABASE_SERVICE_ROLE_KEY: 'qa-service-key',
  BM_QA_STORAGE_BUCKET: 'private-order-files-qa',
  BM_QA_ADMIN_USER_ID: '10000000-0000-4000-8000-000000000001', BM_QA_ADMIN_EMAIL: 'qa-admin@bmprinting.test',
  BM_QA_STAFF_A_USER_ID: '10000000-0000-4000-8000-000000000002', BM_QA_STAFF_A_EMAIL: 'qa-staff-a@bmprinting.test',
  BM_QA_STAFF_B_USER_ID: '10000000-0000-4000-8000-000000000003', BM_QA_STAFF_B_EMAIL: 'qa-staff-b@bmprinting.test',
  BM_QA_CUSTOMER_A_USER_ID: '10000000-0000-4000-8000-000000000004', BM_QA_CUSTOMER_A_EMAIL: 'qa-customer-a@bmprinting.test',
  BM_QA_CUSTOMER_B_USER_ID: '10000000-0000-4000-8000-000000000005', BM_QA_CUSTOMER_B_EMAIL: 'qa-customer-b@bmprinting.test'
};

describe('isolated browser QA environment guards', () => {
  test('fails closed when QA settings are absent or still placeholders', () => {
    expect(() => validateQaConfig({})).toThrow(/incomplete/);
    expect(() => validateQaConfig({ ...config, BM_QA_SUPABASE_ANON_KEY: 'YOUR_QA_PUBLIC_ANON_KEY' })).toThrow(/placeholders/);
  });

  test('rejects the normal Supabase project and requires a separate HTTPS QA project', () => {
    expect(() => validateQaConfig(config, ['https://qa-project.supabase.co'])).toThrow(/matches a project/);
    expect(() => validateQaConfig({ ...config, BM_QA_SUPABASE_URL: 'http://qa-project.supabase.co' })).toThrow(/HTTPS/);
  });

  test('keeps the database pinned to bmprinting_qa and refuses production or non-loopback targets', () => {
    expect(() => validateMongoTarget('mongodb://127.0.0.1:27017/bmprinting', 'bmprinting', '127.0.0.1:27017')).toThrow(/bmprinting_qa/);
    expect(() => validateMongoTarget('mongodb://cluster.example.net/bmprinting_qa', QA_DATABASE_NAME, '127.0.0.1:27017')).toThrow(/loopback/);
    expect(() => validateMongoTarget('mongodb://127.0.0.1:27017/bmprinting', QA_DATABASE_NAME, '127.0.0.1:27017')).toThrow(/URI/);
  });

  test('requires the expected disposable replica-set handshake', () => {
    expect(validateQaReplicaSetHello({ setName: 'bmprinting_qa_rs', hosts: ['127.0.0.1:27018'] }, '127.0.0.1:27018')).toBe(true);
    expect(() => validateQaReplicaSetHello({ setName: 'rs0', hosts: ['127.0.0.1:27017'] }, '127.0.0.1:27017')).toThrow(/disposable replica-set/);
  });

  test('confines the database path to a unique OS temporary directory', () => {
    expect(validateDisposablePath('/tmp/bmprinting-qa-run-a/mongo', '/tmp/bmprinting-qa-run-a', '/tmp')).toBe(true);
    expect(() => validateDisposablePath('/data/mongodb', '/tmp/bmprinting-qa-run-a', '/tmp')).toThrow(/outside/);
  });

  test('removes only a run directory with its exact marker under the OS temp root', async () => {
    const systemTemp = await fs.mkdtemp(path.join(os.tmpdir(), 'bmprinting-qa-run-test-'));
    const qaRoot = path.join(systemTemp, 'bmprinting-qa-run-child');
    await fs.mkdir(qaRoot);
    await fs.writeFile(path.join(qaRoot, '.marker'), 'expected-marker');
    await expect(removeMarkedQaDirectory({ qaRoot, systemTemp, markerName: '.marker', markerValue: 'wrong-marker' })).rejects.toThrow(/marker/);
    expect(await fs.stat(qaRoot)).toBeTruthy();
    await removeMarkedQaDirectory({ qaRoot, systemTemp, markerName: '.marker', markerValue: 'expected-marker' });
    await expect(fs.stat(qaRoot)).rejects.toThrow();
    await fs.rm(systemTemp, { recursive: true, force: true });
  });

  test('does not pass server-only credentials into the Vite environment', () => {
    const frontend = makeFrontendEnvironment({ config, apiOrigin: 'http://127.0.0.1:4300' });
    expect(frontend.VITE_SUPABASE_URL).toBe(config.BM_QA_SUPABASE_URL);
    expect(frontend.VITE_SUPABASE_ANON_KEY).toBe(config.BM_QA_SUPABASE_ANON_KEY);
    expect(frontend.SUPABASE_SERVICE_ROLE_KEY).toBeUndefined();
    const backend = makeBackendEnvironment({ config, mongoUri: 'mongodb://127.0.0.1:27017/bmprinting_qa', mongoAddress: '127.0.0.1:27017', apiPort: 4300, frontendOrigin: 'http://127.0.0.1:3300', artifactRoot: '/tmp/qa', jwtSecret: 'isolated-test-secret' });
    expect(backend.MONGODB_DB_NAME).toBe(QA_DATABASE_NAME);
    expect(backend.ALLOW_LEGACY_AUTH).toBe('false');
    expect(backend.SUPABASE_SERVICE_ROLE_KEY).toBe(config.BM_QA_SUPABASE_SERVICE_ROLE_KEY);
  });

  test('starts a disposable single-member replica set and then stops it', async () => {
    let replicaSet;
    const systemTemp = path.resolve(os.tmpdir());
    const qaRoot = await fs.mkdtemp(path.join(systemTemp, 'bmprinting-qa-run-test-'));
    const mongoPath = path.join(qaRoot, 'mongo');
    await fs.mkdir(mongoPath);
    try {
      replicaSet = await MongoMemoryReplSet.create({
        binary: { version: '7.0.14' }, replSet: { name: 'bmprinting_qa_rs', count: 1 },
        instanceOpts: [{ dbPath: mongoPath, ip: '127.0.0.1', storageEngine: 'wiredTiger' }]
      });
      const uri = replicaSet.getUri(QA_DATABASE_NAME);
      const server = replicaSet.servers[0].instanceInfo;
      expect(validateMongoTarget(uri, QA_DATABASE_NAME, `${server.ip}:${server.port}`)).toBe(true);
      expect(path.resolve(server.dbPath)).toBe(path.resolve(mongoPath));
      expect(validateDisposablePath(server.dbPath, qaRoot, systemTemp)).toBe(true);
      const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
      try {
        await client.connect();
        const hello = await client.db('admin').command({ hello: 1 });
        expect(validateQaReplicaSetHello(hello, `${server.ip}:${server.port}`)).toBe(true);
        await seedQaFixtures(uri, `${server.ip}:${server.port}`, config);
        const db = client.db(QA_DATABASE_NAME);
        expect(await db.collection('users').countDocuments()).toBe(5);
        expect(await db.collection('employees').countDocuments()).toBe(2);
        expect(await db.collection('products').countDocuments()).toBe(1);
        expect(await db.collection('inventories').countDocuments()).toBe(1);
        expect(await db.collection('orders').countDocuments()).toBe(2);
        expect(await db.collection('productions').countDocuments()).toBe(0);
        expect((await db.collection('orders').findOne({ orderId: 'QA-ORDER-A' })).paymentStatus).toBe('Unpaid');
      } finally { await client.close(); }
    } finally {
      if (replicaSet) expect(await replicaSet.stop({ doCleanup: false })).toBe(true);
      await fs.rm(qaRoot, { recursive: true, force: true });
    }
    expect(replicaSet.state).toBe('stopped');
  }, 120000);
});
