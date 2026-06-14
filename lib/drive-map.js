/**
 * lib/drive-map.js — self-contained drive-map renderer (Terrain-Aware Diagnosis, M6).
 *
 * Draws the GPS drive path + fault pins into an SVG, with NO external dependency
 * and NO API key — an equirectangular auto-fit projection. This is the always-on
 * baseline; a Google Maps JS SDK street-map is a key-gated upgrade layered on top
 * in unit.html. Pure rendering — caller owns the path/pin data.
 *
 *   const map = makeDriveMap(divEl);
 *   map.render({ path:[{lat,lng}], pins:[{lat,lng,sev,label}], current:{lat,lng} });
 */

const SEV_COLOR = { critical: '#ef6b6b', warning: '#f3b04a', monitor: '#39c2d7', info: '#39c2d7' };

export function makeDriveMap(el) {
  const W = 100, H = 100;   // viewBox units (SVG scales to the container)

  function project(pts, pad = 8) {
    // bounds
    let minLa = Infinity, maxLa = -Infinity, minLo = Infinity, maxLo = -Infinity;
    for (const p of pts) {
      if (p.lat < minLa) minLa = p.lat; if (p.lat > maxLa) maxLa = p.lat;
      if (p.lng < minLo) minLo = p.lng; if (p.lng > maxLo) maxLo = p.lng;
    }
    const latMid = (minLa + maxLa) / 2;
    const cos = Math.cos(latMid * Math.PI / 180) || 1;
    // spans in projected units (lng scaled by cos(lat) so it isn't stretched)
    let spanX = Math.max(1e-6, (maxLo - minLo) * cos);
    let spanY = Math.max(1e-6, (maxLa - minLa));
    const span = Math.max(spanX, spanY);                 // square aspect, keep shape
    const k = (Math.min(W, H) - 2 * pad) / span;
    const cx = (minLo + maxLo) / 2, cy = (minLa + maxLa) / 2;
    return (p) => ({
      x: W / 2 + ((p.lng - cx) * cos) * k,
      y: H / 2 - ((p.lat - cy)) * k,                     // y inverted (north up)
    });
  }

  function render({ path = [], pins = [], current = null } = {}) {
    if (!el) return;
    const all = path.concat(pins).concat(current ? [current] : []);
    if (all.length === 0) {
      el.innerHTML = '<div class="dm-empty">awaiting GPS fixes…<br><span>start capture on the geo-capture page, or replay an enriched session</span></div>';
      return;
    }
    const pr = project(all);
    const pathPts = path.map(pr);
    const poly = pathPts.length > 1
      ? `<polyline points="${pathPts.map(p => p.x.toFixed(2) + ',' + p.y.toFixed(2)).join(' ')}" fill="none" stroke="#39c2d7" stroke-width="0.8" stroke-linejoin="round" stroke-linecap="round" opacity="0.85"/>`
      : '';
    const pinSvg = pins.map((pin) => {
      const q = pr(pin); const c = SEV_COLOR[pin.sev] || '#39c2d7';
      return `<g><circle cx="${q.x.toFixed(2)}" cy="${q.y.toFixed(2)}" r="2.4" fill="${c}" fill-opacity="0.25" stroke="${c}" stroke-width="0.7"/>`
           + `<circle cx="${q.x.toFixed(2)}" cy="${q.y.toFixed(2)}" r="0.9" fill="${c}"/></g>`;
    }).join('');
    let cur = '';
    if (current) { const q = pr(current); cur = `<circle cx="${q.x.toFixed(2)}" cy="${q.y.toFixed(2)}" r="1.6" fill="#3ddc97" stroke="#eafbff" stroke-width="0.5"><animate attributeName="r" values="1.4;2.6;1.4" dur="1.6s" repeatCount="indefinite"/></circle>`; }
    el.innerHTML =
      `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" class="dm-svg">`
      + `<rect x="0" y="0" width="${W}" height="${H}" fill="rgba(57,194,215,0.02)"/>`
      + poly + pinSvg + cur
      + `</svg>`;
  }

  return { render };
}

