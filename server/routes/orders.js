import { randomBytes, createHash } from 'node:crypto';
import { isOrderStaff, ORDER_STATUSES } from '../../shared/orderWorkflow.js';
import { Order, Production } from '../db.js';
import { requireOrderAuth, requireAdmin, requireOrderStaff } from '../middleware/auth.js';
import { orderCreate, orderIdParam, statusUpdate } from '../middleware/validate.js';
import { safeText, serializeOrder, uploadDesignFile } from '../utils.js';
import { generateDailyReport, getDefaultReportDate } from '../reportService.js';

const orderOwnershipFilter = user => {
  if (isOrderStaff(user)) return {};
  const filters = [{ customerId: user.id }];
  if (user.email) {
    // Email compatibility is limited to old orders without an assigned owner.
    filters.push({ customerId: null, customerEmail: user.email.toLowerCase() });
  }
  return { $or: filters };
};

const serializeCustomerOrder = async order => {
  const production = await Production.findOne({ phase3: true, orderId: order.orderId })
    .select('jobOrderId status dateAssigned productionStartedAt productionCompletedAt readyForPickupAt reservedMaterials')
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
      reservedMaterials: production.reservedMaterials || []
    } : null
  };
};

const bindAuthenticatedEmail = (req, res, next) => {
  const body = req.body || {};
  const productId = Number(body.productId);
  const quantity = Number(body.quantity);
  const productName = safeText(body.product || body.productName);
  const unitPrice = Number(body.unitPrice ?? body.price ?? 0);
  req.body = {
    ...body,
    customerName: safeText(body.customerName || body.customer || body.name || req.user?.name),
    customerEmail: req.user?.email || body.email || body.customerEmail,
    contactNumber: safeText(body.contactNumber || body.phone || req.user?.phone),
    items: [{ productId, productName, quantity, unitPrice }]
  };
  next();
};

