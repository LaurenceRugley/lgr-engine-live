/* ============================================================
   @lgr/engine-core — createDiveController (Lesson HOARD-2: the dive, lifted to a reusable seam).
   ------------------------------------------------------------
   The "dive" — a from-view zoom-crossfades into a to-view (god-view → first-person, city → office, iso →
   FPS) — was proven + loved as a feature but was hand-wired at every call site: the city dive inline in
   projects/city, the cavern inline in projects/hoard/cavern.js. This module is the ONE implementation, so
   the cavern, the survivor game, and (eventually) the city dive all share it: no wiring drift.

   OWNERSHIP SPLIT (the reconciliation): createSceneTransition already owns the eased a→in→b→out→a state
   machine + the crossfade/focus material (the L60 seam). This controller adds the two things every consumer
   was re-writing: (1) the two screen-sized render targets (created here, resized here via the core's content-
   resizer registry) and (2) the PRESENT ORCHESTRATION — settled frames render the active view straight to
   the screen; transition frames render BOTH views to the targets and run the crossfade pass. The consumer
   supplies only HOW to render each view (a callback taking a target: null → screen) — so it stays agnostic
   to beauty-present vs renderCityPipeline vs a raw renderer.render.

   freezeFrom (the single-rig case): a consumer with only ONE camera rig (the city / the survivor game render
   the SAME scene from the iso rig-cam and then the FP eye override — it cannot hold both live in one frame)
   sets freezeFrom:true. Then the FROM view is captured ONCE the instant dive() is called (while the rig is
   still in its from-state) and held frozen through the ~1 s descent; only the TO view renders live. The zoom
   push-in hides that the backdrop is a still (you are zooming away from it). A two-camera consumer (the
   cavern owns a separate FPS PerspectiveCamera) leaves freezeFrom:false and both views render live.

   C++ anchor: a compositor object owning two offscreen buffers + a small state machine, parameterized on two
   "draw this view into that target" function pointers — the classic dependency-inject-the-render-callback.
   ============================================================ */
import * as THREE from 'three';
import { createSceneTransition } from './scene-transition.js';

function makeScreenRT(renderer) {
  const db = renderer.getDrawingBufferSize(new THREE.Vector2());
  return new THREE.WebGLRenderTarget(db.x, db.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
  });
}

/* createDiveController(core, opts) — opts:
     rate        — the exponential-ease dive speed (createSceneTransition's rate; 2.4 ≈ a slow ~1 s descent).
     freezeFrom  — true → capture the FROM view once at dive() and hold it through the descent (single-rig
                   consumers); false → render both views live every transition frame (two-camera consumers).
     renderFrom(target) / renderTo(target) — REQUIRED. Render the from/to view into `target` (an RT, or null
                   for the screen). The consumer sets its camera/rig state so these draw the right view.
   Returns: { dive(focusUv), surface(), toggle(focusUv), update(dt)->mode, resize(), dispose(),
              get mode, get diving, get t, transition }.  Call update(dt) once per frame; it presents. */
export function createDiveController(core, {
  rate = 2.4,
  freezeFrom = false,
  renderFrom,
  renderTo,
} = {}) {
  if (typeof renderFrom !== 'function' || typeof renderTo !== 'function') {
    throw new Error('createDiveController: renderFrom(target) and renderTo(target) callbacks are required');
  }
  const { renderer, runPass, registerContentResizer } = core;
  const transition = createSceneTransition({ rate });

  let rtA = makeScreenRT(renderer);   // FROM view (source A)
  let rtB = makeScreenRT(renderer);   // TO view   (source B)
  transition.setSources(rtA.texture, rtB.texture);
  let frozen = false;                 // has the frozen FROM frame been captured this dive?

  function resize() {
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    rtA.setSize(db.x, db.y); rtB.setSize(db.x, db.y);
  }
  // RT.setSize keeps the same .texture object, so setSources stays valid across resize (no re-bind needed).
  if (typeof registerContentResizer === 'function') registerContentResizer((db) => { rtA.setSize(db.x, db.y); rtB.setSize(db.x, db.y); });

  /* dive(focusUv) — begin the descent toward focusUv (screen UV, THREE.Vector2). For a freezeFrom consumer
     this is the moment to snapshot the FROM view: the rig is still in its from-state RIGHT NOW (the consumer
     switches to the to-state only once mode leaves 'a'), so capture it here before that switch. */
  function dive(focusUv) {
    if (transition.mode !== 'a') return false;
    if (freezeFrom) { renderFrom(rtA); frozen = true; }
    return transition.enter(focusUv);
  }
  function surface() { return transition.exit(); }
  function toggle(focusUv) { return transition.mode === 'a' ? dive(focusUv) : surface(); }

  /* update(dt) — advance the ease + PRESENT this frame. Returns the current mode. */
  function update(dt) {
    const mode = transition.update(dt);
    if (mode === 'a') {
      renderFrom(null);            // settled from-view → screen
      frozen = false;              // armed for the next dive
    } else if (mode === 'b') {
      renderTo(null);              // settled to-view → screen
    } else {
      // transitioning: FROM into rtA (live, or the held freeze) + TO into rtB, then crossfade to the screen.
      if (!freezeFrom) renderFrom(rtA);
      else if (!frozen) { renderFrom(rtA); frozen = true; }   // safety: capture if dive() didn't (e.g. snap)
      renderTo(rtB);
      runPass(transition.material, null);
    }
    return mode;
  }

  function dispose() { rtA.dispose(); rtB.dispose(); }

  return {
    dive, surface, toggle, update, resize, dispose, transition,
    get mode() { return transition.mode; },
    get diving() { return transition.transitioning; },
    get t() { return transition.t; },
  };
}
