/* ============================================================
   scatter.js — Lesson 65: BIOME-KEYED WORLD SCATTER (Arc 2 of the world-builder).
   ------------------------------------------------------------
   L64 generated bare terrain. This makes it feel INHABITED — forests of trees, rocks on the hills +
   beaches, sparse plains — so "grassland, trees, land with a lake" reads true. The terrain heightfield
   (the L64 source of truth) is READ here, never re-derived: scatter samples the same `height`/`biome`
   buffers the terrain mesh was built from, so every prop sits exactly on the surface.

   THE PLACEMENT ALGORITHM — JITTERED-GRID rejection sampling (cheap blue-noise-ish):
   walk a grid over the terrain; at each cell perturb the sample point a little (jitter → no rigid rows);
   read the biome + height + SLOPE there; then REJECT the candidate if it's underwater, too steep, or
   loses the biome's density dice-roll. What survives is a placement (position + a random scale/rotation/
   tint). Deterministic — seeded by mulberry32, so a world's scatter is byte-identical on reroll-to-seed.
   C++ anchors: rejection sampling on a perturbed lattice; SLOPE = the gradient magnitude of the
   heightfield (central differences, like a Sobel) — flat ground passes, cliffs reject.

   THE RENDER — `InstancedMesh`: one geometry + one material drawn N times with N per-instance transforms
   in ONE draw call (GPU instancing; the matrix is a per-instance attribute, not a uniform — like
   `glDrawElementsInstanced`). Thousands of trees = one draw call. A per-instance COLOUR multiplies the
   prop's vertex colours for subtle variety (no two trees the exact same green). Flat-shaded to match the
   faceted terrain. C++: upload an instance-matrix buffer once; the vertex shader indexes it by gl_InstanceID.
   ============================================================ */
import * as THREE from 'three';
import { mulberry32 } from './citygen.js';
import { attachVertexAO } from './vector-style.js';   // L80: beauty-tier baked vertex AO (seats props on the ground)

/* ---- SCATTER TABLE — data-driven, keyed by biome KEY (from terrain.js BIOMES). Each biome lists the
   props that grow there with a per-cell `density` (placement probability) + a `maxSlope` (reject steeper
   ground, in world-Y per world-X). ocean + snow get nothing. Extend this table to add props/biomes. ---- */
const SCATTER_TABLE = {
  beach:     [{ type: 'rock', density: 0.05, maxSlope: 1.4 }],
  grassland: [{ type: 'tree', density: 0.10, maxSlope: 0.7 }, { type: 'tuft', density: 0.30, maxSlope: 0.9 }],
  forest:    [{ type: 'tree', density: 0.62, maxSlope: 0.8 }, { type: 'rock', density: 0.03, maxSlope: 1.2 }],
  hills:     [{ type: 'tree', density: 0.14, maxSlope: 0.7 }, { type: 'rock', density: 0.16, maxSlope: 1.6 }],
  rock:      [{ type: 'rock', density: 0.22, maxSlope: 2.0 }],
};

/* ============================================================================================
   generateScatter({ terrain, seed, worldSize, baseY }) → { placements: { tree:[], rock:[], tuft:[] }, counts }
   Each placement = { x, y, z, s (scale), r (yaw), t (tint 0..1) }. World mapping MATCHES buildTerrainMesh
   (so props land on the surface): cell = worldSize/(size-1), wy(h) = baseY + (h-sea)*relief.
   ============================================================================================ */
