/* =============================================================================
   MNA Dynamic Torque — Shop engine
   Cart state (localStorage), shared header/footer, badge, toasts, WhatsApp order.
   Depends on assets/catalog.js (window.MNACatalog).
   ============================================================================= */
(function (global) {
  'use strict';

  /* ---- EDIT BEFORE GOING LIVE -------------------------------------------
     WhatsApp number for orders (international format, no +/spaces).        */
  const WHATSAPP = '60123456789';
  const STORAGE_KEY = 'mna_cart_v1';
  const C = global.MNACatalog;

  /* ---- cart persistence -------------------------------------------------- */
  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr.filter(function (i) { return i && i.id && i.qty > 0; }) : [];
    } catch (e) { return []; }
  }
  function save(items) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(items)); } catch (e) {}
    updateBadge();
    document.dispatchEvent(new CustomEvent('cart:change', { detail: items }));
  }

  let items = load();

  function getItems() { return items.slice(); }
  function count() { return items.reduce(function (n, i) { return n + i.qty; }, 0); }

  function find(id) { return items.find(function (i) { return i.id === id; }); }

  function add(id, qty) {
    qty = Math.max(1, parseInt(qty, 10) || 1);
    const product = C.byId(id);
    if (!product) return;
    if (product.stockStatus === 'out_of_stock') { toast('Out of stock', false); return; }
    const existing = find(id);
    const max = product.stockQty || 99;
    if (existing) existing.qty = Math.min(max, existing.qty + qty);
    else items.push({ id: id, qty: Math.min(max, qty) });
    save(items);
    toast(qty + '× ' + product.name + ' added to cart');
  }

  function setQty(id, qty) {
    qty = parseInt(qty, 10) || 0;
    const it = find(id);
    if (!it) return;
    if (qty <= 0) { remove(id); return; }
    const product = C.byId(id);
    const max = (product && product.stockQty) || 99;
    it.qty = Math.min(max, qty);
    save(items);
  }

  function remove(id) {
    items = items.filter(function (i) { return i.id !== id; });
    save(items);
  }
  function clear() { items = []; save(items); }

  /* ---- pricing (retail + wholesale tier) --------------------------------- */
  function lineFor(item) {
    const p = C.byId(item.id);
    if (!p) return null;
    const isWholesale = p.wholesalePrice && p.minWholesaleQty && item.qty >= p.minWholesaleQty;
    const unit = isWholesale ? p.wholesalePrice : p.price;
    return {
      product: p, qty: item.qty, unit: unit, isWholesale: isWholesale,
      subtotal: unit * item.qty,
      retailSubtotal: p.price * item.qty,
    };
  }
  function totals() {
    let subtotal = 0, retail = 0;
    items.forEach(function (item) {
      const l = lineFor(item);
      if (!l) return;
      subtotal += l.subtotal;
      retail += l.retailSubtotal;
    });
    return { subtotal: subtotal, retail: retail, savings: retail - subtotal, count: count() };
  }

  /* ---- WhatsApp order message ------------------------------------------- */
  function buildOrderMessage(customer) {
    const t = totals();
    const lines = [];
    lines.push('*MNA Dynamic Torque — New Parts Order*');
    lines.push('');
    items.forEach(function (item, idx) {
      const l = lineFor(item);
      if (!l) return;
      lines.push(
        (idx + 1) + '. ' + l.product.name +
        ' (' + l.product.sku + ')'
      );
      lines.push(
        '   ' + l.qty + ' × ' + C.formatPrice(l.unit) +
        (l.isWholesale ? ' (wholesale)' : '') +
        ' = ' + C.formatPrice(l.subtotal)
      );
    });
    lines.push('');
    lines.push('Subtotal: ' + C.formatPrice(t.subtotal));
    if (t.savings > 0.005) lines.push('Wholesale savings: -' + C.formatPrice(t.savings));
    lines.push('*Order total: ' + C.formatPrice(t.subtotal) + '*');
    lines.push('(Delivery/shipping quoted on confirmation)');
    if (customer) {
      lines.push('');
      lines.push('— Customer —');
      if (customer.name) lines.push('Name: ' + customer.name);
      if (customer.phone) lines.push('Phone: ' + customer.phone);
      if (customer.type) lines.push('Buyer: ' + customer.type);
      if (customer.company) lines.push('Company: ' + customer.company);
      if (customer.address) lines.push('Delivery: ' + customer.address);
      if (customer.notes) lines.push('Notes: ' + customer.notes);
    }
    return lines.join('\n');
  }
  function orderUrl(customer) {
    return 'https://wa.me/' + WHATSAPP + '?text=' + encodeURIComponent(buildOrderMessage(customer));
  }

  /* ---- nav badge --------------------------------------------------------- */
  function updateBadge() {
    const badges = document.querySelectorAll('[data-cart-badge]');
    const n = count();
    badges.forEach(function (b) {
      b.textContent = n;
      b.classList.toggle('show', n > 0);
    });
  }

  /* ---- toast ------------------------------------------------------------- */
  function toast(msg, ok) {
    if (ok === undefined) ok = true;
    let host = document.getElementById('toasts');
    if (!host) { host = document.createElement('div'); host.id = 'toasts'; document.body.appendChild(host); }
    const el = document.createElement('div');
    el.className = 'toast' + (ok ? ' ok' : '');
    el.innerHTML = (ok
      ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M20 6L9 17l-5-5"/></svg>'
      : '<svg viewBox="0 0 24 24" fill="none" stroke="#ff6b73" stroke-width="2.4"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg>'
    ) + '<span></span>';
    el.querySelector('span').textContent = msg;
    host.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0'; el.style.transform = 'translateY(10px)';
      setTimeout(function () { el.remove(); }, 300);
    }, 2600);
  }

  /* ---- shared header / footer markup ------------------------------------ */
  const WA_ICON = '<svg viewBox="0 0 24 24"><path d="M.057 24l1.687-6.163a11.867 11.867 0 01-1.587-5.945C.16 5.335 5.495 0 12.05 0a11.82 11.82 0 018.413 3.488 11.82 11.82 0 013.48 8.414c-.003 6.557-5.338 11.892-11.893 11.892a11.9 11.9 0 01-5.688-1.448L.057 24zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884a9.86 9.86 0 001.519 5.262l-.999 3.648 3.969-1.04z"/></svg>';
  const CART_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

  function renderHeader(active, base) {
    base = base || '';
    return '' +
      '<header id="hdr"><div class="wrap"><nav>' +
        '<a class="brand" href="' + base + 'index.html" aria-label="MNA Dynamic Torque — home">' +
          '<img src="' + base + 'assets/mna-logo.png" alt="MNA Dynamic Torque"/></a>' +
        '<div class="nav-links" id="navlinks">' +
          '<a href="' + base + 'shop.html"' + (active === 'shop' ? ' class="active"' : '') + '>Spare Parts</a>' +
          '<a href="' + base + 'index.html#services">Services</a>' +
          '<a href="' + base + 'index.html#experience">3D Experience</a>' +
          '<a href="' + base + 'index.html#process">How It Works</a>' +
          '<a href="' + base + 'index.html#contact">Contact</a>' +
        '</div>' +
        '<div class="nav-cta">' +
          '<a class="cart-link" href="' + base + 'cart.html" aria-label="Cart">' + CART_ICON +
            '<span class="cart-badge" data-cart-badge>0</span></a>' +
          '<a class="btn btn-wa btn-sm" href="https://wa.me/' + WHATSAPP + '" target="_blank" rel="noopener">' + WA_ICON + 'WhatsApp</a>' +
        '</div>' +
        '<div class="burger" id="burger"><span></span><span></span><span></span></div>' +
      '</nav></div></header>';
  }

  function renderFooter(base) {
    base = base || '';
    const year = '2026';
    return '' +
      '<footer><div class="wrap">' +
        '<div class="foot-grid">' +
          '<div class="col foot-brand">' +
            '<img src="' + base + 'assets/mna-logo.png" alt="MNA Dynamic Torque"/>' +
            '<p>CVT & automatic transmission specialists — diagnostics-first repair, rebuilds, and genuine-spec spare parts supply. Drive Beyond Limit.</p>' +
          '</div>' +
          '<div class="col"><h4>Shop</h4>' +
            '<a href="' + base + 'shop.html">All Parts</a>' +
            '<a href="' + base + 'shop.html?cat=cvt_belt">CVT Belt & Variator</a>' +
            '<a href="' + base + 'shop.html?cat=overhaul_kit">Overhaul Kits</a>' +
            '<a href="' + base + 'shop.html?cat=lubricants">Lubricants</a>' +
            '<a href="' + base + 'cart.html">Cart & Checkout</a>' +
          '</div>' +
          '<div class="col"><h4>Workshop</h4>' +
            '<a href="' + base + 'index.html#services">Services</a>' +
            '<a href="' + base + 'index.html#experience">3D Simulator</a>' +
            '<a href="' + base + 'index.html#process">How It Works</a>' +
            '<a href="' + base + 'index.html#contact">Book a Diagnostic</a>' +
          '</div>' +
          '<div class="col"><h4>Contact</h4>' +
            '<a href="https://wa.me/' + WHATSAPP + '" target="_blank" rel="noopener">💬 WhatsApp +60 12-345 6789</a>' +
            '<a href="tel:+60123456789">📞 +60 12-345 6789</a>' +
            '<div data-edit>📍 Your workshop address here</div>' +
            '<div data-edit>🕒 Mon–Sat 9:00–18:00</div>' +
          '</div>' +
        '</div>' +
        '<div class="foot-bottom">' +
          '<span>© ' + year + ' MNA Dynamic Torque. All rights reserved.</span>' +
          '<span>Parts supplied subject to stock & compatibility confirmation.</span>' +
        '</div>' +
      '</div></footer>' +
      '<a class="fab" href="https://wa.me/' + WHATSAPP + '?text=Hi%20MNA%20Dynamic%20Torque!" target="_blank" rel="noopener" aria-label="WhatsApp us">' + WA_ICON + '</a>';
  }

  function mountChrome(active, base) {
    const head = document.querySelector('[data-mount="header"]');
    const foot = document.querySelector('[data-mount="footer"]');
    if (head) head.outerHTML = renderHeader(active, base);
    if (foot) foot.outerHTML = renderFooter(base);
    // burger toggle
    const burger = document.getElementById('burger');
    const links = document.getElementById('navlinks');
    if (burger && links) burger.addEventListener('click', function () { links.classList.toggle('open'); });
    updateBadge();
  }

  global.MNAShop = {
    WHATSAPP: WHATSAPP,
    getItems: getItems, count: count, add: add, setQty: setQty, remove: remove, clear: clear,
    lineFor: lineFor, totals: totals,
    buildOrderMessage: buildOrderMessage, orderUrl: orderUrl,
    toast: toast, updateBadge: updateBadge,
    renderHeader: renderHeader, renderFooter: renderFooter, mountChrome: mountChrome,
  };

  document.addEventListener('DOMContentLoaded', updateBadge);
})(window);
