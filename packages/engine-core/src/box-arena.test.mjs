/* box-arena.test.mjs — A-SKYLINE (2026-08-10). The contract of the SWINGABLE-BY-CONSTRUCTION level.
   ------------------------------------------------------------------------------------------------
   WHY THESE ASSERTIONS AND NOT OTHERS (Rule 9 — a test encodes WHY the behaviour matters):

   1. THE DEFAULT PATH IS AN EXACT NO-OP. `projects/swing-lab`'s 27-check probe, every number in the
      swing ledger's A-LAB/A-LOCK/A-CLIMB tables, and the lab's derived rope are all calibrated to the
      uniform grid. If adding a skyline profile moved one box on that path, every one of those rows
      would silently become a claim about a different level. So the old path is pinned box-for-box.

   2. THE GUARANTEE IS THE WHOLE POINT. metropolis's measured failure is not "buildings are short", it
      is that NOTHING in the generator knew about the arc-bottom rule — 9 of 162 towers cleared it and
      the number was discovered afterwards. A level that states `frac` and then delivers something else
      is that failure with better intentions, so the fraction is asserted, not reported.

   3. THE LOOP MUST CLOSE. Generate from a rope, then derive the rope back out of the generated skyline
      with `swingableRope(roofAt(1 - frac))`. Agreement is a check on both derivations at once; this is
      the same "a derivation that agrees is a check, a literal that agrees is a coincidence" rule the
      metropolis port used.

   4. SILHOUETTE PARTS MUST BE IN THE COLLIDER BUFFER, because that is the only thing that makes them
      real to the mechanic: `findAnchor` casts `segmentHit` against `solids` and nothing else. A spire
      that exists only as a mesh is scenery; a spire in the buffer is an anchor 2 u above the roof.

   5. A TOWER'S ROOF SURVIVES ITS OWN SILHOUETTE. Tiers and cornices apportion height out of the total,
      so the topmost tier still ends where the quantile map said — otherwise the setbacks would quietly
      shorten every building and (2) would be false in a way (2) could not see.
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoxArena, swingableHeight, swingableRope, topAtPercentile, percentileOf } from './box-arena.js';

const LAB = { cols: 9, rows: 9, spacing: 4.2, width: 1.7, height: 5.31, heightVary: 0.45, plaza: 1, seed: 7 };

test('DEFAULT PATH: passing skyline/silhouette undefined changes nothing, box for box', () => {
  const a = createBoxArena(LAB);
  const b = createBoxArena({ ...LAB, skyline: null, silhouette: null });
  assert.equal(a.boxes.length, b.boxes.length);
  assert.equal(a.solids.length, b.solids.length);
  for (let i = 0; i < a.solids.length; i++) assert.equal(a.solids[i], b.solids[i], `solid float ${i}`);
  // and the new accessors agree with the old one when there are no parts to disagree about
  assert.equal(a.stats.parts, 0, 'the uniform grid emits no silhouette parts');
  assert.equal(a.towers.length, a.boxes.length, 'every box IS a tower on the default path');
  for (const p of [0, 0.2, 0.35, 0.5, 0.95, 1]) {
    assert.equal(a.roofAt(p), a.topAt(p), `roofAt must equal topAt at p=${p} when parts do not exist`);
  }
  assert.equal(a.stats.swingable, null, 'no skyline profile → no guarantee to state');
});

test('DEFAULT PATH: the lab rope derivation is unmoved (the number in the ledger)', () => {
  const a = createBoxArena(LAB);
  const rope = swingableRope({ towerTop: a.roofAt(0.35), arcClear: 0.45, skim: 0.06, groundY: 0, ropeMin: 0.55 });
  assert.ok(Math.abs(rope - 4.10) < 0.02, `A-CLIMB measured 4.10 u off this arena; got ${rope.toFixed(3)}`);
});

const CITY = {
  cols: 15, rows: 15, spacing: 4.6, width: 1.9, plaza: 1, seed: 11, groundY: 0,
  skyline: { frac: 0.70, ropeMax: 4.10, arcClear: 0.45, skim: 0.06, tall: 2.1, low: 0.22, cores: 3 },
  silhouette: {},
};

test('THE GUARANTEE: the stated fraction of towers clears the arc-bottom rule, counted', () => {
  const a = createBoxArena(CITY);
  const s = a.stats.swingable;
  assert.ok(s, 'a skyline profile must publish its own guarantee');
  const need = swingableHeight({ ropeMax: 4.10, arcClear: 0.45, skim: 0.06, groundY: 0, margin: 0 });
  assert.ok(Math.abs(s.need - need) < 1e-9, 'the level built against the mechanic\'s own arc-bottom rule');
  // The break sits AT `need`, so the tower exactly on it does not clear — hence a one-tower tolerance.
  assert.ok(s.frac >= s.want - 1 / s.towers, `wanted >= ${s.want}, got ${s.frac.toFixed(3)} (${s.clearing}/${s.towers})`);
  assert.ok(s.frac <= s.want + 2 / s.towers, `the guarantee is a floor, not a blank cheque: ${s.frac.toFixed(3)}`);
});

test('THE LOOP CLOSES: the rope derived back out of the generated skyline is the rope it was built from', () => {
  const a = createBoxArena(CITY);
  const back = swingableRope({ towerTop: a.roofAt(1 - 0.70), arcClear: 0.45, skim: 0.06, groundY: 0, ropeMin: 0.55 });
  assert.ok(Math.abs(back - 4.10) < 0.06, `built from rope 4.10, skyline hands back ${back.toFixed(3)}`);
});

test('roofAt is NOT topAt once parts exist — and that difference is the trap it was added for', () => {
  const a = createBoxArena(CITY);
  assert.ok(a.stats.parts > a.stats.towers, 'a silhouetted city is majority parts by count');
  assert.ok(a.roofAt(0.30) > a.topAt(0.30) + 0.5,
    'topAt(0.30) over a parts-heavy buffer answers a question about cornices, not about the skyline — ' +
    'feeding it to swingableRope is exactly the bug roofAt exists to prevent');
});

test('SILHOUETTE PARTS ARE COLLIDER SOLIDS — the only thing that makes them webbable', () => {
  const plain = createBoxArena({ ...CITY, silhouette: null });
  const sil = createBoxArena(CITY);
  assert.equal(plain.stats.parts, 0, 'skyline without silhouette = one box per tower');
  assert.ok(sil.boxes.length > plain.boxes.length, 'the silhouette adds geometry');
  assert.equal(sil.solids.length, sil.boxes.length * 6, 'EVERY box, parts included, is in the packed AABB buffer');
  const kinds = new Set(sil.boxes.map((b) => b.kind));
  for (const k of ['tower', 'setback', 'cornice', 'roofbox', 'spire', 'bridge']) {
    assert.ok(kinds.has(k), `the generator must actually emit ${k}s (found: ${[...kinds].join(', ')})`);
  }
  // a spire must reach ABOVE the roof it stands on, or it is not an anchor, it is a decoration
  const spires = sil.boxes.filter((b) => b.kind === 'spire');
  for (const s of spires) {
    const t = sil.towers.find((r) => r.i === s.i && r.j === s.j);
    assert.ok(s.top > t.top + 0.5, 'a spire is worth building only if it puts an anchor above the roof');
  }
  // a bridge must have air under it — that is its whole reason to exist (ledger OPEN #6)
  const bridges = sil.boxes.filter((b) => b.kind === 'bridge');
  assert.ok(bridges.length > 0);
  for (const b of bridges) assert.ok(b.y > 1.0, 'a skybridge that rests on the street is a wall');
});

test('A TOWER KEEPS ITS ROOF: setbacks apportion height, they do not steal it', () => {
  const sil = createBoxArena(CITY);
  const plain = createBoxArena({ ...CITY, silhouette: null });
  assert.equal(sil.towers.length, plain.towers.length);
  for (let k = 0; k < sil.towers.length; k++) {
    assert.ok(Math.abs(sil.towers[k].top - plain.towers[k].top) < 1e-9,
      'the silhouette must not move a single roof, or the swingability guarantee is measuring a different city');
  }
  // …and the stack actually reaches it: some box of that tower ends at the roof.
  for (const t of sil.towers.slice(0, 40)) {
    const reaches = sil.boxes.some((b) => b.i === t.i && b.j === t.j && Math.abs(b.top - t.top) < 1e-6);
    assert.ok(reaches, 'no box of this tower ends at the roof the record claims');
  }
});

/* THIS TEST CHANGED SHAPE BECAUSE IT FAILED, and the failure was the more interesting half. The first
   version asserted that a new seed moves `roofMedian`. It does not, and cannot: the seed decides which
   CELL gets which RANK, and the rank→height map is fixed by the quantile arithmetic — so the multiset
   of roof heights is a property of (frac, tall, low, gamma, count) alone and is SEED-INVARIANT.
   That is not a limitation, it is the guarantee's other face: rerolling a skyline city changes where
   downtown is and cannot change how swingable the city is. Worth pinning explicitly, because the
   obvious "reroll until it feels right" workflow would otherwise be a silent no-op on the one property
   the level exists to provide. */
