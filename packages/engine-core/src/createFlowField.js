/* ============================================================
   @lgr/engine-core — createFlowField (Lesson M3: flow-field horde pathing).
   ------------------------------------------------------------
   THE ABILITY: hundreds of agents stream toward a moving target, flowing AROUND obstacles, for the
   price of ONE grid solve shared by the whole crowd — after that each agent pays a single array lookup
   per step. This is the classic RTS/"flow field" (a.k.a. vector-field / integration-field) crowd
   technique: instead of every agent running its own path search (N searches per frame = death at
   scale), we solve the field ONCE from the target outward, then every agent just reads the arrow in
   its cell.

   WHY (settled in the brief): The Hoard's v1 zombies straight-line seek — `hoard.js:534-541` sets a
   desired velocity of `(dx/td)*speed` straight at the survivor — so they bunch against tree push-out
   and can't route around cover. A flow field is first-party, arena-scaled, and the top-3 leverage item
   in the recon. Navmesh (recast) was considered and deferred: overkill for a flat arena.

   ── THREE PARTS, all pure number-crunching (this module imports NOTHING — no THREE, no GPU — so it is
      directly node-testable and the game just consumes the vectors):

   1. THE GRID — a uniform lattice over the arena's axis-aligned bounding box (AABB). Each cell is either
      OPEN or BLOCKED. Obstacles (the forest's tree colliders `{x,z,r}`, plus optional AABB barriers) are
      "rasterized": a cell is blocked if its centre sits inside an obstacle, inflated by the agent radius
      (so the path keeps a body's width of clearance — this is "configuration space" in robotics: grow
      the obstacles by the mover's radius, then treat the mover as a point).

   2. THE INTEGRATION FIELD — a breadth-first flood (BFS) outward from the target's cell across OPEN
      cells. `cost[cell]` = how many grid steps that cell is from the target (−1 = unreached). BFS uses
      8-connectivity (orthogonal + diagonal), and REFUSES to cut a diagonal between two blocked cells
      (no squeezing through a corner gap). Key property we rely on: because BFS reaches every cell from a
      neighbour exactly one step closer to the target, EVERY reachable open cell has at least one
      strictly-lower-cost neighbour — so the field has NO local minima except the target itself. Agents
      following it downhill can never get stuck in a pocket (the failure mode of naive "walk toward the
      target" steering). We use uniform step cost (Chebyshev), not √2-weighted diagonals: that keeps the
      solve a plain O(N) BFS with a preallocated ring queue (no priority heap), and the no-local-minima
      guarantee is what actually matters for steering — exact Euclidean distances do not.
      (A true octile Dijkstra would weight diagonals by 1.414 for Euclidean-accurate distances; noted for
      the curious, not needed here.)

   3. THE DIRECTION FIELD — for each open cell, pick the OPEN neighbour with the lowest cost and store the
      unit vector pointing at it. `sample(x,z)` maps a world position to its cell and returns that arrow.
      The target cell and any unreachable/blocked cell return (0,0) → the agent idles instead of
      exploding toward NaN (the brief's "unreachable target: agents idle, not explode").

   Plus an OPTIONAL `separate()` helper (spatial-hash neighbour push): a field steers a crowd toward the
   target but does nothing to stop agents overlapping — there is NO zombie-zombie separation anywhere in
   the game today, so field-steered crowds would stack into one thick line. `separate()` gives the game a
   cheap, capped-neighbour anti-overlap push it can choose to add. The game decides whether to call it.

   C++ anchors:
     • the typed arrays (Int32Array cost, Float32Array dir) ≈ raw `int*` / `float*` buffers you'd malloc
       once and reuse — no per-frame allocation, the hot-loop discipline this engine holds everywhere.
     • the BFS ring queue ≈ a fixed-capacity circular buffer of cell indices; head/tail chase each other.
     • `sample()` returning a shared scratch object ≈ returning a reference to a reused stack struct
       (the caller must copy if it wants to keep it) — matches the game's `_rc` push-out scratch pattern.

   Contract: createFlowField(opts) -> {
     cols, rows, cellSize, cost, dir, blocked,        // grid + fields (exposed for tests/inspection)
     solve(tx,tz), update(tx,tz,dt), sample(x,z,out), // per-frame API
     isBlocked(x,z), costAt(x,z), worldToCell(x,z,out),
     separate(agents, count, outPush, opts),          // optional anti-overlap
     dispose(),
   }
   ============================================================ */

