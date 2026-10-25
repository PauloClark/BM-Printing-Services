import mongoose from 'mongoose';
import { AuditLog, Expense, Inventory, Order, Production, StockMovement } from '../db.js';
import { requireAdmin } from '../middleware/auth.js';

const categories = ['Utilities', 'Rent', 'Payroll', 'Delivery', 'Maintenance', 'Supplies', 'Marketing', 'Other'];
const fail = (status, message) => { throw Object.assign(new Error(message), { status }); };
const text = (value, limit = 500) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
const cents = value => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9 || Math.abs(value * 100 - Math.round(value * 100)) > 1e-7) fail(400, 'Amounts must be valid non-negative numbers with no fractions smaller than one centavo.');
  return Math.round(value * 100);
};
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const actorName = user => user.name || user.email || '';
const validDateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const parseManilaDate = value => validDateOnly(value) ? new Date(`${value}T12:00:00+08:00`) : null;
const audit = (req, action, type, id, previousValue, newValue) => AuditLog.create({
  userId: req.user.id, userName: actorName(req.user), role: 'admin', action, module: 'Financials',
  resourceType: type, resourceId: id, previousValue, newValue, timestamp: new Date()
});
const wrap = handler => async (req, res) => {
  try { await handler(req, res); }
  catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    if (error.name === 'ValidationError') return res.status(400).json({ error: 'Check the financial record fields and amounts.' });
    if (error.name === 'CastError') return res.status(400).json({ error: 'Invalid financial record identifier.' });
    console.error('Financial request failed:', error);
    return res.status(503).json({ error: 'Financial records could not be loaded or saved. Refresh and retry.' });
  }
};
function dateWindow(query) {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  if (!validDateOnly(from) || !validDateOnly(to) || from > to) fail(400, 'Select a valid date range (YYYY-MM-DD).');
  const start = new Date(`${from}T00:00:00+08:00`);
  const end = new Date(new Date(`${to}T00:00:00+08:00`).getTime() + 86400000);
  return { from, to, start, end };
}
const inWindow = (date, range) => date && date >= range.start && date < range.end;
const moneyCents = value => Math.round((Number(value) || 0) * 100);
const manilaDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
function periodKey(date, period) {
  const day = manilaDate(date);
  if (period === 'daily') return day;
  if (period === 'monthly') return day.slice(0, 7);
  const d = new Date(`${day}T00:00:00Z`);
  const weekday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - weekday);
  return `Week of ${d.toISOString().slice(0, 10)}`;
}
function safeCsvCell(value) {
  let cell = value == null ? '' : value instanceof Date ? value.toISOString() : String(value);
  if (/^[\s]*[=+\-@]/.test(cell)) cell = `'${cell}`;
  return `"${cell.replace(/"/g, '""')}"`;
}
function csv(res, filename, columns, records) {
  const content = [columns.map(safeCsvCell).join(','), ...records.map(row => row.map(safeCsvCell).join(','))].join('\r\n');
  res.status(200).type('text/csv; charset=utf-8').attachment(filename).send(`\uFEFF${content}`);
}
function verifiedPayments(order, range) {
  const rows = [];
  if (order.cashPayment?.verifiedAt && order.cashPayment?.verifiedBy && inWindow(new Date(order.cashPayment.verifiedAt), range)) {
    rows.push({ amountCents: moneyCents(order.cashPayment.amount), method: order.paymentMethod || 'Cash', date: new Date(order.cashPayment.verifiedAt) });
  }
  for (const payment of order.paymentSubmissions || []) {
    if (payment.status === 'Verified' && payment.verifiedAt && payment.verifiedBy && inWindow(new Date(payment.verifiedAt), range)) {
      rows.push({ amountCents: moneyCents(payment.amount), method: payment.paymentMethod || '', date: new Date(payment.verifiedAt) });
    }
  }
  return rows;
}
function paymentAmountAllTime(order) {
  const cash = order.cashPayment?.verifiedAt && order.cashPayment?.verifiedBy ? moneyCents(order.cashPayment.amount) : 0;
  return cash + (order.paymentSubmissions || []).reduce((sum, payment) =>
    sum + (payment.status === 'Verified' && payment.verifiedAt && payment.verifiedBy ? moneyCents(payment.amount) : 0), 0);
}
const resolutionEvents = order => (order.financialResolutionEvents || []).slice().sort((a, b) => new Date(a.occurredAt) - new Date(b.occurredAt));
function resolutionAtRangeEnd(order, range) {
  const event = resolutionEvents(order).filter(item => item.occurredAt && new Date(item.occurredAt) < range.end).at(-1);
  if (event) return event;
  const resolution = order.financialResolution || {};
  return resolution.status && resolution.status !== 'NONE' && resolution.resolutionDate && new Date(resolution.resolutionDate) < range.end
    ? { toStatus: resolution.status, originalVerifiedAmountCents: resolution.originalVerifiedAmountCents, accountedAmountCents: resolution.accountedAmountCents }
    : null;
}
function expenseView(expense) {
  return {
    id: expense._id, expenseDate: expense.expenseDate, category: expense.category, description: expense.description,
    amountCents: expense.amountCents, paymentStatus: expense.paymentStatus, paidAmountCents: expense.paidAmountCents, paidAt: expense.paidAt,
    paymentMethod: expense.paymentMethod, reference: expense.reference, status: expense.status,
    voidReason: expense.voidReason, recordedBy: expense.recordedBy, recordedByName: expense.recordedByName,
    createdAt: expense.createdAt, updatedAt: expense.updatedAt, auditHistory: expense.auditHistory || []
  };
}

