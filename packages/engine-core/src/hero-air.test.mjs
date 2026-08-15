/* ============================================================
   hero-air.test.mjs — the airborne layer's curves, pinned to the READS they exist to produce.
   ------------------------------------------------------------
   Rule 9: a test encodes WHY the behaviour matters, not just what the code does. Every assertion below
   names a thing you would SEE go wrong on the screen, because this module's whole job is a visual one —
   the previous arc shipped four frozen frames and the ledger's complaint was "a held frame does not
   breathe". A test that only checked the numbers came back would pass on a module that returned a
   constant, which is precisely the defect under repair.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeAirPose, airPose, riseFall, breathe, climbCycle, AIR_MODES, AIR_POSE_KEYS } from './hero-air.js';

const P = () => makeAirPose();

/* ---- riseFall: the one signal the whole layer is a function of ---- */

test('riseFall is SIGNED and saturates — a rooftop drop is not "more fallen" than terminal', () => {
  // WHY: the shape must be fully expressed at the level's own jumpSpeed and then STOP growing, or a long
  // fall keeps opening the arms past the point where a human body can go and the pose tears.
  assert.equal(riseFall(0, 1.2), 0);
  assert.equal(riseFall(1.2, 1.2), 1);
  assert.equal(riseFall(-1.2, 1.2), -1);
  assert.equal(riseFall(-99, 1.2), -1, 'saturates rather than running away');
  assert.equal(riseFall(1.2, 0), 0, 'a zero reference is a mis-config, not a divide-by-zero');
});

test('riseFall turns SMOOTHLY through the apex — the one frame where vy flips sign', () => {
  // WHY THIS IS THE INTERESTING FRAME: at the top of a jump vy passes through zero in a single frame.
  // With a raw clamp the body would snap from tucked to spread there. The smoothstep makes the
  // derivative near zero vanish, so the apex is a turn, not a corner.
  const near = riseFall(0.02, 1.2), far = riseFall(0.6, 1.2);
  assert.ok(Math.abs(near) < 0.002, `apex is nearly flat, got ${near}`);
  assert.ok(far > 0.4, 'but halfway up it is genuinely committed');
  // symmetric: rising at v and falling at v must be equally strong shapes, opposite sign.
  assert.equal(riseFall(0.5, 1.2), -riseFall(-0.5, 1.2));
});

/* ---- the poses: each mode must be a DIFFERENT silhouette, and none may be a still ---- */

test('every mode writes EVERY field — a mode change can never strand a limb', () => {
  // WHY: the failure this prevents is the ugliest kind and the hardest to spot in review — switch
  // fall→cling and, if `cling` simply didn't touch `kneeRX`, one shin would keep the fall's angle
  // forever. Writing the full struct every call makes that structurally impossible.
  const a = P();
  for (const key of AIR_POSE_KEYS) a[key] = 9.99;          // poison every field
  airPose(a, 'cling', 0, 0, 1);
  for (const key of AIR_POSE_KEYS) assert.notEqual(a[key], 9.99, `cling left ${key} stale`);
  assert.deepEqual(Object.keys(P()).sort(), [...AIR_POSE_KEYS].sort(), 'AIR_POSE_KEYS and makeAirPose agree');
});

test('an unknown or null mode is an EXACT no-op — the release path writes zeros', () => {
  // WHY: `setAirMotion(null)` is how a landing releases the layer. If null left the last pose in place
  // the eased weight would fade a spread-eagle out over a landing instead of the body simply standing up.
  const a = P();
  airPose(a, 'fall', -1, 0.4, 0);
  airPose(a, null, -1, 0.4, 0);
  for (const key of AIR_POSE_KEYS) assert.equal(a[key], 0, `${key} not cleared by a null mode`);
});

test('JUMP and FALL are OPPOSITE silhouettes — the contrast IS the arc', () => {
  // WHY: a jump and a fall happen one frame apart at the apex. If both read as "airborne pose" the
  // player never sees the arc, which is the whole complaint the previous arc left open. The spine is
  // the tell: a launch CRUNCHES forward (+X), a fall ARCHES back (−X).
  const up = P(), down = P();
  airPose(up, 'jump', 1, 0, 0);
  airPose(down, 'fall', -1, 0, 0);
  assert.ok(up.spineX > 0.1, 'a launch closes the chest');
  assert.ok(down.spineX < -0.1, 'a fall opens it');
  // …and the legs invert too: tucked under on the way up, trailing on the way down.
  assert.ok(up.upLegLX > 0.3, 'knees come up on a launch');
  assert.ok(down.upLegLX < up.upLegLX - 0.5, 'and drop away on a fall');
  // the arms are wide on the fall and comparatively close on the launch (a drive, not a spread).
  assert.ok(Math.abs(down.armLZ) > Math.abs(up.armLZ) * 2, 'a fall is the wider shape');
});

test('the air poses SCALE with speed — a short hop is not a rooftop drop', () => {
  // WHY: this is the half a baked clip fundamentally cannot do, and the reason this module is code and
  // not an asset. A clip plays the same at every velocity; these angles are a function of the physics.
  const slow = P(), fast = P();
  airPose(slow, 'fall', -0.2, 0, 0);
  airPose(fast, 'fall', -1, 0, 0);
  assert.ok(Math.abs(fast.armLZ) > Math.abs(slow.armLZ) * 3, 'the faster fall spreads far wider');
  assert.ok(Math.abs(fast.spineX) > Math.abs(slow.spineX) * 3);
});

