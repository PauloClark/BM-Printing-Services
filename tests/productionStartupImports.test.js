import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';

describe('production backend startup imports', () => {
  it('loads the backend module when mongodb-memory-server is unavailable', () => {
    const loader = pathToFileURL(path.join(process.cwd(), 'tests/fixtures/blockMongoMemoryServerLoader.mjs')).href;
    const result = spawnSync(process.execPath, ['--experimental-loader', loader, '--input-type=module', '--eval', "await import('./server.js')"], {
      cwd: process.cwd(), encoding: 'utf8', env: {
        ...process.env, NODE_ENV: 'production', DEPLOYMENT_ENVIRONMENT: 'staging',
        MONGODB_URI: 'mongodb+srv://cluster.example.test/bmprinting_staging', MONGODB_DB_NAME: 'bmprinting_staging',
        ALLOW_IN_MEMORY_DB: 'false', SEED_DEFAULT_ADMIN: 'false'
      }
    });
    if (result.status !== 0) throw new Error(`${result.stdout}\n${result.stderr}`);
    expect(result.status).toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).not.toContain('mongodb-memory-server must not resolve');
  });

  it('keeps Render\'s npm run validate command bound to backend-only validation', () => {
    const scripts = JSON.parse(readFileSync('package.json', 'utf8')).scripts;
    expect(scripts.validate).toBe('npm run validate:backend-env');
  });
});
