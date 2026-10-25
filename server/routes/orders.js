import { orderAccessFilter } from '../orderAccess.js';
import { reserveProductStock, releaseProductStock } from '../productReservations.js';
import { validateSpecifications, specificationSummary } from '../../shared/productSpecifications.js';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { isOrderStaff, ORDER_STATUSES } from '../../shared/orderWorkflow.js';
import { Order, Product, Production, AuditLog } from '../db.js';
import { requireOrderAuth, requireAdmin, requireOrderStaff } from '../middleware/auth.js';
import { orderIdParam, statusUpdate } from '../middleware/validate.js';
import { safeText, serializeOrder, uploadDesignFile } from '../utils.js';
import { requireDurableUploadStorage, removeNewUpload } from '../uploadStorage.js';
import { generateDailyReport, getDefaultReportDate } from '../reportService.js';
import { PRODUCT_CATALOG } from '../../shared/productCatalog.js';
import { toCentavos } from '../paymentAmounts.js';
import { makeNotificationIntent } from '../notificationService.js';
import { runNotificationBatch } from '../notificationWorker.js';

const serializeCustomerOrder = async order => {
  const production = await Production.findOne({ phase3: true, orderId: order.orderId })
    .select('jobOrderId status dateAssigned productionStartedAt productionCompletedAt readyForPickupAt reviewedAt reviewNotes productionHistory reservedMaterials')
    .lean();
  return {
    ...serializeOrder(order),
    production: production ? {
      jobOrderId: production.jobOrderId,
      status: production.status,
      dateAssigned: production.dateAssigned,
      productionStartedAt: production.productionStartedAt,
      productionCompletedAt: production.productionCompletedAt,
      readyForPickupAt: production.readyForPickupAt,
      reviewedAt: production.reviewedAt,
      reviewNotes: production.reviewNotes || '',
      productionHistory: production.productionHistory || [],
      reservedMaterials: production.reservedMaterials || []
    } : null
  };
};

const serializeAdminOrder = async order => {
  const production = await Production.findOne({ phase3: true, orderId: order.orderId })
    .select('jobOrderId status assignedEmployee assignedEmployeeName dateAssigned dueDate productionHistory')
    .lean();
  return { ...serializeOrder(order), production: production ? {
    jobOrderId: production.jobOrderId,
    status: production.status,
    assignedEmployee: production.assignedEmployee,
    assignedEmployeeName: production.assignedEmployeeName,
    dateAssigned: production.dateAssigned,
    dueDate: production.dueDate,
    productionHistory: production.productionHistory || []
  } : null,
  financialResolution: order.financialResolution?.toObject?.() || order.financialResolution || { status: 'NONE' },
  cancellationAudit: order.cancellationAudit || [],
  stockReleaseStatus: order.stockReleaseStatus || 'NOT_REQUIRED'
};
};

