/* graph-sim.test.mjs — headless (node --test, no GPU/DOM). The force sim is a PURE module and that
   decoupling is the point: physics is exactly the kind of code that "looks right" in a screenshot while
   being wrong. Each test encodes the WHY (Rule 9), and each maps to a §9 requirement or pitfall.
   Run: `node --test packages/engine-core/src/graph-sim.test.mjs` (wired into the root `npm test` glob). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGraphSim, SIM_DEFAULTS } from './graph-sim.js';
import { createGraphLayout } from './graph-layout.js';

/* A small graph with the shape that matters: one hub, a ring of leaves, and two mid-degree nodes wired to
   each other. That is the configuration hub-softening exists for. */
const SPEC = {
  v: 1,
  nodes: [
    { id: 'hub', kind: 'hub' },
    { id: 'm1', kind: 'live-ops' }, { id: 'm2', kind: 'live-ops' },
    { id: 'l1', kind: 'doctrine' }, { id: 'l2', kind: 'doctrine' },
    { id: 'l3', kind: 'doctrine' }, { id: 'l4', kind: 'doctrine' },
  ],
  edges: [
    { from: 'hub', to: 'm1' }, { from: 'hub', to: 'm2' },
    { from: 'hub', to: 'l1' }, { from: 'hub', to: 'l2' },
    { from: 'm1', to: 'm2' },                                  // hub-to-hub-ish: two mid-degree nodes
    { from: 'm1', to: 'l3' }, { from: 'm2', to: 'l4' },        // leaves hanging off the mids
    { from: 'hub', to: 'ghost' },                              // DANGLING — must be skipped, not crash
  ],
};

const seed = () => createGraphLayout(SPEC, { rings: { 'live-ops': 2, doctrine: 4 }, fallbackRadius: 6 });
const snapshot = (positions) => [...positions.entries()].map(([id, p]) => [id, +p.x.toFixed(9), +p.z.toFixed(9)]);

test('the sim is DETERMINISTIC: same spec + same seed → identical rest positions', () => {
  // WHY: the atlas must not reshuffle on reload. A "random" layout that settles somewhere new each refresh
  // destroys spatial memory — the user's ability to know where a note lives. No Math.random, ever.
  const a = createGraphSim(SPEC, seed());
  const b = createGraphSim(SPEC, seed());
  const pa = seed(), pb = seed();
  const simA = createGraphSim(SPEC, pa);
  const simB = createGraphSim(SPEC, pb);
  simA.settleNow(); simB.settleNow();
  assert.deepEqual(snapshot(pa), snapshot(pb));
  assert.ok(simA.ticks > 0 && simA.ticks === simB.ticks, 'identical tick counts too');
  a.dispose(); b.dispose();
});

test('a dangling edge is skipped, not crashed on (the [[L08]] class, same as the renderer)', () => {
  const p = seed();
  const sim = createGraphSim(SPEC, p);
  assert.equal(sim.nodeCount, 7);
  assert.equal(sim.linkCount, 7, 'the 8th edge points at "ghost", which has no position');
  sim.settleNow();
  for (const [, q] of p) assert.ok(Number.isFinite(q.x) && Number.isFinite(q.z));
});

test('PITFALL 3 — it HARD-STOPS: alpha snaps to 0, velocities to 0, and rest frames are bit-identical', () => {
  // WHY: "settled" cannot mean "moving imperceptibly". A graph that keeps integrating forever jitters in the
  // last significant bit, re-uploads every buffer every frame, and never lets the renderer skip work. Rest
  // must be EXACT, so that "a settled graph costs zero CPU" is a fact rather than a hope.
  const p = seed();
  const sim = createGraphSim(SPEC, p);
  const steps = sim.settleNow();
  assert.ok(steps < 4000, `should converge, took ${steps}`);
  assert.equal(sim.settled, true);
  assert.equal(sim.alpha, 0, 'alpha is snapped to exactly 0, not left at 0.0009');
  assert.equal(sim.kineticEnergy(), 0, 'every velocity is exactly 0');

  const before = snapshot(p);
  const ticksBefore = sim.ticks;
  assert.equal(sim.tick(5), false, 'ticking a settled sim reports no movement');
  assert.equal(sim.ticks, ticksBefore, 'and does not even run a step — zero CPU at rest');
  assert.deepEqual(snapshot(p), before, 'positions are bit-identical across rest frames');
});

