/* ============================================================
   @lgr/engine-core — createTreeKit (ARC A-TREEKIT, 2026-08-19): the modeled-forest ability.
   ------------------------------------------------------------
   Loads the Blender-pipeline conifer kit (tree_kit.glb — 4 variants from ONE parameterized
   generator, tools/blender/build_tree_kit.py) and instances it over EXISTING placements, with the
   arc's headline: PER-INSTANCE COLOUR VARIETY — the gap the Blender bounded proof recorded against
   the whole kit thesis ("kit equal to baseline but not better: no per-instance colour variety"),
   closed here as an engine seam every project inherits.

   THE DIVISION OF LABOUR (deliberate, and the reason placement is byte-identical across arms):
     · WHERE trees stand   — the caller's placer (moto-lab: generateScatter; hoard: placeForest).
                             This module NEVER places; it consumes {x,y,z,s,r} placements as-is,
                             so procedural-vs-kit is a pure ART A/B — same seed, same forest plan.
     · WHAT a tree is      — the GLB's variant meshes (one glTF primitive each: albedo×AO baked
                             into COLOR_0 by the generator, ONE material, ONE draw per variant).
     · WHICH variant WHERE — assignTreeVariants(): a seeded stream SEPARATE from the placer's RNG,
                             so variant choice cannot perturb positions (the placer's stream is
                             never consumed here — that separation IS the placement guarantee).
     · WHAT COLOUR         — makeTreeTints(): seeded hue/value jitter around the material base,
                             written as InstancedMesh.instanceColor (three multiplies it over the
                             vertex-colour albedo in the shader — zero per-frame cost).

   THE TINT MODEL (parameterized, receipted):  every instance gets
       w = rng·2−1                        the warm↔cool axis (which way this tree leans)
       v = lerp(value[0], value[1], rng)  the value jitter — the SAME 0.82..1.18 band the
                                          procedural forest's scalar tint used, so the kit arm
                                          brightens/darkens exactly as far as the control arm
       tint = HSL(w>0 ? warmHue : coolHue, sat·|w|, 0.5) · (v·2)
   At w=0 the saturation is 0 → a pure grey multiplier (value-only, the procedural behaviour);
   at |w|=1 it reaches the warm (amber-green) or cool (blue-green) pole. The mean over instances
   is neutral, so the FOREST keeps the authored albedo while every TREE is its own green.
   C++ anchor: a per-instance uniform-free colour multiplier — one vec3 in the instance buffer,
   read by gl_InstanceID; the CPU touches it once at build, never per frame (no-hot-alloc).

   Loading follows createBikeGlbMesh's shape (group now, content when ready, loud on failure) —
   but the FALLBACK differs by design: the bike degrades INSIDE (box bike), while a forest's
   procedural fallback is the caller's own placer-built group, so `ready` resolving 'failed'
   hands the decision back (moto-lab rebuilds the procedural trees, loudly). Contract:
     createTreeKit({ url, variants, type, sway }) -> { ready, mode, variants, counts,
                                 buildGroup(list, opts), tintReport(), dispose() }

   ── A-FLORA (2026-08-21): THE SAME SEAM NOW LOADS ANY KIT, NOT JUST THE CONIFERS ────────────────
   Two more kits came out of the Blender pipeline in the same shape as tree_kit.glb — one
   instanced, vertex-coloured, one-primitive mesh per named variant:
     broadleaf_kit.glb   4 broadleaf + 2 dead-snag variants (build_broadleaf_kit.py)
     groundcover_kit.glb 2 bushes + 2 ferns + 2 tufts + 2 boulders (build_groundcover_kit.py)
   Nothing about this module was conifer-specific EXCEPT two hard-coded constants: the variant
   NAME LIST and the `userData.type` stamp. Both are now parameters, so loading a second family is
   a call-site argument rather than a second loader. `variants` defaults to TREE_KIT_VARIANTS and
   `type` to 'tree', which is exactly what the two existing call sites (moto-lab, world-lab) pass
   implicitly — they are byte-identical, unchanged, untouched.

   WHY `type` HAD TO BECOME A PARAMETER, and this is not cosmetic: hashTreeInstances below counts
   every InstancedMesh whose userData.type === 'tree'. If a ground-cover kit stamped 'tree' too,
   moto-lab's placement-identity hash (e9de9e9 over 641 instances — the receipt that proves the
   forest did not move) would silently start including bushes and rocks, and the number that exists
   to catch a moved tree would change for a reason that has nothing to do with trees. A shared
   receipt is only trustworthy while the thing it counts stays defined.

   ON TINTING NON-FOLIAGE: makeTreeTints' hue poles are green by default. A boulder wants VALUE
   variety, not hue variety — pass `{ sat: 0 }`, which drives the model to its own w=0 special case
   (a pure grey multiplier) and gives rocks lighter/darker without turning any of them olive. That
   is a parameter that already existed, named here so the next caller finds it.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';   // the in-convention loader (moto.js/landmarks.js)
import { mulberry32 } from './citygen.js';
import { attachVertexAO } from './vector-style.js';

export const TREE_KIT_VARIANTS = ['tree_conifer_a', 'tree_conifer_b', 'tree_conifer_c', 'tree_conifer_d'];

/* A-FLORA's two families, as name lists a caller passes to `variants`. Split BROADLEAF from DEAD
   deliberately even though they ship in ONE glb: a forest wants broadleaves at canopy density and
   snags as a sparse accent, so the ratio is the CONSUMER's decision, not the file's. A caller that
   genuinely wants them mixed uniformly passes [...BROADLEAF, ...DEAD]. */
