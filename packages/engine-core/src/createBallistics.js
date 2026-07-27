/* ============================================================
   @lgr/engine-core — createBallistics (Lesson M4: projectile simulation).
   ------------------------------------------------------------
   THE ABILITY: real projectiles — pooled, with velocity + gravity DROP, swept per step so a fast bullet
   can't tunnel through a thin target between frames. The module owns the SIMULATION (integrate, sweep,
   resolve nearest hit, report) but knows NOTHING about the world it flies through: the game INJECTS the
   collision queries as callbacks. That injection is the whole design — the engine ships the ballistics
   maths once, and every game/map supplies its own "what does this segment hit?" without the module ever
   depending on a particular collision system.

   WHY (settled in the brief): the Hoard's v1 gun is an angular-corridor HITSCAN (`hoard.js:264-289`,
   GUN_RANGE 9 / GUN_TOL 0.7) — an instant ray, no travel time, no drop. The owner's design calls for
   projectile weapons; the FELT difference is travel time + the arc: near targets are flat, far targets
   drop, and a bullet can be blocked by a tree it passes behind.

   ── THE INJECTED CAST SEAM (refuter-corrected — NOT collide.js). collide.js's `segmentHit` sweeps only
      the STATIC city AABB world and returns just a scalar t (no point, no normal, no target), and on the
      forest map there is no collider world at all (trees are game-side circles, zombies are pooled plain
      objects). So the game supplies two queries, each returning a rich hit record or null:
        • castWorld(ox,oy,oz, ex,ey,ez) -> { t, point:{x,y,z}, normal:{x,y,z} } | null
            static geometry along the segment (forest: circle/cylinder trees + ground; city later: wrap
            segmentHit and derive a point/normal). `t` is the fraction [0,1] along origin→end.
        • castTargets(ox,oy,oz, ex,ey,ez) -> { t, target, point:{x,y,z} } | null
            dynamic actors along the segment (the live zombies). `target` is whatever the game wants back.
      Per step the module sweeps BOTH and resolves the NEAREST (smaller t), then emits
      onHit({ point, normal, target, meta }) + onExpire(meta). This is dependency INVERSION (C++: a functor
      /std::function the algorithm calls — the algorithm owns control flow, the caller owns the predicate).

   ── FORBIDDEN wrong path (brief): do NOT register the zombies into a static collider grid with a
      per-frame rebuild(). Dynamic actors are a per-step QUERY (castTargets), never a rebuilt static world.

   ── speed:Infinity → a single full-length sweep this step = hitscan-CLASS behaviour (proves the same
      module still covers instant fire). The exact v1 corridor-aim feel is NOT a goal; v1 stays reachable
      via git + the game's ?gun flag.

   ── ZERO PER-FRAME ALLOCATION. The pool is Structure-of-Arrays typed buffers (C++ anchor: SoA — parallel
      float arrays indexed by slot, cache-friendly, not an array of heap objects). update() does no `new`,
      no array literals, no closures — the hit record handed to onHit is a single reused object; the game
      must read it synchronously (like the engine's other `_scratch` returns).

   Contract: createBallistics(opts) -> {
     fire(ox,oy,oz, dx,dy,dz, speed, meta) -> boolean,   // false if the pool is full
     update(dt),
     liveCount, maxLive,
     px,py,pz, vx,vy,vz, alive,                          // pool buffers (game reads them to draw tracers)
     dispose(),
   }
   ============================================================ */

