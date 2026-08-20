/* ============================================================
   carve-pads.js — ARC A-MARRIAGE (2026-08-19): the citygen ↔ terrain MARRIAGE, route 1.
   ------------------------------------------------------------
   THE PROBLEM THIS CLOSES (research-aaa-environments.md §2, the ratified route): "citygen is a flat
   plinth, terrain is an island; they have never met." Every city this engine generates stands on a
   plane at one groundY; every terrain it generates has no room for a city. The standard, proven cure
   is TERRAIN CARVING — flatten a PAD under each block, run a RAMPED street between pads, blend the
   pad edges into the natural ground with a smoothstep embankment (the Cinevva/CityEngine pattern) —
   and the guiding rule the route ratified is MUTATE THE ONE FIELD: this module writes into the
   *existing* Float32Array heightfield (terrain.js's CPU-authoritative single source of truth), then
   the caller refreshes dirty chunks with `rebuildTerrainChunks`. No second field, no separate city
   ground plane, no fork of anything — render, physics, biome classify and future erosion all keep
   reading the ONE buffer they already read.

   THE SHAPE OF THE CARVE (San Francisco, not Kansas):
     · Each grid cell gets a PAD — a flat plateau of side `spacing − streetW`, at a height sampled
       from the wild terrain under it. Buildings stand ON pads; a plaza cell is simply a pad with no
       tower. Flat is what makes A-SKYLINE's swingable arithmetic survive: tower heights author
       relative to PAD TOP, so the rank→height quantile map never learns the terrain exists.
     · Between two adjacent pads the street is a RAMP: a smoothstep profile from pad edge to pad
       edge. Smoothstep, not linear, because BOTH junction kinks vanish — a linear ramp meets its pad
       at a crease, and a crease is a curvature spike the bike's launch inequality (v²·κ > g) reads
       as a kicker. The price is stated arithmetic: a smoothstep over run W with rise Δ has peak
       grade 1.5·Δ/W (its derivative maxes at 1.5× the mean), so the height RELAXATION below budgets
       Δ ≤ maxGrade·W/1.5 and the DIAL keeps its plain meaning — max grade anywhere on the street.
     · Where four streets meet, the surface is the bilinear blend of the four pads (both axis
       weights active at once) — an intersection reads as a saddle, which is the San-Francisco look.
     · Outside the city the carved surface eases into the wild terrain over `blend` u of smoothstep
       EMBANKMENT, so the city sits IN the landscape instead of on a cookie-cutter disc.

   WHY PAD HEIGHTS ARE RELAXED, NOT JUST SAMPLED. Raw terrain means under adjacent pads can differ
   by more than a street can climb. So phase A samples each pad's wild mean, then runs an iterative
   constraint relaxation over the street graph: any neighbour pair further apart than the street's
   budget Δmax is pulled symmetrically toward its midpoint, sweep after sweep, until every street
   fits its own grade dial. (C++ anchor: projection onto a convex constraint set by alternating
   projections — Dykstra without the correction term, fine here because we only need feasibility,
   not the exact nearest point.) The residual is REPORTED, and the real gate is counted off the
   finished grid anyway (grade proof b in carve-pads.test.mjs) — a derivation never checked is a
   wish (the ledger's method).

   THE LATTICE IS A GRID BY CONTRACT, deliberately: both existing city generators (citygen's block
   grid, box-arena's tower grid) are regular lattices, and the ratified route names citygen's LAYOUT
   grid as the input shape. A free-form pad-rect list (for the accepted-but-unimplemented
   `blockPattern: 'organic'`) is the recorded LIFT for the arc that builds organic blocks — building
   its spatial index today would be speculative abstraction (Rule 2).

   COORDINATES match box-arena exactly: cell (i,j) centres at
   ((i − (cols−1)/2) · spacing, (j − (rows−1)/2) · spacing) — pass the same cols/rows/spacing and
   the pads land under the towers by construction.

   C++ anchors: the carve is one pass over a float heightmap writing `h = f(x,z)` — a compute kernel
   with a CPU loop; `padY` is a little row-major float matrix; the whole module is pure data (no
   THREE import), so node tests and probes run it without a renderer.
   ============================================================ */

/* smoothstep on [0,1] — the ramp profile AND the embankment ease. d/dt = 6t(1−t), max 1.5 at t=½. */
const sm01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

