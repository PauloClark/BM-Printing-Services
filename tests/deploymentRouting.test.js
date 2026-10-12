import { allowedFrontendOrigins, deploymentHostnames } from '../server/deploymentOrigins.js';
import { apiRequestNeedsMongo, restoreApiPath } from '../api/_requestPath.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Vercel deployment routing configuration', () => {
  test('recognizes the production and current Vercel deployment hosts', () => {
    const env = {
      NODE_ENV: 'production',
      FRONTEND_ORIGINS: 'https://shop.example',
      VERCEL_PROJECT_PRODUCTION_URL: 'bm-printing-services.vercel.app',
      VERCEL_URL: 'bm-printing-services-preview.vercel.app'
    };
    expect(deploymentHostnames(env)).toEqual([
      'bm-printing-services.vercel.app', 'bm-printing-services-preview.vercel.app'
    ]);
    expect([...allowedFrontendOrigins(env)]).toEqual(expect.arrayContaining([
      'https://shop.example',
      'https://bm-printing-services.vercel.app',
      'https://bm-printing-services-preview.vercel.app'
    ]));
  });

  test('restores the original Express API path and query string', () => {
    const req = { url: '/api?__api_path=products', query: { __api_path: 'products', category: 'Printing' } };
    restoreApiPath(req);
    expect(req.url).toBe('/api/products?category=Printing');
    expect(req.query).toEqual({ category: 'Printing' });
  });

  test('keeps Turnstile verification available without weakening database-backed APIs', () => {
    expect(apiRequestNeedsMongo('/api/turnstile/verify')).toBe(false);
    expect(apiRequestNeedsMongo('/api/turnstile/verify?source=login')).toBe(false);
    expect(apiRequestNeedsMongo('/api/health')).toBe(false);
    expect(apiRequestNeedsMongo('/api/products')).toBe(true);
    expect(apiRequestNeedsMongo('/api/auth/login')).toBe(true);
  });

  test('renders one shared Turnstile widget on each email authentication page', () => {
    const source = file => readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(source('src/components/Pages/LoginPage.jsx').match(/<TurnstileWidget/g)).toHaveLength(1);
    expect(source('src/components/Pages/RegisterPage.jsx').match(/<TurnstileWidget/g)).toHaveLength(1);
    expect(source('src/components/Common/GoogleAuthOption.jsx')).not.toContain('<TurnstileWidget');
  });
});
