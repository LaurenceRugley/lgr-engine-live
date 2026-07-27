// createParticles.test.mjs — node:test of the PURE ring/budget math (planSpawn). The GPU sim/render need
// a browser (verified by tools/capture-particles.mjs); here we pin the CPU-side allocation invariants
// (Rule 9 — WHY): the pool is BOUNDED (budget) and spawns WRAP as a ring split into scissor rectangles.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planSpawn } from './particle-ring.js';   // pure math split out so node can import it (createParticles.js pulls GLSL)

test('budget clamp: a spawn never exceeds the per-emit cap or the pool', () => {
  const ts = 64, total = ts * ts;
  assert.equal(planSpawn(0, 1000, ts, 64).spawned, 64, 'clamped to the per-emit cap');
  assert.equal(planSpawn(0, 999999, ts, Infinity).spawned, total, 'clamped to the pool size');
  assert.equal(planSpawn(0, -5, ts, 64).spawned, 0, 'negative count → 0');
  assert.equal(planSpawn(0, 10.9, ts, 64).spawned, 10, 'fractional count floored');
});

test('ring allocation: a spawn inside one row is a single scissor rect', () => {
  const ts = 64;
  const { segments, spawned, nextCursor } = planSpawn(10, 20, ts, 64);
  assert.equal(spawned, 20);
  assert.deepEqual(segments, [{ x: 10, y: 0, w: 20 }]);
  assert.equal(nextCursor, 30);
});

test('ring allocation: a spawn crossing a row end splits into two rects', () => {
  const ts = 64;
  const { segments, spawned } = planSpawn(50, 30, ts, 64);   // row 0 has 14 texels left (50..63), then 16 in row 1
  assert.equal(spawned, 30);
  assert.deepEqual(segments, [{ x: 50, y: 0, w: 14 }, { x: 0, y: 1, w: 16 }]);
  // the segments cover exactly `spawned` texels
  assert.equal(segments.reduce((s, g) => s + g.w, 0), 30);
});

test('ring wrap: a cursor near the texture end wraps back to row 0', () => {
  const ts = 8, total = ts * ts;   // 64 texels
  const { segments, nextCursor, spawned } = planSpawn(total - 3, 6, ts, total);   // start at texel 61 (row 7, x5)
  assert.equal(spawned, 6);
  // 3 texels to the end of the last row, then 3 wrap to row 0
  assert.deepEqual(segments, [{ x: 5, y: 7, w: 3 }, { x: 0, y: 0, w: 3 }]);
  assert.equal(nextCursor, 3, 'cursor wrapped past the end back to texel 3');
});

test('every segment stays within the texture bounds', () => {
  const ts = 32, total = ts * ts;
  for (let c = 0; c < total; c += 37) {
    const { segments } = planSpawn(c, 50, ts, total);
    for (const s of segments) {
      assert.ok(s.x >= 0 && s.x < ts && s.y >= 0 && s.y < ts, `seg out of bounds ${JSON.stringify(s)}`);
      assert.ok(s.x + s.w <= ts, `seg overruns its row ${JSON.stringify(s)}`);
    }
  }
});
