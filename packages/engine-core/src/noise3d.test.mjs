/* ============================================================
   noise3d.test.mjs — the tiling Perlin-Worley volume builder (Rule 9: encode WHY the clouds can trust it).
   generateVolume is PURE (no THREE) — the one node-testable piece of the cloud lift. What matters: it's
   DETERMINISTIC (same seed → same volume, so clouds are reproducible), the RGBA volume is fully populated
   in-range, and the base (R) channel actually SPANS its range (a flat channel → no cloud gaps to carve).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateVolume } from './noise3d.js';

test('generateVolume is deterministic + a correctly-sized RGBA volume', () => {
  const a = generateVolume({ N: 16, seed: 1337 });
  const b = generateVolume({ N: 16, seed: 1337 });
  assert.equal(a.N, 16);
  assert.equal(a.data.length, 16 * 16 * 16 * 4);
  assert.deepEqual(a.data, b.data, 'same seed → byte-identical volume (reproducible clouds)');
  const c = generateVolume({ N: 16, seed: 42 });
  assert.notDeepEqual(a.data, c.data, 'a different seed → a different volume');
});

test('every channel is a valid 8-bit value; the base (R) channel SPANS its range (carve-able gaps)', () => {
  const { data } = generateVolume({ N: 16, seed: 7 });
  let rMin = 255, rMax = 0;
  for (let i = 0; i < data.length; i += 4) {
    for (let k = 0; k < 4; k++) { const v = data[i + k]; assert.ok(v >= 0 && v <= 255 && Number.isInteger(v)); }
    rMin = Math.min(rMin, data[i]); rMax = Math.max(rMax, data[i]);
  }
  // the R (Perlin-Worley base) must have real contrast — a near-constant channel gives the coverage
  // threshold nothing to carve, so clouds would be all-or-nothing. Assert a wide spread.
  assert.ok(rMin < 60 && rMax > 195, `R base spans a wide range (min ${rMin}, max ${rMax})`);
});
