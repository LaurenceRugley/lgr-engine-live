/* ============================================================
   @lgr/engine-core — createFacadeKit (ARC A-FACADE, 2026-08-22): the modelled-skyline ability.
   ------------------------------------------------------------
   Loads the Blender-pipeline facade kit (facade_kit.glb — 5 variants from ONE parameterized
   generator, tools/blender/build_facade_kit.py) so `createBoxArena` can draw a procedural
   skyline's BODY boxes as modelled buildings instead of unit cubes, while every collider, every
   guarantee and every anchor stays exactly the box it was.

   THE DIVISION OF LABOUR mirrors createTreeKit's, deliberately — one loader shape in this repo,
   not two (rule 6):
     · WHERE buildings stand — box-arena's own layout. This module NEVER places.
     · WHAT a building is    — the GLB's variant meshes (one glTF primitive each: slot albedo x
                               baked AO collapsed into COLOR_0, ONE material, ONE draw per variant).
     · WHICH variant WHERE   — assignFacadeVariants(): a pure function of the instance's own
                               HEIGHT, not of a random stream. That is the whole difference from
                               the tree kit and it is forced by the geometry (see below).
     · WHAT COLOUR           — NOT this module. box-arena already owns the per-instance tint (the
                               district palette x the height ramp) and writes it with setColorAt;
                               three multiplies it over COLOR_0 in the shader. Two owners of one
                               colour is the drift rule 6 forbids, and the kit is authored so the
                               existing tint lands right: `wall` is baked at 0.95, i.e. the box
                               arm's brightness to within 5%, and only the WINDOWS subtract light.

   ── WHY VARIANT CHOICE IS DETERMINISTIC IN HEIGHT AND NOT A SEEDED ROLL ───────────────────────
   A tree is scaled uniformly, so any variant fits any placement and a random pick is the right
   pick. A building is NOT: box-arena scales its unit box per instance, and the measured spread in
   projects/swing-lab's city (?level=city, seed 11, 19x19, 892 body boxes) is

       plan aspect max(w,d)/min(w,d) = 1.000 for 892/892   — every body box is SQUARE IN PLAN,
                                                             so X and Z always scale EQUALLY and
                                                             there is NO horizontal stretch at all
       height h = 0.679 .. 4.620 u                          — a 6.81x span, the ONE axis that
                                                             distorts a modelled facade

   So the kit is a HEIGHT-BAND family: variant k bakes `courses[k]` storey courses into a UNIT
   height, and an instance takes the variant whose target height (courses x storey) is nearest its
   own IN LOG SPACE — log, because what the eye reads is the RATIO by which a storey got stretched,
   and a linear nearest-rung would hand every error to the short stock.
   The residual is a y-scale error and the acceptance band is this repo's own: box-arena.js's
   `facadeVary` note calls +/-22% "the band where buildings stop sharing a floor plan and stay the
   same CITY" and +/-50% "storeys a person could not stand up in". `facadeFitReport` measures the
   realized error against the caller's real heights so the claim is a number, never a hope.

   C++ anchor: `assignFacadeVariants` is a nearest-neighbour lookup into a tiny sorted table —
   `std::lower_bound` over five doubles, run once at level build, never per frame (no-hot-alloc).

   Loading follows createTreeKit's shape (group now, content when ready, loud on failure). The
   FALLBACK is the honest one for this consumer: `mode` goes 'failed' and box-arena keeps drawing
   its cubes, which is exactly the control arm — a city that is less pretty, never a city that is
   missing.  Contract:
     createFacadeKit({ url, variants, courses, storey, material })
       -> { ready, mode, variants, parts, kinds, targets, assign(heights), fit(heights), dispose() }
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';   // the in-convention loader (moto.js/landmarks.js)

/* The shipped kit. NAMES CARRY THEIR COURSE COUNT because that is the only thing a variant is —
   every variant is authored at unit height, so the course count is its entire geometry, and a
   rung hidden behind a letter is a rung nobody can check against the generator. */
