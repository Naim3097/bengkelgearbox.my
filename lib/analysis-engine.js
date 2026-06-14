/**
 * lib/analysis-engine.js
 *
 * Phase 9.2 — Diagnostic analysis engine.
 *
 * The brain behind both the live scanner read-out and the printed report.  It
 * is a STATEFUL session accumulator: `update()` is called every history tick
 * (~20 Hz) with the live TEL + the current operating point, and it
 *   1. accumulates whole-session statistics (independent of the 5-min ring
 *      buffer, so nothing is lost on a long test drive),
 *   2. detects anomaly EVENTS with hysteresis — using the SAME envelopes the
 *      live HUD uses, so the report can never contradict what the screen showed,
 *   3. records every DTC the TCM reported and when,
 * and on demand `buildReport()` synthesises ranked, evidence-backed FINDINGS by
 * correlating those events + DTCs against the grounded knowledge base.
 *
 * DESIGN PRINCIPLES (per project mandate — no mock, no guessing):
 *   - Deterministic: same session in → same findings out.
 *   - Grounded: every finding cites the real signal evidence that produced it.
 *   - Honest about confidence: evidence drawn from ESTIMATED signals (clutch
 *     pressure/temp, EDS3) is tagged and can never reach "High" confidence on
 *     its own — only a measured signal or a stored DTC can.
 *   - Coverage-aware: a clean result is reported as "healthy WITHIN WHAT WAS
 *     TESTED", with an explicit list of what the drive did and did not exercise.
 *     You cannot clear a fault you never loaded.
 */

import { resolveEnvelope, envelopeStatus } from './envelopes.js';
import { OP_BUCKETS } from './operating-point.js';
import {
  FAILURE_MODES, DTC_TO_MODE, EVENT_TO_MODE, EVENT_LABELS,
} from './cvt-knowledge.js';
// Shared diagnosis core (cvt-context): secClampReqBar / lineReqBar are the ONE
// clamp/line-pressure requirement both engines (and the sim) use. Geo-aware on a
// grade; otherwise engine-torque on the same calibrated curve, which reproduces the
// old throttle formula when only throttle is known → real-session behaviour preserved.
import { secClampReqBar, lineReqBar, LOCKUP_KPH, gradeClass, envFactor } from './cvt-context.js';

// Curated signals we keep running stats on (min/max/mean + time-above where
// relevant).  Mirrors the history surface but focused on the diagnostic ones.
const STAT_SIGNALS = [
  'V_kph', 'N_MOT', 'N_Prim', 'N_sec', 'ratio',
  'P_line', 'P_pri', 'P_sec', 'P_clutch',
  'T_oil', 'T_clutch', 'EDS1_mA', 'EDS2_mA', 'EDS3_mA',
  'beltSlip_pct', 'clutchSlip_pct', 'throttlePct', 'engineTorqueNm', 'V_batt',
  'grade_pct', 'road_load_Nm',   // terrain (null when no geo → skipped by the finite guard)
];

// Which TEL signals are MEASURED/CALIBRATED vs DERIVED vs ESTIMATED.  Drives
// the honesty cap on finding confidence.
const SIGNAL_BASIS = {
  // calibrated measurements off the bus
  V_kph: 'measured', N_MOT: 'measured', throttlePct: 'measured',
  T_oil: 'measured', V_batt: 'measured',
  P_line: 'measured', P_pri: 'measured', P_sec: 'measured',
  EDS1_mA: 'measured', EDS2_mA: 'measured',
  // derived from measured anchors
  N_Prim: 'derived', N_sec: 'derived', ratio: 'derived', ratioCmd: 'measured',
  beltSlip_pct: 'derived', clutchSlip_pct: 'derived',
  // modelled estimates (no physical sensor on the Preve)
  P_clutch: 'estimated', T_clutch: 'estimated', EDS3_mA: 'estimated',
  engineTorqueNm: 'derived',
};

