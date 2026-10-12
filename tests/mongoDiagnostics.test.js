import { classifyMongoError, logMongoOperationFailure, mongoEnvironmentSummary, sanitizedMongoError } from '../server/mongoDiagnostics.js';

const nested = (name, code, syscall) => ({
  name: 'MongooseServerSelectionError',
  reason: { type: 'ReplicaSetNoPrimary', servers: new Map([['hidden-node', { error: { name, code, syscall, message: 'sensitive-source-message' } }]]) },
  message: 'sensitive-top-level-message'
});

describe('sanitized MongoDB diagnostics', () => {
  test.each([
    [nested('Error', 'ENOTFOUND', 'querySrv'), 'dns'],
    [nested('MongoServerError', '18'), 'authentication'],
    [nested('MongoServerError', '13'), 'authorization'],
    [nested('MongoNetworkTimeoutError', 'ETIMEDOUT'), 'timeout'],
    [nested('Error', 'ERR_TLS_CERT_ALTNAME_INVALID'), 'tls'],
    [nested('MongoNetworkError', 'ECONNREFUSED', 'connect'), 'network']
  ])('classifies safe failure categories', (error, expected) => {
    expect(classifyMongoError(error)).toBe(expected);
  });

  test('never includes messages, hosts, URIs or credentials', () => {
    const output = JSON.stringify(sanitizedMongoError(nested('Error', 'ENOTFOUND', 'querySrv')));
    expect(output).toContain('dns');
    for (const privateValue of ['message', 'hidden-node', 'sensitive-source-message', 'sensitive-top-level-message']) expect(output).not.toContain(privateValue);
  });

  test('reports presence and safe option formats without connection values', () => {
    expect(mongoEnvironmentSummary({
      NODE_ENV: 'production', VERCEL: '1', MONGODB_URI: 'mongodb+srv://opaque',
      MONGODB_DB_NAME: 'bmprinting', MONGODB_MAX_POOL_SIZE: '10', MONGODB_SERVER_SELECTION_TIMEOUT_MS: '15000'
    })).toEqual({
      production: true, vercel: true, uriPresent: true, uriScheme: 'mongodb+srv', databaseName: 'bmprinting',
      maxPoolSize: 10, serverSelectionTimeoutMs: 15000
    });
  });

  test('operation logging includes only the allowlisted operation and sanitized error', () => {
    const logger = jest.fn();
    logMongoOperationFailure('products.list-public', nested('MongoServerError', '13'), logger);
    const output = logger.mock.calls.flat().join(' ');
    expect(output).toContain('products.list-public');
    for (const privateValue of ['hidden-node', 'sensitive-source-message']) expect(output).not.toContain(privateValue);
  });
});
