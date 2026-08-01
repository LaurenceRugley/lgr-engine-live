// character-anim.test.mjs — node:test of the PURE animation state machine (no THREE). Encodes the rig's
// transition invariants (Rule 9 — WHY): a rig must only cross-fade on a REAL state change (re-triggering
// the same clip pops), must map logical states to the right clips, and must know which states hold vs loop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnimStateMachine, ZOMBIE_STATES, ZOMBIE_LOOP_ONCE, strideTimeScale } from './character-anim.js';

test('resolve: the six logical states map to the GLB clip names', () => {
  const sm = createAnimStateMachine();
  assert.equal(sm.resolve('idle'), 'Idle');
  assert.equal(sm.resolve('walk'), 'Walk');
  assert.equal(sm.resolve('run'), 'Run');
  assert.equal(sm.resolve('attack'), 'Punch');
  assert.equal(sm.resolve('hit'), 'HitReact');
  assert.equal(sm.resolve('death'), 'Death');
  assert.equal(sm.resolve('nope'), null);
  // the exported maps stay in sync (all six states present)
  assert.deepEqual(Object.keys(ZOMBIE_STATES).sort(), ['attack', 'death', 'hit', 'idle', 'run', 'walk']);
});

test('to(): a real change reports the edge; same-state and unknown are no-ops (no pop)', () => {
  const sm = createAnimStateMachine();
  let r = sm.to('idle');
  assert.deepEqual([r.changed, r.from, r.to, r.clip], [true, null, 'idle', 'Idle']);
  r = sm.to('walk');
  assert.deepEqual([r.changed, r.from, r.to], [true, 'idle', 'walk']);
  r = sm.to('walk');
  assert.equal(r.changed, false, 're-requesting the current state must NOT re-fade');
  assert.equal(r.reason, 'same');
  r = sm.to('fly');
  assert.equal(r.changed, false, 'an unknown state is ignored');
  assert.equal(r.reason, 'unknown');
  assert.equal(sm.current, 'walk', 'current unchanged by the no-ops');
});

test('loop-once: attack/hit/death hold; idle/walk/run loop', () => {
  const sm = createAnimStateMachine();
  for (const s of ZOMBIE_LOOP_ONCE) assert.ok(sm.isLoopOnce(s), `${s} should be loop-once`);
  for (const s of ['idle', 'walk', 'run']) assert.ok(!sm.isLoopOnce(s), `${s} should loop`);
  assert.equal(sm.to('death').loopOnce, true);
  assert.equal(sm.to('walk').loopOnce, false);
});

test('custom mapping is honoured', () => {
  const sm = createAnimStateMachine({ clips: { idle: 'Stand', walk: 'Stroll' }, loopOnce: [] });
  assert.equal(sm.resolve('idle'), 'Stand');
  assert.equal(sm.to('walk').clip, 'Stroll');
  assert.equal(sm.resolve('run'), null, 'states outside the custom map do not resolve');
});

/* A6-2 STRIDE RATE — the anti-slide playback scaler (WHY: feet must grip, not skate). */
test('strideTimeScale: at the reference speed the clip plays natural (1×); it scales linearly with speed', () => {
  assert.equal(strideTimeScale(1.5, 1.5), 1, 'v == refStride → natural 1× playback');
  assert.ok(Math.abs(strideTimeScale(0.75, 1.5) - 0.5) < 1e-9, 'half the ref speed → half rate (legs slow with the body)');
  assert.ok(Math.abs(strideTimeScale(3.0, 1.5) - 2.0) < 1e-9, 'double the ref speed → double rate (legs quicken)');
});

test('strideTimeScale clamps: a near-stop never FREEZES the pose and a sprint never JUDDERS', () => {
  assert.equal(strideTimeScale(0, 1.5), 0.4, 'zero speed clamps to the min (idle blend handles the actual stop)');
  assert.equal(strideTimeScale(0.01, 1.5, 0.4, 2.4), 0.4, 'crawl clamps to min');
  assert.equal(strideTimeScale(99, 1.5, 0.4, 2.4), 2.4, 'huge speed clamps to max');
  assert.equal(strideTimeScale(2, 1, 0.5, 1.8), 1.8, 'custom max honoured');
});

test('strideTimeScale is defined + finite even with a degenerate refStride (guarded /0)', () => {
  const v = strideTimeScale(1.0, 0);
  assert.ok(Number.isFinite(v), 'refStride 0 does not divide by zero → finite (clamped to max)');
});
