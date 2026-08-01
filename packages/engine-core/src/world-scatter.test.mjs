/* ============================================================
   world-scatter.test.mjs — the lifted play-ring generators (Rule 9: encode WHY the sim can trust them).
   These feed the sim's collision + harvest sets, so the property that MATTERS is determinism: same seed +
   same params ⇒ byte-identical placements (the trace-identity spine). Also pins placeCoverBuildings's fixed
   rng() call ORDER (ang, rad, w, d, h) — a reorder would silently shift every building and desync the sim.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { scatterRuins, scatterProps, deriveHarvest, placeCoverBuildings, citySolidsToObstacles } from './world-scatter.js';

// a tiny deterministic stream so the tests don't depend on the game's mulberry32 (they only need SOME
// reproducible () => [0,1) to prove "same stream ⇒ same output"). Two instances from the same seed match.
function stream(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

test('scatterRuins is deterministic (same stream ⇒ byte-identical ruins) and respects the annulus', () => {
  const a = scatterRuins({ rng: stream(1337), count: 14, innerR: 8, outerR: 22, minSpacing: 3.2 });
  const b = scatterRuins({ rng: stream(1337), count: 14, innerR: 8, outerR: 22, minSpacing: 3.2 });
  assert.deepEqual(a, b, 'same seed → identical ruins (the sim reads these)');
  assert.ok(a.length > 0 && a.length <= 14);
  for (const r of a) {
    const rr = Math.hypot(r.x, r.z);
    assert.ok(rr >= 8 - 1e-9, 'no ruin inside the open inner ring');
    assert.ok(['wall', 'husk', 'rubble'].includes(r.kind));
    assert.ok(r.r > 0, 'has a collider footprint');
  }
});

test('scatterRuins minSpacing keeps ruins apart (no clumping → long sightlines)', () => {
  const rs = scatterRuins({ rng: stream(99), count: 14, innerR: 8, outerR: 24, minSpacing: 3.2 });
  for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
    assert.ok(Math.hypot(rs[i].x - rs[j].x, rs[i].z - rs[j].z) >= 3.2 - 1e-9, 'every pair respects minSpacing');
  }
});

test('placeCoverBuildings pins the rng() ORDER (ang, rad, w, d, h) — a reorder would desync the sim', () => {
  // Feed a stream that RECORDS its draw order, then assert each field consumed exactly one draw in sequence.
  const draws = [];
  let a = 7 >>> 0;
  const rec = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296; draws.push(v); return v; };
  const bs = placeCoverBuildings({ rng: rec, count: 2, innerR: 11, radSpan: 5 });
  assert.equal(bs.length, 2);
  assert.equal(draws.length, 10, 'exactly 5 draws per building (ang, rad, w, d, h)');
  // reconstruct building 0 from the first 5 draws and confirm the formula/order the sim depends on.
  const [d0ang, d0rad, d0w, d0d, d0h] = draws;
  const ang0 = 0 + d0ang * 1.1 + 0.7, rad0 = 11 + d0rad * 5;
  assert.ok(Math.abs(bs[0].x - Math.cos(ang0) * rad0) < 1e-9, 'x from ang(1st draw) + rad(2nd draw)');
  assert.ok(Math.abs(bs[0].w - (4.4 + d0w * 1.6)) < 1e-9, 'w is the 3rd draw');
  assert.ok(Math.abs(bs[0].h - (3.9 + d0h * 1.1)) < 1e-9, 'h is the 5th draw');
  assert.ok(Math.abs(bs[0].r - Math.max(bs[0].w, bs[0].d) * 0.5) < 1e-9, 'cover radius = max(w,d)/2');
});

test('deriveHarvest maps trees→wood, ruins→scrap, with husks yielding extra scrap', () => {
  const h = deriveHarvest([{ x: 1, z: 2 }], [{ x: 3, z: 4, kind: 'husk' }, { x: 5, z: 6, kind: 'wall' }], { woodAmount: 6, scrapAmount: 8 });
  assert.deepEqual(h.wood, [{ x: 1, z: 2, amount: 6 }]);
  assert.equal(h.scrap[0].amount, 12, 'a husk yields scrapAmount + 4');
  assert.equal(h.scrap[1].amount, 8, 'a wall yields the base scrapAmount');
});

test('scatterProps is deterministic and keeps the central spawn clear', () => {
  const a = scatterProps({ rng: stream(5), count: 30, radius: 24, clearR: 1.8, minSpacing: 1.25 });
  const b = scatterProps({ rng: stream(5), count: 30, radius: 24, clearR: 1.8, minSpacing: 1.25 });
  assert.deepEqual(a, b);
  for (const p of a) assert.ok(Math.hypot(p.x, p.z) >= 1.8 - 1e-9, 'no prop in the central clearR (the spawn)');
});

test('citySolidsToObstacles (ARC A21) maps one AABB to a centred, conservative circle + a matching cylinder', () => {
  // one solid: x∈[0,4] (width 4), y∈[0,2] (height 2), z∈[0,2] (depth 2) → centre (2,1), half-diagonal hypot(2,1)
  const solids = new Float32Array([0, 0, 0, 4, 2, 2]);
  const { obstacles, buildingCylinders } = citySolidsToObstacles(solids);
  assert.equal(obstacles.length, 1);
  assert.equal(obstacles[0].x, 2); assert.equal(obstacles[0].z, 1);
  assert.ok(Math.abs(obstacles[0].r - Math.hypot(2, 1)) < 1e-9, 'radius is the horizontal half-diagonal (conservative — never smaller than the true footprint)');
  assert.deepEqual(buildingCylinders[0], { x: 2, z: 1, r: obstacles[0].r, h: 2 }, 'the cylinder carries the AABB height too');
});

test('citySolidsToObstacles handles an empty solids array (no buildings) and multiple solids in order', () => {
  assert.deepEqual(citySolidsToObstacles(new Float32Array(0)), { obstacles: [], buildingCylinders: [] });
  const two = new Float32Array([0, 0, 0, 2, 1, 2,  10, 0, 10, 12, 3, 12]);
  const { obstacles } = citySolidsToObstacles(two);
  assert.equal(obstacles.length, 2);
  assert.equal(obstacles[1].x, 11); assert.equal(obstacles[1].z, 11);
});
