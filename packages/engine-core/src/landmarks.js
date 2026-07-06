/* ============================================================
   landmarks.js — Lesson 12: GLTF landmarks — real models enter the pipeline.
   ------------------------------------------------------------
   Every building so far has been a procedural BOX. This lesson loads real modeled
   buildings (Kenney's CC0 City Kit — see assets/models/CREDITS.md) and makes them
   flow through EVERY system we've built: the flat-vector style, day/night, night
   windows, the post passes. That turns "our district in John's style" into "ANY
   city in any style" — the multi-city ambition (NY / Paris / London / …) starts here.

   GLTF — "the JPEG of 3D". A glTF file (`.gltf` JSON, or `.glb` binary) is a STANDARD
   scene container: meshes + materials + a node hierarchy, in one portable package.
   LOADING it is easy (a few lines). ADOPTION is the real lesson: an imported asset
   arrives with its OWN materials and scale, and looks pasted-in unless we make it
   inherit our art direction. So three steps per model: LOAD → NORMALIZE → ADOPT.

   C++ ANALOGIES (Laurence learns via C++ anchors):
   - `loadAsync` returns a Promise ≈ a `std::future<GLTF>` — you `await` it like
     `future.get()`, but non-blocking (the event loop runs other frames meanwhile).
   - The glTF scene graph ≈ a tree of `unique_ptr<Node>` you own and must walk
     (`traverse` = a recursive visitor over that tree).
   - `GLTFLoader` lives in `three/addons`, not the core — like a header-only helper
     you include separately from the main library (`#include <three/addons/...>`).
   - DRACO / KTX2 (mesh + texture compression) ≈ zlib for geometry / a GPU-native
     image codec. We DON'T wire them here (these models are tiny); you'd add them when
     a city has hundreds of MB of assets and download size starts to hurt.
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { vectorizeTower } from './vector-style.js';
import { ICONIC_KEYS, ICONIC_HEIGHT, buildIconic } from './landmarks-iconic.js';

// `?url` asks Vite to treat the .glb as a static ASSET: it copies the file into the build
// output (dist/assets, content-hashed for caching) and hands us back the final URL string —
// the "asset pipeline". This works the same in dev and in the production build. (Importing
// it without `?url` would try to PARSE the binary as a module and fail.)
import skyscraperUrl from '../assets/models/building-skyscraper-d.glb?url';
import midriseUrl    from '../assets/models/building-n.glb?url';
import setbackUrl    from '../assets/models/building-g.glb?url';
// The kit's GLBs reference a SHARED palette atlas by relative path ("Textures/colormap.png").
// Our `?url` build serves each GLB from a hashed path, so that relative lookup 404s. We import
// the atlas as its own asset and redirect the loader to it (below) — the texture gives lit
// mode the kit's baked colours; vector mode overrides colour anyway. (C++ analogy: a
// LoadingManager URL modifier ≈ a custom resolver hook in front of every file open.)
import colormapUrl   from '../assets/models/colormap.png?url';

/* Model KEY → url + a sensible placeholder flat-vector body colour + a fill factor (how much
   of the slot height to occupy). L13 makes landmarks a FACTORY: load each GLB ONCE, then on
   every city (re)generation CLONE the cached prototype into a slot. (Lesson 14 swaps these
   Kenney placeholders for procedurally-built iconic landmarks — the slot API stays the same.) */
const MODELS = {
  skyscraper: { url: skyscraperUrl, color: '#9cc1dd', fill: 0.92 },  // glass hero tower
  midrise:    { url: midriseUrl,    color: '#c9a07a', fill: 0.96 },  // warm stone mid-rise
  setback:    { url: setbackUrl,    color: '#d9c7a0', fill: 0.90 },  // tan setback tower
};

/* The factory: loads the prototypes once, then hands out adopted CLONES on demand.
   `make(key, slot, opts)` is the slot API citygen calls — it knows nothing about GLTF, just
   "give me a mesh that fills this footprint". Returns null until the models finish loading. */
export function createLandmarkFactory({ windowGlow, manager } = {}) {
  // L107: route through the SHARED loader-progress manager when one is passed (so the boot bar counts these GLBs);
  // fall back to a private manager for standalone use. Either way, redirect the kit's relative
  // "Textures/colormap.png" to our bundled atlas (no 404).
  const mgr = manager || new THREE.LoadingManager();
  mgr.setURLModifier((url) => (url.includes('colormap.png') ? colormapUrl : url));
  const loader = new GLTFLoader(mgr);

  const cache = {};          // key → the loaded gltf.scene PROTOTYPE we clone from
  let ready = false;
  const whenReady = Promise.all(Object.entries(MODELS).map(async ([key, spec]) => {
    const gltf = await loader.loadAsync(spec.url);   // ≈ future.get(), non-blocking
    cache[key] = gltf.scene;
  })).then(() => { ready = true; window.__landmarksReady = true; })
    .catch((e) => console.error('landmark models failed:', e));

  let lid = 9000;            // landmark window-id range (won't clash with citygen's building ids)

  function make(key, slot, opts = {}) {
    let obj, fill;
    if (ICONIC_KEYS.includes(key)) {
      // L14: a PROCEDURAL icon (Empire State, Eiffel, …) — built fresh from primitives, already
      // adopted into our material system by the builder. No GLB, no async.
      obj = buildIconic(key, { windowGlow, winColors: opts.winColors, litFrac: opts.litFrac, id: () => ++lid });
      fill = 1.0;   // FIX(L14): the icon's height is now decided by citygen (hMax × heightFactor)
    } else {
      // a Kenney GLB placeholder hero (generic fill, usable by any profile).
      const proto = cache[key], spec = MODELS[key];
      if (!proto || !spec) return null;
      obj = proto.clone(true);   // clone the node tree (geometry shared; materials replaced below)
      fill = spec.fill;
    }

    // NORMALIZE to the slot: scale so the model's height ≈ slot.h, seat its base on the plinth.
    obj.updateMatrixWorld(true);
    const size = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3());
    obj.scale.setScalar((slot.h * fill) / size.y);
    obj.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3());
    obj.position.x += slot.x - c.x;
    obj.position.z += slot.z - c.z;
    obj.position.y += slot.plinthTop - box.min.y;

    if (ICONIC_KEYS.includes(key)) {
      obj.userData.ownsGeometry = true;   // L110 (audit B12): a procedural icon owns its geometry (fresh primitives) → citygen's regenerate teardown must dispose it. GLB clones (else branch) SHARE the cached proto geometry, so they deliberately DON'T set this.
      obj.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.raycast = () => {}; } });
    } else {
      // ADOPT the GLB's loaded materials into our system (flat tiers + night windows), using the
      // active profile's night-window palette/lit-fraction so heroes match their skyline.
      obj.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = false; o.raycast = () => {};
        const adopt = (m) => vectorizeTower(m.clone(), {
          color: MODELS[key].color, id: ++lid, windowGlow, winColors: opts.winColors, litFrac: opts.litFrac,
        });
        o.material = Array.isArray(o.material) ? o.material.map(adopt) : adopt(o.material);
      });
    }
    return obj;
  }

  // how tall (× the profile's hMax) an icon should stand — citygen multiplies this by hMax to
  // get the slot height, so each landmark sits proportionately in ITS skyline. (1.0 = generic.)
  const heightFactor = (key) => ICONIC_HEIGHT[key] ?? 1.0;
  return { make, whenReady, heightFactor, get ready() { return ready; } };
}
