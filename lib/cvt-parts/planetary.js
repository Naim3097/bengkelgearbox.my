/**
 * lib/cvt-parts/planetary.js
 *
 * Punch VT2-VT3 compound (double-pinion) planetary gear set — used for the
 * reverse-direction path.  Sun gear is driven by the input (clutch hub),
 * three INNER planets mesh with the sun, three OUTER planets mesh with the
 * INNER planets and the ring gear (forming 3 pairs / 6 planets total — the
 * "compound" arrangement Punch uses to get a forward-reduction reverse
 * without reversing the sun→ring sign).  The carrier holds the brake band.
 *
 * Kinematics modelled (carrier-held reverse stage):
 *   Mode D  → planetary locked (sun + carrier + ring spin together at N_in)
 *   Mode R  → CARRIER stopped by brake;
 *             ring_rpm = -N_in × (sun_teeth / ring_teeth)
 *             each inner planet spins = N_in × (sun_teeth / planet_teeth)
 *             each outer planet spins in the opposite sense at the same
 *             tangential speed (since it meshes with the inner planet).
 *   Mode N/P → everything idle
 *
 * Typical tooth counts (Punch VT2-VT3 inferred):
 *   sun = 30, planet = 15, ring = 60  →  reverse ratio = -0.5 (ring spins
 *   ½× of input speed in opposite direction).  Multiplied through the
 *   variator's low-gear ratio and the final drive, this gives the expected
 *   ~15-20 kph max reverse speed for a typical Punch application.
 *
 * Construction returns { group, refs, dispose } per the cross-cutting
 * principle in BYKI_3D_DIAGNOSTIC_BUILD_PLAN.md §4.1.
 *
 * Public API:
 *   buildPlanetary({ materials, edgeMat, ...overrides }) => { group, refs, dispose }
 *
 *   group.setKinematics(N_in_rpm, mode)
 *      mode = 'D' | 'S'         → locked (1:1)
 *      mode = 'R'               → ring brake on, carrier reverses
 *      mode = 'N' | 'P' | other → idle, no rotation update
 *
 *   group.setRingBrake(engaged)  → emissive on the brake band
 *   group.setHighlight(on)       → DTC fault flag (red pulse)
 *
 * Local frame: axis along +Y (matches clutch-pack convention).  Caller is
 * responsible for axis alignment to the rest of the drivetrain.
 */

import * as THREE from 'three';

const DEFAULTS = {
  sunR:         12,       // Ø24 sun gear (smaller to make room for paired pinions)
  sunTeeth:     24,
  innerPlanetR: 7,        // Ø14 inner pinion (meshes with sun)
  innerPlanetTeeth: 14,
  outerPlanetR: 7,        // Ø14 outer pinion (meshes with inner planet AND ring)
  outerPlanetTeeth: 14,
  planetPairs:  3,        // 3 pairs = 6 planets total (compound double-pinion)
  ringInnerR:   40,       // sun + 2×inner + 2×outer ≈ 12 + 14 + 14 = 40
  ringOuterR:   50,
  ringTeeth:    72,
  carrierR:     34,       // disc that holds both planet pin sets
  bandOuterR:   52,       // brake band wraps the CARRIER's drum OD (it's the carrier that's held)
  bandThick:    1.5,
  bandWidth:    7,        // axial width of the brake band
  width:        12,       // total axial extent of the gear set
  toothH:       1.2,      // visible tooth height (radial)
};

