import { Product } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { productCreate } from '../middleware/validate.js';
import { safeText } from '../utils.js';

export default function productRoutes(app) {
  app.get('/api/products', async (req, res) => {
    const products = await Product.find({ active: true }).sort({ id: 1 });
    res.json({ products: products.map(product => ({
      id: product.id,
      name: product.name,
      price: product.price,
      image: product.image,
      description: product.description,
      minQty: product.minQty,
      category: product.category,
      stock: product.stock,
      lowStockThreshold: product.lowStockThreshold,
      status: product.stock <= 0 ? 'Out of Stock' : product.stock <= product.lowStockThreshold ? 'Low Stock' : 'In Stock'
    })) });
  });

  app.post('/api/products', requireAdmin, productCreate, async (req, res) => {
    try {
      const { name, description, price, category, lowStockThreshold, status, stock, image } = req.body || {};
      if (!name) return res.status(400).json({ error: 'Product name is required.' });

      const maxProduct = await Product.findOne({}).sort({ id: -1 });
      const nextId = (maxProduct?.id || 0) + 1;

      const product = await Product.create({
        id: nextId,
        name,
        price: Number(price || 0),
        description: description || '',
        category: category || 'Printing',
        stock: stock !== undefined ? Number(stock) : 0,
        lowStockThreshold: lowStockThreshold !== undefined ? Number(lowStockThreshold) : 10,
        status: status || 'Active',
        active: true,
        image: image || ''
      });

      res.json({ success: true, product });
    } catch (error) {
      console.error('Product create failed:', error);
      res.status(500).json({ error: 'Unable to create product.' });
    }
  });

  app.patch('/api/products/:id', requireAdmin, async (req, res) => {
    try {
      const productId = safeText(req.params.id);
      const { name, description, price, category, lowStockThreshold, status, stock, image, active } = req.body || {};

      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = price;
      if (category !== undefined) updateData.category = category;
      if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold;
      if (stock !== undefined) updateData.stock = stock;
      if (image !== undefined) updateData.image = image;
      if (active !== undefined) updateData.active = active;

      let product = await Product.findOne({ id: Number(productId) });
      if (product) {
        await Product.updateOne({ id: Number(productId) }, updateData);
        product = await Product.findOne({ id: Number(productId) });
      } else {
        product = await Product.create({
          id: Number(productId),
          name,
          price: Number(price || 0),
          description: description || '',
          category: category || 'Printing',
          stock: stock ? Number(stock) : 0,
          lowStockThreshold: lowStockThreshold ? Number(lowStockThreshold) : 10,
          active: true,
          image: image || ''
        });
      }

      res.json({ success: true, product });
    } catch (error) {
      console.error('Product edit failed:', error);
      res.status(500).json({ error: 'Unable to edit product.' });
    }
  });

  app.delete('/api/products/:id', requireAdmin, async (req, res) => {
    try {
      const productId = safeText(req.params.id);
      const product = await Product.findOne({ id: Number(productId) });
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      await Product.deleteOne({ id: Number(productId) });
      res.json({ success: true, message: 'Product deleted.' });
    } catch (error) {
      console.error('Product delete failed:', error);
      res.status(500).json({ error: 'Unable to delete product.' });
    }
  });

  app.patch('/api/products/:id/stock/increase', requireAdmin, async (req, res) => {
    try {
      const productId = safeText(req.params.id);
      const { amount } = req.body || { amount: 1 };

      const product = await Product.findOne({ id: Number(productId) });
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      const qty = Number(amount);
      if (isNaN(qty) || qty <= 0) {
        return res.status(400).json({ error: 'Amount must be a positive number.' });
      }

      product.stock += qty;
      await product.save();

      res.json({ success: true, product });
    } catch (error) {
      console.error('Stock increase failed:', error);
      res.status(500).json({ error: 'Unable to increase stock.' });
    }
  });

  app.patch('/api/products/:id/stock/decrease', requireAdmin, async (req, res) => {
    try {
      const productId = safeText(req.params.id);

      const product = await Product.findOne({ id: Number(productId) });
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }

      product.stock -= 1;
      if (product.stock < 0) {
        product.stock = 0;
      }
      await product.save();

      res.json({ success: true, product });
    } catch (error) {
      console.error('Stock decrease failed:', error);
      res.status(500).json({ error: 'Unable to decrease stock.' });
    }
  });
}
