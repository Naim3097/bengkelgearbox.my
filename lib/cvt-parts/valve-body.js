/**
 * lib/cvt-parts/valve-body.js
 *
 * Punch VT2-VT3 valve body — the hydraulic control brain of the CVT.
 * Sits beneath the variator in the gearcase, fed by the oil pump and
 * commanded by the three EDS PWM solenoids:
 *   EDS1 = primary clamp pressure regulator   (5.05 Ω)
 *   EDS2 = secondary clamp pressure regulator (5.05 Ω)
 *   EDS3 = D / R clutch pressure regulator    (5.05 Ω)
 *
 * The block itself is semi-abstract — the goal is mechanic-readable
 * *position* and *function*, not lithographic-accurate channel layout
 * (that's not in the manual anyway).  Three solenoid stacks protrude
 * upward; each animates with its own EDS_mA current.
 *
 * Construction returns { group, refs, dispose } per the cross-cutting
 * principle in BYKI_3D_DIAGNOSTIC_BUILD_PLAN.md §4.1.
 *
 * Public API:
 *   buildValveBody({ materials, edgeMat, ...overrides }) => { group, refs, dispose }
 *
 *   group.setEdsCurrent(idx, mA)
 *      idx: 0=EDS1, 1=EDS2, 2=EDS3
 *      coil ring brightness scales with current (0..700 mA range typical).
 *      A subtle high-frequency pulse models the PWM duty visually.
 *
 *   group.setSpoolPosition(idx, fraction)
 *      fraction: 0..1 — spool indicator bar inside the block shifts.
 *      Caller maps from commanded duty or measured pressure.
 *
 *   group.setTemp(t_C)
 *      Drives emissive heat tint on the block (matches oil temperature).
 *
 *   group.setHighlight(idx, on)
 *      Phase-5 DTC fault flag on the specified solenoid (EDS1/2/3).
 *      Pulses red on that solenoid only.
 *
 * Local frame: block centred at origin, top face at +Y.  Solenoid stacks
 * project upward in +Y.  Caller positions / rotates as needed.
 */

import * as THREE from 'three';

const DEFAULTS = {
  // Block
  bodyW:           180,    // X
  bodyD:            90,    // Z
  bodyH:            25,    // Y (thickness)
  cornerR:           4,    // visual chamfer
  // Solenoid stack
  solCount:          3,
  solSpacing:       60,    // X spacing between solenoid centres
  solOffsetX:      -60,    // X of first solenoid (negative-X side)
  solBodyR:         11,    // Ø22 solenoid steel core
  solBodyH:         42,    // cylindrical magnetic body
  solCapR:           7,
  solCapH:          14,    // narrower top cap (electrical connector)
  // Coil ring
  coilR:            14,    // Ø28 coil outer
  coilInnerR:       11,
  coilH:            22,
  // Spool indicator (visible through cutout in block)
  spoolBarW:        20,
  spoolBarH:         3,
  spoolBarD:         5,
  spoolTravelMm:    14,    // max axial travel along Z within the block
};

const LABELS = ['EDS1', 'EDS2', 'EDS3'];

