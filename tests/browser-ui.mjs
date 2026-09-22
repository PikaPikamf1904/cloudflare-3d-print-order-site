import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const adminKey = process.env.TEST_ADMIN_KEY || 'local-ui-test-key';
const port = 9223;
const profile = await mkdtemp(join(tmpdir(), '3d-print-browser-'));
const artifacts = resolve('test-artifacts');
await mkdir(artifacts, { recursive: true });
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let socket;
let sequence = 0;
const pending = new Map();
const eventWaiters = new Map();
const browserErrors = [];
let passed = 0;
let failed = 0;

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
function assert(value, message) { if (!value) throw new Error(message); }
async function test(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } }
async function waitForJson(url, options) { for (let i = 0; i < 80; i += 1) { try { const response = await fetch(url, options); if (response.ok) return response.json(); } catch {} await delay(100); } throw new Error(`Timed out waiting for ${url}`); }
function send(method, params = {}) { const id = ++sequence; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, reject) => pending.set(id, { resolve: resolveSend, reject })); }
function waitEvent(method, timeout = 5000) { return new Promise((resolveEvent, reject) => { const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout); const list = eventWaiters.get(method) || []; list.push((params) => { clearTimeout(timer); resolveEvent(params); }); eventWaiters.set(method, list); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed'); return result.result.value; }
async function waitFor(expression, timeout = 8000) { const started = Date.now(); while (Date.now() - started < timeout) { if (await evaluate(expression)) return; await delay(100); } throw new Error(`Timed out waiting for: ${expression}`); }
async function navigate(url) { const loaded = waitEvent('Page.loadEventFired', 10000); await send('Page.navigate', { url }); await loaded; }
async function viewport(width, height) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 640 }); }
async function screenshot(name) {
  // Mask even imported fixture identities and references in screenshot artifacts.
  await evaluate(`(() => { window.__masked=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(['SCRIPT','STYLE'].includes(n.parentElement.tagName))continue;const safe=n.textContent.replace(/legacy-[a-z-]+|3D-[A-Z0-9-]+|BUG-[A-Z0-9-]+|Olivia|Andrew|Ava|Unknown customer|Frontend Edited|Frontend Test|[^\\s@]+@[^\\s@]+/gi,'[local fixture]');if(safe!==n.textContent){window.__masked.push([n,n.textContent]);n.textContent=safe;}} })()`);
  try { const result = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(join(artifacts, name), Buffer.from(result.data, 'base64')); }
  finally { await evaluate('window.__masked.forEach(([n,t])=>n.textContent=t);window.__masked=[]'); }
}

