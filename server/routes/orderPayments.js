import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AuditLog, Order } from '../db.js';
import { requireAdmin, requireOrderAuth } from '../middleware/auth.js';
import { safeText, serializeOrder, uploadDesignFile } from '../utils.js';
import { requireDurableUploadStorage, removeNewUpload } from '../uploadStorage.js';
import { isOrderStaff } from '../../shared/orderWorkflow.js';
import { makeNotificationIntent } from '../notificationService.js';
import { runNotificationBatch } from '../notificationWorker.js';
import { paymentMatchesOrderTotal, toCentavos } from '../paymentAmounts.js';

const customerOrderFilter = user => ({
  $or: [
    { customerId: user.id },
    ...(user.email ? [{ customerId: null, orderSource: { $ne: 'walk_in' }, customerEmail: user.email.toLowerCase() }] : [])
  ]
});

const latestPayment = order => order.paymentSubmissions?.[order.paymentSubmissions.length - 1] || null;
const isFinalizedOrder = order => Boolean(order.archived) || ['Cancelled', 'Completed', 'Picked Up'].includes(order.status);
const verifiedReceiptDetails = order => {
  let amountCents = 0, count = 0, uncertain = false;
  const cash = order.cashPayment || {};
  if (cash.verifiedAt || cash.verifiedBy) {
    const amount = toCentavos(cash.amount);
    if (!cash.verifiedAt || !cash.verifiedBy || amount == null) uncertain = true;
    else { amountCents += amount; count += 1; }
  }
  for (const payment of order.paymentSubmissions || []) {
    if (payment.status !== 'Verified') continue;
    const amount = toCentavos(payment.amount);
    if (!payment.verifiedAt || !payment.verifiedBy || amount == null) uncertain = true;
    else { amountCents += amount; count += 1; }
  }
  if (order.paymentStatus === 'Verified' && count === 0) uncertain = true;
  const totalCents = toCentavos(order.totalAmount);
  if (count > 0 && amountCents !== totalCents) uncertain = true;
  return { amountCents, count, uncertain, totalCents };
};
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
  !Number.isNaN(Date.parse(`${value}T12:00:00+08:00`)) &&
  new Date(`${value}T12:00:00+08:00`).toISOString().slice(0, 10) === value;

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
  receiptFileSize: payment.receiptFileSize,
  reconciliationAt: payment.reconciliationAt,
  reconciliationBy: payment.reconciliationBy,
  reconciliationNote: payment.reconciliationNote
});

