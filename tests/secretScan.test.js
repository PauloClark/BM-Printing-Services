import { secretFindings } from '../scripts/secretScan.js';

describe('release secret exposure checks', () => {
  it('detects credentials without returning their values', () => {
    const secrets = ['sb_secret_' + 'x'.repeat(32), 'ghp_' + 'z'.repeat(36), '-----BEGIN ' + 'PRIVATE KEY-----', 'mongodb+srv://' + 'person:not-a-real-password@cluster.mongodb.net/db'];
    for (const secret of secrets) {
      const findings = secretFindings(`first line\n${secret}`);
      expect(findings.length).toBeGreaterThan(0);
      expect(findings[0].line).toBe(2);
      expect(JSON.stringify(findings)).not.toContain(secret);
    }
  });

  it('permits labelled template database credentials and public anon JWTs, but rejects service-role JWTs', () => {
    expect(secretFindings('mongodb+srv://' + 'USERNAME:PASSWORD@CLUSTER/database')).toEqual([]);
    const jwt = role => [Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url'), Buffer.from(JSON.stringify({ role, ref: 'offline' })).toString('base64url'), 'x'.repeat(32)].join('.');
    expect(secretFindings(jwt('anon'))).toEqual([]);
    expect(secretFindings(jwt('service_role'))).toEqual([expect.objectContaining({ kind: 'jwt' })]);
  });

  it('detects a backend canary embedded under an unrelated public name', () => {
    const secret = 'ci-canary-not-an-actual-provider-credential';
    expect(secretFindings(`const display = ${JSON.stringify(secret)}`, { forbiddenValues: [secret] }))
      .toEqual([{ kind: 'backend-secret-value', line: null }]);
    expect(secretFindings('public configuration', { forbiddenValues: [secret] })).toEqual([]);
  });
});
