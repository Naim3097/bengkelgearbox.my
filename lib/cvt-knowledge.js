/**
 * lib/cvt-knowledge.js
 *
 * Phase 9.1 — Grounded CVT failure-mode knowledge base.
 *
 * This is the DATA layer behind every diagnostic finding.  It is deliberately
 * pure data (no logic) so the analysis engine stays small and every claim the
 * report makes can be traced to a single, reviewable source of truth.
 *
 * Each failure mode ties together the four things One X Transmission's
 * diagnosis-first process needs to justify an inspection:
 *   1. what the DRIVER feels        (driverSymptoms)  — relatable, real-world
 *   2. WHY it happens mechanically  (mechanism)       — the physics
 *   3. which PART is suspected      (component/parts) — what to disassemble/replace
 *   4. what to DO next              (oneXAction)      — Stage-2/3 action
 *
 * GROUNDING — every entry is anchored to one or more of:
 *   - Haima M3/M6/S5 CVT Service Manual (D-ASS-224-00-e) — the VT2/VT3 hardware
 *   - Punch Powertrain VT2/VT3 architecture (wet multi-plate launch clutch,
 *     push-belt variator, EDS proportional solenoids, gerotor oil pump)
 *   - Measured Preve session data (session-13 full-envelope drive) for the
 *     pressure/temperature/slip ranges a HEALTHY unit actually exhibits
 *   - Field-typical CVT failure literature (belt slip, clutch judder, thermal
 *     degradation) cross-checked against the above
 *
 * NOTE ON PART NUMBERS: we cite the assembly P/Ns we can verify (483319/05
 * primary, 483059705 secondary) and otherwise name the component by function.
 * We do NOT invent part numbers — an unknown P/N is shown as "—" so the
 * workshop sources it from the parts catalogue, never from a guessed string.
 *
 *   FAILURE_MODES[id] = { ...entry }
 *   DTC_TO_MODE[code] = failureModeId
 *   EVENT_TO_MODE[eventType] = failureModeId
 */

export const FAILURE_MODES = {

  // ── BELT / SECONDARY CLAMP — the defining CVT wear item ───────────────────
  belt_clamp_slip: {
    id: 'belt_clamp_slip',
    title: 'Push-belt slip / insufficient secondary clamp',
    component: 'Push-belt + secondary pulley clamp circuit',
    node3d: 'belt',                       // 3D node to frame in the report figure
    partRefs: [
      { name: 'Steel push-belt assembly', pn: '—', action: 'inspect + measure element wear, replace if scored/elongated' },
      { name: 'Secondary pulley assembly', pn: '483059705', action: 'inspect sheave faces for belt scoring / glazing' },
      { name: 'Secondary pressure regulator (EDS2)', pn: '—', action: 'flow + current test, replace if weak' },
    ],
    severity: 'crit',
    driverSymptoms: [
      'Engine RPM flares up but the car does not accelerate to match ("rubber-band" surge)',
      'Acceleration feels weak or "slipping" under load, especially uphill or overtaking',
      'A burnt-oil smell after hard driving',
      'Metallic glitter in the CVT fluid on the dipstick / drain',
    ],
    mechanism:
      'The push-belt transmits torque only as long as the secondary pulley squeezes it hard enough to prevent micro-slip. If secondary clamp pressure (set by EDS2 and fed by the oil pump) drops below the level the transmitted torque demands, the belt slips between the sheaves. Slip polishes the sheave faces and shaves the belt elements, which raises fluid temperature and contaminates the oil — accelerating further slip. Left unchecked this is the classic terminal CVT failure.',
    realWorldNote:
      'On the Punch VT2/VT3 the TCM runs a belt-protection (VSM) strategy: when it detects slip it raises clamp and can drop to limp. Repeated protection events are an early warning long before the belt fails outright.',
    oneXAction:
      'Stage 2 teardown: pull the secondary, measure belt element thickness and band stack, inspect both sheave faces for scoring/glazing. Bench-test EDS2 flow vs current. Replace belt + any glazed sheave; never re-shim a slipping belt.',
    evidenceSignals: ['beltSlip_pct', 'P_sec', 'P_line', 'N_Prim', 'N_sec', 'EDS2_mA'],
    relatedDTCs: ['P0944', 'P1765', 'P0840', 'P0730'],
  },

  // ── WET LAUNCH CLUTCH (VT2 has no torque converter) ───────────────────────
  clutch_wear_slip: {
    id: 'clutch_wear_slip',
    title: 'Launch-clutch slip / friction wear',
    component: 'Wet multi-plate launch clutch pack',
    node3d: 'fwdClutch',
    partRefs: [
      { name: 'Forward clutch friction pack', pn: '—', action: 'measure plate thickness, inspect for glazing/burn, replace as a set' },
      { name: 'Clutch apply piston + seals', pn: '—', action: 'inspect bore + seal lips, replace seal kit' },
      { name: 'Clutch pressure solenoid (EDS3)', pn: '—', action: 'current/flow test against apply schedule' },
    ],
    severity: 'crit',
    driverSymptoms: [
      'Shudder or judder when moving off from a standstill',
      'Delayed engagement — a pause between selecting D/R and the car moving',
      'Engine revs climb on launch without matching road speed',
      'In severe cases the car barely moves in D or R',
    ],
    mechanism:
      'The VT2/VT3 uses a wet multi-plate clutch (NOT a torque converter) to launch the car. The TCM modulates apply pressure (EDS3) so the clutch slips intentionally for a smooth take-off, then locks. Worn friction material or weak apply pressure means it keeps slipping after it should be locked — engine speed (N_MOT) stays above primary speed (N_Prim). The slip energy becomes heat, which burns the friction faces and the fluid, compounding the wear.',
    realWorldNote:
      'Some clutch slip on launch is NORMAL and healthy — the engine must out-run the input briefly. A finding is only raised when slip persists past launch (at cruise) or runs hot, which is why the engine separates launch-window slip from sustained slip.',
    oneXAction:
      'Stage 1 confirm with a controlled launch + cruise hold while watching N_MOT vs N_Prim. Stage 2: drop the clutch pack, measure friction-plate thickness and check for blue/burnt steels. Replace pack + seals; flush fluid (burnt oil never recovers).',
    evidenceSignals: ['clutchSlip_pct', 'N_MOT', 'N_Prim', 'P_clutch', 'EDS3_mA', 'T_clutch'],
    relatedDTCs: ['P0811', 'P2787', 'P0902', 'P0900'],
  },

  // ── VARIATOR RATIO CONTROL (EDS1 / sensors / TCM) ─────────────────────────
  ratio_control: {
    id: 'ratio_control',
    title: 'Variator ratio-control fault',
    component: 'Primary clamp circuit (EDS1) + speed sensors',
    node3d: 'primaryPulley',
    partRefs: [
      { name: 'Primary pressure regulator (EDS1)', pn: '—', action: 'resistance ~5.5 Ω check + current sweep' },
      { name: 'Primary / secondary speed sensors', pn: '—', action: 'scope signal continuity through a ratio sweep' },
      { name: 'Primary pulley assembly', pn: '483319/05', action: 'inspect movable sheave travel + bearing' },
    ],
    severity: 'crit',
    driverSymptoms: [
      'Engine "hangs" at high RPM and won\'t settle (won\'t upshift into overdrive)',
      'Poor fuel economy on the highway from over-revving',
      'Hesitation or flare when ratio should change smoothly',
      'Sometimes a stored fault with no obvious feel until limp mode',
    ],
    mechanism:
      'Ratio is the balance between primary clamp (EDS1) and secondary clamp (EDS2): to upshift the TCM raises primary pressure to pull the belt outward on the primary. If EDS1 is weak/stuck, a speed sensor drops out, or the movable sheave binds, the commanded ratio and the actual ratio (N_Prim / N_sec) diverge. The TCM detects the error and may lock a safe low ratio (limp).',
    realWorldNote:
      'Legitimate highway overdrive (ratio ≈ 0.5 at 90 km/h) is healthy and must NOT be flagged — the engine only treats a ratio that is too HIGH for the road speed (failure to upshift / over-rev) or a commanded-vs-actual error as a fault.',
    oneXAction:
      'Confirm commanded vs actual ratio error during a steady pull. Bench EDS1 and scope both speed sensors. Inspect movable-sheave travel and the primary bearing before condemning the TCM.',
    evidenceSignals: ['ratio', 'ratioCmd', 'N_Prim', 'N_sec', 'EDS1_mA', 'P_pri'],
    relatedDTCs: ['P0730', 'P0962', 'P0963', 'P0960', 'P0720'],
  },

  // ── FLUID / THERMAL ───────────────────────────────────────────────────────
  oil_thermal: {
    id: 'oil_thermal',
    title: 'CVT fluid over-temperature / degradation',
    component: 'CVT fluid + cooler circuit',
    node3d: 'valveBody',
    partRefs: [
      { name: 'CVT fluid (genuine spec only)', pn: '—', action: 'drain + inspect colour/smell, full flush' },
      { name: 'Fluid cooler + lines', pn: '—', action: 'flow test, back-flush or replace if restricted' },
      { name: 'Oil filter / strainer', pn: '—', action: 'replace, inspect for friction debris' },
    ],
    severity: 'crit',
    driverSymptoms: [
      'Transmission warning light / over-temp message after sustained load or traffic',
      'Power reduction or limp mode when hot, recovering after cool-down',
      'Whine or harshness that worsens as the drive goes on',
    ],
    mechanism:
      'CVT fluid both lubricates and sets the friction coefficient at the belt and clutch. As it overheats it oxidises and loses film strength, which lets the belt and clutch slip — generating still more heat (a runaway loop). The TCM protects the unit above ~120 °C (oil) / ~150 °C (clutch) by cutting torque. Sustained high temperature is both a symptom of slip and a cause of further wear.',
    realWorldNote:
      'Healthy Preve fluid in the session data sat in the 50–90 °C band even under load. Repeated excursions above ~110 °C, or a high baseline, point to a restricted cooler, tired fluid, or an underlying slip source feeding heat in.',
    oneXAction:
      'Inspect fluid colour/smell (dark/burnt = degraded). Flow-test the cooler. Flush with genuine fluid and re-test thermals; if temperature still climbs, hunt the slip source feeding the heat.',
    evidenceSignals: ['T_oil', 'T_clutch', 'beltSlip_pct', 'clutchSlip_pct'],
    relatedDTCs: ['P1767', 'P0218', 'P2787'],
  },

  // ── HYDRAULIC SUPPLY (pump / line pressure) ───────────────────────────────
  hydraulic_supply: {
    id: 'hydraulic_supply',
    title: 'Low hydraulic supply (pump / line pressure)',
    component: 'Oil pump + line-pressure regulator (valve body)',
    node3d: 'pump',
    partRefs: [
      { name: 'CVT oil pump', pn: '—', action: 'measure output pressure vs spec at rpm, replace if worn' },
      { name: 'Valve body / line regulator', pn: '—', action: 'inspect bores for wear, clean/replace' },
      { name: 'Suction filter + seals', pn: '—', action: 'replace filter, check for air ingress' },
    ],
    severity: 'crit',
    driverSymptoms: [
      'Weak drive everywhere (both clamp and clutch starved together)',
      'Symptoms worse when hot (thin fluid leaks past worn clearances)',
      'Slow / soft engagement combined with slip under load',
    ],
    mechanism:
      'A single gerotor pump feeds the whole hydraulic circuit — primary clamp, secondary clamp, clutch apply, lube and cooling. When the pump wears or the line regulator leaks, EVERY pressure sags together, so you see belt slip AND clutch slip AND soft engagement at once. That broad, simultaneous deficit is what distinguishes a supply problem from a single failed solenoid.',
    realWorldNote:
      'On the VT2 there is no oil pressure in the pulleys unless the engine is running (Haima manual §1.1) — the pump is engine-driven. Idle-rpm pressure that cannot build with load is the classic worn-pump signature.',
    oneXAction:
      'Tee a master gauge onto the line tap and compare to spec across idle → stall → load. If line pressure is low everywhere with healthy solenoids, condemn the pump / regulator, not the belt or clutch.',
    evidenceSignals: ['P_line', 'P_sec', 'P_pri', 'P_clutch', 'beltSlip_pct', 'clutchSlip_pct'],
    relatedDTCs: ['P1765', 'P0944', 'P0840'],
  },

  // ── EDS SOLENOID ELECTRICAL ───────────────────────────────────────────────
  eds_electrical: {
    id: 'eds_electrical',
    title: 'EDS solenoid electrical fault',
    component: 'EDS proportional solenoid(s) + harness',
    node3d: 'valveBody',
    partRefs: [
      { name: 'EDS solenoid (per code)', pn: '—', action: 'resistance + current test, replace failed coil' },
      { name: 'Internal harness / connector', pn: '—', action: 'back-probe for short/open, inspect for chafe near case' },
    ],
    severity: 'warn',
    driverSymptoms: [
      'Sudden limp mode (locked ratio / reduced power), often intermittent',
      'Fault may clear and return with temperature or vibration',
      'Drive feels normal between events — purely electrical',
    ],
    mechanism:
      'The EDS solenoids convert a TCM current command into a hydraulic pressure. A shorted or open coil, or a chafed harness, breaks that command — the affected pressure goes uncontrolled (full-on or zero) and the TCM logs the electrical code and protects the unit. Unlike wear faults this is binary and electrical, so it is confirmed with a meter, not a teardown.',
    realWorldNote:
      'Electrical EDS faults are repairable without a full rebuild — confirming the code electrically first can save the customer a teardown they do not need (diagnosis-first).',
    oneXAction:
      'Measure coil resistance against spec (~5–6 Ω) and check the harness for short-to-ground / short-to-power / open. Replace the proven-faulty solenoid or repair the harness; re-scan to confirm the code clears.',
    evidenceSignals: ['EDS1_mA', 'EDS2_mA', 'EDS3_mA', 'P_pri', 'P_sec'],
    relatedDTCs: ['P0962', 'P0963', 'P0960', 'P0840', 'P0641'],
  },

  // ── COMMUNICATION ─────────────────────────────────────────────────────────
  comm_bus: {
    id: 'comm_bus',
    title: 'CAN communication fault',
    component: 'CAN bus wiring / module',
    node3d: null,
    partRefs: [
      { name: 'CAN bus wiring + terminators', pn: '—', action: '60 Ω termination check, inspect wiring near case' },
    ],
    severity: 'crit',
    driverSymptoms: [
      'Multiple warning lights at once',
      'Transmission drops to limp with engine codes present',
      'Intermittent, often correlated with bumps / temperature',
    ],
    mechanism:
      'The TCM needs engine data (load, rpm, throttle) over CAN to schedule pressure and ratio. Lost communication forces a fail-safe. This is a wiring/network fault, not a mechanical transmission fault — chasing it inside the gearbox wastes the customer\'s money.',
    realWorldNote: 'Confirm the network before opening the transmission.',
    oneXAction: 'Check CAN-H/CAN-L 60 Ω termination, scan all modules, inspect bus wiring and grounds near the transmission case.',
    evidenceSignals: ['N_MOT', 'throttlePct'],
    relatedDTCs: ['U0100', 'U0001', 'U0121'],
  },
};

