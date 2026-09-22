const receiptBox = document.querySelector('#receipt');
document.querySelector('#print-receipt').addEventListener('click', () => window.print());
const orderId = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
const money = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function pill(text, kind) { return element('span', text, `status-pill ${kind.toLowerCase().replaceAll(' ', '-')}`); }
async function api(path, options) { const response = await fetch(path, options); let data; try { data = await response.json(); } catch { data = {}; } if (!response.ok) throw new Error(data.error || 'The order could not be loaded.'); return data; }
function showPaymentMessage(message, kind = '') { const box = document.querySelector('#payment-message'); if (!box) return; box.className = `form-message${kind ? ` ${kind}` : ''}`; box.textContent = message; }
function paymentButton(label, handler) {
  const button = element('button', label, 'button button-primary'); button.type = 'button';
  button.addEventListener('click', async () => { button.disabled = true; const original = button.textContent; button.textContent = 'Opening…'; try { await handler(); } catch (error) { button.disabled = false; button.textContent = original; showPaymentMessage(error.message, 'error'); } });
  return button;
}
async function copyText(value, success) {
  try { await navigator.clipboard.writeText(value); }
  catch { const area = element('textarea'); area.value = value; area.setAttribute('readonly', ''); area.style.position = 'fixed'; area.style.opacity = '0'; document.body.append(area); area.select(); document.execCommand('copy'); area.remove(); }
  showPaymentMessage(success, 'success');
}
function renderReceipt(data) {
  const order = data.order; receiptBox.replaceChildren(); receiptBox.setAttribute('aria-busy', 'false');
  const header = element('div', undefined, 'receipt-header');
  header.append(element('span', '✓', 'brand-mark'), element('span', 'ORDER RECEIPT', 'eyebrow'), element('h1', 'Thanks for your order!'), element('p', order.id, 'receipt-number'));
  header.append(element('p', `${order.first_name} · ${order.class_color} class`));
  const summary = element('div', undefined, 'receipt-summary'); summary.append(pill(order.status, order.status), pill(order.paymentStatus, order.paymentStatus)); header.append(summary);
  const lines = element('div', undefined, 'receipt-items');
  order.items.forEach((item) => { const line = element('div', undefined, 'receipt-line'); const description = element('div'); description.append(element('strong', `${item.quantity} × ${item.product_name}`), element('span', `${item.color} · ${money(item.unit_price_cents)} each`)); line.append(description, element('strong', money(item.line_total_cents))); lines.append(line); });
  const total = element('div', undefined, 'receipt-total'); total.append(element('span', 'Locked order total'), element('strong', money(order.total_cents)));
  const balance = element('div', undefined, 'receipt-total receipt-balance'); balance.append(element('span', 'Remaining balance'), element('strong', money(order.remainingBalanceCents)));
  receiptBox.append(header, lines, total, balance);
  const payment = element('section', undefined, 'payment-panel');
  if (order.paymentStatus === 'Paid') payment.append(element('h2', 'Payment received'), element('p', 'This order is marked Paid. Thank you!'));
  else if (['Historical', 'Cancelled'].includes(order.status) || !Object.values(data.paymentMethods || {}).some(Boolean)) {
    payment.append(element('h2', order.status === 'Historical' ? 'Historical order' : 'Payment unavailable'), element('p', order.status === 'Historical' ? 'This imported receipt preserves its original locked total.' : 'Payment cannot be started for this order.'));
  } else {
    payment.append(element('h2', `Amount due: ${money(order.remainingBalanceCents)}`), element('p', `Selected payment method: ${order.payment_method}`));
    if (data.paymentMethods?.cash) { const cash = element('div'); cash.append(element('strong', 'Pay with cash'), element('p', 'Cash is accepted. Exact change is appreciated.')); payment.append(cash); }
    const actions = element('div', undefined, 'payment-actions');
    if (data.paymentMethods?.greenlight && data.greenlight?.url) {
      const notice = element('p', 'Send the exact amount shown and include your order number with the payment. Your order remains unpaid until the payment is manually confirmed.', 'manual-payment-notice');
      const link = element('a', 'Pay with Greenlight', 'button button-primary'); link.href = data.greenlight.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
      actions.append(link, paymentButton('Copy amount', () => copyText(money(order.remainingBalanceCents), 'Amount copied.')), paymentButton('Copy order number', () => copyText(order.id, 'Order number copied.')));
      payment.append(notice);
    }
    if (data.paymentMethods?.stripe) actions.append(paymentButton('Pay with Card / Cash App', async () => { const result = await api(`/api/orders/${encodeURIComponent(orderId)}/pay/stripe`, { method: 'POST' }); location.assign(result.checkoutUrl); }));
    payment.append(actions); const message = element('div', '', 'form-message'); message.id = 'payment-message'; payment.append(message);
  }
  receiptBox.append(payment);
}
async function loadReceipt() {
  if (!/^3D-[A-Z0-9]{8}$|^legacy-[a-z0-9-]+$/i.test(orderId)) { receiptBox.replaceChildren(element('div', 'That order number is not valid.', 'state-card error-state')); receiptBox.setAttribute('aria-busy', 'false'); return; }
  try { const data = await api(`/api/orders/${encodeURIComponent(orderId)}`); renderReceipt(data); const hint = new URLSearchParams(location.search).get('payment'); if (hint === 'success' && data.order.paymentStatus !== 'Paid') showPaymentMessage('Your payment is still being confirmed. Refresh this page in a moment.'); if (hint === 'cancelled') showPaymentMessage('Payment was cancelled. Your order is still unpaid.'); }
  catch (error) { receiptBox.replaceChildren(element('div', error.message, 'state-card error-state')); receiptBox.setAttribute('aria-busy', 'false'); }
}
loadReceipt();
