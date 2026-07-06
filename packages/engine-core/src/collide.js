/* ============================================================
   collide.js — Lesson 108 (part C): FLIGHT COLLISION — the piloted craft stops flying through
   buildings, via a soft MOVE-AND-SLIDE push-out. Engine ability (crafts inherit it; no gameplay).
   ------------------------------------------------------------
   THE ONE IDEA — move-and-slide (the classic character-controller resolve, Quake's PM_SlideMove /
   Unreal's SlideAlongSurface): each frame the movement model INTEGRATES the craft forward (partly
   INTO a wall), then we DETECT the overlap and PUSH the craft back out along the surface normal.
   The craft keeps a SCALAR speed along a yaw heading (not a velocity vector), so we clip POSITION,
   not velocity — the net motion becomes the tangential (sliding) component for free, and because we
   never touch yaw/speed-sign the chase camera (slaved to yaw) stays serene. No bounce, no hard stop.

   TWO PHASES (standard collision structure):
   • BROAD phase — a uniform GRID over the city footprint buckets every building AABB into the cells
     it overlaps, so a query only tests the handful of boxes near the craft (not all ~400-700).
   • NARROW phase — sphere-vs-AABB: the craft is a SPHERE (cabin-sized; rotor overlap is an accepted
     arcade cheat so grazes feel forgiving). Closest point on the box → penetration normal + depth →
     a capped push-out + a head-on speed scrub (slide friction).

   AABB = Axis-Aligned Bounding Box (see GLOSSARY): a min/max corner pair; buildings are unrotated
   prisms so their exact AABB is just position ± half-size. Solids arrive as a packed SoA
   Float32Array (6 floats/solid: minX,minY,minZ, maxX,maxY,maxZ) built at generate-time in citygen.

   C++ anchor: the grid is a `std::unordered_map<cellHash, std::vector<int>>`; resolveSphere is the
   inner loop of a kinematic character controller — integrate, find the deepest overlap, clip to the
   plane, repeat a couple of times for corners. Zero allocation in the hot path (scratch reused).
   ============================================================ */

