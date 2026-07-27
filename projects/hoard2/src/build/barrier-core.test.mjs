/* ============================================================
   hoard2 · src/build/barrier-core.test.mjs — the fortification CONTRACT, node-testable.
   Verifies WHY the mechanics matter (Rule 9), not just that code runs. Imports ONLY the pure
   barrier-core.js + core/config.js — never the engine barrel (its shader re-exports kill node).

   Pins the DONE #4 economy invariant ("both sources matter"), the place→damage→breach→repair HP
   lifecycle, the ballistics segment test (hit through a wall, miss beside it), and harvest accrual.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as config from '../core/config.js';
import {
  createBarrierField, canAfford, fullRebuildCost, singleSourceFundsRebuild,
  BARRIER_COST, harvestFrom, castSegment, makeBarrier, aabbList,
} from './barrier-core.js';

test('economy: a full barrier rebuild costs MORE than either single source yields in a wave (DONE #4)', () => {
  // This is the load-bearing balance claim: wood-alone and scrap-alone each fall short of one full
  // rebuild, so BOTH the forest (wood) and the ruins/drops (scrap) genuinely matter.
  assert.equal(fullRebuildCost(), config.BUILD.barrierCostWood + config.BUILD.barrierCostScrap);
  assert.ok(fullRebuildCost() > config.BUILD.woodPerWaveEstimate, 'wood/wave cannot fund a full rebuild');
  assert.ok(fullRebuildCost() > config.BUILD.scrapPerWaveEstimate, 'scrap/wave cannot fund a full rebuild');
  assert.equal(singleSourceFundsRebuild(config.BUILD.woodPerWaveEstimate), false);
  assert.equal(singleSourceFundsRebuild(config.BUILD.scrapPerWaveEstimate), false);
});

test('economy: canAfford needs BOTH resources — a hoard of one alone never places a wall', () => {
  assert.equal(canAfford({ wood: BARRIER_COST.wood, scrap: BARRIER_COST.scrap }), true);
  assert.equal(canAfford({ wood: 9999, scrap: BARRIER_COST.scrap - 1 }), false, 'all wood, short scrap → no');
  assert.equal(canAfford({ wood: BARRIER_COST.wood - 1, scrap: 9999 }), false, 'all scrap, short wood → no');
});

test('HP lifecycle: place at full HP → damage drives hp→breach exactly once → repair revives it', () => {
  const field = createBarrierField();
  const b = field.place(0, 5, 'x');
  assert.equal(b.hp, config.BUILD.barrierHpMax);
  assert.equal(b.alive, true);
  assert.equal(field.aabbs().length, 1, 'alive wall is a blocker');

  // Chip it down: no breach until hp actually reaches 0.
  let breaches = 0;
  const chunk = config.BUILD.barrierHpMax / 3;
  for (let i = 0; i < 5; i++) { const r = field.hit(b.id, chunk); if (r.breached) breaches++; }
  assert.equal(breaches, 1, 'breach fires exactly on the hp≤0 transition, not on later hits');
  assert.equal(b.alive, false);
  assert.equal(b.hp, 0);
  assert.equal(field.aabbs().length, 0, 'breached wall drops out of the blocker list → field re-paths');

  // Repair kit stands it back up.
  field.repair(b.id, config.BUILD.repairKitHp);
  assert.equal(b.alive, true, 'repaired wall blocks again');
  assert.equal(b.hp, config.BUILD.repairKitHp);
  assert.equal(field.aabbs().length, 1);
});

test('ballistics segment test: a shot THROUGH a wall hits; a shot beside it misses (DONE #4 "blocks shots")', () => {
  const field = createBarrierField();
  const b = field.place(0, 0, 'x'); // wall centered at origin, long in x, thin in z
  const y = config.GROUND_Y + 0.5;

  // Shot from -z to +z straight through the wall's face → a hit with a valid entry point + normal.
  const hit = field.cast({ x: 0, y, z: -4 }, { x: 0, y, z: 4 });
  assert.ok(hit, 'segment crossing the wall returns a hit');
  assert.equal(hit.id, b.id);
  assert.ok(hit.t > 0 && hit.t < 1, `hit param in (0,1), got ${hit.t}`);
  assert.ok(Math.abs(hit.point.z) <= b.maxz + 1e-6, 'hit point lands on the wall box');
  assert.ok(hit.normal.z !== 0, 'entry normal faces the incoming shot along z');

  // Parallel shot well beside the wall (far +x, thin in z) → clean miss (null, not a phantom hit).
  const miss = field.cast({ x: 50, y, z: -4 }, { x: 50, y, z: 4 });
  assert.equal(miss, null, 'a segment that never enters the AABB returns null');

  // A shot sailing OVER the top of the wall also misses (the box has a finite height).
  const over = field.cast({ x: 0, y: config.GROUND_Y + 10, z: -4 }, { x: 0, y: config.GROUND_Y + 10, z: 4 });
  assert.equal(over, null, 'a shot above the wall top clears it');

  // castSegment ignores breached walls (dead blockers cannot stop a bullet).
  field.hit(b.id, b.hpMax + 1);
  assert.equal(field.cast({ x: 0, y, z: -4 }, { x: 0, y, z: 4 }), null, 'breached wall no longer casts');
});

test('cast returns the NEAREST of overlapping walls (smallest t wins)', () => {
  const field = createBarrierField();
  field.place(0, -1, 'x'); // nearer to a -z origin
  const far = field.place(0, 1, 'x'); // farther
  const y = config.GROUND_Y + 0.5;
  const hit = castSegment(field.barriers, { x: 0, y, z: -5 }, { x: 0, y, z: 5 });
  assert.ok(hit && hit.id !== far.id, 'the closer wall is the one that stops the shot');
});

test('harvest: node depletes and grants accrue toward — but never exceed — a wave estimate', () => {
  // A single wood node with the whole wave's wood headroom in it. Repeated harvests deplete it and
  // the total granted equals the node's stock — and that total (≤ estimate) still cannot fund a
  // full rebuild alone, tying the harvest model back to DONE #4.
  const node = { x: 4, z: 4, amount: config.BUILD.woodPerWaveEstimate };
  let total = 0;
  for (let i = 0; i < 20; i++) total += harvestFrom(node, 8);
  assert.equal(total, config.BUILD.woodPerWaveEstimate, 'you can extract exactly the node stock, no more');
  assert.equal(node.remaining, 0, 'node is fully depleted');
  assert.ok(total < fullRebuildCost(), 'a whole wave of wood alone is short of a full barrier');
  // Harvesting an empty node grants nothing (no negative / no free materials).
  assert.equal(harvestFrom(node, 8), 0);
});

test('aabbList mirrors only alive barriers with correct extents', () => {
  const b = makeBarrier(7, 2, 3, 'x');
  const list = aabbList([b]);
  assert.equal(list.length, 1);
  assert.deepEqual(list[0], { id: 7, minx: b.minx, minz: b.minz, maxx: b.maxx, maxz: b.maxz });
  b.alive = false;
  assert.equal(aabbList([b]).length, 0);
});
