/* ============================================================
   hoard2 · src/sim/zombies.js — the live zombie pool + crowd step + damage/drops (THREE-free, node-testable).
   ------------------------------------------------------------
   A FIXED pool of config.MAXZ zombie records (spawned once, recycled by index — zero per-frame allocation,
   mirroring createCharacterHorde's pool so the render horde maps 1:1). Everything here is pure numbers:
   the render mirror lives in index.js. The three types come straight off config.ZTYPE (speed/hp/scale/weight/dmg)
   — the SIM axes; silhouette/tint is fx/world's job.

   PATHING (DONE #3 crowd behaviour): steer down an injected FLOW FIELD toward the player (streams around
   trees + barriers, no local minima — see createFlowField), fall back to a direct seek in the field's
   target cell (so the zombie closes for the bite) and add the field's separation push so the crowd doesn't
   collapse to a line. v1 straight-line-seek is the baseline (hoard.js:695-705); this is the M3 upgrade.

   NIGHT (DONE #3): z.speed is recomputed EVERY step as baseSpeed · NIGHT.speedMul(nf), so as the world's
   nightFactor ramps the zombies visibly speed up (observable in the trace), not just at spawn.

   BARRIERS: if a zombie's next step would enter a barrier AABB it is CLAMPED and put in an attack state,
   calling the injected hitBarrier(id, dmg·dt) — build stays the sole emitter of barrier:* events. Contact
   with the player calls the injected damagePlayer(dmg·dt).

   DETERMINISM (DONE #10): the ONLY randomness is spawn (angle/radius/type) and the on-death drop roll, all
   off the injected sim stream (rng.fork('sim')). The step itself is pure math — same inputs, same output.

   C++ anchor: an object pool of PODs handed out by index; the compact `_agents` list is a scratch vector of
   pointers rebuilt each frame (contents reassigned, never reallocated) so separation sees only live agents.
   ============================================================ */
const DROP_TABLE = ['food', 'scrap', 'scrap', 'bandage', 'food']; // weighted: scrap common, food/bandage rarer

