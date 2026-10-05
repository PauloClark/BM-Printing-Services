import mongoose from 'mongoose';
import { randomBytes } from 'node:crypto';
import { Inventory, Order, Production, StockMovement } from '../db.js';
import { requireAdmin, requireOrderStaff } from '../middleware/auth.js';
import { serializeOrder } from '../utils.js';
import { listAssignableStaff, verifyAssignableStaff } from '../staffDirectory.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
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
  if (order.paymentStatus !== 'Verified' || order.status !== 'Confirmed' || last?.status !== 'Verified' || !last.verifiedBy) fail(409, 'An admin-verified payment and Confirmed order are required.');
  return order;
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
  app.get('/api/job-orders/staff', requireAdmin, wrap(async (req, res) => res.json({ staff: await listAssignableStaff() })));
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
    const b = req.body || {}, orderId = text(b.orderId, 50), rows = materialsInput(b);
    await confirmedOrder(orderId);
    const employee = await verifyAssignableStaff(b.assignedEmployeeId);
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') fail(503, 'Job reservations require a MongoDB replica set with transactions. Ask the administrator to complete Phase 3 database setup.');
    await Production.init();
    const session = await mongoose.startSession();
    let created;
    try {
      await session.withTransaction(async () => {
        const order = await confirmedOrder(orderId, session);
        const jobOrderId = 'JO-' + new Date().toISOString().slice(0,10).replaceAll('-','') + '-' + randomBytes(6).toString('hex').toUpperCase();
        // Write-lock the authoritative order to serialize duplicates and payment/status changes.
        const lock = await Order.updateOne({ _id: order._id, paymentStatus: 'Verified', status: 'Confirmed', jobOrderId: { $exists: false } }, { $set: { jobOrderId } }, { session });
        if (!lock.modifiedCount) fail(409, 'The order changed. Refresh before preparing it.');
        const materials = [];
        for (const row of [...rows].sort((a,b) => a.inventoryId.localeCompare(b.inventoryId))) {
          const item = await Inventory.findOneAndUpdate({ _id: row.inventoryId, $expr: { $gte: [availableExpression, row.quantity] } }, [{ $set: { reservedQuantity: { $round: [{ $add: [{ $ifNull: ['$reservedQuantity', 0] }, row.quantity] }, 3] }, updatedAt: '$$NOW' } }], { new: true, session });
          if (!item) fail(409, 'INSUFFICIENT STOCK: availability changed. Refresh materials and restock before retrying.');
          materials.push({ inventoryId: item._id, material: item.material, unit: item.unit || 'pcs', quantity: row.quantity });
        }
        [created] = await Production.create([{ phase3: true, jobOrderId, orderId, assignedEmployee: employee.id, assignedEmployeeName: employee.name, assignedBy: req.user.id, dateAssigned: new Date(), status: 'Queueing', reservedMaterials: materials }], { session });
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally { await session.endSession(); }
    res.status(201).json({ job: created });
  }));
  const jobsFilter = user => ({ phase3: true, ...(user.role === 'admin' ? {} : { assignedEmployee: user.id }) });
  app.get('/api/job-orders', requireOrderStaff, wrap(async (req, res) => {
    const jobs = await Production.find(jobsFilter(req.user)).sort({ dateAssigned: -1 }).lean();
    const orders = await Order.find({ orderId: { $in: jobs.map(j => j.orderId) } });
    const byId = new Map(orders.map(o => [o.orderId, serializeOrder(o)]));
    res.json({ jobs: jobs.map(job => ({ ...job, order: byId.get(job.orderId) || null })) });
  }));
  app.get('/api/job-orders/:id', requireOrderStaff, wrap(async (req, res) => {
    const job = await Production.findOne({ ...jobsFilter(req.user), jobOrderId: req.params.id }).lean();
    if (!job) fail(404, 'Job order not found.');
    const order = await Order.findOne({ orderId: job.orderId });
    res.json({ job: { ...job, order: order ? serializeOrder(order) : null } });
  }));

  const nextJobStatus = { Queueing: 'In Progress', 'In Progress': 'Completed', Completed: 'Ready for Pickup' };
  const orderStatusForJob = {
    Queueing: { current: 'Confirmed', next: 'Processing' },
    'In Progress': { current: 'Processing', next: null },
    Completed: { current: 'Processing', next: 'Ready for Pickup' }
  };
  app.patch('/api/job-orders/:id/status', requireOrderStaff, wrap(async (req, res) => {
    const expectedStatus = text(req.body?.expectedStatus, 40);
    const status = text(req.body?.status, 40);
    if (!nextJobStatus[expectedStatus] || nextJobStatus[expectedStatus] !== status) {
      fail(400, 'Invalid Job Order status transition.');
    }

    const filter = { ...jobsFilter(req.user), jobOrderId: req.params.id, status: expectedStatus };
    const session = await mongoose.startSession();
    let updatedJob;
    try {
      await session.withTransaction(async () => {
        const job = await Production.findOne({ ...jobsFilter(req.user), jobOrderId: req.params.id }).session(session);
        if (!job) fail(404, 'Job order not found.');
        if (job.status !== expectedStatus) fail(409, 'This Job Order changed. Refresh and try again.');

        const orderRule = orderStatusForJob[expectedStatus];
        const order = await Order.findOne({ orderId: job.orderId, jobOrderId: job.jobOrderId }).session(session);
        if (!order || order.status !== orderRule.current) fail(409, 'The parent Order status is not ready for this production transition.');

        const timestamp = new Date();
        const fields = { status };
        if (status === 'In Progress') {
          fields.productionStartedAt = timestamp;
          fields.productionStartedBy = req.user.id;
        } else if (status === 'Completed') {
          fields.productionCompletedAt = timestamp;
          fields.productionCompletedBy = req.user.id;
        } else {
          fields.readyForPickupAt = timestamp;
          fields.readyForPickupBy = req.user.id;
        }

        updatedJob = await Production.findOneAndUpdate(filter, {
          $set: fields,
          $push: { productionHistory: {
            status,
            timestamp,
            notes: `Job Order moved to ${status}.`,
            performedBy: req.user.id,
            performedByName: req.user.name || req.user.email || ''
          } }
        }, { new: true, runValidators: true, session });
        if (!updatedJob) fail(409, 'This Job Order changed. Refresh and try again.');

        if (orderRule.next) {
          const updatedOrder = await Order.findOneAndUpdate(
            { _id: order._id, jobOrderId: job.jobOrderId, status: orderRule.current },
            { $set: { status: orderRule.next } },
            { new: true, runValidators: true, session }
          );
          if (!updatedOrder) fail(409, 'The parent Order changed. Refresh and try again.');
        }
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally {
      await session.endSession();
    }

    const order = await Order.findOne({ orderId: updatedJob.orderId });
    res.json({ job: { ...updatedJob.toObject(), order: order ? serializeOrder(order) : null } });
  }));

  // ─── PHASE 5: PICKUP CONFIRMATION & FINAL INVENTORY DEDUCTION ─────────

  app.get('/api/orders/ready-for-pickup', requireOrderStaff, wrap(async (req, res) => {
    const orders = await Order.find({ status: 'Ready for Pickup' }).sort({ createdAt: -1 }).lean();
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

    const job = await Production.findOne({ orderId, phase3: true }).lean();
    if (!job) fail(404, 'Job order not found.');

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
    const receivedByName = text(req.body?.receivedByName, 100) || null;

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
        if (!job.reservedMaterials?.length) fail(409, 'No reserved materials found for this order.');

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
