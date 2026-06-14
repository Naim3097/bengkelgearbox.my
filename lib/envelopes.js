/**
 * lib/envelopes.js
 *
 * Phase 6.1 — Per-signal healthy-range envelopes, resolved per operating point.
 *
 * A value is only meaningful relative to what the CVT is doing.  Each signal
 * gets a healthy band [lo, hi] that depends on the operating-point bucket
 * (see operating-point.js).  The UI draws this band under each chip with a
 * live needle, and colours it green / amber / red; the 3D heat zones bind to
 * the same status.
 *
 * GROUNDING (every band cites its basis):
 *   - Pressures: cvt_datadict.md §4.2 — line 4–58 bar, secondary 0–60, the
 *     pressure SCHEDULE rises with torque demand. Bucket bands bracket the
 *     expected schedule value ± headroom, consistent with the real session-13
 *     calibration (15 bar light → 51–57 bar WOT).
 *   - Temperatures: cvt_datadict.md §5 — normal 60–90 °C, warm to 110, P0218
 *     >120, P1767 >130, clutch P2787 >150.
 *   - Ratio: variator span 0.51–2.2 (measured envelope, ratio-performance r²=0.997);
 *     low gear at launch, overdrive at speed.
 *   - Slip: P0944 belt slip >2 %; P0811 clutch slip (sustained) >10 %.
 *
 * resolveEnvelope(key, opBucket, TEL) → { lo, hi, dmin, dmax, twoSided } | null
 */

import { OP_BUCKETS as B } from './operating-point.js';

// Pressure schedule bands (bar) keyed by bucket.  [lo, hi] = healthy window.
const PRESSURE_BANDS = {
  [B.PARK_IDLE]:  [4, 14],
  [B.STALL]:      [8, 24],
  [B.LAUNCH]:     [28, 58],
  [B.CREEP]:      [6, 20],
  [B.CRUISE_LT]:  [8, 26],
  [B.CRUISE_MID]: [16, 42],
  [B.WOT]:        [36, 58],
  [B.COAST]:      [5, 18],
  [B.REVERSE]:    [8, 28],
};

// Ratio bands keyed by bucket (variator i = N_Prim / N_sec).
const RATIO_BANDS = {
  [B.PARK_IDLE]:  [1.4, 2.2],   // sits in low gear ready to launch
  [B.STALL]:      [1.6, 2.2],
  [B.LAUNCH]:     [1.3, 2.2],
  [B.CREEP]:      [1.2, 2.2],
  [B.CRUISE_LT]:  [0.6, 1.6],
  [B.CRUISE_MID]: [0.6, 1.4],
  [B.WOT]:        [0.8, 2.0],   // pulls toward low gear for power
  [B.COAST]:      [0.5, 1.5],
  [B.REVERSE]:    [1.4, 2.2],
};

// Clutch-slip healthy ceiling (%) — launch tolerates large transient slip.
const CLUTCH_SLIP_HI = {
  [B.LAUNCH]: 35, [B.STALL]: 60, [B.CREEP]: 12, [B.REVERSE]: 35,
  [B.CRUISE_LT]: 3, [B.CRUISE_MID]: 3, [B.WOT]: 8, [B.COAST]: 3, [B.PARK_IDLE]: 100,
};

