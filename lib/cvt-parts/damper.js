/**
 * lib/cvt-parts/damper.js
 *
 * Punch VT2 torsional damper — the rigid coupling between the engine
 * crankshaft and the CVT input shaft.  VT2 has NO torque converter; this
 * damper takes its place.
 *
 * Architecture (real Punch VT2):
 *   - DRIVE PLATE (cover): a thin steel disc bolted to the engine flexplate.
 *   - SPRING POCKETS: 4 arc-shaped coil springs spaced 90° apart around the
 *     periphery, sitting in machined cavities between the drive plate and
 *     driven plate.  They allow a few degrees of relative rotation to
 *     absorb engine torsional vibration.
 *   - DRIVEN PLATE: a stamped plate that picks up the spring force and
 *     transmits it to the hub.
 *   - HUB FLANGE: central splined hub connected to the CVT input shaft.
 *
 * This is mechanically rigid (1:1 input:output speed at steady state) with
 * a few degrees of compliant twist — NOT a fluid coupling, NO torque
 * multiplication, NO lockup clutch (because there's nothing to lock up).
 *
 * Live API (matches torque-converter.js so it's a drop-in replacement):
 *   group.setSpeeds(N_MOT, N_Prim, dt)
 *      Both plates spin at N_MOT (rigid coupling).  N_Prim is ignored;
 *      kept in signature for API parity with TC kit.
 *   group.setLockup(engaged)
 *      No-op (no lockup clutch in a damper).  Kept for API parity.
 *   group.setTemp(t_C)         — heat tint on drive plate
 *   group.setHighlight(on)     — DTC fault pulse (e.g. damper spring break)
 *
 * Local frame: axis along +Y.  Drive plate centred at y=+depth/2,
 * driven plate at y=-depth/2.  Springs sit at y=0 around the periphery.
 */

import * as THREE from 'three';

const DEFAULTS = {
  // Real damper is ~Ø180-220mm — about the same diameter as a sheave (Ø150)
  // but axially THIN (no fluid cavity).  Total axial depth ~25mm.
  outerR:        80,    // Ø160 outer plate
  innerHubR:     14,    // Ø28 hub bore (input shaft pass-through)
  hubR:          26,    // hub flange OD
  plateThk:       3,    // each plate's axial thickness
  depth:         28,    // total axial extent (bumped from 24 to make springs visible)
  springCount:    4,    // arc springs spaced 90°
  springArcDeg:  62,    // each spring sweeps ~62° of arc (slightly wider)
  springR:       60,    // radius at which spring centres sit
  springThk:      9,    // axial thickness of springs (was 6)
  springTube:     8,    // coil "tube" radius (was 5 — now clearly visible)
};

