/* ============================================================
   regions.test.mjs — ARC A-PATCHWORK's counted proofs, in node (no GPU, no THREE).
   ------------------------------------------------------------
   The arc's claim is that the world is made of REGIONS and not of speckle, and "region" is a word
   until somebody counts it. Every assertion below counts off the FINISHED field — the same rule
   carve-pads.test.mjs follows and for the same reason: a derivation is a design, a count is a gate.

   The proofs, in the order the brief asked for them:
     a  PARTITION     — every texel belongs to exactly one region; none unassigned, none double-owned.
     b  CONTIGUITY    — each region's largest 4-connected component holds ≥ 99% of its texels,
                        WITH the negative control that makes the number mean something: the same
                        count run over today's per-texel `classify` biome map, where it collapses.
     c  COVERAGE      — ask X%, count X% off the finished field, to the texel.
     d  SEAMS         — the steepest grade the region system adds ANYWHERE ≤ the dial, and the offset
                        is exactly 0 on every boundary texel (the mechanism, not just the outcome).
     e  THE CITY      — the carve's own footprint rect is 100% inside the city region, by seeding.
   plus determinism, the null-mask byte-identity that keeps every existing scatter consumer safe, and
   the additive-biome invariant that keeps every existing WORLD safe.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrain, BIOMES } from './terrain.js';
import { generateRegions, shapeRegionTerrain, regionReport, regionAt, UNASSIGNED } from './regions.js';
import { generateScatter } from './scatter.js';

/* ONE CONFIG FAMILY with projects/world-lab (A-MARRIAGE's own discipline: what the suite counts is
   what the page stands on). A smaller grid than the room ships — the properties are scale-free and a
   node test should not cost 2 s — but every dial, want and program parameter is the room's. */
const SIZE = 220, WORLD = 128, SEED = 12;
const CITY = { cols: 13, rows: 13, spacing: 4.6, streetW: 1.2 };
const CITY_RIM = ((CITY.cols - 1) / 2) * CITY.spacing + (CITY.spacing - CITY.streetW) / 2 + CITY.streetW;   // carve-pads.js's own rimX
const PLAN = [
  { key: 'sea',    want: 0.22, mode: 'rim' },
  { key: 'city',   want: 0.25, mode: 'rect', rect: { x0: -CITY_RIM, z0: -CITY_RIM, x1: CITY_RIM, z1: CITY_RIM } },
  { key: 'woods',  want: 0.26, mode: 'seed', at: { x: -34, z: 30 } },
  { key: 'desert', want: 0.15, mode: 'seed', at: { x: 34, z: -32 } },
  { key: 'lakes',  want: 0.12, mode: 'seed', at: { x: 30, z: 34 } },
];
const SEAM = 8, GRADE_DIAL = 0.25;
const SHAPE = {
  seamBlend: SEAM, seed: SEED,
  desert: { key: 'desert', amp: 0.45, len: 12, angle: 0.6, sharp: 1.6, warp: 0.25 },
  lakes: { key: 'lakes', bowls: 5, depth: 0.55, flatR: 2.1, rimR: 5.5 },
};
const mkTerrain = () => generateTerrain({ seed: SEED, size: SIZE, preset: 'valley' });
const mkRegions = () => generateRegions({ size: SIZE, worldSize: WORLD, seed: SEED, plan: PLAN });

test('a · PARTITION — every texel belongs to exactly ONE region, none left over', () => {
  const R = mkRegions();
  const N = SIZE * SIZE;
  assert.equal(R.stats.total, N);
  assert.equal(R.stats.unassigned, 0, 'no texel may stay UNASSIGNED — the flood must reach the whole grid');
  let sum = 0, bad = 0;
  for (let k = 0; k < N; k++) { const r = R.region[k]; if (r === UNASSIGNED || r >= PLAN.length) bad++; }
  for (const p of R.stats.per) sum += p.texels;
  assert.equal(bad, 0);
  assert.equal(sum, N, 'the per-region counts must sum to the grid — that identity IS "no overlap"');
  assert.equal(R.stats.starved, 0, 'no region may run out of frontier before reaching its target');
});

