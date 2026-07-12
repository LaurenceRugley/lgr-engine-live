/* Tests for hidden-prop-logic.js — the two business rules behind the hidden cardboard box.
   Each test pins an INTENT (why the behaviour matters), not merely the current arithmetic. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { pickStreetIntersection, createProximityLatch } from './hidden-prop-logic.js';

// The real city grid (citygen.js LAYOUT): BLOCK 1.9 + STREET 0.55 = PITCH 2.45, N = 6.
const LAYOUT = { PITCH: 2.45, N: 6 };
const BLOCK = 1.9;

test('placement lands on a street, never inside a block — that is WHY it needs no collision test', () => {
  // Block centres are (g - (N-1)/2) * PITCH. A block occupies ±BLOCK/2 around its centre.
  // Every chosen point must miss every block footprint, or the box spawns inside a building.
  const centres = [];
  for (let g = 0; g < LAYOUT.N; g++) centres.push((g - (LAYOUT.N - 1) / 2) * LAYOUT.PITCH);

  for (let i = 0; i < 200; i++) {
    const { x, z } = pickStreetIntersection(LAYOUT, i / 200);
    const insideX = centres.some((c) => Math.abs(x - c) < BLOCK / 2);
    const insideZ = centres.some((c) => Math.abs(z - c) < BLOCK / 2);
    assert.ok(!(insideX && insideZ), `rnd=${i / 200} put the prop inside a block at (${x}, ${z})`);
  }
});

test('placement is deterministic — the same seed yields the same spot on every machine', () => {
  // The egg must be findable: a shared "it's at the crossing north of the park" only works
  // if the position is a pure function of the city seed, not of wall-clock or load order.
  assert.deepEqual(pickStreetIntersection(LAYOUT, 0.42), pickStreetIntersection(LAYOUT, 0.42));
});

test('placement spans the whole grid — all (N-1)^2 intersections are reachable', () => {
  // If the index math collapsed (e.g. an off-by-one in the row divisor), the box would only
  // ever appear on one row of streets and the "hidden" part would be a lie.
  const seen = new Set();
  for (let i = 0; i < 1000; i++) {
    const { x, z } = pickStreetIntersection(LAYOUT, i / 1000);
    seen.add(`${x.toFixed(3)},${z.toFixed(3)}`);
  }
  assert.equal(seen.size, (LAYOUT.N - 1) ** 2);
});

test('placement is symmetric about the origin — the grid is centred, not corner-anchored', () => {
  const first = pickStreetIntersection(LAYOUT, 0);            // lowest index
  const last = pickStreetIntersection(LAYOUT, 0.999999);      // highest index
  assert.ok(Math.abs(first.x + last.x) < 1e-9, 'x extremes should mirror');
  assert.ok(Math.abs(first.z + last.z) < 1e-9, 'z extremes should mirror');
});

test('a rnd of exactly 1.0 clamps instead of indexing off the lattice', () => {
  const p = pickStreetIntersection(LAYOUT, 1.0);
  assert.ok(Number.isFinite(p.x) && Number.isFinite(p.z));
  assert.deepEqual(p, pickStreetIntersection(LAYOUT, 0.999999));
});

test('a degenerate grid is rejected loudly rather than producing a NaN position', () => {
  assert.throws(() => pickStreetIntersection({ PITCH: 2.45, N: 1 }, 0.5), RangeError);
});

test('the latch fires ONCE — the egg is a once-per-session delight, not a per-frame chip', () => {
  // This is the whole point of the latch. A bare `d < r` would re-fire every frame the
  // craft loiters inside the radius; that would spam the "!" chip and cheapen the moment.
  const latch = createProximityLatch(5);
  assert.equal(latch.test(0, 0), true, 'first frame inside must fire');
  assert.equal(latch.test(0, 0), false, 'loitering must NOT re-fire');
  assert.equal(latch.test(1, 1), false, 'still inside, still silent');
});

test('the latch stays fired after the craft leaves — a second flyby is silent', () => {
  const latch = createProximityLatch(5);
  latch.test(0, 0);                       // trip it
  assert.equal(latch.test(100, 100), false, 'far away');
  assert.equal(latch.test(0, 0), false, 'returning must not re-fire — once per session');
  assert.equal(latch.fired, true);
});

test('the latch does not fire outside the radius, and the boundary is exclusive', () => {
  const latch = createProximityLatch(5);
  assert.equal(latch.test(5, 0), false, 'exactly on the boundary is outside (d^2 == r^2)');
  assert.equal(latch.test(6, 0), false);
  assert.equal(latch.fired, false, 'a near miss must leave the egg unfound');
  assert.equal(latch.test(4.9, 0), true, 'just inside fires');
});

test('the latch measures a top-down ring — altitude never blocks the trigger', () => {
  // update() passes only dx/dz: a craft passing directly overhead at 200 units still finds
  // the box. If someone "fixed" this into a 3D sphere test, flying the city would never trip it.
  const latch = createProximityLatch(5);
  assert.equal(latch.test(0, 0), true);   // dy is not a parameter at all — by design
});
