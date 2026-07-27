/* ============================================================
   hoard2 · src/core/core.test.mjs — the core-seam contract, node-testable (no THREE/DOM).
   Verifies the coordination LAW itself, not just behavior (Rule 9): the registry fails loud on a
   missing/duplicate wire, the event bus rejects out-of-vocabulary names, the rng forks are
   deterministic AND decorrelated (the determinism spine DONE #10 rests on), and the pinned config
   invariants the DONE criteria are asserted against (monotonic waves, night multipliers > 1) hold.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRegistry } from './registry.js';
import { createEventBus } from './events.js';
import { createRng } from './rng.js';
import { createTime } from './time.js';
import * as config from './config.js';

test('registry: register/get round-trips; missing + duplicate fail loud', () => {
  const r = createRegistry();
  const facade = { hello: 1 };
  assert.equal(r.register('sim', facade), facade);
  assert.equal(r.get('sim'), facade);
  assert.equal(r.has('sim'), true);
  assert.equal(r.has('nope'), false);
  assert.throws(() => r.get('world'), /not registered/); // missing wire = crash, not undefined
  assert.throws(() => r.register('sim', {}), /already registered/); // two owners, one name = surfaced
});

test('events: vocabulary is enforced; on/emit/dispose work; a throwing listener is isolated', () => {
  const bus = createEventBus();
  assert.throws(() => bus.on('not:real', () => {}), /vocabulary/);
  assert.throws(() => bus.emit('not:real', {}), /vocabulary/);
  let got = null;
  const off = bus.on('zombie:death', (p) => { got = p; });
  bus.on('zombie:death', () => { throw new Error('bad listener'); }); // must not kill the emit
  bus.emit('zombie:death', { id: 7 });
  assert.deepEqual(got, { id: 7 });
  off();
  got = null;
  bus.emit('zombie:death', { id: 8 });
  assert.equal(got, null); // disposed listener no longer fires
});

test('rng: same seed → identical named streams (determinism spine)', () => {
  const a = createRng(1337).fork('sim');
  const b = createRng(1337).fork('sim');
  const seqA = Array.from({ length: 8 }, () => a());
  const seqB = Array.from({ length: 8 }, () => b());
  assert.deepEqual(seqA, seqB); // reproducible
  assert.ok(seqA.every((v) => v >= 0 && v < 1));
});

test('rng: forks are decorrelated (world rolls do not perturb the sim stream)', () => {
  // The determinism guarantee: sim output depends ONLY on the sim stream. Two runs where the WORLD
  // stream is consumed a different number of times must yield the SAME sim sequence.
  const run = (worldRolls) => {
    const rng = createRng(1337);
    const world = rng.fork('world');
    for (let i = 0; i < worldRolls; i++) world();
    const sim = rng.fork('sim');
    return Array.from({ length: 6 }, () => sim());
  };
  assert.deepEqual(run(0), run(50)); // world activity cannot shift the sim trace
  // And the two streams are not the same sequence:
  const rng = createRng(1337);
  assert.notDeepEqual([rng.fork('sim')(), rng.fork('sim')()], [rng.fork('fx')(), rng.fork('fx')()]);
});

test('rng: fork(name) is idempotent — same handle, one advancing stream per name', () => {
  const rng = createRng(42);
  assert.equal(rng.fork('sim'), rng.fork('sim')); // caching, not a fresh stream each call
});

test('config: wave curve is strictly monotonic (DONE #3) and reaches ≥40 by wave 10 (DONE #9)', () => {
  for (let n = 1; n < 30; n++) assert.ok(config.WAVE.count(n + 1) > config.WAVE.count(n), `wave ${n + 1} > ${n}`);
  assert.ok(config.WAVE.count(10) >= 40, `wave 10 spawns = ${config.WAVE.count(10)} must be ≥ 40`);
  assert.ok(config.MAXZ >= 40, 'live pool must hold ≥ 40 concurrent');
});

test('config: night makes it harder — both multipliers exceed 1 at full night (DONE #3)', () => {
  assert.ok(config.NIGHT.speedMul(1) > 1, 'night speed mul > 1');
  assert.ok(config.NIGHT.countMul(1) > 1, 'night count mul > 1');
  assert.equal(config.NIGHT.speedMul(0), 1, 'day = no speed penalty');
  assert.equal(config.NIGHT.countMul(0), 1, 'day = no count penalty');
});

test('config: a full barrier rebuild costs more than either single source per wave (DONE #4)', () => {
  const full = config.BUILD.barrierCostWood + config.BUILD.barrierCostScrap;
  assert.ok(full > config.BUILD.woodPerWaveEstimate, 'wood alone cannot fund a full rebuild');
  assert.ok(full > config.BUILD.scrapPerWaveEstimate, 'scrap alone cannot fund a full rebuild');
});

test('config: dive dilation is the ratified ~0.5 (danger stays real)', () => {
  assert.ok(config.DIVE_TIMESCALE > 0.12 && config.DIVE_TIMESCALE <= 0.6, `dilation ${config.DIVE_TIMESCALE}`);
});

test('time: pause zeroes both clocks; dive eases the sim clock toward the dilation', () => {
  const time = createTime();
  assert.equal(time.simDt(1), 1); // surfaced, unpaused: real time
  time.setPaused(true);
  assert.equal(time.simDt(1), 0);
  assert.equal(time.realDt(1), 0); // paused freezes everything
  time.setPaused(false);
  time.setDived(true);
  for (let i = 0; i < 240; i++) time.update(1 / 60); // ease to target over ~seconds
  assert.ok(Math.abs(time.scale - config.DIVE_TIMESCALE) < 0.02, `scale eased to ${time.scale}`);
  assert.ok(time.simDt(1) < time.realDt(1), 'dived: world clock slower than the walker clock');
});