test('b · CONTIGUITY — each region is ONE blob (≥99% in its largest component), and per-texel classify is not', () => {
  const R = mkRegions();
  for (const p of R.stats.per) {
    assert.ok(p.lccFrac >= 0.99,
      `${p.key}: largest connected component ${p.lcc}/${p.texels} = ${(p.lccFrac * 100).toFixed(2)}% — below the 99% bar`);
  }
  /* THE NEGATIVE CONTROL, and the whole reason the bar above is meaningful. Today's world classifies
     every texel independently, so its "regions" are salt: run the SAME component count over the biome
     map of the SAME terrain and the largest forest component holds a few percent of all forest. If
     this control ever passed, the arc would be solving a problem that does not exist. */
  const T = mkTerrain();
  const ctl = regionReport(T.biome, SIZE, BIOMES.length);
  let worst = 1, worstKey = '';
  for (let b = 0; b < BIOMES.length; b++) {
    if (ctl.counts[b] < 500) continue;                       // only biomes with real area can speak
    const f = ctl.lcc[b] / ctl.counts[b];
    if (f < worst) { worst = f; worstKey = BIOMES[b].key; }
  }
  assert.ok(worst < 0.75,
    `the per-texel control should FRAGMENT (worst biome '${worstKey}' held ${(worst * 100).toFixed(1)}% in one component) — if it does not, the region field is not buying coherence`);
});

test('c · COVERAGE — the dial means what it says: ask X%, count X% off the finished field', () => {
  const R = mkRegions();
  const N = SIZE * SIZE;
  for (const p of R.stats.per) {
    /* EXACT to the texel: growth stops at a COUNT, so `texels` is the target, not an approximation
       of it. The only region allowed to differ from its asked want is one whose seed footprint
       already exceeds it — the city's rect is what it is — and that correction is reported, never
       silent, so the assertion is against the CORRECTED target and the drift is printed. */
    assert.equal(p.texels, p.wantTexels, `${p.key}: grew to ${p.texels} texels, target was ${p.wantTexels}`);
    if (p.key !== 'city') {
      assert.ok(Math.abs(p.frac - p.want) < 0.02,
        `${p.key}: asked ${(p.want * 100).toFixed(1)}% of the world, got ${(p.frac * 100).toFixed(1)}%`);
    }
  }
  assert.equal(R.stats.per.reduce((s, p) => s + p.texels, 0), N);
});

test('d · SEAMS — the region system adds no cliff anywhere, and its offset is exactly 0 at every boundary', () => {
  const T = mkTerrain(), R = mkRegions();
  const S = shapeRegionTerrain(T, { worldSize: WORLD, baseY: 0 }, R, SHAPE);
  assert.ok(S.gradeMax <= GRADE_DIAL,
    `steepest grade the offset field adds = ${S.gradeMax.toFixed(4)} > dial ${GRADE_DIAL} (at ${JSON.stringify(S.gradeAt)})`);
  /* THE MECHANISM, swept exhaustively rather than sampled: on every texel that has a 4-neighbour in a
     DIFFERENT region, the offset must be identically zero — that is what makes both sides of every
     seam agree on the wild ground, and it is why the sweep above is a complete account of the seam
     grade instead of a spot check. (Guard-scope lesson: sweep ACROSS the regime boundary, not near it.) */
  let boundary = 0, nonZero = 0, worst = 0;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const idx = j * SIZE + i, r = R.region[idx];
      const diff = (i > 0 && R.region[idx - 1] !== r) || (i < SIZE - 1 && R.region[idx + 1] !== r)
        || (j > 0 && R.region[idx - SIZE] !== r) || (j < SIZE - 1 && R.region[idx + SIZE] !== r);
      if (!diff) continue;
      boundary++;
      const a = Math.abs(S.offset[idx]);
      if (a > 1e-9) { nonZero++; worst = Math.max(worst, a); }
    }
  }
  assert.ok(boundary > 1000, `expected a real seam network to sweep, found ${boundary} boundary texels`);
  assert.equal(nonZero, 0, `${nonZero} of ${boundary} boundary texels carry a non-zero offset (worst ${worst.toFixed(5)} u)`);
  /* the SEA and the WOODS shape nothing at all — stated in the module, counted here, because "adds
     precisely nothing" is the cheapest guarantee in the arc and the easiest to break by accident. */
  const rSea = R.keys.indexOf('sea'), rWoods = R.keys.indexOf('woods'), rCity = R.keys.indexOf('city');
  let quiet = 0;
  for (let k = 0; k < SIZE * SIZE; k++) {
    const r = R.region[k];
    if ((r === rSea || r === rWoods || r === rCity) && S.offset[k] !== 0) quiet++;
  }
  assert.equal(quiet, 0, 'sea / woods / city districts must carry an offset of exactly 0');
});

