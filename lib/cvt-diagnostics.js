/**
 * lib/cvt-diagnostics.js — CVT (Punch VT2) DIAGNOSIS DATA LAYER  (Phase 8.2)
 *
 * Ported from the BYKI V16 architecture (data-driven rule tables + coverage/
 * confidence gating + symptom→component mapping), specialised to the Punch VT2
 * and grounded in this project's REAL LID/CAN signals.
 *
 * PRINCIPLE (no hardcoded/mock conclusions): every diagnosis traces to a RULE
 * (data) evaluating a LIVE SIGNAL feature → a COMPONENT UNIT, with confidence
 * CAPPED by the signal's basis (measured/derived/estimated) and by coverage
 * (a missing signal can never produce a fault — it becomes "insufficient data").
 *
 * Source-agnostic: runs identically on manual-sim TEL, replayed-CAN TEL, or
 * live-CAN TEL.  It only READS signals and WRITES per-component risk — it owns
 * no state in the rest of the app.
 *
 * Output of evaluate():
 *   { componentRisk:{ belt, primary, secondary, clutch, hydraulic, thermal, electronics }, // 0..1
 *     findings:[ { ruleId, symptom, components, severity, strength, confidence, basis, note } ],
 *     coverage,            // 0..1 fraction of rules whose required signals were present
 *     worstSeverity }      // 'none'|'monitor'|'warning'|'critical'
 */

// M5 — shared terrain brain (geo path only; geo-less → identical behaviour).
import { gradeClass, envFactor, loadTorque, expectedSecClampBar, LOCKUP_KPH } from './cvt-context.js';

// ── Signal basis (honesty cap) — mirrors analysis-engine.js SIGNAL_BASIS + audit §H.
//    'measured'  : real, calibrated/trend-true off the bus
//    'derived'   : computed from measured anchors (no independent sensor)
//    'estimated' : modelled, NO physical sensor on this Preve → confidence-capped
export const SIGNAL_BASIS = {
  V_kph:'measured', N_MOT:'measured', throttlePct:'measured', coolantTempC:'measured',
  T_oil:'measured',                         // cvtf_temp byte (offset unconfirmed → trend)
  ratio:'measured', ratioCmd:'measured',    // raw_cvt_ratio (r²=0.994) / commanded
  P_line:'derived', P_pri:'derived', P_sec:'derived',   // byte-confirmed, scale UNCALIBRATED → trend only
  EDS1_mA:'derived', EDS2_mA:'derived',
  N_Prim:'derived', N_sec:'derived', beltSlip_pct:'derived', clutchSlip_pct:'derived',
  P_clutch:'estimated', T_clutch:'estimated', EDS3_mA:'estimated',
  lockupEngaged:'measured',
};
const BASIS_RANK = { measured:3, derived:2, estimated:1 };
// A finding can never exceed this confidence given the WORST basis among its signals.
const BASIS_CONF_CAP = { measured:1.0, derived:0.75, estimated:0.49 };

// ── Component units (the narrowing targets — keys match unit.html __health) ──
export const CVT_COMPONENTS = ['belt','primary','secondary','clutch','hydraulic','thermal','electronics'];

