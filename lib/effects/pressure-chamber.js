/**
 * lib/effects/pressure-chamber.js
 *
 * Phase 4.3 — Pressure chamber fill visualization.
 *
 * Each hollow hydraulic chamber (primary cup, secondary dome, fwd-clutch
 * piston bore, rev-clutch piston bore) gets a translucent fluid cylinder
 * placed inside it.  A custom shader fills the cylinder from the bottom up
 * based on the chamber's current pressure — so the viewer literally SEES the
 * fluid level rise and fall as EDS-commanded pressure changes.
 *
 * Visual language:
 *   - Empty (P ≈ 0)         → invisible (whole cylinder discarded)
 *   - Filling (rising P)    → meniscus surface visible, slight ripple
 *   - Full at low P         → low fluid level, dim colour
 *   - Full at high P        → high fluid level, bright body + pressure throb
 *   - Hot oil (T > 80°C)    → tint shifts toward amber
 *
 * Each chamber attaches to a parent group (the host pulley / clutch),
 * inheriting that part's transform.  Local coordinates therefore stay in the
 * host's frame — primary cup chamber's local +Y axis is the primary's
 * sheave axis.
 *
 * Public API:
 *   const chambers = buildPressureChambers({ PULLEY, SEC_PULLEY,
 *                                            fwdClutchGroup, revClutchGroup });
 *   // chambers.group is NOT added to scene — each chamber's mesh is added
 *   // directly to its host group.  Group exists only for visibility toggling.
 *   chambers.update(TEL, dt);
 *   chambers.setVisible(false);
 *   chambers.dispose();
 */

import * as THREE from 'three';

const VERT_SHADER = `
  uniform float uHeight;       // total height of the cylinder in local units
  varying vec2  vUv;
  varying float vAxial;        // 0 at bottom, 1 at top — independent of UV mapping
  void main() {
    vUv = uv;
    vAxial = (position.y + uHeight * 0.5) / max(uHeight, 0.001);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_SHADER = `
  uniform float uTime;
  uniform float uFill;         // 0..1 — fluid level
  uniform float uPressure;     // 0..1 — pressure brightness (independent of fill)
  uniform float uTemp;         // 0..1 — cold to hot
  uniform float uHighlight;    // 0/1 — DTC pulse
  uniform vec3  uBaseColor;
  uniform vec3  uHotColor;
  uniform vec3  uFaultColor;
  varying vec2  vUv;
  varying float vAxial;

  void main() {
    // Meniscus level — soft ripple driven by uTime so the surface looks
    // live, not painted.  Ripple amplitude scaled down for a calmer surface.
    float ripple = sin(uTime * 4.2 + vUv.x * 12.0) * 0.5
                 + sin(uTime * 2.6 + vUv.x * 18.0) * 0.5;
    float meniscus = uFill + ripple * 0.008 * (0.3 + uPressure * 0.7);

    // Discard everything ABOVE the meniscus (that's air / gas).
    if (vAxial > meniscus) discard;

    // Distance from the meniscus surface, for surface highlight.
    float surfaceDist = meniscus - vAxial;
    float surfaceHi = 1.0 - smoothstep(0.0, 0.07, surfaceDist);   // slightly wider band

    // Depth gradient — bottom darker, top brighter.
    float depth = vAxial / max(meniscus, 0.01);

    // Pressure throb — calmer 1.6 Hz (was 2.4 Hz) and lower amplitude.
    float throb = 0.5 + 0.5 * sin(uTime * 1.6);
    float throbI = uPressure * 0.10 * throb;

    // Colour: cool blue → hot amber → red on DTC.
    vec3 col = mix(uBaseColor, uHotColor, clamp(uTemp, 0.0, 1.0) * 0.60);
    col = mix(col, uFaultColor, uHighlight);

    // DTC pulse — calmed from 6.0 Hz to 1.0 Hz (matches gallery / target pulse rate).
    float dtcPulse = 0.5 + 0.5 * sin(uTime * 1.0 * 6.28);
    float dtcBoost = uHighlight * (0.22 + dtcPulse * 0.32);

    // Softer intensity composition — was clipping bright at high fill+pressure.
    float intensity = mix(0.34, 0.90, depth)
                    + surfaceHi * 0.32          // meniscus skin — was 0.45
                    + throbI
                    + uPressure * 0.12          // base pressure offset — was 0.18
                    + dtcBoost;

    float alpha = mix(0.38, 0.72, depth) + surfaceHi * 0.14 + uPressure * 0.08;

    gl_FragColor = vec4(col * intensity, clamp(alpha, 0.28, 0.88));
  }
