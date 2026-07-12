/* ============================================================
   @lgr/engine-core — createAurora (Lesson K3).
   ------------------------------------------------------------
   K3 hero scene pack: slow light ribbons over deep ink. A few layered, semi-
   transparent CURTAIN meshes (aurora.vert/.frag), each waving on its own phase,
   additive-blended and CAPPED per the beauty guard. Gold→cream restraint, very
   slow drift — the calm counterpoint to Constellation's energy.

   No force sim, no raymarch: just N tall planes with vertex-wave displacement.
   Simplicity-first (Rule 2) — the look comes from layering + bloom, not compute.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true }.
   Dispose owns: each layer's geometry + material. No uniform textures, no RTs.
   ============================================================ */
import * as THREE from 'three';
import auroraVert from '../shaders/aurora.vert';
import auroraFrag from '../shaders/aurora.frag';

const GOLD  = new THREE.Color(1.000, 0.258, 0.101);   // linear-sRGB base — L-N default ribbon low
const CREAM = new THREE.Color(0.650, 0.563, 0.474);   // linear-sRGB crown — L-N default ribbon high
const BACKDROP = new THREE.Color(0x04030a);           // deep ink — L-N default backdrop

/* Per-layer config: narrow, TALL vertical curtains spread across x — several,
   at varied depth/phase, so they read as distinct drifting light ribbons (not
   one wide sheet). depth (z), horizontal position (x), phase, width, height. */
/* L-N: the ribbon palette is a single factory option (gold/cream, shared by every layer — as low/high
   always were), so the per-layer entries carry only GEOMETRY (depth/x/phase/width/height), not colour. */
const LAYERS = [
  { z: -6.5, x: -6.4, phase: 0.0, w: 3.4, h: 15 },
  { z: -5.0, x: -3.6, phase: 1.4, w: 2.8, h: 14 },
  { z: -4.0, x: -1.2, phase: 2.7, w: 3.2, h: 16 },
  { z: -3.0, x:  1.4, phase: 3.9, w: 2.6, h: 14 },
  { z: -4.6, x:  3.8, phase: 5.1, w: 3.0, h: 15 },
  { z: -6.0, x:  6.2, phase: 0.8, w: 3.6, h: 16 },
];

export function createAurora(core, {
  gold     = GOLD,       // L-N re-skin: ribbon LOW colour (linear sRGB); default byte-identical
  cream    = CREAM,      // L-N re-skin: ribbon HIGH/crown colour; default byte-identical
  backdrop = BACKDROP,   // L-N re-skin: scene background; default byte-identical
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().copy(backdrop);   // deep ink (clone: don't capture caller's ref)

  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 200);
  camera.position.set(0, 0.5, 9);
  camera.lookAt(0, 0.5, 0);

  const geos = [];
  const mats = [];
  const meshes = [];

  for (const L of LAYERS) {
    // Segment the plane vertically so the sine-wave displacement is smooth.
    const geo = new THREE.PlaneGeometry(L.w, L.h, 24, 40);
    const mat = new THREE.ShaderMaterial({
      vertexShader:   auroraVert,
      fragmentShader: auroraFrag,
      uniforms: {
        uTime:      { value: 0 },
        uPhase:     { value: L.phase },
        uColorLow:  { value: gold.clone() },    // L-N: the palette is now the factory option (all layers share it,
        uColorHigh: { value: cream.clone() },   //      exactly as L.low/L.high did — byte-identical on defaults)
      },
      transparent: true,
      blending:    THREE.AdditiveBlending,   // capped in the frag
      depthWrite:  false,
      depthTest:   false,                    // stacked glow; order-independent
      side:        THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(L.x, 0.5, L.z);
    mesh.frustumCulled = false;
    scene.add(mesh);
    geos.push(geo); mats.push(mat); meshes.push(mesh);
  }

  function update(dt, elapsed) {
    for (const m of mats) m.uniforms.uTime.value = elapsed;
  }

  function dispose() {
    for (let i = 0; i < meshes.length; i++) {
      geos[i].dispose();
      mats[i].dispose();
      scene.remove(meshes[i]);
    }
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
