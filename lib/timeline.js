/**
 * lib/timeline.js
 *
 * Phase 7.4 — Scrubbable history timeline.
 *
 * A slim bottom-of-screen strip showing the last 5 minutes of vehicle speed as
 * a filled area, overlaid with event markers (DTC = red, gear change = cyan,
 * WOT = amber).  Dragging anywhere on the strip enters SCRUB mode: the host
 * rewinds the entire HUD + 3D model to that moment via the snapshot callback.
 * Releasing returns to live.
 *
 *   const tl = buildTimeline({
 *     history,
 *     onScrub:    (snapshot, tMs) => { ...apply to TEL... },
 *     onScrubEnd: () => { ...resume live... },
 *   });
 *   tl.update();   // each frame
 */

import { SIGNAL_META } from './ring-buffer.js';

const SPAN_MS = 300000;   // 5 minutes
const MARKER_COLORS = { dtc: '#ef6b6b', gear: '#39c2d7', wot: '#f3b04a' };

export function buildTimeline({ history, onScrub, onScrubEnd }) {
  let scrubbing = false;

  const root = document.createElement('div');
  root.id = 'timeline';
  // Bottom strip that CLEARS the driver panel (bottom-left, ~320px wide).
  // Spans from just right of it to the right edge.
  root.style.cssText = `position:fixed;left:336px;right:16px;bottom:8px;
    height:72px;z-index:8;border:1px solid rgba(57,194,215,.3);
    border-radius:6px;background:linear-gradient(180deg,rgba(8,12,16,.9),rgba(5,8,11,.9));
    backdrop-filter:blur(6px);cursor:crosshair;overflow:hidden;
    box-shadow:0 4px 20px rgba(0,0,0,.5)`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
  root.appendChild(canvas);
  const tip = document.createElement('div');
  tip.style.cssText = `position:absolute;top:4px;left:10px;font:700 9.5px 'JetBrains Mono',monospace;
    letter-spacing:.2em;color:#39c2d7;pointer-events:none;text-transform:uppercase`;
  tip.innerHTML = `HISTORY <span style="color:#6b7884;font-weight:400">· vehicle speed · drag to scrub · 5 min</span>`;
  root.appendChild(tip);
  document.body.appendChild(root);
  const ctx = canvas.getContext('2d');
  // Header band reserved at the top for marker labels (so they never collide
  // with the speed trace) + a baseline area for the trace below it.
  const HEADER_H = 20;

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.floor(root.clientWidth * dpr);
    canvas.height = Math.floor(root.clientHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', resize);
  setTimeout(resize, 0);

  // map clientX → time
  function timeAtX(clientX) {
    const r = root.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    const rng = history.range();
    const tEnd = rng.lastT, tStart = tEnd - SPAN_MS;
    return tStart + frac * SPAN_MS;
  }

  function doScrub(clientX) {
    const t = timeAtX(clientX);
    const snap = history.snapshotAt(t);
    if (snap && onScrub) onScrub(snap, t);
    _scrubX = clientX;
  }
  let _scrubX = null;

  // POINTER events (superset of mouse) so the scrubber drags with a finger on touch
  // screens too — identical behaviour for a mouse. touch-action:none keeps a horizontal
  // drag from scrolling the page; setPointerCapture keeps the drag alive off-element.
  root.style.touchAction = 'none';
  root.addEventListener('pointerdown', (e) => {
    scrubbing = true; try { root.setPointerCapture(e.pointerId); } catch {} doScrub(e.clientX);
  });
  window.addEventListener('pointermove', (e) => { if (scrubbing) doScrub(e.clientX); });
  const _endScrub = () => { if (scrubbing) { scrubbing = false; _scrubX = null; if (onScrubEnd) onScrubEnd(); } };
  window.addEventListener('pointerup', _endScrub);
  window.addEventListener('pointercancel', _endScrub);

  function update() {
    const W = root.clientWidth, H = root.clientHeight;
    if (!W) return;
    ctx.clearRect(0, 0, W, H);
    const rng = history.range();
    if (rng.n < 2) return;
    const tEnd = rng.lastT, tStart = tEnd - SPAN_MS;
    const xOf = (t) => ((t - tStart) / SPAN_MS) * W;
    const plotTop = HEADER_H, plotBot = H - 4, plotH = plotBot - plotTop;

    // ── minute gridlines + time labels (so it reads as a real timeline) ──────
    ctx.font = "9px 'JetBrains Mono',monospace"; ctx.textBaseline = 'alphabetic';
    for (let mAgo = 0; mAgo <= 5; mAgo++) {
      const x = W - (mAgo / 5) * W;
      ctx.strokeStyle = 'rgba(57,194,215,.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBot); ctx.stroke();
      ctx.fillStyle = '#5a6b78'; ctx.textAlign = mAgo === 0 ? 'right' : (mAgo === 5 ? 'left' : 'center');
      ctx.fillText(mAgo === 0 ? 'now' : `-${mAgo}m`, mAgo === 0 ? W - 4 : (mAgo === 5 ? 4 : x), H - 5);
    }

    // ── speed area fill (gradient) + bright stroke ───────────────────────────
    const s = history.series('V_kph', SPAN_MS);
    const meta = SIGNAL_META.V_kph;
    const yOf = (v) => plotBot - Math.max(0, Math.min(1, v / meta.max)) * (plotH - 4);
    if (s.n > 1) {
      const grad = ctx.createLinearGradient(0, plotTop, 0, plotBot);
      grad.addColorStop(0, 'rgba(57,194,215,.38)');
      grad.addColorStop(1, 'rgba(57,194,215,.04)');
      ctx.beginPath();
      ctx.moveTo(xOf(s.t[0]), plotBot);
      for (let i = 0; i < s.n; i++) ctx.lineTo(xOf(s.t[i]), yOf(s.v[i]));
      ctx.lineTo(xOf(s.t[s.n - 1]), plotBot);
      ctx.closePath();
      ctx.fillStyle = grad; ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < s.n; i++) { const x = xOf(s.t[i]), y = yOf(s.v[i]); if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y); }
      ctx.strokeStyle = '#57c8e0'; ctx.lineWidth = 1.5; ctx.stroke();
    }

    // ── markers (collision-avoided labels in the header band) ────────────────
    const markers = history.markersSince(SPAN_MS);
    let lastLabelX = -1e9;
    for (const m of markers) {
      const x = xOf(m.t);
      if (x < 0 || x > W) continue;
      const col = MARKER_COLORS[m.type] || '#9eb0bd';
      // tick down through the plot
      ctx.strokeStyle = col; ctx.globalAlpha = m.type === 'dtc' ? 0.9 : 0.5;
      ctx.lineWidth = m.type === 'dtc' ? 2 : 1;
      ctx.beginPath(); ctx.moveTo(x, plotTop); ctx.lineTo(x, plotBot); ctx.stroke();
      ctx.globalAlpha = 1;
      // label only if it won't collide with the previous one (≥26 px apart),
      // or always for DTC (important).
      if (m.type === 'dtc' || x - lastLabelX > 26) {
        const txt = String(m.label).slice(0, 6);
        ctx.fillStyle = col; ctx.font = "700 9px 'JetBrains Mono',monospace"; ctx.textAlign = 'center';
        // small chip behind the label for legibility
        const w = ctx.measureText(txt).width + 6;
        ctx.fillStyle = 'rgba(5,9,12,.7)'; ctx.fillRect(x - w/2, 4, w, 12);
        ctx.fillStyle = col; ctx.fillText(txt, x, 13);
        lastLabelX = x;
      }
    }

    // ── playhead ─────────────────────────────────────────────────────────────
    let phX = W - 1;
    if (scrubbing && _scrubX != null) {
      const r = root.getBoundingClientRect();
      phX = Math.max(0, Math.min(W, _scrubX - r.left));
    }
    ctx.strokeStyle = scrubbing ? '#eafbff' : 'rgba(61,220,151,.85)';
    ctx.lineWidth = scrubbing ? 2 : 1.5;
    ctx.beginPath(); ctx.moveTo(phX, plotTop); ctx.lineTo(phX, H); ctx.stroke();
    if (scrubbing) {
      const t = timeAtX(_scrubX);
      const secsAgo = (tEnd - t) / 1000;
      const lbl = secsAgo >= 60 ? `-${Math.floor(secsAgo/60)}m${(secsAgo%60).toFixed(0)}s` : `-${secsAgo.toFixed(1)}s`;
      ctx.fillStyle = '#eafbff'; ctx.font = "700 10px 'JetBrains Mono',monospace"; ctx.textAlign = phX > W - 70 ? 'right' : 'left';
      const tx = phX + (phX > W - 70 ? -5 : 5);
      const tw = ctx.measureText(lbl).width + 6;
      ctx.fillStyle = 'rgba(5,9,12,.8)'; ctx.fillRect(phX > W-70 ? tx-tw : tx-3, plotTop+2, tw, 13);
      ctx.fillStyle = '#eafbff'; ctx.fillText(lbl, tx, plotTop + 12);
    }
  }

  function setVisible(v) { root.style.display = v ? 'block' : 'none'; }
  function isScrubbing() { return scrubbing; }

  return { update, setVisible, isScrubbing };
}
