import { canTransitionOrder } from '../shared/orderWorkflow.js';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { QA_DATABASE_NAME, validateQaMongoConfig, validateQaReplicaSetHello } from './qaMongoGuard.js';

const DEFAULT_ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@bm.com';
const DEFAULT_ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

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

const employeeSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 120 },
  email: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
  phone: { type: String, default: '', trim: true, maxlength: 30 },
  position: { type: String, default: 'Production Staff', trim: true, maxlength: 100 },
  // Legacy employee records use these names. Keep them readable while the
  // current API serializes the same records through the canonical fields.
  employeeRole: { type: String, default: '' },
  linkedUserId: { type: String, default: '', trim: true },
  linkedEmail: { type: String, default: '', trim: true, lowercase: true },
  linkedAt: { type: Date, default: null },
  linkedBy: { type: String, default: '' },
  archived: { type: Boolean, default: false },
  passwordChangedAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
  supabaseUserId: { type: String, default: null, trim: true },
  mustChangePassword: { type: Boolean, default: false },
  permissions: {
    type: [{ type: String, enum: ['view_assigned_jobs', 'update_job_progress'] }],
    default: ['view_assigned_jobs', 'update_job_progress']
  },
  createdBy: { type: String, required: true }
}, { timestamps: true });
// Legacy roster rows store this value as linkedEmail; don't treat their
// missing canonical email field as duplicate null keys in the unique index.
employeeSchema.index({ email: 1 }, {
  name: 'employee_email_unique_nonempty', unique: true,
  partialFilterExpression: { email: { $type: 'string', $gt: '' } }
});
employeeSchema.index({ supabaseUserId: 1 }, {
  name: 'supabaseUserId_unique_nonempty', unique: true,
  partialFilterExpression: { supabaseUserId: { $type: 'string', $gt: '' } }
});
// Employee indexes are migrated explicitly on connect so the legacy sparse
// unique index can be safely replaced before Mongoose attempts index creation.
employeeSchema.set('autoIndex', false);