export function resolveEnvelope(key, bucket, TEL) {
  switch (key) {
    // ── Pressures (two-sided: too low = slip risk, too high = regulator fault) ─
    case 'P_line': {
      const [lo, hi] = PRESSURE_BANDS[bucket] || [4, 58];
      return { lo, hi, dmin: 0, dmax: 60, twoSided: true };
    }
    case 'P_pri': {
      const [lo, hi] = PRESSURE_BANDS[bucket] || [0, 58];
      return { lo: Math.max(0, lo - 2), hi, dmin: 0, dmax: 60, twoSided: true };
    }
    case 'P_sec': {
      const [lo, hi] = PRESSURE_BANDS[bucket] || [0, 60];
      // Secondary must always hold a baseline clamp to prevent belt slip.
      return { lo: Math.max(4, lo), hi: Math.min(60, hi + 2), dmin: 0, dmax: 60, twoSided: true };
    }
    case 'P_clutch': {
      // Engaged clutch sits ~14–30 bar; released ~0. (Estimated signal.)
      const engaged = (bucket !== B.PARK_IDLE && bucket !== B.COAST);
      return engaged
        ? { lo: 10, hi: 32, dmin: 0, dmax: 40, twoSided: true }
        : { lo: 0,  hi: 6,  dmin: 0, dmax: 40, twoSided: false };
    }

    // ── Temperatures (one-sided: only too hot is a fault) ─────────────────────
    case 'T_oil':
      return { lo: 50, hi: 110, dmin: 20, dmax: 150, twoSided: false };  // P0218 >120, P1767 >130
    case 'T_clutch':
      return { lo: 50, hi: 130, dmin: 20, dmax: 180, twoSided: false };  // P2787 >150

    // ── Ratio (two-sided) ────────────────────────────────────────────────────
    // PHYSICALLY-GROUNDED band: the healthy variator ratio at any speed is
    // bounded by keeping the engine in its usable rpm window.  ratio = N_Prim/
    // N_sec, and N_sec ∝ road speed, so:
    //   ratio_lo = idleRpm / N_sec   (any lower and the engine would lug/stall)
    //   ratio_hi = maxUsefulRpm / N_sec (any higher and it would over-rev)
    // intersected with the physical variator span [0.51, 2.2].  This avoids
    // false-flagging legitimate highway overdrive (0.55 @ 80 km/h is healthy).
    // At a standstill (N_sec≈0) fall back to the launch/low-gear band.
    case 'ratio': {
      const nsec = TEL && TEL.N_sec ? TEL.N_sec : 0;
      if (nsec > 200) {
        // Healthy upper edge = whatever ratio keeps the engine at/below its
        // useful ceiling for this speed.  Sitting at FULL OVERDRIVE (low ratio)
        // is never a fault — so this edge is ONE-SIDED-HIGH: amber/red only
        // when the ratio is TOO HIGH for the speed (over-rev / not upshifting,
        // i.e. P0730 territory).  A hard red floor at 0.50 catches an
        // impossible/sensor ratio.
        const maxUseful = (bucket === B.WOT ? 6200 : 5200);
        let hi = Math.min(2.20, maxUseful / nsec);
        let lo = Math.max(0.51, 850 / nsec);          // display-only lower edge
        if (hi < lo + 0.1) hi = lo + 0.1;
        return { lo: +lo.toFixed(2), hi: +hi.toFixed(2), dmin: 0.4, dmax: 2.3, twoSided: false, redBelow: 0.50 };
      }
      // Standstill / launch: low ratio WOULD be a fault (no torque mult), so
      // here the band is genuinely two-sided around the expected low gear.
      const [lo, hi] = RATIO_BANDS[bucket] || [0.51, 2.2];
      return { lo, hi, dmin: 0.4, dmax: 2.3, twoSided: true };
    }

    // ── Slip (one-sided: only excess slip is a fault) ────────────────────────
    case 'beltSlip_pct':
      return { lo: 0, hi: 1.0, dmin: 0, dmax: 5, twoSided: false };       // P0944 >2 %
    case 'clutchSlip_pct': {
      const hi = CLUTCH_SLIP_HI[bucket] ?? 5;
      return { lo: 0, hi, dmin: 0, dmax: Math.max(20, hi * 1.3), twoSided: false };
    }

    default:
      return null;
  }
}

/**
 * Classify a live value against its envelope.
 *   → 'green' (comfortably inside) | 'amber' (near/just outside) | 'red' (well outside)
 * Margin = 10 % of band width (build plan §8.2).
 */
export function envelopeStatus(value, env) {
  if (!env || value == null || !Number.isFinite(value)) return 'green';
  // Optional hard red floor (e.g. ratio below the physical overdrive limit).
  if (env.redBelow != null && value < env.redBelow) return 'red';
  const span = Math.max(1e-6, env.hi - env.lo);
  const m = 0.10 * span;
  if (env.twoSided) {
    if (value < env.lo - m || value > env.hi + m) return 'red';
    if (value < env.lo + m || value > env.hi - m) return 'amber';
    return 'green';
  }
  // one-sided: only the upper edge matters (low side is healthy)
  if (value > env.hi + m) return 'red';
  if (value > env.hi - m) return 'amber';
  return 'green';
}

/** Map a value onto the display axis [dmin,dmax] → 0..1 (clamped). */
export function axisFrac(value, env) {
  if (!env) return 0;
  return Math.max(0, Math.min(1, (value - env.dmin) / (env.dmax - env.dmin)));
}