export const FACADE_KIT_VARIANTS = ['facade_c2', 'facade_c3', 'facade_c4', 'facade_c6', 'facade_c8'];
export const FACADE_KIT_COURSES = [2, 3, 4, 6, 8];
/* The box kinds a facade may replace: the building BODIES. Everything else box-arena emits —
   cornices, parapets, roof plant, water towers, masts, spires, signs, skybridges — stays a box,
   and that is not a shortcut. A spire's aspect reaches 21.6 in the measured city; it is a thin
   vertical stick, not a facade, and the silhouette vocabulary A-SKYLINE/A-DRESS measured its
   +63% net ground from is made of exactly those boxes. */
export const FACADE_BODY_KINDS = ['tower', 'setback'];

/* ---- THE STOREY HEIGHT IS A PROPERTY OF THE ROOM, NOT OF THIS MODULE, so it is derived here and
   passed in rather than hard-coded. A room whose towers wear a triplanar facade already HAS a
   storey rhythm — the painted one — and modelled bands at a different pitch would beat against it,
   two representations of one thing. Feed this the same three numbers the material was built from:

     storeyU({ metresPerUnit: 6, worldSize: 8, tilesPerTile: 0.55, storeysPerTile: 5 }) = 0.48485 u

   which is `1 / (tilesPerUnit(...) * storeysPerTile)` — tilesPerUnit being triplanar-forge's own
   exported arithmetic, restated here in the one line that inverts it so a caller does not have to
   import a material module to size a mesh. A room with no painted facade passes its own number. */
export function storeyU({ metresPerUnit = 1, worldSize = 1, tilesPerTile = 1, storeysPerTile = 1 } = {}) {
  const tpu = (metresPerUnit / worldSize) * tilesPerTile;
  if (!(tpu > 0) || !(storeysPerTile > 0)) throw new Error('storeyU: metresPerUnit/worldSize/tilesPerTile/storeysPerTile must all be > 0');
  return 1 / (tpu * storeysPerTile);
}

/* ---- WHICH VARIANT WHERE — pure, node-tested, and a function of HEIGHT alone (see the header).
   `heights` is any array-like of per-instance heights in world units; returns a Uint8Array of
   variant indices. Nearest rung in LOG space: |ln(h / target_k)| minimised. */
export function assignFacadeVariants(heights, { courses = FACADE_KIT_COURSES, storey = 1 } = {}) {
  const targets = courses.map((c) => c * storey);
  const out = new Uint8Array(heights.length);
  for (let i = 0; i < heights.length; i++) {
    const h = heights[i];
    let best = 0, bestE = Infinity;
    for (let k = 0; k < targets.length; k++) {
      const e = Math.abs(Math.log(h / targets[k]));
      if (e < bestE) { bestE = e; best = k; }
    }
    out[i] = best;
  }
  return out;
}

/* ---- THE FIT RECEIPT. `assignFacadeVariants` decides; this MEASURES what that decision costs, in
   the units the acceptance band is stated in (|1 - yScale|, i.e. how far a storey got stretched).
   Reported, not asserted, because the honest number for a given room is the room's own: a kit that
   covers this city may leave a different one's tall stock outside the band, and a caller that
   cannot see that would ship a smear it never measured. `over` counts the instances outside
   `band`; `perVariant` proves no variant is a wasted draw call. */
export function facadeFitReport(heights, { courses = FACADE_KIT_COURSES, storey = 1, band = 0.22 } = {}) {
  const targets = courses.map((c) => c * storey);
  const which = assignFacadeVariants(heights, { courses, storey });
  const perVariant = new Array(courses.length).fill(0);
  const errs = new Float64Array(heights.length);
  let over = 0;
  for (let i = 0; i < heights.length; i++) {
    perVariant[which[i]]++;
    const e = Math.abs(1 - heights[i] / targets[which[i]]);
    errs[i] = e;
    if (e > band) over++;
  }
  errs.sort();
  const q = (p) => (errs.length ? errs[Math.min(errs.length - 1, Math.max(0, Math.floor(p * errs.length)))] : 0);
  return {
    n: heights.length, storey, courses: [...courses], targets,
    perVariant, band, over,
    p50: q(0.5), p90: q(0.9), max: errs.length ? errs[errs.length - 1] : 0,
  };
}