// Anomaly detectors.  Each returns whether the condition is currently TRUE for
// this sample, plus the value to track as the event "peak".  We reuse the live
// envelope so the engine and the HUD are one source of truth.
//   basis: confidence ceiling source for events of this type.
const DETECTORS = [
  {
    type: 'belt_slip', basis: 'derived', minDurMs: 300, peakSig: 'beltSlip_pct',
    test: (T, op) => envelopeStatus(T.beltSlip_pct || 0, resolveEnvelope('beltSlip_pct', op.bucket, T)) === 'red',
  },
  {
    // A secondary-clamp deficit is only a fault relative to the torque being
    // transmitted — a gentle launch correctly runs low pressure.  So compare
    // P_sec against a TORQUE-SCALED clamp requirement (∝ throttle), NOT a fixed
    // bucket band.  The schedule is anchored to the measured session-13 drive:
    // light load ≈ 15 bar, WOT ≈ 51–57 bar → req ≈ 8 + throttle×0.44 bar.
    // Fires only under real demand (>30 % throttle) and >30 % below requirement.
    type: 'sec_pressure_deficit', basis: 'measured', minDurMs: 500, peakSig: 'P_sec',
    test: (T) => {
      const inGear = T.selector === 'D' || T.selector === 'S' || T.selector === 'R';
      const thr = T.throttlePct || 0;
      if (!inGear || thr < 30) return false;
      // ONE shared clamp-requirement (P1 consolidation): geo→road-load torque, else
      // engine torque (throttle-estimated if torque is missing) on the SAME calibrated
      // curve cvt-diagnostics + the sim now use. Old throttle number is reproduced when
      // only throttle is known, so real-session behaviour is essentially unchanged.
      const reqClamp = secClampReqBar(T);
      return (T.P_sec || 0) < reqClamp * 0.70;          // slip risk: clamp can't hold the torque
    },
  },
  {
    type: 'clutch_slip', basis: 'estimated', minDurMs: 500, peakSig: 'clutchSlip_pct',
    test: (T, op) => {
      const inGear = T.selector === 'D' || T.selector === 'S' || T.selector === 'R';
      // Exclude the launch-to-lockup ramp: below lockup speed the wet clutch slips by
      // design (the op-bucket flips to cruise-mid at 15 km/h, but the clutch isn't
      // locked until ~25). Judging slip there false-fires on every moderate launch.
      if (!inGear || (T.V_kph || 0) < LOCKUP_KPH) return false;
      return envelopeStatus(T.clutchSlip_pct || 0, resolveEnvelope('clutchSlip_pct', op.bucket, T)) === 'red';
    },
  },
  {
    type: 'clutch_overtemp', basis: 'estimated', minDurMs: 1000, peakSig: 'T_clutch',
    test: (T) => (T.T_clutch || 0) > 130,
  },
  {
    type: 'oil_overtemp', basis: 'measured', minDurMs: 1000, peakSig: 'T_oil',
    test: (T) => (T.T_oil || 0) > 110,
  },
  {
    type: 'ratio_error', basis: 'derived', minDurMs: 800, peakSig: 'ratio',
    test: (T) => {
      if ((T.N_sec || 0) < 200) return false;           // need to be rolling
      const cmd = T.ratioCmd;
      // The commanded-ratio signal is only ★★★ and is sometimes mis-scaled
      // (observed reading 0.27 — below the 0.51 physical variator minimum).
      // Reject any command outside the physical span [0.51, 2.20]: it cannot be
      // a real TCM command, so it's a bad decode, not a ratio-control fault.
      if (!(cmd >= 0.51 && cmd <= 2.20)) return false;
      return Math.abs((T.ratio || 0) - cmd) > 0.20;     // genuine divergence
    },
  },
  {
    // Pump/supply signature = line pressure can't meet the torque-scaled demand
    // AND clutch apply is starved at the same time (a single failed solenoid
    // would not starve everything).  Torque-scaled like the secondary, gated to
    // real load (>40 % throttle) to stay clear of normal light-load operation.
    type: 'line_pressure_low', basis: 'measured', minDurMs: 600, peakSig: 'P_line',
    test: (T) => {
      const inGear = T.selector === 'D' || T.selector === 'S' || T.selector === 'R';
      const thr = T.throttlePct || 0;
      if (!inGear || thr < 40) return false;
      const reqLine = lineReqBar(T);                     // ONE shared line-pressure requirement (P1)
      return (T.P_line || 0) < reqLine * 0.60 && (T.P_clutch || 0) < 8;
    },
  },
];

