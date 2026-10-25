import express from 'express';
import mongoose from 'mongoose';
import request from 'supertest';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { AuditLog, Expense, Inventory, Order, Production, StockMovement, User } from '../server/db.js';
import financialRoutes from '../server/routes/financials.js';
import phase3Routes from '../server/routes/jobOrders.js';
import { generateToken } from '../server/middleware/auth.js';

jest.mock('../server/utils.js', () => ({
  safeText: value => typeof value === 'string' ? value : '',
  serializeOrder: order => typeof order.serialize === 'function' ? order.serialize() : ({ ...order, id: order.orderId, total: order.totalAmount }),
  uploadDesignFile: jest.fn()
}));
jest.mock('../server/staffDirectory.js', () => ({
  listAssignableStaff: jest.fn().mockResolvedValue([]),
  verifyAssignableStaff: jest.fn()
}));
jest.mock('../server/notificationService.js', () => ({
  createNotification: jest.fn(), notifyAdmins: jest.fn(), safeNotify: jest.fn()
}));

let mongoServer;
let app;
let adminToken;
let staffToken;
const range = { from: '2026-10-01', to: '2026-10-31' };
const auth = token => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
  app = express();
  app.use(express.json());
  financialRoutes(app);
  phase3Routes(app);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

beforeEach(async () => {
  await Promise.all(Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})));
  const admin = await User.create({ id: 'financial-admin', name: 'Finance Admin', email: 'finance-admin@example.test', role: 'admin' });
  const staff = await User.create({ id: 'financial-staff', name: 'Finance Staff', email: 'finance-staff@example.test', role: 'staff' });
  adminToken = generateToken(admin);
  staffToken = generateToken(staff);
});

