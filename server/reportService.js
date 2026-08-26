import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { Order } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPORTS_DIR = path.join(__dirname, '..', 'reports', 'orders');

function toManilaDate(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Manila',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function toManilaTime(date) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Manila',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date);
}

function validateDateString(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(`${date}T00:00:00`);
  return !Number.isNaN(parsed.getTime());
}

function toCurrency(value) {
  return `₱${Number(value || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function buildRows(orders) {
  return orders.flatMap(order => {
    const orderDate = toManilaDate(order.createdAt || new Date());
    const orderTime = toManilaTime(order.createdAt || new Date());
    return (order.items || []).map(item => ({
      orderId: order.orderId,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      contactNumber: order.contactNumber,
      product: item.productName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      subtotal: item.subtotal,
      totalPrice: order.totalAmount,
      status: order.status,
      orderDate,
      orderTime
    }));
  });
}

async function ensureReportsDir() {
  await fs.mkdir(REPORTS_DIR, { recursive: true });
}

export async function generateDailyReport(dateString, options = {}) {
  if (!validateDateString(dateString)) {
    throw new Error('Invalid report date. Use YYYY-MM-DD.');
  }

  await ensureReportsDir();
  const start = new Date(`${dateString}T00:00:00+08:00`);
  const end = new Date(`${dateString}T23:59:59.999+08:00`);

  const orders = await Order.find({
    createdAt: { $gte: start, $lte: end }
  }).sort({ createdAt: 1 });

  const filePath = path.join(REPORTS_DIR, `${dateString}.xlsx`);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'BM Printing Services';
  workbook.lastModifiedBy = 'BM Printing Services';
  const sheet = workbook.addWorksheet('Daily Orders');

  sheet.columns = [
    { header: 'Order ID', key: 'orderId', width: 16 },
    { header: 'Customer Name', key: 'customerName', width: 24 },
    { header: 'Customer Email', key: 'customerEmail', width: 28 },
    { header: 'Contact Number', key: 'contactNumber', width: 18 },
    { header: 'Product', key: 'product', width: 24 },
    { header: 'Quantity', key: 'quantity', width: 10 },
    { header: 'Unit Price', key: 'unitPrice', width: 13 },
    { header: 'Subtotal', key: 'subtotal', width: 13 },
    { header: 'Total Price', key: 'totalPrice', width: 14 },
    { header: 'Order Status', key: 'status', width: 16 },
    { header: 'Order Date', key: 'orderDate', width: 15 },
    { header: 'Order Time', key: 'orderTime', width: 12 }
  ];

  const rows = buildRows(orders);
  rows.forEach(row => {
    sheet.addRow({
      orderId: row.orderId,
      customerName: row.customerName,
      customerEmail: row.customerEmail,
      contactNumber: row.contactNumber,
      product: row.product,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      subtotal: row.subtotal,
      totalPrice: row.totalPrice,
      status: row.status,
      orderDate: row.orderDate,
      orderTime: row.orderTime
    });
  });

  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF8B1A1A' }
  };
  sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
  sheet.views = [{ state: 'frozen', xSplit: 0, ySplit: 1 }];
  sheet.autoFilter = { from: 'A1', to: `L${sheet.rowCount}` };

  sheet.getColumn('unitPrice').numFmt = '"₱"#,##0.00';
  sheet.getColumn('subtotal').numFmt = '"₱"#,##0.00';
  sheet.getColumn('totalPrice').numFmt = '"₱"#,##0.00';

  await workbook.xlsx.writeFile(filePath);
  return {
    filePath,
    fileName: path.basename(filePath),
    totalOrders: orders.length,
    totalSales: orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
    rows: rows.length
  };
}

export async function getReportSummary(dateString) {
  if (!validateDateString(dateString)) {
    throw new Error('Invalid report date. Use YYYY-MM-DD.');
  }

  const reportPath = path.join(REPORTS_DIR, `${dateString}.xlsx`);
  let exists = false;
  try {
    await fs.access(reportPath);
    exists = true;
  } catch {
    exists = false;
  }

  const orders = await Order.find({
    createdAt: {
      $gte: new Date(`${dateString}T00:00:00+08:00`),
      $lte: new Date(`${dateString}T23:59:59.999+08:00`)
    }
  });

  return {
    date: dateString,
    exists,
    fileName: exists ? `${dateString}.xlsx` : null,
    totalOrders: orders.length,
    totalSales: orders.reduce((sum, order) => sum + Number(order.totalAmount || 0), 0),
    downloadUrl: exists ? `/api/admin/reports/orders/${dateString}/download` : null
  };
}

export async function readReportFile(dateString) {
  if (!validateDateString(dateString)) {
    throw new Error('Invalid report date. Use YYYY-MM-DD.');
  }

  const filePath = path.join(REPORTS_DIR, `${dateString}.xlsx`);
  const data = await fs.readFile(filePath);
  return { filePath, data };
}

export function getDefaultReportDate() {
  return toManilaDate(new Date());
}

export function formatCurrency(value) {
  return toCurrency(value);
}