export function createFacadeKit({
  url, variants = FACADE_KIT_VARIANTS, courses = FACADE_KIT_COURSES,
  storey = 1, kinds = FACADE_BODY_KINDS, material = null,
  /* A-LITWINDOWS (2026-08-22): an optional `createLitWindows` handle. null (the default) = not one
     statement of the night path runs and the kit is exactly what A-FACADE shipped. Given one, each
     variant's material is patched with THAT VARIANT'S course count, because the row index that puts
     one lit-window hash per glazing band is `floor(localY * courses)` and facade_c8 has eight bands
     where facade_c2 has two. The kit is the only thing that knows which material belongs to which
     rung, which is why the wiring lives here and the ABILITY lives in lit-windows.js. */
  litWindows = null,
} = {}) {
  if (!url) throw new Error('createFacadeKit: `url` is required — import it from \'@lgr/engine-core/assets/models/facade_kit.glb?url\' (the pedestrians.js rule: a ?url inside the lib would inline the asset into every bundle)');
  if (!Array.isArray(variants) || !variants.length) throw new Error('createFacadeKit: `variants` must be a non-empty array of glTF node names');
  if (variants.length !== courses.length) throw new Error(`createFacadeKit: variants (${variants.length}) and courses (${courses.length}) must line up — variant k IS courses[k] baked into unit height`);
  if (!(storey > 0)) throw new Error('createFacadeKit: `storey` must be > 0 — derive it with storeyU() from the room\'s own facade material, or pass the room\'s own floor height');

  let mode = 'loading';
  const parts = [];                 // [{ name, geometry, material }] once loaded — kit-owned
  /* The GLB's OWN materials, kept beside `parts` rather than only inside it: when the caller
     supplies a material, `parts[i].material` is overwritten with the shared clone and the five
     originals would otherwise have no owner and never be disposed (found by an adversarial pass,
     2026-08-22). They are GLB-created, so they are ours to free. */
  const srcMats = [];
  /* A-LITWINDOWS: was ONE shared clone; now one clone PER VARIANT, because `litWindows` needs a
     per-variant uniform (the course count) and a uniform is a property of a material. Five
     materials instead of one costs ZERO extra draw calls — box-arena already draws one
     InstancedMesh per variant — and they share ONE compiled program, because every patch on them
     carries the same `customProgramCacheKey`. This is citygen's existing arrangement (a
     vectorizeTower material per building, all keyed 'lgr-vec-tower'), not a new one. */
  const ownedMats = [];             // the per-variant clones, when the caller supplied a material

  const ready = new GLTFLoader().loadAsync(url).then((gltf) => {
    for (const name of variants) {
      const node = gltf.scene.getObjectByName(name);
      /* ALL of them or none — a partial kit means a broken regeneration; degrade whole, loudly
         (the createCrowdTiers.js convention, the same shape createTreeKit uses). */
      if (!node || !node.isMesh) throw new Error(`${url} is missing variant '${name}' — re-run tools/blender/build_facade_kit.py and read the RECEIPT lines`);
      if (!node.material.vertexColors) throw new Error(`${url} variant '${name}' arrived without vertex colours — the COLOR_0 (albedo x AO) bake is the kit's whole texture story; re-run the generator`);
      /* THE UNIT-CUBE CONTRACT, RE-CHECKED AT THE CONSUMER. The generator gates it too, but the
         GLB is a build product that can go stale against a script, and the failure it would cause
         here is the worst kind: every building in the city silently off its own collider by a
         hair. Cheap to check, impossible to notice otherwise. */
      node.geometry.computeBoundingBox();
      const bb = node.geometry.boundingBox;
      const off = Math.max(Math.abs(bb.min.x + 0.5), Math.abs(bb.max.x - 0.5), Math.abs(bb.min.z + 0.5),
        Math.abs(bb.max.z - 0.5), Math.abs(bb.min.y), Math.abs(bb.max.y - 1));
      if (off > 1e-3) throw new Error(`${url} variant '${name}' is not the unit cube (x/z -0.5..0.5, y 0..1) — off by ${off.toFixed(4)}. The runtime scales it by (w, h, d) straight off the collider AABB, so a drifted variant puts every building slightly off its own collider. Re-run the generator.`);
      parts.push({ name, geometry: node.geometry, material: node.material });
      srcMats.push(node.material);
    }
    /* THE MATERIAL, and the choice is the caller's because the LOOK is the room's. With one
       supplied (swing-lab hands over its triplanar forge facade) it is cloned ONCE and shared by
       all five meshes with `vertexColors` on, so the modelled relief wears the same world-space
       texture the cubes wore — the texture never stretches because it is sampled by position, and
       the kit's baked albedo x AO multiplies over it. With none, each variant keeps its own GLB
       material, which is the flat vertex-coloured look and needs no renderer to exist. */
    if (material) {
      for (const p of parts) {
        const m = material.clone();
        m.vertexColors = true;
        ownedMats.push(m);
        p.material = m;
      }
    }
    /* THE NIGHT PATCH GOES ON LAST, so it chains over whatever the material already carried rather
       than being overwritten by it. `parts[k]` is `variants[k]` is `courses[k]` — the three lists
       are index-locked by the constructor's own length check, so the rung handed to each material
       is that material's own. */
    if (litWindows) parts.forEach((p, k) => litWindows.apply(p.material, { courses: courses[k] }));
    mode = 'kit';
    return mode;
  }).catch((e) => {
    console.error('facade kit GLB failed to load — the arena keeps its boxes (the control arm becomes the ride):', e);
    /* DEGRADE WHOLE, INCLUDING THE BOOKKEEPING. A throw partway through the variant loop used to
       leave the already-collected parts in place: `mode` said 'failed' while `variants` still
       listed the two that had loaded, and their geometries were never freed (adversarial pass,
       2026-08-22). A half-kit is not a kit — free what was collected and report nothing, so a
       consumer reading `variants` cannot be told a different story from the one `mode` tells. */
    for (const p of parts) p.geometry.dispose();
    for (const m of srcMats) m.dispose();
    for (const m of ownedMats) m.dispose();     // A-LITWINDOWS: the per-variant clones are ours too
    parts.length = 0; srcMats.length = 0; ownedMats.length = 0;
    mode = 'failed';
    return mode;
  });

  return {
    ready,
    get mode() { return mode; },
    get variants() { return parts.map((p) => p.name); },
    get parts() { return parts; },
    kinds,
    courses: [...courses],
    storey,
    targets: courses.map((c) => c * storey),
    assign: (heights) => assignFacadeVariants(heights, { courses, storey }),
    fit: (heights, opts) => facadeFitReport(heights, { courses, storey, ...opts }),
    dispose() {
      /* Geometry and the GLB's OWN materials are ours and are freed here, whether or not a
         caller-supplied clone replaced them on `parts` — that replacement is why `srcMats` exists.
         The clone is ours too. A caller-supplied `material` is the CALLER's and is never disposed
         from in here (the createTreeKit ownership rule). Idempotent: the lists are emptied, so a
         second call is a no-op rather than a double-free. */
      for (const p of parts) p.geometry.dispose();
      for (const m of srcMats) if (m !== material) m.dispose();
      for (const m of ownedMats) m.dispose();
      parts.length = 0; srcMats.length = 0; ownedMats.length = 0;
    },
  };
}
