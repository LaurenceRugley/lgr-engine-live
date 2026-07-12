/* ============================================================
   @lgr/engine-core — createProductMoment (Lesson K4).
   ------------------------------------------------------------
   K4 hero scene pack: a floating PROCEDURAL object under studio lighting — the
   "product moment" that says "we build real things," with ZERO GLB. A brushed
   warm-metal torus-knot on a soft studio sweep, slow turntable + gentle float.

   Reuses the product-stage LIGHTING RECIPE (RoomEnvironment → PMREM → scene
   .environment studio IBL + one key DirectionalLight) — the same indoor env
   source createProductStage introduced — but as a hero PACK: it exposes only
   { scene, camera, update, dispose, usesBloom } and lets the director's
   presentBeauty own tone-mapping. Renderer default is NoToneMapping, so the
   MeshPhysicalMaterial writes LINEAR HDR into beautyRT and the filmic pass ACES-
   compresses it exactly once (no double tone-map). NO own render(), NO shadows
   (the engine's shadowMap.autoUpdate is off — touching it would risk the
   byte-identical tier-guard), NO orbit — just turntable + float.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true }.
   Dispose owns: geometry + material + the PMREM env render target.
   ============================================================ */
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

/* Warm brushed-metal tint (on-token: a gold/bronze in the dusk-harbor family). */
const METAL = new THREE.Color('#d8a55e');
/* Soft studio sweep — warm sand, brighter than the 3 dark scenes so the product
   moment reads distinct in the ring. Pushed warm to survive the director's dusk
   grade (which cools a neutral toward blue-grey). */
const BACKDROP = new THREE.Color('#d8b98a');

export function createProductMoment(core, {
  envIntensity = 1.0,
  metal    = METAL,      // L-N re-skin: brushed-metal tint; default byte-identical (#d8a55e)
  backdrop = BACKDROP,   // L-N re-skin: studio sweep background; default byte-identical (#d8b98a)
} = {}) {
  const { renderer } = core;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color().copy(backdrop);   // clone: don't capture caller's ref

  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(38, w / h, 0.05, 100);
  camera.position.set(0, 0.9, 7.6);   // pulled back so the whole knot frames with margin
  camera.lookAt(0, 0, 0);

  /* STUDIO IBL — RoomEnvironment → PMREM → scene.environment (the product-stage
     recipe). PMREM borrows the shared renderer once at build; we keep the env RT
     to dispose on teardown (the env texture must outlive the generator). */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room  = new RoomEnvironment();
  const envRT = pmrem.fromScene(room, 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = envIntensity;
  pmrem.dispose();
  /* The room's boxes were GPU-uploaded during baking but are no longer needed —
     free them now so a create→dispose loop doesn't accumulate their geometry/
     materials (product-stage skips this because it builds once; the hero pack is
     created + disposed repeatedly). */
  room.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose?.(); });

  /* One warm key light for a directional highlight the IBL alone won't give. */
  const key = new THREE.DirectionalLight(0xfff2e2, 2.2);
  key.position.set(2.6, 4.2, 2.4);
  scene.add(key);

  /* The object: a procedural torus-knot in brushed warm metal. Anisotropy gives
     the brushed-metal streak; high metalness + satin roughness catch the IBL
     softly — higher roughness spreads the highlight so it never clips to a hard
     white zebra (the beauty guard: no clipped highlights). */
  const geo = new THREE.TorusKnotGeometry(1.0, 0.30, 220, 32);
  const material = new THREE.MeshPhysicalMaterial({
    color:      new THREE.Color().copy(metal),
    metalness:  1.0,
    roughness:  0.42,          // satin, not mirror — softens the highlight
    anisotropy: 0.40,          // brushed streak, restrained
    anisotropyRotation: Math.PI * 0.25,
    envMapIntensity: 1.0,
    clearcoat:  0.0,
  });
  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);

  /* update — turntable + gentle float. Scalars only, no hot alloc. */
  function update(dt, elapsed) {
    mesh.rotation.y = elapsed * 0.35;              // slow turntable
    mesh.rotation.x = Math.sin(elapsed * 0.25) * 0.12;
    mesh.position.y = Math.sin(elapsed * 0.6) * 0.14;  // gentle bob
  }

  /* dispose — owns geometry + material + the PMREM env target. */
  function dispose() {
    geo.dispose();
    material.dispose();
    envRT.dispose();
    scene.environment = null;
    scene.remove(mesh, key);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'bright' };
}