export function generateScatter({ terrain, seed = 1, worldSize = 26, baseY = 0, biomeKeys, density = 1, max = 9000 } = {}) {
  const { size, height, biome, sea, relief } = terrain;
  const rng = mulberry32((seed ^ 0x5ca77e8) >>> 0);
  const cell = worldSize / (size - 1), half = worldSize / 2;
  const wy = (h) => baseY + (h - sea) * relief;
  // central-difference slope (world-Y per world-unit) at grid (i,j), clamped to the interior.
  const slopeAt = (i, j) => {
    const i0 = Math.max(1, Math.min(size - 2, i)), j0 = Math.max(1, Math.min(size - 2, j));
    const dx = (height[j0 * size + i0 + 1] - height[j0 * size + i0 - 1]) * relief / (2 * cell);
    const dz = (height[(j0 + 1) * size + i0] - height[(j0 - 1) * size + i0]) * relief / (2 * cell);
    return Math.hypot(dx, dz);
  };
  const placements = { tree: [], rock: [], tuft: [] };
  const STRIDE = 2;                                   // sample every other cell → ~6.4k candidates at size 160
  for (let j = 1; j < size - 1; j += STRIDE) {
    for (let i = 1; i < size - 1; i += STRIDE) {
      const idx = j * size + i;
      const h = height[idx];
      if (h < sea + 0.005) continue;                  // underwater → nothing (water rejection)
      const key = biomeKeys[biome[idx]];
      const rules = SCATTER_TABLE[key];
      if (!rules) continue;                           // ocean / snow → nothing
      const slope = slopeAt(i, j);
      for (const rule of rules) {
        // one die per rule (consume RNG in a fixed order → determinism), gated by slope + density.
        const roll = rng();
        if (slope > rule.maxSlope) continue;
        if (roll > rule.density * density) continue;
        const arr = placements[rule.type];
        if (arr.length >= max) continue;
        // jitter within the cell, look the height back up at the jittered cell for a snug sit
        const jx = (rng() - 0.5) * cell * STRIDE, jz = (rng() - 0.5) * cell * STRIDE;
        const x = i * cell - half + jx, z = j * cell - half + jz;
        arr.push({ x, y: wy(h), z, s: 0.7 + rng() * 0.6, r: rng() * Math.PI * 2, t: 0.82 + rng() * 0.36 });
      }
    }
  }
  return { placements, counts: { tree: placements.tree.length, rock: placements.rock.length, tuft: placements.tuft.length } };
}

/* ---- LOW-POLY STYLIZED PROP GEOMETRIES (flat-shaded, vertex-coloured) — built once, instanced N times.
   Each is NON-INDEXED with a baked vertex colour so trunk+canopy read in one mesh; the material's
   flatShading derives a flat normal per face (the faceted look that matches the terrain). ---- */
function paint(geo, hex) {                            // give a geometry a flat per-vertex colour + baked base-AO
  const c = new THREE.Color(hex), n = geo.attributes.position.count;
  const col = new Float32Array(n * 3), ao = new Float32Array(n), py = geo.attributes.position.array;
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    // L80 baked CONTACT AO: darken the bottom ~0.55 units so the prop seats on the ground instead of floating
    // (beauty tier multiplies it in; stylized tiers gate it to 0). The shader clamps; keep it gentle here.
    ao[i] = Math.min(0.45, Math.max(0, 0.42 * (1 - py[i * 3 + 1] / 0.55)));
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
  return geo;
}
function mergePositions(geos) {                       // concat a few non-indexed geometries (pos+normal+color+aAo)
  let n = 0; for (const g of geos) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), ao = new Float32Array(n);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    if (g.attributes.aAo) ao.set(g.attributes.aAo.array, o);   // L80: carry the baked base-AO through the merge
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aAo', new THREE.BufferAttribute(ao, 1));
  return out;
}
function makeTreeGeo() {
  // trunk: a short cylinder (origin at its base, y=0 = ground); canopy: 1–2 stacked cones above it.
  const trunk = paint(new THREE.CylinderGeometry(0.045, 0.06, 0.34, 6).translate(0, 0.17, 0).toNonIndexed(), '#5b3f28');
  const c1 = paint(new THREE.ConeGeometry(0.30, 0.55, 7).translate(0, 0.55, 0).toNonIndexed(), '#3f7d3a');
  const c2 = paint(new THREE.ConeGeometry(0.22, 0.42, 7).translate(0, 0.85, 0).toNonIndexed(), '#4f9046');
  return mergePositions([trunk, c1, c2]);
}
function makeRockGeo() {
  // a low-poly boulder: an icosahedron with deterministically jittered verts → a faceted rock. Origin at
  // centre; placed slightly sunk into the ground. One shared shape; per-instance rotation gives variety.
  const g = new THREE.IcosahedronGeometry(0.18, 0).toNonIndexed();
  const p = g.attributes.position, r = mulberry32(0x0c1a);
  for (let i = 0; i < p.count; i++) { const k = 0.78 + r() * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k); }
  g.computeVertexNormals();
  return paint(g, '#7d7468');
}
function makeTuftGeo() {
  // a tiny low grass tuft: a squat 4-sided cone, light green. Cheap "ground cover" in grassland.
  return paint(new THREE.ConeGeometry(0.06, 0.16, 4).translate(0, 0.08, 0).toNonIndexed(), '#6f9a4e');
}

/* ============================================================================================
   buildScatterGroup(placements) → a THREE.Group of one InstancedMesh PER prop type. Per-instance matrix
   (position + yaw + scale) and a per-instance COLOUR (a slight tint that multiplies the vertex colours).
   ============================================================================================ */
