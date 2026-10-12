import { Product } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { productCreate } from '../middleware/validate.js';
import { safeText } from '../utils.js';
import { logMongoOperationFailure } from '../mongoDiagnostics.js';

const TEXT_FIELDS = ['name', 'description', 'category', 'image', 'unit', 'imageFit', 'specificationType'];
const NUMBER_FIELDS = ['price', 'minQty', 'stock', 'lowStockThreshold'];
const BOOLEAN_FIELDS = ['active', 'popular', 'trackStock'];

const serializeProduct = product => {
  const row = product.toObject ? product.toObject() : product;
  return {
    id: row.id, name: row.name, description: row.description || '', category: row.category || 'Printing',
    price: Number(row.price), minQty: Number(row.minQty || 1), unit: row.unit || 'per piece', image: row.image || '',
    imageFit: row.imageFit || 'contain', popular: Boolean(row.popular), active: Boolean(row.active),
    trackStock: Boolean(row.trackStock), specificationType: row.specificationType || 'general',
    stock: Number(row.stock || 0), lowStockThreshold: Number(row.lowStockThreshold || 0),
    status: row.active ? 'Active' : 'Inactive'
  };
};

const productUpdate = body => {
  const update = {};
  for (const field of TEXT_FIELDS) if (body[field] !== undefined) update[field] = safeText(body[field]);
  for (const field of NUMBER_FIELDS) if (body[field] !== undefined) update[field] = Number(body[field]);
  for (const field of BOOLEAN_FIELDS) if (body[field] !== undefined) update[field] = Boolean(body[field]);
  return update;
};

const validUpdate = update => Number.isInteger(update.price ?? 1) && (update.price ?? 1) >= 1 &&
  Number.isInteger(update.minQty ?? 1) && (update.minQty ?? 1) >= 1 &&
  Number.isInteger(update.stock ?? 0) && (update.stock ?? 0) >= 0 &&
  Number.isInteger(update.lowStockThreshold ?? 0) && (update.lowStockThreshold ?? 0) >= 0;

export default function productRoutes(app) {
  app.get('/api/products', async (_req, res) => {
    try {
      const [products, catalogCount] = await Promise.all([
        Product.find({ active: true }).sort({ id: 1 }).lean(), Product.countDocuments({})
      ]);
      res.set('Cache-Control', 'no-store');
      res.json({ products: products.map(serializeProduct), catalogConfigured: catalogCount > 0 });
    } catch (error) {
      logMongoOperationFailure('products.list-public', error);
      res.status(503).json({ error: 'Unable to load products.' });
    }
  });

  app.get('/api/admin/products', requireAdmin, async (_req, res) => {
    try {
      const products = await Product.find({}).sort({ id: 1 }).lean();
      res.set('Cache-Control', 'no-store');
      res.json({ products: products.map(serializeProduct), catalogConfigured: products.length > 0 });
    } catch (error) {
      logMongoOperationFailure('products.list-admin', error);
      res.status(503).json({ error: 'Unable to load product management.' });
    }
  });

  app.post('/api/products', requireAdmin, productCreate, async (req, res) => {
    try {
      const update = productUpdate(req.body || {});
      if (!update.name) return res.status(400).json({ error: 'Product name is required.' });
      if (!validUpdate(update)) return res.status(400).json({ error: 'Product price must be a positive whole PHP amount and quantities must be whole numbers.' });
      const maxProduct = await Product.findOne({}).sort({ id: -1 }).select('id').lean();
      const product = await Product.create({ id: (maxProduct?.id || 0) + 1, ...update, active: update.active ?? true });
      res.status(201).json({ success: true, product: serializeProduct(product) });
    } catch (error) {
      if (error?.code === 11000) return res.status(409).json({ error: 'A product with this identifier already exists.' });
      res.status(500).json({ error: 'Unable to create product.' });
    }
  });

  app.patch('/api/products/:id', requireAdmin, async (req, res) => {
    try {
      const id = Number(safeText(req.params.id));
      if (!Number.isInteger(id)) return res.status(400).json({ error: 'Invalid product ID.' });
      const update = productUpdate(req.body || {});
      if (!validUpdate(update)) return res.status(400).json({ error: 'Product price must be a positive whole PHP amount and quantities must be whole numbers.' });
      const product = await Product.findOneAndUpdate({ id }, { $set: update }, { new: true, runValidators: true });
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      res.json({ success: true, product: serializeProduct(product) });
    } catch { res.status(500).json({ error: 'Unable to edit product.' }); }
  });

  app.patch('/api/products/:id/stock/:direction', requireAdmin, async (req, res) => {
    try {
      const product = await Product.findOne({ id: Number(req.params.id) });
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      if (!product.trackStock) return res.status(409).json({ error: 'Stock tracking is disabled for this service.' });
      const amount = req.params.direction === 'decrease' ? -1 : Number(req.body?.amount || 1);
      if (!Number.isFinite(amount) || amount === 0 || !['increase', 'decrease'].includes(req.params.direction)) return res.status(400).json({ error: 'Invalid stock adjustment.' });
      product.stock = Math.max(0, product.stock + amount);
      await product.save();
      res.json({ success: true, product: serializeProduct(product) });
    } catch { res.status(500).json({ error: 'Unable to adjust stock.' }); }
  });
}
