/* ============================================================
   @lgr/engine-core — createForest (Lesson HOARD-3: a sparse instanced forest for a flat arena).
   ------------------------------------------------------------
   The vegetation ability, born for The Hoard's forest map. SIBLING of scatter.js — but scatter.js is
   TERRAIN scatter (it samples a heightfield + biome grid + slope, for the world editor). A game ARENA is
   flat and needs three things scatter doesn't do: CLEARING keep-outs (the arena heart stays open — the
   fight + the barriers live there), MIN-SPACING (sparse, no clumping — long Zomboid sightlines), and
   GAMEPLAY COLLIDERS (trees block the survivor AND the horde, or the fiction breaks). So this is its own
   focused, self-contained, node-tested ability, not a scatter parameter. It reuses scatter's *look* (one
   InstancedMesh per archetype, flat-shaded baked vertex colour) so the forest matches the house style.

   ── THE ABILITY (the node-tested part) is the PLACEMENT: a deterministic dart-throw. Seeded RNG picks
   candidate points in the arena disk; a candidate is REJECTED if it falls inside a clearing keep-out or
   within minSpacing of an already-placed tree; survivors get a weighted archetype + a scale/yaw/tint.
   Same seed ⇒ same forest (the ?capture + regression contract). C++ anchor: Poisson-ish rejection sampling
   with an O(n²) neighbour check — fine at the sparse counts a moody forest wants.

   ── COLLIDERS: every placed tree/rock within `arenaR` (the playable radius) yields a {x,z,r} circle. Trees
   beyond the play radius are visual-only (the survivor is clamped inside arenaR anyway), so they cost no
   collision. The game folds these into its movement clamp (hoard.setColliders).

   Contract: createForest(opts) -> { group, colliders:[{x,z,r}], placements, dispose() }.
   ============================================================ */
import * as THREE from 'three';
import { mulberry32 } from './citygen.js';

/* ---- GEOMETRY: three low-poly archetypes, flat-shaded with a baked per-vertex colour so trunk + canopy
   read in ONE instanced mesh (no per-part material). Primitive-built — SHAPE + LIGHT carry it. ---- */
function bakeColor(geo, hex) {
  const c = new THREE.Color(hex), n = geo.attributes.position.count, col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return geo;
}
/* concat a few non-indexed (position+normal+color+uv) geometries into one — a tiny local merge (the
   engine doesn't pull in BufferGeometryUtils). Each input must already be non-indexed + colour-baked.
   UV is carried through additively (Beauty B1): the default vertex-colour material ignores it, so v1
   stays byte-identical, but a forge BARK material (map/normalMap) can now tile up the trunk. */
function mergeParts(geos) {
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), uv = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);   // primitive geos carry uv; keep it
    o += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return out;
}
/* A5 — place a tapered branch: a cone (base→tip) built along +Y with its BASE at the origin, tilted `tilt`
   from vertical, aimed at azimuth `az`, then anchored at (attach point on the parent). Returns the geo so a
   twig can be forked off its TIP (we return the tip world-pos too). Low-poly (4–5 radial segs). */
