import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { connectMongo, seedCatalogAndAdmin, User, Product, Order } from './server/db.js';
import { generateDailyReport, getDefaultReportDate, getReportSummary, readReportFile, formatCurrency } from './server/reportService.js';

dotenv.config();

const app = express();
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

app.use(express.json({ limit: '256kb' }));
app.use(cors({ origin: FRONTEND_ORIGINS, credentials: true }));

function safeText(value) {
  return typeof value === 'string' ? value : '';
}

function serializeOrder(order) {
  const firstItem = order.items?.[0] || {};
  return {
    id: order.orderId,
    orderId: order.orderId,
    customer: order.customerName,
    email: order.customerEmail,
    phone: order.contactNumber,
    address: order.address,
    product: firstItem.productName || '',
    productId: firstItem.productId || null,
    quantity: firstItem.quantity || 0,
    specs: order.notes || '',
    design: '',
    payment: order.paymentMethod,
    total: order.totalAmount,
    status: order.status,
    date: order.createdAt ? new Date(order.createdAt).toISOString().split('T')[0] : '',
    notes: order.notes,
    userId: order.customerId,
    createdAt: order.createdAt,
    items: order.items || []
  };
}

function requireAdmin(req, res, next) {
  const role = req.get('x-user-role') || req.get('x-admin-role') || req.body?.userRole;
  if (role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

app.get('/api/health', async (req, res) => {
  res.json({ status: 'ok', db: 'connected' });
});

app.get('/api/products', async (req, res) => {
  const products = await Product.find({ active: true }).sort({ id: 1 });
  res.json({ products: products.map(product => ({
    id: product.id,
    name: product.name,
    price: product.price,
    image: product.image,
    description: product.description,
    minQty: product.minQty,
    category: product.category
  })) });
});

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

app.post('/api/orders', async (req, res) => {
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

    if (!customerName || !customerEmail || !contactNumber || !productName || !paymentMethod || !quantity || !productId) {
      return res.status(400).json({ error: 'Missing required order information.' });
    }

    const orderId = safeText(body.id || body.orderId) || `ORD-${Date.now().toString(36).toUpperCase()}`;
    const createdAt = body.createdAt ? new Date(body.createdAt) : new Date();

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
      createdAt
    });

    const reportDate = getDefaultReportDate();
    const reportSummary = await generateDailyReport(reportDate, { regenerate: false });

    res.json({ order: serializeOrder(order), report: reportSummary });
  } catch (error) {
    console.error('Order creation failed:', error);
    res.status(500).json({ error: 'Unable to create order.', details: error.message });
  }
});

app.patch('/api/orders/:orderId/status', requireAdmin, async (req, res) => {
  try {
    const orderId = safeText(req.params.orderId).toUpperCase();
    const status = safeText(req.body?.status);
    if (!status) {
      return res.status(400).json({ error: 'Status is required.' });
    }

    const order = await Order.findOneAndUpdate({ orderId }, { status }, { new: true });
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

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

app.post('/api/auth/register', async (req, res) => {
  try {
    const body = req.body || {};
    const email = safeText(body.email).toLowerCase();
    const password = safeText(body.password);
    const name = safeText(body.name);
    const phone = safeText(body.phone);

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Name, email, and password are required.' });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ error: 'Email already registered.' });
    }

    const user = await User.create({
      id: `user-${Date.now()}`,
      name,
      email,
      phone,
      password,
      role: 'customer'
    });

    res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (error) {
    console.error('Register failed:', error);
    res.status(500).json({ error: 'Unable to register user.' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  try {
    const body = req.body || {};
    const email = safeText(body.email).toLowerCase();
    const password = safeText(body.password);

    if (email === 'admin@bm.com' && password === 'admin123') {
      return res.json({ user: { id: 'admin', name: 'BM Admin', email, role: 'admin' } });
    }

    const user = await User.findOne({ email, password });
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    res.json({ user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role } });
  } catch (error) {
    console.error('Login failed:', error);
    res.status(500).json({ error: 'Unable to log in.' });
  }
});

app.get('/api/admin/orders', requireAdmin, async (req, res) => {
  const orders = await Order.find({}).sort({ createdAt: -1 });
  res.json({ orders: orders.map(serializeOrder) });
});

app.get('/api/admin/reports/orders', requireAdmin, async (req, res) => {
  const date = safeText(req.query.date) || getDefaultReportDate();
  const summary = await getReportSummary(date);
  res.json(summary);
});

app.post('/api/admin/reports/orders/:date/regenerate', requireAdmin, async (req, res) => {
  const date = safeText(req.params.date);
  try {
    const result = await generateDailyReport(date, { regenerate: true });
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get('/api/admin/reports/orders/:date/download', requireAdmin, async (req, res) => {
  const date = safeText(req.params.date);
  try {
    const file = await readReportFile(date);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${date}.xlsx"`);
    res.send(file.data);
  } catch (error) {
    res.status(404).json({ error: 'Report not found.' });
  }
});

app.get('/api/admin/reports/orders/:date/summary', requireAdmin, async (req, res) => {
  const date = safeText(req.params.date);
  const summary = await getReportSummary(date);
  res.json(summary);
});

app.get('/api/admin/reports/currency', requireAdmin, async (req, res) => {
  const amount = Number(req.query.amount || 0);
  res.json({ formatted: formatCurrency(amount) });
});

async function startServer() {
  try {
    await connectMongo();
    await seedCatalogAndAdmin();
    app.listen(process.env.PORT || 4000, () => {
      console.log(`BM Printing Services backend running on port ${process.env.PORT || 4000}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
