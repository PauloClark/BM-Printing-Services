import mongoose from 'mongoose';
import { randomBytes, randomUUID } from 'node:crypto';
import { AuditLog, Employee, Inventory, Notification, Order, Production, StockMovement } from '../db.js';
import { finalizeMaterial, reconcileReservationMaterial, releaseMaterial, reserveMaterial } from '../materialReservations.js';
import { requireAdmin, requireOrderStaff } from '../middleware/auth.js';
import { serializeOrder } from '../utils.js';
import { listAssignableStaff, verifyAssignableStaff } from '../staffDirectory.js';
import { makeNotificationIntent } from '../notificationService.js';
import { runNotificationBatch } from '../notificationWorker.js';
import { paymentMatchesOrderTotal } from '../paymentAmounts.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const REASSIGNABLE_JOB_STATUSES = ['Assigned', 'Acknowledged', 'In Progress', 'Correction Required'];
const EXCEPTION_TYPES = ['DELAYED', 'BLOCKED', 'PAUSED', 'FAILED'];
const EXCEPTION_REPORT_STATUSES = ['Assigned', 'Acknowledged', 'In Progress', 'Submitted for Review', 'Correction Required', 'Approved'];
const noActiveExceptionFilter = { exceptionHistory: { $not: { $elemMatch: { resolutionStatus: 'ACTIVE' } } } };
const stableExceptionMaterialFilter = { $and: [
  { materialOperationState: { $nin: ['PREPARING', 'RESERVATION_PENDING', 'CONSUMPTION_PENDING', 'RECONCILIATION_REQUIRED'] } },
  { $nor: [{ 'reservedMaterials.reservationStatus': 'pending' }] }
] };
const hasActiveException = job => (job?.exceptionHistory || []).some(item => item.resolutionStatus === 'ACTIVE');
const requireEmployeePermission = permission => async (req, res, next) => {
  if (req.user.role === 'admin') return next();
  try {
    const managedEmployees = await Employee.countDocuments();
    if (!managedEmployees) return next();
    const employee = await Employee.findOne({ active: true, archived: { $ne: true }, $and: [
      { $or: [{ supabaseUserId: req.user.id }, { linkedUserId: req.user.id }] },
      { $or: [{ permissions: permission }, { permissions: { $exists: false } }] }
    ] }).lean();
    if (!employee) return res.status(403).json({ error: 'Your employee access is inactive or does not allow this action.' });
    return next();
  } catch { return res.status(503).json({ error: 'Unable to verify employee access.' }); }
};
const number = (value, positive = false) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < (positive ? 0.001 : 0) || value > 1e9 || Math.abs(value * 1000 - Math.round(value * 1000)) > 0.0001) fail(400, 'Quantities must be finite numbers with at most three decimal places.');
  return value;
};
const text = (v, max = 150) => typeof v === 'string' ? v.trim().slice(0, max) : '';
const validId = id => typeof id === 'string' && /^[a-f0-9]{24}$/i.test(id);
const validDateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const availableExpression = { $subtract: ['$quantity', { $ifNull: ['$reservedQuantity', 0] }] };
const inventoryView = item => ({ ...item.toObject(), reservedQuantity: item.reservedQuantity || 0, availableQuantity: Math.round((item.quantity - (item.reservedQuantity || 0)) * 1000) / 1000 });
const wrap = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'A job order already exists. Refresh the order.' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 20 || error.codeName === 'IllegalOperation') return res.status(503).json({ error: 'Job reservations require a MongoDB replica set with transactions. No materials were reserved.' });
    if (error.name === 'ValidationError') { console.error('Phase 3 validation failure:', error.message); return res.status(400).json({ error: 'Check the material category, quantities and required fields.' }); }
    console.error('Phase 3 request failed:', error);
    res.status(503).json({ error: 'The request could not be completed. Refresh and retry; no partial reservation is committed.' });
  }
};
function materialsInput(body, allowEmpty = false) {
  if (allowEmpty && Array.isArray(body.materials) && body.materials.length === 0) return [];
  if (!Array.isArray(body.materials) || !body.materials.length || body.materials.length > 50) fail(400, 'Select between 1 and 50 required materials.');
  const seen = new Set();
  return body.materials.map(row => {
    if (!validId(row.inventoryId) || seen.has(row.inventoryId)) fail(400, 'Select each valid material only once.');
    seen.add(row.inventoryId);
    return { inventoryId: row.inventoryId, quantity: number(row.quantity, true) };
  });
}
function materialUsageInput(job, rows) {
  if (!Array.isArray(rows) || rows.length !== job.reservedMaterials.length) fail(400, 'Submit usage for every reserved material exactly once.');
  const seen = new Set();
  return job.reservedMaterials.map(material => {
    const row = rows.find(value => value?.reservationId === material.reservationId);
    if (!row || seen.has(row.reservationId)) fail(400, 'Material usage rows must uniquely match the job reservations.');
    seen.add(row.reservationId);
    const usedQuantity = number(row.usedQuantity, false);
    const wastedQuantity = number(row.wastedQuantity, false);
    const unusedQuantity = number(row.unusedQuantity, false);
    if (Math.round((usedQuantity + wastedQuantity + unusedQuantity) * 1000) !== Math.round(material.quantity * 1000)) {
      fail(400, `Used, wasted and unused quantities must equal the ${material.quantity} ${material.unit} reserved for ${material.material}.`);
    }
    const wasteReason = text(row.wasteReason, 500);
    if (wastedQuantity > 0 && wasteReason.length < 5) fail(400, `A waste reason of at least five characters is required for ${material.material}.`);
    return { reservationId: material.reservationId, usedQuantity, wastedQuantity, unusedQuantity, wasteReason, notes: text(row.notes, 500) };
  });
}
async function finalizeJobMaterials(job, actor) {
  const usageById = new Map((job.materialUsage || []).map(row => [row.reservationId, row]));
  const finalizedRows = [];
  for (const material of job.reservedMaterials || []) {
    const usage = usageById.get(material.reservationId);
    if (!usage) fail(`Usage record for ${material.material} is missing.`);
    const claim = await finalizeMaterial(material.toObject?.() || material, usage, job, actor);
    const consumedQuantity = Math.round((claim.usedQuantity + claim.wastedQuantity) * 1000) / 1000;
    if (consumedQuantity > 0) finalizedRows.push({
      ...material.toObject?.() || material,
      quantity: consumedQuantity,
      reservationStatus: 'consumed',
      unitCostSnapshot: claim.costDataComplete ? claim.unitCostSnapshot : null,
      directCostCents: claim.costDataComplete ? Math.round(consumedQuantity * claim.unitCostSnapshot * 100) : null,
      costDataComplete: claim.costDataComplete
    });
  }
  const finalizedAt = new Date();
  const updated = await Production.findOneAndUpdate({ _id: job._id, materialOperationState: 'CONSUMPTION_PENDING' }, {
    $set: { reservedMaterials: finalizedRows, materialOperationState: 'FINALIZED', materialRecoveryAction: 'NONE', materialOperationError: '', materialFinalizedAt: finalizedAt }
  }, { new: true, runValidators: true });
  if (!updated) fail('Material events are recorded, but the job finalization state needs Admin reconciliation.');
  return updated;
}
async function confirmedOrder(orderId, session) {
  const order = await Order.findOne({ orderId }).session(session || null);
  if (!order) fail(404, 'Order not found.');
  const existing = await Production.findOne({ orderId, phase3: { $ne: false } }).session(session || null);
  if (order.jobOrderId || existing) fail(409, `Job Order already created: ${order.jobOrderId || existing.jobOrderId || 'legacy production record (requires review)'}`);
  const last = order.paymentMethod === 'cash' ? { ...order.cashPayment?.toObject?.(), status: order.paymentStatus } : order.paymentSubmissions?.at(-1);
  if (order.paymentStatus !== 'Verified' || order.status !== 'Confirmed' || last?.status !== 'Verified' || !last.verifiedBy || !paymentMatchesOrderTotal(last.amount, order.totalAmount)) {
    fail(409, 'A full, admin-verified payment matching the stored order total and a Confirmed order are required.');
  }
  return order;
}
const audit = (req, action, resourceType, resourceId, previousValue, newValue) => AuditLog.create({
  userId: req.user.id, userName: req.user.name || req.user.email || '', role: req.user.role,
  action, module: 'Job Orders', resourceType, resourceId, previousValue, newValue,
  timestamp: new Date()
});
const visibleJob = (job, user) => {
  if (user.role === 'admin') return job;
  const { assignmentHistory, reassignmentNotificationOutbox, exceptionNotificationOutbox, ...staffJob } = job;
  return staffJob;
};
async function deliverExceptionNotifications(jobOrderId, exceptionId) {
  await runNotificationBatch({ limit: 20 }).catch(() => {});
  const job = await Production.findOne({ phase3: true, jobOrderId }).lean();
  if (!job) fail(404, 'Job order not found.');
  const refreshed = await Production.findById(job._id).select('exceptionNotificationOutbox').lean();
  const intents = (refreshed?.exceptionNotificationOutbox || []).filter(item => item.exceptionId === exceptionId);
  const results = [];
  for (const intent of intents) {
    if (intent.recipientId === '*') {
      const records = (await Notification.find({ relatedJobId: jobOrderId, recipientRole: 'admin' }).select('eventKey recipientId recipientRole').lean())
        .filter(row => row.eventKey.startsWith(`${intent.eventKey}:`));
      if (records.length) results.push(...records.map(row => ({ recipientId: row.recipientId, recipientRole: row.recipientRole, state: intent.state, lastError: intent.lastError || '' })));
      else results.push({ recipientId: '*', recipientRole: intent.recipientRole, state: intent.state, lastError: intent.lastError || '' });
    } else results.push({ recipientId: intent.recipientId, recipientRole: intent.recipientRole, state: intent.state, lastError: intent.lastError || '' });
  }
  return results;
}
async function deliverReassignmentNotifications(jobOrderId, requestId) {
  await runNotificationBatch({ limit: 20 }).catch(() => {});
  const job = await Production.findOne({ phase3: true, jobOrderId }).lean();
  if (!job) fail(404, 'Job order not found.');
  const refreshed = await Production.findOne({ _id: job._id }).select('reassignmentNotificationOutbox').lean();
  return (refreshed?.reassignmentNotificationOutbox || []).filter(item => item.requestId === requestId).map(item => ({
    recipientId: item.recipientId, recipientKind: item.recipientKind, state: item.state, lastError: item.lastError || ''
  }));
}
async function recordInventoryMovement({ idempotencyKey, item, actor, quantity, movementType, reason, orderId = '', jobOrderId = '', notes = '' }) {
  if (!(quantity > 0)) return null;
  return StockMovement.findOneAndUpdate({ idempotencyKey }, { $setOnInsert: {
    idempotencyKey, orderId, jobOrderId, inventoryId: item._id, material: item.material, materialType: item.type,
    unit: item.unit, quantity, movementType, reason, performedBy: actor.id, performedByName: actor.name || actor.email || '',
    notes, unitCostSnapshot: item.costBasisKnown ? item.costPerUnit : null, costDataComplete: item.costBasisKnown === true
  } }, { upsert: true, new: true, setDefaultsOnInsert: true });
}

