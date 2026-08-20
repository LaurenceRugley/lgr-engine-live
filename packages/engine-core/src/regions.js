/* ============================================================
   regions.js — ARC A-PATCHWORK (2026-08-20): REGIONS, not speckle.
   ------------------------------------------------------------
   THE PROBLEM THIS CLOSES. `terrain.js` classifies every texel INDEPENDENTLY: a Whittaker lookup on
   (elevation, moisture). Two adjacent texels can therefore land in different biomes for no reason a
   player can see, and the result is a *speckle* — forest pixels salted through grassland pixels — not
   a FOREST. Speckle is fine as a ground colour and useless as a place: you cannot walk "into the
   woods" if the woods are one texel wide. A world you can navigate needs REGION-SCALE COHERENCE: a
   small number of large, CONTIGUOUS districts, each of which decides what CONTENT belongs there.

   The distinction this module is built around, and the reason it does not simply replace `classify`:
     · the REGION decides the CONTENT     — trees here, dunes there, a city here, water there;
     · the per-texel BIOME still decides the COLOUR inside a region — so a woods region is grass and
       forest and hill greens with rock where it is steep, and a desert region keeps its rocky
       outcrops and snowy tops. Region ≠ biome. They compose.

   ── HOW THE FIELD IS BUILT: a capacity-constrained PRIORITY FLOOD from one seed per region.
   The obvious candidates were considered and rejected for reasons worth writing down, because each
   fails a *counted* property this arc has to prove:
     · low-frequency noise thresholds — cheap, but a threshold band produces islands and holes:
       contiguity fails and coverage is an accident of the noise histogram.
     · plain (or domain-warped) VORONOI over seeded sites — contiguity is good (a Voronoi cell is
       convex), but COVERAGE is whatever the cell areas happen to be. "Ask for 26% woods" cannot be
       honoured, and a dial that does not mean what it says is the drift Rule 6 is about.
     · capacity-constrained Voronoi (per-site bias solved by auction/Lloyd iteration) — honours
       coverage, but only in the limit, and the convergence is fiddly to prove.
   The priority flood gives BOTH properties by construction, in one pass:
       every region starts from its own seed and grows into unclaimed texels, always taking its
       cheapest frontier texel; the scheduler always advances the region with the largest RELATIVE
       DEFICIT (target−have)/target; a region stops growing when it reaches its texel target.
   ⇒ CONTIGUITY: a region is a flood from ONE connected seed set through 4-neighbours, so it is a
     4-connected set — not approximately, exactly. (We count it off the finished field anyway; a
     derivation never checked is a wish, which is this repo's own method.)
   ⇒ COVERAGE: growth stops at a texel COUNT, so "ask 26%" is honoured to the texel, and the counts
     sum to size² exactly, so the field is a PARTITION with no unassigned cell and no overlap.
   The ORGANIC SHAPE comes from the cost function, not from the topology: cost is distance measured in
   a DOMAIN-WARPED copy of the plane (`p + A·fbm(p)`), the same trick terrain.js uses to bend
   grid-aligned noise into coastlines. Straight-line Voronoi boundaries become lobed and wandering
   while the flood's guarantees are untouched, because warping only reorders the priority queue.

   C++ anchors: this is a multi-source Dijkstra / watershed transform over a grid with per-source
   capacities — one binary min-heap per source, a `Uint8Array` label buffer (an enum per cell), and a
   two-pass chamfer distance transform for the edge field. Pure data: no THREE import, so node tests
   and probes run it without a renderer (carve-pads.js's own shape).
   ============================================================ */
import { makeNoise2D, fbm } from './terrain.js';

/* smoothstep on [0,1] — carve-pads.js's own ramp profile, verbatim. d/dt = 6t(1−t), max 1.5 at t=½.
   That 1.5 is load-bearing twice here: it budgets the SEAM width, and it budgets the lake bowl. */
const sm01 = (t) => { t = t < 0 ? 0 : t > 1 ? 1 : t; return t * t * (3 - 2 * t); };

export const UNASSIGNED = 255;

/* ---- a tiny binary MIN-HEAP over (key, index) pairs, growing by doubling. One per region.
   Typed arrays rather than objects because the flood pushes O(4·N) entries and a per-entry object
   would be O(N) garbage in a build that runs on every dial change (the no-hot-alloc habit applied
   to a build path). C++ anchor: std::priority_queue over a pair<float,int> with a vector backing. */
