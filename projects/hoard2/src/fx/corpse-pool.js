/* ============================================================
   hoard2 · src/fx/corpse-pool.js — the CORPSE POOL bookkeeping (PURE, no THREE, node-tested).
   ------------------------------------------------------------
   DONE #5: "hits leave decals; kills leave corpses that persist ≥10s or to pool cap — no vanishing."
   HOARD-CONTRACT §Game-layer builds pins the corpse pool as a SECOND small createCharacterHorde over the
   zombie rig, slots pinned to the death state, fed by `zombie:death`. This file is the *math* half of that
   — a fixed-size slot pool with two recycle rules — kept free of THREE so it is node-testable in CI (the
   engine barrel pulls shaders and dies under `node --test`; the THREE glue lives in index.js).

   TWO RECYCLE RULES (both are "no vanishing" — a corpse never blinks out the instant it dies):
     1. AGE floor — a corpse persists AT LEAST `ttl` seconds (CORPSE_TTL_S ≥ 10). update(now) frees a slot
        only once `now - born >= ttl`. So a corpse is guaranteed on-screen for the whole floor window.
     2. CAP ceiling — when all `cap` slots are active (CORPSE_CAP) and a new death arrives, the OLDEST
        corpse's slot is recycled to make room (oldest = smallest spawn sequence). The pool never grows
        past `cap`, and eviction is deterministic oldest-first (not random, not newest).

   `seq` is a monotonic spawn counter — since it only ever increases, the smallest live `seq` is exactly
   the oldest live corpse, so eviction ordering is unambiguous even when several deaths share one frame's
   timestamp. `born` (wall-clock seconds) drives the TTL floor; `seq` drives eviction order.

   C++ anchor: a fixed object pool of POD structs — allocate `cap` up front, hand out slots by index, and
   free by two policies (a TTL sweep + an LRU-style oldest-eviction). Zero allocation after construction;
   spawn/update mutate the pre-built slot array in place (engine-invariants #7 — no per-frame heap).
   ============================================================ */

export function createCorpsePool({ cap, ttl }) {
  if (!(cap > 0)) throw new Error('[corpse-pool] cap must be > 0');
  if (!(ttl >= 0)) throw new Error('[corpse-pool] ttl must be >= 0');

  // Pre-allocate every slot once. A slot is reused by index; nothing is ever new/deleted after this.
  const slots = new Array(cap);
  for (let i = 0; i < cap; i++) slots[i] = { active: false, born: 0, seq: 0, x: 0, y: 0, z: 0, yaw: 0, type: null };
  let seqCounter = 0;

  // The OLDEST active slot = the smallest live seq (seq is monotonic with spawn order).
  function oldestActive() {
    let best = -1, bestSeq = Infinity;
    for (let i = 0; i < cap; i++) {
      const s = slots[i];
      if (s.active && s.seq < bestSeq) { bestSeq = s.seq; best = i; }
    }
    return best;
  }

  /* spawn(data, now): activate a corpse. Uses a FREE slot if one exists, else evicts the OLDEST (cap rule).
     Returns { index, evicted } — index = the slot now holding the corpse; evicted = the slot that was
     recycled to make room (-1 when a free slot was used). The THREE glue reads `index` to place/repose the
     character and (on eviction) knows that slot's previous corpse is gone. */
  function spawn(data, now) {
    let idx = -1, evicted = -1;
    for (let i = 0; i < cap; i++) if (!slots[i].active) { idx = i; break; }
    if (idx < 0) { idx = oldestActive(); evicted = idx; }   // full → recycle oldest (never grow past cap)
    const s = slots[idx];
    s.active = true; s.born = now; s.seq = seqCounter++;
    s.x = data.x; s.y = data.y; s.z = data.z; s.yaw = data.yaw; s.type = data.type;
    return { index: idx, evicted };
  }

  /* update(now, onRecycle): the TTL sweep. Frees every slot that has persisted at least `ttl` seconds.
     onRecycle(i) fires per freed slot so the glue can hide that character. No allocation. */
  function update(now, onRecycle) {
    for (let i = 0; i < cap; i++) {
      const s = slots[i];
      if (s.active && now - s.born >= ttl) {
        s.active = false; s.type = null;
        if (onRecycle) onRecycle(i);
      }
    }
  }

  function forEachActive(cb) { for (let i = 0; i < cap; i++) if (slots[i].active) cb(i, slots[i]); }
  function countActive() { let n = 0; for (let i = 0; i < cap; i++) if (slots[i].active) n++; return n; }

  return {
    spawn, update, forEachActive, countActive,
    get(i) { return slots[i]; },
    get cap() { return cap; },
    get ttl() { return ttl; },
  };
}
