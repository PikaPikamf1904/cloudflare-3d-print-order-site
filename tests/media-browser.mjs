import {pngPixel} from './png-pixel.mjs';
import {startLocalWorker,stopLocalWorker} from './local-worker.mjs';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const context=process.env.EXTERNAL_TEST_SERVER?null:await startLocalWorker();
const base=context?.base||process.env.TEST_BASE_URL;
const adminKey=context?.key||process.env.TEST_ADMIN_KEY;
const port = 9224;
const profile = await mkdtemp(join(tmpdir(), '3d-print-browser-'));
const artifacts = resolve(process.env.TEST_ARTIFACTS_DIR || 'test-artifacts');
await mkdir(artifacts, { recursive: true });
const chrome = spawn(chromePath, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
let socket;
let sequence = 0;
const pending = new Map();
const eventWaiters = new Map();
const browserErrors = [];
let expectedRefreshFailureConsoleCount = 0;
let allowExpectedDuplicateColorError = false;
let expectedDuplicateColorErrorCount = 0;
const adminNetworkRequests = [];
const manualPaymentRequests = [];
let mediaFailNext=false,mediaFailures=0;
let failCatalogRequests = 0;
let failedCatalogRequests = 0;
const browserOrderIds = [];
let passed = 0;
let failed = 0;

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
function assert(value, message) { if (!value) throw new Error(message); }
async function test(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } }
async function waitForJson(url, options) { for (let i = 0; i < 80; i += 1) { try { const response = await fetch(url, options); if (response.ok) return response.json(); } catch {} await delay(100); } throw new Error(`Timed out waiting for ${url}`); }
function send(method, params = {}) { const id = ++sequence; socket.send(JSON.stringify({ id, method, params })); return new Promise((resolveSend, reject) => pending.set(id, { resolve: resolveSend, reject })); }
function waitEvent(method, timeout = 5000) { return new Promise((resolveEvent, reject) => { const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout); const list = eventWaiters.get(method) || []; list.push((params) => { clearTimeout(timer); resolveEvent(params); }); eventWaiters.set(method, list); }); }
async function evaluate(expression) { const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture:true }); if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Browser evaluation failed'); return result.result.value; }
async function waitFor(expression, timeout = 8000) { const started = Date.now(); let lastError; while (Date.now() - started < timeout) { try { if (await evaluate(expression)) return; } catch (error) { lastError = error; } await delay(100); } throw new Error(`Timed out waiting for: ${expression}${lastError ? ` (last evaluation: ${lastError.message})` : ''}`); }
async function waitForCondition(predicate, timeout = 5000) { const started = Date.now(); while (Date.now() - started < timeout) { if (predicate()) return; await delay(50); } throw new Error('Timed out waiting for captured browser request.'); }
async function navigate(url) { const loaded = waitEvent('Page.loadEventFired', 10000); await send('Page.navigate', { url }); await loaded; }
async function viewport(width, height) { await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: width <= 640 }); }
async function stopChrome() {
  if (process.platform === 'win32' && chrome.exitCode === null && chrome.signalCode === null) {
    await new Promise((resolve) => {
      const killer = spawn('taskkill.exe', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' });
      killer.once('error', resolve);
      killer.once('exit', resolve);
    });
  } else if (chrome.exitCode === null && chrome.signalCode === null) chrome.kill();
  if (chrome.exitCode === null && chrome.signalCode === null) {
    await Promise.race([new Promise((resolve) => chrome.once('exit', resolve)), delay(10000)]);
  }
}
async function removeChromeProfile() {
  await rm(profile, { recursive: true, force: true, maxRetries: 100, retryDelay: 200 });
}
async function screenshot(name) {
  // Mask even imported fixture identities and references in screenshot artifacts.
  await evaluate(`(() => { window.__masked=[];const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while(n=walker.nextNode()){if(['SCRIPT','STYLE'].includes(n.parentElement.tagName))continue;const safe=n.textContent.replace(/legacy-[a-z-]+|3D-[A-Z0-9-]+|BUG-[A-Z0-9-]+|Test Customer|Frontend Edited|Frontend Test|[^\\s@]+@[^\\s@]+/gi,'[local fixture]');if(safe!==n.textContent){window.__masked.push([n,n.textContent]);n.textContent=safe;}} })()`);
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
    if (message.method === 'Log.entryAdded' && message.params.entry.level === 'error') {
      const text = message.params.entry.text;
      if (text === 'Failed to load resource: the server responded with a status of 503 (Service Unavailable)' && failedCatalogRequests > expectedRefreshFailureConsoleCount) expectedRefreshFailureConsoleCount += 1;
      else if (text === 'Failed to load resource: the server responded with a status of 400 (Bad Request)' && allowExpectedDuplicateColorError) expectedDuplicateColorErrorCount += 1;
      else browserErrors.push(text);
    }
    if (message.method === 'Network.requestWillBeSent' && /\/api\/admin\/(catalog|orders\/search|export)(?:$|\?)/.test(message.params.request.url)) adminNetworkRequests.push({ url: message.params.request.url, method: message.params.request.method, postData: message.params.request.postData || '' });
    if (message.method === 'Network.requestWillBeSent' && /\/api\/admin\/orders\/[^/]+\/payments$/.test(new URL(message.params.request.url).pathname)) manualPaymentRequests.push({ url: message.params.request.url, method: message.params.request.method, postData: message.params.request.postData || '' });
    if (message.method === 'Fetch.requestPaused') {
      const request = message.params.request;
      if(mediaFailNext&&request.url.endsWith('/media')&&request.method==='POST'){mediaFailNext=false;mediaFailures++;send('Fetch.fulfillRequest',{requestId:message.params.requestId,responseCode:503,responseHeaders:[{name:'content-type',value:'application/json'}],body:Buffer.from('{"error":"Synthetic upload failure."}').toString('base64')}).catch(()=>{});}
      else if (failCatalogRequests > 0 && request.url.endsWith('/api/admin/catalog') && request.method === 'GET') { failCatalogRequests -= 1; failedCatalogRequests += 1; send('Fetch.fulfillRequest', { requestId: message.params.requestId, responseCode: 503, responseHeaders: [{name:'content-type',value:'application/json'}], body: Buffer.from('{"error":"Synthetic refresh failure."}').toString('base64') }).catch(() => {}); }
      else send('Fetch.continueRequest', { requestId: message.params.requestId }).catch(() => {});
    }
    const list = eventWaiters.get(message.method); if (list?.length) { const resolveEvent = list.shift(); resolveEvent(message.params); }
  });
  await send('Page.enable');await send('Page.bringToFront'); await send('Runtime.enable'); await send('Log.enable'); await send('Network.enable');
  const click=text=>evaluate(`(()=>{const b=[...document.querySelectorAll('#product-dialog button')].find(x=>x.textContent===${JSON.stringify(text)});if(!b)throw Error('Button missing');b.click();})()`);
  const api=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{'x-admin-key':adminKey,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const d=await r.json();assert(r.ok,d.error);return d;};
  const created=await api('/api/admin/products','POST',{name:'Disposable gallery fixture',description:'Local browser only',imageUrl:'',imageAlt:'',enabled:true,sortOrder:9000,colors:[{color:'White',priceCents:73,enabled:true,sortOrder:0,swatch:''}]});const productId=created.product.id;
  await navigate(base+'/admin');await evaluate(`document.querySelector('#admin-key').value=${JSON.stringify(adminKey)};document.querySelector('#login-form').requestSubmit()`);await waitFor("!document.querySelector('#dashboard-view').hidden");
  await evaluate(`productManager.open(${JSON.stringify(productId)})`);await waitFor("document.querySelector('#product-dialog h2').textContent==='Product details'");await click('Edit product');
  await test('normal upload picker opens and supports multiple files',async()=>{
    await send('Page.setInterceptFileChooserDialog',{enabled:true});const event=waitEvent('Page.fileChooserOpened');await click('Upload photos or GIFs');const picker=await event;assert(picker.mode==='selectMultiple','picker does not allow multiple files');
    await send('DOM.setFileInputFiles',{backendNodeId:picker.backendNodeId,files:['valid.png','animated.gif','animated.webp'].map(x=>resolve('tests/fixtures/media',x))});await waitFor('productManager.mediaEditor.queue.length===3&&!productManager.mediaBusy');
    assert(await evaluate("productManager.mediaEditor.queue.every(x=>x.status==='Saved')"),'multiple upload did not succeed');assert(await evaluate("productManager.current.media.every(x=>x.previewUrl)"),'still previews missing');
  });
  await test('uploading preserves unsaved name and price fields',async()=>{
    await evaluate("productManager.controls.name.value='Unsaved title';productManager.controls.name.dispatchEvent(new Event('input',{bubbles:true}));productManager.variants.firstChild.inputs.price.value='0.89'");
    await send('DOM.getDocument');const {root}=await send('DOM.getDocument');const {nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'.product-media-editor input[multiple]'});await send('DOM.setFileInputFiles',{nodeId,files:[resolve('tests/fixtures/media/valid.jpg')]});await waitFor('productManager.mediaEditor.queue.length===4&&!productManager.mediaBusy');
    assert(await evaluate("productManager.controls.name.value==='Unsaved title'&&productManager.variants.firstChild.inputs.price.value==='0.89'"),'unsaved fields were lost');const saved=(await api('/api/admin/products/'+productId)).product;assert(saved.name===created.product.name&&saved.colors[0].priceCents===73,'upload saved product fields');
  });
  await test('desktop drag and drop uploads multiple files and keeps unsaved fields',async()=>{
    const at=selector=>evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}})()`);
    const data={items:[],files:['valid.webp','valid.gif'].map(x=>resolve('tests/fixtures/media',x)),dragOperationsMask:1};
    const zone=await at('.media-drop');await send('Input.dispatchDragEvent',{type:'dragEnter',...zone,data});await send('Input.dispatchDragEvent',{type:'dragOver',...zone,data});
    assert(await evaluate("document.querySelector('.product-media-editor').classList.contains('media-dragging')"),'drop area shows no drag state');
    await send('Input.dispatchDragEvent',{type:'drop',...zone,data});await waitFor("productManager.mediaEditor.queue.length===6&&!productManager.mediaBusy");
    assert(await evaluate("productManager.mediaEditor.queue.slice(4).every(x=>x.status==='Saved')&&!document.querySelector('.product-media-editor').classList.contains('media-dragging')"),'dropped files did not upload');
    const stray=await at('#product-dialog h2');const href=await evaluate('location.href');await send('Input.dispatchDragEvent',{type:'dragOver',...stray,data});await send('Input.dispatchDragEvent',{type:'drop',...stray,data});await delay(300);
    assert(await evaluate(`location.href===${JSON.stringify(href)}&&productManager.controls.name.value==='Unsaved title'&&productManager.mediaEditor.queue.length===6`),'stray drop navigated, uploaded or lost unsaved fields');
    assert((await api('/api/admin/products/'+productId)).product.name===created.product.name,'drop saved product fields');
  });
  await test('cover selection accessible reorder alt text and media save',async()=>{
    await evaluate("document.querySelectorAll('.media-list .media-row')[1].querySelector('.catalog-actions button').click()");assert(await evaluate("productManager.mediaEditor.items[0].type==='image/gif'"),'cover selection failed');
    await evaluate("(()=>{const input=document.querySelector('.media-list .media-row input');input.value='Red and blue animated cube';input.dispatchEvent(new Event('input',{bubbles:true}));})()");await click('Save media');await waitFor('!productManager.mediaBusy');
    const d=await api('/api/admin/products/'+productId+'/media');assert(d.media[0].type==='image/gif'&&d.media[0].alt==='Red and blue animated cube','cover or alt not saved');assert(await evaluate("productManager.controls.name.value==='Unsaved title'"),'media save discarded form edits');
    await evaluate("document.querySelector('.media-row .catalog-actions button:nth-child(3)').click()");assert(await evaluate("productManager.mediaEditor.items[1].type==='image/gif'"),'move later failed');await click('Save media');await waitFor('!productManager.mediaBusy');
  });
  await test('failed replacement retains original and retry adds no duplicate',async()=>{
    const before=await api('/api/admin/products/'+productId+'/media'),old=before.media[0];mediaFailNext=true;await send('Fetch.enable',{patterns:[{urlPattern:'*/api/admin/products/*/media'}]});
    await evaluate("document.querySelector('.media-list .media-row button:nth-child(4)').click()");
    const {root}=await send('DOM.getDocument'),{nodeId}=await send('DOM.querySelector',{nodeId:root.nodeId,selector:'.media-list .media-row input[type=file]'});await send('DOM.setFileInputFiles',{nodeId,files:[resolve('tests/fixtures/media/valid.png')]});await waitFor("!productManager.mediaBusy&&productManager.mediaEditor.queue.at(-1).status==='Failed'");
    assert((await api('/api/admin/products/'+productId+'/media')).media[0].id===old.id,'failed replacement removed original');await evaluate("[...document.querySelectorAll('.media-queue button')].find(x=>x.textContent==='Retry').click()");await waitFor("!productManager.mediaBusy&&productManager.mediaEditor.queue.at(-1).status==='Saved'");
    const after=await api('/api/admin/products/'+productId+'/media');assert(after.media.length===before.media.length&&!after.media.some(x=>x.id===old.id),'replacement duplicated or retained obsolete metadata');assert(mediaFailures===1,'failure injection missing');await send('Fetch.disable');
  });
  await test('removal requires confirmation and takes effect on save',async()=>{
    const before=await api('/api/admin/products/'+productId+'/media');await evaluate("[...document.querySelectorAll('.media-list .media-row button')].find(x=>x.textContent==='Remove').click()");await waitFor("document.querySelector('#confirm-dialog').open");assert((await api('/api/admin/products/'+productId+'/media')).media.length===before.media.length,'removed before confirmation');
    await evaluate("document.querySelector('#confirm-dialog [value=confirm]').click()");await waitFor(`productManager.mediaEditor.items.length===${before.media.length-1}`);await click('Save media');await waitFor('!productManager.mediaBusy');assert((await api('/api/admin/products/'+productId+'/media')).media.length===before.media.length-1,'removal not saved');
  });
  await test('mobile editor controls fit and stay usable at 360px',async()=>{await viewport(360,850);assert(await evaluate("document.querySelector('#product-dialog').scrollWidth<=innerWidth"),'mobile editor overflows');assert(await evaluate("[...document.querySelectorAll('.media-list button')].every(x=>x.getBoundingClientRect().height>=44)"),'media controls too small');await screenshot('media-editor-mobile.png');});
  // Leave unsaved product fields behind; completed media remains saved by design.
  await click('Cancel');await waitFor("document.querySelector('#confirm-dialog').open");await evaluate("document.querySelector('#confirm-dialog [value=confirm]').click()");await waitFor("document.querySelector('#product-dialog h2').textContent==='Product details'");await click('Close');
  await navigate(base+'/');await waitFor(`document.querySelectorAll('.gallery-open').length>0`);
  const openGallery=async()=>{await evaluate(`(()=>{const card=[...document.querySelectorAll('.product-card')].find(x=>x.querySelector('h3').textContent===${JSON.stringify(created.product.name)});card.querySelector('.gallery-open').click();})()`);await waitFor("document.querySelector('.product-gallery')?.open");};
  await test('storefront cover uses the small preview and gallery does not change cart',async()=>{
    assert(await evaluate(`(()=>{const c=[...document.querySelectorAll('.product-card')].find(x=>x.querySelector('h3').textContent===${JSON.stringify(created.product.name)});return c.querySelector('.product-picture img').src.endsWith('/preview')})()`),'card loads full animation');const before=await evaluate("document.querySelector('#header-cart-count').textContent");await openGallery();assert(await evaluate("document.querySelector('#header-cart-count').textContent")===before,'opening gallery changed cart');
    assert(await evaluate("getComputedStyle(document.querySelector('.gallery-main img')).objectFit==='contain'"),'expanded image crops product');await screenshot('media-gallery-mobile.png');
  });
  await test('gallery keyboard navigation Escape and focus return',async()=>{const before=await evaluate("document.querySelector('.gallery-controls [role=status]').textContent");await send('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});assert(await evaluate("document.querySelector('.gallery-controls [role=status]').textContent")!==before,'ArrowRight failed');await send('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await waitFor("!document.querySelector('.product-gallery')");assert(await evaluate("document.activeElement.classList.contains('gallery-open')"),'focus did not return');});
  await test('mobile swipe changes image without changing cart',async()=>{await openGallery();const before=await evaluate("document.querySelector('.gallery-controls [role=status]').textContent");await evaluate("(()=>{const main=document.querySelector('.gallery-main');for(const[type,x]of [['touchstart',220],['touchend',80]]){const e=new Event(type);Object.defineProperty(e,'changedTouches',{value:[{clientX:x,clientY:200}]});main.dispatchEvent(e);}})()");assert(await evaluate("document.querySelector('.gallery-controls [role=status]').textContent")!==before,'swipe failed');});
  await test('reduced motion uses explicit animation playback',async()=>{
    await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});await delay(150);await evaluate("(()=>{const b=[...document.querySelectorAll('.gallery-thumbnails button')].find(x=>x.textContent.includes('Animation'));b.click();})()");assert(await evaluate("!document.querySelector('.gallery-main img')&&document.querySelector('.gallery-main').textContent.includes('Play animation')"),'animation autoplays under reduced motion');await evaluate("document.querySelector('.gallery-main button').click()");await waitFor("document.querySelector('.gallery-main img')?.complete&&document.querySelector('.gallery-main img')?.naturalWidth>0");await send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'no-preference'}]});await delay(150);
  });
  for(const format of ['gif','webp'])await test(`${format.toUpperCase()} animation actually changes rendered browser pixels`,async()=>{
    await evaluate(`(()=>{const items=MediaTools.items(${JSON.stringify((await api('/api/admin/products/'+productId)).product)});const index=items.findIndex(x=>x.type==='image/${format}');document.querySelectorAll('.gallery-thumbnails button')[index].click();})()`);await waitFor("document.querySelector('.gallery-main img')?.complete&&document.querySelector('.gallery-main img')?.naturalWidth>0");
    const rect=await evaluate("(()=>{const r=document.querySelector('.gallery-main img').getBoundingClientRect();return{x:Math.floor(r.x+r.width/2),y:Math.floor(r.y+r.height/2),width:2,height:2,scale:1}})()");const pixels=new Set();for(let i=0;i<12;i++){const image=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});pixels.add(pngPixel(image.data,rect.x,rect.y));if(i===0||i===6){const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(artifacts,`media-${format}-frame-${i}.png`),Buffer.from(shot.data,'base64'));}await delay(90);}assert(pixels.size>1,`${format} rendered pixels stayed static`);
  });
  await test('single image and zero image gallery behavior',async()=>{await evaluate("document.querySelector('.product-gallery button').click()");await waitFor("!document.querySelector('.product-gallery')");await evaluate("ProductGallery.open({name:'Single',media:[{id:'legacy',url:'/product-test-cube.png',alt:'Single test'}]},document.querySelector('.gallery-open'))");assert(await evaluate("document.querySelector('.gallery-controls [role=status]').textContent==='1 of 1'&&[...document.querySelectorAll('.gallery-controls button')].every(x=>x.disabled)"),'single image controls wrong');await evaluate("document.querySelector('.product-gallery button').click()");await waitFor("!document.querySelector('.product-gallery')");await evaluate("ProductGallery.open({name:'Empty',media:[]},document.querySelector('.gallery-open'))");assert(await evaluate("!document.querySelector('.product-gallery')"),'zero-image gallery opened');});
  await test('media browser checks produce no unexpected runtime errors',async()=>{const unexpected=browserErrors.filter(x=>!x.includes('503 (Service Unavailable)'));assert(unexpected.length===0,unexpected.join(' | '));});
  const current=(await api('/api/admin/products/'+productId)).product;const media=await api('/api/admin/products/'+productId+'/media');await api('/api/admin/products/'+productId+'/media','PATCH',{mediaVersion:media.mediaVersion,items:[]});await api('/api/admin/products/'+productId+'/archive','POST',{version:current.version});
}finally{socket?.close();await stopChrome();await removeChromeProfile();await stopLocalWorker(context);}
console.log(`\n${passed} passed, ${failed} failed`);if(failed)process.exitCode=1;
