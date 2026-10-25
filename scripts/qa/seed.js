import mongoose from 'mongoose';
import { QA_DATABASE_NAME, validateQaReplicaSetHello } from '../../server/qaMongoGuard.js';

export async function seedQaFixtures(uri, expectedAddress, config) {
  const prior = Object.fromEntries(['BM_QA_MODE', 'MONGODB_URI', 'MONGODB_DB_NAME'].map(key => [key, process.env[key]]));
  process.env.BM_QA_MODE = 'true';
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB_NAME = QA_DATABASE_NAME;
  try {
    const { User, Product, Inventory, Employee, Order, ensureEmployeeIndexes } = await import('../../server/db.js');
    await mongoose.connect(uri, { dbName: QA_DATABASE_NAME, serverSelectionTimeoutMS: 5000 });
    if (mongoose.connection.name !== QA_DATABASE_NAME || `${mongoose.connection.host}:${mongoose.connection.port}` !== expectedAddress) {
      throw new Error('Seed connection failed disposable MongoDB identity checks.');
    }
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    validateQaReplicaSetHello(hello, expectedAddress);
    await ensureEmployeeIndexes();
    const accountSpecs = [
      ['ADMIN', 'QA Admin', 'admin'], ['STAFF_A', 'QA Staff A', 'staff'], ['STAFF_B', 'QA Staff B', 'staff'],
      ['CUSTOMER_A', 'QA Customer A', 'customer'], ['CUSTOMER_B', 'QA Customer B', 'customer']
    ];
    for (const [suffix, name, role] of accountSpecs) {
      const id = config[`BM_QA_${suffix}_USER_ID`];
      const email = config[`BM_QA_${suffix}_EMAIL`].toLowerCase();
      await User.updateOne({ id }, { $set: { id, name, email, role, password: '' } }, { upsert: true, runValidators: true });
      if (role === 'staff') {
        await Employee.updateOne({ supabaseUserId: id }, { $set: {
          name, email, phone: '', position: 'QA Production Staff', employeeRole: 'staff', linkedUserId: id,
          linkedEmail: email, linkedAt: new Date(), linkedBy: config.BM_QA_ADMIN_USER_ID,
          archived: false, active: true, supabaseUserId: id, mustChangePassword: false,
          permissions: ['view_assigned_jobs', 'update_job_progress'], createdBy: config.BM_QA_ADMIN_USER_ID
        } }, { upsert: true, runValidators: true });
      }
    }
    await Product.updateOne({ id: 990001 }, { $setOnInsert: {
      id: 990001, name: 'QA Test T-Shirt', price: 180, description: 'Synthetic QA product',
      category: 'Clothing & Apparel', active: true, trackStock: false, stock: 0,
      specificationType: 'clothing', minQty: 1, unit: 'per piece'
    } }, { upsert: true, runValidators: true });
    await Inventory.updateOne({ material: 'QA Paper 200gsm' }, { $setOnInsert: {
      material: 'QA Paper 200gsm', type: 'Paper', quantity: 100, reservedQuantity: 0,
      unit: 'sheets', minimumStockLevel: 10, costPerUnit: 1, costBasisKnown: true
    } }, { upsert: true, runValidators: true });
    for (const suffix of ['A', 'B']) {
      const customerId = config[`BM_QA_CUSTOMER_${suffix}_USER_ID`];
      const customerEmail = config[`BM_QA_CUSTOMER_${suffix}_EMAIL`].toLowerCase();
      await Order.updateOne({ orderId: `QA-ORDER-${suffix}` }, { $setOnInsert: {
        orderId: `QA-ORDER-${suffix}`, customerId, customerName: `QA Customer ${suffix}`,
        customerEmail, contactNumber: '', address: '', items: [{
          productId: 990001, productName: 'QA Test T-Shirt', quantity: 1, unitPrice: 180, subtotal: 180
        }], totalAmount: 180, paymentMethod: 'GCash', paymentStatus: 'Unpaid', status: 'Pending',
        notes: 'Synthetic QA fixture. No real payment was made.'
      } }, { upsert: true, runValidators: true });
    }
  } finally {
    await mongoose.disconnect().catch(() => {});
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}