export const BROADLEAF_KIT_VARIANTS = ['tree_broadleaf_a', 'tree_broadleaf_b', 'tree_broadleaf_c', 'tree_broadleaf_d'];
export const DEAD_KIT_VARIANTS = ['tree_dead_a', 'tree_dead_b'];
/* Ground cover, split by family for the same reason — a hillside wants its own tuft:rock ratio,
   and `assignTreeVariants` distributes NEAR-UNIFORMLY across whatever list it is handed. Handing it
   all eight would put as many boulders on a lawn as grass tufts. */
export const GROUNDCOVER_BUSH_VARIANTS = ['gc_bush_a', 'gc_bush_b'];
export const GROUNDCOVER_FERN_VARIANTS = ['gc_fern_a', 'gc_fern_b'];
export const GROUNDCOVER_TUFT_VARIANTS = ['gc_tuft_a', 'gc_tuft_b'];
export const GROUNDCOVER_ROCK_VARIANTS = ['gc_rock_a', 'gc_rock_b'];

/* ---- WHICH VARIANT WHERE — pure, seeded, node-tested. A SEPARATE mulberry32 stream (the placer's
   RNG is never consumed → positions cannot move; Rule-15-style receipt: the A/B position hash).
   Returns a Uint8Array of variant indices, one per placement, near-uniform across variants. ---- */
export function assignTreeVariants(count, nVariants = 4, seed = 1) {
  const rng = mulberry32((seed ^ 0x7ce31a) >>> 0);
  const out = new Uint8Array(count);
  for (let i = 0; i < count; i++) out[i] = Math.min(nVariants - 1, (rng() * nVariants) | 0);
  return out;
}

/* ---- WHAT COLOUR — the per-instance tint stream (pure, seeded, node-tested; the headline).
   opts: { warmHue, coolHue, sat, value:[lo,hi] } — see the header's tint model. Returns
   { colors: Float32Array(count·3), report } where report carries the REALIZED ranges (not the
   requested ones): distinct count, w span, v span — the receipt the arc's proof (f) reads. ---- */
const _hsl = new THREE.Color();
export function makeTreeTints(count, seed = 1, { warmHue = 0.10, coolHue = 0.42, sat = 0.38, value = [0.82, 1.18] } = {}) {
  const rng = mulberry32((seed ^ 0x71a7) >>> 0);
  const colors = new Float32Array(count * 3);
  let wLo = Infinity, wHi = -Infinity, vLo = Infinity, vHi = -Infinity;
  const seen = new Set();
  for (let i = 0; i < count; i++) {
    const w = rng() * 2 - 1;
    const v = value[0] + rng() * (value[1] - value[0]);
    /* setHSL lands in the working (linear) colour space — the same space instanceColor multiplies
       in, and the same neutrality the procedural arm's grey scalar had. L=0.5 then ×(v·2): at
       sat 0 the channels are exactly v (pure value jitter — the control arm's whole behaviour). */
    _hsl.setHSL(w > 0 ? warmHue : coolHue, sat * Math.abs(w), 0.5).multiplyScalar(v * 2);
    colors[i * 3] = _hsl.r; colors[i * 3 + 1] = _hsl.g; colors[i * 3 + 2] = _hsl.b;
    wLo = Math.min(wLo, w); wHi = Math.max(wHi, w);
    vLo = Math.min(vLo, v); vHi = Math.max(vHi, v);
    if (seen.size < 4096) seen.add(`${_hsl.r.toFixed(4)},${_hsl.g.toFixed(4)},${_hsl.b.toFixed(4)}`);
  }
  return { colors, report: { n: count, distinct: seen.size, wRange: [wLo, wHi], vRange: [vLo, vHi], warmHue, coolHue, sat, value: [...value] } };
}

