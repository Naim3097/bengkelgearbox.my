/**
 * lib/cvt-parts/output-drivetrain.js
 *
 * Punch VT2-VT3 output drivetrain — AUDIT FIX F13/F14: rebuilt to the real
 * TWO-STAGE final drive (service manual §3.2.1/§3.2.3, catalogue №864):
 *
 *   Secondary shaft output gear ──┐            (stage 1)
 *                                 ├── Intermediate "pinion shaft"
 *                                 │     · large helical gear (meshes stage 1)
 *                                 │     · integral small pinion (drives stage 2)
 *                                 └── CROWN WHEEL bolted to the differential
 *                                       carrier on its OWN axis   (stage 2)
 *
 * The differential spins about the same axis direction as the pulleys, and
 * the drive shafts leave it COAXIALLY (through the case's differential oil
 * seals) — the old model's single stage, gear-face-mounted "differential"
 * and perpendicular axle stubs were kinematically impossible.
 *
 * Local frame: gear axes along local +Y (caller rotates x=+π/2 so local +Y →
 * world +Z, matching the secondary shaft).  Local X stays world X; local +Z
 * maps to world −Y, so "below" in the case = +Z here.
 *
 * Public API (unchanged):
 *   buildOutputDrivetrain({ materials, edgeMat, ...overrides }) => { group, refs, dispose }
 *   group.setRotation(N_sec_rpm, dt)   — stage rates follow the gear meshes;
 *                                        diff/axles at N_sec / finalDrive
 *   group.setTemp(t_C)                 — heat tint on differential housing
 *   group.setHighlight(on)             — DTC fault flag
 *
 * refs keep their historical names so existing wiring stays intact:
 *   pinionGroup    = secondary-shaft output gear (stage-1 driver)
 *   reductionGroup = intermediate pinion shaft
 *   diffGroup      = crown wheel + differential + axles
 */

import * as THREE from 'three';

const DEFAULTS = {
  // Stage 1: secondary output gear → intermediate large gear
  secGearR:      24,   secGearTeeth: 22,   secGearW: 14,
  intGearR:      36,   intGearTeeth: 33,   intGearW: 12,
  // Stage 2: intermediate pinion → crown wheel on the differential
  pinionR:       15,   pinionTeeth:  15,   pinionW: 16,
  crownR:        52,   crownTeeth:   52,   crownW: 14,
  toothH:        1.6,
  // Axis offsets in the local frame (world: int at +18x/−57y, diff at −41.5x/−87y
  // relative to the secondary axis — a compact triangle inside the case).
  intOffset:  { x:  18,   z:  57 },
  diffOffset: { x: -41.5, z:  87 },
  // Differential carrier + axles (coaxial with the diff axis — audit F13)
  diffR:         36,   diffH: 26,
  axleR:          9,
  crownBolts:     8,
  finalDrive:  5.182,  // authoritative wheel rate (measured, Preve VT2)
};

