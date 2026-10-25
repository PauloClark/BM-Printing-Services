import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import { secretFindings } from './secretScan.js';
import { syntheticDeploymentEnvironment } from './ci-environment.js';

const bundle = process.argv.includes('--bundle');
const secretNames = /SECRET|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|GEMINI_API_KEY|MONGODB_URI/;
const secretValues = [...Object.entries(process.env), ...Object.entries(syntheticDeploymentEnvironment())]
  .filter(([key]) => secretNames.test(key)).map(([, value]) => value);
// Local comparisons are in memory only. CI has no ignored environment files.
for (const file of ['.env', '.env.local', '.env.qa.local', 'env']) {
  if (!existsSync(file)) continue;
  for (const [key, value] of Object.entries(dotenv.parse(readFileSync(file)))) {
    if (secretNames.test(key) && !/change-this|your_|replace|example|placeholder/i.test(value)) secretValues.push(value);
  }
}
const files = bundle ? walk('dist') : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean)
  .filter(file => file !== 'scripts/smoke-stock-live.mjs' && /(?:\.(?:[cm]?js|jsx|json|ya?ml|md|sql|html|example|txt)|(?:^|\/)\.env[^/]*)$/.test(file));
if (bundle && !files.length) throw new Error('Secret scan requires a completed dist build.');
const findings = [];
for (const file of [...new Set(files)]) {
  if (bundle && !/\.(?:js|css|html|map|json)$/.test(file)) continue;
  for (const finding of secretFindings(readFileSync(file, 'utf8'), { forbiddenValues: bundle ? secretValues : [] })) {
    findings.push({ file, ...finding });
  }
}
console.log(JSON.stringify({ scan: bundle ? 'frontend bundle' : 'repository source', files: files.length, findings,
  limitations: 'Pattern and exact-value checks, not a history/cloud scan. The excluded local smoke script is not a release input.' }));
if (findings.length) process.exitCode = 1;

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(file) : [file];
  });
}
