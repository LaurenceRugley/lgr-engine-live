/* ============================================================
   @lgr/engine-core — createBoxArena (A-LAB, 2026-08-09): PROVING-GROUND GEOMETRY.
   ------------------------------------------------------------
   WHAT THIS IS. A flat floor and a parameterised grid of boxes, delivered as the three things a
   gameplay module actually needs from a level: the packed AABB list, the WORLD QUERY BAG that
   `createCharacterController` / `createGrappleModel` / the camera spring-arm all speak, and a
   THREE.Group you can add to a scene. One call, and `rebuild(params)` re-lays it live.

   WHY IT IS IN THE ENGINE AND NOT IN THE LAB THAT NEEDED IT FIRST. Three separate abilities were
   about to be born project-local:
     1. "turn a box list into a collider world" — every project so far got this for free by booting
        the whole CITY (`createCityWorld` owns the only `createColliderWorld` call in the repo). A
        project that wants collision WITHOUT a procedural city had no route to it at all: collide.js
        is CORE_UNBARRELED and the package `exports` map does not expose `./src/collide.js`, so the
        ability was physically unreachable from outside the package. (Fixed alongside this file —
        `createColliderWorld` is now barrelled too, because a consumer with its OWN box list should
        not have to go through an arena to get a collider.)
     2. "the four-function world bag" — `heightAt` / `surfaceAt` / `segmentHit` / `resolveSphere`.
        metropolis assembles it by hand (main.js's `charWorld`). It is the same four lines every
        time and getting one of them wrong is a whole class of bug (the ledger's "two ground
        functions that disagree by a few centimetres").
     3. "a test level whose proportions are an ARGUMENT" — the thing you cannot do to a procedural
        city. Tuning a traversal mechanic means changing the geometry and re-measuring; a level you
        can only reroll is a level you cannot bisect.

   PROPORTIONS ARE THE POINT, so they are all named arguments with no hidden coupling. The defaults
   are derived from the SWING's own numbers rather than copied off a city (see `heightFor` below).

   DETERMINISTIC AND INDEX-ADDRESSED. The per-tower height jitter comes from a hash of (i, j, seed),
   NOT from a sequential PRNG. That is deliberate: with a hash, tower (2,3) is the same height
   whether the grid is 4x4 or 12x12, so changing `cols` does not reshuffle the level you were just
   measuring. A stateful generator would make every parameter sweep a different world.

   C++ anchors: `solids` is a packed SoA `std::vector<float>` (6 floats/box, min then max) handed to
   the collider by reference — the same buffer citygen builds, so collide.js needs no new path; the
   returned `world` is a struct of function pointers (a vtable assembled by hand); `rebuild` is a
   `clear() + emplace_back` loop that reuses the allocation when the count is unchanged.

   CONTRACT
   --------
   createBoxArena({
     cols, rows,          // tower grid
     spacing,             // u between tower CENTRES (street width = spacing - width)
     width, depth,        // tower footprint (depth defaults to width)
     height, heightVary,  // base height and the ± fraction the hash spreads it over
     groundY,             // the walkable floor
     plaza,               // radius (in TOWERS) of an empty patch at the centre, 0 = none
     seed,
     cell,                // collider broad-phase cell — defaults to `spacing` (the grid the level IS)
     material,            // optional THREE.Material for the towers; one is built if omitted
     groundSize,          // u across the floor plane; defaults to a margin past the grid
     groundMaterial,
     skyline,             // A-SKYLINE opt-in — see below. null (default) = the uniform grid, untouched.
     silhouette,          // A-SKYLINE opt-in — setbacks/cornices/roof boxes/spires/skybridges. null = boxes.
     groundYAt,           // A-MARRIAGE opt-in — (x, z, i, j) => world-Y of the PAD under cell (i,j).
                          //   null (default) = the flat plinth at `groundY`, floats untouched.
     heightAt,            // A-MARRIAGE opt-in — (x, z) => ground Y for the world bag (a terrain
                          //   sampler). null = the flat `() => groundY` the bag always had.
     ground,              // false = no flat floor plane (the married room's terrain mesh IS the
                          //   ground). Default true — the plane every existing consumer stands on.
   }) -> {
     world,               // { heightAt, surfaceAt, segmentHit, resolveSphere } — the query bag
     collider,            // the raw createColliderWorld handle (depthAt/probe/boxAt for probes)
     group,               // THREE.Group: ground + towers. Add it to your scene.
     solids,              // Float32Array, 6 floats/box
     boxes,               // [{ x, y, z, w, d, h, top, kind }] — EVERY box, towers and silhouette parts
     towers,              // the TOWER records only ({ x,z,w,d,h,y,top,i,j,parts }); === boxes on the
                          // default path. ORDERED BY RANK on the skyline path (shortest first), NOT by
                          // grid cell — the sort is what decouples the district field from the quantile
                          // map, so index k is "the k-th shortest tower" and (i,j) is the only stable id.
     params,              // the resolved parameter set (defaults filled in)
     stats,               // { count, medianTop, maxTop, minTop, streetWidth, extent, towers, parts, swingable }
     topAt(p),            // percentile over EVERY solid top (parts included)
     roofAt(p),           // percentile over TOWER ROOFS only — the one a derived rope must read
     rebuild(next),       // merge params, re-lay, re-bucket the collider, rebuild the meshes
     dispose(),
   }

   ---- A-SKYLINE (2026-08-10): SWINGABLE BY CONSTRUCTION, AND SILHOUETTES TO WEB ------------------
   The uniform grid above answers "state a level as parameters". It does not answer the question the
   swing ledger's OPEN #7 actually poses, which is "state a level as a GUARANTEE": metropolis's own
   measured numbers are 60% of towers unable to support even the shortest legal rope and 9 of 162
   (5.6%) clearing the arc-bottom rule, and the cure for that is not "taller buildings by eye".

   `skyline` inverts the arithmetic one more time. `swingableHeight` gives the minimum useful tower for
   a rope; `swingableRope` gives the rope a tower affords; this generates a whole DISTRIBUTION whose
   (1-frac) quantile IS that minimum, so exactly `frac` of the towers clear the rule and the level can
   be asked to prove it (`stats.swingable`). The percentile is doing the same job it does in
   `swingableRope` — it is the entire safety margin, stated as a fact about the level rather than as a
   fudge factor. Feed the generated level back through `swingableRope(roofAt(1 - frac))` and you get
   the rope you started from: a closed loop, which is a check and not a coincidence.

   DISTRICTS COME FROM THE *RANKING*, NOT FROM THE HEIGHT. A downtown gradient applied as a multiplier
   on height would silently break the guarantee (the fraction above the line becomes whatever the field
   happens to produce). So the field decides only which tower gets which RANK; the rank-to-height map is
   fixed by the quantile arithmetic. Districts and the guarantee stop competing: the global distribution
   is exact, and the tall stock clusters where the cores are.

   `silhouette` is the other half of the ledger's own OPEN #16 ("the lab's towers are boxes… so anchor
   VARIETY is untested: every anchor is a point on a flat vertical face"). Setbacks, cornices that
   OVERHANG the street, rooftop plant, spires and skybridges are all emitted as ordinary AABBs into the
   SAME packed buffer, which is what makes them real: `findAnchor` casts `segmentHit` against that
   buffer, so a spire top or a bridge underside is an anchor with air beneath it — the thing the ledger's
   OPEN #6 says the swing has never had.

   skyline: {
     frac,                // the fraction of towers REQUIRED to clear the arc-bottom rule (the guarantee)
     ropeMax, arcClear, skim,   // the rule's own terms — the same three `swingableHeight` takes
     tall,                // the tallest tower as a MULTIPLE of the arc-bottom minimum
     low,                 // the shortest tower as a FRACTION of it (the low-rise district)
     gamma,               // >1 pushes the tall stock down toward the line; 1 = a linear spread
     cores, coreSigma, mix,     // the district field: how many downtowns, how wide, how much noise
     footVary, jitter,    // taller towers get wider footprints; towers sit slightly off their cell centre
     palette,             // A-DRESS: per-DISTRICT colour families. null (default) = the A-SKYLINE tint, exactly
     facadeVary,          // A-DRESS: per-instance facade variation written as the `aLgrVar` attribute. 0 = none
   }
   silhouette: { minTiered, tier3, corniceH, corniceOut, roofBox, spire, bridge, bridgeSpan,
                 parapet, penthouse, waterTower, mast, sign, emissiveKinds }   // A-DRESS, all default 0/null

   ---- A-DRESS (2026-08-15): MORE VOCABULARY, SAME DRAW CALL. -------------------------------------
   A-SKYLINE measured the thing that justifies this whole file: with the silhouette on, **77% of web
   attaches land on setbacks/cornices/spires** against 100% flat-face without it, and the chain's net
   ground went 10.30 → 16.78 u (+63%). Silhouette variety is therefore not decoration — it is the
   resource the traversal spends. So the honest next move is MORE of the same kind of thing, and the
   constraint that makes it cheap is the one this file already established: **a part is an AABB in the
   packed buffer and an instance in the one InstancedMesh, so vocabulary costs INSTANCES, never draw
   calls.** Parapets, penthouses, water towers and antenna masts are five more box shapes; the whole
   city stays one draw call, and every one of them is simultaneously an anchor, a ledge and a collider
   because there is no second representation for it to drift from.

   EVERY NEW RATE DEFAULTS TO 0 AND EVERY NEW FIELD TO null, so a consumer that passes the A-SKYLINE
   `silhouette: {}` gets the A-SKYLINE city box-for-box — which is what keeps `swing-lab-probe`'s
   27 checks, the ledger's measured tables and `npm run tier-guard` all still true of the default path.

   THE ONE THING THAT IS NOT A BOX IN THE MAIN MESH: `emissiveKinds`. A sign that is lit only by the
   sun is a sign that disappears at night, which is the half of a city a streetlight arc is about. Kinds
   named there are drawn into a SECOND InstancedMesh with an UNLIT material instead of the main one
   (never both — they are partitioned, not duplicated), which costs exactly one extra draw call and only
   when a consumer asks for it. Their AABBs stay in the same packed buffer, so an emissive sign is still
   something you can web.
   ============================================================ */
