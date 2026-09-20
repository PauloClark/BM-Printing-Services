import { Order, Product } from '../db.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { orderCreate, orderIdParam, statusUpdate } from '../middleware/validate.js';
import { safeText, serializeOrder, uploadDesignFile } from '../utils.js';
import { generateDailyReport, getDefaultReportDate } from '../reportService.js';

export default function orderRoutes(app) {
  app.get('/api/orders', async (req, res) => {
    const email = safeText(req.query.email).toLowerCase();
    const userId = safeText(req.query.userId);

    const filter = {};
    if (email) filter.customerEmail = email;
    if (userId) filter.customerId = userId;

    const orders = await Order.find(filter).sort({ createdAt: -1 });
    res.json({ orders: orders.map(serializeOrder) });
  });

  app.get('/api/orders/:orderId', async (req, res) => {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const email = safeText(req.query.email).toLowerCase();
    const order = await Order.findOne({ orderId });

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (email && order.customerEmail.toLowerCase() !== email) {
      return res.status(403).json({ error: 'Order not available with the provided email.' });
    }

    return res.json({ order: serializeOrder(order) });
  });

  app.post('/api/orders', requireAuth, orderCreate, async (req, res) => {
    try {
      const body = req.body || {};
      const customerName = safeText(body.customer || body.name || body.customerName);
      const customerEmail = safeText(body.email || body.customerEmail).toLowerCase();
      const contactNumber = safeText(body.phone || body.contactNumber);
      const address = safeText(body.address);
      const paymentMethod = safeText(body.payment || body.paymentMethod);
      const notes = safeText(body.notes);
      const userId = safeText(body.userId || body.customerId);
      const quantity = Number(body.quantity || 0);
      const productId = Number(body.productId);
      const productName = safeText(body.product || body.productName);
      const total = Number(body.total || 0);
      const designNotes = safeText(body.designNotes);
      const designFileData = body.designFile || null;

      if (!customerName || !customerEmail || !contactNumber || !productName || !paymentMethod || !quantity || !productId) {
        return res.status(400).json({ error: 'Missing required order information.' });
      }

      const orderId = safeText(body.id || body.orderId) || `ORD-${Date.now().toString(36).toUpperCase()}`;
      const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();

      // Handle design file upload
      let designFileResult = null;
      if (designFileData) {
        designFileResult = uploadDesignFile(designFileData);
        if (designFileResult.error) {
          return res.status(400).json({ error: designFileResult.error });
        }
      }

      let stockDeductionResult = { success: true };
      if (productId && quantity > 0) {
        const product = await Product.findOne({ id: productId });
        if (product) {
          const currentStock = product.stock;
          if (currentStock < quantity) {
            stockDeductionResult = { error: 'Insufficient product stock.', available: currentStock };
          } else {
            await Product.updateOne({ id: productId }, { $inc: { stock: -quantity } });
            stockDeductionResult = { success: true, newStock: currentStock - quantity };
          }
        }
      }

      const order = await Order.create({
        orderId,
        customerId: userId || null,
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
        status: safeText(body.status) || 'Pending',
        notes,
        designNotes,
        designFilePath: designFileResult ? designFileResult.filePath : '',
        designFileName: designFileResult ? designFileResult.fileName : '',
        designFileType: designFileResult ? designFileResult.fileType : '',
        designFileSize: designFileResult ? designFileResult.fileSize : 0,
        createdAt
      });

      const reportDate = getDefaultReportDate();
      const reportSummary = await generateDailyReport(reportDate, { regenerate: false });

      res.json({ order: serializeOrder(order), report: reportSummary, stockDeduction: stockDeductionResult });
    } catch (error) {
      console.error('Order creation failed:', error);
      res.status(500).json({ error: 'Unable to create order.', details: error.message });
    }
  });

  app.patch('/api/orders/:orderId/status', requireAdmin, orderIdParam, statusUpdate, async (req, res) => {
    try {
      const orderId = safeText(req.params.orderId).toUpperCase();
      const status = safeText(req.body?.status);
      if (!status) {
        return res.status(400).json({ error: 'Status is required.' });
      }

      const allowedStatuses = ['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Cancelled'];
      if (!allowedStatuses.includes(status)) {
        return res.status(400).json({ error: 'Invalid status value.' });
      }

      const order = await Order.findOne({ orderId });
      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      if (order.status === 'Completed' || order.status === 'Cancelled') {
        return res.status(400).json({ error: 'Cannot modify a finalized order.' });
      }

      if (!order.canTransitionTo(status)) {
        return res.status(400).json({ error: `Cannot transition from '${order.status}' to '${status}'.` });
      }

      order.status = status;
      await order.save();

      const reportDate = getDefaultReportDate();
      await generateDailyReport(reportDate, { regenerate: false });
      res.json({ order: serializeOrder(order) });
    } catch (error) {
      console.error('Status update failed:', error);
      res.status(500).json({ error: 'Unable to update status.' });
    }
  });

  app.delete('/api/orders/:orderId', requireAdmin, async (req, res) => {
    try {
      const orderId = safeText(req.params.orderId).toUpperCase();
      const deleted = await Order.findOneAndDelete({ orderId });
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
