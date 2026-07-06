/* ============================================================
   citygen.js — Lesson 13: a SEEDED procedural city generator (Phase 1).
   ------------------------------------------------------------
   Lessons 07–12 framed ONE hand-placed district. This generates a city from a NUMBER.
   Same seed → byte-identical city, every time, on every machine — that determinism is
   the whole point: a city becomes a shareable address (`?city=1234`), and later the
   replay/multiplayer property a game needs. Different seeds → different but plausible
   cities. Three "profiles" (Manhattan / Paris / Neo-Tokyo) re-skin the same rules into
   recognizably different places — the multi-city pitch, from one generator.

   THE PIPELINE (each step its own small, testable idea):
     1. SEED a PRNG (mulberry32) — deterministic pseudo-randomness.
     2. GRID the island into N×N blocks separated by streets.
     3. SPLIT each block into 1–4 lots (BSP-lite: maybe halve each axis).
     4. a GAUSSIAN height field over the island → tall downtown core, low-rise edges.
     5. BUILD each lot: a parameterized box that adopts our flat-vector style + windows
        (reusing `vectorizeTower`), plus shopfront bands, parks+trees, roof details.
     6. place a few LANDMARKS at the tallest core lots (via an injected factory).
   Everything flows through the existing styles/day-night/post for free.

   C++ ANCHORS (Laurence learns via C++):
   - mulberry32 ≈ a tiny `std::mt19937` you seed and pull floats from — reproducible.
   - The profile objects ≈ a `struct CityProfile { ... }` table; data drives the generator.
   - REGENERATE must free the old city's GPU buffers: `geometry.dispose()` ≈ `delete` on a
     resource you own. JS garbage-collects the JS object, but the GPU VRAM is yours to free —
     forget it and you leak VRAM every reroll (like leaking a `new[]` every frame).
   ============================================================ */
import * as THREE from 'three';
import { vectorize, vectorizeTower } from './vector-style.js';

/* ---- mulberry32: a 32-bit seeded PRNG. Pure function of its internal state → the SAME
   seed yields the SAME sequence forever. ~5 lines, fast, good enough for art (not crypto). */
export function mulberry32(seed) {
  let a = seed >>> 0;                                  // force unsigned 32-bit
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;     // → [0,1)
  };
}

/* Tiny RNG façade so the generator reads cleanly (range / int / pick / chance). */
function makeRng(seed) {
  const next = mulberry32(seed);
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    chance: (p) => next() < p,
  };
}

/* L92 (palette, part 3) — PER-BUILDING TINT. The towers palettes lean pale (Paris is all light cream), so
   the blocky placeholder masses read flat + blown-white under the sky-IBL. This pulls each building's picked
   colour's VALUE down (most on the palest, least on the already-dark — a multiplier on L) and jitters hue +
   saturation a touch, so every building reads a little different → the geometry looks DELIBERATE, not a
   uniform pale grid. Deterministic (the building rng → same seed = same city; colours don't feed the
   position-based determinism signature). C++: a per-instance constant transform of the base albedo. */
const _tintC = new THREE.Color();
const _tintHSL = { h: 0, s: 0, l: 0 };
function tintTower(hex, rng) {
  _tintC.set(hex).getHSL(_tintHSL);
  _tintHSL.l = Math.max(0.10, Math.min(0.90, _tintHSL.l * (0.78 + rng.next() * 0.14)));   // VALUE down (fix pale) + vary
  _tintHSL.h = (_tintHSL.h + (rng.next() - 0.5) * 0.045 + 1.0) % 1.0;                       // small hue jitter
  _tintHSL.s = Math.min(1.0, _tintHSL.s * (0.92 + rng.next() * 0.26));                      // slight saturation vary
  _tintC.setHSL(_tintHSL.h, _tintHSL.s, _tintHSL.l);
  return '#' + _tintC.getHexString();
}

/* ---- THE PROFILES — data-driven cities. Each is a palette + a few character knobs the
   generator reads; nothing here is code, so adding a city later is just another row.
   palette: towers[] (building bodies) / ground / street / sidewalk / park / water /
   shopfronts[] (ground-floor accent bands) / glass (day-window tint) / winColors[] (night).
   character: hMax (core tower height, wu) · sigma (downtown spread) · roofRate · pSplit
   (lot subdivision likelihood) · nightLit (fraction of windows lit at full night) ·
   roofTint (optional top-face tint — Paris zinc mansards) · landmarks (which model keys). */