export function createZombiePool(config, srng) {
  const MAXZ = config.MAXZ, Z = config.ZTYPE, N = config.NIGHT;
  const TYPES = Object.keys(Z);
  let typeWeightTotal = 0; for (const k of TYPES) typeWeightTotal += Z[k].weight;

  const zs = [];
  for (let i = 0; i < MAXZ; i++) {
    zs.push({ id: i, x: 0, z: 0, vx: 0, vz: 0, alive: false, type: 'walker',
      hp: 1, maxhp: 1, baseSpeed: 1, speed: 1, scale: 1, dmg: 0, flash: 0, attacking: false });
  }
  let aliveCount = 0;

  // Hoisted step scratch (no per-frame alloc): compact live-agent list for separation + its push buffer.
  const _agents = new Array(MAXZ);
  const _push = new Float32Array(MAXZ * 2);
  // Hoisted death payload (reused; caller consumes synchronously in the same tick).
  const _drops = [];
  const _death = { z: null, drops: _drops };

  function rollType() {
    let r = srng() * typeWeightTotal;
    for (const k of TYPES) { r -= Z[k].weight; if (r <= 0) return k; }
    return TYPES[0];
  }

  // Spawn one zombie just outside the play disc. waveScale grows hp/speed with the wave (v1 hoard.js:251-253).
  function spawn(wave, nf, cx = 0, cz = 0) {
    let slot = -1;
    for (let i = 0; i < MAXZ; i++) if (!zs[i].alive) { slot = i; break; }
    if (slot < 0) return null; // pool saturated
    const type = rollType(), t = Z[type], z = zs[slot];
    const hpScale = 1 + wave * 0.08;
    const ang = srng.range(0, Math.PI * 2);
    // Spawn on a ring around the SURVIVOR (cx,cz) — short + consistent approach (playtest #2). Clamp the
    // spawn inside the arena so a survivor at the edge doesn't spawn zombies off the map.
    const rad = config.SPAWN_RING + srng.range(-config.SPAWN_JITTER, config.SPAWN_JITTER);
    let sx = cx + Math.cos(ang) * rad, sz = cz + Math.sin(ang) * rad;
    const d = Math.hypot(sx, sz), lim = config.PLAY_RADIUS + 1;
    if (d > lim) { sx *= lim / d; sz *= lim / d; } // keep it on the field
    z.x = sx; z.z = sz;
    z.vx = 0; z.vz = 0; z.alive = true; z.type = type;
    z.maxhp = t.hp * hpScale; z.hp = z.maxhp;
    // Wave-1 gets a gentle speed grace so a new viewer isn't instantly swarmed (v1 L35). Night speed is applied LIVE in step().
    z.baseSpeed = t.speed * (1 + wave * 0.015) * (wave === 1 ? 0.85 : 1);
    z.speed = z.baseSpeed * N.speedMul(nf);
    z.scale = t.scale; z.dmg = t.dmg; z.flash = 0; z.attacking = false;
    aliveCount++;
    return z;
  }

  // Is world point (x,z) inside barrier AABB `b` (inflated by margin)? aabbs use build.aabbs()'s lowercase keys.
  function pointInAabb(b, x, z, m) {
    return x >= b.minx - m && x <= b.maxx + m && z >= b.minz - m && z <= b.maxz + m;
  }
  function firstAabbHit(aabbs, x, z, m) {
    for (let i = 0; i < aabbs.length; i++) if (pointInAabb(aabbs[i], x, z, m)) return aabbs[i];
    return null;
  }

  /* The per-frame crowd step. s = {
       player:{x,z}, field|null, contactR, nf, aabbs|null, hitBarrier(id,amount)|null, damagePlayer(amount)|null
     }. Zero allocation. */
  function step(dt, s) {
    if (dt <= 0) return;
    const player = s.player, field = s.field, contactR = s.contactR, nf = s.nf || 0;
    const aabbs = s.aabbs, hitBarrier = s.hitBarrier, damagePlayer = s.damagePlayer;

    if (field) field.update(player.x, player.z, dt); // re-solve the shared field toward the survivor (near-free)

    // Compact the live zombies so separation only pushes real agents (dead slots would clump at their last pos).
    let ac = 0;
    for (let i = 0; i < MAXZ; i++) { const z = zs[i]; if (z.alive) _agents[ac++] = z; }
    if (field && ac > 0) field.separate(_agents, ac, _push, { radius: 0.7, maxNeighbors: 6 });

    const zk = 1 - Math.exp(-6 * dt); // velocity smoothing toward desired (v1 hoard.js:704)
    for (let k = 0; k < ac; k++) {
      const z = _agents[k];
      z.speed = z.baseSpeed * N.speedMul(nf); // LIVE night speed — visibly faster as nf ramps
      const dx = player.x - z.x, dz = player.z - z.z, td = Math.hypot(dx, dz) || 1;

      let desX, desZ;
      if (field) {
        const smp = field.sample(z.x, z.z);
        if (smp.x !== 0 || smp.z !== 0) { desX = smp.x * z.speed; desZ = smp.z * z.speed; }
        else { desX = (dx / td) * z.speed; desZ = (dz / td) * z.speed; } // in the target cell → direct seek for the bite
      } else { desX = (dx / td) * z.speed; desZ = (dz / td) * z.speed; }

      z.vx += (desX - z.vx) * zk; z.vz += (desZ - z.vz) * zk;
      if (field) { z.vx += _push[k * 2] * 0.9; z.vz += _push[k * 2 + 1] * 0.9; } // anti-overlap

      z.attacking = false;
      if (td > contactR) {
        let nx = z.x + z.vx * dt, nz = z.z + z.vz * dt;
        // Barrier block+attack: a step into a barrier is refused; the zombie stops and gnaws the wall.
        if (aabbs && aabbs.length) {
          const hit = firstAabbHit(aabbs, nx, nz, 0.25 * z.scale);
          if (hit) {
            z.attacking = true; nx = z.x; nz = z.z;
            if (hitBarrier) hitBarrier(hit.id, z.dmg * dt); // build owns barrier HP + barrier:* events
          }
        }
        z.x = nx; z.z = nz;
      } else {
        z.attacking = true;                       // in reach → maul the survivor
        if (damagePlayer) damagePlayer(z.dmg * dt);
      }
      if (z.flash > 0) z.flash = Math.max(0, z.flash - dt);
    }
  }

  function rollDrop() { return srng.pick(DROP_TABLE); }

  // Apply damage to a zombie by id (from a bullet/melee hit). Returns the reused _death info on a kill, else null.
  function damage(id, amount) {
    const z = zs[id];
    if (!z || !z.alive || amount <= 0) return null;
    z.hp -= amount; z.flash = 0.12;
    if (z.hp > 0) return null;
    z.alive = false; aliveCount--;
    _drops.length = 0;
    if (srng.chance(0.30)) _drops.push(rollDrop()); // v1 hoard.js:262 — ~30% of the dead drop something
    _death.z = z;
    return _death;
  }

  // Ballistics/melee hit-test seam: zombies a world segment o→e could hit, nearest-first. On-demand (not per-frame).
  function queryTargets(seg) {
    const o = seg.o, e = seg.e;
    const ax = o.x, az = o.z, abx = e.x - ax, abz = e.z - az, abl2 = abx * abx + abz * abz || 1;
    const out = [];
    for (let i = 0; i < MAXZ; i++) {
      const z = zs[i]; if (!z.alive) continue;
      let t = ((z.x - ax) * abx + (z.z - az) * abz) / abl2;
      if (t < 0) t = 0; else if (t > 1) t = 1;
      const cx = ax + abx * t, cz = az + abz * t, dcx = z.x - cx, dcz = z.z - cz;
      const r = 0.45 * z.scale + 0.1;
      if (dcx * dcx + dcz * dcz <= r * r) out.push({ id: z.id, x: z.x, y: config.GROUND_Y + 0.9, z: z.z, type: z.type, hp: z.hp, _t: t });
    }
    out.sort((a, b) => a._t - b._t);
    for (const o2 of out) delete o2._t;
    return out;
  }

  // Horde centroid (deterministic) for the probe's px,pz. Writes into `out`; returns false if no zombies alive.
  function centroid(out) {
    if (aliveCount === 0) return false;
    let sx = 0, sz = 0, n = 0;
    for (let i = 0; i < MAXZ; i++) { const z = zs[i]; if (z.alive) { sx += z.x; sz += z.z; n++; } }
    out.x = sx / n; out.z = sz / n; return true;
  }

  function reset() { for (let i = 0; i < MAXZ; i++) zs[i].alive = false; aliveCount = 0; }
  function forEach(cb) { for (let i = 0; i < MAXZ; i++) cb(i, zs[i]); }

  // queryCone — the NEAREST live zombie within a cone (half-angle cosHalf) of the aim direction (dirx,dirz),
  // out to `range`. The gun's AIM-ASSIST snaps to this so deliberate aim connects without full auto-aim
  // (you must still face the threat; cone-limited). Returns the body-centre record or null. No allocation
  // beyond the one result object.
  function queryCone(px, pz, dirx, dirz, cosHalf, range) {
    let best = null, bestD = Infinity;
    const r2 = range * range;
    for (let i = 0; i < MAXZ; i++) {
      const z = zs[i]; if (!z.alive) continue;
      const ex = z.x - px, ez = z.z - pz, d2 = ex * ex + ez * ez;
      if (d2 > r2 || d2 < 1e-4) continue;
      const dot = (ex * dirx + ez * dirz) / Math.sqrt(d2); // cos of the angle aim↔zombie
      if (dot < cosHalf) continue;                          // outside the cone
      if (d2 < bestD) { bestD = d2; best = z; }             // nearest in cone
    }
    return best ? { id: best.id, x: best.x, y: config.GROUND_Y + 0.9, z: best.z, vx: best.vx, vz: best.vz, type: best.type, hp: best.hp } : null;
  }

  return {
    spawn, step, damage, queryTargets, queryCone, centroid, reset, forEach,
    get alive() { return aliveCount; }, get(i) { return zs[i]; }, get max() { return MAXZ; },
  };
}
