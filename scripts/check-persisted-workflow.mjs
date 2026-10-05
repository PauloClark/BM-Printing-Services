// Real browser, Express routes and persistent MongoDB; only Supabase identity is a test fixture.
// Uses a unique database and temporary upload/report directories. Never inserts live shop orders.
import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const chrome = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'bm-workflow-browser-'));
const dbName = 'bmprinting_workflow_test_' + Date.now();
const client = new mongoose.mongo.MongoClient('mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 3000 });
await client.connect();
const db = client.db(dbName);
const identities = Object.fromEntries(['customer','staff','other'].map((role,i)=> {
 const user={ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa'+i, email: role+'@example.test', aud:'authenticated', role:'authenticated', app_metadata:{role:role==='other'?'customer':role,provider:'email',providers:['email']}, user_metadata:{full_name:'Test '+role} };
 const token=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600})).toString('base64url')+'.fixture';
 return [role,{user,token}];
}));
const auth = http.createServer((req,res)=> {
 const identity=Object.values(identities).find(value=>'Bearer '+value.token===req.headers.authorization);
 res.writeHead(identity?200:401,{'Content-Type':'application/json'}); res.end(JSON.stringify(identity?.user || {error:'Invalid token'}));
});
await new Promise(resolve=>auth.listen(0,'127.0.0.1',resolve));
const reservation=http.createServer(); await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
const apiPort=reservation.address().port; await new Promise(resolve=>reservation.close(resolve));
let backend, browser, socket, backendLog='';
const apiOrigin='http://127.0.0.1:'+apiPort;
const startBackend=async()=> {
 backend=spawn(process.execPath,['server.js'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,PORT:String(apiPort),MONGODB_URI:'mongodb://127.0.0.1:27017/'+dbName,SUPABASE_URL:'http://127.0.0.1:'+auth.address().port,SUPABASE_ANON_KEY:'test-fixture',ALLOW_LEGACY_AUTH:'false',ALLOW_IN_MEMORY_DB:'false',ORDER_UPLOAD_DIR:path.join(profile,'uploads'),ORDER_REPORTS_DIR:path.join(profile,'reports')}});
 backend.stdout.on('data',data=>backendLog+=data); backend.stderr.on('data',data=>backendLog+=data);
 for(let i=0;i<150;i++){try{const r=await fetch(apiOrigin+'/api/health');if(r.ok)return;}catch{}await delay(100);}
 throw new Error('Backend startup failed: '+backendLog);
};
const stopBackend=async()=>{if(backend && backend.exitCode===null){const stopped=new Promise(resolve=>backend.once('exit',resolve));backend.kill();await stopped;}};
const api=async(role,url,method='GET',body)=>fetch(apiOrigin+url,{method,headers:{...(role?{Authorization:'Bearer '+identities[role].token}:{}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const server=await createServer({server:{host:'127.0.0.1',port:0,open:false,proxy:{'/api':{target:apiOrigin,changeOrigin:true}}}});
const mock = function () {
 const identities=IDENTITIES;
 let user;
 const original=window.fetch.bind(window);
 const json=body=>Promise.resolve(new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}}));
 window.fetch=(input,options={})=> {
  const url=typeof input==='string'?input:input.url;
  if(url.includes('/auth/v1/token')){const role=JSON.parse(options.body).email.split('@')[0];const identity=identities[role];user=identity.user;return json({access_token:identity.token,refresh_token:'test-refresh',expires_in:3600,token_type:'bearer',user});}
  if(url.includes('/auth/v1/user'))return json(user);
  if(url.includes('/auth/v1/logout')){user=null;return json({});}
  return original(input,options);
 };
};
try {
 await startBackend(); await server.listen();
 const origin=server.resolvedUrls.local[0].replace(/\/$/,'');
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
    for (let i = 0; i < 200; i++) { if (await evaluate(expression)) return; await delay(100); }
    throw new Error(`Timed out: ${label}. Page: ${(await evaluate('document.body.innerText')).slice(0, 1400)}`);
  };
  const click = text => evaluate(`Array.from(document.querySelectorAll('button')).findLast(b => b.textContent.trim() === ${JSON.stringify(text)})?.click()`);
  await command('Page.enable'); await command('Runtime.enable');
  await command('Page.addScriptToEvaluateOnNewDocument', { source: `(${mock.toString().replace('IDENTITIES', JSON.stringify(identities))})()` });
  await command('Emulation.setDeviceMetricsOverride', { width: 1365, height: 900, deviceScaleFactor: 1, mobile: false });

 const set=async(selector,value)=>evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw new Error('Missing input');const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 const login=async(role)=>{await evaluate("location.hash='login'");await waitFor("Boolean(document.querySelector('input[type=password]'))",'login');await set('input[type=email]',role+'@example.test');await set('input[type=password]','test-password');await click('Login');await waitFor(`location.hash === '#${role==='customer'?'home':role}'`,role+' redirect');await delay(700);};
 const logout=async()=>{await click('Logout');await waitFor("Boolean(document.querySelector('.bm-logout-confirm'))",'logout dialog');await click('Log Out');await waitFor("!document.querySelector('.bm-logout-confirm') && !Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Logout')",'logout complete');};
 await command('Page.navigate',{url:origin+'/#login'});
 await login('customer');
 await click('Order Now');
 await waitFor("Boolean(document.querySelector('#customer-name'))",'order form');
 await set('#customer-name','Test customer');await set('#customer-phone','09171234567');await set('#customer-address','Test address');await click('Next \u2192');
 await waitFor("Boolean(document.querySelector('#order-product'))",'product step');
 await set('#order-product','2');await set('#order-quantity','12');await set('#spec-size','XL');await set('#spec-color','Red');
 const png=path.join(profile,'reference.png');await fs.writeFile(png,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==','base64'));
 const root=await command('DOM.getDocument');const input=await command('DOM.querySelector',{nodeId:root.root.nodeId,selector:'#order-design-file'});await command('DOM.setFileInputFiles',{nodeId:input.nodeId,files:[png]});await delay(300);await click('Next \u2192');
 await waitFor("document.body.innerText.includes('Payment & Review')",'payment step');await set('select','GCash');
 await evaluate("Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Confirm Order'))?.click()");
 await waitFor("document.body.innerText.includes('Order Placed!')",'saved receipt');
 let saved=await db.collection('orders').findOne({customerEmail:'customer@example.test'});assert.ok(saved);assert.equal(saved.status,'Pending');assert.equal(saved.customerId,identities.customer.user.id);assert.equal(saved.items[0].quantity,12);assert.match(saved.specs,/Red/);const orderId=saved.orderId;
 console.log('PASS authenticated customer UI checkout -> actual MongoDB Pending order with specifications/file.');
 await stopBackend();await startBackend();assert.equal((await db.collection('orders').findOne({orderId})).status,'Pending');
 assert.equal((await api('customer','/api/staff/orders')).status,403);assert.equal((await api(null,'/api/staff/orders')).status,401);assert.equal((await api('customer','/api/orders/'+orderId+'/status','PATCH',{status:'Confirmed'})).status,403);
 const otherOrders=await (await api('other','/api/customers/orders')).json();assert.equal(otherOrders.orders.length,0);
 assert.equal((await api('other','/api/orders/'+orderId+'/files')).status,404);
 assert.equal((await api('staff','/api/orders/'+orderId+'/status','PATCH',{status:'Completed'})).status,400);
 console.log('PASS backend restart persistence, customer access denial, other-customer isolation, invalid status jump rejection.');
 await logout();await login('staff');await waitFor(`document.body.innerText.includes(${JSON.stringify(orderId)})`,'staff incoming order');await click('View Order');
 await waitFor("document.body.innerText.includes('Color: Red') && document.body.innerText.includes('reference.png')",'complete details');await waitFor("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='View / download reference.png')",'design download button');await click('View / download reference.png');await waitFor("Boolean(Array.from(document.images).find(img=>img.alt==='reference.png'))",'secure file preview');
 const customerStatus=async(status)=>{
  await logout();await login('customer');await evaluate("location.hash='myorders'");
  await waitFor(`document.body.innerText.includes(${JSON.stringify(orderId)}) && document.body.innerText.includes(${JSON.stringify(status)})`,'My Orders '+status);
  await evaluate("location.hash='track'");await waitFor("Boolean(document.querySelector('input'))",'track form');await set('input',orderId);await click('Search');
  await waitFor(`document.body.innerText.includes(${JSON.stringify(status)})`,'Track Order '+status);
  await evaluate("location.hash='staff'");await waitFor("document.body.innerText.includes('Access denied')",'customer denied staff URL');
  await logout();await login('staff');await waitFor(`document.body.innerText.includes(${JSON.stringify(orderId)})`,'staff list');await click('View Order');
 };
 assert.ok(await evaluate("Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()==='Staff Dashboard')"));
 for(const [action,status,nextAction] of [['Confirm Order','Confirmed','Start Processing'],['Start Processing','Processing','Mark as Ready for Pickup'],['Mark as Ready for Pickup','Ready for Pickup','Mark as Completed']]){
  await click(action);await waitFor(`document.body.innerText.includes(${JSON.stringify(nextAction)})`,status+' action');
  assert.equal((await db.collection('orders').findOne({orderId})).status,status);await customerStatus(status);
  console.log('PASS staff '+status+' -> logout -> customer login -> My Orders/Track Order same status; customer staff URL denied.');
 }
 await evaluate("window.__confirmations=[];window.confirm=message=>{window.__confirmations.push(message);return false;}");await click('Mark as Completed');await delay(200);assert.equal((await db.collection('orders').findOne({orderId})).status,'Ready for Pickup');assert.equal(await evaluate('window.__confirmations.length'),1);
 await evaluate('window.confirm=()=>true');await click('Mark as Completed');await waitFor("!document.body.innerText.includes('Mark as Completed')",'completed');assert.equal((await db.collection('orders').findOne({orderId})).status,'Completed');
 console.log('PASS Ready for Pickup -> completion requires confirmation -> Completed persists.');
 await customerStatus('Completed');
 await evaluate("location.hash='admin'");await waitFor("document.body.innerText.includes('Access denied')",'staff denied admin URL');await evaluate("location.hash='staff'");
 await waitFor("document.body.innerText.includes('Orders')",'staff return');
 const guestResponse=await api(null,'/api/orders','POST',{customer:'Guest test',email:'guest@example.test',phone:'09171234567',productId:6,product:'Mug Printing',quantity:1,total:150,payment:'GCash',specs:'Mug variant: White'});
 assert.equal(guestResponse.status,200);const guest=await guestResponse.json();assert.ok(guest.guestToken);assert.equal(guest.order.status,'Pending');
 await waitFor(`document.body.innerText.includes(${JSON.stringify(guest.order.id)})`,'new order appears by polling');
 await evaluate(`Array.from(document.querySelectorAll('tr')).find(row=>row.textContent.includes(${JSON.stringify(guest.order.id)})).querySelector('button').click()`);
 await waitFor("document.body.innerText.includes('Mug variant: White')",'non-apparel specifications');
 await evaluate("window.__confirmations=[];window.confirm=message=>{window.__confirmations.push(message);return false;}");await click('Cancel Order');assert.equal(await evaluate('window.__confirmations.length'),1);assert.equal((await db.collection('orders').findOne({orderId:guest.order.id})).status,'Pending');
 await evaluate('window.confirm=()=>true');await click('Cancel Order');await waitFor("!document.body.innerText.includes('Cancel Order')",'cancelled');assert.equal((await db.collection('orders').findOne({orderId:guest.order.id})).status,'Cancelled');
 assert.equal((await api(null,'/api/guest/orders/'+guest.order.id)).status,404);
 const tracked=await fetch(apiOrigin+'/api/guest/orders/'+guest.order.id,{headers:{'X-Order-Token':guest.guestToken}});assert.equal((await tracked.json()).order.status,'Cancelled');
 console.log('PASS guest persistence, new-order polling, product-specific details, cancellation confirmation, private guest tracking, staff denied admin.');
 if(exceptions.length)throw new Error(exceptions.join('\n'));
 // Chrome may close its socket before acknowledging Browser.close.
 socket.send(JSON.stringify({id:++id,method:'Browser.close'}));
 console.log('All persistent workflow checks passed. Auth provider was simulated; order API and MongoDB were real.');
} finally {
 socket?.close();browser?.kill();await server.close();await stopBackend();await new Promise(resolve=>auth.close(resolve));
 if(!/^bmprinting_workflow_test_[0-9]+$/.test(dbName))throw new Error('Unsafe test DB cleanup');await db.dropDatabase();await client.close();
 const resolved=path.resolve(profile);if(path.dirname(resolved)!==path.resolve(os.tmpdir())||!path.basename(resolved).startsWith('bm-workflow-browser-'))throw new Error('Unsafe test directory cleanup');
 await fs.rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200}).catch(()=>{});
}