export default function orderRoutes(app) {
  app.get('/api/staff/orders', requireOrderStaff, async (req, res) => {
    try {
      let filter = { archived: { $ne: true } };
      if (req.user.role !== 'admin') {
        const assignedOrderIds = await Production.distinct('orderId', { phase3: true, assignedEmployee: req.user.id });
        filter = { archived: { $ne: true }, orderId: { $in: assignedOrderIds } };
      }
      const orders = await Order.find(filter).sort({ createdAt: -1 });
      res.json({ orders: req.user.role === 'admin' ? await Promise.all(orders.map(serializeAdminOrder)) : orders.map(serializeOrder) });
    } catch { res.status(503).json({ error: 'Unable to load orders. Please retry.' }); }
  });
  app.get('/api/guest/orders/:orderId', async (req, res) => {
    const token = req.headers['x-order-token'];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return res.status(404).json({ error: 'Order not found.' });
    try {
      const order = await Order.findOne({ orderId: req.params.orderId.toUpperCase(), customerId: null,
        guestTokenHash: createHash('sha256').update(token).digest('hex') });
      if (!order) return res.status(404).json({ error: 'Order not found.' });
      res.json({ order: await serializeCustomerOrder(order) });
    } catch { res.status(503).json({ error: 'Unable to load order.' }); }
  });
  app.get('/api/orders', requireOrderAuth, async (req, res) => {
    try {
      const orders = await Order.find(await orderAccessFilter(req.user)).sort({ createdAt: -1 });
      res.json({ orders: orders.map(serializeOrder) });
    } catch { res.status(503).json({ error: 'Unable to load orders.' }); }
  });

  app.get('/api/customers/orders', requireOrderAuth, async (req, res) => {
    try {
      const orders = await Order.find(await orderAccessFilter(req.user)).sort({ createdAt: -1 });
      res.json({ success: true, count: orders.length, orders: await Promise.all(orders.map(serializeCustomerOrder)) });
    } catch (error) {
      console.error('Failed to fetch customer orders:', error);
      res.status(500).json({ error: 'Unable to fetch customer orders.' });
    }
  });

  app.get('/api/customers/orders/:orderId', requireOrderAuth, async (req, res) => {
    try {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const order = await Order.findOne({ orderId, ...(await orderAccessFilter(req.user)) });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    return res.json({ success: true, order: await serializeCustomerOrder(order) });
    } catch { res.status(503).json({ error: 'Unable to load order.' }); }
  });

  app.get('/api/orders/:orderId', requireOrderAuth, async (req, res) => {
    try {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const order = await Order.findOne({ orderId, ...(await orderAccessFilter(req.user)) });

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    return res.json({ order: serializeOrder(order) });
    } catch { res.status(503).json({ error: 'Unable to load order.' }); }
  });

  const createOrder = async (req, res) => {
    let upload, reserved = false, saved = false, product, orderId;
    const reference = randomBytes(6).toString('hex');
    try {
      const body = req.body || {};
      const walkIn = req.path === '/api/admin/orders/walk-in';
      const customerName = safeText(body.customer || body.customerName || body.name).trim();
      const customerEmail = safeText(walkIn ? (body.email || body.customerEmail) : req.user.email).trim().toLowerCase();
      const phone = safeText(body.phone || body.contactNumber).trim();
      const fulfillmentMethod = body.fulfillmentMethod || 'pickup';
      const address = safeText(body.address).trim();
      const quantity = Number(body.quantity), productId = Number(body.productId);
      const paymentMethod = safeText(body.payment || body.paymentMethod);
      if (!customerName || customerName.length > 100 || (!walkIn && !phone) || phone.length > 30 || (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) || (!walkIn && !customerEmail && !req.user.phone)) return res.status(400).json({ error: 'Enter valid customer contact information.' });
      if (!['pickup', 'delivery'].includes(fulfillmentMethod) || (fulfillmentMethod === 'delivery' && !address)) return res.status(400).json({ error: 'A delivery address is required.' });
      if (!['GCash', 'Maya', 'BPI', 'GoTyme', 'cash'].includes(paymentMethod) || (walkIn && paymentMethod !== 'cash')) return res.status(400).json({ error: 'Choose a supported payment method.' });
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(productId)) return res.status(400).json({ error: 'Enter a valid product and whole quantity.' });
      product = await Product.findOne({ id: productId }).lean();
      if (!product && !await Product.exists({})) product = PRODUCT_CATALOG.find(p => p.id === productId);
      if (!product || product.active === false) return res.status(400).json({ error: 'This product is no longer available.' });
      const total = Number(product.price) * quantity;
      if (!Number.isSafeInteger(total) || total <= 0 || quantity < (product.minQty || 1)) return res.status(400).json({ error: 'Invalid price or minimum quantity.' });
      const details = body.specificationDetails || {};
      const fields = validateSpecifications(product, details);
      if (Object.keys(fields).length) return res.status(400).json({ error: 'Complete the product specifications.', fields });
      if (!body.designFile) return res.status(400).json({ error: 'Upload the customer design or reference.' });
      if (safeText(body.notes).length > 2000 || safeText(body.designNotes).length > 5000) return res.status(400).json({ error: 'Instructions are too long.' });
      orderId = (safeText(body.id || body.orderId) || 'ORD-' + randomBytes(12).toString('hex')).toUpperCase();
      if (!/^[A-Z0-9-]{1,50}$/.test(orderId)) return res.status(400).json({ error: 'Invalid order reference.' });
      if (await Order.exists({ orderId })) return res.status(409).json({ error: 'This reference is already saved. Check your orders before retrying.' });
      upload = await uploadDesignFile(body.designFile, orderId);
      if (!upload || upload.error) return res.status(400).json({ error: upload?.error || 'Design upload failed.' });
      await reserveProductStock(product, quantity, orderId); reserved = Boolean(product.trackStock);
      const order = await Order.create({
        orderId, customerId: walkIn ? null : req.user.id, orderSource: walkIn ? 'walk_in' : 'online', createdBy: req.user.id,
        customerName, customerEmail, contactNumber: phone, address, fulfillmentMethod,
        specs: specificationSummary(product, details), specificationDetails: details,
        items: [{ productId, productName: product.name, quantity, unitPrice: product.price, subtotal: total }],
        totalAmount: total, paymentMethod, paymentStatus: paymentMethod === 'cash' ? 'pending' : 'Unpaid', status: 'Pending',
        notificationOutbox: !walkIn ? [makeNotificationIntent({
          eventKey: `customer-order-created:${orderId}`, recipientId: '*', recipientRole: 'admin', type: 'new_order',
          title: 'New customer order', message: `Order ${orderId} was submitted by a customer.`, relatedOrderId: orderId, targetPage: 'admin'
        })] : [],
        notes: safeText(body.notes), designNotes: safeText(body.designNotes),
        designFilePath: upload.filePath, designFileName: upload.fileName, designOriginalName: upload.originalName,
        designFileOriginalName: upload.originalName, designFileType: upload.fileType, designFileSize: upload.fileSize
      });
      saved = true;
      if (!walkIn) await runNotificationBatch({ limit: 10 }).catch(() => {});
      await AuditLog.create({ userId: req.user.id, role: req.user.role, action: 'CREATE_ORDER', module: 'Orders', resourceType: 'Order', resourceId: orderId, newValue: { source: order.orderSource, paymentStatus: order.paymentStatus } });
      return res.json({ order: serializeOrder(order), guestToken: null });
    } catch (error) {
      if (!saved) {
        if (reserved) {
          try { await releaseProductStock(product.id, orderId); }
          catch (cleanupError) { console.error('Order stock cleanup failed.', { reference, errorName: cleanupError?.name, errorCode: cleanupError?.code }); }
        }
        if (upload?.filePath) {
          try { await removeNewUpload(upload.filePath); }
          catch (cleanupError) { console.error('Order file cleanup failed.', { reference, errorName: cleanupError?.name, errorCode: cleanupError?.code }); }
        }
      }
      console.error('Order creation failed.', { reference, errorName: error?.name, errorCode: error?.code });
      const status = error.status || (error.code === 11000 ? 409 : error.name === 'ValidationError' ? 400 : 500);
      return res.status(status).json({
        error: saved
          ? `Order saved, but the audit log needs attention. Check My Orders before retrying. Reference ${reference}.`
          : error.status
            ? error.message
            : `Unable to save the order. Check My Orders before retrying. Reference ${reference}.`,
        reference
      });
    }
  };
  app.post('/api/orders', requireOrderAuth, (req, res, next) => req.user.role === 'customer' ? next() : res.status(403).json({ error: 'Use Admin walk-in ordering.' }), requireDurableUploadStorage, createOrder);
  app.post('/api/admin/orders/walk-in', requireAdmin, requireDurableUploadStorage, createOrder);

  app.patch('/api/orders/:orderId/status', requireAdmin, orderIdParam, statusUpdate, async (req, res) => {
    let cancellationCommitted = false;
    try {
      const orderId = safeText(req.params.orderId).toUpperCase();
      const status = safeText(req.body?.status);
      if (!status) {
        return res.status(400).json({ error: 'Status is required.' });
      }

      const allowedStatuses = ORDER_STATUSES;
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
      }

      const order = await Order.findOne({ orderId });
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      if (status === 'Cancelled') {
        const reason = safeText(req.body?.cancellationReason || req.body?.reason).trim().slice(0, 1000);
        if (!reason) return res.status(400).json({ error: 'Enter a cancellation reason.' });
        if (order.status === 'Cancelled' && order.stockReleaseStatus !== 'COMPLETED') {
          try {
            await releaseProductStock(order.items?.[0]?.productId, orderId);
            await Order.updateOne({ _id: order._id, status: 'Cancelled' }, { $set: { stockReleaseStatus: 'COMPLETED' } });
            order.stockReleaseStatus = 'COMPLETED';
            return res.json({ order: serializeOrder(order), recoveredStockRelease: true });
          } catch (error) {
            console.error('Cancelled order stock release recovery failed:', error);
            return res.status(503).json({ error: 'The order is cancelled, but its stock release is still pending. Retry cancellation with the same order to finish recovery.' });
          }
        }
        if (order.archived || ['Picked Up', 'Completed', 'Cancelled'].includes(order.status) || !order.canTransitionTo('Cancelled')) {
          return res.status(409).json({ error: 'This order is not eligible for cancellation.' });
        }
        const pendingEvidence = order.paymentStatus === 'For Verification' || order.paymentSubmissions?.some(payment => payment.status === 'For Verification');
        if (pendingEvidence) return res.status(409).json({ error: 'Payment evidence is awaiting review. Reject or resolve it before cancelling this order.' });

        const cash = order.cashPayment || {};
        const verifiedSubmissions = (order.paymentSubmissions || []).filter(payment => payment.status === 'Verified');
        const hasVerifiedReceipt = order.paymentStatus === 'Verified' || Boolean(cash.verifiedAt || cash.verifiedBy) || verifiedSubmissions.length > 0;
        const resolution = order.financialResolution?.toObject?.() || order.financialResolution || {};
        const resolutionState = resolution.status || 'NONE';
        let receiptCents = 0;
        let receiptEvidenceValid = true;
        const totalCents = toCentavos(order.totalAmount);
        if (cash.verifiedAt || cash.verifiedBy) {
          const amount = toCentavos(cash.amount);
          if (!cash.verifiedAt || !cash.verifiedBy || amount == null) receiptEvidenceValid = false;
          else receiptCents += amount;
        }
        for (const payment of verifiedSubmissions) {
          const amount = toCentavos(payment.amount);
          if (!payment.verifiedAt || !payment.verifiedBy || amount == null) receiptEvidenceValid = false;
          else receiptCents += amount;
        }
        if (hasVerifiedReceipt && (!receiptEvidenceValid || receiptCents !== totalCents || totalCents == null)) {
          return res.status(409).json({ error: 'Verified payment records are inconsistent or do not equal the full order total. Reconcile the payment before cancellation.' });
        }
        const finalResolution = ['REFUND_COMPLETED', 'CREDIT_ISSUED', 'NO_REFUND_APPLICABLE'].includes(resolutionState);
        if (hasVerifiedReceipt && (!finalResolution || resolution.originalVerifiedAmountCents !== receiptCents || resolution.accountedAmountCents !== receiptCents)) {
          return res.status(409).json({ error: 'This order has verified payment. Record a complete Admin financial resolution before cancellation.' });
        }
        if (!hasVerifiedReceipt && !['Unpaid', 'pending', 'Rejected'].includes(order.paymentStatus || 'Unpaid')) {
          return res.status(409).json({ error: 'The payment state is not eligible for cancellation. Reconcile it before continuing.' });
        }

        const assignedProduction = await Production.exists({ orderId, $or: [
          { assignedEmployee: { $nin: ['', null] } }, { phase3: true }
        ] });
        if (assignedProduction) return res.status(409).json({ error: 'This order has a production assignment and cannot be cancelled.' });

        const cancelledAt = new Date();
        const auditEvent = {
          eventId: randomUUID(), action: 'CANCEL_ORDER', orderId,
          previousStatus: order.status, newStatus: 'Cancelled', reason,
          paymentStatus: order.paymentStatus || 'Unpaid',
          financialResolutionId: resolution.resolutionId || '',
          actorId: req.user.id, actorName: req.user.name || req.user.email || '',
          timestamp: cancelledAt
        };
        const atomicFilter = {
          _id: order._id, orderId, status: order.status,
          archived: { $ne: true }, jobOrderId: { $in: [null, ''] },
          paymentSubmissions: { $not: { $elemMatch: { status: 'For Verification' } } }
        };
        if (hasVerifiedReceipt) {
          atomicFilter.paymentStatus = 'Verified';
          atomicFilter['financialResolution.status'] = resolutionState;
          atomicFilter['financialResolution.resolutionId'] = resolution.resolutionId;
          atomicFilter['financialResolution.originalVerifiedAmountCents'] = receiptCents;
          atomicFilter['financialResolution.accountedAmountCents'] = receiptCents;
        } else {
          atomicFilter.$or = [
            { paymentStatus: { $in: ['Unpaid', 'pending', 'Rejected'] } },
            { paymentStatus: { $exists: false } },
            { paymentStatus: null }
          ];
          atomicFilter.paymentSubmissions.$not.$elemMatch.status = { $in: ['For Verification', 'Verified'] };
          atomicFilter['cashPayment.verifiedAt'] = null;
        }
        const updated = await Order.findOneAndUpdate(
          atomicFilter,
          { $set: { status: 'Cancelled', stockReleaseStatus: 'PENDING' }, $push: {
            cancellationAudit: auditEvent,
            ...(order.customerId ? { notificationOutbox: makeNotificationIntent({
              eventKey: `order-cancelled:${orderId}:${auditEvent.eventId}`, recipientId: order.customerId, recipientRole: 'customer', type: 'order_cancelled',
              title: 'Order cancelled', message: `Order ${orderId} was cancelled.`, relatedOrderId: orderId, targetPage: 'myorders', createdAt: cancelledAt
            }) } : {})
          } },
          { new: true, runValidators: true }
        );
        if (!updated) return res.status(409).json({ error: 'The order, payment, or assignment changed. Refresh and verify eligibility before retrying.' });
        cancellationCommitted = true;
        if (order.customerId) await runNotificationBatch({ limit: 10 }).catch(() => {});
        await releaseProductStock(order.items?.[0]?.productId, orderId);
        const releaseUpdate = await Order.updateOne({ _id: updated._id, status: 'Cancelled', stockReleaseStatus: 'PENDING' }, { $set: { stockReleaseStatus: 'COMPLETED' } });
        if (releaseUpdate.modifiedCount) updated.stockReleaseStatus = 'COMPLETED';
        try {
          await AuditLog.create({
            userId: req.user.id, userName: req.user.name || req.user.email || '', role: 'admin',
            action: 'CANCEL_ORDER', module: 'Orders', resourceType: 'Order', resourceId: orderId,
            previousValue: { status: order.status, paymentStatus: order.paymentStatus || 'Unpaid' },
            newValue: { status: 'Cancelled', reason, financialResolutionId: resolution.resolutionId || '', timestamp: cancelledAt },
            timestamp: cancelledAt
          });
        } catch (error) {
          console.error('Cancellation is recorded on the Order but central audit logging failed:', error);
          return res.status(503).json({ error: 'Cancellation was recorded on the order, but central audit logging failed. Do not repeat the action; the embedded order event is the recovery record.' });
        }
        return res.json({ order: serializeOrder(updated) });
      }

      if (order.jobOrderId) return res.status(409).json({ error: 'Use the assigned Job Order workflow to update production status.' });
      if (['Confirmed', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Processing'].includes(status) && order.paymentStatus !== 'Verified') {
        return res.status(409).json({ error: 'Payment must be verified before confirming this order.' });
      }
      if (['Ready for Pickup', 'Picked Up', 'Completed'].includes(status) && order.paymentStatus !== 'Verified') {
        return res.status(409).json({ error: 'Payment must be verified before pickup or completion.' });
      }
      if (['Confirmed', 'Processing', 'Ready for Pickup'].includes(order.status) && ['Processing', 'Ready for Pickup', 'Picked Up', 'Completed'].includes(status)) {
        return res.status(409).json({ error: 'Assign and complete a Job Order before advancing production or pickup status.' });
      }
      if (order.status === 'Cancelled' && status === 'Cancelled') { await releaseProductStock(order.items[0].productId, orderId); return res.json({ order: serializeOrder(order) }); }
      if (order.status === 'Completed' || order.status === 'Cancelled') {
        return res.status(400).json({ error: 'Cannot modify a finalized order.' });
      }

      if (!order.canTransitionTo(status)) {
        return res.status(400).json({ error: `Cannot transition from '${order.status}' to '${status}'.` });
      }

      if (req.body.expectedStatus && req.body.expectedStatus !== order.status) {
        return res.status(409).json({ error: 'This order changed. Refresh and try again.' });
      }
      const notificationOutbox = status === 'Confirmed' && order.customerId && order.status !== 'Confirmed'
        ? makeNotificationIntent({ eventKey: `order-confirmed:${orderId}`, recipientId: order.customerId, recipientRole: 'customer', type: 'order_confirmed', title: 'Order confirmed', message: `Order ${orderId} was confirmed and is ready for production.`, relatedOrderId: orderId, targetPage: 'myorders' }) : null;
      const update = { $set: { status, ...(status === 'Completed' ? { completedAt: new Date() } : {}) } };
      if (notificationOutbox) update.$push = { notificationOutbox };
      const updated = await Order.findOneAndUpdate({ orderId, status: order.status, jobOrderId: { $exists: false } },
        update,
        { new: true, runValidators: true });
      if (!updated) return res.status(409).json({ error: 'This order changed. Refresh and try again.' });
      if (notificationOutbox) await runNotificationBatch({ limit: 10 }).catch(() => {});

      if (status === 'Cancelled') await releaseProductStock(order.items[0].productId, orderId);
      const reportDate = getDefaultReportDate();
      await generateDailyReport(reportDate, { regenerate: false }).catch(error => console.error('Report generation failed:', error.message));
      res.json({ order: serializeOrder(updated) });
    } catch (error) {
      console.error('Status update failed:', error);
      if (cancellationCommitted) return res.status(503).json({ error: 'Cancellation was recorded, but stock release or audit follow-up failed. Retry the cancellation request to recover stock release; review the order audit before any other action.' });
      res.status(500).json({ error: 'Unable to update status.' });
    }
  });

  app.delete('/api/orders/:orderId', requireAdmin, (_req, res) => res.status(409).json({ error: 'Preserve order history: cancel or archive this order instead.' }));
}
