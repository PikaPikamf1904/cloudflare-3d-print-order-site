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
async function test(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } }

try {
  await test('create disposable cash order with server-locked price', async () => {
    const result = await call('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Frontend Test', classColor: 'Yellow', email: 'frontend-test@example.invalid', notes: 'customer start', totalCents: 999999, items: [{ productId: 'ring', color: 'Standard', quantity: 1, priceCents: 1 }] }) });
    assert(result.response.status === 201, result.data.error || `status ${result.response.status}`); assert(result.data.totalCents === 75, `server total was ${result.data.totalCents}`); orderId = result.data.orderId;
  });
  await test('complete detail and customer/order edit preserve locked values', async () => {
    const before = await call(`/api/admin/orders/${encodeURIComponent(orderId)}`, {}, true); const locked = before.data.order;
    const result = await call(`/api/admin/orders/${encodeURIComponent(orderId)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Frontend Edited', classColor: 'Blue', email: 'frontend-edited@example.invalid', status: 'Printing', paymentStatus: 'Paid', notes: 'customer updated', adminNote: 'private updated' }) }, true);
    assert(result.response.status === 200, result.data.error || `status ${result.response.status}`); const order = result.data.order;
    assert(order.first_name === 'Frontend Edited' && order.class_color === 'Blue' && order.email === 'frontend-edited@example.invalid', 'customer fields were not updated');
    assert(order.notes === 'customer updated' && order.admin_note === 'private updated', 'notes were not kept separate'); assert(order.status === 'Printing' && order.paid_at, 'status/payment update failed');
    assert(order.total_cents === locked.total_cents && order.items[0].unit_price_cents === locked.items[0].unit_price_cents && order.created_at === locked.created_at, 'locked order values changed'); assert(order.activity.some((entry) => entry.action === 'customer_updated'), 'customer activity entry missing');
  });
  await test('filters, aggregates, and filtered CSV find edited order', async () => {
    const query = `q=${encodeURIComponent(orderId)}&status=Printing&payment=Paid&class=Blue&source=Current&deleted=active`;
    const result = await call(`/api/admin/orders?${query}`, {}, true); assert(result.response.status === 200 && result.data.orders.length === 1, 'combined filters failed'); assert(result.data.aggregates.totalOrders === 1 && result.data.aggregates.paidRevenueCents === 75, 'filtered aggregates failed');
    const csv = await fetch(`${base}/api/admin/export?${query}`, { headers: { 'x-admin-key': key } }); const body = await csv.text(); assert(csv.status === 200 && body.includes(orderId) && body.includes('Frontend Edited') && body.includes('75'), 'filtered CSV failed'); assert(!body.includes('Frontend Test,'), 'CSV included an unfiltered fixture');
  });
  await test('trash and restore are visible through deleted filter', async () => {
    let result = await call(`/api/admin/orders/${encodeURIComponent(orderId)}/trash`, { method: 'POST' }, true); assert(result.response.status === 200, 'trash failed');
    result = await call(`/api/admin/orders?q=${encodeURIComponent(orderId)}&deleted=active`, {}, true); assert(result.data.orders.length === 0, 'trashed order remained active'); result = await call(`/api/admin/orders?q=${encodeURIComponent(orderId)}&deleted=deleted`, {}, true); assert(result.data.orders.length === 1, 'trash filter missed order');
    result = await call(`/api/admin/orders/${encodeURIComponent(orderId)}/restore`, { method: 'POST' }, true); assert(result.response.status === 200, 'restore failed'); const detail = await call(`/api/admin/orders/${encodeURIComponent(orderId)}`, {}, true); assert(detail.data.order.activity.some((entry) => entry.action === 'trashed') && detail.data.order.activity.some((entry) => entry.action === 'restored'), 'trash activity missing');
  });
  await test('catalog/settings round-trip leaves cash-only configuration intact', async () => {
    const current = await call('/api/admin/catalog', {}, true); assert(current.response.status === 200, 'catalog load failed'); const config = current.data.config;
    assert(config.payments.cash.enabled && config.payments.greenlight.enabled && config.payments.greenlight.url.startsWith('https://gl.me/') && !config.payments.stripe.enabled && !config.payments.stripe.cashAppEnabled && !config.payments.paypal.enabled && !config.payments.venmo.enabled, 'manual payment configuration is not safe');
    const catalogSave = await call('/api/admin/catalog', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ products: current.data.products }) }, true); assert(catalogSave.response.status === 200, catalogSave.data.error || 'catalog round-trip failed');
    const settingsSave = await call('/api/admin/catalog', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: { storeName: config.store_name, orderingOpen: Boolean(config.ordering_open), absenceEnabled: Boolean(config.absence_enabled), absenceMessage: config.absence_message, paymentInstructions: config.payment_instructions, priceDisclaimer: config.price_disclaimer, payments: { cash: { enabled: true }, greenlight: { enabled: true, url: config.payments.greenlight.url }, stripe: { enabled: false, cashAppEnabled: false }, paypal: { enabled: false, mode: 'sandbox' }, venmo: { enabled: false } } } }) }, true); assert(settingsSave.response.status === 200, settingsSave.data.error || 'settings round-trip failed');
  });
  await test('public receipt allows name/class but hides private fields', async () => {
    const result = await call(`/api/orders/${encodeURIComponent(orderId)}`); const serialized = JSON.stringify(result.data); assert(result.response.status === 200, 'receipt failed'); assert(result.data.order.first_name === 'Frontend Edited' && result.data.order.class_color === 'Blue', 'public name/class missing'); assert(!serialized.includes('frontend-edited@example.invalid') && !serialized.includes('private updated') && !serialized.includes('customer_updated'), 'receipt leaked private admin/customer data');
  });
} finally {
  if (orderId) await call(`/api/admin/orders/${encodeURIComponent(orderId)}/trash`, { method: 'POST' }, true);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
