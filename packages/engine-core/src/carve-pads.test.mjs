/* ============================================================
   carve-pads.test.mjs — A-MARRIAGE proofs a · b · e, counted off the FINISHED grid.
   ------------------------------------------------------------
   The house rule every guarantee in this repo follows (A-SKYLINE → A-MOTO): a derivation that is
   never checked is a wish, so nothing here asserts against the formula that built the geometry —
   every count reads the mutated Float32Array (or the sampler over it), i.e. the exact bytes the
   renderer and the physics read.

     a. PAD FLATNESS — every tower-base sample point sits within ε of its pad. 100% counted.
     b. STREET GRADE — the finished surface's grade along every street ≤ the dial. All streets,
        every texel step, plus the intersection-saddle bound (the guard-scope lesson: a sweep that
        skips the corners is a guard that cannot see them).
     e. WORLD-BAG ↔ MESH — the bilinear sampler vs the mesh's own two-triangle split, per sample,
        against the exact analytic bound |Δ| ≤ |twist|/4 — with sample lines that CROSS the
        pad↔ramp↔embankment↔wild regime boundaries, because a sweep that stays inside one regime
        proves nothing about the seams.
   Plus: relaxation honours its budget · pavement biome lands where the mask says · same seed ⇒
   byte-identical carve (the determinism the byte-identical-tier invariant leans on).

   The numbers mirror projects/world-lab (one room, one config family), but the proofs are about
   the MECHANISM — they hold at these numbers and fail loudly if the arithmetic drifts.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateTerrain, createTerrainSampler, BIOMES } from './terrain.js';
import { carveCityPads } from './carve-pads.js';

/* the world-lab family: 336-texel grid over 104 u (cell 0.310), a 13×13 city at 4.6 u pitch. */
const W = { seed: 11, size: 336, worldSize: 104, baseY: 0 };
const LAYOUT = { cols: 13, rows: 13, spacing: 4.6 };
const CARVE = { streetW: 1.2, maxGrade: 0.25, blend: 3.0 };
const CELL = W.worldSize / (W.size - 1);

function build() {
  const t = generateTerrain({ seed: W.seed, size: W.size, preset: 'valley' });
  const carve = carveCityPads(t, { worldSize: W.worldSize, baseY: W.baseY }, LAYOUT, CARVE);
  const sample = createTerrainSampler(t, { worldSize: W.worldSize, baseY: W.baseY });
  return { t, carve, sample };
}
const BUILT = build();

test('carve — the relaxation honours the grade budget it derived (and reports how it ended)', () => {
  const s = BUILT.carve.stats;
  assert.ok(s.relaxResidual <= 1e-9, `relaxation residual ${s.relaxResidual} — did not converge in ${s.relaxSweeps} sweeps`);
  assert.ok(s.maxPadDelta <= s.deltaBudget + 1e-9,
    `pad delta ${s.maxPadDelta} exceeds the budget ${s.deltaBudget} (maxGrade ${s.maxGrade} · streetW ${s.streetW} / 1.5)`);
  assert.ok(s.steepestStreet <= s.maxGrade + 1e-9, `analytic steepest street ${s.steepestStreet} > dial ${s.maxGrade}`);
  // the carve must actually carve — a zero-pad or zero-texel run would green every proof below vacuously
  assert.equal(s.pads, LAYOUT.cols * LAYOUT.rows);
  assert.ok(s.carvedTexels > 20000, `only ${s.carvedTexels} texels carved — the city rect missed the grid?`);
  assert.ok(s.padMax - s.padMin > 0.3, `pad relief ${(s.padMax - s.padMin).toFixed(3)} u — this seed/preset should be hilly; a flat result means the carve read the wrong field`);
});

/* ---- PROOF a — PAD FLATNESS, 100% COUNTED. -----------------------------------------------------
   The sample points are the WORST a real building base uses: box-arena's skyline worst-case edge is
   wMax/2 + minStreet·jitter/2 = 2.2/2 + 2.4·0.1 = 1.34 u from the pad centre (world-lab's numbers:
   minStreet 2.4, jitter 0.2). Bilinear support reaches one texel further (1.34 + 0.307 = 1.65) and
   must stay inside the pad plateau (half-side 1.7) — the 0.05 u margin this asserts is the design's
   own slack, counted rather than trusted. ε = 1e-5 u: the only error inside a plateau is the f32
   round-trip of the normalised write (≈ relief·2⁻²⁴ ≈ 4.5e-7 u); bilinear over equal corners is
   exact. */
