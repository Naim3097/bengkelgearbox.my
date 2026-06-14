/**
 * lib/cvt-context.js — THE shared terrain brain (Terrain-Aware Diagnosis, M4).
 *
 * One module, imported by BOTH diagnosis engines AND the envelope/operating-point
 * backbone (wired in M5). It turns the terrain signals already in TEL
 * (grade_pct, road_load_Nm, geo_ok — landed by M3) into the diagnosis-facing
 * facts: the true INPUT torque, the expected clamp/line pressure for that torque,
 * a grade classification, and the environmental "known-behaviour" suppressions.
 *
 * ── ZERO-REGRESSION CONTRACT ────────────────────────────────────────────────
 * This module ONLY describes the GEO path. When `TEL.geo_ok` is false:
 *   • loadTorque() → null        (caller keeps its own throttle/torque proxy)
 *   • gradeClass() → 'unknown'   (no env behaviour fires)
 *   • envFactor()  → 1           (no suppression)
 * So with no GPS / old session / replay-without-geo, the engines run their
 * EXISTING logic unchanged → behaviour is byte-identical to today. Terrain only
 * ever SHARPENS the result when present.
 *
 * No DOM, no Node/browser APIs — pure functions, unit-testable standalone.
 */

import { inputTorqueNm, VEH_DEFAULTS } from './road-load.js';

// Pressure baselines (bar) as a function of the INPUT (variator) torque that
// must cross the belt. Anchored to the unit's measured schedule: ~8 bar secondary
// baseline → ~52 bar near peak input torque (~180 Nm); line ~12 → ~58 bar. These
// are the GEO-PATH requirements; the no-geo path stays each engine's own formula.
const SEC_BAR0 = 8,  SEC_BAR_PER_NM = (52 - 8) / 180;   // ≈ 0.244 bar/Nm
const LINE_BAR0 = 12, LINE_BAR_PER_NM = (58 - 12) / 180; // ≈ 0.256 bar/Nm
const BAR_CAP = 58;                                      // physical line/clamp ceiling
const PEAK_INPUT_NM = 180;                               // engine peak (for reference)

// Wet launch-clutch lockup speed (~25 km/h) + a small ramp margin. Below this the
// clutch is DESIGNED to slip on its way to lockup, so clutch slip there is normal,
// not a fault. BOTH engines gate their clutch-slip detectors on this single value
// so they agree at launch (it's the one shared lockup threshold).
export const LOCKUP_KPH = 28;

/**
 * Best terrain-derived INPUT (variator) torque, or NULL when there's no usable
 * geo (→ caller keeps its own proxy; zero-regression). Uses the live ratio to
 * convert wheel torque (road_load_Nm) to input torque. Basis-tagged for honesty.
 */
export function loadTorque(TEL, veh = VEH_DEFAULTS) {
  if (!TEL || !TEL.geo_ok) return null;
  const wheel = TEL.road_load_Nm;
  if (wheel == null || !Number.isFinite(+wheel)) return null;
  const ratioTotal = ((TEL.ratio > 0 ? TEL.ratio : 1)) * veh.iFinal;
  const Nm = inputTorqueNm(+wheel, ratioTotal, veh.driveEff);
  return { Nm, mag: Math.abs(Nm), basis: 'derived-geo', source: 'road-load' };
}

/** Expected SECONDARY clamp (bar) for an input-torque magnitude. Geo path only. */
export function expectedSecClampBar(inputNmMag) {
  const t = Math.max(0, +inputNmMag || 0);
  return Math.min(BAR_CAP, SEC_BAR0 + t * SEC_BAR_PER_NM);
}

/** Expected LINE pressure (bar) for an input-torque magnitude. Geo path only. */
export function expectedLineBar(inputNmMag) {
  const t = Math.max(0, +inputNmMag || 0);
  return Math.min(BAR_CAP, LINE_BAR0 + t * LINE_BAR_PER_NM);
}

/**
 * Torque magnitude (Nm) to size clamp pressure for the CURRENT state, no-geo path.
 * We use THROTTLE — not the raw engine_torque bus signal. On real CAN, engine_torque
 * is 0x11 byte[7], an UNCALIBRATED raw byte (observed 51–140, never below ~51 even at
 * idle, and reads ~121 at 31 % throttle): treating it as Nm over-states load at part
 * throttle and makes the clamp requirement false-fire on healthy real drives (verified
 * on session-13). Throttle is the reliable proxy the requirement schedule was empirically
 * calibrated to (light ≈ 15 bar → WOT ≈ 52 bar). Through expectedSecClampBar this
 * REPRODUCES the original throttle formula exactly (8 + thr·0.44 = 8 + (thr·1.8)·0.244),
 * so the report engine is byte-identical on real sessions.
 *   NOTE: real TORQUE *is* used where it's trustworthy — the GEO path (road-load physics),
 *   via loadTorque() in secClampReqBar/lineReqBar below.
 */
function noGeoTorqueNm(TEL) {
  const thr = (TEL && +TEL.throttlePct) || 0;
  return Math.max(0, Math.min(100, thr)) / 100 * PEAK_INPUT_NM;   // throttle → torque estimate (0..180 Nm)
}

