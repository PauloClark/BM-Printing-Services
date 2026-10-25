import { allowedFrontendOrigins, deploymentHostnames } from '../server/deploymentOrigins.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('Vercel deployment routing configuration', () => {
  test('allows only the known local Vite origins during development', () => {
    const origins = allowedFrontendOrigins({ NODE_ENV: 'development' });
    expect([...origins]).toEqual(expect.arrayContaining([
      'http://localhost:3000', 'http://127.0.0.1:3000',
      'http://localhost:3001', 'http://127.0.0.1:3001',
      'http://localhost:3002', 'http://127.0.0.1:3002'
    ]));
    expect(origins.has('http://attacker.example')).toBe(false);
  });

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

  test('deploys Vercel as a static SPA without an API function rewrite', () => {
    const config = JSON.parse(readFileSync(path.join(process.cwd(), 'vercel.json'), 'utf8'));
    expect(config.functions).toBeUndefined();
    expect(config.routes).not.toEqual(expect.arrayContaining([expect.objectContaining({ src: expect.stringContaining('/api') })]));
    expect(readFileSync(path.join(process.cwd(), '.vercelignore'), 'utf8')).toContain('api/**');
  });

  test('renders Supabase CAPTCHA on password auth while leaving Google OAuth independent', () => {
    const source = file => readFileSync(path.join(process.cwd(), file), 'utf8');
    expect(source('src/components/Pages/LoginPage.jsx')).toContain('<TurnstileWidget');
    expect(source('src/components/Pages/RegisterPage.jsx')).toContain('<TurnstileWidget');
    expect(source('src/components/Common/GoogleAuthOption.jsx')).not.toMatch(/TurnstileWidget|captchaToken/);
  });
});
