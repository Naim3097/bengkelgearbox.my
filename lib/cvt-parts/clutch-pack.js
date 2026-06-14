/**
 * lib/cvt-parts/clutch-pack.js
 *
 * Punch VT2-VT3 multi-plate wet clutch pack.
 *
 * One module, used twice in unit.html — once for the forward (D) clutch and
 * once for the reverse (R) clutch.  Each instance is independently driven by
 * live telemetry through the live API methods:
 *
 *   group.setStroke(p_bar)   — piston travel proportional to clutch pressure
 *   group.setSlip(pct)       — friction-disc rotational oscillation when slipping
 *   group.setTemp(t_C)       — emissive heat tint on friction plates
 *   group.setHighlight(bool) — DTC fault flag (red pulse) — used by Phase 5
 *
 * Construction returns { group, refs, dispose } per the cross-cutting principle
 * defined in BYKI_3D_DIAGNOSTIC_BUILD_PLAN.md §4.1.
 *
 * Public API:
 *   buildClutchPack({ name, materials, edgeMat, ...overrides }) => { group, refs, dispose }
 *
 * The caller owns positioning — this module always builds in its own local
 * frame with the piston at y=0 and the pack growing in +Y.
 */

import * as THREE from 'three';

const DEFAULTS = {
  outerR:         38,    // Ø76 housing OD (typical Punch VT2-VT3 clutch pack)
  innerR:         18,    // Ø36 splined hub through centre
  plateCount:     6,     // 3 friction + 3 steel alternating
  plateThickness: 1.6,   // mm each
  plateGap:       0.5,   // mm gap when released
  housingThk:     4,     // mm drum wall + top cap
  pistonThk:      8,     // hydraulic apply piston
  pistonStroke:   4,     // max axial travel (mm)
  hubLen:         48,    // central spline hub length
  fullEngageBar:  18,    // bar pressure at which stroke = pistonStroke
  springR:        30,    // return-spring torus mean radius
  springWireR:    1.0,   // return-spring wire radius
};

