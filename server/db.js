import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bm.com';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const userSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true },
    phone: { type: String, default: '' },
    password: { type: String, default: '' },
    role: { type: String, enum: ['customer', 'admin', 'manager', 'cashier', 'production'], default: 'customer' },
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
    active: { type: Boolean, default: true },
    stock: { type: Number, default: 0 },
    lowStockThreshold: { type: Number, default: 10 }
  },
  { timestamps: true }
);

const inventorySchema = new mongoose.Schema(
  {
    material: { type: String, required: true },
    type: { type: String, enum: ['Paper', 'Ink', 'Tarpaulin', 'Vinyl', 'T-shirts', 'Sticker material', 'Card stock', 'Packaging', 'Other'], required: true },
    quantity: { type: Number, default: 0, min: 0 },
    minimumStockLevel: { type: Number, default: 10 },
    costPerUnit: { type: Number, default: 0 },
    supplier: { type: String, default: '' },
    lastRestocked: { type: Date, default: null },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

const productionSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    status: { type: String, enum: ['Pending', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Delayed', 'Cancelled'], default: 'Pending' },
    assignedEmployee: { type: String, default: '' },
    priority: { type: String, default: 'normal' },
    startTime: { type: Date, default: null },
    estimatedCompletion: { type: Date, default: null },
    actualCompletion: { type: Date, default: null },
    productionNotes: { type: String, default: '' },
    qualityCheckStatus: { type: String, enum: ['Pending', 'Pass', 'Fail'], default: 'Pending' },
    delayReason: { type: String, default: '' },
    productionHistory: [
      {
        status: { type: String, required: true },
        timestamp: { type: Date, default: Date.now },
        notes: { type: String, default: '' }
      }
    ]
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
    status: { type: String, enum: ['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Cancelled'], default: 'Pending' },
    notes: { type: String, default: '' },
    designNotes: { type: String, default: '' },
    designFilePath: { type: String, default: '' },
    designFileName: { type: String, default: '' },
    designFileType: { type: String, default: '' },
    designFileSize: { type: Number, default: 0 },
    createdAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

const orderFileSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    filename: { type: String, required: true },
    originalName: { type: String, required: true },
    fileType: { type: String, required: true },
    fileSize: { type: Number, default: 0 },
    storagePath: { type: String, required: true },
    approved: { type: Boolean, default: false },
    approvalNotes: { type: String, default: '' },
    productionReady: { type: Boolean, default: false },
    uploadedAt: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

const auditLogSchema = new mongoose.Schema(
  {
    userId: { type: String, default: '' },
    userName: { type: String, default: '' },
    role: { type: String, default: '' },
    action: { type: String, required: true },
    module: { type: String, default: '' },
    resourceType: { type: String, default: '' },
    resourceId: { type: String, default: '' },
    previousValue: { type: mongoose.Schema.Types.Mixed, default: null },
    newValue: { type: mongoose.Schema.Types.Mixed, default: null },
    result: { type: String, default: 'Success' },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    timestamp: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

orderSchema.methods.serialize = function() {
  const firstItem = this.items?.[0] || {};
  return {
    id: this.orderId,
    orderId: this.orderId,
    customer: this.customerName,
    email: this.customerEmail,
    phone: this.contactNumber,
    address: this.address,
    product: firstItem.productName || '',
    productId: firstItem.productId || null,
    quantity: firstItem.quantity || 0,
    specs: this.notes || '',
    design: this.designNotes || '',
    payment: this.paymentMethod,
    total: this.totalAmount,
    status: this.status,
    date: this.createdAt ? this.createdAt.toISOString().split('T')[0] : '',
    notes: this.notes,
    userId: this.customerId,
    createdAt: this.createdAt,
    items: this.items || [],
    designFilePath: this.designFilePath,
    designFileName: this.designFileName,
    designFileType: this.designFileType,
    designFileSize: this.designFileSize
  };
};

orderSchema.methods.getStatusColor = function() {
  const colors = {
    Pending: '#6c757d',
    Quoted: '#28a745',
    Confirmed: '#17a2b8',
    'Payment Pending': '#ffc107',
    Paid: '#28a745',
    Queued: '#6c757d',
    'In Production': '#fd7e14',
    'Quality Check': '#6f42c1',
    Ready: '#198754',
    Completed: '#28a745',
    Cancelled: '#dc3545'
  };
  return colors[this.status] || '#6c757d';
};

orderSchema.methods.canTransitionTo = function(newStatus) {
  const transitions = {
    Pending: ['Quoted', 'Cancelled'],
    Quoted: ['Confirmed', 'Cancelled'],
    Confirmed: ['Payment Pending', 'Cancelled'],
    'Payment Pending': ['Paid', 'Cancelled'],
    Paid: ['Queued', 'Cancelled'],
    Queued: ['In Production', 'Cancelled'],
    'In Production': ['Quality Check', 'Cancelled'],
    'Quality Check': ['Ready', 'Cancelled'],
    Ready: ['Completed', 'Cancelled'],
    Completed: [],
    Cancelled: []
  };
  return transitions[this.status]?.includes(newStatus) || false;
};

userSchema.statics.findByCredentials = async function(email, password) {
  const user = await this.findOne({ email: email.toLowerCase() });
  if (!user) {
    throw new Error('Invalid login credentials');
  }
  if (!user.password || (!user.password.startsWith('$2b$') && !user.password.startsWith('$2a$'))) {
    throw new Error('Account needs password reset. Please contact admin.');
  }
  const bcrypt = (await import('bcryptjs')).default;
  const match = await bcrypt.compare(password, user.password);
  if (!match) {
    throw new Error('Invalid login credentials');
  }
  return user;
};

productSchema.statics.findActive = function() {
  return this.find({ active: true });
};

orderSchema.statics.findByCustomer = function(customerId) {
  return this.find({ customerId });
};

orderSchema.statics.findByStatus = function(status) {
  return this.find({ status });
};

orderSchema.virtual('formattedTotal').get(function() {
  return `₱${this.totalAmount.toLocaleString()}`;
});

orderSchema.virtual('displayStatus').get(function() {
  return this.status;
});

const User = mongoose.model('User', userSchema);
const Product = mongoose.model('Product', productSchema);
const Inventory = mongoose.model('Inventory', inventorySchema);
const Production = mongoose.model('Production', productionSchema);
const Order = mongoose.model('Order', orderSchema);
const OrderFile = mongoose.model('OrderFile', orderFileSchema);
const AuditLog = mongoose.model('AuditLog', auditLogSchema);

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bmprinting';

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB:', uri);
    return;
  } catch (error) {
    console.warn('Local MongoDB not available, falling back to in-memory MongoDB:', error.message);
  }

  const memoryServer = await MongoMemoryServer.create();
  const memoryUri = memoryServer.getUri();
  await mongoose.connect(memoryUri);
  console.log('Connected to in-memory MongoDB:', memoryUri);
}

export async function seedCatalogAndAdmin() {
  try {
    const existingAdmin = await User.findOne({ email: DEFAULT_ADMIN_EMAIL });
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
      await User.create({
        id: 'admin-001',
        name: 'BM Admin',
        email: DEFAULT_ADMIN_EMAIL,
        phone: '',
        password: hashedPassword,
        role: 'admin'
      });
      console.log('Default admin account created.');
    }
  } catch (error) {
    console.error('Failed to seed admin account:', error.message);
  }
}

export { User, Product, Order, Inventory, Production, OrderFile, AuditLog, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD };