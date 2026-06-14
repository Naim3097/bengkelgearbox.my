/**
 * lib/road-load.js — SHARED road-load physics (Terrain-Aware Diagnosis).
 *
 * The ONE place the road-load model lives. Pure functions — no DOM, no Node/
 * browser APIs — so BOTH the bridge (server-side live computation, M2) and the
 * client `cvt-context.js` (M4) import the SAME physics. No duplication.
 *
 * Road-load (longitudinal) — the tractive effort the powertrain must deliver:
 *   F_road = m·g·Crr·cosθ + ½·ρ·Cd·A·v² + m·g·sinθ + m·a
 *            └ rolling ──┘   └ aero ───┘   └ GRADE ─┘  └ inertia ┘
 *   T_wheel = F_road · r_tyre                      (torque at the wheels)
 *   T_input = T_wheel / (i_total · η)              (torque crossing the variator → sets clamp)
 *
 * θ (grade) is what throttle can't capture — it comes from GPS/elevation.
 */

// Proton Prevé CFE CVT — CONFIRMED vehicle data (user-supplied measured spec).
// Every value is a named input, never hard-coded inside a rule.
export const VEH_DEFAULTS = {
  mass_kg:  1450,    // TEST mass = kerb 1366 + driver + fuel (the mass actually moved)
  CdA:      0.733,   // drag area = Cd 0.32 × frontal area 2.29 m²
  Crr:      0.010,   // rolling-resistance coefficient
  rTyre_m:  0.303,   // 205/55R16 loaded rolling radius (circumference 1.904 m)
  iFinal:   5.182,   // final-drive ratio (unit spec)
  driveEff: 0.90,    // driveline efficiency
  rho:      1.225,   // air density at sea level (kg/m³)
  g:        9.81,
  kerb_kg:  1366,    // reference: kerb mass
};

/** Great-circle horizontal distance between two lat/lng points, in metres. */
export function haversine_m(lat1, lon1, lat2, lon2) {
  const R = 6371000, toRad = Math.PI / 180;
  const dLat = (lat2 - lat1) * toRad, dLon = (lon2 - lon1) * toRad;
  const s = Math.sin(dLat / 2) ** 2
          + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * Road-load forces + torques for an instantaneous condition.
 *   gradeFrac : grade as rise/run fraction (+up, −down)
 *   v         : speed m/s ; a : long. accel m/s²
 * Returns force (N), wheel torque (Nm), and the term breakdown (for honesty/debug).
 */
export function roadLoad({ gradeFrac = 0, v = 0, a = 0, veh = VEH_DEFAULTS }) {
  const m = veh.mass_kg, g = veh.g;
  const theta = Math.atan(gradeFrac || 0);
  const F_roll    = m * g * veh.Crr * Math.cos(theta);
  const F_aero    = 0.5 * veh.rho * veh.CdA * v * v;
  const F_grade   = m * g * Math.sin(theta);
  const F_inertia = m * a;
  const F_road = F_roll + F_aero + F_grade + F_inertia;
  return {
    F_road_N: F_road,
    wheelTorque_Nm: F_road * veh.rTyre_m,
    breakdown: { F_roll, F_aero, F_grade, F_inertia },
  };
}

/**
 * Convert wheel torque to INPUT (variator) torque — clamp pressure scales with
 * this. ratioTotal = variator_ratio · final_drive. Needs the live ratio, so this
 * is called where TEL is available (cvt-context, M4), not in the bridge.
 */
export function inputTorqueNm(wheelTorque_Nm, ratioTotal, driveEff = VEH_DEFAULTS.driveEff) {
  if (!ratioTotal || ratioTotal <= 0) return 0;
  return wheelTorque_Nm / (ratioTotal * driveEff);
}

/**
 * Coarse grade fraction from a time-ordered fix track (device altitude).
 * Walks back from the newest fix until the cumulative horizontal run ≥ baseline_m
 * (so noisy ±metres of GPS altitude are averaged over a real distance), then
 * grade = Δaltitude / run. Returns null if there isn't enough baseline yet.
 *   fixes: [{ lat, lng, alt }], oldest→newest.
 */
export function gradeFromTrack(fixes, baseline_m = 20) {
  if (!Array.isArray(fixes) || fixes.length < 2) return null;
  const newest = fixes[fixes.length - 1];
  if (newest.alt == null) return null;
  let run = 0, i = fixes.length - 1;
  while (i > 0) {
    const a = fixes[i - 1], b = fixes[i];
    if (a.lat == null || b.lat == null) break;
    run += haversine_m(a.lat, a.lng, b.lat, b.lng);
    i--;
    if (run >= baseline_m) break;
  }
  const oldest = fixes[i];
  if (run < Math.min(baseline_m, 6) || oldest.alt == null) return null;  // too short → noise
  return (newest.alt - oldest.alt) / run;
}

/** Clamp a grade to a sane road range (±25 % ≈ ±14°) to reject GPS-altitude spikes. */
export function clampGrade(gradeFrac) {
  if (gradeFrac == null || !Number.isFinite(gradeFrac)) return 0;
  return Math.max(-0.25, Math.min(0.25, gradeFrac));
}
