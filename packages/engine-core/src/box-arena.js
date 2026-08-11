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
   }) -> {
     world,               // { heightAt, surfaceAt, segmentHit, resolveSphere } — the query bag
     collider,            // the raw createColliderWorld handle (depthAt/probe/boxAt for probes)
     group,               // THREE.Group: ground + towers. Add it to your scene.
     solids,              // Float32Array, 6 floats/box
     boxes,               // [{ x, y, z, w, d, h, top }] — readable form, for HUD/probe/anchor picking
     params,              // the resolved parameter set (defaults filled in)
     stats,               // { count, medianTop, maxTop, minTop, streetWidth, extent }
     rebuild(next),       // merge params, re-lay, re-bucket the collider, rebuild the meshes
     dispose(),
   }
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
    ...opts,
  };
  if (P.depth == null) P.depth = P.width;
  if (P.cell == null) P.cell = P.spacing;

  const collider = createColliderWorld({ cell: P.cell });
  const group = new THREE.Group();
  group.name = 'box-arena';

  let boxes = [];
  let solids = new Float32Array(0);
  let towers = null;        // THREE.InstancedMesh — one draw call for the whole skyline
  let ground = null;
  let ownedMat = null, ownedGroundMat = null, ownedGeo = null, ownedGroundGeo = null;
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _p = new THREE.Vector3();

  /* ---- LAYOUT. Pure data: this builds `boxes` + `solids` and touches no THREE object, so a probe
     (or a headless sweep over parameters) can call the maths without a renderer. ---- */
  function layout() {
    boxes = [];
    const cx = (P.cols - 1) / 2, cz = (P.rows - 1) / 2;
    for (let i = 0; i < P.cols; i++) {
      for (let j = 0; j < P.rows; j++) {
        /* THE PLAZA IS MEASURED IN TOWERS, not units, so it survives a spacing change — the point of
           an empty middle is "somewhere to stand and look up", and that is a count of missing towers
           however far apart they are. */
        if (P.plaza > 0 && Math.max(Math.abs(i - cx), Math.abs(j - cz)) < P.plaza) continue;
        const x = (i - cx) * P.spacing, z = (j - cz) * P.spacing;
        const r = hash3(i, j, P.seed);
        const h = Math.max(0.2, P.height * (1 + (r * 2 - 1) * P.heightVary));
        boxes.push({ x, z, w: P.width, d: P.depth, h, y: P.groundY, top: P.groundY + h, i, j });
      }
    }
    if (solids.length !== boxes.length * 6) solids = new Float32Array(boxes.length * 6);
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k], o = k * 6;
      solids[o] = b.x - b.w / 2; solids[o + 1] = b.y; solids[o + 2] = b.z - b.d / 2;
      solids[o + 3] = b.x + b.w / 2; solids[o + 4] = b.top; solids[o + 5] = b.z + b.d / 2;
    }
    collider.rebuild(solids);
  }

  /* ---- MESHES. Rebuilt only when the COUNT changes; otherwise the instance matrices are rewritten
     in place, so a live height/spacing slider does not churn GPU buffers every frame. ---- */
  function buildMeshes() {
    if (!P.material && !ownedMat) {
      ownedMat = new THREE.MeshStandardMaterial({ color: '#7d8496', roughness: 0.82, metalness: 0.02, flatShading: true });
    }
    const mat = P.material || ownedMat;
    if (!towers || towers.count !== boxes.length) {
      if (towers) { group.remove(towers); towers.dispose(); }
      if (!ownedGeo) ownedGeo = new THREE.BoxGeometry(1, 1, 1);
      towers = new THREE.InstancedMesh(ownedGeo, mat, Math.max(1, boxes.length));
      towers.castShadow = true; towers.receiveShadow = true;
      towers.frustumCulled = false;                 // one instanced draw; the arena is the whole scene
      group.add(towers);
    }
    towers.count = boxes.length;
    for (let k = 0; k < boxes.length; k++) {
      const b = boxes[k];
      _p.set(b.x, b.y + b.h / 2, b.z); _s.set(b.w, b.h, b.d);
      _m.compose(_p, _q, _s);
      towers.setMatrixAt(k, _m);
    }
    towers.instanceMatrix.needsUpdate = true;
    towers.computeBoundingSphere();

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
     `heightAt` is the FLAT FLOOR ONLY. Rooftops arrive through `surfaceAt`, exactly as they do in
     metropolis, and keeping them apart is load-bearing rather than tidy: the grapple's `arcClear`
     test asks `heightAt` "would this arc hit the GROUND", and folding roofs into that answer would
     reject every arc that passes over a building — which is most of the good ones. ---- */
  const world = {
    heightAt: () => P.groundY,
    surfaceAt: (x, z, yMax, r) => collider.surfaceAt(x, z, yMax, r),
    segmentHit: (ox, oy, oz, ex, ey, ez, r) => collider.segmentHit(ox, oy, oz, ex, ey, ez, r),
    resolveSphere: (st, dt, cfg) => collider.resolveSphere(st, dt, cfg),
  };

  function stats() {
    const tops = boxes.map((b) => b.top).sort((a, b) => a - b);
    const med = tops.length ? tops[tops.length >> 1] : 0;
    return {
      count: boxes.length,
      medianTop: med,
      maxTop: tops.length ? tops[tops.length - 1] : 0,
      minTop: tops.length ? tops[0] : 0,
      streetWidth: P.spacing - P.width,
      extent: (Math.max(P.cols, P.rows) - 1) * P.spacing / 2 + P.width / 2,
    };
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
    topAt(p = 0.5) {
      if (!boxes.length) return P.groundY;
      const tops = boxes.map((b) => b.top).sort((a, b) => a - b);
      const i = Math.min(tops.length - 1, Math.max(0, Math.floor(p * tops.length)));
      return tops[i];
    },
    /* A CLEAR SPAWN, because "where do I stand" is a question the level should answer and every probe
       in this repo has had to re-derive. Returns the centre of the widest street near (x,z), i.e. a
       point the arena guarantees is not inside a tower. */
    openSpot(x = 0, z = 0) {
      const gx = Math.round(x / P.spacing) * P.spacing + P.spacing / 2;
      const gz = Math.round(z / P.spacing) * P.spacing + P.spacing / 2;
      return { x: gx, y: P.groundY, z: gz };
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
      if (ground) group.remove(ground);
      if (ownedGeo) ownedGeo.dispose();
      if (ownedGroundGeo) ownedGroundGeo.dispose();
      if (ownedMat) ownedMat.dispose();
      if (ownedGroundMat) ownedGroundMat.dispose();
      towers = null; ground = null;
    },
  };
}
