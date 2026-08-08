/* morph-timeline.test.mjs — node:test, headless, no DOM/GPU.
   Rule 9: these tests would FAIL if the ease logic, endpoint clamping, or monotonicity
   invariant were removed — they encode WHY behavior matters, not just what it does.
   The timeline is the one-scalar spine of every lesson; correctness here matters as much
   as correctness in the shaders. */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { createMorphTimeline, easeInOutCubic } from './morph-timeline.js';

test('easeInOutCubic: f(0)=0, f(1)=1 exactly (endpoint identity)', () => {
  // WHY: if the ease doesn't hit exactly 0 at t=0 and 1 at t=1, the "at-rest" frame
  // shows a wrong matrix (e.g. already partially transformed at t=0), teaching the
  // wrong start/end state — a faithfulness violation.
  assert.equal(easeInOutCubic(0), 0, 'ease(0) must be 0');
  assert.equal(easeInOutCubic(1), 1, 'ease(1) must be 1');
});

test('easeInOutCubic: strictly monotone on [0,1] (no backtracking)', () => {
  // WHY: a non-monotone ease would make the matrix REVERSE during the tween —
  // showing a false intermediate state where the transform undoes itself. That
  // would teach that the path from A to B passes through C, which is wrong.
  for (let i = 1; i <= 100; i++) {
    const prev = easeInOutCubic((i-1) / 100);
    const curr = easeInOutCubic(i / 100);
    assert.ok(curr >= prev, `ease is not monotone at t=${i/100}: ${curr} < ${prev}`);
  }
});

test('scrub: fires onUpdate immediately with clamped t', () => {
  const tl = createMorphTimeline();
  const seen = [];
  tl.onUpdate((v) => seen.push(v));
  tl.scrub(0.4);
  assert.equal(seen.length, 1, 'onUpdate must fire exactly once on scrub');
  assert.equal(seen[0], 0.4, 'onUpdate must receive the scrubbed value');
  // Clamping: t is always ∈ [0,1]
  tl.scrub(-0.5);
  assert.equal(seen[1], 0, 'scrub(-0.5) must clamp to 0');
  tl.scrub(1.9);
  assert.equal(seen[2], 1, 'scrub(1.9) must clamp to 1');
});

test('play: hits from exactly at elapsed=0', () => {
  // WHY: if the first update produces a wrong from-value, the very first frame of
  // every animation shows a corrupted start state (wrong matrix at t=0).
  const tl = createMorphTimeline({ duration: 0.5 });
  const seen = [];
  tl.onUpdate((v) => seen.push(v));
  tl.play(0.2, 0.8);
  // play() fires onUpdate immediately with the from value
  assert.ok(seen.length >= 1, 'play must fire onUpdate on call');
  assert.equal(seen[0], 0.2, 'first value from play must be exactly `from`');
});

test('play: reaches `to` exactly at elapsed >= duration', () => {
  // WHY: if the end state is not exact, the final frame shows a slightly-off matrix —
  // the target transform is never truly shown, so the lesson never lands.
  const tl = createMorphTimeline({ duration: 0.1 });
  let last = null;
  tl.onUpdate((v) => { last = v; });
  tl.play(0, 1);
  // Advance past duration in one big step (seconds)
  tl.update(0.2);
  assert.equal(last, 1, 'final value must be exactly `to` (1) after elapsed ≥ duration');
  assert.equal(tl.t, 1, 'tl.t must equal `to` after completion');
});

test('play: values are monotonically non-decreasing (from < to)', () => {
  // WHY: the matrix-grid lesson depends on M(t) being a real intermediate transform.
  // A timeline that goes back before going forward would reverse the grid momentarily,
  // showing a false backtrack that has no mathematical meaning.
  const tl = createMorphTimeline({ duration: 1 });
  const vals = [];
  tl.onUpdate((v) => vals.push(v));
  tl.play(0, 1);
  for (let i = 0; i < 20; i++) tl.update(0.05);
  for (let i = 1; i < vals.length; i++) {
    assert.ok(vals[i] >= vals[i-1],
      `timeline backtracked at step ${i}: ${vals[i]} < ${vals[i-1]}`);
  }
});

test('scrub: stops any active playback', () => {
  const tl = createMorphTimeline({ duration: 0.5 });
  tl.play(0, 1);
  tl.scrub(0.5);
  assert.equal(tl.playing, false, 'scrub must stop playback');
  tl.update(1);  // a big update (seconds) that would advance play() to completion
  assert.equal(tl.t, 0.5, 'update must not advance t after scrub stopped playback');
});

test('no external allocation on update (structural check: repeated updates are stable)', () => {
  // WHY: the no-hot-alloc invariant prevents GC pauses during animation. We can't
  // measure heap directly in node:test, but we can verify the timeline produces
  // consistent, terminating behavior across 10k updates — which it wouldn't do if
  // alloc caused unbounded growth that slowed execution non-linearly.
  // NOTE (Arc A-UNIT): this test is a pure RATIO check (dt*iterations == duration) —
  // it would pass identically whether `duration`/`dt` are interpreted as ms or seconds,
  // since only their ratio is asserted. It does NOT prove the unit is seconds; the test
  // below ('unit is SECONDS...') is what was added to close that gap.
  const tl = createMorphTimeline({ duration: 1 });
  let count = 0;
  tl.onUpdate(() => count++);
  tl.play(0, 1);
  // dt is duration/10000 with a small margin (not an exact 1e-4) so 10k additions clear
  // the threshold despite float accumulation error — an exact 0.0001 lands at
  // 0.9999999999999062 (just under 1) here, though the old ms-scale numbers (0.1 x 10000)
  // happened to land just OVER — this test was always relying on accumulation luck.
  for (let i = 0; i < 10000; i++) tl.update(0.0001001);
  // Should have fired exactly once per update call (≤ 10001 including play()) and then
  // stopped (not looped).
  assert.ok(count <= 10001, `callback fired ${count} times, expected ≤ 10001`);
  assert.equal(tl.playing, false, 'timeline must stop after duration');
  assert.equal(tl.t, 1, 'final t must be exactly 1');
});

test('unit is SECONDS: a 1s duration takes ~60 real-frame updates at 60fps, not 60000 or 0.06', () => {
  // WHY: this is the exact risk the ARC A-UNIT brief names — a duration/dt unit mismatch
  // makes an animation ~1000x too fast or too slow. A pure ratio test (like the one above)
  // can't catch that, because it would pass under either unit. This test ties `duration`
  // and `dt` to a REAL frame interval (1/60s) so a units bug fails it outright: at the old
  // ms contract, dt=1/60 (~0.0167) would be read as ~0.0167ms per frame, and a "1" duration
  // (read as 1ms) would finish in a single frame instead of ~60.
  const tl = createMorphTimeline({ duration: 1 });
  tl.play(0, 1);
  const FRAME = 1 / 60;                              // one real 60fps frame, in seconds
  let frames = 0;
  while (tl.playing && frames < 1000) { tl.update(FRAME); frames++; }
  assert.ok(frames >= 55 && frames <= 65,
    `a 1s duration took ${frames} frames at 60fps (expected ~60) — the unit is wrong`);
});
