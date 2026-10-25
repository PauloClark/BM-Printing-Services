import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve from the repository, not process.cwd(). Existing deployment-provided
// variables retain precedence because dotenv override remains disabled.
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The QA launcher constructs a strict child environment and must never load
// the normal local/deployment files as fallbacks.
if (process.env.BM_QA_MODE !== 'true') {
  dotenv.config({ path: path.join(projectRoot, '.env') });
  // Some local deployments store their ignored environment file as `env`.
  // Load it as a fallback while preserving process/.env values when present.
  dotenv.config({ path: path.join(projectRoot, 'env') });
}
