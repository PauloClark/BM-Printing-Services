// Local browser integration smoke test. Auth/API responses are mocked; no live
// accounts, emails, orders or role assignments are created.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-payment-browser-'));
const server = await createServer({
  define: { 'import.meta.env.VITE_TURNSTILE_SITE_KEY': JSON.stringify('1x00000000000000000000AA') },
  server: { host: '127.0.0.1', port: 0, open: false }
});
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
    if (url.includes('/api/turnstile/verify')) return json({ success: true });
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
    if (url.includes('/api/products')) return json({ products: [{ id: 2, name: 'Polo Shirt', price: 500 }] });
    if (url.includes('/api/payments/quote')) {
      return json({ error: 'Online checkout has been removed. Use the manual payment flow instead.' }, 410);
    }
    if (url.includes('/api/payments/create')) { window.__paymentCalls = (window.__paymentCalls || 0) + 1; return json({ error: 'Simulated provider outage; no payment was attempted.' }, 503); }
    if (url === '/api/orders' && options.method === 'POST') { window.__orderCalls = (window.__orderCalls || 0) + 1; return json({ order }); }
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
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).findLast(b => b.textContent.trim().toLowerCase() === ${JSON.stringify(text.toLowerCase())})?.click()`);
  await command('Page.enable'); await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `window.turnstile = { render(_container, options) { queueMicrotask(() => options.callback('turnstile-test-token')); return 'test-widget'; }, reset() {}, remove() {} }; (${mock.toString()})()` });
  await command('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: origin + '/#login' });
  await waitFor("Boolean(document.querySelector('input[type=password]'))", 'login form');
  const fill = (selector, value) => evaluate(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); const proto = el.tagName === 'SELECT' ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event(el.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); })()`);
  await fill('input[type=email]', 'customer@example.test');
  await fill('input[type=password]', 'test-password');
  await click('Login');
  await waitFor("location.hash === '#home'", 'authenticated customer');
  await evaluate("location.hash = 'order'");
  await waitFor("Boolean(document.querySelector('#customer-phone'))", 'step 1');
  await fill('#customer-phone', '09171234567');
  await fill('#customer-address', 'Test address');
  const next = () => evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Next Step'))?.click()");
  await next();
  await waitFor("Boolean(document.querySelector('#order-product'))", 'step 2');
  await fill('#order-product', '2');
  await fill('#order-quantity', '3');
  await fill('#spec-size', 'XL');
  await fill('#spec-color', 'Maroon');
  await evaluate(`(() => { const input = document.querySelector('#order-design-file'); const dt = new DataTransfer(); dt.items.add(new File(['test'], 'customer-design.png', { type: 'image/png' })); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await next();
  await waitFor("document.body.innerText.includes('Full total due')", 'step 3 quote');
  const payDisabled = "Array.from(document.querySelectorAll('button')).find(b => b.textContent.startsWith('Pay '))?.disabled";
  if (!(await evaluate(payDisabled))) throw new Error('Payment must start disabled');
  await evaluate("document.querySelector('input[value=gcash]').click()");
  if (!(await evaluate(payDisabled))) throw new Error('Confirmation must be required');
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  if (await evaluate(payDisabled)) throw new Error('Valid confirmed order must enable payment');
  await evaluate("document.querySelector('input[value=paymaya]').click()");
  if (!(await evaluate("document.querySelectorAll('input[name=paymentMethod]:checked').length === 1 && document.querySelector('input[value=paymaya]').checked"))) throw new Error('Wallet selection is not exclusive');
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  for (const width of [1365, 375, 320]) {
    await command('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
    if (await evaluate('document.documentElement.scrollWidth > window.innerWidth + 2')) throw new Error('Step 3 overflows at ' + width);
  }
  const back = () => evaluate("Array.from(document.querySelectorAll('button')).findLast(b => b.textContent.includes('Back'))?.click()");
  await back();
  await waitFor("Boolean(document.querySelector('#spec-color'))", 'back to step 2');
  if (!(await evaluate("document.querySelector('#spec-color').value === 'Maroon' && document.querySelector('#order-quantity').value === '3' && document.body.innerText.includes('customer-design.png')"))) throw new Error('Back lost entered order data');
  await evaluate('window.__missingConfig = true');
  await next();
  await waitFor("document.body.innerText.includes('must configure')", 'missing configuration notice');
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  if (!(await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent === 'Payment unavailable')?.disabled"))) throw new Error('Unconfigured checkout must be disabled');
  await back(); await evaluate('window.__missingConfig = false'); await next();
  await waitFor("document.body.innerText.includes('750.00')", 'reloaded quote');
  await evaluate("document.querySelector('input[type=checkbox]').click()");
  await evaluate("Array.from(document.querySelectorAll('button')).find(b => b.textContent.startsWith('Pay ')).click()");
  await waitFor("document.body.innerText.includes('payment pending')", 'saved unpaid order');
  await waitFor("window.__paymentCalls === 1", 'mocked checkout failure');
  await click('Continue test checkout');
  await waitFor("window.__paymentCalls === 2", 'retry existing order');
  if (!(await evaluate('window.__orderCalls === 1'))) throw new Error('Retry created another order');
  await evaluate("history.replaceState(null, '', '?payment_return=ORD-SMOKE#myorders'); window.dispatchEvent(new HashChangeEvent('hashchange'))");
  await waitFor("document.body.innerText.includes('This does not confirm payment')", 'safe return notice');
  console.log('Step 3 browser checks passed: summary, confirmation, wallet selection, back preservation, missing configuration, mobile widths, retry, and safe return.');
  if (exceptions.length) throw new Error(exceptions.join('\n'));
  console.log('All mocked browser smoke checks passed. No live credentials or data used.');
  await command('Browser.close');
} finally {
  socket?.close();
  browser?.kill();
  await server.close();
  // Resolve and check before recursive cleanup, confined to this test's temp profile.
  const resolved = path.resolve(profile);
  if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('bm-payment-browser-')) throw new Error('Unsafe browser profile cleanup path');
  await fs.rm(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }).catch(() => {});
}
