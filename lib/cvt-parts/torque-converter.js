/**
 * lib/cvt-parts/torque-converter.js
 *
 * Punch VT2-VT3 torque converter — the fluid coupling between the engine
 * crankshaft and the CVT input shaft.  Includes a lockup clutch that, once
 * engaged at ≥25 kph (manual §1.6), mechanically bypasses the fluid coupling
 * to eliminate slip losses.
 *
 * Internals (typical 3-element TC):
 *   IMPELLER — fixed to the engine flexplate side; pumps the ATF outward
 *   TURBINE  — driven by the ATF flow, fixed to the TC output (which feeds
 *              the CVT's forward clutch)
 *   STATOR   — sits between impeller and turbine on a one-way clutch.  At
 *              low input speed (high slip) it redirects fluid for torque
 *              multiplication.  At coupling speed it freewheels.
 *   LOCKUP   — friction clutch ring between turbine hub and the TC front
 *              cover.  When engaged, impeller = turbine, no slip.
 *
 * Visual model:
 *   Outer donut casing (translucent so internals are visible)
 *   Impeller blade ring (concentric set of curved fins)
 *   Turbine blade ring (mirror-image of impeller)
 *   Stator (small bladed wheel between them)
 *   Lockup ring (thin annular disc, opacity / colour reflects engagement)
 *
 * Live API:
 *   group.setSpeeds(N_MOT, N_Prim, dt)   — impeller spins at N_MOT, turbine at N_Prim
 *   group.setLockup(engaged)              — lockup clutch colour change + opacity
 *   group.setTemp(t_C)                    — heat tint on casing
 *   group.setHighlight(on)                — DTC fault flag
 *
 * Local frame: axis along +Y.  Outer torus is centred at y=0, internals
 * occupy ±depth/2 along Y.
 */

import * as THREE from 'three';

const DEFAULTS = {
  // Real Punch VT2-VT3 TC is ~Ø240-260mm — the largest single round
  // component in the transmission.  Earlier Ø124 was undersized vs the
  // Ø150 sheaves.  Ø190 is a pragmatic mid-point that doesn't dominate
  // but properly outranks the pulleys.
  outerR:       95,    // Ø190 outer donut OD
  tubeR:        30,    // tube radius (gives Ø130 internal cavity)
  bladeR_in:    22,    // inner radius of blade ring
  bladeR_out:   60,    // outer radius of blade ring
  bladeCount:   18,
  bladeH:        3,    // axial blade thickness (visual)
  statorR:      18,    // stator outer radius
  statorBlades: 11,
  lockupRingR_in:  20,
  lockupRingR_out: 58,
  lockupRingThk:    1.4,
  depth:        60,    // total axial extent (was 48)
};

