const PRODUCTS = Object.freeze({
  ring: { name: 'Ring', prices: { Standard: 75 } },
  octopus: { name: 'Octopus', prices: { White: 100, Green: 100, Red: 110, Multicolor: 125 } },
  kirby: { name: 'Kirby', prices: { White: 20, Green: 20, Red: 25 } },
  'half-octopus': { name: 'Half-size Octopus', prices: { White: 66, Green: 66, Red: 75, Multicolor: 85 } },
  'infinity-cube': { name: 'Infinity Cube', prices: { White: 75, Green: 75 } },
  'weighted-cube': { name: 'Weighted Infinity Cube', prices: { White: 125, Green: 125 } }
});

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

function clean(value, max = 200) {
  return String(value ?? '').trim().slice(0, max);
}

function safeCsv(value) {
  let text = String(value ?? '').replace(/\r?\n/g, ' ');
  if (/^[=+\-@]/.test(text)) text = "'" + text;
  return `"${text.replaceAll('"', '""')}"`;
}

async function secretsEqual(a, b) {
  const enc = new TextEncoder();
  const left = enc.encode(String(a));
  const right = enc.encode(String(b));
  if (left.length !== right.length || left.length === 0) return false;
  return crypto.subtle.timingSafeEqual(left, right);
}

async function createOrder(request, env) {
  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > 20_000) return json({ error: 'Order is too large.' }, 413);

  let body;
  try { body = await request.json(); }
  catch { return json({ error: 'Invalid order.' }, 400); }

  const firstName = clean(body.firstName, 40);
  const classColor = clean(body.classColor, 10);
  const email = clean(body.email, 120).toLowerCase();
  const paymentMethod = clean(body.paymentMethod, 30);
  const notes = clean(body.notes, 500);
  if (!firstName || !['Yellow', 'Blue'].includes(classColor)) return json({ error: 'Enter a first name and class.' }, 400);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email.' }, 400);
  if (!['Cash', 'Exact change'].includes(paymentMethod)) return json({ error: 'Choose a payment method.' }, 400);
  if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 30) return json({ error: 'Your cart is empty.' }, 400);

  const items = [];
  let total = 0;
  for (const raw of body.items) {
    const productId = clean(raw.productId, 40);
    const color = clean(raw.color, 30);
    const quantity = Number(raw.quantity);
    const product = PRODUCTS[productId];
    const unitPrice = product?.prices[color];
    if (!product || unitPrice === undefined || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return json({ error: 'One of the cart items is invalid.' }, 400);
    }
    const lineTotal = unitPrice * quantity;
    total += lineTotal;
    items.push({ productId, name: product.name, color, quantity, unitPrice, lineTotal });
  }
  if (total > 100_000) return json({ error: 'Order total is too large.' }, 400);

  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const statements = [env.DB.prepare(
    `INSERT INTO orders (id, created_at, first_name, class_color, email, payment_method, notes, total_cents, status, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'New', 'Website')`
  ).bind(id, createdAt, firstName, classColor, email, paymentMethod, notes, total)];

  for (const item of items) {
    statements.push(env.DB.prepare(
      `INSERT INTO order_items (order_id, product_id, product_name, color, quantity, unit_price_cents, line_total_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, item.productId, item.name, item.color, item.quantity, item.unitPrice, item.lineTotal));
  }
  await env.DB.batch(statements);
  console.log(JSON.stringify({ event: 'order_created', orderId: id, totalCents: total, itemCount: items.length }));
  return json({ ok: true, orderId: id.slice(0, 8).toUpperCase(), totalCents: total }, 201);
}

async function adminCsv(request, env) {
  const key = new URL(request.url).searchParams.get('key') || '';
  if (!env.ADMIN_KEY || !(await secretsEqual(key, env.ADMIN_KEY))) return new Response('Not authorized', { status: 401 });
  const { results } = await env.DB.prepare(
    `SELECT o.id, o.created_at, o.first_name, o.class_color, o.email, o.payment_method,
            o.notes, o.total_cents, o.status, o.source,
            GROUP_CONCAT(oi.quantity || 'x ' || oi.product_name || ' (' || oi.color || ')', '; ') AS items
     FROM orders o LEFT JOIN order_items oi ON oi.order_id = o.id
     GROUP BY o.id ORDER BY o.created_at DESC`
  ).all();
  const headers = ['Order ID','Date','First Name','Class','Email','Payment','Items','Total','Status','Notes','Source'];
  const rows = results.map(r => [r.id,r.created_at,r.first_name,r.class_color,r.email,r.payment_method,r.items || '',(r.total_cents/100).toFixed(2),r.status,r.notes,r.source]);
  const csv = [headers, ...rows].map(row => row.map(safeCsv).join(',')).join('\r\n');
  return new Response(csv, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="3d-print-orders.csv"', 'cache-control': 'no-store' } });
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === 'POST' && url.pathname === '/api/orders') return await createOrder(request, env);
      if (request.method === 'GET' && url.pathname === '/admin.csv') return await adminCsv(request, env);
      if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/admin')) return json({ error: 'Not found.' }, 404);
      return env.ASSETS.fetch(request);
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_error', message: error instanceof Error ? error.message : 'Unknown error' }));
      return json({ error: 'Something went wrong. Please try again.' }, 500);
    }
  }
};