function makeHeap(cap = 1024) {
  let n = 0, key = new Float64Array(cap), idx = new Int32Array(cap);
  const swap = (a, b) => {
    const k = key[a]; key[a] = key[b]; key[b] = k;
    const i = idx[a]; idx[a] = idx[b]; idx[b] = i;
  };
  return {
    get size() { return n; },
    push(i, k) {
      if (n === key.length) {
        const nk = new Float64Array(n * 2), ni = new Int32Array(n * 2);
        nk.set(key); ni.set(idx); key = nk; idx = ni;
      }
      let c = n++;
      key[c] = k; idx[c] = i;
      while (c > 0) { const p = (c - 1) >> 1; if (key[p] <= key[c]) break; swap(p, c); c = p; }
    },
    pop() {
      const top = idx[0];
      n--;
      if (n > 0) { key[0] = key[n]; idx[0] = idx[n]; }
      let c = 0;
      for (;;) {
        const l = c * 2 + 1, r = l + 1;
        let m = c;
        if (l < n && key[l] < key[m]) m = l;
        if (r < n && key[r] < key[m]) m = r;
        if (m === c) break;
        swap(m, c); c = m;
      }
      return top;
    },
  };
}

/* ============================================================================================
   generateRegions({ size, worldSize, seed, plan, warp, warpFreq }) → the region field.

     size, worldSize — the SAME two numbers handed to generateTerrain / buildTerrainMesh /
                       createTerrainSampler. One grid, one mapping, four readers (carve-pads.js's
                       own "they cannot drift" rule).
     plan            — the districts, in order. Each entry:
                         { key,                 the region's name (the CONTENT key consumers switch on)
                           want,                target coverage as a fraction of the world (0..1)
                           mode: 'seed'         grow from one point — the default
                               | 'rim'          grow INWARD from the world border (the sea: a region
                                                that is not a blob but an OUTSIDE, so its cost is the
                                                depth from the border, not a radius from a point)
                               | 'rect',        pre-own a world-space rect { x0, z0, x1, z1 } and grow
                                                outward from it (the CITY: the carve's own footprint
                                                must be inside the city region BY CONSTRUCTION, not by
                                                luck — so the rect is seeded, never hoped for)
                           at: { x, z },        seed position in world units ('seed' mode)
                           rect: {x0,z0,x1,z1}  ('rect' mode) }
     warp, warpFreq  — domain-warp amplitude (in world units) and frequency of the region boundaries.

   Returns {
     size, worldSize, keys, region: Uint8Array(size²),   // region index per texel — a PARTITION
     edgeDist: Float32Array(size²),                      // world-u distance to the nearest texel of a
                                                         //   DIFFERENT region (or the grid border)
     seeds: [{ key, x, z, i, j }],
     stats: { total, unassigned, starved, per: [{ key, want, wantTexels, texels, frac, lcc, lccFrac,
                                                  components }] },
   }
   `lcc` is the size of the region's LARGEST 4-connected component — the anti-speckle number, counted
   off the finished field rather than argued from the algorithm.
   ============================================================================================ */
