import { allowedFrontendOrigins, deploymentHostnames } from '../server/deploymentOrigins.js';
import { restoreApiPath } from '../api/_requestPath.js';

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
});
