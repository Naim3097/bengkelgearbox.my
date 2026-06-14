/**
 * lib/operating-point.js
 *
 * Phase 6.4 — Rolling operating-point detector.
 *
 * A CVT's "healthy" value for any signal depends entirely on what the unit is
 * being asked to do *right now*: 40 bar of line pressure is healthy at WOT but
 * a fault at idle; a 2.0 ratio is healthy launching from a stop but wrong at
 * 120 km/h.  So before we can judge a value against an envelope, we must first
 * classify the current operating point.
 *
 * Inputs (from TEL): N_MOT (engine rpm), throttlePct, selector, V_kph, brake.
 * Output: a stable operating-point object that the envelope resolver keys on.
 *
 * The classifier is hysteretic + low-passed so the operating point doesn't
 * flicker between buckets on noisy live data (which would make the envelope
 * bands jump around).
 *
 *   const op = makeOperatingPoint();
 *   const pt = op.update(TEL, dt);   // → { bucket, label, throttle, vkph, ... }
 */

import { loadTorque, gradeClass } from './cvt-context.js';   // M5 — terrain context on the op

export const OP_BUCKETS = {
  PARK_IDLE:   'park-idle',     // P/N, stopped, engine idling
  STALL:       'stall',         // D/R, stopped on brake, engine loaded against clutch
  LAUNCH:      'launch',        // D/S, accelerating hard from low speed
  CREEP:       'creep',         // D, very low speed, light throttle
  CRUISE_LT:   'cruise-light',  // steady, light throttle
  CRUISE_MID:  'cruise-mid',    // steady, moderate throttle
  WOT:         'wot',           // wide-open / near-full throttle, moving
  COAST:       'coast',         // throttle lifted, vehicle rolling (overrun)
  REVERSE:     'reverse',       // R selected
};

const LABELS = {
  'park-idle':  'Park / Idle',
  'stall':      'Stall (stopped in gear)',
  'launch':     'Launch',
  'creep':      'Creep',
  'cruise-light':'Light cruise',
  'cruise-mid': 'Mid-load cruise',
  'wot':        'Wide-open throttle',
  'coast':      'Coast / overrun',
  'reverse':    'Reverse',
};

export function makeOperatingPoint() {
  // Low-passed copies of the raw inputs — smooth the classifier inputs so the
  // bucket is stable.
  let sThr = 0, sV = 0, sRpm = 0;
  let bucket = OP_BUCKETS.PARK_IDLE;
  let _holdT = 0;                 // hysteresis dwell timer (s)

  function classify(thr, v, rpm, sel, brake) {
    const inGear = (sel === 'D' || sel === 'S');
    if (sel === 'R') return OP_BUCKETS.REVERSE;
    if (sel === 'P' || sel === 'N') return OP_BUCKETS.PARK_IDLE;
    // In a forward gear from here on.
    if (v < 3) {
      return (brake > 0.2 || thr < 8) ? OP_BUCKETS.STALL : OP_BUCKETS.LAUNCH;
    }
    if (thr >= 70)            return OP_BUCKETS.WOT;
    if (v < 15 && thr >= 25)  return OP_BUCKETS.LAUNCH;
    if (thr < 5)              return OP_BUCKETS.COAST;
    if (v < 12)               return OP_BUCKETS.CREEP;
    if (thr < 28)             return OP_BUCKETS.CRUISE_LT;
    return OP_BUCKETS.CRUISE_MID;
  }

  function update(TEL, dt = 0.016) {
    const a = Math.min(1, dt * 4);          // ~0.25 s smoothing
    sThr += ((TEL.throttlePct || 0) - sThr) * a;
    sV   += ((TEL.V_kph || 0)      - sV)   * a;
    sRpm += ((TEL.N_MOT || 0)      - sRpm) * a;

    const target = classify(sThr, sV, sRpm, TEL.selector, TEL.brake || 0);

    // Hysteresis: require the target bucket to persist ~0.4 s before switching,
    // EXCEPT selector-driven buckets (P/N/R) which are authoritative & instant.
    const instant = (target === OP_BUCKETS.REVERSE || target === OP_BUCKETS.PARK_IDLE
                   || bucket === OP_BUCKETS.REVERSE || bucket === OP_BUCKETS.PARK_IDLE);
    if (target === bucket) {
      _holdT = 0;
    } else if (instant) {
      bucket = target; _holdT = 0;
    } else {
      _holdT += dt;
      if (_holdT > 0.4) { bucket = target; _holdT = 0; }
    }

    // M5 — terrain context (null/'unknown' when no geo → downstream unchanged).
    const _lt = loadTorque(TEL);
    const _gc = gradeClass(TEL);
    return {
      bucket,
      label: LABELS[bucket] || bucket,
      throttle: sThr,
      vkph: sV,
      rpm: sRpm,
      selector: TEL.selector,
      geo: _gc.state !== 'unknown',
      grade: _gc.state,
      grade_pct: _gc.grade,
      loadTorqueNm: _lt ? _lt.mag : null,
    };
  }

  return { update, get bucket() { return bucket; } };
}
