/* ============================================================
   createAgentSim.test.mjs — the IN-POOL outbreak path (the half hoard2 does not exercise).
   ------------------------------------------------------------
   The hoard2 adapter path (external zpool, onTurn handoff) is pinned where it lives:
   projects/hoard2/src/sim/civilians.test.mjs runs the full determinism trace THROUGH the adapter, and
   the A-CITIZENS lift was proven byte-identical against the 84c0667 original across 3 seeds (timeline +
   per-second position trace). These tests encode the INTENT of what the lift ADDED (Rule 9):
     • the in-pool cycle — bite → incubation → the record flips to 'i' WHERE IT FELL (no external pool),
       and the risen infectious then HUNTS: the outbreak is self-sustaining inside one pool;
     • chase targeting is the phase-3 seam — nearest(state) — and consumes NO rng (a growing horde must
       never re-order the stream, or city determinism dies the moment the first civilian turns);
     • determinism of the whole in-pool outbreak (same seed ⇒ identical timeline + positions);
     • clampBlocked — a body can never end a step inside the field's blocked mask (the failure mode is
       an agent shoved into a tower footprint reading cost −1 = "safe" and idling inside the wall).
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentSim, createAgentRng } from './createAgentSim.js';
import { createFlowField } from './createFlowField.js';

const DT = 1 / 60;

// City-shaped params at a 6 m/u scale (swing-lab's world) — the SECOND consumer with DIFFERENT numbers
// is itself part of the test: the sim must be scale-free.
const P = {
  count: 24, walkSpeed: 0.12, fleeSpeed: 0.3, staggerSpeed: 0.08,
  populateRadius: 8, panicCells: 9, calmCells: 13,
  /* biteRadius MUST clear the separation shell (sepRadius 0.12 below) — measured here: at bite 0.10 the
     chase closed to 0.12 and ORBITED there forever (the mutual push balances a slow chase exactly at
     the shell; preyD held 0.12 for 25 s straight). A bite is an arm's reach PAST personal space. */
  biteRadius: 0.13, pTransmitPerSec: 2.0, contactCells: 4,
  incubationS: [1.5, 3], wanderIdleS: [1, 3], wanderRadius: 1.5,
  playRadius: 10, arriveR: 0.1, lookAhead: 0.2,
  /* chase.speed MUST clear fleeSpeed or the outbreak stalls — measured here first (0.24 vs flee 0.3:
     the risen infectious never landed a second bite in 40 s; the gap GREW 0.06 u/s). hoard2's phase-1
     ratio is runner 2.65 / flee 1.8 = 1.47; 0.45/0.3 = 1.5 keeps that class. */
  chase: { speed: 0.45, directR: 1.2 },
};

function mkWorld(seed = 7, over = {}) {
  const srng = createAgentRng(seed);
  const sim = createAgentSim({ ...P, ...over }, srng, { cap: over.cap ?? P.count, sepRadius: 0.12, clampBlocked: true });
  const mkField = () => createFlowField({ center: { x: 0, z: 0 }, radius: 10, cellSize: 0.25, agentRadius: 0.05, maxAgents: 64 });
  const flee = mkField(), hunt = mkField();
  sim.populate(flee);
  return { sim, flee, hunt, srng };
}

// The city wiring's reseed rule in miniature: flee multi-source from the I set, hunt from the S set.
const _f = [], _h = [];
function reseed(sim, flee, hunt) {
  _f.length = 0; _h.length = 0;
  sim.forEach((_i, c) => {
    if (!c.alive) return;
    if (c.state === 'i') _f.push({ x: c.x, z: c.z });
    else if (c.state === 's') _h.push({ x: c.x, z: c.z });
  });
  flee.solve(_f); hunt.solve(_h);
}

test('IN-POOL cycle: patient zero → E telegraph → flips to i WHERE IT FELL → hunts and bites AGAIN', () => {
  const { sim, flee, hunt } = mkWorld(11);
  const log = [];
  const s = {
    field: flee, zpool: null, huntField: hunt, aabbs: null,
    onBite: (c) => log.push(['bite', c.id]),
    onTurned: (c) => log.push(['turn', c.id, c.x, c.z]),
  };
  sim.forceExpose(1, 0, 0);
  reseed(sim, flee, hunt);
  sim.step(DT, s);
  assert.equal(sim.eCount, 1, 'the forced patient zero is EXPOSED through the real bite path');
  assert.equal(log[0][0], 'bite');
  const victim = log[0][1];
  // Snapshot where the victim staggers as the window closes, then ride to the flip.
  let vx = 0, vz = 0, guard = 0;
  while (sim.iCount === 0 && guard++ < 60 * 10) {
    const v = sim.get(victim); vx = v.x; vz = v.z;
    reseed(sim, flee, hunt);
    sim.step(DT, s);
  }
  assert.equal(sim.iCount, 1, 'the victim TURNED in-pool (no external pool anywhere)');
  const turn = log.find((r) => r[0] === 'turn');
  assert.ok(turn && Math.hypot(turn[2] - vx, turn[3] - vz) < 0.05, 'it rose where it fell');
  const riser = sim.get(victim);
  assert.equal(riser.state, 'i');
  assert.ok(riser.alive, 'the record LIVES ON as the infectious — pool count is conserved');
  // The risen infectious hunts: distance to its nearest susceptible must shrink, and the outbreak
  // must claim a SECOND victim through the internal bite scan (self-sustaining, the whole point).
  const d0 = (() => { const p = sim.nearest(riser.x, riser.z, 100, 's'); return Math.hypot(p.x - riser.x, p.z - riser.z); })();
  guard = 0;
  while (sim.eCount === 0 && guard++ < 60 * 40) { reseed(sim, flee, hunt); sim.step(DT, s); }
  assert.ok(sim.eCount >= 1, 'the risen infectious BIT a susceptible (agent-to-agent, no zpool)');
  const p1 = sim.nearest(riser.x, riser.z, 100, 's');
  if (p1) assert.ok(Math.hypot(p1.x - riser.x, p1.z - riser.z) < d0 + 2, 'the hunt closed rather than wandered');
  assert.equal(sim.sCount + sim.eCount + sim.iCount, sim.alive, 'S+E+I books balance');
});