test('PROOF a — every pad is FLAT under the worst building base: 9 points × every pad, 100%', () => {
  const { carve, sample } = BUILT;
  const cx = (LAYOUT.cols - 1) / 2, cz = (LAYOUT.rows - 1) / 2;
  const EDGE = 1.34;                  // the worst base edge world-lab's arena params can produce
  assert.ok(EDGE + CELL <= (LAYOUT.spacing - CARVE.streetW) / 2,
    'the config no longer guarantees bilinear support inside the plateau — re-derive EDGE/streetW');
  const offs = [-EDGE, 0, EDGE];
  let checked = 0, worst = 0, fails = [];
  for (let j = 0; j < LAYOUT.rows; j++) {
    for (let i = 0; i < LAYOUT.cols; i++) {
      const px = (i - cx) * LAYOUT.spacing, pz = (j - cz) * LAYOUT.spacing;
      const pad = carve.padYOf(i, j);
      for (const ox of offs) {
        for (const oz of offs) {
          const d = Math.abs(sample(px + ox, pz + oz) - pad);
          if (d > worst) worst = d;
          checked++;
          if (d > 1e-5) fails.push(`pad(${i},${j}) @ +(${ox},${oz}): off by ${d}`);
        }
      }
    }
  }
  assert.equal(checked, LAYOUT.cols * LAYOUT.rows * 9);
  assert.equal(fails.length, 0, `${fails.length}/${checked} base points off their pad (worst ${worst}):\n${fails.slice(0, 5).join('\n')}`);
  assert.ok(worst <= 1e-5, `worst pad-flatness error ${worst}`);
});

/* ---- PROOF b — STREET GRADE ≤ THE DIAL, counted on the finished mesh. --------------------------
   Every street between every neighbour pair, walked texel-by-texel along the centreline through the
   SAMPLER (what a wheel reads). The discrete secant of a C¹ profile cannot exceed its sup-derivative
   (mean value theorem), so the assertion is the dial itself — no fudge allowance. Corners are the
   saddle: both axis ramps active at once, gradient magnitude bounded by √2·dial; swept separately so
   the along-street green cannot hide a corner spike (a guard only covers what its sweep can see). */
test('PROOF b — max grade along every street ≤ the dial; intersection saddles ≤ √2·dial', () => {
  const { sample } = BUILT;
  const S = LAYOUT.spacing, P2 = (S - CARVE.streetW) / 2;
  const cx = (LAYOUT.cols - 1) / 2, cz = (LAYOUT.rows - 1) / 2;
  const step = CELL;                             // the mesh's own resolution
  let maxStreet = 0, streets = 0, samples = 0;
  for (let j = 0; j < LAYOUT.rows; j++) {
    for (let i = 0; i < LAYOUT.cols; i++) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + di >= LAYOUT.cols || j + dj >= LAYOUT.rows) continue;
        streets++;
        // centreline from pad A's edge to pad B's edge (the ramp span), along the street axis
        const ax = (i - cx) * S, az = (j - cz) * S;
        for (let s = 0; s <= CARVE.streetW + 1e-9; s += step / 4) {
          const t0 = Math.min(s, CARVE.streetW), t1 = Math.min(s + step, CARVE.streetW + step);
          const xa = ax + di * (P2 + t0), za = az + dj * (P2 + t0);
          const xb = ax + di * (P2 + t1), zb = az + dj * (P2 + t1);
          const g = Math.abs(sample(xb, zb) - sample(xa, za)) / Math.hypot(xb - xa, zb - za);
          if (g > maxStreet) maxStreet = g;
          samples++;
        }
      }
    }
  }
  assert.equal(streets, 2 * LAYOUT.cols * LAYOUT.rows - LAYOUT.cols - LAYOUT.rows);
  assert.ok(samples >= streets * 12, `only ${samples} grade samples over ${streets} streets — the sweep collapsed`);
  assert.ok(maxStreet <= CARVE.maxGrade + 1e-9,
    `measured street grade ${maxStreet.toFixed(4)} exceeds the dial ${CARVE.maxGrade} — the smoothstep budget (Δ ≤ dial·W/1.5) is broken`);

  /* the saddles: sweep every interior intersection square on a fine grid, gradient by central
     difference at half-texel arms. Bound: each axis' partial ≤ dial ⇒ |∇h| ≤ √2·dial. */
  let maxCorner = 0;
  const h = CELL / 2;
  for (let j = 0; j < LAYOUT.rows - 1; j++) {
    for (let i = 0; i < LAYOUT.cols - 1; i++) {
      const x0 = (i - cx) * S + P2, z0 = (j - cz) * S + P2;   // the corner square [x0,x0+W]×[z0,z0+W]
      for (let a = 0; a <= 4; a++) {
        for (let b = 0; b <= 4; b++) {
          const x = x0 + (CARVE.streetW * a) / 4, z = z0 + (CARVE.streetW * b) / 4;
          const gx = (sample(x + h, z) - sample(x - h, z)) / (2 * h);
          const gz = (sample(x, z + h) - sample(x, z - h)) / (2 * h);
          const g = Math.hypot(gx, gz);
          if (g > maxCorner) maxCorner = g;
        }
      }
    }
  }
  assert.ok(maxCorner <= Math.SQRT2 * CARVE.maxGrade + 1e-9,
    `intersection saddle gradient ${maxCorner.toFixed(4)} exceeds √2·dial ${(Math.SQRT2 * CARVE.maxGrade).toFixed(4)}`);
});

