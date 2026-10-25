import { spawnSync } from 'node:child_process';
import { assertDeploymentEnvironment, validateDeploymentEnvironment } from './deploymentEnvValidation.js';
import { isolatedCheckEnvironment, syntheticDeploymentEnvironment } from './ci-environment.js';

for (const environment of ['staging', 'production']) {
  const env = syntheticDeploymentEnvironment(environment);
  for (const target of ['frontend', 'backend', 'all']) assertDeploymentEnvironment(env, target);
  const wrongDatabase = environment === 'staging' ? 'bmprinting' : 'bmprinting_staging';
  if (!validateDeploymentEnvironment({ ...env, MONGODB_DB_NAME: wrongDatabase }, 'deployment', 'backend').length) {
    throw new Error('Synthetic deployment validation failed to reject a mixed database target.');
  }
}
console.log('Offline staging/production environment contracts passed (frontend, backend, combined, and negative database checks).');

if (process.argv.includes('--build')) {
  const result = spawnSync(process.execPath, ['node_modules/vite/bin/vite.js', 'build'], {
    stdio: 'inherit', windowsHide: true,
    env: { ...isolatedCheckEnvironment(), ...syntheticDeploymentEnvironment('staging') }
  });
  process.exitCode = result.status ?? 1;
}
