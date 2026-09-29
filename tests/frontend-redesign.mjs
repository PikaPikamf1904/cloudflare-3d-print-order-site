const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
let passed = 0;
let failed = 0;

async function test(name, run) {
  try { await run(); passed += 1; console.log(`PASS ${name}`); }
  catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); }
}
function assert(value, message) { if (!value) throw new Error(message); }
async function get(path) { return fetch(`${base}${path}`, { redirect: 'manual' }); }

await test('storefront HTML and security headers', async () => {
  const response = await get('/'); const body = await response.text();
  assert(response.status === 200, `status ${response.status}`);
  assert(response.headers.get('content-type')?.includes('text/html'), 'wrong content type');
  assert(response.headers.get('x-content-type-options') === 'nosniff', 'nosniff missing');
  assert(body.includes('Choose your prints') && body.includes('/theme.js'), 'redesigned storefront missing');
});
await test('catalog contract and locked catalog prices', async () => {
  const response = await get('/api/store'); const data = await response.json();
  assert(response.status === 200, `status ${response.status}`);
  assert(data.products.length === 4, `expected 4 products, got ${data.products.length}`);
  assert(data.products.reduce((sum, product) => sum + product.colors.length, 0) === 7, 'expected 7 colors');
  const price = (id, color) => data.products.find((product) => product.id === id)?.colors.find((entry) => entry.color === color)?.priceCents;
  assert(price('ring', 'Standard') === 175, 'Ring is not $1.75');
  assert(price('kirby', 'Red') === 25, 'Red Kirby is not 25 cents');
  assert(!data.products.some((product) => ['octopus','half-octopus'].includes(product.id)), 'Octopus products are still visible');
  assert(price('infinity-cube', 'White') === 175, 'Infinity Cube is not $1.75');
  assert(price('weighted-cube', 'White') === 225, 'Weighted Infinity Cube is not $2.25');
  const cube = data.products.find((product) => product.id === 'infinity-cube');
  assert(cube.colors.every((entry) => ['White', 'Green'].includes(entry.color)), 'Infinity Cube exposes a forbidden color');
  const serialized = JSON.stringify(data);
  assert(!/ADMIN_KEY|STRIPE_SECRET|PAYPAL_CLIENT_SECRET|webhook_secret/i.test(serialized), 'public store response exposes a secret field');
});
await test('admin assets retain correct content types and no-store', async () => {
  const html = await get('/admin'); const js = await get('/admin.js'); const css = await get('/admin.css');
  assert(html.status === 200 && html.headers.get('content-type')?.includes('text/html'), 'admin HTML content type failed');
  assert(html.headers.get('cache-control')?.includes('no-store'), 'admin no-store missing');
  assert(js.headers.get('content-type')?.includes('javascript'), 'admin JS content type failed');
  assert(css.headers.get('content-type')?.includes('text/css'), 'admin CSS content type failed');
});
await test('admin APIs require authentication', async () => {
  for (const path of ['/api/admin/orders', '/api/admin/catalog', '/api/admin/export']) {
    const response = await get(path); assert(response.status === 401, `${path} returned ${response.status}`);
    assert(response.headers.get('content-type')?.includes('application/json'), `${path} is not JSON`);
  }
});
await test('receipt route and public receipt privacy', async () => {
  const page = await get('/order/legacy-test-history'); const html = await page.text();
  assert(page.status === 200 && page.headers.get('content-type')?.includes('text/html'), 'receipt page route failed');
  assert(html.includes('/order.js') && !html.includes('<script>'), 'receipt does not use external script');
  const response = await get('/api/orders/legacy-test-history');
  if (response.status === 200) {
    const data = await response.json(); const serialized = JSON.stringify(data);
    assert(data.order.total_cents === 750, `synthetic locked total changed to ${data.order.total_cents}`);
    assert(!Object.hasOwn(data.order, 'email'), 'public receipt exposes email');
    assert(!Object.hasOwn(data.order, 'admin_note'), 'public receipt exposes admin note');
    assert(!Object.hasOwn(data.order, 'activity'), 'public receipt exposes activity');
    assert(!/secret|raw_event/i.test(serialized), 'public receipt exposes provider internals');
  }
});
await test('friendly pages and custom 404', async () => {
  for (const path of ['/bug-report', '/privacy', '/terms', '/accessibility', '/error']) {
    const response = await get(path); assert(response.status === 200, `${path} returned ${response.status}`); assert(response.headers.get('content-type')?.includes('text/html'), `${path} is not HTML`);
  }
  const missing = await get('/definitely-not-a-real-page'); const body = await missing.text();
  assert(missing.status === 404, `missing route returned ${missing.status}`);
  assert(body.includes('This page wandered off'), 'custom 404 body missing');
});
await test('canonical metadata, robots, and sitemap use the production origin', async () => {
  const home = await (await get('/')).text();
  assert(home.includes('rel="canonical"') && home.includes('https://enrichment-3d-print-orders.life-line-gaming-solutions.workers.dev/'), 'canonical production URL missing');
  const robots = await get('/robots.txt'); const robotsBody = await robots.text();
  assert(robots.status === 200 && robots.headers.get('content-type')?.includes('text/plain') && robotsBody.includes('Disallow: /admin') && robotsBody.includes('sitemap.xml'), 'robots.txt is incomplete');
  const sitemap = await get('/sitemap.xml'); const sitemapBody = await sitemap.text();
  assert(sitemap.status === 200 && sitemap.headers.get('content-type')?.includes('xml') && sitemapBody.includes('/accessibility'), 'sitemap.xml is incomplete');
});
await test('dark mode and mobile design hooks exist', async () => {
  const css = await (await get('/styles.css')).text(); const adminCss = await (await get('/admin.css')).text();
  assert(css.includes('[data-theme="dark"]') && adminCss.includes('[data-theme="dark"]'), 'dark mode tokens missing');
  assert(css.includes('@media(max-width:640px)') && adminCss.includes('@media(max-width:760px)'), 'mobile breakpoints missing');
  assert(css.includes('min-height:44px') && adminCss.includes('min-height:44px'), 'touch target rules missing');
  assert(css.includes('.color-swatch') && css.includes('.swatch-dot'), 'labeled color swatch rules missing');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
