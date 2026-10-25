import { orderAccessFilter } from '../orderAccess.js';
import { downloadPrivateFile } from '../uploadStorage.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Order, OrderFile } from '../db.js';
import { optionalOrderAuth, requireAdmin, requireOrderAuth } from '../middleware/auth.js';
import { isOrderStaff } from '../../shared/orderWorkflow.js';

async function accessibleOrder(req) {
  const orderId = req.params.orderId.toUpperCase();
  if (req.user) return Order.findOne({ orderId, ...(await orderAccessFilter(req.user)) });
  const token = req.headers['x-order-token'];
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  return Order.findOne({ orderId, customerId: null, guestTokenHash: createHash('sha256').update(token).digest('hex') });
}

export default function orderFileRoutes(app, directory) {
  const send = async (res, filename, name = filename, reference = '', type = '', missingMessage = 'Design file not found.') => {
    if (reference.startsWith('supabase://')) {
      try {
        const file = await downloadPrivateFile(reference);
        res.set({ 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; sandbox", 'Content-Type': type || file.type || 'application/octet-stream', 'Content-Disposition': "attachment; filename*=UTF-8''" + encodeURIComponent(name) });
        return res.send(file.bytes);
      } catch (error) {
        if (error.status === 503) return res.status(503).json({ error: 'Unable to load the stored attachment. Please try again.' });
        return res.status(404).json({ error: missingMessage });
      }
    }
    if (!filename || path.basename(filename) !== filename || filename.includes('\\')) return res.status(404).json({ error: missingMessage });
    try {
      const root = path.resolve(directory);
      const candidate = reference
        ? path.isAbsolute(reference) ? path.resolve(reference) : path.resolve(root, reference)
        : path.resolve(root, filename);
      if (!path.isAbsolute(reference || '') && reference) {
        const relative = path.relative(root, candidate);
        if (relative.startsWith('..') || path.isAbsolute(relative)) return res.status(404).json({ error: missingMessage });
      }
      if (path.basename(candidate) !== filename) return res.status(404).json({ error: missingMessage });
      const file = await fs.realpath(candidate);
      const stat = await fs.stat(file);
      if (!stat.isFile()) return res.status(404).json({ error: missingMessage });
      const contentType = /^[\w.+-]+\/[\w.+-]+$/.test(type) ? type : 'application/octet-stream';
      res.set({
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; sandbox",
        'Content-Type': contentType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name || filename)}`
      });
      return res.send(await fs.readFile(file));
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return res.status(404).json({ error: missingMessage });
      return res.status(503).json({ error: 'Unable to load the stored attachment. Please try again.' });
    }
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
      if (req.params.fileId === 'design') return send(res, order.designFileName, order.designOriginalName || order.designFileName, order.designFilePath, order.designFileType);
      if (!/^[a-f0-9]{24}$/i.test(req.params.fileId)) return res.status(404).json({ error: 'Design file not found.' });
      const file = await OrderFile.findOne({ _id: req.params.fileId, orderId: order.orderId });
      if (!file) return res.status(404).json({ error: 'Design file not found.' });
      return send(res, file.filename, file.originalName, file.storagePath, file.fileType);
    } catch { res.status(503).json({ error: 'Unable to load design file.' }); }
  });
  app.get('/api/admin/orders/:orderId/payments/:paymentId/receipt', requireAdmin, async (req, res) => {
    try {
      const order = await Order.findOne({ orderId: req.params.orderId.toUpperCase() });
      const payment = order?.paymentSubmissions?.id(req.params.paymentId);
      if (!payment) return res.status(404).json({ error: 'Payment receipt not found.' });
      return send(
        res,
        payment.receiptFileName,
        payment.receiptOriginalName,
        payment.receiptFilePath,
        payment.receiptFileType,
        'Receipt unavailable - file missing.'
      );
    } catch { return res.status(503).json({ error: 'Unable to load payment receipt.' }); }
  });
  // Preserve the legacy URL, with server-side ownership checks.
  app.get('/uploads/orders/:filename', requireOrderAuth, async (req, res) => {
    try {
      const filename = req.params.filename;
      let order = await Order.findOne({ designFileName: filename, ...(await orderAccessFilter(req.user)) });
      if (!order) {
        const file = await OrderFile.findOne({ filename });
        if (file) order = await Order.findOne({ orderId: file.orderId, ...(await orderAccessFilter(req.user)) });
      }
      if (!order) return res.status(404).json({ error: 'Design file not found.' });
      return send(res, filename);
    } catch { res.status(503).json({ error: 'Unable to load design file.' }); }
  });
}