export function generateRegions({ size, worldSize, seed = 1, plan, warp = 9, warpFreq = 2.4 } = {}) {
  if (!Array.isArray(plan) || !plan.length) throw new Error('generateRegions: `plan` must list at least one region');
  const K = plan.length;
  if (K >= UNASSIGNED) throw new Error(`generateRegions: at most ${UNASSIGNED - 1} regions (the label buffer is a Uint8Array)`);
  const N = size * size;
  const cell = worldSize / (size - 1), half = worldSize / 2;
  const wx = (i) => i * cell - half, wz = (j) => j * cell - half;

  /* ---- the DOMAIN WARP. Two decorrelated fBm fields displace the sample point; region distances
     are then measured in that displaced plane. Amplitude is in WORLD units so `warp` reads as "how
     far a boundary can wander", and it is bounded well under the typical seed spacing — a warp that
     exceeds half the spacing can fold the plane hard enough to detach a lobe, which would show up
     as a contiguity number below 1.0 (the reason that number is COUNTED and not assumed). */
  const warpN = makeNoise2D((seed * 13 + 7) >>> 0);
  const WX = new Float32Array(N), WZ = new Float32Array(N);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const nx = (i / size - 0.5) * warpFreq, nz = (j / size - 0.5) * warpFreq;
      WX[j * size + i] = wx(i) + warp * fbm(warpN, nx + 2.7, nz + 8.1, 4, 2, 0.5);
      WZ[j * size + i] = wz(j) + warp * fbm(warpN, nx + 6.3, nz + 1.9, 4, 2, 0.5);
    }
  }

  /* ---- TARGETS. Normalise the wants (a plan that does not sum to 1 is a config slip, not a crash),
     floor to texels, then hand the rounding remainder to the largest region so Σtargets = N EXACTLY
     — that identity is what makes the finished field a partition with no leftovers. */
  const wantSum = plan.reduce((s, p) => s + (p.want || 0), 0) || 1;
  const targets = new Int32Array(K);
  let assignedTargets = 0;
  for (let r = 0; r < K; r++) { targets[r] = Math.floor((plan[r].want || 0) / wantSum * N); assignedTargets += targets[r]; }
  let biggest = 0;
  for (let r = 1; r < K; r++) if (targets[r] > targets[biggest]) biggest = r;
  targets[biggest] += N - assignedTargets;

  const region = new Uint8Array(N).fill(UNASSIGNED);
  const counts = new Int32Array(K);
  const heaps = []; for (let r = 0; r < K; r++) heaps.push(makeHeap());
  let assigned = 0;

  /* ---- COST. Every region measures cost in the warped plane; only the ORIGIN of the measurement
     differs by mode. 'rim' is the one that is not a point: the sea is the OUTSIDE of the island, so
     its cost is the Chebyshev depth from the border — which grows a ring inward at an even rate
     instead of a disc from one coastal point. */
  const seeds = [];
  const costOf = new Array(K);
  for (let r = 0; r < K; r++) {
    const p = plan[r];
    if (p.mode === 'rim') {
      costOf[r] = (i, j) => Math.min(i, j, size - 1 - i, size - 1 - j) * cell
        + (WX[j * size + i] - wx(i)) * 0.5 + (WZ[j * size + i] - wz(j)) * 0.5;   // the warp wobbles the coastline
      continue;
    }
    let sx, sz;
    if (p.mode === 'rect') { sx = (p.rect.x0 + p.rect.x1) / 2; sz = (p.rect.z0 + p.rect.z1) / 2; }
    else { sx = p.at.x; sz = p.at.z; }
    const si = Math.max(0, Math.min(size - 1, Math.round((sx + half) / cell)));
    const sj = Math.max(0, Math.min(size - 1, Math.round((sz + half) / cell)));
    const sWX = WX[sj * size + si], sWZ = WZ[sj * size + si];
    costOf[r] = (i, j) => Math.hypot(WX[j * size + i] - sWX, WZ[j * size + i] - sWZ);
    seeds.push({ key: p.key, x: sx, z: sz, i: si, j: sj });
  }

  /* ---- SEEDING. Claim each region's starting texels, then push their unclaimed 4-neighbours. Every
     seed set is itself 4-connected (a point, a rect, or the border ring), which is the base case of
     the contiguity induction: a flood from a connected set stays connected. */
  const claim = (r, i, j) => {
    const idx = j * size + i;
    if (region[idx] !== UNASSIGNED) return;
    region[idx] = r; counts[r]++; assigned++;
  };
  const pushNeighbours = (r, i, j) => {
    const h = heaps[r];
    if (i > 0 && region[j * size + i - 1] === UNASSIGNED) h.push(j * size + i - 1, costOf[r](i - 1, j));
    if (i < size - 1 && region[j * size + i + 1] === UNASSIGNED) h.push(j * size + i + 1, costOf[r](i + 1, j));
    if (j > 0 && region[(j - 1) * size + i] === UNASSIGNED) h.push((j - 1) * size + i, costOf[r](i, j - 1));
    if (j < size - 1 && region[(j + 1) * size + i] === UNASSIGNED) h.push((j + 1) * size + i, costOf[r](i, j + 1));
  };
  /* PROTECTED texels — a region's own seed set is a CONTRACT, not spare capacity. The city's rect is
     the carve's footprint and must stay city; the border ring must stay sea; a region must not lose
     the point it grew from. The exchange below is forbidden to touch these. (Found by the test, not
     by reading: the first exchange pass quietly took 80 texels out of the carve's own rim rect.) */
  const locked = new Uint8Array(N);
  const seeded = [];
  for (let r = 0; r < K; r++) {
    const p = plan[r], mine = [];
    if (p.mode === 'rim') {
      for (let i = 0; i < size; i++) { mine.push([i, 0], [i, size - 1]); }
      for (let j = 1; j < size - 1; j++) { mine.push([0, j], [size - 1, j]); }
    } else if (p.mode === 'rect') {
      const i0 = Math.max(0, Math.ceil((p.rect.x0 + half) / cell)), i1 = Math.min(size - 1, Math.floor((p.rect.x1 + half) / cell));
      const j0 = Math.max(0, Math.ceil((p.rect.z0 + half) / cell)), j1 = Math.min(size - 1, Math.floor((p.rect.z1 + half) / cell));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) mine.push([i, j]);
    } else {
      const s = seeds.find((q) => q.key === p.key);
      mine.push([s.i, s.j]);
    }
    for (const [i, j] of mine) { claim(r, i, j); locked[j * size + i] = 1; }
    seeded.push(mine);
  }
  for (let r = 0; r < K; r++) for (const [i, j] of seeded[r]) pushNeighbours(r, i, j);

  /* A pre-owned seed set can already exceed its own want (the city's footprint is what it is).
     Raising that region's target to what is actually on the ground keeps Σtargets = N exact — which
     is the identity the partition rests on — and the difference comes off whichever region has the
     most room left, one texel at a time. Deliberately the simple loop and not a proportional formula:
     `over` is the seed overshoot (thousands at most, on a build path), and a correction whose job is
     to keep a sum EXACT should not be the place where a rounding rule is invented. `stats` reports
     asked-vs-got either way — a dial that silently lies is worse than one that reports its correction. */
  for (let r = 0; r < K; r++) {
    if (counts[r] <= targets[r]) continue;
    let over = counts[r] - targets[r];
    targets[r] = counts[r];
    while (over > 0) {
      let q = -1, room = 0;
      for (let t = 0; t < K; t++) {
        if (t === r) continue;
        const rm = targets[t] - counts[t];
        if (rm > room) { room = rm; q = t; }
      }
      if (q < 0) break;
      targets[q]--; over--;
    }
  }

  /* ---- THE FLOOD. Advance the region with the largest RELATIVE deficit that still has a frontier.
     Relative (not absolute) so a small region is not starved behind a large one all the way to the
     end — every region grows in proportion, which is also what makes the districts interleave into a
     patchwork instead of one region eating the map and the rest crowding the leftovers.
     A region past its target has a NEGATIVE deficit and is therefore only chosen when nothing else
     can move, which is the guarantee that the loop terminates with every texel assigned: when we
     claim a texel we push its unclaimed neighbours, so the unassigned set's whole boundary always
     lives in some heap. */
  let guard = N * 8;
  while (assigned < N && guard-- > 0) {
    let best = -1, bestDef = -Infinity;
    for (let r = 0; r < K; r++) {
      if (heaps[r].size === 0) continue;
      const def = (targets[r] - counts[r]) / Math.max(1, targets[r]);
      if (def > bestDef) { bestDef = def; best = r; }
    }
    if (best < 0) break;                                   // no frontier anywhere — reported below
    const h = heaps[best];
    const idx = h.pop();
    if (region[idx] !== UNASSIGNED) continue;              // a stale duplicate push; skip
    const i = idx % size, j = (idx / size) | 0;
    claim(best, i, j);
    pushNeighbours(best, i, j);
  }

  /* ---- PHASE 2: THE EXCHANGE — and why the flood alone is not enough.
     The flood is MONOTONE: a texel, once claimed, is never released. So a district that gets
     ENCLOSED by its neighbours before it reaches quota can never make the difference up, and the
     shortfall silently lands on whoever still had a frontier. Measured, not guessed: across six
     seeds × six seed-position layouts, EVERY configuration starved at least one region by
     0.18–1.04 percentage points. That is small, and it is still a dial that does not mean what it
     says, which is the one thing this arc is not allowed to ship.
     The cure is a bounded, targeted exchange: a region still under target takes texels from an
     OVER-target neighbour, always the donor's FARTHEST texel (largest cost from the donor's own
     seed) that touches the taker. Why that choice and not any adjacent texel: a flood's set is
     essentially a sublevel set {cost ≤ θ} of its own cost field, so stripping its highest-cost
     members leaves a sublevel set — the shape connectivity comes from. The taker cannot break,
     ever: every texel it gains is adjacent to it by construction. The donor's connectivity is the
     one thing this pass argues for rather than proves, which is exactly why `regionReport` COUNTS
     the largest connected component afterwards and the gate reads that number, not this comment. */
  {
    const donorHeap = makeHeap();
    const queued = new Uint8Array(N);
    for (let s = 0; s < K; s++) {
      let need = targets[s] - counts[s];
      if (need <= 0) continue;
      queued.fill(0);
      while (donorHeap.size) donorHeap.pop();
      const offer = (idx) => {
        const o = region[idx];
        if (o === s || queued[idx] || locked[idx]) return;
        queued[idx] = 1;
        donorHeap.push(idx, -costOf[o](idx % size, (idx / size) | 0));   // min-heap on −cost = the donor's farthest first
      };
      for (let k = 0; k < N; k++) {
        if (region[k] !== s) continue;
        const i = k % size, j = (k / size) | 0;
        if (i > 0 && region[k - 1] !== s) offer(k - 1);
        if (i < size - 1 && region[k + 1] !== s) offer(k + 1);
        if (j > 0 && region[k - size] !== s) offer(k - size);
        if (j < size - 1 && region[k + size] !== s) offer(k + size);
      }
      while (need > 0 && donorHeap.size) {
        const idx = donorHeap.pop();
        const o = region[idx];
        if (o === s) continue;
        if (counts[o] <= targets[o]) continue;            // this donor has nothing spare any more
        region[idx] = s; counts[s]++; counts[o]--; need--;
        const i = idx % size, j = (idx / size) | 0;
        if (i > 0) offer(idx - 1);
        if (i < size - 1) offer(idx + 1);
        if (j > 0) offer(idx - size);
        if (j < size - 1) offer(idx + size);
      }
    }
  }
  /* ONE PASS, and the residual is named rather than chased. Iterating the exchange to a fixed point
     was tried and is INERT — it changed not one texel across a 40-seed × 2-grid sweep — because the
     leftover shortfall is not an ordering artifact. Instrumented (grid 380, seeds 3 and 24): the
     taker is `lakes`, the only over-target region is `city`, and every city texel on their shared
     boundary is LOCKED rect, so no donor is reachable at all. The over-claim that caused it is
     forced, too: when the taker's frontier collapsed there were still unassigned texels and somebody
     had to have them, or the field would not be a partition. So the honest contract is:
       coverage is EXACT whenever a taker can reach spare capacity, and the shortfall is REPORTED
       (`stats.starved`, plus asked-vs-got per region) whenever it cannot.
     Measured worst case over 40 seeds × 2 grids: 0.062 percentage points — 90 texels of 144,400 —
     and 0.000 on the seed the room ships. A loop that provably never fires is worse than a stated
     limit (Rule 2), so it is not here. */

  /* ---- THE EDGE FIELD — world-u distance to the nearest texel of a DIFFERENT region (the grid
     border counts as different, so no program runs at full amplitude off the edge of the world).
     A two-pass CHAMFER transform with weights (1, √2): forward sweep then backward sweep, each
     relaxing against the four already-final neighbours in its direction. The 3-4 style chamfer
     approximates Euclidean distance to within ~4% — stated, because the SEAM WIDTH is budgeted off
     this number and a budget wants its error named. C++ anchor: the classic two-pass distance
     transform over an image. */
  const D = Math.SQRT2;
  const edgeDist = new Float32Array(N).fill(Infinity);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = j * size + i, r = region[idx];
      const border = i === 0 || j === 0 || i === size - 1 || j === size - 1;
      if (border
        || (i > 0 && region[idx - 1] !== r) || (i < size - 1 && region[idx + 1] !== r)
        || (j > 0 && region[idx - size] !== r) || (j < size - 1 && region[idx + size] !== r)) edgeDist[idx] = 0;
    }
  }
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = j * size + i; let d = edgeDist[idx];
      if (i > 0) d = Math.min(d, edgeDist[idx - 1] + 1);
      if (j > 0) {
        d = Math.min(d, edgeDist[idx - size] + 1);
        if (i > 0) d = Math.min(d, edgeDist[idx - size - 1] + D);
        if (i < size - 1) d = Math.min(d, edgeDist[idx - size + 1] + D);
      }
      edgeDist[idx] = d;
    }
  }
  for (let j = size - 1; j >= 0; j--) {
    for (let i = size - 1; i >= 0; i--) {
      const idx = j * size + i; let d = edgeDist[idx];
      if (i < size - 1) d = Math.min(d, edgeDist[idx + 1] + 1);
      if (j < size - 1) {
        d = Math.min(d, edgeDist[idx + size] + 1);
        if (i > 0) d = Math.min(d, edgeDist[idx + size - 1] + D);
        if (i < size - 1) d = Math.min(d, edgeDist[idx + size + 1] + D);
      }
      edgeDist[idx] = d;
    }
  }
  for (let k = 0; k < N; k++) edgeDist[k] *= cell;          // texels → world units

  const keys = plan.map((p) => p.key);
  const rep = regionReport(region, size, K);
  let starved = 0;
  const per = plan.map((p, r) => {
    if (counts[r] < targets[r]) starved++;
    return {
      key: p.key, want: (p.want || 0) / wantSum, wantTexels: targets[r],
      texels: counts[r], frac: counts[r] / N,
      lcc: rep.lcc[r], lccFrac: counts[r] ? rep.lcc[r] / counts[r] : 1, components: rep.components[r],
    };
  });
  return {
    size, worldSize, keys, region, edgeDist, seeds,
    stats: { total: N, unassigned: rep.unassigned, starved, per },
  };
}

