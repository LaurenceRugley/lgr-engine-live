/* ============================================================
   hoard2 · src/build/barrier-core.js — PURE fortification logic (zero THREE, zero DOM).
   ------------------------------------------------------------
   The geometry + economy + HP model of fortification, split out from index.js so it is
   node-testable WITHOUT importing the engine barrel (which re-exports .frag/.vert shaders and
   kills a node import — see rng.js's note). index.js does the THREE meshes + ctx wiring; every
   number and every decision that a DONE criterion rests on lives HERE and is unit-tested.

   Three pillars:
     • ECONOMY  — a full barrier rebuild costs 30 wood + 20 scrap; DONE #4 requires that neither
                  single source (wood-from-forest OR scrap-from-ruins/drops) funds a full rebuild
                  in one wave, so BOTH matter. The numbers are READ from core/config.js (pinned by
                  the lead), never redefined here.
     • HP MODEL — place → damage → breach (hp≤0, AABB removed so the field/walker re-path) →
                  repair (repair-kit restores hp, revives the blocker).
     • GEOMETRY — a barrier is an axis-aligned box (a wall of length×thickness×height). aabbList()
                  feeds sim's flow field + player's walker; castSegment() is the ballistics
                  SEGMENT test folded into castWorld — a slab test against a STATIC box, NEVER a
                  rebuilt grid of dynamic actors (createBallistics' FORBIDDEN note).

   C++ anchor: a header-only value type + free functions over plain structs — no vtables, no
   engine handles; the renderer layer (index.js) owns the GPU-side mesh mirror.
   ============================================================ */
import * as config from '../core/config.js';

// Wall dimensions are GEOMETRY/feel (not balance) — the pinned balance knobs are hp + costs in
// config.BUILD. A wall is `length` long, `thickness` deep, `height` tall (blocks shots up to its top).
export const WALL = Object.freeze({ length: 3.0, thickness: 0.5, height: 1.4 });

// Per-harvest-action grant sizes (feel, not pinned). Tuned so a few actions per wave approach the
// pinned per-wave estimates without a single action overshooting them (DONE #4 "both matter").
export const HARVEST = Object.freeze({ woodPerAction: 8, scrapPerAction: 6, dropScrap: 4 });

// The cost of ONE barrier, read from the pinned config (30 wood + 20 scrap = 50 total).
export const BARRIER_COST = Object.freeze({
  wood: config.BUILD.barrierCostWood,
  scrap: config.BUILD.barrierCostScrap,
});

// Total material a full rebuild burns — the number DONE #4 compares against each single source.
export function fullRebuildCost() {
  return BARRIER_COST.wood + BARRIER_COST.scrap;
}

// canAfford requires BOTH resources — you cannot substitute wood for scrap. This is why both
// sources must matter: a pile of only-wood or only-scrap never places a barrier.
export function canAfford(stock) {
  return stock.wood >= BARRIER_COST.wood && stock.scrap >= BARRIER_COST.scrap;
}

// The single-source-can't-fund invariant, expressed as code the test pins (DONE #4). A wave's max
// yield of ONE source (its pinned estimate) is strictly below a full rebuild's total cost.
export function singleSourceFundsRebuild(perWaveEstimate) {
  return perWaveEstimate >= fullRebuildCost();
}

/* ---- GEOMETRY ---- */
// A barrier's world-space AABB. dir 'x' = the wall runs along the X axis (long in x, thin in z);
// dir 'z' = long in z, thin in x. Axis-aligned either way, so aabbs() stays a true AABB list.
export function barrierBox(cx, cz, dir) {
  const halfLen = WALL.length / 2;
  const halfThick = WALL.thickness / 2;
  const hx = dir === 'z' ? halfThick : halfLen;
  const hz = dir === 'z' ? halfLen : halfThick;
  return {
    minx: cx - hx, maxx: cx + hx,
    minz: cz - hz, maxz: cz + hz,
    miny: config.GROUND_Y, maxy: config.GROUND_Y + WALL.height,
  };
}

// A barrier record: identity + pose + HP + its cached box. Plain data (structuredClone-safe).
export function makeBarrier(id, cx, cz, dir = 'x') {
  const box = barrierBox(cx, cz, dir);
  return {
    id, cx, cz, dir,
    hpMax: config.BUILD.barrierHpMax,
    hp: config.BUILD.barrierHpMax,
    alive: true,
    ...box,
  };
}

// Apply damage. Returns TRUE exactly on the transition into breach (hp crossing to ≤0 while alive),
// so the caller emits `barrier:breach` once, not every subsequent hit on a dead wall.
export function damageBarrier(b, amount) {
  if (!b.alive) return false;
  b.hp = Math.max(0, b.hp - amount);
  if (b.hp <= 0) { b.alive = false; return true; }
  return false;
}

// Repair restores hp (clamped to max) and revives the blocker if it had been breached.
export function repairBarrier(b, amount) {
  b.hp = Math.min(b.hpMax, b.hp + amount);
  b.alive = b.hp > 0;
}

// The blocker list for sim's field + player's walker — ALIVE barriers only. A breached wall is
// absent so both re-path THROUGH the gap (the whole point of a breach).
export function aabbList(barriers) {
  const out = [];
  for (const b of barriers) {
    if (b.alive) out.push({ id: b.id, minx: b.minx, minz: b.minz, maxx: b.maxx, maxz: b.maxz });
  }
  return out;
}

// Slab test: does segment o→e hit this box? Returns { t, point, normal } (entry face) or null.
// Standard branchless-ish slab method; the entry axis gives the surface normal (pointing back
// toward the ray origin). y is included so a shot can clear the wall's top instead of always
// clipping it — the wall really is a 3D box, not an infinite curtain.
function slabHit(o, e, box) {
  const dx = e.x - o.x, dy = e.y - o.y, dz = e.z - o.z;
  const lo = { x: box.minx, y: box.miny, z: box.minz };
  const hi = { x: box.maxx, y: box.maxy, z: box.maxz };
  const d = { x: dx, y: dy, z: dz };
  const O = { x: o.x, y: o.y, z: o.z };
  let tmin = 0, tmax = 1, axis = null, sign = 0;
  for (const a of ['x', 'y', 'z']) {
    if (Math.abs(d[a]) < 1e-9) {
      if (O[a] < lo[a] || O[a] > hi[a]) return null; // parallel to slab AND outside it → no hit
      continue;
    }
    const inv = 1 / d[a];
    const t1 = (lo[a] - O[a]) * inv;
    const t2 = (hi[a] - O[a]) * inv;
    const tnear = Math.min(t1, t2);
    const tfar = Math.max(t1, t2);
    if (tnear > tmin) { tmin = tnear; axis = a; sign = d[a] > 0 ? -1 : 1; }
    if (tfar < tmax) tmax = tfar;
    if (tmin > tmax) return null;
  }
  const point = { x: O.x + dx * tmin, y: O.y + dy * tmin, z: O.z + dz * tmin };
  const normal = { x: 0, y: 0, z: 0 };
  if (axis) normal[axis] = sign;
  return { t: tmin, point, normal };
}

// castSegment(barriers, o, e): the nearest ALIVE barrier hit for the player's castWorld, or null.
// Iterates the (small, player-placed) barrier set — a segment test, never a rasterized grid.
export function castSegment(barriers, o, e) {
  let best = null;
  for (const b of barriers) {
    if (!b.alive) continue;
    const h = slabHit(o, e, b);
    if (h && (best === null || h.t < best.t)) best = { point: h.point, normal: h.normal, id: b.id, t: h.t };
  }
  return best;
}

/* ---- proximity helpers (probe/harvest targeting) ---- */
export function nearest(items, x, z) {
  let best = null, bestD = Infinity;
  for (const it of items) {
    const dx = it.cx !== undefined ? it.cx - x : it.x - x;
    const dz = it.cz !== undefined ? it.cz - z : it.z - z;
    const d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = it; }
  }
  return best;
}

// Grant up to `want` from a node's remaining amount; mutates node.remaining, returns granted (≥0).
export function harvestFrom(node, want) {
  const rem = node.remaining ?? node.amount ?? 0;
  const got = Math.max(0, Math.min(rem, want));
  node.remaining = rem - got;
  return got;
}

/* ---- the barrier field: the mutable collection index.js drives and the test exercises ---- */
export function createBarrierField() {
  const barriers = [];
  let nextId = 1;

  function place(cx, cz, dir = 'x') {
    const b = makeBarrier(nextId++, cx, cz, dir);
    barriers.push(b);
    return b;
  }
  const getById = (id) => barriers.find((b) => b.id === id) || null;
  const nearestBarrier = (x, z) => nearest(barriers.filter((b) => b.alive), x, z);
  const mostDamaged = () => {
    let w = null;
    for (const b of barriers) if (b.hp < b.hpMax && (w === null || b.hp < w.hp)) w = b;
    return w;
  };

  return {
    barriers,
    place,
    getById,
    nearestBarrier,
    mostDamaged,
    hit: (id, amount) => { const b = getById(id); return b ? { b, breached: damageBarrier(b, amount) } : null; },
    repair: (id, amount) => { const b = getById(id); if (b) repairBarrier(b, amount); return b; },
    aabbs: () => aabbList(barriers),
    cast: (o, e) => castSegment(barriers, o, e),
  };
}
