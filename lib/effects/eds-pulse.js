/**
 * lib/effects/eds-pulse.js
 *
 * Phase 4.4 — EDS solenoid current pulse effect.
 *
 * Builds on the per-coil emissive ring from Phase 3.4.  Adds:
 *   - A persistent translucent halo torus around each EDS coil that flickers
 *     at a PWM-frequency proxy (~10 Hz visible rate) so the viewer sees the
 *     coil is *energised*, not just statically bright.
 *   - A small pool of expanding "magnetic field" pulse rings per coil.  Each
 *     spawns at a rate proportional to current, expands outward over ~350 ms,
 *     and fades to alpha 0 before recycling.  Conveys active current flow.
 *
 * The effect attaches its halo + ring meshes directly to each solenoid's
 * own Group, so they inherit any future valve-body transforms (rotation,
 * explode mode, etc.) automatically.
 *
 * Public API:
 *   const edsPulse = buildEdsPulse({ valveBodyRefs, getCurrent });
 *   // valveBodyRefs.solenoids[] is the array from buildValveBody().refs.solenoids
 *   // getCurrent(idx) returns mA for EDS1..3
 *   edsPulse.update(TEL, dt);
 *   edsPulse.setVisible(false);
 *   edsPulse.dispose();
 */

import * as THREE from 'three';

const RING_POOL_SIZE = 5;          // rings per coil — small pool, recycled
const RING_LIFETIME  = 0.55;       // seconds per ring expansion cycle (was 0.42 — gentler)
const PWM_FREQ_HZ    = 4.5;        // visible-rate PWM proxy (was 9.0 — less strobe-y)

