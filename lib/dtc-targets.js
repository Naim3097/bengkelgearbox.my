/**
 * lib/dtc-targets.js
 *
 * Phase 5 — DTC → 3D component & camera mapping.
 *
 * For each diagnostic trouble code we know how to:
 *   - identify the affected components (so they can be visually pulsed red)
 *   - frame the camera on those components (so a mechanic glancing at the
 *     screen immediately sees WHERE the fault is)
 *
 * The mapping is built lazily, given a `refs` object that exposes the
 * scene components (PULLEY, SEC_PULLEY, fwdClutchKit, revClutchKit,
 * planetaryKit, valveBodyKit, tcKit, pumpKit, outputKit, oilFlow,
 * pressureChambers, edsPulse).
 *
 * Each DTC entry returns:
 *   targets[]   — components to call setHighlight(true) / pulse red
 *   camera      — { position: Vec3, lookAt: Vec3 } for the auto-focus glide
 *
 * Some helpers below abstract common framings (variator top-down, clutch
 * stack rear, valve-body front, etc.) so DTCs sharing a region don't
 * duplicate hardcoded coords.
 */

import * as THREE from 'three';

// Hardcoded layout constants — match unit.html
const PRIMARY_X   = -77.5;
const SECONDARY_X = +77.5;

// Pre-built camera framings keyed by region.
//
// All framings use OVERVIEW distances (~400-550 mm from subject).  The intent
// is "calm bias toward the fault region" not "extreme close-up".  At 75″
// screen scale, an overview shot with a subtle red pulse on the affected
// component reads better than a zoomed-in pulse that washes the whole screen.
function framings() {
  return {
    // Variator (belt + both pulleys) — softly tilted 3/4 from above
    variator:        { position: new THREE.Vector3( 320, 280, 380), lookAt: new THREE.Vector3( 0,   10,    0) },
    variatorTop:     { position: new THREE.Vector3(  60, 540,  80), lookAt: new THREE.Vector3( 0,   10,    0) },
    // Primary side — pulled back so the pulley is ~40% of the frame, not 80%
    primaryCloseup:  { position: new THREE.Vector3(-340, 180, 360), lookAt: new THREE.Vector3(PRIMARY_X, 20, 0) },
    secondaryCloseup:{ position: new THREE.Vector3( 340, 180, 360), lookAt: new THREE.Vector3(SECONDARY_X, 20, 0) },
    // Clutch + planetary stack — view from the secondary side looking back
    clutchStack:     { position: new THREE.Vector3( 360, 160,  60), lookAt: new THREE.Vector3(PRIMARY_X,  0, -155) },
    // Valve body — view from forward & elevated so all 3 EDS solenoids are visible
    valveBody:       { position: new THREE.Vector3(  20, 140, 380), lookAt: new THREE.Vector3( 0, -110,   0) },
    // Pump — view from beside the primary
    pump:            { position: new THREE.Vector3(-340, 200, 320), lookAt: new THREE.Vector3(PRIMARY_X, 40, 60) },
    // Damper / TC — view from secondary side looking down the chain
    damperTC:        { position: new THREE.Vector3( 380, 160, -80), lookAt: new THREE.Vector3(PRIMARY_X,  0, -210) },
    // Planetary specifically — same region as clutchStack but slightly different
    planetary:       { position: new THREE.Vector3( 380, 140, -40), lookAt: new THREE.Vector3(PRIMARY_X,  0, -155) },
    // Output drivetrain — pulled back so reduction gear + diff + axles all fit
    output:          { position: new THREE.Vector3( 380, 80,  340), lookAt: new THREE.Vector3( SECONDARY_X, -110, 30) },
    // Generic overview / home — used as the "return-to" position
    overview:        { position: new THREE.Vector3( 380, 220, 220), lookAt: new THREE.Vector3( 0,   -30, -90) },
  };
}