test('DETERMINISM: same seed → byte-identical; a new seed rearranges the city but NOT its swingability', () => {
  const a = createBoxArena(CITY), b = createBoxArena(CITY);
  assert.equal(a.solids.length, b.solids.length);
  for (let i = 0; i < a.solids.length; i++) assert.equal(a.solids[i], b.solids[i]);

  const c = createBoxArena({ ...CITY, seed: 12 });
  /* COMPARED BY CELL, NOT BY INDEX — `towers` is in RANK order (the sort is what decouples the district
     field from the quantile map), so an index-for-index comparison compares rank k against rank k and
     is identical by construction. That mistake failed this test once; it is the kind of thing a probe
     that "looks right" would have hidden. */
    const topAtCell = (arena) => new Map(arena.towers.map((t) => [t.i * 4096 + t.j, t.top]));
  const ca = topAtCell(a), cc = topAtCell(c);
  let moved = 0;
  for (const [k, v] of ca) if (Math.abs(v - cc.get(k)) > 1e-9) moved++;
  assert.ok(moved > ca.size * 0.5, `a new seed must re-rank most cells (moved ${moved}/${ca.size})`);

  const sortTops = (x) => x.towers.map((t) => t.top).sort((p, q) => p - q);
  const ta = sortTops(a), tc = sortTops(c);
  for (let k = 0; k < ta.length; k++) {
    assert.ok(Math.abs(ta[k] - tc[k]) < 1e-9, 'the height DISTRIBUTION is seed-invariant by construction');
  }
  assert.equal(c.stats.swingable.clearing, a.stats.swingable.clearing, 'so the guarantee survives every reroll');
});

