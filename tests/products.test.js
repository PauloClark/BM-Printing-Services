import request from 'supertest';
import express from 'express';
import { setupTestDB, teardownTestDB, clearTestDB, seedTestAdmin, generateAdminToken } from './setup.js';
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

  it('prevents duplicate migration records and flags conflicting existing values', async () => {
    await Product.create({ ...baseProduct, name: 'Existing Custom Shirt', price: 999 });
    const preview = await previewCatalogMigration();
    expect(preview).toHaveLength(7);
    expect(preview.find(item => item.proposed.id === 1)).toMatchObject({ action: 'skip-existing', conflict: true });
    expect(preview.filter(item => item.action === 'insert')).toHaveLength(6);
  });
});
