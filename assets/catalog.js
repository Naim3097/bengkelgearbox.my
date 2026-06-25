/* =============================================================================
   MNA Dynamic Torque — Spare Parts Catalogue
   Static product data + helpers (no build step, no backend).
   Ported from the Dynamic Torque dataset and enriched with CVT-specific parts.
   ============================================================================= */
(function (global) {
  'use strict';

  /* ---- Categories -------------------------------------------------------- */
  const CATEGORIES = [
    { slug: 'cvt_belt',      name: 'CVT Belt & Variator', desc: 'Push belts, chains & variator pulley sets', icon: 'belt' },
    { slug: 'valve_body',    name: 'Valve Body & Solenoid', desc: 'Valve bodies, solenoids & step motors', icon: 'valve' },
    { slug: 'torque_conv',   name: 'Torque Converter',   desc: 'Converters & lock-up clutch kits', icon: 'converter' },
    { slug: 'clutch_plate',  name: 'Clutch Plate',       desc: 'Friction & pressure plates', icon: 'clutch' },
    { slug: 'steel_plate',   name: 'Steel Plate',        desc: 'Transmission steel plates', icon: 'steel' },
    { slug: 'auto_filter',   name: 'Auto Filter',        desc: 'Transmission fluid filters', icon: 'filter' },
    { slug: 'forward_drum',  name: 'Forward Drum',       desc: 'Forward clutch drum assemblies', icon: 'drum' },
    { slug: 'oil_pump',      name: 'Oil Pump',           desc: 'Transmission oil pumps', icon: 'pump' },
    { slug: 'piston_seal',   name: 'Piston Seal',        desc: 'Hydraulic piston seals & O-rings', icon: 'seal' },
    { slug: 'overhaul_kit',  name: 'Overhaul Kit',       desc: 'Complete rebuild & overhaul kits', icon: 'kit' },
    { slug: 'lubricants',    name: 'Lubricants',         desc: 'ATF fluids, CVT fluids & additives', icon: 'fluid' },
  ];

  /* ---- Per-category colour accents used for generated thumbnails --------- */
  const CAT_COLOR = {
    cvt_belt:     '#34b9f0',
    valve_body:   '#5fd2ff',
    torque_conv:  '#ec1c24',
    clutch_plate: '#ff7a45',
    steel_plate:  '#a9cdee',
    auto_filter:  '#5ad19a',
    forward_drum: '#c79bff',
    oil_pump:     '#ffd24a',
    piston_seal:  '#ff5b8a',
    overhaul_kit: '#34b9f0',
    lubricants:   '#7df0c0',
  };

  /* ---- Products ---------------------------------------------------------- */
  const PRODUCTS = [
    /* ---- CVT belts & variators (CVT-specific, beyond DT dataset) -------- */
    {
      id: 'c1', name: 'CVT Steel Push Belt JF011E', slug: 'cvt-steel-push-belt-jf011e', sku: 'MNA-CB-0001',
      category: 'cvt_belt',
      description: 'Genuine-spec steel push belt for Jatco JF011E / RE0F10A CVTs. Hundreds of precision-ground elements riding on two laminated steel rings — the single most load-critical part in a CVT. Replace as a set with worn variator pulleys.',
      specifications: { type: 'Push belt', elements: '~400', ring: 'Dual laminated steel', width: '24mm' },
      compatibleVehicles: ['Nissan X-Trail', 'Nissan Qashqai', 'Mitsubishi Outlander', 'Renault Koleos'],
      compatibleGearboxes: ['JF011E', 'RE0F10A'],
      price: 480.0, wholesalePrice: 410.0, minWholesaleQty: 2,
      stockQty: 12, stockStatus: 'in_stock', lowStockThreshold: 4,
      tags: ['cvt', 'belt', 'push belt', 'jf011e', 'variator'], isFeatured: true,
    },
    {
      id: 'c2', name: 'Variator Pulley Set JF015E', slug: 'variator-pulley-set-jf015e', sku: 'MNA-CB-0002',
      category: 'cvt_belt',
      description: 'Matched primary + secondary variator pulley (cone) set for Jatco JF015E. Mirror-polished sheave faces restore clean ratio sweep and stop belt slip on worn units. Supplied as a balanced pair.',
      specifications: { includes: 'Primary + secondary cones', finish: 'Mirror-polished', condition: 'Remanufactured' },
      compatibleVehicles: ['Nissan Almera', 'Nissan Note', 'Suzuki Swift'],
      compatibleGearboxes: ['JF015E', 'RE0F11A'],
      price: 620.0, wholesalePrice: 540.0, minWholesaleQty: 2,
      stockQty: 6, stockStatus: 'in_stock', lowStockThreshold: 3,
      tags: ['cvt', 'variator', 'pulley', 'jf015e'], isFeatured: true,
    },
    /* ---- Valve body & solenoid (CVT-specific) -------------------------- */
    {
      id: 'v1', name: 'CVT Valve Body Reman JF011E', slug: 'cvt-valve-body-reman-jf011e', sku: 'MNA-VB-0001',
      category: 'valve_body',
      description: 'Remanufactured and dyno-tested valve body for JF011E CVTs. Restored bores, new check balls and recalibrated line-pressure circuit — cures harsh engagement, judder and slow ratio response.',
      specifications: { condition: 'Remanufactured', tested: 'Dyno-tested', solenoids: 'Included' },
      compatibleVehicles: ['Nissan X-Trail', 'Mitsubishi Outlander'],
      compatibleGearboxes: ['JF011E', 'RE0F10A'],
      price: 1150.0, wholesalePrice: 980.0, minWholesaleQty: 1,
      stockQty: 4, stockStatus: 'in_stock', lowStockThreshold: 2,
      tags: ['valve body', 'cvt', 'jf011e', 'reman'], isFeatured: true,
    },
    {
      id: 'v2', name: 'Line Pressure Solenoid Set', slug: 'line-pressure-solenoid-set', sku: 'MNA-VB-0002',
      category: 'valve_body',
      description: 'Replacement linear solenoid set for CVT and AT valve bodies. Matched resistance and flow for consistent pressure control. Sold as a 3-piece set.',
      specifications: { pieces: '3 solenoids', type: 'Linear (variable force)', resistance: '5.0Ω ±0.3' },
      compatibleVehicles: ['Nissan', 'Toyota', 'Mitsubishi'],
      compatibleGearboxes: ['JF011E', 'JF015E', 'K313'],
      price: 240.0, wholesalePrice: 195.0, minWholesaleQty: 4,
      stockQty: 28, stockStatus: 'in_stock', lowStockThreshold: 8,
      tags: ['solenoid', 'valve body', 'pressure'], isFeatured: false,
    },
    /* ---- Torque converter (CVT/AT) ------------------------------------- */
    {
      id: 't1', name: 'Torque Converter Reman A750E', slug: 'torque-converter-reman-a750e', sku: 'MNA-TC-0001',
      category: 'torque_conv',
      description: 'Remanufactured torque converter with new lock-up clutch lining and balanced impeller for A750E transmissions. Bench-tested for leak-down and concentricity. Eliminates lock-up shudder and stall-speed drift.',
      specifications: { condition: 'Remanufactured', lockup: 'New lining', tested: 'Leak + balance' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota Fortuner', 'Lexus GX470'],
      compatibleGearboxes: ['A750E', 'A750F'],
      price: 540.0, wholesalePrice: 460.0, minWholesaleQty: 1,
      stockQty: 9, stockStatus: 'in_stock', lowStockThreshold: 3,
      tags: ['torque converter', 'lockup', 'a750e', 'reman'], isFeatured: true,
    },

    /* ---- Clutch plates (DT dataset) ------------------------------------ */
    {
      id: '1', name: 'AT Clutch Friction Plate 3.5mm', slug: 'at-clutch-friction-plate-3-5mm', sku: 'DT-CP-0001',
      category: 'clutch_plate',
      description: 'High-performance automatic transmission clutch friction plate. 3.5mm thickness, OEM-equivalent material composition for reliable engagement and long service life.',
      specifications: { thickness: '3.5mm', material: 'Organic Friction', diameter: '165mm' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota Fortuner', 'Isuzu D-Max'],
      compatibleGearboxes: ['A750E', 'A750F'],
      price: 28.0, wholesalePrice: 22.0, minWholesaleQty: 10,
      stockQty: 150, stockStatus: 'in_stock', lowStockThreshold: 20,
      tags: ['clutch', 'friction', 'a750e'], isFeatured: true,
    },
    {
      id: '2', name: 'HD Clutch Disc A750E', slug: 'hd-clutch-disc-a750e', sku: 'DT-CP-0002',
      category: 'clutch_plate',
      description: 'Heavy-duty clutch disc designed for A750E transmissions. Enhanced friction material for towing and high-load applications.',
      specifications: { thickness: '4.0mm', material: 'Kevlar Blend', diameter: '170mm' },
      compatibleVehicles: ['Toyota Land Cruiser', 'Lexus GX470'],
      compatibleGearboxes: ['A750E'],
      price: 35.0, wholesalePrice: 28.0, minWholesaleQty: 10,
      stockQty: 85, stockStatus: 'in_stock', lowStockThreshold: 15,
      tags: ['clutch', 'heavy-duty', 'a750e'], isFeatured: false,
    },
    /* ---- Steel plates -------------------------------------------------- */
    {
      id: '3', name: 'Steel Separator Plate 1.8mm', slug: 'steel-separator-plate-1-8mm', sku: 'DT-SP-0001',
      category: 'steel_plate',
      description: 'Precision-ground steel separator plate for automatic transmissions. Hardened and tempered for consistent performance.',
      specifications: { thickness: '1.8mm', material: 'Hardened Steel', finish: 'Phosphate coated' },
      compatibleVehicles: ['Toyota Hilux', 'Mitsubishi Triton'],
      compatibleGearboxes: ['A750E', 'A340'],
      price: 16.0, wholesalePrice: 12.0, minWholesaleQty: 20,
      stockQty: 200, stockStatus: 'in_stock', lowStockThreshold: 30,
      tags: ['steel', 'separator', 'plate'], isFeatured: false,
    },
    {
      id: '4', name: 'Waved Steel Plate A340', slug: 'waved-steel-plate-a340', sku: 'DT-SP-0002',
      category: 'steel_plate',
      description: 'Waved steel plate for A340 series transmissions. The wave pattern provides controlled clutch engagement.',
      specifications: { thickness: '2.0mm', material: 'Spring Steel', pattern: 'Waved' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota 4Runner'],
      compatibleGearboxes: ['A340'],
      price: 20.0, wholesalePrice: 15.0, minWholesaleQty: 20,
      stockQty: 120, stockStatus: 'in_stock', lowStockThreshold: 20,
      tags: ['steel', 'waved', 'a340'], isFeatured: false,
    },
    /* ---- Auto filters -------------------------------------------------- */
    {
      id: '5', name: 'ATF Inline Filter Universal', slug: 'atf-inline-filter-universal', sku: 'DT-AF-0001',
      category: 'auto_filter',
      description: 'Universal inline ATF filter for automatic transmissions. Catches fine particles and extends transmission fluid life.',
      specifications: { type: 'Inline', micron: '25μm', connection: '3/8" barb' },
      compatibleVehicles: ['Universal'], compatibleGearboxes: ['Universal'],
      price: 12.0, wholesalePrice: 9.0, minWholesaleQty: 25,
      stockQty: 300, stockStatus: 'in_stock', lowStockThreshold: 50,
      tags: ['filter', 'inline', 'universal'], isFeatured: true,
    },
    {
      id: '6', name: 'Pan Transmission Filter Kit', slug: 'pan-transmission-filter-kit', sku: 'DT-AF-0002',
      category: 'auto_filter',
      description: 'Complete pan filter kit with gasket. Direct replacement for OEM transmission pan filters.',
      specifications: { type: 'Pan filter', includes: 'Filter + gasket', material: 'Felt/Metal mesh' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota Fortuner'], compatibleGearboxes: ['A750E', 'A750F'],
      price: 25.0, wholesalePrice: 19.0, minWholesaleQty: 15,
      stockQty: 95, stockStatus: 'in_stock', lowStockThreshold: 15,
      tags: ['filter', 'pan', 'kit'], isFeatured: false,
    },
    /* ---- Forward drums ------------------------------------------------- */
    {
      id: '7', name: 'Forward Clutch Drum A750E', slug: 'forward-clutch-drum-a750e', sku: 'DT-FD-0001',
      category: 'forward_drum',
      description: 'Complete forward clutch drum assembly for A750E transmissions. Precision machined with new bushing pre-installed.',
      specifications: { material: 'Cast Aluminum', bushing: 'Pre-installed', splines: '36T' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota Fortuner', 'Lexus GX470'], compatibleGearboxes: ['A750E'],
      price: 120.0, wholesalePrice: 95.0, minWholesaleQty: 3,
      stockQty: 25, stockStatus: 'in_stock', lowStockThreshold: 5,
      tags: ['drum', 'forward', 'a750e', 'assembly'], isFeatured: true,
    },
    {
      id: '8', name: 'Forward Drum Shell Assembly', slug: 'forward-drum-shell-assembly', sku: 'DT-FD-0002',
      category: 'forward_drum',
      description: 'Replacement drum shell for various automatic transmissions. Supplied without internal components.',
      specifications: { material: 'Steel', finish: 'Machined', weight: '1.2kg' },
      compatibleVehicles: ['Toyota Hilux', 'Nissan Navara'], compatibleGearboxes: ['A340', 'RE5R05A'],
      price: 105.0, wholesalePrice: 85.0, minWholesaleQty: 3,
      stockQty: 18, stockStatus: 'in_stock', lowStockThreshold: 5,
      tags: ['drum', 'shell', 'assembly'], isFeatured: false,
    },
    /* ---- Oil pumps ----------------------------------------------------- */
    {
      id: '9', name: 'Front Oil Pump Body A340', slug: 'front-oil-pump-body-a340', sku: 'DT-OP-0001',
      category: 'oil_pump',
      description: 'Remanufactured front oil pump body for A340 transmissions. Restored to OEM specifications with new seals.',
      specifications: { type: 'Front pump body', condition: 'Remanufactured', seals: 'Included' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota 4Runner'], compatibleGearboxes: ['A340'],
      price: 150.0, wholesalePrice: 120.0, minWholesaleQty: 2,
      stockQty: 15, stockStatus: 'in_stock', lowStockThreshold: 5,
      tags: ['oil pump', 'front', 'a340', 'reman'], isFeatured: true,
    },
    {
      id: '10', name: 'Oil Pump Gear Set', slug: 'oil-pump-gear-set', sku: 'DT-OP-0002',
      category: 'oil_pump',
      description: 'Replacement inner and outer gear set for transmission oil pumps. Hardened steel construction.',
      specifications: { type: 'Gear set (inner + outer)', material: 'Hardened Steel' },
      compatibleVehicles: ['Toyota Hilux', 'Mitsubishi Triton'], compatibleGearboxes: ['A750E', 'A340'],
      price: 85.0, wholesalePrice: 68.0, minWholesaleQty: 5,
      stockQty: 30, stockStatus: 'in_stock', lowStockThreshold: 8,
      tags: ['oil pump', 'gears'], isFeatured: false,
    },
    /* ---- Piston seals -------------------------------------------------- */
    {
      id: '11', name: 'Bonded Piston Seal Kit A750E', slug: 'bonded-piston-seal-kit-a750e', sku: 'DT-PS-0001',
      category: 'piston_seal',
      description: 'Complete bonded piston seal kit for A750E automatic transmissions. Includes all required piston seals for a full rebuild.',
      specifications: { pieces: '6 seals', material: 'Viton rubber bonded to steel', type: 'Bonded' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota Fortuner', 'Lexus GX470'], compatibleGearboxes: ['A750E'],
      price: 14.0, wholesalePrice: 10.0, minWholesaleQty: 20,
      stockQty: 250, stockStatus: 'in_stock', lowStockThreshold: 40,
      tags: ['piston', 'seal', 'bonded', 'a750e'], isFeatured: false,
    },
    {
      id: '12', name: 'D-Ring Seal Assortment', slug: 'd-ring-seal-assortment', sku: 'DT-PS-0002',
      category: 'piston_seal',
      description: 'Assorted D-ring seals for automatic transmission hydraulic circuits. Multiple sizes for common applications.',
      specifications: { pieces: '24 assorted', material: 'NBR rubber', sizes: 'Mixed (12mm–45mm)' },
      compatibleVehicles: ['Universal'], compatibleGearboxes: ['Universal'],
      price: 10.0, wholesalePrice: 7.5, minWholesaleQty: 30,
      stockQty: 400, stockStatus: 'in_stock', lowStockThreshold: 60,
      tags: ['seal', 'd-ring', 'assortment'], isFeatured: false,
    },
    /* ---- Overhaul kits ------------------------------------------------- */
    {
      id: '13', name: 'Master Rebuild Kit A750E', slug: 'master-rebuild-kit-a750e', sku: 'DT-OK-0001',
      category: 'overhaul_kit',
      description: 'Complete master overhaul kit for A750E automatic transmissions. Includes all frictions, steels, seals, gaskets, and bushings needed for a full rebuild.',
      specifications: { includes: 'Frictions, steels, seals, gaskets, bushings', coverage: 'Full overhaul' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota Fortuner', 'Lexus GX470'], compatibleGearboxes: ['A750E'],
      price: 250.0, wholesalePrice: 195.0, minWholesaleQty: 2,
      stockQty: 20, stockStatus: 'in_stock', lowStockThreshold: 5,
      tags: ['overhaul', 'rebuild', 'master', 'a750e', 'complete'], isFeatured: true,
    },
    {
      id: '14', name: 'Banner Kit A340', slug: 'banner-kit-a340', sku: 'DT-OK-0002',
      category: 'overhaul_kit',
      description: 'Gasket and seal kit (banner kit) for A340 transmissions. Covers all external and internal sealing surfaces.',
      specifications: { includes: 'Gaskets, O-rings, lip seals, pan gasket', coverage: 'Seals only' },
      compatibleVehicles: ['Toyota Hilux', 'Toyota 4Runner'], compatibleGearboxes: ['A340'],
      price: 160.0, wholesalePrice: 128.0, minWholesaleQty: 3,
      stockQty: 35, stockStatus: 'in_stock', lowStockThreshold: 8,
      tags: ['banner', 'gasket', 'seal', 'a340'], isFeatured: false,
    },
    /* ---- Lubricants ---------------------------------------------------- */
    {
      id: '15', name: 'ATF Dexron VI 1L', slug: 'atf-dexron-vi-1l', sku: 'DT-LB-0001',
      category: 'lubricants',
      description: 'Premium automatic transmission fluid meeting Dexron VI specifications. Suitable for a wide range of automatic transmissions.',
      specifications: { volume: '1 Litre', spec: 'Dexron VI', type: 'Fully synthetic' },
      compatibleVehicles: ['Universal'], compatibleGearboxes: ['Universal'],
      price: 18.0, wholesalePrice: 14.0, minWholesaleQty: 20,
      stockQty: 500, stockStatus: 'in_stock', lowStockThreshold: 50,
      tags: ['atf', 'dexron', 'fluid', 'lubricant'], isFeatured: true,
    },
    {
      id: '16', name: 'CVT Fluid NS-3 1L', slug: 'cvt-fluid-ns3-1l', sku: 'DT-LB-0002',
      category: 'lubricants',
      description: 'CVT-specific transmission fluid compatible with Nissan NS-3 specification. For continuously variable transmissions.',
      specifications: { volume: '1 Litre', spec: 'NS-3 Compatible', type: 'Fully synthetic' },
      compatibleVehicles: ['Nissan Navara', 'Nissan X-Trail', 'Mitsubishi Outlander'], compatibleGearboxes: ['JF015E', 'JF011E'],
      price: 22.0, wholesalePrice: 17.0, minWholesaleQty: 20,
      stockQty: 3, stockStatus: 'low_stock', lowStockThreshold: 50,
      tags: ['cvt', 'fluid', 'ns-3', 'nissan'], isFeatured: false,
    },
  ];

  /* ---- Derived stock status (guards manual data) ------------------------ */
  PRODUCTS.forEach(function (p) {
    if (p.stockQty <= 0) p.stockStatus = 'out_of_stock';
    else if (p.stockQty <= p.lowStockThreshold) p.stockStatus = 'low_stock';
    else p.stockStatus = 'in_stock';
    p.currency = 'MYR';
  });

  /* ---- Generated SVG thumbnail (data-URI) — no external images needed --- */
  const ICON_PATHS = {
    belt:      '<circle cx="22" cy="32" r="13"/><circle cx="42" cy="32" r="13"/><path d="M22 19h20M22 45h20"/>',
    valve:     '<rect x="16" y="18" width="32" height="28" rx="2"/><path d="M24 18v28M40 18v28M16 32h32"/>',
    converter: '<circle cx="32" cy="32" r="16"/><path d="M32 16v32M16 32h32M21 21l22 22M43 21L21 43"/>',
    clutch:    '<circle cx="32" cy="32" r="16"/><circle cx="32" cy="32" r="6"/><path d="M32 16v8M32 40v8M16 32h8M40 32h8"/>',
    steel:     '<circle cx="32" cy="32" r="16"/><circle cx="32" cy="32" r="8"/>',
    filter:    '<path d="M20 18h24l-8 12v14l-8 4V30z"/>',
    drum:      '<rect x="18" y="20" width="28" height="24" rx="3"/><path d="M18 28h28M18 36h28"/>',
    pump:      '<circle cx="32" cy="32" r="15"/><path d="M32 17v30M17 32h30" stroke-width="2"/><circle cx="32" cy="32" r="4"/>',
    seal:      '<circle cx="32" cy="32" r="15"/><circle cx="32" cy="32" r="9" stroke-dasharray="3 3"/>',
    kit:       '<rect x="16" y="22" width="32" height="22" rx="2"/><path d="M24 22v-4h16v4M16 31h32"/>',
    fluid:     '<path d="M27 16h10v6l4 6v18a3 3 0 01-3 3H26a3 3 0 01-3-3V28l4-6z"/><path d="M23 34h18"/>',
  };

  function thumbFor(product) {
    const cat = CATEGORIES.find(function (c) { return c.slug === product.category; });
    const color = CAT_COLOR[product.category] || '#34b9f0';
    const icon = ICON_PATHS[(cat && cat.icon) || 'kit'] || ICON_PATHS.kit;
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
      '<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#0b1a3a"/><stop offset="1" stop-color="#050b1c"/>' +
      '</linearGradient></defs>' +
      '<rect width="64" height="64" fill="url(#g)"/>' +
      '<g fill="none" stroke="' + color + '" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.92">' +
      icon + '</g></svg>';
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  /* ---- Helpers ----------------------------------------------------------- */
  function formatPrice(value, currency) {
    try {
      return new Intl.NumberFormat('en-MY', {
        style: 'currency', currency: currency || 'MYR', minimumFractionDigits: 2,
      }).format(value);
    } catch (e) {
      return 'RM ' + Number(value).toFixed(2);
    }
  }
  function bySlug(slug) { return PRODUCTS.find(function (p) { return p.slug === slug; }); }
  function byId(id) { return PRODUCTS.find(function (p) { return p.id === id; }); }
  function inCategory(slug) { return PRODUCTS.filter(function (p) { return p.category === slug; }); }
  function featured() { return PRODUCTS.filter(function (p) { return p.isFeatured; }); }
  function categoryInfo(slug) { return CATEGORIES.find(function (c) { return c.slug === slug; }); }

  function search(query) {
    const q = (query || '').trim().toLowerCase();
    if (!q) return PRODUCTS.slice();
    return PRODUCTS.filter(function (p) {
      const hay = [
        p.name, p.sku, p.description, p.category,
        (p.tags || []).join(' '),
        (p.compatibleVehicles || []).join(' '),
        (p.compatibleGearboxes || []).join(' '),
      ].join(' ').toLowerCase();
      return hay.indexOf(q) !== -1;
    });
  }

  global.MNACatalog = {
    categories: CATEGORIES,
    products: PRODUCTS,
    catColor: CAT_COLOR,
    thumbFor: thumbFor,
    formatPrice: formatPrice,
    bySlug: bySlug,
    byId: byId,
    inCategory: inCategory,
    featured: featured,
    categoryInfo: categoryInfo,
    search: search,
  };
})(window);