export default function orderRoutes(app) {
  app.get('/api/staff/orders', requireOrderStaff, async (req, res) => {
    try {
      const orders = await Order.find({}).sort({ createdAt: -1 });
      res.json({ orders: orders.map(serializeOrder) });
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
      const orders = await Order.find(orderOwnershipFilter(req.user)).sort({ createdAt: -1 });
      res.json({ orders: orders.map(serializeOrder) });
    } catch { res.status(503).json({ error: 'Unable to load orders.' }); }
  });

  app.get('/api/customers/orders', requireOrderAuth, async (req, res) => {
    try {
      const orders = await Order.find(orderOwnershipFilter(req.user)).sort({ createdAt: -1 });
      res.json({ success: true, count: orders.length, orders: await Promise.all(orders.map(serializeCustomerOrder)) });
    } catch (error) {
      console.error('Failed to fetch customer orders:', error);
      res.status(500).json({ error: 'Unable to fetch customer orders.' });
    }
  });

  app.get('/api/customers/orders/:orderId', requireOrderAuth, async (req, res) => {
    try {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const order = await Order.findOne({ orderId, ...orderOwnershipFilter(req.user) });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    return res.json({ success: true, order: await serializeCustomerOrder(order) });
    } catch { res.status(503).json({ error: 'Unable to load order.' }); }
  });

  app.get('/api/orders/:orderId', requireOrderAuth, async (req, res) => {
    try {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const order = await Order.findOne({ orderId, ...orderOwnershipFilter(req.user) });

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    return res.json({ order: serializeOrder(order) });
    } catch { res.status(503).json({ error: 'Unable to load order.' }); }
  });

  app.post('/api/orders', requireOrderAuth, bindAuthenticatedEmail, orderCreate, async (req, res) => {
    try {
      const body = req.body || {};
      const customerName = safeText(body.customer || body.name || body.customerName);
      const customerEmail = safeText(req.user?.email || body.customerEmail).toLowerCase();
      const contactNumber = safeText(body.phone || body.contactNumber);
      const address = safeText(body.address);
      const paymentMethod = safeText(body.payment || body.paymentMethod);
      const notes = safeText(body.notes);
      const quantity = Number(body.quantity || 0);
      const productId = Number(body.productId);
      const productName = safeText(body.product || body.productName);
      const total = Number(body.total || 0);
      const designNotes = safeText(body.designNotes);
      const designFileData = body.designFile || null;

      if (!customerName || !customerEmail || !contactNumber || !productName || !paymentMethod || !quantity || !productId) {
        return res.status(400).json({ error: 'Missing required order information.' });
      }

      if (!Number.isFinite(total) || total < 0 || !Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid order price or product.' });
      const orderId = (safeText(body.id || body.orderId) || `ORD-${randomBytes(8).toString('hex')}`).toUpperCase();
      if (!/^[A-Z0-9-]{1,50}$/.test(orderId)) return res.status(400).json({ error: 'Invalid order ID.' });
      const createdAt = new Date();

      // Handle design file upload
      let designFileResult = null;
      if (designFileData) {
        designFileResult = uploadDesignFile(designFileData);
        if (designFileResult?.error) {
          return res.status(400).json({ error: designFileResult.error });
        }
      }

      const order = await Order.create({
        orderId,
        customerId: req.user.id,
        specs: safeText(body.specs),
        customerName,
        customerEmail,
        contactNumber,
        address,
        items: [{
          productId,
          productName,
          quantity,
          unitPrice: Number(body.unitPrice || body.price || 0),
          subtotal: Number(body.subtotal || total)
        }],
        totalAmount: total,
        paymentMethod,
        status: 'Pending',
        notes,
        designNotes,
        designFilePath: designFileResult ? designFileResult.filePath : '',
        designFileName: designFileResult ? designFileResult.fileName : '',
        designOriginalName: designFileResult ? designFileResult.originalName : '',
        designFileOriginalName: designFileResult ? designFileResult.originalName : '',
        designFileType: designFileResult ? designFileResult.fileType : '',
        designFileSize: designFileResult ? designFileResult.fileSize : 0,
        createdAt
      });

      // Checkout only saves an order. Stock is reserved during job preparation;
      // physical deduction and reporting belong to later phases.
      res.json({ order: serializeOrder(order), guestToken: null });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ error: 'This order ID is already saved. Check My Orders or Track Order before retrying.' });
      const reference = randomBytes(6).toString('hex');
      console.error('Order creation failed:', { reference, customerId: req.user?.id || null, error });
      const unavailable = ['MongoServerSelectionError', 'MongoNetworkError', 'MongooseServerSelectionError'].includes(error.name);
      res.status(unavailable ? 503 : 500).json({
        error: (unavailable ? 'Order storage is unavailable.' : 'The order could not be saved.') +
          ' Check My Orders before retrying. If the issue continues, contact staff with reference ' + reference + '.',
        reference
      });
    }
  });

  app.patch('/api/orders/:orderId/status', requireOrderStaff, orderIdParam, statusUpdate, async (req, res) => {
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

      if (order.jobOrderId) return res.status(409).json({ error: 'This order has reserved materials and a Queueing job. Production changes are not part of Phase 3.' });
      if (order.status === 'Completed' || order.status === 'Cancelled') {
        return res.status(400).json({ error: 'Cannot modify a finalized order.' });
      }

      if (!order.canTransitionTo(status)) {
        return res.status(400).json({ error: `Cannot transition from '${order.status}' to '${status}'.` });
      }

      if (req.body.expectedStatus && req.body.expectedStatus !== order.status) {
        return res.status(409).json({ error: 'This order changed. Refresh and try again.' });
      }
      const updated = await Order.findOneAndUpdate({ orderId, status: order.status, jobOrderId: { $exists: false } },
        { $set: { status, ...(status === 'Completed' ? { completedAt: new Date() } : {}) } },
        { new: true, runValidators: true });
      if (!updated) return res.status(409).json({ error: 'This order changed. Refresh and try again.' });

      const reportDate = getDefaultReportDate();
      await generateDailyReport(reportDate, { regenerate: false }).catch(error => console.error('Report generation failed:', error.message));
      res.json({ order: serializeOrder(updated) });
    } catch (error) {
      console.error('Status update failed:', error);
      res.status(500).json({ error: 'Unable to update status.' });
    }
  });

  app.delete('/api/orders/:orderId', requireAdmin, async (req, res) => {
    try {
      const orderId = safeText(req.params.orderId).toUpperCase();
      const assigned = await Order.exists({ orderId, jobOrderId: { $exists: true } });
      if (assigned) return res.status(409).json({ error: 'Orders with reserved job materials cannot be deleted.' });
      const deleted = await Order.findOneAndDelete({ orderId, jobOrderId: { $exists: false } });
      if (!deleted) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      const reportDate = getDefaultReportDate();
      await generateDailyReport(reportDate, { regenerate: false });
      res.json({ deleted: true });
    } catch (error) {
      console.error('Order delete failed:', error);
      res.status(500).json({ error: 'Unable to delete order.' });
    }
  });
}
