/* ============================================================
   terrain.js — Lesson 64: a PROCEDURAL TERRAIN generator (Arc 1 of the world-builder).
   ------------------------------------------------------------
   Laurence wants to "create more procedural worlds to poke around in" — valleys, grassland, ocean,
   land with a lake — to feel out what the engine can do. This is the FOUNDATION: a reusable terrain
   GENERATOR (engine-core, so every project inherits it) that turns a seed into a varied, explorable
   heightfield + biome map, plus a flat-shaded vertex-colour MESH to render it.

   THE GUIDING RULE (from the research synthesis, docs/guides/procedural-worlds-research.md):
   ONE CPU-authoritative heightfield (a `Float32Array`) is the single source of truth — render,
   queries, future sculpting/agents/water-basins all read THIS buffer. We do NOT do GPU-displacement-
   only (that warps the visuals but not the data you query). And we DECOUPLE the two noise fields:
   ELEVATION noise drives the *shape* (mountains/valleys), a SEPARATE MOISTURE field drives the
   *biome* (Minecraft 1.18's lesson) — so a tall mountain can be wet (forest) or dry (rock) independent
   of its height.

   THE NOISE STACK (Inigo Quilez / Red Blob Games):
   1. fBm — "fractional Brownian motion": sum octaves of a base noise at DOUBLING frequency / HALVING
      amplitude (a Fourier-ish build-up). Big smooth shapes from the low octaves, fine detail from the
      high ones. C++: a loop accumulating `amp*noise(p*freq)`, `freq*=2; amp*=0.5`.
   2. RIDGED multifractal — fold the noise with `(1-|n|)^2`: the zero-crossings become sharp RIDGES and
      the rest smooth valleys. Highest visual-per-line: blobby hills → real mountain ranges.
   3. A low-frequency MOUNTAIN MASK blends ridged peaks in only in some regions → coherent
      plains/hills/peaks zones instead of uniform spiky chaos.
   4. ONE domain-warp level — `fbm(p + 4*fbm(p))`: feed noise its own noise as a position offset, which
      bends the grid-aligned "noise look" into organic, non-repeating coastlines.

   C++ anchors: the heightfield = a 2D `float` buffer indexed `[y*size+x]` (a heightmap). The biome map
   = a parallel `uint8` buffer (an enum per cell). A biome = a 2-D lookup keyed by (elevation, moisture).
   ============================================================ */
import * as THREE from 'three';
import { mulberry32 } from './citygen.js';
import { attachVertexAO } from './vector-style.js';   // L80: beauty-tier baked vertex AO (seats the terrain folds)

/* ---- seeded 2D gradient noise (Perlin-style) ---------------------------------------------------
   Classic Perlin: a hashed PERMUTATION table assigns a pseudo-random gradient to each integer lattice
   point; a sample interpolates the dot-products of the 4 corner gradients with the offset to the point,
   through a quintic fade curve (smooth 1st+2nd derivatives → no creases). Seeded by mulberry32 (the
   same deterministic PRNG citygen uses), so a seed → a byte-identical world. Returns ~[-1, 1]. */
function makeNoise2D(seed) {
  const rng = mulberry32(seed >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {                 // Fisher-Yates shuffle (deterministic from the seed)
    const j = (rng() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);   // quintic ease
  const lerp = (a, b, t) => a + (b - a) * t;
  // 8 gradient directions packed into the low 3 bits of the hash (Perlin's grad function).
  const grad = (h, x, y) => { const u = (h & 4) ? y : x, v = (h & 4) ? x : y; return ((h & 1) ? -u : u) + ((h & 2) ? -v : v); };
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);                        // ~[-1, 1]
  };
}