/* ============================================================================================
   carveCityPads(terrain, world, layout, opts) → the carve report.
     terrain — generateTerrain's result ({ size, height, biome, sea, relief }). `height` (and, when
               `pave`, `biome`) are MUTATED IN PLACE — the one-field rule. minH/maxH are refreshed.
     world   — { worldSize, baseY }: the SAME mapping object handed to buildTerrainMesh /
               createTerrainSampler. One mapping, three readers, zero drift.
     layout  — { cols, rows, spacing }: the city lattice (box-arena's own three numbers).
     opts    — { streetW  = 1.2,   street width in u; pad side = spacing − streetW
                 maxGrade = 0.25,  the DIAL: max street grade anywhere on the finished surface
                 blend    = 3.0,   embankment width in u from the city rim to wild terrain
                 pave     = true } write the `pavement` biome under pads + streets (mask ≥ 0.999)

   Returns {
     padY,            // Float64Array cols·rows — world-Y of every pad (row-major j·cols+i)
     padYOf(i, j),    // the lookup a groundYAt closure wants
     touched,         // { i0, i1, j0, j1 } texel rect the carve wrote (inclusive) — feed to
                      //   dirtyMeshesFor + rebuildTerrainChunks
     stats: { pads, spacing, streetW, padSide, maxGrade,
              deltaBudget,        // Δmax per street = maxGrade·streetW/1.5 (the smoothstep factor)
              maxPadDelta,        // max |padY(a) − padY(b)| over street pairs AFTER relaxation
              steepestStreet,     // the analytic peak grade that delta implies (1.5·Δ/W)
              relaxSweeps, relaxResidual,   // how the relaxation ended (residual past budget)
              carvedTexels, pavedTexels,
              padMin, padMax },   // the pad height range — the "city relief" number
   }
   ============================================================================================ */
