const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787';
const key = process.env.TEST_ADMIN_KEY || 'local-review-test-key';
const created = [];
let passed = 0;
let failed = 0;
const assert = (value, message) => { if (!value) throw new Error(message); };
async function call(path, options = {}, authenticated = false) {
  const response = await fetch(`${base}${path}`, { ...options, headers: { accept: 'application/json', ...(options.headers || {}), ...(authenticated ? { 'x-admin-key': key } : {}) } });
  let data = {}; try { data = await response.json(); } catch {}
  return { response, data };
}
async function test(name, run) { try { await run(); passed += 1; console.log(`PASS ${name}`); } catch (error) { failed += 1; console.error(`FAIL ${name}: ${error.message}`); } }
async function create({ method = 'cash', email = 'review-fixture@example.invalid', klass = 'Yellow', firstName = 'Admin Review Fixture' } = {}) {
  const result = await call('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName, classColor: klass, email, paymentMethod: method, items: [{ productId: 'kirby', color: 'Red', quantity: 3 }] }) });
  assert(result.response.status === 201, result.data.error || `order creation returned ${result.response.status}`); created.push(result.data.orderId); await new Promise(resolve => setTimeout(resolve, 8)); return result.data;
}
const detail = id => call(`/api/admin/orders/${encodeURIComponent(id)}`, {}, true);
const pay = (id, method, amountCents) => call(`/api/admin/orders/${encodeURIComponent(id)}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method, amountCents }) }, true);
const review = (id, body, authenticated = true) => call(`/api/admin/orders/${encodeURIComponent(id)}/payment-review`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, authenticated);
const search = (body, authenticated = true) => call('/api/admin/orders/search', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, authenticated);
async function setOrder(id, updates) {
  const current = (await detail(id)).data.order;
  return call(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ firstName: current.first_name, classColor: current.class_color, email: current.email, status: updates.status || current.status, paymentStatus: updates.paymentStatus || (current.paid_at ? 'Paid' : 'Unpaid'), notes: current.notes || '', adminNote: current.admin_note || '' }) }, true);
}

try {
  await test('body search/export routes require authentication, validate filters, and return private no-store responses', async () => {
    assert((await search({ q: 'private synthetic' }, false)).response.status === 401, 'unauthenticated search was accepted');
    assert((await search({ q: 'private synthetic' })).response.status === 200, 'authenticated search failed');
    const wrong = await fetch(`${base}/api/admin/orders/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'invalid-test-key' }, body: '{}' }); assert(wrong.status === 401, 'invalid Admin key was accepted');
    assert((await search({ q: 'x'.repeat(81) })).response.status === 400, 'overlong search was accepted');
    assert((await search({ q: 'fixture', extra: 'unexpected' })).response.status === 400, 'unexpected filter property was accepted');
    assert((await search({ status: 'New; DROP TABLE orders' })).response.status === 400, 'non-allowlisted status was accepted');
    const tooLarge = await fetch(`${base}/api/admin/orders/search`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify({ padding: 'x'.repeat(9000) }) }); assert(tooLarge.status === 413, 'oversized search request was accepted');
    const oldRead = await call('/api/admin/orders?sort=newest', {}, true); assert(oldRead.response.status === 200, 'legacy GET callers without free-text search broke');
    const oldSearch = await call('/api/admin/orders?q=legacy-search-test', {}, true); assert(oldSearch.response.status === 400, 'legacy GET accepted free-text search');
    const exportDenied = await fetch(`${base}/api/admin/export`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); assert(exportDenied.status === 401, 'unauthenticated CSV export was accepted');
    const exported = await fetch(`${base}/api/admin/export`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: '{}' }); assert(exported.status === 200 && exported.headers.get('cache-control') === 'no-store, private', 'authenticated export headers are not private and no-store');
  });

  let noEmail, partial, cashUnpaid, cashPaid, greenlightPaid, cancelled, historical, deleted;
  await test('controlled synthetic order set supports missing email, methods, statuses, and stable sorting', async () => {
    noEmail = await create({ method: 'greenlight', email: '', klass: 'High School' });
    partial = await create({ method: 'greenlight' }); await pay(partial.orderId, 'greenlight', 25); await setOrder(partial.orderId, { status: 'Printing' });
    cashUnpaid = await create({ method: 'cash', email: 'review-fixture@example.invalid', klass: 'Blue' }); await setOrder(cashUnpaid.orderId, { status: 'Ready' });
    cashPaid = await create({ method: 'cash' }); await pay(cashPaid.orderId, 'cash', 75); await setOrder(cashPaid.orderId, { status: 'Complete' });
    greenlightPaid = await create({ method: 'greenlight' }); await pay(greenlightPaid.orderId, 'greenlight', 75); await setOrder(greenlightPaid.orderId, { status: 'Complete' });
    cancelled = await create({ method: 'greenlight' }); await setOrder(cancelled.orderId, { status: 'Cancelled' });
    historical = await create({ method: 'greenlight' }); await setOrder(historical.orderId, { status: 'Historical' });
    deleted = await create({ method: 'greenlight' }); await call(`/api/admin/orders/${encodeURIComponent(deleted.orderId)}/trash`, { method: 'POST' }, true);
    const q = { q: 'Admin Review Fixture' };
    const missing = await search({ ...q, email: 'missing' }); assert(missing.data.orders.length === 1 && missing.data.orders[0].id === noEmail.orderId, 'email=missing did not return only the blank-email active fixture');
    const present = await search({ ...q, email: 'present' }); assert(present.data.orders.length === 6 && present.data.orders.every(row => row.email), 'email=present returned a blank email or missed an active fixture');
    const greenlight = await search({ ...q, method: 'greenlight' }), cash = await search({ ...q, method: 'cash' }); assert(greenlight.data.orders.length === 5 && greenlight.data.orders.every(row => row.payment_method === 'Greenlight Pay'), 'Greenlight method filter is incorrect'); assert(cash.data.orders.length === 2 && cash.data.orders.every(row => row.payment_method === 'Cash'), 'Cash method filter is incorrect');
    const unpaid = await search({ ...q, payment: 'Unpaid' }), partly = await search({ ...q, payment: 'Partial' }), paid = await search({ ...q, payment: 'Paid' }); assert(unpaid.data.orders.some(row => row.id === noEmail.orderId) && partly.data.orders.length === 1 && partly.data.orders[0].id === partial.orderId && paid.data.orders.length === 2, 'Unpaid/Partial/Paid filters do not use recorded payment status consistently');
    const newest = await search({ ...q, deleted: 'all' }), oldest = await search({ ...q, sort: 'oldest' }); assert(newest.data.orders[0].id === deleted.orderId && oldest.data.orders[0].id === noEmail.orderId, 'newest/oldest ordering did not follow created timestamps');
    const queue = await search({ ...q, sort: 'queue' }); assert(queue.data.orders.slice(0, 3).map(row => row.id).join(',') === [noEmail.orderId, partial.orderId, cashUnpaid.orderId].join(','), 'production queue sort did not prioritize New, Printing, Ready');
    const combined = await search({ ...q, review: 'greenlight', email: 'missing', sort: 'oldest' }); assert(combined.data.orders.length === 1 && combined.data.orders[0].id === noEmail.orderId, 'combined review/email/sort filters failed');
  });

  await test('Greenlight review count and dedicated shortcut filter share eligibility, including partial payments', async () => {
    const body = { q: 'Admin Review Fixture' }, all = await search(body), matching = await search({ ...body, review: 'greenlight' });
    assert(all.data.aggregates.manualVerificationCount === 2, `review count was ${all.data.aggregates.manualVerificationCount}, expected the two unpaid active Greenlight orders`);
    assert(matching.data.orders.length === all.data.aggregates.manualVerificationCount && matching.data.orders.some(row => row.id === partial.orderId && row.received_cents === 25), 'review filter did not match count or omitted partial payments');
    assert(!matching.data.orders.some(row => [greenlightPaid.orderId, cancelled.orderId, historical.orderId, deleted.orderId].includes(row.id)), 'review filter included a paid/deleted/terminal order');
    const csv = await fetch(`${base}/api/admin/export`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify({ ...body, review: 'greenlight' }) }); const bodyText = await csv.text();
    assert(csv.status === 200 && bodyText.includes(noEmail.orderId) && bodyText.includes(partial.orderId) && !bodyText.includes(greenlightPaid.orderId), 'CSV review export differs from the review result set');
  });

  await test('CSV filters preserve blank email and neutralize formula-like customer text', async () => {
    const formula = await create({ method: 'cash', email: '', klass: 'Blue', firstName: '=2+3' });
    const response = await fetch(`${base}/api/admin/export`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': key }, body: JSON.stringify({ q: '=2+3', email: 'missing' }) }); const csv = await response.text();
    assert(response.status === 200 && csv.includes(formula.orderId) && csv.includes('"\'=2+3"'), 'CSV did not neutralize a formula-like first name');
    const row = csv.split('\r\n').find(line => line.includes(formula.orderId)); assert(row && /,"Blue","","Kirby",/.test(row), 'CSV did not preserve the blank email field safely');
  });

  await test('payment review transitions require Admin auth, log fixed safe actions, and never alter payment or order data', async () => {
    const order = await create({ method: 'greenlight' }); const before = (await detail(order.orderId)).data.order;
    assert((await review(order.orderId, { state: 'reported' }, false)).response.status === 401, 'review route accepted missing auth');
    const invalidKey = await fetch(`${base}/api/admin/orders/${encodeURIComponent(order.orderId)}/payment-review`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-admin-key': 'wrong-test-key' }, body: JSON.stringify({ state: 'reported' }) }); assert(invalidKey.status === 401, 'review route accepted invalid auth');
    assert((await review(order.orderId, { state: 'unknown' })).response.status === 400, 'unknown state was accepted');
    assert((await review(order.orderId, { state: 'reported', details: 'customer supplied' })).response.status === 400, 'unexpected review detail was accepted');
    for (const [state, expected] of [['reported','reported'],['mismatch','mismatch'],['clear','clear']]) {
      const changed = await review(order.orderId, { state }); assert(changed.response.status === 200 && changed.data.order.manual_review_state === expected, `${state} transition failed`);
      const current = changed.data.order;
      assert(current.paid_at === before.paid_at && current.status === before.status && current.total_cents === before.total_cents && JSON.stringify(current.items) === JSON.stringify(before.items), `${state} changed paid_at, status, locked items, or total`);
      assert(current.payments.length === before.payments.length && current.amountReceivedCents === 0 && current.greenlight_confirmed === false, `${state} created payment evidence or changed received amount`);
      const entry = current.activity.find(item => item.action.startsWith('greenlight_payment_')); assert(entry && ['greenlight_payment_reported','greenlight_payment_mismatch','greenlight_payment_review_cleared'].includes(entry.action) && !/customer supplied|email|@/i.test(entry.details), 'review audit action/details are not fixed and safe');
    }
  });

  await test('review endpoint rejects paid, deleted, non-Greenlight, Cancelled, and Historical orders', async () => {
    const paid = greenlightPaid;
    for (const id of [paid.orderId, deleted.orderId, cashUnpaid.orderId, cancelled.orderId, historical.orderId]) { const result = await review(id, { state: 'reported' }); assert(result.response.status === 409, `ineligible order ${id} was accepted`); }
  });

  await test('partial, multiple, administrative correction, manual proof, and reversals keep status separate from received cents', async () => {
    const partialDetail = (await detail(partial.orderId)).data.order; const partialRow = (await search({ q: 'Admin Review Fixture', method: 'greenlight', payment: 'Partial' })).data.orders.find(row => row.id === partial.orderId);
    assert(partialDetail.amountReceivedCents === 25 && partialDetail.remainingBalanceCents === 50 && partialDetail.greenlight_confirmed === false && partialRow.received_cents === 25 && partialRow.greenlight_confirmed === 0, 'partial list/detail values disagree');
    const reached = await pay(partial.orderId, 'greenlight', 50); assert(reached.data.order.amountReceivedCents === 75 && reached.data.order.remainingBalanceCents === 0 && reached.data.order.greenlight_confirmed === true, 'multiple completed Greenlight payments did not qualify at the total');
    const split = await create({ method: 'greenlight' }); await pay(split.orderId, 'cash', 25); const splitPaid = await pay(split.orderId, 'greenlight', 50); assert(splitPaid.data.order.paymentStatus === 'Paid' && splitPaid.data.order.amountReceivedCents === 75 && splitPaid.data.order.greenlight_confirmed === false, 'mixed methods were misrepresented as Greenlight-only confirmation');
    const correctedPartial = await create({ method: 'greenlight' }); await pay(correctedPartial.orderId, 'greenlight', 25); await setOrder(correctedPartial.orderId, { paymentStatus: 'Paid' }); const corrected = (await detail(correctedPartial.orderId)).data.order;
    assert(corrected.paymentStatus === 'Paid' && corrected.amountReceivedCents === 25 && corrected.remainingBalanceCents === 50 && corrected.greenlight_confirmed === false, 'partial Greenlight payment plus Paid correction claimed full verification or inflated cents');
    const paidCorrection = await create({ method: 'greenlight' }); await setOrder(paidCorrection.orderId, { paymentStatus: 'Paid' }); const noEvidence = (await detail(paidCorrection.orderId)).data.order; assert(noEvidence.paymentStatus === 'Paid' && noEvidence.amountReceivedCents === 0 && noEvidence.remainingBalanceCents === 75 && noEvidence.greenlight_confirmed === false, 'Paid correction without payment rows invented evidence');
    const reversedOrder = await create({ method: 'greenlight' }); const paidBeforeReverse = await pay(reversedOrder.orderId, 'greenlight', 75), payment = paidBeforeReverse.data.order.payments.find(row => row.manual && row.method === 'greenlight' && row.status === 'completed'); assert(paidBeforeReverse.data.order.greenlight_confirmed, 'full manual Greenlight payment did not confirm');
    const reversed = await call(`/api/admin/orders/${encodeURIComponent(reversedOrder.orderId)}/payments/${encodeURIComponent(payment.id)}/reverse`, { method: 'POST' }, true); assert(reversed.data.order.amountReceivedCents === 0 && reversed.data.order.paymentStatus === 'Unpaid' && reversed.data.order.greenlight_confirmed === false && reversed.data.order.payments.some(row => row.id === payment.id && row.status === 'reversed'), 'reversal did not remove eligible received cents while preserving history');
    const correctionList = (await search({ q: 'Admin Review Fixture', payment: 'Paid' })).data.orders.find(row => row.id === paidCorrection.orderId); assert(correctionList && correctionList.received_cents === 0 && correctionList.greenlight_confirmed === 0, 'list disagrees with no-evidence detail correction');
  });
} finally {
  for (const orderId of created) await call(`/api/admin/orders/${encodeURIComponent(orderId)}/trash`, { method: 'POST' }, true);
}
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exitCode = 1;
