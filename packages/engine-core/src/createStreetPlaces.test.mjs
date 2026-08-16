// createStreetPlaces.test.mjs — node:test of the PURE gathering-place math (no THREE, no GPU, no page).
// These encode the DISTRIBUTION INVARIANTS the crowd read depends on (Rule 9 — WHY, not "it runs"):
//   • BOTH VOCABULARIES SURVIVE THE QUOTA — the regression test for the bug this module shipped and the
//     visibility bench caught: a global `hash * kindWeight` sort made a mid-block STOP mathematically
//     unable to outscore a junction CORNER, so at any truncation every kept place was a corner and the
//     canyons (half of every street a player walks down) had nothing in them.
//   • THE WEIGHTED PICK IS UNBIASED — the other regression test, and the one the numbers found first.
//     A one-pass "reservoir" using a SINGLE fixed uniform is not weighted reservoir sampling; it
//     degenerates to "the last item that passes", which piled a 600-body crowd onto a few places.
//     A sampler that is subtly wrong looks exactly like a correct one until something counts its output.
//   • PLACES RESPECT THE CONSUMER'S BLOCKED TEST — a gathering place inside a building gathers nobody,
//     and every body sent there would be clamped back out by the sim, i.e. silently deleted from the
//     crowd read.
//   • DETERMINISM — one seed replays one crowd. The whole outbreak-replay claim rides on it.
//   • THE WALKER SPLIT IS REAL — walkers must not get the loiter bonus, because "everyone loiters" is
//     measurably the arm that empties the streets between the groups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreetPlaces } from './createStreetPlaces.js';

// mulberry32, the same stream shape createAgentRng hands the sim, so the tests exercise the real seam.
function rng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (x, y) => x + (y - x) * next();
  next.chance = (p) => next() < p;
  return next;
}
const BASE = { spacing: 4.6, extent: 30, roadHalf: 1.081, count: 60, seed: 11 };

test('both vocabularies survive the quota — a mid-block stop can never be sorted out of existence', () => {
  const sp = createStreetPlaces({ ...BASE, count: 60 });
  assert.ok(sp.stats.corners > 0, 'no junction corners kept');
  assert.ok(sp.stats.stops > 0, 'NO MID-BLOCK STOPS KEPT — the global-sort bug is back, and with it an empty canyon');
  // and the quota, not luck, is what did it: the shares are honoured to within a rounding place.
  const total = sp.stats.corners + sp.stats.stops;
  assert.ok(Math.abs(sp.stats.corners / total - 0.55) < 0.08, `corner share ${sp.stats.corners}/${total} is not the 0.55 quota`);
});

test('the quota is a share of `count`, so the group SIZE is what the consumer states', () => {
  const few = createStreetPlaces({ ...BASE, count: 20 });
  const many = createStreetPlaces({ ...BASE, count: 200 });
  assert.equal(few.stats.kept, 20);
  assert.equal(many.stats.kept, 200);
  // ...and the small set is a SUBSET of the large one — growing the crowd must not reshuffle the
  // corner the player was just looking at (box-arena's index-addressed determinism rule).
  const key = (p) => `${p.kind}:${p.x.toFixed(4)},${p.z.toFixed(4)}`;
  const big = new Set(many.places.map(key));
  for (const p of few.places) assert.ok(big.has(key(p)), `place ${key(p)} vanished when count grew`);
});

test('the weighted pick is UNBIASED — the single-uniform reservoir bug, pinned', () => {
  /* THE LIST HAS TO BE LONG FOR THIS TEST TO BE ABLE TO FAIL, and the first version of it was not.
     The broken sampler is `if (u * total_i <= w_i) chosen = i` with u FIXED, which for equal weights
     selects the LAST index satisfying u <= 1/i, i.e. index floor(1/u): P(0) = 1/2, P(1) = 1/6,
     P(2) = 1/12 … ~1/k². Over THREE places that lands 49.7 / 17.1 / 33.2 — bad, but close enough to
     flat that a loose bound waves it through (measured: it did). Over TWENTY the same code puts half
     the crowd on ONE place against an expected 5%, which is exactly the collapse the visibility bench
     saw in the city. So: many places, and the bar is each place's OWN weight share, not flatness. */
  const sp = createStreetPlaces({ ...BASE, count: 20 });
  const N = 20000;
  const r = rng(7), out = { x: 0, z: 0 };
  const hits = new Map();
  for (let i = 0; i < N; i++) {
    sp.spawn(r, out);
    let best = null, bd = Infinity;
    for (const p of sp.places) { const d = Math.hypot(p.x - out.x, p.z - out.z); if (d < bd) { bd = d; best = p; } }
    hits.set(best, (hits.get(best) || 0) + 1);
  }
  assert.equal(hits.size, sp.places.length, 'some place was never spawned into at all');
  const totalW = sp.places.reduce((a, p) => a + p.w, 0);
  let worst = 0, worstP = null;
  for (const p of sp.places) {
    const expect = p.w / totalW, got = (hits.get(p) || 0) / N;
    const err = Math.abs(got - expect);
    if (err > worst) { worst = err; worstP = { expect, got }; }
  }
  assert.ok(worst < 0.02,
    `spawn share is off its weight share by ${(worst * 100).toFixed(1)} points (expected ${(worstP.expect * 100).toFixed(1)}%, got ${(worstP.got * 100).toFixed(1)}%) — the sampler is biased`);
});

