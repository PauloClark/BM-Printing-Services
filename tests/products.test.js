import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, generateAdminToken, seedTestCustomer, generateCustomerToken } from './setup.js';
import { Product } from '../server/db.js';
import productRoutes from '../server/routes/products.js';
import { previewCatalogMigration } from '../server/catalogMigration.js';

jest.mock('../server/utils.js', () => ({ safeText: value => typeof value === 'string' ? value : '' }));

let app, adminToken;
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const baseProduct = { id: 1, name: 'Custom T-Shirt Printing', description: 'Printed shirt', category: 'Clothing & Apparel', price: 400, minQty: 1, unit: 'per piece', image: 'image/tshirt.png', active: true, trackStock: false, specificationType: 'clothing' };

beforeAll(async () => {
  await setupTestDB();
  app = express(); app.use(express.json({ limit: '50mb' })); productRoutes(app);
});
afterAll(teardownTestDB);
beforeEach(async () => { await clearTestDB(); adminToken = generateAdminToken(await seedTestAdmin()); });

describe('authoritative product management', () => {
  it('marks an empty collection as unconfigured for explicit legacy bootstrap', async () => {
    const response = await request(app).get('/api/products').expect(200);
    expect(response.body).toMatchObject({ products: [], catalogConfigured: false });
  });

  it('returns active products publicly and all products to Admin', async () => {
    await Product.create([baseProduct, { ...baseProduct, id: 2, name: 'Inactive', active: false }]);
    const publicList = await request(app).get('/api/products').expect(200);
    expect(publicList.body.catalogConfigured).toBe(true);
    expect(publicList.body.products.map(item => item.id)).toEqual([1]);
    const adminList = await request(app).get('/api/admin/products').set(auth()).expect(200);
    expect(adminList.body.products).toHaveLength(2);
  });

  it('restores configured specification types for legacy products saved as general', async () => {
    await Product.create([
      { ...baseProduct, id: 1, specificationType: 'general' },
      { ...baseProduct, id: 2, specificationType: 'general' },
      { ...baseProduct, id: 3, specificationType: 'general' },
      { ...baseProduct, id: 4, specificationType: 'general' },
      { ...baseProduct, id: 5, specificationType: 'general' },
      { ...baseProduct, id: 9, specificationType: 'general' },
      { ...baseProduct, id: 11, specificationType: 'general' }
    ]);
    const response = await request(app).get('/api/products').expect(200);
    expect(response.body.products.map(product => [product.id, product.specificationType])).toEqual([
      [1, 'clothing'], [2, 'clothing'], [3, 'hoodie'], [4, 'schoolId'],
      [5, 'banner'], [9, 'mug'], [11, 'sticker']
    ]);
  });

  it('persists a whole-peso price, options, image and availability edits', async () => {
    await Product.create(baseProduct);
    await request(app).patch('/api/products/1').set(auth()).send({ price: 500, minQty: 3, unit: 'per order', image: 'image/new.png', specificationType: 'general', active: false }).expect(200);
    const saved = await Product.findOne({ id: 1 }).lean();
    expect(saved).toMatchObject({ price: 500, minQty: 3, unit: 'per order', image: 'image/new.png', specificationType: 'general', active: false });
    expect((await request(app).get('/api/products')).body.products).toEqual([]);
  });

  it.each([400, 500, 150])('accepts the whole-peso price %s', async price => {
    await Product.create(baseProduct);
    await request(app).patch('/api/products/1').set(auth()).send({ price }).expect(200);
    expect((await Product.findOne({ id: 1 }).lean()).price).toBe(price);
  });

  it.each([0, -1, 499.01, 'not-a-price'])('rejects the invalid price %s', async price => {
    await Product.create(baseProduct);
    await request(app).patch('/api/products/1').set(auth()).send({ price }).expect(400);
    expect((await Product.findOne({ id: 1 }).lean()).price).toBe(400);
  });

  it('rejects unknown edits instead of creating an accidental product', async () => {
    await request(app).patch('/api/products/99').set(auth()).send({ price: 100 }).expect(404);
    expect(await Product.countDocuments()).toBe(0);
  });

  it('adds a made-to-order product without forcing stock tracking', async () => {
    const response = await request(app).post('/api/products').set(auth()).send({ name: 'New Service', description: 'Custom work', category: 'Printing', price: 100, minQty: 1, unit: 'per piece', trackStock: false }).expect(201);
    expect(response.body.product).toMatchObject({ id: 1, trackStock: false, active: true });
  });

  it('only permits stock adjustment for products configured to track stock', async () => {
    await Product.create(baseProduct);
    await request(app).patch('/api/products/1/stock/increase').set(auth()).send({ amount: 2 }).expect(409);
    await Product.updateOne({ id: 1 }, { trackStock: true, stock: 2 });
    const response = await request(app).patch('/api/products/1/stock/increase').set(auth()).send({ amount: 2 }).expect(200);
    expect(response.body.product.stock).toBe(4);
  });

  it.each([[0, 'out-of-stock'], [3, 'low-stock'], [20, 'low-stock']])('honors the configured low-stock threshold for stock %i', async (stock, availability) => {
    await Product.create({ ...baseProduct, trackStock: true, stock, lowStockThreshold: 99 });
    const response = await request(app).get('/api/products').expect(200);
    expect(response.body.products[0]).toMatchObject({ stock, lowStockThreshold: 99, availability });
  });

  it('persists stock edits across fresh admin and customer reads, including replenishment', async () => {
    await Product.create(baseProduct);
    for (const [stock, availability] of [[0, 'out-of-stock'], [3, 'low-stock'], [20, 'in-stock']]) {
      await request(app).patch('/api/products/1').set(auth()).send({ trackStock: true, stock }).expect(200);
      expect((await Product.findOne({ id: 1 }).lean()).stock).toBe(stock);
      for (const url of ['/api/products', '/api/admin/products']) {
        const result = await request(app).get(url).set(auth()).expect(200);
        expect(result.body.products[0]).toMatchObject({ stock, availability, price: baseProduct.price, image: baseProduct.image });
      }
    }
    await request(app).patch('/api/products/1').set(auth()).send({ trackStock: false }).expect(200);
    expect((await request(app).get('/api/products')).body.products[0].availability).toBe('made-to-order');
  });

  it('rejects unauthorized stock edits and invalid quantities', async () => {
    await Product.create({ ...baseProduct, trackStock: true, stock: 3 });
    const customer = generateCustomerToken(await seedTestCustomer());
    for (const url of ['/api/products/1', '/api/products/1/stock/increase']) {
      await request(app).patch(url).send({ stock: 20 }).expect(401);
      await request(app).patch(url).set('Authorization', 'Bearer ' + customer).send({ stock: 20 }).expect(403);
    }
    for (const stock of [-1, 1.5, 'invalid']) {
      await request(app).patch('/api/products/1').set(auth()).send({ stock }).expect(400);
    }
    for (const amount of [-1, 0, 1.5]) {
      await request(app).patch('/api/products/1/stock/increase').set(auth()).send({ amount }).expect(400);
    }
    await request(app).patch('/api/products/1/stock/decrease').set(auth()).send({ amount: 4 }).expect(409);
    const results = await Promise.all(Array.from({ length: 5 }, () => request(app).patch('/api/products/1/stock/increase').set(auth()).send({ amount: 1 })));
    expect(results.every(result => result.status === 200)).toBe(true);
    expect((await Product.findOne({ id: 1 }).lean()).stock).toBe(8);
  });

  it('prevents duplicate migration records and flags conflicting existing values', async () => {
    await Product.create({ ...baseProduct, name: 'Existing Custom Shirt', price: 999 });
    const preview = await previewCatalogMigration();
    expect(preview).toHaveLength(7);
    expect(preview.find(item => item.proposed.id === 1)).toMatchObject({ action: 'skip-existing', conflict: true });
    expect(preview.filter(item => item.action === 'insert')).toHaveLength(6);
  });
});
