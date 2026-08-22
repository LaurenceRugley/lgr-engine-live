/* ============================================================
   @lgr/engine-core — street-kit.js (ARC A-DRESS, 2026-08-15): THE THINGS A STREET NEEDS, INSTANCED.
   ------------------------------------------------------------
   WHAT THIS IS. A deterministic generator that dresses a GRID of streets with the props a street has —
   streetlights, trees, benches, hydrants, bus shelters — and hands them back as **three meshes total,
   whatever the size of the city**: one InstancedMesh of unit boxes for every solid prop, one
   InstancedMesh of a low-poly blob for tree canopies, and one unlit InstancedMesh for the lamp heads
   that have to still be there at night. A `createStreetLights` glow layer rides along on the same
   positions, which is one THREE.Points.

   WHY BOXES, AND WHY ONE MESH. This is not an aesthetic preference, it is the repo's measured budget
   discipline. `box-arena.js` renders an entire 1753-box skyline in ONE draw call by making every
   silhouette part an instance of one unit cube; `citygen.js` predates that and emits one Mesh per
   building PART, so its draw calls scale with the city (the Rule-6 conflict `docs/design/
   research-aaa-environments.md` §1 names, and its recommendation is to build on the newer pattern).
   A street-furniture pass done the citygen way would be hundreds of draw calls — a regression wearing
   an art pass's clothes. Done this way it is a fixed three, and a bigger city costs instances.
   The measured budget it has to sit inside: the A-SKYLINE city renders in 5–9 draw calls total.

   PROPS ARE DRESSING, NOT LEVEL — AND THAT IS A DELIBERATE, STATED CALL. Nothing here is pushed into
   the collider's packed solids buffer. Three reasons, in order of weight:
     1. The swing's own numbers are measured against that buffer. A lamppost is a 3.2 m pole whose top
        is far below `swingableHeight` (4.61 u in this city), so it can never be a legal swing anchor —
        but it CAN be an obstacle `findAnchor` rejects, and adding 1500 of them would move every
        anchor-supply number in the ledger for no gameplay gain.
     2. `createAgentSim`'s flow fields take every solid whose underside is below head height as a 2D
        obstacle (swing-lab's own `GROUND_CLEAR` filter). Street furniture starts at y=0, so all of it
        would become crowd geometry and the outbreak would route differently — a sim change smuggled
        in behind an art pass.
     3. It keeps the A/B honest: with dressing on and off, the LEVEL is identical, so any difference in
        a chain number is a rendering difference and cannot be a geometry one.
   A consumer that wants collidable furniture has the parts to build it (`boxes` is returned), and the
   day that is wanted it should be an explicit opt-in with its own re-measured ledger row, not a
   side effect of turning the lights on.

   THE GRID IT DRESSES is the one `createBoxArena` lays out: towers sit on a `spacing` lattice centred
   on the origin, so the STREETS are the lines halfway between them — x = (k + 0.5) * spacing, and the
   same in z. That is stated as arithmetic rather than passed in as a list because it is the same
   arithmetic `applyStreetGrid` paints the road markings with, and two descriptions of one grid is
   exactly the drift the project CLAUDE.md's rule 6 is about: the road and the lamp posts standing on
   different grids is a bug you can see from the street.

   DETERMINISM is index-addressed, not sequential — `hash3(axis, line, n)` — for the same reason
   box-arena's is: changing the extent must not reshuffle the street you were just looking at.

   C++ anchor: `boxes` is a `std::vector<Prop>` built once and then walked to fill three GPU instance
   buffers; `update()` writes two scalars and never allocates, like a per-frame uniform update.

   CONTRACT
   --------
   createStreetKit({
     extent,          // half-width of the dressed square, in world units (the arena's own `stats.extent`)
     spacing,         // the block pitch — street centrelines at (k + 0.5) * spacing
     groundY,
     seed,
     roadHalf,        // half-width of the asphalt; props stand just outside it, on the sidewalk
     step,            // distance between prop SLOTS along a street
     blocked,         // (x, z) => bool — a consumer-supplied "is this inside a building" test
     lampsPerBlock,   // streetlights per block per street line, spread over the non-junction stretch (0 = none)
     lampHeight, lampReach,
     tree, bench, hydrant, shelter,   // per-slot probabilities for the rest of the vocabulary
     material, foliageMaterial, lampMaterial,   // optional; flat-shaded defaults are built if omitted
     castShadow,      // props + foliage cast shadows (default true; the honest cost is +1 draw each)
     glow,            // { size, color } for the additive night sprite, or null for no glow layer
   }) -> {
     group,           // THREE.Group — add it to your scene
     boxes,           // the generated prop AABBs, for a consumer that wants to collide them itself
     lampPoints,      // flat [x,y,z,…] of the lamp heads
     stats,           // { props, foliage, lamps, drawMeshes }
     update(night),   // 0 = day, 1 = night. Two scalar writes + one colour lerp. No allocation.
     dispose(),
   }
   ============================================================ */
