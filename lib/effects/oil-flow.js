/**
 * lib/effects/oil-flow.js
 *
 * Phase 4.1-4.2 — Hydraulic oil gallery tubes.
 *
 * Procedural TubeGeometry curves routing between the major hydraulic
 * components.  Each gallery uses a custom shader with UV-scroll to convey
 * fluid motion — no particles (per build plan §6.2, particles are too
 * expensive for the >Ø1500 4K target frame).
 *
 * Galleries modelled (each = one route from a high-pressure source to a
 * consumer chamber):
 *
 *   pump → valve body            — main suction & line-pressure trunk
 *   valve body → primary cup     — EDS1 commanded, primary clamp pressure
 *   valve body → secondary dome  — EDS2 commanded, secondary clamp pressure
 *   valve body → forward clutch  — EDS3 commanded, fwd engagement pressure
 *   valve body → reverse clutch  — EDS3 commanded, rev engagement pressure
 *
 * Shader behaviour:
 *   - uTime drives UV-scroll on the dashed pressure-band pattern
 *   - uFlow modulates scroll speed AND band visibility — no flow → no bands
 *   - uPressure modulates overall brightness (bright = high pressure)
 *   - uTemp shifts the colour from cool blue toward hot amber
 *
 * Public API:
 *   const oilFlow = buildOilGalleries({ PRIMARY_X, SECONDARY_X, edgeMat });
 *   scene.add(oilFlow.group);
 *   // each frame:
 *   oilFlow.update(TEL, dt);
 *   // optional:
 *   oilFlow.setVisible(false);
 *   oilFlow.setHighlight('vb-pri', true);    // pulse a single gallery red
 *   oilFlow.dispose();
 */

import * as THREE from 'three';

const VERT_SHADER = `
  varying vec2 vUv;
  varying vec3 vViewNormal;
  void main() {
    vUv = uv;
    vViewNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_SHADER = `
  uniform float uTime;
  uniform float uFlow;        // 0..1  — flow rate (independent of pressure)
  uniform float uFlowDir;     // -1..+1 — flow direction (negative = drain/return)
  uniform float uPressure;    // 0..1  — pressure (independent of flow)
  uniform float uValveOpen;   // 0..1  — commanded valve opening (gates band visibility)
  uniform float uTemp;        // 0..1  — temperature (cold → hot)
  uniform float uHighlight;   // 0/1   — DTC pulse
  uniform vec3  uBaseColor;
  uniform vec3  uHotColor;
  uniform vec3  uFaultColor;
  varying vec2 vUv;
  varying vec3 vViewNormal;

  void main() {
    // vUv.x runs along the tube length (0 at start, 1 at end).
    // Scroll direction is toward consumer (positive) or back (negative).
    float scrollSpeed = (0.12 + uFlow * 1.8) * uFlowDir;
    float scroll = vUv.x - uTime * scrollSpeed;

    // Repeating pressure-pulse band — frequency rises with flow rate.
    float bandFreq = 18.0 + uFlow * 32.0;
    float band = sin(scroll * bandFreq);
    band = smoothstep(0.30, 0.92, band);            // softer ramp = less harsh bands

    // Body intensity — reduced ceiling so tubes read as DATA, not subject.
    // Was: 0.16 + uPressure * 0.62.  Now: 0.12 + uPressure * 0.42.
    float bodyI = 0.12 + uPressure * 0.42;

    // Pressure swell — slow 1.4 Hz breathing when fluid is held but not flowing.
    float swell = 0.5 + 0.5 * sin(uTime * 1.4);
    float swellI = uPressure * (1.0 - uFlow) * 0.06 * swell;

    // Band intensity — gated by valve, lower amplitude.
    float bandI = band * uFlow * uValveOpen * 0.55;

    // Subtle rim-light — much softer than before (was 0.22+pres*0.28).
    float rim = 1.0 - abs(vViewNormal.z);
    rim = pow(rim, 2.4);
    float rimI = rim * (0.14 + uPressure * 0.20);

    // Colour: blue→amber with temperature, override to red on DTC.
    vec3 col = mix(uBaseColor, uHotColor, clamp(uTemp, 0.0, 1.0) * 0.65);
    col = mix(col, uFaultColor, uHighlight);

    // DTC pulse — slowed to 1.0 Hz (was 6.0 = nearly strobe).
    float dtcPulse = 0.5 + 0.5 * sin(uTime * 1.0 * 6.28);
    float dtcBoost = uHighlight * (0.22 + dtcPulse * 0.30);

    float intensity = bodyI + swellI + bandI + rimI + dtcBoost;
    // Alpha ceiling slightly lower so tubes don't dominate solid components
    float alpha = 0.48 + uPressure * 0.22 + bandI * 0.28;

    gl_FragColor = vec4(col * intensity, clamp(alpha, 0.28, 0.86));
  }
