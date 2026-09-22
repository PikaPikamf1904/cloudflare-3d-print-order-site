let adminKey = '';
let catalogData = null;
let ordersData = null;
let currentOrder = null;
let detailDirty = false;
let toastTimer;
const $ = (selector) => document.querySelector(selector);
const money = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
const dateTime = (value) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—';
const text = (tag, value, className) => { const node = document.createElement(tag); node.textContent = value ?? ''; if (className) node.className = className; return node; };

function showToast(message) {
  const toast = $('#admin-toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2200);
}
function setConnection(ok, label = ok ? 'Connected' : 'Connection issue') {
  const status = $('#connection-status');
  status.classList.toggle('offline', !ok);
  status.lastChild.textContent = ` ${label}`;
}
async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { accept: 'application/json', ...(options.headers || {}), 'x-admin-key': adminKey } });
  let data = {};
  try { data = await response.json(); } catch { /* non-JSON admin failures are converted below */ }
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    if (response.status === 401 && !$('#dashboard-view').hidden) logout('Your admin session ended. Please log in again.');
    throw error;
  }
  setConnection(true);
  return data;
}
function filterParams() {
  const params = new URLSearchParams();
  ['q', 'status', 'payment', 'class', 'source', 'deleted'].forEach((id) => { const value = $(`#${id}`).value.trim(); if (value) params.set(id, value); });
  return params;
}
function activeFilterCount() {
  return ['q', 'status', 'payment', 'class', 'source'].filter((id) => $(`#${id}`).value).length + ($('#deleted').value === 'active' ? 0 : 1);
}
function pill(label, type = label) { return text('span', label, `status-pill ${String(type).toLowerCase().replaceAll(' ', '-')}`); }
function classBadge(value) { return text('span', value || '—', `class-badge ${String(value).toLowerCase()}`); }

function renderStats(aggregates) {
  const items = [
    ['Total orders', aggregates.totalOrders], ['Open orders', aggregates.openOrders], ['Waiting to print', aggregates.waitingToPrint],
    ['Ready for pickup', aggregates.readyForPickup ?? '—'], ['Paid revenue', money(aggregates.paidRevenueCents)], ['Unpaid balance', money(aggregates.unpaidBalanceCents)],
  ];
  $('#stats').replaceChildren(...items.map(([label, value]) => { const card = document.createElement('article'); card.className = 'stat-card'; card.append(text('strong', value), text('span', label)); return card; }));
}
function orderTableRow(order) {
  const row = document.createElement('tr'); row.tabIndex = 0;
  const customer = document.createElement('td'); customer.className = 'customer-cell'; customer.append(text('strong', order.first_name), text('small', order.email));
  const status = document.createElement('td'); status.append(pill(order.deleted_at ? 'Deleted' : order.status, order.deleted_at ? 'deleted' : order.status));
  const payment = document.createElement('td'); payment.append(pill(order.paid_at ? 'Paid' : 'Unpaid'));
  const action = document.createElement('td'); const button = text('button', 'View', 'view-link'); button.type = 'button'; action.append(button);
  [text('td', order.id, 'order-id'), customer, (() => { const cell = document.createElement('td'); cell.append(classBadge(order.class_color)); return cell; })(), text('td', money(order.total_cents)), status, payment, text('td', dateTime(order.created_at)), action].forEach((cell) => row.append(cell));
  const open = () => openOrder(order.id); row.addEventListener('click', open); row.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } });
  return row;
}
function orderCard(order) {
  const card = document.createElement('article'); card.className = `order-card ${String(order.class_color).toLowerCase()}`;
  const top = document.createElement('div'); top.className = 'order-card-top'; top.append(text('h3', order.first_name), text('strong', money(order.total_cents)));
  const id = text('p', `${order.id} · ${dateTime(order.created_at)}`, 'order-id');
  const meta = document.createElement('div'); meta.className = 'order-card-meta'; meta.append(classBadge(order.class_color), pill(order.deleted_at ? 'Deleted' : order.status, order.deleted_at ? 'deleted' : order.status), pill(order.paid_at ? 'Paid' : 'Unpaid'));
  const footer = document.createElement('div'); footer.className = 'order-card-footer'; footer.append(text('p', order.item_count === undefined ? 'View line items' : `${order.item_count} line item${order.item_count === 1 ? '' : 's'}`)); const button = text('button', 'View order', 'button button-secondary'); button.type = 'button'; button.addEventListener('click', () => openOrder(order.id)); footer.append(button);
  card.append(top, id, meta, footer); return card;
}
function renderOrders() {
  const state = $('#orders-state'), tableWrap = $('#orders-table-wrap'), cards = $('#orders-cards');
  $('#orders-table').replaceChildren(); cards.replaceChildren();
  const list = ordersData?.orders || [];
  $('#order-count').textContent = `${list.length} matching order${list.length === 1 ? '' : 's'}`;
  if (!list.length) {
    state.hidden = false; tableWrap.hidden = true; cards.hidden = true; state.className = 'state-card';
    state.textContent = $('#deleted').value === 'deleted' ? 'Trash is empty.' : 'No orders match these filters.'; return;
  }
  state.hidden = true; tableWrap.hidden = false; cards.hidden = false;
  list.forEach((order) => { $('#orders-table').append(orderTableRow(order)); cards.append(orderCard(order)); });
}
async function loadOrders() {
  const state = $('#orders-state'); state.hidden = false; state.className = 'state-card'; state.replaceChildren(text('span', '', 'spinner'), document.createTextNode(' Loading orders…'));
  $('#orders-table-wrap').hidden = true; $('#orders-cards').hidden = true;
  $('#filter-count').textContent = activeFilterCount();
  try {
    ordersData = await api(`/api/admin/orders?${filterParams()}`);
    renderStats(ordersData.aggregates); renderOrders(); $('#last-updated').textContent = `Updated ${new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date())}`;
  } catch (error) { state.hidden = false; state.className = 'state-card error'; state.textContent = error.message; setConnection(false); }
}