export const PROFILES = [
  {
    key: 'manhattan', name: 'Manhattan',
    towers: ['#EDE3C8', '#D9B98A', '#B5562F', '#A8C8E8', '#2E3F5C'],
    ground: '#7CC455', street: '#9AA0A6', sidewalk: '#C8CCD0', park: '#5DB347', water: '#29A8D8',
    shopfronts: ['#C04A3A', '#3A7AC0', '#C09A2A'], glass: '#7FA8CC',
    winColors: ['#ffd27a', '#9ad6ff'],                // warm offices + a few cool screens
    hMax: 4.6, sigma: 0.36, roofRate: 0.35, pSplit: 0.60, nightLit: 0.55, roofTint: null,
    // L28 coast flavour — Manhattan = ISLAND-LIKE: a tight base (more open water around it) with bold
    // capes + coves (high out/in), moderately crisp edges.
    coast: { base: 0.55, out: 1.00, in: 0.60, jag: 1.05 },
    landmarks: ['empireState', 'chrysler', 'liberty'],  // L14: procedural NYC icons
  },
  {
    key: 'paris', name: 'Paris',
    towers: ['#E8DCC0', '#F2EAD6', '#E0D2B4'],
    ground: '#8CC46A', street: '#A8A29A', sidewalk: '#D4CEC2', park: '#6DB35A', water: '#3FA8C8',
    shopfronts: ['#C04A3A', '#3A6B5A', '#7A5AC0'], glass: '#5A6B7A',
    winColors: ['#ffdca0', '#ffcaa0'],                // warm, low, sleepy
    hMax: 1.5, sigma: 0.90, roofRate: 0.15, pSplit: 0.75, nightLit: 0.45, roofTint: '#6A7886',
    // L28 coast flavour — Paris = BROAD + GENTLE: a wide base (land reaches further) with soft, low-
    // frequency curves (low out/in, jag < 1 damps the fine capes).
    coast: { base: 1.05, out: 0.55, in: 0.30, jag: 0.50 },
    landmarks: ['eiffel', 'arcDeTriomphe', 'sacreCoeur'],  // L14: Paris icons
  },
  {
    key: 'neoTokyo', name: 'Neo-Tokyo',
    towers: ['#2A3038', '#3A4250', '#252B36', '#4A4456'],
    ground: '#3A4A42', street: '#5A6068', sidewalk: '#7A8088', park: '#2E5E46', water: '#0E6878',
    shopfronts: ['#E8483A', '#5AE8E0', '#E85AA0'], glass: '#5AE8E0',
    winColors: ['#5AE8E0', '#E85AA0', '#E8E06A'],     // neon trio — the city never sleeps
    hMax: 5.2, sigma: 0.42, roofRate: 0.60, pSplit: 0.60, nightLit: 0.70, roofTint: null,
    // L28 coast flavour — Neo-Tokyo = JAGGED: many smaller capes/inlets (jag > 1 boosts the high
    // octaves) over a moderate base — a busy, fractured industrial waterfront.
    coast: { base: 0.70, out: 1.05, in: 0.62, jag: 1.70 },
    landmarks: ['tokyoTower', 'pagoda', 'neonBillboard'],  // L14: Neo-Tokyo icons
  },
];
export const PROFILE_KEYS = PROFILES.map((p) => p.key);

/* ---- layout constants (world units, wu) ---- */
const PLINTH_TOP = 0.3;          // island top y (towers stand here; body sinks below water)
const BLOCK = 1.9;               // block square side
const STREET = 0.55;             // street gap between blocks
const PITCH = BLOCK + STREET;    // block-to-block spacing (2.45)
const SIDEWALK = 0.12;           // sidewalk border inset on each block edge
const SHORE = 0.6;               // island margin beyond the outermost blocks
const N = 6;                     // L20: 6×6 blocks (bigger map). One source of truth: generate()
                                 // AND the L24 street network (agents.js) both read it.

/* ---- L25 coastline constants (world units) ----
   The block field is a square; its outer edge sits at BLOCK_HALF = half + BLOCK/2 from centre.
   COAST.BASE is how far the (still roughly square) base shoreline sits BEYOND that block edge —
   a green coastal margin. The shore then WOBBLES around that base: OUT = max seaward bulge (a
   headland/point), IN = max landward bite (a gentle bay). HARBOR_* carve ONE deep inlet into the
   camera-facing +X edge. Everything stays seaward of the blocks (a hard clamp), so no reroll can
   ever flood the grid — determinism + dry land are both invariants. */
const COAST = {
  BASE: 0.70,          // base shoreline margin beyond the outer block edge (fallback; profiles override)
  OUT: 0.95,           // max seaward bulge (a point/headland) — L28 bolder default
  IN: 0.55,            // max landward bite (a bay) — L28 bolder default
  JAG: 1.0,            // harmonic richness (>1 = more, finer capes; <1 = smoother)
  SAMPLES_PER_EDGE: 28,// shoreline resolution (×4 edges) — a touch finer for the bolder shapes
  HARBOR_DEPTH: 0.55,  // how far PAST the base the harbor mouth bites inland
  HARBOR_WIDTH: 0.26,  // harbor mouth half-extent as a fraction of an edge (≈ a quarter of it)
};

/* L24: EXPORT the layout so the street generator (agents.js) lays roads in the EXACT gaps this
   file reserves — no duplicated magic numbers that could silently drift apart (Rule 7). The
   blocks sit on a regular grid, so the STREETS are the N+1 gap-lines per axis between/around them.
   L25 adds the coastline knobs so any future water-life module reads ONE source of truth.
   C++ anchor: a small `struct CityLayout` shared header both translation units include. */
export const LAYOUT = { PLINTH_TOP, BLOCK, STREET, PITCH, SIDEWALK, SHORE, N, COAST };

