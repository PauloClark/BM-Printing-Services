import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { AuditLog, Employee, Inventory, Order, Production, StockMovement } from '../db.js';
import { requireAdmin, requireOrderStaff } from '../middleware/auth.js';
import { serializeOrder } from '../utils.js';
import { listAssignableStaff, verifyAssignableStaff } from '../staffDirectory.js';
import { createNotification, notifyAdmins, safeNotify } from '../notificationService.js';
import { paymentMatchesOrderTotal } from '../paymentAmounts.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const requireEmployeePermission = permission => async (req, res, next) => {
  if (req.user.role === 'admin') return next();
  try {
    const managedEmployees = await Employee.countDocuments();
    if (!managedEmployees) return next();
    const employee = await Employee.findOne({ supabaseUserId: req.user.id, active: true, permissions: permission }).lean();
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
const availableExpression = { $subtract: ['$quantity', { $ifNull: ['$reservedQuantity', 0] }] };
const inventoryView = item => ({ ...item.toObject(), reservedQuantity: item.reservedQuantity || 0, availableQuantity: Math.round((item.quantity - (item.reservedQuantity || 0)) * 1000) / 1000 });
const wrap = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    if (error.code === 11000) return res.status(409).json({ error: 'A job order already exists. Refresh the order.' });
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 20 || error.codeName === 'IllegalOperation') return res.status(503).json({ error: 'Job reservations require a MongoDB replica set with transactions. No materials were reserved.' });
    if (error.name === 'ValidationError') return res.status(400).json({ error: 'Check the material category, quantities and required fields.' });
    console.error('Phase 3 request failed:', error);
    res.status(503).json({ error: 'The request could not be completed. Refresh and retry; no partial reservation is committed.' });
  }
};
function materialsInput(body) {
  if (!Array.isArray(body.materials) || !body.materials.length || body.materials.length > 50) fail(400, 'Select between 1 and 50 required materials.');
  const seen = new Set();
  return body.materials.map(row => {
    if (!validId(row.inventoryId) || seen.has(row.inventoryId)) fail(400, 'Select each valid material only once.');
    seen.add(row.inventoryId);
    return { inventoryId: row.inventoryId, quantity: number(row.quantity, true) };
  });
}
async function confirmedOrder(orderId, session) {
  const order = await Order.findOne({ orderId }).session(session || null);
  if (!order) fail(404, 'Order not found.');
  const existing = await Production.findOne({ orderId }).session(session || null);
  if (order.jobOrderId || existing) fail(409, `Job Order already created: ${order.jobOrderId || existing.jobOrderId || 'legacy production record (requires review)'}`);
  const last = order.paymentSubmissions?.at(-1);
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
    const item = await Inventory.create({ material, unit, type: b.type || 'Other', quantity: number(b.quantity), minimumStockLevel: number(b.minimumStockLevel ?? 10), reservedQuantity: 0 });
    res.status(201).json({ inventory: inventoryView(item) });
  }));
  app.post('/api/inventory/stock-in', requireAdmin, wrap(async (req, res) => {
    const qty = number(req.body?.quantity, true);
    const filter = validId(req.body?.inventoryId) ? { _id: req.body.inventoryId } : { material: text(req.body?.material) };
    const item = await Inventory.findOneAndUpdate(filter, { $inc: { quantity: qty }, $set: { lastRestocked: new Date() } }, { new: true, runValidators: true });
    if (!item) fail(404, 'Create the inventory item before restocking.');
    res.json({ inventory: inventoryView(item) });
  }));
  app.post('/api/inventory/stock-out', requireAdmin, (req, res) => res.status(409).json({ error: 'Physical stock deduction is not available in Phase 3. Reserve materials through Prepare Job Order.' }));
  app.patch('/api/inventory/adjust', requireAdmin, wrap(async (req, res) => {
    const qty = number(req.body?.quantity);
    const filter = validId(req.body?.inventoryId) ? { _id: req.body.inventoryId } : { material: text(req.body?.material) };
    const item = await Inventory.findOneAndUpdate({ ...filter, $expr: { $lte: [{ $ifNull: ['$reservedQuantity', 0] }, qty] } }, { $set: { quantity: qty } }, { new: true, runValidators: true });
    if (!item) fail(409, 'On-hand stock cannot fall below reserved stock, or the item no longer exists.');
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
    const [accounts, employees] = await Promise.all([listAssignableStaff(), Employee.find().select('supabaseUserId active').lean()]);
    const eligibleIds = new Set(employees.filter(employee => employee.active && employee.supabaseUserId).map(employee => employee.supabaseUserId));
    res.json({ staff: employees.length ? accounts.filter(account => eligibleIds.has(account.id)) : accounts });
  }));
  app.get('/api/job-orders/eligible', requireAdmin, wrap(async (req, res) => {
    const orders = await Order.find({
      paymentStatus: 'Verified', status: 'Confirmed', archived: { $ne: true },
      $or: [{ jobOrderId: { $exists: false } }, { jobOrderId: null }, { jobOrderId: '' }]
    }).sort({ createdAt: 1 });
    res.json({ orders: orders.filter(order => {
      const payment = order.paymentSubmissions?.at(-1);
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
    await confirmedOrder(orderId);
    const account = await verifyAssignableStaff(b.assignedEmployeeId);
    const managedEmployees = await Employee.countDocuments();
    const linkedEmployee = managedEmployees ? await Employee.findOne({ supabaseUserId: account.id, active: true, permissions: { $all: ['view_assigned_jobs', 'update_job_progress'] } }).lean() : null;
    if (managedEmployees && !linkedEmployee) {
      fail(400, 'Select an active linked employee with assigned-job access.');
    }
    await Production.init();
    const jobOrderId = 'JO-' + new Date().toISOString().slice(0,10).replaceAll('-','') + '-' + randomBytes(6).toString('hex').toUpperCase();
    const lockedOrder = await Order.findOneAndUpdate(
      { orderId, paymentStatus: 'Verified', status: 'Confirmed', $or: [{ jobOrderId: { $exists: false } }, { jobOrderId: null }, { jobOrderId: '' }] },
      { $set: { jobOrderId } }, { new: true, runValidators: true }
    );
    if (!lockedOrder) fail(409, 'The order changed or was already assigned. Refresh and try again.');
    let created;
    try {
      created = await Production.create({
        phase3: true, jobOrderId, orderId, assignedEmployee: account.id,
        assignedEmployeeName: linkedEmployee?.name || account.name, assignedBy: req.user.id,
        assignedByName: req.user.name || req.user.email || '', dateAssigned: new Date(),
        status: 'Assigned', reservedMaterials: [],
        jobInstructions: text(b.jobInstructions, 2000), priority: ['low','normal','high','urgent'].includes(b.priority) ? b.priority : 'normal',
        dueDate: b.dueDate ? new Date(b.dueDate) : null,
        productionHistory: [{ status: 'Assigned', notes: 'Job assigned.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' }]
      });
    } catch (error) {
      await Order.updateOne({ _id: lockedOrder._id, jobOrderId }, { $unset: { jobOrderId: 1 } });
      throw error;
    }
    await audit(req, 'ASSIGN_JOB', 'Production', jobOrderId, null, { orderId, assignedEmployee: account.id, priority: created.priority });
    await safeNotify(() => createNotification({ recipientId: account.id, recipientRole: 'staff', type: 'job_assigned', title: 'New job assigned', message: `Job ${jobOrderId} for order ${orderId} was assigned to you.`, relatedOrderId: orderId, relatedJobId: jobOrderId, targetPage: 'staff', eventKey: `job-assigned:${jobOrderId}:${account.id}` }));
    res.status(201).json({ job: created });
  }));
  const jobsFilter = user => ({ phase3: true, ...(user.role === 'admin' ? {} : { assignedEmployee: user.id }) });
  app.get('/api/job-orders', requireOrderStaff, requireEmployeePermission('view_assigned_jobs'), wrap(async (req, res) => {
    const jobs = await Production.find(jobsFilter(req.user)).sort({ dateAssigned: -1 }).lean();
    const orders = await Order.find({ orderId: { $in: jobs.map(j => j.orderId) } });
    const byId = new Map(orders.map(o => [o.orderId, serializeOrder(o)]));
    res.json({ jobs: jobs.map(job => ({ ...job, order: byId.get(job.orderId) || null })) });
  }));
  app.get('/api/job-orders/:id', requireOrderStaff, requireEmployeePermission('view_assigned_jobs'), wrap(async (req, res) => {
    const job = await Production.findOne({ ...jobsFilter(req.user), jobOrderId: req.params.id }).lean();
    if (!job) fail(404, 'Job order not found.');
    const order = await Order.findOne({ orderId: job.orderId });
    res.json({ job: { ...job, order: order ? serializeOrder(order) : null } });
  }));

  const nextJobStatus = {
    Assigned: 'Acknowledged', Queueing: 'Acknowledged', Acknowledged: 'In Progress',
    'Correction Required': 'In Progress', 'In Progress': 'Submitted for Review'
  };
  app.patch('/api/job-orders/:id/status', requireOrderStaff, requireEmployeePermission('update_job_progress'), wrap(async (req, res) => {
    const expectedStatus = text(req.body?.expectedStatus, 40);
    const status = text(req.body?.status, 40);
    if (!nextJobStatus[expectedStatus] || nextJobStatus[expectedStatus] !== status) {
      fail(400, 'Invalid Job Order status transition.');
    }

    const timestamp = new Date();
    const fields = { status };
    if (status === 'Acknowledged') { fields.acknowledgedAt = timestamp; fields.acknowledgedBy = req.user.id; }
    if (status === 'In Progress') { fields.productionStartedAt = timestamp; fields.productionStartedBy = req.user.id; }
    if (status === 'Submitted for Review') { fields.productionCompletedAt = timestamp; fields.productionCompletedBy = req.user.id; fields.submittedForReviewAt = timestamp; }
    const updatedJob = await Production.findOneAndUpdate(
      { ...jobsFilter(req.user), jobOrderId: req.params.id, status: expectedStatus },
      { $set: fields, $push: { productionHistory: { status, timestamp, notes: `Job Order moved to ${status}.`, performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } } },
      { new: true, runValidators: true }
    );
    if (!updatedJob) fail(409, 'This Job Order changed or is not assigned to you. Refresh and try again.');
    if (status === 'In Progress') await Order.updateOne({ orderId: updatedJob.orderId, jobOrderId: updatedJob.jobOrderId, status: 'Confirmed' }, { $set: { status: 'Processing' } });
    await audit(req, status === 'Submitted for Review' ? 'SUBMIT_JOB_FOR_REVIEW' : 'UPDATE_JOB_STATUS', 'Production', updatedJob.jobOrderId, { status: expectedStatus }, { status });
    if (status === 'Submitted for Review') await safeNotify(() => notifyAdmins({ type: 'job_review_required', title: 'Job ready for review', message: `Job ${updatedJob.jobOrderId} was submitted for administrative review.`, relatedOrderId: updatedJob.orderId, relatedJobId: updatedJob.jobOrderId, targetPage: 'admin', eventKey: `job-review:${updatedJob.jobOrderId}:${updatedJob.submittedForReviewAt?.toISOString() || timestamp.toISOString()}` }));

    const order = await Order.findOne({ orderId: updatedJob.orderId });
    res.json({ job: { ...updatedJob.toObject(), order: order ? serializeOrder(order) : null } });
  }));

  app.post('/api/job-orders/:id/review', requireAdmin, wrap(async (req, res) => {
    const action = text(req.body?.action, 20), notes = text(req.body?.notes, 2000);
    if (!['approve', 'return'].includes(action)) fail(400, 'Choose approve or return.');
    if (action === 'return' && !notes) fail(400, 'Correction instructions are required.');
    const status = action === 'approve' ? 'Approved' : 'Correction Required', timestamp = new Date();
    const job = await Production.findOneAndUpdate(
      { phase3: true, jobOrderId: req.params.id, status: 'Submitted for Review' },
      { $set: { status, reviewedAt: timestamp, reviewedBy: req.user.id, reviewNotes: notes }, $push: { productionHistory: { status, timestamp, notes: notes || 'Completed work approved.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } } },
      { new: true, runValidators: true }
    );
    if (!job) fail(409, 'This job is not awaiting admin review.');
    await audit(req, action === 'approve' ? 'APPROVE_COMPLETED_JOB' : 'RETURN_JOB_FOR_CORRECTION', 'Production', job.jobOrderId, { status: 'Submitted for Review' }, { status, notes });
    if (action === 'return') await safeNotify(() => createNotification({ recipientId: job.assignedEmployee, recipientRole: 'staff', type: 'job_correction_required', title: 'Job returned for correction', message: `Job ${job.jobOrderId} requires correction: ${notes}`, relatedOrderId: job.orderId, relatedJobId: job.jobOrderId, targetPage: 'staff', eventKey: `job-correction:${job.jobOrderId}:${timestamp.toISOString()}` }));
    res.json({ job });
  }));

  app.post('/api/job-orders/:id/ready-for-pickup', requireAdmin, wrap(async (req, res) => {
    const timestamp = new Date();
    const job = await Production.findOne({ phase3: true, jobOrderId: req.params.id, status: 'Approved' });
    if (!job) fail(409, 'Only an approved completed job can be marked ready for pickup.');
    const order = await Order.findOneAndUpdate(
      { orderId: job.orderId, jobOrderId: job.jobOrderId, status: 'Processing', paymentStatus: 'Verified' },
      { $set: { status: 'Ready for Pickup' } }, { new: true, runValidators: true }
    );
    if (!order) fail(409, 'The parent order is not eligible or its payment is not verified.');
    const updatedJob = await Production.findOneAndUpdate(
      { _id: job._id, status: 'Approved' },
      { $set: { status: 'Ready for Pickup', readyForPickupAt: timestamp, readyForPickupBy: req.user.id }, $push: { productionHistory: { status: 'Ready for Pickup', timestamp, notes: 'Admin marked the approved order ready for pickup.', performedBy: req.user.id, performedByName: req.user.name || req.user.email || '' } } },
      { new: true, runValidators: true }
    );
    if (!updatedJob) { await Order.updateOne({ _id: order._id, status: 'Ready for Pickup' }, { $set: { status: 'Processing' } }); fail(409, 'The job changed. Refresh and try again.'); }
    await audit(req, 'MARK_READY_FOR_PICKUP', 'Order', order.orderId, { status: 'Processing' }, { status: 'Ready for Pickup' });
    if (order.customerId) await safeNotify(() => createNotification({ recipientId: order.customerId, recipientRole: 'customer', type: 'ready_for_pickup', title: 'Order ready for pickup', message: `Order ${order.orderId} is ready for pickup.`, relatedOrderId: order.orderId, relatedJobId: updatedJob.jobOrderId, targetPage: 'myorders', eventKey: `ready-for-pickup:${order.orderId}` }));
    res.json({ job: updatedJob, order: serializeOrder(order) });
  }));

  // ─── PHASE 5: PICKUP CONFIRMATION & FINAL INVENTORY DEDUCTION ─────────

  app.get('/api/pickup/orders', requireOrderStaff, wrap(async (req, res) => {
    const orders = await Order.find({ status: 'Ready for Pickup', paymentStatus: 'Verified' }).sort({ createdAt: -1 }).lean();
    const jobOrders = await Production.find({ phase3: true, orderId: { $in: orders.map(o => o.orderId) } }).lean();
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
    const order = await Order.findOne({ orderId }).lean();
    if (!order) fail(404, 'Order not found.');
    if (order.status !== 'Ready for Pickup') fail(409, 'Order is not ready for pickup.');
    if (order.paymentStatus !== 'Verified') fail(409, 'Pickup cannot be confirmed until payment is verified.');

    const job = await Production.findOne({ orderId, phase3: true }).lean();
    if (!job) fail(404, 'Job order not found.');
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

    const pickupOrder = await Order.findOne({ orderId }).lean();
    if (!pickupOrder || pickupOrder.status !== 'Ready for Pickup') fail(409, 'Order is not ready for pickup or has already been picked up.');
    if (pickupOrder.paymentStatus !== 'Verified') fail(409, 'Pickup cannot be confirmed until payment is verified.');
    const pickupJob = await Production.findOne({ orderId, phase3: true }).lean();
    if (!pickupJob || pickupJob.status !== 'Ready for Pickup') fail(409, 'The approved job is not ready for pickup.');
    if (receivedByName.length < 2) fail(400, 'Received By name is required and must contain at least 2 characters.');
    if (!pickupJob.reservedMaterials?.length) {
      const pickedUpAt = new Date();
      const updatedOrder = await Order.findOneAndUpdate(
        { _id: pickupOrder._id, status: 'Ready for Pickup', paymentStatus: 'Verified' },
        { $set: { status: 'Picked Up', pickedUpAt, releasedBy: req.user.id, releasedByName: req.user.name || req.user.email || '', receivedByName } },
        { new: true, runValidators: true }
      );
      if (!updatedOrder) fail(409, 'Order changed during pickup. Refresh and try again.');
      await audit(req, 'CONFIRM_PICKUP', 'Order', orderId, { status: 'Ready for Pickup' }, { status: 'Picked Up', pickedUpAt });
      if (updatedOrder.customerId) await safeNotify(() => createNotification({ recipientId: updatedOrder.customerId, recipientRole: 'customer', type: 'order_picked_up', title: 'Pickup confirmed', message: `Pickup for order ${orderId} was confirmed.`, relatedOrderId: orderId, relatedJobId: pickupJob.jobOrderId, targetPage: 'myorders', eventKey: `pickup-confirmed:${orderId}` }));
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

        const job = await Production.findOne({ orderId, phase3: true }).session(session);
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
            { $set: { 'reservedMaterials.$.reservationStatus': 'consumed' } },
            { session }
          );

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
            performedBy: req.user.id,
            performedByName: req.user.name || req.user.email || '',
            receivedByName
          });
        }

        await StockMovement.create(movements, { session });

        const pickedUpAt = new Date();
        const updatedOrder = await Order.findOneAndUpdate(
          { _id: order._id, status: 'Ready for Pickup' },
          {
            $set: {
              status: 'Picked Up',
              pickedUpAt,
              releasedBy: req.user.id,
              releasedByName: req.user.name || req.user.email || '',
              receivedByName
            }
          },
          { new: true, runValidators: true, session }
        );
        if (!updatedOrder) fail(409, 'Order changed during pickup. Refresh and try again.');

        result = { order: updatedOrder, movements };
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally {
      await session.endSession();
    }

    await audit(req, 'CONFIRM_PICKUP', 'Order', orderId, { status: 'Ready for Pickup' }, { status: 'Picked Up', pickedUpAt: result.order.pickedUpAt });
    if (result.order.customerId) await safeNotify(() => createNotification({ recipientId: result.order.customerId, recipientRole: 'customer', type: 'order_picked_up', title: 'Pickup confirmed', message: `Pickup for order ${orderId} was confirmed.`, relatedOrderId: orderId, relatedJobId: pickupJob.jobOrderId, targetPage: 'myorders', eventKey: `pickup-confirmed:${orderId}` }));
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
