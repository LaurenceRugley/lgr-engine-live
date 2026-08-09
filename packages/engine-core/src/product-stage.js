/* ============================================================
   product-stage.js — L-stress-2: a self-contained PRODUCT STAGE (studio-lit GLB inspector).
   ------------------------------------------------------------
   Engine-first: the CAPABILITY lives here (parameterized, never product-specific); a site/app WIRES it. This is the
   configurator's engine half — a clean studio scene (own scene + camera + IBL + key light + shadow catcher), a GLB
   loader, KHR_materials_variants swapping, a constrained damped orbit, and — critically — a `render(renderer)` that
   SHARES the engine's ONE WebGLRenderer (ONE-THREE / one GL context) while SAVING + RESTORING every renderer state it
   touches, so a product frame can NEVER bleed into the city hero (the byte-identical hazard: toneMapping /
   outputColorSpace / shadowMap.type / autoClear / clearColor). Built to verify STANDALONE first, embed second.

   Why NEW code (grep-confirmed the engine lacked all three seams): the GLTFLoader was landmark-only; the only lighting
   rig is the outdoor SunRig + Preetham sky (this needs indoor RoomEnvironment→PMREM studio IBL — a NEW env source);
   inspect.js follows existing WORLD entities and can't isolate + orbit one loaded object. Only the PMREM *plumbing*
   pattern was copyable. three addons (GLTFLoader / RoomEnvironment) come from the SAME hoisted three → ONE-THREE holds.

   C++ anchor: a self-contained "viewer widget" object — owns its scene graph + resources, borrows the shared device
   (renderer) for a draw call, and leaves the device's global state exactly as it found it (RAII save/restore).
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { damp, clamp } from './math.js';   // reuse the engine's dt-correct ease (import, not edit — same feel as the rig)

export function createProductStage({
  renderer,                       // SHARED with the engine (ONE-THREE / one GL context)
  backdrop = '#efe9df',           // neutral studio sweep
  envIntensity = 1.0,             // IBL strength
  exposure = 1.05,                // ACES tone-mapping exposure for the product frame only (save/restored)
  autoRotate = 0.25,              // rad/s idle turntable (0 = off)
  /* Breathing room around the fitted silhouette. 1.25 made the product a technically correct HERO
     that ate its own caption: measured 18% of frame, with the heading and sub-copy sitting on top of
     a busy blue mesh and unreadable. The fit maths was the bug; this is the composition.
     1.78 → 2.46 (2026-08-08): the fit is computed ONCE at load from the model's rest bounds, but the
     turntable keeps spinning it, and a long object's WORLD-space box grows as it turns. Measured on
     desktop the silhouette reached 797px in a 900px viewport and clipped 128px off the top — the heel
     and collar simply gone. Fitting the rest pose is not the same as fitting every pose it will hold;
     the margin has to cover the WORST rotation, not the one it happened to load in. */
  fitMargin = 2.46,
  /* Vertical framing bias as a fraction of model height: NEGATIVE aims the camera below the model, so
     the model rides HIGH in frame and leaves the lower third for copy. A product stage whose consumer
     puts a caption under it needs this; centring the model dead-centre is only right for a bare
     viewer. Eased -0.66 → -0.42 alongside the fitMargin change: once the silhouette fits, it no longer
     needs shoving that far up the frame, and -0.66 was itself pushing the crown off the top edge. */
  frameBias = -0.42,
  /* Floor on the aspect used by the WIDTH half of the fit. A long low object (a shoe) fitted across a
     390px portrait viewport pushes the camera absurdly far back — measured, the product fell to 2.9%
     of a phone frame against ~10% on desktop, small enough that at some scroll positions it left the
     visible band entirely and the page showed three swatches on an empty ground. On a narrow screen
     the right answer is to let the LENGTH overflow a little and keep the product legible, which is
     what a phone product shot does anyway. Desktop is unaffected: its aspect is already above this. */
  minFitAspect = 0.95,
  /* Zoom clamps, as MULTIPLES OF THE FIT DISTANCE (2026-08-07). They used to be absolute world units
     while this comment claimed they were relative, and the mismatch had teeth: for the showcase shoe
     the fit landed on 1.60 and the absolute floor was ALSO 1.60, so the camera opened pinned exactly
     at its zoom-in limit. Zooming in did nothing at all (measured: camera y unchanged after twelve
     zoomBy(0.7) calls) and only zoom-out had travel, which read as "the zoom is broken". Relative
     clamps cannot collapse like that whatever the model's size. */
  minDist = 0.55, maxDist = 2.4,
  minPolar = 0.22, maxPolar = 1.45,  // pitch clamps (radians from +Y) — never under the floor, never over the pole
} = {}) {
  if (!renderer) throw new Error('createProductStage: pass the shared { renderer }');

  /* --- own scene + camera (nothing shared with the city scene) --- */
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(backdrop);
  const camera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);

  /* --- STUDIO IBL: RoomEnvironment → PMREM → scene.environment (the NEW indoor env source; PMREM plumbing is the
        proven pattern). PMREM borrows the renderer once at build; we dispose it after (the env texture persists). --- */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = envIntensity;
  pmrem.dispose();

  /* --- one key DirectionalLight + a soft shadow, and a ShadowMaterial catcher (an invisible ground that only takes
        the shadow) so the product sits on a surface without a visible floor plane. --- */
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(2.5, 4.5, 2.0);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.near = 0.5; key.shadow.camera.far = 24;
  Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3 });
  key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02;
  scene.add(key, key.target);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), new THREE.ShadowMaterial({ opacity: 0.26 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
  scene.add(ground);

  /* --- GLB loader + KHR_materials_variants state --- */
  const loader = new GLTFLoader();
  let model = null, parser = null, variantDefs = [], _loadedURL = null;

  async function load(url) {
    const gltf = await loader.loadAsync(url);
    if (model) { scene.remove(model); disposeObject(model); }
    model = gltf.scene; parser = gltf.parser; _loadedURL = url;
    model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(model);
    const ext = gltf.userData?.gltfExtensions?.KHR_materials_variants;
    variantDefs = ext ? ext.variants : [];
    frameToBounds();
    return { variants: listVariants() };
  }
  const listVariants = () => variantDefs.map((v) => v.name);

  /* KHR_materials_variants swap — the official three.js recipe (webgl_loader_gltf_variants): for each mesh, look up the
     mapping for the chosen variant index and reassign that material via the kept parser (instant, no reload). */
  async function setVariant(name) {
    if (!model || !parser) return false;
    const idx = variantDefs.findIndex((v) => v.name === name);
    if (idx < 0) return false;
    const jobs = [];
    model.traverse((o) => {
      const def = o.isMesh && o.userData?.gltfExtensions?.KHR_materials_variants;
      if (!def) return;
      if (!o.userData.__baseMaterial) o.userData.__baseMaterial = o.material;
      const mapping = def.mappings.find((m) => m.variants.includes(idx));
      jobs.push((async () => {
        o.material = mapping ? await parser.getDependency('material', mapping.material) : o.userData.__baseMaterial;
        parser.assignFinalMaterial(o);
      })());
    });
    await Promise.all(jobs);
    return true;
  }

  /* --- constrained damped orbit (hand-rolled: azimuth/polar/distance goals eased with the engine's `damp`, clamped so
        the camera can't dip under the floor, flip the pole, or zoom into the mesh). --- */
  const orbit = { az: 0.7, azG: 0.7, pol: 1.05, polG: 1.05, dist: 3, distG: 3, target: new THREE.Vector3() };
  let _minD = minDist, _maxD = maxDist;
  const _size = new THREE.Vector3(); let _fit = 3;
  /* The camera distance at which `_size` just fills the frame, given the CURRENT aspect. Depends on
     aspect, so it has to be recomputable — see resize(). */
  function fitDistance() {
    const vFov = (camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(minFitAspect, camera.aspect));
    const dV = (_size.y * 0.5) / Math.tan(vFov / 2);
    const dH = (Math.max(_size.x, _size.z) * 0.5) / Math.tan(hFov / 2);
    return Math.max(dV, dH, 0.0001) * fitMargin;
  }
  const orbitBy = (dAz, dPol) => { orbit.azG += dAz; orbit.polG = clamp(orbit.polG - dPol, minPolar, maxPolar); };
  const zoomBy = (f) => { orbit.distG = clamp(orbit.distG * f, _minD, _maxD); };

  function frameToBounds() {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);                          // recenter the model on the origin
    ground.position.y = box.min.y - center.y;            // drop the shadow catcher to the model's underside
    key.target.position.set(0, 0, 0);
    /* FIT TO THE PROJECTED SILHOUETTE, not the bounding DIAGONAL (2026-08-07). The old fit used
       0.5*hypot(x,y,z) as a radius, which for a long low object like a shoe massively overestimates
       how much of the frame it actually covers: the diagonal is dominated by length while the camera
       is constrained by height. Result, measured on this page — the product filled roughly 7% of a
       1440px frame on the one section pitching commercial work.
       The honest fit solves the projection instead: how far back must the camera sit for the object's
       height to fill the vertical FOV, and for its width to fill the horizontal FOV, then take the
       binding one. `fitMargin` is the breathing room around it. */
    _size.copy(size);
    _fit = fitDistance();
    _minD = _fit * minDist; _maxD = Math.max(_minD + 0.01, _fit * maxDist);
    orbit.dist = orbit.distG = _fit;
    orbit.target.set(0, _size.y * frameBias, 0);
  }

  function update(dt) {
    if (autoRotate) orbit.azG += autoRotate * dt;
    orbit.az = damp(orbit.az, orbit.azG, dt, 6); orbit.pol = damp(orbit.pol, orbit.polG, dt, 6); orbit.dist = damp(orbit.dist, orbit.distG, dt, 6);
    const sp = Math.sin(orbit.pol), cp = Math.cos(orbit.pol);
    camera.position.set(
      orbit.target.x + orbit.dist * sp * Math.sin(orbit.az),
      orbit.target.y + orbit.dist * cp,
      orbit.target.z + orbit.dist * sp * Math.cos(orbit.az),
    );
    camera.lookAt(orbit.target);
  }

  /* RE-FIT ON RESIZE. This only updated `aspect` before, so a wider viewport made the framing WORSE
     rather than reframing — the fit had been computed once, at whatever aspect happened to be current
     at load. The visitor's own zoom is preserved as a RATIO of the fit, so a window resize reframes
     without yanking someone who deliberately zoomed in. */
  function resize(w, h) {
    camera.aspect = (h > 0 ? w / h : 1);
    camera.updateProjectionMatrix();
    if (!model) return;
    const prev = _fit;
    _fit = fitDistance();
    const k = prev > 0 ? _fit / prev : 1;
    _minD = _fit * minDist; _maxD = Math.max(_minD + 0.01, _fit * maxDist);
    orbit.distG = clamp(orbit.distG * k, _minD, _maxD);
    orbit.dist = clamp(orbit.dist * k, _minD, _maxD);
  }

  /* --- THE BYTE-IDENTICAL SEAM. Borrow the shared renderer for one draw, save every global we change, restore it all.
        This is why the city hero A/B is pixel-unchanged after a product frame renders. --- */
  const _saved = {};
  function render() {
    _saved.tone = renderer.toneMapping; _saved.exp = renderer.toneMappingExposure;
    _saved.cs = renderer.outputColorSpace; _saved.ac = renderer.autoClear;
    _saved.smE = renderer.shadowMap.enabled; _saved.smT = renderer.shadowMap.type;
    _saved.rt = renderer.getRenderTarget();
    renderer.getClearColor(_saved.cc = new THREE.Color()); _saved.ca = renderer.getClearAlpha();

    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = exposure;
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.autoClear = true;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setRenderTarget(null);
    renderer.render(scene, camera);

    renderer.toneMapping = _saved.tone; renderer.toneMappingExposure = _saved.exp;
    renderer.outputColorSpace = _saved.cs; renderer.autoClear = _saved.ac;
    renderer.shadowMap.enabled = _saved.smE; renderer.shadowMap.type = _saved.smT;
    renderer.setClearColor(_saved.cc, _saved.ca); renderer.setRenderTarget(_saved.rt);
    // NB: shadowMap.type changed → three re-compiles depth materials lazily; the city's own shadow re-render on its
    // next frame restores its map. Verified by the hero A/B: the city frame after a product frame is pixel-unchanged.
  }

  /* --- PRESENCE (2026-08-08) — how present the product is, 1 = fully there, 0 = gone.
     WHY this is an ability and not a page trick: the stage renders into a VIEWPORT-FIXED canvas while
     the page's copy scrolls over it. That is fine while the section owns the screen, and wrong the
     moment it stops — at the very bottom of the showcase the outgoing configurator headline scrolled
     up INTO the shoe, so "Build your pair." was struck through by a lace and the body copy sat on a
     blue mesh upper. The shoe never moved; the words did. No amount of framing bias fixes that, because
     the collision happens where the section is LEAVING, not where it is composed.
     Any page that pins this stage behind scrolling copy has the same exit problem, so the fade belongs
     here, parameterised, rather than in one project's scroll handler.
     Default 1 touches NOTHING — `transparent` is only forced while a fade is actually in progress, so
     material state and render order are byte-identical to before at full presence.
     In C++ terms: a scoped guard that restores the flags it changed. --- */
  let _presence = 1;
  function setPresence(a) {
    const v = Math.min(1, Math.max(0, a));
    if (v === _presence) return;
    _presence = v;
    const full = v >= 1;
    model?.traverse((o) => {
      if (!o.isMesh) return;
      for (const mat of (Array.isArray(o.material) ? o.material : [o.material])) {
        if (!mat) continue;
        /* Remember what the material WAS the first time we dim it, so returning to 1 restores the
           author's own flags rather than leaving everything transparent forever. */
        if (mat.userData._lgrOpaque === undefined) mat.userData._lgrOpaque = { t: mat.transparent, o: mat.opacity };
        const was = mat.transparent;
        if (full) { mat.transparent = mat.userData._lgrOpaque.t; mat.opacity = mat.userData._lgrOpaque.o; }
        else { mat.transparent = true; mat.opacity = mat.userData._lgrOpaque.o * v; }
        mat.depthWrite = full ? true : v > 0.92;   // keep self-sorting sane mid-fade
        /* three.js bakes the alpha path into the compiled program, so flipping `transparent` without
           this leaves the OPAQUE program running: the material reads transparent=true / opacity=0 and
           the mesh still draws at full strength. Measured exactly that before adding this line —
           the probe said faded, the screenshot said otherwise. Only on the flip, not every frame. */
        if (was !== mat.transparent) mat.needsUpdate = true;
      }
    });
    ground.material.opacity = 0.26 * v;            // the contact shadow leaves with the thing casting it
    ground.visible = v > 0.001;
  }

  function disposeObject(root) {
    root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      const m = o.material; if (!m) return;
      (Array.isArray(m) ? m : [m]).forEach((mat) => { for (const k in mat) { const v = mat[k]; if (v && v.isTexture) v.dispose(); } mat.dispose?.(); });
    });
  }
  function dispose() {
    if (model) disposeObject(model);
    ground.geometry.dispose(); ground.material.dispose();
    envRT.dispose();
  }

  return { scene, camera, load, listVariants, setVariant, frameToBounds, orbitBy, zoomBy, update, render, resize, setPresence, dispose, get presence() { return _presence; }, get url() { return _loadedURL; } };
}
