/* ============================================================
   hoard2 · src/fx/fx-graph.test.mjs — the event-driven fx orchestration (Rule 9: intent, not "runs").
   ------------------------------------------------------------
   Drives createFxCore with the REAL core bus/rng/time (all node-safe — no engine barrel) and MOCK cosmetic
   sinks. Encodes the two contract promises the fx-audio owner must keep:
     · DEGRADE — with NO float RT (null particles) and no audio (null decals/sfx), every combat/wave/barrier
       event is a safe no-op (never throws). The game runs without FX.
     · CORPSE FLOW (DONE #5) — `zombie:death` books a persistent corpse (counts().corpses rises), drives the
       horde sink, evicts oldest at cap, recycles on the wall-clock TTL sweep, and catches a late-loading
       horde up via syncActive().
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createFxCore } from './fx-graph.js';
import { createEventBus } from '../core/events.js';
import { createRng } from '../core/rng.js';
import { createTime } from '../core/time.js';

function mockSink(ready = true) {
  const applied = [], recycled = [], stepped = [];
  return {
    _ready: ready,
    ready() { return this._ready; },
    apply(i, s) { applied.push({ i, x: s.x, z: s.z, type: s.type }); },
    recycle(i) { recycled.push(i); },
    step(dt) { stepped.push(dt); },
    applied, recycled, stepped,
  };
}

function makeCore({ config, sink, particles = null, decals = null, sfx = null } = {}) {
  const events = createEventBus();
  const core = createFxCore({
    events, rng: createRng(1337), time: createTime(), config,
    groundY: 0.3, particles, decals, sfx, sink: sink || mockSink(),
  });
  return { events, core, sink: sink || null };
}

const CFG = { CORPSE_CAP: 48, CORPSE_TTL_S: 14 };

test('DEGRADE — null particles/decals/sfx: every event is a safe no-op (no throw)', () => {
  const { events, core } = makeCore({ config: CFG });   // particles/decals/sfx all null
  assert.doesNotThrow(() => {
    events.emit('weapon:fire', { origin: { x: 0, y: 1, z: 0 }, dir: { x: 0, y: 0, z: 1 }, weapon: 'rifle', seed: 1 });
    events.emit('weapon:hit', { point: { x: 1, y: 0.3, z: 2 }, normal: { x: 0, y: 1, z: 0 }, damage: 10 });        // world hit
    events.emit('weapon:hit', { point: { x: 1, y: 0.3, z: 2 }, normal: { x: 0, y: 1, z: 0 }, target: { id: 3 }, damage: 10 }); // body hit
    events.emit('melee:hit', { target: { id: 3, x: 4, z: 5 }, damage: 8 });
    events.emit('melee:hit', { target: 3, damage: 8 });   // target with no position → burst skipped, no throw
    events.emit('barrier:damage', { id: 1, seg: 0, hp: 50 });
    events.emit('barrier:breach', { id: 1, seg: 0, hp: 0 });
    events.emit('zombie:death', { id: 7, type: 'walker', pos: { x: 3, y: 0.3, z: 3 } });
    core.update(0.016);
  });
  // Even fully degraded, the pure corpse pool still counts (it never needs the GPU/audio).
  assert.equal(core.counts().corpses, 1, 'a death still books a corpse with no FX present');
  assert.equal(core.counts().particles, 0);
  assert.equal(core.counts().decals, 0);
});

test('zombie:death books a persistent corpse and drives the horde sink', () => {
  const sink = mockSink(true);
  const { events, core } = makeCore({ config: CFG, sink });
  events.emit('zombie:death', { id: 1, type: 'runner', pos: { x: 2, y: 0.3, z: -4 } });
  assert.equal(core.counts().corpses, 1, 'corpse counted');
  assert.equal(sink.applied.length, 1, 'the horde sink was told to place the corpse');
  assert.equal(sink.applied[0].x, 2); assert.equal(sink.applied[0].z, -4);
  assert.equal(sink.applied[0].type, 'runner', 'the zombie type carries to the corpse (visual distinctness)');
});

test('corpse persists across the TTL floor, then the wall-clock sweep recycles it (drives sink.recycle)', () => {
  const sink = mockSink(true);
  const { events, core } = makeCore({ config: { CORPSE_CAP: 8, CORPSE_TTL_S: 14 }, sink });
  events.emit('zombie:death', { id: 1, type: 'walker', pos: { x: 0, y: 0.3, z: 0 } });

  // Advance ~13.9s of WALL clock in 60fps steps — corpse must still be alive (no vanishing under the floor).
  let t = 0; const step = 1 / 60;
  while (t < 13.9) { core.update(step); t += step; }
  assert.equal(core.counts().corpses, 1, 'corpse persists the full TTL floor on wall-clock');
  assert.equal(sink.recycled.length, 0, 'nothing recycled before the floor');

  // Cross the floor → the sweep frees the slot and tells the sink to hide that corpse.
  while (t < 14.1) { core.update(step); t += step; }
  assert.equal(core.counts().corpses, 0, 'corpse recycled after the TTL floor');
  assert.deepEqual(sink.recycled, [0], 'sink.recycle fired for the freed slot');
});

test('at CORPSE_CAP a new death evicts oldest and stays capped (never grows)', () => {
  const cap = 3;
  const sink = mockSink(true);
  const { events, core } = makeCore({ config: { CORPSE_CAP: cap, CORPSE_TTL_S: 10000 }, sink });
  for (let k = 0; k < cap; k++) events.emit('zombie:death', { id: k, type: 'walker', pos: { x: k, y: 0.3, z: 0 } });
  assert.equal(core.counts().corpses, cap, 'pool filled to cap');
  events.emit('zombie:death', { id: 99, type: 'tank', pos: { x: 99, y: 0.3, z: 0 } });
  assert.equal(core.counts().corpses, cap, 'a death at cap does NOT grow the pool past CORPSE_CAP');
  // The reused slot (index 0 = oldest) is re-applied with the new corpse.
  assert.equal(sink.applied[sink.applied.length - 1].x, 99, 'the newest corpse reused the oldest slot');
});

test('syncActive catches a late-loading horde up on corpses that already died', () => {
  const sink = mockSink(false);   // horde not ready yet (GLB still loading)
  const { events, core } = makeCore({ config: CFG, sink });
  events.emit('zombie:death', { id: 1, type: 'walker', pos: { x: 1, y: 0.3, z: 1 } });
  events.emit('zombie:death', { id: 2, type: 'runner', pos: { x: 2, y: 0.3, z: 2 } });
  assert.equal(core.counts().corpses, 2, 'pool books corpses even while the horde is unready');
  assert.equal(sink.applied.length, 0, 'nothing applied while unready (sink.ready() false)');

  sink._ready = true;         // GLB lands → horde built
  core.syncActive();
  assert.equal(sink.applied.length, 2, 'both already-dead corpses get applied on catch-up');
});

test('the fx roll comes off the decorrelated fx stream (a death yaw does not consume the sim stream)', () => {
  // Two cores with the SAME seed: one that fires a death, one that does not. The sim stream must be
  // untouched by fx activity (determinism spine, DONE #10 — fx is cosmetic).
  const rngA = createRng(1337), rngB = createRng(1337);
  const simA = rngA.fork('sim'), simB = rngB.fork('sim');
  const eventsA = createEventBus();
  createFxCore({ events: eventsA, rng: rngA, time: createTime(), config: CFG, groundY: 0.3, sink: mockSink(true) });
  eventsA.emit('zombie:death', { id: 1, type: 'walker', pos: { x: 0, y: 0.3, z: 0 } });   // consumes the fx stream
  // rngB's fx stream is never touched. The sim streams must still march in lockstep.
  for (let i = 0; i < 5; i++) assert.equal(simA(), simB(), 'sim stream unaffected by fx rolls');
});