`;

export function buildPressureChambers({
  PULLEY,
  SEC_PULLEY,
  fwdClutchGroup,
  revClutchGroup,
} = {}) {
  const chambers = [];

  // Shared time uniform.
  const uTime = { value: 0 };

  function makeChamber(name, parent, options) {
    const radius = options.radius;
    const height = options.height;
    const geom = new THREE.CylinderGeometry(radius, radius, height, 28, 1, false);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime,
        uHeight:    { value: height },
        uFill:      { value: 0 },
        uPressure:  { value: 0 },
        uTemp:      { value: 0 },
        uHighlight: { value: 0 },
        uBaseColor:  { value: new THREE.Color(options.baseColor  ?? 0x3d9be0) },
        uHotColor:   { value: new THREE.Color(options.hotColor   ?? 0xffae40) },
        uFaultColor: { value: new THREE.Color(options.faultColor ?? 0xff3050) },
      },
      vertexShader:   VERT_SHADER,
      fragmentShader: FRAG_SHADER,
      transparent: true,
      depthWrite:  false,
      side:        THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.name = `chamber-${name}`;
    mesh.renderOrder = 4;

    // Local position & orientation INSIDE the parent group.  Default is
    // origin with cylinder axis along local +Y.
    if (options.position) mesh.position.fromArray(options.position);
    if (options.rotation) mesh.rotation.fromArray(options.rotation);

    parent.add(mesh);

    const c = {
      name, mesh, mat, parent,
      getFill:     options.getFill     ?? (() => 0),
      getPressure: options.getPressure ?? (() => 0),
      getTemp:     options.getTemp     ?? (() => 0),
      _sFill: 0, _sPres: 0, _sTemp: 0,
    };
    chambers.push(c);
    return c;
  }

  // ── 1. PRIMARY CUP CHAMBER ────────────────────────────────────────────────
  // Inside the moveable sheave's piston cup.  Cup local Y range ~34..69
  // (cupH=38, base at movHubH+8=34).  Fluid occupies the lower portion
  // beneath the cup top.  We model a chamber centred at local Y=53,
  // height 28, radius 45 (slightly less than cupIR=66 minus piston body).
  if (PULLEY) {
    makeChamber('pri-cup', PULLEY, {
      radius: 45,
      height: 28,
      position: [0, 53, 0],          // PULLEY-local frame
      getFill:     (TEL) => Math.min(1, (TEL.P_pri || 0) / 58),
      getPressure: (TEL) => Math.min(1, (TEL.P_pri || 0) / 58),
      getTemp:     (TEL) => Math.max(0, Math.min(1, ((TEL.T_oil || 25) - 60) / 80)),
    });
  }

  // ── 2. SECONDARY DOME CHAMBER ─────────────────────────────────────────────
  // Inside the secondary spring dome (above the spring).
  // D2.domeBaseH=34, D2.movHubH=24 → dome body local Y ~32..66.
  // Fluid sits above the spring stack.  Chamber centred at local Y=52,
  // height 26, radius 36 (inside dome's inner volume).
  if (SEC_PULLEY) {
    makeChamber('sec-dome', SEC_PULLEY, {
      radius: 36,
      height: 26,
      position: [0, 52, 0],          // SEC_PULLEY-local frame
      getFill:     (TEL) => Math.min(1, (TEL.P_sec || 0) / 60),
      getPressure: (TEL) => Math.min(1, (TEL.P_sec || 0) / 60),
      getTemp:     (TEL) => Math.max(0, Math.min(1, ((TEL.T_oil || 25) - 60) / 80)),
    });
  }

  // ── 3. FWD CLUTCH PISTON BORE ─────────────────────────────────────────────
  // Inside the fwd clutch drum.  Clutch group has rotation.x = -π/2 applied
  // at its parent level — local +Y axis points to world -Z (AWAY from primary).
  // The hydraulic chamber that pushes the piston is BEHIND it, on the side
  // facing back toward the primary — that's local -Y direction.
  // Clutch's piston sits at local Y=0; chamber lives just below at Y≈-7,
  // radius 22 (just under the piston disc), height 8.
  if (fwdClutchGroup) {
    makeChamber('fwd-piston', fwdClutchGroup, {
      radius: 22,
      height: 8,
      position: [0, -7, 0],          // clutch-pack local frame
      baseColor: 0x4a8ed0,           // slightly different blue from the cup
      getFill:     (TEL) => (TEL.selector === 'D' || TEL.selector === 'S')
                            ? Math.min(1, (TEL.P_clutch || 0) / 30) : 0,
      getPressure: (TEL) => (TEL.selector === 'D' || TEL.selector === 'S')
                            ? Math.min(1, (TEL.P_clutch || 0) / 30) : 0,
      getTemp:     (TEL) => Math.max(0, Math.min(1, ((TEL.T_clutch || 25) - 70) / 90)),
    });
  }

  // ── 4. REV CLUTCH PISTON BORE ─────────────────────────────────────────────
  if (revClutchGroup) {
    makeChamber('rev-piston', revClutchGroup, {
      radius: 22,
      height: 8,
      position: [0, -7, 0],
      baseColor: 0x4a8ed0,
      getFill:     (TEL) => (TEL.selector === 'R')
                            ? Math.min(1, (TEL.P_clutch || 0) / 30) : 0,
      getPressure: (TEL) => (TEL.selector === 'R')
                            ? Math.min(1, (TEL.P_clutch || 0) / 30) : 0,
      getTemp:     (TEL) => Math.max(0, Math.min(1, ((TEL.T_clutch || 25) - 70) / 90)),
    });
  }

  // ── Group (purely for visibility toggling — meshes are parented to hosts) ──
  const group = new THREE.Group();
  group.name = 'pressure-chambers';
  // We don't add the meshes to this group (they live in their host groups)
  // — group.visible just gates the show/hide.  To honour that, we toggle
  // each chamber's mesh.visible from setVisible().

  function update(TEL, dt) {
    uTime.value += dt;
    const aFill = Math.min(1, dt * 5);
    const aPres = Math.min(1, dt * 4);
    const aTemp = Math.min(1, dt * 1.8);
    chambers.forEach(c => {
      const tFill = c.getFill(TEL);
      const tPres = c.getPressure(TEL);
      const tTemp = c.getTemp(TEL);
      c._sFill += (tFill - c._sFill) * aFill;
      c._sPres += (tPres - c._sPres) * aPres;
      c._sTemp += (tTemp - c._sTemp) * aTemp;
      c.mat.uniforms.uFill.value     = c._sFill;
      c.mat.uniforms.uPressure.value = c._sPres;
      c.mat.uniforms.uTemp.value     = c._sTemp;
    });
  }

  function setVisible(v) {
    chambers.forEach(c => { c.mesh.visible = !!v; });
  }

  function setHighlight(name, on) {
    const c = chambers.find(x => x.name === name);
    if (c) c.mat.uniforms.uHighlight.value = on ? 1 : 0;
  }

  function dispose() {
    chambers.forEach(c => {
      c.mesh.geometry.dispose();
      c.mat.dispose();
      if (c.mesh.parent) c.mesh.parent.remove(c.mesh);
    });
  }

  return { group, chambers, update, setVisible, setHighlight, dispose };
}
