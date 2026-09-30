import { startLocalWorker, stopLocalWorker } from './local-worker.mjs';
let localWorker = null;
if (!process.env.EXTERNAL_TEST_SERVER) localWorker = await startLocalWorker(8799);
const base = process.env.TEST_BASE_URL || localWorker.base;
const key = process.env.TEST_ADMIN_KEY || localWorker.key;
let reportId = '';
let passed = 0; let failed = 0;
const assert = (value, message) => { if (!value) throw new Error(message); };
async function request(path, options = {}, admin = false) { const response = await fetch(`${base}${path}`, { ...options, headers: { accept: 'application/json', ...(options.headers || {}), ...(admin ? { 'x-admin-key': key } : {}) } }); let data = {}; try { data = await response.json(); } catch {} return { response, data }; }
async function test(name, run) { try { await run(); passed++; console.log(`PASS ${name}`); } catch (error) { failed++; console.error(`FAIL ${name}: ${error.message}`); } }
const good = (extra = {}) => ({ category: 'cart', description: 'The cart quantity button did not update the total.', pagePath: '/cart', orderId: '', contactEmail: '', diagnosticConsent: false, website: '', ...extra });

try {
await test('public report validation, body limit, honeypot, and unknown fields', async () => {
  let result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good({ category: 'nope' })) }); assert(result.response.status === 400, 'invalid category accepted');
  result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good({ description: 'short' })) }); assert(result.response.status === 400, 'short description accepted');
  result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good({ website: 'spam.example' })) }); assert(result.response.status === 400, 'honeypot accepted');
  result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...good(), adminKey: 'do-not-store' }) }); assert(result.response.status === 400, 'unknown sensitive property accepted');
  result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good({ description: 'x'.repeat(9000) })) }); assert(result.response.status === 413, `oversized report returned ${result.response.status}`);
});
await test('public submission returns only safe report ID and discards diagnostics without consent', async () => {
  const result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good({ diagnostics: { cookie: 'nope' } })) }); assert(result.response.status === 201, result.data.error || `status ${result.response.status}`); assert(/^BUG-[A-F0-9]{12}$/.test(result.data.reportId), 'safe report ID missing'); assert(!/description|email|diagnostic/i.test(JSON.stringify(result.data)), 'public response leaked report data'); reportId = result.data.reportId;
});
await test('diagnostics require explicit consent and are allowlisted', async () => {
  let result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good({ diagnosticConsent: true, diagnostics: { viewport: { width: 360, height: 800 }, language: 'en-US', theme: 'dark', timezoneOffset: 420 } })) }); assert(result.response.status === 201, result.data.error || 'valid diagnostics failed');
  result = await request('/api/bug-reports', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(good({ diagnosticConsent: true, diagnostics: { viewport: { width: 360, height: 800 }, language: 'en-US', theme: 'dark', timezoneOffset: 420, localStorage: 'secret' } })) }); assert(result.response.status === 400, 'unsafe diagnostics accepted');
});
await test('admin report endpoints require header authentication', async () => { for (const path of ['/api/admin/bug-reports', `/api/admin/bug-reports/${reportId}`]) { const result = await request(path); assert(result.response.status === 401, `${path} was not protected`); } });
await test('admin filters, detail, and public privacy', async () => {
  const list = await request(`/api/admin/bug-reports?q=${reportId}&status=new&category=cart&priority=normal&deleted=active`, {}, true); assert(list.response.status === 200 && list.data.reports.length === 1, 'combined report filter failed'); assert(list.data.aggregates.newReports >= 1, 'new aggregate missing');
  const detail = await request(`/api/admin/bug-reports/${reportId}`, {}, true); assert(detail.response.status === 200 && detail.data.report.description.includes('quantity'), 'admin detail missing'); assert(detail.data.report.diagnostics === null, 'diagnostics without consent were stored');
  const publicResult = await request(`/api/bug-reports/${encodeURIComponent(reportId)}`); assert(publicResult.response.status === 404 && !JSON.stringify(publicResult.data).includes('quantity'), 'public report detail was exposed');
});
await test('admin status, priority, notes and activity update safely', async () => {
  const result = await request(`/api/admin/bug-reports/${reportId}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: 'resolved', priority: 'high', adminNotes: '<script>private</script>' }) }, true); assert(result.response.status === 200, result.data.error || 'update failed'); assert(result.data.report.status === 'resolved' && result.data.report.priority === 'high' && result.data.report.resolved_at, 'status transition failed'); assert(result.data.report.admin_notes === '<script>private</script>', 'private notes missing'); assert(result.data.report.activity.some((entry) => entry.action === 'bug_report_updated'), 'activity missing');
});
await test('trash and restore are soft and logged', async () => {
  let result = await request(`/api/admin/bug-reports/${reportId}/trash`, { method: 'POST' }, true); assert(result.response.status === 200, 'trash failed'); result = await request(`/api/admin/bug-reports?q=${reportId}&deleted=active`, {}, true); assert(result.data.reports.length === 0, 'trashed report listed as active'); result = await request(`/api/admin/bug-reports?q=${reportId}&deleted=deleted`, {}, true); assert(result.data.reports.length === 1, 'trash filter failed'); result = await request(`/api/admin/bug-reports/${reportId}/restore`, { method: 'POST' }, true); assert(result.response.status === 200, 'restore failed'); const detail = await request(`/api/admin/bug-reports/${reportId}`, {}, true); assert(detail.data.report.activity.some((entry) => entry.action === 'bug_report_trashed') && detail.data.report.activity.some((entry) => entry.action === 'bug_report_restored'), 'trash activity missing');
});
await test('existing cash-only settings and locked order data remain unchanged', async () => { const store = await request('/api/store'); assert(store.response.status === 200 && store.data.products.length === 4, 'store catalog count changed unexpectedly'); assert(!store.data.products.some((p) => ['octopus','half-octopus'].includes(p.id)), 'octopus products are still visible'); assert(store.data.products.find((p) => p.id === 'ring').colors[0].priceCents === 150, 'ring price not updated'); assert(store.data.products.find((p) => p.id === 'kirby').colors.find((c) => c.color === 'Red').priceCents === 25, 'kirby price changed'); assert(store.data.config.payments.cash.enabled && !store.data.config.payments.stripe.enabled && !store.data.config.payments.stripe.cashAppEnabled && !store.data.config.payments.paypal.enabled, 'cash-only settings changed'); const fixture = await request('/api/orders/legacy-test-history'); assert(fixture.response.status === 200 && fixture.data.order.total_cents === 750, 'synthetic locked total changed'); });
} finally { await stopLocalWorker(localWorker); }
console.log(`\n${passed} passed, ${failed} failed`); if (failed) process.exitCode = 1;