export function carveCityPads(terrain, world, layout, opts = {}) {
  const { size, height, biome, sea, relief } = terrain;
  const { worldSize = 26, baseY = 0 } = world || {};
  const { cols, rows, spacing } = layout;
  const streetW = opts.streetW ?? 1.2;
  const maxGrade = opts.maxGrade ?? 0.25;
  const blend = opts.blend ?? 3.0;
  const pave = opts.pave !== false;

  const P = spacing - streetW;                    // pad side
  if (!(P > 0)) throw new Error(`carveCityPads: streetW ${streetW} leaves no pad (spacing ${spacing})`);
  const cell = worldSize / (size - 1), half = worldSize / 2;
  const cx = (cols - 1) / 2, cz = (rows - 1) / 2; // box-arena's own centring
  const wy = (h) => baseY + (h - sea) * relief;   // normalised → world (buildTerrainMesh's mapping)
  const hn = (y) => (y - baseY) / relief + sea;   // world → normalised (the exact inverse)

  /* ---- PHASE A1: sample each pad's WILD mean off the texels under its footprint. Texel means
     (not analytic re-evaluation) because the finished GRID is the ground truth the pads must agree
     with — the same "count off the finished geometry" rule every guarantee in this repo follows. */
  const padY = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const px = (i - cx) * spacing, pz = (j - cz) * spacing;
      const ti0 = Math.max(0, Math.ceil((px - P / 2 + half) / cell));
      const ti1 = Math.min(size - 1, Math.floor((px + P / 2 + half) / cell));
      const tj0 = Math.max(0, Math.ceil((pz - P / 2 + half) / cell));
      const tj1 = Math.min(size - 1, Math.floor((pz + P / 2 + half) / cell));
      let sum = 0, n = 0;
      for (let tj = tj0; tj <= tj1; tj++) {
        for (let ti = ti0; ti <= ti1; ti++) { sum += height[tj * size + ti]; n++; }
      }
      padY[j * cols + i] = wy(n ? sum / n : height[Math.round((pz + half) / cell) * size + Math.round((px + half) / cell)] || 0);
    }
  }

  /* ---- PHASE A2: RELAX to the street-grade budget. Δmax = maxGrade·W/1.5 — the 1.5 is the
     smoothstep peak-slope factor, budgeted here so the DIAL stays "max grade on the street", not
     "mean grade" (two meanings of one dial is the drift Rule 6 is about). Symmetric pull toward the
     pair midpoint; sweeps capped, residual reported, and the finished-mesh count (proof b) is the
     actual gate. */
  const deltaBudget = maxGrade * streetW / 1.5;
  let sweeps = 0, residual = 0;
  const MAX_SWEEPS = 64 * (cols + rows);
  for (; sweeps < MAX_SWEEPS; sweeps++) {
    let worst = 0;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const a = j * cols + i;
        for (const [di, dj] of [[1, 0], [0, 1]]) {
          const ii = i + di, jj = j + dj;
          if (ii >= cols || jj >= rows) continue;
          const b = jj * cols + ii;
          const d = padY[a] - padY[b];
          const ex = Math.abs(d) - deltaBudget;
          if (ex > 0) {
            const s = Math.sign(d) * ex / 2;
            padY[a] -= s; padY[b] += s;
            if (ex > worst) worst = ex;
          }
        }
      }
    }
    residual = worst;
    if (worst <= 1e-9) break;
  }

  /* ---- PHASE B: THE CARVE — one pass over every texel the city can reach. The married surface is
     a bilinear-with-plateaus blend of the 2×2 nearest pads (weights are smoothstep ramps across the
     streets, flat 0/1 across the pads), eased into the wild field by the embankment mask. ---- */
  const p2 = P / 2;
  /* the city's outer edge = outermost pad edge + the street ring around it (streets exist between
     pads; the rim keeps a half-street apron so the outer ramp has somewhere to finish). */
  const rimX = cx * spacing + p2 + streetW, rimZ = cz * spacing + p2 + streetW;
  const reach = blend + cell;                     // how far past the rim the embankment writes
  const ti0 = Math.max(0, Math.floor((-rimX - reach + half) / cell));
  const ti1 = Math.min(size - 1, Math.ceil((rimX + reach + half) / cell));
  const tj0 = Math.max(0, Math.floor((-rimZ - reach + half) / cell));
  const tj1 = Math.min(size - 1, Math.ceil((rimZ + reach + half) / cell));

  /* per-axis: nearest cell index (clamped to the grid) + the smoothstep weight toward the +1
     neighbour. |off| ≤ p2 → on the pad (w 0); past it → on the ramp; the weight reaches exactly ½
     at the cell boundary, so the two cells' frames agree there (continuous, matched slope). */
  const axis = (wcoord, count, c0) => {
    const f = wcoord / spacing + c0;              // fractional cell coordinate
    const iClamped = Math.min(count - 1, Math.max(0, Math.round(f)));
    const off = (f - iClamped) * spacing;         // world offset from the CLAMPED centre
    let w = 0, nb = iClamped;
    if (off > p2 && iClamped < count - 1) { w = sm01((off - p2) / streetW); nb = iClamped + 1; }
    else if (off < -p2 && iClamped > 0)   { w = sm01((-off - p2) / streetW); nb = iClamped - 1; }
    return { i: iClamped, nb, w };
  };

  let carvedTexels = 0, pavedTexels = 0;
  for (let tj = tj0; tj <= tj1; tj++) {
    const z = tj * cell - half;
    for (let ti = ti0; ti <= ti1; ti++) {
      const x = ti * cell - half;
      /* the embankment mask: 1 inside the rim, easing to 0 over `blend` past it (Chebyshev distance
         to the rim rect — square city, square skirt). */
      const dOut = Math.max(Math.abs(x) - rimX, Math.abs(z) - rimZ);
      const m = dOut <= 0 ? 1 : 1 - sm01(dOut / blend);
      if (m <= 0) continue;
      const ax = axis(x, cols, cx), az = axis(z, rows, cz);
      const y00 = padY[az.i * cols + ax.i], y10 = padY[az.i * cols + ax.nb];
      const y01 = padY[az.nb * cols + ax.i], y11 = padY[az.nb * cols + ax.nb];
      const city = y00 * (1 - ax.w) * (1 - az.w) + y10 * ax.w * (1 - az.w)
                 + y01 * (1 - ax.w) * az.w + y11 * ax.w * az.w;
      const idx = tj * size + ti;
      const carved = m >= 1 ? city : wy(height[idx]) + (city - wy(height[idx])) * m;
      height[idx] = hn(carved);
      carvedTexels++;
      if (pave && m > 0.999 && biome) { biome[idx] = 7; pavedTexels++; }   // BIOMES[7] = pavement
    }
  }

  /* refresh the min/max the mesh normalisation reads (generateTerrain computed them pre-carve). */
  let minH = Infinity, maxH = -Infinity;
  for (let k = 0; k < height.length; k++) { const h = height[k]; if (h < minH) minH = h; if (h > maxH) maxH = h; }
  terrain.minH = minH; terrain.maxH = maxH;

  /* the report — every number a proof or a HUD row wants, none re-derivable two ways. */
  let maxPadDelta = 0, padMin = Infinity, padMax = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const a = padY[j * cols + i];
      if (a < padMin) padMin = a; if (a > padMax) padMax = a;
      if (i + 1 < cols) maxPadDelta = Math.max(maxPadDelta, Math.abs(a - padY[j * cols + i + 1]));
      if (j + 1 < rows) maxPadDelta = Math.max(maxPadDelta, Math.abs(a - padY[(j + 1) * cols + i]));
    }
  }
  return {
    padY,
    padYOf: (i, j) => padY[j * cols + i],
    touched: { i0: ti0, i1: ti1, j0: tj0, j1: tj1 },
    stats: {
      pads: cols * rows, spacing, streetW, padSide: P, maxGrade,
      deltaBudget, maxPadDelta,
      steepestStreet: 1.5 * maxPadDelta / streetW,
      relaxSweeps: sweeps, relaxResidual: residual,
      carvedTexels, pavedTexels, padMin, padMax,
    },
  };
}

/* dirtyMeshesFor(group, touched) — which chunk meshes of a buildTerrainMesh group the carve's texel
   rect intersects. Feed the result straight to rebuildTerrainChunks (with writeColor true when the
   carve paved). A chunk owns CELLS [i0,i1)×[j0,j1) (its verts span one texel further), so the
   overlap test widens the chunk by that vertex. */
export function dirtyMeshesFor(group, touched) {
  const out = [];
  for (const mesh of group.children) {
    const c = mesh.userData && mesh.userData.chunk;
    if (!c) continue;
    if (c.i1 + 1 < touched.i0 || c.i0 > touched.i1 || c.j1 + 1 < touched.j0 || c.j0 > touched.j1) continue;
    out.push(mesh);
  }
  return out;
}
