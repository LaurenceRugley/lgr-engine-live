/* ============================================================
   createTextureForge.test.mjs — the PURE, node-testable guards of the forge.
   ------------------------------------------------------------
   The bake itself needs a GPU (no WebGL in node), so it is verified in the browser (hoard2 capture +
   the contact sheet). What CAN and MUST be pinned here is the math that keeps a recipe HONEST — the
   Nyquist feature floor and the tiling-repeat count. These encode WHY the forge looks right, not
   just that a function returns a number (Rule 9): if a recipe's finest band drops under the floor it
   bakes as white noise, and if repeatFor is wrong the tile visibly stretches or shimmers.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nyquistFeatureFloor, repeatFor, FORGE_MIN_TEXELS } from './forge-math.js';

test('nyquistFeatureFloor: a 1024 bake over 4 m resolves ~2.5 cm features minimum', () => {
  const floor = nyquistFeatureFloor(1024, 4);
  // 6.4 texels * 4 m / 1024 px = 0.025 m. Anything finer than this bakes as noise.
  assert.ok(Math.abs(floor - 0.025) < 1e-6, `floor ${floor} != 0.025`);
});

test('nyquistFeatureFloor scales inversely with resolution (more px -> finer honest features)', () => {
  const at512 = nyquistFeatureFloor(512, 4);
  const at1024 = nyquistFeatureFloor(1024, 4);
  assert.ok(at1024 < at512, 'doubling px must halve the feature floor');
  assert.ok(Math.abs(at512 / at1024 - 2) < 1e-9, 'the ratio must be exactly 2');
});

test('nyquistFeatureFloor uses the 6.4-texel constant (the shipped invariant, not a magic literal)', () => {
  // If someone lowers the constant chasing detail, this fails loudly — the whole point of the rule.
  assert.equal(FORGE_MIN_TEXELS, 6.4);
  assert.equal(nyquistFeatureFloor(6400, 1), 0.001); // 6.4 * 1 / 6400 = 0.001
});

test('repeatFor: a 52 m ground disc over a 4 m tile repeats 13x', () => {
  assert.equal(repeatFor(52, 4), 13);
});

test('repeatFor never returns < 1 (a tile larger than the surface still shows one copy, not zero)', () => {
  assert.equal(repeatFor(0.5, 4), 1);
  assert.ok(repeatFor(3, 4) === 1); // clamps up
});

test('repeatFor guards a zero worldSize (no divide-by-zero -> Infinity leaking into a UV transform)', () => {
  const r = repeatFor(10, 0);
  assert.ok(Number.isFinite(r), 'repeatFor must stay finite even at worldSize 0');
});