// ── Google Maps JS SDK street-map (key-gated upgrade) ────────────────────────
// Same render({path,pins,current}) interface as the SVG map. Loads the SDK lazily;
// shows the SVG map until the street-map is ready, and PERMANENTLY falls back to
// the SVG if the SDK can't load (bad key / referrer not allow-listed).
let _gmapsLoad = null;
function loadGoogleMaps(key) {
  if (window.google && window.google.maps) return Promise.resolve();
  if (_gmapsLoad) return _gmapsLoad;
  _gmapsLoad = new Promise((resolve, reject) => {
    window.__sxanGmapsReady = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&callback=__sxanGmapsReady&v=weekly`;
    s.async = true; s.defer = true;
    s.onerror = () => reject(new Error('Google Maps SDK failed to load'));
    document.head.appendChild(s);
  });
  return _gmapsLoad;
}

const DARK_STYLE = [
  { elementType: 'geometry', stylers: [{ color: '#0b141b' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#6b8a96' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#060a0e' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1b2a33' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#264a57' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0a1f29' }] },
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] },
];

export function makeGoogleDriveMap(el, key) {
  const svg = makeDriveMap(el);   // shown until ready / on failure
  let map = null, poly = null, cur = null, markers = [], ready = false, failed = false, last = null, fitted = false;
  // Google calls this globally when the key/referrer/billing is rejected at runtime
  // (after the SDK script itself loads). Fall back to the self-contained SVG map.
  window.gm_authFailure = () => { failed = true; ready = false; try { el.innerHTML = ''; } catch (e) {} svg.render(last || {}); };
  loadGoogleMaps(key).then(() => {
    el.innerHTML = '';
    map = new google.maps.Map(el, {
      center: { lat: 3.14, lng: 101.69 }, zoom: 14, mapTypeId: 'roadmap',
      disableDefaultUI: true, zoomControl: true, gestureHandling: 'greedy',
      backgroundColor: '#0b141b', styles: DARK_STYLE,
    });
    poly = new google.maps.Polyline({ map, path: [], strokeColor: '#39c2d7', strokeOpacity: 0.9, strokeWeight: 3 });
    ready = true; if (last) draw(last);
    // Robust auth/referrer/billing check: if no tiles render within 4 s, the key
    // isn't usable here (e.g. referrer not allow-listed) → drop to the SVG map.
    let tilesOk = false;
    google.maps.event.addListenerOnce(map, 'tilesloaded', () => { tilesOk = true; });
    setTimeout(() => {
      if (!tilesOk) { failed = true; ready = false; try { el.innerHTML = ''; } catch (e) {} svg.render(last || {}); }
    }, 9000);
  }).catch(() => { failed = true; if (last) svg.render(last); });

  function dot(color, scale) {
    return { path: google.maps.SymbolPath.CIRCLE, scale, fillColor: color, fillOpacity: 0.95, strokeColor: '#070b0e', strokeWeight: 1.5 };
  }
  function draw(d) {
    if (failed || !ready || !map) { svg.render(d); return; }
    poly.setPath((d.path || []).map((p) => ({ lat: p.lat, lng: p.lng })));
    markers.forEach((m) => m.setMap(null)); markers = [];
    for (const pin of (d.pins || [])) {
      markers.push(new google.maps.Marker({ map, position: { lat: pin.lat, lng: pin.lng }, title: pin.label || pin.ruleId, icon: dot(SEV_COLOR[pin.sev] || '#39c2d7', 7) }));
    }
    if (d.current) {
      const pos = { lat: d.current.lat, lng: d.current.lng };
      if (!cur) cur = new google.maps.Marker({ map, position: pos, icon: dot('#3ddc97', 6), zIndex: 999 });
      else cur.setPosition(pos);
    }
    if (!fitted && (d.path || []).length > 1) {
      const b = new google.maps.LatLngBounds(); d.path.forEach((p) => b.extend({ lat: p.lat, lng: p.lng })); map.fitBounds(b); fitted = true;
    }
  }
  return { render(d) { last = d; draw(d); } };
}
