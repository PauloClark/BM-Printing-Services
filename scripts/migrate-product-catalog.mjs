// Idempotent legacy-catalog migration. Dry-run is the default and never writes.
import '../server/loadEnv.js';
import mongoose from 'mongoose';
import { applyCatalogMigration, previewCatalogMigration, proposedCatalogProducts } from '../server/catalogMigration.js';

const apply = process.argv.includes('--apply');
const confirmed = process.argv.includes('--confirm=bm-seven-product-catalog');
if (apply && !confirmed) throw new Error('Apply requires --confirm=bm-seven-product-catalog after explicit owner approval.');

const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bmprinting';
try {
  await mongoose.connect(uri);
  const preview = await previewCatalogMigration();
  const existing = preview.filter(item => item.action === 'skip-existing');
  console.log(JSON.stringify({ mode: apply ? 'apply' : 'dry-run', database: mongoose.connection.name, summary: { proposed: proposedCatalogProducts.length, insert: preview.filter(item => item.action === 'insert').length, existing: existing.length, conflicts: preview.filter(item => item.conflict).length }, records: preview }, null, 2));
  if (apply) {
    const inserted = await applyCatalogMigration(preview);
    console.log(`Applied ${inserted} insert(s); ${existing.length} existing record(s) were not overwritten.`);
  }
} finally {
  await mongoose.disconnect();
}
