/**
 * lib/cvt-parts/output-drivetrain.js
 *
 * Punch VT2-VT3 output drivetrain — connects the secondary pulley's output
 * spline through a reduction gear set to the differential and the axle stubs.
 *
 * Real flow:
 *   Secondary spline (26T) ─┐
 *                            ├── Input pinion (26T)
 *                            ├── Reduction gear (large, ~70T)  → final-drive ratio ≈ 5.18
 *                            └── Differential ring gear
 *                                                  └── Differential carrier
 *                                                                  ├── Left axle stub
 *                                                                  └── Right axle stub
 *
 * Visual model:
 *   - Pinion gear (small, attached to secondary output)
 *   - Large reduction gear (meshing with pinion)
 *   - Differential housing (the spherical case)
 *   - Two axle stubs poking out either side
 *
 * Construction returns { group, refs, dispose } per the cross-cutting
 * principle.
 *
 * Public API:
 *   buildOutputDrivetrain({ materials, edgeMat, ...overrides }) => { group, refs, dispose }
 *
 *   group.setRotation(N_sec_rpm, dt)
 *      Pinion spins at N_sec (it's directly on the secondary shaft).
 *      Reduction gear spins at N_sec × (pinionTeeth / reductionTeeth).
 *      Differential rotates at the reduction gear speed.
 *      Axle stubs rotate at that same rate (we don't model differential
 *      action — both wheels treated as locked together).
 *
 *   group.setTemp(t_C) — heat tint on differential housing.
 *
 *   group.setHighlight(on) — DTC fault flag (e.g. final-drive gear wear).
 *
 * Local frame: pinion axis along +Y (matches secondary shaft orientation
 * after caller's rotation).  Reduction gear sits offset to +X.  Differential
 * sits further +Y from the reduction gear.
 */

import * as THREE from 'three';