/**
 * THE single secondary-clamp requirement (bar) both engines call. Geo-aware: on a
 * grade it sizes to the real road-load input torque; otherwise to engine torque
 * (throttle-estimated only if torque is missing). One calibrated curve everywhere —
 * no throttle-vs-torque fork, no geo-on/off discontinuity. (Geo path is byte-identical
 * to before: it still resolves to expectedSecClampBar(loadTorque.mag).)
 */
export function secClampReqBar(TEL) {
  const lt = loadTorque(TEL);
  return expectedSecClampBar(lt ? lt.mag : noGeoTorqueNm(TEL));
}

/** THE single LINE-pressure requirement (bar) both engines call. Same basis as secClampReqBar. */
export function lineReqBar(TEL) {
  const lt = loadTorque(TEL);
  return expectedLineBar(lt ? lt.mag : noGeoTorqueNm(TEL));
}

/**
 * Classify the terrain right now from TEL. Returns 'unknown' (→ no env behaviour)
 * whenever geo is absent. `state`: 'climb' | 'descend' | 'level' | 'unknown'.
 */
export function gradeClass(TEL) {
  if (!TEL || !TEL.geo_ok || TEL.grade_pct == null || !Number.isFinite(+TEL.grade_pct)) {
    return { state: 'unknown', grade: null, magnitude: 0, cornering: false };
  }
  const g = +TEL.grade_pct;                       // percent (+up / −down)
  const state = g > 2.5 ? 'climb' : g < -2.5 ? 'descend' : 'level';
  const cornering = (TEL.turn_rate != null) && Math.abs(+TEL.turn_rate) > 15;  // deg/s (M5+)
  return { state, grade: g, magnitude: Math.abs(g), cornering };
}

/**
 * Environmental KNOWN-BEHAVIOURS — terrain's analog of CVT_PROFILES.punch_vt2.
 * Each DISCOUNTS (or suppresses) a rule only while its terrain context holds.
 * Reported, never silent. factor 0 = expected-by-design; 0<factor<1 = discount.
 */
export const ENV_BEHAVIORS = [
  { id: 'uphill_no_overdrive',
    appliesTo: ['CVT_NO_OVERDRIVE'],
    when: (c) => c.state === 'climb',
    factor: 0.0,
    reason: 'Uphill: the CVT correctly holds a lower ratio for the grade — "no overdrive at speed" is expected here, not a fault.' },
  { id: 'downhill_flare',
    appliesTo: ['CVT_BELT_SLIP', 'CVT_CLUTCH_SLIP', 'belt_slip', 'clutch_slip'],
    when: (c) => c.state === 'descend',
    factor: 0.4,
    reason: 'Downhill: engine-braking flares revs and unloads the belt — slip sensitivity discounted (not zeroed) so a real descent slip still reads.' },
  { id: 'cornering_mod',
    appliesTo: ['CVT_JUDDER', 'CVT_RATIO_HUNTING', 'ratio_error'],
    when: (c) => !!c.cornering,
    factor: 0.4,
    reason: 'Cornering: throttle modulation through the turn explains ratio/judder fluctuation.' },
];

/**
 * Product of all environmental factors that apply to `ruleId` under terrain `ctx`
 * (a gradeClass() result). 1 when geo is absent or nothing matches → no change.
 * Returns { factor, applied:[{id,reason,factor}] } so callers can report it.
 */
export function envFactor(ruleId, ctx) {
  if (!ctx || ctx.state === 'unknown') return { factor: 1, applied: [] };
  let factor = 1; const applied = [];
  for (const b of ENV_BEHAVIORS) {
    if (!b.appliesTo.includes(ruleId)) continue;
    let ok; try { ok = b.when(ctx); } catch { ok = false; }
    if (ok) { factor *= b.factor; applied.push({ id: b.id, reason: b.reason, factor: b.factor }); }
  }
  return { factor, applied };
}

/**
 * Convenience bundle the engines call once per evaluation. Carries the load
 * torque (or null), the expected pressures FOR THAT torque, the grade class, and
 * a coverage flag. With no geo: { geo:false, loadTorque:null, grade:'unknown' }.
 */
export function terrainContext(TEL, veh = VEH_DEFAULTS) {
  const lt = loadTorque(TEL, veh);
  const gc = gradeClass(TEL);
  return {
    geo: !!(TEL && TEL.geo_ok),
    basis: TEL && TEL.gradeBasis ? TEL.gradeBasis : (lt ? lt.basis : null),
    loadTorque: lt,                                   // null when no geo
    expectedSecBar: lt ? expectedSecClampBar(lt.mag) : null,
    expectedLineBar: lt ? expectedLineBar(lt.mag) : null,
    grade: gc,                                        // { state, grade, magnitude, cornering }
  };
}

export const CVT_CONTEXT_CONSTANTS = { SEC_BAR0, SEC_BAR_PER_NM, LINE_BAR0, LINE_BAR_PER_NM, BAR_CAP, PEAK_INPUT_NM };
