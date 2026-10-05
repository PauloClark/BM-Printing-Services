import mongoose from 'mongoose';
import ExcelJS from 'exceljs';
import { Order, Production, StockMovement } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';
import { safeText, serializeOrder } from '../utils.js';

const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const wrap = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.code === 11000) return res.status(409).json({ error: 'This order is already archived.' });
    if (error.code === 20 || error.codeName === 'IllegalOperation') return res.status(503).json({ error: 'Archiving requires MongoDB transactions. No archive changes were committed.' });
    console.error('Archive/report request failed:', error);
    return res.status(503).json({ error: 'Unable to complete this archive/report request.' });
  }
};

const validateDate = (value, name) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) fail(400, `${name} must use YYYY-MM-DD.`);
  const date = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(date.getTime()) || date.toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' }) !== value) {
    fail(400, `${name} is not a valid date.`);
  }
  return date;
};
const dateRange = (query, required = false) => {
  const from = safeText(query.from);
  const to = safeText(query.to);
  if (!from && !to && !required) return null;
  if (!from || !to) fail(400, 'Provide both from and to dates.');
  const start = validateDate(from, 'From date');
  const endStart = validateDate(to, 'To date');
  const end = new Date(endStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  if (start > end) fail(400, 'From date must be on or before the to date.');
  return { from, to, start, end };
};
const money = value => Number(value || 0);
const sameId = (left, right) => String(left) === String(right);

function hasFinalizedInventory(job, movements) {
  const materials = job.reservedMaterials || [];
  if (!materials.length || materials.some(material => material.reservationStatus !== 'consumed')) return false;
  if (movements.length !== materials.length) return false;
  return materials.every(material => {
    const matching = movements.filter(movement => sameId(movement.inventoryId, material.inventoryId));
    return matching.length === 1 &&
      matching[0].movementType === 'OUT' &&
      matching[0].reason === 'ORDER_PICKUP' &&
      sameId(matching[0].jobOrderId, job.jobOrderId) &&
      Math.abs(money(matching[0].quantity) - money(material.quantity)) < 0.001;
  });
}

async function assertArchiveEligible(order, session) {
  if (order.archived) fail(409, 'Order is already archived.');
  if (order.status !== 'Picked Up' || !order.pickedUpAt || !order.releasedBy) fail(409, 'Only orders with a confirmed pickup can be archived.');
  const latestPayment = order.paymentSubmissions?.[order.paymentSubmissions.length - 1];
  if (order.paymentStatus !== 'Verified' || latestPayment?.status !== 'Verified' || !latestPayment.verifiedAt) {
    fail(409, 'The order must have a verified payment before it can be archived.');
  }
  const job = await Production.findOne({ phase3: true, orderId: order.orderId, jobOrderId: order.jobOrderId }).session(session).lean();
  if (!job || job.status !== 'Ready for Pickup' || !job.productionCompletedAt || !job.readyForPickupAt) {
    fail(409, 'The Job Order must have completed production and reached Ready for Pickup before archiving.');
  }
  const movements = await StockMovement.find({ orderId: order.orderId, jobOrderId: job.jobOrderId, movementType: 'OUT', reason: 'ORDER_PICKUP' }).session(session).lean();
  if (!hasFinalizedInventory(job, movements)) {
    fail(409, 'Inventory reservation finalization and matching pickup stock movements are required before archiving.');
  }
  return { job, movements };
}

const orderWithArchive = order => ({
  ...serializeOrder(order),
  archived: Boolean(order.archived),
  archivedAt: order.archivedAt || null,
  archivedBy: order.archivedBy || '',
  archivedByName: order.archivedByName || ''
});

const paymentHistory = order => (order.paymentSubmissions || []).map(payment => ({
  paymentMethod: payment.paymentMethod,
  amount: payment.amount,
  referenceNumber: payment.referenceNumber,
  status: payment.status,
  submittedAt: payment.submittedAt,
  verifiedAt: payment.verifiedAt,
  verifiedBy: payment.verifiedBy,
  rejectionReason: payment.rejectionReason,
  receiptOriginalName: payment.receiptOriginalName
}));

async function completedRows(range) {
  const jobs = await Production.find({
    phase3: true,
    status: 'Ready for Pickup',
    productionCompletedAt: { $gte: range.start, $lte: range.end }
  }).sort({ productionCompletedAt: 1, orderId: 1 }).lean();
  if (!jobs.length) return [];
  const orderIds = [...new Set(jobs.map(job => job.orderId))];
  const [orders, movements] = await Promise.all([
    Order.find({ orderId: { $in: orderIds }, status: 'Picked Up', paymentStatus: 'Verified' }).lean(),
    StockMovement.find({ orderId: { $in: orderIds }, movementType: 'OUT', reason: 'ORDER_PICKUP' }).lean()
  ]);
  const ordersById = new Map(orders.map(order => [order.orderId, order]));
  const movementsById = new Map();
  for (const movement of movements) {
    const items = movementsById.get(movement.orderId) || [];
    items.push(movement);
    movementsById.set(movement.orderId, items);
  }
  const rows = [];
  const included = new Set();
  for (const job of jobs) {
    const order = ordersById.get(job.orderId);
    if (!order || included.has(order.orderId) || !order.pickedUpAt || !order.releasedBy) continue;
    if (!hasFinalizedInventory(job, movementsById.get(order.orderId) || [])) continue;
    const payment = order.paymentSubmissions?.[order.paymentSubmissions.length - 1];
    if (payment?.status !== 'Verified' || !payment.verifiedAt) continue;
    included.add(order.orderId);
    const product = order.items?.[0] || {};
    rows.push({
      orderId: order.orderId,
      customerName: order.customerName,
      product: product.productName || '',
      quantity: product.quantity || 0,
      totalAmount: money(order.totalAmount),
      paymentMethod: payment.paymentMethod || order.paymentMethod || '',
      amountPaid: money(payment.amount),
      assignedEmployee: job.assignedEmployeeName || '',
      productionStartedAt: job.productionStartedAt || null,
      productionCompletedAt: job.productionCompletedAt,
      readyForPickupAt: job.readyForPickupAt,
      pickedUpAt: order.pickedUpAt,
      archived: Boolean(order.archived)
    });
  }
  return rows;
}

const periodLabel = (from, to) => {
  const format = value => new Intl.DateTimeFormat('en-PH', { timeZone: 'Asia/Manila', year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(`${value}T00:00:00+08:00`));
  return `${format(from)} - ${format(to)}`;
};
const reportFilename = range => `BM_Printing_Completed_Orders_${range.from}_to_${range.to}.xlsx`;

function createWorkbook(rows, range) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BM Printing Services';
  workbook.created = new Date();
  const sheet = workbook.addWorksheet('Completed Orders', { views: [{ state: 'frozen', ySplit: 5 }] });
  sheet.columns = [
    { header: 'Order Number', key: 'orderId', width: 20 },
    { header: 'Client Name', key: 'customerName', width: 26 },
    { header: 'Product / Service', key: 'product', width: 28 },
    { header: 'Quantity', key: 'quantity', width: 12 },
    { header: 'Total Amount', key: 'totalAmount', width: 16 },
    { header: 'Payment Method', key: 'paymentMethod', width: 17 },
    { header: 'Amount Paid', key: 'amountPaid', width: 15 },
    { header: 'Assigned Employee', key: 'assignedEmployee', width: 24 },
    { header: 'Production Started', key: 'productionStartedAt', width: 23 },
    { header: 'Production Completed / Manufacture Date', key: 'productionCompletedAt', width: 34 },
    { header: 'Ready for Pickup Date', key: 'readyForPickupAt', width: 24 },
    { header: 'Picked Up Date', key: 'pickedUpAt', width: 24 }
  ];
  sheet.mergeCells('A1:L1');
  sheet.getCell('A1').value = 'BM PRINTING SERVICES';
  sheet.mergeCells('A2:L2');
  sheet.getCell('A2').value = 'COMPLETED ORDERS REPORT';
  sheet.mergeCells('A3:L3');
  sheet.getCell('A3').value = `Reporting Period: ${periodLabel(range.from, range.to)}`;
  sheet.mergeCells('A4:L4');
  sheet.getCell('A4').value = `Generated: ${new Date().toLocaleString('en-PH', { timeZone: 'Asia/Manila' })}`;
  sheet.getRow(1).font = { bold: true, size: 16, color: { argb: 'FF8B1A1A' } };
  sheet.getRow(2).font = { bold: true, size: 13 };
  sheet.getRow(3).font = { bold: true, size: 11 };
  sheet.getRow(4).font = { italic: true, size: 10, color: { argb: 'FF666666' } };
  sheet.addRow([]);
  sheet.addRow(sheet.columns.map(column => column.header));
  const header = sheet.getRow(6);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF8B1A1A' } };
  header.alignment = { vertical: 'middle', wrapText: true };
  for (const row of rows) {
    sheet.addRow([
      row.orderId,
      row.customerName,
      row.product,
      row.quantity,
      row.totalAmount,
      row.paymentMethod,
      row.amountPaid,
      row.assignedEmployee,
      row.productionStartedAt || '',
      row.productionCompletedAt,
      row.readyForPickupAt || '',
      row.pickedUpAt
    ]);
  }
  for (let index = 7; index <= sheet.rowCount; index += 1) {
    for (const column of [9, 10, 11, 12]) {
      const cell = sheet.getRow(index).getCell(column);
      if (cell.value instanceof Date) cell.numFmt = 'dd mmm yyyy hh:mm';
    }
  }
  sheet.getColumn(5).numFmt = '"₱"#,##0.00';
  sheet.getColumn(7).numFmt = '"₱"#,##0.00';
  sheet.autoFilter = { from: 'A6', to: `L${Math.max(6, sheet.rowCount)}` };
  const footerRow = sheet.rowCount + 2;
  sheet.mergeCells(`A${footerRow}:C${footerRow}`);
  sheet.getCell(`A${footerRow}`).value = `Total Completed Orders: ${rows.length}`;
  sheet.mergeCells(`D${footerRow}:L${footerRow}`);
  sheet.getCell(`D${footerRow}`).value = rows.reduce((sum, row) => sum + row.totalAmount, 0);
  sheet.getCell(`D${footerRow}`).numFmt = '"Total Sales: ₱"#,##0.00';
  sheet.getRow(footerRow).font = { bold: true };
  return workbook;
}

export default function orderArchiveRoutes(app) {
  app.post('/api/admin/orders/:orderId/archive', requireAdmin, wrap(async (req, res) => {
    const orderId = safeText(req.params.orderId).trim().toUpperCase();
    const session = await mongoose.startSession();
    let archivedOrder;
    try {
      await session.withTransaction(async () => {
        const order = await Order.findOne({ orderId }).session(session);
        if (!order) fail(404, 'Order not found.');
        const { job } = await assertArchiveEligible(order, session);
        const archivedAt = new Date();
        archivedOrder = await Order.findOneAndUpdate(
          { _id: order._id, status: 'Picked Up', paymentStatus: 'Verified', archived: { $ne: true }, jobOrderId: job.jobOrderId },
          { $set: { archived: true, archivedAt, archivedBy: req.user.id, archivedByName: req.user.name || req.user.email || '' } },
          { new: true, runValidators: true, session }
        );
        if (!archivedOrder) fail(409, 'Order changed while archiving. Refresh and try again.');
      }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } });
    } finally {
      await session.endSession();
    }
    return res.json({ success: true, order: orderWithArchive(archivedOrder) });
  }));

  app.get('/api/admin/archived-orders', requireAdmin, wrap(async (req, res) => {
    const range = dateRange(req.query, false);
    const jobs = await Production.find({ phase3: true, status: 'Ready for Pickup', ...(range ? { productionCompletedAt: { $gte: range.start, $lte: range.end } } : {}) })
      .sort({ productionCompletedAt: -1 }).lean();
    if (!jobs.length) return res.json({ orders: [] });
    const ids = [...new Set(jobs.map(job => job.orderId))];
    const orders = await Order.find({ orderId: { $in: ids }, archived: true }).lean();
    const byId = new Map(orders.map(order => [order.orderId, order]));
    const q = safeText(req.query.q).trim().toLowerCase();
    const product = safeText(req.query.product).trim().toLowerCase();
    const results = jobs.flatMap(job => {
      const order = byId.get(job.orderId);
      if (!order) return [];
      const item = order.items?.[0] || {};
      const matchesSearch = !q || [order.orderId, order.customerName, order.customerEmail].some(value => String(value || '').toLowerCase().includes(q));
      const matchesProduct = !product || String(item.productName || '').toLowerCase().includes(product);
      if (!matchesSearch || !matchesProduct) return [];
      return [{
        ...orderWithArchive(order),
        production: {
          jobOrderId: job.jobOrderId,
          assignedEmployeeName: job.assignedEmployeeName,
          dateAssigned: job.dateAssigned,
          productionStartedAt: job.productionStartedAt,
          productionCompletedAt: job.productionCompletedAt,
          readyForPickupAt: job.readyForPickupAt
        }
      }];
    });
    return res.json({ orders: results });
  }));

  app.get('/api/admin/archived-orders/:orderId', requireAdmin, wrap(async (req, res) => {
    const orderId = safeText(req.params.orderId).trim().toUpperCase();
    const order = await Order.findOne({ orderId, archived: true }).lean();
    if (!order) fail(404, 'Archived order not found.');
    const [job, movements] = await Promise.all([
      Production.findOne({ phase3: true, orderId, jobOrderId: order.jobOrderId }).lean(),
      StockMovement.find({ orderId }).sort({ createdAt: 1 }).lean()
    ]);
    return res.json({
      order: orderWithArchive(order),
      payments: paymentHistory(order),
      job: job ? {
        jobOrderId: job.jobOrderId,
        assignedEmployeeName: job.assignedEmployeeName,
        assignedBy: job.assignedBy,
        dateAssigned: job.dateAssigned,
        status: job.status,
        productionStartedAt: job.productionStartedAt,
        productionCompletedAt: job.productionCompletedAt,
        readyForPickupAt: job.readyForPickupAt,
        reservedMaterials: job.reservedMaterials || []
      } : null,
      pickup: { pickedUpAt: order.pickedUpAt, releasedByName: order.releasedByName, receivedByName: order.receivedByName },
      movements: movements.map(movement => ({
        material: movement.material,
        quantity: movement.quantity,
        unit: movement.unit,
        movementType: movement.movementType,
        reason: movement.reason,
        performedByName: movement.performedByName,
        receivedByName: movement.receivedByName,
        createdAt: movement.createdAt
      }))
    });
  }));

  app.get('/api/admin/reports/completed-orders', requireAdmin, wrap(async (req, res) => {
    const range = dateRange(req.query, true);
    const rows = await completedRows(range);
    const q = safeText(req.query.q).trim().toLowerCase();
    const product = safeText(req.query.product).trim().toLowerCase();
    const filtered = rows.filter(row => (!q || [row.orderId, row.customerName].some(value => value.toLowerCase().includes(q))) &&
      (!product || row.product.toLowerCase().includes(product)));
    return res.json({
      from: range.from,
      to: range.to,
      reportingPeriod: periodLabel(range.from, range.to),
      completedOrders: filtered.length,
      totalSales: filtered.reduce((sum, row) => sum + row.totalAmount, 0),
      rows: filtered
    });
  }));

  app.get('/api/admin/reports/completed-orders/export', requireAdmin, wrap(async (req, res) => {
    const range = dateRange(req.query, true);
    const rows = await completedRows(range);
    const q = safeText(req.query.q).trim().toLowerCase();
    const product = safeText(req.query.product).trim().toLowerCase();
    const filtered = rows.filter(row => (!q || [row.orderId, row.customerName].some(value => value.toLowerCase().includes(q))) &&
      (!product || row.product.toLowerCase().includes(product)));
    const workbook = createWorkbook(filtered, range);
    const data = await workbook.xlsx.writeBuffer();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${reportFilename(range)}"`,
      'Cache-Control': 'private, no-store'
    });
    return res.send(data);
  }));
}
