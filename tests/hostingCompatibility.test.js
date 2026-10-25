import request from 'supertest';
import express from 'express';
import { API_JSON_BODY_LIMIT, handleJsonBodyError } from '../server/httpRuntime.js';

const app = express();
app.use(express.json({ limit: API_JSON_BODY_LIMIT }));
app.post('/upload-contract', (_req, res) => res.status(204).end());
app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
app.use(handleJsonBodyError);

describe('persistent API hosting compatibility', () => {
  it('keeps enough JSON headroom for a 10 MiB base64 upload', async () => {
    expect(API_JSON_BODY_LIMIT).toBe('15mb');
    const base64 = Buffer.alloc(10 * 1024 * 1024).toString('base64');
    const response = await request(app)
      .post('/upload-contract')
      .send({ designFile: { filename: 'art.png', base64: `data:image/png;base64,${base64}` } });
    expect(response.status).toBe(204);
  });

  it('rejects an oversized JSON request with a safe 413 response', async () => {
    const response = await request(app)
      .post('/upload-contract')
      .send({ oversized: 'x'.repeat(16 * 1024 * 1024) });
    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: 'Request body is too large.', code: 'REQUEST_BODY_TOO_LARGE' });
  });

  it('provides a database-independent liveness endpoint', async () => {
    const response = await request(app).get('/health/live');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });
});
