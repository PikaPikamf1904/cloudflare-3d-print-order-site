const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_ADMIN_KEY || 'local-ui-test-key';
let passed = 0;
let failed = 0;
const created = [];
const assert = (value, message) => { if (!value) throw new Error(message); };
async function call(path, options = {}, authenticated = false) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { accept: 'application/json', ...(options.headers || {}), ...(authenticated ? { 'x-admin-key': key } : {}) } });
  let data = {}; try { data = await response.json(); } catch {}
  return { response, data };
}
async function test(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } }
async function create(method, productId = 'ring', color = 'Standard') {
  const result = await call('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: 'Payment Test', classColor: 'Yellow', email: 'payment-test@example.invalid', paymentMethod: method, items: [{ productId, color, quantity: 1 }] }) });
  assert(result.response.status === 201, result.data.error || `create status ${result.response.status}`); created.push(result.data.orderId); return result.data;
}
const postPayment = (orderId, body) => call(`/api/admin/orders/${encodeURIComponent(orderId)}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, true);

try {
  await test('Greenlight settings are safe and online processors stay disabled', async () => {
    const store = await call('/api/store'); const payments = store.data.config.payments;
    assert(store.response.status === 200 && payments.cash.enabled && payments.greenlight.enabled, 'manual methods are not enabled');
    assert(payments.greenlight.url === 'https://gl.me/u/gqpcpm2TtjkK', 'configured Greenlight URL changed');
    assert(!payments.stripe.enabled && !payments.stripe.cashAppEnabled && !payments.paypal.enabled && !payments.venmo.enabled, 'an online processor is enabled');
  });
  await test('Greenlight checkout stays unpaid and receipt exposes only the safe manual link', async () => {
    const order = await create('greenlight'); const receipt = await call(`/api/orders/${encodeURIComponent(order.orderId)}`); const serialized = JSON.stringify(receipt.data);
    assert(receipt.data.order.payment_method === 'Greenlight Pay' && receipt.data.order.paymentStatus === 'Unpaid', 'Greenlight order was not left unpaid');
    assert(receipt.data.order.remainingBalanceCents === 75 && receipt.data.greenlight.url === 'https://gl.me/u/gqpcpm2TtjkK', 'receipt amount or link is wrong');
    assert(!serialized.includes('payment-test@example.invalid') && !serialized.includes('private_reference') && !serialized.includes('admin_note'), 'public receipt exposed a private field');
    const afterLink = await call(`/api/orders/${encodeURIComponent(order.orderId)}?returned=greenlight`); assert(afterLink.data.order.paymentStatus === 'Unpaid', 'returning from Greenlight marked the order paid');
  });
  await test('partial, invalid, exact, and reversal workflows are audited', async () => {
    const order = await create('cash');
    for (const amountCents of [0, -1, 1.5, 'abc']) { const invalid = await postPayment(order.orderId, { method: 'cash', amountCents }); assert(invalid.response.status === 400, `invalid amount ${amountCents} was accepted`); }
    let result = await postPayment(order.orderId, { method: 'cash', amountCents: 25, reference: 'local fixture' });
    assert(result.response.status === 200 && result.data.order.paymentStatus === 'Partially paid' && result.data.order.remainingBalanceCents === 50, 'partial payment balance is wrong');
    const over = await postPayment(order.orderId, { method: 'greenlight', amountCents: 51 }); assert(over.response.status === 400, 'overpayment was accepted');
    result = await postPayment(order.orderId, { method: 'greenlight', amountCents: 50, reference: 'local fixture exact' });
    assert(result.data.order.paymentStatus === 'Paid' && result.data.order.remainingBalanceCents === 0 && result.data.order.paid_at, 'exact total did not mark paid');
    const payment = result.data.order.payments.find((entry) => entry.manual && entry.method === 'greenlight' && entry.status === 'completed'); assert(payment, 'manual Greenlight history missing');
    const reversed = await call(`/api/admin/orders/${encodeURIComponent(order.orderId)}/payments/${encodeURIComponent(payment.id)}/reverse`, { method: 'POST' }, true);
    assert(reversed.response.status === 200 && reversed.data.order.paymentStatus === 'Partially paid' && reversed.data.order.remainingBalanceCents === 50, 'reversal did not restore the balance');
    assert(reversed.data.order.payments.some((entry) => entry.id === payment.id && entry.status === 'reversed'), 'reversed payment history was deleted');
    assert(reversed.data.order.activity.some((entry) => entry.action === 'manual_payment_recorded') && reversed.data.order.activity.some((entry) => entry.action === 'manual_payment_reversed'), 'manual payment audit entries are missing');
  });
  await test('server rejects unsafe Greenlight hosts', async () => {
    const current = await call('/api/admin/catalog', {}, true); const c = current.data.config;
    const result = await call('/api/admin/catalog', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config: { storeName: c.store_name, orderingOpen: Boolean(c.ordering_open), absenceEnabled: Boolean(c.absence_enabled), absenceMessage: c.absence_message, paymentInstructions: c.payment_instructions, priceDisclaimer: c.price_disclaimer, payments: { cash: { enabled: true }, greenlight: { enabled: true, url: 'https://example.com/not-greenlight' } } } }) }, true);
    assert(result.response.status === 400, 'unsafe Greenlight hostname was accepted');
  });
} finally {
  for (const orderId of created) await call(`/api/admin/orders/${encodeURIComponent(orderId)}/trash`, { method: 'POST' }, true);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
