import { spawnSync } from 'node:child_process';
import { isolatedCheckEnvironment } from './ci-environment.js';

const suites = [
  ['node_modules/jest/bin/jest.js', '--config', 'jest.config.cjs', '--forceExit', '--detectOpenHandles', '--runInBand'],
  ['--experimental-vm-modules', 'node_modules/jest/bin/jest.js', '--config', 'jest.esm.config.cjs', '--forceExit', '--detectOpenHandles', '--runInBand']
];
for (const args of suites) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: isolatedCheckEnvironment(), windowsHide: true });
  if (result.error || result.status !== 0) {
    console.error(`Jest failed: native exit ${result.status ?? 'unavailable'}, signal ${result.signal || 'none'}.`);
    process.exit(result.status || 1);
  }
}
console.log('Both Jest configurations passed (native exits 0).');
