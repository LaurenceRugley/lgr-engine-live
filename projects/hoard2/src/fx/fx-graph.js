/* ============================================================
   hoard2 · src/fx/fx-graph.js — the FX ORCHESTRATION (PURE: core + injected adapters, no engine/THREE).
   ------------------------------------------------------------
   The event-driven brain of the fx-audio owner. It listens to the combat/wave vocabulary and drives four
   COSMETIC sinks — particles, decals, the corpse pool, and combat SFX — through small injected adapters.
   It imports ONLY the pure corpse-pool math + whatever `deps` hand it, so it is node-testable (the engine
   barrel dies under `node --test`; index.js does the THREE wiring and passes real adapters in here).

   WHY a pure seam (Rule 9 / no-pretending): the DONE-#5 corpse behaviour and the "degrade to no-op when
   the float RT is absent" contract are LOGIC, not rendering — so they get tested as logic, with mock sinks
   and a fake clock, decoupled from GPU state we can't stand up headless.

   DEGRADE POSTURE: every sink is nullable. `createParticles` returns null with no float RT; `createAudioBus`
   returns null headless. A null sink means the corresponding handler simply does nothing — never throws.
   The corpse POOL always runs (it is pure JS); only its VISUAL sink (the horde) may be absent early (async
   GLB load) — pool bookkeeping proceeds and the glue catches up via syncActive() once the horde is ready.

   AGEING CLOCK (v1 main.js:359-360): particles/decals/corpses age on WALL-CLOCK (`time.realDt`), not the
   dilated sim clock — a blood pool fades on real seconds even while a dive slows the horde to a crawl.

   Adapter contracts (index.js supplies these; the test supplies mocks):
     particles | null : { muzzle(x,y,z,dx,dy,dz), burst(x,y,z,dx,dy,dz), update(dt), get live }
     decals    | null : { hole(x,y,z,nx,ny,nz), blood(x,z), update(dt), get count }
     sfx       | null : { fire(pos), hit(pos,isBody), melee(pos), death(pos), barrier(kind) }
     sink            : { ready()->bool, apply(i, slot), recycle(i), step(dt) }   // the corpse horde glue
   ============================================================ */
import { createCorpsePool } from '@lgr/engine-core/src/corpse-pool.js';   // B3: lifted to core (deep-import = node-safe, barrel-free)

const TWO_PI = Math.PI * 2;

// Pull a {x,y,z} out of whatever a payload hands us (Vector3, plain obj, or a target ref). Returns null if
// there is no usable position — a cosmetic handler then simply skips (never guesses coordinates).
function posOf(v) {
  if (!v) return null;
  if (typeof v.x === 'number' && typeof v.z === 'number') return v;
  return null;
}

