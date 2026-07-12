/* ============================================================
   graph-sim.js — VIZ SLICE 6: the LIVING GRAPH. A first-party force simulation over a GraphSpec.
   ------------------------------------------------------------
   PURE MATH. No THREE, no DOM, no clock, no randomness — so `node --test` can import it and assert the
   physics directly, the same discipline graph-spec.js holds. The renderer never appears in this file; the
   sim's only output is that it MUTATES THE SHARED positions Map in place. Everything downstream (node
   matrices, labels, halos, the pick proxy, edge endpoints) already reads that Map, so the whole picture
   follows one source of truth (design doc §9).

   BUILD-VS-BUY, RESOLVED (§9): first-party, not d3-force-3d. At 45-500 nodes brute-force O(n²) repulsion
   is sub-millisecond in plain JS; the "d3 lags at 300 nodes" reports are DOM-write cost, which a WebGL
   renderer does not pay. Barnes-Hut is unnecessary below ~2k nodes and a Web Worker below ~1k (it would add
   drag-sync latency for zero benefit). d3-force is the REFERENCE SPEC here, and its math is reproduced
   faithfully — including the parts that look wrong until you know why.

   THE INTEGRATOR IS SEMI-IMPLICIT EULER, NOT VERLET. Per tick, in this exact order:
       alpha += (alphaTarget - alpha) * alphaDecay      // the cooling schedule
       each force writes into vx/vz, scaled by alpha     // forces are IMPULSES, not accelerations
       v *= (1 - velocityDecay)                          // the single damping multiplier
       pos += v
   That one damping multiplier is the entire stability engine, and `velocityDecay` is THE feel knob: d3's
   default 0.4 is mushy; 0.25-0.3 gives the visible overshoot and bounce that reads as "alive". Because the
   multipliers are per-TICK and not per-second, the tick must be a FIXED timestep — see PITFALL 1.

   THE THREE FORCES:
     REPULSION  all-pairs, d3's many-body: v += (other - self) * (strength * alpha / dist²). Note the vector
                points self→other while `strength` is NEGATIVE, so the node moves AWAY. Magnitude falls as
                1/dist (not 1/dist²) because the vector's own length grows with dist. A `distanceMax` cap
                stops far clusters from slowly creeping apart forever.
     LINKS      Hooke springs toward `restLen`, with d3's hub-softening `strength = 1 / min(degA, degB)`.
                KEEP THAT FORMULA. A leaf has one link and must follow its hub, so dividing by the SMALLER
                degree makes that link strong; a link between two hubs is weak, so hubs do not crush leaves.
                Displacement is split by `bias = degA / (degA + degB)` — the heavier node moves less.
     CENTERING  translate-to-centroid, NOT a spring. A centering spring rings and oscillates around the
                origin forever; a translation cannot, because it adds no energy.

   SEEDING (§9): the deterministic radial layout STAYS as the seed. The sim relaxes FROM it, and every
   edge's `restLen` is the seeded distance between its endpoints — so the kind-ring structure survives as
   basins of attraction rather than being flung apart. Same spec + same seed → same rest positions, always.

   THE THREE PITFALLS (§9), each handled where marked below:
     1. VARIABLE-DT INSTABILITY — this module exposes `tick()`, one FIXED step. It never sees a real clock.
        The caller accumulates real time and runs 0-2 fixed steps per frame. Never scale the per-tick
        multipliers by a raw rAF dt: at a 200ms hitch, `v *= (1 - 0.28*12)` flips sign and the graph explodes.
     2. DRAG FIGHTS THE SIM — a dragged node is PINNED (removed from integration entirely: position forced,
        velocity zeroed) while still exerting forces on everyone else. Spring-pulling it toward the cursor
        is the classic "fighting the cursor" failure.
     3. NEVER-SETTLING JITTER — below alphaMin we HARD-STOP (tick returns immediately, alpha snapped to 0,
        all velocities zeroed) and clamp sub-epsilon velocities to exactly 0. Rest frames are then
        bit-identical, which is what makes "a settled graph costs zero CPU and zero uploads" true rather
        than aspirational.

   C++ anchor: a fixed-step physics solver over a Structure-of-Arrays (x[], z[], vx[], vz[]) — the layout a
   cache-friendly integrator wants — plus a `pinned` mask that short-circuits integration for constrained
   bodies. `tick()` is one `step(dt)` call; the render loop owns the accumulator.
   ============================================================ */