function branch(r0, r1, len, tilt, az, ax, ay, az2, hex, segs = 5) {
  const g = new THREE.CylinderGeometry(r1, r0, len, segs).translate(0, len / 2, 0).toNonIndexed();
  g.rotateZ(tilt).rotateY(az).translate(ax, ay, az2);
  bakeColor(g, hex);
  // tip position after the same transform (for forking twigs): base(0,len,0) → rotZ → rotY → translate.
  // rotateZ(θ) sends (0,len,0) → (-len·sinθ, len·cosθ, 0); rotateY(az) then spins x into x/z. rx MUST be
  // NEGATIVE or the twig anchors mirrored across the trunk (caught in the tip-vs-geometry check).
  const s = Math.sin(tilt), c = Math.cos(tilt), rx = -len * s;
  const tx = rx * Math.cos(az) + ax, ty = len * c + ay, tz = -rx * Math.sin(az) + az2;
  return { g, tip: [tx, ty, tz] };
}
function makeConifer() {   // a pine: short trunk + THREE stacked cones (fuller, pointier canopy) — reads as a pine
  const trunk = bakeColor(new THREE.CylinderGeometry(0.05, 0.08, 0.44, 6).translate(0, 0.22, 0).toNonIndexed(), '#4a3423');
  // A5: a third, tighter top cone + slightly overlapping skirts so the silhouette is a full conifer, not two discs.
  const c1 = bakeColor(new THREE.ConeGeometry(0.40, 0.66, 8).translate(0, 0.60, 0).toNonIndexed(), '#2f4a2b');
  const c2 = bakeColor(new THREE.ConeGeometry(0.30, 0.56, 8).translate(0, 0.92, 0).toNonIndexed(), '#37592f');
  const c3 = bakeColor(new THREE.ConeGeometry(0.19, 0.46, 8).translate(0, 1.24, 0).toNonIndexed(), '#3f6a38');
  return mergeParts([trunk, c1, c2, c3]);
}
function makeBare(seed = 0x0cae) {   // A5: a SKELETAL dead tree — tapered trunk + forking primary branches +
  const rng = mulberry32(seed);      // secondary twigs, so it reads as a bare tree, not a TV-antenna of straight stubs.
  const B = ['#52412f', '#493827', '#584936', '#463829', '#4d3d2d'];
  const bh = (i) => B[i % B.length];
  // tapered trunk (thicker base → thin top), a touch taller than v1's so the crown sits above eye-line.
  const parts = [bakeColor(new THREE.CylinderGeometry(0.04, 0.095, 1.35, 6).translate(0, 0.675, 0).toNonIndexed(), '#4b3c2c')];
  const PRIM = 6;   // primary branches fork off the upper trunk at varied heights/angles/lengths
  for (let i = 0; i < PRIM; i++) {
    const az = (i / PRIM) * Math.PI * 2 + rng() * 0.9;
    const h = 0.62 + (i / PRIM) * 0.62 + rng() * 0.1;         // climb the trunk as we go around
    const len = 0.34 + rng() * 0.34;
    const tilt = 0.55 + rng() * 0.55;                          // up-and-out
    const ar = 0.045;                                          // anchor just off the trunk axis
    const b = branch(0.03, 0.014, len, tilt, az, Math.cos(az) * ar, h, Math.sin(az) * ar, bh(i));
    parts.push(b.g);
    // a secondary twig forks off the primary's tip ~60% of the time (skeletal fullness)
    if (rng() > 0.4) {
      const tl = len * (0.5 + rng() * 0.25), t2 = tilt + (rng() - 0.5) * 0.9, a2 = az + (rng() - 0.5) * 1.1;
      parts.push(branch(0.013, 0.006, tl, t2, a2, b.tip[0], b.tip[1], b.tip[2], bh(i + 2), 4).g);
    }
  }
  return mergeParts(parts);
}
function makeRock(seed) {   // a low faceted boulder (deterministic jitter), sunk a touch into the ground
  const g = new THREE.IcosahedronGeometry(0.24, 0).toNonIndexed(), p = g.attributes.position, r = mulberry32(seed);
  for (let i = 0; i < p.count; i++) { const k = 0.72 + r() * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.7, p.getZ(i) * k); }
  g.computeVertexNormals();
  return bakeColor(g, '#6b6560');
}
const ARCHETYPE_GEO = { conifer: makeConifer, bare: makeBare, rock: () => makeRock(0x0c1a) };

