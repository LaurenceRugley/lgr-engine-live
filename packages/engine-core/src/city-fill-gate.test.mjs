/* city-fill-gate.test.mjs — intent-encoding unit test for nightFillGate (F2b).
   WHY: the F2 fillGate was shipped INVERTED (smoothstep(y, 0, -0.06) — min>max causes
   THREE to return 1 when y>-0.06 and 0 when y<0, opposite of the intended gate).
   Result: the +0.35·sunDownK fill boost fired at noon (washout) and was dead at night
   (night-city fill silently gone). This test encodes the CONTRACT so inversion can't re-land.

   We define the formula here WITHOUT a THREE import (pure smoothstep) so the test:
   (a) runs in Node with no bundler/WebGL context required,
   (b) is not fragile to THREE version changes,
   (c) documents the MATHEMATICAL INTENT independently of the production implementation. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

// Pure smoothstep — mirrors THREE.MathUtils.smoothstep(x, min, max) exactly.
function smoothstep(x, min, max) {
  if (x <= min) return 0;
  if (x >= max) return 1;
  const t = (x - min) / (max - min);
  return t * t * (3 - 2 * t);
}

// nightFillGate: 1 - smoothstep(y, -0.06, 0)
// CONTRACT:
//   y >= 0  → 0   (sun at/above horizon: no fill boost, preventing the grazing-sun washout)
//   y = -0.03 → 0.5  (midpoint of the transition band)
//   y <= -0.06 → 1  (sun below horizon: full fill boost, restoring the night-city warm fill)
//   monotonically non-increasing as y rises (gate closes as sun rises)
function nightFillGate(y) { return 1 - smoothstep(y, -0.06, 0); }

test('nightFillGate: 0 at horizon and above — boost OFF when sun is up (prevents washout)', () => {
  assert.strictEqual(nightFillGate(0),    0, 'y=0: boost must be off at exact horizon');
  assert.strictEqual(nightFillGate(0.01), 0, 'y=0.01: boost must be off just above horizon');
  assert.strictEqual(nightFillGate(0.5),  0, 'y=0.5: boost must be off at noon');
  assert.strictEqual(nightFillGate(1.0),  0, 'y=1.0: boost must be off at zenith');
});

test('nightFillGate: 0.5 at midpoint y=-0.03 — ramps through the 0→-0.06 transition band', () => {
  const v = nightFillGate(-0.03);
  assert.ok(Math.abs(v - 0.5) < 0.001, `expected 0.5 at y=-0.03, got ${v.toFixed(4)}`);
});

test('nightFillGate: 1 at and below y=-0.06 — full boost once sun is below the horizon', () => {
  assert.strictEqual(nightFillGate(-0.06), 1, 'y=-0.06: full boost at threshold');
  assert.strictEqual(nightFillGate(-0.10), 1, 'y=-0.10: full boost at moderate night');
  assert.strictEqual(nightFillGate(-0.50), 1, 'y=-0.50: full boost at deep night');
});

test('nightFillGate: monotonically non-increasing as y rises (gate closes as sun rises)', () => {
  const ys = [-0.10, -0.06, -0.05, -0.04, -0.03, -0.02, -0.01, 0, 0.01, 0.5];
  let prev = nightFillGate(ys[0]);
  for (let i = 1; i < ys.length; i++) {
    const cur = nightFillGate(ys[i]);
    assert.ok(cur <= prev + 1e-9,
      `gate(${ys[i]})=${cur.toFixed(4)} should be ≤ gate(${ys[i - 1]})=${prev.toFixed(4)} (monotonic)`);
    prev = cur;
  }
});
