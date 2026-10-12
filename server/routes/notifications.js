import mongoose from 'mongoose';
import { Notification } from '../db.js';
import { requireOrderAuth } from '../middleware/auth.js';

const view = item => ({ id: String(item._id), type: item.type, title: item.title, message: item.message, relatedOrderId: item.relatedOrderId, relatedJobId: item.relatedJobId, targetPage: item.targetPage, read: item.read, readAt: item.readAt, createdAt: item.createdAt });

export default function notificationRoutes(app) {
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