// DTC → failure mode.  Codes the engine sees from the TCM are attributed to the
// mode they most strongly indicate (a mode may own several codes).
export const DTC_TO_MODE = {
  P0944: 'belt_clamp_slip',
  P1765: 'belt_clamp_slip',
  P0840: 'eds_electrical',
  P0730: 'ratio_control',
  P0720: 'ratio_control',
  P0962: 'eds_electrical',
  P0963: 'eds_electrical',
  P0960: 'eds_electrical',
  P0641: 'eds_electrical',
  P0811: 'clutch_wear_slip',
  P0902: 'clutch_wear_slip',
  P0900: 'clutch_wear_slip',
  P2787: 'clutch_wear_slip',
  P1767: 'oil_thermal',
  P0218: 'oil_thermal',
  U0100: 'comm_bus',
  U0001: 'comm_bus',
  U0121: 'comm_bus',
};

// Engine-detected event type → failure mode.
export const EVENT_TO_MODE = {
  belt_slip:            'belt_clamp_slip',
  sec_pressure_deficit: 'belt_clamp_slip',
  clutch_slip:          'clutch_wear_slip',
  clutch_overtemp:      'clutch_wear_slip',
  ratio_error:          'ratio_control',
  oil_overtemp:         'oil_thermal',
  line_pressure_low:    'hydraulic_supply',
};

// Human-readable event-type labels (used in the evidence list).
export const EVENT_LABELS = {
  belt_slip:            'Belt slip excursion',
  sec_pressure_deficit: 'Secondary clamp pressure deficit',
  clutch_slip:          'Sustained launch-clutch slip',
  clutch_overtemp:      'Clutch over-temperature',
  ratio_error:          'Ratio command-vs-actual error',
  oil_overtemp:         'Fluid over-temperature',
  line_pressure_low:    'Line-pressure deficit',
};
