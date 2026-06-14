/**
 * lib/signal-quality.js
 *
 * Phase 10 — Per-signal confidence + freshness metadata.
 *
 * Two honesty signals for every value the HUD shows:
 *   1. CONFIDENCE (1–5 ★) — how much to trust the number, from cvt_datadict.md
 *      §7.1 ratings, adjusted for our derivation/calibration provenance.
 *   2. FRESHNESS — which underlying measured field's arrival keeps this chip
 *      "live", so the scanner can dim a chip whose bus signal has gone stale.
 *
 * SOURCE classes (match analysis-engine SIGNAL_BASIS so the whole tool agrees):
 *   measured  — read off the CAN bus + calibrated (★ from the data dictionary)
 *   derived   — computed from measured anchors (VT2 kinematics)
 *   estimated — modelled; no physical sensor on the Preve (clutch P/T, EDS3)
 */

// Bridge signal_id → the TEL field it freshens.  Used to stamp a per-field
// "last seen" time when a real frame arrives.
export const FIELD_OF = {
  vehicle_speed: 'V_kph', vehicle_speed_lid: 'V_kph',
  wheel_speed_fl: 'V_kph', wheel_speed_fr: 'V_kph', wheel_speed_rl: 'V_kph', wheel_speed_rr: 'V_kph',
  engine_rpm: 'N_MOT', engine_rpm_input: 'N_MOT', engine_rpm_lid: 'N_MOT',
  throttle_pct: 'throttlePct', throttle_or_pedal_tcm: 'throttlePct',
  raw_cvt_ratio: 'ratio',
  p_s1_measured: 'P_pri', p_s2_measured: 'P_sec',
  eds1_primary: 'EDS1_mA', eds2_secondary: 'EDS2_mA', eds3_clutch: 'EDS3_mA',
  clutch_pressure: 'P_clutch',
  cvtf_temp: 'T_oil',
  gear_selector_bitmap: 'selector',
};

// Per-displayed-chip quality.  `valId` = the value <span> id in the chip;
// `field` = TEL field; `fresh` = the TEL field whose arrival keeps it live
// ('bus' = no direct measured field → fall back to overall bus freshness).
export const CHIP_QUALITY = [
  { valId: 't-vkph',  field: 'V_kph',    stars: 5, source: 'measured',  fresh: 'V_kph',  note: 'CAN 0x291 vehicle speed' },
  { valId: 't-rpm',   field: 'N_MOT',    stars: 5, source: 'measured',  fresh: 'N_MOT',  note: 'CAN 0x320 engine rpm' },
  { valId: 't-nprim', field: 'N_Prim',   stars: 4, source: 'derived',   fresh: 'N_MOT',  note: '= engine rpm in gear (VT2 has no TC)' },
  { valId: 't-nsec',  field: 'N_sec',    stars: 4, source: 'derived',   fresh: 'V_kph',  note: '= wheel speed × final drive 5.30' },
  { valId: 't-ratio', field: 'ratio',    stars: 4, source: 'derived',   fresh: 'N_MOT',  note: 'N_Prim / N_sec (raw ratio corroborated)' },
  { valId: 't-bar',   field: 'P_line',   stars: 3, source: 'measured',  fresh: 'P_sec',  note: 'line = max(clamp)+margin · calibrated bar' },
  { valId: 't-ppri',  field: 'P_pri',    stars: 3, source: 'measured',  fresh: 'P_pri',  note: 'primary clamp · KWP LID · ≈×0.716 bar' },
  { valId: 't-psec',  field: 'P_sec',    stars: 3, source: 'measured',  fresh: 'P_sec',  note: 'secondary clamp · KWP LID · ≈×0.716 bar' },
  { valId: 't-pclu',  field: 'P_clutch', stars: 2, source: 'estimated', fresh: 'bus',    note: 'modelled — Preve has no clutch-pressure sensor' },
  { valId: 't-toil',  field: 'T_oil',    stars: 3, source: 'measured',  fresh: 'T_oil',  note: 'CVT fluid temp · KWP 0x21 LID byte 22' },
  { valId: 't-tclu',  field: 'T_clutch', stars: 2, source: 'estimated', fresh: 'bus',    note: 'modelled from oil temp + slip energy' },
];

const SOURCE_LABEL = { measured: 'MEASURED', derived: 'DERIVED', estimated: 'ESTIMATED' };

export function starString(n) {
  const f = Math.max(0, Math.min(5, n | 0));
  return '★'.repeat(f) + '☆'.repeat(5 - f);
}

export function qualityTooltip(q) {
  return `${starString(q.stars)}  ${q.stars}/5 · ${SOURCE_LABEL[q.source] || q.source}\n${q.note}`;
}