test('DETERMINISM in-pool: same seed ⇒ identical outbreak (events AND positions), across a GROWING horde', () => {
  const run = (seed) => {
    const { sim, flee, hunt } = mkWorld(seed);
    const timeline = [];
    let frame = 0;
    const s = {
      field: flee, zpool: null, huntField: hunt, aabbs: null,
      onBite: (c) => timeline.push(`${frame}:b${c.id}:${c.incubDur.toFixed(6)}`),
      onTurned: (c) => timeline.push(`${frame}:t${c.id}@${c.x.toFixed(6)},${c.z.toFixed(6)}`),
    };
    sim.forceExpose(2, 0, 0);
    const trace = [];
    for (frame = 0; frame < 30 * 60; frame++) {
      if (frame % 24 === 0) reseed(sim, flee, hunt); // the wiring's 0.4 s cadence
      sim.step(DT, s);
      if (frame % 60 === 0) {
        let row = '';
        sim.forEach((i, c) => { if (c.alive) row += `${i}${c.state}:${c.x.toFixed(6)},${c.z.toFixed(6)};`; });
        trace.push(row);
      }
    }
    return { timeline: timeline.join('|'), trace: trace.join('#'), i: sim.iCount };
  };
  const a = run(99), b = run(99), c = run(100);
  assert.ok(a.i >= 2, `the outbreak actually grew (I=${a.i})`);
  assert.equal(a.timeline, b.timeline, 'identical event timeline');
  assert.equal(a.trace, b.trace, 'identical position trace');
  assert.notEqual(a.timeline, c.timeline, 'a different seed is a different outbreak');
});

test('nearest(state) is the target-set seam: state-filtered, radius-bounded, and rollless', () => {
  const { sim } = mkWorld(3);
  const a = sim.get(0), b = sim.get(1), z = sim.get(2);
  a.x = 1; a.z = 0; a.state = 's';
  b.x = 3; b.z = 0; b.state = 'e';
  z.x = 0.5; z.z = 0; z.state = 'i';
  const got = sim.nearest(0, 0, 10, 's');
  assert.ok(got === a || (got.state === 's' && Math.hypot(got.x, got.z) <= 1), 'nearest S — never the closer E or I');
  assert.notEqual(got.state, 'e'); assert.notEqual(got.state, 'i');
  assert.equal(sim.nearest(0, 0, 0.7, 'i'), z, 'state i found inside the radius');
  assert.equal(sim.nearest(20, 20, 0.5, 's'), null, 'radius bounds the query');
  assert.equal(sim.nearestS(0, 0, 10), got, 'nearestS is the s-state alias (hoard2 opportunism unchanged)');
});

test('clampBlocked: a step can never END inside the blocked mask, even when shoved', () => {
  const srng = createAgentRng(5);
  const sim = createAgentSim({ ...P, chase: null }, srng, { cap: 2, clampBlocked: true });
  const field = createFlowField({ center: { x: 0, z: 0 }, radius: 5, cellSize: 0.25, agentRadius: 0.05, aabbs: [{ minX: 0.5, minZ: -2, maxX: 2.5, maxZ: 2 }], maxAgents: 8 });
  sim.populate(field);
  const c = sim.get(0), d = sim.get(1);
  // 0.15 sits in an OPEN cell: the rasterizer blocks every cell whose CENTRE is inside the inflated
  // box, so the wall's true frontier at this grid is the 0.25-cell boundary, one cell early (config-
  // space quantisation, not slack — a first draft started at 0.30, INSIDE the blocked frontier cell,
  // and measured the clamp doing exactly its job by never letting it leave).
  c.x = 0.15; c.z = 0; c.vx = 3; c.vz = 0;   // sprinting straight at the wall face
  d.alive = false;
  const s = { field, zpool: null, aabbs: null, onBite: null };
  for (let f = 0; f < 120; f++) sim.step(DT, s);
  assert.equal(field.isBlocked(c.x, c.z), false, `ended open: (${c.x.toFixed(2)}, ${c.z.toFixed(2)})`);
});
