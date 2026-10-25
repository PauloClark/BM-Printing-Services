import { spawnSync } from 'node:child_process';
import { syntheticDeploymentEnvironment, isolatedCheckEnvironment } from '../scripts/ci-environment.js';

describe('deployment validation at executable boundaries', () => {
  it('rejects invalid backend configuration before any database connection', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import mongoose from 'mongoose';
      mongoose.connect = async () => { throw new Error('DATABASE_CONNECTION_MUST_NOT_RUN'); };
      const { startServer } = await import('./server.js');
      await startServer();
    `], { encoding: 'utf8', env: {
      ...isolatedCheckEnvironment(), ...syntheticDeploymentEnvironment(),
      MONGODB_URI: 'not-an-atlas-uri', JWT_SECRET: 'private-canary-that-must-not-be-logged'
    } });
    expect(result.status).toBe(1);
    const output = `${result.stdout}\n${result.stderr}`;
    expect(output).toContain('Deployment environment validation failed (backend)');
    expect(output).toContain('MONGODB_URI');
    expect(output).not.toContain('DATABASE_CONNECTION_MUST_NOT_RUN');
    expect(output).not.toContain('private-canary-that-must-not-be-logged');
  });

  it('rejects a missing deployment environment on a production backend without connecting', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
      import mongoose from 'mongoose';
      mongoose.connect = async () => { throw new Error('DATABASE_CONNECTION_MUST_NOT_RUN'); };
      const { startServer } = await import('./server.js');
      await startServer();
    `], { encoding: 'utf8', env: {
      ...isolatedCheckEnvironment(), NODE_ENV: 'production'
    } });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('DEPLOYMENT_ENVIRONMENT');
    expect(result.stderr).not.toContain('DATABASE_CONNECTION_MUST_NOT_RUN');
  });

  it('fails the Vercel build before bundling a server credential', () => {
    const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
      encoding: 'utf8', env: { ...isolatedCheckEnvironment(), ...syntheticDeploymentEnvironment(),
        VERCEL: '1', VITE_GEMINI_API_KEY: 'private-build-canary-do-not-log'
      }
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('VITE_GEMINI_API_KEY must not be set');
    expect(result.stderr).not.toContain('private-build-canary-do-not-log');
  });
});
