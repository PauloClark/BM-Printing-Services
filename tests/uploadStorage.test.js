import { createClient } from '@supabase/supabase-js';
import { downloadPrivateFile, storageConfigured, storePrivateFile } from '../server/uploadStorage.js';

jest.mock('@supabase/supabase-js', () => ({ createClient: jest.fn() }));

describe('private Supabase upload storage', () => {
  const keys = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_STORAGE_BUCKET', 'SUPABASE_SERVICE_ROLE_KEY'];
  const originals = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  let getBucket, upload, download, remove;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'https://project.supabase.co';
    delete process.env.VITE_SUPABASE_URL;
    process.env.SUPABASE_STORAGE_BUCKET = 'private-order-files';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'server-only-test-key';
    getBucket = jest.fn().mockResolvedValue({ data: { public: false }, error: null });
    upload = jest.fn().mockResolvedValue({ error: null });
    download = jest.fn().mockResolvedValue({ data: new Blob(['design']), error: null });
    remove = jest.fn().mockResolvedValue({ error: null });
    createClient.mockReturnValue({ storage: { getBucket, from: jest.fn(() => ({ upload, download, remove })) } });
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('stores artwork and receipts under safe order-scoped paths in the private bucket', async () => {
    const file = { filename: 'art.png', base64: 'data:image/png;base64,dGVzdA==' };
    const design = await storePrivateFile(file, 'ORD-ABC123', 'design');
    const receipt = await storePrivateFile(file, 'ORD-ABC123', 'receipt');
    expect(design.filePath).toMatch(/^supabase:\/\/private-order-files\/ORD-ABC123\/design\//);
    expect(receipt.filePath).toMatch(/^supabase:\/\/private-order-files\/ORD-ABC123\/receipt\//);
    expect(upload).toHaveBeenCalledTimes(2);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/png', upsert: false });
    expect(getBucket).toHaveBeenCalledWith('private-order-files');
  });

  it('rejects public buckets and unsafe object path segments', async () => {
    getBucket.mockResolvedValue({ data: { public: true }, error: null });
    await expect(storePrivateFile({ filename: 'art.png', base64: 'data:image/png;base64,dGVzdA==' }, 'ORD-ABC123')).rejects.toThrow(/private Storage bucket/i);
    expect(upload).not.toHaveBeenCalled();
    await expect(storePrivateFile({ filename: 'art.png', base64: 'data:image/png;base64,dGVzdA==' }, '../outside')).rejects.toThrow(/storage path/i);
  });

  it('checks the bucket remains private before download and rejects references to another bucket', async () => {
    const file = await downloadPrivateFile('supabase://private-order-files/ORD-ABC123/design/art.png');
    expect(Buffer.from(file.bytes).toString()).toBe('design');
    getBucket.mockResolvedValue({ data: { public: true }, error: null });
    await expect(downloadPrivateFile('supabase://private-order-files/ORD-ABC123/design/art.png')).rejects.toThrow(/private Storage bucket/i);
    await expect(downloadPrivateFile('supabase://other-bucket/ORD-ABC123/design/art.png')).rejects.toThrow(/bucket reference/i);
    expect(download).toHaveBeenCalledTimes(1);
  });

  it('reports durable storage as unavailable when any required setting is missing or invalid', () => {
    expect(storageConfigured()).toBe(true);
    delete process.env.SUPABASE_STORAGE_BUCKET;
    expect(storageConfigured()).toBe(false);
    process.env.SUPABASE_STORAGE_BUCKET = 'private-order-files';
    process.env.SUPABASE_URL = 'http://project.supabase.co';
    expect(storageConfigured()).toBe(false);
  });
});
