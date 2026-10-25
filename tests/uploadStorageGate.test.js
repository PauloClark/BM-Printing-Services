import { requireDurableUploadStorage } from '../server/uploadStorage.js';

const response = () => {
  const res = {};
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  return res;
};

describe('production upload storage gate', () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalVercel = process.env.VERCEL;
  const originalStorageEnv = Object.fromEntries(['SUPABASE_STORAGE_BUCKET', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'VITE_SUPABASE_URL'].map(key => [key, process.env[key]]));

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
    for (const [key, value] of Object.entries(originalStorageEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  test('blocks upload-backed operations on Vercel', () => {
    process.env.VERCEL = '1';
    const res = response();
    const next = jest.fn();
    requireDurableUploadStorage({}, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DURABLE_UPLOAD_STORAGE_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('fails safely in production when durable storage is absent', () => {
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'production';
    delete process.env.SUPABASE_STORAGE_BUCKET;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.VITE_SUPABASE_URL;
    const res = response();
    const next = jest.fn();
    requireDurableUploadStorage({}, res, next);
    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'DURABLE_UPLOAD_STORAGE_REQUIRED' }));
    expect(next).not.toHaveBeenCalled();
  });

  test('permits local development testing', () => {
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'development';
    const res = response();
    const next = jest.fn();
    requireDurableUploadStorage({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });

  test('permits production uploads only when durable storage credentials and bucket are configured', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.VERCEL;
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    process.env.SUPABASE_STORAGE_BUCKET = 'private-order-files';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';
    const res = response();
    const next = jest.fn();
    requireDurableUploadStorage({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
