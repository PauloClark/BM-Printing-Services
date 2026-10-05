import { canTransitionOrder } from '../shared/orderWorkflow.js';
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
    address: { type: String, default: '' },
    password: { type: String, default: '' },
    role: { type: String, enum: ['customer', 'admin', 'staff', 'manager', 'cashier', 'production'], default: 'customer' },
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
    reservedQuantity: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: 'pcs' },
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
    phase3: { type: Boolean },
    jobOrderId: { type: String },
    assignedEmployeeName: { type: String },
    dateAssigned: { type: Date },
    assignedBy: { type: String },
    productionStartedAt: { type: Date, default: null },
    productionStartedBy: { type: String, default: '' },
    productionCompletedAt: { type: Date, default: null },
    productionCompletedBy: { type: String, default: '' },
    readyForPickupAt: { type: Date, default: null },
    readyForPickupBy: { type: String, default: '' },
    reservedMaterials: [{
      inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
      material: { type: String, required: true },
      unit: { type: String, required: true },
      quantity: { type: Number, required: true, min: 0.001 },
      reservationStatus: { type: String, enum: ['reserved', 'consumed', 'released'], default: 'reserved' }
    }],
    orderId: { type: String, required: true },
    status: { type: String, enum: ['Queueing', 'In Progress', 'Ready for Pickup', 'Pending', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Delayed', 'Cancelled'], default: 'Pending' },
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
        notes: { type: String, default: '' },
        performedBy: { type: String, default: '' },
        performedByName: { type: String, default: '' }
      }
    ]
  },
  { timestamps: true }
);

// Existing production rows are preserved; uniqueness applies only to new job orders.
productionSchema.index({ jobOrderId: 1 }, { unique: true, partialFilterExpression: { phase3: true } });
productionSchema.index({ orderId: 1 }, { unique: true, partialFilterExpression: { phase3: true } });

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

const paymentSubmissionSchema = new mongoose.Schema({
  customerId: { type: String, required: true },
  paymentMethod: { type: String, enum: ['GCash', 'Maya', 'BPI', 'GoTyme'], required: true },
  amount: { type: Number, required: true, min: 0.01 },
  referenceNumber: { type: String, required: true, trim: true, maxlength: 100 },
  receiptFileName: { type: String, required: true },
  receiptFilePath: { type: String, required: true },
  receiptOriginalName: { type: String, required: true },
  receiptFileType: { type: String, required: true },
  receiptFileSize: { type: Number, default: 0 },
  status: { type: String, enum: ['For Verification', 'Verified', 'Rejected'], required: true },
  submittedAt: { type: Date, default: Date.now },
  verifiedAt: { type: Date, default: null },
  verifiedBy: { type: String, default: '' },
  rejectedAt: { type: Date, default: null },
  rejectedBy: { type: String, default: '' },
  rejectionReason: { type: String, default: '', maxlength: 500 }
});

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    customerId: { type: String, default: null },
    guestTokenHash: { type: String, select: false },
    jobOrderId: { type: String },
    specs: { type: String, default: '' },
    customerName: { type: String, required: true },
    customerEmail: { type: String, required: true, lowercase: true },
    contactNumber: { type: String, default: '' },
    address: { type: String, default: '' },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    paymentMethod: { type: String, default: '' },
    paymentStatus: { type: String, enum: ['Unpaid', 'For Verification', 'Verified', 'Rejected'], default: 'Unpaid' },
    paymentRejectionReason: { type: String, default: '' },
    paymentSubmissions: { type: [paymentSubmissionSchema], default: [] },
    status: { type: String, enum: ['Pending', 'Quoted', 'Confirmed', 'Payment Pending', 'Paid', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Processing', 'Ready for Pickup', 'Picked Up', 'Completed', 'Cancelled'], default: 'Pending' },
    notes: { type: String, default: '' },
    designNotes: { type: String, default: '' },
    designFilePath: { type: String, default: '' },
    designFileName: { type: String, default: '' },
    designOriginalName: { type: String, default: '' },
    designFileOriginalName: { type: String, default: '' },
    designFileType: { type: String, default: '' },
    designFileSize: { type: Number, default: 0 },
    pickedUpAt: { type: Date, default: null },
    releasedBy: { type: String, default: '' },
    releasedByName: { type: String, default: '' },
    receivedByName: { type: String, default: null },
    archived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date, default: null },
    archivedBy: { type: String, default: '' },
    archivedByName: { type: String, default: '' },
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

const contactMessageSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    // Verified authenticated identity. Null for guests. Never taken from the browser.
    userId: { type: String, default: null },
    senderName: { type: String, required: true },
    senderEmail: { type: String, required: true, lowercase: true },
    subject: { type: String, required: true },
    // Stored and rendered as plain text only.
    message: { type: String, required: true },
    senderType: { type: String, enum: ['guest', 'customer'], default: 'guest' },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
    readAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ status: 1, createdAt: -1 });
