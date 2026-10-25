import ExcelJS from 'exceljs';
import { Order } from '../server/db.js';
import { getReportSummary, readReportFile } from '../server/reportService.js';

jest.mock('../server/db.js', () => ({ Order: { find: jest.fn() } }));

const order = {
  orderId: 'ORD-HOST-001', customerName: 'Hosting Test', customerEmail: 'qa@example.com',
  contactNumber: '09000000000', totalAmount: 250, status: 'Completed',
  createdAt: new Date('2026-10-25T03:00:00Z'),
  items: [{ productName: 'Sticker', quantity: 5, unitPrice: 50, subtotal: 250 }]
};

function mockDownloadQueries() {
  Order.find
    .mockReturnValueOnce({ sort: jest.fn().mockResolvedValue([order]) })
    .mockReturnValueOnce({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([{ totalAmount: 250 }]) })) });
}

describe('on-demand daily Excel reports', () => {
  beforeEach(() => jest.clearAllMocks());

  it('generates a downloadable workbook in memory without a local report file', async () => {
    mockDownloadQueries();
    const report = await readReportFile('2026-10-25');
    expect(report.fileName).toBe('2026-10-25.xlsx');
    expect(Buffer.isBuffer(report.data)).toBe(true);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(report.data);
    expect(workbook.getWorksheet('Daily Orders').getCell('A2').value).toBe('ORD-HOST-001');
    expect(report).not.toHaveProperty('filePath');
  });

  it('exposes a download only when the selected date has orders', async () => {
    Order.find
      .mockResolvedValueOnce([order])
      .mockReturnValueOnce({ select: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([{ totalAmount: 250 }]) })) });
    const summary = await getReportSummary('2026-10-25');
    expect(summary.exists).toBe(true);
    expect(summary.downloadUrl).toBe('/api/admin/reports/orders/2026-10-25/download');
  });
});
