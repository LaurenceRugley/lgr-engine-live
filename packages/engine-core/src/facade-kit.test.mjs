/* facade-kit.test.mjs — A-FACADE (2026-08-22). The contract of the MODELLED skyline.
   ------------------------------------------------------------------------------------------------
   WHY THESE ASSERTIONS AND NOT OTHERS (Rule 9 — a test encodes WHY the behaviour matters):

   1. THE DEFAULT PATH IS AN EXACT NO-OP. Every A-SKYLINE/A-DRESS number in the swing ledger, the
      27-check probe's room, and `npm run tier-guard`'s byte-identical baselines are calibrated to
      the arena WITHOUT a facade. If wiring one moved a single float in `solids`, all of them would
      silently become claims about a different level. Pinned box-for-box, including with a kit
      handle present but not yet loaded — which is the state the page is actually in for the first
      few frames, and the one an "it works after the GLB lands" test would never look at.

   2. THE PHYSICS IS NOT ALLOWED TO NOTICE. The arc's first prior decision is that the collider and
      the swingable guarantee stay boxes. So `solids`, `roofAt`, `topAt` and `stats.swingable` are
      asserted IDENTICAL between the arena with a kit and the arena without one. A facade that
      moved the guarantee would be a bug the city could not see until three arcs later.

   3. THE PARTITION IS A PARTITION. Every box is drawn exactly once — main, emissive or a facade
      variant, never two of them, never none. A double-drawn box is invisible on screen (it is the
      same box) and doubles a draw's instance count forever after.

   4. VARIANT CHOICE IS HEIGHT, IN LOG SPACE, AND DETERMINISTIC. It is the one thing about this kit
      that is not like the tree kit, and the reason is geometric: a building is scaled non-uniformly
      by its own height. Log rather than linear because what the eye reads is the RATIO a storey got
      stretched by; a linear nearest-rung hands its whole error to the short stock, which is exactly
      where this room's boxes are densest.

   5. THE FIT REPORT MUST BE ABLE TO SAY NO. `facadeFitReport` exists to make the coverage claim a
      number rather than a hope, so it is tested on a distribution the shipped kit does NOT cover —
      if the report cannot go red it is decoration, and this repo has been burned by exactly that
      (a sentinel Infinity passing a clearance check).
*/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBoxArena } from './box-arena.js';
import { assignFacadeVariants, facadeFitReport, storeyU, FACADE_KIT_COURSES, FACADE_BODY_KINDS } from './createFacadeKit.js';

/* projects/swing-lab's own city, at the size the arc measured. */
const CITY = {
  cols: 19, rows: 19, spacing: 4.6, width: 1.9, plaza: 1, seed: 11, groundY: 0, heightVary: 0, height: 0,
  skyline: { frac: 0.70, ropeMax: 4.10, arcClear: 0.45, skim: 0.06, tall: 2.1, low: 0.22, gamma: 1.0, cores: 3, coreSigma: 0.30, mix: 0.45 },
  silhouette: { parapet: 0.55, penthouse: 0.42, waterTower: 0.26, mast: 0.30, sign: 0.16, emissiveKinds: ['sign'] },
};
const STOREY = storeyU({ metresPerUnit: 6, worldSize: 8, tilesPerTile: 0.55, storeysPerTile: 5 });

/* A stand-in for the loaded kit: box-arena only ever reads `mode`, `parts`, `kinds` and `assign`,
   so a fake with five named parts exercises the real partition without a GLB or a GPU. The parts
   carry no geometry because `layout()` — the only thing under test here — never touches it. */
const fakeKit = (n = 5) => ({
  mode: 'kit',
  kinds: FACADE_BODY_KINDS,
  parts: Array.from({ length: n }, (_, i) => ({ name: `facade_c${FACADE_KIT_COURSES[i]}` })),
  assign: (hs) => assignFacadeVariants(hs, { courses: FACADE_KIT_COURSES.slice(0, n), storey: STOREY }),
});

test('storeyU inverts the triplanar arithmetic the facade material is sized by', () => {
  // tilesPerUnit = (6/8)*0.55 = 0.4125 tiles/u; the recipe puts 5 storeys in a tile.
  assert.ok(Math.abs(STOREY - 1 / (0.4125 * 5)) < 1e-12);
  assert.ok(Math.abs(STOREY - 0.484848) < 1e-5, `expected ~0.48485 u, got ${STOREY}`);
  assert.throws(() => storeyU({ metresPerUnit: 0, worldSize: 8, tilesPerTile: 0.55, storeysPerTile: 5 }));
  assert.throws(() => storeyU({ metresPerUnit: 6, worldSize: 8, tilesPerTile: 0.55, storeysPerTile: 0 }));
});