`;

export function buildOilGalleries({
  PRIMARY_X = -77.5,
  SECONDARY_X = +77.5,
  edgeMat = null,
} = {}) {
  const galleries = [];

  // Shared time uniform across all galleries (so they pulse in sync).
  const uTime = { value: 0 };

  function makeGallery(name, points, options = {}) {
    const curve = new THREE.CatmullRomCurve3(
      points.map(p => new THREE.Vector3(p[0], p[1], p[2])),
      false, 'catmullrom', 0.4
    );
    // Thinner conduits read as a hydraulic SCHEMATIC overlay, not fat pipes.
    const tubeRadius  = options.radius     ?? 2.2;
    const radialSegs  = 8;
    const tubularSegs = Math.max(64, points.length * 16);
    const geom = new THREE.TubeGeometry(curve, tubularSegs, tubeRadius, radialSegs, false);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uFlow:      { value: 0 },
        uFlowDir:   { value: 1 },
        uPressure:  { value: 0 },
        uValveOpen: { value: 0 },
        uTemp:      { value: 0 },
        uHighlight: { value: 0 },
        uBaseColor:  { value: new THREE.Color(options.baseColor  ?? 0x3a86c8) },
        uHotColor:   { value: new THREE.Color(options.hotColor   ?? 0xd86420) },
        uFaultColor: { value: new THREE.Color(options.faultColor ?? 0xff3050) },
      },
      vertexShader:   VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      transparent: true,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `oil-gallery-${name}`;
    mesh.renderOrder = 5;     // draw on top of solid components

    // ── Port nodes at each end ─────────────────────────────────────────────
    // Cap the conduit ends with small glowing spheres so they read as
    // "ports" where the line meets a component, instead of awkward open
    // pipe holes floating in space.
    const capMat = new THREE.MeshBasicMaterial({
      color: options.baseColor ?? 0x3a86c8, transparent: true, opacity: 0.55,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const capGeom = new THREE.SphereGeometry(tubeRadius * 1.25, 10, 8);
    const capA = new THREE.Mesh(capGeom, capMat); capA.position.copy(curve.getPoint(0));   capA.renderOrder = 5;
    const capB = new THREE.Mesh(capGeom, capMat); capB.position.copy(curve.getPoint(1));   capB.renderOrder = 5;

    // Subtle edge overlay (only in hologram mode if edgeMat provided)
    let edgeMesh = null;
    if (edgeMat) {
      const eg = new THREE.EdgesGeometry(geom, 25);
      edgeMesh = new THREE.LineSegments(eg, edgeMat);
      edgeMesh.renderOrder = 6;
    }

    const g = {
      name, curve, geom, mat, mesh, edgeMesh,
      capA, capB, capGeom, capMat,
      // -- inputs (one per visual axis) --
      // Body brightness — what the absolute pressure at the consumer end is.
      getPressure:      options.getPressure      ?? (() => 0),
      // Steady-state flow magnitude — continuous transfer (e.g. pump output).
      getBaseFlow:      options.getBaseFlow      ?? (() => 0),
      // Transient source — value whose |d/dt| produces a flow surge
      // (e.g. P_pri changing during a ratio shift, P_clutch during clutch fill).
      getTransientSrc:  options.getTransientSrc  ?? null,
      // Per-gallery transient scaling — how big a |dP/dt| reads as full flow.
      transientScale:   options.transientScale   ?? 40,    // bar/s
      // Valve opening gate (0..1) — closes off the band animation regardless
      // of flow magnitude.  Lets us model "pressure stuck behind closed valve".
      getValveOpen:     options.getValveOpen     ?? ((TEL) => Math.min(1, (TEL.N_Prim || 0) / 800)),
      // Flow direction (+1 toward consumer, -1 return/drain).
      getDirection:     options.getDirection     ?? (() => 1),
      getTemp:          options.getTemp          ?? (() => 0),

      // -- internal state --
      _smoothFlow: 0,
      _smoothPres: 0,
      _smoothTemp: 0,
      _smoothValve: 0,
      _prevTransient: null,
      _smoothTransientFlow: 0,
    };
    galleries.push(g);
    return g;
  }

  // World layout reference (matches unit.html positions):
  //   PULLEY (primary)    at (PRIMARY_X, 0, 0), cup top  at world (PRIMARY_X, +85, 0)
  //   SEC_PULLEY          at (SECONDARY_X, 0, 0), dome top at (SECONDARY_X, +85, 0)
  //   oil pump            at (PRIMARY_X, 0, +95)  — axis +Z
  //   valve body          at (0, -120, 0)  — top face at y=-107.5
  //   FWD clutch          at (PRIMARY_X, 0, -135)
  //   REV clutch          at (PRIMARY_X, 0, -180)

  // ── 1. PUMP → VALVE BODY (main pressure trunk) ─────────────────────────────
  // Pump outlet is on the side of the pump body (offset in +X from pump axis).
  // Trunk drops along the front of the case, then back to the valve body's
  // left intake port.
  makeGallery('pump-vb', [
    [PRIMARY_X + 18,  10,  88],     // pump discharge port
    [PRIMARY_X + 30, -30,  60],
    [PRIMARY_X + 30, -90,  20],
    [-50,            -107, -5],
    [-50,            -118, -5],     // enters valve body left side
  ], {
    radius: 3.2,                     // largest tube — high-pressure trunk
    baseColor: 0x6ec8ff,             // brighter cyan than EDS branches
    hotColor:  0xffae40,             // warmer hot color
    // Pump always produces flow whenever the engine runs (positive-displacement
    // pump driven off primary shaft).  Pressure is independent — controlled
    // by line-pressure regulator at the valve body.
    getBaseFlow:     (TEL) => Math.min(1, (TEL.N_Prim || 0) / 3500),
    getPressure:     (TEL) => Math.min(1, (TEL.P_line || 0) / 60),
    getValveOpen:    () => 1,                // trunk is always open
    transientScale:  100,                    // pressure deltas don't matter much here
    getTemp:         (TEL) => Math.max(0, Math.min(1, ((TEL.T_oil || 25) - 60) / 80)),
  });

  // ── 2. VALVE BODY → PRIMARY CUP (EDS1) ─────────────────────────────────────
  // Exits valve body's left-top face, curves up along the primary side of the
  // case to the bottom of the primary cup (which sits at y≈+55, ID Ø108).
  // Steady-state has only leakage flow.  Big flow happens during ratio shifts.
  makeGallery('vb-pri', [
    [-30, -107, -10],
    [-55,  -80,  -5],
    [-72,  -20,   2],
    [PRIMARY_X,  30,  4],
    [PRIMARY_X,  62,  0],            // into the cup chamber from below
  ], {
    radius: 3.2,
    baseColor: 0x3a86c8,
    getPressure:     (TEL) => Math.min(1, (TEL.P_pri || 0) / 58),
    // Tiny steady-state leakage proportional to commanded current.
    getBaseFlow:     (TEL) => Math.min(0.15, (TEL.EDS1_mA || 0) / 1200),
    // Transient: when P_pri is rapidly changing the gallery is actively
    // filling or draining the primary cup.
    getTransientSrc: (TEL) => TEL.P_pri || 0,
    transientScale:  18,                                // bar/s for full-flow read
    getValveOpen:    (TEL) => Math.min(1, (TEL.EDS1_mA || 0) / 800),
    // Direction: when P_pri is rising, flow runs INTO the cup (+); when
    // falling, it drains BACK to the valve body (-).
    getDirection:    (TEL, dPdt) => (dPdt < -2 ? -1 : 1),
    getTemp:         (TEL) => Math.max(0, Math.min(1, ((TEL.T_oil || 25) - 60) / 80)),
  });

  // ── 3. VALVE BODY → SECONDARY DOME (EDS2) ──────────────────────────────────
  makeGallery('vb-sec', [
    [+30, -107, -10],
    [+55,  -80,  -5],
    [+72,  -20,   2],
    [SECONDARY_X,  30,  4],
    [SECONDARY_X,  62,  0],          // into the dome chamber from below
  ], {
    radius: 3.2,
    baseColor: 0x3a86c8,
    getPressure:     (TEL) => Math.min(1, (TEL.P_sec || 0) / 60),
    getBaseFlow:     (TEL) => Math.min(0.15, (TEL.EDS2_mA || 0) / 1200),
    getTransientSrc: (TEL) => TEL.P_sec || 0,
    transientScale:  20,
    getValveOpen:    (TEL) => Math.min(1, (TEL.EDS2_mA || 0) / 800),
    getDirection:    (TEL, dPdt) => (dPdt < -2 ? -1 : 1),
    getTemp:         (TEL) => Math.max(0, Math.min(1, ((TEL.T_oil || 25) - 60) / 80)),
  });

  // ── 4. VALVE BODY → FWD CLUTCH (EDS3, when selector ∈ D/S) ─────────────────
  // Routes back from the valve body's rear face along the floor of the case,
  // up to the FWD clutch piston chamber.
  //   Steady-state: clutch full → near zero flow (closed valve).
  //   Transient   : clutch filling/draining → big surge of flow.
  makeGallery('vb-fwd', [
    [-15, -107, -25],
    [-35,  -95, -55],
    [-55,  -60, -95],
    [PRIMARY_X + 20, -25, -125],
    [PRIMARY_X,        0, -135],     // into the fwd clutch piston bore
  ], {
    radius: 2.8,
    baseColor: 0x4a96c8,
    getPressure:     (TEL) => (TEL.selector === 'D' || TEL.selector === 'S')
                       ? Math.min(1, (TEL.P_clutch || 0) / 30) : 0,
    // Tiny make-up flow even at steady state (leakage).
    getBaseFlow:     (TEL) => ((TEL.selector === 'D' || TEL.selector === 'S')
                       ? Math.min(0.10, (TEL.P_clutch || 0) / 250) : 0),
    // Transient: P_clutch rate-of-change drives the visible flow surge.
    getTransientSrc: (TEL) => ((TEL.selector === 'D' || TEL.selector === 'S')
                       ? (TEL.P_clutch || 0) : 0),
    transientScale:  10,                                // bar/s for full-flow read
    getValveOpen:    (TEL) => ((TEL.selector === 'D' || TEL.selector === 'S')
                       ? Math.min(1, (TEL.EDS3_mA || 0) / 800) : 0),
    getDirection:    (TEL, dPdt) => (dPdt < -1.5 ? -1 : 1),
    getTemp:         (TEL) => Math.max(0, Math.min(1, ((TEL.T_clutch || 25) - 70) / 90)),
  });

  // ── 5. VALVE BODY → REV CLUTCH (EDS3, when selector = R) ───────────────────
  makeGallery('vb-rev', [
    [-15, -107, -35],
    [-40,  -95, -75],
    [-60,  -60, -130],
    [PRIMARY_X + 20, -25, -165],
    [PRIMARY_X,        0, -180],     // into the rev clutch piston bore
  ], {
    radius: 2.8,
    baseColor: 0x4a96c8,
    getPressure:     (TEL) => (TEL.selector === 'R')
                       ? Math.min(1, (TEL.P_clutch || 0) / 30) : 0,
    getBaseFlow:     (TEL) => ((TEL.selector === 'R')
                       ? Math.min(0.10, (TEL.P_clutch || 0) / 250) : 0),
    getTransientSrc: (TEL) => ((TEL.selector === 'R') ? (TEL.P_clutch || 0) : 0),
    transientScale:  10,
    getValveOpen:    (TEL) => ((TEL.selector === 'R')
                       ? Math.min(1, (TEL.EDS3_mA || 0) / 800) : 0),
    getDirection:    (TEL, dPdt) => (dPdt < -1.5 ? -1 : 1),
    getTemp:         (TEL) => Math.max(0, Math.min(1, ((TEL.T_clutch || 25) - 70) / 90)),
  });

  // ── Bundle all gallery meshes ──────────────────────────────────────────────
  const group = new THREE.Group();
  group.name = 'oil-galleries';
  group.visible = false;     // Phase-4 hydraulic overlay is OFF by default — it's
                             // a diagnostic x-ray of the (internally-routed) oil
                             // flow, shown on demand via the FLOW toggle.
  galleries.forEach(g => {
    group.add(g.mesh);
    group.add(g.capA); group.add(g.capB);
    if (g.edgeMesh) group.add(g.edgeMesh);
  });

  // ── Public API ─────────────────────────────────────────────────────────────
  // Hot-path update — runs every frame.  For each gallery:
  //   - sample target signals from TEL
  //   - compute transient flow from |dPressure/dt| of the transient source
  //   - blend steady-state flow with transient surge
  //   - first-order LPF smoothing to absorb CAN-frame jitter
  function update(TEL, dt) {
    uTime.value += dt;
    if (dt <= 0) return;            // safety: paused tab → don't divide by zero
    const dtClamped = Math.min(dt, 0.05);     // clamp to ≤50 ms so a tab-switch
                                              // pause doesn't produce a fake surge
    galleries.forEach(g => {
      const pres = g.getPressure(TEL);
      const baseFlow = g.getBaseFlow(TEL);
      const valve = g.getValveOpen(TEL);
      const temp = g.getTemp(TEL);

      // Transient flow from |dP/dt| of the per-gallery transient source.
      let transientFlow = 0;
      let dPdt = 0;
      if (g.getTransientSrc) {
        const cur = g.getTransientSrc(TEL);
        if (g._prevTransient !== null) {
          dPdt = (cur - g._prevTransient) / dtClamped;
          transientFlow = Math.min(1, Math.abs(dPdt) / g.transientScale);
        }
        g._prevTransient = cur;
      }
      // Transient flow decays quickly (the gallery doesn't "remember" the
      // surge once dP/dt settles).  Use an asymmetric smoother — attack fast,
      // decay slower so the eye catches the surge.
      const aFlowUp   = Math.min(1, dtClamped * 16);
      const aFlowDown = Math.min(1, dtClamped *  3);
      const surgeTarget = Math.max(transientFlow, baseFlow);
      const aFlow = surgeTarget > g._smoothTransientFlow ? aFlowUp : aFlowDown;
      g._smoothTransientFlow += (surgeTarget - g._smoothTransientFlow) * aFlow;

      // Direction may depend on dP/dt sign.
      const dir = g.getDirection(TEL, dPdt);

      // Standard LPF on the slower signals.
      const aPres  = Math.min(1, dtClamped * 5);
      const aTemp  = Math.min(1, dtClamped * 1.8);
      const aValve = Math.min(1, dtClamped * 8);
      g._smoothPres  += (pres  - g._smoothPres)  * aPres;
      g._smoothTemp  += (temp  - g._smoothTemp)  * aTemp;
      g._smoothValve += (valve - g._smoothValve) * aValve;

      const u = g.mat.uniforms;
      u.uFlow.value      = g._smoothTransientFlow;
      u.uFlowDir.value   = dir;
      u.uPressure.value  = g._smoothPres;
      u.uValveOpen.value = g._smoothValve;
      u.uTemp.value      = g._smoothTemp;
    });
  }

  function setHighlight(name, on) {
    const g = galleries.find(x => x.name === name);
    if (g) g.mat.uniforms.uHighlight.value = on ? 1 : 0;
  }

  function dispose() {
    galleries.forEach(g => {
      g.geom.dispose();
      g.mat.dispose();
      g.capGeom?.dispose();
      g.capMat?.dispose();
      if (g.edgeMesh) g.edgeMesh.geometry.dispose();
    });
  }

  // Visibility is the toggle for the whole hydraulic-flow overlay.
  function setVisible(v){ group.visible = !!v; }
  function isVisible(){ return group.visible; }

  return { group, galleries, update, setVisible, isVisible, setHighlight, dispose };
}
