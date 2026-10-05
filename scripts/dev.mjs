import { spawn } from 'node:child_process';
import path from 'node:path';
import { ensureLocalServices, projectRoot } from './local-services.mjs';

try {
  await ensureLocalServices();
  const vite = spawn(process.execPath, [path.join(projectRoot, 'node_modules/vite/bin/vite.js'), ...process.argv.slice(2)], {
    cwd: projectRoot, stdio: 'inherit', windowsHide: true
  });
  vite.on('exit', code => { process.exitCode = code || 0; });
  vite.on('error', error => { console.error(error.message); process.exitCode = 1; });
  // Persistent MongoDB and the API intentionally remain available when Vite closes.
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