/* ============================================================================================
   regionReport(region, size, K) → { unassigned, counts, lcc, components }
   THE ANTI-SPECKLE COUNT, and the only honest way to make it: a 4-connected component labelling of
   the FINISHED field (an explicit stack, not recursion — a component here can be 100k texels and a
   recursive flood would blow the JS stack). `lcc[r]` is the largest component of region r; the arc's
   headline proof is lcc[r]/counts[r] ≈ 1, and the negative control is running this exact function
   over a per-texel `classify` biome map, where it is a few percent.
   Exported because the node test, the probe and the HUD must all read ONE implementation of the
   number (the "two ground functions that disagree by centimetres" lesson, applied to a statistic).
   ============================================================================================ */
export function regionReport(region, size, K) {
  const N = size * size;
  const counts = new Int32Array(K), lcc = new Int32Array(K), components = new Int32Array(K);
  let unassigned = 0;
  for (let k = 0; k < N; k++) {
    const r = region[k];
    if (r === UNASSIGNED || r >= K) { unassigned++; continue; }
    counts[r]++;
  }
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  for (let start = 0; start < N; start++) {
    if (seen[start]) continue;
    const r = region[start];
    if (r === UNASSIGNED || r >= K) { seen[start] = 1; continue; }
    let sp = 0, n = 0;
    stack[sp++] = start; seen[start] = 1;
    while (sp > 0) {
      const idx = stack[--sp]; n++;
      const i = idx % size, j = (idx / size) | 0;
      if (i > 0 && !seen[idx - 1] && region[idx - 1] === r) { seen[idx - 1] = 1; stack[sp++] = idx - 1; }
      if (i < size - 1 && !seen[idx + 1] && region[idx + 1] === r) { seen[idx + 1] = 1; stack[sp++] = idx + 1; }
      if (j > 0 && !seen[idx - size] && region[idx - size] === r) { seen[idx - size] = 1; stack[sp++] = idx - size; }
      if (j < size - 1 && !seen[idx + size] && region[idx + size] === r) { seen[idx + size] = 1; stack[sp++] = idx + size; }
    }
    components[r]++;
    if (n > lcc[r]) lcc[r] = n;
  }
  return { unassigned, counts, lcc, components };
}

