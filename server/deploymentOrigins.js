const hostnameOnly = value => String(value || '').trim().toLowerCase()
  .replace(/^https?:\/\//, '').replace(/\/$/, '');

export function deploymentHostnames(environment = process.env) {
  return [environment.VERCEL_PROJECT_PRODUCTION_URL, environment.VERCEL_URL]
    .map(hostnameOnly).filter(Boolean);
}

export function allowedFrontendOrigins(environment = process.env) {
  const configured = String(environment.FRONTEND_ORIGINS || (environment.NODE_ENV === 'production'
    ? '' : 'http://localhost:3000,http://127.0.0.1:3000'))
    .split(',').map(origin => origin.trim().replace(/\/$/, '')).filter(Boolean);
  const vercel = deploymentHostnames(environment).map(hostname => `https://${hostname}`);
  return new Set([...configured, ...vercel]);
}
