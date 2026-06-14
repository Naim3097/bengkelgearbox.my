/**
 * lib/cvt-parts/oil-pump.js
 *
 * Punch VT2-VT3 oil pump — external-gear (gerotor / spur-gear) type.
 * Driven mechanically by the primary pulley's 6 drive lugs (the visible
 * crown at the top of the primary cup).  The pump is the SOURCE of all
 * hydraulic pressure in the transmission, so its visual rotation should
 * track N_Prim directly — when the engine stops, pressure dies, the model
 * goes idle.  This is mechanically critical and a frequent source of
 * mechanic mis-diagnosis ("why's pressure low?" — often the pump).
 *
 * Geometry:
 *   - Cylindrical housing body (a thick disc with two gear cavities)
 *   - Driving gear:  spur gear with 6 internal slots that mate with the
 *                    primary cup's 6 drive lugs (visual coupling)
 *   - Driven gear:   meshing idler at standard centre distance
 *   - Inlet / outlet ports visible as small protruding bosses
 *   - Cover plate (semi-transparent) so the meshing gears stay visible
 *
 * Construction returns { group, refs, dispose } per the cross-cutting
 * principle in BYKI_3D_DIAGNOSTIC_BUILD_PLAN.md §4.1.
 *
 * Public API:
 *   buildOilPump({ materials, edgeMat, ...overrides }) => { group, refs, dispose }
 *
 *   group.setRotation(N_Prim_rpm, dt)
 *      Both gears rotate at the primary RPM (1:1 — they're directly coupled).
 *      The driving gear gets +sign, the driven (idler) gets -sign (meshing).
 *
 *   group.setWarning(on)
 *      Pump body glows amber when N_Prim is too low to make pressure
 *      while the transmission is supposed to be active (i.e. selector ≠ P).
 *      A real "engine-off-while-in-D" condition.
 *
 *   group.setHighlight(on)
 *      Phase-5 DTC fault flag (e.g. P1765 secondary-pressure-too-low could
 *      indicate pump wear).  Pulses cover + body red.
 *
 * Local frame: same convention as clutch-pack / planetary — axis along +Y.
 * Caller applies the static rotation to align with the primary shaft.
 */

import * as THREE from 'three';

const DEFAULTS = {
  bodyR:          40,    // Ø80 pump body
  bodyThick:      18,    // axial thickness
  coverThick:     2,
  gearR:          14,    // Ø28 each gear
  gearTeeth:      11,
  toothH:         1.4,
  centreDist:     27,    // distance between the two gear axes (gear-meshing)
  driveLugSlots:  6,     // internal coupling to primary cup's 6 drive lugs
  inletR:         5,     // port boss radius
  inletOffsetR:  34,     // radial offset of port boss from pump centre
};

