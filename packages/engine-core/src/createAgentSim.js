/* ============================================================
   @lgr/engine-core — createAgentSim (A-CITIZENS, 2026-08-12): the pooled SEIR agent population.
   ------------------------------------------------------------
   THE ABILITY, lifted (not rewritten) from projects/hoard2/src/sim/civilians.js @ 84c0667 (A-OUTBREAK
   Phase 1), per the research doc's Phase 2 (docs/design/research-agents-gameplay.md §7): the agent-based
   SEIR state machine over a fixed pool —
     S (susceptible) = wander/idle the level, FLEE the infected by ASCENDING a multi-source flow field;
     E (exposed)     = bitten + incubating across a rolled window (THE PACING LEVER — every turn is
                       telegraphed by gait + tint, never a pop);
     I (infectious)  = EITHER an external chaser pool (hoard2's zombies.js — the E→I turn is a handoff
                       via `onTurn`), OR — new in the lift — IN-POOL: with `params.chase` set a completed
                       incubation flips the record to state 'i' where it stands (the victim rises where
                       it fell) and it starts hunting the nearest susceptible;
     R (removed)     = the consumer's corpse pool (fx), unchanged.

   WHY THE LIFT PRESERVES hoard2 BYTE-FOR-BYTE (its determinism trace tests are the proof): the S/E code
   path is the hoard2 original, parameterised in NAME only — `config.CIVS` becomes `params`,
   `config.PLAY_RADIUS` becomes `params.playRadius`, and every new branch (in-pool 'i' records, the
   internal bite scan, the in-place turn) is gated on `params.chase` or `s.zpool == null`, both of which
   hoard2 never triggers. Same srng stream, same roll ORDER, same numbers. hoard2's civilians.js is now a
   two-line adapter over this module; its node tests + tools/hoard2-outbreak-probe.mjs pin the claim.

   THE PHASE-3 SEAM, taken deliberately small (the brief's "nearest of a target set"): target selection
   is `nearest(x, z, r, state)` — the nearest live pool member OF A GIVEN STATE. hoard2's zombie
   opportunism consumes it as `nearestS` (state 's', unchanged); the in-pool chasers consume it the same
   way; a faction arc widens `state` to a set/predicate and seeds per-faction flow fields multi-source
   from each target set (createFlowField.solve(sources) already takes the array). Nothing here hard-codes
   "the player" — the sim never reads a player at all, which is what makes a same-seed city outbreak
   replay EXACTLY while a human swings through it.

   DETERMINISM DOCTRINE (unchanged from the original): the ONLY randomness — scatter, wander targets,
   transmission rolls, incubation durations — is off the injected stream (`srng`, e.g. rng.fork('sim')).
   The step itself is pure math; the 'i' chase consumes NO rolls (pure nearest-scan + field read), so a
   growing outbreak never re-orders the stream. Zero per-frame allocation; THREE-free; imports NOTHING —
   node-testable exactly like createFlowField.

   C++ anchor: an object pool of PODs; the SEIR state is an enum + two floats (incubT, incubDur) per
   record; an agent-based epidemic sim is a state machine over a broadphase. `createAgentRng` below is
   mulberry32 + helpers — the same deliberate small duplication as hoard2's rng.js (the barrel is not
   node-importable, and this module must import nothing).

   Contract: createAgentSim(params, srng, opts) -> {
     populate(field, cx, cz), step(dt, s), forceExpose(n, px, pz),
     nearest(x, z, r, state), nearestS(x, z, r),          // phase-3 target-set seam (nearestS = 's')
     reset(), forEach(cb), get(i),
     max, alive, sCount, eCount, iCount,
   }
   params = { count, walkSpeed, fleeSpeed, staggerSpeed, populateRadius, panicCells, calmCells,
              biteRadius, pTransmitPerSec, contactCells, incubationS: [min,max], wanderIdleS: [min,max],
              wanderRadius, playRadius, arriveR?, lookAhead?, chase?: { speed, directR } }
   opts.placer? = { spawn(srng,out), wander(srng,c,out), dwellScale?(c) }  — A-CROWD, see below:
              WHERE bodies are, injected, so the sim keeps knowing nothing about cities. Absent (hoard2,
              and the lab's uniform control arm) ⇒ not one statement of it runs and the stream is
              byte-identical. `createStreetPlaces` is the engine's street-grid implementation of it.
   TWO MEASURED TUNING INVARIANTS (createAgentSim.test.mjs found both on first contact):
     · chase.speed must CLEAR fleeSpeed or the outbreak stalls (the gap grows, no second bite, ever);
     · biteRadius must CLEAR opts.sepRadius — a slow chase closes to the separation shell and ORBITS
       there (the mutual push balances the approach exactly at the shell; hoard2 never saw it because
       its chasers punch through at ~6x the relative speed).
   step s = { field (multi-source FLEE field — cost = grid distance to the nearest infectious),
              zpool|null (external I pool — hoard2), huntField|null (multi-source field seeded from the
              S set — in-pool chasers descend it), threatCount?, aabbs|null,
              onBite(c)|null, onTurn(c)->bool|null (external handoff), onTurned(c)|null (in-pool flip) }
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
const SAFE = 1e9; // safety score for a cell the threat flood never reached (no infectious can path there)

export function createAgentSim(params, srng, opts = {}) {
  const C = params;
  const MAXC = (opts.cap != null && opts.cap >= 0) ? opts.cap : C.count; // cap 0 = a legal A/B arm (no agents)
  // ?noflee=1 A/B lever (the consumer wires it): with flee OFF susceptibles keep wandering through the
  // horde — the measurement control for "flee actually flees" (mean threat distance must beat this arm).
  const fleeOn = opts.flee !== false;

  const clampBlocked = !!opts.clampBlocked;

  /* THE PLACER SEAM (A-CROWD, 2026-08-15) — an injected strategy for WHERE bodies are, as opposed to
     HOW they move. The sim's own answer is "uniformly over a disc, wandering at random", which is the
     right default for hoard2's forest and is measurably the wrong one for a city: a uniform crowd is a
     THIN crowd at every count you can afford (swing-ledger OPEN #30). A consumer that knows what its
     world looks like passes an object with three methods and the sim asks it three questions:
       spawn(srng, out)       — where does a body start?
       wander(srng, c, out)   — where does it go next?
       dwellScale(c)          — how much longer than usual does THIS body stand still here?
     `createStreetPlaces` is the engine's implementation for a street grid; nothing here knows about
     streets, which is the point — a forest, a market or a spaceport would pass a different one.
     GATED ON PRESENCE, so every existing consumer (hoard2, and the lab's own uniform control arm) runs
     the identical code path off the identical stream: not one statement below executes without it. */
  const placer = opts.placer || null;
  const _pt = { x: 0, z: 0 };   // hoisted placer scratch — no per-call allocation

  const cs = [];
  for (let i = 0; i < MAXC; i++) {
    cs.push({ id: i, x: 0, z: 0, vx: 0, vz: 0, alive: false, state: 's',
      incubT: 0, incubDur: 0, fleeing: false, idleT: 0, wx: 0, wz: 0, forceBite: false });
  }
  let sCount = 0, eCount = 0, iCount = 0;

  // Hoisted step scratch (no per-frame alloc): the combined agent+external-threat compact list for the
  // shared separation hash, and the push buffer sized for both pools (opts.sepCap = external pool max).
  const sepCap = MAXC + (opts.sepCap || 0);
  const _agents = new Array(sepCap);
  const _push = new Float32Array(sepCap * 2);
  const _des = { x: 0, z: 0 };

  /* ---- populate: deterministic scatter inside the play disc (called once, after the field exists) ---- */
  function populate(field, cx = 0, cz = 0) {
    for (let i = 0; i < MAXC; i++) {
      const c = cs[i];
      let x = cx, z = cz;
      if (placer) {
        /* THE CLUSTERED SPAWN. The placer picks a gathering place and a point in it, re-testing its
           OWN blocked predicate; the field's mask is stricter (it inflates obstacles by the agent
           radius — configuration space), so the sim keeps its own rejection loop over the placer. */
        for (let t = 0; t < 6; t++) {
          placer.spawn(srng, _pt);
          x = _pt.x; z = _pt.z;
          if (!field || !field.isBlocked(x, z)) break;
        }
      } else {
        for (let t = 0; t < 20; t++) { // rejection-sample off blocked cells (obstacles); accept the last try
          const ang = srng.range(0, Math.PI * 2);
          const rad = Math.sqrt(srng()) * C.populateRadius; // sqrt → area-uniform over the disc
          x = cx + Math.cos(ang) * rad; z = cz + Math.sin(ang) * rad;
          if (!field || !field.isBlocked(x, z)) break;
        }
      }
      c.x = x; c.z = z; c.vx = 0; c.vz = 0;
      c.alive = true; c.state = 's'; c.incubT = 0; c.incubDur = 0;
      c.fleeing = false; c.forceBite = false;
      c.idleT = srng.range(0, C.wanderIdleS[1]); // desynced first dwell so the crowd doesn't move in lockstep
      pickWander(c, field);
    }
    sCount = MAXC; eCount = 0; iCount = 0;
  }

  function pickWander(c, field) {
    if (placer) {
      /* THE CLUSTERED TARGET — and it is the half that KEEPS them, not just the half that puts them
         there. A spawn-only cluster dissolves in about a minute: every random-walk step is a step
         toward the uniform average, which is what the uniform arm IS. Asking the placer every time
         means a body that drifts out of its group walks back into it. */
      for (let t = 0; t < 4; t++) {
        placer.wander(srng, c, _pt);
        let wx = _pt.x, wz = _pt.z;
        const d = Math.hypot(wx, wz);
        if (d > C.populateRadius) { wx *= C.populateRadius / d; wz *= C.populateRadius / d; }
        c.wx = wx; c.wz = wz;
        if (!field || !field.isBlocked(wx, wz)) return;
      }
      return;
    }
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

  /* ---- barrier clamp (same rule as the hoard2 original — a step into a barrier AABB is refused) ---- */
  function pointInAabb(b, x, z, m) {
    return x >= b.minx - m && x <= b.maxx + m && z >= b.minz - m && z <= b.maxz + m;
  }
  function firstAabbHit(aabbs, x, z, m) {
    for (let i = 0; i < aabbs.length; i++) if (pointInAabb(aabbs[i], x, z, m)) return aabbs[i];
    return null;
  }

  /* The per-frame step — see the contract in the header. Zero allocation. */
  function step(dt, s) {
    if (dt <= 0) return;
    const field = s.field, zpool = s.zpool, aabbs = s.aabbs;
    // hoard2 always passes threatCount (external pool) — identical. In-pool consumers may omit it and
    // the live 'i' count is the threat count by construction.
    const threats = s.threatCount != null ? s.threatCount | 0 : iCount;
    const chase = C.chase || null;

    // ONE combined compact list (pool agents first, external threats appended) so the field's spatial
    // hash separates agent↔agent AND agent↔threat in a single build. Only the pool prefix's push
    // entries are read.
    let nc = 0;
    for (let i = 0; i < MAXC; i++) { const c = cs[i]; if (c.alive) _agents[nc++] = c; }
    if (nc === 0) return;
    let na = nc;
    if (field && zpool) for (let i = 0; i < zpool.max && na < sepCap; i++) { const z = zpool.get(i); if (z.alive) _agents[na++] = z; }
    if (field) field.separate(_agents, na, _push, { radius: opts.sepRadius || 0.7, maxNeighbors: 6 });

    const zk = 1 - Math.exp(-6 * dt); // same velocity smoothing constant as the hoard2 zombie step
    for (let k = 0; k < nc; k++) {
      const c = _agents[k];
      // Threat distance in grid cells (multi-source BFS from every infectious); −1 = unreachable = safe.
      const tcost = (field && threats > 0) ? field.costAt(c.x, c.z) : -1;

      let desX = 0, desZ = 0;

      if (chase && c.state === 'i') {
        // IN-POOL INFECTIOUS (params.chase consumers only — hoard2 never has an 'i' record). Hunt the
        // nearest susceptible: an exact scan inside directR (field cells are too coarse for the last
        // metre), else DESCEND the hunt field (multi-source from the S set — its arrows point at the
        // nearest S by the BFS identity). NO rolls — a growing horde never re-orders the srng stream.
        const prey = nearest(c.x, c.z, chase.directR, 's');
        if (prey) {
          const dx = prey.x - c.x, dz = prey.z - c.z, d = Math.hypot(dx, dz) || 1;
          desX = (dx / d) * chase.speed; desZ = (dz / d) * chase.speed;
        } else if (s.huntField) {
          const smp = s.huntField.sample(c.x, c.z);
          desX = smp.x * chase.speed; desZ = smp.z * chase.speed;
        }
      } else if (c.state === 'e') {
        // INCUBATING — the telegraph window. The gait drops to a stagger; the mirror ramps the tint off
        // incubT/incubDur. At the end of the window the victim TURNS: external handoff (onTurn — a
        // zombie rises where it fell and the record dies), or — chase consumers — an IN-PLACE flip to
        // 'i' (the victim rises where it fell AS a pool member).
        c.incubT += dt;
        if (c.incubT >= c.incubDur) {
          if (s.onTurn) {
            if (s.onTurn(c)) { c.alive = false; eCount--; continue; }
            c.incubT = c.incubDur; // external pool saturated → hold at the threshold, retry next tick
          } else if (chase) {
            c.state = 'i'; eCount--; iCount++;
            c.fleeing = false;
            if (s.onTurned) s.onTurned(c);
            continue; // it hunts from the next tick — this tick it stands up
          } else {
            c.incubT = c.incubDur; // no turn path configured → hold (the hoard2-original behaviour)
          }
        }
        fleeInto(field, c, _des);
        desX = _des.x * C.staggerSpeed; desZ = _des.z * C.staggerSpeed;
      } else {
        // BITE — the exact circle test runs ONLY inside the flee-field prefilter (contactCells covers
        // biteRadius + one fleeResolveS of runner drift, so staleness can't hide a contact).
        const hasThreatSrc = zpool || (chase && iCount > 0);
        if (c.forceBite || (hasThreatSrc && tcost >= 0 && tcost <= C.contactCells)) {
          let bit = c.forceBite;
          if (!bit) {
            const r2 = C.biteRadius * C.biteRadius;
            if (zpool) {
              for (let i = 0; i < zpool.max; i++) {
                const z = zpool.get(i); if (!z.alive) continue;
                const dx = z.x - c.x, dz = z.z - c.z;
                if (dx * dx + dz * dz <= r2) { bit = srng.chance(Math.min(1, C.pTransmitPerSec * dt)); break; }
              }
            } else {
              for (let i = 0; i < MAXC; i++) {
                const z = cs[i]; if (!z.alive || z.state !== 'i') continue;
                const dx = z.x - c.x, dz = z.z - c.z;
                if (dx * dx + dz * dz <= r2) { bit = srng.chance(Math.min(1, C.pTransmitPerSec * dt)); break; }
              }
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
              // arriveR/lookAhead default to the hoard2 originals (0.4 / 0.5 u) — parameterised because
              // a consumer at a different world scale (swing-lab's 6 m/u city) needs them in ITS units.
              const arrive = C.arriveR != null ? C.arriveR : 0.4;
              const ahead = C.lookAhead != null ? C.lookAhead : 0.5;
              const dx = c.wx - c.x, dz = c.wz - c.z, d = Math.hypot(dx, dz);
              /* THE LOITER. `dwellScale` is the third placer question and the one that actually
                 accumulates a group: if bodies only TARGET gathering places but stand still for the
                 same time everywhere, steady-state occupancy is set by travel time and comes back out
                 nearly uniform. Time spent standing still is what makes a crowd. The base roll is
                 taken FIRST and unchanged, so the stream is the sim's, scaled — not the placer's. */
              if (d < arrive) {
                c.idleT = srng.range(C.wanderIdleS[0], C.wanderIdleS[1]);
                if (placer && placer.dwellScale) c.idleT *= placer.dwellScale(c);
                pickWander(c, field);
              }
              else if (field && field.isBlocked(c.x + (dx / d) * ahead, c.z + (dz / d) * ahead)) pickWander(c, field);
              else { desX = (dx / d) * C.walkSpeed; desZ = (dz / d) * C.walkSpeed; }
            }
          }
        }
      }

      c.vx += (desX - c.vx) * zk; c.vz += (desZ - c.vz) * zk;
      c.vx += _push[k * 2] * 0.9; c.vz += _push[k * 2 + 1] * 0.9; // shared-hash anti-overlap

      let nx = c.x + c.vx * dt, nz = c.z + c.vz * dt;
      if (aabbs && aabbs.length) {
        const hit = firstAabbHit(aabbs, nx, nz, 0.2);
        if (hit) { nx = c.x; nz = c.z; } // an agent doesn't gnaw the wall — just stops
      }
      // Opt-in hard clamp against the FIELD's own blocked mask (opts.clampBlocked — the city consumer):
      // steering never CHOOSES a blocked cell, but the separation push + velocity smoothing can still
      // shove a body across a tower footprint, and a blocked cell reads cost −1 = "safe", so an agent
      // pushed inside would idle INSIDE the wall forever. O(1) per agent; hoard2 does not set it (its
      // trees ride on steering alone, the shipped behaviour, byte-identical).
      if (clampBlocked && field && field.isBlocked(nx, nz)) { nx = c.x; nz = c.z; }
      // Keep the crowd on the field: a flee past the play rim slides along it instead of leaving.
      const d0 = Math.hypot(nx, nz), lim = C.playRadius;
      if (d0 > lim) { nx *= lim / d0; nz *= lim / d0; }
      c.x = nx; c.z = nz;
    }
  }

  // THE TARGET-SET QUERY (phase-3 seam): the nearest live pool member of `state` within r of (x,z),
  // else null. Exposed victims don't attract as prey (state 's' excludes them — they're already claimed,
  // and chasing them would drag the teller off the telegraph). Pure scan, no rolls, deterministic;
  // O(pool) with small constants. Factions widen `state` to a set; this is deliberately not built yet.
  function nearest(x, z, r, state = 's') {
    let best = null, bd = r * r;
    for (let i = 0; i < MAXC; i++) {
      const c = cs[i];
      if (!c.alive || c.state !== state) continue;
      const dx = c.x - x, dz = c.z - z, d2 = dx * dx + dz * dz;
      if (d2 <= bd) { bd = d2; best = c; }
    }
    return best;
  }
  const nearestS = (x, z, r) => nearest(x, z, r, 's'); // hoard2 zombies.js opportunism, unchanged name

  // Probe hook (probe.infect): force-bite the n live susceptibles NEAREST (px,pz) THROUGH the real
  // bite path (the flag is consumed by step(), which rolls the incubation and fires onBite like any
  // street bite). Nearest-first so a scripted patient zero lands ON CAMERA. Deterministic: pure
  // distance scan, no rolls.
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

  function reset() { for (let i = 0; i < MAXC; i++) cs[i].alive = false; sCount = 0; eCount = 0; iCount = 0; }
  function forEach(cb) { for (let i = 0; i < MAXC; i++) cb(i, cs[i]); }

  return {
    populate, step, forceExpose, nearest, nearestS, reset, forEach,
    get(i) { return cs[i]; },
    get max() { return MAXC; },
    get alive() { return sCount + eCount + iCount; },
    get sCount() { return sCount; },
    get eCount() { return eCount; },
    get iCount() { return iCount; },
  };
}

/* ---- createAgentRng — a seeded stream with the helper vocabulary the sim consumes. -----------------
   mulberry32 VERBATIM from citygen.js:33 (the canonical source), inlined for the same measured reason
   hoard2's rng.js inlined it: this module must import NOTHING to stay node-testable, and the barrel is
   not node-importable (it re-exports shaders). Consumers with their own forked-stream infrastructure
   (hoard2) pass their stream instead; this exists so a project WITHOUT one (swing-lab) can seed a
   deterministic sim in one line. C++ anchor: a self-seeded std::mt19937 with a few distribution helpers. */
export function createAgentRng(seed) {
  let a = seed >>> 0;
  const next = function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (aa, b) => aa + (b - aa) * next();
  next.int = (aa, b) => aa + Math.floor(next() * (b - aa + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  return next;
}
