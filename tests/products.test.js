import request from 'supertest';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, seedTestProduct, generateAdminToken } from './setup.js';

let app;
let adminToken;
let ProductModel;

beforeAll(async () => {
  await setupTestDB();
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const mongoose = (await import('mongoose')).default;
  const { Product } = await import('../server/db.js');
  ProductModel = Product;
  const { requireAuth, requireAdmin } = await import('../server/middleware/auth.js');

  app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(cors());

  app.get('/api/products', async (req, res) => {
    const products = await Product.find({ active: true }).sort({ id: 1 });
    res.json({ products });
  });

  app.post('/api/products', requireAdmin, async (req, res) => {
    try {
      const { name, description, price, category, lowStockThreshold, status, stock, image } = req.body;
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
      res.status(500).json({ error: 'Unable to create product.' });
    }
  });

  app.patch('/api/products/:id', requireAdmin, async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const updateData = {};
      const { name, description, price, category, lowStockThreshold, status, stock, image, active } = req.body;
      if (name !== undefined) updateData.name = name;
      if (description !== undefined) updateData.description = description;
      if (price !== undefined) updateData.price = price;
      if (category !== undefined) updateData.category = category;
      if (lowStockThreshold !== undefined) updateData.lowStockThreshold = lowStockThreshold;
      if (stock !== undefined) updateData.stock = stock;
      if (image !== undefined) updateData.image = image;
      if (active !== undefined) updateData.active = active;
      if (status !== undefined) updateData.status = status;

      let product = await Product.findOne({ id: productId });
      if (!product) {
        return res.status(404).json({ error: 'Product not found.' });
      }
      await Product.updateOne({ id: productId }, updateData);
      product = await Product.findOne({ id: productId });
      res.json({ success: true, product });
    } catch (error) {
      res.status(500).json({ error: 'Unable to edit product.' });
    }
  });

  app.delete('/api/products/:id', requireAdmin, async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const product = await Product.findOne({ id: productId });
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      await Product.deleteOne({ id: productId });
      res.json({ success: true, message: 'Product deleted.' });
    } catch (error) {
      res.status(500).json({ error: 'Unable to delete product.' });
    }
  });

  app.patch('/api/products/:id/stock/increase', requireAdmin, async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const { amount } = req.body || { amount: 1 };
      const product = await Product.findOne({ id: productId });
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      const qty = Number(amount);
      if (isNaN(qty) || qty <= 0) return res.status(400).json({ error: 'Amount must be positive.' });
      product.stock += qty;
      await product.save();
      res.json({ success: true, product });
    } catch (error) {
      res.status(500).json({ error: 'Unable to increase stock.' });
    }
  });

  app.patch('/api/products/:id/stock/decrease', requireAdmin, async (req, res) => {
    try {
      const productId = Number(req.params.id);
      const product = await Product.findOne({ id: productId });
      if (!product) return res.status(404).json({ error: 'Product not found.' });
      product.stock -= 1;
      if (product.stock < 0) product.stock = 0;
      await product.save();
      res.json({ success: true, product });
    } catch (error) {
      res.status(500).json({ error: 'Unable to decrease stock.' });
    }
  });
});

afterAll(async () => {
  await teardownTestDB();
});

beforeEach(async () => {
  await clearTestDB();
  const admin = await seedTestAdmin();
  adminToken = generateAdminToken(admin);
});

describe('Products', () => {
  describe('GET /api/products', () => {
    it('should return empty list when no products', async () => {
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(200);
      expect(res.body.products).toEqual([]);
    });

    it('should return active products', async () => {
      await seedTestProduct();
      const res = await request(app).get('/api/products');
      expect(res.status).toBe(200);
      expect(res.body.products.length).toBe(1);
      expect(res.body.products[0].name).toBe('Test T-Shirt');
    });
  });

  describe('POST /api/products', () => {
    it('should create product as admin', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'New Product', price: 100, category: 'Test', stock: 50 });
      expect(res.status).toBe(200);
      expect(res.body.product.name).toBe('New Product');
      expect(res.body.product.stock).toBe(50);
    });

    it('should reject creation without admin token', async () => {
      const res = await request(app)
        .post('/api/products')
        .send({ name: 'New Product', price: 100 });
      expect(res.status).toBe(401);
    });

    it('should reject creation without name', async () => {
      const res = await request(app)
        .post('/api/products')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ price: 100 });
      expect(res.status).toBe(400);
    });
  });

  describe('PATCH /api/products/:id', () => {
    it('should update product', async () => {
      const product = await seedTestProduct();
      const res = await request(app)
        .patch(`/api/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Updated Product', price: 200 });
      expect(res.status).toBe(200);
      expect(res.body.product.name).toBe('Updated Product');
      expect(res.body.product.price).toBe(200);
    });
  });

  describe('DELETE /api/products/:id', () => {
    it('should delete product', async () => {
      const product = await seedTestProduct();
      const res = await request(app)
        .delete(`/api/products/${product.id}`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const check = await request(app).get('/api/products');
      expect(check.body.products.length).toBe(0);
    });
  });

  describe('Stock Management', () => {
    it('should increase stock', async () => {
      const product = await seedTestProduct();
      const res = await request(app)
        .patch(`/api/products/${product.id}/stock/increase`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ amount: 50 });
      expect(res.status).toBe(200);
      expect(res.body.product.stock).toBe(150);
    });

    it('should decrease stock', async () => {
      const product = await seedTestProduct();
      const res = await request(app)
        .patch(`/api/products/${product.id}/stock/decrease`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.product.stock).toBe(99);
    });

    it('should not allow stock below zero', async () => {
      const product = await seedTestProduct();
      await ProductModel.updateOne({ id: product.id }, { stock: 0 });
      const res = await request(app)
        .patch(`/api/products/${product.id}/stock/decrease`)
        .set('Authorization', `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.product.stock).toBe(0);
    });
  });
});