export function buildOilPump({
  name = 'pump',
  materials = {},
  edgeMat = null,
  ...custom
} = {}) {
  const D = { ...DEFAULTS, ...custom };

  const group = new THREE.Group();
  group.name = name;
  group.userData.kind = 'oil-pump';

  // ── materials ─────────────────────────────────────────────────────────────
  const matBody = (materials.body || new THREE.MeshPhysicalMaterial({
    color: 0x4e5560, metalness: 0.88, roughness: 0.4,
    transparent: true, opacity: 0.85, side: THREE.DoubleSide,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matCover = (materials.cover || new THREE.MeshPhysicalMaterial({
    color: 0x6b7884, metalness: 0.78, roughness: 0.3,
    transparent: true, opacity: 0.45, side: THREE.DoubleSide,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matGear = (materials.gear || new THREE.MeshPhysicalMaterial({
    color: 0xb0bcc8, metalness: 0.95, roughness: 0.18,
    transparent: true, opacity: 0.96,
    emissive: 0x000000, emissiveIntensity: 0,
  })).clone();
  const matPort = (materials.port || new THREE.MeshPhysicalMaterial({
    color: 0x5e6a76, metalness: 0.7, roughness: 0.5,
    transparent: true, opacity: 0.9,
  })).clone();

  const geomCache = [];

  // ── 1. PUMP BODY (the housing) ────────────────────────────────────────────
  // Modelled as a cylinder; two gear cavities will be filled with the gear
  // meshes themselves (so users see them spin).  We don't actually cut
  // cavities into the lathe — the visual reads correctly with semi-transparent
  // body + opaque gears inside.
  const bodyGeom = new THREE.CylinderGeometry(D.bodyR, D.bodyR, D.bodyThick, 56, 1, false);
  geomCache.push(bodyGeom);
  const body = new THREE.Mesh(bodyGeom, matBody);
  body.name = `${name}-body`;
  body.position.y = D.bodyThick / 2;
  group.add(body);

  // ── 2. TOP COVER (semi-transparent so gears stay visible) ────────────────
  const coverGeom = new THREE.CylinderGeometry(D.bodyR, D.bodyR, D.coverThick, 56, 1, false);
  geomCache.push(coverGeom);
  const cover = new THREE.Mesh(coverGeom, matCover);
  cover.name = `${name}-cover`;
  cover.position.y = D.bodyThick + D.coverThick / 2;
  group.add(cover);

  // ── 3. DRIVING GEAR (coupled to primary's 6 drive lugs) ──────────────────
  const drivingGroup = new THREE.Group();
  drivingGroup.name = `${name}-driving`;
  // The driving gear sits offset from pump centre by centreDist/2
  drivingGroup.position.set(-D.centreDist / 2, 0, 0);

  const drivingBodyGeom = new THREE.CylinderGeometry(D.gearR, D.gearR, D.bodyThick - 1, 28, 1, false);
  geomCache.push(drivingBodyGeom);
  const drivingBody = new THREE.Mesh(drivingBodyGeom, matGear);
  drivingBody.position.y = D.bodyThick / 2;
  drivingGroup.add(drivingBody);

  // Spur teeth on outer surface
  for (let i = 0; i < D.gearTeeth; i++) {
    const a = (i / D.gearTeeth) * Math.PI * 2;
    const toothW = (2 * Math.PI * D.gearR / D.gearTeeth) * 0.5;
    const tg = new THREE.BoxGeometry(D.toothH, D.bodyThick - 1, toothW);
    geomCache.push(tg);
    const t = new THREE.Mesh(tg, matGear);
    t.position.set(Math.cos(a) * (D.gearR + D.toothH/2), D.bodyThick/2, Math.sin(a) * (D.gearR + D.toothH/2));
    t.lookAt(0, t.position.y, 0);
    drivingGroup.add(t);
  }

  // 6 internal lug slots — visual signature of "this is driven by 6 lugs"
  // Modelled as 6 cylindrical recesses (small dark cylinders) on top face.
  for (let i = 0; i < D.driveLugSlots; i++) {
    const a = (i / D.driveLugSlots) * Math.PI * 2 + Math.PI / 12;
    const lugGeom = new THREE.BoxGeometry(2.5, 4, 5);
    geomCache.push(lugGeom);
    const l = new THREE.Mesh(lugGeom, matBody);
    l.position.set(Math.cos(a) * (D.gearR * 0.55), D.bodyThick + 0.5, Math.sin(a) * (D.gearR * 0.55));
    l.lookAt(0, l.position.y, 0);
    drivingGroup.add(l);
  }

  group.add(drivingGroup);

  // ── 4. DRIVEN GEAR (idler — meshes with driving gear) ────────────────────
  const drivenGroup = new THREE.Group();
  drivenGroup.name = `${name}-driven`;
  drivenGroup.position.set(D.centreDist / 2, 0, 0);

  const drivenBodyGeom = new THREE.CylinderGeometry(D.gearR, D.gearR, D.bodyThick - 1, 28, 1, false);
  geomCache.push(drivenBodyGeom);
  const drivenBody = new THREE.Mesh(drivenBodyGeom, matGear);
  drivenBody.position.y = D.bodyThick / 2;
  drivenGroup.add(drivenBody);

  for (let i = 0; i < D.gearTeeth; i++) {
    const a = (i / D.gearTeeth) * Math.PI * 2;
    const toothW = (2 * Math.PI * D.gearR / D.gearTeeth) * 0.5;
    const tg = new THREE.BoxGeometry(D.toothH, D.bodyThick - 1, toothW);
    geomCache.push(tg);
    const t = new THREE.Mesh(tg, matGear);
    t.position.set(Math.cos(a) * (D.gearR + D.toothH/2), D.bodyThick/2, Math.sin(a) * (D.gearR + D.toothH/2));
    t.lookAt(0, t.position.y, 0);
    drivenGroup.add(t);
  }
  group.add(drivenGroup);

  // Pre-rotate driven gear by half-tooth so teeth mesh correctly with driving
  drivenGroup.rotation.y = Math.PI / D.gearTeeth;

  // ── 5. INLET + OUTLET PORTS ──────────────────────────────────────────────
  // Two small cylindrical bosses on the body — one for low-pressure inlet
  // (suction from oil pan), one for high-pressure outlet (to valve body).
  const portCount = 2;
  const portMeshes = [];
  for (let i = 0; i < portCount; i++) {
    const a = (i === 0 ? 1 : -1) * Math.PI / 2;     // top and bottom on the Z axis
    const portGeom = new THREE.CylinderGeometry(D.inletR, D.inletR, 8, 16, 1, false);
    geomCache.push(portGeom);
    const p = new THREE.Mesh(portGeom, matPort);
    p.position.set(Math.cos(a) * D.inletOffsetR, D.bodyThick / 2, Math.sin(a) * D.inletOffsetR);
    p.rotation.x = Math.PI / 2;
    p.userData.role = (i === 0 ? 'outlet' : 'inlet');
    group.add(p);
    portMeshes.push(p);
  }

  // ── edge overlays (hologram mode) ─────────────────────────────────────────
  const edgeMeshes = [];
  if (edgeMat) {
    [body, cover, drivingBody, drivenBody, ...portMeshes].forEach(mesh => {
      const eg = new THREE.LineSegments(
        new THREE.EdgesGeometry(mesh.geometry, 14), edgeMat
      );
      eg.position.copy(mesh.position);
      eg.rotation.copy(mesh.rotation);
      // For gear edges, parent under the gear group so they rotate together
      if (mesh === drivingBody) drivingGroup.add(eg);
      else if (mesh === drivenBody) drivenGroup.add(eg);
      else group.add(eg);
      edgeMeshes.push(eg);
    });
  }

  // ── refs ──────────────────────────────────────────────────────────────────
  const refs = {
    body, cover, drivingGroup, drivenGroup, drivingBody, drivenBody, ports: portMeshes,
    materials: { matBody, matCover, matGear, matPort },
  };

  // ── live API ──────────────────────────────────────────────────────────────
  let _drivingPhase = 0;
  let _drivenPhase  = Math.PI / D.gearTeeth;          // pre-meshed offset
  const _warningBase = new THREE.Color(0x000000);
  const _warningHot  = new THREE.Color(0xf3b04a);
  let _warnPhase = 0;
  let _hlPhase = 0;

  /**
   * setRotation(N_Prim_rpm, dt)
   * Drives both gears.  The driving gear rotates at N_Prim (same as the
   * primary cup that drives it via the 6 lugs).  The driven gear rotates
   * at opposite sign (meshing) at the same rate (1:1 tooth count).
   */
  group.setRotation = function (N_Prim_rpm, dt = 0.016) {
    const w = (N_Prim_rpm / 60) * 2 * Math.PI;
    _drivingPhase += w * dt;
    _drivenPhase  -= w * dt;
    drivingGroup.rotation.y = _drivingPhase;
    drivenGroup.rotation.y  = _drivenPhase;
  };

  /**
   * setWarning(on) — pump body glows amber when engine is off but
   * transmission is selected (engine cranking required to make pressure).
   * Subtle pulse at ~1 Hz.
   */
  group.setWarning = function (on) {
    if (!on) {
      body.material.emissive.copy(_warningBase);
      body.material.emissiveIntensity = 0;
      cover.material.emissive.copy(_warningBase);
      cover.material.emissiveIntensity = 0;
      return;
    }
    _warnPhase += 0.06;
    const pulse = 0.5 + 0.5 * Math.sin(_warnPhase);
    body.material.emissive.copy(_warningHot);
    body.material.emissiveIntensity = 0.25 + pulse * 0.3;
    cover.material.emissive.copy(_warningHot);
    cover.material.emissiveIntensity = 0.15 + pulse * 0.2;
  };

  /**
   * setHighlight(on) — Phase-5 DTC fault flag.  Strong red pulse over
   * body + cover; used for pump-related fault codes.
   */
  group.setHighlight = function (on) {
    if (!on) {
      body.material.emissive.setHex(0x000000);
      body.material.emissiveIntensity = 0;
      cover.material.emissive.setHex(0x000000);
      cover.material.emissiveIntensity = 0;
      return;
    }
    _hlPhase += 0.18;
    const pulse = 0.5 + 0.5 * Math.sin(_hlPhase);
    body.material.emissive.setHex(0xff2244);
    body.material.emissiveIntensity = 0.4 + pulse * 0.6;
    cover.material.emissive.setHex(0xff2244);
    cover.material.emissiveIntensity = 0.3 + pulse * 0.4;
  };

  return {
    group,
    refs,
    dispose() {
      geomCache.forEach(g => g.dispose());
      [matBody, matCover, matGear, matPort].forEach(m => m.dispose());
      edgeMeshes.forEach(eg => eg.geometry?.dispose());
    },
  };
}
