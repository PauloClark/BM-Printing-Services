import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

export function safeText(value) {
  return typeof value === 'string' ? value : '';
}

export function serializeOrder(order) {
  const firstItem = order.items?.[0] || {};
  return {
    id: order.orderId,
    orderId: order.orderId,
    customerName: order.customerName,
    customerEmail: order.customerEmail,
    contactNumber: order.contactNumber,
    address: order.address,
    items: order.items || [],
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    status: order.status,
    notes: order.notes,
    designNotes: order.designNotes,
    designFilePath: order.designFilePath,
    designFileName: order.designFileName,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    serviceName: firstItem.productName || firstItem.name || 'N/A'
  };
}

export function uploadDesignFile(fileData) {
  if (!fileData || !fileData.base64) return null;
  try {
    const matches = fileData.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) return null;
    const ext = fileData.filename?.split('.').pop() || 'bin';
    const filename = `design-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const uploadsDir = path.join(UPLOADS_DIR, 'orders');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const buffer = Buffer.from(matches[2], 'base64');
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    return { filename, originalName: fileData.filename || filename, fileType: matches[1], fileSize: buffer.length, storagePath: `/uploads/orders/${filename}` };
  } catch (err) {
    console.error('File upload failed:', err);
    return null;
  }
}

export function uploadProductImage(fileData) {
  if (!fileData || !fileData.base64) return '';
  try {
    const matches = fileData.base64.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
    if (!matches) return '';
    const ext = fileData.filename?.split('.').pop() || 'png';
    const filename = `product-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const uploadsDir = path.join(UPLOADS_DIR, 'products');
    if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
    const buffer = Buffer.from(matches[2], 'base64');
    fs.writeFileSync(path.join(uploadsDir, filename), buffer);
    return `/uploads/products/${filename}`;
  } catch (err) {
    console.error('Image upload failed:', err);
    return '';
  }
}
