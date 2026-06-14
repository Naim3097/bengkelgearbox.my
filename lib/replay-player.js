/**
 * lib/replay-player.js
 *
 * Phase 8 — Client-side session replay player.
 *
 * Loads a decoded session (from the bridge `GET /sessions/<id>/series`) and
 * plays it back entirely in the browser with full transport control:
 * play / pause / seek (instant scrub) / variable speed.  Because the whole
 * decoded series lives in memory, scrubbing is instantaneous and speed is
 * arbitrary — no per-frame round-trips to the bridge.
 *
 * Sampling is step-hold (zero-order-hold): the value of a signal at time t is
 * the most recent sample at or before t — exactly how a real signal reads
 * between updates.
 *
 *   const player = buildReplayPlayer();
 *   await player.load(seriesJson);     // { id, label, durationMs, signals:{sig:{t,v}} }
 *   player.play();  player.setSpeed(2);
 *   player.tick(dt);                   // each frame; advances the cursor
 *   const map = player.sample();       // { sigId: value } at current cursor
 */

export function buildReplayPlayer() {
  let signals = null;      // { sig: { t:Float, v:Float } }
  let sigKeys = [];
  let durationMs = 0;
  let cursorMs = 0;
  let playing = false;
  let speed = 1;
  let label = '';
  let id = null;
  let loop = true;
  const _idx = {};         // per-signal running search index (optimisation)

  async function load(data) {
    signals = data.signals || {};
    sigKeys = Object.keys(signals);
    durationMs = data.durationMs || 0;
    label = data.label || data.id || '';
    id = data.id || null;
    cursorMs = 0; playing = false;
    for (const k of sigKeys) _idx[k] = 0;
    return { ok: true, durationMs, label, signalCount: sigKeys.length };
  }

  // value of one signal at time t (step-hold).  Uses a binary search; cheap
  // enough per-signal per-frame for these series sizes.
  function valueAt(key, t) {
    const s = signals[key];
    if (!s || !s.t.length) return null;
    const arr = s.t;
    if (t <= arr[0]) return s.v[0];
    if (t >= arr[arr.length - 1]) return s.v[arr.length - 1];
    let lo = 0, hi = arr.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (arr[mid] <= t) lo = mid; else hi = mid - 1;
    }
    return s.v[lo];
  }

  function sample() {
    const out = {};
    if (!signals) return out;
    for (const k of sigKeys) {
      const v = valueAt(k, cursorMs);
      if (v != null) out[k] = v;
    }
    return out;
  }

  function tick(dt) {
    if (!playing || !signals) return;
    cursorMs += dt * 1000 * speed;
    if (cursorMs >= durationMs) {
      if (loop) cursorMs = 0;
      else { cursorMs = durationMs; playing = false; }
    }
    if (cursorMs < 0) cursorMs = 0;
  }

  return {
    load,
    sample,
    tick,
    play()        { if (signals) playing = true; },
    pause()       { playing = false; },
    toggle()      { playing = !playing && !!signals; },
    seek(tMs)     { cursorMs = Math.max(0, Math.min(durationMs, tMs)); },
    seekFrac(f)   { cursorMs = Math.max(0, Math.min(1, f)) * durationMs; },
    setSpeed(x)   { speed = x; },
    setLoop(v)    { loop = !!v; },
    get loaded()  { return !!signals; },
    get playing() { return playing; },
    get speed()   { return speed; },
    get cursorMs(){ return cursorMs; },
    get durationMs(){ return durationMs; },
    get label()   { return label; },
    get id()      { return id; },
    get signalKeys(){ return sigKeys; },
  };
}
