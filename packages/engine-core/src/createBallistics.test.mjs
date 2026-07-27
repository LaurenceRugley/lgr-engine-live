// createBallistics.test.mjs — node:test of the projectile sim (pure math; casts injected as callbacks).
// Encodes the BALLISTICS INVARIANTS the gun depends on (Rule 9 — WHY, not just "it runs"):
//   • TRAJECTORY — a horizontal shot follows the closed-form parabola (travel + drop = the felt point);
//   • POOL EXHAUSTION — a bounded pool refuses new shots instead of growing (no unbounded alloc);
//   • CAST ORDER — the NEAREST of {world, target} wins per step (a bullet can't hit a zombie behind a tree);
//   • DETERMINISM — identical inputs ⇒ identical trajectories (the capture/regression contract);
//   • ZERO-ALLOC — update() allocates nothing per frame (a RUNNABLE --expose-gc heap proof, + a source lint).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createBallistics } from './createBallistics.js';

const HERE = dirname(fileURLToPath(import.meta.url));

test('trajectory: a horizontal shot follows the closed-form parabola (exact x, drop = ½·g·t²)', () => {
  const g = 10, v = 20, dt = 1 / 500, steps = 250;      // small dt → Euler drift stays tiny + bounded
  const b = createBallistics({ gravity: g, maxLive: 4, maxLife: 100 });   // no casts → free flight
  b.fire(0, 0, 0, 1, 0, 0, v, 1);                        // horizontal, +x, no initial vertical velocity
  for (let s = 0; s < steps; s++) b.update(dt);
  const t = steps * dt;                                  // 0.5 s
  // horizontal has NO acceleration → position is exact: x = v·t.
  assert.ok(Math.abs(b.px[0] - v * t) < 1e-4, `x ${b.px[0]} ≠ ${v * t}`);
  // vertical drop vs continuous closed form. Symplectic-Euler drift here is ½·g·dt·t; allow 2×.
  const closedY = -0.5 * g * t * t;
  const tol = g * dt * t;                                // = 0.5·g·dt·t × 2
  assert.ok(Math.abs(b.py[0] - closedY) < tol, `y ${b.py[0].toFixed(4)} vs closed ${closedY} (tol ${tol})`);
  assert.ok(b.py[0] < -0.5, 'the bullet visibly dropped');
});

test('pool exhaustion: a full pool refuses new shots (bounded, no growth)', () => {
  const b = createBallistics({ gravity: 0, maxLive: 3, maxLife: 100 });
  assert.equal(b.fire(0, 0, 0, 1, 0, 0, 5, 1), true);
  assert.equal(b.fire(0, 0, 0, 1, 0, 0, 5, 1), true);
  assert.equal(b.fire(0, 0, 0, 1, 0, 0, 5, 1), true);
  assert.equal(b.fire(0, 0, 0, 1, 0, 0, 5, 1), false, '4th shot into a size-3 pool must be refused');
  assert.equal(b.liveCount, 3);
});

test('cast order: the NEAREST of world/target wins (a bullet is blocked by what it reaches first)', () => {
  const rec = { target: undefined, normalY: undefined, called: 0 };
  const mkWorld = (t) => () => ({ t, point: { x: t, y: 0, z: 0 }, normal: { x: 0, y: 1, z: 0 } });
  const mkTarget = (t) => () => ({ t, target: { id: 7 }, point: { x: t, y: 0, z: 0 } });
  const onHit = (h) => { rec.called++; rec.target = h.target; rec.normalY = h.normal.y; };

  // target nearer (0.3 < 0.6) → target hit (target set, no surface normal).
  let b = createBallistics({ gravity: 0, maxLive: 2, castWorld: mkWorld(0.6), castTargets: mkTarget(0.3), onHit });
  b.fire(0, 0, 0, 1, 0, 0, 10, 1); b.update(1 / 60);
  assert.equal(rec.target && rec.target.id, 7, 'nearer target should be hit'); assert.equal(rec.normalY, 0);
  assert.equal(b.liveCount, 0, 'a hit frees the slot');

  // world nearer (0.3 < 0.6) → world hit (no target, surface normal present).
  rec.target = undefined;
  b = createBallistics({ gravity: 0, maxLive: 2, castWorld: mkWorld(0.3), castTargets: mkTarget(0.6), onHit });
  b.fire(0, 0, 0, 1, 0, 0, 10, 1); b.update(1 / 60);
  assert.equal(rec.target, null, 'world hit ⇒ no target'); assert.equal(rec.normalY, 1, 'world hit carries the normal');

  // tie → target wins (a zombie flush against a wall still takes the shot).
  rec.target = undefined;
  b = createBallistics({ gravity: 0, maxLive: 2, castWorld: mkWorld(0.5), castTargets: mkTarget(0.5), onHit });
  b.fire(0, 0, 0, 1, 0, 0, 10, 1); b.update(1 / 60);
  assert.equal(rec.target && rec.target.id, 7, 'on a tie the target wins');
});

test('speed:Infinity is a one-step hitscan sweep (resolves + gone this frame)', () => {
  let hits = 0;
  const b = createBallistics({ gravity: 5, maxLive: 2, hitscanRange: 50, castTargets: () => ({ t: 0.2, target: { id: 1 }, point: { x: 10, y: 0, z: 0 } }), onHit: () => hits++ });
  b.fire(0, 0, 0, 1, 0, 0, Infinity, 1);
  assert.equal(b.liveCount, 1);
  b.update(1 / 60);
  assert.equal(hits, 1, 'hitscan resolves in one step');
  assert.equal(b.liveCount, 0, 'and is gone (instant fire)');
});

test('determinism: identical fire+update sequences produce identical trajectories', () => {
  const run = () => {
    const b = createBallistics({ gravity: 9, maxLive: 8, maxLife: 100 });
    for (let s = 0; s < 60; s++) {
      if (s % 5 === 0) b.fire(0, 0.5, 0, Math.sin(s), 0.1, Math.cos(s), 22, 1);
      b.update(1 / 90);
    }
    return [...b.px, ...b.py, ...b.pz];
  };
  assert.deepEqual(run(), run(), 'same inputs ⇒ bit-identical pool state');
});

test('zero-alloc: 12k update steps drift < 64 KB (spawned --expose-gc heap proof)', () => {
  const worker = resolve(HERE, '../../../tools/ballistics-heap.mjs');
  let out;
  try {
    out = execFileSync(process.execPath, ['--expose-gc', worker], { encoding: 'utf8' });
  } catch (e) {
    assert.fail(`heap proof exited non-zero (over budget):\n${e.stdout || ''}${e.stderr || ''}`);
  }
  const m = out.match(/HEAPDELTA=(\d+)/);
  assert.ok(m, `no HEAPDELTA in worker output:\n${out}`);
  assert.ok(Number(m[1]) < 64 * 1024, `heap grew ${m[1]} bytes ≥ 64 KB`);
});

test('zero-alloc lint (secondary): the hot path has no allocating tokens', () => {
  const src = readFileSync(resolve(HERE, 'createBallistics.js'), 'utf8');
  // grab from resolveSegment through update (the per-frame hot path) up to the module return.
  const hot = src.slice(src.indexOf('function resolveSegment'), src.indexOf('return {'));
  for (const bad of ['new ', '.map(', '.filter(', '=> [', 'Array(']) {
    assert.ok(!hot.includes(bad), `hot path contains an allocating token: "${bad}"`);
  }
});