test('e · THE CITY DISTRICT owns the carve\'s whole footprint, by seeding not by luck', () => {
  const R = mkRegions();
  const cell = WORLD / (SIZE - 1), half = WORLD / 2;
  let inside = 0, wrong = 0;
  for (let j = 0; j < SIZE; j++) {
    for (let i = 0; i < SIZE; i++) {
      const x = i * cell - half, z = j * cell - half;
      if (Math.abs(x) > CITY_RIM || Math.abs(z) > CITY_RIM) continue;
      inside++;
      if (regionAt(R, x, z) !== 'city') wrong++;
    }
  }
  assert.ok(inside > 1000, 'the city rect should cover real ground');
  assert.equal(wrong, 0, `${wrong}/${inside} texels inside the carve rim rect are NOT in the city district`);
});

/* THE ONE PROOF THAT IS NOT SCALE-FREE, and it earned its own grid. Everything above holds at any
   resolution — a partition is a partition. The BASIN COUNT does not: bowl siting samples a rim circle
   and requires a whole rim's worth of ground above the water line, so a coarser grid finds fewer
   qualifying centres (measured: 2 basins at the room's 380, 1 at this file's fast 220). Rather than
   quietly lower the bar to what the fast grid happens to give, this proof runs at the grid the room
   SHIPS — because "the lake district digs discrete basins" is a claim about the shipped world. */
const SHIP_SIZE = 380;
test('f · LAKES — discrete bowls at the SHIPPED grid, each with a floor kept above sea level', () => {
  const T = generateTerrain({ seed: SEED, size: SHIP_SIZE, preset: 'valley' });
  const R = generateRegions({ size: SHIP_SIZE, worldSize: WORLD, seed: SEED, plan: PLAN });
  const S = shapeRegionTerrain(T, { worldSize: WORLD, baseY: 0 }, R, SHAPE);
  assert.ok(S.bowls.length >= 2, `expected a lake DISTRICT of ≥2 basins at grid ${SHIP_SIZE}, dug ${S.bowls.length}`);
  /* one giant pit is exactly what detectLakes cannot use (it floods 0.045 above a local minimum and
     rejects a pool past MAXPOOL), so the bowls must be genuinely separate: centres at least a rim
     apart. */
  for (let a = 0; a < S.bowls.length; a++) {
    for (let b = a + 1; b < S.bowls.length; b++) {
      const d = Math.hypot(S.bowls[a].x - S.bowls[b].x, S.bowls[a].z - S.bowls[b].z);
      assert.ok(d >= S.bowls[a].rimR, `bowls ${a}/${b} are ${d.toFixed(2)} u apart — closer than one rim (${S.bowls[a].rimR})`);
    }
  }
  /* THE CLAMP'S ACTUAL PROMISE, scoped exactly: no texel the BOWLS DUG may end below sea level. It is
     deliberately not "no lakes-district texel is below sea" — a district that reaches the coast can
     legitimately contain ground the wild radial falloff already put under water, and asserting
     otherwise tests the terrain, not the clamp (the first cut of this test did, and read 1047). */
  let dug = 0, below = 0;
  for (let k = 0; k < SHIP_SIZE * SHIP_SIZE; k++) {
    if (S.offset[k] >= 0) continue;
    dug++;
    if (T.height[k] < T.sea) below++;
  }
  assert.ok(dug > 500, `expected real excavation, ${dug} texels dug`);
  assert.equal(below, 0, `${below} of ${dug} DUG texels ended below sea level — detectLakes calls those "drains to the ocean", not lakes`);
});