test('energy decreases: the sim cools rather than pumping itself', () => {
  // WHY: semi-implicit Euler with a per-tick damping multiplier is only stable while the damping wins. If a
  // force were ever scaled by real dt (PITFALL 1) this monotonic decay is the first thing to break.
  const sim = createGraphSim(SPEC, seed());
  sim.tick(5);
  const early = sim.kineticEnergy();
  sim.tick(40);
  const late = sim.kineticEnergy();
  assert.ok(late < early, `kinetic energy must fall: ${early} → ${late}`);
  assert.ok(sim.alpha < SIM_DEFAULTS.alphaInit, 'alpha cools toward alphaTarget');
});

test('hub-softening: a LEAF\'s link is stronger than a link between two higher-degree nodes', () => {
  // WHY d3's `1 / min(degA, degB)` and not `1 / max` or a constant: a leaf has exactly one thing holding it,
  // so that bond must be strong or the leaf drifts away. Two well-connected nodes are each anchored by many
  // links, so their shared spring must be weak or they crush everything between them. Assert the ORDERING —
  // it is the property that matters; the exact coefficients are an implementation detail.
  const sim = createGraphSim(SPEC, seed());
  const leafLink = sim.linkStrengthOf('hub', 'l1');   // deg(l1) = 1  → 1/1 = 1
  const midLink  = sim.linkStrengthOf('m1', 'm2');    // deg(m1) = deg(m2) = 3 → 1/3
  assert.equal(leafLink, 1);
  assert.ok(midLink < leafLink, `leaf link ${leafLink} must outrank mid-mid link ${midLink}`);
  assert.equal(sim.linkStrengthOf('hub', 'nope'), 0, 'unknown pair → 0, never NaN into a force');
});

test('PITFALL 2 — a pinned node is REMOVED from integration: it holds position exactly, and never fights', () => {
  // WHY full fx/fz pinning rather than spring-pulling toward the cursor: a spring lags the pointer and then
  // overshoots it, which is the "fighting the cursor" feel everyone recognises and nobody wants. The dragged
  // node must be exactly where the finger is — while still shoving its neighbours around.
  const p = seed();
  const sim = createGraphSim(SPEC, p);
  sim.reheat(0.3);
  sim.pin('l1', 5.5, -2.25);
  sim.tick(60);
  const q = p.get('l1');
  assert.equal(q.x, 5.5, 'the pinned node is exactly where it was put, after 60 ticks of force');
  assert.equal(q.z, -2.25);
  assert.equal(sim.pinnedCount, 1);
  assert.equal(sim.settled, false, 'a sim with a pinned node is never "settled" — the user is still holding it');
});

test('a pinned node still SOURCES force: dragging one node tugs the web', () => {
  // WHY: this is the entire "living graph" premise. If a pinned node were removed from the force loops as
  // well as from integration, dragging it would slide a disconnected dot across a frozen picture.
  const p = seed();
  const sim = createGraphSim(SPEC, p);
  const hubBefore = { ...p.get('hub') };
  sim.reheat(0.3);
  sim.pin('l1', 9, 9);            // yank a leaf far away
  sim.tick(90);
  const hubAfter = p.get('hub');
  const moved = Math.hypot(hubAfter.x - hubBefore.x, hubAfter.z - hubBefore.z);
  assert.ok(moved > 1e-3, `the hub must feel the pull through the link (moved ${moved})`);
});

test('release rejoins the sim and settles again (the drift-then-rest of §9\'s interaction contract)', () => {
  const p = seed();
  const sim = createGraphSim(SPEC, p);
  sim.reheat(0.3);
  sim.pin('l1', 9, 9);
  sim.tick(60);
  assert.equal(sim.settled, false);

  sim.unpin('l1');
  sim.reheat(0);                 // alphaTarget → 0: cool down
  assert.equal(sim.pinnedCount, 0);
  const steps = sim.settleNow();
  assert.ok(steps > 0, 'it keeps evolving for a beat after release — that drift IS the feel');
  assert.equal(sim.settled, true);
  assert.equal(sim.kineticEnergy(), 0);
});