/* fBm — sum `oct` octaves, frequency ×`lac` and amplitude ×`gain` each step; normalised to ~[-1,1]. */
function fbm(noise, x, y, oct, lac, gain) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { sum += amp * noise(x * freq, y * freq); norm += amp; amp *= gain; freq *= lac; }
  return sum / norm;
}
/* Ridged multifractal — `(1-|n|)^2` per octave → sharp ridges + smooth valleys; normalised to ~[0,1]. */
function ridged(noise, x, y, oct, lac, gain) {
  let amp = 0.5, freq = 1, sum = 0, norm = 0;
  for (let i = 0; i < oct; i++) { let n = 1 - Math.abs(noise(x * freq, y * freq)); n *= n; sum += amp * n; norm += amp; amp *= gain; freq *= lac; }
  return sum / norm;
}
const smoothstep = (a, b, t) => { t = Math.max(0, Math.min(1, (t - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---- BIOME TABLE — a data-driven (elevation, moisture) → biome lookup (Whittaker / Red Blob Games).
   Each biome carries a coordinated GROUND COLOUR (the research's "palette sells a biome cheaper than
   geometry"). `idx` is the value stored in the biome buffer. Extend this table to add biomes. ------- */
export const BIOMES = [
  { key: 'ocean',     color: '#2a5b7a' },   // 0 — below sea level (mostly hidden by the water plane)
  { key: 'beach',     color: '#d8c89a' },   // 1 — the wet sand band just above sea level
  { key: 'grassland', color: '#6f9a4e' },   // 2 — low, dry-ish plains
  { key: 'forest',    color: '#3f6b3a' },   // 3 — low/mid + wet
  { key: 'hills',     color: '#8a8a55' },   // 4 — mid elevation
  { key: 'rock',      color: '#7d7468' },   // 5 — high, exposed
  { key: 'snow',      color: '#eef2f6' },   // 6 — the peaks
];
const B = Object.fromEntries(BIOMES.map((b, i) => [b.key, i]));

/* Classify one cell. `e` is normalised elevation [0,1], `m` moisture [0,1], `sea` the sea-level cut.
   A height-band gate first (ocean/beach/peak), then moisture splits the mid bands (Valheim-style). */
function classify(e, m, sea) {
  if (e < sea - 0.015) return B.ocean;
  if (e < sea + 0.02)  return B.beach;
  const land = (e - sea) / (1 - sea);              // 0 at shore → 1 at the highest point
  if (land > 0.82) return B.snow;
  if (land > 0.60) return m > 0.5 ? B.rock : B.rock;   // high & exposed
  if (land > 0.34) return m > 0.45 ? B.forest : B.hills;
  return m > 0.55 ? B.forest : B.grassland;        // low plains: wet → forest, dry → grassland
}

/* ---- BIOME PRESETS — one-tap parameter sets that bias the world toward a theme (the UX research's
   "reroll is the hero, a preset row is second"). Each tweaks the elevation shaping + sea level + how
   strongly mountains intrude, so a tap gives a coherent *kind* of world (not a random soup). -------- */
export const TERRAIN_PRESETS = {
  valley:      { freq: 2.3, mtnMask: 0.30, mtnGain: 0.55, sea: 0.30, relief: 7.5,  warp: 0.9 },
  archipelago: { freq: 3.4, mtnMask: 0.18, mtnGain: 0.40, sea: 0.50, relief: 6.0,  warp: 1.3 },
  mountains:   { freq: 2.0, mtnMask: 0.62, mtnGain: 0.85, sea: 0.26, relief: 11.0, warp: 0.8 },
  plains:      { freq: 1.8, mtnMask: 0.12, mtnGain: 0.30, sea: 0.28, relief: 4.5,  warp: 0.7 },
};
export const PRESET_KEYS = Object.keys(TERRAIN_PRESETS);

/* ============================================================================================
   generateTerrain({ seed, size, preset, ... }) → the heightfield + biome map (the source of truth).
   - `size`   : grid resolution per side (e.g. 160 → 160×160 = 25.6k samples). More = finer.
   - `preset` : a key into TERRAIN_PRESETS (or pass explicit params to override).
   Returns { size, height:Float32Array (normalised 0..1), biome:Uint8Array, sea, relief, minH, maxH,
   params }. World placement (units, sea→y) happens in buildTerrainMesh — the data here is unit-free.
   ============================================================================================ */
export function generateTerrain({ seed = 1, size = 160, preset = 'valley', params = null } = {}) {
  const P = params || TERRAIN_PRESETS[preset] || TERRAIN_PRESETS.valley;
  // four DECORRELATED noise fields (different seeds): shape, the mountain mask, moisture, domain-warp.
  const elevN = makeNoise2D(seed * 2 + 1);
  const maskN = makeNoise2D(seed * 5 + 9);
  const moistN = makeNoise2D(seed * 7 + 13);
  const warpN = makeNoise2D(seed * 3 + 5);

  const height = new Float32Array(size * size);
  const biome = new Uint8Array(size * size);
  let minH = Infinity, maxH = -Infinity;

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      // normalise the cell to a noise-space coordinate (centred so warps stay symmetric)
      const nx = (i / size - 0.5) * P.freq;
      const ny = (j / size - 0.5) * P.freq;
      // 1 DOMAIN WARP: offset the sample point by its own low-freq fBm → organic, non-grid shapes.
      const wx = nx + P.warp * fbm(warpN, nx + 5.2, ny + 1.3, 4, 2, 0.5);
      const wy = ny + P.warp * fbm(warpN, nx + 9.7, ny + 4.1, 4, 2, 0.5);
      // 2 base elevation fBm → [0,1]
      let e = fbm(elevN, wx, wy, 6, 2, 0.5) * 0.5 + 0.5;
      // 3 RIDGED mountains, blended in by a low-freq mask → coherent mountain REGIONS
      const mask = smoothstep(0.45, 0.75, fbm(maskN, nx * 0.5, ny * 0.5, 3, 2, 0.5) * 0.5 + 0.5);
      const mtn = ridged(elevN, wx * 1.7 + 11, wy * 1.7 + 7, 5, 2, 0.5);   // [0,1]
      e = e * (1 - mask * P.mtnMask) + mtn * (mask * P.mtnMask * (0.6 + P.mtnGain));
      // radial falloff → the world is an ISLAND/landmass surrounded by ocean (edges sink under the sea)
      const dx = i / size - 0.5, dy = j / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;        // 0 centre → ~1 at the edge midpoints
      e -= smoothstep(0.62, 1.0, r) * 0.55;              // pull the rim below sea level
      e = Math.max(0, Math.min(1, e));

      const m = fbm(moistN, nx * 0.8 + 3, ny * 0.8 + 8, 4, 2, 0.5) * 0.5 + 0.5;   // moisture [0,1]
      const idx = j * size + i;
      height[idx] = e;
      biome[idx] = classify(e, m, P.sea);
      if (e < minH) minH = e; if (e > maxH) maxH = e;
    }
  }
  return { size, height, biome, sea: P.sea, relief: P.relief, minH, maxH, params: P, seed, preset };
}

/* ============================================================================================
   buildTerrainMesh(terrain, { worldSize, baseY, chunks }) → a THREE.Group of CHUNKED, FLAT-SHADED,
   VERTEX-COLOURED meshes. Flat-shaded faceting IS the stylized look (and it's the correct, cheap tech
   — no texture splatting). NON-INDEXED geometry: every triangle owns its 3 vertices, so each face gets
   ONE flat normal + ONE flat colour (the low-poly look). Chunked (default 4×4) so the GPU frustum-culls
   off-screen tiles + a future sculpt pass can re-upload only the dirty chunk.
   - `worldSize` : the terrain's footprint in world units (fits inside the wave-sim water plane).
   - `baseY`     : the world Y of SEA LEVEL (so terrain below `sea` sits under the water plane).
   - relief (from the terrain) scales normalised height → world height above/below sea.
   ============================================================================================ */
const _palette = BIOMES.map((b) => new THREE.Color(b.color));
const _cols = new THREE.Color(), _ab = new THREE.Vector3(), _ac = new THREE.Vector3(), _n = new THREE.Vector3();

/* Fill a chunk's position (+ normal, + colour if `writeColor`) arrays from the CURRENT heightfield. Used
   both at build and on a live SCULPT rebuild (L69). `m` = { i0,j0,i1,j1 } chunk bounds; `w` = world map. */
function fillChunk(terrain, w, m, pos, nor, col, ao, writeColor) {
  const { size, height, biome, sea, relief } = terrain;
  const { cell, half, baseY } = w;
  const wx = (i) => i * cell - half, wz = (j) => j * cell - half, wy = (h) => baseY + (h - sea) * relief;
  /* L80 baked AO from local CONCAVITY: a vertex that sits BELOW the average of its 4 grid neighbours is in a
     valley fold / basin → more ambient-occluded → darker. A cheap discrete-Laplacian curvature; scaled to a
     gentle 0..0.5 occlusion (the beauty tier multiplies it in, the stylized tiers gate it to 0). */
  const aoAt = (i, j) => {
    const h = height[j * size + i]; let sum = 0, n = 0;
    if (i > 0) { sum += height[j * size + i - 1]; n++; }
    if (i < size - 1) { sum += height[j * size + i + 1]; n++; }
    if (j > 0) { sum += height[(j - 1) * size + i]; n++; }
    if (j < size - 1) { sum += height[(j + 1) * size + i]; n++; }
    const conc = Math.max(0, (n ? sum / n : h) - h);     // below neighbours → concave
    return Math.min(0.5, conc * relief * 0.8);
  };
  let v = 0;
  const tri = (ax, ay, az, bx, by, bz, cx, cy, cz, c, aoa, aob, aoc) => {
    _ab.set(bx - ax, by - ay, bz - az); _ac.set(cx - ax, cy - ay, cz - az);
    _n.crossVectors(_ab, _ac).normalize();
    const verts = [[ax, ay, az, aoa], [bx, by, bz, aob], [cx, cy, cz, aoc]];
    for (const [x, y, z, a] of verts) {
      pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
      nor[v * 3] = _n.x; nor[v * 3 + 1] = _n.y; nor[v * 3 + 2] = _n.z;
      if (writeColor) { col[v * 3] = c.r; col[v * 3 + 1] = c.g; col[v * 3 + 2] = c.b; }
      if (ao) ao[v] = a;                                 // L80: per-vertex baked occlusion (one float per vertex)
      v++;
    }
  };
  for (let j = m.j0; j < m.j1; j++) {
    for (let i = m.i0; i < m.i1; i++) {
      const x0 = wx(i), x1 = wx(i + 1), z0 = wz(j), z1 = wz(j + 1);
      const y00 = wy(height[j * size + i]), y10 = wy(height[j * size + i + 1]);
      const y01 = wy(height[(j + 1) * size + i]), y11 = wy(height[(j + 1) * size + i + 1]);
      const a00 = aoAt(i, j), a10 = aoAt(i + 1, j), a01 = aoAt(i, j + 1), a11 = aoAt(i + 1, j + 1);
      const c1 = _palette[biome[j * size + i]], c2 = _palette[biome[(j + 1) * size + i + 1]];
      tri(x0, y00, z0, x0, y01, z1, x1, y10, z0, _cols.copy(c1), a00, a01, a10);   // triangle A (00, 01, 10)
      tri(x1, y10, z0, x0, y01, z1, x1, y11, z1, _cols.copy(c2), a10, a01, a11);   // triangle B (10, 01, 11)
    }
  }
}

export function buildTerrainMesh(terrain, { worldSize = 26, baseY = 0, chunks = 4 } = {}) {
  const { size } = terrain;
  const group = new THREE.Group();
  const w = { cell: worldSize / (size - 1), half: worldSize / 2, baseY };
  group.userData.world = w;                              // L69: stored so a sculpt rebuild reuses the mapping
  const per = Math.ceil((size - 1) / chunks);            // grid cells per chunk side
  for (let cj = 0; cj < chunks; cj++) {
    for (let ci = 0; ci < chunks; ci++) {
      const i0 = ci * per, j0 = cj * per;
      const i1 = Math.min(i0 + per, size - 1), j1 = Math.min(j0 + per, size - 1);
      if (i1 <= i0 || j1 <= j0) continue;
      const m = { i0, j0, i1, j1 };
      const verts = (i1 - i0) * (j1 - j0) * 6;            // 2 triangles × 3 verts per cell
      const pos = new Float32Array(verts * 3), nor = new Float32Array(verts * 3), col = new Float32Array(verts * 3);
      const ao = new Float32Array(verts);                 // L80: one baked-AO float per vertex
      fillChunk(terrain, w, m, pos, nor, col, ao, true);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));   // L80: baked vertex AO (read by attachVertexAO)
      geo.computeBoundingSphere();
      const mat = attachVertexAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0, flatShading: true }));
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true; mesh.receiveShadow = true;
      mesh.userData.chunk = m;                            // L69: chunk bounds → which cells this mesh owns
      group.add(mesh);                                    // raycast ENABLED (L69 sculpt picks the terrain)
    }
  }
  group.userData.dispose = () => group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return group;
}

