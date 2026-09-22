const cart = [];
let catalog = [];
let storeConfig = {};
let toastTimer;
const $ = (selector) => document.querySelector(selector);
const money = (cents) => `$${(Number(cents) / 100).toFixed(2)}`;

function setMessage(message, type = 'error') {
  const box = $('#order-message');
  box.textContent = message;
  box.className = `full form-message${message ? ` ${type}` : ''}`;
}
function showToast(message) {
  const toast = $('#toast');
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 1600);
}
function totals() {
  return { count: cart.reduce((sum, item) => sum + item.quantity, 0), cents: cart.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) };
}
function syncCartSummary() {
  const { count, cents } = totals();
  $('#header-cart-count').textContent = count;
  $('#header-cart-total').textContent = money(cents);
  $('#mobile-cart-count').textContent = count;
  $('#mobile-cart-total').textContent = money(cents);
  $('#cart-total').textContent = money(cents);
  $('#submit-total').textContent = money(cents);
  $('#cart-count-label').textContent = `${count} ${count === 1 ? 'item' : 'items'}`;
  $('#clear-cart').disabled = count === 0;
}
function quantityButton(label, accessibleLabel, handler) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-label', accessibleLabel);
  button.addEventListener('click', handler);
  return button;
}
function renderCart() {
  const box = $('#cart-items');
  box.replaceChildren();
  if (!cart.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-cart';
    const title = document.createElement('strong');
    title.textContent = 'Your cart is empty';
    const help = document.createElement('span');
    help.textContent = 'Choose a product above to get started.';
    empty.append(title, help);
    box.append(empty);
    syncCartSummary();
    return;
  }
  cart.forEach((item, index) => {
    const row = document.createElement('article');
    row.className = 'cart-row';
    const info = document.createElement('div');
    info.className = 'cart-item-info';
    const name = document.createElement('strong');
    name.textContent = item.productName;
    const details = document.createElement('small');
    details.textContent = `${item.color} · ${money(item.unitPriceCents)} each`;
    info.append(name, details);
    const quantity = document.createElement('div');
    quantity.className = 'quantity-control';
    const down = quantityButton('−', `Decrease ${item.productName} quantity`, () => changeQuantity(index, -1));
    const output = document.createElement('output');
    output.textContent = item.quantity;
    output.setAttribute('aria-label', `${item.quantity} in cart`);
    const up = quantityButton('+', `Increase ${item.productName} quantity`, () => changeQuantity(index, 1));
    quantity.append(down, output, up);
    const lineTotal = document.createElement('span');
    lineTotal.className = 'line-total';
    lineTotal.textContent = money(item.unitPriceCents * item.quantity);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => { cart.splice(index, 1); renderCart(); showToast(`${item.productName} removed`); });
    row.append(info, quantity, lineTotal, remove);
    box.append(row);
  });
  syncCartSummary();
}
function changeQuantity(index, delta) {
  cart[index].quantity += delta;
  if (cart[index].quantity < 1) cart.splice(index, 1);
  renderCart();
}
function addItem(productId, select) {
  const product = catalog.find((entry) => entry.id === productId);
  const option = product?.colors?.find((color) => color.color === select.value);
  if (!product || !option) return;
  const existing = cart.find((item) => item.productId === productId && item.color === option.color);
  if (existing) existing.quantity += 1;
  else cart.push({ productId, productName: product.name, color: option.color, unitPriceCents: option.priceCents, quantity: 1 });
  renderCart();
  showToast(`${product.name} added to your cart`);
}
function renderCatalog() {
  const box = $('#products');
  const status = $('#catalog-status');
  box.replaceChildren();
  status.hidden = true;
  if (!catalog.length) {
    status.hidden = false;
    status.className = 'state-card';
    status.textContent = 'No products are currently available.';
    return;
  }
  catalog.forEach((product) => {
    const colors = Array.isArray(product.colors) ? product.colors : [];
    if (!colors.length) return;
    const card = document.createElement('article');
    card.className = 'product-card';
    const accent = document.createElement('span');
    accent.className = 'product-accent';
    accent.setAttribute('aria-hidden', 'true');
    const title = document.createElement('h3');
    title.textContent = product.name;
    const starting = document.createElement('p');
    starting.className = 'starting-price';
    starting.textContent = `Starting at ${money(Math.min(...colors.map((color) => color.priceCents)))}`;
    const label = document.createElement('p');
    label.className = 'field-label';
    label.textContent = 'Choose a color';
    const swatches = document.createElement('div');
    swatches.className = 'color-swatches';
    swatches.setAttribute('role', 'group');
    swatches.setAttribute('aria-label', `${product.name} color`);
    const priceRow = document.createElement('div');
    priceRow.className = 'product-price-row';
    const caption = document.createElement('span');
    caption.textContent = 'Selected price';
    const selectedPrice = document.createElement('strong');
    selectedPrice.className = 'selected-price';
    let selectedColor = colors[0];
    const swatchClass = (color) => `swatch-${String(color).toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const selectColor = (color) => {
      selectedColor = color;
      selectedPrice.textContent = money(color.priceCents);
      swatches.querySelectorAll('.color-swatch').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.color === color.color));
      });
    };
    colors.forEach((color) => {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'color-swatch';
      swatch.dataset.color = color.color;
      swatch.setAttribute('aria-pressed', 'false');
      swatch.setAttribute('aria-label', `Choose ${color.color} for ${product.name}`);
      const dot = document.createElement('span');
      dot.className = `swatch-dot ${swatchClass(color.color)}`;
      if (/^#[0-9a-f]{6}$/i.test(color.swatch || '')) dot.style.backgroundColor = color.swatch;
      dot.setAttribute('aria-hidden', 'true');
      const text = document.createElement('span');
      text.textContent = color.color;
      swatch.append(dot, text);
      swatch.addEventListener('click', () => selectColor(color));
      swatches.append(swatch);
    });
    selectColor(selectedColor);
    priceRow.append(caption, selectedPrice);
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'button button-primary';
    add.textContent = 'Add to cart';
    add.addEventListener('click', () => addItem(product.id, { value: selectedColor.color }));
    const description = document.createElement('p'); description.textContent = product.description || '';
    card.append(accent, ProductTools.picture(product), title, description, starting, label, swatches, priceRow, add);
    box.append(card);
  });
}
function applyStoreConfig() {
  const storeName = storeConfig.store_name || '3D Print Orders';
  $('#store-name').textContent = storeName;
  document.title = storeName;
  $('#price-disclaimer').textContent = storeConfig.price_disclaimer || 'Prices are subject to change. Once you submit an order, the checkout price is locked in for that order.';
  $('#cash-message').textContent = storeConfig.payment_instructions || 'Cash is accepted. Exact change is appreciated.';
  const greenlight = $('#greenlight-choice');
  greenlight.hidden = !storeConfig.payments?.greenlight?.enabled;
  if (!storeConfig.payments?.cash?.enabled && !greenlight.hidden) greenlight.querySelector('input').checked = true;
  if (storeConfig.absence_enabled && storeConfig.absence_message) {
    $('#absence-message').textContent = storeConfig.absence_message;
    $('#absence-notice').hidden = false;
  }
  if (!storeConfig.ordering_open) {
    const message = 'Ordering is currently closed. You can still browse products and build a cart.';
    $('#absence-message').textContent = message;
    $('#absence-notice').hidden = false;
    $('#place-order').disabled = true;
    setMessage(message);
  }
}
async function loadStore() {
  try {
    const response = await fetch('/api/store', { headers: { accept: 'application/json' } });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.products)) throw new Error();
    catalog = data.products;
    storeConfig = data.config || {};
    applyStoreConfig();
    renderCatalog();
  } catch {
    const status = $('#catalog-status');
    status.hidden = false;
    status.className = 'state-card error-state';
    status.textContent = 'Products could not be loaded. Please refresh and try again.';
  }
}
$('#clear-cart').addEventListener('click', () => { if (cart.length && confirm('Clear every item from your cart?')) { cart.splice(0); renderCart(); showToast('Cart cleared'); } });
$('#order-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage('');
  if (!cart.length) { setMessage('Add at least one product to your cart.'); $('#catalog').scrollIntoView({ behavior: 'smooth' }); return; }
  if (!event.currentTarget.reportValidity()) return;
  const button = $('#place-order');
  button.disabled = true;
  const restoreButton = () => { const total = document.createElement('span'); total.id = 'submit-total'; total.textContent = money(totals().cents); button.replaceChildren(document.createTextNode('Place order '), total); };
  button.textContent = 'Placing order…';
  try {
    const fields = new FormData(event.currentTarget);
    const response = await fetch('/api/orders', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ firstName: fields.get('firstName'), classColor: fields.get('classColor'), email: fields.get('email'), notes: fields.get('notes'), paymentMethod: fields.get('paymentMethod'), items: cart.map((item) => ({ productId: item.productId, color: item.color, quantity: item.quantity })) }) });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Your order could not be placed. Please try again.');
    setMessage('Order placed. Opening your receipt…', 'success');
    location.assign(`/order/${encodeURIComponent(data.orderId)}`);
  } catch (error) {
    setMessage(error.message || 'Your order could not be placed. Please try again.');
    button.disabled = false;
    restoreButton();
  }
});
renderCart();
loadStore();