export function buildOutputDrivetrain({
  name = 'output',
  materials = {},
  edgeMat = null,
  ...custom
} = {}) {
  const D = { ...DEFAULTS, ...custom };

  const group = new THREE.Group();
  group.name = name;
  group.userData.kind = 'output-drivetrain';

  // ── materials ─────────────────────────────────────────────────────────────
  const matGear = (materials.gear || new THREE.MeshPhysicalMaterial({
    color: 0xa6b3c0, metalness: 0.95, roughness: 0.2,
    transparent: true, opacity: 0.95,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matDiff = (materials.diff || new THREE.MeshPhysicalMaterial({
    color: 0x4e5560, metalness: 0.85, roughness: 0.4,
    transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matAxle = (materials.axle || new THREE.MeshPhysicalMaterial({
    color: 0x5e6a76, metalness: 0.92, roughness: 0.28,
    transparent: true, opacity: 0.94,
  })).clone();

  const geomCache = [];

  // Helper — spur/helical gear body + teeth into a target group.
  function buildGear(parent, R, teeth, W, mat) {
    const bg = new THREE.CylinderGeometry(R, R, W, 40, 1, false);
    geomCache.push(bg);
    const body = new THREE.Mesh(bg, mat);
    parent.add(body);
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const tw = (2 * Math.PI * R / teeth) * 0.55;
      const tg = new THREE.BoxGeometry(D.toothH, W, tw);
      geomCache.push(tg);
      const t = new THREE.Mesh(tg, mat);
      t.position.set(Math.cos(a) * (R + D.toothH/2), 0, Math.sin(a) * (R + D.toothH/2));
      t.lookAt(0, 0, 0);
      parent.add(t);
    }
    return body;
  }

  // ── 1. SECONDARY OUTPUT GEAR (stage-1 driver, on the secondary axis) ─────
  const pinionGroup = new THREE.Group();          // historical ref name
  pinionGroup.name = `${name}-sec-gear`;
  const pinionBody = buildGear(pinionGroup, D.secGearR, D.secGearTeeth, D.secGearW, matGear);
  group.add(pinionGroup);

  // ── 2. INTERMEDIATE "PINION SHAFT" (large gear + integral small pinion) ──
  const reductionGroup = new THREE.Group();       // historical ref name
  reductionGroup.name = `${name}-intermediate`;
  reductionGroup.position.set(D.intOffset.x, 0, D.intOffset.z);
  const redBody = buildGear(reductionGroup, D.intGearR, D.intGearTeeth, D.intGearW, matGear);
  // integral pinion sits one plane over (toward the crown wheel)
  const pinionSub = new THREE.Group();
  pinionSub.position.y = 16;
  buildGear(pinionSub, D.pinionR, D.pinionTeeth, D.pinionW, matGear);
  reductionGroup.add(pinionSub);
  // stub shaft joining gear and pinion, on taper-bearing journals
  {
    const sg = new THREE.CylinderGeometry(8, 8, 40, 16, 1, false);
    geomCache.push(sg);
    const s = new THREE.Mesh(sg, matAxle);
    s.position.y = 8;
    reductionGroup.add(s);
  }
  reductionGroup.rotation.y = Math.PI / D.intGearTeeth;   // half-tooth mesh offset
  group.add(reductionGroup);

  // ── 3. CROWN WHEEL + DIFFERENTIAL (own axis — audit F14) ─────────────────
  const diffGroup = new THREE.Group();
  diffGroup.name = `${name}-differential`;
  diffGroup.position.set(D.diffOffset.x, 0, D.diffOffset.z);

  // Crown wheel in the pinion's plane (y ≈ +16), bolted to the carrier.
  const crownGroup = new THREE.Group();
  crownGroup.position.y = 16;
  const diffBody = buildGear(crownGroup, D.crownR, D.crownTeeth, D.crownW, matGear);
  diffBody.material = matGear;
  // crown bolts on the wheel face
  for (let i = 0; i < D.crownBolts; i++) {
    const a = (i / D.crownBolts) * Math.PI * 2;
    const bg = new THREE.CylinderGeometry(2.6, 2.6, 3, 6);
    geomCache.push(bg);
    const b = new THREE.Mesh(bg, matAxle);
    b.position.set(Math.cos(a) * (D.crownR - 14), D.crownW/2 + 1.2, Math.sin(a) * (D.crownR - 14));
    crownGroup.add(b);
  }
  diffGroup.add(crownGroup);

  // Differential carrier behind the crown (+Y side = deeper into the case)
  const carrGeom = new THREE.CylinderGeometry(D.diffR, D.diffR * 0.92, D.diffH, 32, 1, false);
  geomCache.push(carrGeom);
  const carrier = new THREE.Mesh(carrGeom, matDiff);
  carrier.position.y = 16 + D.crownW/2 + D.diffH/2;
  diffGroup.add(carrier);
  const diffCapGeom = new THREE.CylinderGeometry(D.diffR * 0.6, D.diffR * 0.85, 8, 32, 1, false);
  geomCache.push(diffCapGeom);
  const diffCap = new THREE.Mesh(diffCapGeom, matDiff);
  diffCap.position.y = 16 + D.crownW/2 + D.diffH + 4;
  diffGroup.add(diffCap);

  // ── 4. AXLE STUBS — COAXIAL with the diff axis (audit F13: the old model
  //      pointed them 90° off the rotation axis, which cannot turn wheels).
  //      One exits toward the bell face (local −Y → world −Z), the other
  //      toward the cover side (+Y), through the differential oil seals.
  const axleGeomL = new THREE.CylinderGeometry(D.axleR, D.axleR, 46, 16, 1, false);
  const axleGeomR = new THREE.CylinderGeometry(D.axleR, D.axleR, 40, 16, 1, false);
  geomCache.push(axleGeomL, axleGeomR);
  const axleLeft = new THREE.Mesh(axleGeomL, matAxle);
  axleLeft.position.y = -14;                       // toward the bell/engine face
  diffGroup.add(axleLeft);
  const axleRight = new THREE.Mesh(axleGeomR, matAxle);
  axleRight.position.y = 16 + D.crownW/2 + D.diffH + 8 + 16;   // out the cover side
  diffGroup.add(axleRight);
  // CV-joint stub flares at the tips
  const cvGeom = new THREE.CylinderGeometry(D.axleR + 4.5, D.axleR + 1.5, 10, 16, 1, false);
  geomCache.push(cvGeom);
  const cvL = new THREE.Mesh(cvGeom, matAxle);
  cvL.rotation.x = Math.PI; cvL.position.y = -38;
  diffGroup.add(cvL);
  const cvR = new THREE.Mesh(cvGeom, matAxle);
  cvR.position.y = carrier.position.y + D.diffH/2 + 4 + 32;
  diffGroup.add(cvR);

  diffGroup.rotation.y = Math.PI / D.crownTeeth;   // half-tooth mesh offset
  group.add(diffGroup);

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    [ [pinionBody, pinionGroup], [redBody, reductionGroup],
      [diffBody, crownGroup], [carrier, diffGroup], [diffCap, diffGroup],
      [axleLeft, diffGroup], [axleRight, diffGroup] ].forEach(([mesh, parent]) => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 14), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      parent.add(eg);
      edgeMeshes.push(eg);
    });
  }

  // ── refs (historical names preserved) ─────────────────────────────────────
  const refs = {
    pinionGroup, reductionGroup, diffGroup,
    pinionBody, redBody, diffBody, diffCap, axleLeft, axleRight,
    materials: { matGear, matDiff, matAxle },
  };

  // ── live API ──────────────────────────────────────────────────────────────
  // Stage rates now follow the real meshes — and because there are TWO
  // external meshes, the differential turns the SAME direction as the
  // secondary, at N_sec / finalDrive (the authoritative measured rate).
  const stage1 = D.secGearR / D.intGearR;          // ≈ 0.667
  let _pinPhase = 0, _intPhase = Math.PI / D.intGearTeeth, _diffPhase = Math.PI / D.crownTeeth;
  const _PI2 = Math.PI * 2;

  group.setRotation = function (N_sec_rpm, dt = 0.016) {
    const wSec  = (N_sec_rpm / 60) * _PI2;
    const wInt  = -wSec * stage1;                  // stage-1 external mesh flips
    const wDiff =  wSec / D.finalDrive;            // two flips → same sign; true wheel rate
    _pinPhase  += wSec  * dt;
    _intPhase  += wInt  * dt;
    _diffPhase += wDiff * dt;
    if (_pinPhase > 1e6){ _pinPhase %= _PI2; _intPhase %= _PI2; _diffPhase %= _PI2; }
    pinionGroup.rotation.y    = _pinPhase;
    reductionGroup.rotation.y = _intPhase;
    diffGroup.rotation.y      = _diffPhase;
  };

  group.setTemp = function (t_C) {
    const tN = Math.max(0, Math.min(1, (t_C - 80) / 60));
    carrier.material.emissive.setHex(tN > 0.05 ? 0xff5520 : 0x000000);
    carrier.material.emissiveIntensity = tN * 0.4;
  };

  let _hlPhase = 0;
  group.setHighlight = function (on) {
    if (!on) {
      [redBody, diffBody].forEach(m => {
        m.material.emissive.setHex(0x000000);
        m.material.emissiveIntensity = 0;
      });
      carrier.material.emissive.setHex(0x000000);
      carrier.material.emissiveIntensity = 0;
      return;
    }
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    [redBody, diffBody].forEach(m => {
      m.material.emissive.setHex(0xff2244);
      m.material.emissiveIntensity = 0.4 + pulse * 0.5;
    });
    carrier.material.emissive.setHex(0xff2244);
    carrier.material.emissiveIntensity = 0.3 + pulse * 0.4;
  };

  return {
    group,
    refs,
    dispose() {
      geomCache.forEach(g => g.dispose());
      [matGear, matDiff, matAxle].forEach(m => m.dispose());
      edgeMeshes.forEach(eg => eg.geometry?.dispose());
    },
  };
}
