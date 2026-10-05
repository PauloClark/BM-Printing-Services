// Local browser integration smoke test. Auth/API responses are mocked; no live
// accounts, emails, orders or role assignments are created.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-staff-browser-'));
const server = await createServer({ server: { host: '127.0.0.1', port: 0, open: false } });
let browser, socket;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const mock = () => {
  localStorage.clear();
  let user;
  const original = window.fetch.bind(window);
  const json = (body, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }));
  const order = { id: 'ORD-SMOKE', orderId: 'ORD-SMOKE', customer: 'Test Customer', email: 'customer@example.test', phone: '09171234567', product: 'Polo Shirt', quantity: 12, total: 6000, payment: 'GCash', specs: 'Size: XL\nColor: Red', status: 'Pending', createdAt: new Date().toISOString(), items: [{ productName: 'Polo Shirt', quantity: 12, subtotal: 6000 }] };
  window.fetch = (input, options = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/auth/v1/token')) {
      const role = JSON.parse(options.body).email.split('@')[0];
      user = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: `${role}@example.test`, aud: 'authenticated', role: 'authenticated', app_metadata: { role, provider: 'email', providers: ['email'] }, user_metadata: { full_name: `Test ${role}` } };
      const jwt = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })) + '.' + btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })) + '.test';
      return json({ access_token: jwt, refresh_token: 'test-refresh', expires_in: 3600, token_type: 'bearer', user });
    }
    if (url.includes('/auth/v1/user')) {
      if (options.method === 'PUT') user.user_metadata = { ...user.user_metadata, ...JSON.parse(options.body).data };
      return json(user);
    }
    if (url.includes('/auth/v1/logout')) { user = null; return json({}); }
    if (url.includes('/api/auth/me')) return user ? json({ user: { id: user.id, name: user.user_metadata.full_name, email: user.email, role: window.__testRole || user.app_metadata.role, authProvider: 'supabase' } }) : json({ error: 'Login required' }, 401);
    if (url.includes('/api/staff/orders')) return json({ orders: [order] });
    if (url.includes('/files/design')) return Promise.resolve(new Response(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg=='), c => c.charCodeAt(0)), { headers: { 'Content-Type': 'image/png' } }));
    if (url.includes('/files')) return json({ files: [{ id: 'design', name: 'Reference.png', type: 'image/png' }] });
    if (url.includes('/status')) { order.status = JSON.parse(options.body).status; return json({ order }); }
    if (url.includes('/api/customers/orders') || url.includes('/api/admin/orders')) return json({ orders: [] });
    if (url.includes('/api/')) return json({});
    return original(input, options);
  };
};
try {
  await server.listen();
  const origin = server.resolvedUrls.local[0].replace(/\/$/, '');
  browser = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let port;
  for (let i = 0; i < 100; i++) {
    try { port = (await fs.readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; } catch { await delay(100); }
  }
  if (!port) throw new Error('Headless Chrome did not start. Set CHROME_PATH to your installed browser.');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(target => target.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map(), exceptions = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    const entry = pending.get(message.id);
    if (entry) { pending.delete(message.id); clearTimeout(entry.timer); message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result); }
  };
  const command = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`CDP timeout: ${method}`)); }, 30000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
  const evaluate = async expression => {
    const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
    return result.result.value;
  };
  const waitFor = async (expression, label) => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${label}. Page: ${(await evaluate('document.body.innerText')).slice(0, 1400)}`);
  };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).findLast(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  await command('Page.enable'); await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `(${mock.toString()})()` });
  await command('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  for (const role of ['staff', 'customer', 'admin']) {
    await command('Page.navigate', { url: `${origin}/?test=${role}#login` });
    await waitFor("Boolean(document.querySelector('input[type=password]'))", 'login form');
    await evaluate(`(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      for (const [type,value] of [['email','${role}@example.test'],['password','test-password']]) {
        const input = document.querySelector('input[type='+type+']'); set.call(input,value); input.dispatchEvent(new Event('input',{bubbles:true}));
      } })()`);
    await click('Login');
    const destination = role === 'customer' ? 'home' : role;
    await waitFor(`location.hash === '#${destination}'`, `${role} login redirect`);
    if (role === 'staff') {
      await waitFor("document.body.innerText.includes('ORD-SMOKE')", 'staff orders');
      await click('View Order');
      await waitFor("document.body.innerText.includes('Color: Red') && document.body.innerText.includes('Reference.png')", 'specifications and design');
      await click('View / download Reference.png');
      await waitFor("Boolean(document.querySelector('img[alt=\"Reference.png\"]'))", 'authenticated design preview');
      await click('Confirm Order');
      await waitFor("document.body.innerText.includes('Start Processing')", 'confirmed order action');
      await command('Emulation.setDeviceMetricsOverride', { width: 375, height: 812, deviceScaleFactor: 1, mobile: true });
      if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 2')) throw new Error('Staff page overflows the mobile viewport');
      await command('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
      await evaluate("location.hash = 'admin'");
      await waitFor("document.body.innerText.includes('Access denied')", 'staff denied admin dashboard');
      await evaluate("location.hash = 'staff'");
      await waitFor("document.body.innerText.includes('ORD-SMOKE')", 'return to staff dashboard');
      await evaluate("window.__testRole = 'customer'; window.dispatchEvent(new Event('focus'))");
      await waitFor("document.body.innerText.includes('Access denied')", 'revoked staff role');
    } else if (role === 'customer') {
      await evaluate("location.hash = 'staff'");
      await waitFor("document.body.innerText.includes('Access denied')", 'customer denied staff URL');
    } else {
      await waitFor("document.body.innerText.includes('BM ADMIN')", 'admin dashboard');
    }
    console.log(`${role} browser checks passed`);
  }
  if (exceptions.length) throw new Error(exceptions.join('\n'));
  console.log('All mocked browser smoke checks passed. No live credentials or data used.');
  await command('Browser.close');
} finally {
  socket?.close();
  browser?.kill();
  await server.close();
  // Resolve and check before recursive cleanup, confined to this test's temp profile.
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('bm-staff-browser-')) throw new Error('Unsafe browser profile cleanup path');
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