const SEVERITY_RANK = { info: 0, warn: 1, crit: 2 };

function freshSession(tMs = 0) {
  const stats = {};
  for (const s of STAT_SIGNALS) stats[s] = { min: Infinity, max: -Infinity, sum: 0, n: 0 };
  return {
    startT: tMs, lastT: tMs, ticks: 0,
    stats,
    dwellBucket: {},          // bucket → ms
    dwellGear: {},            // gear → ms
    dwellGrade: { climb: 0, descend: 0, level: 0 },   // terrain time (ms) — road-condition coverage
    corneringMs: 0,           // time cornering (ms)
    geoMs: 0,                 // time with live terrain context (ms)
    distanceKm: 0,
    idleMs: 0,
    events: [],               // committed anomaly events
    _det: DETECTORS.map(() => ({ active: false, startT: 0, accumMs: 0, creditMs: 0, peak: -Infinity, peakOp: null, committed: false })),
    dtcSeen: {},              // code → { firstT, lastT, count }
  };
}

export function makeAnalysisEngine() {
  let S = freshSession();

  function reset(tMs = 0) { S = freshSession(tMs); }

  function update(TEL, op, dtSec, tMs) {
    if (!TEL || !op) return;
    const dtMs = Math.max(0, Math.min(500, (dtSec || 0) * 1000));   // clamp wild dt
    S.lastT = tMs; S.ticks++;

    // running stats
    for (const s of STAT_SIGNALS) {
      const v = TEL[s];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const a = S.stats[s];
      if (v < a.min) a.min = v;
      if (v > a.max) a.max = v;
      a.sum += v; a.n++;
    }

    // dwell + distance
    S.dwellBucket[op.bucket] = (S.dwellBucket[op.bucket] || 0) + dtMs;
    if (TEL.selector) S.dwellGear[TEL.selector] = (S.dwellGear[TEL.selector] || 0) + dtMs;
    S.distanceKm += (Math.max(0, TEL.V_kph || 0) / 3600) * (dtMs / 1000);
    if ((TEL.V_kph || 0) < 1 && (TEL.selector === 'P' || TEL.selector === 'N')) S.idleMs += dtMs;

    // Terrain context (shared core) — SAME ENV_BEHAVIORS the live engine applies, so both
    // engines treat terrain identically (not per-engine). 'unknown' when no geo → factor 1
    // → byte-identical to pre-terrain. A discount (e.g. downhill belt-slip ×0.4, cornering
    // ratio-error ×0.4) slows the COMMIT credit, so a terrain-explained blip needs to
    // persist proportionally longer to count — a real sustained fault still commits.
    const _gc = gradeClass(TEL);
    const _terrainOn = _gc.state !== 'unknown';

    // Terrain DWELL (road-condition coverage for the report). geo-less → nothing accrues.
    if (_terrainOn) {
      S.geoMs += dtMs;
      S.dwellGrade[_gc.state] = (S.dwellGrade[_gc.state] || 0) + dtMs;
      if (_gc.cornering) S.corneringMs += dtMs;
    }

    // event detection (hysteresis + min-duration commit)
    for (let i = 0; i < DETECTORS.length; i++) {
      const D = DETECTORS[i], st = S._det[i];
      let on = false;
      try { on = !!D.test(TEL, op); } catch { on = false; }
      const pv = TEL[D.peakSig];
      if (on) {
        if (!st.active) { st.active = true; st.startT = tMs; st.accumMs = 0; st.creditMs = 0; st.peak = -Infinity; st.peakOp = op.bucket; st.committed = false; }
        st.accumMs += dtMs;                                  // honest wall-time (→ event durationMs)
        const tf = _terrainOn ? envFactor(D.type, _gc).factor : 1;   // 1 = no terrain change
        st.creditMs += dtMs * tf;                            // terrain-discounted commit credit
        if (typeof pv === 'number' && Number.isFinite(pv) && pv > st.peak) st.peak = pv;
        if (!st.committed && st.creditMs >= D.minDurMs) {
          st.committed = true;
          st._ev = { type: D.type, basis: D.basis, tStart: st.startT, tEnd: tMs, peak: st.peak, opBucket: st.peakOp, durationMs: st.accumMs, peakSig: D.peakSig,
            // terrain context AT COMMIT — so the report can say "on a descent / while cornering"
            grade: _terrainOn ? +(+_gc.grade).toFixed(1) : null, gradeState: _terrainOn ? _gc.state : null, cornering: _terrainOn ? !!_gc.cornering : false };
          S.events.push(st._ev);
        } else if (st.committed && st._ev) {
          st._ev.tEnd = tMs; st._ev.peak = st.peak; st._ev.durationMs = st.accumMs;
        }
      } else {
        st.active = false; st._ev = null;
      }
    }
  }

  // Call whenever the live DTC set changes (codes from the TCM via the bridge).
  function observeDTCs(codes, tMs) {
    if (!Array.isArray(codes)) return;
    for (const c of codes) {
      if (!c) continue;
      const rec = S.dtcSeen[c] || (S.dtcSeen[c] = { firstT: tMs, lastT: tMs, count: 0 });
      rec.lastT = tMs; rec.count++;
    }
  }

  function mean(s) { return s.n ? s.sum / s.n : 0; }

  // Lightweight read-out for the live scanner panel (cheap, called each frame).
  function getLiveSummary() {
    const active = S._det.filter(st => st.committed).length;
    let worst = 'green';
    // any committed event of crit mode → red, else amber if any active
    const anyCommitted = S.events.length > 0;
    if (anyCommitted) worst = 'red';
    else if (S._det.some(st => st.active)) worst = 'amber';
    const dtcN = Object.keys(S.dtcSeen).length;
    return { activeAnomalies: active, eventCount: S.events.length, dtcCount: dtcN, worst, durationMs: S.lastT - S.startT };
  }

  // ── Full report synthesis ────────────────────────────────────────────────
  function buildReport(meta = {}) {
    const durationMs = Math.max(0, S.lastT - S.startT);

    // 1. group evidence by failure mode
    const modeAgg = {};   // modeId → { events:[], dtcs:[], estimatedOnly:bool }
    const ensure = (id) => modeAgg[id] || (modeAgg[id] = { events: [], dtcs: [] });

    for (const ev of S.events) {
      const modeId = EVENT_TO_MODE[ev.type];
      if (!modeId) continue;
      ensure(modeId).events.push(ev);
    }
    for (const [code, rec] of Object.entries(S.dtcSeen)) {
      const modeId = DTC_TO_MODE[code] || null;
      ensure(modeId || 'unmapped_' + code).dtcs.push({ code, ...rec });
    }

    // 2. build a finding per mode
    const findings = [];
    for (const [modeId, agg] of Object.entries(modeAgg)) {
      const km = FAILURE_MODES[modeId];
      const hasDTC = agg.dtcs.length > 0;
      const evtCount = agg.events.length;
      const totalDurMs = agg.events.reduce((s, e) => s + (e.durationMs || 0), 0);
      const estimatedOnly = !hasDTC && evtCount > 0 && agg.events.every(e => e.basis === 'estimated');

      // confidence: a stored DTC is hard evidence; engine events add weight.
      // Several corroborating measured/derived excursions of the SAME failure
      // mode can reach High on their own (e.g. belt slip + secondary deficit).
      let conf = 0;
      if (hasDTC) conf += 0.6 + Math.min(0.2, 0.05 * agg.dtcs.length);
      if (evtCount > 0) {
        const evtWeight = Math.min(0.7, 0.20 * evtCount + Math.min(0.3, totalDurMs / 15000));
        conf += evtWeight;
      }
      conf = Math.min(1, conf);
      // honesty cap: evidence drawn ONLY from estimated signals can't claim "High"
      if (estimatedOnly) conf = Math.min(conf, 0.49);

      const confidence = conf >= 0.7 ? 'High' : conf >= 0.42 ? 'Medium' : 'Low';

      // severity from knowledge, downgraded if confidence is low
      let severity = km ? km.severity : 'warn';
      if (confidence === 'Low' && severity === 'crit') severity = 'warn';

      // terrain context across this mode's evidence (for the report's road-condition note)
      const _tEv = agg.events.filter(e => e.gradeState);
      const terrain = _tEv.length
        ? { geo: true, grades: [...new Set(_tEv.map(e => e.gradeState))], cornering: _tEv.some(e => e.cornering) }
        : { geo: false };

      findings.push({
        terrain,
        modeId,
        known: !!km,
        title: km ? km.title : ('Unmapped code ' + agg.dtcs.map(d => d.code).join(', ')),
        component: km ? km.component : 'Unknown — see code definition',
        node3d: km ? km.node3d : null,
        severity, confidence, confidenceScore: +conf.toFixed(2),
        estimatedOnly,
        driverSymptoms: km ? km.driverSymptoms : [],
        mechanism: km ? km.mechanism : '',
        realWorldNote: km ? km.realWorldNote : '',
        oneXAction: km ? km.oneXAction : 'Look up the code definition and confirm before any repair.',
        partRefs: km ? km.partRefs : [],
        dtcs: agg.dtcs,
        events: agg.events.map(e => ({
          type: e.type, label: EVENT_LABELS[e.type] || e.type, basis: e.basis,
          peak: +(+e.peak).toFixed(2), peakSig: e.peakSig,
          durationMs: Math.round(e.durationMs), opBucket: e.opBucket,
          tStart: e.tStart, tEnd: e.tEnd,
          grade: e.grade ?? null, gradeState: e.gradeState ?? null, cornering: !!e.cornering,
        })),
      });
    }

    // rank: severity first, then confidence
    findings.sort((a, b) =>
      (SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity]) ||
      (b.confidenceScore - a.confidenceScore));

    // 3. coverage — what the drive actually exercised (honesty about the test)
    const dwellS = (k) => Math.round((S.dwellBucket[k] || 0) / 1000);
    const coverage = {
      buckets: Object.fromEntries(Object.entries(S.dwellBucket).map(([k, v]) => [k, Math.round(v / 1000)])),
      gears: Object.fromEntries(Object.entries(S.dwellGear).map(([k, v]) => [k, Math.round(v / 1000)])),
      maxThrottle: Math.round(S.stats.throttlePct.max > -Infinity ? S.stats.throttlePct.max : 0),
      maxV_kph: Math.round(S.stats.V_kph.max > -Infinity ? S.stats.V_kph.max : 0),
      didLoadTest: (dwellS(OP_BUCKETS.WOT) >= 1) || (dwellS(OP_BUCKETS.LAUNCH) >= 1),
      didReverse: (S.dwellGear.R || 0) > 1000,
      didHighway: (S.stats.V_kph.max || 0) >= 80,
      thermalMax: Math.round(S.stats.T_oil.max > -Infinity ? S.stats.T_oil.max : 0),
      // road-condition coverage (terrain) — what grades/corners the drive actually saw
      geo: (S.geoMs || 0) > 1000,
      maxGrade: S.stats.grade_pct.max > -Infinity ? +S.stats.grade_pct.max.toFixed(1) : null,
      minGrade: S.stats.grade_pct.min <  Infinity ? +S.stats.grade_pct.min.toFixed(1) : null,
      didClimb:   (S.dwellGrade.climb   || 0) > 1000,
      didDescend: (S.dwellGrade.descend || 0) > 1000,
      didCorner:  (S.corneringMs        || 0) > 500,
    };
    const caveats = [];
    if (!coverage.geo) caveats.push('No road‑grade / GPS data was available for this capture — engine load was inferred from throttle, not real road‑load, and slip/no‑overdrive findings were not terrain‑adjusted. Connect the tablet GPS on the next drive for grade‑accurate clamp baselines.');
    if (!coverage.didLoadTest) caveats.push('No wide-open-throttle pull or hard launch was captured — belt clamp and clutch apply were not exercised at peak torque. A clean result here does not certify behaviour under full load.');
    if (!coverage.didReverse) caveats.push('Reverse was not engaged during the capture — reverse-band / clutch behaviour was not assessed.');
    if (!coverage.didHighway) caveats.push('No highway speed reached — full overdrive ratio and sustained thermal load were not exercised.');
    if (coverage.thermalMax < 60) caveats.push('Fluid did not reach normal operating temperature — cold-only data; thermal-related faults can hide until hot.');

    // 4. verdict + health score
    let verdict = 'HEALTHY', verdictNote = 'No fault evidence within the operating points tested.';
    // A stored DTC, or a critical finding backed by solid (non-estimated)
    // evidence, escalates to NEEDS ATTENTION.  Estimated-only or low-confidence
    // findings stay at MONITOR (worth a re-test, not yet a hard fault).
    const hasAnyDTC = Object.keys(S.dtcSeen).length > 0;
    const hardCrit = findings.some(f => f.severity === 'crit' && f.confidenceScore >= 0.5 && !f.estimatedOnly);
    const hasMedium = findings.some(f => f.confidence !== 'Low');
    if (hardCrit || hasAnyDTC) { verdict = 'NEEDS ATTENTION'; verdictNote = 'Fault evidence found — see findings below.'; }
    else if (hasMedium) { verdict = 'MONITOR'; verdictNote = 'Early-warning evidence found; not yet a hard fault. Re-test recommended.'; }

    let score = 100;
    for (const f of findings) {
      const sevW = f.severity === 'crit' ? 28 : f.severity === 'warn' ? 14 : 6;
      score -= Math.round(sevW * f.confidenceScore);
    }
    score = Math.max(5, Math.min(100, score));

    // 5. session summary stats (means + ranges of the headline signals)
    const summary = {
      durationMs, durationStr: fmtDur(durationMs),
      distanceKm: +S.distanceKm.toFixed(2),
      idleStr: fmtDur(S.idleMs),
      maxV_kph: coverage.maxV_kph,
      maxRpm: Math.round(S.stats.N_MOT.max > -Infinity ? S.stats.N_MOT.max : 0),
      ratioRange: rangeStr(S.stats.ratio, 2),
      lineRange: rangeStr(S.stats.P_line, 0, ' bar'),
      secRange: rangeStr(S.stats.P_sec, 0, ' bar'),
      oilRange: rangeStr(S.stats.T_oil, 0, ' °C'),
      eds1Mean: Math.round(mean(S.stats.EDS1_mA)),
      eds2Mean: Math.round(mean(S.stats.EDS2_mA)),
      beltSlipMax: +(S.stats.beltSlip_pct.max > -Infinity ? S.stats.beltSlip_pct.max : 0).toFixed(1),
      clutchSlipMax: +(S.stats.clutchSlip_pct.max > -Infinity ? S.stats.clutchSlip_pct.max : 0).toFixed(1),
      // terrain (only meaningful when geo was active; null-safe ranges otherwise)
      geo: (S.geoMs || 0) > 1000,
      gradeRange: (S.geoMs || 0) > 1000 ? rangeStr(S.stats.grade_pct, 1, ' %') : '—',
      roadLoadRange: (S.geoMs || 0) > 1000 ? rangeStr(S.stats.road_load_Nm, 0, ' Nm') : '—',
    };

    return {
      meta: { generatedAtMs: meta.nowMs || S.lastT, ...meta },
      verdict, verdictNote, healthScore: score,
      summary, coverage, caveats,
      findings,
      dtcCount: Object.keys(S.dtcSeen).length,
      eventCount: S.events.length,
    };
  }

  return { reset, update, observeDTCs, getLiveSummary, buildReport, get session() { return S; } };
}

// ── helpers ──────────────────────────────────────────────────────────────────
function fmtDur(ms) {
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60), r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}
function rangeStr(a, dp = 0, unit = '') {
  if (!a || a.n === 0 || a.min === Infinity) return '—';
  return `${a.min.toFixed(dp)}–${a.max.toFixed(dp)}${unit}`;
}