describe('Admin financial management', () => {
  it('separates verified cash, fulfilled revenue, outstanding balances, direct costs, and expenses', async () => {
    const inventory = await Inventory.create({ material: 'Paper', type: 'Paper', quantity: 4, unit: 'ream', costPerUnit: 5, costBasisKnown: true });
    const fulfilled = await Order.create({
      orderId: 'FIN-FULFILLED', customerName: 'Customer', items: [{ productId: 1, productName: 'Print', quantity: 1, unitPrice: 1500, subtotal: 1500 }],
      totalAmount: 1500, status: 'Picked Up', pickedUpAt: new Date('2026-10-12T04:00:00.000Z'),
      cashPayment: { amount: 1000, verifiedBy: 'financial-admin', verifiedAt: new Date('2026-10-12T04:00:00.000Z') },
      paymentSubmissions: [{ customerId: 'customer', paymentMethod: 'GCash', amount: 500, referenceNumber: 'REF-500', receiptFileName: 'receipt.png', receiptFilePath: 'receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', status: 'Verified', verifiedBy: 'financial-admin', verifiedAt: new Date('2026-10-12T04:00:00.000Z') }]
    });
    await Order.create({
      orderId: 'FIN-CANCELLED', customerName: 'Customer', totalAmount: 500, status: 'Cancelled',
      cashPayment: { amount: 100, verifiedBy: 'financial-admin', verifiedAt: new Date('2026-10-13T04:00:00.000Z') }
    });
    await Order.create({
      orderId: 'FIN-UNCONFIRMED', customerName: 'Customer', totalAmount: 300, status: 'Pending', paymentStatus: 'Verified',
      paymentSubmissions: [{ customerId: 'customer', paymentMethod: 'Maya', amount: 300, referenceNumber: 'REF-300', receiptFileName: 'receipt.png', receiptFilePath: 'receipt.png', receiptOriginalName: 'receipt.png', receiptFileType: 'image/png', status: 'Verified', verifiedAt: new Date('2026-10-14T04:00:00.000Z') }]
    });
    await Production.create({
      phase3: true, jobOrderId: 'FIN-JOB', orderId: fulfilled.orderId, status: 'Ready for Pickup',
      reservedMaterials: [{ inventoryId: inventory._id, material: inventory.material, unit: inventory.unit, quantity: 2, reservationStatus: 'consumed', unitCostSnapshot: 5, directCostCents: 1000, costDataComplete: true }]
    });
    await StockMovement.create({
      orderId: fulfilled.orderId, jobOrderId: 'FIN-JOB', inventoryId: inventory._id, material: inventory.material, unit: inventory.unit,
      quantity: 2, movementType: 'OUT', reason: 'ORDER_PICKUP', performedBy: 'staff', directCostCents: 1000, unitCostSnapshot: 5,
      costDataComplete: true, createdAt: new Date('2026-10-12T04:00:00.000Z')
    });
    await StockMovement.create({
      orderId: fulfilled.orderId, jobOrderId: 'FIN-JOB', inventoryId: inventory._id, material: inventory.material, unit: inventory.unit,
      quantity: 0.25, movementType: 'WASTE', reason: 'PRODUCTION_WASTE', performedBy: 'staff', directCostCents: 125, unitCostSnapshot: 5,
      costDataComplete: true, createdAt: new Date('2026-10-12T04:00:00.000Z')
    });
    await Expense.create({
      expenseDate: new Date('2026-10-10T04:00:00.000Z'), paidAt: new Date('2026-10-15T04:00:00.000Z'),
      category: 'Utilities', description: 'Electricity', amountCents: 5000, paymentStatus: 'Paid', paidAmountCents: 5000,
      recordedBy: 'financial-admin'
    });

    const response = await request(app).get(`/api/admin/financial/summary?${queryString(range)}`).set(auth(adminToken));
    expect(response.status).toBe(200);
    expect(response.body.totals.verifiedPaymentsReceivedCents).toBe(160000);
    expect(response.body.totals.fulfilledSalesRevenueCents).toBe(150000);
    expect(response.body.totals.bookedOrderValueCents).toBe(230000);
    expect(response.body.totals.directMaterialCostsCents).toBe(1000);
    expect(response.body.totals.wastageCostCents).toBe(125);
    expect(response.body.totals.grossProfitCents).toBe(149000);
    expect(response.body.totals.inventoryValuationCents).toBe(2000);
    expect(response.body.totals.operatingExpensesCents).toBe(5000);
    expect(response.body.totals.netCashMovementCents).toBe(155000);
    expect(response.body.totals.outstandingBalanceCents).toBe(30000);
    expect(response.body.completeness.isComplete).toBe(true);
    expect(response.body.refundsSupported).toBe(true);
    expect(response.body.jobProfitability).toContainEqual(expect.objectContaining({
      orderId: 'FIN-FULFILLED', directMaterialCostsCents: 1000, grossProfitCents: 149000, costDataComplete: true
    }));
  });

  it('separates cancelled-order receipts, paid refunds, pending liabilities, and customer credits', async () => {
    const when = new Date('2026-10-12T04:00:00.000Z');
    const makePaidCancelled = (orderId, totalAmount, financialResolution, event) => Order.create({
      orderId, customerName: 'Customer', totalAmount, status: 'Cancelled', paymentStatus: 'Verified',
      createdAt: when, cashPayment: { amount: totalAmount, verifiedBy: 'financial-admin', verifiedAt: when },
      financialResolution, financialResolutionEvents: event ? [event] : []
    });
    await makePaidCancelled('REFUND-OWED', 100, {
      status: 'REFUND_PENDING', originalVerifiedAmountCents: 10000, accountedAmountCents: 0
    }, { toStatus: 'REFUND_PENDING', originalVerifiedAmountCents: 10000, accountedAmountCents: 0, occurredAt: when });
    await makePaidCancelled('REFUND-DONE', 200, {
      status: 'REFUND_COMPLETED', originalVerifiedAmountCents: 20000, accountedAmountCents: 20000
    }, { toStatus: 'REFUND_COMPLETED', amountCents: 20000, originalVerifiedAmountCents: 20000, accountedAmountCents: 20000, resolutionDate: new Date('2026-10-14T04:00:00.000Z'), occurredAt: when });
    await makePaidCancelled('CREDIT-DONE', 300, {
      status: 'CREDIT_ISSUED', originalVerifiedAmountCents: 30000, accountedAmountCents: 30000
    }, { toStatus: 'CREDIT_ISSUED', amountCents: 30000, originalVerifiedAmountCents: 30000, accountedAmountCents: 30000, resolutionDate: new Date('2026-10-15T04:00:00.000Z'), occurredAt: when });

    const response = await request(app).get(`/api/admin/financial/summary?${queryString(range)}`).set(auth(adminToken));
    expect(response.status).toBe(200);
    expect(response.body.totals).toMatchObject({
      bookedOrderValueCents: 60000,
      verifiedPaymentsReceivedCents: 60000,
      fulfilledSalesRevenueCents: 0,
      refundsPaidCents: 20000,
      outstandingRefundLiabilityCents: 10000,
      customerCreditsIssuedCents: 30000,
      netCashMovementCents: 40000
    });
  });

  it('records, corrects, voids, and retains expenses with Admin audit history', async () => {
    const url = '/api/admin/financial/expenses';
    const created = await request(app).post(url).set(auth(adminToken)).send({
      expenseDate: '2026-10-10', paidAt: '2026-10-11', category: 'Delivery', description: 'Courier',
      amount: 120, paidAmount: 120, paymentStatus: 'Paid', paymentMethod: 'Cash', reference: 'REC-1'
    });
    expect(created.status).toBe(201);
    expect(created.body.expense.auditHistory).toHaveLength(1);
    const corrected = await request(app).patch(`${url}/${created.body.expense.id}`).set(auth(adminToken)).send({ amount: 125, paidAmount: 125, paidAt: '2026-10-11', reason: 'Corrected to match receipt.' });
    expect(corrected.status).toBe(200);
    expect(corrected.body.expense.amountCents).toBe(12500);
    expect(corrected.body.expense.auditHistory).toHaveLength(2);
    const voided = await request(app).post(`${url}/${created.body.expense.id}/void`).set(auth(adminToken)).send({ reason: 'Duplicate receipt entry.' });
    expect(voided.status).toBe(200);
    expect(voided.body.expense.status).toBe('Voided');
    expect(voided.body.expense.auditHistory).toHaveLength(3);
    expect(await Expense.countDocuments({ status: 'Voided' })).toBe(1);
    expect(await AuditLog.countDocuments({ module: 'Financials' })).toBe(3);
  });

  it('keeps stock purchase restocking idempotent and unknown opening costs incomplete', async () => {
    const inventory = await Inventory.create({ material: 'Vinyl', type: 'Vinyl', quantity: 0, unit: 'sqm' });
    const purchase = {
      inventoryId: String(inventory._id), purchaseId: 'abcdef0123456789abcdef01', quantity: 2, totalCost: 12,
      paidAmount: 8, purchaseDate: '2026-10-08', paidDate: '2026-10-09', supplier: 'Supplier', reference: 'INV-2'
    };
    const first = await request(app).post('/api/inventory/stock-in').set(auth(adminToken)).send(purchase);
    expect(first.status).toBe(201);
    expect(first.body.inventory.quantity).toBe(2);
    expect(first.body.inventory.costBasisKnown).toBe(true);
    expect(first.body.inventory.costPerUnit).toBe(6);
    expect(await StockMovement.countDocuments({ inventoryId: inventory._id, reason: 'RESTOCK' })).toBe(1);
    const retry = await request(app).post('/api/inventory/stock-in').set(auth(adminToken)).send(purchase);
    expect(retry.status).toBe(200);
    expect(retry.body.duplicate).toBe(true);
    const saved = await Inventory.findById(inventory._id);
    expect(saved.quantity).toBe(2);
    expect(saved.purchaseHistory).toHaveLength(1);
    expect(await StockMovement.countDocuments({ inventoryId: inventory._id, reason: 'RESTOCK' })).toBe(1);
    expect(saved.purchaseHistory[0].paidAmountCents).toBe(800);
    const unknown = await Inventory.create({ material: 'Existing stock', type: 'Paper', quantity: 5 });
    const restock = await request(app).post('/api/inventory/stock-in').set(auth(adminToken)).send({
      ...purchase, inventoryId: String(unknown._id), purchaseId: 'abcdef0123456789abcdef02'
    });
    expect(restock.status).toBe(201);
    expect(restock.body.inventory.costBasisKnown).toBe(false);
  });

  it('denies staff financial access and blocks cost correction without transaction support', async () => {
    const forbidden = await request(app).get(`/api/admin/financial/summary?${queryString(range)}`).set(auth(staffToken));
    expect(forbidden.status).toBe(403);
    const inventory = await Inventory.create({ material: 'Ink', type: 'Ink', quantity: 1 });
    await Order.create({ orderId: 'COST-ORDER', customerName: 'Customer', totalAmount: 1, status: 'Picked Up' });
    await Production.create({
      phase3: true, jobOrderId: 'COST-JOB', orderId: 'COST-ORDER', status: 'Ready for Pickup',
      reservedMaterials: [{ inventoryId: inventory._id, material: 'Ink', unit: 'liter', quantity: 1, reservationStatus: 'consumed' }]
    });
    const movement = await StockMovement.create({
      orderId: 'COST-ORDER', jobOrderId: 'COST-JOB', inventoryId: inventory._id, material: 'Ink', quantity: 1,
      movementType: 'OUT', reason: 'ORDER_PICKUP', performedBy: 'staff', costDataComplete: false
    });
    const response = await request(app).patch('/api/admin/financial/material-cost/COST-JOB').set(auth(adminToken)).send({
      inventoryId: String(inventory._id), unitCost: 4, reason: 'Invoice indicates cost.'
    });
    expect(response.status).toBe(503);
    expect((await StockMovement.findById(movement._id)).costDataComplete).toBe(false);
  });

  it('escapes spreadsheet formulas in financial exports and validates date ranges', async () => {
    await Order.create({ orderId: 'FIN-CSV', customerName: '=HYPERLINK("x")', totalAmount: 10, status: 'Pending', createdAt: new Date('2026-10-10T04:00:00.000Z') });
    const exported = await request(app).get(`/api/admin/financial/export/orders?${queryString(range)}`).set(auth(adminToken));
    expect(exported.status).toBe(200);
    expect(exported.text).toContain("'=HYPERLINK");
    const invalid = await request(app).get('/api/admin/financial/summary?from=2026-02-31&to=2026-03-01').set(auth(adminToken));
    expect(invalid.status).toBe(400);
  });
});

function queryString(values) {
  return new URLSearchParams(values).toString();
}
