/* ============================================================
   sun-rig-keyframes.test.mjs — L-N: the injectable SunRig keyframe contract.
   ------------------------------------------------------------
   WHY THIS MATTERS (intent, not arithmetic): the day/night KEYFRAMES became a client-injectable
   option so a re-skin hands in its own environment sets. The whole point of validateSunKeyframes
   is FAIL-LOUD (Rule 12): a client build with a malformed env set must CRASH AT BOOT with a clear
   message — never silently render a wrong or NaN-lit world. These tests pin that: a bad set throws
   at construction, a good one constructs, and the SHIPPED default set is itself valid (so the
   validator can't drift out of sync with the real keyframes the engine renders every day).

   sun-rig.js imports only THREE (no GLSL), so this runs in plain `node --test`.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateSunKeyframes, createSunRig } from './sun-rig.js';

// A minimal VALID keyframe — every required field present and well-typed.
const goodKF = (name) => ({
  name, sun: '#4a6f9e', intensity: 1, hemiSky: '#26344f', hemiGround: '#0c1018',
  horizon: '#1e2942', sky: '#36486e', exposure: 1, outline: '#101a30', window: 0.5, toonGain: 2,
  turbidity: 3, rayleigh: 1, mie: 0.004, mieG: 0.75,
  gradeTint: '#cfd8ec', gradeSat: 0.9, gradeLift: '#05070e', gradeContrast: 1,
});
const goodSet = () => [goodKF('night'), goodKF('dawn'), goodKF('noon'), goodKF('dusk')];

test('the SHIPPED default keyframes are valid — the validator cannot drift from what the engine renders', () => {
  // createSunRig() with no args uses the module KEYFRAMES; if those ever fail their own validator,
  // every default build would crash at boot. This is the guard that keeps the two in lockstep.
  assert.doesNotThrow(() => createSunRig());
});

test('a valid custom 4-keyframe set is accepted — injection actually works', () => {
  assert.doesNotThrow(() => validateSunKeyframes(goodSet()));
  assert.doesNotThrow(() => createSunRig({ keyframes: goodSet() }));
});

test('the wrong COUNT throws — applyEnvironment indexes % 4, so exactly 4 is the schema', () => {
  // A client that hands in 3 (or 5) keyframes would silently mis-index the day/night ring; catch it loud.
  assert.throws(() => validateSunKeyframes(goodSet().slice(0, 3)), /EXACTLY 4/);
  assert.throws(() => validateSunKeyframes([...goodSet(), goodKF('extra')]), /EXACTLY 4/);
  assert.throws(() => validateSunKeyframes('not an array'), /EXACTLY 4/);
  assert.throws(() => validateSunKeyframes(null), /EXACTLY 4/);
});

test('a missing COLOUR field throws, naming the field — no undefined into THREE.Color', () => {
  const set = goodSet();
  delete set[2].sky;   // noon loses its sky colour
  assert.throws(() => validateSunKeyframes(set), /missing colour field "sky"/);
});

test('a non-finite NUMBER field throws, naming the field — no NaN into the lit scene', () => {
  const bad = goodSet();
  bad[1].intensity = 'bright';   // a string where a number is required
  assert.throws(() => validateSunKeyframes(bad), /field "intensity" must be a finite number/);
  const nan = goodSet();
  nan[0].exposure = NaN;
  assert.throws(() => validateSunKeyframes(nan), /field "exposure" must be a finite number/);
});

test('createSunRig FAILS LOUD at construction on a malformed set — not on first render', () => {
  // The crash must happen at boot (construction), so a client sees it immediately, not as a
  // mysterious mid-run glitch. Passing keyframes straight into the factory must throw.
  assert.throws(() => createSunRig({ keyframes: goodSet().slice(0, 2) }), /EXACTLY 4/);
});
