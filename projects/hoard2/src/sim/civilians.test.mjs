/* ============================================================
   hoard2 · src/sim/civilians.test.mjs — the OUTBREAK's intent, node-testable (no THREE, no engine barrel).
   ------------------------------------------------------------
   These encode WHY the SEIR loop matters (Rule 9), against the REAL flow field and the REAL zombie pool:
     • THE CYCLE — bite → incubation (a rolled window inside CIVS.incubationS — the pacing lever) → turn,
       and the turn spawns a zombie AT the victim's position from the EXISTING pool (S→E→I is a handoff,
       not a parallel system). If the incubation window stops being tunable/telegraphed, these fail.
     • DETERMINISM — same seed ⇒ an identical outbreak TIMELINE (event sequence + position trace). The
       whole probe/replay infrastructure dies if infection adds untracked randomness (research doc risk #3).
     • FLEE ACTUALLY FLEES — mean distance-to-nearest-threat must GROW under flee and beat the ?noflee
       control arm. A flee that doesn't buy distance is theater pretending to be behaviour.
     • THE PREFILTER IS HONEST — a zombie beyond contactCells never bites (the flee-field cost gate is a
       broadphase, not a rule change).
   createFlowField is imported by RELATIVE path (its own test does the same) — the module is pure and
   node-safe; only the @lgr/engine-core BARREL is un-importable here (it pulls shaders).
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import * as config from '../core/config.js';
import { createZombiePool } from './zombies.js';
import { createCivilianPool } from './civilians.js';
import { createFlowField } from '../../../../packages/engine-core/src/createFlowField.js';

const DT = 1 / 60;

function mkWorld(seed = config.DEFAULT_SEED, { flee = true, civCap = 12 } = {}) {
  const rng = createRng(seed);
  const srng = rng.fork('sim');
  const zpool = createZombiePool(config, srng);
  const civs = createCivilianPool(config, srng, { cap: civCap, sepCap: zpool.max, flee });
  const field = createFlowField({ center: { x: 0, z: 0 }, radius: config.ARENA_EXTENT, cellSize: 0.6, agentRadius: 0.3, maxAgents: zpool.max + civCap });
  civs.populate(field);
  return { srng, zpool, civs, field };
}
// The sim's reseed rule, in miniature: multi-source solve from every live zombie.
function reseed(field, zpool) {
  const list = [];
  for (let i = 0; i < zpool.max; i++) { const z = zpool.get(i); if (z.alive) list.push({ x: z.x, z: z.z }); }
  field.solve(list);
}

test('SEIR cycle: bite → incubation inside the configured window → a zombie rises AT the victim', () => {
  const { zpool, civs, field } = mkWorld();
  const events = [];
  const s = {
    field, zpool, threatCount: 1, aabbs: null,
    onBite: (c) => events.push({ ev: 'bite', id: c.id, dur: c.incubDur }),
    onTurn: (c) => {
      const z = zpool.spawnAt(c.x, c.z, 1, 0);
      if (!z) return false;
      events.push({ ev: 'turn', id: c.id, zid: z.id, x: c.x, z: c.z, zx: z.x, zz: z.z });
      return true;
    },
  };
  const victim = civs.get(0);
  const zomb = zpool.spawnAt(victim.x, victim.z, 1, 0); // an infectious body ON the victim
  reseed(field, zpool);

  // Ride the contact until the transmission roll lands (the zombie is glued to the victim so the
  // contact × dt × p integral actually integrates — in play the chase supplies this).
  let t = 0;
  while (events.length === 0 && t < 30) { zomb.x = victim.x; zomb.z = victim.z; reseed(field, zpool); civs.step(DT, s); t += DT; }
  assert.equal(events.length, 1, 'the bite must land within a few seconds of sustained contact');
  assert.equal(events[0].ev, 'bite');
  const dur = events[0].dur;
  assert.ok(dur >= config.CIVS.incubationS[0] && dur <= config.CIVS.incubationS[1],
    `incubation ${dur}s must sit inside the configured window [${config.CIVS.incubationS}] — it IS the pacing lever`);
  assert.equal(civs.eCount, 1); assert.equal(civs.sCount, civs.max - 1);

  // Incubate to the turn. The zombie stops chasing (moved away) so the turn is the only event left.
  zomb.x = 30; zomb.z = 30; reseed(field, zpool);
  const zBefore = zpool.alive;
  let steps = Math.ceil((dur + 1) / DT);
  while (events.length === 1 && steps-- > 0) civs.step(DT, s);
  assert.equal(events.length, 2, 'the victim must TURN when the window closes');
  const turn = events[1];
  assert.equal(turn.zx, turn.x); assert.equal(turn.zz, turn.z, 'the zombie rises exactly where the civilian fell');
  assert.equal(zpool.alive, zBefore + 1, 'the turn draws from the EXISTING zombie pool (E→I is a handoff)');
  assert.equal(civs.eCount, 0, 'the turned civilian leaves the population');
  assert.equal(civs.alive, civs.max - 1);
});

// A scripted outbreak: a wave of zombies hunts a static survivor at the origin THROUGH the crowd, two
// civilians are force-bitten at t=0, and everything runs for 45 s. Returns the full event timeline plus
// a sampled position trace — the determinism fingerprint.
function outbreakRun(seed) {
  const { zpool, civs, field } = mkWorld(seed);
  const hunt = createFlowField({ center: { x: 0, z: 0 }, radius: config.ARENA_EXTENT, cellSize: 0.6, agentRadius: 0.3, maxAgents: zpool.max });
  const timeline = [];
  let frame = 0;
  const s = {
    field, zpool, threatCount: 0, aabbs: null,
    onBite: (c) => timeline.push(`${frame}:bite:${c.id}:${c.incubDur.toFixed(4)}`),
    onTurn: (c) => {
      const z = zpool.spawnAt(c.x, c.z, 1, 0);
      if (!z) return false;
      timeline.push(`${frame}:turn:${c.id}>${z.id}@${c.x.toFixed(4)},${c.z.toFixed(4)}`);
      return true;
    },
  };
  for (let i = 0; i < 24; i++) zpool.spawn(2, 0); // the wave, on the ring around the survivor
  civs.forceExpose(2);                            // patient zero ×2, through the real bite path
  const player = { x: 0, z: 0 };
  const zStep = { player, field: hunt, contactR: 0.6, nf: 0, aabbs: null, hitBarrier: null, damagePlayer: null, civs }; // opportunism ON — the trace covers the spread mechanism
  const trace = [];
  let fleeAcc = 1; // ≥ threshold → reseed on the first frame
  for (frame = 0; frame < 45 * 60; frame++) {
    zpool.step(DT, zStep);
    fleeAcc += DT;
    if (fleeAcc >= config.CIVS.fleeResolveS) { fleeAcc = 0; reseed(field, zpool); }
    s.threatCount = zpool.alive;
    civs.step(DT, s);
    if (frame % 60 === 0) {
      let row = '';
      for (let i = 0; i < civs.max; i++) { const c = civs.get(i); if (c.alive) row += `${i}${c.state}:${c.x.toFixed(4)},${c.z.toFixed(4)};`; }
      trace.push(row);
    }
  }
  return { timeline, trace, bitesAndTurns: timeline.length };
}

test('DETERMINISM: same seed ⇒ an identical outbreak timeline (events AND positions)', () => {
  const a = outbreakRun(config.DEFAULT_SEED);
  const b = outbreakRun(config.DEFAULT_SEED);
  assert.ok(a.timeline.length >= 4, `expected the outbreak to actually run (≥2 bites + ≥2 turns), got ${a.timeline.length} events: ${a.timeline}`);
  assert.deepEqual(a.timeline, b.timeline, 'the infection event sequence must replay exactly');
  assert.deepEqual(a.trace, b.trace, 'the civilian position trace must replay exactly');
});

test('DETERMINISM: a different seed produces a DIFFERENT outbreak (the timeline is not degenerate)', () => {
  const a = outbreakRun(config.DEFAULT_SEED);
  const c = outbreakRun(config.DEFAULT_SEED + 7);
  assert.notDeepEqual(a.timeline, c.timeline);
});

// Mean distance from each live civilian to the nearest of the threats.
function meanThreatDist(civs, threats) {
  let sum = 0, n = 0;
  civs.forEach((_i, c) => {
    if (!c.alive) return;
    let best = Infinity;
    for (const t of threats) best = Math.min(best, Math.hypot(c.x - t.x, c.z - t.z));
    sum += best; n++;
  });
  return n ? sum / n : 0;
}

test('FLEE actually flees: distance-to-threat GROWS, and beats the ?noflee control arm', () => {
  const run = (flee) => {
    const { zpool, civs, field } = mkWorld(31337, { flee });
    // Put the WHOLE crowd inside the panic radius (deterministic ring, r 2.5 ⇒ ≤ ~4.5 u from a threat,
    // under panicCells·cellSize ≈ 5.4 u) — the metric below is a mean, and a crowd scattered over the
    // full 18 u disc dilutes it with civilians the rule says should NOT flee (metric-audit lesson).
    civs.forEach((i, c) => { const a = (i / civs.max) * Math.PI * 2; c.x = Math.cos(a) * 2.5; c.z = Math.sin(a) * 2.5; });
    // Two static infectious bodies in the middle of the crowd — multi-source flight, no chase confound.
    const zA = zpool.spawnAt(2, 0, 1, 0), zB = zpool.spawnAt(-2, 1, 1, 0);
    const threats = [{ x: zA.x, z: zA.z }, { x: zB.x, z: zB.z }];
    reseed(field, zpool);
    const s = { field, zpool, threatCount: 2, aabbs: null, onBite: null, onTurn: null };
    const d0 = meanThreatDist(civs, threats);
    for (let f = 0; f < 8 * 60; f++) civs.step(DT, s);
    return { d0, d1: meanThreatDist(civs, threats) };
  };
  const F = run(true), N = run(false);
  assert.ok(F.d1 > F.d0 + 1.0, `flee must BUY distance: ${F.d0.toFixed(2)} → ${F.d1.toFixed(2)} u`);
  assert.ok(F.d1 > N.d1 + 1.0, `flee (${F.d1.toFixed(2)} u) must clearly beat the no-flee control (${N.d1.toFixed(2)} u)`);
});

// ---- ZOMBIE OPPORTUNISM (the agent-to-agent spread mechanism — zombies.js s.civs, optional) ----
test('opportunism is an EXACT no-op when s.civs is absent or empty (existing traces are byte-identical)', () => {
  const mk = () => {
    const srng = createRng(config.DEFAULT_SEED).fork('sim');
    const zpool = createZombiePool(config, srng);
    for (let i = 0; i < 10; i++) zpool.spawn(2, 0);
    return zpool;
  };
  const civsEmpty = createCivilianPool(config, createRng(1).fork('x'), { cap: 4 }); // never populated → no live S
  const run = (civs) => {
    const zpool = mk();
    const s = { player: { x: 0, z: 0 }, field: null, contactR: 0.6, nf: 0, aabbs: null, hitBarrier: null, damagePlayer: null, civs };
    const rows = [];
    for (let f = 0; f < 300; f++) {
      zpool.step(DT, s);
      if (f % 30 === 0) { let r = ''; for (let i = 0; i < zpool.max; i++) { const z = zpool.get(i); if (z.alive) r += `${i}:${z.x.toFixed(6)},${z.z.toFixed(6)};`; } rows.push(r); }
    }
    return rows;
  };
  assert.deepEqual(run(null), run(civsEmpty), 'no live susceptibles ⇒ the diversion branch never fires');
});

test('opportunism DIVERTS: a susceptible inside opportunityR (and closer than the survivor) gets chased', () => {
  const srng = createRng(config.DEFAULT_SEED).fork('sim');
  const zpool = createZombiePool(config, srng);
  const civs = createCivilianPool(config, srng, { cap: 2, sepCap: zpool.max });
  const z = zpool.spawnAt(0, 0, 1, 0);
  // A pinned susceptible 2 u away (inside opportunityR 3.5, far closer than the survivor at 20 u).
  const bait = civs.get(0); bait.alive = true; bait.state = 's'; bait.x = 2; bait.z = 0;
  const s = { player: { x: 20, z: 0 }, field: null, contactR: 0.6, nf: 0, aabbs: null, hitBarrier: null, damagePlayer: null, civs };
  const d0 = Math.hypot(z.x - bait.x, z.z - bait.z);
  for (let f = 0; f < 60; f++) zpool.step(DT, s);
  const d1 = Math.hypot(z.x - bait.x, z.z - bait.z);
  assert.ok(d1 < d0 - 0.4, `the zombie must close on the bait: ${d0.toFixed(2)} → ${d1.toFixed(2)} u`);
  // …and a civ OUTSIDE the radius is ignored: the zombie resumes the survivor march.
  bait.x = 10; bait.z = 10;
  const px0 = Math.hypot(z.x - 20, z.z - 0);
  for (let f = 0; f < 60; f++) zpool.step(DT, s);
  const px1 = Math.hypot(z.x - 20, z.z - 0);
  assert.ok(px1 < px0, `released past opportunityR, the zombie marches on the survivor again: ${px0.toFixed(2)} → ${px1.toFixed(2)} u`);
});

test('the bite PREFILTER is a broadphase, not a rule change: a distant zombie never infects', () => {
  const { zpool, civs, field } = mkWorld();
  // Every zombie parked far outside contact range of every civilian (populateRadius 18 + margin).
  zpool.spawnAt(30, 30, 1, 0);
  reseed(field, zpool);
  let bites = 0;
  const s = { field, zpool, threatCount: 1, aabbs: null, onBite: () => bites++, onTurn: null };
  for (let f = 0; f < 5 * 60; f++) civs.step(DT, s);
  assert.equal(bites, 0);
  assert.equal(civs.eCount, 0);
});