/* ---- PROOF e — THE WORLD BAG AGREES WITH THE MESH, across every regime boundary. ---------------
   The mesh triangulates each cell (fillChunk: triangle A = 00/01/10, B = 10/01/11); the bag
   interpolates the bilinear patch. Their difference is EXACTLY uv·twist (≤ |twist|/4), so each
   sample is asserted against its own cell's analytic bound — a sentinel that cannot drift, and a
   radial sweep that crosses pad → ramp → intersection → embankment → wild in one line (the
   guard-scope lesson: the seams are where a bag and a mesh disagree). */
test('PROOF e — sampler vs the mesh triangle split: |Δ| ≤ |twist|/4 per sample, across regimes', () => {
  const { t, sample } = BUILT;
  const { size, height, sea, relief } = t;
  const half = W.worldSize / 2;
  const wy = (hh) => W.baseY + (hh - sea) * relief;
  const meshHeight = (x, z) => {
    const fx = Math.min(size - 1, Math.max(0, (x + half) / CELL));
    const fz = Math.min(size - 1, Math.max(0, (z + half) / CELL));
    let i = Math.floor(fx), j = Math.floor(fz);
    if (i >= size - 1) i = size - 2;
    if (j >= size - 1) j = size - 2;
    const u = fx - i, v = fz - j;
    const h00 = wy(height[j * size + i]), h10 = wy(height[j * size + i + 1]);
    const h01 = wy(height[(j + 1) * size + i]), h11 = wy(height[(j + 1) * size + i + 1]);
    // fillChunk's own split: A (00, 01, 10) covers u+v ≤ 1; B (10, 01, 11) the rest
    const plane = (u + v <= 1)
      ? h00 + u * (h10 - h00) + v * (h01 - h00)
      : h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11);
    const twist = h00 + h11 - h10 - h01;
    return { plane, bound: Math.abs(twist) / 4 };
  };
  let n = 0, worstOver = -Infinity;
  for (let ang = 0; ang < 8; ang++) {            // 8 radial lines: every one crosses all four regimes
    const a = (ang / 8) * Math.PI * 2 + 0.13;
    for (let r = 0.3; r < half - 1; r += CELL * 0.37) {   // incommensurate step — no texel-lattice aliasing
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const m = meshHeight(x, z);
      const over = Math.abs(sample(x, z) - m.plane) - (m.bound + 1e-9);
      if (over > worstOver) worstOver = over;
      assert.ok(over <= 0, `bag vs mesh at (${x.toFixed(2)}, ${z.toFixed(2)}): |Δ| exceeds the twist bound by ${over}`);
      n++;
    }
  }
  assert.ok(n > 900, `only ${n} samples — the sweep collapsed`);
});

test('carve — pavement lands under the city, the embankment keeps its wild biome', () => {
  const { t } = BUILT;
  assert.equal(BIOMES[7].key, 'pavement');
  assert.ok(BUILT.carve.stats.pavedTexels > 15000, `pavedTexels ${BUILT.carve.stats.pavedTexels}`);
  const half = W.worldSize / 2;
  const at = (x, z) => t.biome[Math.round((z + half) / CELL) * t.size + Math.round((x + half) / CELL)];
  assert.equal(at(0, 0), 7, 'the plaza centre must be pavement');
  const rim = ((LAYOUT.cols - 1) / 2) * LAYOUT.spacing + (LAYOUT.spacing - CARVE.streetW) / 2 + CARVE.streetW;
  assert.notEqual(at(rim + CARVE.blend * 0.6, 0), 7, 'mid-embankment must keep the wild biome (mask < 0.999 there)');
  assert.notEqual(at(rim + CARVE.blend + 2, 0), 7, 'wild terrain must be untouched');
});

test('carve — deterministic: same seed byte-identical, different seed differs', () => {
  const a = build(), b = build();
  assert.deepEqual(Buffer.from(a.t.height.buffer), Buffer.from(b.t.height.buffer), 'same seed must carve byte-identical');
  const c = generateTerrain({ seed: W.seed + 1, size: W.size, preset: 'valley' });
  carveCityPads(c, { worldSize: W.worldSize, baseY: W.baseY }, LAYOUT, CARVE);
  assert.notDeepEqual(Buffer.from(a.t.height.buffer), Buffer.from(c.height.buffer), 'a different seed must differ');
});