/* Defaults. §9's parameter ranges were authored in d3's PIXEL space (a graph a few hundred px across);
   this atlas lives in WORLD units, ~20 across. Repulsion is the only force whose number does not carry
   over, because its impulse scales as strength/distance — see REPULSION_NOTE below. Everything else
   (alpha schedule, velocityDecay, link strengths) is dimensionless and transfers unchanged. */
export const SIM_DEFAULTS = Object.freeze({
  alphaInit:      1.0,
  alphaTarget:    0.0,
  alphaDecay:     0.028,   // §9: 0.02-0.03
  alphaMin:       0.001,   // §9: hard-stop below this
  velocityDecay:  0.28,    // §9: 0.25-0.30 — THE feel knob (d3's 0.4 is mushier)
  repulsion:     -0.15,    // world units; see REPULSION_NOTE (§9's -80..-150 is d3 pixel space)
  distanceMaxMul: 3.0,     // repulsion cap, in multiples of the MEDIAN rest length ("a few link-lengths")
  centerStrength: 0.05,    // §9: 0.03-0.08 — gentle, not a snap
  linkScale:      1.0,     // multiply every seeded rest length (>1 = roomier graph)
  velEpsilon:     0.0006,  // world units/tick below which a velocity is snapped to exactly 0
  dragAlphaTarget: 0.3,    // §9: reheat target while dragging — NOT 1.0 (that re-explodes the layout)
});

/* REPULSION_NOTE — why -0.15 and not §9's -110.
   The per-tick impulse one neighbour delivers is |strength| * alpha / dist. d3's numbers assume PIXEL space,
   where a typical separation is ~100px: -110 there is ~1.1 px/tick, roughly 1% of a link. This atlas lives
   in WORLD units with an inner ring ~2.2 across, so the same fraction-of-a-link impulse is two orders of
   magnitude smaller. Rather than smuggle a hidden unit conversion into the force loop, the parameter is
   declared in world units and TUNED AGAINST THE REAL GRAPH, on two hard constraints:

     framing     the settled radius must stay under ~10.5 world units, or the outer ring leaves the boot
                 zoom's frame (and past ~14 it crosses the ortho eye's near plane — the slice-3 finding).
     legibility  the kind-rings must stay radially ORDERED (live-ops inside doctrine inside initiative),
                 or the colour clusters stop reading.

   Measured on the 45-node vault (seed radius 8.8, mean nearest-neighbour 2.24):
     -0.05 → radius 9.30, mean drift 0.47, rings ordered  (too rigid — barely relaxes off the seed)
     -0.15 → radius 10.18, mean drift 1.35, rings ordered  ← SHIPPED
     -0.30 → radius 13.36, mean drift 3.37, rings ordered  (leaves the frame)
     -1.10 → radius 20.55, rings SCRAMBLED               (the naive port of §9's number)
   The owner is the final judge of feel: `?sim=rep:-0.2` retunes this live, no rebuild. */

const clampVel = (v, eps) => (v > -eps && v < eps ? 0 : v);