function field(labelText, input) { const label = document.createElement('label'); label.append(document.createTextNode(labelText), input); return label; }
function input(name, value, options = {}) { const node = document.createElement(options.tag || 'input'); node.name = name; node.value = value ?? ''; if (options.type) node.type = options.type; if (options.maxLength) node.maxLength = options.maxLength; if (options.rows) node.rows = options.rows; if (options.required) node.required = true; if (options.disabled) node.disabled = true; return node; }
function select(name, values, value, disabled = false) { const node = document.createElement('select'); node.name = name; values.forEach((entry) => { const option = text('option', entry); option.value = entry; node.append(option); }); node.value = value; node.disabled = disabled; return node; }
function detailSection(title) { const section = document.createElement('section'); section.className = 'detail-section'; section.append(text('h3', title)); return section; }
function detailValue(label, value) { const item = document.createElement('p'); item.append(text('span', label), document.createTextNode(value ?? '—')); return item; }
function confirmAction(title, message) {
  const dialog = $('#confirm-dialog'); $('#confirm-title').textContent = title; $('#confirm-message').textContent = message;
  return new Promise((resolve) => { dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), { once: true }); dialog.showModal(); });
}
function patchPayload(form) {
  return { firstName: form.firstName.value, classColor: form.classColor.value, email: form.email.value, status: form.status.value, paymentStatus: form.paymentStatus.value, notes: form.notes.value, adminNote: form.adminNote.value };
}
async function copyToClipboard(value) { try { await navigator.clipboard.writeText(value); } catch { const area = input('', value, { tag: 'textarea' }); area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); } }
function invoiceText(order) {
  const lines = [`Order: ${order.id}`, `Customer: ${order.first_name}`, 'Line items:'];
  (order.items || []).forEach((item) => lines.push(`- ${item.product_name} | Color: ${item.color} | Qty: ${item.quantity} | Unit: ${money(item.unit_price_cents)} | Line: ${money(item.line_total_cents)}`));
  lines.push(`Total due: ${money(order.total_cents)}`, `Selected payment method: ${order.payment_method}`);
  if (order.payment_method === 'Greenlight Pay') lines.push('Greenlight: Send the exact amount shown and include the order number. Payment is confirmed manually.');
  return lines.join('\n');
}
async function saveOrder(form, successMessage) {
  if (!form.reportValidity()) return false;
  const buttons = form.querySelectorAll('button'); buttons.forEach((button) => { button.disabled = true; });
  try {
    const data = await api(`/api/admin/orders/${encodeURIComponent(currentOrder.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patchPayload(form)) });
    currentOrder = data.order; detailDirty = false; showToast(successMessage); await loadOrders(); renderOrderDetail(data.order); return true;
  } catch (error) { const message = form.querySelector('.detail-message'); message.textContent = error.message; message.className = 'form-message detail-message'; return false; }
  finally { buttons.forEach((button) => { button.disabled = false; }); }
}
function renderOrderDetail(order) {
  currentOrder = order; detailDirty = false; $('#drawer-title').textContent = order.id;
  const box = $('#order-detail'); box.replaceChildren();
  const hero = document.createElement('div'); hero.className = 'detail-hero'; const summary = document.createElement('div'); summary.append(text('strong', order.first_name), text('p', `${order.class_color} class · ${dateTime(order.created_at)}`)); const badges = document.createElement('div'); badges.append(pill(order.deleted_at ? 'Deleted' : order.status, order.deleted_at ? 'deleted' : order.status), document.createTextNode(' '), pill(order.paymentStatus)); hero.append(summary, text('strong', money(order.total_cents), 'detail-total')); box.append(hero, badges);
  const overview = detailSection('Order information'), grid = document.createElement('div'); grid.className = 'detail-grid'; grid.append(detailValue('Order ID', order.id), detailValue('Created', dateTime(order.created_at)), detailValue('Source', order.source), detailValue('Payment method', order.payment_method), detailValue('Paid at', dateTime(order.paid_at)), detailValue('Deleted at', dateTime(order.deleted_at))); const copyInvoice = text('button', 'Copy invoice details', 'button button-secondary'); copyInvoice.type = 'button'; copyInvoice.addEventListener('click', async () => { await copyToClipboard(invoiceText(order)); showToast('Invoice details copied.'); }); overview.append(grid, copyInvoice); box.append(overview);
  const items = detailSection('Locked line items'); (order.items || []).forEach((item) => { const row = document.createElement('div'); row.className = 'line-item'; const description = document.createElement('div'); description.append(text('strong', `${item.quantity} × ${item.product_name}`), text('small', `${item.color} · ${money(item.unit_price_cents)} each`)); row.append(description, text('strong', money(item.line_total_cents))); items.append(row); }); box.append(items);
  const paymentSummary = detailSection('Payment summary'), paymentGrid = document.createElement('div'); paymentGrid.className = 'detail-grid'; paymentGrid.append(detailValue('Locked total', money(order.total_cents)), detailValue('Amount received', money(order.amountReceivedCents || 0)), detailValue('Remaining balance', money(order.remainingBalanceCents || 0)), detailValue('Selected method', order.payment_method), detailValue('Payment status', order.paymentStatus), detailValue('Payment date', dateTime(order.paid_at))); paymentSummary.append(paymentGrid);
  if (!order.deleted_at && !['Cancelled', 'Historical'].includes(order.status) && Number(order.remainingBalanceCents) > 0) {
    const paymentForm = document.createElement('form'); paymentForm.className = 'manual-payment-form';
    const method = select('method', ['Cash', 'Greenlight Pay'], order.payment_method === 'Greenlight Pay' ? 'Greenlight Pay' : 'Cash');
    const amount = input('amount', (Number(order.remainingBalanceCents) / 100).toFixed(2), { type: 'text', required: true, maxLength: 10 }); amount.inputMode = 'decimal'; amount.pattern = '^(0|[1-9]\\d{0,3})(\\.\\d{1,2})?$';
    const reference = input('reference', '', { maxLength: 200 });
    const paymentMessage = text('div', '', 'form-message'); paymentMessage.setAttribute('role', 'alert');
    const record = text('button', 'Record manual payment', 'button button-primary'); record.type = 'submit';
    paymentForm.append(field('Method', method), field('Amount received ($)', amount), field('Private reference / note (optional)', reference), paymentMessage, record);
    paymentForm.addEventListener('submit', async (event) => { event.preventDefault(); if (!paymentForm.reportValidity()) return; let amountCents; try { amountCents = ProductTools.dollarsToCents(amount.value); if (amountCents <= 0) throw new Error('Enter a payment greater than $0.00.'); } catch (error) { paymentMessage.textContent = error.message; return; } record.disabled = true; try { const data = await api(`/api/admin/orders/${encodeURIComponent(order.id)}/payments`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ method: method.value === 'Greenlight Pay' ? 'greenlight' : 'cash', amountCents, reference: reference.value }) }); showToast('Manual payment recorded.'); await loadOrders(); renderOrderDetail(data.order); } catch (error) { paymentMessage.textContent = error.message; } finally { record.disabled = false; } });
    paymentSummary.append(paymentForm);
  }
  box.append(paymentSummary);
  const edit = detailSection('Manage order'), form = document.createElement('form'); form.className = 'edit-form';
  const firstName = input('firstName', order.first_name, { maxLength: 40, required: true, disabled: true }); const classColor = select('classColor', ['Yellow', 'Blue'], order.class_color, true); const email = input('email', order.email, { type: 'email', maxLength: 120, required: true, disabled: true });
  form.append(field('First name', firstName), field('Class', classColor), field('Email', email));
  const customerActions = document.createElement('div'); customerActions.className = 'customer-actions'; const editCustomer = text('button', 'Edit customer', 'button button-secondary'); editCustomer.type = 'button'; const saveCustomer = text('button', 'Save customer', 'button button-primary'); saveCustomer.type = 'button'; saveCustomer.hidden = true; const cancelCustomer = text('button', 'Cancel', 'button button-quiet'); cancelCustomer.type = 'button'; cancelCustomer.hidden = true; customerActions.append(editCustomer, cancelCustomer, saveCustomer); form.append(customerActions);
  const status = select('status', ['New', 'Printing', 'Ready', 'Complete', 'Cancelled', 'Historical'], order.status); const payment = select('paymentStatus', ['Unpaid', 'Paid'], order.paymentStatus === 'Paid' ? 'Paid' : 'Unpaid'); form.append(field('Order status', status), field('Payment status', payment));
  const notes = input('notes', order.notes, { tag: 'textarea', maxLength: 500, rows: 4 }); const adminNote = input('adminNote', order.admin_note, { tag: 'textarea', maxLength: 1000, rows: 4 }); const notesLabel = field('Customer notes', notes); notesLabel.className = 'full'; const adminLabel = field('Private admin notes', adminNote); adminLabel.className = 'full'; form.append(notesLabel, adminLabel);
  const message = text('div', '', 'detail-message full'); message.setAttribute('role', 'alert'); form.append(message);
  const actions = document.createElement('div'); actions.className = 'drawer-actions full'; const save = text('button', 'Save order changes', 'button button-primary'); save.type = 'submit'; const trash = text('button', order.deleted_at ? 'Restore order' : 'Move to trash', order.deleted_at ? 'button button-secondary' : 'button button-danger'); trash.type = 'button'; actions.append(trash, save); form.append(actions); edit.append(form); box.append(edit);
  const originalCustomer = { firstName: order.first_name, classColor: order.class_color, email: order.email };
  const customerMode = (enabled) => { [firstName, classColor, email].forEach((control) => { control.disabled = !enabled; }); editCustomer.hidden = enabled; saveCustomer.hidden = !enabled; cancelCustomer.hidden = !enabled; if (enabled) firstName.focus(); };
  editCustomer.addEventListener('click', () => customerMode(true)); cancelCustomer.addEventListener('click', () => { firstName.value = originalCustomer.firstName; classColor.value = originalCustomer.classColor; email.value = originalCustomer.email; customerMode(false); }); saveCustomer.addEventListener('click', async () => { [firstName, classColor, email].forEach((control) => { control.disabled = false; }); await saveOrder(form, 'Customer information saved.'); });
  form.addEventListener('input', () => { detailDirty = true; }); form.addEventListener('change', () => { detailDirty = true; }); form.addEventListener('submit', async (event) => { event.preventDefault(); [firstName, classColor, email].forEach((control) => { control.disabled = false; }); await saveOrder(form, 'Order changes saved.'); });
  trash.addEventListener('click', async () => { const restoring = Boolean(order.deleted_at); if (!restoring && !await confirmAction('Move order to trash?', 'The order will leave normal lists, but it can be restored later.')) return; try { await api(`/api/admin/orders/${encodeURIComponent(order.id)}/${restoring ? 'restore' : 'trash'}`, { method: 'POST' }); showToast(restoring ? 'Order restored.' : 'Order moved to trash.'); await loadOrders(); const refreshed = await api(`/api/admin/orders/${encodeURIComponent(order.id)}`); renderOrderDetail(refreshed.order); } catch (error) { message.textContent = error.message; message.className = 'form-message detail-message full'; } });
  if (order.payments?.length) { const payments = detailSection('Payment history'); order.payments.forEach((entry) => { const row = document.createElement('div'); row.className = 'history-entry'; row.append(text('p', `${entry.provider} · ${money(entry.amount_cents)} ${entry.currency} · ${entry.status}`), text('small', entry.reversed_at ? `Reversed ${dateTime(entry.reversed_at)}` : entry.completed_at ? `Completed ${dateTime(entry.completed_at)}` : `Recorded ${dateTime(entry.created_at)}`)); if (entry.private_reference) row.append(text('small', `Private reference: ${entry.private_reference}`)); if (entry.manual && entry.status === 'completed') { const reverse = text('button', 'Reverse payment', 'button button-quiet'); reverse.type = 'button'; reverse.addEventListener('click', async () => { if (!await confirmAction('Reverse this payment?', 'The payment stays in history and an audit entry will be added.')) return; try { const data = await api(`/api/admin/orders/${encodeURIComponent(order.id)}/payments/${encodeURIComponent(entry.id)}/reverse`, { method: 'POST' }); showToast('Payment reversed.'); await loadOrders(); renderOrderDetail(data.order); } catch (error) { showToast(error.message); } }); row.append(reverse); } payments.append(row); }); box.append(payments); }
  const activity = detailSection('Admin activity'); if (!order.activity?.length) activity.append(text('p', 'No activity has been recorded yet.')); else order.activity.forEach((entry) => { const row = document.createElement('div'); row.className = 'history-entry'; row.append(text('p', entry.action.replaceAll('_', ' ')), text('small', `${dateTime(entry.created_at)}${entry.previous_status || entry.new_status ? ` · ${entry.previous_status || '—'} → ${entry.new_status || '—'}` : ''}`)); if (entry.details) row.append(text('small', entry.details)); activity.append(row); }); box.append(activity);
}
async function openOrder(id) {
  const dialog = $('#order-dialog'); $('#drawer-title').textContent = id; $('#order-detail').replaceChildren(text('div', 'Loading order…', 'state-card')); dialog.showModal();
  try { const data = await api(`/api/admin/orders/${encodeURIComponent(id)}`); renderOrderDetail(data.order); } catch (error) { $('#order-detail').replaceChildren(text('div', error.message, 'state-card error')); }
}
async function closeDrawer() { if (detailDirty && !await confirmAction('Discard unsaved changes?', 'Your unsaved order changes will be lost.')) return; detailDirty = false; $('#order-dialog').close(); }

function setSettings(config) {
  const form = $('#settings-form'); form.storeName.value = config.store_name || ''; form.orderingOpen.checked = Boolean(config.ordering_open); form.absenceEnabled.checked = Boolean(config.absence_enabled); form.absenceMessage.value = config.absence_message || ''; form.paymentInstructions.value = config.payment_instructions || ''; form.priceDisclaimer.value = config.price_disclaimer || ''; form.cashEnabled.checked = true; form.greenlightEnabled.checked = Boolean(config.payments?.greenlight?.enabled); form.greenlightUrl.value = config.payments?.greenlight?.url || ''; form.stripeEnabled.checked = false; form.cashAppEnabled.checked = false; form.paypalEnabled.checked = false; form.venmoEnabled.checked = false; form.paypalMode.value = 'sandbox'; $('#stripe-credential').textContent = 'Online payments are disabled.'; $('#paypal-credential').textContent = 'Online payments are disabled.';
}
const productManager = new ProductManager({ api, toast: showToast, confirm: confirmAction });
function renderProducts() { productManager.setProducts(catalogData.products); }
async function loadAdminData() { catalogData = await api('/api/admin/catalog'); setSettings(catalogData.config); renderProducts(); }
async function login() { await Promise.all([loadAdminData(), loadOrders()]); $('#login-view').hidden = true; $('#dashboard-view').hidden = false; }
function logout(message = '') { adminKey = ''; currentOrder = null; $('#admin-key').value = ''; $('#dashboard-view').hidden = true; $('#login-view').hidden = false; $('#login-error').textContent = message; }

$('#login-form').addEventListener('submit', async (event) => { event.preventDefault(); const button = $('#login-button'); $('#login-error').textContent = ''; adminKey = $('#admin-key').value; button.disabled = true; button.textContent = 'Logging in…'; try { await login(); } catch (error) { adminKey = ''; $('#login-error').textContent = error.status === 401 ? 'That admin password is incorrect.' : error.message; } finally { button.disabled = false; button.textContent = 'Log in'; } });
$('#show-password').addEventListener('click', () => { const field = $('#admin-key'), showing = field.type === 'text'; field.type = showing ? 'password' : 'text'; $('#show-password').textContent = showing ? 'Show' : 'Hide'; $('#show-password').setAttribute('aria-label', showing ? 'Show password' : 'Hide password'); });
$('#logout-button').addEventListener('click', () => logout());
$('#refresh-button').addEventListener('click', async () => { try { await Promise.all([loadAdminData(), loadOrders()]); showToast('Dashboard refreshed.'); } catch (error) { showToast(error.message); } });
document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { document.querySelectorAll('.tab').forEach((item) => { const active = item === tab; item.classList.toggle('active', active); item.setAttribute('aria-selected', String(active)); }); document.querySelectorAll('.tab-panel').forEach((panel) => { panel.hidden = panel.id !== `${tab.dataset.tab}-tab`; }); }));
$('#filter-toggle').addEventListener('click', () => { const open = $('#filters').classList.toggle('open'); $('#filter-toggle').setAttribute('aria-expanded', String(open)); });
let searchTimer; ['status', 'payment', 'class', 'source', 'deleted'].forEach((id) => $(`#${id}`).addEventListener('change', loadOrders)); $('#q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadOrders, 280); });
$('#clear-filters').addEventListener('click', () => { ['q', 'status', 'payment', 'class', 'source'].forEach((id) => { $(`#${id}`).value = ''; }); $('#deleted').value = 'active'; loadOrders(); });
$('#export-button').addEventListener('click', async () => { const button = $('#export-button'); button.disabled = true; button.textContent = 'Preparing CSV…'; try { const response = await fetch(`/api/admin/export?${filterParams()}`, { headers: { 'x-admin-key': adminKey } }); if (!response.ok) { let data = {}; try { data = await response.json(); } catch {} throw new Error(data.error || 'CSV export failed.'); } const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a'); link.href = url; link.download = `3d-print-orders-${new Date().toISOString().slice(0, 10)}.csv`; document.body.append(link); link.click(); link.remove(); URL.revokeObjectURL(url); showToast('Filtered CSV downloaded.'); } catch (error) { showToast(error.message); } finally { button.disabled = false; button.textContent = 'Download filtered CSV'; } });
$('#close-drawer').addEventListener('click', closeDrawer); $('#order-dialog').addEventListener('cancel', (event) => { event.preventDefault(); closeDrawer(); });
$('#settings-form').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget, button = form.querySelector('[type="submit"]'), message = $('#settings-message'); button.disabled = true; button.textContent = 'Saving…'; message.textContent = ''; try { const config = { storeName: form.storeName.value, orderingOpen: form.orderingOpen.checked, absenceEnabled: form.absenceEnabled.checked, absenceMessage: form.absenceMessage.value, paymentInstructions: form.paymentInstructions.value, priceDisclaimer: form.priceDisclaimer.value, payments: { cash: { enabled: true }, greenlight: { enabled: form.greenlightEnabled.checked, url: form.greenlightUrl.value }, stripe: { enabled: false, cashAppEnabled: false }, paypal: { enabled: false, mode: 'sandbox' }, venmo: { enabled: false } } }; catalogData = await api('/api/admin/catalog', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ config }) }); setSettings(catalogData.config); message.textContent = 'Store settings saved.'; message.className = 'form-message success'; showToast('Store settings saved.'); } catch (error) { message.textContent = error.message; message.className = 'form-message'; } finally { button.disabled = false; button.textContent = 'Save settings'; } });