export function buildTorqueConverter({
  name = 'tc',
  materials = {},
  edgeMat = null,
  ...custom
} = {}) {
  const D = { ...DEFAULTS, ...custom };

  const group = new THREE.Group();
  group.name = name;
  group.userData.kind = 'torque-converter';

  // ── materials ─────────────────────────────────────────────────────────────
  const matCasing = (materials.casing || new THREE.MeshPhysicalMaterial({
    color: 0x6b7884, metalness: 0.85, roughness: 0.35,
    transparent: true, opacity: 0.42, side: THREE.DoubleSide,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matImpeller = (materials.impeller || new THREE.MeshPhysicalMaterial({
    color: 0xc7a05a, metalness: 0.78, roughness: 0.3,           // bronze-ish
    transparent: true, opacity: 0.95,
    emissive: 0x3a2410, emissiveIntensity: 0.2,
  })).clone();
  const matTurbine = (materials.turbine || new THREE.MeshPhysicalMaterial({
    color: 0xa6b3c0, metalness: 0.95, roughness: 0.2,           // chrome
    transparent: true, opacity: 0.95,
    emissive: 0x111a22, emissiveIntensity: 0.3,
  })).clone();
  const matStator = (materials.stator || new THREE.MeshPhysicalMaterial({
    color: 0x5e6a76, metalness: 0.85, roughness: 0.4,
    transparent: true, opacity: 0.95,
    emissive: 0x0a131a, emissiveIntensity: 0.2,
  })).clone();
  const matLockup = (materials.lockup || new THREE.MeshPhysicalMaterial({
    color: 0xc7a05a, metalness: 0.4, roughness: 0.55,
    transparent: true, opacity: 0.35, side: THREE.DoubleSide,
    emissive: 0x3a2410, emissiveIntensity: 0.25,
  })).clone();

  const geomCache = [];

  // ── 1. OUTER CASING (torus — the donut) ──────────────────────────────────
  // Translucent so we can see the impeller / turbine inside.
  const casingGeom = new THREE.TorusGeometry(D.outerR - D.tubeR, D.tubeR, 24, 64);
  casingGeom.rotateX(Math.PI/2);                        // align tube hole with Y axis
  geomCache.push(casingGeom);
  const casing = new THREE.Mesh(casingGeom, matCasing);
  casing.name = `${name}-casing`;
  group.add(casing);

  // ── 2. IMPELLER (engine-side blade ring) ─────────────────────────────────
  const impellerGroup = new THREE.Group();
  impellerGroup.name = `${name}-impeller`;
  impellerGroup.position.y = -D.depth/4;               // engine side = -Y

  for (let i = 0; i < D.bladeCount; i++) {
    const a = (i / D.bladeCount) * Math.PI * 2;
    // Each blade is a thin curved fin — modelled as a slim box that lookAts
    // the centre (gives a fan-like appearance from above).
    const bladeGeom = new THREE.BoxGeometry(D.bladeR_out - D.bladeR_in, D.bladeH, 3);
    geomCache.push(bladeGeom);
    const b = new THREE.Mesh(bladeGeom, matImpeller);
    const r = (D.bladeR_in + D.bladeR_out) / 2;
    b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.lookAt(0, 0, 0);
    b.rotation.z += 0.4;                                // pitch angle
    impellerGroup.add(b);
  }
  // Impeller hub (visible centre)
  const impHubGeom = new THREE.CylinderGeometry(D.bladeR_in, D.bladeR_in, D.bladeH * 1.4, 24, 1, false);
  geomCache.push(impHubGeom);
  const impHub = new THREE.Mesh(impHubGeom, matImpeller);
  impellerGroup.add(impHub);
  group.add(impellerGroup);

  // ── 3. TURBINE (transmission-side blade ring, mirror of impeller) ────────
  const turbineGroup = new THREE.Group();
  turbineGroup.name = `${name}-turbine`;
  turbineGroup.position.y = D.depth/4;                  // trans side = +Y

  for (let i = 0; i < D.bladeCount; i++) {
    const a = (i / D.bladeCount) * Math.PI * 2;
    const bladeGeom = new THREE.BoxGeometry(D.bladeR_out - D.bladeR_in, D.bladeH, 3);
    geomCache.push(bladeGeom);
    const b = new THREE.Mesh(bladeGeom, matTurbine);
    const r = (D.bladeR_in + D.bladeR_out) / 2;
    b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.lookAt(0, 0, 0);
    b.rotation.z -= 0.4;                                // opposite pitch from impeller
    turbineGroup.add(b);
  }
  const turbHubGeom = new THREE.CylinderGeometry(D.bladeR_in, D.bladeR_in, D.bladeH * 1.4, 24, 1, false);
  geomCache.push(turbHubGeom);
  const turbHub = new THREE.Mesh(turbHubGeom, matTurbine);
  turbineGroup.add(turbHub);
  group.add(turbineGroup);

  // ── 4. STATOR (small bladed wheel in the centre, between impeller/turbine) ──
  const statorGroup = new THREE.Group();
  statorGroup.name = `${name}-stator`;
  statorGroup.position.y = 0;

  const statorBodyGeom = new THREE.CylinderGeometry(8, 8, 6, 18, 1, false);
  geomCache.push(statorBodyGeom);
  statorGroup.add(new THREE.Mesh(statorBodyGeom, matStator));

  for (let i = 0; i < D.statorBlades; i++) {
    const a = (i / D.statorBlades) * Math.PI * 2;
    const sBladeGeom = new THREE.BoxGeometry(D.statorR - 8, 1.6, 2.2);
    geomCache.push(sBladeGeom);
    const b = new THREE.Mesh(sBladeGeom, matStator);
    const r = (8 + D.statorR) / 2;
    b.position.set(Math.cos(a) * r, 0, Math.sin(a) * r);
    b.lookAt(0, 0, 0);
    b.rotation.z = 0.25;
    statorGroup.add(b);
  }
  group.add(statorGroup);

  // ── 5. LOCKUP CLUTCH RING (between turbine and front cover) ──────────────
  // Thin annular disc visible inside the casing.  Opacity reflects engagement:
  // released = translucent ghost; engaged = solid amber.
  const lockupShape = new THREE.Shape();
  lockupShape.absarc(0, 0, D.lockupRingR_out, 0, Math.PI * 2, false);
  const lockupHole = new THREE.Path();
  lockupHole.absarc(0, 0, D.lockupRingR_in, 0, Math.PI * 2, true);
  lockupShape.holes.push(lockupHole);
  const lockupGeom = new THREE.ExtrudeGeometry(lockupShape, {
    depth: D.lockupRingThk, bevelEnabled: false, curveSegments: 56,
  });
  lockupGeom.rotateX(-Math.PI/2);
  geomCache.push(lockupGeom);
  const lockup = new THREE.Mesh(lockupGeom, matLockup);
  lockup.name = `${name}-lockup`;
  lockup.position.y = D.depth/3.2;       // just above the turbine, against the front cover
  group.add(lockup);

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    [casing, impHub, turbHub, lockup].forEach(mesh => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 14), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      // Parent edges with their owners so they follow rotation
      const parent = (mesh === impHub) ? impellerGroup
                   : (mesh === turbHub) ? turbineGroup
                   : group;
      parent.add(eg);
      edgeMeshes.push(eg);
    });
  }

  // ── refs ──────────────────────────────────────────────────────────────────
  const refs = {
    casing, impellerGroup, turbineGroup, statorGroup, lockup,
    materials: { matCasing, matImpeller, matTurbine, matStator, matLockup },
  };

  // ── live API ──────────────────────────────────────────────────────────────
  let _impPhase = 0, _turbPhase = 0, _statPhase = 0;

  /**
   * setSpeeds(N_MOT_rpm, N_Prim_rpm, dt)
   *   Impeller spins at engine speed.
   *   Turbine spins at primary speed (= engine when locked).
   *   Stator: in slip mode, locked (no rotation).  When approaching coupling
   *   speed (turbine ≈ impeller), stator freewheels — visualised as a tiny
   *   reverse drift.
   */
  group.setSpeeds = function (N_MOT, N_Prim, dt = 0.016) {
    const wImp = (N_MOT  / 60) * 2 * Math.PI;
    const wTrb = (N_Prim / 60) * 2 * Math.PI;
    _impPhase  += wImp * dt;
    _turbPhase += wTrb * dt;
    impellerGroup.rotation.y = _impPhase;
    turbineGroup.rotation.y  = _turbPhase;
    // Stator: barely moves; gently freewheels when slip < 5 %
    const slip = N_MOT > 0 ? (N_MOT - N_Prim) / N_MOT : 0;
    if (Math.abs(slip) < 0.05) _statPhase += wImp * 0.05 * dt;
    statorGroup.rotation.y = _statPhase;
  };

  /**
   * setLockup(engaged)
   *   Engaged: clutch ring becomes solid amber.
   *   Released: clutch ring is a translucent ghost.
   */
  group.setLockup = function (engaged) {
    if (engaged) {
      lockup.material.opacity = 0.85;
      lockup.material.emissive.setHex(0xff8a20);
      lockup.material.emissiveIntensity = 0.55;
    } else {
      lockup.material.opacity = 0.30;
      lockup.material.emissive.setHex(0x3a2410);
      lockup.material.emissiveIntensity = 0.2;
    }
  };

  /**
   * setTemp(t_C) — heat tint on casing (matches T_oil since the TC is full
   * of CVTF).  Above 120 °C, casing shifts amber.
   */
  group.setTemp = function (t_C) {
    const tN = Math.max(0, Math.min(1, (t_C - 80) / 60));
    casing.material.emissive.setHex(tN > 0.05 ? 0xff5520 : 0x000000);
    casing.material.emissiveIntensity = tN * 0.5;
  };

  /**
   * setHighlight(on) — Phase-5 DTC fault flag (e.g. lockup clutch fault).
   * Pulses the lockup ring red.
   */
  let _hlPhase = 0;
  group.setHighlight = function (on) {
    if (!on) {
      lockup.material.emissive.setHex(0x3a2410);
      return;
    }
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    lockup.material.emissive.setHex(0xff2244);
    lockup.material.emissiveIntensity = 0.4 + pulse * 0.5;
  };

  return {
    group,
    refs,
    dispose() {
      geomCache.forEach(g => g.dispose());
      [matCasing, matImpeller, matTurbine, matStator, matLockup].forEach(m => m.dispose());
      edgeMeshes.forEach(eg => eg.geometry?.dispose());
    },
  };
}