/* ---- THE PLACEMENT RECEIPT — an ORDER-INDEPENDENT hash over every rendered tree instance's
   position (the f32 translation actually in the GPU buffer, not the source array), so the
   procedural and kit arms can prove "same forest plan" against the THING ON SCREEN. Works on any
   root: it finds InstancedMesh children whose userData.type === 'tree' (the procedural scatter
   mesh and every kit variant mesh both carry it). Order-independent because the kit SPLITS one
   list across four meshes: per-instance FNV-1a hashes are SUMMED mod 2³², so grouping cannot
   change the answer, only a moved/added/lost tree can. ---- */
const _hm = new THREE.Matrix4();
export function hashTreeInstances(root) {
  const f32 = new Float32Array(3);
  const bytes = new Uint8Array(f32.buffer);
  let sum = 0, count = 0;
  root.traverse((o) => {
    if (!o.isInstancedMesh || o.userData.type !== 'tree') return;
    for (let k = 0; k < o.count; k++) {
      o.getMatrixAt(k, _hm);
      f32[0] = _hm.elements[12]; f32[1] = _hm.elements[13]; f32[2] = _hm.elements[14];
      let h = 0x811c9dc5;
      for (let b = 0; b < 12; b++) { h ^= bytes[b]; h = Math.imul(h, 0x01000193); }
      sum = (sum + (h >>> 0)) >>> 0;
      count++;
    }
  });
  return { hash: sum.toString(16), count };
}