export function buildPlanetary({
  name = 'planetary',
  materials = {},
  edgeMat = null,
  ...custom
} = {}) {
  const D = { ...DEFAULTS, ...custom };

  const group = new THREE.Group();
  group.name = name;
  group.userData.kind = 'planetary';

  // ── materials ─────────────────────────────────────────────────────────────
  const matSun = (materials.sun || new THREE.MeshPhysicalMaterial({
    color: 0xa6b3c0, metalness: 0.92, roughness: 0.22,
    transparent: true, opacity: 0.95,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matPlanet = (materials.planet || new THREE.MeshPhysicalMaterial({
    color: 0xb4c0ca, metalness: 0.92, roughness: 0.2,
    transparent: true, opacity: 0.95,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matRing = (materials.ring || new THREE.MeshPhysicalMaterial({
    color: 0x7c8a98, metalness: 0.88, roughness: 0.3,
    transparent: true, opacity: 0.88, side: THREE.DoubleSide,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matCarrier = (materials.carrier || new THREE.MeshPhysicalMaterial({
    color: 0x5e6a76, metalness: 0.8, roughness: 0.4,
    transparent: true, opacity: 0.72, side: THREE.DoubleSide,
    emissive: 0x0a131a, emissiveIntensity: 0.2,
  })).clone();
  const matBand = (materials.band || new THREE.MeshPhysicalMaterial({
    color: 0x4a3d2e, metalness: 0.2, roughness: 0.85,
    transparent: true, opacity: 0.9,
    emissive: 0x1a0f08, emissiveIntensity: 0.2,
  })).clone();

  const geomCache = [];

  // Helper — build a gear-disc body + radial teeth into a target Group.
  function buildGear(parent, R, teeth, mat) {
    const bg = new THREE.CylinderGeometry(R, R, D.width, 24, 1, false);
    geomCache.push(bg);
    const body = new THREE.Mesh(bg, mat);
    parent.add(body);
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * Math.PI * 2;
      const tw = (2 * Math.PI * R / teeth) * 0.55;
      const tg = new THREE.BoxGeometry(D.toothH, D.width, tw);
      geomCache.push(tg);
      const t = new THREE.Mesh(tg, mat);
      t.position.set(Math.cos(a) * (R + D.toothH/2), 0, Math.sin(a) * (R + D.toothH/2));
      t.lookAt(0, 0, 0);
      parent.add(t);
    }
    return body;
  }

  // ── 1. SUN GEAR ───────────────────────────────────────────────────────────
  const sunGroup = new THREE.Group();
  sunGroup.name = `${name}-sun`;
  const sunBody = buildGear(sunGroup, D.sunR, D.sunTeeth, matSun);
  sunBody.name = `${name}-sun-body`;
  group.add(sunGroup);

  // ── 2. PLANET GEARS — 3 PAIRS (compound double-pinion) ───────────────────
  // Each "pair" is one inner planet (meshes with sun) + one outer planet
  // (meshes with inner planet AND ring).  The pair occupies adjacent angular
  // positions around the carrier.  All planet pins are rigidly mounted to a
  // single carrier disc; they revolve when the carrier spins.
  const innerOrbitR = D.sunR + D.innerPlanetR;             // inner planet axis
  const outerOrbitR = innerOrbitR + (D.innerPlanetR + D.outerPlanetR);
  // For visual layout the outer planet sits at a slight angular OFFSET from
  // its paired inner planet (so both meshes are tangentially visible).
  const pairAngularOffset = Math.PI / 9;                   // ~20° angular gap

  const carrierGroup = new THREE.Group();
  carrierGroup.name = `${name}-carrier`;
  const innerPlanetMeshes = [];
  const outerPlanetMeshes = [];

  for (let p = 0; p < D.planetPairs; p++) {
    const aBase = (p / D.planetPairs) * Math.PI * 2;

    // -- INNER planet --
    const innerGroup = new THREE.Group();
    innerGroup.name = `${name}-planet-inner-${p}`;
    innerGroup.position.set(
      Math.cos(aBase) * innerOrbitR, 0,
      Math.sin(aBase) * innerOrbitR
    );
    buildGear(innerGroup, D.innerPlanetR, D.innerPlanetTeeth, matPlanet);
    carrierGroup.add(innerGroup);
    innerPlanetMeshes.push(innerGroup);

    // -- OUTER planet --
    const aOuter = aBase + pairAngularOffset;
    const outerGroup = new THREE.Group();
    outerGroup.name = `${name}-planet-outer-${p}`;
    outerGroup.position.set(
      Math.cos(aOuter) * outerOrbitR, 0,
      Math.sin(aOuter) * outerOrbitR
    );
    buildGear(outerGroup, D.outerPlanetR, D.outerPlanetTeeth, matPlanet);
    carrierGroup.add(outerGroup);
    outerPlanetMeshes.push(outerGroup);
  }
  // Back-compat alias (kept for any external refs)
  const planetMeshes = innerPlanetMeshes;

  // Carrier disc — visual link between planet centres
  const carrierDiscShape = new THREE.Shape();
  carrierDiscShape.absarc(0, 0, D.carrierR, 0, Math.PI * 2, false);
  const carrierHole = new THREE.Path();
  carrierHole.absarc(0, 0, D.sunR + 1.5, 0, Math.PI * 2, true);
  carrierDiscShape.holes.push(carrierHole);
  const carrierDiscGeom = new THREE.ExtrudeGeometry(carrierDiscShape, {
    depth: 1.5, bevelEnabled: false, curveSegments: 36,
  });
  carrierDiscGeom.rotateX(-Math.PI/2);
  carrierDiscGeom.translate(0, D.width/2 - 0.75, 0);   // front face of disc
  geomCache.push(carrierDiscGeom);
  const carrierDisc = new THREE.Mesh(carrierDiscGeom, matCarrier);
  carrierDisc.name = `${name}-carrier-disc`;
  carrierGroup.add(carrierDisc);

  group.add(carrierGroup);

  // ── 3. RING GEAR ──────────────────────────────────────────────────────────
  // Outer ring with internal teeth.  Modelled as a thick ring with teeth
  // protruding INWARD (toward the planets).
  const ringShape = new THREE.Shape();
  ringShape.absarc(0, 0, D.ringOuterR, 0, Math.PI * 2, false);
  const ringHole = new THREE.Path();
  ringHole.absarc(0, 0, D.ringInnerR + D.toothH, 0, Math.PI * 2, true);
  ringShape.holes.push(ringHole);
  const ringBodyGeom = new THREE.ExtrudeGeometry(ringShape, {
    depth: D.width, bevelEnabled: false, curveSegments: 64,
  });
  ringBodyGeom.rotateX(-Math.PI/2);
  ringBodyGeom.translate(0, -D.width/2, 0);
  geomCache.push(ringBodyGeom);

  const ringGroup = new THREE.Group();
  ringGroup.name = `${name}-ring`;
  const ringBody = new THREE.Mesh(ringBodyGeom, matRing);
  ringBody.name = `${name}-ring-body`;
  ringGroup.add(ringBody);

  // Internal teeth — small boxes protruding inward at ringInnerR
  for (let i = 0; i < D.ringTeeth; i++) {
    const a = (i / D.ringTeeth) * Math.PI * 2;
    const toothW = (2 * Math.PI * D.ringInnerR / D.ringTeeth) * 0.5;
    const tg = new THREE.BoxGeometry(D.toothH, D.width, toothW);
    geomCache.push(tg);
    const t = new THREE.Mesh(tg, matRing);
    t.position.set(Math.cos(a) * (D.ringInnerR + D.toothH/2), 0, Math.sin(a) * (D.ringInnerR + D.toothH/2));
    t.lookAt(0, 0, 0);
    ringGroup.add(t);
  }
  group.add(ringGroup);

  // ── 4. REVERSE BRAKE BAND ─────────────────────────────────────────────────
  // Thin friction band wrapping the CARRIER drum (which extends outboard of
  // the ring in this compact layout).  Holding the carrier with sun=input
  // gives ring=output × -(Ns/Nr) — the classic forward-reduction reverse.
  // Lights up red when engaged (selector = R).
  const bandShape = new THREE.Shape();
  bandShape.absarc(0, 0, D.bandOuterR, 0, Math.PI * 2, false);
  const bandHole = new THREE.Path();
  bandHole.absarc(0, 0, D.bandOuterR - D.bandThick, 0, Math.PI * 2, true);
  bandShape.holes.push(bandHole);
  const bandGeom = new THREE.ExtrudeGeometry(bandShape, {
    depth: D.bandWidth, bevelEnabled: false, curveSegments: 56,
  });
  bandGeom.rotateX(-Math.PI/2);
  bandGeom.translate(0, -D.bandWidth/2, 0);
  geomCache.push(bandGeom);
  const band = new THREE.Mesh(bandGeom, matBand);
  band.name = `${name}-band`;
  group.add(band);

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    // Major contour edges only — teeth would explode the line count
    [sunBody, carrierDisc, ringBody, band].forEach(mesh => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 14), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      group.add(eg);
      edgeMeshes.push(eg);
    });
  }

  // ── refs ──────────────────────────────────────────────────────────────────
  const refs = {
    sunGroup, carrierGroup, ringGroup, band, carrierDisc, ringBody,
    sunBody,
    planetMeshes,                      // back-compat alias = innerPlanetMeshes
    innerPlanetMeshes, outerPlanetMeshes,
    materials: { matSun, matPlanet, matRing, matCarrier, matBand },
  };

  // ── live API ──────────────────────────────────────────────────────────────
  // Carrier-held reverse stage (sun=input, ring=output, carrier braked):
  //   ω_ring / ω_sun = -(N_sun / N_ring)  with carrier stationary.
  //   For Ns=24, Nr=72: ratio = -0.333 (ring reverses at ⅓ × sun speed).
  const reverseRatio = -(D.sunTeeth / D.ringTeeth);
  const innerPlanetSpinPerSun = D.sunTeeth / D.innerPlanetTeeth; // inner pinion spin
  const outerPlanetSpinPerInner = D.innerPlanetTeeth / D.outerPlanetTeeth;

  let _sunPhase = 0;
  let _carrierPhase = 0;
  let _ringPhase = 0;
  const _innerPlanetPhases = new Array(D.planetPairs).fill(0);
  const _outerPlanetPhases = new Array(D.planetPairs).fill(0);

  /**
   * setKinematics(N_in_rpm, mode, dt)
   *   N_in_rpm: input speed (engine / clutch hub rpm)
   *   mode:     'D' | 'S' | 'R' | 'N' | 'P'
   *   dt:       seconds since last call
   */
  group.setKinematics = function (N_in_rpm, mode, dt = 0.016) {
    const wIn = (N_in_rpm / 60) * 2 * Math.PI;          // rad/s

    if (mode === 'D' || mode === 'S') {
      // Locked: sun + carrier + ring spin together at N_in (no relative motion)
      _sunPhase += wIn * dt;
      _carrierPhase += wIn * dt;
      _ringPhase += wIn * dt;
      sunGroup.rotation.y = _sunPhase;
      carrierGroup.rotation.y = _carrierPhase;
      ringGroup.rotation.y = _ringPhase;
    } else if (mode === 'R') {
      // CARRIER held by brake → reverse motion appears on the RING (output)
      _sunPhase += wIn * dt;
      const wRing = wIn * reverseRatio;
      _ringPhase += wRing * dt;
      // Carrier stationary (don't advance phase)
      sunGroup.rotation.y = _sunPhase;
      ringGroup.rotation.y = _ringPhase;
      // Inner planets spin on their pins (driven by the sun);
      // outer planets spin in the opposite sense at a proportional rate.
      const wInner = wIn * innerPlanetSpinPerSun;
      const wOuter = -wInner * outerPlanetSpinPerInner;
      for (let p = 0; p < D.planetPairs; p++) {
        _innerPlanetPhases[p] += wInner * dt;
        _outerPlanetPhases[p] += wOuter * dt;
        innerPlanetMeshes[p].rotation.y = _innerPlanetPhases[p];
        outerPlanetMeshes[p].rotation.y = _outerPlanetPhases[p];
      }
    } else {
      // P / N / unknown → idle, no rotation advance
    }
  };

  /**
   * setRingBrake(engaged) — visual indication that the reverse band is
   * clamping the CARRIER drum.  Engaged in 'R' mode; released otherwise.
   * (Name kept for back-compat with callers in unit.html.)
   */
  const _baseBandColor = new THREE.Color(0x1a0f08);
  const _hotBandColor  = new THREE.Color(0xff5a20);
  group.setRingBrake = function (engaged) {
    if (engaged) {
      band.material.emissive.copy(_hotBandColor);
      band.material.emissiveIntensity = 0.7;
      // Tint the carrier disc so the user sees "this is what's held"
      carrierDisc.material.emissive.setHex(0x3a1c08);
      carrierDisc.material.emissiveIntensity = 0.35;
    } else {
      band.material.emissive.copy(_baseBandColor);
      band.material.emissiveIntensity = 0.2;
      carrierDisc.material.emissive.setHex(0x0a131a);
      carrierDisc.material.emissiveIntensity = 0.2;
    }
  };
  // Alias for clearer naming going forward
  group.setCarrierBrake = group.setRingBrake;

  /**
   * setHighlight(on) — Phase-5 DTC fault flag (e.g. reverse-engagement fault).
   * Pulses sun + ring + carrier in red.
   */
  let _hlPhase = 0;
  group.setHighlight = function (on) {
    if (!on) {
      [sunBody, carrierDisc, ringBody].forEach(m => {
        m.material.emissive.setHex(0x000000);
        m.material.emissiveIntensity = 0;
      });
      return;
    }
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    [sunBody, carrierDisc, ringBody].forEach(m => {
      m.material.emissive.setHex(0xff2244);
      m.material.emissiveIntensity = 0.3 + pulse * 0.5;
    });
  };

  return {
    group,
    refs,
    dispose() {
      geomCache.forEach(g => g.dispose());
      [matSun, matPlanet, matRing, matCarrier, matBand].forEach(m => m.dispose());
      edgeMeshes.forEach(eg => eg.geometry?.dispose());
    },
  };
}
