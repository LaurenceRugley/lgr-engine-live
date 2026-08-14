/* ============================================================
   hero-body-pose.test.mjs — the body's decision logic, pinned to the REASONS it exists.
   ------------------------------------------------------------
   Rule 9: a test encodes WHY the behaviour matters. Each assertion below names the failure it
   prevents, and every one of them is a failure you can SEE on a rigged body and cannot see on a
   capsule — which is the whole argument for having a body at all.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { gaitBlend, gaitName, heroPose, HERO_POSES } from './hero-body-pose.js';

/* ---- gaitBlend: the piecewise map onto the rig's own blend ---- */

test('gaitBlend puts walkSpeed at EXACTLY 0.5 — the blend\'s only pure-walk point', () => {
  // WHY THIS NUMBER AND NOT ANOTHER: createCharacterRig weights the blend
  //   s < 0.5 → idle 1-2s, walk 2s   ·   s >= 0.5 → walk 2-2s, run 2s-1
  // so 0.5 is the unique s where walk = 1 and both neighbours are 0. Anything else mixes a second
  // clip into a plain walk — legs at a cadence the body's travel does not match.
  assert.equal(gaitBlend(0.55, 0.55, 0.95), 0.5);
  assert.equal(gaitBlend(3.0, 3.0, 5.2), 0.5);      // hoard2's own walk/sprint pair
});

test('gaitBlend puts sprintSpeed at EXACTLY 1 — pure run, no walk bleeding through', () => {
  assert.equal(gaitBlend(0.95, 0.55, 0.95), 1);
  assert.equal(gaitBlend(5.2, 3.0, 5.2), 1);
});

test('the naive hs/sprint ratio is the bug this replaces — it walks at a 16% run', () => {
  // The regression guard, stated as the thing that would come back if someone "simplified" this to a
  // division. swing-lab: walk 0.55, sprint 0.95 → naive 0.579, which the rig reads as walk 0.84 +
  // RUN 0.16. Not a rounding difference: a visible second cadence in the legs.
  const naive = 0.55 / 0.95;
  assert.ok(naive > 0.5, 'the naive ratio is on the RUN side of the split (that is the defect)');
  const runWeightNaive = 2 * naive - 1;
  assert.ok(runWeightNaive > 0.15, `naive leaks ${(runWeightNaive * 100).toFixed(0)}% run into a walk`);
  assert.equal(2 * gaitBlend(0.55, 0.55, 0.95) - 1, 0, 'gaitBlend leaks none');
});

test('gaitBlend is 0 at rest, monotonic, and clamped at 1 past sprint', () => {
  assert.equal(gaitBlend(0, 0.55, 0.95), 0);
  assert.equal(gaitBlend(-1, 0.55, 0.95), 0);        // a negative speed is not a backwards run
  let prev = -1;
  for (let hs = 0; hs <= 1.4; hs += 0.05) {
    const g = gaitBlend(hs, 0.55, 0.95);
    assert.ok(g >= prev, `monotonic at hs=${hs.toFixed(2)}`);
    assert.ok(g <= 1, 'never exceeds 1');
    prev = g;
  }
  assert.equal(gaitBlend(99, 0.55, 0.95), 1, 'a launch-speed body still just runs');
});

test('gaitBlend survives a mis-configured speed pair instead of dividing by zero', () => {
  // A consumer that passes sprint <= walk (or zeros) must get a usable number, not NaN/Infinity —
  // a NaN here propagates into an AnimationAction weight and freezes the whole body in bind pose,
  // which reads as "the rig is broken" rather than "the config is wrong".
  for (const g of [gaitBlend(1, 0, 0), gaitBlend(1, 0.5, 0.5), gaitBlend(1, 0.5, 0.2)]) {
    assert.ok(Number.isFinite(g), 'finite');
    assert.ok(g >= 0 && g <= 1, 'in range');
  }
});

/* ---- heroPose: exclusivity, in the controller's own branch order ---- */

test('a roped body is SWINGING even though it is also airborne', () => {
  // character.js runs the grapple branch first and returns; the body must agree. If `airborne` won
  // here the swinging player would play the fall pose for the whole arc — the single most visible
  // pose bug available, since swinging is what this level exists for.
  assert.equal(heroPose({ swinging: true, grounded: false, clinging: false, vy: -3 }), 'swing');
  assert.equal(heroPose({ anchor: { x: 0, y: 5, z: 0 }, grounded: false, vy: -3 }), 'swing');
});

test('a clinging body is CLINGING, not falling — gravity is off, so the fall pose would lie', () => {
  assert.equal(heroPose({ clinging: true, grounded: false, swinging: false, vy: -0.4 }), 'cling');
  // …and the rope still outranks it (both can never be true, but the order must be stated).
  assert.equal(heroPose({ clinging: true, swinging: true, vy: 0 }), 'swing');
});

test('jump vs fall splits on the SIGN of vy, with a band so the apex does not flicker', () => {
  assert.equal(heroPose({ grounded: false, vy: 1.2 }), 'jump');
  assert.equal(heroPose({ grounded: false, vy: -1.2 }), 'fall');
  // THE APEX. vy passes through 0 over one or two frames; a bare `vy > 0` test would emit
  // jump→fall→jump there and the blend would visibly twitch at the top of every jump.
  assert.equal(heroPose({ grounded: false, vy: 0.02 }), 'fall', 'inside the band = already falling');
  assert.equal(heroPose({ grounded: false, vy: 0 }), 'fall');
});

test('grounded is ground regardless of speed — idle/walk/sprint are the GAIT axis, not poses', () => {
  assert.equal(heroPose({ grounded: true, vy: 0 }), 'ground');
  assert.equal(heroPose({ grounded: true, vy: 0, speed: 9 }), 'ground');
});

test('every pose heroPose can return is in HERO_POSES (no undeclared mode)', () => {
  const seen = new Set([
    heroPose(null), heroPose({ grounded: true }), heroPose({ grounded: false, vy: 1 }),
    heroPose({ grounded: false, vy: -1 }), heroPose({ swinging: true }), heroPose({ clinging: true }),
  ]);
  for (const p of seen) assert.ok(HERO_POSES.includes(p), `${p} is declared`);
});

test('gaitName labels agree with the blend boundaries (a HUD that contradicts the legs is worse than none)', () => {
  assert.equal(gaitName(gaitBlend(0, 0.55, 0.95)), 'idle');
  assert.equal(gaitName(gaitBlend(0.55, 0.55, 0.95)), 'walk');
  assert.equal(gaitName(gaitBlend(0.95, 0.55, 0.95)), 'sprint');
});
