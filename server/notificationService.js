import { Notification, User } from './db.js';

const clean = (value, max) => String(value || '').trim().slice(0, max);

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

export async function notifyAdmins(event) {
  const admins = await User.find({ role: 'admin' }).select('id').lean();
  return Promise.all(admins.map(admin => createNotification({ ...event, recipientId: admin.id, recipientRole: 'admin', eventKey: `${event.eventKey}:${admin.id}` })));
}

export async function safeNotify(operation) {
  try { return await operation(); }
  catch (error) { console.error('Notification persistence failed:', error.message); return null; }
}