/* L69/L71 — rebuild ONLY the chunk meshes a brush edit touched: recompute position + flat normals from the
   mutated heightfield. A dirty-region update, not a full-mesh rebuild → cheap enough to run live while
   dragging. `writeColor` (L71 PAINT-TERRAIN): when true, also re-bake the per-cell biome→vertex colour from
   the mutated `biome[]` (sculpt passes false — it changes SHAPE; paint passes true — it changes the biome). */
export function rebuildTerrainChunks(group, terrain, dirtyMeshes, writeColor = false) {
  const w = group.userData.world;
  for (const mesh of dirtyMeshes) {
    const geo = mesh.geometry;
    const aoArr = geo.attributes.aAo ? geo.attributes.aAo.array : null;   // L80: re-bake AO too (shape changed → folds moved)
    fillChunk(terrain, w, mesh.userData.chunk, geo.attributes.position.array, geo.attributes.normal.array, geo.attributes.color.array, aoArr, writeColor);
    geo.attributes.position.needsUpdate = true;
    geo.attributes.normal.needsUpdate = true;
    if (aoArr) geo.attributes.aAo.needsUpdate = true;
    if (writeColor) geo.attributes.color.needsUpdate = true;
    geo.computeBoundingSphere();                          // keep frustum-cull + raycast bounds correct
  }
}