test('DEFAULT PATH: a facade changes nothing — not with it null, not with a kit still loading', () => {
  const base = createBoxArena(CITY);
  for (const facade of [null, { mode: 'loading', kinds: FACADE_BODY_KINDS, parts: [], assign: () => [] },
    { mode: 'failed', kinds: FACADE_BODY_KINDS, parts: [], assign: () => [] }]) {
    const a = createBoxArena({ ...CITY, facade });
    assert.equal(a.boxes.length, base.boxes.length);
    assert.equal(a.solids.length, base.solids.length);
    for (let i = 0; i < base.solids.length; i++) assert.equal(a.solids[i], base.solids[i], `solid float ${i}`);
    assert.equal(a.facadeReport()?.mode ?? null, facade ? facade.mode : null);
  }
});

test('THE PHYSICS DOES NOT NOTICE: same solids, same roofs, same guarantee, kit vs no kit', () => {
  const box = createBoxArena(CITY);
  const kit = createBoxArena({ ...CITY, facade: fakeKit() });
  assert.equal(kit.solids.length, box.solids.length, 'the packed buffer must be the same length');
  for (let i = 0; i < box.solids.length; i++) assert.equal(kit.solids[i], box.solids[i], `solid float ${i}`);
  for (const p of [0, 0.3, 0.5, 0.7, 1]) {
    assert.equal(kit.roofAt(p), box.roofAt(p), `roofAt(${p})`);
    assert.equal(kit.topAt(p), box.topAt(p), `topAt(${p})`);
  }
  assert.deepEqual(kit.stats.swingable, box.stats.swingable, 'the swingable guarantee is the physics, not the art');
  assert.equal(kit.stats.count, box.stats.count);
  assert.equal(kit.stats.towers, box.stats.towers);
  assert.equal(kit.stats.parts, box.stats.parts);
});

test('THE PARTITION IS A PARTITION: every box drawn exactly once, bodies to the kit', () => {
  const a = createBoxArena({ ...CITY, facade: fakeKit() });
  const rep = a.facadeReport();
  const bodies = a.boxes.filter((b) => FACADE_BODY_KINDS.indexOf(b.kind || 'tower') >= 0);
  const emissive = a.boxes.filter((b) => b.kind === 'sign');
  assert.equal(rep.mode, 'kit');
  assert.equal(rep.drawn, bodies.length, 'every body box goes to a facade mesh');
  assert.equal(rep.drawn + emissive.length + (a.boxes.length - rep.drawn - emissive.length), a.boxes.length);
  assert.equal(rep.perVariant.reduce((s, v) => s + v.count, 0), rep.drawn, 'no body counted twice or lost');
  /* NO VARIANT MAY BE A WASTED DRAW CALL — the criterion the shipped ladder was searched under.
     If a future retune leaves one empty this fails here rather than costing a silent draw call. */
  for (const v of rep.perVariant) assert.ok(v.count > 0, `variant ${v.name} drew nothing — a wasted draw call`);
});

test('EMISSIVE WINS THE TIE — a kind named emissive is never also drawn as a facade', () => {
  /* A consumer that names 'tower' emissive meant the unlit mesh. Drawing it twice is the one thing
     a partition must never do, and it would look completely correct on screen. */
  const a = createBoxArena({ ...CITY, silhouette: { ...CITY.silhouette, emissiveKinds: ['sign', 'tower'] }, facade: fakeKit() });
  const rep = a.facadeReport();
  const towers = a.boxes.filter((b) => (b.kind || 'tower') === 'tower').length;
  const setbacks = a.boxes.filter((b) => b.kind === 'setback').length;
  assert.ok(towers > 0 && setbacks > 0, 'the fixture must actually contain both kinds');
  assert.equal(rep.drawn, setbacks, 'towers went to the unlit mesh, so only setbacks are facades');
});

test('VARIANT CHOICE: nearest rung in LOG space, deterministic, and it is the RATIO that decides', () => {
  const courses = [2, 4], storey = 1;                       // targets 2 and 4
  // 2.83 is the geometric mean (sqrt(8)): just under it must take rung 2, just over it rung 4.
  const which = assignFacadeVariants([2.82, 2.84], { courses, storey });
  assert.equal(which[0], 0);
  assert.equal(which[1], 1);
  // A LINEAR nearest-rung would put the crossover at 3.0, so this pair is exactly what separates
  // the two rules — and log is the right one because a storey stretched 1.41x reads the same
  // whether it started at 2 or at 4.
  assert.equal(assignFacadeVariants([2.95], { courses, storey })[0], 1, 'log-space crossover, not linear');
  // deterministic and pure: same input, same output, and no RNG anywhere in the path
  assert.deepEqual([...assignFacadeVariants([0.7, 3.1, 9.9], { courses, storey })],
    [...assignFacadeVariants([0.7, 3.1, 9.9], { courses, storey })]);
  // out of range clamps to the end rungs rather than throwing — a room taller than the kit still
  // renders, just outside the band, and `facadeFitReport` is what says so
  assert.equal(assignFacadeVariants([0.01], { courses, storey })[0], 0);
  assert.equal(assignFacadeVariants([99], { courses, storey })[0], 1);
});

