import fs from 'node:fs/promises';
import path from 'node:path';
import { Order } from '../db.js';
import { requireAdmin, requireOrderAuth } from '../middleware/auth.js';
import { safeText, serializeOrder, uploadDesignFile } from '../utils.js';
import { isOrderStaff } from '../../shared/orderWorkflow.js';

const customerOrderFilter = user => ({
  $or: [
    { customerId: user.id },
    ...(user.email ? [{ customerId: null, customerEmail: user.email.toLowerCase() }] : [])
  ]
});

const latestPayment = order => order.paymentSubmissions?.[order.paymentSubmissions.length - 1] || null;

const paymentSummary = payment => ({
  id: String(payment._id),
  paymentMethod: payment.paymentMethod,
  amount: payment.amount,
  referenceNumber: payment.referenceNumber,
  status: payment.status,
  submittedAt: payment.submittedAt,
  verifiedAt: payment.verifiedAt,
  verifiedBy: payment.verifiedBy,
  rejectedAt: payment.rejectedAt,
  rejectedBy: payment.rejectedBy,
  rejectionReason: payment.rejectionReason,
  receiptOriginalName: payment.receiptOriginalName,
  receiptFileType: payment.receiptFileType,
  receiptFileSize: payment.receiptFileSize
});

export default function orderPaymentRoutes(app, uploadDirectory) {
  app.post('/api/orders/:orderId/payments', requireOrderAuth, async (req, res) => {
    if (isOrderStaff(req.user)) return res.status(403).json({ error: 'Customer access is required to submit an order payment.' });

    const orderId = safeText(req.params.orderId).toUpperCase();
    const paymentMethod = safeText(req.body?.paymentMethod).trim();
    const referenceNumber = safeText(req.body?.referenceNumber).trim();
    const amount = Number(req.body?.amount);
    const receipt = req.body?.receipt;
    if (!['GCash', 'Maya', 'BPI', 'GoTyme'].includes(paymentMethod)) return res.status(400).json({ error: 'Choose a supported payment method.' });
    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Enter a valid amount greater than zero.' });
    if (!referenceNumber || referenceNumber.length > 100) return res.status(400).json({ error: 'Enter a reference number (up to 100 characters).' });
    const receiptExtension = path.extname(safeText(receipt?.filename)).toLowerCase();
    if (!receipt || !['.jpg', '.jpeg', '.png', '.webp'].includes(receiptExtension)) {
      return res.status(400).json({ error: 'Upload a JPG, JPEG, PNG, or WEBP payment receipt.' });
    }

    try {
      const order = await Order.findOne({ orderId, ...customerOrderFilter(req.user) });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (['Cancelled', 'Completed'].includes(order.status)) return res.status(409).json({ error: 'Payment cannot be submitted for a finalized order.' });
      if (order.paymentStatus === 'Verified') return res.status(409).json({ error: 'This order payment is already verified.' });
      if (order.paymentStatus === 'For Verification') return res.status(409).json({ error: 'A payment is already waiting for verification.' });

      const stored = uploadDesignFile(receipt);
      if (!stored || stored.error) return res.status(400).json({ error: stored?.error || 'Unable to save the payment receipt.' });
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(stored.fileType)) {
        await fs.unlink(stored.filePath).catch(() => {});
        return res.status(400).json({ error: 'Upload a JPG, JPEG, PNG, or WEBP payment receipt.' });
      }

      const submittedAt = new Date();
      const submission = {
        customerId: req.user.id,
        paymentMethod,
        amount,
        referenceNumber,
        receiptFileName: stored.fileName,
        receiptFilePath: stored.filePath,
        receiptOriginalName: stored.originalName,
        receiptFileType: stored.fileType,
        receiptFileSize: stored.fileSize,
        status: 'For Verification',
        submittedAt
      };
      const updated = await Order.findOneAndUpdate(
        {
          _id: order._id,
          paymentStatus: { $in: ['Unpaid', 'Rejected'] },
          status: { $nin: ['Cancelled', 'Completed'] }
        },
        { $push: { paymentSubmissions: submission }, $set: { paymentStatus: 'For Verification', paymentRejectionReason: '' } },
        { new: true, runValidators: true }
      );
      if (!updated) {
        await fs.unlink(stored.filePath).catch(() => {});
        return res.status(409).json({ error: 'The order payment changed. Refresh My Orders and try again.' });
      }
      return res.json({ order: serializeOrder(updated) });
    } catch (error) {
      console.error('Payment submission failed:', error);
      return res.status(500).json({ error: 'Unable to submit payment. Please try again.' });
    }
  });

  app.get('/api/admin/payments/verification', requireAdmin, async (_req, res) => {
    try {
      const orders = await Order.find({ paymentStatus: 'For Verification' }).sort({ 'paymentSubmissions.submittedAt': 1 });
      const payments = orders.map(order => {
        const payment = latestPayment(order);
        if (!payment) return null;
        const item = order.items?.[0] || {};
        return {
          orderId: order.orderId,
          customerName: order.customerName,
          customerEmail: order.customerEmail,
          product: item.productName || '',
          quantity: item.quantity || 0,
          orderTotal: order.totalAmount,
          payment: paymentSummary(payment)
        };
      }).filter(Boolean);
      return res.json({ payments });
    } catch {
      return res.status(503).json({ error: 'Unable to load payments for verification.' });
    }
  });

  app.patch('/api/admin/orders/:orderId/payments/:paymentId/review', requireAdmin, async (req, res) => {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const paymentId = safeText(req.params.paymentId);
    const action = safeText(req.body?.action);
    const rejectionReason = safeText(req.body?.rejectionReason).trim().slice(0, 500);
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: 'Choose approve or reject.' });
    if (action === 'reject' && !rejectionReason) return res.status(400).json({ error: 'Enter a reason for rejecting this payment.' });

    try {
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (['Cancelled', 'Completed'].includes(order.status)) return res.status(409).json({ error: 'A finalized order cannot be reviewed for payment.' });
      const payment = latestPayment(order);
      if (!payment || String(payment._id) !== paymentId) return res.status(404).json({ error: 'Payment submission not found.' });
      if (order.paymentStatus !== 'For Verification' || payment.status !== 'For Verification') {
        return res.status(409).json({ error: 'This payment is no longer waiting for verification.' });
      }

      const reviewedAt = new Date();
      const reviewFields = action === 'approve' ? {
        paymentStatus: 'Verified',
        paymentRejectionReason: '',
        status: 'Confirmed',
        'paymentSubmissions.$.status': 'Verified',
        'paymentSubmissions.$.verifiedAt': reviewedAt,
        'paymentSubmissions.$.verifiedBy': req.user.id
      } : {
        paymentStatus: 'Rejected',
        paymentRejectionReason: rejectionReason,
        status: 'Pending',
        'paymentSubmissions.$.status': 'Rejected',
        'paymentSubmissions.$.rejectedAt': reviewedAt,
        'paymentSubmissions.$.rejectedBy': req.user.id,
        'paymentSubmissions.$.rejectionReason': rejectionReason
      };
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, paymentStatus: 'For Verification', status: { $nin: ['Cancelled', 'Completed'] }, 'paymentSubmissions._id': payment._id },
        { $set: reviewFields },
        { new: true, runValidators: true }
      );
      if (!updated) return res.status(409).json({ error: 'This payment was already reviewed. Refresh and try again.' });
      return res.json({ order: serializeOrder(updated), payment: paymentSummary(latestPayment(updated)) });
    } catch (error) {
      console.error('Payment review failed:', error);
      return res.status(500).json({ error: 'Unable to review this payment. Please try again.' });
    }
  });
}