// ─────────────────────────────────────────────────────────────────────────────
// RESEARCH PROVENANCE (Phase 8.2 — ranges grounded in CVT literature, like BYKI)
// Every threshold below traces to a real physics formula / measured range, not a
// guess. Sources are tagged on each rule via `ref`. Key validated constants:
//
//  • Pulley CLAMPING FORCE (push-belt):  F = (S_fr · T) / (2 · μ · R · cos α)
//      α = 11° sheave HALF-angle (incl. 22°);  μ ≈ 0.09 steel-belt-in-CVTF;
//      safety factor S_fr ≈ 1.0–1.3.  ⇒ required clamp ∝ torque / radius.
//      [Liu et al., "Clamping Force Control … Slip Characteristics", PMC8949221]
//  • BELT SLIP regime:  micro-slip 1–2 % = NORMAL (efficiency peak); >~2 % enters
//      MACRO-slip (pulleys decouple → glazing/belt burn within minutes).
//      [Bonsen/van der Meulen et al.; IJAT metal V-belt slip dynamics; sciepub AJVD]
//  • LINE / CLAMP PRESSURE (real Jatco CVT): idle line ~10 bar (140 psi),
//      secondary idle ~4 bar (60 psi); peak/stall ~62 bar (900 psi); primary
//      8→48+ bar.  General push-belt CVT: idle 5–8, load 30–50, full ~60 bar.
//      [Gears Magazine — Jatco CVT Pressure Diagnostics; firgelliauto CVT]
//  • THERMAL: normal 60–80 °C (140–176 °F);  WARNING set-point ~125 °C (257 °F);
//      above → derate/limp.  Matches VT2 manual P0218 (>120) / P1767 (>130).
//      [Subaru CVT Field Service / training; manual P-codes]
//  • LOCKUP engagement ~16–25 km/h (load-dependent), lock RPM ~3200–3800.
//      [TC lockup strategy refs; Proton Preve measured ~25 km/h]
//  • EDS proportional solenoid: R ≈ 5.5 Ω, current 0–~1100 mA, current→pressure.
//      Matches VT2 manual EDS ≈ 5.05 Ω.  [Transmission-Digest/go4trans solenoid spec]
//  • JUDDER: stick-slip at clutch engage/lockup from friction-modifier decay /
//      touch-point drift; launch judder low-speed, lockup shudder ~40–80 km/h.
//      [Roadrunner/NewParts TC shudder; SAE wet-clutch judder]
//  • Punch VT2 real-world: dominant customer complaint = jerk/judder in slow
//      traffic (validates judder/jerk rules as primary). [paultan.org; wapcar.my]
// ─────────────────────────────────────────────────────────────────────────────

// helper: graded ramp 0..1 between lo (start firing) and hi (full strength)
const ramp = (x, lo, hi) => Math.max(0, Math.min(1, (x - lo) / (hi - lo)));

/**
 * THE RULE TABLE.  Each rule:
 *   id        unique id
 *   symptom   customer-language symptom this signature represents
 *   signals   required live signals (drives coverage + basis cap)
 *   components which CVT component units it implicates (→ 3D)
 *   severity  'monitor'|'warning'|'critical'
 *   weight    0..1 contribution to component risk
 *   test(f)   → strength 0..1 (0 = not firing) from the FEATURE object
 *   note      physics / what it means (for the report)
 *   dtc       (optional) the DTC this corresponds to
 */