const productSchema = new mongoose.Schema(
  {
    id: { type: Number, required: true, unique: true },
    name: { type: String, required: true },
    price: {
      type: Number,
      required: true,
      min: 1,
      validate: { validator: Number.isInteger, message: 'Price must be a whole PHP amount.' }
    },
    image: { type: String, default: '' },
    description: { type: String, default: '' },
    minQty: { type: Number, default: 1 },
    unit: { type: String, default: 'per piece', trim: true, maxlength: 40 },
    category: { type: String, default: 'Printing' },
    active: { type: Boolean, default: true },
    imageFit: { type: String, enum: ['contain', 'cover'], default: 'contain' },
    popular: { type: Boolean, default: false },
    trackStock: { type: Boolean, default: false },
    specificationFields: { type: [mongoose.Schema.Types.Mixed], default: [] },
    stockReservations: { type: [{ orderId: String, quantity: Number }], default: [] },
    specificationType: { type: String, enum: ['clothing', 'hoodie', 'schoolId', 'banner', 'mug', 'sticker', 'backdrop', 'general'], default: 'general' },
    stock: { type: Number, default: 0, min: 0, validate: { validator: Number.isSafeInteger, message: 'Stock must be a nonnegative whole number.' } },
    lowStockThreshold: { type: Number, default: 5 }
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
    costBasisKnown: { type: Boolean, default: false },
    costBasisUpdatedAt: { type: Date, default: null },
    costBasisUpdatedBy: { type: String, default: '' },
    costBasisAudit: [{
      previousCostPerUnit: { type: Number, default: null },
      costPerUnit: { type: Number, required: true },
      reason: { type: String, required: true, maxlength: 500 },
      updatedBy: { type: String, required: true },
      updatedAt: { type: Date, required: true }
    }],
    purchaseHistory: [{
      purchaseId: { type: String, required: true },
      purchasedAt: { type: Date, required: true },
      quantity: { type: Number, required: true, min: 0.001 },
      totalCostCents: { type: Number, required: true, min: 1 },
      paidAmountCents: { type: Number, required: true, min: 0 },
      paidAt: { type: Date, default: null },
      supplier: { type: String, default: '', maxlength: 150 },
      reference: { type: String, default: '', maxlength: 100 },
      notes: { type: String, default: '', maxlength: 500 },
      recordedBy: { type: String, required: true },
      recordedByName: { type: String, default: '' },
      recordedAt: { type: Date, required: true }
    }],
    materialReservations: [{
      reservationId: { type: String, required: true }, operationId: { type: String, required: true },
      jobOrderId: { type: String, required: true }, orderId: { type: String, required: true },
      quantity: { type: Number, required: true, min: 0.001 }, usedQuantity: { type: Number, default: 0, min: 0 },
      wastedQuantity: { type: Number, default: 0, min: 0 }, releasedQuantity: { type: Number, default: 0, min: 0 },
      status: { type: String, enum: ['RESERVED', 'FINALIZED', 'RELEASED'], default: 'RESERVED' },
      unitCostSnapshot: { type: Number, default: null, min: 0 }, costDataComplete: { type: Boolean, default: false },
      actorId: { type: String, default: '' }, releasedBy: { type: String, default: '' }, releaseReason: { type: String, default: '', maxlength: 500 },
      releasedAt: { type: Date, default: null }, finalizedBy: { type: String, default: '' },
      wasteReason: { type: String, default: '', maxlength: 500 }, movementKeys: { type: [String], default: [] },
      createdAt: { type: Date, default: Date.now }, finalizedAt: { type: Date, default: null }, updatedAt: { type: Date, default: Date.now }
    }],
    stockAdjustments: [{
      requestId: { type: String, required: true }, previousQuantity: { type: Number, required: true },
      quantity: { type: Number, required: true }, reason: { type: String, required: true, maxlength: 500 },
      actorId: { type: String, required: true }, timestamp: { type: Date, required: true }
    }],
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
    // Missing on legacy records; treated as version 0 by reassignment CAS.
    assignmentVersion: { type: Number, default: 0, min: 0 },
    assignmentHistory: [{
      requestId: { type: String, required: true },
      previousAssignedEmployee: { type: String, required: true },
      previousAssignedEmployeeName: { type: String, default: '' },
      newAssignedEmployee: { type: String, required: true },
      newAssignedEmployeeName: { type: String, default: '' },
      reason: { type: String, required: true, maxlength: 1000 },
      actorId: { type: String, required: true },
      actorName: { type: String, default: '' },
      timestamp: { type: Date, required: true },
      fromVersion: { type: Number, required: true, min: 0 },
      toVersion: { type: Number, required: true, min: 1 },
      materialUsageSnapshot: { type: mongoose.Schema.Types.Mixed, default: null },
      materialUsageSubmittedBy: { type: String, default: '' },
      materialUsageSubmittedAt: { type: Date, default: null }
    }],
    notificationOutbox: [{
      eventKey: { type: String, required: true }, recipientId: { type: String, required: true },
      recipientRole: { type: String, enum: ['admin', 'staff', 'customer'], required: true },
      type: { type: String, required: true }, title: { type: String, required: true }, message: { type: String, required: true },
      relatedOrderId: { type: String, default: '' }, relatedJobId: { type: String, default: '' }, targetPage: { type: String, default: '' },
      state: { type: String, enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'], default: 'PENDING' },
      attempts: { type: Number, default: 0, min: 0 }, lastAttemptAt: { type: Date, default: null }, nextAttemptAt: { type: Date, default: null },
      manualRetryCount: { type: Number, default: 0, min: 0 },
      lockedUntil: { type: Date, default: null }, lockToken: { type: String, default: '' }, deliveryHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
      createdAt: { type: Date, required: true }, deliveredAt: { type: Date, default: null }, lastError: { type: String, default: '', maxlength: 300 }
    }],
    reassignmentNotificationOutbox: [{
      requestId: { type: String, required: true },
      eventKey: { type: String, required: true },
      recipientKind: { type: String, enum: ['previous', 'new'], required: true },
      recipientId: { type: String, required: true },
      recipientRole: { type: String, enum: ['staff'], required: true },
      type: { type: String, required: true },
      title: { type: String, required: true },
      message: { type: String, required: true },
      relatedOrderId: { type: String, default: '' },
      relatedJobId: { type: String, default: '' },
      targetPage: { type: String, default: 'staff' },
      state: { type: String, enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'], default: 'PENDING' },
      attempts: { type: Number, default: 0, min: 0 },
      manualRetryCount: { type: Number, default: 0, min: 0 },
      lastAttemptAt: { type: Date, default: null }, nextAttemptAt: { type: Date, default: null },
      lockedUntil: { type: Date, default: null }, lockToken: { type: String, default: '' },
      deliveryHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
      createdAt: { type: Date, required: true },
      deliveredAt: { type: Date, default: null },
      lastError: { type: String, default: '', maxlength: 300 }
    }],
    exceptionHistory: [{
      exceptionId: { type: String, required: true },
      requestId: { type: String, required: true },
      type: { type: String, enum: ['DELAYED', 'BLOCKED', 'PAUSED', 'FAILED'], required: true },
      reason: { type: String, required: true, maxlength: 1000 },
      notes: { type: String, default: '', maxlength: 2000 },
      previousStatus: { type: String, required: true },
      reportedBy: { type: String, required: true },
      reportedByName: { type: String, default: '' },
      reportedByRole: { type: String, enum: ['admin', 'staff'], required: true },
      reportedAt: { type: Date, required: true },
      resolutionStatus: { type: String, enum: ['ACTIVE', 'RESOLVED'], default: 'ACTIVE' },
      resolvedBy: { type: String, default: '' },
      resolvedByName: { type: String, default: '' },
      resolutionAction: { type: String, enum: ['RESUME', 'RETURN_FOR_CORRECTION', ''], default: '' },
      resolutionNotes: { type: String, default: '', maxlength: 2000 },
      resolvedAt: { type: Date, default: null },
      resolvedFromStatus: { type: String, default: '' },
      resolvedToStatus: { type: String, default: '' }
    }],
    exceptionNotificationOutbox: [{
      exceptionId: { type: String, required: true },
      eventKey: { type: String, required: true },
      recipientId: { type: String, required: true },
      recipientRole: { type: String, enum: ['admin', 'staff'], required: true },
      type: { type: String, required: true },
      title: { type: String, required: true },
      message: { type: String, required: true },
      targetPage: { type: String, default: 'admin' },
      state: { type: String, enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'], default: 'PENDING' },
      attempts: { type: Number, default: 0, min: 0 },
      manualRetryCount: { type: Number, default: 0, min: 0 },
      lastAttemptAt: { type: Date, default: null }, nextAttemptAt: { type: Date, default: null },
      lockedUntil: { type: Date, default: null }, lockToken: { type: String, default: '' },
      deliveryHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
      createdAt: { type: Date, required: true },
      deliveredAt: { type: Date, default: null },
      lastError: { type: String, default: '', maxlength: 300 }
    }],
    assignmentRequestId: { type: String, default: undefined },
    materialPlanVersion: { type: Number, default: null },
    materialPlanMode: { type: String, enum: ['MATERIALS', 'NO_MANAGED_MATERIALS', null], default: null },
    noMaterialsReason: { type: String, default: '', maxlength: 500 },
    materialOperationState: { type: String, enum: ['PREPARING', 'RESERVATION_PENDING', 'RESERVED', 'CONSUMPTION_PENDING', 'FINALIZED', 'RECONCILIATION_REQUIRED', 'RELEASED', 'NOT_REQUIRED', 'FAILED_RELEASED', null], default: null },
    materialOperationKind: { type: String, enum: ['ASSIGNMENT', 'ADDITIONAL_RESERVATION', 'FINALIZATION', ''], default: '' },
    materialOperationId: { type: String, default: '' },
    materialRecoveryAction: { type: String, enum: ['RELEASE_RESERVATIONS', 'FINALIZE_USAGE', 'NONE', ''], default: '' },
    materialOperationError: { type: String, default: '', maxlength: 500 },
    materialUsage: { type: mongoose.Schema.Types.Mixed, default: null },
    materialUsageSubmittedAt: { type: Date, default: null },
    materialUsageSubmittedBy: { type: String, default: '' },
    materialUsageSubmittedAssignmentVersion: { type: Number, default: null },
    materialUsageReviewRequired: { type: Boolean, default: false },
    materialUsageReviewedBy: { type: String, default: '' },
    materialUsageReviewedAt: { type: Date, default: null },
    materialFinalizationOperationId: { type: String, default: '' },
    materialFinalizedAt: { type: Date, default: null },
    assignedEmployeeName: { type: String },
    dateAssigned: { type: Date },
    assignedBy: { type: String },
    assignedByName: { type: String, default: '' },
    jobInstructions: { type: String, default: '', maxlength: 2000 },
    dueDate: { type: Date, default: null },
    acknowledgedAt: { type: Date, default: null },
    acknowledgedBy: { type: String, default: '' },
    submittedForReviewAt: { type: Date, default: null },
    reviewedAt: { type: Date, default: null },
    reviewedBy: { type: String, default: '' },
    reviewNotes: { type: String, default: '', maxlength: 2000 },
    productionStartedAt: { type: Date, default: null },
    productionStartedBy: { type: String, default: '' },
    productionCompletedAt: { type: Date, default: null },
    productionCompletedBy: { type: String, default: '' },
    readyForPickupAt: { type: Date, default: null },
    readyForPickupBy: { type: String, default: '' },
    reservedMaterials: [{
      inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
      reservationId: { type: String, default: '' },
      operationId: { type: String, default: '' },
      material: { type: String, required: true },
      unit: { type: String, required: true },
      quantity: { type: Number, required: true, min: 0.001 },
      reservationStatus: { type: String, enum: ['pending', 'reserved', 'consumed', 'released'], default: 'reserved' },
      unitCostSnapshot: { type: Number, default: null, min: 0 },
      directCostCents: { type: Number, default: null, min: 0 },
      costDataComplete: { type: Boolean, default: false }
    }],
    orderId: { type: String, required: true },
    status: { type: String, enum: ['Assigned', 'Acknowledged', 'In Progress', 'Submitted for Review', 'Correction Required', 'Approved', 'Ready for Pickup', 'Queueing', 'Pending', 'Queued', 'In Production', 'Quality Check', 'Ready', 'Completed', 'Delayed', 'Cancelled'], default: 'Pending' },
    assignedEmployee: { type: String, default: '' },
    priority: { type: String, enum: ['low', 'normal', 'high', 'urgent'], default: 'normal' },
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
productionSchema.index({ assignmentRequestId: 1 }, { unique: true, sparse: true });
productionSchema.index({ 'notificationOutbox.state': 1, 'notificationOutbox.nextAttemptAt': 1 });
productionSchema.index({ 'reassignmentNotificationOutbox.state': 1, 'reassignmentNotificationOutbox.nextAttemptAt': 1 });
productionSchema.index({ 'exceptionNotificationOutbox.state': 1, 'exceptionNotificationOutbox.nextAttemptAt': 1 });

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
  amount: {
    type: Number,
    required: true,
    min: 0.01,
    validate: {
      validator: value => Number.isFinite(value) && Math.abs(value * 100 - Math.round(value * 100)) <= 1e-7,
      message: 'Payment amount cannot contain fractions smaller than one centavo.'
    }
  },
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
  rejectionReason: { type: String, default: '', maxlength: 500 },
  reconciliationAt: { type: Date, default: null },
  reconciliationBy: { type: String, default: '' },
  reconciliationNote: { type: String, default: '', maxlength: 1000 }
});

const orderSchema = new mongoose.Schema(
  {
    orderId: { type: String, required: true, unique: true },
    customerId: { type: String, default: null },
    guestTokenHash: { type: String, select: false },
    jobOrderId: { type: String },
    specs: { type: String, default: '' },
    customerName: { type: String, required: true },
    customerEmail: { type: String, default: '', lowercase: true },
    orderSource: { type: String, enum: ['online', 'walk_in'], default: 'online' },
    createdBy: { type: String, default: '' },
    fulfillmentMethod: { type: String, enum: ['pickup', 'delivery'], default: 'pickup' },
    specificationDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
    cashPayment: { amount: Number, verifiedBy: String, verifiedAt: Date },
    paymentAudit: { type: [mongoose.Schema.Types.Mixed], default: [] },
    financialResolution: {
      status: { type: String, enum: ['NONE', 'REFUND_REQUIRED', 'REFUND_PENDING', 'REFUND_COMPLETED', 'CREDIT_ISSUED', 'NO_REFUND_APPLICABLE'], default: 'NONE' },
      resolutionId: { type: String, default: '' },
      originalVerifiedAmountCents: { type: Number, default: 0 },
      accountedAmountCents: { type: Number, default: 0 },
      resolutionType: { type: String, default: '' },
      reason: { type: String, default: '' },
      referenceNumber: { type: String, default: '' },
      resolutionDate: { type: Date, default: null },
      resolvedBy: { type: String, default: '' },
      evidenceName: { type: String, default: '' },
      confirmation: { type: String, default: '' }
    },
    financialResolutionEvents: { type: [mongoose.Schema.Types.Mixed], default: [] },
    notificationOutbox: [{
      eventKey: { type: String, required: true }, recipientId: { type: String, required: true },
      recipientRole: { type: String, enum: ['customer', 'staff', 'admin'], required: true },
      type: { type: String, required: true }, title: { type: String, required: true }, message: { type: String, required: true },
      relatedOrderId: { type: String, default: '' }, relatedJobId: { type: String, default: '' }, targetPage: { type: String, default: '' },
      state: { type: String, enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'], default: 'PENDING' },
      attempts: { type: Number, default: 0, min: 0 }, lastAttemptAt: { type: Date, default: null }, nextAttemptAt: { type: Date, default: null },
      manualRetryCount: { type: Number, default: 0, min: 0 },
      lockedUntil: { type: Date, default: null }, lockToken: { type: String, default: '' },
      deliveryHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
      createdAt: { type: Date, required: true }, deliveredAt: { type: Date, default: null }, lastError: { type: String, default: '', maxlength: 300 }
    }],
    cancellationAudit: { type: [mongoose.Schema.Types.Mixed], default: [] },
    stockReleaseStatus: { type: String, enum: ['NOT_REQUIRED', 'PENDING', 'COMPLETED'], default: 'NOT_REQUIRED' },
    contactNumber: { type: String, default: '' },
    address: { type: String, default: '' },
    items: [orderItemSchema],
    totalAmount: { type: Number, required: true },
    paymentMethod: { type: String, default: '' },
    paymentStatus: { type: String, enum: ['Unpaid', 'pending', 'For Verification', 'Verified', 'Rejected'], default: 'Unpaid' },
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

orderSchema.index({ 'notificationOutbox.state': 1, 'notificationOutbox.nextAttemptAt': 1 });

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
    status: { type: String, enum: ['new', 'read', 'awaiting_staff', 'awaiting_customer', 'resolved'], default: 'new' },
    replies: [{
      replyId: { type: String, required: true }, requestId: { type: String, required: true },
      message: { type: String, required: true, maxlength: 3000 }, authorId: { type: String, required: true },
      authorName: { type: String, required: true }, authorRole: { type: String, enum: ['customer', 'staff', 'admin'], required: true },
      createdAt: { type: Date, required: true }
    }],
    internalNotes: [{
      noteId: { type: String, required: true }, requestId: { type: String, required: true },
      message: { type: String, required: true, maxlength: 3000 }, authorId: { type: String, required: true },
      authorName: { type: String, required: true }, authorRole: { type: String, enum: ['staff', 'admin'], required: true },
      createdAt: { type: Date, required: true }
    }],
    notificationOutbox: [{
      eventKey: { type: String, required: true }, recipientId: { type: String, required: true },
      recipientRole: { type: String, enum: ['customer', 'admin'], required: true },
      title: { type: String, required: true }, message: { type: String, required: true },
      state: { type: String, enum: ['PENDING', 'PROCESSING', 'DELIVERED', 'FAILED'], default: 'PENDING' },
      attempts: { type: Number, default: 0, min: 0 }, lastAttemptAt: { type: Date, default: null }, nextAttemptAt: { type: Date, default: null },
      manualRetryCount: { type: Number, default: 0, min: 0 },
      lockedUntil: { type: Date, default: null }, lockToken: { type: String, default: '' },
      deliveryHistory: { type: [mongoose.Schema.Types.Mixed], default: [] },
      lastError: { type: String, default: '', maxlength: 300 }, createdAt: { type: Date, required: true }, deliveredAt: { type: Date, default: null }
    }],
    lastActivityAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
    resolvedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

contactMessageSchema.index({ createdAt: -1 });
contactMessageSchema.index({ status: 1, createdAt: -1 });
contactMessageSchema.index({ userId: 1 });
contactMessageSchema.index({ userId: 1, createdAt: -1 });

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

const notificationSchema = new mongoose.Schema({
  recipientId: { type: String, required: true, index: true },
  recipientRole: { type: String, enum: ['customer', 'admin', 'staff'], required: true },
  type: { type: String, required: true, maxlength: 80 },
  title: { type: String, required: true, maxlength: 160 },
  message: { type: String, required: true, maxlength: 1000 },
  relatedOrderId: { type: String, default: '', maxlength: 80 },
  relatedJobId: { type: String, default: '', maxlength: 80 },
  targetPage: { type: String, enum: ['', 'myorders', 'admin', 'staff'], default: '' },
  eventKey: { type: String, required: true, unique: true, maxlength: 240 },
  read: { type: Boolean, default: false, index: true },
  readAt: { type: Date, default: null }
}, { timestamps: true });
notificationSchema.index({ recipientId: 1, createdAt: -1 });

const stockMovementSchema = new mongoose.Schema(
  {
    orderId: { type: String, default: '' },
    jobOrderId: { type: String, default: '' },
    inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', required: true },
    material: { type: String, required: true },
    materialType: { type: String, default: '' },
    unit: { type: String, default: 'pcs' },
    quantity: { type: Number, required: true, min: 0.001 },
    movementType: { type: String, enum: ['IN', 'OUT', 'RESERVE', 'RELEASE', 'WASTE'], required: true },
    reason: { type: String, enum: ['RESTOCK', 'ORDER_PICKUP', 'PRODUCTION_RESERVATION', 'PRODUCTION_RELEASE', 'PRODUCTION_USE', 'PRODUCTION_WASTE', 'ADJUSTMENT', 'OTHER'], required: true },
    performedBy: { type: String, required: true },
    performedByName: { type: String, default: '' },
    receivedByName: { type: String, default: null },
    idempotencyKey: { type: String, default: undefined },
    notes: { type: String, default: '' },
    unitCostSnapshot: { type: Number, default: null, min: 0 },
    directCostCents: { type: Number, default: null, min: 0 },
    costDataComplete: { type: Boolean, default: false }
  },
  { timestamps: true }
);

stockMovementSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

const expenseSchema = new mongoose.Schema({
  expenseDate: { type: Date, required: true, index: true },
  category: { type: String, required: true, enum: ['Utilities', 'Rent', 'Payroll', 'Delivery', 'Maintenance', 'Supplies', 'Marketing', 'Other'] },
  description: { type: String, required: true, trim: true, maxlength: 500 },
  amountCents: { type: Number, required: true, min: 1 },
  paymentStatus: { type: String, required: true, enum: ['Paid', 'Unpaid'], default: 'Paid' },
  paidAmountCents: { type: Number, required: true, min: 0, default: 0 },
  paidAt: { type: Date, default: null },
  paymentMethod: { type: String, default: '', maxlength: 50 },
  reference: { type: String, default: '', maxlength: 100 },
  status: { type: String, enum: ['Active', 'Voided'], default: 'Active', index: true },
  voidReason: { type: String, default: '', maxlength: 500 },
  recordedBy: { type: String, required: true },
  recordedByName: { type: String, default: '' },
  updatedBy: { type: String, default: '' },
  updatedAt: { type: Date, default: null },
  auditHistory: [{
    action: { type: String, required: true },
    userId: { type: String, required: true },
    userName: { type: String, default: '' },
    timestamp: { type: Date, required: true },
    reason: { type: String, default: '', maxlength: 500 }
  }]
}, { timestamps: true });
expenseSchema.index({ expenseDate: -1, status: 1 });

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
const Expense = mongoose.model('Expense', expenseSchema);
const ContactMessage = mongoose.model('ContactMessage', contactMessageSchema);
const Employee = mongoose.model('Employee', employeeSchema);
const Notification = mongoose.model('Notification', notificationSchema);

let mongoConnectionPromise;

export async function ensureEmployeeIndexes() {
  try { await Employee.createCollection(); }
  catch (error) { if (error.codeName !== 'NamespaceExists' && error.code !== 48) throw error; }

  const indexes = await Employee.collection.indexes();
  const accountIndexes = indexes.filter(index => index.key?.supabaseUserId === 1);
  const hasDesiredIndex = accountIndexes.some(index => index.unique &&
    index.partialFilterExpression?.supabaseUserId?.$type === 'string' &&
    index.partialFilterExpression.supabaseUserId.$gt === '');
  if (!hasDesiredIndex) {
    const duplicate = await Employee.aggregate([
      { $match: { supabaseUserId: { $type: 'string', $gt: '' } } },
      { $group: { _id: '$supabaseUserId', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } }, { $limit: 1 }
    ]);
    if (duplicate.length) throw new Error(`Duplicate staff account link ${duplicate[0]._id} exists on multiple employees; resolve it before enabling unique account links.`);
    for (const index of accountIndexes) await Employee.collection.dropIndex(index.name);
  }
  await Employee.createIndexes();
}

export async function connectMongo() {
  const qaMode = process.env.BM_QA_MODE === 'true';
  const uri = process.env.MONGODB_URI || (qaMode ? '' : 'mongodb://127.0.0.1:27017/bmprinting');
  const dbName = process.env.MONGODB_DB_NAME || undefined;
  if (qaMode) validateQaMongoConfig(uri, dbName, process.env.BM_QA_MONGO_ADDRESS);
  if (mongoose.connection.readyState === 1) {
    if (qaMode) {
      if (mongoose.connection.name !== QA_DATABASE_NAME || `${mongoose.connection.host}:${mongoose.connection.port}` !== process.env.BM_QA_MONGO_ADDRESS) {
        throw new Error('QA mode detected an existing MongoDB connection outside the disposable database.');
      }
      validateQaReplicaSetHello(await mongoose.connection.db.admin().command({ hello: 1 }), process.env.BM_QA_MONGO_ADDRESS);
    }
    return mongoose.connection;
  }
  if (mongoConnectionPromise) return mongoConnectionPromise;
  if (process.env.NODE_ENV === 'production' && !process.env.MONGODB_URI) {
    throw new Error('MONGODB_URI is required in production. Configure an Atlas replica-set connection string.');
  }
  mongoConnectionPromise = (async () => {
    try {
      await mongoose.connect(uri, {
        dbName,
        maxPoolSize: Number(process.env.MONGODB_MAX_POOL_SIZE || 10),
        serverSelectionTimeoutMS: Number(process.env.MONGODB_SERVER_SELECTION_TIMEOUT_MS || 10000)
      });
      if (qaMode) {
        const hello = await mongoose.connection.db.admin().command({ hello: 1 });
        validateQaReplicaSetHello(hello, process.env.BM_QA_MONGO_ADDRESS);
      }
      await ensureEmployeeIndexes();
      console.log('Connected to MongoDB.');
      return mongoose.connection;
    } catch (error) {
      if (process.env.ALLOW_IN_MEMORY_DB !== 'true' || process.env.NODE_ENV === 'production') throw error;
      console.warn('Using explicitly enabled temporary development database. Orders will not survive a restart.');
      const memoryServer = await MongoMemoryServer.create();
      await mongoose.connect(memoryServer.getUri());
      console.log('Connected to an explicitly enabled temporary development database.');
      return mongoose.connection;
    }
  })().catch(error => { mongoConnectionPromise = undefined; throw error; });
  return mongoConnectionPromise;
}

export async function seedCatalogAndAdmin() {
  if (!DEFAULT_ADMIN_PASSWORD) throw new Error("Explicit Admin bootstrap password required.");
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

export { User, Employee, Product, Order, Inventory, Production, OrderFile, AuditLog, Notification, StockMovement, Expense, ContactMessage, DEFAULT_ADMIN_EMAIL, DEFAULT_ADMIN_PASSWORD };
