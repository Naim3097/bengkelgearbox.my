/**
 * lib/dtc-explain.js
 *
 * Phase 5.3 — Diagnostic interpretation layer for DTC codes.
 *
 * Maps each Punch VT2-VT3 DTC to a structured human-readable interpretation
 * that a workshop mechanic can act on directly.  Source material: Proton
 * service docs + Punch VT2-VT3 manual cross-references (see cvt_datadict.md).
 *
 * Each entry shape:
 *   {
 *     title:           string  // shorter, panel-friendly
 *     severity:       'info'|'warn'|'crit'
 *     symptom:         string  // what the driver / customer reports
 *     likelyCauses:    string[]
 *     nextTests:       string[]
 *     affectedSignals: string[]   // TEL keys to watch
 *     relatedDTCs:     string[]   // codes that commonly co-occur
 *   }
 *
 * Codes not in this map fall back to whatever DTC_INFO already provides
 * (just title + severity).  Adding a code here makes the side-card view
 * available for it.
 */

export const DTC_EXPLAIN = {

  // ── PRESSURE / VARIATOR ────────────────────────────────────────────────────
  P0944: {
    title: 'Insufficient clamping (VSM)',
    severity: 'crit',
    symptom: 'Belt slip under load. Surging RPM with no acceleration. Possible burnt-oil smell.',
    likelyCauses: [
      'Low secondary clamping pressure (EDS2 weak or oil leak)',
      'Worn or stretched push-belt segments',
      'Failed secondary spring (preload < 1.0 kN)',
      'Oil pump worn — line pressure insufficient',
      'Belt-slip safety strategy (VSM) triggered by transient overload',
    ],
    nextTests: [
      'Read TEL.beltSlip_pct under 50% throttle in D — should stay < 2 %',
      'Compare P_sec commanded vs measured during a brake-stall test',
      'Check oil pump driven-rpm vs N_Prim',
      'Inspect belt with VT2 borescope kit for segment wear',
    ],
    affectedSignals: ['P_sec','P_line','beltSlip_pct','N_Prim','N_sec'],
    relatedDTCs: ['P0730','P1765','P0840'],
  },

  P0730: {
    title: 'Ratio control fault',
    severity: 'crit',
    symptom: 'Wrong gear ratio for engine load. Stuck in low or high. May enter limp mode.',
    likelyCauses: [
      'EDS1 or EDS2 stuck — primary/secondary clamp imbalance',
      'Speed sensor (primary or secondary) intermittent',
      'TCM software fault — adaptation values corrupt',
      'Belt slip preventing target ratio',
    ],
    nextTests: [
      'Verify N_Prim and N_sec at idle, low load, and pull',
      'Check TEL.ratio vs commanded — error > 0.05 = fault',
      'Read EDS1/EDS2 currents during ratio sweep',
    ],
    affectedSignals: ['ratio','N_Prim','N_sec','EDS1_mA','EDS2_mA'],
    relatedDTCs: ['P2765','P0720','P0944'],
  },

  P1765: {
    title: 'Secondary pressure too low',
    severity: 'crit',
    symptom: 'Belt slip risk. TCM may force limp mode (low gear lock).',
    likelyCauses: [
      'EDS2 solenoid weak or stuck — coil failing',
      'Secondary chamber seal leaking',
      'Oil pump output low (worn pump)',
      'Line pressure regulator fault',
    ],
    nextTests: [
      'EDS2 current at full clamp command — should reach ≥ 550 mA',
      'Compare P_sec/P_line ratio',
      'Pressure-leak test on secondary chamber',
    ],
    affectedSignals: ['P_sec','P_line','EDS2_mA','N_Prim'],
    relatedDTCs: ['P0944','P0840'],
  },

  P0840: {
    title: 'Secondary pressure sensor electrical',
    severity: 'warn',
    symptom: 'TCM cannot read secondary pressure — may run open-loop or limp.',
    likelyCauses: [
      'Pressure sensor connector loose / corroded',
      'Sensor signal wire shorted or open',
      'Pressure sensor 5 V supply fault (see P0641)',
      'Sensor itself failed (out-of-range)',
    ],
    nextTests: [
      'Back-probe sensor connector — 5 V, GND, signal',
      'Confirm signal varies with pressure (~0.5 V at 0 bar, 4.5 V at 60 bar)',
      'Check for P0641 co-occurrence',
    ],
    affectedSignals: ['P_sec'],
    relatedDTCs: ['P0641','P1765'],
  },

  // ── EDS COIL FAULTS ────────────────────────────────────────────────────────
  P0962: {
    title: 'EDS1 primary — short to ground',
    severity: 'warn',
    symptom: 'Loss of primary clamp control. Ratio may stuck low.',
    likelyCauses: [
      'EDS1 coil shorted internally',
      'Wiring harness shorted to chassis',
      'Connector pin damage',
    ],
    nextTests: [
      'Measure EDS1 resistance — expect ~5.5 Ω (per Punch VT2 spec)',
      'Disconnect harness, check for short to GND on each pin',
      'Inspect wiring for chafing near transmission case',
    ],
    affectedSignals: ['EDS1_mA','P_pri','ratio'],
    relatedDTCs: ['P0963','P0960'],
  },

  P0963: {
    title: 'EDS1 primary — short to battery',
    severity: 'warn',
    symptom: 'Primary clamp stuck full-on. Belt may slip on secondary.',
    likelyCauses: [
      'Coil winding shorted to power',
      'Harness shorted to + 12 V',
      'TCM driver stage fault',
    ],
    nextTests: [
      'Measure EDS1 with key off — should be open-circuit to +12 V',
      'TCM-side current measurement during low-clamp command',
    ],
    affectedSignals: ['EDS1_mA','P_pri'],
    relatedDTCs: ['P0962','P0960'],
  },

  P0960: {
    title: 'EDS1 primary — open circuit',
    severity: 'warn',
    symptom: 'No primary clamp force. Variator cannot upshift.',
    likelyCauses: [
      'EDS1 coil broken internally',
      'Harness wire severed',
      'Connector unplugged',
    ],
    nextTests: [
      'EDS1 resistance — open = infinite Ω = confirmed open',
      'Continuity check both wires from TCM to solenoid',
    ],
    affectedSignals: ['EDS1_mA','P_pri'],
    relatedDTCs: ['P0962','P0963'],
  },

  P0811: {
    title: 'Clutch slipping (D/R)',
    severity: 'crit',
    symptom: 'Vehicle moves slowly or not at all in D/R. Engine revs without proportional speed gain.',
    likelyCauses: [
      'EDS3 weak — insufficient clutch apply pressure',
      'Worn friction plates (high mileage)',
      'Burnt clutch oil (T_clutch > 150 °C history)',
      'Clutch piston seal failure',
    ],
    nextTests: [
      'TEL.clutchSlip_pct during launch — should < 5 %',
      'Compare N_MOT vs N_Prim during full throttle from stop',
      'Inspect oil for burnt smell / debris',
    ],
    affectedSignals: ['P_clutch','EDS3_mA','clutchSlip_pct','T_clutch'],
    relatedDTCs: ['P2787','P0902','P0900'],
  },

  P2787: {
    title: 'Clutch temperature too high',
    severity: 'crit',
    symptom: 'Slip-protect strategy engaged. Reduced torque, possible limp mode.',
    likelyCauses: [
      'Persistent clutch slip (see P0811)',
      'Hill-hold abuse / launch-control abuse',
      'Cooler restricted',
      'Sensor reading high incorrectly',
    ],
    nextTests: [
      'Verify T_clutch with infrared at pan',
      'Inspect cooler flow under operating conditions',
      'Read clutch slip events history',
    ],
    affectedSignals: ['T_clutch','clutchSlip_pct','T_oil'],
    relatedDTCs: ['P0811','P1767'],
  },

  P1767: {
    title: 'Critical oil temperature',
    severity: 'crit',
    symptom: 'TCM enters protect mode. Drive ratio locked, clutch slip protected.',
    likelyCauses: [
      'Cooler blocked',
      'Continuous high-load operation',
      'Worn pump — insufficient flow to cooler',
      'Sensor reading high',
    ],
    nextTests: [
      'Inspect oil temperature with scan-tool',
      'Check cooler inlet/outlet temperatures with infrared',
      'Verify cooler line for restriction',
    ],
    affectedSignals: ['T_oil','T_clutch','N_Prim'],
    relatedDTCs: ['P0218','P2787'],
  },

  // ── COMM ───────────────────────────────────────────────────────────────────
  U0100: {
    title: 'CAN: lost comm with ECM',
    severity: 'crit',
    symptom: 'TCM and engine ECU not exchanging data. Limp mode + transmission codes.',
    likelyCauses: [
      'CAN bus wiring fault',
      'ECM unpowered or failed',
      'Termination resistor failure',
    ],
    nextTests: [
      'CAN bus 60 Ω termination check (between CAN-H and CAN-L)',
      'Scan all modules on bus',
      'Inspect bus wiring near transmission',
    ],
    affectedSignals: ['N_MOT','throttlePct','engineTorqueNm'],
    relatedDTCs: ['U0001','U0121'],
  },
};