export function buildDtcTargets(refs) {
  const F = framings();

  // Each DTC entry returns { targets, camera }.  Targets are an array of
  // objects exposing setHighlight(true|false).
  const map = {};

  // Helpers that wrap a single target with a temporary highlight adapter
  // when the underlying kit doesn't expose setHighlight (e.g. raw groups).
  function makeOilFlowHighlight(name) {
    if (!refs.oilFlow) return null;
    return {
      setHighlight: (on) => refs.oilFlow.setHighlight(name, on),
    };
  }
  function makeChamberHighlight(name) {
    if (!refs.pressureChambers) return null;
    return {
      setHighlight: (on) => refs.pressureChambers.setHighlight(name, on),
    };
  }
  function makeEdsHighlight(idx) {
    if (!refs.valveBodyKit?.group?.setHighlight) return null;
    return {
      setHighlight: (on) => refs.valveBodyKit.group.setHighlight(idx, on),
    };
  }
  // Pulley + belt highlight (raw groups — use material emissive override)
  // Shared pulse clock — ensures all simultaneously-highlighted DTC targets
  // breathe in unison instead of getting out of phase with each other.
  const _matCache = new Map();
  const _pulseClock = { t: 0, lastNow: typeof performance !== 'undefined' ? performance.now() : 0 };
  function _tickPulse() {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.min(0.05, (now - _pulseClock.lastNow) * 0.001);
    _pulseClock.lastNow = now;
    _pulseClock.t += dt;
  }
  function _pulseValue() {
    // 1.0 Hz pure sine — much calmer than the prior 1.5 Hz phase-accumulator.
    // Half-amplitude offset keeps it 0..1 instead of -1..+1.
    return 0.5 + 0.5 * Math.sin(_pulseClock.t * Math.PI * 2 * 1.0);
  }
  function makePulleyHighlight(group) {
    if (!group) return null;
    return {
      setHighlight: (on) => {
        _tickPulse();
        const pulse = _pulseValue();
        group.traverse(o => {
          if (!o.isMesh || !o.material || !o.material.emissive) return;
          const m = o.material;
          if (!_matCache.has(m)) {
            _matCache.set(m, { hex: m.emissive.getHex(), int: m.emissiveIntensity });
          }
          if (on) {
            const base = _matCache.get(m);
            // Deep crimson at a very low intensity ceiling — barely above
            // base.  The component reads as "tinted red" rather than "glowing".
            // Peak addition = 0.04 + 0.08 = 0.12 over base.  No bloom flooding.
            m.emissive.setHex(0xa42848);          // deep crimson
            m.emissiveIntensity = base.int + 0.04 + pulse * 0.08;
          } else {
            const base = _matCache.get(m);
            if (base) { m.emissive.setHex(base.hex); m.emissiveIntensity = base.int; }
          }
        });
      },
    };
  }

  function reg(code, targetsBuilder, camera) {
    const lazy = () => (targetsBuilder() || []).filter(Boolean);
    map[code] = { code, get targets() { return lazy(); }, camera };
  }

  // ── PRESSURE / VARIATOR FAULTS ────────────────────────────────────────────
  reg('P0944', () => [                                  // Insufficient clamping → belt slip
    makePulleyHighlight(refs.PULLEY),
    makePulleyHighlight(refs.SEC_PULLEY),
    makePulleyHighlight(refs.beltLink),
  ], F.variatorTop);

  reg('P0730', () => [                                  // Ratio control fault
    makePulleyHighlight(refs.PULLEY),
    makePulleyHighlight(refs.SEC_PULLEY),
  ], F.variator);

  reg('P0840', () => [                                  // Secondary pressure sensor
    makePulleyHighlight(refs.SEC_PULLEY),
    makeOilFlowHighlight('vb-sec'),
    makeChamberHighlight('sec-dome'),
  ], F.secondaryCloseup);

  reg('P1765', () => [                                  // Secondary pressure too low
    makePulleyHighlight(refs.SEC_PULLEY),
    makeOilFlowHighlight('vb-sec'),
    makeChamberHighlight('sec-dome'),
  ], F.secondaryCloseup);
  reg('P1766', () => [                                  // Secondary pressure too high
    makePulleyHighlight(refs.SEC_PULLEY),
    makeOilFlowHighlight('vb-sec'),
    makeChamberHighlight('sec-dome'),
  ], F.secondaryCloseup);

  reg('P0641', () => [                                  // Pressure sensor 5V supply
    refs.valveBodyKit?.group ? { setHighlight: (on) => {
      [0,1,2].forEach(i => refs.valveBodyKit.group.setHighlight(i, on));
    } } : null,
  ], F.valveBody);

  // ── SPEED-SENSOR FAULTS ────────────────────────────────────────────────────
  reg('P2765', () => [ makePulleyHighlight(refs.PULLEY) ],     F.primaryCloseup);
  reg('P2766', () => [ makePulleyHighlight(refs.PULLEY) ],     F.primaryCloseup);
  reg('P0720', () => [ makePulleyHighlight(refs.SEC_PULLEY) ], F.secondaryCloseup);
  reg('P0721', () => [ makePulleyHighlight(refs.SEC_PULLEY) ], F.secondaryCloseup);
  reg('P0727', () => [ refs.tcKit?.group ], F.damperTC);       // Engine speed unplausible → TC/damper

  // ── CLUTCH FAULTS ─────────────────────────────────────────────────────────
  reg('P0811', () => [                                  // Clutch slipping
    refs.fwdClutchKit?.group,
    refs.revClutchKit?.group,
    makeChamberHighlight('fwd-piston'),
    makeChamberHighlight('rev-piston'),
  ], F.clutchStack);

  reg('P2787', () => [                                  // Clutch temp too high
    refs.fwdClutchKit?.group,
    refs.revClutchKit?.group,
  ], F.clutchStack);

  // ── EDS SOLENOID FAULTS ───────────────────────────────────────────────────
  // EDS1 = primary clamp
  ['P0962','P0963','P0960'].forEach(code => reg(code, () => [
    makeEdsHighlight(0),
    makeOilFlowHighlight('vb-pri'),
    makeChamberHighlight('pri-cup'),
  ], F.valveBody));
  // EDS2 = secondary clamp
  ['P0966','P0967','P0964'].forEach(code => reg(code, () => [
    makeEdsHighlight(1),
    makeOilFlowHighlight('vb-sec'),
    makeChamberHighlight('sec-dome'),
  ], F.valveBody));
  // EDS3 = clutch
  ['P0902','P0903','P0900'].forEach(code => reg(code, () => [
    makeEdsHighlight(2),
    makeOilFlowHighlight('vb-fwd'),
    makeOilFlowHighlight('vb-rev'),
    refs.fwdClutchKit?.group,
    refs.revClutchKit?.group,
  ], F.valveBody));

  // ── OIL TEMPERATURE FAULTS ────────────────────────────────────────────────
  ['P0710','P0218','P1767'].forEach(code => reg(code, () => [
    refs.pumpKit?.group,
    refs.tcKit?.group,
    makeOilFlowHighlight('pump-vb'),
  ], F.pump));

  // ── ELECTRICAL ────────────────────────────────────────────────────────────
  ['P0882','P0883'].forEach(code => reg(code, () => [], F.overview));   // No specific component
  ['U0001','U0100','U0121'].forEach(code => reg(code, () => [], F.overview));

  // Public API
  return {
    /** @param {string} code → { code, targets, camera } | undefined */
    get(code) { return map[code]; },
    /** All codes registered */
    codes() { return Object.keys(map); },
    /** Activate red pulse on all targets for `code`.  Returns disable() fn. */
    highlight(code, on) {
      const entry = map[code];
      if (!entry) return null;
      entry.targets.forEach(t => t?.setHighlight?.(on));
    },
  };
}
