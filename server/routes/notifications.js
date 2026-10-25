import mongoose from 'mongoose';
import { Notification } from '../db.js';
import { requireOrderAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/auth.js';
import { listNotificationDelivery, retryFailedNotification, runNotificationBatch } from '../notificationWorker.js';
import { timingSafeEqual } from 'node:crypto';

const view = item => ({ id: String(item._id), type: item.type, title: item.title, message: item.message, relatedOrderId: item.relatedOrderId, relatedJobId: item.relatedJobId, targetPage: item.targetPage, read: item.read, readAt: item.readAt, createdAt: item.createdAt });

export default function notificationRoutes(app) {
  app.get('/api/admin/notification-delivery', requireAdmin, async (_req, res) => {
    try { res.set('Cache-Control', 'private, no-store').json(await listNotificationDelivery()); }
    catch { res.status(503).json({ error: 'Unable to load notification delivery status.' }); }
  });
  app.post('/api/admin/notification-delivery/retry', requireAdmin, async (req, res) => {
    const { sourceType, sourceId, eventKey } = req.body || {};
    if (!['order', 'production-reassignment', 'production-exception', 'production', 'contact-message'].includes(sourceType)
      || typeof sourceId !== 'string' || sourceId.length > 100 || typeof eventKey !== 'string' || eventKey.length > 240) {
      return res.status(400).json({ error: 'Choose a valid failed notification event.' });
    }
    try {
      const updated = await retryFailedNotification({ sourceType, sourceId, eventKey, actorId: req.user.id });
      if (!updated) return res.status(409).json({ error: 'This notification is no longer eligible for manual retry.' });
      res.json({ success: true });
    } catch { res.status(503).json({ error: 'Unable to schedule this notification retry.' }); }
  });
  app.post('/api/internal/notification-worker/run', async (req, res) => {
    const secret = Buffer.from(process.env.NOTIFICATION_WORKER_SECRET || '');
    const provided = Buffer.from(String(req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!process.env.VERCEL || secret.length < 32 || provided.length !== secret.length
      || !timingSafeEqual(provided, secret)) return res.status(404).json({ error: 'Not found.' });
    try { res.json({ success: true, ...(await runNotificationBatch({ limit: 20 })) }); }
    catch { res.status(503).json({ error: 'Notification batch could not be completed.' }); }
  });
  app.get('/api/notifications', requireOrderAuth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
      const [items, unreadCount] = await Promise.all([
        Notification.find({ recipientId: req.user.id, recipientRole: req.user.role }).sort({ createdAt: -1 }).limit(limit).lean(),
        Notification.countDocuments({ recipientId: req.user.id, recipientRole: req.user.role, read: false })
      ]);
      res.set('Cache-Control', 'private, no-store').json({ notifications: items.map(view), unreadCount });
    } catch { res.status(503).json({ error: 'Unable to load notifications.' }); }
  });
  app.patch('/api/notifications/read-all', requireOrderAuth, async (req, res) => {
    try {
      const readAt = new Date();
      await Notification.updateMany({ recipientId: req.user.id, recipientRole: req.user.role, read: false }, { $set: { read: true, readAt } });
      res.json({ success: true, unreadCount: 0, readAt });
    } catch { res.status(503).json({ error: 'Unable to update notifications.' }); }
  });
  app.patch('/api/notifications/:id/read', requireOrderAuth, async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ error: 'Invalid notification.' });
    try {
      const notification = await Notification.findOneAndUpdate({ _id: req.params.id, recipientId: req.user.id, recipientRole: req.user.role }, { $set: { read: true, readAt: new Date() } }, { new: true });
      if (!notification) return res.status(404).json({ error: 'Notification not found.' });
      res.json({ notification: view(notification) });
    } catch { res.status(503).json({ error: 'Unable to update notification.' }); }
  });
}