export function buildDamper({
  name = 'damper',
  materials = {},
  edgeMat = null,
  ...custom
} = {}) {
  const D = { ...DEFAULTS, ...custom };

  const group = new THREE.Group();
  group.name = name;
  group.userData.kind = 'damper';

  // ── materials ─────────────────────────────────────────────────────────────
  const matPlate = (materials.plate || new THREE.MeshPhysicalMaterial({
    color: 0x8c98a3, metalness: 0.9, roughness: 0.3,
    transparent: true, opacity: 0.55,                          // was 0.92 — now translucent so springs read through
    side: THREE.DoubleSide,
    emissive: 0x0a131a, emissiveIntensity: 0.18,
  })).clone();
  const matHub = (materials.hub || new THREE.MeshPhysicalMaterial({
    color: 0xa6b3c0, metalness: 0.95, roughness: 0.22,
    transparent: true, opacity: 0.95,
    emissive: 0x111a22, emissiveIntensity: 0.22,
  })).clone();
  const matSpring = (materials.spring || new THREE.MeshPhysicalMaterial({
    color: 0xffc14a, metalness: 0.55, roughness: 0.42,        // bright brass coil — pops against dark plates
    transparent: false,
    emissive: 0x9a5410, emissiveIntensity: 0.75,              // strong self-glow so it reads on the TV
  })).clone();

  const geomCache = [];

  // ── 1. DRIVE PLATE (engine side, +Y) ──────────────────────────────────────
  // A disc with a central bore, annular relief around the spring pockets.
  const drivePlateShape = new THREE.Shape();
  drivePlateShape.absarc(0, 0, D.outerR, 0, Math.PI*2, false);
  const drivePlateHole = new THREE.Path();
  drivePlateHole.absarc(0, 0, D.innerHubR, 0, Math.PI*2, true);
  drivePlateShape.holes.push(drivePlateHole);
  const drivePlateGeom = new THREE.ExtrudeGeometry(drivePlateShape, {
    depth: D.plateThk, bevelEnabled: false, curveSegments: 56,
  });
  drivePlateGeom.rotateX(-Math.PI/2);
  drivePlateGeom.translate(0, D.depth/2 - D.plateThk/2, 0);
  geomCache.push(drivePlateGeom);
  const drivePlate = new THREE.Mesh(drivePlateGeom, matPlate);
  drivePlate.name = `${name}-drive-plate`;
  group.add(drivePlate);

  // ── 2. DRIVEN PLATE (CVT side, -Y) ────────────────────────────────────────
  const drivenPlateGeom = new THREE.ExtrudeGeometry(drivePlateShape, {
    depth: D.plateThk, bevelEnabled: false, curveSegments: 56,
  });
  drivenPlateGeom.rotateX(-Math.PI/2);
  drivenPlateGeom.translate(0, -D.depth/2 + D.plateThk/2, 0);
  geomCache.push(drivenPlateGeom);
  const drivenPlate = new THREE.Mesh(drivenPlateGeom, matPlate);
  drivenPlate.name = `${name}-driven-plate`;
  group.add(drivenPlate);

  // Outer rim that connects the two plates (a thin cylindrical band)
  const rimGeom = new THREE.CylinderGeometry(D.outerR, D.outerR, D.depth, 56, 1, true);
  geomCache.push(rimGeom);
  const rim = new THREE.Mesh(rimGeom, matPlate);
  rim.name = `${name}-rim`;
  group.add(rim);

  // ── 3. CENTRAL HUB FLANGE ─────────────────────────────────────────────────
  // A short cylindrical hub on the driven side, with a flange disc.
  const hubGeom = new THREE.CylinderGeometry(D.hubR, D.hubR, D.depth + 6, 32, 1, false);
  geomCache.push(hubGeom);
  const hub = new THREE.Mesh(hubGeom, matHub);
  hub.name = `${name}-hub`;
  hub.position.y = -2;     // slight asymmetric protrusion toward driven side
  group.add(hub);

  // Splined inner bore detail (8 axial ribs around the hub bore)
  const splineCount = 12;
  for (let i = 0; i < splineCount; i++) {
    const a = (i / splineCount) * Math.PI * 2;
    const sg = new THREE.BoxGeometry(1.6, D.depth + 6, 1.6);
    geomCache.push(sg);
    const sm = new THREE.Mesh(sg, matHub);
    sm.position.set(Math.cos(a) * (D.innerHubR + 0.8), -2, Math.sin(a) * (D.innerHubR + 0.8));
    sm.lookAt(0, sm.position.y, 0);
    group.add(sm);
  }

  // ── 4. ARC COIL SPRINGS (4 around the periphery) ──────────────────────────
  // Each spring is a torus segment whose centre rides at radius springR.
  // The coil "thickness" is the tube radius; the arc sweep is springArcDeg.
  const springsGroup = new THREE.Group();
  springsGroup.name = `${name}-springs`;
  const springArcRad = (D.springArcDeg * Math.PI) / 180;
  const halfArc = springArcRad / 2;
  // Single shared shell (cavity housing) material — hoisted out of the loop so
  // it is created once, can be disposed, and could be swapped by the caller.
  const matShell = new THREE.MeshPhysicalMaterial({
    color: 0x4e5560, metalness: 0.75, roughness: 0.5,
    transparent: true, opacity: 0.45, side: THREE.DoubleSide,
  });
  for (let i = 0; i < D.springCount; i++) {
    const aCentre = (i / D.springCount) * Math.PI * 2 + Math.PI / D.springCount;

    // Outer "shell" — a thick toroidal arc (the cavity housing)
    const shellGeom = new THREE.TorusGeometry(D.springR, D.springTube + 1.5,
      8, 16, springArcRad);
    geomCache.push(shellGeom);
    const shell = new THREE.Mesh(shellGeom, matShell);
    shell.rotation.x = Math.PI/2;                  // lay torus in XZ plane (perpendicular to +Y axis)
    shell.rotation.z = aCentre - halfArc;          // rotate so the arc starts at aCentre - halfArc
    springsGroup.add(shell);

    // Coiled spring — represented as a tube of helical points along the arc.
    // For visual economy we use a tighter inner torus arc with a helical "ridge".
    const coilGeom = new THREE.TorusGeometry(D.springR, D.springTube,
      8, 32, springArcRad);
    geomCache.push(coilGeom);
    const coil = new THREE.Mesh(coilGeom, matSpring);
    coil.rotation.x = Math.PI/2;
    coil.rotation.z = aCentre - halfArc;
    springsGroup.add(coil);

    // Coil "winding" hint — bands wrapped around the torus at discrete
    // points along the sweep, giving the visual cue of helical turns.
    const turns = 12;                              // was 8 — denser helical look
    for (let t = 0; t < turns; t++) {
      const u = (t + 0.5) / turns;                 // fraction along arc
      const aHere = (aCentre - halfArc) + u * springArcRad;
      const cx = Math.cos(aHere) * D.springR;
      const cz = Math.sin(aHere) * D.springR;
      const bg = new THREE.TorusGeometry(D.springTube, D.springTube * 0.32, 8, 16);
      geomCache.push(bg);
      const b = new THREE.Mesh(bg, matSpring);
      b.position.set(cx, 0, cz);
      // Orient ring so its axis is tangent to the spring arc
      const tangent = new THREE.Vector3(-Math.sin(aHere), 0, Math.cos(aHere));
      b.lookAt(b.position.clone().add(tangent));
      springsGroup.add(b);
    }
  }
  group.add(springsGroup);

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    [drivePlate, drivenPlate, rim, hub].forEach(mesh => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 14), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      group.add(eg);
      edgeMeshes.push(eg);
    });
    // Spring-pack edges — the coils are the most prominent feature, so give
    // each coil arc an edge overlay so the spring pack survives WIREFRAME x-ray
    // (which hides solid mesh fills).  Skip the tiny winding rings to cap lines.
    springsGroup.children.forEach(child => {
      if (child.geometry && child.geometry.parameters && child.geometry.parameters.arc) {
        const eg = new THREE.LineSegments(new THREE.EdgesGeometry(child.geometry, 18), edgeMat);
        eg.rotation.copy(child.rotation);
        eg.position.copy(child.position);
        springsGroup.add(eg);
        edgeMeshes.push(eg);
      }
    });
  }

  // ── refs ──────────────────────────────────────────────────────────────────
  const refs = {
    drivePlate, drivenPlate, rim, hub, springsGroup,
    materials: { matPlate, matHub, matSpring },
  };

  // ── live API ──────────────────────────────────────────────────────────────
  let _phase = 0;
  group.setSpeeds = function (N_MOT_rpm, _N_Prim_rpm_ignored, dt = 0.016) {
    // Rigid coupling — whole assembly spins at engine speed.
    const w = (N_MOT_rpm / 60) * 2 * Math.PI;
    _phase += w * dt;
    group.rotation.y = _phase;   // whole damper rotates together (parent's
                                 // own rotation.x/etc still apply on top)
  };
  // No lockup in a damper — keep for API parity but it's a no-op.
  group.setLockup = function (_engaged) { /* no-op */ };

  group.setTemp = function (t_C) {
    const tN = Math.max(0, Math.min(1, (t_C - 80) / 60));
    drivePlate.material.emissive.setHex(tN > 0.05 ? 0xff5520 : 0x0a131a);
    drivePlate.material.emissiveIntensity = tN > 0.05 ? tN * 0.4 : 0.18;
  };

  let _hlPhase = 0;
  group.setHighlight = function (on) {
    if (!on) {
      [drivePlate, drivenPlate].forEach(m => {
        m.material.emissive.setHex(0x0a131a);
        m.material.emissiveIntensity = 0.18;
      });
      return;
    }
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    [drivePlate, drivenPlate].forEach(m => {
      m.material.emissive.setHex(0xff2244);
      m.material.emissiveIntensity = 0.3 + pulse * 0.5;
    });
  };

  return {
    group,
    refs,
    dispose() {
      geomCache.forEach(g => g.dispose());
      [matPlate, matHub, matSpring, matShell].forEach(m => m.dispose());
      edgeMeshes.forEach(eg => eg.geometry?.dispose());
    },
  };
}
