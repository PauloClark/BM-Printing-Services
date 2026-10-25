import { storePrivateFile, storageConfigured } from './uploadStorage.js';
import { saveDesignFile } from './designFiles.js';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.join(__dirname, '..', 'uploads');

export function safeText(value) {
  return typeof value === 'string' ? value : '';
}

export function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function serializeOrder(order) {
  const firstItem = order.items?.[0] || {};
  const date = order.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : '';
  return {
    id: order.orderId,
    orderId: order.orderId,
    jobOrderId: order.jobOrderId || null,
    customer: order.customerName,
    customerName: order.customerName,
    email: order.customerEmail,
    customerEmail: order.customerEmail,
    phone: order.contactNumber,
    contactNumber: order.contactNumber,
    address: order.address,
    product: firstItem.productName || firstItem.name || '',
    productId: firstItem.productId || null,
    quantity: firstItem.quantity || 0,
    items: order.items || [],
    total: order.totalAmount,
    totalAmount: order.totalAmount,
    payment: order.paymentMethod,
    paymentMethod: order.paymentMethod,
    payment_method: order.paymentMethod,
    payment_status: order.paymentStatus === 'Verified' ? 'paid' : order.paymentStatus === 'For Verification' ? 'for_verification' : 'pending',
    orderSource: order.orderSource || 'online',
    order_source: order.orderSource || 'online',
    createdBy: order.createdBy || '',
    fulfillmentMethod: order.fulfillmentMethod,
    specificationDetails: order.specificationDetails || {},
    cashPayment: order.cashPayment || null,
    paymentStatus: order.paymentStatus || 'Unpaid',
    paymentRejectionReason: order.paymentRejectionReason || '',
    latestPayment: order.paymentSubmissions?.length ? (() => {
      const payment = order.paymentSubmissions[order.paymentSubmissions.length - 1];
      return {
        id: String(payment._id),
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        referenceNumber: payment.referenceNumber,
        status: payment.status,
        submittedAt: payment.submittedAt,
        verifiedAt: payment.verifiedAt,
        verifiedBy: payment.verifiedBy,
        rejectionReason: payment.rejectionReason,
        receiptOriginalName: payment.receiptOriginalName,
        reconciliationAt: payment.reconciliationAt,
        reconciliationBy: payment.reconciliationBy,
        reconciliationNote: payment.reconciliationNote
      };
    })() : null,
    status: order.status,
    notes: order.notes,
    designNotes: order.designNotes,
    designOriginalName: order.designOriginalName,
    designFileName: order.designFileName,
    designFileOriginalName: order.designFileOriginalName,
    designFileType: order.designFileType,
    designFileSize: order.designFileSize,
    specs: order.specs || order.designNotes || order.notes || '',
    userId: order.customerId,
    date,
    createdAt: order.createdAt,
    completedAt: order.completedAt,
    pickedUpAt: order.pickedUpAt || null,
    releasedBy: order.releasedBy || '',
    releasedByName: order.releasedByName || '',
    receivedByName: order.receivedByName || null,
    archived: order.archived || false,
    archivedAt: order.archivedAt || null,
    archivedBy: order.archivedBy || '',
    archivedByName: order.archivedByName || '',
    serviceName: firstItem.productName || firstItem.name || 'N/A'
  };
}

export async function uploadDesignFile(fileData, orderId, kind) {
  if (storageConfigured()) return storePrivateFile(fileData, orderId, kind);
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Object.assign(new Error("Private Storage is not configured."), { status: 503 });
  return saveDesignFile(fileData, path.resolve(process.env.ORDER_UPLOAD_DIR || path.join(UPLOADS_DIR, 'orders')));
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