/* createGraphSim(spec, positions, opts) -> {
     tick(nSteps=1) · reheat(target) · pin(id, x, z) · unpin(id) · unpinAll()
     get alpha · get settled · get pinnedCount · get ticks · get moved
     kineticEnergy() · linkStrengthOf(from, to) · setParams(partial) · params · dispose()
   }
   spec:      a validated GraphSpec.
   positions: the Map<id,{x,y,z}> from createGraphLayout. MUTATED IN PLACE — it is the shared truth. The
              y component is never touched: this graph lives on the y=0 plane, so the sim is 2-D in (x, z).
   Dangling edges (an endpoint with no position — the honest [[L08]] finding) are skipped, exactly as the
   renderer skips them. */
export function createGraphSim(spec, positions, opts = {}) {
  const params = { ...SIM_DEFAULTS, ...opts };

  const nodes = (Array.isArray(spec.nodes) ? spec.nodes : []).filter((n) => positions.has(n.id));
  const N = nodes.length;
  const index = new Map(nodes.map((n, i) => [n.id, i]));

  const rawEdges = Array.isArray(spec.edges) ? spec.edges : [];
  const links = [];
  for (const e of rawEdges) {
    const a = index.get(e.from), b = index.get(e.to);
    if (a == null || b == null || a === b) continue;   // dangling, or a self-loop (no force to speak of)
    links.push({ a, b });
  }

  // ---- Structure-of-Arrays state. Seeded from the deterministic radial layout: reproducible start. ----
  const x = new Float64Array(N);
  const z = new Float64Array(N);
  const vx = new Float64Array(N);
  const vz = new Float64Array(N);
  const px = new Array(N);   // the SHARED position objects — we write straight through them
  nodes.forEach((n, i) => {
    const p = positions.get(n.id);
    px[i] = p;
    x[i] = p.x;
    z[i] = p.z;
  });

  // ---- degrees (over the DRAWN links, matching what the renderer shows) ----
  const degree = new Int32Array(N);
  for (const l of links) { degree[l.a]++; degree[l.b]++; }

  /* Rest lengths straight off the seed, and d3's two link coefficients.
     strength = 1 / min(deg a, deg b)  — hub softening. A leaf (deg 1) bonded to the hub gets strength 1:
     it has nothing else holding it, so it must follow. Two hubs get a weak spring and negotiate.
     bias     = deg a / (deg a + deg b) — how the correction is SPLIT. The higher-degree end moves less,
     because it is anchored by everything else pulling on it. */
  const restLen = new Float64Array(links.length);
  const linkStr = new Float64Array(links.length);
  const linkBias = new Float64Array(links.length);
  links.forEach((l, i) => {
    const dx = x[l.b] - x[l.a], dz = z[l.b] - z[l.a];
    restLen[i] = Math.max(Math.hypot(dx, dz) * params.linkScale, 1e-6);
    const da = degree[l.a], db = degree[l.b];
    linkStr[i] = 1 / Math.min(da, db);
    linkBias[i] = da / (da + db);
  });

  // "A few link-lengths": the repulsion cap, derived from the MEDIAN seeded link — a mean would be dragged
  // upward by the hub's 44 long spokes and the cap would stop capping anything.
  const sortedRest = Array.from(restLen).sort((a, b) => a - b);
  const medianRest = sortedRest.length ? sortedRest[sortedRest.length >> 1] : 1;
  let distanceMax = medianRest * params.distanceMaxMul;
  let distanceMax2 = distanceMax * distanceMax;

  // ---- pinning (PITFALL 2): a pinned node is removed from integration but still pushes/pulls others ----
  const pinned = new Uint8Array(N);
  const fx = new Float64Array(N);
  const fz = new Float64Array(N);
  let pinnedCount = 0;

  let alpha = params.alphaInit;
  let alphaTarget = params.alphaTarget;
  let settled = false;
  let ticks = 0;
  let moved = false;   // did the LAST tick() change any position? drives the renderer's upload skip

  function pin(id, nx, nz) {
    const i = index.get(id);
    if (i == null) return;
    if (!pinned[i]) { pinned[i] = 1; pinnedCount++; }
    fx[i] = nx; fz[i] = nz;
    vx[i] = 0; vz[i] = 0;
    // Apply immediately so a drag tracks the finger even on a frame where no fixed step runs.
    x[i] = nx; z[i] = nz;
    px[i].x = nx; px[i].z = nz;
    moved = true;
  }
  function unpin(id) {
    const i = index.get(id);
    if (i == null || !pinned[i]) return;
    pinned[i] = 0; pinnedCount--;
    // Velocity stays 0: the node rejoins the sim at rest and is carried out by its neighbours' pull.
    // (d3 does the same. Injecting the pointer's velocity here reads as a "throw", which Obsidian doesn't do.)
  }
  function unpinAll() { for (const n of nodes) unpin(n.id); }

  /* reheat(target) — §9's interaction contract. Drag start: reheat(0.3). Release: reheat(0).
     alpha CLIMBS toward alphaTarget through the same first-order filter that cools it, so a drag warms the
     neighbourhood without re-exploding the layout the way alpha = 1 would. */
  function reheat(target = params.dragAlphaTarget) {
    alphaTarget = target;
    if (target > 0) {
      settled = false;
      if (alpha < target) alpha = Math.max(alpha, params.alphaMin * 2);   // un-stick a hard-stopped sim
    }
  }

  // ---- one FIXED step (PITFALL 1: this function has no concept of real time) ----
  function step() {
    alpha += (alphaTarget - alpha) * params.alphaDecay;

    // PITFALL 3 — HARD STOP. Not "skip the render": stop integrating, snap alpha and every velocity to
    // exactly 0, so successive rest frames are bit-identical and nothing jitters in the last significant bit.
    if (alpha < params.alphaMin && pinnedCount === 0) {
      alpha = 0;
      vx.fill(0); vz.fill(0);
      settled = true;
      return false;
    }

    // --- REPULSION: all pairs, equal and opposite. O(n²) — 990 pairs at 45 nodes, sub-millisecond. ---
    const rep = params.repulsion * alpha;
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        let dx = x[j] - x[i];
        let dz = z[j] - z[i];
        let l = dx * dx + dz * dz;
        if (l > distanceMax2) continue;              // the cap: far clusters stop creeping
        if (l < 1e-6) { dx = 1e-3; dz = 1e-3; l = 2e-6; }   // coincident nodes: nudge deterministically
        const w = rep / l;                            // strength is negative → w negative → they separate
        const ix = dx * w, iz = dz * w;
        if (!pinned[i]) { vx[i] += ix; vz[i] += iz; }
        if (!pinned[j]) { vx[j] -= ix; vz[j] -= iz; }   // pinned nodes still SOURCE force, never receive it
      }
    }

    // --- LINK SPRINGS. d3 evaluates the spring at the VELOCITY-ANTICIPATED position (x + vx): that is the
    //     "semi-implicit" in semi-implicit Euler, and it is what keeps stiff springs from ringing. ---
    for (let k = 0; k < links.length; k++) {
      const a = links[k].a, b = links[k].b;
      let dx = (x[b] + vx[b]) - (x[a] + vx[a]);
      let dz = (z[b] + vz[b]) - (z[a] + vz[a]);
      let l = Math.hypot(dx, dz);
      if (l < 1e-9) { dx = 1e-3; dz = 0; l = 1e-3; }
      const f = ((l - restLen[k]) / l) * alpha * linkStr[k];
      const ix = dx * f, iz = dz * f;
      const bias = linkBias[k];
      if (!pinned[b]) { vx[b] -= ix * bias; vz[b] -= iz * bias; }
      if (!pinned[a]) { vx[a] += ix * (1 - bias); vz[a] += iz * (1 - bias); }
    }

    // --- INTEGRATE: damp, then advance. One multiplier, applied per TICK (never per second). ---
    const keep = 1 - params.velocityDecay;
    moved = false;
    for (let i = 0; i < N; i++) {
      if (pinned[i]) { x[i] = fx[i]; z[i] = fz[i]; vx[i] = 0; vz[i] = 0; continue; }
      vx[i] = clampVel(vx[i] * keep, params.velEpsilon);
      vz[i] = clampVel(vz[i] * keep, params.velEpsilon);
      if (vx[i] !== 0 || vz[i] !== 0) { x[i] += vx[i]; z[i] += vz[i]; moved = true; }
    }

    // --- CENTERING: translate the whole cloud so its centroid returns to the origin. Adds no energy. ---
    if (params.centerStrength > 0 && N > 0) {
      let cx = 0, cz = 0;
      for (let i = 0; i < N; i++) { cx += x[i]; cz += z[i]; }
      cx = (cx / N) * params.centerStrength;
      cz = (cz / N) * params.centerStrength;
      if (cx !== 0 || cz !== 0) {
        for (let i = 0; i < N; i++) {
          if (pinned[i]) continue;   // a pinned node is where the user put it; do not slide it
          x[i] -= cx; z[i] -= cz;
        }
        moved = true;
      }
    }

    // Publish into the SHARED position objects. Everything downstream reads these — no copies, no events.
    for (let i = 0; i < N; i++) { px[i].x = x[i]; px[i].z = z[i]; }
    ticks++;
    return true;
  }

  /* tick(nSteps) — run up to nSteps fixed steps. Returns true if anything moved. Below alphaMin with
     nothing pinned this is a single comparison and an early return: a settled graph costs no CPU. */
  function tick(nSteps = 1) {
    if (settled && pinnedCount === 0) { moved = false; return false; }
    let any = false;
    for (let s = 0; s < nSteps; s++) any = step() || any;
    return any || moved;
  }

  /* settleNow(maxSteps) — run the sim to convergence with nothing painted. Used by prefers-reduced-motion:
     the graph is already at rest on the first frame the user ever sees, so there is no boot animation to
     dislike. Also how the tests reach a rest state without a clock. */
  function settleNow(maxSteps = 4000) {
    let s = 0;
    while (!settled && s < maxSteps) { step(); s++; }
    return s;
  }

  function kineticEnergy() {
    let e = 0;
    for (let i = 0; i < N; i++) e += vx[i] * vx[i] + vz[i] * vz[i];
    return e;
  }

  /* linkStrengthOf(fromId, toId) — the hub-softening coefficient, exposed so a test can assert the ORDERING
     (a leaf's link outranks a hub-to-hub link) rather than eyeballing that hubs don't crush leaves. */
  function linkStrengthOf(fromId, toId) {
    const a = index.get(fromId), b = index.get(toId);
    if (a == null || b == null) return 0;
    for (let k = 0; k < links.length; k++) {
      if ((links[k].a === a && links[k].b === b) || (links[k].a === b && links[k].b === a)) return linkStr[k];
    }
    return 0;
  }

  /* setParams — live tuning (the atlas exposes ?sim= so feel iteration needs no rebuild). Rest lengths are
     NOT recomputed: they are a property of the seed, not of the tuning. */
  function setParams(patch = {}) {
    Object.assign(params, patch);
    distanceMax = medianRest * params.distanceMaxMul;
    distanceMax2 = distanceMax * distanceMax;
    if (patch.alphaTarget != null) alphaTarget = patch.alphaTarget;
  }

  function dispose() { unpinAll(); }

  return {
    tick, step, settleNow, reheat, pin, unpin, unpinAll,
    kineticEnergy, linkStrengthOf, setParams, dispose,
    get params() { return params; },
    get alpha() { return alpha; },
    get alphaTarget() { return alphaTarget; },
    get settled() { return settled && pinnedCount === 0; },
    get pinnedCount() { return pinnedCount; },
    get ticks() { return ticks; },
    get moved() { return moved; },
    get nodeCount() { return N; },
    get linkCount() { return links.length; },
    get restLengths() { return restLen; },
  };
}
