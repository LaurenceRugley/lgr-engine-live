/* tween.test.mjs — node:test, headless. Rule 9: each test states the consequence of failure.
   Primary proof for Arc A-TWEEN (the brief's own words: "this arc's primary proof is UNIT TESTS,
   unusually — easing math is genuinely testable, unlike most of this engine's rendering work"). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createTween } from './tween.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('endpoints: value is exactly `from` before any step, and exactly `to` once complete', () => {
  // WHY: if the first frame doesn't show exactly `from`, a UI element pops in mid-animation on frame
  // one; if the last frame isn't exactly `to`, the tween "settles" at a visibly-wrong resting value
  // forever (e.g. a fade that never quite reaches full opacity).
  const tw = createTween({ from: 10, to: 50, duration: 1 });
  assert.equal(tw.value, 10, 'value before any step() must be exactly `from`');
  tw.step(1);
  assert.equal(tw.value, 50, 'value once elapsed >= duration must be exactly `to`');
  assert.equal(tw.done, true, 'done must be true once the duration has fully elapsed');
});

test('monotonic (ease=linear): value never decreases as time advances toward `to`', () => {
  // WHY: a non-monotone value mid-tween would mean the animated property (a position, an opacity)
  // visibly reverses before continuing forward — the "does it backtrack" bug class every easing
  // curve in this engine is already tested against (math/easing.test.mjs); the tween must inherit it.
  const tw = createTween({ from: 0, to: 100, duration: 1, ease: 'linear' });
  let prev = -Infinity;
  for (let i = 0; i < 50; i++) {
    tw.step(0.02);
    assert.ok(tw.value >= prev, `value decreased at step ${i}: ${tw.value} < ${prev}`);
    prev = tw.value;
  }
});

test('monotonic (ease=easeOutCubic): a non-linear curve is still monotone end to end', () => {
  // WHY: linear alone proving monotonicity would miss a curve-specific backtrack (e.g. a bugged
  // cubic that overshoots past `to` then settles back — visually a bounce nobody asked for).
  const tw = createTween({ from: -20, to: 20, duration: 2, ease: 'easeOutCubic' });
  let prev = -Infinity;
  for (let i = 0; i < 40; i++) {
    tw.step(0.05);
    assert.ok(tw.value >= prev - 1e-9, `value decreased at step ${i}: ${tw.value} < ${prev}`);
    prev = tw.value;
  }
  assert.ok(Math.abs(tw.value - 20) < 1e-9, 'final value must reach `to` exactly');
});

test('delay: value holds at `from` until the delay elapses, THEN the tween runs its full duration', () => {
  // WHY: a staggered reveal (the brief's own stated phase-4/5 use case: N tweens with increasing
  // delays) depends on EVERY tween holding its start value for exactly its own delay window — a
  // delay that leaks early motion would desync the stagger into a ragged, unintentional-looking mess.
  const tw = createTween({ from: 0, to: 1, duration: 0.5, delay: 0.3, ease: 'linear' });
  tw.step(0.2);
  assert.equal(tw.value, 0, 'still inside the delay window — value must not have moved yet');
  assert.equal(tw.done, false);
  tw.step(0.2);   // elapsed since delay start: 0.4 -> 0.1s into the 0.5s tween
  assert.ok(tw.value > 0 && tw.value < 1, `tween should be underway (10% in): got ${tw.value}`);
  tw.step(0.5);   // well past duration now
  assert.equal(tw.value, 1, 'must reach `to` once delay + duration have both elapsed');
  assert.equal(tw.done, true);
});

test('delay + dt-independence: one big step across the whole delay+duration lands on the exact same place as many small ones', () => {
  // WHY: delay is folded into the SAME elapsed accumulator as the tween itself (tween.js's own
  // header) specifically so a big dt spanning both windows in one jump can't desync from many small
  // steps — this is the case most likely to break if delay were a separate phase machine instead.
  const a = createTween({ from: 0, to: 10, duration: 0.6, delay: 0.2, ease: 'linear' });
  a.step(0.5);   // one jump: 0.2 delay + 0.3 into the tween
  const b = createTween({ from: 0, to: 10, duration: 0.6, delay: 0.2, ease: 'linear' });
  for (let i = 0; i < 5; i++) b.step(0.1);   // five small steps, same total 0.5
  assert.ok(Math.abs(a.value - b.value) < 1e-9, `one big step (${a.value}) must equal five small ones (${b.value})`);
});

test('onComplete: fires EXACTLY once, at the moment the tween finishes, never on a later step()', () => {
  // WHY: a double-fired onComplete would double-trigger whatever it drives (e.g. incrementing a
  // score, spawning a follow-up effect) — a classic "fence-post" animation bug. A LATE fire (or a
  // fire on every subsequent step) would keep re-triggering side effects forever after completion.
  let fires = 0;
  const tw = createTween({ from: 0, to: 1, duration: 0.3, onComplete: () => { fires++; } });
  tw.step(0.1); assert.equal(fires, 0, 'must not fire before completion');
  tw.step(0.1); assert.equal(fires, 0, 'still not complete (0.2s of 0.3s)');
  tw.step(0.1); assert.equal(fires, 1, 'must fire exactly once the instant duration is reached');
  tw.step(0.1); tw.step(1); assert.equal(fires, 1, 'must NOT fire again on any later step()');
});

test('onComplete: a single step() that overshoots the whole duration in one jump still fires exactly once', () => {
  // WHY: dt is engine-supplied and can be large (a tab backgrounded and resumed, a slow frame) —
  // completion must not depend on the tween happening to be stepped near its exact duration.
  let fires = 0;
  const tw = createTween({ from: 0, to: 1, duration: 0.2, onComplete: () => { fires++; } });
  tw.step(50);   // wildly overshoots
  assert.equal(fires, 1);
  assert.equal(tw.value, 1);
});

test('cancel: freezes the current value, stops further motion, and suppresses onComplete', () => {
  // WHY: "cancel stops it" (the brief, verbatim) — a cancelled tween must not silently keep running
  // in the background, must not jump to `to`, and must not fire the completion side-effect it was
  // never allowed to reach (the brief's contract: cancel is not the same as fast-forwarding).
  let fired = false;
  const tw = createTween({ from: 0, to: 100, duration: 1, ease: 'linear', onComplete: () => { fired = true; } });
  tw.step(0.4);
  const frozen = tw.value;
  tw.cancel();
  assert.equal(tw.playing, false, 'cancel must stop playback');
  tw.step(0.4); tw.step(10);
  assert.equal(tw.value, frozen, 'a cancelled tween must not move on further step() calls');
  assert.equal(tw.done, false, 'a cancelled tween never reaches done=true (it did not complete, it was stopped)');
  assert.equal(fired, false, 'onComplete must never fire for a cancelled tween');
});

test('dt-independence (the capture-safe property, the brief\'s own headline case): 1×0.5s == 5×0.1s, exactly', () => {
  // WHY (verbatim from the brief): "stepping 1x0.5s and 5x0.1s must land on the same value... that's
  // the property that makes it capture-safe" — a recorder/probe that steps at a DIFFERENT granularity
  // than real gameplay must reproduce byte-identical results, or every capture-based verification in
  // this repo (tier-guard, present-parity, the two-sample proofs) becomes unreliable for anything
  // this module drives.
  const a = createTween({ from: 3, to: 30, duration: 0.5, ease: 'easeInOutCubic' });
  a.step(0.5);
  const b = createTween({ from: 3, to: 30, duration: 0.5, ease: 'easeInOutCubic' });
  for (let i = 0; i < 5; i++) b.step(0.1);
  assert.equal(a.value, b.value, `one 0.5s step (${a.value}) must exactly equal five 0.1s steps (${b.value})`);
});

test('dt-independence holds mid-tween too, not just at the finish line', () => {
  // WHY: a property only checked at completion would miss a bug that desyncs INTERMEDIATE frames
  // (e.g. a recurrence-based implementation masquerading as pure) while still landing correctly at
  // t=1 by coincidence (both paths clamp to the same endpoint regardless of how they got there).
  const a = createTween({ from: 0, to: 1, duration: 1, ease: 'smoothstep' });
  a.step(0.3);
  const b = createTween({ from: 0, to: 1, duration: 1, ease: 'smoothstep' });
  b.step(0.1); b.step(0.1); b.step(0.1);
  assert.ok(Math.abs(a.value - b.value) < 1e-12, `mid-tween values must match exactly: ${a.value} vs ${b.value}`);
});

test('duration <= 0 jumps straight to `to` on the first step past the delay, without dividing by zero', () => {
  const tw = createTween({ from: 5, to: 9, duration: 0 });
  tw.step(1 / 60);
  assert.equal(tw.value, 9);
  assert.equal(tw.done, true);
});

test('unknown ease name fails loud (inherits resolveEasing\'s contract, not a silent linear fallback)', () => {
  assert.throws(() => createTween({ ease: 'bounce' }), /unknown curve/);
});

test('zero-alloc: step() across a 64-tween pool, 12k ticks, drift < 64 KB (spawned --expose-gc heap proof)', () => {
  // "Zero per-frame allocation" (invariant #7) is a CLAIM here otherwise — this makes it a test
  // (Rule 15), the SAME pattern createBallistics.test.mjs already established (spawn a worker under
  // --expose-gc, since node:test itself doesn't run with the flag). See tools/tween-heap.mjs for why
  // the pool is built OUTSIDE the measured region and never completes during it.
  const worker = resolve(HERE, '../../../../tools/tween-heap.mjs');
  let out;
  try {
    out = execFileSync(process.execPath, ['--expose-gc', worker], { encoding: 'utf8' });
  } catch (e) {
    assert.fail(`heap proof exited non-zero (over budget):\n${e.stdout || ''}${e.stderr || ''}`);
  }
  const m = out.match(/HEAPDELTA=(-?\d+)/);
  assert.ok(m, `no HEAPDELTA in worker output:\n${out}`);
  assert.ok(Number(m[1]) < 64 * 1024, `heap grew ${m[1]} bytes ≥ 64 KB`);
});