/* ============================================================================================
   shapeRegionTerrain(terrain, world, R, opts) → the shaping report.
   ------------------------------------------------------------
   THE ONE RULE THAT MAKES THE SEAMS PROVABLE: a region program produces an OFFSET, never an absolute
   height, and every offset is multiplied by `sm01(edgeDist / seamBlend)` — so it is exactly ZERO at
   every region boundary. Both sides of every seam therefore agree on the wild terrain there, and the
   *entire* grade the region system can add anywhere in the world is the gradient of ONE field: the
   blended offset. That is a number you can sweep exhaustively (proof d), and it does not drag the
   wild terrain's own mountains into the measurement — which the naive "max grade at boundary texels"
   metric does, and which would have made this proof fail for reasons that have nothing to do with
   seams. Bound, before any code runs:
       |∇(offset·w)| ≤ |∇offset| + max|offset| · 1.5/seamBlend
   the 1.5 being smoothstep's peak slope, carve-pads.js's own factor. Budget `seamBlend` off that,
   then COUNT the realised gradient off the finished array (`gradeMax`) — the derivation is the
   design, the count is the gate.

   Only two of the five district kinds shape anything, and that is deliberate (Rule 2 — the minimum
   code for the stated problem):
     · DESERT — DUNES: a directional, noise-warped, sharpened sinusoid. Real dunes are a transverse
       wave train perpendicular to the prevailing wind, so one dot-product against a wind axis plus a
       low-frequency fBm wobble reads as a dune field. Peak slope is analytic: for
       g(t) = (½+½·sin 2πt)^sharp the derivative peaks at ≈ π·sharp^…—rather than trust the algebra we
       cap it with `amp·π·sharp/len` as the design bound and count the truth.
     · LAKES — BOWLS: a lake district digs `bowls` discrete basins, not one giant depression, for a
       mechanical reason: `detectLakes` floods only `DEPTH` (0.045 normalised) above a local minimum
       and rejects any pool over MAXPOOL coarse cells, so one huge flat pit yields either nothing or
       a rejected pool. A flat-bottomed bowl of radius `rimR` with a `flatR` floor produces a pool the
       detector can actually find, and its peak slope is `depth·1.5/(rimR−flatR)` — the same
       smoothstep budget again.
     · SEA, WOODS, CITY — offset EXACTLY 0. The sea is already the wild field's radial falloff and the
       water plane the room lays at sea level; the woods are wild ground plus trees; the city is
       `carveCityPads`, which runs AFTER this and owns its own surface. Their seams therefore add
       precisely nothing, which is not a claim, it is arithmetic.

   MUTATES `terrain.height` (and `terrain.biome` when the desert paints) in place — A-MARRIAGE's
   one-field rule: this is the same buffer the mesh, the sampler, the carve, the scatter and the lake
   detector all read, so there is no second source of truth to drift.
   ============================================================================================ */
