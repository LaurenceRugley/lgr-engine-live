/* ============================================================
   reel-grammar.test.mjs — the trailer/reel grammar (Arc R1, Rule 9: intent, not "runs"). Pins the LAWS
   the compositor + director + capture scripts all trust: hook-first (no intro), 2–3 s shots, wide→med→close
   rotation, focal-from-framing, and the loop-back tail that closes the seam. Each assertion would FAIL if
   the grammar drifted from docs/reel-factory-formats-2026-07-28.md. Pure — no THREE, no DOM.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReelPlan, GRAMMAR, FRAMING_FOCAL, FOCAL_FOV } from './reel-grammar.js';

test('trailer rule — beat[0] is the hook; an intro-flagged opener FAILS LOUD (real footage from frame one)', () => {
  assert.throws(() => buildReelPlan([{ id: 'logo', intro: true }, { id: 'game' }]),
    /intro/, 'an intro opener must be rejected — the whole grammar is "no cinematic intro"');
  assert.throws(() => buildReelPlan([]), /at least one beat/, 'empty beat list is not a reel');
  const plan = buildReelPlan([{ id: 'horde' }, { id: 'combat' }], { loop: false });
  assert.equal(plan.shots[0].isHook, true, 'first shot carries the hook flag');
});

test('shot duration is clamped into the 2–3 s grammar window (a flicker or a bleed is corrected, and warned)', () => {
  const plan = buildReelPlan([
    { id: 'a', durationMs: 400 },     // too short → flicker
    { id: 'b', durationMs: 9000 },    // too long → bleed
  ], { loop: false });
  assert.equal(plan.shots[0].durationMs, GRAMMAR.shotMinMs, '400ms clamped up to the 2s floor');
  assert.equal(plan.shots[1].durationMs, GRAMMAR.shotMaxMs, '9000ms clamped down to the 3s ceiling');
  assert.ok(plan.warnings.some((w) => /clamped/.test(w)), 'a clamp is surfaced, not silent (Rule 12)');
});

test('framing rotates wide→medium→close by position, and the focal is derived from the framing', () => {
  const plan = buildReelPlan([{ id: '0' }, { id: '1' }, { id: '2' }], { loop: false });
  assert.deepEqual(plan.shots.map((s) => s.framing), ['wide', 'medium', 'close'], 'default rotation');
  assert.equal(plan.shots[0].focalMm, FRAMING_FOCAL.wide, 'wide → 24mm');
  assert.equal(plan.shots[2].focalMm, FRAMING_FOCAL.close, 'close → 85mm');
  assert.equal(plan.shots[0].fov, FOCAL_FOV[24], 'fov comes off the focal set');
});

test('an unknown framing or off-set focal FAILS LOUD (a typo must not silently pick a wrong lens)', () => {
  assert.throws(() => buildReelPlan([{ id: 'x', framing: 'closeup' }]), /unknown framing/);
  assert.throws(() => buildReelPlan([{ id: 'x', focalMm: 40 }]), /off-set focal/);
});

test('loop-aware — a loop reel appends a caption-less return beat matching the opening framing (invisible seam)', () => {
  const beats = [{ id: 'dusk', framing: 'wide', caption: 'THE HORDE COMES' }, { id: 'combat', framing: 'close', caption: 'STAND YOUR GROUND' }];
  const looped = buildReelPlan(beats, { loop: true });
  const back = looped.shots[looped.shots.length - 1];
  assert.equal(back.isLoopback, true, 'a loopback tail exists');
  assert.equal(back.framing, 'wide', 'the loopback returns to the OPENING framing so the last frame flows into the first');
  assert.equal(back.caption, '', 'the loopback carries no caption — it must read as the opening frame, not a new beat');

  const noloop = buildReelPlan(beats, { loop: false });
  assert.equal(noloop.shots.length, 2, 'loop:false appends no tail');
  assert.equal(looped.shots.length, 3, 'loop:true appends exactly one tail');
});

test('total runtime is reported and the looper-floor / engagement-ceiling are warned, not enforced silently', () => {
  const tiny = buildReelPlan([{ id: 'a', durationMs: 2000 }], { loop: false });
  assert.equal(tiny.totalMs, 2000, 'totalMs sums the shots');
  assert.ok(tiny.warnings.some((w) => /looper floor/.test(w)), 'a 2s reel warns it is under the 7s looper floor');
});