export const CVT_RULES = [
  // ── Belt / variator (Category C) ──────────────────────────────────────────
  { id:'CVT_BELT_SLIP', symptom:'RPM flare / belt slip under load',
    signals:['ratio','beltSlip_pct'], components:['belt','secondary','hydraulic'],
    severity:'critical', weight:0.5, dtc:'P0944',
    // Research: micro-slip 1–2 % is NORMAL (efficiency peak); >~2 % = macro-slip,
    // where pulleys decouple and surfaces glaze/burn → warn from 2 %, gross by 8 %.
    // Belt slip = measured slip (beltSlip_pct). The ratio-variance PROXY (for sessions with
    // no slip signal) only counts at STEADY cruise — during normal shifting/transitions ratio
    // variance is expected, not slip (it was false-firing on real transition noise).
    test:f => Math.max(ramp(f.beltSlip_pct, 2, 8), (f.inGear && f.steady) ? ramp(f.ratio_var, 0.0030, 0.020) : 0),
    note:'Derived belt slip beyond the normal 1–2 % micro-slip band → macro-slip: insufficient clamping (F = S_fr·T/(2·μ·R·cos11°)) or belt/pulley wear. Macro-slip glazes sheaves and burns the belt within minutes.',
    ref:'metal V-belt slip dynamics (IJAT); sciepub AJVD 2/1/6 (efficiency peak 1–2 % slip)' },

  { id:'CVT_RATIO_ERROR', symptom:'Ratio error (commanded ≠ actual)',
    signals:['ratio','ratioCmd'], components:['primary','electronics'],
    severity:'warning', weight:0.4, dtc:'P0730',
    test:f => ramp(f.ratio_err, 0.18, 0.6),
    note:'Sustained gap between commanded and actual variator ratio — primary clamp (EDS1) / ratio-control not achieving target.',
    ref:'push-belt ratio control (IJETCH "Control Concepts of Push-Belt CVT"); model-based pressure control (SCIRP MME 2016)' },

  { id:'CVT_RATIO_HUNTING', symptom:'Hunting ratio (RPM up/down)',
    signals:['ratio'], components:['primary','electronics'],
    severity:'warning', weight:0.3,
    test:f => (f.steady ? ramp(f.ratio_var, 0.0040, 0.025) : 0),
    note:'Variator ratio oscillating at steady cruise — pressure/control instability in the ratio loop (the "rubber-band"/hunting the VT2 is criticised for, when sustained).',
    ref:'push-belt ratio-loop stability (IJETCH); paultan.org VT2 calibration history' },

  { id:'CVT_NO_OVERDRIVE', symptom:'High-RPM cruising / no overdrive',
    signals:['ratio','V_kph'], components:['primary','hydraulic'],
    severity:'monitor', weight:0.25,
    test:f => (f.V_kph > 90 ? ramp(f.ratio, 0.85, 1.3) : 0),
    note:'At highway speed the variator cannot reach overdrive (ratio floored high) — primary pulley travel limited / clamp-balance fault. Wastes fuel and over-revs.',
    ref:'CVT ratio-spread kinematics (push-belt overdrive ~0.4–0.5); firgelliauto CVT' },

  // ── Clutch (Category B) ───────────────────────────────────────────────────
  { id:'CVT_CLUTCH_SLIP', symptom:'Clutch slip',
    signals:['clutchSlip_pct'], components:['clutch'],
    severity:'critical', weight:0.45, dtc:'P0811',
    // Only a fault once the clutch should be LOCKED (≥ lockup speed). Below it the wet
    // clutch slips by design on its way to lockup — gating here keeps this engine
    // consistent with the report engine's clutch_slip (both share LOCKUP_KPH).
    test:f => ((f.engaged && f.V_kph >= LOCKUP_KPH) ? ramp(f.clutchSlip_pct, 10, 40) : 0),
    note:'Engine ≫ primary while the clutch is applied — launch clutch slipping (wear or low apply pressure). Heat ∝ T·Δω, so sustained slip cooks the pack.',
    ref:'wet-clutch slip-energy control (ScienceDirect S0888-3270; SAE launch-clutch strategy)' },

  { id:'CVT_JUDDER', symptom:'Shudder / judder on take-off',
    signals:['N_Prim'], components:['clutch'],
    severity:'warning', weight:0.3,
    // Judder is the car SHUDDERING at quasi-steady low speed (creep / touch-point), not the
    // smooth rpm sweep of a normal launch/decel (which inflated raw nprim_osc). Gate to a
    // quasi-steady speed window (|Δv| < 1.5 km/h) so dynamic accel/decel ramps aren't judder.
    test:f => ((f.engaged && f.V_kph >= 2 && f.V_kph < 25 && f.vRamp < 1.5) ? ramp(f.nprim_osc, 0.04, 0.18) : 0),
    note:'Primary-side speed oscillating during take-off — stick-slip from friction-modifier decay / touch-point drift (this targets LAUNCH judder; lockup shudder is the ~40–80 km/h cousin). The Punch VT2’s top real-world complaint.',
    ref:'TC/clutch shudder mechanism (Roadrunner, NewParts); paultan.org VT2 jerk-in-traffic reports' },

  { id:'CVT_NO_CREEP', symptom:'No creep (does not move in D)',
    signals:['P_clutch','V_kph'], components:['clutch','hydraulic'],
    severity:'warning', weight:0.3,
    test:f => ((f.inGear && f.V_kph < 2 && f.N_MOT > 1500) ? ramp(35 - (f.P_clutch||0)*2, 0, 20) : 0),
    note:'In D/R at idle the vehicle will not creep — launch-clutch apply pressure absent (hydraulic / adaptation). P_clutch is ESTIMATED → confidence capped.',
    ref:'wet launch-clutch apply control (SAE); manual no-creep symptom list' },

  { id:'CVT_LOCKUP_FAULT', symptom:'Sustained slip above lockup speed',
    signals:['lockupEngaged','V_kph','clutchSlip_pct'], components:['clutch'],
    severity:'monitor', weight:0.2,
    test:f => ((f.inGear && f.V_kph > 35 && !f.lockupEngaged) ? ramp(f.clutchSlip_pct, 5, 25) : 0),
    note:'Lockup engages ~16–25 km/h (load-dependent); by 35 km/h the clutch should be locked. Still slipping → lockup solenoid / apply pressure.',
    ref:'TC lockup strategy (US6085136); lockup engage 16–20 km/h field data' },

  // ── Hydraulic supply (Category A) ─────────────────────────────────────────
  { id:'CVT_LOW_LINE_PRESSURE', symptom:'Loss of power / low line pressure',
    signals:['P_sec','engineTorqueNm'], components:['hydraulic','secondary'],
    severity:'warning', weight:0.4, dtc:'P1765',
    test:f => ramp(f.pline_deficit, 4, 22),
    note:'Secondary clamp below the level current torque demands (TREND, scale uncalibrated). Required clamp ∝ torque per F = S_fr·T/(2·μ·R·cos11°); real CVT secondary runs ~4 bar idle → ~62 bar at stall. Deficit ⇒ pump / line-pressure regulator / valve body.',
    ref:'clamp-force formula (PMC8949221); Jatco line/secondary pressure 60–900 psi (Gears Magazine)' },

  { id:'CVT_PRESSURE_OSCILLATION', symptom:'Pressure oscillation',
    signals:['P_line'], components:['hydraulic'],
    severity:'monitor', weight:0.25,
    test:f => ramp(f.pline_var_norm, 0.06, 0.25),
    note:'Line/clamp pressure fluctuating at steady state (TREND, normalized CoV) — regulator / valve-body instability or aerated fluid.',
    ref:'Jatco CVT pressure diagnostics (Gears Magazine); model-based pressure control (SCIRP MME 2016)' },

  // ── Thermal (Category A) ──────────────────────────────────────────────────
  { id:'CVT_OVERHEAT', symptom:'Fluid overheating',
    signals:['T_oil'], components:['thermal'],
    severity:'warning', weight:0.4, dtc:'P0218',
    test:f => ramp(f.T_oil, 118, 135),
    note:'CVT fluid above its normal 60–80 °C band approaching the ~125 °C protection set-point — torque request reduced; cooler / fluid condition. (manual P0218 >120 °C)',
    ref:'Subaru CVT FSM normal 60–80 °C, warn ~125 °C; VT2 manual P0218' },

  { id:'CVT_OVERHEAT_CRIT', symptom:'Critical fluid temperature',
    signals:['T_oil'], components:['thermal'],
    severity:'critical', weight:0.6, dtc:'P1767',
    test:f => ramp(f.T_oil, 128, 145),
    note:'CVT fluid critically hot (past the ~125 °C warning) — limp / speed limiting to protect belt friction + clutch pack. (manual P1767 >130 °C)',
    ref:'Subaru CVT temp warning 125 °C; VT2 manual P1767' },

  { id:'CVT_COLD_START', symptom:'Cold-start abnormality',
    signals:['T_oil','N_MOT'], components:['thermal','clutch'],
    severity:'monitor', weight:0.15,
    test:f => ((f.N_MOT > 400 && f.T_oil < 20) ? 0.6 : 0),
    note:'Fluid below the 20 °C adaptation window — high CVTF viscosity; clutch adaptation blocked until warm, and cold-only data hides thermal faults.',
    ref:'VT2 manual adaptation window 20–60 °C; cold-fluid viscosity effects on shift/clamp' },

  // ── Electronics (Category D) ──────────────────────────────────────────────
  { id:'CVT_EDS_ELECTRICAL', symptom:'Solenoid electrical fault',
    signals:['EDS1_mA','EDS2_mA'], components:['electronics','hydraulic'],
    severity:'warning', weight:0.4, dtc:'P0962',
    // A low reading (open) only counts when the solenoid SHOULD be energised — the clamp
    // actively working (in gear, rolling). At idle/standstill EDS sits ~0 mA BY DESIGN, so
    // that's not an open. A SHORT / over-current (>1100 mA) is a fault in any state.
    test:f => { const expectCurrent = f.inGear && f.V_kph > 10;
      const bad = mA => mA != null && ((expectCurrent && mA < 5) || mA > 1100);
      return Math.max(bad(f.EDS1_mA) ? 1 : 0, bad(f.EDS2_mA) ? 1 : 0); },
    note:'EDS proportional solenoid current outside its 0–~1100 mA working band (open / short / stuck). Linear pressure solenoids are ~5.5 Ω (VT2 ≈ 5.05 Ω), current→pressure — out-of-range ⇒ solenoid or harness.',
    ref:'linear/EDS solenoid spec ~5.5 Ω, 0–>1 A (Transmission-Digest, go4trans); VT2 manual EDS 5.05 Ω' },
];