/* ---- L25: a deterministic irregular COASTLINE ----------------------------------------------
   PHASE 1–2 framed the city on a flat SQUARE island. Phase 3 gives the world a real EDGE:
   land where the shoreline says land, water everywhere seaward of it. We build the shore as a
   closed loop of points by walking the perimeter of a base square (half-side B) and pushing each
   sample OUT or IN along its edge normal by a smooth, seed-driven offset → headlands and bays
   instead of four straight sides. One stretch of the +X (camera-facing) edge is pulled deep
   inland = the HARBOR inlet (where L26 boats will live). It is a PURE FUNCTION of the seed: the
   same seed yields byte-identical points on every machine.

   C++ ANCHORS:
   - A coastline = a THRESHOLD on a field: land where the radius ≥ the shoreline, water below
     (here expressed as a polygon outline rather than a sampled 2-D mask — same idea, cheaper to
     triangulate). C++: a `float shoreline(float angle)` you compare a sample point against.
   - "value noise over the perimeter" = a few SINE OCTAVES with seeded phases. Periodic by
     construction (period = the full loop) so the shore meets itself with no seam, and pure:
     same seed → same coefficient table → same coast. C++: a `constexpr` harmonics table. */
function buildCoastline(seed, blockHalf, coast) {
  // L28: per-PROFILE coast flavour. The shape is the same seeded noise, but `base/out/in/jag` come
  // from the profile (a config struct selected by city) → Manhattan island-like, Paris broad+gentle,
  // Neo-Tokyo jagged. Falls back to the global COAST defaults if a profile omits them.
  const base = coast?.base ?? COAST.BASE, out = coast?.out ?? COAST.OUT;
  const inAmp = coast?.in ?? COAST.IN, jag = coast?.jag ?? COAST.JAG;
  const B = blockHalf + base;                       // base (roughly square) shoreline half-side
  // A SEPARATE PRNG stream from the city layout (xor a constant) so rerolling the seed changes
  // the coast too, but the coast never disturbs the building RNG sequence.
  const rng = makeRng((seed ^ 0xC0A57) >>> 0);
  // Sine octaves with seeded phases → smooth periodic noise. `jag` re-weights the HIGHER octaves
  // (pow(jag, (k-2)/6)): jag>1 lifts the fine capes (jagged), jag<1 damps them (smooth) — same
  // function, profile-keyed constants. k=2 is always unscaled (the big low-frequency lobe).
  const harm = [2, 3, 5, 8, 11, 13].map((k) => ({ k, amp: (1 / k) * Math.pow(jag, (k - 2) / 6), phase: rng.range(0, Math.PI * 2) }));
  const sumAmp = harm.reduce((s, h) => s + h.amp, 0);
  const wob = (u) => {                               // periodic noise CLAMPED to [-1,1], pure fn of u∈[0,1)
    let s = 0;
    for (const h of harm) s += h.amp * Math.sin(h.k * u * Math.PI * 2 + h.phase);
    return Math.max(-1, Math.min(1, s / (sumAmp * 0.6)));  // 0.6 → bolder excursions reach the rails
  };
  // Four edges walked CCW. Each: which coord is FIXED (±B), the outward normal, and the sign that
  // makes the varying coord sweep so the loop stays counter-clockwise (consistent winding).
  const edges = [
    { fix: +B, nx: +1, nz: 0, sign: +1 },           // +X edge: x=+B, z sweeps -B→+B
    { fix: +B, nx: 0, nz: +1, sign: -1 },           // +Z edge: z=+B, x sweeps +B→-B
    { fix: -B, nx: -1, nz: 0, sign: -1 },           // -X edge: x=-B, z sweeps +B→-B
    { fix: -B, nx: 0, nz: -1, sign: +1 },           // -Z edge: z=-B, x sweeps -B→+B
  ];
  const minR = blockHalf + 0.22;                     // HARD floor: shore never crosses this → blocks stay dry
  const S = COAST.SAMPLES_PER_EDGE, total = 4 * S;
  const pts = [];
  let gi = 0;
  for (let e = 0; e < 4; e++) {
    const ed = edges[e];
    for (let i = 0; i < S; i++, gi++) {
      const t = i / S;                               // 0..1 along this edge
      const u = gi / total;                          // 0..1 around the whole loop (for periodic noise)
      const along = (-B + 2 * B * t) * ed.sign;      // the coordinate that varies along the edge
      const w = wob(u);
      let off = w >= 0 ? w * out : w * inAmp;         // asymmetric: bolder points, gentler bays
      // HARBOR: a deep inland bite centred on the +X edge midpoint (e===0, t≈0.5), cosine-tapered
      // so the inlet has soft sloping sides, not a square gash.
      if (e === 0) {
        const d = Math.abs(t - 0.5);
        if (d < COAST.HARBOR_WIDTH) {
          const k = 0.5 + 0.5 * Math.cos((d / COAST.HARBOR_WIDTH) * Math.PI); // 1 at centre → 0 at mouth edges
          off -= (base + COAST.HARBOR_DEPTH) * k;
        }
      }
      // place the point: fixed coord nudged by normal*off; clamp the seaward axis to minR so the
      // coast (and the harbor) can never eat into the block field.
      let x, z;
      if (ed.nx !== 0) {                             // ±X edge
        x = ed.fix + ed.nx * off; z = along;
        x = ed.nx > 0 ? Math.max(x, minR) : Math.min(x, -minR);
      } else {                                       // ±Z edge
        z = ed.fix + ed.nz * off; x = along;
        z = ed.nz > 0 ? Math.max(z, minR) : Math.min(z, -minR);
      }
      pts.push(new THREE.Vector2(x, z));
    }
  }
  return { points: pts, B, maxR: B + out, harborX: minR };
}

