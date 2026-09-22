/* Shared, dependency-free validation. Also imported by the Worker and local tests. */
(function (root) {
  function dollarsToCents(value) {
    if (typeof value !== 'string' || !/^(0|[1-9]\d{0,3})(\.\d{1,2})?$/.test(value.trim())) throw new Error('Use an exact dollar price with at most two decimal places.');
    const [whole, fraction = ''] = value.trim().split('.');
    const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
    if (cents > 100000) throw new Error('Price must not exceed $1,000.00.');
    return cents;
  }
  function imageUrl(value) {
    if (typeof value !== 'string' || value.length > 1000 || /[\s<>"'`\\]/.test(value)) throw new Error('Use a plain HTTPS image URL or existing same-site raster image path.');
    if (!value) return '';
    if (value.startsWith('//')) throw new Error('Use an explicit HTTPS URL.');
    const local = value.startsWith('/') && !value.startsWith('//');
    let url;
    try { url = new URL(value, 'https://static.invalid'); } catch { throw new Error('Invalid image URL.'); }
    if ((!local && url.protocol !== 'https:') || url.username || url.password || url.search || url.hash || /%|\.\./.test(value) || !/\.(png|jpe?g|webp|gif|avif|ico)$/i.test(url.pathname)) throw new Error('Use a raster image URL without credentials, query strings, or fragments (PNG, JPEG, WebP, GIF, AVIF or ICO).');
    if (!local && (/^(localhost|.*\.localhost|.*\.local|.*\.internal)$/i.test(url.hostname) || /^[\d.[\]:]+$/.test(url.hostname) || !url.hostname.includes('.'))) throw new Error('Image URL must use a public HTTPS hostname.');
    return local ? url.pathname : url.href;
  }
  function picture(product) {
    const box = document.createElement('div'); box.className = 'product-picture';
    const fallback = document.createElement('span'); fallback.className = 'picture-placeholder'; fallback.textContent = 'No product photo'; box.append(fallback);
    if (product.imageUrl) {
      try {
        const img = document.createElement('img'); img.src = imageUrl(product.imageUrl); img.alt = product.imageAlt || ''; img.width = 480; img.height = 320; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer';
        img.addEventListener('load', () => { fallback.hidden = true; });
        img.addEventListener('error', () => { img.remove(); fallback.hidden = false; fallback.textContent = 'Photo unavailable'; }); box.append(img);
      } catch { fallback.textContent = 'Photo unavailable'; }
    }
    return box;
  }
  root.ProductTools = Object.freeze({ dollarsToCents, imageUrl, picture });
})(globalThis);
