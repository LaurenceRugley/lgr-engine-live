/* ============================================================
   hoard2 · src/fx/corpse-pool.test.mjs — DONE #5 corpse-persistence bookkeeping (Rule 9: intent, not "runs").
   ------------------------------------------------------------
   These tests encode WHY the corpse pool exists: "kills leave corpses that persist ≥10s or to pool cap — no
   vanishing" (docs/hoard-oneshot-prompt DONE #5). They pin the two behaviours the DONE rests on and would
   FAIL if either regressed:
     · the TTL FLOOR — a corpse is guaranteed alive for at least CORPSE_TTL_S (it never vanishes on death).
     · the CAP CEILING — at CORPSE_CAP the pool recycles the OLDEST corpse (deterministic, oldest-first) and
       never grows past the cap.
   Pure math + a fake clock — no THREE, no engine barrel (which dies under `node --test`).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createCorpsePool } from './corpse-pool.js';

const corpse = (x = 0, z = 0, type = 'walker') => ({ x, y: 0.3, z, yaw: 0, type });

test('TTL floor — a corpse persists for at least ttl seconds, then recycles (never vanishes on death)', () => {
  const ttl = 14;
  const pool = createCorpsePool({ cap: 4, ttl });
  pool.spawn(corpse(), 0);
  assert.equal(pool.countActive(), 1, 'corpse is live the instant it spawns');

  // Sweep repeatedly right up to just under the floor — it must STILL be alive (no early vanish).
  for (let t = 1; t < ttl; t++) pool.update(t);
  pool.update(ttl - 0.001);
  assert.equal(pool.countActive(), 1, `corpse must persist the full ${ttl}s floor (DONE #5 "persist ≥10s")`);

  // At/after the floor it is eligible to be recycled so slots free up (not lingering forever).
  pool.update(ttl);
  assert.equal(pool.countActive(), 0, 'corpse recycles once it has outlived the TTL floor');
});

test('cap ceiling — at CORPSE_CAP a new death evicts the OLDEST corpse, pool never exceeds cap', () => {
  const cap = 3;
  const pool = createCorpsePool({ cap, ttl: 1000 });   // huge ttl so only the CAP rule can recycle here
  const a = pool.spawn(corpse(1), 0).index;
  const b = pool.spawn(corpse(2), 1).index;
  const c = pool.spawn(corpse(3), 2).index;
  assert.equal(pool.countActive(), 3, 'pool filled to cap');
  assert.notEqual(a, b); assert.notEqual(b, c); assert.notEqual(a, c);

  // A fourth death with the pool full → evict the OLDEST (slot a), reuse its slot, stay capped.
  const r = pool.spawn(corpse(4), 3);
  assert.equal(pool.countActive(), cap, 'pool never grows past CORPSE_CAP');
  assert.equal(r.evicted, a, 'the OLDEST corpse is the one evicted (deterministic oldest-first, not random)');
  assert.equal(r.index, a, 'the evicted slot is reused for the new corpse');

  // The newer two (b, c) must be untouched — only the oldest went.
  assert.equal(pool.get(b).active, true, 'the 2nd corpse survives the eviction');
  assert.equal(pool.get(c).active, true, 'the 3rd corpse survives the eviction');

  // And the NEXT eviction takes what is now the oldest live corpse (b), proving the ordering advances.
  const r2 = pool.spawn(corpse(5), 4);
  assert.equal(r2.evicted, b, 'the next eviction takes the now-oldest live corpse');
});

test('free slots are used before any eviction (cap only bites when full)', () => {
  const pool = createCorpsePool({ cap: 4, ttl: 1000 });
  const r0 = pool.spawn(corpse(), 0);
  const r1 = pool.spawn(corpse(), 1);
  assert.equal(r0.evicted, -1, 'a free slot never reports an eviction');
  assert.equal(r1.evicted, -1);
  assert.equal(pool.countActive(), 2);
});

test('the corpse payload (position/yaw/type) is stored on the activated slot', () => {
  const pool = createCorpsePool({ cap: 2, ttl: 10 });
  const { index } = pool.spawn({ x: 5, y: 0.3, z: -7, yaw: 1.23, type: 'tank' }, 0);
  const s = pool.get(index);
  assert.deepEqual([s.x, s.y, s.z, s.yaw, s.type], [5, 0.3, -7, 1.23, 'tank']);
});