test('the seed survives: rest lengths come from the seeded spacing, so kind-rings stay as basins', () => {
  // WHY: §9's stability requirement. If rest lengths were a single global constant, the sim would forget the
  // radial layout entirely and every kind-ring would dissolve into one undifferentiated blob. Seeded rest
  // lengths make the authored structure a basin of attraction the relaxation stays inside.
  const p = seed();
  const sim = createGraphSim(SPEC, p);
  const hubToInner = Math.hypot(p.get('m1').x, p.get('m1').z);   // seeded at ring radius 2
  const hubToOuter = Math.hypot(p.get('l1').x, p.get('l1').z);   // seeded at ring radius 4
  sim.settleNow();
  const innerAfter = Math.hypot(p.get('m1').x - p.get('hub').x, p.get('m1').z - p.get('hub').z);
  const outerAfter = Math.hypot(p.get('l1').x - p.get('hub').x, p.get('l1').z - p.get('hub').z);
  assert.ok(hubToInner < hubToOuter, 'sanity: the seed really is concentric');
  assert.ok(innerAfter < outerAfter, 'and the inner ring is STILL inside the outer one after relaxation');
});

test('setParams retunes live without recomputing rest lengths (the ?sim= feel loop)', () => {
  const p = seed();
  const sim = createGraphSim(SPEC, p);
  const rest = Array.from(sim.restLengths);
  sim.setParams({ velocityDecay: 0.5, repulsion: -2 });
  assert.equal(sim.params.velocityDecay, 0.5);
  assert.deepEqual(Array.from(sim.restLengths), rest, 'rest lengths belong to the SEED, not to the tuning');
});

/* ============================================================
   SLICE 18 — COLLISION (PERSONAL SPACE). These tests encode the slice's contract, not just behavior:
   the whole point of collision is a GEOMETRIC GUARANTEE at rest ("no two discs intersect"), it must not
   cost determinism (same spec → same rest positions), and it must not break the §9 interaction model
   (a pinned drag PLOWS THROUGH; the hard-stop still produces bit-identical rest frames).
   ============================================================ */
const COLLIDE_SPEC = {
  v: 1,
  nodes: [
    { id: 'hub', kind: 'hub' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `n${i}`, kind: 'doctrine' })),
  ],
  edges: Array.from({ length: 12 }, (_, i) => ({ from: `n${i}`, to: 'hub' })),
};
// A deliberately CROWDED seed: a ring far too small for the radii, so collision has real work to do.
function crowdedPositions() {
  const m = new Map([['hub', { x: 0, y: 0, z: 0 }]]);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    m.set(`n${i}`, { x: Math.cos(a) * 1.2, y: 0, z: Math.sin(a) * 1.2 });
  }
  return m;
}
const RADII = (id) => (id === 'hub' ? 0.9 : 0.55);   // sum 1.45 vs seed gaps ~0.62 — heavy overlap

test('collision: NO intersecting pair at rest (the geometric guarantee)', () => {
  const sim = createGraphSim(COLLIDE_SPEC, crowdedPositions(), { radii: RADII });
  sim.settleNow();
  assert.equal(sim.settled, true);
  assert.ok(sim.maxOverlap() <= 1e-9, `worst overlap ${sim.maxOverlap()} — discs still intersect at rest`);
});

test('collision: determinism holds (same spec + radii → identical rest positions)', () => {
  const p1 = crowdedPositions(), p2 = crowdedPositions();
  const a = createGraphSim(COLLIDE_SPEC, p1, { radii: RADII });
  const b = createGraphSim(COLLIDE_SPEC, p2, { radii: RADII });
  a.settleNow(); b.settleNow();
  for (const id of p1.keys()) {
    assert.equal(p1.get(id).x, p2.get(id).x, `${id}.x diverged`);
    assert.equal(p1.get(id).z, p2.get(id).z, `${id}.z diverged`);
  }
});

test('collision: a pinned drag PLOWS THROUGH — the pinned node never yields, others do', () => {
  const pos = crowdedPositions();
  const sim = createGraphSim(COLLIDE_SPEC, pos, { radii: RADII });
  sim.settleNow();
  // Pin n0 and drive it straight at n6's rest spot: n0 must sit EXACTLY where pinned, n6 must yield.
  const target = { x: pos.get('n6').x, z: pos.get('n6').z };
  sim.pin('n0', target.x, target.z);
  sim.reheat(0.3);
  for (let s = 0; s < 400; s++) sim.tick();
  assert.equal(pos.get('n0').x, target.x, 'pinned node was pushed off the pointer');
  assert.equal(pos.get('n0').z, target.z);
  const d = Math.hypot(pos.get('n6').x - target.x, pos.get('n6').z - target.z);
  assert.ok(d >= RADII('n0') + RADII('n6') - 0.05, `n6 did not yield (d=${d.toFixed(2)})`);
});

