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
  minDist = 1.6, maxDist = 6.0,   // zoom clamps (× model radius applied at frame time)
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
  const orbitBy = (dAz, dPol) => { orbit.azG += dAz; orbit.polG = clamp(orbit.polG - dPol, minPolar, maxPolar); };
  const zoomBy = (f) => { orbit.distG = clamp(orbit.distG * f, _minD, _maxD); };

  function frameToBounds() {
    if (!model) return;
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
    model.position.sub(center);                          // recenter the model on the origin
    ground.position.y = box.min.y - center.y;            // drop the shadow catcher to the model's underside
    key.target.position.set(0, 0, 0);
    const r = 0.5 * Math.hypot(size.x, size.y, size.z);  // bounding radius
    _minD = Math.max(minDist, r * 1.15); _maxD = Math.max(_minD + 0.5, r * 3.2);
    orbit.dist = orbit.distG = clamp(r * 2.0, _minD, _maxD);
    orbit.target.set(0, 0, 0);
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

  function resize(w, h) { camera.aspect = (h > 0 ? w / h : 1); camera.updateProjectionMatrix(); }

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

  return { scene, camera, load, listVariants, setVariant, frameToBounds, orbitBy, zoomBy, update, render, resize, dispose, get url() { return _loadedURL; } };
}