import * as THREE from 'three';
import { createStreetLights } from './street-lights.js';

/* The same 32-bit index-addressed hash box-arena uses, for the same reason (see its header). Copied
   rather than imported so this module has no dependency on a level generator — a street kit that
   needs an arena to exist is a street kit only one project can use. */
function hash3(i, j, seed) {
  let h = (i * 0x27d4eb2d) ^ (j * 0x165667b1) ^ (seed * 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export function createStreetKit(opts = {}) {
  const P = {
    extent: 40, spacing: 4.6, groundY: 0, seed: 11,
    /* A-NIGHTFALL — MARRIED GROUND. `groundY` is a single plane, which is true of swing-lab's lab and
       false of any room whose terrain was carved (world-lab). A flat plane there buries half the lamp
       posts and floats the other half. `groundYAt(x, z) => y` is the SAME seam name and shape
       box-arena already takes for exactly this reason (its `groundYAt`/`heightAt` opt-ins), so a room
       that already has a ground sampler hands over the one it is using rather than a second copy.
       null (the default) = use the flat `groundY`, i.e. byte-identical for every existing caller. */
    groundYAt: null,
    roadHalf: null,          // defaults to 0.30 * spacing — see below
    step: 1.15,
    blocked: null,
    lampsPerBlock: 1, lampHeight: 0.62, lampReach: 0.34,
    tree: 0.30, bench: 0.10, hydrant: 0.07, shelter: 0.05,
    material: null, foliageMaterial: null, lampMaterial: null,
    castShadow: true,
    glow: { size: 0.95, color: '#ffd88a', pool: { size: 3.1, color: '#ffb454' } },
    ...opts,
  };
  /* THE SIDEWALK IS DERIVED FROM THE STREET, not typed: the asphalt is `roadHalf` either side of the
     centreline and a prop stands a hand's width outside that, so widening the road moves the lamp
     posts with it instead of leaving them in the traffic. */
  if (P.roadHalf == null) P.roadHalf = P.spacing * 0.30;
  const WALK = P.roadHalf + 0.16;

  const group = new THREE.Group();
  group.name = 'street-kit';

  /* ---- THE VOCABULARY. Each entry appends unit-cube instances to `boxes` (and at most one canopy to
     `blobs`). Sizes are in world units at this repo's ~6 m/u city scale — a 0.62 u lamp post is ~3.7 m,
     a 0.32 u bench seat ~1.9 m, i.e. street furniture at the size a 0.30 u player reads as human. ---- */
  const boxes = [];      // { x, y, z, w, h, d, rot, c: [r,g,b] }
  const blobs = [];      // { x, y, z, r, c }
  const lampPts = [];    // flat [x, y, z, …] — the lamp-head glow positions
  const poolPts = [];    // the same lamps, at road level — the pool of light they throw
  const heads = [];      // the unlit lamp-head instances

  const COL = {
    pole: [0.19, 0.20, 0.23],
    bench: [0.34, 0.26, 0.19],
    hydrant: [0.55, 0.16, 0.13],
    trunk: [0.26, 0.21, 0.17],
    canopy: [[0.20, 0.34, 0.21], [0.24, 0.38, 0.23], [0.17, 0.30, 0.20]],
    shelter: [0.22, 0.25, 0.30],
    glass: [0.40, 0.48, 0.56],
  };
  const box = (x, y, z, w, h, d, c, rot = 0) => boxes.push({ x, y, z, w, h, d, c, rot });

  /* THE FLOOR UNDER ONE PROP, sampled ONCE per prop and then shared by all of its boxes. Per-BOX
     sampling would be the obvious thing and it would be wrong: a bench's four corners are at
     different (x, z), so on a graded street each leg would find its own height and the bench would
     lean. A prop stands on one spot; this is that spot. */
  const groundAt = P.groundYAt ? (x, z) => P.groundYAt(x, z) : () => P.groundY;

  /* A STREETLIGHT IS THREE BOXES AND ONE OF THEM IS NOT LIT BY THE SUN. The pole and the arm are
     ordinary geometry; the HEAD goes into the unlit mesh, because the entire point of a streetlight is
     the frames in which there is no sun — a diffuse-shaded lamp head at night is a dark smudge on a
     dark pole, which is a lamp post, not a lamp. The additive glow sprite (createStreetLights, the
     engine's existing night ability) is registered at the same point, so the halo and the thing that
     is supposed to be making it are never in two places. */
  function streetlight(x, z, faceX, side, r) {
    const gy = groundAt(x, z);
    const h = P.lampHeight * (0.92 + 0.16 * r);
    box(x, gy, z, 0.07, h, 0.07, COL.pole);
    const reach = P.lampReach * (faceX ? -side : 0), reachZ = P.lampReach * (faceX ? 0 : -side);
    box(x + reach * 0.5, gy + h - 0.05, z + reachZ * 0.5,
      faceX ? Math.abs(reach) + 0.06 : 0.06, 0.06, faceX ? 0.06 : Math.abs(reachZ) + 0.06, COL.pole);
    const hx = x + reach, hz = z + reachZ, hy = gy + h - 0.09;
    heads.push({ x: hx, y: hy, z: hz, w: 0.20, h: 0.07, d: 0.13 });
    lampPts.push(hx, hy - 0.02, hz);
    /* THE POOL ON THE ROAD, and it is the half that makes a streetlight a LIGHT rather than a bright
       dot. A real point light per lamp is out of the question — 1500 of them is not a lighting rig, it
       is a slideshow, and the engine's existing answer (street-lights.js, written for citygen) is
       deliberately an additive SPRITE for exactly this reason. So the pool is a second, much larger,
       much dimmer sprite sitting just above the asphalt: it is not a light, it is the thing a light
       leaves behind, which is all the eye is actually reading at this camera distance. */
    poolPts.push(hx, gy + 0.04, hz);
  }
  /* A TREE IS A TRUNK BOX AND ONE BLOB, and the blob is the ONE thing in this module that is not a box.
     That is a considered exception: a boxy canopy in a city made entirely of boxes reads as another
     small building, and "is there a tree there" stops being answerable at a glance — which is the whole
     job of a tree at street level. A 20-triangle icosahedron instanced once is the cheapest shape that
     is unmistakably not architecture, and it costs exactly one more draw call for the whole city. */
  function tree(x, z, r, r2) {
    const gy = groundAt(x, z);
    const th = 0.34 + 0.20 * r;
    box(x, gy, z, 0.11, th, 0.11, COL.trunk);
    blobs.push({ x, y: gy + th + 0.20 + 0.10 * r2, z, r: 0.26 + 0.16 * r2, c: COL.canopy[Math.floor(r2 * 3) % 3] });
  }
  function bench(x, z, faceX, r) {
    const gy = groundAt(x, z);
    const L = 0.62 + 0.16 * r, seatY = gy + 0.14;
    const w = faceX ? L : 0.30, d = faceX ? 0.30 : L;
    box(x, seatY, z, w, 0.06, d, COL.bench);
    box(x + (faceX ? 0 : 0.11), seatY + 0.06, z + (faceX ? 0.11 : 0), faceX ? L : 0.05, 0.20, faceX ? 0.05 : L, COL.bench);
    for (const s of [-1, 1]) {
      box(x + (faceX ? s * L * 0.36 : 0), gy, z + (faceX ? 0 : s * L * 0.36), 0.06, 0.14, 0.06, COL.pole);
    }
  }
  function hydrant(x, z) {
    const gy = groundAt(x, z);
    box(x, gy, z, 0.10, 0.19, 0.10, COL.hydrant);
    box(x, gy + 0.19, z, 0.15, 0.05, 0.15, COL.hydrant);
  }
  function shelter(x, z, faceX, side) {
    const gy = groundAt(x, z);
    const L = 1.15, H = 0.46;
    box(x, gy + H, z, faceX ? L : 0.52, 0.06, faceX ? 0.52 : L, COL.shelter);
    for (const s of [-1, 1]) {
      box(x + (faceX ? s * L * 0.44 : 0), gy, z + (faceX ? 0 : s * L * 0.44), 0.06, H, 0.06, COL.pole);
    }
    /* the back panel faces AWAY from the road, which is the one detail that makes a shelter read as a
       shelter rather than as a bus stop's ghost: you can see the shape is open toward the traffic. */
    box(x + (faceX ? 0 : side * 0.24), gy + 0.06, z + (faceX ? side * 0.24 : 0),
      faceX ? L : 0.05, H - 0.06, faceX ? 0.05 : L, COL.glass);
  }

  /* ---- THE GRID, AS ONE FUNCTION, because getting it wrong twice is how the first cut of this module
     placed ZERO streetlights in a whole city and the night captures came back with dark posts and no
     light. Worth the paragraph.

     Street centrelines sit at (k + 0.5) * spacing on both axes, so walking ALONG one street, the
     crossing streets are at (m + 0.5) * spacing too — i.e. an intersection is where the along-coordinate
     is HALF A PITCH off a multiple of `spacing`. The first version tested distance to a MULTIPLE of the
     pitch instead: exactly half a period out of phase, so it deleted the mid-block slots and kept the
     junctions — the opposite of what it says.
     It survived a build and a screenshot because of the SECOND bug, which is the more interesting one:
     with `step * lampEvery === spacing` every lamp slot lands on the SAME phase within the block, so
     the lamp cadence is all-or-nothing against any phase test. One inverted comparison plus one exact
     resonance = a city with no streetlights and no error anywhere.
     The cure for both is to stop deriving lamp positions from a slot INDEX. Lamps are now placed per
     BLOCK at fixed fractions of the span between two junctions, which is where a real street puts them,
     is even by construction, and cannot resonate with anything. */
  const distToJunction = (along) => Math.abs(((along % P.spacing) + P.spacing) % P.spacing - P.spacing * 0.5);

  function layout() {
    boxes.length = 0; blobs.length = 0; lampPts.length = 0; poolPts.length = 0; heads.length = 0;
    const K = Math.ceil(P.extent / P.spacing);
    const N = Math.floor((P.extent * 2) / P.step);
    const clear = P.roadHalf + 0.35;        // no furniture inside a junction or its crossing band
    for (let axis = 0; axis < 2; axis++) {
      for (let li = -K; li <= K; li++) {
        const centre = (li + 0.5) * P.spacing;
        if (Math.abs(centre) > P.extent) continue;
        const place = (along, side, fn) => {
          const off = side * WALK;
          const x = axis === 0 ? along : centre + off;
          const z = axis === 0 ? centre + off : along;
          if (Math.abs(x) > P.extent || Math.abs(z) > P.extent) return;
          if (P.blocked && P.blocked(x, z)) return;
          fn(x, z);
        };

        /* THE LAMPS, PER BLOCK, SPREAD ACROSS THE USABLE STRETCH — and "usable" is the word that took
           two goes. A block is `spacing` long between junctions, but `clear` of it at each end belongs
           to the crossing, so the sidewalk a lamp can actually stand on is `spacing - 2 * clear`. The
           second version of this loop spread the lamps over the WHOLE block (fractions 0.25 / 0.75),
           which at this city's numbers put every single one of them 1.15 u from a junction against a
           1.43 u clear zone — so the junction filter deleted all of them and the city had, again,
           exactly zero streetlights.
           THE LESSON, and it generalises past this module: when a placement rule and a rejection rule
           are written separately, the placement must be expressed in the SPAN THE REJECTION LEAVES, not
           in the span it started from. Otherwise the filter is not filtering, it is vetoing. */
        if (P.lampsPerBlock > 0) {
          const usable = P.spacing - 2 * clear;
          for (let m = -K - 1; m <= K; m++) {
            const blockStart = (m + 0.5) * P.spacing;
            for (let q = 0; q < P.lampsPerBlock; q++) {
              const f = (q + 0.5) / P.lampsPerBlock;
              const along = usable > 0.1
                ? blockStart + clear + f * usable
                : blockStart + 0.5 * P.spacing;      // a block too short to have a clear stretch: centre it
              if (distToJunction(along) < clear * 0.98) continue;
              /* ALTERNATING SIDES, block by block, which is what a real street does and what stops a
                 night frame reading as two parallel strings of fairy lights. */
              const side = ((m + q) & 1) ? 1 : -1;
              const r = hash3(axis * 131 + li, m * 8 + q, P.seed);
              place(along, side, (x, z) => streetlight(x, z, axis === 0, side, r));
            }
          }
        }

        /* EVERYTHING ELSE ON THE SLOT LATTICE, probabilistically — benches and hydrants genuinely are
           where they happen to be, and a hash of (axis, line, slot) keeps that stable under an extent
           change (box-arena's index-addressed determinism rule, same reason). */
        for (let n = 0; n <= N; n++) {
          const along = -P.extent + n * P.step;
          if (distToJunction(along) < clear) continue;
          const side = (n & 1) ? 1 : -1;
          const r = hash3(axis * 131 + li, n, P.seed);
          const r2 = hash3(n, axis * 977 + li, (P.seed ^ 0x5717) >>> 0);
          if (r < P.tree) place(along, side, (x, z) => tree(x, z, r / Math.max(1e-6, P.tree), r2));
          else if (r < P.tree + P.bench) place(along, side, (x, z) => bench(x, z, axis === 0, r2));
          else if (r < P.tree + P.bench + P.hydrant) place(along, side, (x, z) => hydrant(x, z));
          else if (r < P.tree + P.bench + P.hydrant + P.shelter) place(along, side, (x, z) => shelter(x, z, axis === 0, side));
        }
      }
    }
  }

  /* ---- THE MESHES. Three, and the count does not depend on the city's size. ---- */
  let propMesh = null, foliageMesh = null, headMesh = null, lights = null, pool = null;
  let ownedMat = null, ownedFol = null, ownedHead = null, ownedBoxGeo = null, ownedBlobGeo = null;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const _c = new THREE.Color();
  const DAY_HEAD = new THREE.Color('#2b2f37'), NIGHT_HEAD = new THREE.Color('#ffd489');

  function build() {
    if (!P.material && !ownedMat) ownedMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.85, metalness: 0.02, flatShading: true });
    if (!P.foliageMaterial && !ownedFol) ownedFol = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.95, metalness: 0, flatShading: true });
    if (!P.lampMaterial && !ownedHead) ownedHead = new THREE.MeshBasicMaterial({ color: DAY_HEAD.clone(), toneMapped: false });
    if (!ownedBoxGeo) ownedBoxGeo = new THREE.BoxGeometry(1, 1, 1);
    /* detail 0 = a 20-triangle icosahedron. Higher is a smoother ball, which at 0.3 u across and a
       flat-shaded palette is triangles nobody will ever resolve. */
    if (!ownedBlobGeo) ownedBlobGeo = new THREE.IcosahedronGeometry(1, 0);

    propMesh = new THREE.InstancedMesh(ownedBoxGeo, P.material || ownedMat, Math.max(1, boxes.length));
    propMesh.castShadow = P.castShadow; propMesh.receiveShadow = true;
    propMesh.frustumCulled = false;
    group.add(propMesh);
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      _p.set(b.x, b.y + b.h / 2, b.z); _s.set(b.w, b.h, b.d);
      _m.compose(_p, _q, _s);
      propMesh.setMatrixAt(k, _m);
      _c.setRGB(b.c[0], b.c[1], b.c[2]);
      propMesh.setColorAt(k, _c);
    }
    propMesh.count = boxes.length;
    propMesh.instanceMatrix.needsUpdate = true;
    if (propMesh.instanceColor) propMesh.instanceColor.needsUpdate = true;
    propMesh.computeBoundingSphere();

    foliageMesh = new THREE.InstancedMesh(ownedBlobGeo, P.foliageMaterial || ownedFol, Math.max(1, blobs.length));
    foliageMesh.castShadow = P.castShadow; foliageMesh.receiveShadow = true;
    foliageMesh.frustumCulled = false;
    group.add(foliageMesh);
    for (let k = 0; k < blobs.length; k++) {
      const b = blobs[k];
      _p.set(b.x, b.y, b.z);
      /* SQUASHED, because a sphere is a lollipop. 0.78 vertical against 1.0 horizontal is the ratio
         that reads as a canopy at the distance a street shot sees one. */
      _s.set(b.r, b.r * 0.78, b.r);
      _m.compose(_p, _q, _s);
      foliageMesh.setMatrixAt(k, _m);
      _c.setRGB(b.c[0], b.c[1], b.c[2]);
      foliageMesh.setColorAt(k, _c);
    }
    foliageMesh.count = blobs.length;
    foliageMesh.instanceMatrix.needsUpdate = true;
    if (foliageMesh.instanceColor) foliageMesh.instanceColor.needsUpdate = true;
    foliageMesh.computeBoundingSphere();

    headMesh = new THREE.InstancedMesh(ownedBoxGeo, P.lampMaterial || ownedHead, Math.max(1, heads.length));
    headMesh.castShadow = false; headMesh.receiveShadow = false;
    headMesh.frustumCulled = false;
    group.add(headMesh);
    for (let k = 0; k < heads.length; k++) {
      const h = heads[k];
      _p.set(h.x, h.y, h.z); _s.set(h.w, h.h, h.d);
      _m.compose(_p, _q, _s);
      headMesh.setMatrixAt(k, _m);
    }
    headMesh.count = heads.length;
    headMesh.instanceMatrix.needsUpdate = true;

    /* THE GLOW LAYER IS THE ENGINE'S EXISTING ABILITY, now reachable (see street-lights.js's A-DRESS
       note): one THREE.Points, additive, invisible at `night <= 0.01` — so by day it is not drawn at
       all, which is the byte-identical contract that module was written to keep. */
    if (P.glow && lampPts.length) {
      lights = createStreetLights({ points: lampPts, size: P.glow.size, color: P.glow.color });
      group.add(lights.group);
      if (P.glow.pool) {
        pool = createStreetLights({ points: poolPts, size: P.glow.pool.size, color: P.glow.pool.color });
        group.add(pool.group);
      }
    }
  }

  layout();
  build();

  return {
    group,
    get boxes() { return boxes; },
    get lampPoints() { return lampPts; },
    get poolPoints() { return poolPts; },
    params: P,
    get stats() {
      return {
        props: boxes.length, foliage: blobs.length, lamps: heads.length,
        /* THE HONEST DRAW COUNT: three instanced meshes plus the glow layer's one Points, and the
           shadow pass re-draws whichever of them cast. Reported rather than left to be discovered. */
        drawMeshes: 3 + (lights ? 1 : 0) + (pool ? 1 : 0),
        shadowMeshes: P.castShadow ? 2 : 0,
      };
    },
    /* 0 = day, 1 = night. Everything here is a scalar or a colour lerp on ONE shared material — no
       per-instance write, no allocation, safe to call every frame. */
    update(night = 0) {
      const n = night < 0 ? 0 : night > 1 ? 1 : night;
      const hm = P.lampMaterial || ownedHead;
      if (hm && hm.color) hm.color.copy(DAY_HEAD).lerp(NIGHT_HEAD, n);
      if (lights) lights.update(n);
      /* THE POOL IS DIMMER THAN THE SOURCE — a light pool as bright as the lamp reads as fog. */
      if (pool) pool.update(n * 0.62);
    },
    dispose() {
      for (const m of [propMesh, foliageMesh, headMesh]) if (m) { group.remove(m); m.dispose(); }
      for (const l of [lights, pool]) if (l) { group.remove(l.group); l.dispose(); }
      if (ownedBoxGeo) ownedBoxGeo.dispose();
      if (ownedBlobGeo) ownedBlobGeo.dispose();
      if (ownedMat) ownedMat.dispose();
      if (ownedFol) ownedFol.dispose();
      if (ownedHead) ownedHead.dispose();
      propMesh = foliageMesh = headMesh = lights = pool = null;
    },
  };
}