test('DISTRICTS: the tall stock CLUSTERS — a skyline, not uniform noise', () => {
  const a = createBoxArena(CITY);
  const tall = a.towers.filter((t) => t.top > a.stats.swingable.need);
  const mx = tall.reduce((s, t) => s + t.x, 0) / tall.length;
  const mz = tall.reduce((s, t) => s + t.z, 0) / tall.length;
  const spread = Math.sqrt(tall.reduce((s, t) => s + (t.x - mx) ** 2 + (t.z - mz) ** 2, 0) / tall.length);
  const all = a.towers;
  const amx = all.reduce((s, t) => s + t.x, 0) / all.length, amz = all.reduce((s, t) => s + t.z, 0) / all.length;
  const aspread = Math.sqrt(all.reduce((s, t) => s + (t.x - amx) ** 2 + (t.z - amz) ** 2, 0) / all.length);
  assert.ok(spread < aspread * 0.95,
    `the downtown field must concentrate the tall stock (tall rms ${spread.toFixed(2)} vs all ${aspread.toFixed(2)})`);
});

test('percentileOf is ONE implementation, and topAtPercentile is its caller', () => {
  const solids = new Float32Array([0, 0, 0, 1, 3, 1, 0, 0, 0, 1, 1, 1, 0, 0, 0, 1, 2, 1]);
  assert.equal(topAtPercentile(solids, 0), 1);
  assert.equal(topAtPercentile(solids, 0.5), 2);
  assert.equal(topAtPercentile(solids, 1), 3);
  assert.equal(percentileOf(new Float64Array([3, 1, 2]), 0.5), 2, 'TypedArray.sort is numeric — the JS trap this guards');
});