const SCATTER_TYPES = ['tree', 'rock', 'tuft'];
const Y_OFF = { tree: 0, rock: -0.05, tuft: 0 };              // sink rocks a touch into the ground
const _gm = new THREE.Matrix4(), _gq = new THREE.Quaternion(), _gp = new THREE.Vector3(), _gs = new THREE.Vector3(), _gyA = new THREE.Vector3(0, 1, 0), _gc = new THREE.Color();

/* L72 — the scatter group is now a MUTABLE, CAPACITY-BACKED store (a `std::vector` over a GPU buffer): each
   type's InstancedMesh is allocated with CAPACITY ≥ the generated count, and a live `count` says how many slots
   draw. Painting appends (grow 2× when full), erasing swap-removes — one draw call per type throughout. We
   ALWAYS create all 3 type meshes (even empty) so the object brush can plant a type a world generated none of. */
export function buildScatterGroup(placements) {
  const group = new THREE.Group();
  group.raycast = () => {};
  const GEO = { tree: makeTreeGeo(), rock: makeRockGeo(), tuft: makeTuftGeo() };
  for (const type of SCATTER_TYPES) {
    const list = placements[type] || (placements[type] = []);
    const cap = Math.max(list.length * 2, 512);              // spare capacity for hand-painting
    const mat = attachVertexAO(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0.0, flatShading: true }), { sway: true });   // L80 beauty AO + L94 ambient sway (foliage breathes; terrain attaches the same helper WITHOUT sway so the ground stays put)
    const inst = new THREE.InstancedMesh(GEO[type], mat, cap);
    inst.count = list.length;                                // only the filled slots draw
    inst.castShadow = true; inst.receiveShadow = false; inst.frustumCulled = true; inst.raycast = () => {};
    inst.userData.type = type;
    inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
    for (let k = 0; k < list.length; k++) writeInstance(inst, k, list[k], Y_OFF[type]);
    inst.instanceMatrix.needsUpdate = true; inst.instanceColor.needsUpdate = true;
    group.add(inst);
  }
  group.userData.placements = placements;                     // the persistent source-of-truth list (L70 reproject + L72 paint)
  group.userData.yoff = Y_OFF;
  group.userData.dispose = () => group.traverse((o) => { if (o.isInstancedMesh) { o.geometry.dispose(); o.material.dispose(); } });
  return group;
}

/* write one placement {x,y,z,s,r,t} into instance slot k (matrix + colour tint). */
function writeInstance(inst, k, pl, yoff) {
  _gp.set(pl.x, pl.y + (yoff || 0), pl.z); _gq.setFromAxisAngle(_gyA, pl.r); _gs.setScalar(pl.s);
  inst.setMatrixAt(k, _gm.compose(_gp, _gq, _gs));
  inst.setColorAt(k, _gc.setScalar(pl.t));
}
const meshOf = (group, type) => group.children.find((c) => c.isInstancedMesh && c.userData.type === type);

/* grow an InstancedMesh 2× (realloc + copy the live instances) — geometry + material are REUSED. Amortised O(1). */
function growMesh(group, mesh) {
  const newCap = mesh.instanceMatrix.count * 2;
  const n = new THREE.InstancedMesh(mesh.geometry, mesh.material, newCap);
  n.count = mesh.count; n.castShadow = true; n.receiveShadow = false; n.frustumCulled = true; n.raycast = () => {};
  n.userData.type = mesh.userData.type;
  n.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(newCap * 3), 3);
  n.instanceMatrix.array.set(mesh.instanceMatrix.array.subarray(0, mesh.count * 16));
  n.instanceColor.array.set(mesh.instanceColor.array.subarray(0, mesh.count * 3));
  n.instanceMatrix.needsUpdate = true; n.instanceColor.needsUpdate = true;
  group.remove(mesh);
  // L90 H13: free the OLD InstancedMesh's instance buffers (instanceMatrix + instanceColor) on grow — they
  // were leaking each doubling during the paint demo. InstancedMesh.dispose() releases ONLY the instance
  // attributes; the geometry + material are SHARED with `n` (line above) and correctly persist.
  mesh.dispose();
  group.add(n);
  return n;
}

/* L72 ADD — append one prop (the density brush calls this per candidate). Grows the mesh when full. */
export function scatterAdd(group, type, x, y, z, scale, yaw, tint) {
  let mesh = meshOf(group, type); if (!mesh) return false;
  const list = group.userData.placements[type];
  if (list.length >= mesh.instanceMatrix.count) mesh = growMesh(group, mesh);   // capacity exceeded → double
  const k = list.length;
  list.push({ x, y, z, s: scale, r: yaw, t: tint });
  writeInstance(mesh, k, list[k], (group.userData.yoff || {})[type] || 0);
  mesh.count = list.length;
  mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
  return true;
}