test('THE FIT REPORT MEASURES THE SHIPPED KIT AGAINST THE SHIPPED ROOM', () => {
  const a = createBoxArena(CITY);
  const hs = a.boxes.filter((b) => FACADE_BODY_KINDS.indexOf(b.kind || 'tower') >= 0).map((b) => b.h);
  const fit = facadeFitReport(hs, { courses: FACADE_KIT_COURSES, storey: STOREY });
  assert.equal(fit.n, 892, 'the room the ladder was derived against');
  assert.equal(fit.perVariant.length, 5);
  /* The numbers the arc reports, pinned so a retune of the kit OR of the city has to restate them
     rather than quietly shipping a smear. Bounds not equalities: the point is the BAND. */
  assert.ok(fit.p50 <= 0.12, `p50 storey error ${fit.p50}`);
  assert.ok(fit.p90 <= 0.20, `p90 storey error ${fit.p90}`);
  assert.ok(fit.max <= 0.32, `max storey error ${fit.max}`);
  assert.ok(fit.over <= Math.ceil(fit.n * 0.02), `${fit.over}/${fit.n} outside the +/-22% band — the stated partial is 1.1%`);
  assert.ok(fit.over > 0, 'the stated partial is that SOME boxes are outside the band; if none are, the report has stopped measuring');
});

test('A DISAGREEING HANDLE FAILS LOUD, not with a TypeError', () => {
  /* `facade` is a PUBLIC seam. A handle whose `assign` was built from a longer course table than
     the GLB actually delivered returns an index past the end of `parts`, and that used to be a raw
     `undefined.push` TypeError at level-build time — a crash instead of a diagnosis (adversarial
     pass, 2026-08-22). createFacadeKit itself cannot produce it (it throws on a variants/courses
     mismatch and loads all-or-nothing), so this pins the SEAM, which is where a future second
     consumer will meet it. Rule 12: fail loud, and name both numbers. */
  const lying = {
    mode: 'kit', kinds: FACADE_BODY_KINDS,
    parts: [{ name: 'facade_c2' }, { name: 'facade_c3' }, { name: 'facade_c4' }],   // 3 loaded…
    assign: (hs) => assignFacadeVariants(hs, { courses: FACADE_KIT_COURSES, storey: STOREY }), // …5 rungs
  };
  assert.throws(() => createBoxArena({ ...CITY, facade: lying }),
    /facade\.assign returned variant index 3 but the kit has 3 parts/);
  // and a handle that returns the wrong COUNT is caught before it can silently drop buildings
  const short = { ...lying, parts: [{ name: 'a' }], assign: () => new Uint8Array(3) };
  assert.throws(() => createBoxArena({ ...CITY, facade: short }),
    /facade\.assign returned 3 indices for 892 body boxes/);
});

test('A KIND THE CITY DOES NOT HAVE draws nothing, and still draws everything else exactly once', () => {
  /* The empty case has to be safe rather than merely unlikely: a consumer wiring the kit into a
     room whose generator names its bodies something else gets cubes, not a hole. */
  const a = createBoxArena({ ...CITY, facade: { ...fakeKit(), kinds: ['nosuchkind'] } });
  const rep = a.facadeReport();
  assert.equal(rep.drawn, 0);
  assert.equal(rep.perVariant.reduce((s, v) => s + v.count, 0), 0);
  const base = createBoxArena(CITY);
  for (let i = 0; i < base.solids.length; i++) assert.equal(a.solids[i], base.solids[i], `solid float ${i}`);
});

test('THE FIT REPORT CAN GO RED — it is a measurement, not decoration', () => {
  /* A room of 40 u towers against a kit whose tallest rung is 8 storeys (3.88 u). If the report
     came back green on that, it would be green on anything. */
  const tall = Array.from({ length: 50 }, (_, i) => 30 + i);
  const fit = facadeFitReport(tall, { courses: FACADE_KIT_COURSES, storey: STOREY });
  assert.equal(fit.over, 50, 'every one of these is far outside the band and the report must say so');
  assert.ok(fit.max > 5, `expected a huge error, got ${fit.max}`);
  assert.equal(fit.perVariant[0], 0, 'nothing should land on the shortest rung');
  assert.equal(fit.perVariant[4], 50, 'everything piles onto the tallest rung — a kit that does not cover the room');
});