/* ---- PLACEMENT (pure, deterministic, node-tested via createForest.placeForest export) ---- */
export function placeForest({
  seed = 1, radius = 18, arenaR = 7.3, count = 60, minSpacing = 1.4,
  clearings = [{ x: 0, z: 0, r: 6 }],
  archetypes = [{ key: 'conifer', weight: 0.5, r: 0.4 }, { key: 'bare', weight: 0.35, r: 0.34 }, { key: 'rock', weight: 0.15, r: 0.3 }],
  groundY = 0.3,
} = {}) {
  const rng = mulberry32((seed ^ 0x0f0235) >>> 0);
  const totW = archetypes.reduce((s, a) => s + a.weight, 0);
  const pick = () => { let r = rng() * totW; for (const a of archetypes) { if ((r -= a.weight) <= 0) return a; } return archetypes[archetypes.length - 1]; };
  const placed = [];                                  // {x,z} for the spacing check
  const placements = {}; for (const a of archetypes) placements[a.key] = [];
  const colliders = [];
  const minS2 = minSpacing * minSpacing;
  const maxAttempts = count * 40;
  for (let att = 0; att < maxAttempts && placed.length < count; att++) {
    const rr = Math.sqrt(rng()) * radius, ang = rng() * Math.PI * 2;   // sqrt → uniform over the disk area
    const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
    let ok = true;
    for (const c of clearings) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < c.r * c.r) { ok = false; break; } }
    if (ok) for (const p of placed) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < minS2) { ok = false; break; } }
    if (!ok) continue;
    const a = pick(), s = 0.8 + rng() * 0.5, yaw = rng() * Math.PI * 2, tint = 0.82 + rng() * 0.36;
    placements[a.key].push({ x, y: groundY, z, s, r: yaw, t: tint });
    placed.push({ x, z });
    if (rr <= arenaR) colliders.push({ x, z, r: a.r * s });    // only playable-radius trees collide
  }
  return { placements, colliders, count: placed.length };
}

/* ---- ASSEMBLY: one InstancedMesh per archetype (castShadow — the shadow ability grounds them). ---- */
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _yA = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
export function createForest(opts = {}) {
  const { placements, colliders, count } = placeForest(opts);
  // LOOK-TUNE: heightScale grows trees TALLER (Y-only) without widening the trunk — so the horizontal
  // COLLIDER (from placeForest, x/z-based) stays correct with no change. Rocks are exempt (a stretched
  // boulder looks wrong). Default 1 → v1 forest byte-identical.
  const heightScale = opts.heightScale != null ? opts.heightScale : 1;
  // Beauty B1: an optional per-archetype material override (e.g. a forge BARK material for 'bare'
  // trunks). When absent the archetype keeps its flat-shaded vertex-colour material (v1 look). A
  // supplied material should keep vertexColors:true so the per-instance tint still modulates it.
  const materials = opts.materials || {};
  const group = new THREE.Group();
  group.raycast = () => {};
  const geos = {}, ownedMats = [];
  for (const key of Object.keys(placements)) {
    const list = placements[key];
    const geo = (ARCHETYPE_GEO[key] || ARCHETYPE_GEO.conifer)();
    geos[key] = geo;
    let mat = materials[key];
    if (!mat) { mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0.0, flatShading: true }); ownedMats.push(mat); }
    const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, list.length));
    inst.count = list.length;
    inst.castShadow = true; inst.receiveShadow = false; inst.frustumCulled = true; inst.raycast = () => {};
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, list.length) * 3), 3);
    const hs = key === 'rock' ? 1 : heightScale;   // trees grow taller; boulders stay proportioned
    for (let k = 0; k < list.length; k++) {
      const pl = list[k];
      _p.set(pl.x, pl.y, pl.z); _q.setFromAxisAngle(_yA, pl.r); _s.set(pl.s, pl.s * hs, pl.s);
      inst.setMatrixAt(k, _m.compose(_p, _q, _s));
      inst.setColorAt(k, _c.setScalar(pl.t));
    }
    inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
    inst.userData.type = key;
    group.add(inst);
  }
  return {
    group, colliders, placements, count,
    // dispose forest-OWNED materials only; a caller-supplied material (forge bark) is the caller's to free.
    dispose() { for (const k in geos) geos[k].dispose(); for (const m of ownedMats) m.dispose(); },
  };
}