/* L72 ERASE — swap-remove every prop within `radius` of (cx,cz) (O(1) each: copy the last instance into the
   hole, pop the list, decrement count). `type` = 'tree'|'rock'|'tuft'|'all'. Returns how many were erased. */
export function scatterErase(group, type, cx, cz, radius) {
  const types = type === 'all' ? SCATTER_TYPES : [type];
  const r2 = radius * radius; let erased = 0;
  for (const t of types) {
    const mesh = meshOf(group, t); if (!mesh) continue;
    const list = group.userData.placements[t];
    const mArr = mesh.instanceMatrix.array, cArr = mesh.instanceColor && mesh.instanceColor.array;
    for (let k = list.length - 1; k >= 0; k--) {
      const pl = list[k];
      if ((pl.x - cx) * (pl.x - cx) + (pl.z - cz) * (pl.z - cz) > r2) continue;
      const last = list.length - 1;
      if (k !== last) {                                      // copy the last instance into the hole
        list[k] = list[last];
        for (let j = 0; j < 16; j++) mArr[k * 16 + j] = mArr[last * 16 + j];
        if (cArr) for (let j = 0; j < 3; j++) cArr[k * 3 + j] = cArr[last * 3 + j];
      }
      list.pop(); erased++;
    }
    mesh.count = list.length;
    mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  return erased;
}

/* L70 — RE-PROJECT the scatter onto the (sculpted) terrain: for each instance, resample the heightfield at
   its (x,z) and rewrite its instance-matrix y so trees/rocks RIDE the new surface instead of being buried by
   a raised mound or left floating over a dug pit (the "bald-mesa" fix). Instances pushed UNDERWATER (now below
   the sea cut) or onto a now-too-steep slope are CULLED (scaled to 0) — which also lets a freshly-dug pool show
   through the canopy. A scatter/gather over the instance arrays; cheap (~thousands of writes), run debounced. */
export const SLOPE_BY_TYPE = { tree: 0.85, rock: 2.0, tuft: 0.95 };
export function reprojectScatter(group, terrain, { worldSize = 26, baseY = 0 } = {}) {
  const placements = group.userData.placements, yoff = group.userData.yoff || {};
  if (!placements) return;
  const { size, height, sea, relief } = terrain;
  const cell = worldSize / (size - 1), half = worldSize / 2;
  const clampI = (i) => (i < 0 ? 0 : i >= size ? size - 1 : i);
  const sampleH = (x, z) => height[clampI(Math.round((z + half) / cell)) * size + clampI(Math.round((x + half) / cell))];
  const slopeAt = (x, z) => {
    const i = Math.max(1, Math.min(size - 2, Math.round((x + half) / cell)));
    const j = Math.max(1, Math.min(size - 2, Math.round((z + half) / cell)));
    const dx = (height[j * size + i + 1] - height[j * size + i - 1]) * relief / (2 * cell);
    const dz = (height[(j + 1) * size + i] - height[(j - 1) * size + i]) * relief / (2 * cell);
    return Math.hypot(dx, dz);
  };
  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _yA = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();
  for (const inst of group.children) {
    const type = inst.userData.type, list = placements[type];
    if (!list || !inst.isInstancedMesh) continue;
    const maxSlope = SLOPE_BY_TYPE[type] ?? 1.5;
    const cap = inst.instanceMatrix.count;
    const n = Math.min(list.length, cap);                  // capacity-safe (grows only on add; this never exceeds)
    inst.count = n;                                          // L72: live count tracks the (possibly undo-restored) list
    for (let k = 0; k < n; k++) {
      const pl = list[k];
      const h = sampleH(pl.x, pl.z);
      const cull = h < sea + 0.005 || slopeAt(pl.x, pl.z) > maxSlope;   // underwater / too steep → hide
      _p.set(pl.x, baseY + (h - sea) * relief + (yoff[type] || 0), pl.z);
      _q.setFromAxisAngle(_yA, pl.r);
      _s.setScalar(cull ? 0 : pl.s);
      _m.compose(_p, _q, _s);
      inst.setMatrixAt(k, _m);
      inst.setColorAt(k, _c.setScalar(pl.t));               // L72: re-derive tint too, so undo-restore repaints exactly
    }
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  }
}

/* Convenience used by the world mode: generate + build in one call (same seed → identical scatter). */
export function createScatter({ terrain, seed, worldSize, baseY, biomeKeys, density, max }) {
  const { placements, counts } = generateScatter({ terrain, seed, worldSize, baseY, biomeKeys, density, max });
  const group = buildScatterGroup(placements);
  group.userData.counts = counts;
  return group;
}
