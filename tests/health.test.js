import request from 'supertest';
import { setupTestDB, teardownTestDB } from './setup.js';

let app;

beforeAll(async () => {
  await setupTestDB();
  const express = (await import('express')).default;
  const cors = (await import('cors')).default;
  const mongoose = (await import('mongoose')).default;
  const fs = await import('fs');
  const path = await import('path');

  app = express();
  app.use(express.json({ limit: '50mb' }));
  app.use(cors());

  app.get('/api/health', async (req, res) => {
    try {
      const dbState = mongoose.connection.readyState;
      const dbConnected = dbState === 1;
      const uploadsDir = path.join(process.cwd(), 'uploads');
      const uploadsExists = fs.existsSync(uploadsDir);
      let uploadsWritable = false;
      if (uploadsExists) {
        try {
          const testFile = path.join(uploadsDir, '.write-test');
          fs.writeFileSync(testFile, 'test');
          fs.unlinkSync(testFile);
          uploadsWritable = true;
        } catch { uploadsWritable = false; }
      }
      let excelAvailable = false;
      try {
        await import('exceljs');
        excelAvailable = true;
      } catch { excelAvailable = false; }
      const health = {
        status: 'ok',
        timestamp: new Date().toISOString(),
        services: {
          database: { status: dbConnected ? 'connected' : 'disconnected' },
          fileStorage: { status: uploadsExists && uploadsWritable ? 'available' : 'missing' },
          excelReport: { status: excelAvailable ? 'available' : 'unavailable' }
        }
      };
      if (!dbConnected || !uploadsExists || !excelAvailable) health.status = 'degraded';
      res.json(health);
    } catch (error) {
      res.json({ status: 'error', timestamp: new Date().toISOString(), error: error.message });
    }
  });
});

afterAll(async () => {
  await teardownTestDB();
});

describe('System Health', () => {
  it('should return healthy status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
    expect(res.body.services).toBeDefined();
    expect(res.body.services.database.status).toBe('connected');
  });

  it('should report database as connected', async () => {
    const res = await request(app).get('/api/health');
    expect(res.body.services.database.status).toBe('connected');
  });

  it('should report excel support', async () => {
    const res = await request(app).get('/api/health');
    expect(['available', 'unavailable']).toContain(res.body.services.excelReport.status);
  });
});
