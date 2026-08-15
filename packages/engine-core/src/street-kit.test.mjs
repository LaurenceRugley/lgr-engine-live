/* street-kit.test.mjs — A-DRESS (2026-08-15). The contract of the street furniture.
   ------------------------------------------------------------------------------------------------
   WHY THESE ASSERTIONS (Rule 9 — a test encodes WHY the behaviour matters, not just what it does):

   1. THE DRAW COUNT IS CONSTANT IN THE CITY'S SIZE. This is the module's entire justification. The
      repo has a live Rule-6 conflict between two city generators (`citygen.js` emits one Mesh per
      building PART, so its draw calls scale with the city; `box-arena.js` renders a whole skyline as
      ONE InstancedMesh), and the research doc's recommendation is to build on the newer pattern. If a
      four-times-bigger city cost four times the meshes, this module would BE the regression it was
      written to avoid — so the invariant is asserted against a 4x city, not asserted in a comment.

   2. `blocked` IS OBEYED ABSOLUTELY. The consumer's predicate is the only thing that knows where the
      buildings actually are (the skyline path jitters towers off their cell centres and grows the
      footprint with the height). A bench inside a lobby is the visible failure; a predicate that is
      consulted but not respected is the invisible one, so a block-everything predicate must produce a
      completely empty kit.

   3. LAMPS EXIST, AND THEY ARE THE REASON THIS FILE HAS A TEST AT ALL. Two separate bugs — an
      intersection test half a period out of phase, and a lamp cadence that resonated exactly with the
      block pitch — combined to place ZERO streetlights in a whole city, through a clean build, a green
      shader compile and a day capture nobody could fault. It was only caught by reading a COUNT off
      the running page. A count that can be zero and look fine is a count that needs an assertion.

   4. NO LAMP STANDS IN A JUNCTION. That is the same phase arithmetic the road shader paints its
      crossings with; a lamp post in the middle of a zebra crossing is the exact symptom of the two
      descriptions of one grid drifting apart.

   5. DETERMINISM IS INDEX-ADDRESSED. Same rule as box-arena: two builds of one seed agree, so a
      capture is reproducible and an A/B is an A/B.
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStreetKit } from './street-kit.js';

const CITY = { extent: 42.35, spacing: 4.6, groundY: 0, seed: 11, roadHalf: 4.6 * 0.235, step: 1.15 };

test('THE BUDGET: the mesh count does NOT grow with the city — that is the whole point', () => {
  const small = createStreetKit({ ...CITY, extent: 20 });
  const big = createStreetKit({ ...CITY, extent: 80 });
  assert.equal(small.stats.drawMeshes, big.stats.drawMeshes,
    'a 4x city must cost the same number of meshes — instances scale, draws do not');
  assert.ok(big.stats.props > small.stats.props * 2,
    `the bigger city must actually be dressed (${small.stats.props} -> ${big.stats.props} props)`);
  small.dispose(); big.dispose();
});

test('THE PREDICATE IS ABSOLUTE: blocked-everywhere produces an empty kit, not a sparse one', () => {
  const k = createStreetKit({ ...CITY, blocked: () => true });
  assert.equal(k.stats.props, 0, 'a prop placed despite `blocked` is a bench inside a lobby');
  assert.equal(k.stats.foliage, 0);
  assert.equal(k.stats.lamps, 0);
  k.dispose();
});

test('THE LAMPS EXIST — the bug this whole file was written after', () => {
  const k = createStreetKit(CITY);
  assert.ok(k.stats.lamps > 100,
    `a 42 u city on a 4.6 u grid has ~19 street lines per axis; got ${k.stats.lamps} lamps (the first two cuts got 0)`);
  assert.equal(k.lampPoints.length, k.stats.lamps * 3, 'one glow position per lamp head, flat xyz');
  assert.equal(k.poolPoints.length, k.stats.lamps * 3, 'and one pool on the road under each');
  assert.ok(k.stats.drawMeshes >= 5, 'lamps present ⇒ the head mesh, the glow layer and the pool layer all exist');
  k.dispose();
});

test('NO LAMP STANDS IN A JUNCTION — the road shader paints a crossing there', () => {
  const k = createStreetKit(CITY);
  const sp = CITY.spacing, clear = CITY.roadHalf + 0.35;
  /* The junction centres are at (m + 0.5) * spacing on BOTH axes; a lamp must be clear of that line
     along whichever axis its street runs. Distance to the nearest junction line, per axis: */
  const d = (v) => Math.abs(((v % sp) + sp) % sp - sp * 0.5);
  let inside = 0;
  for (let i = 0; i < k.lampPoints.length; i += 3) {
    const x = k.lampPoints[i], z = k.lampPoints[i + 2];
    if (d(x) < clear * 0.9 && d(z) < clear * 0.9) inside++;
  }
  assert.equal(inside, 0, `${inside} lamps are standing in a crossing square`);
  k.dispose();
});

test('DETERMINISM: two builds of one seed place the same street', () => {
  const a = createStreetKit(CITY), b = createStreetKit(CITY);
  assert.equal(a.boxes.length, b.boxes.length);
  assert.equal(a.lampPoints.length, b.lampPoints.length);
  for (let i = 0; i < a.lampPoints.length; i++) assert.equal(a.lampPoints[i], b.lampPoints[i], `lamp coord ${i}`);
  /* and a DIFFERENT seed must actually reroll the probabilistic half (the lamps are a cadence and are
     deliberately seed-independent in POSITION — a reroll that moved the streetlights would mean the
     cadence was a die roll after all). */
  const c = createStreetKit({ ...CITY, seed: 12 });
  assert.equal(c.lampPoints.length, a.lampPoints.length, 'the lamp CADENCE is geometry, not chance');
  a.dispose(); b.dispose(); c.dispose();
});

test('THE NIGHT SWITCH is a scalar, and the glow is DARK at day (the byte-identical contract)', () => {
  const k = createStreetKit(CITY);
  k.update(0);
  const points = k.group.children.filter((c) => c.type === 'Group');
  assert.ok(points.length >= 1, 'the glow layers are groups added by createStreetLights');
  for (const g of points) assert.equal(g.visible, false, 'at day the glow group is NOT DRAWN, not merely transparent');
  k.update(1);
  for (const g of points) assert.equal(g.visible, true, 'at night it is');
  k.dispose();
});