export default function financialRoutes(app) {
  app.get('/api/admin/financial/summary', requireAdmin, wrap(async (req, res) => {
    const range = dateWindow(req.query);
    const [orders, movements, wasteMovements, expenses, inventory] = await Promise.all([
      Order.find().select('orderId status totalAmount items createdAt pickedUpAt completedAt paymentStatus paymentMethod cashPayment paymentSubmissions jobOrderId archived orderSource financialResolution financialResolutionEvents').lean(),
      StockMovement.find({ movementType: 'OUT', reason: 'ORDER_PICKUP', createdAt: { $gte: range.start, $lt: range.end } }).lean(),
      StockMovement.find({ movementType: 'WASTE', reason: 'PRODUCTION_WASTE', createdAt: { $gte: range.start, $lt: range.end } }).lean(),
      Expense.find({ status: 'Active', $or: [{ expenseDate: { $gte: range.start, $lt: range.end } }, { paidAt: { $gte: range.start, $lt: range.end } }] }).lean(),
      Inventory.find().select('material quantity reservedQuantity unit costPerUnit costBasisKnown purchaseHistory').lean()
    ]);
    const fulfilledOrders = orders.filter(order => ['Picked Up', 'Completed'].includes(order.status));
    const jobs = await Production.find({ phase3: true, orderId: { $in: fulfilledOrders.map(order => order.orderId) } }).select('jobOrderId orderId reservedMaterials materialPlanVersion materialOperationState materialPlanMode noMaterialsReason').lean();
    const jobMovementRows = jobs.length ? await StockMovement.find({ jobOrderId: { $in: jobs.map(job => job.jobOrderId) }, movementType: 'OUT', reason: 'ORDER_PICKUP' }).lean() : [];
    const jobByOrder = new Map(jobs.map(job => [job.orderId, job]));
    let revenueCents = 0, paymentCents = 0, bookedOrderValueCents = 0, refundsPaidCents = 0, customerCreditsIssuedCents = 0, outstandingRefundLiabilityCents = 0, fulfilledCount = 0;
    let missingRevenueDateCount = 0, fulfilledOrdersWithUnpaidBalance = 0, fulfilledOrdersWithoutConsumptionRecords = 0;
    const buckets = { daily: new Map(), weekly: new Map(), monthly: new Map() };
    const add = (date, field, amount) => {
      for (const period of Object.keys(buckets)) {
        const key = periodKey(date, period);
        const row = buckets[period].get(key) || { period: key, bookedOrderValueCents: 0, revenueCents: 0, paymentsReceivedCents: 0, refundsPaidCents: 0, creditsIssuedCents: 0, directCostsCents: 0, wastageCostCents: 0, expensesCents: 0 };
        row[field] += amount;
        buckets[period].set(key, row);
      }
    };
    const paymentRows = [];
    for (const order of orders) {
      if (inWindow(new Date(order.createdAt), range)) {
        const booked = moneyCents(order.totalAmount);
        bookedOrderValueCents += booked;
        add(new Date(order.createdAt), 'bookedOrderValueCents', booked);
      }
      for (const payment of verifiedPayments(order, range)) {
        paymentCents += payment.amountCents;
        paymentRows.push({ date: payment.date, amountCents: payment.amountCents });
      }
      const endState = resolutionAtRangeEnd(order, range);
      if (['REFUND_REQUIRED', 'REFUND_PENDING'].includes(endState?.toStatus)) {
        outstandingRefundLiabilityCents += Math.max(0, Number(endState.originalVerifiedAmountCents || 0) - Number(endState.accountedAmountCents || 0));
      }
      for (const event of resolutionEvents(order)) {
        if (event.toStatus === 'REFUND_COMPLETED' && event.resolutionDate && inWindow(new Date(event.resolutionDate), range)) {
          const amount = Number(event.amountCents || 0);
          refundsPaidCents += amount;
          add(new Date(event.resolutionDate), 'refundsPaidCents', amount);
        }
        if (event.toStatus === 'CREDIT_ISSUED' && event.resolutionDate && inWindow(new Date(event.resolutionDate), range)) {
          const amount = Number(event.amountCents || 0);
          customerCreditsIssuedCents += amount;
          add(new Date(event.resolutionDate), 'creditsIssuedCents', amount);
        }
      }
      if (['Picked Up', 'Completed'].includes(order.status)) {
        const fulfillmentDate = order.pickedUpAt || order.completedAt;
        if (!fulfillmentDate) {
          if (inWindow(new Date(order.createdAt), range)) missingRevenueDateCount += 1;
          continue;
        }
        if (inWindow(new Date(fulfillmentDate), range)) {
          fulfilledCount += 1;
          const amount = moneyCents(order.totalAmount);
          revenueCents += amount;
          add(new Date(fulfillmentDate), 'revenueCents', amount);
          if (paymentAmountAllTime(order) < moneyCents(order.totalAmount)) fulfilledOrdersWithUnpaidBalance += 1;
          const job = jobByOrder.get(order.orderId);
          if (order.jobOrderId && (!job || (job.materialPlanVersion === 1
            ? job.materialOperationState !== 'FINALIZED' && !(job.materialOperationState === 'NOT_REQUIRED' && job.noMaterialsReason !== 'Materials not yet tracked in inventory')
            : !(job.reservedMaterials || []).some(row => row.reservationStatus === 'consumed')))) fulfilledOrdersWithoutConsumptionRecords += 1;
        }
      }
    }
    for (const payment of paymentRows) add(payment.date, 'paymentsReceivedCents', payment.amountCents);
    let directCostsCents = 0, wastageCostCents = 0, uncostedMovementCount = 0, uncostedWasteCount = 0;
    for (const movement of movements) {
      if (movement.costDataComplete && Number.isInteger(movement.directCostCents)) {
        directCostsCents += movement.directCostCents;
        add(new Date(movement.createdAt), 'directCostsCents', movement.directCostCents);
      } else uncostedMovementCount += 1;
    }
    for (const movement of wasteMovements) {
      if (movement.costDataComplete && Number.isInteger(movement.directCostCents)) {
        wastageCostCents += movement.directCostCents;
        add(new Date(movement.createdAt), 'wastageCostCents', movement.directCostCents);
      } else uncostedWasteCount += 1;
    }
    let operatingExpensesCents = 0, expensePaidCents = 0;
    const categoryTotals = new Map();
    for (const expense of expenses) {
      if (inWindow(new Date(expense.expenseDate), range)) {
        operatingExpensesCents += expense.amountCents;
        categoryTotals.set(expense.category, (categoryTotals.get(expense.category) || 0) + expense.amountCents);
        add(new Date(expense.expenseDate), 'expensesCents', expense.amountCents);
      }
      if (expense.paidAt && inWindow(new Date(expense.paidAt), range)) expensePaidCents += expense.paidAmountCents;
    }
    let purchaseTotalCents = 0, purchasePaidCents = 0;
    const purchaseRows = [];
    for (const item of inventory) for (const purchase of item.purchaseHistory || []) {
      const purchasedAt = new Date(purchase.purchasedAt);
      if (inWindow(purchasedAt, range)) {
        purchaseTotalCents += purchase.totalCostCents;
        purchaseRows.push({ material: item.material, ...purchase });
      }
      if (purchase.paidAt && inWindow(new Date(purchase.paidAt), range)) purchasePaidCents += purchase.paidAmountCents;
    }
    const outstanding = orders.filter(order => order.status !== 'Cancelled' && moneyCents(order.totalAmount) > paymentAmountAllTime(order));
    const inventoryValueCents = inventory.reduce((sum, item) => sum + (item.costBasisKnown ? Math.round(Number(item.quantity || 0) * Number(item.costPerUnit || 0) * 100) : 0), 0);
    const incompleteInventoryCount = inventory.filter(item => Number(item.quantity || 0) > 0 && !item.costBasisKnown).length;
    const jobMaterialCosts = new Map();
    for (const movement of jobMovementRows) {
      if (!movement.jobOrderId) continue;
      const value = jobMaterialCosts.get(movement.jobOrderId) || { costCents: 0, complete: true };
      if (movement.costDataComplete && Number.isInteger(movement.directCostCents)) value.costCents += movement.directCostCents;
      else value.complete = false;
      jobMaterialCosts.set(movement.jobOrderId, value);
    }
    const jobProfitability = fulfilledOrders.filter(order => {
      const date = order.pickedUpAt || order.completedAt;
      return date && inWindow(new Date(date), range);
    }).map(order => {
      const job = jobByOrder.get(order.orderId), costs = jobMaterialCosts.get(job?.jobOrderId) || { costCents: 0, complete: !order.jobOrderId };
      return {
        orderId: order.orderId, jobOrderId: job?.jobOrderId || '', product: order.items?.[0]?.productName || '',
        fulfilledRevenueCents: moneyCents(order.totalAmount), directMaterialCostsCents: costs.costCents,
        grossProfitCents: moneyCents(order.totalAmount) - costs.costCents,
        costDataComplete: costs.complete && (!order.jobOrderId || Boolean(job && (job.materialPlanVersion === 1
          ? job.materialOperationState === 'FINALIZED' || (job.materialOperationState === 'NOT_REQUIRED' && job.noMaterialsReason !== 'Materials not yet tracked in inventory')
          : (job.reservedMaterials || []).some(row => row.reservationStatus === 'consumed'))))
      };
    });
    const incomplete = uncostedMovementCount > 0 || uncostedWasteCount > 0 || incompleteInventoryCount > 0 || missingRevenueDateCount > 0 || fulfilledOrdersWithoutConsumptionRecords > 0;
    res.json({
      range: { from: range.from, to: range.to, timeZone: 'Asia/Manila' },
      totals: {
        verifiedPaymentsReceivedCents: paymentCents, fulfilledSalesRevenueCents: revenueCents,
        directMaterialCostsCents: directCostsCents, wastageCostCents, inventoryValuationCents: inventoryValueCents,
        inventoryValuationIncompleteItems: incompleteInventoryCount,
        grossProfitCents: revenueCents - directCostsCents, operatingExpensesCents,
        estimatedNetProfitCents: revenueCents - directCostsCents - operatingExpensesCents,
        netCashMovementCents: paymentCents - refundsPaidCents - purchasePaidCents - expensePaidCents,
        bookedOrderValueCents, refundsPaidCents, outstandingRefundLiabilityCents, customerCreditsIssuedCents,
        inventoryPurchasesCents: purchaseTotalCents, inventoryPurchasesPaidCents: purchasePaidCents,
        operatingExpensesPaidCents: expensePaidCents, outstandingBalanceCents: outstanding.reduce((sum, order) => sum + Math.max(0, moneyCents(order.totalAmount) - paymentAmountAllTime(order)), 0)
      },
      counts: {
        fulfilledOrders: fulfilledCount, outstandingOrders: outstanding.length, uncostedConsumedMaterialMovements: uncostedMovementCount, uncostedWasteMovements: uncostedWasteCount,
        fulfilledOrdersWithUnpaidBalance, fulfilledOrdersWithoutConsumptionRecords, fulfilledOrdersMissingRevenueDate: missingRevenueDateCount,
        activeExpenses: expenses.length, inventoryPurchases: purchaseRows.length
      },
      completeness: {
        isComplete: !incomplete,
        estimatedNetProfitIsPartial: incomplete,
        notes: [
          'Only Admin-verified payment records count as cash received.',
          'Booked order value includes orders regardless of later cancellation; it is not cash received or earned revenue.',
          'Sales revenue is recognized only for Picked Up or Completed orders with a recorded fulfillment date.',
          'Refunds count as cash outflow only when an Admin records REFUND_COMPLETED with an actual refund date.',
          'Customer credits are reported separately from cash refunds.',
          'Inventory purchases are asset purchases and are not also deducted as operating expenses.',
          'Inventory valuation uses known cost basis on physical on-hand stock; reservations do not reduce this value.',
          'Wastage cost is a subset of direct material cost and is shown separately for analysis; do not subtract it a second time.',
          'Historical material use without a recorded cost snapshot is excluded from direct costs and marked incomplete.',
          'Jobs marked with materials not yet tracked in inventory are classified as incomplete material costing.',
          'Refunds count only when an Admin records REFUND_COMPLETED with a refund date and reference; pending refunds remain liabilities.',
          'Customer credits are tracked separately and never counted as cash refunds.'
        ]
      },
      refundsSupported: true,
      expenseByCategory: [...categoryTotals].map(([category, amountCents]) => ({ category, amountCents })),
      periods: Object.fromEntries(Object.entries(buckets).map(([period, values]) => [period, [...values.values()].sort((a, b) => a.period.localeCompare(b.period))])),
      jobProfitability
    });
  }));

  app.get('/api/admin/financial/history', requireAdmin, wrap(async (req, res) => {
    const range = dateWindow(req.query);
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 200, 1), 500);
    const offset = Math.min(Math.max(Number.parseInt(req.query.offset, 10) || 0, 0), 1000000);
    const q = text(req.query.q, 100);
    const status = text(req.query.status, 40);
    const paymentStatus = text(req.query.paymentStatus, 40);
    const source = text(req.query.source, 20);
    const filter = { createdAt: { $gte: range.start, $lt: range.end } };
    if (status) filter.status = status;
    if (paymentStatus === 'Unknown') filter.$and = [{ $or: [{ paymentStatus: { $exists: false } }, { paymentStatus: null }, { paymentStatus: '' }] }];
    else if (paymentStatus) filter.paymentStatus = paymentStatus;
    if (source === 'online') {
      filter.$and = [...(filter.$and || []), { $or: [{ orderSource: 'online' }, { orderSource: { $exists: false } }, { orderSource: '' }] }];
    } else if (source) filter.orderSource = source;
    if (q) {
      const pattern = new RegExp(escapeRegex(q), 'i');
      filter.$or = [{ orderId: pattern }, { customerName: pattern }, { 'items.productName': pattern }];
    }
    const [orders, total] = await Promise.all([
      Order.find(filter).sort({ createdAt: -1 }).skip(offset).limit(limit).lean(),
      Order.countDocuments(filter)
    ]);
    res.json({
      limit, offset, total, hasMore: offset + orders.length < total, orders: orders.map(order => ({
        orderId: order.orderId, customerName: order.customerName, products: (order.items || []).map(item => `${item.productName} × ${item.quantity}`).join(', '),
      orderDate: order.createdAt, fulfilledAt: order.pickedUpAt || order.completedAt || null, orderStatus: order.status,
        paymentStatus: order.paymentStatus || 'Unknown', paymentMethod: order.paymentMethod || '',
        orderTotalCents: moneyCents(order.totalAmount), verifiedPaidCents: paymentAmountAllTime(order),
        financialResolutionStatus: order.financialResolution?.status || 'NONE',
        financialResolutionAmountCents: Number(order.financialResolution?.accountedAmountCents || 0),
        financialResolutionReference: order.financialResolution?.referenceNumber || '',
        refundsPaidCents: resolutionEvents(order).filter(event => event.toStatus === 'REFUND_COMPLETED' && event.resolutionDate && inWindow(new Date(event.resolutionDate), range)).reduce((sum, event) => sum + Number(event.amountCents || 0), 0),
        creditsIssuedCents: resolutionEvents(order).filter(event => event.toStatus === 'CREDIT_ISSUED' && event.resolutionDate && inWindow(new Date(event.resolutionDate), range)).reduce((sum, event) => sum + Number(event.amountCents || 0), 0),
        refundLiabilityCents: (() => { const state = resolutionAtRangeEnd(order, range); return ['REFUND_REQUIRED', 'REFUND_PENDING'].includes(state?.toStatus) ? Math.max(0, Number(state.originalVerifiedAmountCents || 0) - Number(state.accountedAmountCents || 0)) : 0; })(),
        balanceCents: Math.max(0, moneyCents(order.totalAmount) - paymentAmountAllTime(order)),
        source: order.orderSource || 'online', archived: Boolean(order.archived)
      }))
    });
  }));

  app.get('/api/admin/financial/expenses', requireAdmin, wrap(async (req, res) => {
    const range = dateWindow(req.query);
    const expenses = await Expense.find({ $or: [{ expenseDate: { $gte: range.start, $lt: range.end } }, { paidAt: { $gte: range.start, $lt: range.end } }] }).sort({ expenseDate: -1, createdAt: -1 }).limit(1000).lean();
    res.json({ expenses: expenses.map(expenseView) });
  }));

  app.post('/api/admin/financial/expenses', requireAdmin, wrap(async (req, res) => {
    const body = req.body || {};
    const amountCents = cents(body.amount);
    const paidAmountCents = cents(body.paidAmount ?? (body.paymentStatus === 'Paid' ? body.amount : 0));
    if (!categories.includes(body.category) || !text(body.description) || amountCents < 1) fail(400, 'Category, description and a positive expense amount are required.');
    if (paidAmountCents > amountCents) fail(400, 'Paid amount cannot exceed the expense amount.');
    const paymentStatus = body.paymentStatus === 'Unpaid' ? 'Unpaid' : 'Paid';
    if ((paymentStatus === 'Paid' && paidAmountCents !== amountCents) || (paymentStatus === 'Unpaid' && paidAmountCents !== 0)) fail(400, 'Record an expense as fully paid or unpaid; partial payments are not supported here.');
    const expenseDate = parseManilaDate(text(body.expenseDate, 10));
    if (!expenseDate) fail(400, 'Enter a valid expense date.');
    const paidAt = body.paidAt ? parseManilaDate(text(body.paidAt, 10)) : expenseDate;
    if (paymentStatus === 'Paid' && !paidAt) fail(400, 'Enter a valid payment date.');
    const record = await Expense.create({
      expenseDate, category: body.category, description: text(body.description), amountCents, paymentStatus, paidAmountCents,
      paidAt: paymentStatus === 'Paid' ? paidAt : null,
      paymentMethod: text(body.paymentMethod, 50), reference: text(body.reference, 100),
      recordedBy: req.user.id, recordedByName: actorName(req.user),
      auditHistory: [{ action: 'CREATE', userId: req.user.id, userName: actorName(req.user), timestamp: new Date(), reason: text(body.reason, 500) || 'Expense recorded.' }]
    });
    await audit(req, 'CREATE_EXPENSE', 'Expense', String(record._id), null, { amountCents, category: record.category, paymentStatus });
    res.status(201).json({ expense: expenseView(record) });
  }));

  app.patch('/api/admin/financial/expenses/:id', requireAdmin, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, 'Invalid expense record.');
    const reason = text(req.body?.reason);
    if (!reason) fail(400, 'A reason is required to correct a financial record.');
    const record = await Expense.findOne({ _id: req.params.id, status: 'Active' });
    if (!record) fail(404, 'Active expense record not found.');
    const before = { expenseDate: record.expenseDate, category: record.category, description: record.description, amountCents: record.amountCents, paymentStatus: record.paymentStatus, paidAmountCents: record.paidAmountCents, paymentMethod: record.paymentMethod, reference: record.reference };
    const body = req.body || {};
    if (body.category !== undefined) {
      if (!categories.includes(body.category)) fail(400, 'Choose a valid expense category.');
      record.category = body.category;
    }
    if (body.description !== undefined) {
      const description = text(body.description);
      if (!description) fail(400, 'Expense description is required.');
      record.description = description;
    }
    if (body.amount !== undefined) record.amountCents = cents(body.amount);
    if (body.paidAmount !== undefined) record.paidAmountCents = cents(body.paidAmount);
    if (body.paymentStatus !== undefined) {
      if (!['Paid', 'Unpaid'].includes(body.paymentStatus)) fail(400, 'Choose Paid or Unpaid.');
      record.paymentStatus = body.paymentStatus;
    }
    if (record.amountCents < 1 || record.paidAmountCents > record.amountCents || (record.paymentStatus === 'Paid' && record.paidAmountCents !== record.amountCents) || (record.paymentStatus === 'Unpaid' && record.paidAmountCents !== 0)) fail(400, 'Record an expense as fully paid or unpaid; partial payments are not supported here.');
    if (body.paymentMethod !== undefined) record.paymentMethod = text(body.paymentMethod, 50);
    if (body.reference !== undefined) record.reference = text(body.reference, 100);
    if (body.expenseDate !== undefined) {
      const date = text(body.expenseDate, 10), parsed = parseManilaDate(date);
      if (!parsed) fail(400, 'Enter a valid expense date.');
      record.expenseDate = parsed;
    }
    if (body.paidAt !== undefined) {
      const date = text(body.paidAt, 10), parsed = parseManilaDate(date);
      if (!parsed) fail(400, 'Enter a valid payment date.');
      record.paidAt = record.paymentStatus === 'Paid' ? parsed : null;
    } else if (record.paymentStatus === 'Unpaid') record.paidAt = null;
    if (record.paymentStatus === 'Paid' && !record.paidAt) fail(400, 'A paid expense must have an actual payment date.');
    record.updatedBy = req.user.id;
    record.updatedAt = new Date();
    record.auditHistory.push({ action: 'CORRECT', userId: req.user.id, userName: actorName(req.user), timestamp: record.updatedAt, reason });
    await record.save();
    await audit(req, 'CORRECT_EXPENSE', 'Expense', String(record._id), before, { ...expenseView(record), reason });
    res.json({ expense: expenseView(record) });
  }));

  app.get('/api/admin/financial/purchases', requireAdmin, wrap(async (req, res) => {
    const range = dateWindow(req.query);
    const items = await Inventory.find().select('material unit purchaseHistory').lean();
    const purchases = items.flatMap(item => (item.purchaseHistory || [])
      .filter(row => inWindow(new Date(row.purchasedAt), range))
      .map(row => ({ ...row, material: item.material, unit: item.unit })))
      .sort((a, b) => new Date(b.purchasedAt) - new Date(a.purchasedAt)).slice(0, 1000);
    res.json({ purchases });
  }));

  app.get('/api/admin/financial/material-costs', requireAdmin, wrap(async (req, res) => {
    const range = dateWindow(req.query);
    const movements = await StockMovement.find({ createdAt: { $gte: range.start, $lt: range.end }, $or: [
      { movementType: 'OUT', reason: 'ORDER_PICKUP' }, { movementType: 'WASTE', reason: 'PRODUCTION_WASTE' }
    ] }).sort({ createdAt: -1 }).limit(1000).lean();
    res.json({ movements });
  }));

  app.patch('/api/inventory/:id/cost-basis', requireAdmin, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, 'Invalid inventory item.');
    const unitCost = req.body?.unitCost;
    const reason = text(req.body?.reason);
    if (typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1e7 || reason.length < 5) fail(400, 'Enter a valid non-negative unit cost and an audit reason of at least five characters.');
    const item = await Inventory.findById(req.params.id);
    if (!item) fail(404, 'Inventory material not found.');
    const previousValue = { costPerUnit: item.costPerUnit, costBasisKnown: item.costBasisKnown };
    const timestamp = new Date();
    item.costPerUnit = unitCost;
    item.costBasisKnown = true;
    item.costBasisUpdatedAt = timestamp;
    item.costBasisUpdatedBy = req.user.id;
    item.costBasisAudit.push({ previousCostPerUnit: previousValue.costBasisKnown ? previousValue.costPerUnit : null, costPerUnit: unitCost, reason, updatedBy: req.user.id, updatedAt: timestamp });
    await item.save();
    await audit(req, 'SET_INVENTORY_COST_BASIS', 'Inventory', String(item._id), previousValue, { costPerUnit: unitCost, reason });
    res.json({ inventory: item });
  }));

  app.post('/api/admin/financial/expenses/:id/void', requireAdmin, wrap(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) fail(400, 'Invalid expense record.');
    const reason = text(req.body?.reason);
    if (reason.length < 5) fail(400, 'Enter a reason of at least five characters to void this expense.');
    const record = await Expense.findOneAndUpdate(
      { _id: req.params.id, status: 'Active' },
      { $set: { status: 'Voided', voidReason: reason, updatedBy: req.user.id, updatedAt: new Date() }, $push: { auditHistory: { action: 'VOID', userId: req.user.id, userName: actorName(req.user), timestamp: new Date(), reason } } },
      { new: true, runValidators: true }
    );
    if (!record) fail(404, 'Active expense record not found.');
    await audit(req, 'VOID_EXPENSE', 'Expense', String(record._id), { status: 'Active' }, { status: 'Voided', reason });
    res.json({ expense: expenseView(record) });
  }));

  app.patch('/api/admin/financial/material-cost/:jobOrderId', requireAdmin, wrap(async (req, res) => {
    const reason = text(req.body?.reason);
    const inventoryId = text(req.body?.inventoryId, 24);
    const unitCost = req.body?.unitCost;
    if (reason.length < 5 || !mongoose.isValidObjectId(inventoryId) || typeof unitCost !== 'number' || !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 1e7) {
      fail(400, 'A valid inventory item, non-negative unit cost, and correction reason of at least five characters are required.');
    }
    const hello = await mongoose.connection.db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== 'isdbgrid') fail(503, 'Cost corrections require a MongoDB replica set. No financial history was changed.');
    const session = await mongoose.startSession();
    let result;
    try {
      await session.withTransaction(async () => {
        const job = await Production.findOne({ jobOrderId: req.params.jobOrderId, phase3: true }).session(session);
        if (!job) fail(404, 'Production job not found.');
        const material = job.reservedMaterials.find(row => String(row.inventoryId) === inventoryId && row.reservationStatus === 'consumed');
        if (!material) fail(404, 'Consumed material row not found for this job.');
        const inventory = await Inventory.findById(inventoryId).session(session);
        if (!inventory) fail(404, 'Inventory material not found.');
        const previousCost = material.unitCostSnapshot;
        const directCostCents = Math.round(material.quantity * unitCost * 100);
        material.unitCostSnapshot = unitCost;
        material.directCostCents = directCostCents;
        material.costDataComplete = true;
        await job.save({ session });
        const movement = await StockMovement.findOneAndUpdate(
          { orderId: job.orderId, jobOrderId: job.jobOrderId, inventoryId, reason: 'ORDER_PICKUP', movementType: 'OUT' },
          { $set: { unitCostSnapshot: unitCost, directCostCents, costDataComplete: true, notes: `Cost corrected by ${req.user.id}: ${reason}` } },
          { new: true, session }
        );
        if (!movement) fail(409, 'Matching stock movement was not found; no cost correction was applied.');
        const usage = (job.materialUsage || []).find(row => row.reservationId === material.reservationId);
        if (usage?.wastedQuantity > 0 && material.reservationId) {
          const wasteMovement = await StockMovement.findOneAndUpdate(
            { idempotencyKey: `${material.reservationId}:waste`, movementType: 'WASTE', reason: 'PRODUCTION_WASTE' },
            { $set: { unitCostSnapshot: unitCost, directCostCents: Math.round(usage.wastedQuantity * unitCost * 100), costDataComplete: true } },
            { new: true, session }
          );
          if (!wasteMovement) fail(409, 'Matching wastage cost record was not found; no cost correction was applied.');
        }
        await AuditLog.create([{
          userId: req.user.id, userName: actorName(req.user), role: 'admin', action: 'CORRECT_MATERIAL_COST',
          module: 'Financials', resourceType: 'StockMovement', resourceId: String(movement._id),
          previousValue: { unitCostSnapshot: previousCost }, newValue: { unitCostSnapshot: unitCost, directCostCents, reason }, timestamp: new Date()
        }], { session });
        result = { jobOrderId: job.jobOrderId, inventoryId, unitCostSnapshot: unitCost, directCostCents, reason };
      });
    } finally { await session.endSession(); }
    res.json({ correction: result });
  }));

  app.get('/api/admin/financial/export/:dataset', requireAdmin, wrap(async (req, res) => {
    const range = dateWindow(req.query);
    const dataset = req.params.dataset;
    if (dataset === 'orders') {
      const orders = await Order.find({ createdAt: { $gte: range.start, $lt: range.end } }).sort({ createdAt: 1 }).limit(10000).lean();
      return csv(res, `financial-orders-${range.from}-${range.to}.csv`,
        ['Order ID', 'Customer', 'Products', 'Order date', 'Fulfilled date', 'Order status', 'Payment status', 'Method', 'Order total PHP', 'Verified receipts PHP', 'Customer balance PHP', 'Resolution status', 'Refund liability PHP', 'Refunds paid PHP', 'Credits issued PHP', 'Source'],
        orders.map(order => {
          const refunds = resolutionEvents(order).filter(event => event.toStatus === 'REFUND_COMPLETED' && event.resolutionDate && inWindow(new Date(event.resolutionDate), range)).reduce((sum, event) => sum + Number(event.amountCents || 0), 0);
          const credits = resolutionEvents(order).filter(event => event.toStatus === 'CREDIT_ISSUED' && event.resolutionDate && inWindow(new Date(event.resolutionDate), range)).reduce((sum, event) => sum + Number(event.amountCents || 0), 0);
          const state = resolutionAtRangeEnd(order, range);
          const liability = ['REFUND_REQUIRED', 'REFUND_PENDING'].includes(state?.toStatus) ? Math.max(0, Number(state.originalVerifiedAmountCents || 0) - Number(state.accountedAmountCents || 0)) : 0;
          return [order.orderId, order.customerName, (order.items || []).map(item => `${item.productName} x ${item.quantity}`).join('; '), order.createdAt, order.pickedUpAt || order.completedAt, order.status, order.paymentStatus || 'Unknown', order.paymentMethod, (moneyCents(order.totalAmount) / 100).toFixed(2), (paymentAmountAllTime(order) / 100).toFixed(2), (Math.max(0, moneyCents(order.totalAmount) - paymentAmountAllTime(order)) / 100).toFixed(2), order.financialResolution?.status || 'NONE', (liability / 100).toFixed(2), (refunds / 100).toFixed(2), (credits / 100).toFixed(2), order.orderSource || 'online'];
        }));
    }
    if (dataset === 'expenses') {
      const expenses = await Expense.find({ expenseDate: { $gte: range.start, $lt: range.end } }).sort({ expenseDate: 1 }).limit(10000).lean();
      return csv(res, `financial-expenses-${range.from}-${range.to}.csv`,
        ['Date', 'Category', 'Description', 'Amount PHP', 'Payment status', 'Paid PHP', 'Method', 'Reference', 'Record status', 'Recorded by'],
        expenses.map(row => [row.expenseDate, row.category, row.description, (row.amountCents / 100).toFixed(2), row.paymentStatus, (row.paidAmountCents / 100).toFixed(2), row.paymentMethod, row.reference, row.status, row.recordedByName]));
    }
    if (dataset === 'purchases') {
      const inventory = await Inventory.find().select('material purchaseHistory').lean();
      const rows = inventory.flatMap(item => (item.purchaseHistory || []).filter(row => inWindow(new Date(row.purchasedAt), range)).map(row => [row.purchasedAt, item.material, row.quantity, (row.totalCostCents / 100).toFixed(2), (row.paidAmountCents / 100).toFixed(2), row.supplier, row.reference, row.recordedByName, row.notes]));
      return csv(res, `inventory-purchases-${range.from}-${range.to}.csv`, ['Date', 'Material', 'Quantity', 'Total cost PHP', 'Paid PHP', 'Supplier', 'Reference', 'Recorded by', 'Notes'], rows);
    }
    if (dataset === 'materials') {
      const rows = await StockMovement.find({ createdAt: { $gte: range.start, $lt: range.end }, $or: [
        { movementType: 'OUT', reason: 'ORDER_PICKUP' }, { movementType: 'WASTE', reason: 'PRODUCTION_WASTE' }
      ] }).sort({ createdAt: 1 }).limit(10000).lean();
      return csv(res, `material-costs-${range.from}-${range.to}.csv`,
        ['Date', 'Order ID', 'Job order ID', 'Material', 'Event', 'Quantity', 'Unit', 'Unit cost PHP', 'Cost PHP', 'Cost complete'],
        rows.map(row => [row.createdAt, row.orderId, row.jobOrderId, row.material, row.movementType === 'WASTE' ? 'Waste' : 'Consumed', row.quantity, row.unit, row.unitCostSnapshot == null ? '' : row.unitCostSnapshot.toFixed(6), row.directCostCents == null ? '' : (row.directCostCents / 100).toFixed(2), row.costDataComplete ? 'Yes' : 'No']));
    }
    fail(404, 'Choose orders, expenses, purchases or materials for export.');
  }));
}
