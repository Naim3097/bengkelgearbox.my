/**
 * lib/cvt-parts/oil-pump.js
 *
 * Punch VT2-VT3 oil pump — EXTERNAL GEAR pump (Punch working-principle:
 * ~10 cm³/rev, 40-50 bar line pressure), an enclosed cartridge bolted with
 * six bolts into the end of the primary bore behind the primary cover.
 * AUDIT FIX F3: driven by the central QUILL SHAFT that runs from the engine
 * coupling through the hollow primary shaft — so it turns at ENGINE speed
 * (pressure exists in Neutral; flat-towing is banned).  The pump is the
 * SOURCE of all hydraulic pressure, a frequent source of mechanic
 * mis-diagnosis ("why's pressure low?" — often the pump).
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
  // AUDIT FIX F3: the real VT2 pump is an enclosed ~Ø92 cartridge bolted with
  // 6 bolts into the end of the primary bore, its EXTERNAL GEAR pair driven by
  // a central quill shaft at engine speed.  The invented "6 drive-lug slots"
  // and external port bosses are gone; the driving gear is centred on the
  // pump axis where the quill shaft arrives.
  bodyR:          46,    // Ø92 cartridge body
  bodyThick:      18,    // axial thickness
  coverThick:     2,
  gearR:          14,    // Ø28 each gear
  gearTeeth:      11,
  toothH:         1.4,
  centreDist:     27,    // distance between the two gear axes (gear-meshing)
  boltCount:      6,     // cartridge retaining bolts (10 Nm, service manual §2.6.2.6)
  boltCircleR:    39,
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

  // ── 3. DRIVING GEAR (on the pump axis — driven by the central quill shaft) ──
  const drivingGroup = new THREE.Group();
  drivingGroup.name = `${name}-driving`;
  // Centred: the quill shaft arrives along the pump axis and splines into it.
  drivingGroup.position.set(0, 0, 0);

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

  // Quill-shaft drive hub — small splined boss at the gear centre where the
  // pump drive shaft arrives through the hollow primary shaft.
  {
    const hubGeom = new THREE.CylinderGeometry(5.5, 5.5, 4, 12, 1, false);
    geomCache.push(hubGeom);
    const h = new THREE.Mesh(hubGeom, matBody);
    h.position.y = D.bodyThick + 1.5;
    drivingGroup.add(h);
  }

  group.add(drivingGroup);

  // ── 4. DRIVEN GEAR (idler — meshes with driving gear) ────────────────────
  const drivenGroup = new THREE.Group();
  drivenGroup.name = `${name}-driven`;
  drivenGroup.position.set(D.centreDist, 0, 0);

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

  // ── 5. CARTRIDGE BOLTS (6× on the cover face — service manual §2.6.2.6) ──
  // The real pump has no external port bosses: its passages are internal.
  // What you DO see are the six retaining bolts on the face.
  const portMeshes = [];
  for (let i = 0; i < D.boltCount; i++) {
    const a = (i / D.boltCount) * Math.PI * 2 + Math.PI / 6;
    const boltGeom = new THREE.CylinderGeometry(2.6, 2.6, 3.4, 6);
    geomCache.push(boltGeom);
    const p = new THREE.Mesh(boltGeom, matPort);
    p.position.set(Math.cos(a) * D.boltCircleR, D.bodyThick + D.coverThick + 1.2, Math.sin(a) * D.boltCircleR);
    p.userData.role = 'bolt';
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