export function buildClutchPack({
  name = 'clutch',
  materials = {},
  edgeMat = null,
  // Geometry overrides
  ...custom
} = {}) {
  const D = { ...DEFAULTS, ...custom };

  const group = new THREE.Group();
  group.name = name;
  group.userData.kind = 'clutch-pack';

  // ── materials ─────────────────────────────────────────────────────────────
  // If caller supplied shared materials, clone them so each instance can drive
  // its own emissive without cross-talk.
  const matHousing = (materials.housing || new THREE.MeshPhysicalMaterial({
    color: 0x6b7884, metalness: 0.85, roughness: 0.4,
    transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matSteel = (materials.steel || new THREE.MeshPhysicalMaterial({
    color: 0xa6b3c0, metalness: 0.95, roughness: 0.18,
    transparent: true, opacity: 0.95,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matFriction = (materials.friction || new THREE.MeshPhysicalMaterial({
    color: 0x4a3d2e, metalness: 0.1, roughness: 0.85,
    emissive: 0x1a0f08, emissiveIntensity: 0.2,
  })).clone();
  const matPiston = (materials.piston || new THREE.MeshPhysicalMaterial({
    color: 0x8a96a3, metalness: 0.9, roughness: 0.25,
    transparent: true, opacity: 0.9,
  })).clone();
  const matSpring = (materials.spring || new THREE.MeshPhysicalMaterial({
    color: 0xc7a05a, metalness: 0.7, roughness: 0.35,
    emissive: 0x3a2810, emissiveIntensity: 0.3,
  })).clone();

  // ── geometry primitives (cached for dispose) ─────────────────────────────
  const geomCache = [];

  // Stack heights
  const stackHeight = D.plateCount * D.plateThickness + (D.plateCount - 1) * D.plateGap;
  const totalH = D.pistonThk + stackHeight + 4;   // 4 mm top clearance under cap

  // 1. Drum (open cylindrical housing) — lathe profile
  //    Profile traces drum wall cross-section.  Drum is open at the bottom
  //    (so we can see plates inside) and closed at the top.
  const drumPts = [
    [D.innerR + 3,            0],                    // inner-bottom corner (annular base ring)
    [D.outerR + D.housingThk, 0],                    // outer-bottom corner
    [D.outerR + D.housingThk, totalH],               // up outer wall
    [D.outerR + D.housingThk - 2, totalH + 2],       // top chamfer outward
    [D.innerR + 4,            totalH + 2],           // top cap inward
    [D.innerR + 4,            totalH - 2],           // top cap underside
    [D.outerR,                totalH - 2],           // top cap underside to inner drum wall
    [D.outerR,                3],                    // down inside of drum wall
    [D.innerR + 3,            3],                    // close inner base
    [D.innerR + 3,            0],                    // back to start
  ];
  const drumGeom = new THREE.LatheGeometry(
    drumPts.map(p => new THREE.Vector2(p[0], p[1])), 48
  );
  drumGeom.computeVertexNormals();
  geomCache.push(drumGeom);
  const drum = new THREE.Mesh(drumGeom, matHousing);
  drum.name = `${name}-drum`;
  group.add(drum);

  // 2. Splined hub (central column the friction discs spline onto)
  const hubPts = [
    [0,             -10],
    [D.innerR,      -10],
    [D.innerR,      D.hubLen - 10],
    [D.innerR - 2,  D.hubLen - 10],
    [D.innerR - 2,  D.hubLen - 8],
    [0,             D.hubLen - 8],
  ];
  const hubGeom = new THREE.LatheGeometry(
    hubPts.map(p => new THREE.Vector2(p[0], p[1])), 32
  );
  hubGeom.computeVertexNormals();
  geomCache.push(hubGeom);
  const hub = new THREE.Mesh(hubGeom, matSteel);
  hub.name = `${name}-hub`;
  group.add(hub);

  // 2a. Hub spline teeth (visual texture — fine axial ridges)
  const splineCount = 24;
  for (let i = 0; i < splineCount; i++) {
    const a = (i / splineCount) * Math.PI * 2;
    const bg = new THREE.BoxGeometry(0.5, D.hubLen - 4, 0.7);
    const m = new THREE.Mesh(bg, matSteel);
    m.position.set(Math.cos(a) * (D.innerR + 0.4), (D.hubLen - 8) / 2 - 6, Math.sin(a) * (D.innerR + 0.4));
    m.lookAt(0, m.position.y, 0);
    group.add(m);
    geomCache.push(bg);
  }

  // 3. Apply piston (annular disc at base of stack)
  //    Position y starts at D.pistonThk/2; setStroke() raises it.
  const pistonPts = [
    [D.innerR + 4,          0],
    [D.outerR - 1,          0],
    [D.outerR - 1,          D.pistonThk],
    [D.outerR - 3,          D.pistonThk + 1.5],
    [D.innerR + 6,          D.pistonThk + 1.5],
    [D.innerR + 4,          D.pistonThk - 1],
    [D.innerR + 4,          0],
  ];
  const pistonGeom = new THREE.LatheGeometry(
    pistonPts.map(p => new THREE.Vector2(p[0], p[1])), 48
  );
  pistonGeom.computeVertexNormals();
  geomCache.push(pistonGeom);
  const piston = new THREE.Mesh(pistonGeom, matPiston);
  piston.name = `${name}-piston`;
  piston.position.y = 0;             // top of piston body at y = pistonThk
  group.add(piston);

  // 4. Return spring (single Bellville-stack representation — a torus ring)
  //    Sits between piston top and bottom plate; visible through drum opening.
  const springGeom = new THREE.TorusGeometry(D.springR, D.springWireR, 5, 32);
  springGeom.rotateX(Math.PI / 2);
  springGeom.translate(0, D.pistonThk + 2, 0);
  geomCache.push(springGeom);
  const spring = new THREE.Mesh(springGeom, matSpring);
  spring.name = `${name}-spring`;
  group.add(spring);

  // 5. Alternating friction / steel plates (the actual clutch stack)
  //    Friction plate = splined to inner hub (rotates with input).
  //    Steel plate    = splined to outer drum (rotates with output).
  //    The two surfaces rub when pressed together.
  const plates = [];
  const plateGroup = new THREE.Group();
  plateGroup.name = `${name}-plates`;
  group.add(plateGroup);

  const platesBaseY = D.pistonThk + 4;   // 4 mm above piston (spring sits between)
  for (let i = 0; i < D.plateCount; i++) {
    const isFriction = (i % 2 === 0);
    // Hollow disc geometry: ring extruded to plate thickness
    const ringShape = new THREE.Shape();
    ringShape.absarc(0, 0, D.outerR - 0.5, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, D.innerR + 0.5, 0, Math.PI * 2, true);
    ringShape.holes.push(hole);
    const plateGeom = new THREE.ExtrudeGeometry(ringShape, {
      depth: D.plateThickness, bevelEnabled: false, curveSegments: 32,
    });
    plateGeom.rotateX(-Math.PI / 2);     // make depth align with +Y
    geomCache.push(plateGeom);

    const mat = isFriction ? matFriction : matSteel;
    const m = new THREE.Mesh(plateGeom, mat);
    m.name = `${name}-plate-${i}-${isFriction ? 'fric' : 'steel'}`;
    m.userData.isFriction = isFriction;
    m.userData.idx = i;
    // basePos = bottom-face y of plate when fully RELEASED
    m.userData.basePos = platesBaseY + i * (D.plateThickness + D.plateGap);
    m.position.y = m.userData.basePos;
    plateGroup.add(m);
    plates.push(m);
  }

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    const candidates = [drum, hub, piston, spring, ...plates];
    candidates.forEach(mesh => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 14), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      eg.userData.followsMesh = mesh;   // for plates: edge follows plate y
      group.add(eg);
      edgeMeshes.push(eg);
    });
  }

  // ── refs ──────────────────────────────────────────────────────────────────
  const refs = {
    drum, hub, piston, spring,
    plates, plateGroup, edgeMeshes,
    materials: { matHousing, matSteel, matFriction, matPiston, matSpring },
  };

  // ── Live API ──────────────────────────────────────────────────────────────

  /**
   * setStroke(p_bar) — push the piston axially in proportion to commanded
   * pressure.  At p_bar=0 the piston is fully retracted; at p_bar >=
   * fullEngageBar the piston is at +pistonStroke and the plate stack is
   * compressed (no inter-plate gap).
   */
  group.setStroke = function (p_bar) {
    const strokeN = Math.max(0, Math.min(1, p_bar / D.fullEngageBar));
    const stroke = strokeN * D.pistonStroke;
    piston.position.y = stroke;

    // Compress plate stack.  When fully engaged, plate i moves down by
    // (plateCount-1-i) gap-shares so the stack squeezes uniformly.
    // (Plate 0 is at the bottom = nearest the piston.)
    const gapsClosed = strokeN;
    for (let i = 0; i < plates.length; i++) {
      const m = plates[i];
      const compression = gapsClosed * i * D.plateGap;
      const newY = m.userData.basePos - compression + stroke;
      m.position.y = newY;
    }

    // Update edge meshes that follow plates / piston
    edgeMeshes.forEach(eg => {
      if (eg.userData.followsMesh && eg.userData.followsMesh.userData.isFriction !== undefined) {
        eg.position.y = eg.userData.followsMesh.position.y;
      } else if (eg.userData.followsMesh === piston) {
        eg.position.y = piston.position.y;
      }
    });
  };

  /**
   * setSlip(pct) — small rotational dither across the friction plates when
   * the clutch is engaged but slipping (pct > 0).  Above ~10 % slip the
   * dither becomes visible; below 1 % it's effectively still.
   */
  let _slipPhase = 0;
  let _lastSlipT = performance.now();
  // The dither is a RELATIVE offset stored on the group; the caller composes it
  // with the plate base spin (`plateGroup.rotation.y = baseSpin + slipDither`) so
  // the spin write no longer clobbers the slip wobble (fixes the dead-dither M4).
  group.slipDither = 0;
  group.setSlip = function (slip_pct) {
    const now = performance.now();
    const dt = Math.min(0.05, (now - _lastSlipT) / 1000);
    _lastSlipT = now;
    const slipN = Math.max(0, Math.min(1, slip_pct / 25));   // saturates at 25 %
    _slipPhase += dt * (8 + 30 * slipN);
    const amp = slipN * 0.08;                                  // rad — barely visible at low slip
    group.slipDither = Math.sin(_slipPhase) * amp;
  };

  /**
   * setTemp(t_C) — drive emissive on friction plates.  Below 100 °C the
   * plates render with their default earthy tint; above 100 °C they shift
   * toward red-amber.  At 150 °C they pulse (≈3 Hz).
   */
  const _baseFricColor = new THREE.Color(0x1a0f08);
  const _hotFricColor  = new THREE.Color(0xff3010);
  group.setTemp = function (t_C) {
    const tN = Math.max(0, Math.min(1, (t_C - 100) / 80));
    const pulse = (t_C > 150)
      ? (0.5 + 0.5 * Math.sin(performance.now() * 0.018))
      : 1;
    plates.forEach(m => {
      if (!m.userData.isFriction) return;
      m.material.emissive.lerpColors(_baseFricColor, _hotFricColor, tN * pulse * 0.85);
      m.material.emissiveIntensity = 0.2 + tN * pulse * 0.9;
    });
  };

  /**
   * setHighlight(on) — Phase-5 DTC fault flag.  When on, drum + plates pulse
   * a saturated red.  Off restores normal emissive.
   */
  let _hlPhase = 0;
  group.setHighlight = function (on) {
    if (!on) {
      drum.material.emissive.setHex(0x000000);
      drum.material.emissiveIntensity = 0;
      plates.forEach(m => {
        if (!m.userData.isFriction) {
          m.material.emissive.setHex(0x000000);
          m.material.emissiveIntensity = 0;
        }
      });
      return;
    }
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    drum.material.emissive.setHex(0xff2244);
    drum.material.emissiveIntensity = 0.4 + pulse * 0.6;
    plates.forEach(m => {
      if (!m.userData.isFriction) {
        m.material.emissive.setHex(0xff2244);
        m.material.emissiveIntensity = 0.3 + pulse * 0.4;
      }
    });
  };

  // ── dispose ───────────────────────────────────────────────────────────────
  return {
    group,
    refs,
    dispose() {
      geomCache.forEach(g => g.dispose());
      [matHousing, matSteel, matFriction, matPiston, matSpring].forEach(m => m.dispose());
      edgeMeshes.forEach(eg => eg.geometry?.dispose());
    },
  };
}
