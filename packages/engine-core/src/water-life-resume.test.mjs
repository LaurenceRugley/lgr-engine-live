/* ============================================================
   water-life-resume.test.mjs — audit 2026-08-17 B2: releasing a piloted boat must NOT teleport it.
   ------------------------------------------------------------
   THE BUG THIS PINS: resumeAutonomy's re-sync was `b.u = b.u` — a self-assign no-op wearing a
   comment that promised the opposite ("hand the lane-follower back a param that matches where the
   human left the hull"). While a human has the helm the lane param `u` FREEZES at the possession
   point; the hull sails away from it. On release the follower resumed at that stale `u`, snapping
   the boat back across the map to wherever you first grabbed it.

   Rule 9 — WHY this matters, not just what: the whole A-BOAT contract is "possession is a lease,
   not a fork" — one boat system, autonomy suspended and resumed in place. A teleport on release
   breaks the fiction that it was ever the same boat. The fix is the real inverse: nearest-u on the
   lane for the hull's current position (coarse sample-and-argmin — it runs once per release, so a
   linear scan is the right tool). C++ anchor: getPointAt is u→position; there is no closed-form
   position→u for a Catmull-Rom loop, so you invert it the numeric way — argmin over samples.

   HEADLESS RIG: water-life.js is a browser-built module — it imports a PNG via Vite's `?url` and
   rasterises glow/spray/gull sheets onto 2D canvases. Neither exists in node, so this file shims
   both seams BEFORE the import: a module hook resolves any `?url` specifier to a stub string
   export (what Vite would emit: a URL), and a stub `document` hands back write-only canvases.
   Everything downstream (loadSpriteSheet, toLuminanceTexture) already guards on window/document,
   and no assertion here reads pixels — the test is about the LANE MATH, not the art.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import * as THREE from 'three';

/* ---- seam 1: Vite's `?url` asset import, shimmed to what Vite would emit (a URL string). ---- */
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.includes('?url')) {
      return { url: 'lgr-asset:' + encodeURIComponent(specifier), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    if (url.startsWith('lgr-asset:')) {
      return { format: 'module', source: 'export default "stub-asset.png";', shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

/* ---- seam 2: a write-only 2D canvas — enough for the glow/spray/gull sheet painters, which
   only ever DRAW (the one reader, toLuminanceTexture, gets zeroed pixels and that is fine). ---- */
const ctx2d = {
  createRadialGradient: () => ({ addColorStop() {} }),
  fillRect() {}, beginPath() {}, moveTo() {}, quadraticCurveTo() {}, stroke() {}, drawImage() {},
  getImageData: (x, y, w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
  putImageData() {},
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d }) };

const { createWaterLife } = await import('./water-life.js');

test('a released boat resumes the lane WHERE THE HUMAN LEFT IT, not at the stale pre-possession u', () => {
  const wl = createWaterLife();
  const boat = wl.getFollowables().find((f) => f.kind === 'boat');
  const lane = wl.lanes[0];                       // boat 1 runs lane 0 (the coast-hugging loop)

  // Let autonomy own it briefly — this is the u the buggy code would resume at.
  for (let i = 0; i < 30; i++) wl.update(1 / 60, i / 60);
  const parked = new THREE.Vector3();
  boat.getWorldPos(parked);

  // Take the helm and sail to the FAR side of the loop (u≈0.5), exactly what a human does.
  boat.pilot.suspendAutonomy();
  const half = lane.getPointAt(0.5, new THREE.Vector3());
  boat.pilot.setTransform({ x: half.x, y: half.y, z: half.z, quat: new THREE.Quaternion() });
  for (let i = 0; i < 30; i++) wl.update(1 / 60, 1 + i / 60);
  const held = new THREE.Vector3();
  boat.getWorldPos(held);
  assert.ok(held.distanceTo(half) < 1e-9, 'setup: a parked lane-follower must not move a piloted hull');

  // Release. One frame later the follower must be carrying on from the hull, not from history.
  boat.pilot.resumeAutonomy();
  wl.update(1 / 60, 2);
  const resumed = new THREE.Vector3();
  boat.getWorldPos(resumed);

  // Tolerance: nearest-u is sampled coarsely (spacing ≈ laneLength/samples ≈ 0.6 u) plus one frame
  // of way and the bob — all well under 1. The stale point is the loop's far side, >10 u away, so
  // the two outcomes cannot be confused.
  const stayNear = resumed.distanceTo(half);
  const snapBack = resumed.distanceTo(parked);
  assert.ok(stayNear < 1.0, `released boat teleported: resumed ${stayNear.toFixed(2)} u from where the human left it`);
  assert.ok(snapBack > 5.0, `setup lost its teeth: stale-u point only ${snapBack.toFixed(2)} u from the release point`);
});
