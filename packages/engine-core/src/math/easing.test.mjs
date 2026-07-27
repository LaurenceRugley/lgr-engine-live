/* easing.test.mjs — node:test, headless. Rule 9: each test states the consequence of failure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  linear, smoothstep, easeInOutCubic, easeOutCubic, easeInCubic, easeInOutSine,
  EASINGS, resolveEasing,
} from './easing.js';

const CURVES = [linear, smoothstep, easeInOutCubic, easeOutCubic, easeInCubic, easeInOutSine];

test('every curve pins endpoints f(0)=0, f(1)=1', () => {
  // WHY: a shot that eases position from A to B must actually REACH B and START at A — an endpoint
  // that misses leaves the camera short of its framing, visible as a jump at the shot boundary.
  for (const f of CURVES) {
    assert.ok(Math.abs(f(0) - 0) < 1e-12, `${f.name}(0) != 0`);
    assert.ok(Math.abs(f(1) - 1) < 1e-12, `${f.name}(1) != 1`);
  }
});

test('every curve is monotonic non-decreasing on [0,1]', () => {
  // WHY: a non-monotonic ease backtracks — the camera would drift the wrong way mid-move, and a
  // timelapse sun would briefly set before rising. Intermediate t must be a real point on the path.
  for (const f of CURVES) {
    let prev = -Infinity;
    for (let i = 0; i <= 100; i++) {
      const v = f(i / 100);
      assert.ok(v >= prev - 1e-9, `${f.name} decreased at t=${i / 100} (${v} < ${prev})`);
      prev = v;
    }
  }
});

test('inputs are clamped — overshoot t yields a clean endpoint, not extrapolation', () => {
  // WHY: floating-point progress can tick just past 1.0; without clamping, cubic curves would
  // extrapolate (e.g. easeInCubic(1.1)=1.33), overshooting the camera target with a visible snap-back.
  for (const f of CURVES) {
    assert.equal(f(-0.5), 0, `${f.name} did not clamp below 0`);
    assert.equal(f(1.5), 1, `${f.name} did not clamp above 1`);
  }
});

test('smoothstep and easeInOutSine are symmetric about the midpoint (f(0.5)=0.5)', () => {
  // WHY: a symmetric ease spends equal time accelerating and settling — an orbit that is faster on
  // the way out than back would read as lopsided.
  assert.ok(Math.abs(smoothstep(0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(easeInOutSine(0.5) - 0.5) < 1e-12);
  assert.ok(Math.abs(easeInOutCubic(0.5) - 0.5) < 1e-12);
});

test('ease-in vs ease-out have opposite early curvature', () => {
  // WHY: encodes the semantic difference the director relies on — easeInCubic departs slowly,
  // easeOutCubic arrives slowly. If these were swapped, "push-in that settles" would lunge at the end.
  assert.ok(easeInCubic(0.25) < 0.25, 'easeIn should lag linear early');
  assert.ok(easeOutCubic(0.25) > 0.25, 'easeOut should lead linear early');
});

test('resolveEasing: function passthrough, name lookup, default, and fail-loud', () => {
  const custom = (t) => t;
  assert.equal(resolveEasing(custom), custom, 'a function passes through');
  assert.equal(resolveEasing('smoothstep'), smoothstep, 'a name resolves');
  assert.equal(resolveEasing(undefined), easeInOutCubic, 'default is the house cubic');
  assert.throws(() => resolveEasing('bounce'), /unknown curve/, 'unknown name fails loud, no silent linear');
  assert.deepEqual(Object.keys(EASINGS).sort(),
    ['easeInCubic', 'easeInOutCubic', 'easeInOutSine', 'easeOutCubic', 'linear', 'smoothstep']);
});
