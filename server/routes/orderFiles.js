import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Order, OrderFile } from '../db.js';
import { optionalOrderAuth, requireAdmin, requireOrderAuth } from '../middleware/auth.js';
import { isOrderStaff } from '../../shared/orderWorkflow.js';

const ownerFilter = user => isOrderStaff(user) ? {} : {
  $or: [
    { customerId: user.id },
    // Phone-only customers have no email; scope legacy orders by ID only.
    ...(user.email ? [{ customerId: null, customerEmail: user.email.toLowerCase() }] : [])
  ]
};
async function accessibleOrder(req) {
  const orderId = req.params.orderId.toUpperCase();
  if (req.user) return Order.findOne({ orderId, ...ownerFilter(req.user) });
  const token = req.headers['x-order-token'];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  return Order.findOne({ orderId, customerId: null, guestTokenHash: createHash('sha256').update(token).digest('hex') });
}

export default function orderFileRoutes(app, directory) {
  const send = async (res, filename, name = filename) => {
    if (!filename || path.basename(filename) !== filename || filename.includes('\\')) return res.status(404).json({ error: 'Design file not found.' });
    try {
      const root = await fs.realpath(directory);
      const file = await fs.realpath(path.join(root, filename));
      if (!file.startsWith(root + path.sep)) return res.status(404).json({ error: 'Design file not found.' });
      // Files are downloaded, never interpreted as same-origin HTML or SVG.
      res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox" });
      res.download(file, name, error => { if (error && !res.headersSent) res.status(404).json({ error: 'Design file not found.' }); });
    } catch { res.status(404).json({ error: 'Design file not found.' }); }
  };
  app.get('/api/orders/:orderId/files', optionalOrderAuth, async (req, res) => {
    try {
      const order = await accessibleOrder(req);
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      const files = await OrderFile.find({ orderId: order.orderId }).sort({ uploadedAt: 1 });
      const result = files.map(file => ({ id: String(file._id), name: file.originalName, type: file.fileType, size: file.fileSize }));
      if (order.designFileName) result.unshift({ id: 'design', name: order.designOriginalName || order.designFileName, type: order.designFileType, size: order.designFileSize });
      res.set('Cache-Control', 'no-store').json({ files: result });
    } catch { res.status(503).json({ error: 'Unable to load design files.' }); }
  });
  app.get('/api/orders/:orderId/files/:fileId', optionalOrderAuth, async (req, res) => {
    try {
      const order = await accessibleOrder(req);
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (req.params.fileId === 'design') return send(res, order.designFileName, order.designOriginalName || order.designFileName);
      if (!/^[a-f0-9]{24}$/i.test(req.params.fileId)) return res.status(404).json({ error: 'Design file not found.' });
      const file = await OrderFile.findOne({ _id: req.params.fileId, orderId: order.orderId });
      if (!file) return res.status(404).json({ error: 'Design file not found.' });
      return send(res, file.filename, file.originalName);
    } catch { res.status(503).json({ error: 'Unable to load design file.' }); }
  });
  app.get('/api/admin/orders/:orderId/payments/:paymentId/receipt', requireAdmin, async (req, res) => {
    try {
      const order = await Order.findOne({ orderId: req.params.orderId.toUpperCase() });
      const payment = order?.paymentSubmissions?.id(req.params.paymentId);
      if (!payment) return res.status(404).json({ error: 'Payment receipt not found.' });
      return send(res, payment.receiptFileName, payment.receiptOriginalName);
    } catch { return res.status(503).json({ error: 'Unable to load payment receipt.' }); }
  });
  // Preserve the legacy URL, with server-side ownership checks.
  app.get('/uploads/orders/:filename', requireOrderAuth, async (req, res) => {
    try {
      const filename = req.params.filename;
      let order = await Order.findOne({ designFileName: filename, ...ownerFilter(req.user) });
      if (!order) {
        const file = await OrderFile.findOne({ filename });
        if (file) order = await Order.findOne({ orderId: file.orderId, ...ownerFilter(req.user) });
      }
      if (!order) return res.status(404).json({ error: 'Design file not found.' });
      return send(res, filename);
    } catch { res.status(503).json({ error: 'Unable to load design file.' }); }
  });
}
