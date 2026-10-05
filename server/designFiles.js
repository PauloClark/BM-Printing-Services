import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const TYPES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', pdf: 'application/pdf', svg: 'image/svg+xml' };
export function saveDesignFile(data, directory) {
  if (!data) return null;
  const originalName = path.basename(String(data.filename || data.originalName || ''));
  const extension = originalName.split('.').pop().toLowerCase();
  const match = typeof data.base64 === 'string' && data.base64.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\r\n]+)$/);
  if (!match || !TYPES[extension] || match[1] !== TYPES[extension]) return { error: 'Upload a valid JPG, PNG, WebP, PDF or SVG design file.' };
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > 10 * 1024 * 1024) return { error: 'Design files must be between 1 byte and 10 MB.' };
  const fileName = `design-${randomUUID()}.${extension}`;
  try {
    fs.mkdirSync(directory, { recursive: true });
    const filePath = path.join(directory, fileName);
    fs.writeFileSync(filePath, bytes, { flag: 'wx' });
    return { fileName, filePath, originalName, fileType: TYPES[extension], fileSize: bytes.length };
  } catch {
    return { error: 'Unable to save the design file. Please retry.' };
  }
}