const DEFAULTS = {
  // Real Punch VT2-VT3 reduction gear is smaller than the variator sheave.
  // Earlier reductionR=36 gave Ø72 which was almost half the sheave — too
  // large.  Pinion at Ø34 (typical) drives a reduction gear at Ø100.
  pinionR:        17,        // Ø34 input pinion (on secondary output)
  pinionTeeth:    24,
  reductionR:     50,        // Ø100 reduction gear (was Ø72)
  reductionTeeth: 62,
  centreDist:     67,        // pinion centre → reduction gear centre
  gearW:          16,        // axial width of gear bodies
  toothH:         1.5,
  diffR:          38,        // differential housing radius
  diffH:          44,
  axleR:          8,         // Ø16 axle stub
  axleL:          30,
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

  // ── 1. INPUT PINION (small gear, on secondary output axis) ───────────────
  const pinionGroup = new THREE.Group();
  pinionGroup.name = `${name}-pinion`;
  pinionGroup.position.set(0, 0, 0);

  const pinionBodyGeom = new THREE.CylinderGeometry(D.pinionR, D.pinionR, D.gearW, 28, 1, false);
  geomCache.push(pinionBodyGeom);
  const pinionBody = new THREE.Mesh(pinionBodyGeom, matGear);
  pinionGroup.add(pinionBody);

  for (let i = 0; i < D.pinionTeeth; i++) {
    const a = (i / D.pinionTeeth) * Math.PI * 2;
    const toothW = (2 * Math.PI * D.pinionR / D.pinionTeeth) * 0.55;
    const tg = new THREE.BoxGeometry(D.toothH, D.gearW, toothW);
    geomCache.push(tg);
    const t = new THREE.Mesh(tg, matGear);
    t.position.set(Math.cos(a) * (D.pinionR + D.toothH/2), 0, Math.sin(a) * (D.pinionR + D.toothH/2));
    t.lookAt(0, t.position.y, 0);
    pinionGroup.add(t);
  }
  group.add(pinionGroup);

  // ── 2. REDUCTION GEAR (large gear meshing with pinion) ───────────────────
  const reductionGroup = new THREE.Group();
  reductionGroup.name = `${name}-reduction`;
  // Offset along +X by centreDist; reduction gear axis parallel to pinion axis
  reductionGroup.position.set(D.centreDist, 0, 0);

  const redBodyGeom = new THREE.CylinderGeometry(D.reductionR, D.reductionR, D.gearW, 56, 1, false);
  geomCache.push(redBodyGeom);
  const redBody = new THREE.Mesh(redBodyGeom, matGear);
  reductionGroup.add(redBody);

  for (let i = 0; i < D.reductionTeeth; i++) {
    const a = (i / D.reductionTeeth) * Math.PI * 2;
    const toothW = (2 * Math.PI * D.reductionR / D.reductionTeeth) * 0.55;
    const tg = new THREE.BoxGeometry(D.toothH, D.gearW, toothW);
    geomCache.push(tg);
    const t = new THREE.Mesh(tg, matGear);
    t.position.set(Math.cos(a) * (D.reductionR + D.toothH/2), 0, Math.sin(a) * (D.reductionR + D.toothH/2));
    t.lookAt(0, t.position.y, 0);
    reductionGroup.add(t);
  }
  // Pre-rotate by half-tooth so teeth interlock visually
  reductionGroup.rotation.y = Math.PI / D.reductionTeeth;
  group.add(reductionGroup);

  // ── 3. DIFFERENTIAL HOUSING ──────────────────────────────────────────────
  // The differential is bolted to the side of the reduction gear (or built
  // into it).  Modelled as a spherical/cylindrical case with axle stubs
  // protruding either side along the gear axis.
  const diffGroup = new THREE.Group();
  diffGroup.name = `${name}-differential`;
  diffGroup.position.set(D.centreDist, 0, 0);     // co-axial with reduction gear

  const diffGeom = new THREE.CylinderGeometry(D.diffR, D.diffR, D.diffH, 32, 1, false);
  geomCache.push(diffGeom);
  const diffBody = new THREE.Mesh(diffGeom, matDiff);
  diffBody.position.y = D.gearW/2 + D.diffH/2 + 2;   // attached to top of reduction gear (in local +Y)
  diffGroup.add(diffBody);

  // Bell-housing front cap (a wider ring at the front of the differential)
  const diffCapGeom = new THREE.CylinderGeometry(D.diffR + 3, D.diffR, 4, 32, 1, false);
  geomCache.push(diffCapGeom);
  const diffCap = new THREE.Mesh(diffCapGeom, matDiff);
  diffCap.position.y = D.gearW/2 + D.diffH + 4;
  diffGroup.add(diffCap);

  // ── 4. AXLE STUBS (Ø14, project either side along the gear axis) ─────────
  // These are the constant-velocity joints that connect to the front axles.
  // Modelled as short cylinders with hex/splined detail.
  const axleStubGeom = new THREE.CylinderGeometry(D.axleR, D.axleR, D.axleL, 16, 1, false);
  geomCache.push(axleStubGeom);
  const axleLeft = new THREE.Mesh(axleStubGeom, matAxle);
  axleLeft.position.y = D.gearW/2 + D.diffH/2 + 2;
  axleLeft.position.x = -(D.diffR + D.axleL/2);
  axleLeft.rotation.z = Math.PI/2;       // lie on its side, along X
  diffGroup.add(axleLeft);
  const axleRight = new THREE.Mesh(axleStubGeom, matAxle);
  axleRight.position.y = D.gearW/2 + D.diffH/2 + 2;
  axleRight.position.x = +(D.diffR + D.axleL/2);
  axleRight.rotation.z = Math.PI/2;
  diffGroup.add(axleRight);

  group.add(diffGroup);

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    [pinionBody, redBody, diffBody, diffCap, axleLeft, axleRight].forEach(mesh => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 14), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      const parent = (mesh === pinionBody) ? pinionGroup
                   : (mesh === redBody)    ? reductionGroup
                   : diffGroup;
      parent.add(eg);
      edgeMeshes.push(eg);
    });
  }

  // ── refs ──────────────────────────────────────────────────────────────────
  const refs = {
    pinionGroup, reductionGroup, diffGroup,
    pinionBody, redBody, diffBody, diffCap, axleLeft, axleRight,
    materials: { matGear, matDiff, matAxle },
  };

  // ── live API ──────────────────────────────────────────────────────────────
  // A single visible gear pair cannot represent the real ~5.39:1 final drive
  // to scale (the reduction gear would have to be ~5× the pinion diameter,
  // dominating the frame).  Real transaxles use two reduction stages.  So we
  // separate VISUAL meshing from the PHYSICAL output speed:
  //   - pinion spins at N_sec (correct — it's on the secondary shaft)
  //   - reduction + diff + axles spin at the TRUE wheel rate N_sec / finalDrive
  //     (so axle rpm is physically accurate against the data)
  // The default finalDrive can be overridden per-vehicle.
  // VISUAL meshing must be correct: the reduction gear is driven by the pinion,
  // so it turns at the first-stage tooth ratio (pinionTeeth/reductionTeeth) — NOT
  // the full final-drive ratio.  The differential and axle stubs are COAXIAL with
  // the reduction gear, so they share that rate (a single visible stage can't also
  // reproduce the true ~5.18 wheel rpm — that lives in the authoritative N_sec data).
  const meshRatio = D.pinionTeeth / D.reductionTeeth;   // ≈ 22/56 ≈ 0.393
  let _pinionPhase = 0;
  let _reductionPhase = Math.PI / D.reductionTeeth;
  let _diffPhase = 0;
  let _axlePhase = 0;
  const _PI2 = Math.PI * 2;

  group.setRotation = function (N_sec_rpm, dt = 0.016) {
    const wPin = (N_sec_rpm / 60) * _PI2;
    const wRed = wPin * meshRatio;                 // reduction gear meshes with pinion
    _pinionPhase    += wPin * dt;
    _reductionPhase -= wRed * dt;                  // meshing → opposite sign
    _diffPhase      -= wRed * dt;                  // coaxial with reduction gear
    _axlePhase      -= wRed * dt;                  // axle stubs on the diff
    // wrap to keep float precision over a long showcase
    if (_pinionPhase > 1e6){ _pinionPhase%=_PI2; _reductionPhase%=_PI2; _diffPhase%=_PI2; _axlePhase%=_PI2; }
    pinionGroup.rotation.y    = _pinionPhase;
    reductionGroup.rotation.y = _reductionPhase;
    diffGroup.rotation.y      = _diffPhase;
    axleLeft.rotation.y       = _axlePhase;
    axleRight.rotation.y      = _axlePhase;
  };

  group.setTemp = function (t_C) {
    const tN = Math.max(0, Math.min(1, (t_C - 80) / 60));
    diffBody.material.emissive.setHex(tN > 0.05 ? 0xff5520 : 0x000000);
    diffBody.material.emissiveIntensity = tN * 0.4;
  };

  let _hlPhase = 0;
  group.setHighlight = function (on) {
    if (!on) {
      [redBody, diffBody].forEach(m => {
        m.material.emissive.setHex(0x000000);
        m.material.emissiveIntensity = 0;
      });
      return;
    }
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    [redBody, diffBody].forEach(m => {
      m.material.emissive.setHex(0xff2244);
      m.material.emissiveIntensity = 0.4 + pulse * 0.5;
    });
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