// ─────────────────────────────────────────────────────────────────────────────
// VEHICLE PROFILE — known-NORMAL VT2 behaviours that must NOT read as faults
// (BYKI transmission_profiles.json `known_behaviors`). Each is a research-backed
// characteristic of the Punch VT2, not a defect; it DISCOUNTS or SUPPRESSES the
// matching rule only while its context holds. Suppressions are reported (not
// silent) so the honesty chain stays auditable.
// ─────────────────────────────────────────────────────────────────────────────
export const CVT_PROFILES = {
  punch_vt2: {
    label: 'Punch Powertrain VT2 (Proton)',
    suppress: [
      // DISCOUNT, not blind: hard accel is also when real belt slip is most likely
      // (peak torque), so we raise the bar (0.3×) rather than suppress — gross slip
      // still survives, the by-design rev-flare does not.
      { id:'rubber_band', appliesTo:['CVT_BELT_SLIP','CVT_RATIO_HUNTING','CVT_RATIO_ERROR'],
        when:f => f.throttlePct > 55 && f.accel, factor:0.3,
        reason:'Rubber-band (by design): under hard throttle the VT2 holds a high ratio while revs climb — ratio flare/variance here is mostly normal CVT behaviour; sensitivity discounted (not zeroed) so real slip still reads.' },
      { id:'cold_calibration', appliesTo:['CVT_RATIO_HUNTING','CVT_JUDDER','CVT_PRESSURE_OSCILLATION'],
        when:f => isNum(f.T_oil) && f.T_oil < 40, factor:0.4,
        reason:'Cold calibration: below ~40 °C the VT2 shifts/clamps firmer and slower on purpose (high CVTF viscosity) — hunting/judder/pressure-osc sensitivity discounted until warm.' },
      { id:'launch_slip', appliesTo:['CVT_CLUTCH_SLIP'],
        when:f => f.V_kph < 8 && f.throttlePct > 30, factor:0.3,
        reason:'Designed launch slip: the wet clutch slips on purpose during take-off — discounted until past the engagement phase.' },
    ],
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// WEAR / DUTY-EXPOSURE layer (P8.3) — HONEST predictive maintenance.
//
// We have NO wear sensor, NO odometer history, NO baseline on this tap — so we do
// NOT fabricate an absolute "wear %" or "remaining km". Instead we integrate the
// OBSERVED damaging duty during the session from live signals into a SESSION-
// RELATIVE duty-exposure index + the current accumulation RATE + a grounded
// predictive trend. Basis = estimated/derived ⇒ confidence capped; the UI states
// the limitation explicitly. This is duty exposure, not a remaining-life gauge.
//
// Physical drivers (research-grounded, same sources as the rules):
//  • belt/sheave abrasion ∝ macro-slip (>2 %) × load   — glazes sheaves [sciepub AJVD]
//  • clutch wear ∝ slip-energy P = T·Δω (engaged) + over-temp   [SAE wet-clutch]
//  • fluid oxidation ∝ Arrhenius ~2× per +10 °C above ~90 °C    [ATF degradation]
//  • hydraulic duty ∝ clamp-pressure deficit under load
// ─────────────────────────────────────────────────────────────────────────────
export const WEAR_DRIVERS = {
  belt:     { basis:'derived',  note:'Macro-slip abrasion — slip beyond the 1–2 % micro-slip band glazes the sheave faces and wears the belt.' },
  secondary:{ basis:'derived',  note:'Sheave-face wear from belt macro-slip under clamp.' },
  clutch:   { basis:'derived',  note:'Slip-energy heat (P = T·Δω) plus over-temperature degrade the friction pack.' },
  thermal:  { basis:'measured', note:'Fluid oxidation — every ~10 °C above 90 °C roughly doubles the degradation rate.' },
  hydraulic:{ basis:'derived',  note:'Pump/valve duty from clamp-pressure deficit under load.' },
};
// Session-relative scale: stress-units that map a component's cumulative duty to
// ~63 % index (1−1/e). Tuned so a few minutes of clear abuse reads HIGH and
// normal driving stays LOW. NOT calibrated to real component life.
const WEAR_SCALE  = { belt:6, secondary:9, clutch:6, thermal:8, hydraulic:10, primary:14, electronics:14 };
const WEAR_LEVELS = [ { level:'severe',min:0.05 }, { level:'high',min:0.02 }, { level:'moderate',min:0.006 }, { level:'low',min:0.0008 } ];
function _wearLevel(rate){ for (const l of WEAR_LEVELS) if (rate >= l.min) return l.level; return 'idle'; }

// ── Feature computer + evaluator ────────────────────────────────────────────
export function makeCvtDiagnostics(opts = {}) {
  const WINDOW = opts.window || 60;          // ~3 s at 20 Hz
  const buf = [];                            // ring of recent samples
  let _t = 0;
  const profile = CVT_PROFILES[opts.profile || 'punch_vt2'] || null;   // false-positive suppression
  // WEAR accumulators (session-cumulative — separate from the rolling window).
  const wearCum = {}, wearRate = {}, wearExpo = {};
  CVT_COMPONENTS.forEach(c => { wearCum[c] = 0; wearRate[c] = 0; wearExpo[c] = 0; });
  let wearTime = 0;

  // Per-component instantaneous damage RATE (stress-units/sec) from live signals.
  function _damageRates(tel) {
    const beltSlip = num(tel.beltSlip_pct), clutchSlip = num(tel.clutchSlip_pct);
    const toil = num(tel.T_oil), tclu = num(tel.T_clutch);
    const tq = num(tel.engineTorqueNm); const load = isNum(tq) ? Math.min(1, Math.abs(tq)/180) : 0;
    const engaged = !!tel.clutchEngaged, psec = num(tel.P_sec);
    // LIVE engine keeps its own conservative clamp proxy (the report engine owns the
    // sensitive, session-13-calibrated requirement). Sharing the *requirement curve*
    // here over-fired on real data — the two engines stay coherent on the geo path and
    // for SC6, but the live panel is deliberately less trigger-happy. See _features.
    const required = isNum(tq) ? Math.max(4, Math.abs(tq)/250 * 28) : 4;
    const deficit  = isNum(psec) ? Math.max(0, required - psec) : 0;
    const r = { belt:0, secondary:0, primary:0, clutch:0, hydraulic:0, thermal:0, electronics:0 };
    if (isNum(beltSlip)) { const ab = Math.max(0, beltSlip - 2) * (0.3 + 0.7*load) * 0.03; r.belt = ab; r.secondary = ab * 0.5; }
    if (engaged && isNum(clutchSlip)) r.clutch = (clutchSlip/100) * (0.2 + 0.8*load) * 0.05;
    if (isNum(tclu)) r.clutch += Math.max(0, tclu - 150) * 0.003;
    if (isNum(toil) && toil > 90) r.thermal = (Math.pow(2, (toil - 90)/10) - 1) * 0.01;
    if (deficit > 3) r.hydraulic = (deficit - 3) * 0.004;
    return r;
  }

  function _push(tel) {
    buf.push({
      ratio: num(tel.ratio), cmd: num(tel.ratioCmd),
      beltSlip: num(tel.beltSlip_pct), clutchSlip: num(tel.clutchSlip_pct),
      nprim: num(tel.N_Prim), pline: num(tel.P_line), psec: num(tel.P_sec),
      toil: num(tel.T_oil), v: num(tel.V_kph), nmot: num(tel.N_MOT),
      thr: num(tel.throttlePct), tq: num(tel.engineTorqueNm),
    });
    if (buf.length > WINDOW) buf.shift();
  }

  function update(tel, dt = 0.05) {
    _t += dt; _push(tel);
    // WEAR — integrate observed damaging duty (estimated, session-relative).
    wearTime += dt;
    const rates = _damageRates(tel);
    for (const c in rates) {
      const rate = rates[c];
      wearCum[c]  += rate * dt;
      if (rate > 1e-6) wearExpo[c] += dt;                              // time in a damaging condition
      wearRate[c] += (rate - wearRate[c]) * Math.min(1, dt * 0.8);     // smoothed current rate
    }
    return _t;
  }

  // Per-component session duty exposure + current rate + forward TREND (no fake RUL).
  function wear() {
    const out = {};
    for (const c of CVT_COMPONENTS) {
      const scale = WEAR_SCALE[c] || 10;
      const dutyIndex = Math.round(100 * (1 - Math.exp(-wearCum[c] / scale)));
      const rate = wearRate[c] || 0;
      const projIdx = Math.round(100 * (1 - Math.exp(-(wearCum[c] + rate * 60) / scale)));   // +1 min at current rate
      out[c] = {
        dutyIndex, rate: +rate.toFixed(4), level: _wearLevel(rate),
        exposureSec: +wearExpo[c].toFixed(1), basis: (WEAR_DRIVERS[c] && WEAR_DRIVERS[c].basis) || 'estimated',
        projPerMin: Math.max(0, projIdx - dutyIndex), note: (WEAR_DRIVERS[c] && WEAR_DRIVERS[c].note) || null,
      };
    }
    out._sessionSec = +wearTime.toFixed(0);
    out._disclaimer = 'Session-relative DUTY exposure (estimated) — not absolute wear or remaining-life. True RUL needs odometer/baseline history (not available on this bus).';
    return out;
  }

  // Build the FEATURE object the rules test against (windowed signatures + live values).
  function _features(tel) {
    const last = buf[buf.length - 1] || {};
    const ratios = buf.map(s => s.ratio).filter(isNum);
    const plines = buf.map(s => s.pline).filter(isNum);
    const nprims = buf.map(s => s.nprim).filter(isNum);
    const vs     = buf.map(s => s.v).filter(isNum);
    const vMean  = mean(vs);
    const thrVar = variance(buf.map(s => s.thr).filter(isNum));
    const ratioMean = mean(ratios);
    // speed trend over the window: newest third vs oldest third (km/h).
    const _vDelta = (vs.length >= 9)
      ? (mean(vs.slice(-Math.ceil(vs.length/3))) - mean(vs.slice(0, Math.ceil(vs.length/3))))
      : 0;
    const accel = _vDelta > 0.5;
    const vRamp = Math.abs(_vDelta);   // |speed change| over the window — flags a dynamic accel/decel ramp
    // clamp demanded by torque — geo-aware on a grade (shared reliable road-load
    // physics via expectedSecClampBar), else the live engine's own conservative engine-
    // torque proxy. (The report engine uses the sensitive throttle-calibrated curve;
    // unifying the no-geo requirement here regressed real-data fire rates — reverted.)
    const _lt = loadTorque(tel);
    const required = _lt ? expectedSecClampBar(_lt.mag) : Math.max(4, (num(tel.engineTorqueNm) / 250) * 28);
    return {
      // live values
      ratio: num(tel.ratio), V_kph: num(tel.V_kph), N_MOT: num(tel.N_MOT),
      N_Prim: num(tel.N_Prim), T_oil: num(tel.T_oil),
      throttlePct: num(tel.throttlePct), accel, vRamp,
      beltSlip_pct: num(tel.beltSlip_pct), clutchSlip_pct: num(tel.clutchSlip_pct),
      P_clutch: num(tel.P_clutch), EDS1_mA: tel.EDS1_mA, EDS2_mA: tel.EDS2_mA,
      inGear: tel.selector === 'D' || tel.selector === 'S' || tel.selector === 'R',
      engaged: !!tel.clutchEngaged, lockupEngaged: !!tel.lockupEngaged,
      // windowed signatures
      ratio_var: ratios.length > 8 ? variance(ratios) : 0,
      // ratioCmd is only ★★★ and is sometimes mis-scaled BELOW the 0.51 physical variator
      // minimum (bad decode — real session-13 reads ~0.11). Reject out-of-span commands so a
      // garbage value can't fake a ratio error (same guard analysis-engine.js's ratio_error uses).
      ratio_err: (isNum(num(tel.ratioCmd)) && num(tel.ratioCmd) >= 0.51 && num(tel.ratioCmd) <= 2.20 && isNum(num(tel.ratio)))
                 ? Math.abs(num(tel.ratioCmd) - num(tel.ratio)) : 0,
      nprim_osc: (nprims.length > 8 && Math.abs(mean(nprims)) > 1) ? Math.sqrt(variance(nprims)) / Math.abs(mean(nprims)) : 0,
      pline_var_norm: (plines.length > 8 && mean(plines) > 1) ? Math.sqrt(variance(plines)) / mean(plines) : 0,
      pline_deficit: isNum(num(tel.P_sec)) ? Math.max(0, required - num(tel.P_sec)) : 0,
      steady: thrVar < 25 && vMean > 8,        // ~steady throttle while moving (for hunting/slip rules)
    };
  }

  function evaluate(tel) {
    const f = _features(tel);
    const gc = gradeClass(tel);                // M5 — terrain class ('unknown' when no geo)
    const risk = {}; CVT_COMPONENTS.forEach(c => risk[c] = 0);
    const findings = [];
    const suppressed = [];                     // would-be findings the profile damped (auditable)
    let covered = 0;

    for (const rule of CVT_RULES) {
      // COVERAGE: every required signal must be present (non-null) on TEL.
      const present = rule.signals.every(s => s in tel && tel[s] != null);
      if (!present) continue;                  // insufficient data → rule cannot fire
      covered++;
      let strength = clamp01(rule.test(f) || 0);

      // PROFILE: discount/suppress known-normal VT2 behaviours (BYKI known_behaviors).
      if (profile && strength > 0.001) {
        for (const sup of profile.suppress) {
          if (!sup.appliesTo.includes(rule.id)) continue;
          let ok; try { ok = sup.when(f); } catch { ok = false; }
          if (!ok) continue;
          const before = strength;
          strength *= sup.factor;
          if (before > 0.05 && strength <= 0.05)   // it WOULD have shown → record why it didn't
            suppressed.push({ ruleId: rule.id, by: sup.id, reason: sup.reason, rawStrength: +before.toFixed(2) });
        }
      }
      // TERRAIN: environmental known-behaviours (uphill no-overdrive, downhill slip,
      // cornering). geo absent → envFactor()=1 → no change (zero-regression).
      if (strength > 0.001) {
        const ef = envFactor(rule.id, gc);
        if (ef.factor < 1) {
          const before = strength;
          strength *= ef.factor;
          if (before > 0.05 && strength <= 0.05 && ef.applied[0])
            suppressed.push({ ruleId: rule.id, by: ef.applied[0].id, reason: ef.applied[0].reason, rawStrength: +before.toFixed(2) });
        }
      }
      if (strength <= 0.001) continue;

      // CONFIDENCE: from strength, then CAPPED by the worst signal basis.
      const worstBasis = rule.signals.reduce((w, s) =>
        (BASIS_RANK[SIGNAL_BASIS[s] || 'estimated'] < BASIS_RANK[w] ? (SIGNAL_BASIS[s] || 'estimated') : w), 'measured');
      const confidence = Math.min(0.55 + 0.45 * strength, BASIS_CONF_CAP[worstBasis]);

      findings.push({ ruleId: rule.id, symptom: rule.symptom, components: rule.components,
        severity: rule.severity, strength: +strength.toFixed(2), confidence: +confidence.toFixed(2),
        basis: worstBasis, note: rule.note, ref: rule.ref || null, dtc: rule.dtc || null });

      // COMPONENT RISK accumulates across rules (BYKI: probability adds, capped).
      for (const comp of rule.components)
        if (comp in risk) risk[comp] = Math.min(0.95, risk[comp] + rule.weight * strength * confidence);
    }

    findings.sort((a, b) => sevRank(b.severity) - sevRank(a.severity) || b.confidence - a.confidence);
    const coverage = CVT_RULES.length ? covered / CVT_RULES.length : 0;
    const worstSeverity = findings.length ? findings[0].severity : 'none';
    return { componentRisk: risk, findings, suppressed, coverage: +coverage.toFixed(2), worstSeverity };
  }

  function reset() {
    buf.length = 0; _t = 0; wearTime = 0;
    CVT_COMPONENTS.forEach(c => { wearCum[c] = 0; wearRate[c] = 0; wearExpo[c] = 0; });
  }
  return { update, evaluate, wear, reset, get rules() { return CVT_RULES; } };
}

// ── tiny stats helpers ──
function num(x){ const n = +x; return Number.isFinite(n) ? n : NaN; }
function isNum(x){ return typeof x === 'number' && Number.isFinite(x); }
function mean(a){ return a.length ? a.reduce((s,x)=>s+x,0)/a.length : 0; }
function variance(a){ if(a.length<2) return 0; const m=mean(a); return a.reduce((s,x)=>s+(x-m)*(x-m),0)/a.length; }
function clamp01(x){ return Math.max(0, Math.min(1, x)); }
function sevRank(s){ return s==='critical'?3 : s==='warning'?2 : s==='monitor'?1 : 0; }
