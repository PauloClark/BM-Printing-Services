import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';

export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(projectRoot, '.env') });
const stateRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'BMPrinting');
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const portOpen = (host, port) => new Promise(resolve => {
  const socket = net.connect({ host, port });
  const done = result => { socket.destroy(); resolve(result); };
  socket.once('connect', () => done(true)); socket.once('error', () => done(false));
  socket.setTimeout(1000, () => done(false));
});

async function databaseReady(uri) {
  const client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 1500 });
  try { await client.connect(); await client.db().command({ ping: 1 }); return true; }
  catch { return false; }
  finally { await client.close(); }
}

async function launch(executable, args, logName) {
  await fs.mkdir(stateRoot, { recursive: true });
  const log = await fs.open(path.join(stateRoot, logName), 'a');
  try {
    const child = spawn(executable, args, { cwd: projectRoot, detached: true, windowsHide: true,
      stdio: ['ignore', log.fd, log.fd], env: process.env });
    await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
    child.unref();
  } finally { await log.close(); }
}

async function findMongoBinary() {
  if (process.env.MONGOD_BINARY) { await fs.access(process.env.MONGOD_BINARY); return process.env.MONGOD_BINARY; }
  // Reuse the already-downloaded real mongod executable, not MongoMemoryServer.
  // Copy it out of node_modules so reinstalling dependencies cannot remove it.
  const binDir = path.join(stateRoot, 'bin');
  const saved = (await fs.readdir(binDir).catch(() => [])).find(name => /^mongod.*\.exe$/.test(name));
  if (saved) return path.join(binDir, saved);
  const cache = path.join(projectRoot, 'node_modules', '.cache', 'mongodb-memory-server');
  const cached = (await fs.readdir(cache).catch(() => [])).find(name => /^mongod.*\.exe$/.test(name));
  if (!cached) throw new Error('Install MongoDB Community Server and set MONGOD_BINARY to mongod, or start your configured MongoDB service. No temporary database will be substituted.');
  await fs.mkdir(binDir, { recursive: true });
  const target = path.join(binDir, cached);
  await fs.copyFile(path.join(cache, cached), target);
  return target;
}

export async function ensureLocalServices() {
  if (process.env.NODE_ENV === 'production') throw new Error('Use a managed MongoDB/service deployment in production; this launcher is for local development.');
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bmprinting';
  if (!await databaseReady(uri)) {
    let address;
    try { address = new URL(uri); } catch { throw new Error('MONGODB_URI is invalid.'); }
    if (address.protocol !== 'mongodb:' || !['127.0.0.1', 'localhost'].includes(address.hostname) || address.username || address.password) {
      throw new Error('The configured MongoDB is unavailable. Restore that database or correct MONGODB_URI; this launcher will not replace a remote or authenticated database.');
    }
    const port = Number(address.port || 27017);
    if (await portOpen('127.0.0.1', port)) throw new Error('The configured database port is occupied but MongoDB is not responding. Check the existing service; no replacement was started.');
    const binary = await findMongoBinary();
    const dbPath = path.resolve(process.env.MONGODB_DATA_DIR || path.join(stateRoot, 'mongodb', 'data'));
    await fs.mkdir(dbPath, { recursive: true });
    console.log(`Starting persistent MongoDB at ${dbPath}`);
    await launch(binary, ['--dbpath', dbPath, '--storageEngine', 'wiredTiger', '--bind_ip', '127.0.0.1', '--port', String(port),
      '--logpath', path.join(stateRoot, 'mongodb.log'), '--logappend'], 'mongodb-launch.log');
    let ready = false;
    for (let i = 0; i < 20 && !ready; i++) { ready = await databaseReady(uri); if (!ready) await delay(250); }
    if (!ready) throw new Error(`MongoDB did not start. Inspect ${path.join(stateRoot, 'mongodb.log')}. No data was deleted.`);
  }

  const port = Number(process.env.PORT || 4000);
  const healthUrl = `http://127.0.0.1:${port}/api/health`;
  const apiReady = async () => {
    try { const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) }); return response.ok && (await response.json()).db === 'connected'; }
    catch { return false; }
  };
  if (!await apiReady()) {
    if (await portOpen('127.0.0.1', port)) throw new Error(`Port ${port} is occupied but the order API is unhealthy. Inspect the running backend.`);
    await launch(process.execPath, ['server.js'], 'backend.log');
    let ready = false;
    for (let i = 0; i < 40 && !ready; i++) { ready = await apiReady(); if (!ready) await delay(250); }
    if (!ready) throw new Error(`Order API did not start. Inspect ${path.join(stateRoot, 'backend.log')}.`);
  }
  console.log(`Order API ready: ${healthUrl}; database connected. Existing data was not migrated or cleared.`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  ensureLocalServices().catch(error => { console.error(error.message); process.exitCode = 1; });
}