export function createFxCore(deps) {
  const { events, rng, time, config, groundY = 0.3 } = deps;
  const particles = deps.particles || null;
  const decals = deps.decals || null;
  const sfx = deps.sfx || null;
  const sink = deps.sink;   // corpse horde glue (always provided; sink.ready() gates the visual half)

  const fxRng = rng.fork('fx');   // determinism: fx rolls come off the DECORRELATED 'fx' stream (never 'sim')
  const pool = createCorpsePool({ cap: config.CORPSE_CAP, ttl: config.CORPSE_TTL_S });

  let corpseClock = 0;   // wall-clock seconds; the pool's TTL/eviction "now" (advanced by realDt in update)

  // Recycle callback reused across the TTL sweep (no per-frame closure alloc).
  const _recycle = (i) => { if (sink && sink.ready()) sink.recycle(i); };

  /* ---- event handlers (registered once; disposers collected for teardown) ---- */
  const off = [];

  // MUZZLE FLASH — a tight bright cone at the barrel along the shot direction.
  off.push(events.on('weapon:fire', (p) => {
    const o = posOf(p && p.origin), d = (p && p.dir) || null;
    if (particles && o) particles.muzzle(o.x, o.y, o.z, d ? d.x : 0, d ? d.y : 1, d ? d.z : 0);
    if (sfx) sfx.fire(o);
  }));

  // IMPACT — blood/spark burst at the hit. A WORLD hit (no zombie target) also stamps a bullet hole on the
  // ground; a BODY hit does not (you don't drill a hole in a corpse). v1 onImpact(main.js:51-57).
  off.push(events.on('weapon:hit', (p) => {
    const pt = posOf(p && p.point); if (!p) return;
    const n = (p.normal) || { x: 0, y: 1, z: 0 };
    const isBody = !!p.target;
    if (particles && pt) particles.burst(pt.x, pt.y + 0.3, pt.z, n.x, n.y + 0.3, n.z);   // bias spray upward
    if (!isBody && decals && pt) decals.hole(pt.x, pt.y, pt.z, n.x, n.y, n.z);
    if (sfx) sfx.hit(pt, isBody);
  }));

  // MELEE IMPACT — a blood burst on the struck zombie. melee:hit's payload is { target, damage }; we take a
  // position off the target if it carries one (see report: assumed target may be {id,x,y,z}), else skip the
  // burst but still play the SFX. No ground decal (a melee hit is on a body, not the floor).
  off.push(events.on('melee:hit', (p) => {
    const t = posOf(p && p.target);
    if (particles && t) particles.burst(t.x, (t.y || groundY) + 0.4, t.z, 0, 1, 0);
    if (sfx) sfx.melee(t);
  }));

  // DEATH — the money event (DONE #5): a blood pool + burst AND a persistent corpse. Never vanishes: the
  // corpse enters the pool (persists ≥ CORPSE_TTL_S / to CORPSE_CAP) and the horde renders it in the death
  // pose. yaw is a cosmetic roll off the 'fx' stream (decorrelated — never perturbs the sim trace).
  off.push(events.on('zombie:death', (p) => {
    const pos = posOf(p && p.pos) || { x: 0, y: groundY, z: 0 };
    if (particles) particles.burst(pos.x, groundY + 0.3, pos.z, 0, 1, 0);
    if (decals) decals.blood(pos.x, pos.z);
    const yaw = fxRng.range(0, TWO_PI);
    const r = pool.spawn({ x: pos.x, y: groundY, z: pos.z, yaw, type: p && p.type }, corpseClock);
    if (sink && sink.ready()) sink.apply(r.index, pool.get(r.index));   // r.evicted (if any) is reused in place
    if (sfx) sfx.death(pos);
  }));

  // BARRIER — a wood/scrap thud on damage, a heavier crack on breach (audio only; build owns the visuals).
  off.push(events.on('barrier:damage', () => { if (sfx) sfx.barrier('damage'); }));
  off.push(events.on('barrier:breach', () => { if (sfx) sfx.barrier('breach'); }));

  /* syncActive(): catch-up when the corpse horde finishes loading AFTER some deaths already landed — apply
     every already-active pool slot to the (now-ready) sink so no corpse is silently missing. */
  function syncActive() {
    if (!sink || !sink.ready()) return;
    pool.forEachActive((i, s) => sink.apply(i, s));
  }

  /* update(dt): advance every cosmetic clock on WALL time, then run the corpse TTL sweep + step the horde. */
  function update(dt) {
    const rdt = time.realDt(dt);
    corpseClock += rdt;
    if (particles) particles.update(rdt);
    if (decals) decals.update(rdt);
    pool.update(corpseClock, _recycle);          // TTL floor sweep (frees corpses past CORPSE_TTL_S)
    if (sink && sink.ready()) sink.step(rdt);     // step the death-pose mixers (LOD-throttled inside the horde)
  }

  function counts() {
    return {
      particles: particles ? (particles.live | 0) : 0,
      decals: decals ? (decals.count | 0) : 0,
      corpses: pool.countActive(),
    };
  }

  function dispose() { for (const d of off) d(); off.length = 0; }

  return { update, counts, syncActive, dispose, _pool: pool };
}
