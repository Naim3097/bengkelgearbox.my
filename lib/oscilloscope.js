/**
 * lib/oscilloscope.js
 *
 * Phase 7.3 — Fullscreen 4-channel oscilloscope overlay.
 *
 * Toggled with the 'O' key.  Plots up to 4 selectable signals from the
 * SignalHistory ring buffer on a shared, scrollable, zoomable time axis with a
 * scrub cursor that reads out every channel at the hovered time.  Pure canvas —
 * no charting library.
 *
 *   const scope = buildOscilloscope({ history });
 *   scope.toggle();         // open / close
 *   scope.update();         // call each frame while open (cheap no-op when closed)
 *   scope.isOpen();
 */

import { SIGNAL_META, HISTORY_SIGNALS } from './ring-buffer.js';

const DEFAULT_CHANNELS = ['N_MOT', 'ratio', 'P_line', 'T_oil'];
const CH_COLORS = ['#39c2d7', '#eafbff', '#f3b04a', '#ef6b6b'];

export function buildOscilloscope({ history }) {
  let open = false;
  let windowMs = 30000;            // visible time span (zoomable 8s..300s)
  let channels = [...DEFAULT_CHANNELS];
  let cursorX = null;              // px within plot, or null

  // ── DOM ─────────────────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'scope-overlay';
  root.style.cssText = `position:fixed;inset:0;z-index:40;display:none;
    background:rgba(4,7,10,.92);backdrop-filter:blur(3px);
    font-family:'JetBrains Mono',ui-monospace,monospace;color:#cfe0e8`;

  const header = document.createElement('div');
  header.style.cssText = `position:absolute;top:0;left:0;right:0;height:46px;display:flex;
    align-items:center;gap:14px;padding:0 18px;border-bottom:1px solid rgba(57,194,215,.25)`;
  header.innerHTML = `<span style="letter-spacing:.22em;color:#39c2d7;font-size:12px;font-weight:600">◷ OSCILLOSCOPE</span>
    <span id="scope-win" style="font-size:10px;color:#9eb0bd">window 30s · scroll to zoom</span>
    <span style="flex:1"></span>
    <span id="scope-chips" style="display:flex;gap:6px"></span>
    <span style="font-size:10px;color:#9eb0bd">press O / Esc to close</span>`;
  root.appendChild(header);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;top:46px;left:0;width:100%;cursor:crosshair';
  root.appendChild(canvas);
  document.body.appendChild(root);
  const ctx = canvas.getContext('2d');
  let _W = 0, _H = 0;     // CSS-px plot surface dims (from window, layout-safe)

  // channel selector chips (click cycles the signal for that channel)
  const chipWrap = header.querySelector('#scope-chips');
  const chipEls = [];
  for (let c = 0; c < 4; c++) {
    const chip = document.createElement('button');
    chip.style.cssText = `font:600 10px 'JetBrains Mono',monospace;letter-spacing:.08em;
      padding:3px 8px;border-radius:3px;cursor:pointer;background:rgba(10,16,22,.6);
      border:1px solid ${CH_COLORS[c]};color:${CH_COLORS[c]}`;
    chip.addEventListener('click', () => cycleChannel(c));
    chipWrap.appendChild(chip);
    chipEls.push(chip);
  }
  function refreshChips() {
    channels.forEach((sig, c) => {
      const m = SIGNAL_META[sig] || { label: sig, unit: '' };
      chipEls[c].textContent = `CH${c + 1} ${m.label}`;
    });
  }
  function cycleChannel(c) {
    const cur = HISTORY_SIGNALS.indexOf(channels[c]);
    channels[c] = HISTORY_SIGNALS[(cur + 1) % HISTORY_SIGNALS.length];
    refreshChips();
  }
  refreshChips();

  // ── interaction ───────────────────────────────────────────────────────────
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const f = e.deltaY > 0 ? 1.2 : 1 / 1.2;
    windowMs = Math.max(8000, Math.min(300000, windowMs * f));
    header.querySelector('#scope-win').textContent = `window ${(windowMs / 1000).toFixed(0)}s · scroll to zoom`;
  }, { passive: false });
  canvas.addEventListener('mousemove', (e) => {
    const r = canvas.getBoundingClientRect();
    cursorX = e.clientX - r.left;
  });
  canvas.addEventListener('mouseleave', () => { cursorX = null; });

  function resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    _W = window.innerWidth;
    _H = Math.max(120, window.innerHeight - 46);   // below the 46px header
    canvas.style.height = _H + 'px';
    canvas.width  = Math.floor(_W * dpr);
    canvas.height = Math.floor(_H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  window.addEventListener('resize', () => { if (open) resize(); });

  // ── draw ────────────────────────────────────────────────────────────────
  function draw() {
    const W = _W, H = _H;
    ctx.clearRect(0, 0, W, H);
    const padL = 8, padR = 92, padT = 12, padB = 26;
    const plotW = W - padL - padR, plotH = H - padT - padB;

    const rng = history.range();
    if (rng.n < 2) return;
    const tEnd = rng.lastT;
    const tStart = tEnd - windowMs;

    // grid
    ctx.strokeStyle = 'rgba(57,194,215,.10)'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let g = 0; g <= 4; g++) { const y = padT + (plotH * g / 4); ctx.moveTo(padL, y); ctx.lineTo(padL + plotW, y); }
    for (let g = 0; g <= 6; g++) { const x = padL + (plotW * g / 6); ctx.moveTo(x, padT); ctx.lineTo(x, padT + plotH); }
    ctx.stroke();
    // time axis labels
    ctx.fillStyle = '#6b7884'; ctx.font = '9px monospace'; ctx.textAlign = 'center';
    for (let g = 0; g <= 6; g++) {
      const x = padL + (plotW * g / 6);
      const secsAgo = (windowMs / 1000) * (1 - g / 6);
      ctx.fillText(secsAgo < 0.5 ? 'now' : `-${secsAgo.toFixed(0)}s`, x, padT + plotH + 16);
    }

    const xOf = (t) => padL + ((t - tStart) / windowMs) * plotW;

    // per-channel traces
    channels.forEach((sig, c) => {
      const meta = SIGNAL_META[sig] || { max: 1, unit: '', label: sig };
      const s = history.series(sig, windowMs);
      if (s.n < 2) return;
      const color = CH_COLORS[c];
      ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.beginPath();
      const yOf = (v) => padT + plotH - Math.max(0, Math.min(1, v / meta.max)) * plotH;
      for (let i = 0; i < s.n; i++) {
        const x = xOf(s.t[i]), y = yOf(s.v[i]);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
      // live value label at right edge
      const lastV = s.v[s.n - 1];
      ctx.fillStyle = color; ctx.font = '10px monospace'; ctx.textAlign = 'left';
      ctx.fillText(`${lastV.toFixed(meta.max <= 3 ? 2 : 0)} ${meta.unit}`, padL + plotW + 6, yOf(lastV) + 3);
    });

    // cursor + readout
    if (cursorX != null && cursorX >= padL && cursorX <= padL + plotW) {
      const tCur = tStart + ((cursorX - padL) / plotW) * windowMs;
      ctx.strokeStyle = 'rgba(234,251,255,.5)'; ctx.lineWidth = 1; ctx.beginPath();
      ctx.moveTo(cursorX, padT); ctx.lineTo(cursorX, padT + plotH); ctx.stroke();
      const snap = history.snapshotAt(tCur);
      if (snap) {
        let yy = padT + 6;
        ctx.textAlign = 'left'; ctx.font = '10px monospace';
        ctx.fillStyle = 'rgba(5,9,12,.85)';
        ctx.fillRect(cursorX + 6, padT + 2, 150, 14 * channels.length + 8);
        channels.forEach((sig, c) => {
          const meta = SIGNAL_META[sig] || { unit: '' };
          ctx.fillStyle = CH_COLORS[c];
          ctx.fillText(`${sig}: ${(snap[sig] ?? 0).toFixed(meta.max <= 3 ? 2 : 0)} ${meta.unit}`, cursorX + 12, yy + 10);
          yy += 14;
        });
      }
    }
  }

  function toggle() {
    open = !open;
    root.style.display = open ? 'block' : 'none';
    if (open) { resize(); }
  }
  function update() { if (open) draw(); }
  function isOpen() { return open; }

  return { toggle, update, isOpen, get channels() { return channels; } };
}