import * as THREE from 'three';
import { createColliderWorld } from './collide.js';

/* A 32-bit integer hash — index-addressed determinism (see the header). Three xorshift-multiply
   rounds is enough decorrelation for a height jitter; this is level dressing, not cryptography.
   C++ anchor: the `std::hash` combine idiom, spelled out because JS has no `size_t`. */
function hash3(i, j, seed) {
  let h = (i * 0x27d4eb2d) ^ (j * 0x165667b1) ^ (seed * 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;      // [0,1)
}

/* THE DEFAULT HEIGHT IS DERIVED, NOT CHOSEN, and this function is where the derivation lives so a
   consumer can re-run it for its own rope.

   A swing is a pendulum hung from a point on a tower. Its lowest point is `anchorY - rope`, and
   `createGrappleModel.findAnchor` REJECTS (demotes to the zip tier) any anchor whose arc bottom
   comes within `arcClear` of the ground — because an arc that bottoms out in the street is not a
   swing, it is a faceplant. So for a full-length rope to be swingable at all:

       anchorTop  >  groundY + skim + arcClear + ropeMax

   With the shipped GRAPPLE_PROFILE (ropeMax 3.2, arcClear 0.45, skim 0.06) that is 3.71 u of
   MINIMUM useful tower, before you have left any room to actually be under the anchor rather than
   level with it. The default adds a comfortable half-rope on top. This is the number metropolis
   does not have — its median building top is 1.14 u, i.e. a THIRD of the minimum, which is why the
   swing ledger's OPEN #7 says "the mechanic outruns the level". */
export function swingableHeight({ ropeMax = 3.2, arcClear = 0.45, skim = 0.06, groundY = 0, margin = 0.5 } = {}) {
  return groundY + skim + arcClear + ropeMax * (1 + margin);
}

/* ---- THE INVERSE (A-CLIMB, 2026-08-10), and it is the direction a real level is actually built in.
   `swingableHeight` answers "how tall must a tower be for THIS rope"; every level after the first
   asks the opposite — "the towers are what they are, how long a rope does this room afford?" The
   owner asked for more web range, and the honest way to pick a number is to invert the rule the range
   is constrained BY rather than to raise a constant until it feels right.

   THE CONSTRAINT IS THE SAME ONE, rearranged. A full-length rope hung from `top` bottoms out at
   `top - ropeMax`, and `arcClear` demands that clear the ground by its own margin, so

       ropeMax  <  top - groundY - skim - arcClear

   THERE IS DELIBERATELY NO `margin` ARGUMENT, and that is the interesting design decision rather than
   an omission. The obvious shape — median tower times some safety fraction — has a fudge factor whose
   only meaning is "a bit less than the most". Feeding a PERCENTILE instead makes the margin state a
   fact about the level: derive the rope from `topAt(0.35)` and, by construction, 65% of the towers
   clear the arc-bottom rule, because `need` comes out equal to the very tower you measured. One knob,
   one meaning, and the answer is legible in the same breath as the question. (Two ways to express the
   same margin is precisely the drift the project CLAUDE.md's rule 6 is about.)

   WHY IT IS HERE AND NOT IN THE LAB THAT NEEDED IT. It is the arithmetic half of "state a level as
   parameters", which is this module's whole job, and it belongs beside its own inverse — two
   derivations of one rule, in one place, is how they stay each other's check. A project passes a
   measured tower top and gets a rope; nothing about a lab, a city or a renderer is assumed. */
export function swingableRope({ towerTop, arcClear = 0.45, skim = 0.06, groundY = 0, ropeMin = 0.55 } = {}) {
  return Math.max(ropeMin, towerTop - groundY - skim - arcClear);
}

/* ---- THE SKYLINE AT A PERCENTILE, OVER A PACKED SOLIDS BUFFER (A-METRO-INHERIT, 2026-08-10).
   `swingableRope` above needs ONE input — a tower top — and `arena.topAt(p)` was the only thing in
   the repo that could supply it. That made the whole derivation an ability of `createBoxArena`, i.e.
   available to the lab and to nothing else: metropolis has 162 towers from citygen and no arena, so
   the project that most needed "derive my rope from my own skyline" was the one project that could
   not ask the question. Engine-first says the ABILITY moves, so it is here, beside the two
   derivations it feeds — three statements of one rule in one place, which is how they stay each
   other's check.

   IT TAKES THE PACKED SoA BUFFER, not a box list, because that is the ONE representation both level
   generators already produce: 6 floats per box (minX,minY,minZ, maxX,maxY,maxZ), which is the exact
   buffer `createColliderWorld.rebuild` is fed. `citygen`'s `city.state.solids` and `createBoxArena`'s
   own `solids` are the same shape, so neither has to be adapted.

   THE TOP IS ELEMENT 4 of each stride (maxY). p=0 is the shortest tower, 1 the tallest, 0.5 the
   median. Sorting on demand rather than caching, for the same reason `arena.topAt` does: a cached
   list is a list `rebuild` can invalidate, and this is called at boot, not per frame.

   C++ anchor: `std::nth_element` over a strided view of a `std::vector<float>` — except JS has no
   strided iterator, so the tops are copied out first. */
export function topAtPercentile(solids, p = 0.5) {
  if (!solids || !solids.length) return 0;
  const n = Math.floor(solids.length / 6);
  const tops = new Float64Array(n);
  for (let k = 0; k < n; k++) tops[k] = solids[k * 6 + 4];
  return percentileOf(tops, p);
}

/* THE INDEXING HALF, ON ITS OWN, because a second caller arrived (A-SKYLINE's `roofAt`, which asks the
   same question of a DIFFERENT set of tops — see `createBoxArena.roofAt`). Two copies of "which element
   is the p-th percentile" is exactly the drift rule 6 is about, and here it would be invisible: both
   would agree on every input except the off-by-one boundaries, which is where a derived rope lives.
   Sorts IN PLACE (TypedArray.sort is numeric, not lexicographic — the one JS trap in this function).
   p=0 is the smallest, 1 the largest, 0.5 the median. */
export function percentileOf(values, p = 0.5) {
  const n = values.length;
  if (!n) return 0;
  values.sort();
  const i = Math.min(n - 1, Math.max(0, Math.floor(p * n)));
  return values[i];
}

export function createBoxArena(opts = {}) {
  const P = {
    cols: 7, rows: 7,
    /* SPACING IS SIZED OFF TRAVEL-PER-SWING, not off a city block. A pendulum hung h units ahead of
       you carries you ~2h forward (findAnchor's own scoring note), and h is bounded by `ropeMax`, so
       one good swing covers up to ~6 u. Spacing much larger than that strands you between towers with
       nothing in reach; much smaller and the arc never gets to open out. 4.2 leaves a 2.5 u street —
       4.5x metropolis's 0.55 u canyon, which is the "an arc has room" the lab exists to provide. */
    spacing: 4.2,
    width: 1.7, depth: null,
    height: swingableHeight(),      // ≈ 5.31 u — see the derivation above
    heightVary: 0.45,
    groundY: 0,
    plaza: 0,
    seed: 7,
    cell: null,
    material: null,
    groundSize: null,
    groundMaterial: null,
    /* BOTH DEFAULT null, AND THAT IS THE WHOLE COMPATIBILITY STORY. `layout()` branches on
       `P.skyline` once; with it null the original loop runs verbatim, emits the same boxes in the
       same order into the same buffer, and `towerRecs` aliases `boxes` so `roofAt === topAt`.
       projects/swing-lab's 27-check probe is calibrated to that path and must stay on it. */
    skyline: null,
    silhouette: null,
    /* ---- A-MARRIAGE (2026-08-19): THE CITY SITS ON TERRAIN, and the whole change is three nulls.
       `groundYAt(x, z, i, j)` is the per-cell PAD height (carveCityPads' padYOf behind a closure);
       every tower's base becomes its pad and every height stays authored RELATIVE to it, so the
       A-SKYLINE quantile map — which never knew about absolute ground — cannot notice. `heightAt`
       replaces the world bag's flat-floor answer with the married terrain sampler. With all three
       at their defaults the arithmetic below is BIT-IDENTICAL to the flat path (base === P.groundY,
       the same variable, so every `top`, gate and stat reads the exact floats it read yesterday —
       pinned by the flat-in hash in world-marriage.test.mjs). FLAT-IN = TODAY-OUT is the contract:
       a flat heightfield through the married pipeline must hash byte-identical to the plinth. */
    groundYAt: null,
    heightAt: null,
    ground: true,
    ...opts,
  };
  if (P.depth == null) P.depth = P.width;
  if (P.cell == null) P.cell = P.spacing;

  const collider = createColliderWorld({ cell: P.cell });
  const group = new THREE.Group();
  group.name = 'box-arena';

  let boxes = [];
  let towerRecs = [];       // the TOWER records only — parts excluded. Aliases `boxes` on the default path.
  let sky = null;           // the resolved skyline profile, or null. Read by stats/roofAt.
  let solids = new Float32Array(0);
  let towers = null;        // THREE.InstancedMesh — one draw call for the whole skyline
  let ground = null;
  /* A-DRESS: the emissive PARTITION. `mainIdx`/`emIdx` are box indices, not a second box list — the
     packed solids buffer and `boxes` stay one set, so the collider, `roofAt` and every probe see the
     city exactly as before whichever mesh a box is drawn by. With `emissiveKinds` null, `emIdx` is
     empty and `mainIdx` is 0..n-1 in order, i.e. the old loop with an indirection that resolves to
     itself. */
  let mainIdx = [], emIdx = [];
  let emMesh = null, ownedEmMat = null;
  /* A-DRESS: the per-tower DISTRICT id, keyed the same way `buildBridges` keys its neighbour lookup.
     Filled only on the skyline path; read only by the palette. */
  const districtOf = new Map();
  let ownedMat = null, ownedGroundMat = null, ownedGeo = null, ownedGroundGeo = null;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
  const _col = new THREE.Color();

  /* Emit one AABB. Every silhouette part goes through here, which is what makes a cornice or a
     skybridge exactly as solid, as climbable and as WEBBABLE as a tower: `findAnchor` casts
     `segmentHit` against the packed buffer these rows become, and it cannot tell them apart. */
  const push = (x, y, z, w, d, h, kind, i, j) =>
    boxes.push({ x, z, w, d, h, y, top: y + h, kind, i, j });

  /* ---- LAYOUT. Pure data: this builds `boxes` + `solids` and touches no THREE object, so a probe
     (or a headless sweep over parameters) can call the maths without a renderer. ---- */
  function layout() {
    boxes = [];
    const cx = (P.cols - 1) / 2, cz = (P.rows - 1) / 2;
    if (P.skyline) {
      layoutSkyline(cx, cz);
    } else {
      sky = null;
      for (let i = 0; i < P.cols; i++) {
        for (let j = 0; j < P.rows; j++) {
          /* THE PLAZA IS MEASURED IN TOWERS, not units, so it survives a spacing change — the point of
             an empty middle is "somewhere to stand and look up", and that is a count of missing towers
             however far apart they are. */
          if (P.plaza > 0 && Math.max(Math.abs(i - cx), Math.abs(j - cz)) < P.plaza) continue;
          const x = (i - cx) * P.spacing, z = (j - cz) * P.spacing;
          const r = hash3(i, j, P.seed);
          const h = Math.max(0.2, P.height * (1 + (r * 2 - 1) * P.heightVary));
          // A-MARRIAGE: the base is the PAD when a groundYAt is wired; `h` stays relative to it.
          const gy = P.groundYAt ? P.groundYAt(x, z, i, j) : P.groundY;
          boxes.push({ x, z, w: P.width, d: P.depth, h, y: gy, top: gy + h, i, j });
        }
      }
      towerRecs = boxes;      // every box IS a tower here, so roofAt and topAt are the same question
    }
    if (solids.length !== boxes.length * 6) solids = new Float32Array(boxes.length * 6);
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k], o = k * 6;
      solids[o] = b.x - b.w / 2; solids[o + 1] = b.y; solids[o + 2] = b.z - b.d / 2;
      solids[o + 3] = b.x + b.w / 2; solids[o + 4] = b.top; solids[o + 5] = b.z + b.d / 2;
    }
    /* A-DRESS: partition for the UNLIT mesh. The solids buffer above is already built and is NOT
       partitioned — that is the point: which mesh draws a box is a rendering fact, and the collider
       must never learn about rendering facts. */
    const em = (P.silhouette && P.silhouette.emissiveKinds) || null;
    mainIdx = []; emIdx = [];
    for (let k = 0; k < boxes.length; k++) {
      if (em && em.indexOf(boxes[k].kind) >= 0) emIdx.push(k); else mainIdx.push(k);
    }
    collider.rebuild(solids);
  }

  /* ============================================================================================
     A-SKYLINE (2026-08-10) — THE SWINGABLE CITY. Everything below this line runs ONLY when a
     `skyline` profile is supplied; with it null not one statement here executes.
     ============================================================================================ */

  /* THE HEIGHT DISTRIBUTION IS THE GUARANTEE, and it is built by inverting the rule the swing is
     constrained BY rather than by choosing numbers that look tall.

     `findAnchor` demotes an anchor to the zip tier unless `anchorY - rope > ground + skim + arcClear`,
     so the minimum useful TOWER TOP is that same expression — which is exactly `swingableHeight` with
     no margin, reused rather than re-typed (three statements of one rule, in one file, is how they stay
     each other's check).

     Map the rank t ∈ [0,1] to a top with the break at t = 1 - frac and the value AT the break equal to
     that minimum. Then "the fraction of towers clearing the rule" is not an outcome to measure and hope
     about; it is `frac`, by construction, and `stats.swingable` counts it anyway because a derivation
     that is never checked is a wish (this repo has the receipts). */
  function skylineTop(t, S, need) {
    const q = 1 - S.frac;
    const lowTop = P.groundY + Math.max(0.35, (need - P.groundY) * S.low);
    const tallTop = P.groundY + (need - P.groundY) * S.tall;
    if (t < q) return q > 1e-6 ? lowTop + (need - lowTop) * (t / q) : need;
    const s = 1 - q > 1e-6 ? (t - q) / (1 - q) : 1;
    /* GAMMA SHAPES THE TALL HALF ONLY, so it can never move the break and therefore can never move the
       guarantee. >1 puts more of the swingable stock near the line (a few real landmarks, a lot of
       ordinary towers); 1 is a flat spread. */
    return need + (tallTop - need) * Math.pow(s, S.gamma);
  }

  function layoutSkyline(cx, cz) {
    const S = sky = {
      frac: 0.70, ropeMax: 3.2, arcClear: 0.45, skim: 0.06,
      tall: 2.1, low: 0.22, gamma: 1.0,
      cores: 3, coreSigma: 0.30, mix: 0.45,
      footVary: 0.45, jitter: 0.25,
      ...P.skyline,
    };
    const need = swingableHeight({ ropeMax: S.ropeMax, arcClear: S.arcClear, skim: S.skim, groundY: P.groundY, margin: 0 });
    S.need = need;

    /* THE DISTRICT FIELD — a handful of Gaussian downtowns whose centres are a pure function of the
       seed, evaluated in NORMALISED cell coordinates so the shape survives a cols/spacing change. */
    const cores = [];
    for (let k = 0; k < S.cores; k++) {
      const a = hash3(k + 101, 17, P.seed) * Math.PI * 2;
      const rr = 0.12 + 0.62 * hash3(k + 202, 29, P.seed);
      cores.push({ x: Math.cos(a) * rr, z: Math.sin(a) * rr, w: 0.55 + 0.9 * hash3(k + 303, 31, P.seed) });
    }
    const halfC = Math.max(1e-6, (P.cols - 1) / 2), halfR = Math.max(1e-6, (P.rows - 1) / 2);
    const cells = [];
    for (let i = 0; i < P.cols; i++) {
      for (let j = 0; j < P.rows; j++) {
        if (P.plaza > 0 && Math.max(Math.abs(i - cx), Math.abs(j - cz)) < P.plaza) continue;
        const u = (i - cx) / halfC, v = (j - cz) / halfR;
        let g = 0;
        /* A-DRESS: WHICH downtown this cell belongs to, decided by the biggest single contribution
           rather than by the sum. The sum is what ranks the cell (unchanged, and it must stay
           unchanged or the guarantee's input moves); the ARGMAX is a second, free reading of the same
           field, and it is what lets two downtowns wear different palettes instead of one gradient. */
        let bestG = -1, dist = 0;
        for (let k = 0; k < cores.length; k++) {
          const c = cores[k];
          const dx = u - c.x, dz = v - c.z;
          const contrib = c.w * Math.exp(-(dx * dx + dz * dz) / (2 * S.coreSigma * S.coreSigma));
          g += contrib;
          if (contrib > bestG) { bestG = contrib; dist = k; }
        }
        /* `mix` is the ONLY randomness in the ranking, and it is deliberately not zero: a pure field
           makes concentric height rings, which reads as a contour map rather than a city. */
        cells.push({ i, j, dist, score: g + S.mix * hash3(i, j, (P.seed ^ 0x51ed) >>> 0) });
      }
    }
    districtOf.clear();
    /* RANK, then map. Sorting is what decouples "where the tall stock is" (the field) from "how many
       towers clear the line" (the quantile map) — see the header. Ties broken by cell index so the sort
       is deterministic regardless of the engine's sort stability. */
    cells.sort((a, b) => (a.score - b.score) || (a.i - b.i) || (a.j - b.j));
    const n = cells.length;
    towerRecs = [];
    for (let k = 0; k < n; k++) {
      const c = cells[k];
      const t = n > 1 ? k / (n - 1) : 1;
      const top = skylineTop(t, S, need);
      /* FOOTPRINT TRACKS HEIGHT, because a 10 u tower on a 1.9 u pad reads as a pencil and — more to
         the point for the mechanic — a wider tower is a wider LEDGE to land on. Clamped so the street
         between two maximal neighbours never closes below `minStreet`. */
      const grow = 1 + S.footVary * ((top - P.groundY) / Math.max(1e-6, need * S.tall - P.groundY) - 0.45);
      const wMax = P.spacing - (S.minStreet ?? 1.6);
      const w = Math.min(wMax, Math.max(0.5, P.width * grow));
      const d = Math.min(wMax, Math.max(0.5, P.depth * grow));
      /* A SMALL OFF-CENTRE NUDGE, bounded by the street it has to leave open, so the grid stops
         reading as graph paper. `openSpot` returns the middle of a street, which stays clear. */
      const slack = Math.max(0, (P.spacing - Math.max(w, d)) * 0.5) * S.jitter;
      const jx = (hash3(c.i, c.j, (P.seed ^ 0x1a7) >>> 0) * 2 - 1) * slack;
      const jz = (hash3(c.j, c.i, (P.seed ^ 0x2b8) >>> 0) * 2 - 1) * slack;
      const x = (c.i - cx) * P.spacing + jx, z = (c.j - cz) * P.spacing + jz;
      districtOf.set(c.i * 4096 + c.j, c.dist);
      /* `t` GOES DOWN WITH THE TOWER, because the rooftop vocabulary is a function of WHERE IN THE
         SKYLINE a building sits, not of how tall it happens to be in units. Rank is the level's own
         normalised coordinate (0 = the shortest tower, 1 = the tallest) and it survives a spacing or
         a rope change, which a raw height threshold would not. */
      /* A-MARRIAGE: `skylineTop` maps rank → a top measured from P.groundY; on a pad the SAME
         relative height stands on the pad instead. The branch (not `top − P.groundY + gy`
         unconditionally) is the flat-in guarantee: with groundYAt null the expression is the
         untouched `top`, so the default path's floats cannot drift by a rounding. */
      const gy = P.groundYAt ? P.groundYAt(x, z, c.i, c.j) : P.groundY;
      towerRecs.push(buildTower(x, z, w, d, P.groundYAt ? top - P.groundY + gy : top, c.i, c.j, S, need, t, c.dist, gy));
    }
    if (P.silhouette) buildBridges(towerRecs, S, need);
  }

  /* ---- ONE TOWER, AS A STACK OF BOXES. -----------------------------------------------------------
     THE POINT IS NOT PRETTINESS. The ledger's OPEN #16 says it exactly: "every anchor in the lab is a
     point on a flat vertical face at a height the generator chose", so `findAnchor`'s scoring has never
     been exercised by anything else. A setback puts a horizontal LEDGE mid-tower; a cornice OVERHANGS
     the street so the anchor above it has air under the arc; a spire is an anchor 2 u above the roof
     that costs one box. Each is emitted into the same AABB buffer, so each is simultaneously geometry
     you can web, cling to, mantle onto and be stopped by — there is no second representation to drift.

     THE TOWER'S `top` IS PRESERVED EXACTLY. Tier heights are apportioned out of (H - cornices), so the
     topmost tier still ends at the height the quantile map asked for and the swingability guarantee
     survives the silhouette. Roof plant and spires sit ABOVE it and are deliberately NOT counted as the
     tower's roof — `roofAt` must answer "what can I stand on", not "what is the highest object". */
  /* A-MARRIAGE: `base` is the tower's OWN ground (its pad) — P.groundY on the flat path, where every
     expression below is the same float it always was. All the height GATES in here compare the
     tower's RELATIVE height (top − base) against the rule's relative minimum (need − P.groundY),
     which is what decision "author heights relative to pad top" means in arithmetic. */
  function buildTower(x, z, w, d, top, i, j, S, need, t = 0.5, dist = 0, base = P.groundY) {
    const SIL = P.silhouette;
    const H = top - base;
    const rec = { x, z, w, d, h: H, y: base, top, kind: 'tower', i, j, parts: 0, rank: t, district: dist };
    if (!SIL || H < (SIL.minTiered ?? 2.2)) {
      push(x, base, z, w, d, H, 'tower', i, j);
      return rec;
    }
    /* ---- WHY A CORNICE IS 0.22 u THICK AND NOT 0.10, WHICH IS WHAT IT LOOKS LIKE IT WANTS TO BE.
       MEASURED, not reasoned: at 0.10 the first silhouetted chain put the body inside geometry on
       72 of 11 532 frames (the same chain in the lab and in this city WITHOUT the silhouette: 0), and
       the attribution named the box — `cornice`, at MID body height, never while grounded, deepest
       0.046 u. `resolveSphere` is a single-sphere depenetration: one sphere of radius `r` at
       `collideYOff`. A slab THINNER THAN 2r has no configuration in which the sphere centre is outside
       it while the body is clear of it, so the resolver's "push out along the least-penetrated face"
       has nothing stable to push against and the body slides through the thin dimension.
       So the floor is the consumer's own sphere DIAMETER plus margin. This is a general invariant of
       this engine, not a fact about cornices: any collider box thinner than 2r is a box the resolver
       cannot see. It is a PARAMETER rather than a hard-coded 0.22 because `radius` belongs to the
       character, not to the level — a consumer with a fatter body has to raise it. */
    const cH = SIL.corniceH ?? (SIL.minThick ?? 0.22), cOut = SIL.corniceOut ?? 1.13;
    const nTier = H > (SIL.tier3 ?? 5.5) ? 3 : 2;
    const fr = nTier === 3 ? [0.50, 0.31, 0.19] : [0.66, 0.34];
    const scale = [1.0, 0.80, 0.63];
    const body = H - cH * (nTier - 1);          // the cornices eat their own height out of the stack
    let y = base;
    for (let k = 0; k < nTier; k++) {
      const th = body * fr[k];
      const tw = w * scale[k], td = d * scale[k];
      push(x, y, z, tw, td, th, k === 0 ? 'tower' : 'setback', i, j);
      y += th;
      if (k < nTier - 1) {                       // the LEDGE: wider than the tier below → a real overhang
        push(x, y, z, tw * cOut, td * cOut, cH, 'cornice', i, j);
        y += cH;
      }
    }
    rec.parts += 2 * (nTier - 1);        // each step adds one setback body and one cornice
    const rh = hash3(i, j, (P.seed ^ 0x77c1) >>> 0);
    /* ROOF PLANT — a smaller box parked off-centre on the roof. Two jobs: a silhouette that is not a
       flat line, and a second standable height on every roof you mantle onto. */
    let capTop = top;
    if (rh < (SIL.roofBox ?? 0.55)) {
      const rw = w * scale[nTier - 1] * (0.34 + 0.22 * hash3(j, i, (P.seed ^ 0x99a2) >>> 0));
      const rhh = 0.22 + 0.5 * hash3(i + 5, j + 3, (P.seed ^ 0x99a2) >>> 0);
      const ox = (hash3(i + 7, j, (P.seed ^ 0xb1) >>> 0) * 2 - 1) * (w * scale[nTier - 1] - rw) * 0.4;
      const oz = (hash3(i, j + 7, (P.seed ^ 0xb2) >>> 0) * 2 - 1) * (d * scale[nTier - 1] - rw) * 0.4;
      push(x + ox, top, z + oz, rw, rw, rhh, 'roofbox', i, j);
      capTop = Math.max(capTop, top + rhh);
      rec.parts++;
    }
    /* A SPIRE IS THE CHEAPEST HIGH ANCHOR IN THE BUILDING. `anchorY - rope <= your own y` is a geometric
       identity (the ledger's governing line), so the resource a level supplies is anchor HEIGHT ABOVE
       YOU — and a mast is 2 u of that for one thin box. Only on towers that already clear the rule, so
       the spires stand where the swinging happens instead of on the low-rise. */
    if (top - base > (need - P.groundY) * 1.15 && hash3(i + 11, j + 13, (P.seed ^ 0x5e1) >>> 0) < (SIL.spire ?? 0.4)) {
      const sh = 0.6 + 1.8 * hash3(i + 3, j + 11, (P.seed ^ 0x5e2) >>> 0);
      const sw = 0.10 + 0.06 * hash3(i + 13, j + 5, (P.seed ^ 0x5e3) >>> 0);
      push(x, capTop, z, sw, sw, sh, 'spire', i, j);
      rec.parts++;
    }
    /* ===== A-DRESS: THE ROOFTOP KIT. Every rate defaults to 0, so with the A-SKYLINE profile not one
       statement below emits a box and the city is the one the ledger measured. =====================
       DISTRICT WEIGHTING, and it is what turns "five more shapes" into "a skyline with structure".
       The same rate is read through a per-band multiplier off the tower's RANK: the downtown stock
       (rank high) wears masts and clean parapets, the middle wears water towers and stair bulkheads,
       the low-rise wears signage. A uniform rate would sprinkle water towers on the tallest tower in
       the city, which is precisely the "uniform towers" read this arc exists to break.
       `band` is 0 low-rise / 1 mid / 2 downtown, split at the rank thirds. */
    const band = t > 0.72 ? 2 : t > 0.34 ? 1 : 0;
    const wt = (v, lo, mid, hi) => (v || 0) * (band === 0 ? lo : band === 1 ? mid : hi);
    const roll = (salt) => hash3(i + salt, j + salt * 3, (P.seed ^ (0xd1e5 + salt * 977)) >>> 0);
    const rw = w * scale[nTier - 1], rd = d * scale[nTier - 1];   // the TOP tier's footprint — the roof

    /* PARAPET — a thin rim around the roof edge, four boxes. It is the cheapest thing on this list and
       the one that changes the street read most: a flat-topped box reads as a box, a box with a lip
       reads as a building. It is also a real mantle edge — `resolveSphere` can see it because it is
       floored at the same `minThick` the cornice is (a slab thinner than the body's sphere DIAMETER is
       a slab the resolver cannot see — this file's own measured invariant). */
    if (roll(1) < wt(SIL.parapet, 1.0, 0.9, 0.7)) {
      const pt = Math.max(SIL.minThick ?? 0.22, SIL.parapetH ?? 0.22), pw2 = SIL.parapetW ?? 0.16;
      push(x, top, z - rd / 2 + pw2 / 2, rw, pw2, pt, 'parapet', i, j);
      push(x, top, z + rd / 2 - pw2 / 2, rw, pw2, pt, 'parapet', i, j);
      push(x - rw / 2 + pw2 / 2, top, z, pw2, rd - pw2 * 2, pt, 'parapet', i, j);
      push(x + rw / 2 - pw2 / 2, top, z, pw2, rd - pw2 * 2, pt, 'parapet', i, j);
      capTop = Math.max(capTop, top + pt);
      rec.parts += 4;
    }
    /* PENTHOUSE / STAIR BULKHEAD — the box the roof door is in. Distinct from `roofBox` (plant) in
       being TALLER and squarer, and deliberately parked at a roof CORNER rather than near the middle,
       so a roof that has both does not read as two lumps of the same thing. */
    if (roll(2) < wt(SIL.penthouse, 0.7, 1.0, 0.9)) {
      const bw = rw * (0.26 + 0.14 * roll(12)), bd = rd * (0.26 + 0.14 * roll(13));
      const bh = 0.34 + 0.42 * roll(14);
      const sx = roll(15) < 0.5 ? -1 : 1, sz = roll(16) < 0.5 ? -1 : 1;
      push(x + sx * (rw - bw) * 0.42, top, z + sz * (rd - bd) * 0.42, bw, bd, bh, 'penthouse', i, j);
      capTop = Math.max(capTop, top + bh);
      rec.parts++;
    }
    /* WATER TOWER — a tank on four legs, five boxes, and the single most "this is a city" silhouette
       in the vocabulary. The legs matter mechanically as well as visually: the tank has AIR UNDER IT,
       which is the ledger's OPEN #6 lever ("score anchors for arcs with air beneath") arriving on a
       rooftop instead of on a skybridge. Legs are floored at `minThick` for the same resolver reason
       as everything else here. */
    if (roll(3) < wt(SIL.waterTower, 0.5, 1.0, 0.35)) {
      const lt = Math.max(SIL.minThick ?? 0.22, 0.22);
      const tw = Math.min(rw * 0.5, 0.55 + 0.35 * roll(17));
      const lh = 0.26 + 0.24 * roll(18), th = 0.42 + 0.34 * roll(19);
      const ox = (roll(20) * 2 - 1) * (rw - tw) * 0.3, oz = (roll(21) * 2 - 1) * (rd - tw) * 0.3;
      for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        push(x + ox + dx * (tw / 2 - lt / 2), top, z + oz + dz * (tw / 2 - lt / 2), lt, lt, lh, 'watertower', i, j);
      }
      push(x + ox, top + lh, z + oz, tw, tw, th, 'watertower', i, j);
      capTop = Math.max(capTop, top + lh + th);
      rec.parts += 5;
    }
    /* ANTENNA MAST — a spire that has been told what it is for. The spire above is one thin box; a mast
       is the same box plus two crossarms, which costs two instances and buys the one rooftop shape a
       player can read as a SHAPE from a block away rather than as a scratch on the sky. Downtown only
       by weighting, because a broadcast mast on a two-storey building is a joke the eye gets. */
    if (roll(4) < wt(SIL.mast, 0.15, 0.6, 1.0)) {
      const mh = 1.1 + 2.2 * roll(22), mw = 0.09 + 0.05 * roll(23);
      const ox = (roll(24) * 2 - 1) * rw * 0.24, oz = (roll(25) * 2 - 1) * rd * 0.24;
      push(x + ox, capTop, z + oz, mw, mw, mh, 'mast', i, j);
      for (const f of [0.42, 0.68]) {
        const aw = mw * (5.5 - f * 3.0);
        push(x + ox, capTop + mh * f, z + oz, aw, mw * 0.8, mw * 0.8, 'mast', i, j);
      }
      capTop += mh;                        // the mast stands ON the current cap, so the cap rises by its height
      rec.parts += 3;
    }
    /* ROOFTOP SIGNAGE — a thin panel standing on the roof edge, facing along whichever axis it sits on.
       This is the kind `emissiveKinds` exists for: by day it is a painted board, and at night it is the
       only thing above street level that is still emitting. Low-rise weighted, because that is where a
       real city puts its signs — at the height people read them from. */
    if (roll(5) < wt(SIL.sign, 1.0, 0.8, 0.45)) {
      const sh = 0.30 + 0.55 * roll(26), st = SIL.signThick ?? 0.09;
      const alongX = roll(27) < 0.5;
      const sl = (alongX ? rw : rd) * (0.55 + 0.35 * roll(28));
      const edge = roll(29) < 0.5 ? -1 : 1;
      if (alongX) push(x, top, z + edge * (rd / 2 - st / 2), sl, st, sh, 'sign', i, j);
      else push(x + edge * (rw / 2 - st / 2), top, z, st, sl, sh, 'sign', i, j);
      capTop = Math.max(capTop, top + sh);
      rec.parts++;
    }
    return rec;
  }

  /* ---- SKYBRIDGES — the one silhouette element that is a MECHANIC change, not dressing. -----------
     swing-ledger OPEN #6: "peak speed down 15% since walls became solid — an arc hung off a vertical
     face grinds that face at its fastest moment. Lever: score anchors for arcs with air beneath."
     A bridge spanning a street is an anchor with the street under it, so the arc that hangs from it has
     nothing to grind. It also gives the auto fan something to find in the MIDDLE of a street, which is
     where a chain most often runs out of geometry.
     Deterministic, and only between neighbours that are both tall enough that the deck sits above the
     rooftops of nothing — the height is a fraction of the SHORTER of the two towers, so a bridge can
     never poke out of its own supports. */
  function buildBridges(recs, S, need) {
    const rate = P.silhouette.bridge ?? 0.16;
    if (!(rate > 0)) return;
    const at = new Map();
    for (const r of recs) at.set(r.i * 4096 + r.j, r);
    /* SAME FLOOR AS THE CORNICE, and for the same measured reason — a 0.16 u deck is thinner than the
       0.18 u sphere that has to stand on it. A bridge you fall through is worse than no bridge. */
    const bt = P.silhouette.minThick ?? 0.22, bw = P.silhouette.bridgeSpan ?? 0.55;
    for (const a of recs) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const b = at.get((a.i + di) * 4096 + (a.j + dj));
        if (!b) continue;
        if (hash3(a.i * 2 + di, a.j * 2 + dj, (P.seed ^ 0xbc1d) >>> 0) >= rate) continue;
        const lo = Math.min(a.top, b.top);
        /* A-MARRIAGE: both gates relative to each tower's OWN base, and the deck hung off the
           HIGHER pad (the deck must clear the ground at both ends; the higher pad is the binding
           one). Flat path: a.y === b.y === P.groundY, so min(a.top−a.y, b.top−b.y) is exactly
           lo − P.groundY (min and an exact common subtraction commute) and bHi === P.groundY —
           the same floats as before, which the flat-in hash pins. */
        if (Math.min(a.top - a.y, b.top - b.y) < (need - P.groundY) * 0.9) continue;   // both ends must be real towers
        const f = 0.42 + 0.34 * hash3(a.i + dj, a.j + di, (P.seed ^ 0xbc2e) >>> 0);
        const bHi = Math.max(a.y, b.y);
        const y = bHi + (lo - bHi) * f;
        if (di) {
          const x0 = a.x + a.w / 2, x1 = b.x - b.w / 2;
          if (x1 - x0 < 0.35) continue;
          push((x0 + x1) / 2, y, (a.z + b.z) / 2, x1 - x0, bw, bt, 'bridge', a.i, a.j);
        } else {
          const z0 = a.z + a.d / 2, z1 = b.z - b.d / 2;
          if (z1 - z0 < 0.35) continue;
          push((a.x + b.x) / 2, y, (z0 + z1) / 2, bw, z1 - z0, bt, 'bridge', a.i, a.j);
        }
      }
    }
  }

  /* ---- MESHES. Rebuilt only when the COUNT changes; otherwise the instance matrices are rewritten
     in place, so a live height/spacing slider does not churn GPU buffers every frame. ---- */
  function buildMeshes() {
    if (!P.material && !ownedMat) {
      ownedMat = new THREE.MeshStandardMaterial({ color: '#7d8496', roughness: 0.82, metalness: 0.02, flatShading: true });
    }
    const mat = P.material || ownedMat;
    if (!towers || towers.count !== mainIdx.length) {
      if (towers) { group.remove(towers); towers.dispose(); }
      if (!ownedGeo) ownedGeo = new THREE.BoxGeometry(1, 1, 1);
      towers = new THREE.InstancedMesh(ownedGeo, mat, Math.max(1, mainIdx.length));
      towers.castShadow = true; towers.receiveShadow = true;
      towers.frustumCulled = false;                 // one instanced draw; the arena is the whole scene
      group.add(towers);
    }
    towers.count = mainIdx.length;
    for (let n = 0; n < mainIdx.length; n++) {
      const b = boxes[mainIdx[n]];
      _p.set(b.x, b.y + b.h / 2, b.z); _s.set(b.w, b.h, b.d);
      _m.compose(_p, _q, _s);
      towers.setMatrixAt(n, _m);
    }
    towers.instanceMatrix.needsUpdate = true;
    towers.computeBoundingSphere();
    /* ---- A-DRESS: THE PER-INSTANCE FACADE VARIATION, and it is the one thing on this list that needs
       a shader to receive it. Every tower is textured by `createTriplanarForgeMaterial`, which samples
       by WORLD POSITION — so two buildings never repeat the same patch of texture, but they DO wear the
       same storey rhythm, because the tile scale is a uniform. `aLgrVar` is a per-instance float the
       triplanar material can multiply that scale by (see triplanar-forge.js `perInstance`), so window
       bands land at a different height on every building for the cost of one float per instance and
       ZERO extra draw calls. Written only when asked for: with `facadeVary` 0 the attribute is not
       created, the material is not patched, and the program is the one A-AERIAL compiled. */
    const fv = sky && sky.facadeVary > 0 ? sky.facadeVary : 0;
    if (fv > 0) {
      if (!towers.geometry.getAttribute('aLgrVar') || towers.geometry.getAttribute('aLgrVar').count !== mainIdx.length) {
        towers.geometry.setAttribute('aLgrVar', new THREE.InstancedBufferAttribute(new Float32Array(mainIdx.length), 1));
      }
      const at = towers.geometry.getAttribute('aLgrVar');
      for (let n = 0; n < mainIdx.length; n++) {
        const b = boxes[mainIdx[n]];
        /* KEYED ON THE TOWER CELL, NOT ON THE BOX, so a setback wears the same facade rhythm as the
           body under it — a building whose third storey band jumps at the setback is a building that
           reads as two buildings. */
        at.array[n] = (hash3(b.i, b.j, (P.seed ^ 0xfacd) >>> 0) * 2 - 1) * fv;
      }
      at.needsUpdate = true;
    }
    /* ---- PER-INSTANCE TINT, and it is opt-in for the same reason everything else here is: touching
       `instanceColor` flips Three's USE_INSTANCING_COLOR define, i.e. a DIFFERENT SHADER, and the lab's
       27-check probe runs on the grey grid. With `skyline` null this block never executes and the mesh
       has no instanceColor attribute at all.
       ONE MESH, ONE MATERIAL, ONE DRAW CALL — the whole city, at any size. That is the entire reason
       the silhouette parts are boxes: variety that costs instances instead of draw calls. The tint is a
       function of HEIGHT (a value ramp, so the skyline reads in depth) times a per-kind factor (plant
       and bridges darker, cornices lighter — the silhouette has to be legible as silhouette). */
    if (P.skyline) {
      const hi = Math.max(1e-6, stats().maxTop - P.groundY);
      /* ---- A-DRESS: THE DISTRICT PALETTE. `null` (the default) keeps the A-SKYLINE formula below
         EXACTLY — one hue band at 0.55, luminance ramped by height — which is what makes this whole
         addition an opt-in no-op. With a palette supplied, the hue/sat/value FAMILY comes from the
         tower's district (the argmax of the same Gaussian core field that ranks it), so two downtowns
         are two colours of city rather than two bumps in one gradient. The height ramp still runs
         inside the family, so depth still reads. */
      const pal = sky && Array.isArray(sky.palette) && sky.palette.length ? sky.palette : null;
      for (let n = 0; n < mainIdx.length; n++) {
        const k = mainIdx[n];
        const b = boxes[k];
        const t = Math.min(1, (b.top - P.groundY) / hi);
        const kind = b.kind || 'tower';
        if (pal) {
          const fam = pal[(districtOf.get(b.i * 4096 + b.j) ?? 0) % pal.length];
          const shadeP = kind === 'cornice' ? 1.16 : kind === 'spire' || kind === 'mast' ? 1.26
            : kind === 'parapet' ? 1.10 : kind === 'roofbox' || kind === 'penthouse' ? 0.84
            : kind === 'watertower' ? 0.72 : kind === 'bridge' ? 0.78 : 1;
          const hu = fam.hue + (fam.hueVary ?? 0.03) * (hash3(b.i, b.j, (P.seed ^ 0xc010) >>> 0) * 2 - 1);
          const sa = (fam.sat ?? 0.08) + (fam.satVary ?? 0.05) * hash3(b.j, b.i, (P.seed ^ 0xc011) >>> 0);
          const lo = fam.valMin ?? 0.40, hiV = fam.valMax ?? 0.70;
          _col.setHSL(hu, sa, Math.min(0.90, (lo + (hiV - lo) * t) * shadeP));
          towers.setColorAt(n, _col);
          continue;
        }
        /* THE VALUES ARE WHERE THEY ARE BECAUSE THE FIRST TRY WAS UNREADABLE. A ramp from L 0.26 put the
           low-rise 30% — the district you spawn IN — below the ambient, and the first capture of the
           city was a black frame. The floor is now near the old flat grey (#7d8496 is L 0.54) and the
           ramp runs UP from it, so height reads as value without anything reading as unlit. */
        /* A-DRESS: the four new kinds join this ladder rather than getting a second one. A water tower
           and a penthouse are PLANT — darker than the wall they sit on, which is what keeps a roof
           reading as a roof with things on it instead of as a lumpy roof. A mast reads like a spire
           because it is one. */
        const shade = kind === 'cornice' ? 1.16 : kind === 'spire' || kind === 'mast' ? 1.26
          : kind === 'parapet' ? 1.10 : kind === 'roofbox' || kind === 'penthouse' ? 0.84
          : kind === 'watertower' ? 0.72 : kind === 'bridge' ? 0.78 : 1;
        const hue = 0.55 + 0.11 * hash3(b.i, b.j, (P.seed ^ 0xc010) >>> 0);
        _col.setHSL(hue, 0.05 + 0.09 * hash3(b.j, b.i, (P.seed ^ 0xc011) >>> 0), Math.min(0.88, (0.40 + 0.30 * t) * shade));
        towers.setColorAt(n, _col);
      }
      if (towers.instanceColor) towers.instanceColor.needsUpdate = true;
    }

    /* ---- A-DRESS: THE UNLIT MESH. One extra draw call, and only when a consumer names an emissive
       kind. `MeshBasicMaterial` is the honest choice over an emissive Standard: this is a sign face,
       it is not lit BY anything and it does not want to be — a night city's signage is the light. Its
       instances are the SAME boxes, drawn once, in the same buffer the collider reads. ---- */
    if (emIdx.length) {
      if (!ownedEmMat) ownedEmMat = new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false });
      if (!emMesh || emMesh.count !== emIdx.length) {
        if (emMesh) { group.remove(emMesh); emMesh.dispose(); }
        if (!ownedGeo) ownedGeo = new THREE.BoxGeometry(1, 1, 1);
        emMesh = new THREE.InstancedMesh(ownedGeo, ownedEmMat, Math.max(1, emIdx.length));
        emMesh.frustumCulled = false;
        emMesh.castShadow = false; emMesh.receiveShadow = false;   // a light source does not shadow itself
        group.add(emMesh);
      }
      emMesh.count = emIdx.length;
      const pal = sky && Array.isArray(sky.palette) && sky.palette.length ? sky.palette : null;
      for (let n = 0; n < emIdx.length; n++) {
        const b = boxes[emIdx[n]];
        _p.set(b.x, b.y + b.h / 2, b.z); _s.set(b.w, b.h, b.d);
        _m.compose(_p, _q, _s);
        emMesh.setMatrixAt(n, _m);
        /* THE SIGN'S HUE IS THE DISTRICT'S, ROTATED — a sign that matches its building is invisible,
           and a sign of a random hue is a fairground. A quarter-turn round the wheel from the local
           facade family reads as "a different material, same city". */
        const fam = pal ? pal[(districtOf.get(b.i * 4096 + b.j) ?? 0) % pal.length] : null;
        const base = (fam ? fam.hue : 0.55) + 0.42 + 0.16 * hash3(b.i + 3, b.j + 5, (P.seed ^ 0x516e) >>> 0);
        /* THE VALUES CAME DOWN FROM (0.62, 0.60) AFTER LOOKING AT THE WIDE SHOT — the ledger's own
           technique #4. Unlit geometry in a scene whose lit surfaces sit around 0.3 does not read as
           "a sign", it reads as a hole punched in the city, and forty of them across a skyline read as
           a fairground. Dropping the lightness under the facade's own top end puts the signs back
           INSIDE the picture, where they still win at night because everything else has gone dark. */
        _col.setHSL(base % 1, 0.48, 0.42);
        emMesh.setColorAt(n, _col);
      }
      emMesh.instanceMatrix.needsUpdate = true;
      if (emMesh.instanceColor) emMesh.instanceColor.needsUpdate = true;
    } else if (emMesh) { group.remove(emMesh); emMesh.dispose(); emMesh = null; }

    /* A-MARRIAGE: `ground: false` = no flat floor plane — the married room's terrain mesh IS the
       ground, and a plinth poking through a hillside would be the exact two-representations drift
       the one-field rule forbids. Default true: every existing consumer keeps its floor. */
    if (P.ground === false) {
      if (ground) { group.remove(ground); ground = null; }
      return;
    }
    const gs = P.groundSize != null ? P.groundSize : Math.max(P.cols, P.rows) * P.spacing + P.spacing * 4;
    if (!ground) {
      if (!P.groundMaterial && !ownedGroundMat) {
        ownedGroundMat = new THREE.MeshStandardMaterial({ color: '#2f3440', roughness: 0.95, metalness: 0 });
      }
      ownedGroundGeo = new THREE.PlaneGeometry(1, 1);
      ground = new THREE.Mesh(ownedGroundGeo, P.groundMaterial || ownedGroundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.receiveShadow = true;
      group.add(ground);
    }
    ground.scale.set(gs, gs, 1);
    ground.position.set(0, P.groundY, 0);
  }

  /* ---- THE WORLD QUERY BAG — the four functions every body in this engine reads.
     `heightAt` is the GROUND ONLY (the flat floor, or — A-MARRIAGE — the married terrain sampler).
     Rooftops arrive through `surfaceAt`, exactly as they do in metropolis, and keeping them apart
     is load-bearing rather than tidy: the grapple's `arcClear` test asks `heightAt` "would this arc
     hit the GROUND", and folding roofs into that answer would reject every arc that passes over a
     building — which is most of the good ones. The ONE bag serves the married geometry: heightAt
     reads the carved field, the other three read the packed boxes standing on it. Read through P
     live (not captured) so a rebuild that swaps the sampler swaps the bag with it. ---- */
  const world = {
    heightAt: (x, z) => (P.heightAt ? P.heightAt(x, z) : P.groundY),
    surfaceAt: (x, z, yMax, r) => collider.surfaceAt(x, z, yMax, r),
    segmentHit: (ox, oy, oz, ex, ey, ez, r) => collider.segmentHit(ox, oy, oz, ex, ey, ez, r),
    resolveSphere: (st, dt, cfg) => collider.resolveSphere(st, dt, cfg),
  };

  function stats() {
    const tops = boxes.map((b) => b.top).sort((a, b) => a - b);
    const med = tops.length ? tops[tops.length >> 1] : 0;
    const s = {
      count: boxes.length,
      medianTop: med,
      maxTop: tops.length ? tops[tops.length - 1] : 0,
      minTop: tops.length ? tops[0] : 0,
      streetWidth: P.spacing - P.width,
      extent: (Math.max(P.cols, P.rows) - 1) * P.spacing / 2 + P.width / 2,
    };
    /* THE GUARANTEE, COUNTED. `skylineTop` makes the fraction true by construction; this recounts it
       off the finished geometry anyway, because the ledger's whole method is that a derivation which is
       never checked is a wish. `need` is the arc-bottom minimum the towers were built against, so
       `clearing/towers` should come back as `skyline.frac` — and if it ever does not, the level says so
       instead of the swing looking broken three arcs later. */
    if (sky) {
      let clearing = 0;
      /* A-MARRIAGE: the rule is LOCAL — a tower on a pad clears it when its top beats the arc-bottom
         minimum measured from ITS OWN ground, i.e. top > need + (padY − P.groundY). On the flat path
         r.y − P.groundY is 0 by identity (same variable) and x + 0 === x in IEEE, so the comparison
         is bit-for-bit the old `r.top > sky.need` — the guarantee count cannot move. */
      for (const r of towerRecs) if (r.top > sky.need + (r.y - P.groundY)) clearing++;
      const rt = towerRecs.map((r) => r.top).sort((a, b) => a - b);
      s.towers = towerRecs.length;
      s.parts = boxes.length - towerRecs.length;
      s.roofMedian = rt.length ? rt[rt.length >> 1] : 0;
      s.swingable = { need: sky.need, clearing, towers: towerRecs.length, frac: towerRecs.length ? clearing / towerRecs.length : 0, want: sky.frac };
    } else {
      s.towers = boxes.length;
      s.parts = 0;
      s.roofMedian = med;
      s.swingable = null;
    }
    return s;
  }

  layout();
  buildMeshes();

  return {
    world, collider, group,
    get solids() { return solids; },
    get boxes() { return boxes; },
    params: P,
    get stats() { return stats(); },
    /* THE SKYLINE AT A PERCENTILE (A-CLIMB, 2026-08-10). `stats` gives min/median/max, which answers
       "how tall is this level" and cannot answer "how tall is the level for MOST of it" — the question
       every derived traversal constant actually asks (see `swingableRope`). p=0 is the shortest tower,
       1 the tallest, 0.5 the median. Sorting 80 numbers on demand is cheaper than caching a list that
       `rebuild` could invalidate. */
    /* Delegates to `topAtPercentile` (A-METRO-INHERIT) — same arithmetic, over the same `solids`
       buffer `layout()` already packed, so the answer is byte-identical to the old boxes-list version
       (solids[k*6+4] IS boxes[k].top). One implementation, two callers. */
    topAt(p = 0.5) {
      if (!boxes.length) return P.groundY;
      return topAtPercentile(solids, p);
    },
    get towers() { return towerRecs; },
    /* ---- `roofAt` vs `topAt`, AND THE DIFFERENCE IS A TRAP WORTH NAMING (A-SKYLINE, 2026-08-10).
       `topAt` is a percentile over EVERY solid, which was the same question as "every tower" right up
       until this file learned to emit cornices and skybridges. It now is not: a silhouetted city's
       solids list is majority PARTS, most of them low, so `topAt(0.3)` on the new path answers a
       question about cornices and would hand a derived rope a number that has nothing to do with the
       skyline. `roofAt` is the percentile over TOWER ROOFS — what you can stand on, what the arc-bottom
       rule is about, and what `swingableRope` must be fed.
       On the default (uniform-grid) path `towerRecs` IS `boxes`, so the two are the same number by
       construction, and both go through `percentileOf` so they cannot drift at the boundaries.
       On that path the tops are read out of `solids` (Float32) rather than off the records (Float64),
       so a rope derived through `roofAt` cannot disagree in the last bits with one derived through
       `topAt`. On the skyline path a tower is a STACK and its record is the only place its roof exists
       as one number, so the record is the source there. */
    roofAt(p = 0.5) {
      if (!towerRecs.length) return P.groundY;
      const aliased = towerRecs === boxes;      // default path: record k IS box k, index for index
      const tops = new Float64Array(towerRecs.length);
      for (let k = 0; k < towerRecs.length; k++) tops[k] = aliased ? solids[k * 6 + 4] : towerRecs[k].top;
      return percentileOf(tops, p);
    },
    /* A CLEAR SPAWN, because "where do I stand" is a question the level should answer and every probe
       in this repo has had to re-derive. Returns the centre of the widest street near (x,z), i.e. a
       point the arena guarantees is not inside a tower. */
    openSpot(x = 0, z = 0) {
      const gx = Math.round(x / P.spacing) * P.spacing + P.spacing / 2;
      const gz = Math.round(z / P.spacing) * P.spacing + P.spacing / 2;
      // A-MARRIAGE: on married ground the open spot's floor is wherever the street actually is.
      return { x: gx, y: P.heightAt ? P.heightAt(gx, gz) : P.groundY, z: gz };
    },
    rebuild(next = {}) {
      Object.assign(P, next);
      if (next.depth === undefined && next.width !== undefined) P.depth = P.width;
      if (next.cell !== undefined) { /* the collider's cell is fixed at construction — spacing changes
        re-bucket into the same grid, which is correct: the cell is a broad-phase hint, not geometry. */ }
      layout();
      buildMeshes();
      return stats();
    },
    dispose() {
      if (towers) { group.remove(towers); towers.dispose(); }
      if (emMesh) { group.remove(emMesh); emMesh.dispose(); }
      if (ground) group.remove(ground);
      if (ownedGeo) ownedGeo.dispose();
      if (ownedGroundGeo) ownedGroundGeo.dispose();
      if (ownedMat) ownedMat.dispose();
      if (ownedEmMat) ownedEmMat.dispose();
      if (ownedGroundMat) ownedGroundMat.dispose();
      towers = null; emMesh = null; ground = null;
    },
  };
}