test('collision: hard-stop still bit-identical at rest (quiescent, no micro-jitter)', () => {
  const pos = crowdedPositions();
  const sim = createGraphSim(COLLIDE_SPEC, pos, { radii: RADII });
  sim.settleNow();
  const snap = new Map([...pos].map(([id, p]) => [id, { x: p.x, z: p.z }]));
  for (let s = 0; s < 50; s++) sim.tick();   // 50 more frames at rest
  for (const [id, p] of pos) {
    assert.equal(p.x, snap.get(id).x, `${id}.x moved at rest`);
    assert.equal(p.z, snap.get(id).z, `${id}.z moved at rest`);
  }
  assert.equal(sim.ticks >= 0 && sim.settled, true);
});

test('collision: release after a plow re-settles CLEAN (overlap drained again)', () => {
  const pos = crowdedPositions();
  const sim = createGraphSim(COLLIDE_SPEC, pos, { radii: RADII });
  sim.settleNow();
  sim.pin('n0', pos.get('n6').x, pos.get('n6').z);
  sim.reheat(0.3);
  for (let s = 0; s < 120; s++) sim.tick();
  sim.unpin('n0');
  sim.reheat(0);
  sim.settleNow();
  assert.equal(sim.settled, true);
  assert.ok(sim.maxOverlap() <= 1e-9, `post-drag rest overlap ${sim.maxOverlap()}`);
});

test('no radii → no collision (pre-18 consumers byte-unchanged)', () => {
  const pos = crowdedPositions();
  const sim = createGraphSim(COLLIDE_SPEC, pos, {});
  sim.settleNow();
  assert.equal(sim.maxOverlap(), 0);           // the seam reports 0 when collision is off
  assert.equal(sim.collideRadiusOf('hub'), 0);
});

/* SLICE 19 — RESET. The contract: a scattered (or dragged, or pinned) graph returns to the DETERMINISTIC
   seed and re-settles through the same schedule — collision included — instead of exploding past it. */
test('reset: re-seeds to the EXACT starting positions and re-runs the schedule', () => {
  const pos = crowdedPositions();
  const seed = crowdedPositions();   // the layout's output — the caller's source of truth
  const sim = createGraphSim(COLLIDE_SPEC, pos, { radii: RADII });
  sim.settleNow();
  // scatter: drag one node far away and leave it pinned, then reset mid-pin
  sim.pin('n3', 9, -9);
  sim.reheat(0.3);
  for (let s = 0; s < 60; s++) sim.tick();
  assert.ok(Math.hypot(pos.get('n3').x - seed.get('n3').x, pos.get('n3').z - seed.get('n3').z) > 5);

  sim.reseed(seed);
  assert.equal(sim.pinnedCount, 0, 'reset must release a pin — otherwise a node is stranded at the pointer');
  for (const [id, p] of pos) {
    assert.equal(p.x, seed.get(id).x, `${id} did not return to the seed`);
    assert.equal(p.z, seed.get(id).z);
  }
  assert.equal(sim.settled, false, 'reset must re-heat: the graph re-settles, it does not freeze on the seed');
});

test('reset: re-settles CLEAN (collision composes with the reset — no explosion, no overlap)', () => {
  const pos = crowdedPositions();
  const sim = createGraphSim(COLLIDE_SPEC, pos, { radii: RADII });
  sim.settleNow();
  sim.reseed(crowdedPositions());
  const steps = sim.settleNow();
  assert.equal(sim.settled, true);
  assert.ok(sim.maxOverlap() <= 1e-9, `post-reset overlap ${sim.maxOverlap()}`);
  assert.ok(steps < 2000, `reset took ${steps} steps to settle — the schedule should be the boot schedule`);
  let maxR = 0;
  for (const [, p] of pos) maxR = Math.max(maxR, Math.hypot(p.x, p.z));
  assert.ok(maxR < 12, `reset EXPLODED the layout (maxR ${maxR.toFixed(1)})`);
});

test('reset: determinism — boot-settle and reset-settle land on the SAME rest state', () => {
  const a = crowdedPositions(), b = crowdedPositions();
  const simA = createGraphSim(COLLIDE_SPEC, a, { radii: RADII });
  simA.settleNow();
  const simB = createGraphSim(COLLIDE_SPEC, b, { radii: RADII });
  simB.settleNow();
  simB.reseed(crowdedPositions());
  simB.settleNow();
  for (const id of a.keys()) {
    assert.equal(b.get(id).x, a.get(id).x, `${id}.x: a reset graph must be the boot graph`);
    assert.equal(b.get(id).z, a.get(id).z);
  }
});
