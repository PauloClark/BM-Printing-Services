import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { decodeDesignFile } from './designFiles.js';

const bucketPattern = /^[a-z0-9][a-z0-9._-]{0,61}[a-z0-9]$/;
const storageConfig = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET?.trim() || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || !bucketPattern.test(bucket) || !serviceKey) return null;
  } catch { return null; }
  return { url, bucket, serviceKey };
};
export const storageConfigured = () => Boolean(storageConfig());
const client = config => createClient(config.url, config.serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function requirePrivateBucket(storage, bucket) {
  const { data, error } = await storage.getBucket(bucket);
  if (error || !data || data.public) throw new Error('A configured private Storage bucket is required.');
}
export function requireDurableUploadStorage(_req, res, next) {
  if (storageConfigured() || (process.env.NODE_ENV !== 'production' && !process.env.VERCEL)) return next();
  return res.status(503).json({ code: 'DURABLE_UPLOAD_STORAGE_REQUIRED', error: 'Private design storage is not configured. Contact Admin; no order or payment has been saved.' });
}
export async function storePrivateFile(data, orderId, kind = 'design') {
  const config = storageConfig();
  if (!config) throw new Error('Private file storage is not configured.');
  if (!/^[A-Z0-9-]{1,50}$/i.test(String(orderId || '')) || !['design', 'receipt'].includes(kind)) {
    throw new Error('Invalid private file storage path.');
  }
  const decoded = decodeDesignFile(data);
  if (!decoded || decoded.error) return decoded;
  const { bytes, extension, originalName, fileType, fileSize } = decoded;
  const storage = client(config).storage;
  await requirePrivateBucket(storage, config.bucket);
  const objectPath = `${orderId.toUpperCase()}/${kind}/${randomUUID()}.${extension}`;
  const { error } = await storage.from(config.bucket).upload(objectPath, bytes, { contentType: fileType, upsert: false });
  if (error) throw new Error('Private file upload failed.');
  return { fileName: objectPath.split('/').pop(), filePath: `supabase://${config.bucket}/${objectPath}`, originalName, fileType, fileSize };
}
function location(reference) {
  const match = /^supabase:\/\/([^/]+)\/(.+)$/.exec(reference || '');
  if (!match || match[2].split('/').some(p => p === '..' || !p)) throw new Error('Invalid storage reference.');
  return { bucket: match[1], path: match[2] };
}
export async function downloadPrivateFile(reference) {
  const config = storageConfig();
  if (!config) throw new Error('Private file storage is not configured.');
  const loc = location(reference);
  if (loc.bucket !== config.bucket) throw new Error('Invalid private storage bucket reference.');
  const storage = client(config).storage;
  await requirePrivateBucket(storage, loc.bucket);
  const { data, error } = await storage.from(loc.bucket).download(loc.path);
  if (error || !data) {
    const missing = String(error?.statusCode || error?.status || '') === '404';
    throw Object.assign(new Error('Stored attachment is unavailable.'), { status: missing ? 404 : 503 });
  }
  return { bytes: Buffer.from(await data.arrayBuffer()), type: data.type };
}
export async function removeNewUpload(reference) {
  if (!reference) return;
  if (!reference.startsWith('supabase://')) { if (process.env.NODE_ENV === 'test') await fs.unlink(reference).catch(() => {}); return; }
  const config = storageConfig();
  if (!config) throw new Error('Private file storage is not configured.');
  const loc = location(reference);
  if (loc.bucket !== config.bucket) throw new Error('Invalid private storage bucket reference.');
  const { error } = await client(config).storage.from(loc.bucket).remove([loc.path]);
  if (error) throw new Error('Unlinked upload requires cleanup.');
}