/* dispose a material (or material array) — free its GPU program-side resources. */
function disposeMat(m) { (Array.isArray(m) ? m : [m]).forEach((x) => x && x.dispose && x.dispose()); }

export function createCity({ seed = 1, profileIndex = 0, landmarkFactory = null, windowGlow }) {
  const group = new THREE.Group();
  // Two sub-groups with different teardown rules: PROCEDURAL meshes own their geometry (we
  // dispose it on regenerate); LANDMARK clones share cached GLB geometry (dispose materials only).
  const procedural = new THREE.Group();
  const landmarksG = new THREE.Group();
  procedural.raycast = () => {}; landmarksG.raycast = () => {};   // keep the water raycast clean
  group.add(procedural, landmarksG);

  /* LIGHTS — same SunRig-driven key+fill the old diorama had (main.js sets them each frame). */
  const key = new THREE.DirectionalLight(0xfff1da, 3.0);
  key.position.set(0.45, 0.6, -0.65).multiplyScalar(10);
  const fill = new THREE.HemisphereLight(0x6f97b3, 0x2a2620, 1.0);
  group.add(key, fill);

  /* reusable scratch + a per-build window-id counter (each building twinkles uniquely). */
  let winId = 0;
  const blinkers = [];             // {mesh, base} small emissive roof lights pulsed in update()

  let state = { seed, profileIndex, profile: PROFILES[profileIndex], extent: 0, meshCount: 0 };

  /* ---- small builders ------------------------------------------------------ */
  // a flat horizontal slab (street/sidewalk/park ground) at y, sized w×d, vector-tinted.
  function slab(w, d, y, colorHex) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, 0.04, d),
      vectorize(new THREE.MeshStandardMaterial({ color: colorHex, roughness: 0.95, flatShading: true }), { color: colorHex }),
    );
    m.position.y = y;
    m.userData.ground = true;                          // flat ground → RECEIVES shadows, doesn't cast
    return m;
  }
  /* ---- the GENERATE step: tear down the old city, build a new one from (seed, profile) -- */
  function generate(nextSeed, nextProfileIndex) {
    // --- teardown (free GPU memory we own) ---
    for (const o of procedural.children) { o.geometry && o.geometry.dispose(); disposeMat(o.material); }
    procedural.clear();
    // L110 (audit B12): landmark teardown was materials-ONLY (right for GLB clones, which SHARE cached geometry).
    // But every profile now uses PROCEDURAL icons that OWN their geometry (userData.ownsGeometry, set by the factory)
    // → their geometry leaked on every reroll/regenerate. Dispose geometry for owned icons; keep materials-only for GLB.
    for (const o of landmarksG.children) {
      const owns = o.userData && o.userData.ownsGeometry;
      o.traverse((m) => { if (m.isMesh) { disposeMat(m.material); if (owns && m.geometry) m.geometry.dispose(); } });
    }
    landmarksG.clear();
    blinkers.length = 0;
    winId = 0;

    const rng = makeRng(nextSeed);
    const prof = PROFILES[nextProfileIndex];
    const half = ((N - 1) / 2) * PITCH;             // block-centre span half-width
    const blockHalf = half + BLOCK / 2;             // outer edge of the block field
    const extent = blockHalf + (prof.coast?.base ?? COAST.BASE);  // NOMINAL land half-size (per-profile shore)
    state = { seed: nextSeed, profileIndex: nextProfileIndex, profile: prof, extent, meshCount: 0 };

    // L25 ISLAND — an IRREGULAR landmass whose outline IS the coastline (was a square box). We
    // build the shore polygon (pure fn of seed), make a THREE.Shape, and EXTRUDE it downward 2wu so
    // it still straddles the waterline — the top cap (y = PLINTH_TOP) is the land the city sits on;
    // the flank sinks to -1.7 for the grab-pass refraction, exactly like the old box did.
    const coast = buildCoastline(nextSeed, blockHalf, prof.coast);
    state.coast = coast;
    const shape = new THREE.Shape();
    coast.points.forEach((p, i) => (i ? shape.lineTo(p.x, p.y) : shape.moveTo(p.x, p.y)));
    shape.closePath();
    const islandGeo = new THREE.ExtrudeGeometry(shape, { depth: 2, bevelEnabled: false, steps: 1 });
    // Shape lives in XY; rotating -90° about X lays it on the ground (XZ) and sends the extrusion
    // depth DOWN. DoubleSide so the cap renders regardless of the polygon's winding (one mesh, cheap).
    const island = new THREE.Mesh(
      islandGeo,
      vectorize(new THREE.MeshStandardMaterial({ color: prof.ground, roughness: 0.9, flatShading: true, side: THREE.DoubleSide }), { color: prof.ground }),
    );
    island.rotation.x = -Math.PI / 2;
    island.position.y = PLINTH_TOP - 2;               // top cap lands at PLINTH_TOP; body sinks to -1.7
    island.userData.ground = true;                    // the landmass top RECEIVES shadows
    procedural.add(island);
    // STREET layer: one square slab covering JUST the block field (a touch beyond the outer blocks,
    // but well INSIDE the shoreline, so the exposed land between street grid and water reads as a
    // green coastal margin). Blocks (sidewalk squares) sit on top → the gaps read as the grid.
    const streetSize = 2 * (blockHalf + 0.12);
    procedural.add(slab(streetSize, streetSize, PLINTH_TOP + 0.02, prof.street));
    // L25 HARBOR DOCKS — a couple of timber piers reaching out over the inlet on the +X edge, plus
    // a quay plank along the shore. The seam L26 boats + harbor life will tie up to. Deterministic.
    buildDocks(coast.harborX, prof);

    // choose park blocks (~8%, min 1) up front so buildings skip them.
    const blocks = [];
    for (let gx = 0; gx < N; gx++) for (let gz = 0; gz < N; gz++) blocks.push([gx, gz]);
    const parkSet = new Set();
    const nParks = Math.max(1, Math.round(blocks.length * 0.08));
    while (parkSet.size < nParks) parkSet.add(rng.int(0, blocks.length - 1));

    // downtown centre (a small seeded offset so the core isn't always dead-centre).
    const cxC = rng.range(-PITCH * 0.6, PITCH * 0.6);
    const czC = rng.range(-PITCH * 0.6, PITCH * 0.6);
    const maxR = Math.hypot(half, half);            // for normalizing radial distance

    // collect candidate landmark lots (tall, large, near core) while we build.
    const candidates = [];

    blocks.forEach(([gx, gz], bi) => {
      const bx = (gx - (N - 1) / 2) * PITCH;
      const bz = (gz - (N - 1) / 2) * PITCH;
      // each block gets a sidewalk square (its base); buildings inset within.
      procedural.add(slab(BLOCK, BLOCK, PLINTH_TOP + 0.03, prof.sidewalk).translateX(bx).translateZ(bz));

      if (parkSet.has(bi)) {                         // PARK block: green + a few trees
        procedural.add(slab(BLOCK - SIDEWALK * 2, BLOCK - SIDEWALK * 2, PLINTH_TOP + 0.05, prof.park).translateX(bx).translateZ(bz));
        const nT = rng.int(3, 5);
        for (let i = 0; i < nT; i++) tree(bx + rng.range(-0.6, 0.6), bz + rng.range(-0.6, 0.6), prof, rng);
        return;
      }

      // LOTS: BSP-lite — maybe halve each axis (1–4 lots). usable area excludes the sidewalk.
      const usable = BLOCK - SIDEWALK * 2;
      const nx = rng.chance(prof.pSplit) ? 2 : 1;
      const nz = rng.chance(prof.pSplit) ? 2 : 1;
      const lw = usable / nx, ld = usable / nz;
      for (let ix = 0; ix < nx; ix++) for (let iz = 0; iz < nz; iz++) {
        const lx = bx - usable / 2 + lw * (ix + 0.5);
        const lz = bz - usable / 2 + ld * (iz + 0.5);
        const fw = Math.max(0.6, lw - 0.10), fd = Math.max(0.6, ld - 0.10);  // footprint inset

        // GAUSSIAN height field: tall near the seeded downtown centre, low at the edges.
        const r = Math.hypot(lx - cxC, lz - czC) / maxR;
        const g = Math.exp(-(r * r) / (2 * prof.sigma * prof.sigma));
        const h = Math.max(0.5, 0.5 + (prof.hMax - 0.5) * g * rng.range(0.75, 1.25));

        // a tall-ish, central lot is a landmark candidate (relaxed so flat Paris finds 3).
        if (h > prof.hMax * 0.5 && Math.min(fw, fd) >= 0.7) candidates.push({ lx, lz, fw, fd, h, r });

        addBuilding(lx, lz, fw, fd, h, prof, rng);
      }
    });

    // LANDMARKS: pick the best candidate lots (closest to core), hand each to the factory.
    if (landmarkFactory && landmarkFactory.ready) {
      candidates.sort((a, b) => a.r - b.r);
      const used = [];
      const wantKeys = prof.landmarks;
      for (let i = 0; i < wantKeys.length && candidates.length; i++) {
        // take a candidate spaced from already-used ones so landmarks don't clump.
        let cand = null;
        for (const c of candidates) {
          if (used.every((u) => Math.hypot(u.lx - c.lx, u.lz - c.lz) > PITCH * 0.9)) { cand = c; break; }
        }
        if (!cand) cand = candidates[0];
        used.push(cand);
        // remove the procedural building on that lot (the landmark replaces it).
        removeBuildingAt(cand.lx, cand.lz);
        // FIX(L14): each icon's height = hMax × its authored heightFactor, so it sits IN the
        // skyline (Liberty below the skyscrapers, pagoda small, Eiffel towering over flat Paris)
        // instead of a uniform boost that made short icons colossal on tall profiles.
        const slotH = prof.hMax * landmarkFactory.heightFactor(wantKeys[i]);
        const mesh = landmarkFactory.make(wantKeys[i], { x: cand.lx, z: cand.lz, w: cand.fw, d: cand.fd, h: slotH, plinthTop: PLINTH_TOP });
        if (mesh) {
          landmarksG.add(mesh);
          // Clear a small PLAZA: evict procedural buildings under the landmark's (scaled)
          // footprint so a tall icon doesn't intersect its neighbours.
          const fp = new THREE.Box3().setFromObject(mesh);
          evictBuildings(fp.min.x - 0.15, fp.max.x + 0.15, fp.min.z - 0.15, fp.max.z + 0.15);
        }
      }
    }

    // L16 SHADOWS: set cast/receive per mesh kind. Flat ground RECEIVES only; buildings/props/
    // landmarks CAST + RECEIVE (so the Eiffel's shadow falls across rooftops); the emissive
    // blinkers (MeshBasic) do neither. The WATER is a custom ShaderMaterial with no shadow
    // chunks — it silently ignores shadows, which is what we want (water doesn't take ground shade).
    procedural.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData.ground) { o.castShadow = false; o.receiveShadow = true; }
      else if (o.material && o.material.isMeshBasicMaterial) { o.castShadow = false; o.receiveShadow = false; }
      else { o.castShadow = true; o.receiveShadow = true; }
    });
    landmarksG.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    state.meshCount = procedural.children.length + landmarksG.children.length;
    // DETERMINISM signature: a hash of every procedural mesh's position. Same (seed, profile)
    // → same stream from mulberry32 → same layout → same sig. Lets a probe PROVE reproducibility.
    let sig = 0;
    for (const o of procedural.children) {
      const p = o.position;
      sig = (Math.imul(sig, 16777619) ^ (Math.round(p.x * 100) * 2654435761
            ^ Math.round(p.y * 100) * 40503 ^ Math.round(p.z * 100) * 2246822519)) >>> 0;
    }
    // L25: fold the COASTLINE points in too, so the signature proves the shore is deterministic.
    for (const p of state.coast.points) {
      sig = (Math.imul(sig, 16777619) ^ (Math.round(p.x * 100) * 2654435761 ^ Math.round(p.y * 100) * 40503)) >>> 0;
    }
    state.sig = sig;

    // L112 COLLISION — derive the solid AABB list (DATA only; consumes ZERO rng + adds NO mesh → the determinism sig
    // above is provably untouched, S6). A post-pass here runs AFTER landmark eviction, so evicted lots can't leak in.
    // Buildings are UNROTATED box prisms → the exact world AABB is position ± half(w,h,d) from geometry.parameters (no
    // Box3 traversal needed). Landmarks (scaled/nested) push their already-computed world Box3 — generous but never
    // clips the icon. SoA Float32Array, 6 floats/solid: minX,minY,minZ, maxX,maxY,maxZ. ~400–700 solids, a few KB.
    const rows = [];
    for (const o of procedural.children) {
      if (!o.userData.collide || o.geometry.type !== 'BoxGeometry') continue;
      const g = o.geometry.parameters, p = o.position;
      rows.push(p.x - g.width / 2, p.y - g.height / 2, p.z - g.depth / 2, p.x + g.width / 2, p.y + g.height / 2, p.z + g.depth / 2);
    }
    for (const lm of landmarksG.children) { _solidBox.setFromObject(lm); rows.push(_solidBox.min.x, _solidBox.min.y, _solidBox.min.z, _solidBox.max.x, _solidBox.max.y, _solidBox.max.z); }
    state.solids = new Float32Array(rows);

    window.__city = { seed: nextSeed, profile: prof.key, meshes: state.meshCount, sig, solids: state.solids.length / 6 };
  }
  const _solidBox = new THREE.Box3();   // L112: reused scratch for landmark world-AABBs in the solids post-pass

  /* a parameterized building box (+ optional shopfront band + roof detail). Tagged with its
     lot centre so a landmark can evict it. */
  function addBuilding(lx, lz, fw, fd, h, prof, rng) {
    const body = vectorizeTower(
      new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, metalness: 0.05, envMapIntensity: 0.3 }),   // L93: cut the sky-IBL response so the bright midday sky doesn't over-light the shadowed faces → buildings keep shadow CONTRAST + pop. Beauty-only (scene.environment is null on pixel/vector/toon → no env to respond to → those tiers byte-identical).
      { color: tintTower(rng.pick(prof.towers), rng), id: ++winId, windowGlow, winColors: prof.winColors, litFrac: prof.nightLit },   // L92: per-building value-down + hue jitter
    );
    // Paris zinc mansard: tint the TOP face via emissive-free trick is hard here; instead a thin
    // roof-coloured slab caps the building (reads as the grey mansard roof at dimetric).
    const b = new THREE.Mesh(new THREE.BoxGeometry(fw, h, fd), body);
    b.position.set(lx, PLINTH_TOP + h / 2, lz);
    b.userData.lot = [lx, lz];
    b.userData.collide = true;   // L112 (collision): EXPLICIT solid tag (not inferred from `lot` — trees/docks omit lot, spires are cylinders). The end-of-generate post-pass reads these + their box params.
    procedural.add(b);

    if (prof.roofTint) {
      const capMat = vectorize(new THREE.MeshStandardMaterial({ color: prof.roofTint, roughness: 0.85, flatShading: true }), { color: prof.roofTint });
      const cap = new THREE.Mesh(new THREE.BoxGeometry(fw * 1.02, 0.08, fd * 1.02), capMat);
      cap.position.set(lx, PLINTH_TOP + h + 0.04, lz); cap.userData.lot = [lx, lz]; cap.userData.collide = true;
      procedural.add(cap);
    }
    // SHOPFRONT band on low-rise: a short, slightly-wider accent box at street level.
    if (h < 1.4) {
      const sc = rng.pick(prof.shopfronts);
      const band = new THREE.Mesh(new THREE.BoxGeometry(fw * 1.04, 0.18, fd * 1.04),
        vectorize(new THREE.MeshStandardMaterial({ color: sc, roughness: 0.8, flatShading: true }), { color: sc }));
      band.position.set(lx, PLINTH_TOP + 0.09, lz); band.userData.lot = [lx, lz]; band.userData.collide = true;
      procedural.add(band);
    }
    // L55 SETBACK CROWN — the biggest silhouette win. Tall buildings get a narrower UPPER tier (the Art-Deco
    // "wedding cake" step) instead of every tower being one flat box. Cheap (one extra box, tall lots only)
    // and deterministic (drawn from the same rng stream → same seed = same city). The crown carries its OWN
    // window id so its façades twinkle too. `roofY` then tracks the true top so the HVAC/spire sit on the
    // crown, not float at the base height. (C++: compose silhouettes by stacking primitives, seeded.)
    let roofY = PLINTH_TOP + h;
    let topW = fw, topD = fd;
    if (h > prof.hMax * 0.5 && rng.chance(0.55)) {
      const cw = fw * rng.range(0.5, 0.72), cd = fd * rng.range(0.5, 0.72);   // narrower footprint
      const ch = h * rng.range(0.18, 0.4);                                    // a modest extra storey-stack
      const crown = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), vectorizeTower(
        new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.7, metalness: 0.05, envMapIntensity: 0.3 }),   // L93: cut the sky-IBL response so the bright midday sky doesn't over-light the shadowed faces → buildings keep shadow CONTRAST + pop. Beauty-only (scene.environment is null on pixel/vector/toon → no env to respond to → those tiers byte-identical).
        { color: tintTower(rng.pick(prof.towers), rng), id: ++winId, windowGlow, winColors: prof.winColors, litFrac: prof.nightLit },   // L92: per-building tint
      ));
      crown.position.set(lx, PLINTH_TOP + h + ch / 2, lz); crown.userData.lot = [lx, lz]; crown.userData.collide = true;
      procedural.add(crown);
      roofY = PLINTH_TOP + h + ch; topW = cw; topD = cd;
    }
    // ROOF detail on taller buildings: an HVAC box or tank, occasionally a blinker — now sits on `roofY`
    // (the crown top when there is one), scaled to whatever tier it caps.
    if (h > prof.hMax * 0.45 && rng.chance(prof.roofRate)) {
      const rd = rng.chance(0.5)
        ? new THREE.Mesh(new THREE.BoxGeometry(topW * 0.4, 0.18, topD * 0.4),
            vectorize(new THREE.MeshStandardMaterial({ color: '#9a9a9a', flatShading: true }), { color: '#9a9a9a' }))
        : new THREE.Mesh(new THREE.CylinderGeometry(topW * 0.18, topW * 0.18, 0.22, 10),
            vectorize(new THREE.MeshStandardMaterial({ color: '#b9bec4', flatShading: true }), { color: '#b9bec4' }));
      rd.position.set(lx + rng.range(-0.1, 0.1), roofY + 0.11, lz + rng.range(-0.1, 0.1));
      rd.userData.lot = [lx, lz];
      if (rd.geometry.type === 'BoxGeometry') rd.userData.collide = true;   // L112: the box HVAC is solid; the cylinder tank is excluded (the post-pass only AABBs boxes anyway)
      procedural.add(rd);
      if (rng.chance(0.25)) {                        // a blinking aviation light (ambient life)
        const bl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5),
          new THREE.MeshBasicMaterial({ color: '#ff3b30', transparent: true, opacity: 1 }));
        bl.position.set(lx, roofY + 0.15, lz); bl.userData.lot = [lx, lz];
        bl.raycast = () => {};
        procedural.add(bl); blinkers.push({ mesh: bl, phase: rng.range(0, 6.28) });
      }
    }
    // L55 ANTENNA SPIRE — a thin mast on a few of the TALLEST towers; reads big on the skyline for ~nothing
    // (one slim 6-sided cylinder). Sits on roofY so it crowns the setback when present.
    if (h > prof.hMax * 0.7 && rng.chance(0.35)) {
      const spH = h * rng.range(0.18, 0.34);
      const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.05, spH, 6),
        vectorize(new THREE.MeshStandardMaterial({ color: '#c8ccd2', flatShading: true }), { color: '#c8ccd2' }));
      spire.position.set(lx, roofY + spH / 2, lz); spire.userData.lot = [lx, lz];
      spire.raycast = () => {};
      procedural.add(spire);
    }
  }

  // remove every procedural mesh tagged with this lot (building + its cap/band/roof/blinker).
  function removeBuildingAt(lx, lz) {
    for (let i = procedural.children.length - 1; i >= 0; i--) {
      const o = procedural.children[i];
      if (o.userData.lot && Math.abs(o.userData.lot[0] - lx) < 1e-4 && Math.abs(o.userData.lot[1] - lz) < 1e-4) {
        o.geometry && o.geometry.dispose(); disposeMat(o.material); procedural.remove(o);
      }
    }
    for (let i = blinkers.length - 1; i >= 0; i--) if (!blinkers[i].mesh.parent) blinkers.splice(i, 1);
  }

  // evict every procedural BUILDING part whose lot centre falls in a world rect (clears a plaza
  // under a tall landmark so it doesn't intersect neighbours). Streets/sidewalks/parks/trees
  // have no userData.lot, so they survive.
  function evictBuildings(minX, maxX, minZ, maxZ) {
    for (let i = procedural.children.length - 1; i >= 0; i--) {
      const o = procedural.children[i];
      if (o.userData.lot && o.position.x >= minX && o.position.x <= maxX && o.position.z >= minZ && o.position.z <= maxZ) {
        o.geometry && o.geometry.dispose(); disposeMat(o.material); procedural.remove(o);
      }
    }
  }

  // L25: harbor docks — a quay plank along the shore + two piers reaching out over the inlet on the
  // +X edge. Cheap timber boxes resting just above the waterline (water surface sits at y≈0). These
  // are the seam L26 boats + harbor life tie up to. Positions are constant (a stable harbor) so the
  // screenshot/demo always shows it; only the surrounding shore reshapes per seed.
  function buildDocks(harborX, prof) {
    const woodMat = vectorize(new THREE.MeshStandardMaterial({ color: '#7a5634', roughness: 0.95, flatShading: true }), { color: '#7a5634' });
    const plank = (w, d, x, z) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.06, d), woodMat);
      m.position.set(x, PLINTH_TOP - 0.16, z);        // ≈y=0.14: just above the flat waterline
      procedural.add(m);
    };
    plank(0.24, 2.0, harborX + 0.02, 0.0);            // quay running along the harbour shore
    plank(1.30, 0.22, harborX + 0.70, -0.72);         // pier 1 reaching out into the water
    plank(1.30, 0.22, harborX + 0.70, 0.72);          // pier 2
  }

  // a stacked-sphere tree (two flattened spheres + a stub trunk), profile greens, vectorized.
  function tree(x, z, prof, rng) {
    const g = new THREE.Color(prof.park);
    const leaf = (s, y) => {
      const c = g.clone().offsetHSL(0, 0, rng.range(-0.06, 0.06)).getStyle();
      const m = new THREE.Mesh(new THREE.SphereGeometry(s, 7, 6),
        vectorize(new THREE.MeshStandardMaterial({ color: c, flatShading: true }), { color: c, season: true }));
      m.scale.y = 0.7; m.position.set(x, PLINTH_TOP + y, z); m.userData.lot = null;
      procedural.add(m);
    };
    const trunk = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.05),
      vectorize(new THREE.MeshStandardMaterial({ color: '#6b4a2a', flatShading: true }), { color: '#6b4a2a' }));
    trunk.position.set(x, PLINTH_TOP + 0.09, z); procedural.add(trunk);
    leaf(0.22, 0.28); leaf(0.16, 0.46);
  }

  /* ambient micro-motion: pulse the roof blinkers (cheap, reads as "the city is alive"). */
  function update(elapsed) {
    for (const b of blinkers) b.mesh.material.opacity = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * 3 + b.phase));
  }

  generate(seed, profileIndex);   // initial build (landmarks fill in once the factory is ready)

  /* L107 (heli-water-lift prereq, engine-first) — is world (x,z) on LAND? The coastline is a closed world-space
     polygon (state.coast.points, Vector2 with .y holding the world Z); INSIDE = land, OUTSIDE = open sea. Classic
     ray-casting point-in-polygon. Lifted here from city/main.js's pointInLand so the pilot WATER sampler + the
     queued rotor-downwash + collision all consume ONE shared land test (do-once, per the water-excellence spec). */
  function isLand(x, z) {
    const pts = state.coast?.points;
    if (!pts || pts.length < 3) return false;             // no coast yet → treat everything as water (safe)
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i], b = pts[j];
      if (((a.y > z) !== (b.y > z)) && (x < (b.x - a.x) * (z - a.y) / (b.y - a.y) + a.x)) inside = !inside;
    }
    return inside;
  }

  return {
    group, key, fill, update, generate, isLand,
    get state() { return state; },
    get extent() { return state.extent; },
    get waterColor() { return state.profile.water; },
    profiles: PROFILES,
  };
}
