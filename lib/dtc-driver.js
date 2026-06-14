/**
 * lib/dtc-driver.js
 *
 * Phase 5 — DTC state-machine driver.  Watches TEL.DTCs (a Set), diffs it
 * against the previous frame, and:
 *   - For each NEW code: triggers a 4 s camera-focus glide to that DTC's
 *     framing position, then leaves the component pulsing red until the
 *     code clears.
 *   - For each cleared code: stops the pulse.
 *   - Each frame: drives the pulse on every active code.
 *
 * Lifecycle:
 *   const driver = buildDtcDriver({ camera, controls, targets, getTel });
 *   driver.update(dt);
 *   driver.frameCode(code);    // user-triggered "frame in 3D" button
 */

import * as THREE from 'three';

const GLIDE_DURATION   = 3.6;          // seconds — main approach
const RETURN_DURATION  = 2.8;          // seconds — glide back to overview when DTCs clear
const SETTLE_DURATION  = 1.8;          // seconds — post-arrival dampened wobble
const ARC_HEIGHT_RATIO = 0.18;         // arc apex = 18% of glide distance, lifted +Y
const SETTLE_AMP_FRAC  = 0.015;        // wobble amplitude = 1.5% of camera→target dist
const SLOW_ORBIT_SPEED = 0.20;         // post-focus auto-orbit speed (default is 0.45)
const PULSE_HZ         = 1.5;          // build plan §7.2 — 1.5 Hz red pulse

// -- Easing functions -------------------------------------------------------
// smootherstep — zero velocity AND zero acceleration at both endpoints.
// Perceptually feels more "natural" than plain smoothstep at long durations.
function smootherstep(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t * t * t * (t * (t * 6 - 15) + 10);
}

// -- Quadratic Bezier through a midpoint offset upward.  Gives the camera an
// arc trajectory so it swings UP and over the subject rather than punching
// through scene geometry in a straight line.
function bezierArc(p0, p1, t, arcUpY) {
  const inv = 1 - t;
  const mx  = (p0.x + p1.x) * 0.5;
  const my  = (p0.y + p1.y) * 0.5 + arcUpY;
  const mz  = (p0.z + p1.z) * 0.5;
  return {
    x: inv * inv * p0.x + 2 * inv * t * mx + t * t * p1.x,
    y: inv * inv * p0.y + 2 * inv * t * my + t * t * p1.y,
    z: inv * inv * p0.z + 2 * inv * t * mz + t * t * p1.z,
  };
}