export function createBallistics(opts = {}) {
  const gravity = opts.gravity != null ? opts.gravity : 9.8;   // downward accel on +y (units/s²); 0 = flat
  const maxLive = opts.maxLive || 64;
  const maxLife = opts.maxLife != null ? opts.maxLife : 3;     // seconds before a miss expires
  const hitscanRange = opts.hitscanRange || 200;               // segment length for a speed:Infinity shot
  const expireBelowY = opts.expireBelowY != null ? opts.expireBelowY : -50;  // backstop for a dropped miss
  const castWorld = opts.castWorld || null;
  const castTargets = opts.castTargets || null;
  const onHit = opts.onHit || null;
  const onExpire = opts.onExpire || null;

  // ---- POOL (SoA, preallocated once) ----
  const px = new Float32Array(maxLive), py = new Float32Array(maxLive), pz = new Float32Array(maxLive);
  const vx = new Float32Array(maxLive), vy = new Float32Array(maxLive), vz = new Float32Array(maxLive);
  const life = new Float32Array(maxLive);
  const alive = new Uint8Array(maxLive);
  const hitscan = new Uint8Array(maxLive);
  const meta = new Array(maxLive).fill(null);   // per-slot game token (a number/damage or a reused object)
  let liveCount = 0;

  // ---- reused hit record handed to onHit (zero-alloc; the game reads it synchronously) ----
  const _hit = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, target: null, meta: null };

  function freeIndex() { for (let i = 0; i < maxLive; i++) if (!alive[i]) return i; return -1; }

  // Fire a projectile from (ox,oy,oz) along (dx,dy,dz) at `speed` units/s. speed:Infinity → hitscan sweep.
  // Returns false if the pool is exhausted (the game can choose to ignore or throttle its fire rate).
  function fire(ox, oy, oz, dx, dy, dz, speed, m) {
    const i = freeIndex();
    if (i < 0) return false;
    const dl = Math.hypot(dx, dy, dz) || 1;
    const nx = dx / dl, ny = dy / dl, nz = dz / dl;      // normalized direction
    px[i] = ox; py[i] = oy; pz[i] = oz;
    if (!Number.isFinite(speed)) {                        // hitscan: store the DIRECTION in v*, flag it
      hitscan[i] = 1; vx[i] = nx; vy[i] = ny; vz[i] = nz;
    } else {
      hitscan[i] = 0; vx[i] = nx * speed; vy[i] = ny * speed; vz[i] = nz * speed;
    }
    life[i] = maxLife; alive[i] = 1; meta[i] = m != null ? m : null;
    liveCount++;
    return true;
  }

  function freeSlot(i) { alive[i] = 0; meta[i] = null; liveCount--; }

  // Resolve one swept segment (origin→end). Fills + fires onHit for the nearest of world/target. Returns
  // true if the projectile was consumed (a hit, or a hitscan that always resolves this step).
  function resolveSegment(i, ox, oy, oz, ex, ey, ez, consumeOnMiss) {
    const hw = castWorld ? castWorld(ox, oy, oz, ex, ey, ez) : null;
    const ht = castTargets ? castTargets(ox, oy, oz, ex, ey, ez) : null;
    const tw = hw ? hw.t : Infinity;
    const tt = ht ? ht.t : Infinity;
    if (tw === Infinity && tt === Infinity) {
      if (consumeOnMiss && onExpire) onExpire(meta[i]);   // a hitscan that hit nothing = an expire
      return consumeOnMiss;
    }
    if (onHit) {
      _hit.meta = meta[i];
      if (tt <= tw) {                                     // dynamic target is nearer (or tie → target wins)
        _hit.point.x = ht.point.x; _hit.point.y = ht.point.y; _hit.point.z = ht.point.z;
        _hit.normal.x = 0; _hit.normal.y = 0; _hit.normal.z = 0;   // targets need no surface normal
        _hit.target = ht.target;
      } else {                                            // static world is nearer
        _hit.point.x = hw.point.x; _hit.point.y = hw.point.y; _hit.point.z = hw.point.z;
        _hit.normal.x = hw.normal.x; _hit.normal.y = hw.normal.y; _hit.normal.z = hw.normal.z;
        _hit.target = null;
      }
      onHit(_hit);
      _hit.target = null;   // don't retain a reference to the game's target between calls
    }
    return true;
  }

  function update(dt) {
    for (let i = 0; i < maxLive; i++) {
      if (!alive[i]) continue;
      const ox = px[i], oy = py[i], oz = pz[i];
      if (hitscan[i]) {
        // one full-length sweep, then gone regardless (instant fire).
        resolveSegment(i, ox, oy, oz, ox + vx[i] * hitscanRange, oy + vy[i] * hitscanRange, oz + vz[i] * hitscanRange, true);
        freeSlot(i);
        continue;
      }
      // semi-implicit (symplectic) Euler: gravity nudges velocity, then position advances — the swept
      // segment is this frame's start→end, so a fast bullet still tests everything it crossed.
      vy[i] -= gravity * dt;
      const ex = ox + vx[i] * dt, ey = oy + vy[i] * dt, ez = oz + vz[i] * dt;
      if (resolveSegment(i, ox, oy, oz, ex, ey, ez, false)) { freeSlot(i); continue; }
      px[i] = ex; py[i] = ey; pz[i] = ez;
      life[i] -= dt;
      if (life[i] <= 0 || py[i] < expireBelowY) { if (onExpire) onExpire(meta[i]); freeSlot(i); }
    }
  }

  return {
    fire, update,
    get liveCount() { return liveCount; },
    maxLive,
    px, py, pz, vx, vy, vz, alive,
    dispose() { alive.fill(0); liveCount = 0; for (let i = 0; i < maxLive; i++) meta[i] = null; },
  };
}