export default function phase3Routes(app) {
  app.get('/api/inventory', requireAdmin, wrap(async (req, res) => {
    res.json({ inventory: (await Inventory.find().sort({ material: 1 })).map(inventoryView) });
  }));
  app.get('/api/inventory/low-stock', requireAdmin, wrap(async (req, res) => {
    const items = (await Inventory.find()).map(inventoryView);
    res.json({ inventory: items.filter(i => i.availableQuantity <= i.minimumStockLevel) });
  }));
  app.post('/api/inventory', requireAdmin, wrap(async (req, res) => {
    const b = req.body || {}, material = text(b.material), unit = text(b.unit, 30);
    if (!material || !unit) fail(400, 'Material name and unit are required.');
    const initialQuantity = number(b.quantity);
    const item = await Inventory.create({ material, unit, type: b.type || 'Other', quantity: initialQuantity, minimumStockLevel: number(b.minimumStockLevel ?? 10), reservedQuantity: 0 });
    await recordInventoryMovement({ idempotencyKey: `opening:${item._id}`, item, actor: req.user, quantity: initialQuantity, movementType: 'IN', reason: 'ADJUSTMENT', notes: 'Initial stock balance entered when the inventory item was created.' });
    await audit(req, 'CREATE_INVENTORY_ITEM', 'Inventory', String(item._id), null, { material, quantity: initialQuantity, unit });
    res.status(201).json({ inventory: inventoryView(item) });
  }));
  app.post('/api/inventory/stock-in', requireAdmin, wrap(async (req, res) => {
    const qty = number(req.body?.quantity, true);
    const totalCost = req.body?.totalCost;
    const paidAmount = req.body?.paidAmount ?? 0;
    if (typeof totalCost !== 'number' || !Number.isFinite(totalCost) || totalCost <= 0 || totalCost > 1e9 || Math.abs(totalCost * 100 - Math.round(totalCost * 100)) > 1e-7) fail(400, 'Enter the actual purchase total in PHP, to the nearest centavo.');
    if (typeof paidAmount !== 'number' || !Number.isFinite(paidAmount) || paidAmount < 0 || paidAmount > totalCost || Math.abs(paidAmount * 100 - Math.round(paidAmount * 100)) > 1e-7) fail(400, 'Paid amount must be between zero and the actual purchase total.');
    const purchaseId = text(req.body?.purchaseId, 80);
    if (!/^[a-f0-9-]{16,80}$/i.test(purchaseId)) fail(400, 'A valid purchase request ID is required to prevent duplicate stock-in.');
    const filter = validId(req.body?.inventoryId) ? { _id: req.body.inventoryId } : { material: text(req.body?.material) };
    const existing = await Inventory.findOne({ 'purchaseHistory.purchaseId': purchaseId });
    if (existing) {
      const purchase = existing.purchaseHistory.find(row => row.purchaseId === purchaseId);
      if ((validId(req.body?.inventoryId) && String(existing._id) !== String(req.body.inventoryId)) ||
          (!validId(req.body?.inventoryId) && existing.material !== text(req.body?.material))) fail(409, 'Purchase request ID was already used for a different inventory item.');
      await recordInventoryMovement({ idempotencyKey: `restock:${existing._id}:${purchaseId}`, item: existing, actor: req.user, quantity: purchase.quantity, movementType: 'IN', reason: 'RESTOCK', notes: `Purchase ${purchaseId}; total ${purchase.totalCostCents} centavos.` });
      return res.json({ inventory: inventoryView(existing), purchase, duplicate: true });
    }
    const item = await Inventory.findOne(filter);
    if (!item) fail(404, 'Create the inventory item before restocking.');
    const purchaseDate = text(req.body?.purchaseDate, 10);
    const purchasedAt = validDateOnly(purchaseDate) ? new Date(`${purchaseDate}T12:00:00+08:00`) : null;
    if (!purchasedAt) fail(400, 'Enter a valid inventory purchase date.');
    const paidDate = text(req.body?.paidDate, 10);
    const effectivePaidDate = paidDate || purchaseDate;
    const paidAt = paidAmount > 0 && validDateOnly(effectivePaidDate) ? new Date(`${effectivePaidDate}T12:00:00+08:00`) : null;
    if (paidAmount > 0 && !paidAt) fail(400, 'Enter a valid payment date for the paid amount.');
    const totalCostCents = Math.round(totalCost * 100);
    const paidAmountCents = Math.round(paidAmount * 100);
    const newQuantity = item.quantity + qty;
    const costBasisKnown = item.costBasisKnown === true || item.quantity === 0;
    const costPerUnit = costBasisKnown
      ? Number((((item.quantity * (item.costBasisKnown ? item.costPerUnit : 0)) + totalCost) / newQuantity).toFixed(6))
      : item.costPerUnit;
    const purchase = {
      purchaseId, purchasedAt, quantity: qty, totalCostCents, paidAmountCents, paidAt,
      supplier: text(req.body?.supplier, 150), reference: text(req.body?.reference, 100),
      notes: text(req.body?.notes, 500), recordedBy: req.user.id,
      recordedByName: req.user.name || req.user.email || '', recordedAt: new Date()
    };
    const updateFilter = {
      ...filter, quantity: item.quantity, costPerUnit: item.costPerUnit, costBasisKnown: item.costBasisKnown === true,
      purchaseHistory: { $not: { $elemMatch: { purchaseId } } }
    };
    const updated = await Inventory.findOneAndUpdate(updateFilter, {
      $inc: { quantity: qty },
      $set: { costPerUnit, costBasisKnown, lastRestocked: purchasedAt },
      $push: { purchaseHistory: purchase }
    }, { new: true, runValidators: true });
    if (!updated) fail(409, 'Inventory changed or this purchase was already recorded. Refresh before retrying.');
    await recordInventoryMovement({ idempotencyKey: `restock:${updated._id}:${purchaseId}`, item: updated, actor: req.user, quantity: qty, movementType: 'IN', reason: 'RESTOCK', notes: `Purchase ${purchaseId}; total ${totalCostCents} centavos.` });
    await AuditLog.create({
      userId: req.user.id, userName: req.user.name || req.user.email || '', role: 'admin',
      action: 'RECORD_INVENTORY_PURCHASE', module: 'Financials', resourceType: 'Inventory',
      resourceId: String(updated._id), previousValue: { quantity: item.quantity }, newValue: { quantity: updated.quantity, purchase },
      timestamp: new Date()
    });
    res.status(201).json({ inventory: inventoryView(updated), purchase });
  }));
  app.post('/api/inventory/stock-out', requireAdmin, (req, res) => res.status(409).json({ error: 'Physical stock deduction is not available in Phase 3. Reserve materials through Prepare Job Order.' }));
  app.patch('/api/inventory/adjust', requireAdmin, wrap(async (req, res) => {
    const qty = number(req.body?.quantity);
    const requestId = text(req.body?.requestId, 80), reason = text(req.body?.reason, 500);
    if (!/^[a-f0-9-]{16,80}$/i.test(requestId) || reason.length < 5) fail(400, 'A stable adjustment request ID and reason of at least five characters are required.');
    const filter = validId(req.body?.inventoryId) ? { _id: req.body.inventoryId } : { material: text(req.body?.material) };
    let item = await Inventory.findOne({ ...filter, 'stockAdjustments.requestId': requestId });
    if (item) {
      const adjustment = item.stockAdjustments.find(row => row.requestId === requestId);
      const delta = adjustment.quantity - adjustment.previousQuantity;
      await recordInventoryMovement({ idempotencyKey: `adjustment:${item._id}:${requestId}`, item, actor: req.user, quantity: Math.abs(delta), movementType: delta > 0 ? 'IN' : 'OUT', reason: 'ADJUSTMENT', notes: adjustment.reason });
      return res.json({ inventory: inventoryView(item), duplicate: true });
    }
    const before = await Inventory.findOne(filter);
    if (!before) fail(404, 'Inventory item was not found.');
    const delta = qty - before.quantity, timestamp = new Date();
    item = await Inventory.findOneAndUpdate({
      ...filter, quantity: before.quantity, 'stockAdjustments.requestId': { $ne: requestId },
      $expr: { $lte: [{ $ifNull: ['$reservedQuantity', 0] }, qty] }
    }, {
      $set: { quantity: qty },
      $push: { stockAdjustments: { requestId, previousQuantity: before.quantity, quantity: qty, reason, actorId: req.user.id, timestamp } }
    }, { new: true, runValidators: true });
    if (!item) fail(409, 'On-hand stock cannot fall below reserved stock, or the item no longer exists.');
    await recordInventoryMovement({ idempotencyKey: `adjustment:${item._id}:${requestId}`, item, actor: req.user, quantity: Math.abs(delta), movementType: delta > 0 ? 'IN' : 'OUT', reason: 'ADJUSTMENT', notes: reason });
    await audit(req, 'ADJUST_INVENTORY_QUANTITY', 'Inventory', String(item._id), { quantity: before.quantity }, { quantity: qty, reason, requestId });
    res.json({ inventory: inventoryView(item) });
  }));
  app.patch('/api/inventory/:id', requireAdmin, wrap(async (req, res) => {
    if (!validId(req.params.id)) fail(400, 'Invalid inventory item.');
    const b = req.body || {}, fields = {};
    for (const key of ['material', 'unit', 'type']) if (b[key] !== undefined) { fields[key] = text(b[key]); if (!fields[key]) fail(400, 'Name, unit and category cannot be empty.'); }
    if (b.minimumStockLevel !== undefined) fields.minimumStockLevel = number(b.minimumStockLevel);
    // Unit/category changes would reinterpret existing reservations. Keep them stable once reserved.
    const filter = { _id: req.params.id };
    if (fields.unit || fields.type) filter.$expr = { $eq: [{ $ifNull: ['$reservedQuantity', 0] }, 0] };
    const item = await Inventory.findOneAndUpdate(filter, { $set: fields }, { new: true, runValidators: true });
    if (!item) fail(409, 'Item missing, or unit/category cannot change while materials are reserved.');
    res.json({ inventory: inventoryView(item) });
  }));
  app.get('/api/job-orders/staff', requireAdmin, wrap(async (req, res) => {
    const [accounts, employees] = await Promise.all([listAssignableStaff(), Employee.find().select('supabaseUserId linkedUserId active archived').lean()]);
    const eligibleIds = new Set(employees.filter(employee => employee.active && !employee.archived && (employee.supabaseUserId || employee.linkedUserId)).map(employee => employee.supabaseUserId || employee.linkedUserId));
    res.json({ staff: employees.length ? accounts.filter(account => eligibleIds.has(account.id)) : accounts });
  }));
  app.get('/api/job-orders/eligible', requireAdmin, wrap(async (req, res) => {
    const orders = await Order.find({
      paymentStatus: 'Verified', status: 'Confirmed', archived: { $ne: true },
      $or: [{ jobOrderId: { $exists: false } }, { jobOrderId: null }, { jobOrderId: '' }]
    }).sort({ createdAt: 1 });
    res.json({ orders: orders.filter(order => {
      const payment = order.paymentMethod === 'cash' ? { ...order.cashPayment?.toObject?.(), status: order.paymentStatus } : order.paymentSubmissions?.at(-1);
      return payment?.status === 'Verified' && payment.verifiedBy && paymentMatchesOrderTotal(payment.amount, order.totalAmount);
    }).map(serializeOrder) });
  }));
  app.post('/api/orders/:orderId/material-check', requireAdmin, wrap(async (req, res) => {
    const order = await confirmedOrder(req.params.orderId), rows = materialsInput(req.body || {}), materials = [];
    for (const row of rows) {
      const item = await Inventory.findById(row.inventoryId);
      if (!item) fail(404, 'A selected material no longer exists.');
      const available = inventoryView(item).availableQuantity;
      materials.push({ ...row, material: item.material, unit: item.unit, available, shortage: Math.max(0, Math.round((row.quantity - available) * 1000) / 1000) });
    }
    res.json({ order: serializeOrder(order), materials, available: materials.every(m => !m.shortage) });
  }));
  app.post('/api/job-orders', requireAdmin, wrap(async (req, res) => {
    const b = req.body || {}, orderId = text(b.orderId, 50);
    const assignmentRequestId = text(b.assignmentRequestId, 80);
    if (!/^[a-f0-9-]{16,80}$/i.test(assignmentRequestId)) fail(400, 'A stable assignment request ID is required. Retry the same request using the same ID.');
    const prior = await Production.findOne({ assignmentRequestId });
    if (prior) {
      if (prior.orderId !== orderId) fail(409, 'This assignment request ID belongs to a different order.');
      if (prior.materialOperationState === 'RESERVED' || prior.materialOperationState === 'NOT_REQUIRED') return res.json({ job: prior, duplicate: true });
      if (prior.materialOperationState === 'FAILED_RELEASED') fail(409, 'The prior attempt was safely rolled back. The same request ID may be retried.');
      fail(503, 'This assignment is still being recovered. Use the Admin reconciliation action before retrying.');
    }
    await confirmedOrder(orderId);
    const noManagedMaterials = b.noManagedMaterials === true;
    const materials = noManagedMaterials ? [] : materialsInput(b);
    if (noManagedMaterials && Array.isArray(b.materials) && b.materials.length) fail(400, 'Remove material rows before choosing a no-material reason.');
    const noMaterialsReason = text(b.noMaterialsReason, 500);
    if (noManagedMaterials && !['Customer-supplied materials', 'Service-only work', 'Materials not yet tracked in inventory'].includes(noMaterialsReason)) {
      fail(400, 'Choose a reason for assigning a job without inventory-managed materials.');
    }
    if (!noManagedMaterials && noMaterialsReason) fail(400, 'A no-material reason can only be used when no-managed-materials is explicitly selected.');
    const materialRows = [];
    for (const row of materials) {
      const item = await Inventory.findById(row.inventoryId).lean();
      if (!item) fail(404, 'A selected material no longer exists.');
      materialRows.push({ ...row, material: item.material, unit: item.unit });
    }
    const account = await verifyAssignableStaff(b.assignedEmployeeId);
    const managedEmployees = await Employee.countDocuments();
    const linkedEmployee = managedEmployees ? await Employee.findOne({ $or: [{ supabaseUserId: account.id }, { linkedUserId: account.id }], active: true, archived: { $ne: true }, $and: [
      { $or: [{ permissions: { $all: ['view_assigned_jobs', 'update_job_progress'] } }, { permissions: { $exists: false } }] }
    ] }).lean() : null;
    if (managedEmployees && !linkedEmployee) {
      fail(400, 'Select an active linked employee with assigned-job access.');
    }
    await Production.init();
    await StockMovement.init();
    const jobOrderId = 'JO-' + new Date().toISOString().slice(0,10).replaceAll('-','') + '-' + randomBytes(6).toString('hex').toUpperCase();
    let created;
    try {
      created = await Production.create({
        assignmentRequestId,
        phase3: true, jobOrderId, orderId, assignmentVersion: 1, assignedEmployee: account.id,
        assignedEmployeeName: linkedEmployee?.name || account.name, assignedBy: req.user.id,
        assignedByName: req.user.name || req.user.email || '', dateAssigned: new Date(),
        status: 'Assigned', materialPlanVersion: 1,
        materialPlanMode: noManagedMaterials ? 'NO_MANAGED_MATERIALS' : 'MATERIALS',
        noMaterialsReason: noManagedMaterials ? noMaterialsReason : '',
        materialOperationState: noManagedMaterials ? 'PREPARING' : 'RESERVATION_PENDING',
        materialOperationKind: noManagedMaterials ? '' : 'ASSIGNMENT',
        materialOperationId: jobOrderId,
        reservedMaterials: materialRows.map(row => {
          const inventoryId = new mongoose.Types.ObjectId(row.inventoryId);
          return { ...row, inventoryId, reservationId: `${jobOrderId}:${inventoryId}`, operationId: jobOrderId, reservationStatus: 'pending' };
        }),
        jobInstructions: text(b.jobInstructions, 2000), priority: ['low','normal','high','urgent'].includes(b.priority) ? b.priority : 'normal',
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        productionHistory: [{ status: 'Assigned', notes: 'Job assigned.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' }]
      });
    } catch (error) { throw error; }
    const lockedOrder = await Order.findOneAndUpdate(
      { orderId, paymentStatus: 'Verified', status: 'Confirmed', $or: [{ jobOrderId: { $exists: false } }, { jobOrderId: null }, { jobOrderId: '' }] },
      { $set: { jobOrderId } }, { new: true, runValidators: true }
    );
    if (!lockedOrder) {
      await Production.updateOne({ _id: created._id, materialOperationState: { $in: ['PREPARING', 'RESERVATION_PENDING'] } }, { $set: { phase3: false, status: 'Cancelled', materialOperationState: 'FAILED_RELEASED', materialRecoveryAction: 'NONE', materialOperationError: 'The order changed before assignment was committed.' }, $unset: { assignmentRequestId: 1 } });
      fail(409, 'The order changed or was already assigned. Refresh and try again.');
    }
    if (noManagedMaterials) {
      const assignedIntent = makeNotificationIntent({ eventKey: `job-assigned:${jobOrderId}:${created._id}:${account.id}`, recipientId: account.id, recipientRole: 'staff', type: 'job_assigned', title: 'New job assigned', message: `Job ${jobOrderId} for order ${orderId} was assigned to you.`, relatedOrderId: orderId, relatedJobId: jobOrderId, targetPage: 'staff' });
      created = await Production.findOneAndUpdate({ _id: created._id, materialOperationState: 'PREPARING' }, { $set: { materialOperationState: 'NOT_REQUIRED' }, $push: { notificationOutbox: assignedIntent } }, { new: true, runValidators: true });
      if (!created) fail(409, 'No-material job assignment needs Admin reconciliation.');
    }
    if (!noManagedMaterials) {
      const reservationJob = created;
      try {
        for (const material of reservationJob.reservedMaterials) {
          const item = await Inventory.findById(material.inventoryId).lean();
          if (!item) fail(404, `Inventory material ${material.inventoryId} no longer exists.`);
          await reserveMaterial({ ...material.toObject(), type: item.type }, reservationJob, req.user);
          const marked = await Production.updateOne({ _id: reservationJob._id, 'reservedMaterials.reservationId': material.reservationId }, { $set: { 'reservedMaterials.$.reservationStatus': 'reserved' } });
          if (!marked.modifiedCount) fail(409, 'A reservation was created but the job claim could not be confirmed; reconcile this job.');
        }
        created = await Production.findOneAndUpdate(
          { _id: reservationJob._id, materialOperationState: 'RESERVATION_PENDING' },
          { $set: { materialOperationState: 'RESERVED', materialOperationKind: '', materialOperationError: '' }, $push: { notificationOutbox: makeNotificationIntent({ eventKey: `job-assigned:${jobOrderId}:${reservationJob._id}:${account.id}`, recipientId: account.id, recipientRole: 'staff', type: 'job_assigned', title: 'New job assigned', message: `Job ${jobOrderId} for order ${orderId} was assigned to you.`, relatedOrderId: orderId, relatedJobId: jobOrderId, targetPage: 'staff' }) } }, { new: true, runValidators: true }
        );
        if (!created) fail(409, 'Job reservation state changed during assignment. Reconcile before proceeding.');
      } catch (error) {
        let recoveryFailed = false;
        for (const material of reservationJob.reservedMaterials) {
          try { await releaseMaterial(material.toObject?.() || material, reservationJob, req.user, 'Assignment reservation compensation.'); }
          catch { recoveryFailed = true; }
        }
        if (recoveryFailed) {
          await Production.updateOne({ _id: reservationJob._id }, { $set: { materialOperationState: 'RECONCILIATION_REQUIRED', materialRecoveryAction: 'RELEASE_RESERVATIONS', materialOperationError: 'Some tentative reservations could not be released. Admin reconciliation is required.' } });
          return res.status(503).json({ error: 'Assignment is blocked because tentative material reservations need Admin reconciliation.', jobOrderId });
        }
        await Production.updateOne({ _id: reservationJob._id }, { $set: { phase3: false, status: 'Cancelled', materialOperationState: 'FAILED_RELEASED', materialRecoveryAction: 'NONE', materialOperationError: error.message }, $unset: { assignmentRequestId: 1 } });
        await Order.updateOne({ _id: lockedOrder._id, jobOrderId }, { $unset: { jobOrderId: 1 } });
        throw error;
      }
    }
    await audit(req, 'ASSIGN_JOB', 'Production', jobOrderId, null, { orderId, assignedEmployee: account.id, priority: created.priority, materialOperationState: created.materialOperationState });
    await runNotificationBatch({ limit: 10 }).catch(() => {});
    res.status(201).json({ job: created });
  }));
  app.post('/api/job-orders/:id/reassign', requireAdmin, wrap(async (req, res) => {
    const jobOrderId = text(req.params.id, 80);
    const newAssignedEmployeeId = text(req.body?.newAssignedEmployeeId, 80);
    const reason = text(req.body?.reason, 1000);
    const requestId = text(req.body?.requestId, 80);
    const expectedAssignmentVersion = req.body?.expectedAssignmentVersion;
    if (!jobOrderId) fail(400, 'A job order ID is required.');
    if (!/^[a-f0-9-]{16,80}$/i.test(requestId)) fail(400, 'A stable reassignment request ID is required.');
    if (!/^[a-f0-9-]{36}$/i.test(newAssignedEmployeeId)) fail(400, 'Select a valid replacement Staff account.');
    if (!Number.isSafeInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 0) fail(400, 'A valid expected assignment version is required. Refresh the job and retry.');
    if (reason.length < 5) fail(400, 'Enter a reassignment reason of at least five characters.');

    let job = await Production.findOne({ phase3: true, jobOrderId });
    if (!job) fail(404, 'Job order not found.');
    const prior = job.assignmentHistory.find(entry => entry.requestId === requestId);
    if (prior) {
      if (prior.newAssignedEmployee !== newAssignedEmployeeId || prior.reason !== reason) fail(409, 'This reassignment request ID was already used for different details.');
      const notifications = await deliverReassignmentNotifications(jobOrderId, requestId);
      job = await Production.findOne({ _id: job._id }).lean();
      return res.json({ job: visibleJob(job, req.user), duplicate: true, notifications });
    }
    if (job.assignmentVersion !== expectedAssignmentVersion) fail(409, 'The assignment changed. Refresh the job before reassigning.');
    if (!REASSIGNABLE_JOB_STATUSES.includes(job.status)) fail(409, 'This job status cannot be reassigned.');
    if (!job.assignedEmployee) fail(409, 'This job has no current Staff assignment to transfer.');
    if (job.assignedEmployee === newAssignedEmployeeId) fail(409, 'Select a different Staff member.');

    const state = job.materialOperationState || null;
    if (job.materialPlanVersion === 1) {
      const allowedMaterialState = job.materialPlanMode === 'MATERIALS' ? 'RESERVED' : 'NOT_REQUIRED';
      if (state !== allowedMaterialState) fail(409, 'Material reservation, finalization, or reconciliation is incomplete; this job cannot be reassigned.');
    } else if (state !== null && !['RESERVED', 'NOT_REQUIRED'].includes(state)) {
      fail(409, 'Material reservation, finalization, or reconciliation is incomplete; this job cannot be reassigned.');
    }
    if ((job.reservedMaterials || []).some(row => ['pending', 'consumed'].includes(row.reservationStatus))) {
      fail(409, 'A material reservation is pending or consumed; this job cannot be reassigned.');
    }

    const replacement = await verifyAssignableStaff(newAssignedEmployeeId);
    const employee = await Employee.findOne({
      active: true, archived: { $ne: true },
      $or: [{ supabaseUserId: replacement.id }, { linkedUserId: replacement.id }],
      permissions: { $all: ['view_assigned_jobs', 'update_job_progress'] }
    }).lean();
    if (!employee) fail(400, 'The replacement must be linked to an active, unarchived employee with production permissions.');

    const now = new Date();
    const fromVersion = expectedAssignmentVersion;
    const toVersion = fromVersion + 1;
    const priorUsageExists = job.materialPlanVersion === 1 && job.materialPlanMode === 'MATERIALS'
      && Array.isArray(job.materialUsage) && job.materialUsage.length > 0;
    const history = {
      requestId, previousAssignedEmployee: job.assignedEmployee,
      previousAssignedEmployeeName: job.assignedEmployeeName || '',
      newAssignedEmployee: replacement.id, newAssignedEmployeeName: employee.name,
      reason, actorId: req.user.id, actorName: req.user.name || req.user.email || '',
      timestamp: now, fromVersion, toVersion,
      materialUsageSnapshot: priorUsageExists ? job.materialUsage : null,
      materialUsageSubmittedBy: priorUsageExists ? (job.materialUsageSubmittedBy || '') : '',
      materialUsageSubmittedAt: priorUsageExists ? (job.materialUsageSubmittedAt || null) : null
    };
    const notificationIntents = [
      { recipientKind: 'previous', recipientId: job.assignedEmployee, type: 'job_reassigned_from', title: 'Job reassigned', message: `Job ${jobOrderId} for order ${job.orderId} was reassigned to another Staff member.`, targetPage: 'staff' },
      { recipientKind: 'new', recipientId: replacement.id, type: 'job_reassigned_to', title: 'Job assigned to you', message: `Job ${jobOrderId} for order ${job.orderId} is now assigned to you.`, targetPage: 'staff' }
    ].map(item => ({
      ...item, requestId, recipientRole: 'staff', relatedOrderId: job.orderId, relatedJobId: jobOrderId,
      eventKey: `job-reassigned:${jobOrderId}:${requestId}:${item.recipientId}`,
      state: 'PENDING', attempts: 0, lastAttemptAt: null, nextAttemptAt: null, lockedUntil: null, lockToken: '', deliveryHistory: [], createdAt: now, deliveredAt: null, lastError: ''
    }));
    const versionPredicate = expectedAssignmentVersion === 0
      ? { $or: [{ assignmentVersion: 0 }, { assignmentVersion: { $exists: false } }] }
      : { assignmentVersion: expectedAssignmentVersion };
    const materialStatePredicate = state === null
      ? { $or: [{ materialOperationState: null }, { materialOperationState: { $exists: false } }] }
      : { materialOperationState: state };
    const updated = await Production.findOneAndUpdate({ $and: [
      { _id: job._id, phase3: true, assignedEmployee: job.assignedEmployee, status: { $in: REASSIGNABLE_JOB_STATUSES } },
      versionPredicate, materialStatePredicate, noActiveExceptionFilter,
      { $nor: [{ 'reservedMaterials.reservationStatus': 'pending' }, { 'reservedMaterials.reservationStatus': 'consumed' }] },
      { assignmentHistory: { $not: { $elemMatch: { requestId } } } }
    ] }, {
      $set: {
        assignedEmployee: replacement.id, assignedEmployeeName: employee.name,
        materialUsageReviewRequired: priorUsageExists,
        materialUsageReviewedBy: '', materialUsageReviewedAt: null
      },
      $inc: { assignmentVersion: 1 },
      $push: {
        assignmentHistory: history,
        productionHistory: { status: 'Reassigned', timestamp: now, notes: reason, performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' },
        reassignmentNotificationOutbox: { $each: notificationIntents }
      }
    }, { new: true, runValidators: true });
    if (!updated) {
      const raced = await Production.findOne({ _id: job._id }).lean();
      const racedRequest = raced?.assignmentHistory?.find(entry => entry.requestId === requestId);
      if (racedRequest?.newAssignedEmployee === newAssignedEmployeeId && racedRequest.reason === reason) {
        const notifications = await deliverReassignmentNotifications(jobOrderId, requestId);
        const current = await Production.findOne({ _id: job._id }).lean();
        return res.json({ job: visibleJob(current, req.user), duplicate: true, notifications });
      }
      fail(409, 'The job assignment or production state changed. Refresh and retry with the current assignment version.');
    }
    await audit(req, 'REASSIGN_JOB', 'Production', jobOrderId,
      { assignedEmployee: job.assignedEmployee, assignedEmployeeName: job.assignedEmployeeName || '', assignmentVersion: fromVersion },
      { assignedEmployee: replacement.id, assignedEmployeeName: employee.name, assignmentVersion: toVersion, reason, requestId });
    const notifications = await deliverReassignmentNotifications(jobOrderId, requestId);
    const current = await Production.findOne({ _id: updated._id }).lean();
    return res.json({ job: visibleJob(current, req.user), duplicate: false, notifications });
  }));
  app.post('/api/job-orders/:id/reassignment-notifications/retry', requireAdmin, wrap(async (req, res) => {
    const requestId = text(req.body?.requestId, 80);
    if (!/^[a-f0-9-]{16,80}$/i.test(requestId)) fail(400, 'A valid reassignment request ID is required.');
    const job = await Production.findOne({ phase3: true, jobOrderId: text(req.params.id, 80) }).lean();
    if (!job) fail(404, 'Job order not found.');
    if (!(job.assignmentHistory || []).some(entry => entry.requestId === requestId)) fail(404, 'Reassignment record not found.');
    const notifications = await deliverReassignmentNotifications(job.jobOrderId, requestId);
    const current = await Production.findOne({ _id: job._id }).lean();
    return res.json({ job: visibleJob(current, req.user), notifications });
  }));
  app.post('/api/job-orders/:id/materials', requireAdmin, wrap(async (req, res) => {
    const job = await Production.findOne({ phase3: true, jobOrderId: req.params.id, materialPlanVersion: 1, materialPlanMode: 'MATERIALS', materialOperationState: 'RESERVED', status: { $in: ['Assigned', 'Acknowledged', 'In Progress'] }, ...noActiveExceptionFilter });
    if (!job) fail(409, 'Additional materials require an active job with fully confirmed reservations.');
    const requestId = text(req.body?.requestId, 80);
    if (!/^[a-f0-9-]{16,80}$/i.test(requestId)) fail(400, 'A stable additional-material request ID is required.');
    const rows = materialsInput(req.body || {});
    const existingIds = new Set(job.reservedMaterials.map(row => String(row.inventoryId)));
    if (rows.some(row => existingIds.has(row.inventoryId))) fail(409, 'This material is already reserved for the job. Select a different material or use the recorded quantity.');
    const operationId = `${job.jobOrderId}:${requestId}`;
    const additions = [];
    for (const row of rows) {
      const item = await Inventory.findById(row.inventoryId).lean();
      if (!item) fail(404, `Inventory material ${row.inventoryId} no longer exists.`);
      additions.push({
        ...row, inventoryId: new mongoose.Types.ObjectId(row.inventoryId), material: item.material, unit: item.unit,
        operationId, reservationId: `${operationId}:${row.inventoryId}`, reservationStatus: 'pending'
      });
    }
    const staged = await Production.findOneAndUpdate({ _id: job._id, materialOperationState: 'RESERVED', status: job.status, ...noActiveExceptionFilter }, {
      $set: { materialOperationState: 'RESERVATION_PENDING', materialOperationKind: 'ADDITIONAL_RESERVATION', materialOperationId: operationId, materialRecoveryAction: '', materialOperationError: '' },
      $push: { reservedMaterials: { $each: additions } },
      $unset: { materialUsage: 1, materialUsageSubmittedAt: 1, materialUsageSubmittedBy: 1 }
    }, { new: true, runValidators: true });
    if (!staged) fail(409, 'Another Admin action changed this job. Refresh and retry.');
    try {
      for (const material of additions) {
        const item = await Inventory.findById(material.inventoryId).lean();
        if (!item) fail(404, `Inventory material ${material.inventoryId} no longer exists.`);
        await reserveMaterial({ ...material, type: item.type }, staged, req.user);
        await Production.updateOne({ _id: staged._id, 'reservedMaterials.reservationId': material.reservationId }, { $set: { 'reservedMaterials.$.material': item.material, 'reservedMaterials.$.unit': item.unit, 'reservedMaterials.$.reservationStatus': 'reserved' } });
      }
      const updated = await Production.findOneAndUpdate({ _id: staged._id, materialOperationState: 'RESERVATION_PENDING', materialOperationId: operationId }, {
        $set: { materialOperationState: 'RESERVED', materialOperationKind: '', materialRecoveryAction: '', materialOperationError: '' }
      }, { new: true, runValidators: true });
      if (!updated) fail(409, 'Additional materials were reserved but job confirmation needs reconciliation.');
      await audit(req, 'RESERVE_ADDITIONAL_MATERIALS', 'Production', job.jobOrderId, null, { operationId, materials: additions });
      return res.status(201).json({ job: updated });
    } catch (error) {
      let failedRelease = false;
      for (const material of additions) {
        try { await releaseMaterial(material, staged, req.user, 'Additional material reservation failed.'); }
        catch { failedRelease = true; }
      }
      if (failedRelease) {
        await Production.updateOne({ _id: staged._id }, { $set: { materialOperationState: 'RECONCILIATION_REQUIRED', materialRecoveryAction: 'RELEASE_RESERVATIONS', materialOperationError: 'Additional material reservation release needs Admin reconciliation.' } });
        return res.status(503).json({ error: 'Additional material reservation is incomplete; this job is blocked pending reconciliation.' });
      }
      await Production.updateOne({ _id: staged._id }, { $pull: { reservedMaterials: { operationId } }, $set: { materialOperationState: 'RESERVED', materialOperationKind: '', materialRecoveryAction: '', materialOperationError: error.message } });
      throw error;
    }
  }));
  app.post('/api/job-orders/:id/material-reconcile', requireAdmin, wrap(async (req, res) => {
    let job = await Production.findOne({ phase3: true, jobOrderId: req.params.id });
    if (!job) fail(404, 'Active job order not found.');
    if (job.materialOperationState === 'PREPARING' && job.materialPlanMode === 'NO_MANAGED_MATERIALS') {
      const order = await Order.findOne({ orderId: job.orderId });
      if (!order) fail(404, 'Parent order not found; assignment remains blocked.');
      if (order.jobOrderId !== job.jobOrderId) {
        if (order.jobOrderId || order.status !== 'Confirmed' || order.paymentStatus !== 'Verified') {
          await Production.updateOne({ _id: job._id }, { $set: { phase3: false, status: 'Cancelled', materialOperationState: 'FAILED_RELEASED', materialRecoveryAction: 'NONE', materialOperationError: 'Parent order is no longer eligible.' }, $unset: { assignmentRequestId: 1 } });
          fail(409, 'Parent order is no longer eligible; no materials were reserved and the assignment attempt was released.');
        }
        const locked = await Order.findOneAndUpdate({ _id: order._id, status: 'Confirmed', paymentStatus: 'Verified', $or: [{ jobOrderId: { $exists: false } }, { jobOrderId: null }, { jobOrderId: '' }] }, { $set: { jobOrderId: job.jobOrderId } });
        if (!locked) fail(409, 'Parent order changed during no-material assignment recovery. Retry Admin reconciliation.');
      }
      job = await Production.findOneAndUpdate({ _id: job._id, materialOperationState: 'PREPARING' }, { $set: { materialOperationState: 'NOT_REQUIRED', materialOperationError: '' } }, { new: true, runValidators: true });
      if (!job) fail(409, 'No-material assignment state changed during recovery.');
      await audit(req, 'RECONCILE_NO_MATERIAL_ASSIGNMENT', 'Production', job.jobOrderId, null, { reason: job.noMaterialsReason });
      return res.json({ job, recovered: true });
    }
    if (job.materialOperationState === 'CONSUMPTION_PENDING' && job.materialRecoveryAction === 'FINALIZE_USAGE') {
      job = await Production.findOneAndUpdate({ _id: job._id, materialOperationState: 'CONSUMPTION_PENDING', materialRecoveryAction: 'FINALIZE_USAGE' }, {
        $set: { materialOperationState: 'RECONCILIATION_REQUIRED', materialOperationError: 'Admin resumed an interrupted finalization.' }
      }, { new: true, runValidators: true });
      if (!job) fail(409, 'Material finalization state changed. Refresh and retry.');
    }
    if (job.materialOperationState === 'RECONCILIATION_REQUIRED' && job.materialRecoveryAction === 'FINALIZE_USAGE') {
      job = await Production.findOneAndUpdate({ _id: job._id, materialOperationState: 'RECONCILIATION_REQUIRED', materialRecoveryAction: 'FINALIZE_USAGE' }, {
        $set: { materialOperationState: 'CONSUMPTION_PENDING', materialOperationError: '' }
      }, { new: true, runValidators: true });
      if (!job) fail(409, 'Another Admin is already reconciling this material finalization.');
      try {
        job = await finalizeJobMaterials(job, req.user);
        const approved = await Production.findOneAndUpdate({ _id: job._id, status: 'Submitted for Review', materialOperationState: 'FINALIZED' }, {
          $set: { status: 'Approved', reviewedAt: new Date(), reviewedBy: req.user.id, reviewNotes: '' },
          $push: { productionHistory: { status: 'Approved', timestamp: new Date(), notes: 'Production and material accounting approved after reconciliation.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } }
        }, { new: true, runValidators: true });
        if (!approved) fail(409, 'Material finalization recovered. Refresh and complete production approval.');
        await audit(req, 'RECONCILE_MATERIAL_FINALIZATION', 'Production', job.jobOrderId, null, { status: 'FINALIZED', operationId: job.materialFinalizationOperationId });
        return res.json({ job: approved, recovered: true });
      } catch (error) {
        await Production.updateOne({ _id: job._id, materialOperationState: 'CONSUMPTION_PENDING' }, { $set: { materialOperationState: 'RECONCILIATION_REQUIRED', materialRecoveryAction: 'FINALIZE_USAGE', materialOperationError: text(error.message, 500) } });
        return res.status(503).json({ error: 'Material finalization remains incomplete. No fulfillment is allowed until retry succeeds.' });
      }
    }
    const pendingRows = job.reservedMaterials.filter(row => row.operationId === job.materialOperationId);
    if (job.materialOperationState === 'RESERVATION_PENDING' && pendingRows.length) {
      try {
        const parentOrder = await Order.findOne({ orderId: job.orderId });
        if (!parentOrder) fail(404, 'Parent order not found; assignment remains blocked.');
        if (parentOrder.jobOrderId !== job.jobOrderId) {
          if (parentOrder.jobOrderId || parentOrder.status !== 'Confirmed' || parentOrder.paymentStatus !== 'Verified') fail(409, 'Parent order is no longer eligible for this assignment.');
          const locked = await Order.findOneAndUpdate({ _id: parentOrder._id, status: 'Confirmed', paymentStatus: 'Verified', $or: [{ jobOrderId: { $exists: false } }, { jobOrderId: null }, { jobOrderId: '' }] }, { $set: { jobOrderId: job.jobOrderId } });
          if (!locked) fail(409, 'Parent order changed during reservation recovery.');
        }
        for (const material of pendingRows) {
          const item = await Inventory.findById(material.inventoryId).lean();
          if (!item) fail(404, `Inventory material ${material.inventoryId} no longer exists.`);
          await reconcileReservationMaterial({ ...material.toObject(), type: item.type }, job, req.user);
          await Production.updateOne({ _id: job._id, 'reservedMaterials.reservationId': material.reservationId }, { $set: { 'reservedMaterials.$.material': item.material, 'reservedMaterials.$.unit': item.unit, 'reservedMaterials.$.reservationStatus': 'reserved' } });
        }
        job = await Production.findOneAndUpdate({ _id: job._id, materialOperationState: 'RESERVATION_PENDING' }, { $set: { materialOperationState: 'RESERVED', materialOperationKind: '', materialRecoveryAction: '', materialOperationError: '' } }, { new: true, runValidators: true });
        await audit(req, 'RECONCILE_MATERIAL_RESERVATION', 'Production', job.jobOrderId, null, { operationId: job.materialOperationId, result: 'RESERVED' });
        return res.json({ job, recovered: true });
      } catch (error) {
        for (const material of pendingRows) {
          try { await releaseMaterial(material.toObject?.() || material, job, req.user, 'Reservation recovery could not complete.'); }
          catch {
            await Production.updateOne({ _id: job._id }, { $set: { materialOperationState: 'RECONCILIATION_REQUIRED', materialRecoveryAction: 'RELEASE_RESERVATIONS', materialOperationError: text(error.message, 500) } });
            return res.status(503).json({ error: 'Some reservation claims could not be safely released. Retry Admin reconciliation.' });
          }
        }
        if (job.materialOperationKind === 'ASSIGNMENT') {
          await Production.updateOne({ _id: job._id }, { $set: { phase3: false, status: 'Cancelled', materialOperationState: 'FAILED_RELEASED', materialOperationKind: '', materialRecoveryAction: 'NONE', materialOperationError: text(error.message, 500) }, $unset: { assignmentRequestId: 1 } });
          await Order.updateOne({ orderId: job.orderId, jobOrderId: job.jobOrderId }, { $unset: { jobOrderId: 1 } });
        } else {
          await Production.updateOne({ _id: job._id }, { $pull: { reservedMaterials: { operationId: job.materialOperationId } }, $set: { materialOperationState: 'RESERVED', materialOperationKind: '', materialRecoveryAction: '', materialOperationError: text(error.message, 500) } });
        }
        return res.status(409).json({ error: 'Reservation could not be completed; tentative claims were released. Correct availability and try again.' });
      }
    }
    if (job.materialOperationState === 'RECONCILIATION_REQUIRED' && job.materialRecoveryAction === 'RELEASE_RESERVATIONS') {
      const rows = job.reservedMaterials.filter(row => row.operationId === job.materialOperationId);
      for (const material of rows) await releaseMaterial(material.toObject?.() || material, job, req.user, 'Admin reconciliation release.');
      if (job.materialOperationKind === 'ASSIGNMENT') {
        await Production.updateOne({ _id: job._id }, { $set: { phase3: false, status: 'Cancelled', materialOperationState: 'FAILED_RELEASED', materialOperationKind: '', materialRecoveryAction: 'NONE' }, $unset: { assignmentRequestId: 1 } });
        await Order.updateOne({ orderId: job.orderId, jobOrderId: job.jobOrderId }, { $unset: { jobOrderId: 1 } });
      } else {
        await Production.updateOne({ _id: job._id }, { $pull: { reservedMaterials: { operationId: job.materialOperationId } }, $set: { materialOperationState: 'RESERVED', materialOperationKind: '', materialRecoveryAction: '', materialOperationError: '' } });
      }
      await audit(req, 'RECONCILE_MATERIAL_RELEASE', 'Production', job.jobOrderId, null, { operationId: job.materialOperationId });
      return res.json({ success: true, recovered: true });
    }
    fail(409, 'This job has no supported pending material operation to reconcile.');
  }));
  const jobsFilter = user => ({
    phase3: true,
    ...(user.role === 'admin' ? {} : {
      assignedEmployee: user.id,
      $or: [{ materialPlanVersion: null }, { materialOperationState: { $in: ['RESERVED', 'FINALIZED', 'NOT_REQUIRED'] } }]
    })
  });
  app.get('/api/job-orders', requireOrderStaff, requireEmployeePermission('view_assigned_jobs'), wrap(async (req, res) => {
    const jobs = await Production.find(jobsFilter(req.user)).sort({ dateAssigned: -1 }).lean();
    const orders = await Order.find({ orderId: { $in: jobs.map(j => j.orderId) } });
    const byId = new Map(orders.map(o => [o.orderId, serializeOrder(o)]));
    res.json({ jobs: jobs.map(job => ({ ...visibleJob(job, req.user), order: byId.get(job.orderId) || null })) });
  }));
  app.get('/api/job-orders/:id', requireOrderStaff, requireEmployeePermission('view_assigned_jobs'), wrap(async (req, res) => {
    const job = await Production.findOne({ ...jobsFilter(req.user), jobOrderId: req.params.id }).lean();
    if (!job) fail(404, 'Job order not found.');
    const order = await Order.findOne({ orderId: job.orderId });
    res.json({ job: { ...visibleJob(job, req.user), order: order ? serializeOrder(order) : null } });
  }));

  app.post('/api/job-orders/:id/exceptions', requireOrderStaff, requireEmployeePermission('update_job_progress'), wrap(async (req, res) => {
    const jobOrderId = text(req.params.id, 80), type = text(req.body?.type, 20).toUpperCase();
    const reason = text(req.body?.reason, 1000), notes = text(req.body?.notes, 2000), requestId = text(req.body?.requestId, 80);
    const expectedAssignmentVersion = req.body?.expectedAssignmentVersion;
    if (!EXCEPTION_TYPES.includes(type)) fail(400, 'Choose a valid exception type.');
    if (reason.length < 3) fail(400, 'Enter a reason of at least three characters.');
    if (!/^[a-f0-9-]{16,80}$/i.test(requestId)) fail(400, 'A stable exception request ID is required.');
    if (!Number.isSafeInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 0) fail(400, 'Refresh the job and provide its assignment version.');
    const job = await Production.findOne({ ...jobsFilter(req.user), phase3: true, jobOrderId });
    if (!job) fail(404, 'Job order not found.');
    const prior = (job.exceptionHistory || []).find(item => item.requestId === requestId);
    if (prior) {
      if (prior.reportedBy !== req.user.id || prior.type !== type || prior.reason !== reason || prior.notes !== notes) fail(409, 'This request ID was already used for different exception details.');
      const notifications = await deliverExceptionNotifications(jobOrderId, prior.exceptionId);
      const current = await Production.findById(job._id).lean();
      return res.json({ job: visibleJob(current, req.user), exception: prior, duplicate: true, notifications });
    }
    if (job.assignmentVersion !== expectedAssignmentVersion) fail(409, 'The job assignment changed. Refresh and retry.');
    if (!EXCEPTION_REPORT_STATUSES.includes(job.status)) fail(409, 'This job is not in a state that can accept a production exception.');
    if (hasActiveException(job)) fail(409, 'This job already has an unresolved production exception.');
    const exceptionId = randomUUID(), reportedAt = new Date();
    const entry = { exceptionId, requestId, type, reason, notes, previousStatus: job.status, reportedBy: req.user.id,
      reportedByName: req.user.name || req.user.email || '', reportedByRole: req.user.role, reportedAt, resolutionStatus: 'ACTIVE' };
    const intents = [{ ...makeNotificationIntent({ exceptionId, recipientId: '*', recipientRole: 'admin', type: 'production_exception_reported',
      title: 'Production issue reported', message: `Job ${jobOrderId} has an unresolved ${type.toLowerCase()} exception.`,
      relatedOrderId: job.orderId, relatedJobId: jobOrderId, targetPage: 'admin', eventKey: `job-exception-reported:${jobOrderId}:${exceptionId}`, createdAt: reportedAt }), exceptionId }];
    const versionFilter = expectedAssignmentVersion === 0
      ? { $or: [{ assignmentVersion: 0 }, { assignmentVersion: { $exists: false } }] }
      : { assignmentVersion: expectedAssignmentVersion };
    const assignedFilter = req.user.role === 'admin' ? {} : { assignedEmployee: req.user.id };
    const updated = await Production.findOneAndUpdate({ $and: [
      { _id: job._id, phase3: true, status: { $in: EXCEPTION_REPORT_STATUSES }, ...assignedFilter }, versionFilter, noActiveExceptionFilter, stableExceptionMaterialFilter,
      { exceptionHistory: { $not: { $elemMatch: { requestId } } } }
    ] }, { $push: { exceptionHistory: entry, exceptionNotificationOutbox: { $each: intents } } }, { new: true, runValidators: true });
    if (!updated) fail(409, 'The job changed or another exception was reported. Refresh before retrying.');
    await audit(req, 'REPORT_PRODUCTION_EXCEPTION', 'Production', jobOrderId, null, entry);
    const notifications = await deliverExceptionNotifications(jobOrderId, exceptionId);
    const current = await Production.findById(job._id).lean();
    res.status(201).json({ job: visibleJob(current, req.user), exception: entry, duplicate: false, notifications });
  }));

  app.patch('/api/job-orders/:id/exceptions/:exceptionId/resolve', requireAdmin, wrap(async (req, res) => {
    const jobOrderId = text(req.params.id, 80), exceptionId = text(req.params.exceptionId, 80);
    const action = text(req.body?.action, 40).toUpperCase(), notes = text(req.body?.notes, 2000);
    const expectedAssignmentVersion = req.body?.expectedAssignmentVersion, expectedStatus = text(req.body?.expectedStatus, 40);
    if (!['RESUME', 'RETURN_FOR_CORRECTION'].includes(action)) fail(400, 'Choose a supported resolution action.');
    if (notes.length < 3) fail(400, 'Resolution notes are required.');
    if (!Number.isSafeInteger(expectedAssignmentVersion) || expectedAssignmentVersion < 0 || !expectedStatus) fail(400, 'Refresh the job and provide its current version and status.');
    const job = await Production.findOne({ phase3: true, jobOrderId });
    if (!job) fail(404, 'Job order not found.');
    const exception = (job.exceptionHistory || []).find(item => item.exceptionId === exceptionId);
    if (!exception || exception.resolutionStatus !== 'ACTIVE') fail(409, 'This exception is already resolved or no longer active.');
    if (exception.type === 'FAILED' && action !== 'RETURN_FOR_CORRECTION') fail(409, 'Failed jobs must be returned for correction before work can resume.');
    if (job.assignmentVersion !== expectedAssignmentVersion || job.status !== expectedStatus) fail(409, 'The job changed. Refresh and review the exception again.');
    const timestamp = new Date(), nextStatus = action === 'RETURN_FOR_CORRECTION' ? 'Correction Required' : job.status;
    const resolution = { resolutionStatus: 'RESOLVED', resolvedBy: req.user.id, resolvedByName: req.user.name || req.user.email || '',
      resolutionAction: action, resolutionNotes: notes, resolvedAt: timestamp, resolvedFromStatus: job.status, resolvedToStatus: nextStatus };
    const notificationIntent = job.assignedEmployee ? [{ ...makeNotificationIntent({ exceptionId, recipientId: job.assignedEmployee, recipientRole: 'staff',
      type: 'production_exception_resolved', title: 'Production issue resolved', message: `Admin resolved the exception for job ${jobOrderId}.`, targetPage: 'staff',
      relatedOrderId: job.orderId, relatedJobId: jobOrderId, eventKey: `job-exception-resolved:${jobOrderId}:${exceptionId}:${job.assignedEmployee}`, createdAt: timestamp }), exceptionId }] : [];
    const assignmentVersionFilter = expectedAssignmentVersion === 0
      ? { $or: [{ assignmentVersion: 0 }, { assignmentVersion: { $exists: false } }] }
      : { assignmentVersion: expectedAssignmentVersion };
    const query = { $and: [
      { _id: job._id, phase3: true, status: expectedStatus,
        exceptionHistory: { $elemMatch: { exceptionId, resolutionStatus: 'ACTIVE' } } }, assignmentVersionFilter
    ] };
    const update = { $set: { 'exceptionHistory.$.resolutionStatus': resolution.resolutionStatus, 'exceptionHistory.$.resolvedBy': resolution.resolvedBy,
      'exceptionHistory.$.resolvedByName': resolution.resolvedByName, 'exceptionHistory.$.resolutionAction': action,
      'exceptionHistory.$.resolutionNotes': notes, 'exceptionHistory.$.resolvedAt': timestamp,
      'exceptionHistory.$.resolvedFromStatus': job.status, 'exceptionHistory.$.resolvedToStatus': nextStatus } };
    if (nextStatus !== job.status) {
      update.$set.status = nextStatus;
      update.$set.reviewNotes = notes;
      update.$push = { productionHistory: { status: nextStatus, timestamp, notes: `Exception ${exceptionId} resolved: ${notes}`, performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } };
    }
    if (notificationIntent.length) update.$push = { ...(update.$push || {}), exceptionNotificationOutbox: { $each: notificationIntent } };
    const updated = await Production.findOneAndUpdate(query, update, { new: true, runValidators: true });
    if (!updated) fail(409, 'The exception was resolved concurrently or the job changed. Refresh before retrying.');
    await audit(req, 'RESOLVE_PRODUCTION_EXCEPTION', 'Production', jobOrderId, { exceptionId, status: job.status }, { ...resolution, status: nextStatus });
    const notifications = await deliverExceptionNotifications(jobOrderId, exceptionId);
    const current = await Production.findById(job._id).lean();
    res.json({ job: visibleJob(current, req.user), exception: current.exceptionHistory.find(item => item.exceptionId === exceptionId), notifications });
  }));

  const nextJobStatus = {
    Assigned: 'Acknowledged', Queueing: 'Acknowledged', Acknowledged: 'In Progress',
    'Correction Required': 'In Progress', 'In Progress': 'Submitted for Review'
  };
  app.put('/api/job-orders/:id/material-usage', requireOrderStaff, requireEmployeePermission('update_job_progress'), wrap(async (req, res) => {
    const job = await Production.findOne({ ...jobsFilter(req.user), jobOrderId: req.params.id, status: 'In Progress', materialPlanVersion: 1, materialPlanMode: 'MATERIALS', materialOperationState: 'RESERVED', ...noActiveExceptionFilter });
    if (!job) fail(409, 'Only an assigned active job with confirmed material reservations can submit material usage.');
    const usage = materialUsageInput(job, req.body?.materials);
    if (job.materialUsageReviewRequired && req.body?.reviewPreviousUsage !== true) {
      fail(409, 'Review the previous Staff member’s saved material usage before submitting your update.');
    }
    const timestamp = new Date();
    const updated = await Production.findOneAndUpdate(
      { _id: job._id, assignedEmployee: req.user.id, assignmentVersion: job.assignmentVersion, status: 'In Progress', materialOperationState: 'RESERVED', materialUsageReviewRequired: job.materialUsageReviewRequired, ...noActiveExceptionFilter },
      { $set: {
        materialUsage: usage, materialUsageSubmittedAt: timestamp, materialUsageSubmittedBy: req.user.id,
        materialUsageSubmittedAssignmentVersion: job.assignmentVersion, materialUsageReviewRequired: false,
        materialUsageReviewedBy: job.materialUsageReviewRequired ? req.user.id : job.materialUsageReviewedBy,
        materialUsageReviewedAt: job.materialUsageReviewRequired ? timestamp : job.materialUsageReviewedAt
      } },
      { new: true, runValidators: true }
    );
    if (!updated) fail(409, 'This job changed while usage was being submitted. Refresh and retry.');
    await audit(req, 'SUBMIT_MATERIAL_USAGE', 'Production', job.jobOrderId, null, { usage, timestamp });
    res.json({ job: updated });
  }));
  app.patch('/api/job-orders/:id/status', requireOrderStaff, requireEmployeePermission('update_job_progress'), wrap(async (req, res) => {
    const expectedStatus = text(req.body?.expectedStatus, 40);
    const status = text(req.body?.status, 40);
    if (!nextJobStatus[expectedStatus] || nextJobStatus[expectedStatus] !== status) {
      fail(400, 'Invalid Job Order status transition.');
    }
    if (status === 'Submitted for Review') {
      const current = await Production.findOne({ ...jobsFilter(req.user), jobOrderId: req.params.id, status: expectedStatus });
      if (current?.materialPlanVersion === 1 && current.materialPlanMode === 'MATERIALS' &&
          (current.materialOperationState !== 'RESERVED' || current.materialUsageReviewRequired || !current.materialUsageSubmittedAt || !Array.isArray(current.materialUsage) || current.materialUsage.length !== current.reservedMaterials.length)) {
        fail(409, 'Submit reconciled material usage before completing this job.');
      }
    }

    const timestamp = new Date();
    const fields = { status };
    if (status === 'Acknowledged') { fields.acknowledgedAt = timestamp; fields.acknowledgedBy = req.user.id; }
    if (status === 'In Progress') { fields.productionStartedAt = timestamp; fields.productionStartedBy = req.user.id; }
    if (status === 'Submitted for Review') { fields.productionCompletedAt = timestamp; fields.productionCompletedBy = req.user.id; fields.submittedForReviewAt = timestamp; }
    const reviewIntent = status === 'Submitted for Review' ? makeNotificationIntent({
      eventKey: `job-review:${req.params.id}:${timestamp.toISOString()}`, recipientId: '*', recipientRole: 'admin',
      type: 'job_review_required', title: 'Job ready for review', message: `Job ${req.params.id} was submitted for administrative review.`,
      relatedOrderId: (await Production.findOne({ ...jobsFilter(req.user), jobOrderId: req.params.id }).select('orderId').lean())?.orderId || '', relatedJobId: req.params.id, targetPage: 'admin', createdAt: timestamp
    }) : null;
    const statusUpdate = { $set: fields, $push: { productionHistory: { status, timestamp, notes: `Job Order moved to ${status}.`, performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } } };
    if (reviewIntent) statusUpdate.$push.notificationOutbox = reviewIntent;
    const updatedJob = await Production.findOneAndUpdate(
      { ...jobsFilter(req.user), jobOrderId: req.params.id, status: expectedStatus, ...noActiveExceptionFilter },
      statusUpdate,
      { new: true, runValidators: true }
    );
    if (!updatedJob) fail(409, 'This Job Order changed or is not assigned to you. Refresh and try again.');
    if (status === 'In Progress') await Order.updateOne({ orderId: updatedJob.orderId, jobOrderId: updatedJob.jobOrderId, status: 'Confirmed' }, { $set: { status: 'Processing' } });
    await audit(req, status === 'Submitted for Review' ? 'SUBMIT_JOB_FOR_REVIEW' : 'UPDATE_JOB_STATUS', 'Production', updatedJob.jobOrderId, { status: expectedStatus }, { status });
    if (reviewIntent) await runNotificationBatch({ limit: 10 }).catch(() => {});

    const order = await Order.findOne({ orderId: updatedJob.orderId });
    res.json({ job: { ...updatedJob.toObject(), order: order ? serializeOrder(order) : null } });
  }));

  app.post('/api/job-orders/:id/review', requireAdmin, wrap(async (req, res) => {
    const action = text(req.body?.action, 20), notes = text(req.body?.notes, 2000);
    if (!['approve', 'return'].includes(action)) fail(400, 'Choose approve or return.');
    if (action === 'return' && !notes) fail(400, 'Correction instructions are required.');
    if (action === 'approve') {
      let current = await Production.findOne({ phase3: true, jobOrderId: req.params.id, status: 'Submitted for Review', ...noActiveExceptionFilter });
      if (current?.materialPlanVersion === 1 && current.materialPlanMode === 'MATERIALS') {
        if (current.materialOperationState === 'RESERVED') {
          if (current.materialUsageReviewRequired || !current.materialUsageSubmittedAt || !Array.isArray(current.materialUsage) || current.materialUsage.length !== current.reservedMaterials.length) fail(409, 'Current assigned Staff must review and submit material usage before production approval.');
          materialUsageInput(current, current.materialUsage);
          current = await Production.findOneAndUpdate({ _id: current._id, status: 'Submitted for Review', materialOperationState: 'RESERVED', ...noActiveExceptionFilter }, {
            $set: { materialOperationState: 'CONSUMPTION_PENDING', materialRecoveryAction: 'FINALIZE_USAGE', materialFinalizationOperationId: `${current.jobOrderId}:material-finalization`, materialOperationError: '' }
          }, { new: true, runValidators: true });
          if (!current) fail(409, 'Another Admin changed this job. Refresh before approving.');
        } else if (current.materialOperationState === 'RECONCILIATION_REQUIRED' && current.materialRecoveryAction === 'FINALIZE_USAGE') {
          current = await Production.findOneAndUpdate({ _id: current._id, status: 'Submitted for Review', materialOperationState: 'RECONCILIATION_REQUIRED', materialRecoveryAction: 'FINALIZE_USAGE', ...noActiveExceptionFilter }, {
            $set: { materialOperationState: 'CONSUMPTION_PENDING', materialOperationError: '' }
          }, { new: true, runValidators: true });
          if (!current) fail(409, 'Another Admin is already reconciling this job. Refresh before retrying.');
        } else if (current.materialOperationState === 'CONSUMPTION_PENDING') {
          fail(409, 'Material finalization is already running or needs the Admin reconciliation action.');
        } else if (current.materialOperationState !== 'FINALIZED') {
          fail(409, 'Material reservations are not confirmed; production approval is blocked.');
        }

        if (current.materialOperationState === 'CONSUMPTION_PENDING') {
          try { current = await finalizeJobMaterials(current, req.user); }
          catch (error) {
            await Production.updateOne({ _id: current._id, materialOperationState: 'CONSUMPTION_PENDING' }, {
              $set: { materialOperationState: 'RECONCILIATION_REQUIRED', materialRecoveryAction: 'FINALIZE_USAGE', materialOperationError: text(error.message, 500) }
            });
            return res.status(503).json({ error: 'Material finalization is incomplete. Fulfillment remains blocked until Admin reconciliation succeeds.' });
          }
        }
        const timestamp = new Date();
        const approved = await Production.findOneAndUpdate({ _id: current._id, status: 'Submitted for Review', materialOperationState: 'FINALIZED', ...noActiveExceptionFilter }, {
          $set: { status: 'Approved', reviewedAt: timestamp, reviewedBy: req.user.id, reviewNotes: '' },
          $push: { productionHistory: { status: 'Approved', timestamp, notes: 'Production and material accounting approved.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } }
        }, { new: true, runValidators: true });
        if (!approved) fail(409, 'Materials are finalized, but production approval state changed. Refresh and review again.');
        await audit(req, 'APPROVE_COMPLETED_JOB', 'Production', approved.jobOrderId, { status: 'Submitted for Review' }, { status: 'Approved', materialOperationState: 'FINALIZED' });
        return res.json({ job: approved });
      }
    }
    const status = action === 'approve' ? 'Approved' : 'Correction Required', timestamp = new Date();
    const existingJob = await Production.findOne({ phase3: true, jobOrderId: req.params.id, status: 'Submitted for Review', ...noActiveExceptionFilter });
    if (!existingJob) fail(409, 'This job is not awaiting admin review.');
    const correctionIntent = action === 'return' && existingJob.assignedEmployee ? makeNotificationIntent({
      eventKey: `job-correction:${existingJob.jobOrderId}:${timestamp.toISOString()}`, recipientId: existingJob.assignedEmployee, recipientRole: 'staff',
      type: 'job_correction_required', title: 'Job returned for correction', message: `Job ${existingJob.jobOrderId} requires correction. Open the job for Admin instructions.`,
      relatedOrderId: existingJob.orderId, relatedJobId: existingJob.jobOrderId, targetPage: 'staff', createdAt: timestamp
    }) : null;
    const reviewUpdate = { $set: { status, reviewedAt: timestamp, reviewedBy: req.user.id, reviewNotes: notes }, $push: { productionHistory: { status, timestamp, notes: notes || 'Completed work approved.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } } };
    if (correctionIntent) reviewUpdate.$push.notificationOutbox = correctionIntent;
    const job = await Production.findOneAndUpdate(
      { phase3: true, jobOrderId: req.params.id, status: 'Submitted for Review', ...noActiveExceptionFilter },
      reviewUpdate,
      { new: true, runValidators: true }
    );
    if (!job) fail(409, 'This job is not awaiting admin review.');
    await audit(req, action === 'approve' ? 'APPROVE_COMPLETED_JOB' : 'RETURN_JOB_FOR_CORRECTION', 'Production', job.jobOrderId, { status: 'Submitted for Review' }, { status, notes });
    if (correctionIntent) await runNotificationBatch({ limit: 10 }).catch(() => {});
    res.json({ job });
  }));

  app.post('/api/job-orders/:id/ready-for-pickup', requireAdmin, wrap(async (req, res) => {
    const timestamp = new Date();
    const job = await Production.findOne({ phase3: true, jobOrderId: req.params.id, status: 'Approved', ...noActiveExceptionFilter });
    if (!job) fail(409, 'Only an approved completed job can be marked ready for pickup.');
    if (job.materialPlanVersion === 1 && !['FINALIZED', 'NOT_REQUIRED'].includes(job.materialOperationState)) fail(409, 'Material accounting is not finalized; fulfillment remains blocked.');
    const updatedJob = await Production.findOneAndUpdate(
      { _id: job._id, status: 'Approved', ...noActiveExceptionFilter },
      { $set: { status: 'Ready for Pickup', readyForPickupAt: timestamp, readyForPickupBy: req.user.id }, $push: { productionHistory: { status: 'Ready for Pickup', timestamp, notes: 'Admin marked the approved order ready for pickup.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } } },
      { new: true, runValidators: true }
    );
    if (!updatedJob) fail(409, 'The job changed. Refresh and try again.');
    const customer = await Order.findOne({ orderId: job.orderId }).select('customerId').lean();
    const notification = customer?.customerId ? makeNotificationIntent({ eventKey: `ready-for-pickup:${job.orderId}`, recipientId: customer.customerId, recipientRole: 'customer', type: 'ready_for_pickup', title: 'Order ready for pickup', message: `Order ${job.orderId} is ready for pickup.`, relatedOrderId: job.orderId, relatedJobId: job.jobOrderId, targetPage: 'myorders', createdAt: timestamp }) : null;
    const orderUpdate = { $set: { status: 'Ready for Pickup' } };
    if (notification) orderUpdate.$push = { notificationOutbox: notification };
    const order = await Order.findOneAndUpdate(
      { orderId: job.orderId, jobOrderId: job.jobOrderId, status: 'Processing', paymentStatus: 'Verified' },
      orderUpdate, { new: true, runValidators: true }
    );
    if (!order) {
      await Production.updateOne({ _id: updatedJob._id, status: 'Ready for Pickup' }, { $set: { status: 'Approved', readyForPickupAt: null, readyForPickupBy: '' } });
      fail(409, 'The parent order is not eligible or its payment is not verified.');
    }
    await audit(req, 'MARK_READY_FOR_PICKUP', 'Order', order.orderId, { status: 'Processing' }, { status: 'Ready for Pickup' });
    if (notification) await runNotificationBatch({ limit: 10 }).catch(() => {});
    res.json({ job: updatedJob, order: serializeOrder(order) });
  }));

  // ─── PHASE 5: PICKUP CONFIRMATION & FINAL INVENTORY DEDUCTION ─────────

  app.get('/api/pickup/orders', requireOrderStaff, wrap(async (req, res) => {
    const jobOrders = await Production.find({ ...jobsFilter(req.user), status: 'Ready for Pickup', ...noActiveExceptionFilter }).lean();
    const orders = await Order.find({ orderId: { $in: jobOrders.map(job => job.orderId) }, status: 'Ready for Pickup', paymentStatus: 'Verified' }).sort({ createdAt: -1 }).lean();
    const jobByOrder = new Map(jobOrders.map(j => [j.orderId, j]));
    res.json({
      orders: orders.map(o => ({
        ...serializeOrder(o),
        jobOrderId: jobByOrder.get(o.orderId)?.jobOrderId || null,
        assignedEmployeeName: jobByOrder.get(o.orderId)?.assignedEmployeeName || '',
        readyForPickupAt: jobByOrder.get(o.orderId)?.readyForPickupAt || null
      }))
    });
  }));

  app.get('/api/orders/:orderId/pickup-details', requireOrderStaff, wrap(async (req, res) => {
    const orderId = text(req.params.orderId, 50).toUpperCase();
    const job = await Production.findOne({ ...jobsFilter(req.user), orderId }).lean();
    if (!job) fail(404, 'Job order not found.');
    if (hasActiveException(job)) fail(409, 'Pickup details are unavailable while a production exception remains unresolved.');
    const order = await Order.findOne({ orderId }).lean();
    if (!order) fail(404, 'Order not found.');
    if (order.status !== 'Ready for Pickup') fail(409, 'Order is not ready for pickup.');
    if (order.paymentStatus !== 'Verified') fail(409, 'Pickup cannot be confirmed until payment is verified.');

    if (job.status !== 'Ready for Pickup') fail(409, 'The approved job is not ready for pickup.');

    const reservedMaterials = [];
    for (const material of job.reservedMaterials || []) {
      const item = await Inventory.findById(material.inventoryId).lean();
      reservedMaterials.push({
        inventoryId: material.inventoryId,
        material: material.material,
        unit: material.unit,
        quantity: material.quantity,
        reservationStatus: material.reservationStatus || 'reserved',
        currentOnHand: item?.quantity || 0,
        currentReserved: item?.reservedQuantity || 0
      });
    }

    res.json({
      order: serializeOrder(order),
      job: {
        jobOrderId: job.jobOrderId,
        status: job.status,
        assignedEmployeeName: job.assignedEmployeeName,
        assignedEmployee: job.assignedEmployee,
        dateAssigned: job.dateAssigned,
        productionStartedAt: job.productionStartedAt,
        productionCompletedAt: job.productionCompletedAt,
        readyForPickupAt: job.readyForPickupAt,
        reservedMaterials
      }
    });
  }));

  app.post('/api/orders/:orderId/confirm-pickup', requireOrderStaff, wrap(async (req, res) => {
    const orderId = text(req.params.orderId, 50).toUpperCase();
    const receivedByName = text(req.body?.receivedByName, 100);

    const pickupJob = await Production.findOne({ ...jobsFilter(req.user), orderId }).lean();
    if (!pickupJob) fail(404, 'Job order not found.');
    if (hasActiveException(pickupJob)) fail(409, 'Pickup is blocked while a production exception remains unresolved.');
    const pickupOrder = await Order.findOne({ orderId }).lean();
    if (!pickupOrder || pickupOrder.status !== 'Ready for Pickup') fail(409, 'Order is not ready for pickup or has already been picked up.');
    if (pickupOrder.paymentStatus !== 'Verified') fail(409, 'Pickup cannot be confirmed until payment is verified.');
    if (pickupJob.status !== 'Ready for Pickup') fail(409, 'The approved job is not ready for pickup.');
    if (receivedByName.length < 2) fail(400, 'Received By name is required and must contain at least 2 characters.');
    if (pickupJob.materialPlanVersion === 1 && !['FINALIZED', 'NOT_REQUIRED'].includes(pickupJob.materialOperationState)) fail(409, 'Material accounting is not finalized; pickup is blocked.');
    if (pickupJob.materialPlanVersion === 1 || !pickupJob.reservedMaterials?.length) {
      const pickedUpAt = new Date();
      const pickupIntent = pickupOrder.customerId ? makeNotificationIntent({ eventKey: `pickup-confirmed:${orderId}`, recipientId: pickupOrder.customerId, recipientRole: 'customer', type: 'order_picked_up', title: 'Pickup confirmed', message: `Pickup for order ${orderId} was confirmed.`, relatedOrderId: orderId, relatedJobId: pickupJob.jobOrderId, targetPage: 'myorders', createdAt: pickedUpAt }) : null;
      const pickupUpdate = { $set: { status: 'Picked Up', pickedUpAt, releasedBy: req.user.id, releasedByName: req.user.name || req.user.email || '', receivedByName } };
      if (pickupIntent) pickupUpdate.$push = { notificationOutbox: pickupIntent };
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: pickupOrder._id, status: 'Ready for Pickup', paymentStatus: 'Verified' },
        pickupUpdate,
        { new: true, runValidators: true }
      );
      if (!updatedOrder) fail(409, 'Order changed during pickup. Refresh and try again.');
      await audit(req, 'CONFIRM_PICKUP', 'Order', orderId, { status: 'Ready for Pickup' }, { status: 'Picked Up', pickedUpAt });
      if (pickupIntent) await runNotificationBatch({ limit: 10 }).catch(() => {});
      return res.json({ success: true, order: serializeOrder(updatedOrder), pickedUpAt, releasedByName: updatedOrder.releasedByName, receivedByName, movements: [] });
    }

    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') fail(503, 'Pickup confirmation requires a MongoDB replica set with transactions. Ask the administrator to complete database setup.');

    await StockMovement.init();
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const order = await Order.findOne({ orderId, status: 'Ready for Pickup' }).session(session);
        if (!order) fail(409, 'Order is not ready for pickup or has already been picked up.');
        if (!order.jobOrderId) fail(409, 'Order does not have a job order.');

        const job = await Production.findOne({ ...jobsFilter(req.user), orderId, ...noActiveExceptionFilter }).session(session);
        if (!job) fail(404, 'Job order not found.');
        if (order.paymentStatus !== 'Verified') fail(409, 'Pickup cannot be confirmed until payment is verified.');
        if (job.status !== 'Ready for Pickup') fail(409, 'The approved job is not ready for pickup.');

        const alreadyConsumed = job.reservedMaterials.some(m => m.reservationStatus === 'consumed');
        if (alreadyConsumed) fail(409, 'Inventory has already been deducted for this order.');

        const movements = [];
        for (const material of [...job.reservedMaterials].sort((a, b) => String(a.inventoryId).localeCompare(String(b.inventoryId)))) {
          const item = await Inventory.findOneAndUpdate(
            {
              _id: material.inventoryId,
              $expr: { $gte: ['$quantity', material.quantity] }
            },
            [{
              $set: {
                quantity: { $round: [{ $subtract: ['$quantity', material.quantity] }, 3] },
                reservedQuantity: { $round: [{ $subtract: [{ $ifNull: ['$reservedQuantity', 0] }, material.quantity] }, 3] },
                updatedAt: '$$NOW'
              }
            }],
            { new: true, session }
          );
          if (!item) fail(409, `INSUFFICIENT STOCK: ${material.material} changed. Refresh and try again.`);

          await Production.updateOne(
            { _id: job._id, 'reservedMaterials._id': material._id },
            { $set: {
              'reservedMaterials.$.reservationStatus': 'consumed',
              'reservedMaterials.$.unitCostSnapshot': item.costBasisKnown ? item.costPerUnit : null,
              'reservedMaterials.$.directCostCents': item.costBasisKnown ? Math.round(material.quantity * item.costPerUnit * 100) : null,
              'reservedMaterials.$.costDataComplete': item.costBasisKnown === true
            } },
            { session }
          );

          const costDataComplete = item.costBasisKnown === true;
          movements.push({
            orderId: order.orderId,
            jobOrderId: job.jobOrderId,
            inventoryId: item._id,
            material: item.material,
            materialType: item.type,
            unit: item.unit,
            quantity: material.quantity,
            movementType: 'OUT',
            reason: 'ORDER_PICKUP',
            unitCostSnapshot: costDataComplete ? item.costPerUnit : null,
            directCostCents: costDataComplete ? Math.round(material.quantity * item.costPerUnit * 100) : null,
            costDataComplete,
            performedBy: req.user.id,
            performedByName: req.user.name || req.user.email || '',
            receivedByName
          });
        }

        await StockMovement.create(movements, { session });

        const pickedUpAt = new Date();
        const pickupIntent = order.customerId ? makeNotificationIntent({ eventKey: `pickup-confirmed:${orderId}`, recipientId: order.customerId, recipientRole: 'customer', type: 'order_picked_up', title: 'Pickup confirmed', message: `Pickup for order ${orderId} was confirmed.`, relatedOrderId: orderId, relatedJobId: job.jobOrderId, targetPage: 'myorders', createdAt: pickedUpAt }) : null;
        const orderUpdate = {
          $set: { status: 'Picked Up', pickedUpAt, releasedBy: req.user.id, releasedByName: req.user.name || req.user.email || '', receivedByName },
          ...(pickupIntent ? { $push: { notificationOutbox: pickupIntent } } : {})
        };
        const updatedOrder = await Order.findOneAndUpdate(
          { _id: order._id, status: 'Ready for Pickup' },
          orderUpdate,
          { new: true, runValidators: true, session }
        );
        if (!updatedOrder) fail(409, 'Order changed during pickup. Refresh and try again.');

        result = { order: updatedOrder, movements };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally {
      await session.endSession();
    }

    await audit(req, 'CONFIRM_PICKUP', 'Order', orderId, { status: 'Ready for Pickup' }, { status: 'Picked Up', pickedUpAt: result.order.pickedUpAt });
    if (result.order.customerId) await runNotificationBatch({ limit: 10 }).catch(() => {});
    res.json({
      success: true,
      order: serializeOrder(result.order),
      pickedUpAt: result.order.pickedUpAt,
      releasedByName: result.order.releasedByName,
      receivedByName: result.order.receivedByName,
      movements: result.movements
    });
  }));

  app.get('/api/inventory/movements', requireAdmin, wrap(async (req, res) => {
    const movements = await StockMovement.find().sort({ createdAt: -1 }).limit(200).lean();
    res.json({ movements });
  }));
}