export function shapeRegionTerrain(terrain, world, R, opts = {}) {
  const { size, height, biome, sea, relief } = terrain;
  const { worldSize = 26 } = world || {};
  const cell = worldSize / (size - 1), half = worldSize / 2;
  const N = size * size;
  const seamBlend = opts.seamBlend ?? 8;
  const seed = opts.seed ?? 1;
  const kindOf = (key) => R.keys.indexOf(key);

  const off = new Float32Array(N);                       // the whole region system's height authority, in WORLD units

  /* ---- DESERT DUNES ------------------------------------------------------------------------- */
  const dn = opts.desert || null;
  const rDesert = dn ? kindOf(dn.key ?? 'desert') : -1;
  if (rDesert >= 0 && dn.amp > 0) {
    const amp = dn.amp, len = dn.len ?? 12, sharp = dn.sharp ?? 1.6;
    const ca = Math.cos(dn.angle ?? 0.6), sa = Math.sin(dn.angle ?? 0.6);
    const dnN = makeNoise2D((seed * 29 + 3) >>> 0), wob = dn.warp ?? 0.25, wf = dn.warpFreq ?? 2.0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const idx = j * size + i;
        if (R.region[idx] !== rDesert) continue;
        const x = i * cell - half, z = j * cell - half;
        const t = (x * ca + z * sa) / len + wob * fbm(dnN, (i / size - 0.5) * wf, (j / size - 0.5) * wf, 3, 2, 0.5);
        off[idx] = amp * Math.pow(0.5 + 0.5 * Math.sin(2 * Math.PI * t), sharp);
      }
    }
  }

  /* ---- LAKE BOWLS --------------------------------------------------------------------------- */
  const lk = opts.lakes || null;
  const rLakes = lk ? kindOf(lk.key ?? 'lakes') : -1;
  const bowls = [];
  /* the lake BED FLOOR, hoisted because the bowl CENTRES are chosen against it: a basin whose bottom
     would sit under sea level is not a lake to `detectLakes` ("drains to the ocean") and would read
     as a hole punched in the island, so only ground with room to hold the whole dig can host a bowl. */
  const bedFloor = sea + (lk && lk.bedMargin != null ? lk.bedMargin : 0.03);
  if (rLakes >= 0 && lk.depth > 0) {
    const rimR = lk.rimR ?? 11, flatR = Math.min(lk.flatR ?? 5, rimR - 0.5), want = lk.bowls ?? 3;
    /* A BOWL DIGS AS DEEP AS THE GROUND ALLOWS. The first cut demanded the FULL depth of headroom
       above the bed floor and got exactly one basin on 8 of 60 measured worlds — a district called
       "lakes" holding one lake. The fix is not a looser floor (a bed under sea level is not a lake)
       but a per-bowl depth: dig min(depth, headroom). The floor stays hard, and `minDepth` is the
       honest lower limit — `detectLakes` fills only 0.045 normalised above a local minimum, so a
       basin shallower than that holds no pool at all and would be a dent, not a lake. */
    const headroomAt = (k) => (height[k] - bedFloor) * relief;   // world-u of dig this ground can take
    const minDig = lk.minDepth ?? 0.45;
    /* DOES THIS GROUND HOLD WATER? Headroom above the bed floor is NOT the same question, and the
       difference cost this arc a red: the first cut dug three textbook basins into ground that sat
       barely above sea level, and `detectLakes` — correctly — found nothing, because at fill level
       the pool drained straight to the ocean. A basin needs a RIM. So the criterion is the one the
       detector itself uses, asked in advance: walk the circle at `rimR` and require every point of
       it to stand above the water line this bowl would fill to. `fill` is detectLakes' own DEPTH
       constant, named here so the digger and the detector cannot disagree about the water line. */
    const FILL = lk.fill ?? 0.045;
    const holdsWater = (k) => {
      const bx = (k % size) * cell - half, bz = ((k / size) | 0) * cell - half;
      const bottom = Math.max(bedFloor, height[k] - Math.min(lk.depth, headroomAt(k)) / relief);
      const line = bottom + FILL;
      for (let a = 0; a < 16; a++) {
        const th = a * Math.PI / 8;
        const ri = Math.max(0, Math.min(size - 1, Math.round((bx + Math.cos(th) * rimR + half) / cell)));
        const rj = Math.max(0, Math.min(size - 1, Math.round((bz + Math.sin(th) * rimR + half) / cell)));
        if (height[rj * size + ri] < line) return false;
      }
      return true;
    };
    const cand = [];
    let deepest = 0;
    for (let k = 0; k < N; k++) if (R.region[k] === rLakes && R.edgeDist[k] > deepest) deepest = R.edgeDist[k];
    const need = Math.min(rimR * 0.85, deepest * 0.72);   // if the district is small, take what it has — and say so
    for (let k = 0; k < N; k++) {
      if (R.region[k] !== rLakes || R.edgeDist[k] < need || headroomAt(k) < minDig) continue;
      if (!holdsWater(k)) continue;
      cand.push(k);
    }
    for (let b = 0; b < want && cand.length; b++) {
      let pick = -1, bestScore = -Infinity;
      for (const k of cand) {
        const x = (k % size) * cell - half, z = ((k / size) | 0) * cell - half;
        let nearest = Infinity;
        for (const c of bowls) nearest = Math.min(nearest, Math.hypot(x - c.x, z - c.z));
        const score = bowls.length ? nearest : R.edgeDist[k];
        if (score > bestScore) { bestScore = score; pick = k; }
      }
      if (pick < 0) break;
      if (bowls.length && bestScore < rimR * 1.15) break;   // no room left for a bowl that is its own lake
      bowls.push({
        x: (pick % size) * cell - half, z: ((pick / size) | 0) * cell - half,
        rimR, flatR, depth: Math.min(lk.depth, headroomAt(pick)),
      });
    }
    for (const c of bowls) {
      const i0 = Math.max(0, Math.floor((c.x - rimR + half) / cell)), i1 = Math.min(size - 1, Math.ceil((c.x + rimR + half) / cell));
      const j0 = Math.max(0, Math.floor((c.z - rimR + half) / cell)), j1 = Math.min(size - 1, Math.ceil((c.z + rimR + half) / cell));
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const idx = j * size + i;
          /* GATED TO THE DISTRICT: a bowl whose rim reaches past the lakes region must not dent the
             woods next door — the seam multiply below would fade it, but "faded" is not "absent",
             and the arc's stated guarantee is that sea/woods/city carry an offset of EXACTLY zero.
             (Caught by the test's own sweep, not by reading: 37 texels leaked on the first cut.) */
          if (R.region[idx] !== rLakes) continue;
          const d = Math.hypot(i * cell - half - c.x, j * cell - half - c.z);
          if (d >= rimR) continue;
          const bowl = -c.depth * (1 - sm01((d - c.flatR) / (rimR - c.flatR)));
          if (bowl < off[idx]) off[idx] = bowl;           // overlapping bowls: the deeper wins
        }
      }
    }
  }

  /* ---- THE SEAM: every offset dies at its own region's edge --------------------------------- */
  let offMax = 0;
  for (let k = 0; k < N; k++) {
    if (off[k] === 0) continue;
    off[k] *= sm01(R.edgeDist[k] / seamBlend);
    const a = Math.abs(off[k]); if (a > offMax) offMax = a;
  }

  /* ---- PROOF (d) MATERIAL, counted here off the finished array so the page, the probe and the node
     test all read ONE number: the steepest 4-neighbour grade the region system adds ANYWHERE. */
  let gradeMax = 0, gradeAt = null;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const idx = j * size + i;
      if (i < size - 1) { const g = Math.abs(off[idx + 1] - off[idx]) / cell; if (g > gradeMax) { gradeMax = g; gradeAt = { i, j, axis: 'x' }; } }
      if (j < size - 1) { const g = Math.abs(off[idx + size] - off[idx]) / cell; if (g > gradeMax) { gradeMax = g; gradeAt = { i, j, axis: 'z' }; } }
    }
  }

  /* ---- APPLY. Offsets are world units; the field is normalised, so divide by relief (the exact
     inverse of buildTerrainMesh's wy(h) = baseY + (h−sea)·relief). The lake floor is CLAMPED to stay
     above sea level: a bed below `sea` is not a lake to `detectLakes` (it "drains to the ocean") and
     it would read as a hole in the island. A max against a constant can only REDUCE grade, so the
     clamp cannot break the count above. */
  let clamped = 0;
  for (let k = 0; k < N; k++) {
    if (off[k] === 0) continue;
    let h = height[k] + off[k] / relief;
    if (off[k] < 0 && h < bedFloor) { h = bedFloor; clamped++; }
    height[k] = h;
  }

  /* ---- BIOME PAINT: sand inside the desert district, over the LOW/MID LAND biomes only. Rock (5)
     and snow (6) survive, and so does ocean (0) — which is what keeps per-texel variety alive INSIDE
     a region, the arc's own stated rule. Gate on edgeDist so the sand line sits a little inside the
     district rather than exactly on the boundary texel (a colour that changes on the same texel the
     offset dies on reads as a hard cut). */
  let painted = 0;
  const PAINTABLE = [1, 2, 3, 4];                        // beach, grassland, forest, hills
  const DESERT = 8;
  if (rDesert >= 0 && biome && (dn.paint !== false)) {
    const gate = seamBlend * (dn.paintGate ?? 0.5);
    for (let k = 0; k < N; k++) {
      if (R.region[k] !== rDesert || R.edgeDist[k] < gate) continue;
      if (!PAINTABLE.includes(biome[k])) continue;
      biome[k] = DESERT; painted++;
    }
  }

  /* refresh the min/max the mesh normalisation reads — carveCityPads does the same, for the same
     reason: generateTerrain computed them before anything mutated the field. */
  let minH = Infinity, maxH = -Infinity;
  for (let k = 0; k < N; k++) { const h = height[k]; if (h < minH) minH = h; if (h > maxH) maxH = h; }
  terrain.minH = minH; terrain.maxH = maxH;

  /* ISLANDS, counted not claimed: sea-district texels the wild field still holds above sea level. */
  let islandTexels = 0;
  const rSea = kindOf(opts.seaKey ?? 'sea');
  if (rSea >= 0) for (let k = 0; k < N; k++) if (R.region[k] === rSea && height[k] > sea) islandTexels++;

  return { offset: off, offMax, gradeMax, gradeAt, bowls, painted, clamped, islandTexels, seamBlend };
}

/* ============================================================================================
   regionAt(R, x, z) → the region KEY under a world position (nearest texel, clamped at the rim, the
   sampler's own convention). The one query every consumer wants — the scatter mask, the lake filter,
   the HUD's "you are standing in the woods" chip and the probe's crossing count all read THIS, so
   "which district is this" has exactly one answer in the whole room.
   ============================================================================================ */
export function regionAt(R, x, z) {
  const { size, worldSize, region, keys } = R;
  const cell = worldSize / (size - 1), half = worldSize / 2;
  const i = Math.max(0, Math.min(size - 1, Math.round((x + half) / cell)));
  const j = Math.max(0, Math.min(size - 1, Math.round((z + half) / cell)));
  const r = region[j * size + i];
  return r === UNASSIGNED ? null : keys[r];
}