export function buildValveBody({
  name = 'valve-body',
  materials = {},
  edgeMat = null,
  ...custom
} = {}) {
  const D = { ...DEFAULTS, ...custom };

  const group = new THREE.Group();
  group.name = name;
  group.userData.kind = 'valve-body';

  // ── materials ─────────────────────────────────────────────────────────────
  const matBlock = (materials.block || new THREE.MeshPhysicalMaterial({
    color: 0x4e5560, metalness: 0.78, roughness: 0.45,
    transparent: true, opacity: 0.92, side: THREE.DoubleSide,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matSolBody = (materials.solBody || new THREE.MeshPhysicalMaterial({
    color: 0x6b7884, metalness: 0.92, roughness: 0.28,
    transparent: true, opacity: 0.94,
  })).clone();
  const matCoil = (materials.coil || new THREE.MeshPhysicalMaterial({
    color: 0xc7a05a, metalness: 0.55, roughness: 0.5,
    transparent: true, opacity: 0.85,
    emissive: 0x39c2d7, emissiveIntensity: 0.15,    // baseline cyan glow
  })).clone();
  const matCap = (materials.cap || new THREE.MeshPhysicalMaterial({
    color: 0x222a32, metalness: 0.4, roughness: 0.6,
    transparent: true, opacity: 0.95,
  })).clone();
  const matSpool = (materials.spool || new THREE.MeshPhysicalMaterial({
    color: 0xa6b3c0, metalness: 0.95, roughness: 0.18,
    emissive: 0x39c2d7, emissiveIntensity: 0.25,
  })).clone();

  const geomCache = [];

  // ── 1. BLOCK (the manifold) ──────────────────────────────────────────────
  // Real Punch VT2-VT3 valve body (P/N 482589) is a cast-aluminium manifold
  // with an irregular outline — roughly trapezoidal with rounded corners
  // and bolt-pad protrusions around the perimeter.  Build via a Shape +
  // ExtrudeGeometry to capture this.  Plan-view (looking down +Y):
  //
  //          (-x) ◄──── 180 mm ────► (+x)
  //                 .-_______.
  //                /          \   (-z)
  //                |   pads   |
  //                |          |   90 mm
  //                |   ▭▭▭   |   (solenoid cluster on top face)
  //                \  __/--__ |
  //                 \/      \-'   (+z, bolted-down side)
  //
  const half_w = D.bodyW/2;
  const half_d = D.bodyD/2;
  const r_corner = 12;   // outer corner radius

  const shape = new THREE.Shape();
  // Start at lower-left, sweep around clockwise with rounded corners,
  // adding a slight kidney curve on the +Z (front) edge to break symmetry.
  shape.moveTo(-half_w + r_corner, -half_d);
  shape.lineTo( half_w - r_corner, -half_d);
  shape.quadraticCurveTo( half_w, -half_d,  half_w, -half_d + r_corner);
  // Right edge with a slight bulge
  shape.lineTo( half_w,  half_d - r_corner - 6);
  shape.quadraticCurveTo( half_w + 4,  half_d - r_corner/2,  half_w - r_corner,  half_d);
  // Front edge — gentle inward curve (kidney bite)
  shape.lineTo( 18,  half_d);
  shape.quadraticCurveTo( 0,  half_d - 14,  -18,  half_d);
  shape.lineTo(-half_w + r_corner,  half_d);
  shape.quadraticCurveTo(-half_w - 2,  half_d - r_corner/2,  -half_w,  half_d - r_corner - 4);
  // Left edge
  shape.lineTo(-half_w, -half_d + r_corner);
  shape.quadraticCurveTo(-half_w, -half_d, -half_w + r_corner, -half_d);

  const blockGeom = new THREE.ExtrudeGeometry(shape, {
    depth: D.bodyH, bevelEnabled: true, bevelThickness: 1.2, bevelSize: 0.8,
    bevelSegments: 2, curveSegments: 24,
  });
  blockGeom.rotateX(-Math.PI/2);
  blockGeom.translate(0, -D.bodyH/2, 0);
  geomCache.push(blockGeom);
  const block = new THREE.Mesh(blockGeom, matBlock);
  block.name = `${name}-block`;
  group.add(block);

  // Bolt pads around the perimeter — small cylindrical bumps suggesting the
  // bolt-down pattern visible in §2.6.2.12 of the service manual.
  const boltPads = [
    [-half_w + 8,  -half_d + 8],   // 4 corners
    [ half_w - 8,  -half_d + 8],
    [-half_w + 8,   half_d - 8],
    [ half_w - 8,   half_d - 8],
    [-half_w + 8,   0],            // mid-edges (left/right)
    [ half_w - 8,   0],
    [ 50,   half_d - 8],           // 2 along front edge
    [-50,   half_d - 8],
  ];
  for (const [x, z] of boltPads) {
    const pg = new THREE.CylinderGeometry(4, 4, D.bodyH + 2, 12, 1, false);
    geomCache.push(pg);
    const p = new THREE.Mesh(pg, matBlock);
    p.position.set(x, 0, z);
    group.add(p);
  }

  // ── 2. SOLENOID STACKS (3 of them) ───────────────────────────────────────
  // Per manual photo: solenoids cluster in a staggered formation, NOT a
  // straight line.  Layout below approximates the physical Punch valve-body
  // solenoid pack: EDS1 (primary clamp) and EDS2 (secondary clamp) sit
  // closer together near the rear edge; EDS3 (clutch) sits forward and
  // offset to one side.
  const solLayout = [
    { x: -45, z: -22, label: 'EDS1' },   // back-left (primary clamp)
    { x:  -8, z: -22, label: 'EDS2' },   // back-centre (secondary clamp)
    { x:  44, z:  10, label: 'EDS3' },   // forward-right (clutch)
  ];

  const solenoids = [];
  for (let i = 0; i < D.solCount; i++) {
    const solGroup = new THREE.Group();
    const lay = solLayout[i] || { x: D.solOffsetX + i * D.solSpacing, z: 0, label: LABELS[i] };
    solGroup.name = `${name}-${lay.label}`;
    solGroup.userData.label = lay.label;
    solGroup.userData.idx = i;
    solGroup.position.set(lay.x, D.bodyH/2, lay.z);

    // 2a. Solenoid body (steel cylinder) — material cloned so per-EDS highlight is independent
    const sBodyGeom = new THREE.CylinderGeometry(D.solBodyR, D.solBodyR, D.solBodyH, 28, 1, false);
    geomCache.push(sBodyGeom);
    const sBody = new THREE.Mesh(sBodyGeom, matSolBody.clone());
    sBody.position.y = D.solBodyH / 2;
    solGroup.add(sBody);

    // 2b. Coil ring (this is what pulses with current)
    const coilGeom = new THREE.CylinderGeometry(D.coilR, D.coilR, D.coilH, 32, 1, true);
    geomCache.push(coilGeom);
    const coil = new THREE.Mesh(coilGeom, matCoil.clone());     // clone so each EDS animates independently
    coil.position.y = D.coilH/2 + 8;                            // sits above bracket, around upper part of body
    solGroup.add(coil);

    // 2c. End cap / electrical connector at top
    const capGeom = new THREE.CylinderGeometry(D.solCapR, D.solCapR, D.solCapH, 18, 1, false);
    geomCache.push(capGeom);
    const cap = new THREE.Mesh(capGeom, matCap);
    cap.position.y = D.solBodyH + D.solCapH/2 - 4;
    solGroup.add(cap);

    // 2d. Small bracket flange at base
    const bracketGeom = new THREE.CylinderGeometry(D.coilR + 2, D.coilR + 2, 3, 32, 1, false);
    geomCache.push(bracketGeom);
    const bracket = new THREE.Mesh(bracketGeom, matSolBody);
    bracket.position.y = 1.5;
    solGroup.add(bracket);

    // 2e. SPOOL position indicator inside the block (visible through transparency)
    // Local +Z axis is the spool travel direction.
    const spoolGeom = new THREE.BoxGeometry(D.spoolBarW, D.spoolBarH, D.spoolBarD);
    geomCache.push(spoolGeom);
    const spool = new THREE.Mesh(spoolGeom, matSpool.clone());
    spool.position.set(0, -D.bodyH/2 + D.spoolBarH/2 + 4, 0);   // inside the block, near the bottom
    solGroup.add(spool);

    solGroup.userData.refs = { sBody, coil, cap, bracket, spool };
    group.add(solGroup);
    solenoids.push(solGroup);
  }

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    [block, ...solenoids.flatMap(s => [
      s.userData.refs.sBody,
      s.userData.refs.coil,
      s.userData.refs.cap,
      s.userData.refs.bracket
    ])].forEach(mesh => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 12), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      // Parent edge under the solenoid group so it follows position
      const parent = (mesh === block) ? group : mesh.parent;
      parent.add(eg);
      edgeMeshes.push(eg);
    });
  }

  // ── refs ──────────────────────────────────────────────────────────────────
  const refs = {
    block, solenoids,
    materials: { matBlock, matSolBody, matCoil, matCap, matSpool },
  };

  // ── live API ──────────────────────────────────────────────────────────────
  const _coilBase = new THREE.Color(0x39c2d7);     // cyan baseline
  const _coilHot  = new THREE.Color(0x7fefff);     // brighter cyan at full duty
  let _pwmPhase = [0, 0, 0];                       // independent PWM phase per coil

  /**
   * setEdsCurrent(idx, mA)
   *   Drives the cyan coil emissive.  Range 0 → 700 mA → 0..1 brightness.
   *   A small PWM-frequency dither (~10 Hz) overlays so the user sees the
   *   coil is "energised", not just bright.
   */
  group.setEdsCurrent = function (idx, mA) {
    const s = solenoids[idx];
    if (!s) return;
    const coil = s.userData.refs.coil;
    const norm = Math.max(0, Math.min(1, (mA || 0) / 700));
    _pwmPhase[idx] += 0.32;
    const pwm = 0.7 + 0.3 * Math.sin(_pwmPhase[idx]);
    coil.material.emissive.lerpColors(_coilBase, _coilHot, norm);
    coil.material.emissiveIntensity = 0.15 + norm * pwm * 1.1;
  };

  /**
   * setSpoolPosition(idx, fraction)
   *   Moves the spool indicator bar along its travel axis (Z, in the block).
   *   fraction 0..1, scales to spoolTravelMm.
   */
  group.setSpoolPosition = function (idx, fraction) {
    const s = solenoids[idx];
    if (!s) return;
    const spool = s.userData.refs.spool;
    const f = Math.max(0, Math.min(1, fraction || 0));
    spool.position.z = (f - 0.5) * D.spoolTravelMm;
  };

  /**
   * setTemp(t_C) — drives block emissive heat tint (matches T_oil).
   */
  const _tempBase = new THREE.Color(0x000000);
  const _tempHot  = new THREE.Color(0xff5520);
  group.setTemp = function (t_C) {
    const tN = Math.max(0, Math.min(1, (t_C - 60) / 70));      // 0 at 60°C, 1 at 130°C
    block.material.emissive.lerpColors(_tempBase, _tempHot, tN);
    block.material.emissiveIntensity = tN * 0.6;
  };

  /**
   * setHighlight(idx, on) — Phase-5 DTC fault flag on the specified solenoid.
   * Pulses red on body + coil of EDSn.  Use idx=-1 for "any EDS fault" (all 3).
   */
  let _hlPhase = 0;
  group.setHighlight = function (idx, on) {
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    const targets = (idx === -1) ? solenoids
                   : (solenoids[idx] ? [solenoids[idx]] : []);
    // Restore any previously-highlighted solenoid not in `targets`
    solenoids.forEach((s, i) => {
      if (targets.includes(s)) return;
      const r = s.userData.refs;
      r.sBody.material.emissive.setHex(0x000000);
      r.sBody.material.emissiveIntensity = 0;
    });
    if (!on) return;
    targets.forEach(s => {
      const r = s.userData.refs;
      r.sBody.material.emissive.setHex(0xff2244);
      r.sBody.material.emissiveIntensity = 0.4 + pulse * 0.5;
    });
  };

  return {
    group,
    refs,
    dispose() {
      geomCache.forEach(g => g.dispose());
      [matBlock, matSolBody, matCoil, matCap, matSpool].forEach(m => m.dispose());
      // Per-solenoid material clones (sBody, coil, spool are each cloned)
      solenoids.forEach(s => {
        s.userData.refs.sBody.material.dispose();
        s.userData.refs.coil.material.dispose();
        s.userData.refs.spool.material.dispose();
      });
      edgeMeshes.forEach(eg => eg.geometry?.dispose());
    },
  };
}
