import { Notification } from './db.js';
import { listNotificationAdmins } from './staffDirectory.js';
import { createHash } from 'node:crypto';

const clean = (value, max) => String(value || '').trim().slice(0, max);

export function makeNotificationIntent({ eventKey, recipientId, recipientRole, type, title, message, relatedOrderId = '', relatedJobId = '', targetPage = '', createdAt = new Date() }) {
  return { eventKey: clean(eventKey, 240), recipientId: clean(recipientId, 200), recipientRole, type: clean(type, 80), title: clean(title, 160), message: clean(message, 1000), relatedOrderId: clean(relatedOrderId, 80), relatedJobId: clean(relatedJobId, 80), targetPage, state: 'PENDING', attempts: 0, manualRetryCount: 0, lastAttemptAt: null, nextAttemptAt: null, lockedUntil: null, lockToken: '', deliveryHistory: [], createdAt, deliveredAt: null, lastError: '' };
}

export async function createNotification({ recipientId, recipientRole, type, title, message, relatedOrderId = '', relatedJobId = '', targetPage = '', eventKey }) {
  if (!recipientId || !eventKey) return null;
  try {
    return await Notification.findOneAndUpdate(
      { eventKey: clean(eventKey, 240) },
      { $setOnInsert: { recipientId: clean(recipientId, 200), recipientRole, type: clean(type, 80), title: clean(title, 160), message: clean(message, 1000), relatedOrderId: clean(relatedOrderId, 80), relatedJobId: clean(relatedJobId, 80), targetPage, eventKey: clean(eventKey, 240), read: false, readAt: null } },
      { new: true, upsert: true, runValidators: true }
    );
  } catch (error) {
    if (error?.code === 11000) return Notification.findOne({ eventKey: clean(eventKey, 240) });
    throw error;
  }
}

export function recipientEventKey(eventKey, recipientId) {
  const full = `${clean(eventKey, 240)}:${clean(recipientId, 200)}`;
  if (full.length <= 240) return full;
  const hash = createHash('sha256').update(full).digest('hex').slice(0, 20);
  return `${full.slice(0, 219)}:${hash}`;
}

export async function notifyAdmins(event) {
  const admins = await listNotificationAdmins();
  return Promise.all(admins.map(admin => createNotification({ ...event, recipientId: admin.id, recipientRole: 'admin', eventKey: recipientEventKey(event.eventKey, admin.id) })));
}

export async function safeNotify(operation) {
  try { return await operation(); }
  catch (error) { console.error('Notification persistence failed:', error.message); return null; }
}