export function buildEdsPulse({
  valveBodyRefs,
  getCurrent = (idx) => 0,
} = {}) {
  if (!valveBodyRefs?.solenoids) {
    console.warn('[eds-pulse] no valveBodyRefs.solenoids — no-op');
    return { update: () => {}, setVisible: () => {}, dispose: () => {} };
  }

  const solenoids = valveBodyRefs.solenoids;
  const coilStates = [];

  // Pulse-ring shader — minimal, additively blended for that "lit field" feel.
  const ringVert = `
    varying float vR;
    void main() {
      // For a TorusGeometry, vUv.x runs around the major loop; we don't use it.
      // We just need depth-correct positioning.
      vR = length(position.xz);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `;
  const ringFrag = `
    uniform float uAlpha;
    uniform vec3  uColor;
    varying float vR;
    void main() {
      gl_FragColor = vec4(uColor * (0.9 + uAlpha * 0.3), uAlpha);
    }
  `;

  function makeRing(parent, baseRadius) {
    // Tube radius is tiny — the ring should be a thin circle.
    const geom = new THREE.TorusGeometry(baseRadius, 0.6, 6, 36);
    const mat  = new THREE.ShaderMaterial({
      uniforms: {
        uAlpha: { value: 0 },
        uColor: { value: new THREE.Color(0x7fefff) },
      },
      vertexShader: ringVert,
      fragmentShader: ringFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geom, mat);
    // TorusGeometry's natural plane is XY.  We want it horizontal (XZ plane)
    // so the rings expand around the coil's vertical axis.
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 7;
    parent.add(mesh);
    return { mesh, mat, baseRadius, age: -1 };   // age < 0 → inactive
  }

  // ── Build per-solenoid effect set ─────────────────────────────────────────
  solenoids.forEach((solGroup, idx) => {
    const refs = solGroup.userData.refs;
    if (!refs || !refs.coil) return;

    // Halo torus — bigger than the coil, sits at the coil's local Y.
    const coilWorldY = refs.coil.position.y;   // local Y of the coil mesh
    const haloGeom = new THREE.TorusGeometry(17, 1.0, 8, 40);   // thinner tube
    const haloMat = new THREE.MeshBasicMaterial({
      color: 0x5fd5e8,                                          // slightly desaturated cyan
      transparent: true,
      opacity: 0.22,                                            // calmer baseline (was 0.35)
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const halo = new THREE.Mesh(haloGeom, haloMat);
    halo.rotation.x = -Math.PI / 2;             // horizontal plane
    halo.position.y = coilWorldY;
    halo.renderOrder = 6;
    solGroup.add(halo);

    // Ring pool — all anchored at the same coil height, scaled at runtime.
    const rings = [];
    for (let i = 0; i < RING_POOL_SIZE; i++) {
      const r = makeRing(solGroup, 14);          // start radius = just above coil OD
      r.mesh.position.y = coilWorldY;
      rings.push(r);
    }

    coilStates.push({
      idx, solGroup, halo, haloMat, rings,
      coilWorldY,
      pwmPhase:    Math.random() * Math.PI * 2,  // independent phase per coil
      spawnAccum:  0,
      lastCurrent: 0,
    });
  });

  function update(TEL, dt) {
    if (!coilStates.length) return;

    coilStates.forEach(s => {
      const mA = Math.max(0, getCurrent(s.idx, TEL));
      const norm = Math.min(1, mA / 700);        // 700 mA ≈ full duty
      s.lastCurrent = mA;

      // -- Halo flicker (PWM proxy) --
      // Smooth sine breathing rather than square-wave strobing — reads as
      // "energised" without giving the viewer a seizure.  Holds a softer
      // baseline glow when current is steady.
      s.pwmPhase += dt * Math.PI * 2 * PWM_FREQ_HZ;
      const wave = 0.5 + 0.5 * Math.sin(s.pwmPhase);           // 0..1 sine
      const haloAlpha = 0.06 + norm * (0.18 + wave * 0.22);    // 0.06 .. ~0.46
      s.haloMat.opacity = haloAlpha;
      // Gentle scale breathing — much subtler than the prior on/off pop
      const haloScale = 1.0 + norm * 0.08 * wave;
      s.halo.scale.set(haloScale, 1, haloScale);

      // -- Magnetic field rings --
      // Spawn rate halved (was 6 Hz at full current) — less visual noise.
      const spawnHz = norm * 3.2;
      s.spawnAccum += dt * spawnHz;
      while (s.spawnAccum >= 1) {
        s.spawnAccum -= 1;
        const r = s.rings.find(x => x.age < 0);
        if (r) {
          r.age = 0;
          r.mesh.visible = true;
          r.mesh.scale.set(1, 1, 1);
        }
      }

      // Animate active rings.  Smoother ease-out alpha and slightly less
      // aggressive expansion (3.2× → 2.6×) so the rings settle gracefully.
      s.rings.forEach(r => {
        if (r.age < 0) return;
        r.age += dt;
        const lifeT = r.age / RING_LIFETIME;
        if (lifeT >= 1) {
          r.age = -1;
          r.mesh.visible = false;
          return;
        }
        const scale = 1.0 + lifeT * 1.6;                  // expand 1× → 2.6×
        r.mesh.scale.set(scale, 1, scale);
        // Quadratic ease-out on alpha — front-loaded brightness, soft decay
        const fade = (1 - lifeT) * (1 - lifeT);
        r.mat.uniforms.uAlpha.value = fade * 0.55 * (0.45 + norm * 0.55);
      });
    });
  }

  function setVisible(v) {
    coilStates.forEach(s => {
      s.halo.visible = !!v;
      s.rings.forEach(r => { if (!v) r.mesh.visible = false; });
    });
  }

  function dispose() {
    coilStates.forEach(s => {
      s.halo.geometry.dispose();
      s.haloMat.dispose();
      s.rings.forEach(r => {
        r.mesh.geometry.dispose();
        r.mat.dispose();
        if (r.mesh.parent) r.mesh.parent.remove(r.mesh);
      });
      if (s.halo.parent) s.halo.parent.remove(s.halo);
    });
  }

  return { update, setVisible, dispose, coilStates };
}
