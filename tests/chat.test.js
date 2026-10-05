import express from 'express';
import request from 'supertest';
import chatRoutes from '../server/routes/chat.js';
import { businessKnowledge, businessKnowledgeSystemInstruction } from '../server/config/businessKnowledge.js';

test('builds verified knowledge from the current public business sources', () => {
  expect(businessKnowledge.contact.address).toBe('NHA Phase 2, R. Castillo Site and Services, Brgy. Gov. Duterte, Agdao, Davao City, Philippines');
  expect(businessKnowledge.contact.email).toBe('bmprintingservices11@gmail.com');
  expect(businessKnowledge.products).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: 'Polo Shirt', price: 500, currency: 'PHP', minimumQuantity: 1 })
  ]));
  expect(businessKnowledge.ordering.paymentMethods).toContain('GCash');
  expect(businessKnowledgeSystemInstruction).toContain('VERIFIED BUSINESS DATA');
});

describe('POST /api/chat', () => {
  let app;
  let originalApiKey;

  beforeEach(() => {
    originalApiKey = process.env.GEMINI_API_KEY;
    app = express();
    app.use(express.json());
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (originalApiKey === undefined) {
      delete process.env.GEMINI_API_KEY;
    } else {
      process.env.GEMINI_API_KEY = originalApiKey;
    }
  });

  test('rejects missing, non-string, empty, and oversized messages', async () => {
    chatRoutes(app, jest.fn());

    await request(app).post('/api/chat').send({}).expect(400);
    await request(app).post('/api/chat').send({ message: 42 }).expect(400);
    await request(app).post('/api/chat').send({ message: '   ' }).expect(400);
    await request(app).post('/api/chat').send({ message: 'x'.repeat(2001) }).expect(413);
  });

  test('returns a reply without exposing the API key', async () => {
    process.env.GEMINI_API_KEY = 'server-only-test-key';
    const generateReply = jest.fn().mockResolvedValue('We can help with printing questions.');
    chatRoutes(app, generateReply);

    const response = await request(app)
      .post('/api/chat')
      .send({ message: '  What services do you offer?  ' })
      .expect(200);

    expect(response.body).toEqual({ reply: 'We can help with printing questions.' });
    expect(JSON.stringify(response.body)).not.toContain('server-only-test-key');
    expect(generateReply).toHaveBeenCalledWith('What services do you offer?', 'server-only-test-key');
  });

  test('returns safe errors when configuration or Gemini is unavailable', async () => {
    delete process.env.GEMINI_API_KEY;
    chatRoutes(app, jest.fn());
    await request(app)
      .post('/api/chat')
      .send({ message: 'Hello' })
      .expect(503, { error: 'Chat service is currently unavailable.' });

    process.env.GEMINI_API_KEY = 'server-only-test-key';
    app = express();
    app.use(express.json());
    const logError = jest.spyOn(console, 'error').mockImplementation(() => {});
    const upstreamError = Object.assign(new Error('sensitive upstream details server-only-test-key'), { status: 503 });
    chatRoutes(app, jest.fn().mockRejectedValue(upstreamError));
    const response = await request(app)
      .post('/api/chat')
      .send({ message: 'Hello' })
      .expect(502);

    expect(response.body.error).toBe('Unable to generate a reply right now.');
    expect(JSON.stringify(response.body)).not.toContain('sensitive upstream details');
    expect(logError).toHaveBeenCalledWith(expect.stringContaining('HTTP 503 Error'));
    expect(logError.mock.calls.flat().join(' ')).toContain('sensitive upstream details');
    expect(logError.mock.calls.flat().join(' ')).not.toContain('server-only-test-key');
  });
});