export function createTreeKit({ url, variants = TREE_KIT_VARIANTS, type = 'tree', sway = true } = {}) {
  if (!url) throw new Error('createTreeKit: `url` is required — import it from \'@lgr/engine-core/assets/models/tree_kit.glb?url\' (the pedestrians.js rule: a ?url inside the lib would inline the asset into every bundle)');
  if (!Array.isArray(variants) || variants.length === 0) throw new Error('createTreeKit: `variants` must be a non-empty array of glTF node names — pass one of the exported *_VARIANTS lists, or omit it for the conifer kit');
  let mode = 'loading';
  const kit = [];                         // [{ name, geometry, material }] once loaded — kit-owned
  let pending = null;                     // the latest buildGroup call made before the GLB arrived
  let lastTints = null;                   // the most recent tint report + per-variant counts (receipts)

  const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(),
    _s = new THREE.Vector3(), _yA = new THREE.Vector3(0, 1, 0), _c = new THREE.Color();

  /* fill a group from placements — one InstancedMesh per variant (one draw each: the generator's
     one-primitive receipt is the other half of this promise). Same flags as buildScatterGroup —
     castShadow on, no raycast, frustum culling on — so the swap changes ART, not behaviour. */
  function populate(group, list, { seed = 1, tint = {} } = {}) {
    const which = assignTreeVariants(list.length, kit.length, seed);
    const { colors, report } = makeTreeTints(list.length, seed, tint);
    const perVariant = new Array(kit.length).fill(0);
    for (let i = 0; i < list.length; i++) perVariant[which[i]]++;
    const cursor = new Array(kit.length).fill(0);
    const meshes = kit.map((v, vi) => {
      const inst = new THREE.InstancedMesh(v.geometry, v.material, Math.max(1, perVariant[vi]));
      inst.count = perVariant[vi];
      inst.castShadow = true; inst.receiveShadow = false; inst.frustumCulled = true; inst.raycast = () => {};
      inst.userData.type = type;          // 'tree': hashTreeInstances + any 'tree' traversal finds both
                                          // arms. A non-foliage kit MUST pass its own (see the header).
      inst.userData.variant = v.name;
      inst.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, perVariant[vi]) * 3), 3);
      return inst;
    });
    for (let i = 0; i < list.length; i++) {
      const pl = list[i], vi = which[i], k = cursor[vi]++;
      /* position/yaw/scale are the PLACER's numbers verbatim (pl.t — the procedural arm's grey
         tint — is deliberately unread: the kit's own seeded stream owns colour now, value range
         matched, hue added; reading BOTH would double-darken). */
      _p.set(pl.x, pl.y, pl.z); _q.setFromAxisAngle(_yA, pl.r); _s.setScalar(pl.s);
      meshes[vi].setMatrixAt(k, _m.compose(_p, _q, _s));
      meshes[vi].setColorAt(k, _c.setRGB(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]));
    }
    for (const m of meshes) { m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true; group.add(m); }
    /* the receipt is cut from the REAL array that just went to the GPU, not re-derived */
    const sample = [];
    for (let i = 0; i < Math.min(16, list.length); i++) {
      sample.push([+colors[i * 3].toFixed(4), +colors[i * 3 + 1].toFixed(4), +colors[i * 3 + 2].toFixed(4)]);
    }
    lastTints = { ...report, sample, perVariant: kit.map((v, vi) => ({ name: v.name, count: perVariant[vi] })) };
  }

  const ready = new GLTFLoader().loadAsync(url).then((gltf) => {
    for (const name of variants) {
      const node = gltf.scene.getObjectByName(name);
      /* ALL of them or none — a partial kit means a broken regeneration; degrade whole, loudly
         (the createCrowdTiers.js:116 convention, the same shape createBikeGlbMesh uses). The
         messages name the URL rather than 'tree_kit.glb' now that three kits load through here —
         an error that names the wrong file sends the reader to the wrong generator. */
      if (!node || !node.isMesh) throw new Error(`${url} is missing variant '${name}' — re-run its generator under tools/blender/ and read the RECEIPT lines`);
      const material = node.material;
      if (!material.vertexColors) throw new Error(`${url} variant '${name}' arrived without vertex colours — the COLOR_0 (albedo×AO) bake is the kit's whole texture story; re-run the generator`);
      /* the house vegetation material seams, attached to the GLB's own material: beauty-tier aAo
         darkening is a bit-exact no-op here (no aAo attribute — documented safe), and the L94
         SWAY makes kit foliage breathe in any wind-driven room exactly like scatter props (the
         moto room drives no wind, so it stays byte-still there).
         A-FLORA: `sway` is a parameter now, defaulting TRUE so the conifer call sites compile the
         same program they did. It has to be, because this loader now also carries BOULDERS, and a
         boulder that breathes in the wind is not a boulder. The bug would have been invisible in
         moto-lab (no wind driven) and obvious in the first room that did — the worst kind. */
      attachVertexAO(material, { sway });
      kit.push({ name, geometry: node.geometry, material });
    }
    mode = 'kit';
    if (pending) { populate(pending.group, pending.list, pending.opts); pending = null; }
    return mode;
  }).catch((e) => {
    console.error('tree kit GLB failed to load — the caller keeps its procedural forest (the control arm becomes the ride):', e);
    mode = 'failed';
    pending = null;
    return mode;
  });

  return {
    ready,
    get mode() { return mode; },
    get variants() { return kit.map((v) => v.name); },
    /* Build a forest group from placements NOW. Before the GLB arrives the group returns empty
       and fills in place on ready (only the LATEST pre-ready call fills — a terrain rebuild
       replaces the plan, and the caller removed the old group anyway). userData.dispose frees
       ONLY the per-instance buffers (InstancedMesh.dispose — the L90 H13 lesson); geometry and
       materials are kit-owned and survive rebuilds — free them once, via kit.dispose(). */
    buildGroup(list, opts = {}) {
      const group = new THREE.Group();
      group.raycast = () => {};
      if (mode === 'kit') populate(group, list, opts);
      else if (mode === 'loading') pending = { group, list, opts };
      group.userData.dispose = () => group.traverse((o) => { if (o.isInstancedMesh) o.dispose(); });
      return group;
    },
    /* the colour-variety receipt (proof f): realized ranges + per-variant counts + up to 16
       sample tints cut from the LAST built group's own colour array (the GPU-bound bytes, not
       the request). null until a group has actually been populated — a receipt about nothing
       would be a lie with formatting. */
    tintReport() { return lastTints ? { ...lastTints } : null; },
    dispose() {
      for (const v of kit) { v.geometry.dispose(); v.material.dispose(); }
      kit.length = 0;
    },
  };
}