contactMessageSchema.index({ userId: 1 });

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

const stockMovementSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true },
    jobOrderId: { type: String, required: true },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    material: { type: String, required: true },
    materialType: { type: String, default: '' },
    unit: { type: String, default: 'pcs' },
    quantity: { type: Number, required: true, min: 0.001 },
    movementType: { type: String, enum: ['IN', 'OUT'], required: true },
    reason: { type: String, enum: ['RESTOCK', 'ORDER_PICKUP', 'ADJUSTMENT', 'OTHER'], required: true },
    performedBy: { type: String, required: true },
    performedByName: { type: String, default: '' },
    receivedByName: { type: String, default: null },
    notes: { type: String, default: '' }
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
    specs: this.specs || this.designNotes || this.notes || '',
    design: this.designNotes || '',
    payment: this.paymentMethod,
    paymentStatus: this.paymentStatus || 'Unpaid',
    paymentRejectionReason: this.paymentRejectionReason || '',
    latestPayment: this.paymentSubmissions?.length ? (() => {
      const payment = this.paymentSubmissions[this.paymentSubmissions.length - 1];
      return {
        id: String(payment._id),
        paymentMethod: payment.paymentMethod,
        amount: payment.amount,
        referenceNumber: payment.referenceNumber,
        status: payment.status,
        submittedAt: payment.submittedAt,
        verifiedAt: payment.verifiedAt,
        rejectionReason: payment.rejectionReason,
        receiptOriginalName: payment.receiptOriginalName
      };
    })() : null,
    total: this.totalAmount,
    status: this.status,
    date: this.createdAt ? this.createdAt.toISOString().split('T')[0] : '',
    notes: this.notes,
    userId: this.customerId,
    createdAt: this.createdAt,
    items: this.items || [],
    designFilePath: this.designFilePath,
    designOriginalName: this.designOriginalName,
    designFileName: this.designFileName,
    designFileOriginalName: this.designFileOriginalName,
    designFileType: this.designFileType,
    designFileSize: this.designFileSize,
    pickedUpAt: this.pickedUpAt || null,
    releasedBy: this.releasedBy || '',
    releasedByName: this.releasedByName || '',
    receivedByName: this.receivedByName || null,
    archived: this.archived || false,
    archivedAt: this.archivedAt || null,
    archivedBy: this.archivedBy || '',
    archivedByName: this.archivedByName || ''
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
    'Picked Up': '#198754',
    Completed: '#28a745',
    Cancelled: '#dc3545'
  };
  return colors[this.status] || '#6c757d';
};

orderSchema.methods.canTransitionTo = function(newStatus) {
  return canTransitionOrder(this.status, newStatus);
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
const StockMovement = mongoose.model('StockMovement', stockMovementSchema);
const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/bmprinting';

  try {
    await mongoose.connect(uri);
    console.log('Connected to MongoDB.');
    return;
  } catch (error) {
    if (process.env.ALLOW_IN_MEMORY_DB !== 'true' || process.env.NODE_ENV === 'production') throw error;
    console.warn('Using explicitly enabled temporary development database. Orders will not survive a restart.');
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

export { User, Product, Order, Inventory, Production, OrderFile, AuditLog, StockMovement, ContactMessage, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD };
