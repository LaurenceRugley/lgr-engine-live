/* ============================================================
   hoard2 · src/sim/civilians.js — the civilian population + SEIR infection step (THREE-free, node-testable).
   ------------------------------------------------------------
   OUTBREAK Phase 1 (docs/design/research-agents-gameplay.md §3/§7): agent-based SEIR mapped onto what the
   game already has —
     S (susceptible)  = these civilians, wandering/idling the arena, FLEEING the horde;
     E (exposed)      = bitten + incubating: they stagger and (the mirror's job) tint-shift across the
                        incubation window, so every impending turn is TELEGRAPHED, never a pop;
     I (infectious)   = the existing zombie pool (zombies.js — untouched; a turn calls its spawnAt);
     R (removed)      = the existing corpse pool (fx — already books every zombie:death).

   Mirrors zombies.js's shape deliberately: a FIXED pool of config.CIVS.count records (recycled by index,
   zero per-frame allocation, 1:1 with a render horde), pure numbers only — the render mirror lives in
   index.js. Same determinism doctrine: the ONLY randomness (scatter, wander targets, transmission rolls,
   incubation durations) is off the injected sim stream (rng.fork('sim')); the step itself is pure math.

   THE FLEE FIELD (the one engine-core seam this arc added): index.js hands step() a flow field solved
   MULTI-SOURCE from every live zombie — `field.costAt(x,z)` is therefore "grid steps to the NEAREST
   infectious". Civilians ASCEND that field (walk to the highest-cost open neighbour), which is flight
   from ALL threats at once, streaming around trees/barriers because blocked cells never score.

   CONTACT IS PRICED OFF THE SAME FIELD (no second broadphase): a bite needs an exact circle test, but it
   only runs for civilians whose flee-field cost ≤ CIVS.contactCells — the multi-source flood doubles as
   the proximity prefilter. Physical separation reuses the field's spatial hash too: ONE combined
   civ+zombie list per step (civilians read their prefix of the push; the zombie sim's own separate() call
   is untouched, so the existing zombie trace is unmoved).

   C++ anchor: same object-pool-of-PODs as zombies.js; the SEIR state is an enum + two floats (incubT,
   incubDur) per record — an agent-based epidemic sim is just a state machine over a broadphase.
   ============================================================ */

// 8-neighbour offsets with pre-normalized directions (diagonals × 1/√2) — the flee step samples the
// field one cell out in each of these and climbs. Kept in lockstep with createFlowField's NEI table.
const INV_SQRT2 = 0.7071067811865476;
const NEI8 = [
  { dx:  1, dz:  0, nx:  1,          nz:  0 },
  { dx: -1, dz:  0, nx: -1,          nz:  0 },
  { dx:  0, dz:  1, nx:  0,          nz:  1 },
  { dx:  0, dz: -1, nx:  0,          nz: -1 },
  { dx:  1, dz:  1, nx:  INV_SQRT2,  nz:  INV_SQRT2 },
  { dx:  1, dz: -1, nx:  INV_SQRT2,  nz: -INV_SQRT2 },
  { dx: -1, dz:  1, nx: -INV_SQRT2,  nz:  INV_SQRT2 },
  { dx: -1, dz: -1, nx: -INV_SQRT2,  nz: -INV_SQRT2 },
];
const SAFE = 1e9; // safety score for a cell the threat flood never reached (no zombie can path there)

export function createCivilianPool(config, srng, opts = {}) {
  const C = config.CIVS;
  const MAXC = (opts.cap != null && opts.cap >= 0) ? opts.cap : C.count; // cap 0 = a legal A/B arm (no civilians)
  // ?noflee=1 A/B lever (index.js wires it): with flee OFF civilians keep wandering through the horde —
  // the measurement control for "flee actually flees" (mean distance-to-infection must beat this arm).
  const fleeOn = opts.flee !== false;

  const cs = [];
  for (let i = 0; i < MAXC; i++) {
    cs.push({ id: i, x: 0, z: 0, vx: 0, vz: 0, alive: false, state: 's',
      incubT: 0, incubDur: 0, fleeing: false, idleT: 0, wx: 0, wz: 0, forceBite: false });
  }
  let sCount = 0, eCount = 0;

  // Hoisted step scratch (no per-frame alloc): the combined civ+zombie compact list for the shared
  // separation hash, and the push buffer sized for both pools (opts.sepCap = zombie pool max).
  const sepCap = MAXC + (opts.sepCap || 0);
  const _agents = new Array(sepCap);
  const _push = new Float32Array(sepCap * 2);
  const _des = { x: 0, z: 0 };

  /* ---- populate: deterministic scatter inside the play disc (called once, after the field exists) ---- */
  function populate(field, cx = 0, cz = 0) {
    for (let i = 0; i < MAXC; i++) {
      const c = cs[i];
      let x = cx, z = cz;
      for (let t = 0; t < 20; t++) { // rejection-sample off blocked cells (trees/ruins); accept the last try
        const ang = srng.range(0, Math.PI * 2);
        const rad = Math.sqrt(srng()) * C.populateRadius; // sqrt → area-uniform over the disc
        x = cx + Math.cos(ang) * rad; z = cz + Math.sin(ang) * rad;
        if (!field || !field.isBlocked(x, z)) break;
      }
      c.x = x; c.z = z; c.vx = 0; c.vz = 0;
      c.alive = true; c.state = 's'; c.incubT = 0; c.incubDur = 0;
      c.fleeing = false; c.forceBite = false;
      c.idleT = srng.range(0, C.wanderIdleS[1]); // desynced first dwell so the crowd doesn't move in lockstep
      pickWander(c, field);
    }
    sCount = MAXC; eCount = 0;
  }

  function pickWander(c, field) {
    for (let t = 0; t < 8; t++) {
      const ang = srng.range(0, Math.PI * 2);
      const r = srng.range(1, C.wanderRadius);
      let wx = c.x + Math.cos(ang) * r, wz = c.z + Math.sin(ang) * r;
      const d = Math.hypot(wx, wz);
      if (d > C.populateRadius) { wx *= C.populateRadius / d; wz *= C.populateRadius / d; } // stay in the peopled disc
      c.wx = wx; c.wz = wz;
      if (!field || !field.isBlocked(wx, wz)) return;
    }
  }

  /* ---- flee steering: climb the multi-source threat field (highest-cost open neighbour wins) ---- */
  function fleeInto(field, c, out) {
    out.x = 0; out.z = 0;
    if (!field) return out;
    const cell = field.cellSize;
    const here = field.costAt(c.x, c.z);
    const hereSafety = here < 0 ? SAFE : here;
    let bestSafety = -1, bestAlign = -Infinity, bnx = 0, bnz = 0;
    for (let n = 0; n < 8; n++) {
      const o = NEI8[n];
      const nx = c.x + o.dx * cell, nz = c.z + o.dz * cell;
      if (field.isBlocked(nx, nz)) continue;
      const nc = field.costAt(nx, nz);
      const safety = nc < 0 ? SAFE : nc; // unreached by ANY threat = safest
      const align = c.vx * o.nx + c.vz * o.nz; // tie-break: keep the direction we already have (no zigzag)
      if (safety > bestSafety || (safety === bestSafety && align > bestAlign)) {
        bestSafety = safety; bestAlign = align; bnx = o.nx; bnz = o.nz;
      }
    }
    if (bestSafety < hereSafety) return out; // already at the local safety max → hold ground
    out.x = bnx; out.z = bnz;
    return out;
  }

  /* ---- barrier clamp (same rule as zombies.js — a step into a barrier AABB is refused) ---- */
  function pointInAabb(b, x, z, m) {
    return x >= b.minx - m && x <= b.maxx + m && z >= b.minz - m && z <= b.maxz + m;
  }
  function firstAabbHit(aabbs, x, z, m) {
    for (let i = 0; i < aabbs.length; i++) if (pointInAabb(aabbs[i], x, z, m)) return aabbs[i];
    return null;
  }

  /* The per-frame step. s = {
       field (the MULTI-SOURCE flee field — cost = grid distance to the nearest live zombie),
       zpool (the zombie pool, for the exact bite circle), threatCount (live zombies — 0 skips all threat work),
       aabbs|null, onBite(c)|null, onTurn(c)->bool|null (false = zombie pool saturated, retry next tick)
     }. Zero allocation. */
  function step(dt, s) {
    if (dt <= 0) return;
    const field = s.field, zpool = s.zpool, aabbs = s.aabbs;
    const threats = s.threatCount | 0;

    // ONE combined compact list (civs first, zombies appended) so the field's spatial hash separates
    // civ↔civ AND civ↔zombie in a single build. Only the civilian prefix's push entries are read.
    let nc = 0;
    for (let i = 0; i < MAXC; i++) { const c = cs[i]; if (c.alive) _agents[nc++] = c; }
    if (nc === 0) return;
    let na = nc;
    if (field && zpool) for (let i = 0; i < zpool.max && na < sepCap; i++) { const z = zpool.get(i); if (z.alive) _agents[na++] = z; }
    if (field) field.separate(_agents, na, _push, { radius: 0.7, maxNeighbors: 6 });

    const zk = 1 - Math.exp(-6 * dt); // same velocity smoothing constant as the zombie step
    for (let k = 0; k < nc; k++) {
      const c = _agents[k];
      // Threat distance in grid cells (multi-source BFS from every live zombie); −1 = unreachable = safe.
      const tcost = (field && threats > 0) ? field.costAt(c.x, c.z) : -1;

      let desX = 0, desZ = 0;

      if (c.state === 'e') {
        // INCUBATING — the telegraph window. The gait drops to a stagger; the mirror ramps the tint off
        // incubT/incubDur. At the end of the window the victim TURNS: a zombie rises where it fell.
        c.incubT += dt;
        if (c.incubT >= c.incubDur) {
          if (s.onTurn && s.onTurn(c)) { c.alive = false; eCount--; continue; }
          c.incubT = c.incubDur; // zombie pool saturated → hold at the threshold, retry next tick
        }
        fleeInto(field, c, _des);
        desX = _des.x * C.staggerSpeed; desZ = _des.z * C.staggerSpeed;
      } else {
        // BITE — the exact circle test runs ONLY inside the flee-field prefilter (contactCells covers
        // biteRadius + one fleeResolveS of runner drift, so staleness can't hide a contact).
        if (c.forceBite || (zpool && tcost >= 0 && tcost <= C.contactCells)) {
          let bit = c.forceBite;
          if (!bit) {
            const r2 = C.biteRadius * C.biteRadius;
            for (let i = 0; i < zpool.max; i++) {
              const z = zpool.get(i); if (!z.alive) continue;
              const dx = z.x - c.x, dz = z.z - c.z;
              if (dx * dx + dz * dz <= r2) { bit = srng.chance(Math.min(1, C.pTransmitPerSec * dt)); break; }
            }
          }
          if (bit) {
            c.forceBite = false;
            c.state = 'e'; c.incubT = 0;
            c.incubDur = srng.range(C.incubationS[0], C.incubationS[1]); // THE PACING LEVER, per victim
            sCount--; eCount++;
            if (s.onBite) s.onBite(c);
          }
        }
        if (c.state === 's') {
          // FLEE with hysteresis (panic inside panicCells, calm only past calmCells — no boundary flicker).
          const trigger = c.fleeing ? C.calmCells : C.panicCells;
          if (fleeOn && tcost >= 0 && tcost <= trigger) {
            c.fleeing = true;
            fleeInto(field, c, _des);
            desX = _des.x * C.fleeSpeed; desZ = _des.z * C.fleeSpeed;
          } else {
            c.fleeing = false;
            // WANDER / IDLE — the ambient theater between scares.
            if (c.idleT > 0) c.idleT -= dt;
            else {
              const dx = c.wx - c.x, dz = c.wz - c.z, d = Math.hypot(dx, dz);
              if (d < 0.4) { c.idleT = srng.range(C.wanderIdleS[0], C.wanderIdleS[1]); pickWander(c, field); }
              else if (field && field.isBlocked(c.x + (dx / d) * 0.5, c.z + (dz / d) * 0.5)) pickWander(c, field);
              else { desX = (dx / d) * C.walkSpeed; desZ = (dz / d) * C.walkSpeed; }
            }
          }
        }
      }

      c.vx += (desX - c.vx) * zk; c.vz += (desZ - c.vz) * zk;
      c.vx += _push[k * 2] * 0.9; c.vz += _push[k * 2 + 1] * 0.9; // shared-hash anti-overlap (civ + zombie)

      let nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
      if (aabbs && aabbs.length) {
        const hit = firstAabbHit(aabbs, nx, nz, 0.2);
        if (hit) { nx = c.x; nz = c.z; } // a civilian doesn't gnaw the wall — just stops
      }
      // Keep the crowd on the field: a flee past the play rim slides along it instead of leaving.
      const d0 = Math.hypot(nx, nz), lim = config.PLAY_RADIUS;
      if (d0 > lim) { nx *= lim / d0; nz *= lim / d0; }
      c.x = nx; c.z = nz;
    }
  }

  // The zombie step's OPPORTUNISM query (zombies.js): the nearest live SUSCEPTIBLE within r of (x,z),
  // else null. Exposed victims don't attract (they're already claimed — and chasing them would drag the
  // teller off the telegraph). Pure scan, no rolls, deterministic; O(pool) with small constants.
  function nearestS(x, z, r) {
    let best = null, bd = r * r;
    for (let i = 0; i < MAXC; i++) {
      const c = cs[i];
      if (!c.alive || c.state !== 's') continue;
      const dx = c.x - x, dz = c.z - z, d2 = dx * dx + dz * dz;
      if (d2 <= bd) { bd = d2; best = c; }
    }
    return best;
  }

  // Probe hook (ctx.probe.infect): force-bite the n live susceptibles NEAREST (px,pz) THROUGH the real
  // bite path (the flag is consumed by step(), which rolls the incubation and fires onBite like any
  // street bite). Nearest-first so a scripted patient zero lands ON CAMERA — the telegraph capture's
  // whole reason to exist. Deterministic: pure distance scan, no rolls.
  function forceExpose(n = 1, px = 0, pz = 0) {
    let done = 0;
    for (let k = 0; k < n; k++) {
      let best = null, bd = Infinity;
      for (let i = 0; i < MAXC; i++) {
        const c = cs[i];
        if (!c.alive || c.state !== 's' || c.forceBite) continue;
        const dx = c.x - px, dz = c.z - pz, d2 = dx * dx + dz * dz;
        if (d2 < bd) { bd = d2; best = c; }
      }
      if (!best) break;
      best.forceBite = true; done++;
    }
    return done;
  }

  function reset() { for (let i = 0; i < MAXC; i++) cs[i].alive = false; sCount = 0; eCount = 0; }
  function forEach(cb) { for (let i = 0; i < MAXC; i++) cb(i, cs[i]); }

  return {
    populate, step, forceExpose, nearestS, reset, forEach,
    get(i) { return cs[i]; },
    get max() { return MAXC; },
    get alive() { return sCount + eCount; },
    get sCount() { return sCount; },
    get eCount() { return eCount; },
  };
}
