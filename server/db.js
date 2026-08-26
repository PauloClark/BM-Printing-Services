import mongoose from 'mongoose';
import { PRODUCTS } from '../src/constants/products.js';

const DEFAULT_ADMIN_EMAIL = 'admin@bm.com';
const DEFAULT_ADMIN_PASSWORD = 'admin123';

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, default: '' },
    password: { type: String, default: '' },
    role: { type: String, enum: ['customer', 'admin'], default: 'customer' },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const productSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    image: { type: String, default: '' },
    description: { type: String, default: '' },
    minQty: { type: Number, default: 1 },
    category: { type: String, default: 'Printing' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

const orderItemSchema = new mongoose.Schema(
  {
    productId: { type: Number, required: true },
    productName: { type: String, required: true },
    quantity: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    subtotal: { type: Number, required: true }
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    customerId: { type: String, default: null },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true, lowercase: true },
    contactNumber: { type: String, default: '' },
    address: { type: String, default: '' },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    paymentMethod: { type: String, default: '' },
    status: { type: String, default: 'Pending' },
    notes: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

export const User = mongoose.model('User', userSchema);
export const Product = mongoose.model('Product', productSchema);
export const Order = mongoose.model('Order', orderSchema);

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bmprinting';
  await mongoose.connect(uri);
  console.log('Connected to MongoDB.');
}

export async function seedCatalogAndAdmin() {
  for (const product of PRODUCTS) {
    await Product.updateOne(
      { id: product.id },
      {
        $set: {
          name: product.name,
          price: product.price,
          image: product.image || '',
          description: product.description || '',
          minQty: product.minQty || 1,
          category: product.category || 'Printing',
          active: true
        }
      },
      { upsert: true }
    );
  }

  const existingAdmin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });
  if (!existingAdmin) {
    await User.create({
      id: 'admin',
      name: 'BM Admin',
      email: DEFAULT_ADMIN_EMAIL,
      phone: '09170000000',
      password: DEFAULT_ADMIN_PASSWORD,
      role: 'admin'
    });
  }
}