/* Build a collider world over a uniform grid. `cell` = the city block PITCH (the grid the city IS). */
export function createColliderWorld({ cell = 2.45 } = {}) {
  let solids = null;      // Float32Array, 6 floats/solid — the packed AABB list (owned by citygen)
  let count = 0;          // number of solids
  let enabled = true;     // the "ghost" toggle — off = the craft passes through (dev free-fly / S7)
  const grid = new Map(); // cellHash → array of solid indices

  // A 2D cell hash (Morton-ish XOR of two large primes) — stable, collision-rare over the small city grid.
  const keyOf = (cx, cz) => (cx * 73856093) ^ (cz * 19349663);

  /* rebuild(solids): re-bucket the AABB list into the grid. Called on every city generate/reroll/
     profile-swap (O(n), sub-ms). A null/empty list clears the world (world mode with no props → no-op). */
  function rebuild(newSolids) {
    solids = (newSolids && newSolids.length) ? newSolids : null;
    count = solids ? (solids.length / 6) | 0 : 0;
    grid.clear();
    for (let i = 0; i < count; i++) {
      const b = i * 6;
      const cx0 = Math.floor(solids[b]     / cell), cx1 = Math.floor(solids[b + 3] / cell);
      const cz0 = Math.floor(solids[b + 2] / cell), cz1 = Math.floor(solids[b + 5] / cell);
      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const k = keyOf(cx, cz);
        let arr = grid.get(k); if (!arr) { arr = []; grid.set(k, arr); }
        arr.push(i);
      }
    }
  }

  // A per-query "seen" stamp so a solid spanning several cells is tested ONCE per resolve iteration
  // (cheaper + avoids a double-count of its penetration). Grows lazily to `count`.
  let stamp = new Int32Array(0), stampGen = 0;
  function ensureStamp() { if (stamp.length < count) stamp = new Int32Array(count); }

  /* The core: given the craft `state` (x,y,z,speed,yaw,vy — mutated in place), push a sphere at
     (x, y+yOff, z) radius r out of every overlapping AABB. dt drives the per-frame push cap + the
     slide-friction scrub. Up to 3 iterations resolve a corner wedged between two towers. */
  function resolveSphere(state, dt, cfg) {
    if (!enabled || !count) return;
    const r    = cfg.r ?? 0.5;
    const yOff = cfg.yOff ?? 0.45;
    const PUSH_MAX = cfg.PUSH_MAX ?? 12.0;   // per-frame push cap (u/s) — MUST exceed craft maxSpeed or a head-on ram out-runs it + tunnels; still eases deep pops over frames
    const FRIC = cfg.SLIDE_FRICTION ?? 1.8;  // head-on speed scrub; grazing ≈ free
    const SKIN = cfg.SKIN ?? 0.02;           // contact deadband so a resting craft doesn't shimmer
    ensureStamp();

    for (let iter = 0; iter < 3; iter++) {
      const px = state.x, py = state.y + yOff, pz = state.z;
      const cx0 = Math.floor((px - r) / cell), cx1 = Math.floor((px + r) / cell);
      const cz0 = Math.floor((pz - r) / cell), cz1 = Math.floor((pz + r) / cell);
      const gen = ++stampGen;
      // ACCUMULATE the push-out vector across ALL overlapping boxes (sum of MTVs — Minimum Translation Vectors).
      // Why sum, not just the single deepest: when the sphere is wedged deep between two TOUCHING boxes, the
      // nearest-face normals point in OPPOSITE directions; summing cancels them horizontally and the residual
      // points UP (the sky is always open above a building) → the craft escapes instead of ping-ponging forever
      // ("stuck inside a building" — the exact bug this feature fixes). A single wall → sum == that one MTV
      // (unchanged); a corner → a clean diagonal. maxDepth drives the move magnitude (deepest overlap).
      let sx = 0, sy = 0, sz = 0, maxDepth = 0, hit = false;

      for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
        const arr = grid.get(keyOf(cx, cz)); if (!arr) continue;
        for (let a = 0; a < arr.length; a++) {
          const i = arr[a];
          if (stamp[i] === gen) continue; stamp[i] = gen;   // already tested this iteration
          const b = i * 6;
          // closest point on the AABB to the sphere centre
          const qx = px < solids[b]     ? solids[b]     : px > solids[b + 3] ? solids[b + 3] : px;
          const qy = py < solids[b + 1] ? solids[b + 1] : py > solids[b + 4] ? solids[b + 4] : py;
          const qz = pz < solids[b + 2] ? solids[b + 2] : pz > solids[b + 5] ? solids[b + 5] : pz;
          const dx = px - qx, dy = py - qy, dz = pz - qz;
          const d2 = dx * dx + dy * dy + dz * dz;
          if (d2 > r * r) continue;   // sphere doesn't reach this box

          if (d2 > 1e-8) {            // centre OUTSIDE the box → normal is the closest-point direction
            const d = Math.sqrt(d2), depth = r - d;
            sx += (dx / d) * depth; sy += (dy / d) * depth; sz += (dz / d) * depth;
            if (depth > maxDepth) maxDepth = depth; hit = true;
          } else {                    // centre INSIDE the box → push out along the least-penetrated face
            const exMin = px - solids[b], exMax = solids[b + 3] - px;
            const eyMin = py - solids[b + 1], eyMax = solids[b + 4] - py;
            const ezMin = pz - solids[b + 2], ezMax = solids[b + 5] - pz;
            let m = exMin, nx = -1, ny = 0, nz = 0;
            if (exMax < m) { m = exMax; nx = 1;  ny = 0; nz = 0; }
            if (eyMin < m) { m = eyMin; nx = 0;  ny = -1; nz = 0; }
            if (eyMax < m) { m = eyMax; nx = 0;  ny = 1;  nz = 0; }
            if (ezMin < m) { m = ezMin; nx = 0;  ny = 0;  nz = -1; }
            if (ezMax < m) { m = ezMax; nx = 0;  ny = 0;  nz = 1; }
            const depth = m + r;
            sx += nx * depth; sy += ny * depth; sz += nz * depth;
            if (depth > maxDepth) maxDepth = depth; hit = true;
          }
        }
      }

      if (!hit || maxDepth <= SKIN) break;   // clear (or within the deadband) → done

      // Direction = the summed MTV; magnitude = the deepest overlap, capped per-frame (the never-pop guarantee;
      // the cap MUST exceed craft maxSpeed or a head-on ram out-runs it and tunnels — see the profile).
      let slen = Math.hypot(sx, sy, sz);
      let ux, uy, uz;
      if (slen > 1e-4) { ux = sx / slen; uy = sy / slen; uz = sz / slen; }
      else { ux = 0; uy = 1; uz = 0; }   // opposing pushes perfectly cancelled → escape straight UP to open sky
      const mag = Math.min(maxDepth, PUSH_MAX * dt);
      state.x += ux * mag; state.y += uy * mag; state.z += uz * mag;

      // SLIDE FRICTION (the only speed touch): scrub speed by how HEAD-ON the hit is (grazing ≈ free, dead-on →
      // eases to a hover against the wall). Uses the xz component of the resolved push direction vs the heading.
      const nlen = Math.hypot(ux, uz);
      if (nlen > 1e-5) {
        const nfx = ux / nlen, nfz = uz / nlen;
        const dir = Math.sign(state.speed) || 1;       // heading is (sin yaw, cos yaw), signed by speed
        const fwdx = Math.sin(state.yaw) * dir, fwdz = Math.cos(state.yaw) * dir;
        const headOn = Math.max(0, -(fwdx * nfx + fwdz * nfz));
        state.speed -= state.speed * headOn * FRIC * dt;
      }
      // ROOF from above (push points up): stop the downward drift → a stable perch (air has no gravity).
      if (uy > 0.5 && state.vy < 0) state.vy = 0;
    }
  }

  /* depthAt(x,y,z): the MAX penetration depth of a probe sphere at a point (0 = clear) — for the
     headless success probes (S1: ram → depthAt(craft) ≤ SKIN every frame). Read-only. */
  function depthAt(x, y, z, r = 0.5, yOff = 0.45) {
    if (!count) return 0;
    const px = x, py = y + yOff, pz = z;
    const cx0 = Math.floor((px - r) / cell), cx1 = Math.floor((px + r) / cell);
    const cz0 = Math.floor((pz - r) / cell), cz1 = Math.floor((pz + r) / cell);
    let best = 0;
    ensureStamp(); const gen = ++stampGen;
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = grid.get(keyOf(cx, cz)); if (!arr) continue;
      for (let a = 0; a < arr.length; a++) {
        const i = arr[a]; if (stamp[i] === gen) continue; stamp[i] = gen;
        const b = i * 6;
        const qx = px < solids[b] ? solids[b] : px > solids[b + 3] ? solids[b + 3] : px;
        const qy = py < solids[b + 1] ? solids[b + 1] : py > solids[b + 4] ? solids[b + 4] : py;
        const qz = pz < solids[b + 2] ? solids[b + 2] : pz > solids[b + 5] ? solids[b + 5] : pz;
        const dx = px - qx, dy = py - qy, dz = pz - qz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > r * r) continue;
        const depth = r - Math.sqrt(Math.max(0, d2));
        if (depth > best) best = depth;
      }
    }
    return best;
  }

  /* probe(x,y,z): DETERMINISTIC self-test of the narrow phase + resolve for the headless S1 check — place a
     stationary craft-sphere at a point (typically INSIDE a building), resolve a few frames, and report whether it
     escaped. before > 0 (was penetrating) → after ≤ SKIN (pushed clear) + moved > 0 proves the push-out works,
     with no piloting-aim needed. Returns the solid AABBs too so a probe can pick a target. */
  function probe(x, y, z, cfg) {
    const c = cfg || { r: 0.5, yOff: 0.45, PUSH_MAX: 6.0, SLIDE_FRICTION: 1.8, SKIN: 0.02 };
    const before = depthAt(x, y, z, c.r, c.yOff);
    const st = { x, y, z, speed: 0, yaw: 0, vy: 0 };
    for (let i = 0; i < 10; i++) resolveSphere(st, 1 / 60, c);   // ~10 frames to fully ease out a deep start
    const after = depthAt(st.x, st.y, st.z, c.r, c.yOff);
    return { before, after, moved: Math.hypot(st.x - x, st.y - y, st.z - z) };
  }
  function boxAt(i) { const b = i * 6; return [solids[b], solids[b + 1], solids[b + 2], solids[b + 3], solids[b + 4], solids[b + 5]]; }

  /* segmentHit(o→e, radius): sweep a thin sphere along the segment target→desiredEye and return the nearest
     BLOCKING fraction t∈[0,1] (1 = clear). The camera SPRING-ARM's one query: "how far back can the eye sit
     before a building is in the way?" Same shared spatial seam as the sphere queries (engine-first — a future
     line-of-sight test reuses it). Broad phase = the rectangle of grid cells the segment's XZ span crosses
     (mirrors resolveSphere's cell loop — v1 keeps it simple, not a DDA). Narrow phase = the slab method on each
     AABB INFLATED by `radius` on all axes (Minkowski expansion → a swept-sphere approximated as ray-vs-fat-box,
     the same forgiving cheat as the sphere-vs-AABB closest-point; corner error is sub-radius + conservative). */
  function segmentHit(ox, oy, oz, ex, ey, ez, radius = 0.25) {
    if (!enabled || !count) return 1;   // no solids (world mode) → always clear → the arm is inert there
    const dx = ex - ox, dy = ey - oy, dz = ez - oz;
    const cx0 = Math.floor((Math.min(ox, ex) - radius) / cell), cx1 = Math.floor((Math.max(ox, ex) + radius) / cell);
    const cz0 = Math.floor((Math.min(oz, ez) - radius) / cell), cz1 = Math.floor((Math.max(oz, ez) + radius) / cell);
    ensureStamp(); const gen = ++stampGen;
    let nearest = 1;
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = grid.get(keyOf(cx, cz)); if (!arr) continue;
      for (let a = 0; a < arr.length; a++) {
        const i = arr[a]; if (stamp[i] === gen) continue; stamp[i] = gen;
        const b = i * 6;
        // slab test vs the AABB inflated by radius — parametric [tEnter,tExit] where the ray is inside all 3 slabs
        let tEnter = 0, tExit = 1, miss = false;
        // X slab
        let lo = solids[b] - radius, hi = solids[b + 3] + radius;
        if (Math.abs(dx) < 1e-8) { if (ox < lo || ox > hi) miss = true; }
        else { const inv = 1 / dx; let t1 = (lo - ox) * inv, t2 = (hi - ox) * inv; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tEnter) tEnter = t1; if (t2 < tExit) tExit = t2; }
        // Y slab
        if (!miss) { lo = solids[b + 1] - radius; hi = solids[b + 4] + radius;
          if (Math.abs(dy) < 1e-8) { if (oy < lo || oy > hi) miss = true; }
          else { const inv = 1 / dy; let t1 = (lo - oy) * inv, t2 = (hi - oy) * inv; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tEnter) tEnter = t1; if (t2 < tExit) tExit = t2; } }
        // Z slab
        if (!miss) { lo = solids[b + 2] - radius; hi = solids[b + 5] + radius;
          if (Math.abs(dz) < 1e-8) { if (oz < lo || oz > hi) miss = true; }
          else { const inv = 1 / dz; let t1 = (lo - oz) * inv, t2 = (hi - oz) * inv; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; } if (t1 > tEnter) tEnter = t1; if (t2 < tExit) tExit = t2; } }
        if (!miss && tEnter <= tExit && tExit >= 0 && tEnter <= 1) {
          const hitT = tEnter > 0 ? tEnter : 0;   // origin already inside the fat box → t=0 (eye must pull fully in)
          if (hitT < nearest) nearest = hitT;
        }
      }
    }
    return nearest;
  }

  return {
    rebuild, resolveSphere, depthAt, probe, boxAt, segmentHit,
    get count() { return count; },
    active() { return enabled && count > 0; },     // pilot gate: only run the resolve/substep when there ARE solids
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
  };
}
