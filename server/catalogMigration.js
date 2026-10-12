import { Product } from './db.js';
import { PRODUCT_CATALOG } from '../shared/productCatalog.js';

const specificationTypes = new Map([[1, 'clothing'], [2, 'clothing'], [3, 'hoodie'], [4, 'schoolId'], [5, 'banner'], [9, 'mug'], [11, 'sticker']]);
export const proposedCatalogProducts = PRODUCT_CATALOG.map(product => ({ ...product, imageFit: product.imageFit || 'contain', popular: Boolean(product.popular), active: true, trackStock: false, stock: 0, lowStockThreshold: 0, specificationType: specificationTypes.get(product.id) || 'general' }));

export async function previewCatalogMigration() {
  const existing = await Product.find({ id: { $in: proposedCatalogProducts.map(product => product.id) } }).lean();
  const byId = new Map(existing.map(product => [product.id, product]));
  return proposedCatalogProducts.map(proposed => {
    const current = byId.get(proposed.id);
    return { action: current ? 'skip-existing' : 'insert', conflict: current ? current.name !== proposed.name || Number(current.price) !== proposed.price : false, proposed, existing: current ? { id: current.id, name: current.name, price: current.price, active: current.active } : null };
  });
}

export async function applyCatalogMigration(preview) {
  const operations = preview.filter(item => item.action === 'insert').map(item => ({ insertOne: { document: item.proposed } }));
  if (operations.length) await Product.bulkWrite(operations, { ordered: false });
  return operations.length;
}