export function buildDtcDriver({
  camera,
  controls,
  targets,        // result of buildDtcTargets(refs)
  getTel,         // () => TEL  (so the driver can read DTC Set each frame)
  homePos,        // optional THREE.Vector3 — camera "rest" position to return to
  homeTgt,        // optional THREE.Vector3 — controls.target "rest" position
}) {
  // Where to glide back to when DTCs clear.  Defaults to whatever the camera
  // is looking at the first time the driver runs (the user's chosen view).
  let _homePos = homePos ? homePos.clone() : null;
  let _homeTgt = homeTgt ? homeTgt.clone() : null;
  const active = new Set();              // currently-pulsing codes
  const forced = new Set();              // test-injected DTCs (re-added each frame
                                         // so simStep can't clear them)
  let focus = null;                      // { code, phase, t, ... }
  let pulsePhase = 0;
  let prevAutoRotate  = null;            // saved across glide so we can restore
  let _prevOrbitSpeed = null;            // saved auto-orbit speed

  function diff(currentSet) {
    const incoming = [];
    const cleared  = [];
    currentSet.forEach(c => { if (!active.has(c)) incoming.push(c); });
    active.forEach(c => { if (!currentSet.has(c)) cleared.push(c); });
    return { incoming, cleared };
  }

  function startFocus(code) {
    const entry = targets.get(code);
    if (!entry || !entry.camera) return;
    // Stash whatever auto-orbit setting the user had; we'll restore it (at
    // a calmer speed) after the settle phase completes.
    if (prevAutoRotate === null) {
      prevAutoRotate = controls.autoRotate;
      _prevOrbitSpeed = controls.autoRotateSpeed;
    }
    controls.autoRotate = false;
    // First time we focus, remember where the user *was* so we can drift
    // back there when all DTCs clear.
    if (!_homePos) {
      _homePos = camera.position.clone();
      _homeTgt = controls.target.clone();
    }

    const fromPos = camera.position.clone();
    const toPos   = entry.camera.position.clone();
    const dist    = fromPos.distanceTo(toPos);
    focus = {
      code,
      phase:   'glide',
      t:       0,
      fromPos, toPos,
      fromTgt: controls.target.clone(),
      toTgt:   entry.camera.lookAt.clone(),
      arcUpY:  dist * ARC_HEIGHT_RATIO,
      isReturn: false,
      // Settle wobble parameters (computed when glide ends)
      settleCenter: null,
      settleAmp:    0,
    };
  }

  // Glide BACK to the saved home position.  Triggered when active drains to
  // empty so the camera doesn't get stuck zoomed in on a fault that already
  // cleared.  No settle wobble on return — just a clean smoothstep arc home.
  function startReturn() {
    if (!_homePos) return;
    controls.autoRotate = false;
    const fromPos = camera.position.clone();
    const toPos   = _homePos.clone();
    const dist    = fromPos.distanceTo(toPos);
    focus = {
      code:    '__return__',
      phase:   'glide',
      t:       0,
      fromPos, toPos,
      fromTgt: controls.target.clone(),
      toTgt:   _homeTgt.clone(),
      arcUpY:  dist * ARC_HEIGHT_RATIO * 0.6,           // shallower arc on return
      isReturn: true,
      settleCenter: null,
      settleAmp:    0,
      _duration: RETURN_DURATION,                       // override default
    };
  }

  // User started dragging / scrolling during a glide → cancel it so we don't
  // fight their input.  OrbitControls fires 'start' on any user interaction.
  const _onUserInteract = () => {
    if (focus) {
      focus = null;
      if (prevAutoRotate !== null) {
        controls.autoRotate      = prevAutoRotate;
        controls.autoRotateSpeed = _prevOrbitSpeed ?? controls.autoRotateSpeed;
        prevAutoRotate = null;
        _prevOrbitSpeed = null;
      }
    }
  };
  controls.addEventListener?.('start', _onUserInteract);

  function update(dt) {
    const TEL = getTel();
    const set = TEL?.DTCs;
    if (!set) return;

    // 0. Re-assert any test-forced DTCs (the simulator's per-frame
    //    evaluation may have just cleared them).
    forced.forEach(c => set.add(c));

    // 1. Diff vs previous frame
    const { incoming, cleared } = diff(set);
    // Forced (test-injected) codes always win priority for the camera focus
    // over simulator-detected codes, so a manual test request can't be
    // shadowed by whatever the sim happened to detect that frame.
    incoming.sort((a, b) => {
      const aForced = forced.has(a) ? 1 : 0;
      const bForced = forced.has(b) ? 1 : 0;
      return bForced - aForced;
    });
    incoming.forEach(code => {
      active.add(code);
      targets.highlight(code, true);
      // Auto camera focus on DTC arrival is DISABLED by design.  Zooming in
      // on a fault washes the screen and is overstimulating on a 75″ display.
      // The component pulse alone draws the eye; mechanics use the explicit
      // "FRAME IN 3D" button on the DTC card to drill in when they want to.
      //
      // To re-enable auto-focus, uncomment:
      //   if (!focus) startFocus(code);
    });
    cleared.forEach(code => {
      active.delete(code);
      targets.highlight(code, false);
    });

    // Return-to-home is only used when an explicit `frameCode()` glide
    // (user-clicked "FRAME IN 3D") needs to be undone.  We don't auto-trigger
    // it on DTC clear anymore because we no longer auto-focus on DTC arrival.
    // The user can dismiss the side card and stay where they were.
    if (active.size === 0 && cleared.length > 0 && _homePos && focus?.code && focus.code !== '__return__') {
      // A previous "FRAME IN 3D" glide is still showing — drift back home.
      if (focus.phase === 'settle') {
        focus = null;
        startReturn();
      }
    }

    // 2. Per-frame pulse refresh (the highlight() above just turns it on;
    //    each kit's setHighlight() internally pulses, but for kits that
    //    use a one-shot emissive we tick them again).
    active.forEach(code => targets.highlight(code, true));
    pulsePhase += dt * Math.PI * 2 * PULSE_HZ;

    // 3. Camera glide / settle state machine
    if (focus) {
      focus.t += dt;

      if (focus.phase === 'glide') {
        // -- GLIDE: smootherstep'd Bezier arc from (fromPos, fromTgt) to
        //    (toPos, toTgt).  Position arcs upward; target lerps directly.
        const dur = focus._duration ?? GLIDE_DURATION;
        const u = Math.min(1, focus.t / dur);
        const e = smootherstep(u);
        const arc = bezierArc(focus.fromPos, focus.toPos, e, focus.arcUpY);
        camera.position.set(arc.x, arc.y, arc.z);
        controls.target.lerpVectors(focus.fromTgt, focus.toTgt, e);
        camera.lookAt(controls.target);
        controls.update();

        if (u >= 1) {
          if (focus.isReturn) {
            // Return glide done — no settle, just hand control back.
            focus = null;
            if (prevAutoRotate !== null) {
              controls.autoRotate      = prevAutoRotate;
              controls.autoRotateSpeed = _prevOrbitSpeed ?? controls.autoRotateSpeed;
              prevAutoRotate  = null;
              _prevOrbitSpeed = null;
            }
          } else {
            focus.phase        = 'settle';
            focus.t            = 0;
            focus.settleCenter = camera.position.clone();
            focus.settleAmp    =
              camera.position.distanceTo(controls.target) * SETTLE_AMP_FRAC;
          }
        }
      } else if (focus.phase === 'settle') {
        // -- SETTLE: small dampened breathing motion around the arrival
        //    position.  Decays from full amplitude to 0 over SETTLE_DURATION.
        const u = Math.min(1, focus.t / SETTLE_DURATION);
        const decay = (1 - u) * (1 - u);                  // quadratic decay
        const a = focus.settleAmp * decay;
        // Two phase-shifted sinusoids — gives a soft "drift" instead of a
        // single-axis wobble.
        const w1 = Math.sin(focus.t * Math.PI * 1.4);
        const w2 = Math.sin(focus.t * Math.PI * 0.9 + 0.7);
        camera.position.set(
          focus.settleCenter.x + a * w2 * 0.6,
          focus.settleCenter.y + a * w1,
          focus.settleCenter.z + a * w1 * 0.4
        );
        camera.lookAt(controls.target);
        controls.update();

        if (u >= 1) {
          focus = null;
          // If no DTCs are active anymore (e.g. the fault self-cleared while
          // we were settling), glide back home instead of orbiting at the
          // close-up framing position.
          if (active.size === 0 && _homePos) {
            startReturn();
          } else {
            // -- FINISHED at the fault framing: restart a slow auto-orbit so
            //    the inspection view keeps gentle motion (avoids the
            //    "frozen screensaver" feel).
            if (prevAutoRotate !== null) {
              controls.autoRotate      = true;
              controls.autoRotateSpeed = SLOW_ORBIT_SPEED;
              prevAutoRotate  = null;
              _prevOrbitSpeed = null;
            }
          }
        }
      }
    }
  }

  function frameCode(code) {
    // User clicked "frame in 3D" on a DTC row — re-trigger the glide even if
    // we've already framed it before.
    startFocus(code);
  }

  function injectTestDtc(code) {
    // For demos / testing without a live bridge.  Force-add and keep adding
    // each frame (forced Set) so the simulator's per-frame DTC sweep can't
    // immediately clear it.
    const TEL = getTel();
    if (!TEL?.DTCs) return false;
    forced.add(code);
    TEL.DTCs.add(code);
    return true;
  }
  function clearTestDtc(code) {
    const TEL = getTel();
    if (!TEL?.DTCs) return false;
    forced.delete(code);
    return TEL.DTCs.delete(code);
  }
  function clearAll() {
    const TEL = getTel();
    forced.clear();
    if (!TEL?.DTCs) return;
    Array.from(TEL.DTCs).forEach(c => TEL.DTCs.delete(c));
  }

  return { update, frameCode, injectTestDtc, clearTestDtc, clearAll, get active() { return [...active]; } };
}