test('a place is never inside a building — the consumer blocked test is honoured at construction AND per point', () => {
  // a wall down x ∈ [1.0, 2.0]: everything in that strip is "inside a building".
  const blocked = (x) => x > 1.0 && x < 2.0;
  const sp = createStreetPlaces({ ...BASE, count: 40, blocked });
  for (const p of sp.places) assert.equal(blocked(p.x), false, `a place was kept inside the wall at x=${p.x}`);
  const r = rng(3), out = { x: 0, z: 0 };
  let inside = 0;
  for (let i = 0; i < 3000; i++) { sp.spawn(r, out); if (blocked(out.x)) inside++; }
  assert.equal(inside, 0, `${inside} spawn points landed inside the wall`);
});

test('one seed replays one crowd — same stream in, identical points out', () => {
  const mk = () => createStreetPlaces({ ...BASE, count: 40 });
  const draw = (sp, seed) => {
    const r = rng(seed), out = { x: 0, z: 0 }, acc = [];
    for (let i = 0; i < 200; i++) { sp.spawn(r, out); acc.push(`${out.x.toFixed(6)},${out.z.toFixed(6)}`); }
    for (let i = 0; i < 200; i++) { sp.wander(r, { id: i, x: acc[i] ? Number(acc[i].split(',')[0]) : 0, z: 0 }, out); acc.push(`${out.x.toFixed(6)},${out.z.toFixed(6)}`); }
    return acc.join('|');
  };
  assert.equal(draw(mk(), 99), draw(mk(), 99));
});

test('a WALKER does not loiter, and a loiterer at a place centre does — the split is not cosmetic', () => {
  const sp = createStreetPlaces({ ...BASE, count: 40, loiterFrac: 0.5, dwell: 3.2 });
  const p = sp.places[0];
  // find one id of each class (isWalker is a pure hash of the id, so this is stable)
  let walker = -1, loiterer = -1;
  for (let id = 0; id < 400 && (walker < 0 || loiterer < 0); id++) {
    const s = sp.dwellScale({ id, x: p.x, z: p.z });
    if (s === 1 && walker < 0) walker = id;
    if (s > 1 && loiterer < 0) loiterer = id;
  }
  assert.ok(walker >= 0, 'no walkers at all — loiterFrac is not being applied');
  assert.ok(loiterer >= 0, 'no loiterers at all — loiterFrac is not being applied');
  assert.equal(sp.dwellScale({ id: walker, x: p.x, z: p.z }), 1, 'a walker was given the loiter bonus');
  assert.ok(sp.dwellScale({ id: loiterer, x: p.x, z: p.z }) > 4, 'a loiterer at a place CENTRE should get the full 1 + dwell');
  // ...and the bonus decays to nothing outside the place, so the edge of a group is a soft edge.
  assert.equal(sp.dwellScale({ id: loiterer, x: p.x + p.r * 2, z: p.z + p.r * 2 }), 1);
});

test('the placer keeps its promise to the sim: out is written, never allocated, and always finite', () => {
  const sp = createStreetPlaces({ ...BASE, count: 30 });
  const r = rng(5), out = { x: 0, z: 0 };
  for (let i = 0; i < 500; i++) {
    const ret = sp.wander(r, { id: i, x: (i % 20) - 10, z: (i % 13) - 6 }, out);
    assert.equal(ret, out, 'wander must write the caller buffer, not return a fresh object');
    assert.ok(Number.isFinite(out.x) && Number.isFinite(out.z), 'wander produced a non-finite target');
  }
});