test('FALL never holds still — the flutter is what "breathing" actually means here', () => {
  // WHY: this is the literal defect on the ledger ("a held frame does not breathe"). Two samples a
  // quarter-second apart, with the physics IDENTICAL, must give different arm angles — if they don't,
  // we have shipped a second still with extra steps.
  const t0 = P(), t1 = P();
  airPose(t0, 'fall', -1, 0.0, 0);
  airPose(t1, 'fall', -1, 0.28, 0);
  assert.notEqual(t0.armLX, t1.armLX);
  assert.ok(Math.abs(t0.armLX - t1.armLX) > 0.02, 'and the difference is visible, not a rounding wobble');
});

test('SWING pumps the legs with the pendulum — knees up on the rise, extended through the bottom', () => {
  // WHY: a real swing is DRIVEN by tucking on the way up. That leg pump is what the eye reads as a
  // swing rather than a body being dragged along a curve, and it is only expressible as a function of
  // which way the body is currently travelling — which is exactly what a clip does not know.
  const rising = P(), dropping = P();
  airPose(rising, 'swing', 1, 0, 0);
  airPose(dropping, 'swing', -1, 0, 0);
  assert.ok(rising.upLegLX > 0.4, 'knees drive up through the rise');
  assert.ok(dropping.upLegLX < 0, 'and the legs extend through the bottom of the arc');
  assert.ok(rising.kneeLX > dropping.kneeLX + 0.4, 'the shins fold and unfold with it');
});

test('SWING leaves the ROPE ARM alone — aim-IK owns it and must win', () => {
  // WHY: the right arm is pointed at the anchor by the rig's aim-IK layer, and A-BODY measured the
  // hand 0.201 u off the body centre line as the proof the rope leaves the HAND. If this layer also
  // wrote that arm it would drag the hand off the anchor and quietly undo that result.
  for (const t of [-1, -0.3, 0, 0.5, 1]) {
    const s = P();
    airPose(s, 'swing', t, 0.7, 0);
    assert.equal(s.armRX, 0, 'the rope arm is untouched');
    assert.equal(s.armRZ, 0);
    assert.equal(s.foreRX, 0);
    assert.notEqual(s.armLX, 0, 'while the FREE arm is genuinely doing something');
  }
});

test('CLING is a SPLAY, not a reach — both arms up and wide, knees out', () => {
  // WHY: this is the previous arc's named weakest pose, and the exact wording of the complaint was
  // "reaching at the wall, not spread-eagled on it". A reach is ONE arm forward. The assertion that
  // distinguishes them is that BOTH arms are raised, and that they go OUT (mirrored Z), not forward.
  const c = P();
  airPose(c, 'cling', 0, 0, 0);
  assert.ok(c.armLX < -0.8 && c.armRX < -0.8, 'BOTH arms are overhead — the thing one aimable arm could not do');
  assert.ok(c.armLZ > 0.4 && c.armRZ < -0.4, 'and mirrored outward, so the silhouette is wide');
  assert.ok(c.upLegLZ > 0.2 && c.upLegRZ < -0.2, 'knees out — a climber frogs the wall, feet do not touch');
  assert.ok(c.spineX > 0.1, 'chest pressed in toward the wall');
});

test('CLING climbs: the four-limb cycle is ANTI-symmetric, and its amplitude is the climb effort', () => {
  // WHY: a static splay is still a decal. A climbing body reaches with one arm while the other holds,
  // driven by the opposite knee — so at any instant the left and right offsets must have OPPOSITE
  // signs about the base. And a player who is not pressing the climb key should barely move.
  const climbing = P();
  airPose(climbing, 'cling', 0, 0.35, 1);              // clock chosen off the cycle's zero crossing
  const dArmL = climbing.armLX - (-1.20), dArmR = climbing.armRX - (-1.20);
  assert.ok(Math.abs(dArmL) > 0.1, 'the reaching arm has actually moved');
  assert.ok(dArmL * dArmR < 0, 'and the two arms move in OPPOSITE directions — a cycle, not a shrug');
  const dLegL = climbing.upLegLX - 0.30, dLegR = climbing.upLegRX - 0.30;
  assert.ok(dLegL * dLegR < 0, 'the knees alternate with them');
  // hanging still: same clock, climb 0 → the same cycle at a fraction of the amplitude.
  const hanging = P();
  airPose(hanging, 'cling', 0, 0.35, 0);
  assert.ok(Math.abs(hanging.armLX + 1.20) < Math.abs(dArmL) * 0.5, 'hanging still is a weight-shift, not a climb');
  assert.notEqual(hanging.armLX, -1.20, 'but it is still ALIVE — a hanging body is not a photograph');
});

test('every declared mode produces a non-trivial pose — no mode is secretly inert', () => {
  // WHY (Rule 12, and the A5→A8 failure class): the bug this repo keeps re-hitting is a layer that
  // silently does nothing. A mode listed in AIR_MODES that returns all zeros would ship as "animated"
  // and be a still. Cheap, total, and it cannot pass on an empty implementation.
  for (const mode of AIR_MODES) {
    const a = P();
    // sample at a rising, a falling and a still instant — a mode need only be alive at ONE of them.
    let alive = false;
    for (const t of [1, -1, 0]) {
      airPose(a, mode, t, 0.4, 0.6);
      if (AIR_POSE_KEYS.some((k) => Math.abs(a[k]) > 0.05)) { alive = true; break; }
    }
    assert.ok(alive, `mode '${mode}' produced no pose at all`);
  }
});

test('breathe and climbCycle are bounded oscillators — an unbounded one would tear a limb off', () => {
  for (let i = 0; i < 200; i++) {
    const c = i * 0.11;
    assert.ok(Math.abs(breathe(c, 5.5)) <= 1);
    assert.ok(Math.abs(climbCycle(c, 2.6)) <= 1);
  }
  assert.notEqual(breathe(0, 5.5), breathe(0.2, 5.5), 'and they actually oscillate');
});