export default function orderPaymentRoutes(app, uploadDirectory) {
  app.post('/api/admin/orders/:orderId/cash', requireAdmin, async (req, res) => {
    try {
      if (req.body?.received !== true) return res.status(400).json({ error: 'Confirm that cash was actually received.' });
      const orderId = safeText(req.params.orderId).toUpperCase();
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      const amount = Number(req.body.amount);
      if (order.paymentMethod !== 'cash' || order.paymentStatus === 'Verified' || ['Cancelled', 'Completed', 'Picked Up'].includes(order.status)) return res.status(409).json({ error: 'This order cannot accept cash verification.' });
      if (!paymentMatchesOrderTotal(amount, order.totalAmount)) return res.status(422).json({ error: 'Record the full order total received, excluding change.' });
      const verifiedAt = new Date();
      const event = { action: 'VERIFY_CASH_PAYMENT', userId: req.user.id, amount, timestamp: verifiedAt, previousStatus: order.paymentStatus };
      const notification = order.customerId ? makeNotificationIntent({ eventKey: `cash-payment-verified:${orderId}`, recipientId: order.customerId, recipientRole: 'customer', type: 'payment_verified', title: 'Payment verified', message: `Cash payment for order ${orderId} was verified.`, relatedOrderId: orderId, targetPage: 'myorders', createdAt: verifiedAt }) : null;
      const update = { $set: { cashPayment: { amount, verifiedBy: req.user.id, verifiedAt }, paymentStatus: 'Verified' }, $push: { paymentAudit: event } };
      if (notification) update.$push.notificationOutbox = notification;
      const updated = await Order.findOneAndUpdate({ _id: order._id, paymentStatus: order.paymentStatus, status: order.status, totalAmount: order.totalAmount }, update, { new: true, runValidators: true });
      if (!updated) return res.status(409).json({ error: 'Order changed. Refresh before confirming payment.' });
      if (notification) await runNotificationBatch({ limit: 10 }).catch(() => {});
      await AuditLog.create({ ...event, role: 'admin', module: 'Payments', resourceType: 'Order', resourceId: orderId, newValue: { amount, paymentStatus: 'Verified' } });
      return res.json({ order: serializeOrder(updated) });
    } catch { return res.status(503).json({ error: 'Unable to complete cash verification. Refresh the order before retrying.' }); }
  });

  app.post('/api/orders/:orderId/payments', requireOrderAuth, requireDurableUploadStorage, async (req, res) => {
    if (isOrderStaff(req.user)) return res.status(403).json({ error: 'Customer access is required to submit an order payment.' });

    const orderId = safeText(req.params.orderId).toUpperCase();
    const paymentMethod = safeText(req.body?.paymentMethod).trim();
    const referenceNumber = safeText(req.body?.referenceNumber).trim();
    const amount = Number(req.body?.amount);
    const receipt = req.body?.receipt;
    if (!['GCash', 'Maya', 'BPI', 'GoTyme'].includes(paymentMethod)) return res.status(400).json({ error: 'Choose a supported payment method.' });
    if (toCentavos(amount) === null) return res.status(400).json({ error: 'Enter a valid positive PHP amount with no fractions smaller than one centavo.' });
    if (!referenceNumber || referenceNumber.length > 100) return res.status(400).json({ error: 'Enter a reference number (up to 100 characters).' });
    const receiptExtension = path.extname(safeText(receipt?.filename)).toLowerCase();
    if (!receipt || !['.jpg', '.jpeg', '.png', '.webp'].includes(receiptExtension)) {
      return res.status(400).json({ error: 'Upload a JPG, JPEG, PNG, or WEBP payment receipt.' });
    }

    try {
      const order = await Order.findOne({ orderId, ...customerOrderFilter(req.user) });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (order.paymentMethod === 'cash') return res.status(409).json({ error: 'Cash must be confirmed by Admin at the shop.' });
      if (toCentavos(order.totalAmount) === null) return res.status(409).json({ error: 'This order total is invalid. Contact BM Printing Services before paying.' });
      if (!paymentMatchesOrderTotal(amount, order.totalAmount)) {
        return res.status(422).json({ error: 'Full payment is required. The submitted amount must exactly match the stored order total.' });
      }
      if (isFinalizedOrder(order)) return res.status(409).json({ error: 'Payment cannot be submitted for a finalized order.' });
      if (order.paymentStatus === 'Verified') return res.status(409).json({ error: 'This order payment is already verified.' });
      if (order.paymentStatus === 'For Verification') return res.status(409).json({ error: 'A payment is already waiting for verification.' });

      const stored = await uploadDesignFile(receipt, orderId, "receipt");
      if (!stored || stored.error) return res.status(400).json({ error: stored?.error || 'Unable to save the payment receipt.' });
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(stored.fileType)) {
        await removeNewUpload(stored.filePath).catch(() => {});
        return res.status(400).json({ error: 'Upload a JPG, JPEG, PNG, or WEBP payment receipt.' });
      }

      const submittedAt = new Date();
      const submissionEventId = randomUUID();
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
        { $push: {
          paymentSubmissions: submission,
          notificationOutbox: makeNotificationIntent({ eventKey: `payment-submitted:${orderId}:${submissionEventId}`, recipientId: '*', recipientRole: 'admin', type: 'payment_submitted', title: 'Payment proof submitted', message: `Order ${orderId} has a payment awaiting verification.`, relatedOrderId: orderId, targetPage: 'admin', createdAt: submittedAt })
        }, $set: { paymentStatus: 'For Verification', paymentRejectionReason: '' } },
        { new: true, runValidators: true }
      );
      if (!updated) {
        await removeNewUpload(stored.filePath).catch(() => {});
        return res.status(409).json({ error: 'The order payment changed. Refresh My Orders and try again.' });
      }
      await runNotificationBatch({ limit: 10 }).catch(() => {});
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
          orderStatus: order.status,
          archived: Boolean(order.archived),
          amountMatchesOrderTotal: paymentMatchesOrderTotal(payment.amount, order.totalAmount),
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
    if (action === 'approve' && req.body?.transactionConfirmed !== true) {
      return res.status(400).json({ error: 'Confirm that the actual transaction was verified before approving this payment.' });
    }

    try {
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (isFinalizedOrder(order)) return res.status(409).json({ error: 'A finalized order cannot be reviewed for payment.' });
      const payment = latestPayment(order);
      if (!payment || String(payment._id) !== paymentId) return res.status(404).json({ error: 'Payment submission not found.' });
      if (order.paymentStatus !== 'For Verification' || payment.status !== 'For Verification') {
        return res.status(409).json({ error: 'This payment is no longer waiting for verification.' });
      }
      if (action === 'approve' && !paymentMatchesOrderTotal(payment.amount, order.totalAmount)) {
        return res.status(409).json({ error: 'This payment cannot be verified because its amount does not exactly match the stored order total. Reject it and ask the customer to submit the full amount.' });
      }

      const reviewedAt = new Date();
      const reviewFields = action === 'approve' ? {
        paymentStatus: 'Verified',
        paymentRejectionReason: '',
        'paymentSubmissions.$.status': 'Verified',
        'paymentSubmissions.$.verifiedAt': reviewedAt,
        'paymentSubmissions.$.verifiedBy': req.user.id
      } : {
        paymentStatus: 'Rejected',
        paymentRejectionReason: rejectionReason,
        'paymentSubmissions.$.status': 'Rejected',
        'paymentSubmissions.$.rejectedAt': reviewedAt,
        'paymentSubmissions.$.rejectedBy': req.user.id,
        'paymentSubmissions.$.rejectionReason': rejectionReason
      };
      const paymentAudit = {
        action: action === 'approve' ? 'VERIFY_PAYMENT' : 'REJECT_PAYMENT',
        paymentId,
        userId: req.user.id,
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        referenceNumber: payment.referenceNumber,
        transactionConfirmed: action === 'approve',
        orderStatus: order.status,
        archived: Boolean(order.archived),
        timestamp: reviewedAt
      };
      const paymentNotification = order.customerId ? makeNotificationIntent({
        eventKey: `payment-${action}:${orderId}:${paymentId}`, recipientId: order.customerId, recipientRole: 'customer',
        type: action === 'approve' ? 'payment_verified' : 'payment_rejected',
        title: action === 'approve' ? 'Payment verified' : 'Payment needs attention',
        message: action === 'approve' ? `Payment for order ${orderId} was verified.` : `Payment for order ${orderId} needs attention. Review My Orders for next steps.`,
        relatedOrderId: orderId, targetPage: 'myorders', createdAt: reviewedAt
      }) : null;
      const reviewUpdate = { $set: reviewFields, $push: { paymentAudit } };
      if (paymentNotification) reviewUpdate.$push.notificationOutbox = paymentNotification;
      const updated = await Order.findOneAndUpdate(
        {
          _id: order._id,
          totalAmount: order.totalAmount,
          paymentStatus: 'For Verification',
          status: { $nin: ['Cancelled', 'Completed'] },
          paymentSubmissions: { $elemMatch: { _id: payment._id, status: 'For Verification', amount: payment.amount } }
        },
        reviewUpdate,
        { new: true, runValidators: true }
      );
      if (!updated) return res.status(409).json({ error: 'This payment was already reviewed. Refresh and try again.' });
      try {
        await AuditLog.create({
          userId: req.user.id, userName: req.user.name || req.user.email || '', role: req.user.role,
          action: action === 'approve' ? 'VERIFY_PAYMENT' : 'REJECT_PAYMENT', module: 'Payments',
          resourceType: 'Order', resourceId: orderId,
          previousValue: {
            paymentId, paymentStatus: 'For Verification', orderStatus: order.status,
            paymentMethod: payment.paymentMethod, amount: payment.amount, referenceNumber: payment.referenceNumber
          },
          newValue: {
            paymentId, paymentStatus: updated.paymentStatus, orderStatus: updated.status,
            paymentMethod: payment.paymentMethod, amount: payment.amount, referenceNumber: payment.referenceNumber,
            transactionConfirmed: action === 'approve'
          },
          timestamp: reviewedAt
        });
      } catch (error) {
        console.error('Payment state was updated but the central audit log could not be written:', error);
        return res.status(503).json({ error: 'The payment decision was recorded, but the central audit log could not be written. Do not retry; contact Admin.' });
      }
      if (paymentNotification) await runNotificationBatch({ limit: 10 }).catch(() => {});
      return res.json({ order: serializeOrder(updated), payment: paymentSummary(latestPayment(updated)) });
    } catch (error) {
      console.error('Payment review failed:', error);
      return res.status(500).json({ error: 'Unable to review this payment. Please try again.' });
    }
  });

  app.post('/api/admin/orders/:orderId/payments/:paymentId/reconcile', requireAdmin, async (req, res) => {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const paymentId = safeText(req.params.paymentId);
    const note = safeText(req.body?.note).trim().slice(0, 1000);
    if (!note) return res.status(400).json({ error: 'Add a note describing the financial reconciliation required.' });

    try {
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (!isFinalizedOrder(order)) {
        return res.status(409).json({ error: 'Only finalized or archived orders can be sent for financial reconciliation.' });
      }
      const payment = latestPayment(order);
      if (!payment || String(payment._id) !== paymentId || payment.status !== 'For Verification' || order.paymentStatus !== 'For Verification') {
        return res.status(409).json({ error: 'This payment is no longer awaiting reconciliation.' });
      }

      const reconciledAt = new Date();
      const auditEvent = {
        action: 'FLAG_PAYMENT_RECONCILIATION',
        paymentId,
        userId: req.user.id,
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        referenceNumber: payment.referenceNumber,
        transactionConfirmed: false,
        orderStatus: order.status,
        archived: Boolean(order.archived),
        note,
        timestamp: reconciledAt
      };
      const updated = await Order.findOneAndUpdate(
        {
          _id: order._id,
          status: order.status,
          archived: Boolean(order.archived),
          paymentStatus: 'For Verification',
          paymentSubmissions: {
            $elemMatch: { _id: payment._id, status: 'For Verification', reconciliationAt: null }
          }
        },
        {
          $set: {
            'paymentSubmissions.$.reconciliationAt': reconciledAt,
            'paymentSubmissions.$.reconciliationBy': req.user.id,
            'paymentSubmissions.$.reconciliationNote': note
          },
          $push: { paymentAudit: auditEvent }
        },
        { new: true, runValidators: true }
      );
      if (!updated) return res.status(409).json({ error: 'This payment was already flagged or changed. Refresh before retrying.' });

      try {
        await AuditLog.create({
          userId: req.user.id,
          userName: req.user.name || req.user.email || '',
          role: req.user.role,
          action: 'FLAG_PAYMENT_RECONCILIATION',
          module: 'Payments',
          resourceType: 'Order',
          resourceId: orderId,
          previousValue: {
            paymentId, paymentStatus: 'For Verification', orderStatus: order.status,
            paymentMethod: payment.paymentMethod, amount: payment.amount, referenceNumber: payment.referenceNumber
          },
          newValue: {
            paymentId, paymentStatus: updated.paymentStatus, orderStatus: updated.status,
            paymentMethod: payment.paymentMethod, amount: payment.amount, referenceNumber: payment.referenceNumber,
            transactionConfirmed: false, note
          },
          timestamp: reconciledAt
        });
      } catch (error) {
        console.error('Reconciliation was flagged but the central audit log could not be written:', error);
        return res.status(503).json({ error: 'Reconciliation was recorded, but the central audit log could not be written. Do not retry; contact Admin.' });
      }
      return res.json({ order: serializeOrder(updated), payment: paymentSummary(latestPayment(updated)) });
    } catch (error) {
      console.error('Payment reconciliation flag failed:', error);
      return res.status(500).json({ error: 'Unable to record the reconciliation request. Please try again.' });
    }
  });

  app.post('/api/admin/orders/:orderId/financial-resolution', requireAdmin, async (req, res) => {
    const orderId = safeText(req.params.orderId).trim().toUpperCase();
    const action = safeText(req.body?.action).trim();
    const reason = safeText(req.body?.reason).trim().slice(0, 1000);
    const referenceNumber = safeText(req.body?.referenceNumber).trim().slice(0, 120);
    const evidenceName = path.basename(safeText(req.body?.evidenceName).trim()).slice(0, 160);

    try {
      const order = await Order.findOne({ orderId });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      if (order.archived || ['Cancelled', 'Completed', 'Picked Up'].includes(order.status)) {
        return res.status(409).json({ error: 'Financial resolution must be recorded before finalizing or archiving this order.' });
      }
      if (order.paymentStatus === 'For Verification' || order.paymentSubmissions?.some(payment => payment.status === 'For Verification')) {
        return res.status(409).json({ error: 'Review or reject pending payment evidence before recording a financial resolution.' });
      }
      const verified = verifiedReceiptDetails(order);
      if (order.paymentStatus !== 'Verified' || verified.count === 0 || verified.uncertain || verified.amountCents !== verified.totalCents) {
        return res.status(409).json({ error: 'Verified payment records are missing, inconsistent, or do not equal the full order total. Resolve the payment record before continuing.' });
      }

      const current = order.financialResolution?.toObject?.() || order.financialResolution || {};
      const currentState = current.status || 'NONE';
      const validActions = {
        NONE: ['require_refund', 'no_refund_applicable'],
        REFUND_REQUIRED: ['refund_pending', 'refund_completed', 'credit_issued', 'no_refund_applicable'],
        REFUND_PENDING: ['refund_completed', 'credit_issued', 'no_refund_applicable']
      };
      if (!validActions[currentState]?.includes(action)) return res.status(409).json({ error: 'This financial resolution is already final or has changed. Refresh before retrying.' });
      if (action === 'require_refund' && reason.length < 5) return res.status(400).json({ error: 'Enter why a refund is required.' });
      if (action === 'refund_pending' && reason.length < 5) return res.status(400).json({ error: 'Enter a note describing the refund processing step.' });
      if (action === 'no_refund_applicable' && (reason.length < 20 || req.body?.exceptionApproved !== true)) {
        return res.status(400).json({ error: 'A justified exception of at least 20 characters and explicit Admin approval are required.' });
      }

      const resolutionDateInput = safeText(req.body?.resolutionDate);
      let resolutionDate = null, amountCents = 0, confirmation = '';
      if (['refund_completed', 'credit_issued'].includes(action)) {
        amountCents = toCentavos(req.body?.amount);
        if (amountCents !== verified.amountCents) return res.status(409).json({ error: 'The refund or credit must account for the full verified payment. Partial or mismatched resolutions remain blocked.' });
        if (!referenceNumber || !validDate(resolutionDateInput)) return res.status(400).json({ error: 'Enter a valid resolution date and payment or credit reference.' });
        if (action === 'refund_completed' && req.body?.transactionConfirmed !== true) return res.status(400).json({ error: 'Confirm that the refund was actually returned to the customer.' });
        if (action === 'credit_issued' && req.body?.customerAgreed !== true) return res.status(400).json({ error: 'Confirm the customer agreed to the recorded credit.' });
        resolutionDate = new Date(`${resolutionDateInput}T12:00:00+08:00`);
        confirmation = action === 'refund_completed' ? 'Admin confirmed funds were returned.' : 'Admin confirmed customer agreement to credit.';
      }

      const now = new Date();
      const resolutionId = current.resolutionId || randomUUID();
      const nextState = {
        require_refund: 'REFUND_REQUIRED', refund_pending: 'REFUND_PENDING',
        refund_completed: 'REFUND_COMPLETED', credit_issued: 'CREDIT_ISSUED',
        no_refund_applicable: 'NO_REFUND_APPLICABLE'
      }[action];
      const terminal = ['REFUND_COMPLETED', 'CREDIT_ISSUED', 'NO_REFUND_APPLICABLE'].includes(nextState);
      const next = {
        ...current,
        status: nextState,
        resolutionId,
        originalVerifiedAmountCents: verified.amountCents,
        accountedAmountCents: terminal ? verified.amountCents : 0,
        resolutionType: nextState,
        reason: reason || current.reason || '',
        referenceNumber: referenceNumber || current.referenceNumber || '',
        resolutionDate: resolutionDate || (nextState === 'NO_REFUND_APPLICABLE' ? now : current.resolutionDate || null),
        resolvedBy: req.user.id,
        evidenceName: evidenceName || current.evidenceName || '',
        confirmation: confirmation || (nextState === 'NO_REFUND_APPLICABLE' ? 'Admin approved documented no-refund exception.' : current.confirmation || '')
      };
      const event = {
        eventId: randomUUID(), orderId, action, fromStatus: currentState, toStatus: nextState,
        originalVerifiedAmountCents: verified.amountCents,
        accountedAmountCents: next.accountedAmountCents,
        amountCents: amountCents || 0, reason: reason || next.reason,
        referenceNumber: referenceNumber || '', resolutionDate,
        evidenceName, confirmation: confirmation || next.confirmation,
        actorId: req.user.id, actorName: req.user.name || req.user.email || '', occurredAt: now
      };
      const resolutionNotification = order.customerId ? makeNotificationIntent({
        eventKey: `financial-resolution:${orderId}:${event.eventId}`, recipientId: order.customerId, recipientRole: 'customer',
        type: 'financial_resolution_updated', title: 'Order financial resolution updated',
        message: `The refund or credit status for order ${orderId} was updated. Review My Orders for the current status.`,
        relatedOrderId: orderId, targetPage: 'myorders', createdAt: now
      }) : null;
      const stateFilter = currentState === 'NONE'
        ? { $or: [{ 'financialResolution.status': 'NONE' }, { 'financialResolution.status': { $exists: false } }] }
        : { 'financialResolution.status': currentState };
      const updated = await Order.findOneAndUpdate(
        { _id: order._id, status: order.status, paymentStatus: 'Verified', archived: { $ne: true }, ...stateFilter },
        { $set: { financialResolution: next }, $push: { financialResolutionEvents: event, ...(resolutionNotification ? { notificationOutbox: resolutionNotification } : {}) } },
        { new: true, runValidators: true }
      );
      if (!updated) return res.status(409).json({ error: 'The order or financial resolution changed. Refresh before retrying.' });
      if (resolutionNotification) await runNotificationBatch({ limit: 10 }).catch(() => {});

      try {
        await AuditLog.create({
          userId: req.user.id, userName: req.user.name || req.user.email || '', role: 'admin',
          action: `FINANCIAL_RESOLUTION_${nextState}`, module: 'Financials', resourceType: 'Order', resourceId: orderId,
          previousValue: { status: currentState, originalVerifiedAmountCents: current.originalVerifiedAmountCents || 0 },
          newValue: { ...event }, timestamp: now
        });
      } catch (error) {
        console.error('Financial resolution is on the Order but central audit logging failed:', error);
        return res.status(503).json({ error: 'Resolution was recorded on the order, but central audit logging failed. Do not repeat the action; contact Admin. The embedded order event is the authoritative recovery record.' });
      }
      return res.json({ order: serializeOrder(updated), financialResolution: updated.financialResolution, financialResolutionEvents: updated.financialResolutionEvents });
    } catch (error) {
      console.error('Financial resolution failed:', error);
      return res.status(500).json({ error: 'Unable to record financial resolution.' });
    }
  });
}
