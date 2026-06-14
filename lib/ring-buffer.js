/**
 * lib/ring-buffer.js
 *
 * Phase 7.1 — Per-signal circular time-series buffer + history manager.
 *
 * Records a fixed set of TEL signals at ~20 Hz for the last 300 s (6000
 * samples).  Backed by typed arrays (one Float32Array ring per signal + a
 * Float64Array ring of timestamps) so memory is flat ~1.5 MB and writes are
 * allocation-free on the hot path.
 *
 * Consumers:
 *   - sparkline chips (last 30 s per signal)
 *   - oscilloscope overlay (any signal, full window, zoomable)
 *   - timeline scrub (reconstruct a TEL snapshot at an arbitrary past time)
 *
 * API:
 *   const hist = new SignalHistory({ capacity, signals });
 *   hist.record(TEL, tMs, extra);     // call each frame (throttled to ~20 Hz by caller)
 *   hist.series(key, sinceMs)         // → { t:Float64Array view-ish, v, n } recent slice
 *   hist.snapshotAt(tMs)              // → { ...signalValues } nearest sample (for scrub)
 *   hist.range()                      // → { firstT, lastT, n }
 *   hist.addMarker(type, tMs, label)  // event marker (DTC / gear / throttle peak)
 *   hist.markersSince(sinceMs)        // → marker[]
 */

// Signals recorded for history.  Keep this list curated — it's the diagnostic
// time-series surface.  (key → also the TEL field name.)
export const HISTORY_SIGNALS = [
  'V_kph', 'N_MOT', 'N_Prim', 'N_sec', 'ratio',
  'P_line', 'P_pri', 'P_sec', 'P_clutch',
  'T_oil', 'T_clutch',
  'EDS1_mA', 'EDS2_mA', 'EDS3_mA',
  'beltSlip_pct', 'clutchSlip_pct',
  'throttlePct', 'engineTorqueNm', 'V_batt',
];

// Display metadata for the oscilloscope / sparklines (units + nominal axis).
export const SIGNAL_META = {
  V_kph:         { label: 'Vehicle speed', unit: 'kph', max: 180,  color: '#39c2d7' },
  N_MOT:         { label: 'Engine',        unit: 'rpm', max: 7000, color: '#7fe0ef' },
  N_Prim:        { label: 'Primary',       unit: 'rpm', max: 7000, color: '#5ad1c0' },
  N_sec:         { label: 'Secondary',     unit: 'rpm', max: 7000, color: '#9ad97f' },
  ratio:         { label: 'Variator ratio',unit: ':1',  max: 2.3,  color: '#eafbff' },
  P_line:        { label: 'Line pressure', unit: 'bar', max: 60,   color: '#f3b04a' },
  P_pri:         { label: 'Primary clamp', unit: 'bar', max: 60,   color: '#f3c06a' },
  P_sec:         { label: 'Secondary clamp',unit: 'bar',max: 60,   color: '#f3a04a' },
  P_clutch:      { label: 'Clutch press',  unit: 'bar', max: 40,   color: '#e0904a' },
  T_oil:         { label: 'Oil temp',      unit: '°C',  max: 150,  color: '#ef8b6b' },
  T_clutch:      { label: 'Clutch temp',   unit: '°C',  max: 180,  color: '#ef6b6b' },
  EDS1_mA:       { label: 'EDS1 current',  unit: 'mA',  max: 800,  color: '#b8a0f0' },
  EDS2_mA:       { label: 'EDS2 current',  unit: 'mA',  max: 800,  color: '#a89adf' },
  EDS3_mA:       { label: 'EDS3 current',  unit: 'mA',  max: 800,  color: '#9890cf' },
  beltSlip_pct:  { label: 'Belt slip',     unit: '%',   max: 5,    color: '#ff6b6b' },
  clutchSlip_pct:{ label: 'Clutch slip',   unit: '%',   max: 20,   color: '#ff8a4a' },
  throttlePct:   { label: 'Throttle',      unit: '%',   max: 100,  color: '#3ddc97' },
  engineTorqueNm:{ label: 'Eng torque',    unit: 'Nm',  max: 250,  color: '#6ad0a0' },
  V_batt:        { label: 'Battery',       unit: 'V',   max: 16,   color: '#d0d8e0' },
};

