import '../server/loadEnv.js';
import { validateDeploymentEnvironment } from './deploymentEnvValidation.js';

const modeArgument = process.argv.find(argument => argument.startsWith('--mode='));
const mode = modeArgument ? modeArgument.slice('--mode='.length) : 'deployment';
const targetArgument = process.argv.find(argument => argument.startsWith('--target='));
const target = targetArgument ? targetArgument.slice('--target='.length) : 'all';
const errors = validateDeploymentEnvironment(process.env, mode, target);
if (errors.length) {
  console.error(`${mode === 'local' ? 'Local' : 'Deployment'} environment validation failed.`);
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
if (mode === 'local') {
  console.log('Local development mode: production storage, Atlas, and scheduler settings are not required.');
} else {
  console.log(`Deployment environment validation passed for ${target}. Secret values were not printed.`);
}
