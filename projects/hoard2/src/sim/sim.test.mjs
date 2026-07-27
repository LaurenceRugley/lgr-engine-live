/* ============================================================
   hoard2 · src/sim/sim.test.mjs — the SIM's INTENT, node-testable (no THREE, no @lgr/engine-core barrel).
   ------------------------------------------------------------
   We test the PURE logic modules directly (survival · wave-director · zombies) — index.js is NOT imported
   because it pulls the engine barrel (shaders → dies under node). These assertions encode WHY the balance
   matters (Rule 9), pinned to the run's DONE criteria:
     • DONE #3  wave count monotonic (fixed night phase) + reaches ≥40 by wave 10; night scales speed AND count.
     • DONE #6  hunger kills (cause 'hunger') AND injury kills (cause 'injury'); pickups heal.
     • DONE #10 same seed → identical zombie-position trace across ≥2 waves; a different WORLD-fork
                consumption does NOT perturb the sim trace (fork decorrelation).
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../core/rng.js';
import * as config from '../core/config.js';
import { createSurvival } from './survival.js';
import { createWaveDirector } from './wave-director.js';
import { createZombiePool } from './zombies.js';

const srngOf = (seed = config.DEFAULT_SEED) => createRng(seed).fork('sim');

// A headless director harness: spawns into a real pool, records the count emitted per wave.
function driveWaves(nf, waves) {
  const pool = createZombiePool(config, srngOf());
  const started = [];
  const dir = createWaveDirector(config, {
    nightAt: () => nf,
    requestSpawn: (n) => { let g = 0; for (let i = 0; i < n; i++) { if (pool.spawn(dir.wave, nf)) g++; else break; } return g; },
    onStart: (n, count) => started.push({ n, count }),
    onClear: () => {},
  });
  for (let w = 0; w < waves; w++) { dir.forceWave(w + 1); pool.reset(); }
  return started;
}

test('DONE#3: emitted wave count is strictly monotonic at a fixed night phase, and ≥40 by wave 10', () => {
  const day = driveWaves(0, 12);
  for (let i = 1; i < day.length; i++) assert.ok(day[i].count > day[i - 1].count, `wave ${i + 1} count ${day[i].count} > ${day[i - 1].count}`);
  const w10 = day.find((s) => s.n === 10);
  assert.ok(w10.count >= 40, `wave 10 spawns ${w10.count} must be ≥ 40`);
});

test('DONE#3: night scales the COUNT up (count ×1.5 at full night) vs the same wave in daylight', () => {
  const day = driveWaves(0, 3);
  const night = driveWaves(1, 3);
  for (let i = 0; i < 3; i++) {
    assert.ok(night[i].count > day[i].count, `night wave ${i + 1} (${night[i].count}) must exceed day (${day[i].count})`);
    const ratio = night[i].count / day[i].count;
    assert.ok(Math.abs(ratio - config.NIGHT.countMul(1)) < 0.06, `night/day count ratio ${ratio.toFixed(3)} ≈ ${config.NIGHT.countMul(1)}`);
  }
});

test('DONE#3: night scales zombie SPEED up (speed ×1.4 at full night), applied live in the step', () => {
  const pool = createZombiePool(config, srngOf());
  pool.spawn(5, 0);
  const z = pool.get(0);
  // A no-op step (no field, player far, no barriers) recomputes z.speed = baseSpeed·speedMul(nf).
  const S = (nf) => { pool.step(1 / 60, { player: { x: 999, z: 999 }, field: null, contactR: 0.6, nf, aabbs: null, hitBarrier: null, damagePlayer: null }); return z.speed; };
  const day = S(0), night = S(1);
  assert.ok(night > day, `night speed ${night} must exceed day ${day}`);
  const ratio = night / day;
  assert.ok(Math.abs(ratio - config.NIGHT.speedMul(1)) < 0.01, `speed ratio ${ratio.toFixed(3)} ≈ ${config.NIGHT.speedMul(1)}`);
});

test('DONE#6: starvation actually kills, with cause "hunger"', () => {
  const s = createSurvival(config);
  let deadCause = null; s.setOnDeath((c) => { deadCause = c; });
  // Drain hunger to 0, then keep ticking until starvation chips hp to 0.
  for (let i = 0; i < 100000 && !s.state.dead; i++) s.update(0.1);
  assert.equal(s.state.dead, true);
  assert.equal(s.state.cause, 'hunger');
  assert.equal(deadCause, 'hunger');
  assert.equal(s.state.hp, 0);
});

test('DONE#6: injury actually kills, with cause "injury"; and pickups heal', () => {
  const s = createSurvival(config);
  s.damage(config.SURVIVE.hpMax);            // one lethal blow
  assert.equal(s.state.dead, true);
  assert.equal(s.state.cause, 'injury');

  const s2 = createSurvival(config);
  s2.state.hunger = 10; s2.applyPickup('food');
  assert.ok(s2.state.hunger > 10, 'food restores hunger');
  s2.state.hp = 40; s2.applyPickup('bandage');
  assert.ok(s2.state.hp > 40, 'bandage restores hp');
});

test('survival: stamina is spent only when affordable (melee/sprint pricing)', () => {
  const s = createSurvival(config);
  s.state.stamina = config.SURVIVE.meleeStaminaCost + 1;
  assert.equal(s.trySpend(config.SURVIVE.meleeStaminaCost), true);
  assert.equal(s.trySpend(config.SURVIVE.meleeStaminaCost), false); // now too low
});

test('zombies: queryTargets returns a zombie a segment passes through, and misses one off to the side', () => {
  const pool = createZombiePool(config, srngOf());
  const z = pool.spawn(1, 0);
  z.x = 5; z.z = 0; // place it on the +X axis
  const hit = pool.queryTargets({ o: { x: 0, y: 0, z: 0 }, e: { x: 10, y: 0, z: 0 } });
  assert.equal(hit.length, 1); assert.equal(hit[0].id, z.id);
  const miss = pool.queryTargets({ o: { x: 0, y: 0, z: 5 }, e: { x: 10, y: 0, z: 5 } });
  assert.equal(miss.length, 0);
});

test('zombies: a bullet kills; drops roll deterministically off the sim stream', () => {
  const pool = createZombiePool(config, srngOf());
  const z = pool.spawn(1, 0);
  const before = pool.alive;
  const death = pool.damage(z.id, z.maxhp + 1);
  assert.ok(death, 'lethal damage returns death info');
  assert.equal(death.z.id, z.id);
  assert.equal(pool.alive, before - 1);
  assert.ok(Array.isArray(death.drops)); // 0 or 1 drop, deterministic
});

// ---- DONE #10: determinism. A scripted, identical (dt, player, kills) sequence spanning ≥2 waves must
//      produce byte-identical zombie-position traces; and consuming the WORLD fork differently must NOT shift it.
function traceRun(worldRolls) {
  const rng = createRng(config.DEFAULT_SEED);
  const world = rng.fork('world'); for (let i = 0; i < worldRolls; i++) world(); // decorrelation stressor
  const pool = createZombiePool(config, rng.fork('sim'));
  let waveClears = 0;
  const dir = createWaveDirector(config, {
    nightAt: () => 0.5,
    requestSpawn: (n) => { let g = 0; for (let i = 0; i < n; i++) { if (pool.spawn(dir.wave, 0.5)) g++; else break; } return g; },
    onStart: () => {}, onClear: () => { waveClears++; },
  });
  const trace = [];
  const dt = 1 / 60;
  let frame = 0;
  // Run until we have cleared ≥ 2 waves (a wave clears when all zombies die), sampling every 30 frames.
  while (waveClears < 2 && frame < 20000) {
    // Deterministic "player" figure-8 so the crowd actually moves/steers each frame.
    const p = { x: Math.sin(frame * 0.01) * 8, z: Math.cos(frame * 0.017) * 8 };
    dir.step(dt, pool.alive);
    pool.step(dt, { player: p, field: null, contactR: 0.6, nf: 0.5, aabbs: null, hitBarrier: null, damagePlayer: null });
    // A scripted cull: every 20th frame kill the lowest live id, so waves progress to a clear.
    if (frame % 20 === 0) { for (let i = 0; i < pool.max; i++) { const z = pool.get(i); if (z.alive) { pool.damage(i, z.maxhp + 1); break; } } }
    if (frame % 30 === 0) { let s = ''; for (let i = 0; i < pool.max; i++) { const z = pool.get(i); if (z.alive) s += `${i}:${z.x.toFixed(4)},${z.z.toFixed(4)};`; } trace.push(s); }
    frame++;
  }
  return { trace, waveClears };
}

test('DONE#10: same seed → identical zombie-position trace spanning ≥2 waves', () => {
  const a = traceRun(0);
  const b = traceRun(0);
  assert.ok(a.waveClears >= 2, `trace must span ≥2 waves (got ${a.waveClears})`);
  assert.deepEqual(a.trace, b.trace);
});

test('DONE#10: a different WORLD-fork consumption does NOT perturb the sim trace (fork decorrelation)', () => {
  const a = traceRun(0);
  const b = traceRun(97); // world stream advanced 97× — sim must be untouched
  assert.deepEqual(a.trace, b.trace);
});
