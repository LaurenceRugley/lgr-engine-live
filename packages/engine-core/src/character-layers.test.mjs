/* ============================================================
   character-layers.test.mjs — the pure motion-layer math (Rule 9: encode WHY, not "runs").
   Pins the two behaviours the procedural layers rest on: a hit impulse that recoils THEN settles (never a
   step that stays offset), and a head-turn that takes the SHORT way round and can't exceed its cone.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { wrapPi, flinchEnvelope, headYawDelta, swingEnvelope, dipEnvelope } from './character-layers.js';

test('swingEnvelope: three beats — wind-up BACK (negative), forward peak, settle to zero', () => {
  assert.equal(swingEnvelope(0), 0, 'no swing at the very start');
  assert.equal(swingEnvelope(1), 0, 'fully settled at the end — the arm does NOT stay extended');
  assert.equal(swingEnvelope(-0.1), 0);
  assert.equal(swingEnvelope(1.5), 0);
  // WIND-UP: the arm cocks BACK before the strike (this is the "not a single pose" property).
  const windup = swingEnvelope(0.12);
  assert.ok(windup < 0, 'mid wind-up the arm is cocked back (negative), not already swinging');
  // IMPACT: the peak lands near the strike point (u≈0.5) and reaches full forward (~1).
  const peak = swingEnvelope(0.5);
  assert.ok(peak > 0.95, 'the strike whips forward to the +1 peak');
  assert.ok(peak > windup, 'the forward peak is well past the cocked-back wind-up');
  // RECOVERY: past the peak it eases home, still forward but decaying.
  const recover = swingEnvelope(0.8);
  assert.ok(recover > 0 && recover < peak, 'past impact it is settling back toward rest');
});

test('dipEnvelope: a RELOAD dip — zero at ends, HELD at 1 through the middle (drop, work the mag, raise)', () => {
  // WHY this matters (not just what): the reload beat must READ as lower→hold→raise, not a symmetric bump.
  // If the middle didn't plateau at 1 the gun would bob instead of staying down while the hands work — the
  // owner's "reload dip → ready" rhythm depends on the HOLD. A test that only checked the endpoints couldn't
  // fail when the plateau regressed to a peak, so it asserts the sustain explicitly.
  assert.equal(dipEnvelope(0), 0);
  assert.equal(dipEnvelope(1), 0);
  assert.equal(dipEnvelope(-0.1), 0);
  assert.equal(dipEnvelope(0.5), 1, 'held fully lowered through the middle (the mag-work sustain)');
  assert.equal(dipEnvelope(0.4), 1);
  assert.equal(dipEnvelope(0.6), 1);
  assert.ok(dipEnvelope(0.11) > 0 && dipEnvelope(0.11) < 1, 'still dropping in the first fifth');
  assert.ok(dipEnvelope(0.86) > 0 && dipEnvelope(0.86) < 1, 'raising back to ready in the last quarter');
});

test('flinchEnvelope: zero at both ends, positive + single-peaked in between (recoil then settle)', () => {
  assert.equal(flinchEnvelope(0), 0, 'no flinch at the very start');
  assert.equal(flinchEnvelope(1), 0, 'fully settled at the end — the body does NOT stay bent');
  assert.equal(flinchEnvelope(-0.2), 0);
  assert.equal(flinchEnvelope(1.5), 0);
  // rises to a peak then falls — sample a few points, assert the mid is above the tails.
  const early = flinchEnvelope(0.14), mid = flinchEnvelope(0.4), late = flinchEnvelope(0.85);
  assert.ok(early > 0.8, 'the attack snaps near full quickly');
  assert.ok(mid > 0 && mid < early, 'past the peak it is decaying');
  assert.ok(late < mid && late > 0, 'still settling near the end, not yet zero');
});

test('wrapPi keeps a yaw difference the SHORT way round (no 350° head cranes)', () => {
  assert.ok(Math.abs(wrapPi(Math.PI * 1.9) - (-Math.PI * 0.1)) < 1e-9, '342° → -18°');
  assert.ok(Math.abs(wrapPi(-Math.PI * 1.9) - (Math.PI * 0.1)) < 1e-9);
  assert.equal(wrapPi(0), 0);
});

test('headYawDelta: 0 dead ahead, clamps to ±cone, turns the short way', () => {
  const cone = 1.2;
  // target dead ahead (facing +z, target at +z) → no turn.
  assert.ok(Math.abs(headYawDelta(0, 0, 5, cone)) < 1e-9, 'target straight ahead → head stays forward');
  // target 90° to the right (facing +z, target at +x) → +90° but clamped to cone.
  assert.equal(headYawDelta(0, 5, 0, cone), cone, 'a target beyond the cone holds the head at its limit');
  // target directly BEHIND → clamped to the cone (a walker can't spin its head around).
  const behind = headYawDelta(0, 0, -5, cone);
  assert.ok(Math.abs(behind) === cone, 'target behind → head at the cone edge, never over-rotated');
  // a small offset within the cone passes through unclamped.
  const small = headYawDelta(0, Math.sin(0.3), Math.cos(0.3), cone);
  assert.ok(Math.abs(small - 0.3) < 1e-6, 'within-cone target turns the exact bearing');
});

test('headYawDelta respects the character facing (turn is relative to where it already looks)', () => {
  const cone = 2.0;
  // character already facing +x (yaw = π/2); target also at +x → no additional turn.
  assert.ok(Math.abs(headYawDelta(Math.PI / 2, 5, 0, cone)) < 1e-6, 'target where it already faces → 0');
});