test('g · DETERMINISM — one seed, one world (field and shaping both)', () => {
  const a = mkRegions(), b = mkRegions();
  assert.deepEqual([...a.region], [...b.region]);
  const ta = mkTerrain(), tb = mkTerrain();
  const sa = shapeRegionTerrain(ta, { worldSize: WORLD, baseY: 0 }, a, SHAPE);
  const sb = shapeRegionTerrain(tb, { worldSize: WORLD, baseY: 0 }, b, SHAPE);
  assert.deepEqual([...ta.height], [...tb.height]);
  assert.equal(sa.gradeMax, sb.gradeMax);
  assert.equal(sa.painted, sb.painted);
  const c = generateRegions({ size: SIZE, worldSize: WORLD, seed: SEED + 1, plan: PLAN });
  assert.notDeepEqual([...a.region], [...c.region], 'a different seed must be a different world');
});

test('h · the DESERT biome is ADDITIVE — classify can never return it, so no existing world moves', () => {
  assert.equal(BIOMES[7].key, 'pavement', 'index 7 is A-MARRIAGE\'s — appending must never renumber');
  assert.equal(BIOMES[8].key, 'desert');
  /* classify is not exported; the invariant it has to satisfy is observable from the OUTSIDE: a
     freshly generated world of any preset contains no texel of biome 8 until a region paints one. */
  for (const preset of ['valley', 'mountains', 'plains', 'archipelago']) {
    const T = generateTerrain({ seed: 5, size: 96, preset });
    let sand = 0;
    for (let k = 0; k < T.biome.length; k++) if (T.biome[k] >= 7) sand++;
    assert.equal(sand, 0, `preset '${preset}' produced ${sand} texels of an additive biome — classify must never return 7 or 8`);
  }
  const T = mkTerrain(), R = mkRegions();
  const S = shapeRegionTerrain(T, { worldSize: WORLD, baseY: 0 }, R, SHAPE);
  assert.ok(S.painted > 500, `the desert district should paint real sand, painted ${S.painted}`);
  const rDesert = R.keys.indexOf('desert');
  let strays = 0;
  for (let k = 0; k < SIZE * SIZE; k++) if (T.biome[k] === 8 && R.region[k] !== rDesert) strays++;
  assert.equal(strays, 0, `${strays} sand texels landed OUTSIDE the desert district`);
});

test('i · the scatter DENSITY MASK is a null-default opt-in — the unmasked path is byte-identical', () => {
  const T = mkTerrain();
  const keys = BIOMES.map((b) => b.key);
  const base = generateScatter({ terrain: T, seed: 3, worldSize: WORLD, baseY: 0, biomeKeys: keys, density: 0.55, max: 4000 });
  const nulled = generateScatter({ terrain: T, seed: 3, worldSize: WORLD, baseY: 0, biomeKeys: keys, density: 0.55, max: 4000, mask: null });
  assert.deepEqual(base.counts, nulled.counts);
  assert.deepEqual(base.placements.tree, nulled.placements.tree, 'passing mask:null must not move a single prop — that is what protects moto-lab');
  /* a mask of a constant 1 is ALSO identical: the multiplier is applied to the density, and the RNG
     is consumed one roll per rule either way, so the stream cannot shift. */
  const ones = generateScatter({ terrain: T, seed: 3, worldSize: WORLD, baseY: 0, biomeKeys: keys, density: 0.55, max: 4000, mask: () => 1 });
  assert.deepEqual(base.placements.rock, ones.placements.rock);
  const zeroed = generateScatter({ terrain: T, seed: 3, worldSize: WORLD, baseY: 0, biomeKeys: keys, density: 0.55, max: 4000, mask: () => 0 });
  assert.equal(zeroed.counts.tree + zeroed.counts.rock + zeroed.counts.tuft, 0, 'a mask of 0 must plant nothing');
});