try {
  await waitForJson(`http://127.0.0.1:${port}/json/version`);
  const target = await waitForJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(`${base}/`)}`, { method: 'PUT' });
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolveOpen, reject) => { socket.addEventListener('open', resolveOpen, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data);
    if (message.id) { const request = pending.get(message.id); if (request) { pending.delete(message.id); if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result); } return; }
    if (message.method === 'Runtime.exceptionThrown') browserErrors.push(message.params.exceptionDetails?.exception?.description || message.params.exceptionDetails?.text || 'Uncaught exception');
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') browserErrors.push(message.params.entry.text);
    const list = eventWaiters.get(message.method); if (list?.length) { const resolveEvent = list.shift(); resolveEvent(message.params); }
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Log.enable');
  await viewport(1440, 1000); await navigate(`${base}/`); await waitFor("document.querySelectorAll('.product-card').length === 6");
  await test('desktop storefront renders six products', async () => { assert(await evaluate("document.querySelectorAll('.product-card').length") === 6, 'product count is not 6'); assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'desktop has horizontal overflow'); });
  const add = (name, color) => evaluate(`(() => { const card=[...document.querySelectorAll('.product-card')].find(x=>x.querySelector('h3').textContent===${JSON.stringify(name)}); if(!card)return false; const swatch=[...card.querySelectorAll('.color-swatch')].find(x=>x.dataset.color===${JSON.stringify(color)}); if(!swatch)return false; swatch.click(); card.querySelector('.button-primary').click(); return true; })()`);
  await test('cart calculates exact locked catalog totals', async () => {
    assert(await add('Ring', 'Standard'), 'Ring card missing'); assert(await evaluate("document.querySelector('#cart-total').textContent") === '$0.75', 'Ring total is not $0.75');
    assert(await add('Kirby', 'Red'), 'Kirby card missing'); assert(await evaluate("document.querySelector('#cart-total').textContent") === '$1.00', 'Ring + Red Kirby is not $1.00');
    assert(await add('Half-size Octopus', 'White'), 'Half-size Octopus card missing'); assert(await evaluate("document.querySelector('#cart-total').textContent") === '$1.66', 'three-item total is not $1.66');
  });
  await test('cart quantity and remove controls work', async () => {
    await evaluate(`(() => { const row=[...document.querySelectorAll('.cart-row')].find(x=>x.querySelector('strong').textContent==='Ring'); row.querySelectorAll('.quantity-control button')[1].click(); })()`); assert(await evaluate("document.querySelector('#cart-total').textContent") === '$2.41', 'increase total wrong');
    await evaluate(`(() => { const row=[...document.querySelectorAll('.cart-row')].find(x=>x.querySelector('strong').textContent==='Ring'); row.querySelectorAll('.quantity-control button')[0].click(); })()`); assert(await evaluate("document.querySelector('#cart-total').textContent") === '$1.66', 'decrease total wrong');
    await evaluate(`(() => { const row=[...document.querySelectorAll('.cart-row')].find(x=>x.querySelector('strong').textContent==='Half-size Octopus'); row.querySelector('.remove-button').click(); })()`); assert(await evaluate("document.querySelector('#cart-total').textContent") === '$1.00', 'remove total wrong');
  });
  await test('Infinity Cube shows only labeled White and Green swatches', async () => { const colors = await evaluate(`(() => { const card=[...document.querySelectorAll('.product-card')].find(x=>x.querySelector('h3').textContent==='Infinity Cube'); return [...card.querySelectorAll('.color-swatch')].map(x=>x.dataset.color); })()`); assert(JSON.stringify(colors) === JSON.stringify(['White', 'Green']), `colors were ${colors.join(', ')}`); assert(await evaluate("[...document.querySelectorAll('.color-swatch')].every(x=>x.textContent.trim())"), 'a color swatch is missing a text label'); });
  await test('dark mode toggles without reload', async () => { const before = await evaluate("document.documentElement.dataset.theme"); await evaluate("document.querySelector('.theme-toggle').click()"); const after = await evaluate("document.documentElement.dataset.theme"); assert(after && after !== before, `theme stayed ${before}`); await evaluate("document.querySelector('.theme-toggle').click()"); assert(await evaluate("document.documentElement.dataset.theme") === before, 'second toggle did not restore theme'); });
  await evaluate("document.documentElement.dataset.theme='dark';localStorage.setItem('3d-print-theme','dark')"); await screenshot('storefront-dark.png');
  await evaluate("document.documentElement.dataset.theme='light';localStorage.setItem('3d-print-theme','light')"); await screenshot('storefront-desktop.png');
  await evaluate("document.querySelector('#cart').scrollIntoView()"); await delay(200); await screenshot('storefront-populated-cart.png');
  await evaluate("document.querySelector('#checkout-title').scrollIntoView()"); await delay(200); await screenshot('checkout.png');
  await viewport(360, 800); await navigate(`${base}/`); await waitFor("document.querySelectorAll('.product-card').length === 6");
  await test('360px storefront has no horizontal overflow', async () => { assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), `scroll width ${await evaluate('document.documentElement.scrollWidth')} exceeds ${await evaluate('document.documentElement.clientWidth')}`); assert(await evaluate("getComputedStyle(document.querySelector('.mobile-cart-bar')).display") !== 'none', 'mobile cart bar is hidden'); });
  await screenshot('storefront-mobile.png');
  await test('tablet storefront layouts remain spacious and clear of sticky controls', async () => { for (const [width, height] of [[768, 1024], [1024, 768]]) { await viewport(width, height); await navigate(`${base}/`); await waitFor("document.querySelectorAll('.product-card').length === 6"); assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), `storefront overflows at ${width}`); assert(await evaluate("document.querySelectorAll('.product-card').length") === 6, `catalog missing at ${width}`); assert(await evaluate("!document.querySelector('.mobile-cart-bar').offsetParent"), `mobile cart bar shown at tablet width ${width}`); } await viewport(768, 1024); await screenshot('storefront-tablet-portrait.png'); await viewport(1024, 768); await screenshot('storefront-tablet-landscape.png'); });
  await test('catalog controls are keyboard focusable and reduced motion disables transitions', async () => { await viewport(768, 1024); await evaluate("document.querySelector('.color-swatch').focus()"); assert(await evaluate("document.activeElement.classList.contains('color-swatch')"), 'color control is not keyboard focusable'); await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); assert(await evaluate("getComputedStyle(document.querySelector('.toast')).transitionDuration === '0s'"), 'reduced motion does not remove toast transition'); await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] }); });
  await viewport(900, 900); await navigate(`${base}/order/legacy-ava`); await waitFor("document.querySelector('.receipt-number')?.textContent === 'legacy-ava'");
  await test('public receipt renders locked total without private fields', async () => { const body = await evaluate('document.body.textContent'); assert(body.includes('$7.50'), 'Ava locked total is missing'); assert(!body.includes('@'), 'receipt appears to expose an email'); assert(!body.includes('Private admin'), 'receipt exposes admin notes'); });
  await screenshot('receipt.png');
  await viewport(1440, 1000); await navigate(`${base}/admin`);
  await test('admin login renders and rejects no frontend secret', async () => { assert(await evaluate("!document.querySelector('#login-view').hidden"), 'login view hidden'); assert(await evaluate("document.querySelector('#admin-key').value") === '', 'admin key is prefilled'); });
  await screenshot('admin-login.png');
  await evaluate(`(() => { const key=document.querySelector('#admin-key'); key.value=${JSON.stringify(adminKey)}; document.querySelector('#login-form').requestSubmit(); })()`); await waitFor("!document.querySelector('#dashboard-view').hidden", 12000);
  await test('admin dashboard, aggregates, filters, and orders render', async () => { assert(await evaluate("document.querySelectorAll('#stats .stat-card').length") === 6, 'six order aggregate cards did not render'); assert(await evaluate("document.querySelectorAll('#filters select').length") === 5, 'filters missing'); assert(await evaluate("document.querySelectorAll('#orders-table tr').length > 0 || document.querySelector('#orders-state').textContent.includes('No orders')"), 'order state did not settle'); });
  await test('admin product and settings tabs render', async () => { await evaluate("document.querySelector('[data-tab=\"products\"]').click()"); assert(await evaluate("document.querySelectorAll('.product-card').length") === 6, 'six product editors did not render'); await evaluate("document.querySelector('[data-tab=\"settings\"]').click()"); assert(await evaluate("!document.querySelector('#settings-tab').hidden"), 'settings tab hidden'); await screenshot('settings.png'); await evaluate("document.querySelector('[data-tab=\"orders\"]').click()"); });
  const firstOrderId = await evaluate("document.querySelector('#orders-table .order-id')?.textContent || null");
  if (firstOrderId) await test('admin order drawer renders complete details', async () => { await evaluate("document.querySelector('#orders-table tr').click()"); await waitFor("document.querySelectorAll('#order-detail .detail-section').length >= 3"); assert(await evaluate("document.querySelector('#order-detail').textContent.includes('Locked line items')"), 'line items missing'); assert(await evaluate("document.querySelector('#order-detail').textContent.includes('Private admin notes')"), 'admin notes missing'); await evaluate("document.querySelector('#close-drawer').click()"); });
  await screenshot('admin-desktop.png');
  await viewport(360, 800); await navigate(`${base}/admin`);
  await test('360px admin login has no horizontal overflow', async () => { assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'mobile admin login overflows'); });
  await evaluate(`(() => { const key=document.querySelector('#admin-key'); key.value=${JSON.stringify(adminKey)}; document.querySelector('#login-form').requestSubmit(); })()`); await waitFor("!document.querySelector('#dashboard-view').hidden", 12000);
  await test('360px admin dashboard uses cards without overflow', async () => { assert(await evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), 'mobile dashboard overflows'); assert(await evaluate("getComputedStyle(document.querySelector('#orders-cards')).display") !== 'none', 'mobile order cards are hidden'); });
  await screenshot('admin-mobile.png');
  await test('tablet admin filters and cards remain usable', async () => { await viewport(768, 1024); await navigate(`${base}/admin`); await evaluate(`(() => { const key=document.querySelector('#admin-key'); key.value=${JSON.stringify(adminKey)}; document.querySelector('#login-form').requestSubmit(); })()`); await waitFor("!document.querySelector('#dashboard-view').hidden", 12000); assert(await evaluate('document.documentElement.scrollWidth <= innerWidth'), 'tablet admin overflows'); assert(await evaluate("getComputedStyle(document.querySelector('#orders-cards')).display") !== 'none', 'tablet cards are hidden'); assert(await evaluate("document.querySelector('#filters').getBoundingClientRect().bottom < innerHeight"), 'tablet filters cover order controls'); await screenshot('admin-tablet.png'); });
  await test('browser console has no application errors', async () => { assert(browserErrors.length === 0, browserErrors.join(' | ')); });
  await viewport(1440,1000);await evaluate("document.querySelector('[data-tab=products]').click()");await screenshot('products-desktop.png');
  const clickProductButton = label => evaluate(`([...document.querySelectorAll('#product-dialog button,.catalog-toolbar button')].find(b=>b.textContent===${JSON.stringify(label)})).click()`);
  await test('add product opens editable form and exact price preview',async()=>{
    await clickProductButton('Add product');await waitFor("document.querySelector('#product-dialog form')");
    await evaluate(`(() => {const set=(label,value)=>{const n=document.querySelector('#product-dialog [aria-label="'+label+'"]');n.value=value;n.dispatchEvent(new Event('input',{bubbles:true}));};set('Product name','Browser fixture');set('Short description','Disposable visual test, not a product photograph');set('Image URL','/product-test-cube.png');set('Image alt text','Local test graphic');set('Variant name','White');set('Price (USD)','0.66');})()`);
    await clickProductButton('Preview card');assert(await evaluate("document.querySelector('.catalog-preview').textContent.includes('$0.66')"),'exact preview price missing');await screenshot('product-add.png');
  });
  await test('browser saves product and defaults to readonly detail',async()=>{await clickProductButton('Save product');await waitFor("document.querySelector('#product-dialog h2').textContent==='Product details'");assert(await evaluate("document.querySelector('#product-dialog [name=name]').disabled"),'not readonly');});
  let browserProduct;
  await test('explicit edit safe text errors retain values and cancel works',async()=>{
    await clickProductButton('Edit product');await evaluate(`(()=>{const n=document.querySelector('#product-dialog [name=name]');n.value='<img src=x onerror=alert(1)>';n.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#product-dialog [aria-label="Price (USD)"]').value='0.666';})()`);await clickProductButton('Save product');await waitFor("document.querySelector('#product-dialog .form-message').textContent.includes('decimal')");assert(await evaluate("document.querySelector('#product-dialog [name=name]').value.includes('<img')"),'input lost');assert(await evaluate("!document.querySelector('#product-dialog h3 img')"),'unsafe HTML rendered');await evaluate(`document.querySelector('#product-dialog [aria-label="Price (USD)"]').value='0.66'`);await clickProductButton('Preview card');assert(await evaluate("!document.querySelector('.catalog-preview h3 img')"),'unsafe preview');await screenshot('product-edit.png');
    await clickProductButton('Cancel');await waitFor("document.querySelector('#confirm-dialog').open");await evaluate("document.querySelector('#confirm-dialog [value=confirm]').click()");await waitFor("document.querySelector('#product-dialog h2').textContent==='Product details'");
    browserProduct=await evaluate('productManager.current');await clickProductButton('Close');
  });
  await test('mobile product cards and form have no overflow at all target widths',async()=>{
    for(const width of [320,360,390,430]){await viewport(width,850);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`products overflow at ${width}`);await clickProductButton('Add product');await waitFor("document.querySelector('#product-dialog form')");assert(await evaluate("document.querySelector('#product-dialog').scrollWidth<=innerWidth"),`form overflow at ${width}`);await clickProductButton('Close');}
    await viewport(360,850);await screenshot('products-mobile.png');
  });
  await viewport(1440,1000);
  await test('archive confirmation and restore operate through UI',async()=>{
    await evaluate(`(()=>{const c=[...document.querySelectorAll('.catalog-card')].find(c=>c.querySelector('h3').textContent==='Browser fixture');[...c.querySelectorAll('button')].find(b=>b.textContent==='Archive').click();})()`);await waitFor("document.querySelector('#confirm-dialog').open");await evaluate("document.querySelector('#confirm-dialog [value=confirm]').click()");await waitFor("[...document.querySelectorAll('.catalog-card')].some(c=>c.textContent.includes('Browser fixture')&&c.textContent.includes('Archived'))");await evaluate("document.querySelector('[aria-label=\"Product visibility\"]').value='archived';document.querySelector('[aria-label=\"Product visibility\"]').dispatchEvent(new Event('change'))");await screenshot('products-archived.png');
    await evaluate("[...document.querySelectorAll('.catalog-card button')].find(b=>b.textContent==='Restore').click()");await waitFor("document.querySelector('#confirm-dialog').open");await evaluate("document.querySelector('#confirm-dialog [value=confirm]').click()");await waitFor("document.querySelector('#product-editor').textContent.includes('No products')");
  });
  await test('bug reports tab still loads',async()=>{await evaluate("document.querySelector('[data-tab=\"bug-reports\"]').click()");await waitFor("document.querySelectorAll('#bug-stats .stat-card').length===3");await screenshot('bug-reports.png');});
  await navigate(`${base}/bug-report`); await waitFor("document.querySelector('#bug-form')"); await screenshot('bug-report-public.png');
  await navigate(`${base}/`);await waitFor("document.querySelectorAll('#products .product-card').length===7");await viewport(1440,1000);await screenshot('storefront-picture-desktop.png');
  await test('saved image lazy-loads with alt and bounded dimensions',async()=>{assert(await evaluate("[...document.querySelectorAll('.product-picture img')].some(i=>i.alt==='Local test graphic'&&i.loading==='lazy'&&i.width>0)"),'image missing');});
  await test('storefront no overflow 320 360 390 430 and dark/system themes',async()=>{for(const width of [320,360,390,430]){await viewport(width,850);assert(await evaluate('document.documentElement.scrollWidth<=innerWidth'),`store overflow ${width}`);}await viewport(360,850);await screenshot('storefront-picture-mobile.png');await evaluate("localStorage.removeItem('3d-print-theme')");await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:'dark'}]});await navigate(base+'/');await waitFor("document.documentElement.dataset.theme==='dark'");await screenshot('storefront-picture-dark.png');});
  await test('image failure uses clean placeholder not a broken icon',async()=>{await evaluate("(()=>{const p=ProductTools.picture({imageUrl:'/favicon.ico',imageAlt:'Test'});document.querySelector('#products').prepend(p);p.querySelector('img').dispatchEvent(new Event('error'));})()");assert(await evaluate("document.querySelector('#products>.product-picture').textContent==='Photo unavailable'&&!document.querySelector('#products>.product-picture img')"),'fallback failed');await screenshot('product-image-fallback.png');});
  await test('disposable receipt displays exact price privately',async()=>{const r=await fetch(base+'/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({firstName:'TEST',classColor:'Yellow',email:'browser@example.invalid',items:[{productId:browserProduct.id,color:'White',quantity:1}]})});const created=await r.json();assert(r.status===201,'checkout failed');await navigate(base+'/order/'+created.orderId);await waitFor("document.querySelector('.receipt-number')");assert(await evaluate("document.body.textContent.includes('$0.66')&&!document.body.textContent.includes('@')"),'receipt privacy or amount');await screenshot('receipt-disposable.png');await fetch(base+'/api/admin/orders/'+created.orderId+'/trash',{method:'POST',headers:{'x-admin-key':adminKey}});});
  await test('Greenlight receipt uses the configured safe link and remains unpaid',async()=>{const r=await fetch(base+'/api/orders',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({firstName:'TEST',classColor:'Yellow',email:'greenlight-browser@example.invalid',paymentMethod:'greenlight',items:[{productId:'ring',color:'Standard',quantity:1}]})});const created=await r.json();assert(r.status===201,'Greenlight checkout failed');await navigate(base+'/order/'+created.orderId);await waitFor("document.querySelector('a[href^=\"https://gl.me/\"]')");assert(await evaluate("(()=>{const a=document.querySelector('a[href^=\"https://gl.me/\"]');return a?.target==='_blank'&&a?.rel.includes('noopener')&&a?.rel.includes('noreferrer')&&document.body.textContent.includes('manually confirmed')&&document.body.textContent.includes('$0.75')&&document.body.textContent.includes("+JSON.stringify(created.orderId)+")})()"),'Greenlight receipt controls are unsafe or incomplete');const after=await (await fetch(base+'/api/orders/'+created.orderId)).json();assert(after.order.paymentStatus==='Unpaid','Greenlight link presence marked paid');await fetch(base+'/api/admin/orders/'+created.orderId+'/trash',{method:'POST',headers:{'x-admin-key':adminKey}});});
  const current=await (await fetch(base+'/api/admin/products/'+browserProduct.id,{headers:{'x-admin-key':adminKey}})).json();await fetch(base+'/api/admin/products/'+browserProduct.id+'/archive',{method:'POST',headers:{'content-type':'application/json','x-admin-key':adminKey},body:JSON.stringify({version:current.product.version})});
  await test('product management introduces no browser runtime errors',async()=>assert(browserErrors.length===0,browserErrors.join(' | ')));
  await viewport(900, 700); await navigate(`${base}/not-a-real-route-for-browser-test`); await test('custom 404 renders in browser', async () => { assert(await evaluate("document.querySelector('h1')?.textContent") === 'This page wandered off.', 'custom 404 heading missing'); }); await screenshot('404.png');
} finally {
  if (socket?.readyState === WebSocket.OPEN) socket.close();
  chrome.kill();
  await delay(300);
  await rm(profile, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
