import '../public/product-tools.js';

class CatalogError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
const fail = (message, status) => { throw new CatalogError(message, status); };
const object = (x) => x && typeof x === 'object' && !Array.isArray(x);
function keys(x, allowed) { if (!object(x) || Object.keys(x).some(k => !allowed.includes(k))) fail('Unexpected catalog fields.'); }
function str(x, name, max, required = false) { if (typeof x !== 'string' || x.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)) fail(`Invalid ${name}.`); const v = x.trim(); if (required && !v) fail(`${name} is required.`); return v; }
function int(x, name, max = 100000) { if (!Number.isInteger(x) || x < 0 || x > max) fail(`Invalid ${name}; use an integer from 0 to ${max}.`); return x; }
function bool(x) { if (typeof x !== 'boolean') fail('Enabled must be true or false.'); return x; }

export async function readCatalog(e, all = false) {
  const products = (await e.DB.prepare(`SELECT * FROM catalog_products ${all ? '' : 'WHERE enabled=1 AND archived_at IS NULL'} ORDER BY sort_order,id`).all()).results;
  const colors = (await e.DB.prepare(`SELECT c.* FROM catalog_product_colors c JOIN catalog_products p ON p.id=c.product_id ${all ? '' : 'WHERE p.enabled=1 AND p.archived_at IS NULL AND c.enabled=1'} ORDER BY c.sort_order,c.public_id`).all()).results;
  return products.map(p => ({ id: p.id, name: p.name, description: p.description || '', imageUrl: p.image_url || '', imageAlt: p.image_alt || '', enabled: !!p.enabled, sortOrder: p.sort_order,
    ...(all ? { archivedAt: p.archived_at, version: p.version } : {}),
    colors: colors.filter(c => c.product_id === p.id).map(c => ({ ...(all ? { id: c.public_id } : {}), color: c.color, priceCents: c.price_cents, enabled: !!c.enabled, sortOrder: c.sort_order, swatch: c.swatch || '' }))
  })).filter(p => all || p.colors.length);
}
async function get(e, id) { const p = (await readCatalog(e, true)).find(p => p.id === id); if (!p) fail('Product not found.', 404); return p; }
async function payload(r) {
  if (!r.headers.get('content-type')?.startsWith('application/json')) fail('Send application/json.', 415);
  const reader = r.body?.getReader(); let size = 0, chunks = [];
  if (!reader) fail('Missing catalog update.');
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 32768) { await reader.cancel(); fail('Catalog update is too large.', 413); } chunks.push(value); }
  try { const bytes = new Uint8Array(size); let pos = 0; for (const c of chunks) { bytes.set(c, pos); pos += c.length; } return JSON.parse(new TextDecoder().decode(bytes)); } catch { fail('Invalid JSON.'); }
}
async function validate(e, b, old) {
  keys(b, ['name','description','imageUrl','imageAlt','enabled','sortOrder','colors', ...(old ? ['version'] : [])]);
  if (old && b.version !== old.version) fail('This product changed. Reload before saving; your changes have not been applied.', 409);
  const p = { name: str(b.name,'Product name',80,true), description: str(b.description ?? '', 'Description',500), enabled: bool(b.enabled), sortOrder: int(b.sortOrder,'Sort order',9999), imageAlt: str(b.imageAlt ?? '', 'Image alt text',200), colors: [] };
  try { p.imageUrl = ProductTools.imageUrl(str(b.imageUrl ?? '', 'Image URL',1000)); } catch (x) { fail(x.message); }
  if (p.imageUrl && p.imageAlt.length < 3) fail('Meaningful image alt text is required.');
  if (p.imageUrl.startsWith('/')) { const response = await e.ASSETS.fetch(new Request(`https://assets.invalid${p.imageUrl}`, { method: 'HEAD' })); if (!response.ok || !/^image\/(png|jpeg|webp|gif|avif|x-icon|vnd.microsoft.icon)(;|$)/i.test(response.headers.get('content-type') || '')) fail('Same-site image must be an existing raster asset.'); }
  if (!Array.isArray(b.colors) || !b.colors.length || b.colors.length > 24) fail('Provide between 1 and 24 variants.');
  const names = new Set(), ids = new Set();
  for (const c of b.colors) {
    keys(c,['id','color','priceCents','enabled','sortOrder','swatch']);
    const color = str(c.color,'Variant name',40,true), lower = color.toLowerCase();
    if (names.has(lower)) fail('Variant names must be unique.'); names.add(lower);
    if (old && ['infinity-cube','weighted-cube'].includes(old.id) && !['white','green'].includes(lower)) fail('Existing Infinity Cubes allow White and Green only.');
    if (c.id !== undefined && (!old?.colors.some(x => x.id === c.id) || ids.has(c.id))) fail('Invalid variant identifier.');
    if (c.id) ids.add(c.id);
    const swatch = str(c.swatch ?? '', 'Swatch',7); if (swatch && !/^#[0-9a-f]{6}$/i.test(swatch)) fail('Swatch must be a six-digit hex color.');
    p.colors.push({ id: c.id || `var-${crypto.randomUUID()}`, color, priceCents: int(c.priceCents,'Price cents'), enabled: bool(c.enabled), sortOrder: int(c.sortOrder,'Variant sort order',9999), swatch });
  }
  if (old?.colors.some(c => !ids.has(c.id))) fail('Keep existing variants; disable them instead of deleting.');
  if (p.enabled && !p.colors.some(c => c.enabled)) fail('An enabled product needs an enabled variant.');
  return p;
}
const log = (e,id,version,action,details) => e.DB.prepare('INSERT INTO admin_activity_log(created_at,order_id,action,details) SELECT ?,?,?,? WHERE EXISTS (SELECT 1 FROM catalog_products WHERE id=? AND version=?)').bind(new Date().toISOString(),`product:${id}`,action,details,id,version);
function statements(e,p,old) {
  const id = old?.id || `prod-${crypto.randomUUID()}`, version = crypto.randomUUID(), s = [];
  if (old) s.push(e.DB.prepare('UPDATE catalog_products SET name=?,description=?,image_url=?,image_alt=?,enabled=?,sort_order=?,version=? WHERE id=? AND version=?').bind(p.name,p.description,p.imageUrl,p.imageAlt,+p.enabled,p.sortOrder,version,id,old.version));
  else s.push(e.DB.prepare('INSERT INTO catalog_products(id,name,description,image_url,image_alt,enabled,sort_order,version) VALUES(?,?,?,?,?,?,?,?)').bind(id,p.name,p.description,p.imageUrl,p.imageAlt,+p.enabled,p.sortOrder,version));
  // Temporary unique labels allow safe renaming/swapping without deleting variant rows.
  if (old) s.push(e.DB.prepare('UPDATE catalog_product_colors SET color=? || public_id WHERE product_id=? AND EXISTS(SELECT 1 FROM catalog_products WHERE id=? AND version=?)').bind(`pending-${version}-`,id,id,version));
  for (const c of p.colors) {
    if (old?.colors.some(x => x.id === c.id)) s.push(e.DB.prepare('UPDATE catalog_product_colors SET color=?,price_cents=?,enabled=?,sort_order=?,swatch=? WHERE product_id=? AND public_id=? AND EXISTS(SELECT 1 FROM catalog_products WHERE id=? AND version=?)').bind(c.color,c.priceCents,+c.enabled,c.sortOrder,c.swatch,id,c.id,id,version));
    else s.push(e.DB.prepare('INSERT INTO catalog_product_colors(product_id,public_id,color,price_cents,enabled,sort_order,swatch) SELECT ?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM catalog_products WHERE id=? AND version=?)').bind(id,c.id,c.color,c.priceCents,+c.enabled,c.sortOrder,c.swatch,id,version));
  }
  const fields = ['name','description','imageUrl','imageAlt','sortOrder'].filter(k => !old || p[k] !== old[k]);
  s.push(log(e,id,version,old?'product_edited':'product_created',`Fields: ${fields.join(', ') || 'variants'}.`));
  if (old && old.enabled !== p.enabled) s.push(log(e,id,version,p.enabled?'product_enabled':'product_disabled','Field: enabled.'));
  for (const c of p.colors) {
    const before = old?.colors.find(x => x.id === c.id);
    const changed = ['color','priceCents','enabled','sortOrder','swatch'].filter(k => !before || c[k] !== before[k]);
    if (changed.length) s.push(log(e,id,version,before?'variant_edited':'variant_added',`Variant ${c.id}; fields: ${changed.join(', ')}.`));
    if (before && before.enabled !== c.enabled) s.push(log(e,id,version,c.enabled?'variant_enabled':'variant_disabled',`Variant ${c.id}.`));
  }
  return { id, s };
}
export async function legacyCatalogUpdate(e, products) {
  // The old bulk endpoint remains compatible but goes through the same strict validation.
  if (!Array.isArray(products) || products.length > 100) fail('Invalid catalog update.');
  const prepared = [];
  for (const p of products) { const old = await get(e,p.id); const { id, archivedAt, ...body } = p; if (archivedAt !== old.archivedAt) fail('Use archive or restore.'); prepared.push(statements(e,await validate(e,body,old),old)); }
  // A stale bulk round-trip must never overwrite newer data: execute individual guarded batches.
  for (const x of prepared) { const results = await e.DB.batch(x.s); if (!results[0].meta.changes) fail('Catalog changed; reload before saving.',409); }
}
export async function catalogRoutes(r,e,{admin,json}) {
  const url = new URL(r.url); if (!url.pathname.startsWith('/api/admin/products')) return null;
  if (!await admin(r,e)) return json({error:'Incorrect admin key.'},401);
  try {
    const match = /^\/api\/admin\/products(?:\/([^/]+)(?:\/(archive|restore))?)?$/.exec(url.pathname);
    if (!match) fail('Route not found.',404);
    let id; try { id = match[1] && decodeURIComponent(match[1]); } catch { fail('Invalid product identifier.'); }
    if (id && !/^[a-zA-Z0-9-]{1,80}$/.test(id)) fail('Invalid product identifier.');
    if (!id && r.method === 'GET') {
      if ([...url.searchParams.keys()].some(k => !['q','state'].includes(k))) fail('Invalid filter.');
      const state = url.searchParams.get('state') || 'all', q = url.searchParams.get('q') || '';
      if (!['all','active','disabled','archived'].includes(state) || q.length > 80) fail('Invalid filter.');
      const products = (await readCatalog(e,true)).filter(p => p.name.toLowerCase().includes(q.trim().toLowerCase()) && (state==='all' || (state==='archived'?!!p.archivedAt:!p.archivedAt && p.enabled===(state==='active'))));
      return json({products});
    }
    if (id && !match[2] && r.method==='GET') return json({product:await get(e,id),activity:(await e.DB.prepare('SELECT created_at,action,details FROM admin_activity_log WHERE order_id=? ORDER BY id DESC LIMIT 100').bind(`product:${id}`).all()).results});
    if (!id && r.method==='POST' || id && !match[2] && r.method==='PATCH') {
      const old = id ? await get(e,id) : null, p = await validate(e,await payload(r),old), write = statements(e,p,old);
      const result = await e.DB.batch(write.s); if (!result[0].meta.changes) fail('Product changed; reload before saving.',409);
      return json({product:await get(e,write.id)},old?200:201);
    }
    if (id && match[2] && r.method==='POST') {
      const old = await get(e,id), body = await payload(r); keys(body,['version']); if (body.version!==old.version) fail('Product changed; reload before saving.',409);
      const archived = match[2]==='archive'; if (!!old.archivedAt===archived) return json({product:old});
      const version=crypto.randomUUID(); const results=await e.DB.batch([e.DB.prepare('UPDATE catalog_products SET archived_at=?,version=? WHERE id=? AND version=?').bind(archived?new Date().toISOString():null,version,id,old.version),log(e,id,version,archived?'product_archived':'product_restored','Field: archived_at.')]);
      if (!results[0].meta.changes) fail('Product changed; reload before saving.',409);
      return json({product:await get(e,id)});
    }
    fail('Method not allowed.',405);
  } catch (x) { return json({error:x instanceof CatalogError?x.message:'Catalog could not be saved. Please retry.'},x instanceof CatalogError?x.status:500); }
}
