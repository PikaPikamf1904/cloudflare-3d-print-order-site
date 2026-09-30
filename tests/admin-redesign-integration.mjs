const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_ADMIN_KEY || 'local-ui-test-key';
let orderId;
let passed = 0;
let failed = 0;
const assert = (value, message) => { if (!value) throw new Error(message); };
async function call(path, options = {}, authenticated = false) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { accept: 'application/json', ...(options.headers || {}), ...(authenticated ? { 'x-admin-key': key } : {}) } });
  let data = {}; try { data = await response.json(); } catch {}
  return { response, data };
}
const search = (body, authenticated = true) => call('/api/admin/orders/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, authenticated);
async function test(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } }

try {
  await test('create High School cash order without email and keep server-locked price', async () => {
    const result = await call('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Frontend Test', classColor: 'High School', notes: 'customer start', totalCents: 999999, items: [{ productId: 'ring', color: 'Standard', quantity: 1, priceCents: 1 }] }) });
    assert(result.response.status === 201, result.data.error || `status ${result.response.status}`); assert(result.data.totalCents === 150, `server total was ${result.data.totalCents}`); orderId = result.data.orderId;
  });
  await test('invalid email is rejected only when an email is provided', async () => {
    const result = await call('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Invalid Email Test', classColor: 'High School', email: 'not-an-email', items: [{ productId: 'ring', color: 'Standard', quantity: 1 }] }) });
    assert(result.response.status === 400, `invalid email returned ${result.response.status}`);
  });
  await test('complete detail and customer/order edit preserve locked values', async () => {
    const before = await call(`/api/admin/orders/${encodeURIComponent(orderId)}`, {}, true); const locked = before.data.order;
    const result = await call(`/api/admin/orders/${encodeURIComponent(orderId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Frontend Edited', classColor: 'High School', email: '', status: 'Printing', paymentStatus: 'Paid', notes: 'customer updated', adminNote: 'private updated' }) }, true);
    assert(result.response.status === 200, result.data.error || `status ${result.response.status}`); const order = result.data.order;
    assert(order.first_name === 'Frontend Edited' && order.class_color === 'High School' && order.email === '', 'optional email or High School class was not preserved');
    assert(order.notes === 'customer updated' && order.admin_note === 'private updated', 'notes were not kept separate'); assert(order.status === 'Printing' && order.paid_at, 'status/payment update failed');
    assert(order.amountReceivedCents === 0 && order.remainingBalanceCents === 150 && order.greenlight_confirmed === false, 'administrative Paid correction invented payment evidence or inflated received cents');
    assert(order.total_cents === locked.total_cents && order.items[0].unit_price_cents === locked.items[0].unit_price_cents && order.created_at === locked.created_at, 'locked order values changed'); assert(order.activity.some((entry) => entry.action === 'customer_updated'), 'customer activity entry missing');
  });
  await test('filters, aggregates, and filtered CSV find edited order', async () => {
    const filters = { q: orderId, status: 'Printing', payment: 'Paid', class: 'High School', source: 'Current', deleted: 'active' };
    const result = await search(filters); assert(result.response.status === 200 && result.data.orders.length === 1, 'combined body filters failed'); assert(result.data.orders[0].received_cents === 0 && result.data.orders[0].greenlight_confirmed === 0, 'list and detail disagree about unrecorded payment evidence'); assert(result.data.aggregates.totalOrders === 1 && result.data.aggregates.recordedPaymentCents === 0 && result.data.aggregates.unpaidBalanceCents === 150, 'aggregates confused status with payment evidence');
    const csv = await fetch(`${base}/api/admin/export`, { method: 'POST', headers: { 'x-admin-key': key, 'content-type': 'application/json' }, body: JSON.stringify(filters) }); const body = await csv.text(); assert(csv.status === 200 && csv.headers.get('cache-control') === 'no-store, private' && body.includes(orderId) && body.includes('Frontend Edited') && /1.?50/.test(body), 'filtered CSV failed'); assert(!body.includes('Frontend Test,'), 'CSV included an unfiltered fixture');
    assert((await call(`/api/admin/orders?q=${encodeURIComponent(orderId)}`, {}, true)).response.status === 400, 'legacy GET accepted private free-text search');
    assert((await search({ q: 'x'.repeat(81) })).response.status === 400 && (await search({ q: orderId, extra: 'unexpected' })).response.status === 400, 'invalid search filters were accepted');
    assert((await search({ q: orderId }, false)).response.status === 401, 'body search did not require authentication');
    const deniedCsv = await fetch(`${base}/api/admin/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ q: orderId }) }); assert(deniedCsv.status === 401, 'body CSV did not require authentication');
  });
  await test('trash and restore are visible through deleted filter', async () => {
    let result = await call(`/api/admin/orders/${encodeURIComponent(orderId)}/trash`, { method: 'POST' }, true); assert(result.response.status === 200, 'trash failed');
    result = await search({ q: orderId, deleted: 'active' }); assert(result.data.orders.length === 0, 'trashed order remained active'); result = await search({ q: orderId, deleted: 'deleted' }); assert(result.data.orders.length === 1, 'trash filter missed order');
    result = await call(`/api/admin/orders/${encodeURIComponent(orderId)}/restore`, { method: 'POST' }, true); assert(result.response.status === 200, 'restore failed'); const detail = await call(`/api/admin/orders/${encodeURIComponent(orderId)}`, {}, true); assert(detail.data.order.activity.some((entry) => entry.action === 'trashed') && detail.data.order.activity.some((entry) => entry.action === 'restored'), 'trash activity missing');
  });
  await test('catalog/settings round-trip leaves cash-only configuration intact', async () => {
    const current = await call('/api/admin/catalog', {}, true); assert(current.response.status === 200, 'catalog load failed'); const config = current.data.config;
    assert(config.payments.cash.enabled && config.payments.greenlight.enabled && config.payments.greenlight.url.startsWith('https://gl.me/') && !config.payments.stripe.enabled && !config.payments.stripe.cashAppEnabled && !config.payments.paypal.enabled && !config.payments.venmo.enabled, 'manual payment configuration is not safe');
    const catalogSave = await call('/api/admin/catalog', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ products: current.data.products }) }, true); assert(catalogSave.response.status === 200, catalogSave.data.error || 'catalog round-trip failed');
    const settingsSave = await call('/api/admin/catalog', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: { storeName: config.store_name, orderingOpen: Boolean(config.ordering_open), absenceEnabled: Boolean(config.absence_enabled), absenceMessage: config.absence_message, paymentInstructions: config.payment_instructions, priceDisclaimer: config.price_disclaimer, payments: { cash: { enabled: true }, greenlight: { enabled: true, url: config.payments.greenlight.url }, stripe: { enabled: false, cashAppEnabled: false }, paypal: { enabled: false, mode: 'sandbox' }, venmo: { enabled: false } } } }) }, true); assert(settingsSave.response.status === 200, settingsSave.data.error || 'settings round-trip failed');
  });
  await test('public receipt allows name/class but hides private fields', async () => {
    const result = await call(`/api/orders/${encodeURIComponent(orderId)}`); const serialized = JSON.stringify(result.data); assert(result.response.status === 200, 'receipt failed'); assert(result.data.order.first_name === 'Frontend Edited' && result.data.order.class_color === 'High School', 'public name/class missing'); assert(!serialized.includes('private updated') && !serialized.includes('customer_updated'), 'receipt leaked private admin/customer data');
  });
} finally {
  if (orderId) await call(`/api/admin/orders/${encodeURIComponent(orderId)}/trash`, { method: 'POST' }, true);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
