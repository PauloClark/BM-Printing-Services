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

  afterEach(() => {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = originalVercel;
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

  test('permits local development testing', () => {
    delete process.env.VERCEL;
    process.env.NODE_ENV = 'development';
    const res = response();
    const next = jest.fn();
    requireDurableUploadStorage({}, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.status).not.toHaveBeenCalled();
  });
});