export class SignalHistory {
  constructor({ capacity = 6000, signals = HISTORY_SIGNALS } = {}) {
    this.capacity = capacity;
    this.signals = signals;
    this.t = new Float64Array(capacity);
    this.buf = {};
    for (const s of signals) this.buf[s] = new Float32Array(capacity);
    this.head = 0;       // next write index
    this.count = 0;      // total valid samples (≤ capacity)
    this.markers = [];   // { type, t, label }  (capped)
    this._lastSelector = null;
    this._thrPeakArm = false;
  }

  record(TEL, tMs, extra = {}) {
    const i = this.head;
    this.t[i] = tMs;
    for (const s of this.signals) {
      const v = TEL[s];
      this.buf[s][i] = (typeof v === 'number' && Number.isFinite(v)) ? v : 0;
    }
    this.head = (this.head + 1) % this.capacity;
    if (this.count < this.capacity) this.count++;

    // --- auto markers ---
    // gear change
    if (TEL.selector !== this._lastSelector) {
      if (this._lastSelector !== null) this.addMarker('gear', tMs, TEL.selector);
      this._lastSelector = TEL.selector;
    }
    // throttle peak (rising edge above 80 %)
    if ((TEL.throttlePct || 0) > 80 && !this._thrPeakArm) { this.addMarker('wot', tMs, 'WOT'); this._thrPeakArm = true; }
    if ((TEL.throttlePct || 0) < 60) this._thrPeakArm = false;
    // DTC marker fed via extra.dtcChanged
    if (extra.dtcMarker) this.addMarker('dtc', tMs, extra.dtcMarker);
  }

  addMarker(type, t, label) {
    this.markers.push({ type, t, label });
    // keep only markers within the buffer window + cap length
    const cutoff = t - this.windowMs();
    if (this.markers.length > 200) this.markers = this.markers.filter(m => m.t >= cutoff).slice(-200);
  }

  windowMs() {
    // approximate full window span (capacity / 20 Hz × 1000)
    return (this.capacity / 20) * 1000;
  }

  range() {
    if (this.count === 0) return { firstT: 0, lastT: 0, n: 0 };
    const lastT = this.t[(this.head - 1 + this.capacity) % this.capacity];
    const firstIdx = this.count < this.capacity ? 0 : this.head;
    const firstT = this.t[firstIdx];
    return { firstT, lastT, n: this.count };
  }

  /** Recent slice of one signal since `sinceMs` before now. Returns plain arrays. */
  series(key, sinceMs) {
    const out = { t: [], v: [], n: 0 };
    if (this.count === 0 || !this.buf[key]) return out;
    const lastT = this.t[(this.head - 1 + this.capacity) % this.capacity];
    const minT = lastT - sinceMs;
    // walk backward from newest to oldest until older than minT
    for (let k = 0; k < this.count; k++) {
      const idx = (this.head - 1 - k + this.capacity) % this.capacity;
      const tt = this.t[idx];
      if (tt < minT) break;
      out.t.push(tt);
      out.v.push(this.buf[key][idx]);
    }
    out.t.reverse(); out.v.reverse();
    out.n = out.v.length;
    return out;
  }

  /** Reconstruct a snapshot of all recorded signals nearest to time tMs. */
  snapshotAt(tMs) {
    if (this.count === 0) return null;
    // binary-ish linear search for nearest (buffer is monotonic in time within
    // the contiguous logical order); count is small enough for a guided scan.
    let bestIdx = -1, bestD = Infinity;
    for (let k = 0; k < this.count; k++) {
      const idx = (this.head - 1 - k + this.capacity) % this.capacity;
      const d = Math.abs(this.t[idx] - tMs);
      if (d < bestD) { bestD = d; bestIdx = idx; }
      // early-out: once we pass tMs going backward, the distance only grows
      if (this.t[idx] < tMs - bestD) break;
    }
    if (bestIdx < 0) return null;
    const snap = { _t: this.t[bestIdx] };
    for (const s of this.signals) snap[s] = this.buf[s][bestIdx];
    return snap;
  }

  markersSince(sinceMs) {
    if (this.count === 0) return [];
    const lastT = this.t[(this.head - 1 + this.capacity) % this.capacity];
    const minT = lastT - sinceMs;
    return this.markers.filter(m => m.t >= minT);
  }
}