// The 8 neighbour offsets, ordered orthogonals-first then diagonals. `dcost` marks diagonals so we can
// apply the no-corner-cutting rule. Directions are pre-normalized (diagonals × 1/√2) so the direction
// field needs no per-cell sqrt.
const INV_SQRT2 = 0.7071067811865476;
const NEI = [
  { dx:  1, dz:  0, diag: false, nx:  1,          nz:  0 },
  { dx: -1, dz:  0, diag: false, nx: -1,          nz:  0 },
  { dx:  0, dz:  1, diag: false, nx:  0,          nz:  1 },
  { dx:  0, dz: -1, diag: false, nx:  0,          nz: -1 },
  { dx:  1, dz:  1, diag: true,  nx:  INV_SQRT2,  nz:  INV_SQRT2 },
  { dx:  1, dz: -1, diag: true,  nx:  INV_SQRT2,  nz: -INV_SQRT2 },
  { dx: -1, dz:  1, diag: true,  nx: -INV_SQRT2,  nz:  INV_SQRT2 },
  { dx: -1, dz: -1, diag: true,  nx: -INV_SQRT2,  nz: -INV_SQRT2 },
];

export function createFlowField(opts = {}) {
  // ---- BOUNDS: accept an explicit AABB, or a disk (center + radius) which the flat arena thinks in. ----
  let { bounds } = opts;
  if (!bounds) {
    const c = opts.center || { x: 0, z: 0 };
    const R = opts.radius != null ? opts.radius : 10;
    bounds = { minX: c.x - R, minZ: c.z - R, maxX: c.x + R, maxZ: c.z + R };
  }
  const cellSize = opts.cellSize || 0.5;
  const agentRadius = opts.agentRadius || 0;
  // re-solve when the target has moved more than this many cells since the last solve (default 1 cell),
  // or — if resolveInterval > 0 — at least every that-many seconds regardless (a slow safety re-solve).
  const resolveEpsilon = opts.resolveEpsilon != null ? opts.resolveEpsilon : 1;
  const resolveInterval = opts.resolveInterval || 0;

  const minX = bounds.minX, minZ = bounds.minZ;
  const cols = Math.max(1, Math.ceil((bounds.maxX - minX) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.maxZ - minZ) / cellSize));
  const N = cols * rows;

  // ---- PREALLOCATED STATE (malloc-once; the solve reuses these every frame, zero per-frame alloc) ----
  const blocked = new Uint8Array(N);      // 1 = obstacle cell (impassable)
  const cost = new Int32Array(N);         // BFS depth from target; −1 = unreached/unreachable
  const dir = new Float32Array(N * 2);    // unit steering vector per cell (0,0 at target / dead cells)
  const queue = new Int32Array(N);        // BFS ring buffer of cell indices (each cell enqueued ≤ once)

  const idx = (gx, gz) => gz * cols + gx;
  const inGrid = (gx, gz) => gx >= 0 && gx < cols && gz >= 0 && gz < rows;
  const cellCenterX = (gx) => minX + (gx + 0.5) * cellSize;
  const cellCenterZ = (gz) => minZ + (gz + 0.5) * cellSize;

  // ---- RASTERIZE OBSTACLES → the `blocked` mask (once at build; call rebuildObstacles to refresh). ----
  function rebuildObstacles(obstacles = opts.obstacles || [], aabbs = opts.aabbs || []) {
    blocked.fill(0);
    // Circles (tree colliders): block every cell whose centre lies within (r + agentRadius). We only scan
    // the cells in the circle's own bounding box — not the whole grid — so this is cheap even with many
    // trees. (config-space: obstacle grown by the mover's radius so the point-sized path keeps clearance.)
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      const rr = (o.r || 0) + agentRadius, rr2 = rr * rr;
      const gx0 = Math.max(0, Math.floor((o.x - rr - minX) / cellSize));
      const gx1 = Math.min(cols - 1, Math.floor((o.x + rr - minX) / cellSize));
      const gz0 = Math.max(0, Math.floor((o.z - rr - minZ) / cellSize));
      const gz1 = Math.min(rows - 1, Math.floor((o.z + rr - minZ) / cellSize));
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) {
        const dx = cellCenterX(gx) - o.x, dz = cellCenterZ(gz) - o.z;
        if (dx * dx + dz * dz <= rr2) blocked[idx(gx, gz)] = 1;
      }
    }
    // AABB obstacles (barriers), also inflated by the agent radius.
    for (let i = 0; i < aabbs.length; i++) {
      const b = aabbs[i], m = agentRadius;
      const gx0 = Math.max(0, Math.floor((b.minX - m - minX) / cellSize));
      const gx1 = Math.min(cols - 1, Math.floor((b.maxX + m - minX) / cellSize));
      const gz0 = Math.max(0, Math.floor((b.minZ - m - minZ) / cellSize));
      const gz1 = Math.min(rows - 1, Math.floor((b.maxZ + m - minZ) / cellSize));
      for (let gz = gz0; gz <= gz1; gz++) for (let gx = gx0; gx <= gx1; gx++) blocked[idx(gx, gz)] = 1;
    }
  }
  rebuildObstacles();

  // ---- worldToCell: clamp into the grid so an out-of-bounds query still reads a valid edge cell. ----
  const _cell = { gx: 0, gz: 0 };
  function worldToCell(x, z, out = _cell) {
    let gx = Math.floor((x - minX) / cellSize);
    let gz = Math.floor((z - minZ) / cellSize);
    if (gx < 0) gx = 0; else if (gx >= cols) gx = cols - 1;
    if (gz < 0) gz = 0; else if (gz >= rows) gz = rows - 1;
    out.gx = gx; out.gz = gz;
    return out;
  }

  // ---- THE SOLVE: BFS integration flood from the target cell, then bake the direction field. ----
  let _tgx = -1, _tgz = -1, _sinceSolve = 0, _solves = 0;
  function solve(tx, tz) {
    const t = worldToCell(tx, tz);
    // If the target cell is itself blocked (survivor standing on/inside a trunk cell — shouldn't happen,
    // but be robust), nudge the seed to the nearest open cell in a small ring so the field still forms.
    let seed = idx(t.gx, t.gz);
    if (blocked[seed]) seed = nearestOpen(t.gx, t.gz);
    _tgx = t.gx; _tgz = t.gz; _sinceSolve = 0; _solves++;

    cost.fill(-1);
    if (seed < 0) { dir.fill(0); return; }   // no open cell at all → everyone idles

    // BFS: ring queue, each cell enqueued at most once (guarded by cost[c] === -1).
    let head = 0, tail = 0;
    cost[seed] = 0; queue[tail++] = seed;
    while (head < tail) {
      const c = queue[head++];
      const cgx = c % cols, cgz = (c - cgx) / cols, cc = cost[c];
      for (let n = 0; n < 8; n++) {
        const o = NEI[n];
        const ngx = cgx + o.dx, ngz = cgz + o.dz;
        if (!inGrid(ngx, ngz)) continue;
        const ni = idx(ngx, ngz);
        if (blocked[ni] || cost[ni] !== -1) continue;
        // No corner-cutting: a diagonal step is only legal if BOTH shared orthogonal cells are open,
        // else the agent would clip through the corner where two trees touch.
        if (o.diag && (blocked[idx(cgx + o.dx, cgz)] || blocked[idx(cgx, cgz + o.dz)])) continue;
        cost[ni] = cc + 1;
        queue[tail++] = ni;
      }
    }
    bakeDirections();
  }

  // Direction field: each open non-target cell points at its lowest-cost open neighbour (guaranteed to be
  // strictly closer, by the BFS property). Target/unreached/blocked cells → (0,0) = idle.
  function bakeDirections() {
    for (let c = 0; c < N; c++) {
      const cc = cost[c];
      if (cc <= 0) { dir[c * 2] = 0; dir[c * 2 + 1] = 0; continue; }   // target (0) or unreached (−1)
      const cgx = c % cols, cgz = (c - cgx) / cols;
      let best = cc, bnx = 0, bnz = 0;
      for (let n = 0; n < 8; n++) {
        const o = NEI[n];
        const ngx = cgx + o.dx, ngz = cgz + o.dz;
        if (!inGrid(ngx, ngz)) continue;
        const ni = idx(ngx, ngz);
        const nc = cost[ni];
        if (nc < 0 || blocked[ni]) continue;
        if (o.diag && (blocked[idx(cgx + o.dx, cgz)] || blocked[idx(cgx, cgz + o.dz)])) continue;
        if (nc < best) { best = nc; bnx = o.nx; bnz = o.nz; }
      }
      dir[c * 2] = bnx; dir[c * 2 + 1] = bnz;
    }
  }

  // Spiral outward from a blocked seed cell to find the nearest open cell (bounded small search).
  function nearestOpen(gx, gz) {
    for (let ring = 1; ring < Math.max(cols, rows); ring++) {
      for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;   // ring perimeter only
        const nx = gx + dx, nz = gz + dz;
        if (inGrid(nx, nz) && !blocked[idx(nx, nz)]) return idx(nx, nz);
      }
    }
    return -1;
  }

  // ---- update: the per-frame call. Re-solve only when the target moved > resolveEpsilon cells (or the
  //      optional interval elapsed). Returns true if it re-solved this frame (handy for the perf probe). ----
  function update(tx, tz, dt = 0) {
    _sinceSolve += dt;
    const t = worldToCell(tx, tz);
    const moved = Math.max(Math.abs(t.gx - _tgx), Math.abs(t.gz - _tgz));
    const intervalDue = resolveInterval > 0 && _sinceSolve >= resolveInterval;
    if (_tgx < 0 || moved > resolveEpsilon || intervalDue) { solve(tx, tz); return true; }
    return false;
  }

  // ---- sample: world position → steering unit vector. Zero-alloc (writes into `out`, or a shared
  //      scratch if none given — caller must copy the scratch if it needs to persist it). ----
  const _out = { x: 0, z: 0 };
  function sample(x, z, out = _out) {
    const t = worldToCell(x, z);
    const c = idx(t.gx, t.gz);
    out.x = dir[c * 2]; out.z = dir[c * 2 + 1];
    return out;
  }

  function isBlocked(x, z) { const t = worldToCell(x, z); return blocked[idx(t.gx, t.gz)] === 1; }
  function costAt(x, z) { const t = worldToCell(x, z); return cost[idx(t.gx, t.gz)]; }

  /* ============================================================
     SEPARATION (optional anti-overlap) — a spatial-hash neighbour push. Field steering pulls the whole
     crowd at the same target, so without this they collapse onto one line. For each agent we gather up to
     `maxNeighbors` others within `radius` and accumulate a push away from them (weighted by closeness),
     writing a push vector per agent into the caller-owned `outPush` (Float32Array, length ≥ 2*count). The
     game adds `push * strength` to each agent's velocity — or ignores it. Capped neighbours keep it O(n)
     even when a clump forms (the naive all-pairs push is O(n²) and spikes exactly when the crowd bunches).

     Spatial hash: a coarse grid of buckets; each agent is inserted into its bucket, and neighbour queries
     scan the agent's 3×3 bucket window. Bucket size ≥ radius guarantees every in-radius neighbour is in
     that window. The linked-list arrays are preallocated for `maxAgents`; the bucket-head array is sized
     to the hash grid and only reallocated if `radius` changes (rare) — steady-state zero-alloc.
     C++ anchor: `_sepHead`/`_sepNext` are an intrusive singly-linked list over a bucket array — head[b]
     is the first agent index in bucket b, next[i] chains to the following agent, −1 terminates. ============================================================ */
  const maxAgents = opts.maxAgents || 512;
  const _sepNext = new Int32Array(maxAgents);
  let _sepHead = null, _sepRadius = -1, _hCols = 0, _hRows = 0, _hCell = 0;
  function ensureHash(radius) {
    if (radius === _sepRadius && _sepHead) return;
    _sepRadius = radius;
    _hCell = Math.max(radius, cellSize);
    _hCols = Math.max(1, Math.ceil((bounds.maxX - minX) / _hCell));
    _hRows = Math.max(1, Math.ceil((bounds.maxZ - minZ) / _hCell));
    _sepHead = new Int32Array(_hCols * _hRows);
  }
  function separate(agents, count, outPush, sopts = {}) {
    const radius = sopts.radius || 0.6;
    const maxNeighbors = sopts.maxNeighbors || 6;
    const r2 = radius * radius;
    const n = Math.min(count, maxAgents);
    ensureHash(radius);
    _sepHead.fill(-1);
    // insert
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      let hx = Math.floor((a.x - minX) / _hCell), hz = Math.floor((a.z - minZ) / _hCell);
      if (hx < 0) hx = 0; else if (hx >= _hCols) hx = _hCols - 1;
      if (hz < 0) hz = 0; else if (hz >= _hRows) hz = _hRows - 1;
      const b = hz * _hCols + hx;
      _sepNext[i] = _sepHead[b]; _sepHead[b] = i;
    }
    // push
    for (let i = 0; i < n; i++) {
      const a = agents[i];
      let px = 0, pz = 0, seen = 0;
      let hx = Math.floor((a.x - minX) / _hCell), hz = Math.floor((a.z - minZ) / _hCell);
      if (hx < 0) hx = 0; else if (hx >= _hCols) hx = _hCols - 1;
      if (hz < 0) hz = 0; else if (hz >= _hRows) hz = _hRows - 1;
      for (let bz = hz - 1; bz <= hz + 1 && seen < maxNeighbors; bz++) {
        if (bz < 0 || bz >= _hRows) continue;
        for (let bx = hx - 1; bx <= hx + 1 && seen < maxNeighbors; bx++) {
          if (bx < 0 || bx >= _hCols) continue;
          for (let j = _sepHead[bz * _hCols + bx]; j !== -1; j = _sepNext[j]) {
            if (j === i) continue;
            const b = agents[j];
            const dx = a.x - b.x, dz = a.z - b.z, d2 = dx * dx + dz * dz;
            if (d2 >= r2 || d2 <= 1e-12) continue;
            const d = Math.sqrt(d2), w = (radius - d) / radius / d;   // closer ⇒ harder push; /d normalizes
            px += dx * w; pz += dz * w;
            if (++seen >= maxNeighbors) break;
          }
        }
      }
      outPush[i * 2] = px; outPush[i * 2 + 1] = pz;
    }
  }

  return {
    cols, rows, cellSize, N, bounds,
    cost, dir, blocked,
    solve, update, sample, isBlocked, costAt, worldToCell, rebuildObstacles,
    separate,
    get solves() { return _solves; },
    dispose() { /* pure typed arrays — GC reclaims them; nothing GPU to free. */ },
  };
}
