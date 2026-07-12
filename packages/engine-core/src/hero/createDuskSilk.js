/* ============================================================
   @lgr/engine-core — createDuskSilk (Lesson K1)
   ------------------------------------------------------------
   K1 hero scene pack: a flowing silk/wave surface — the 3D evolution
   of the site's existing hero-gradient. Vertex-displaced by layered
   noise/sine fields, fragment-shaded ink→gold→cream from diagram-theme
   dusk-harbor tokens, bloom on the crests.

   Pack contract:
     create(core)  → { scene, camera, update(dt,elapsed), dispose(), usesBloom }
     update:        no hot alloc — only sets uTime uniform.
     dispose:       geometry + material (no texture uniforms or owned RTs).
     usesBloom:     true — crest brightness 2.4× in HalfFloat beautyRT triggers
                    the filmic bloom pass automatically.

   Beauty guards (invariant):
     • No GL_LINES — geometry is a PlaneGeometry triangle mesh.
     • Additive capped: BRIGHT_HIGH = 2.4× (no white blowout; ACES compresses).
     • No banding: linear-sRGB HDR gradient + uDither in the filmic pass.
     • No clipped highlights: ACES handles compression from HalfFloat → SDR.
   ============================================================ */
import * as THREE from 'three';
import silkVert from '../shaders/silk.vert';
import silkFrag from '../shaders/silk.frag';

/* L-N re-skin defaults — the dusk-harbor gradient, linear sRGB (matches silk.frag's old consts
   exactly, so a default build is byte-identical). A client build passes its own to re-skin. */
const DEFAULT_INK   = new THREE.Color(0.009, 0.004, 0.001);
const DEFAULT_GOLD  = new THREE.Color(1.000, 0.258, 0.101);
const DEFAULT_CREAM = new THREE.Color(0.650, 0.563, 0.474);

export function createDuskSilk(core, {
  ink   = DEFAULT_INK,
  gold  = DEFAULT_GOLD,
  cream = DEFAULT_CREAM,
} = {}) {
  /* Own scene — isolated from core.scene (godrays skip by design: wrong camera). */
  const scene = new THREE.Scene();

  /* Own camera. Aspect set at create time from renderer drawBuffer; updated by
     the director's registerContentResizer when the window resizes. */
  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 500);
  /* Oblique aerial view: looking across the silk surface from a low angle —
     like a silken sea from a low cliff. Fills the hero viewport. */
  camera.position.set(0, 5.5, 13);
  camera.lookAt(0, 0.5, 0);

  /* Silk geometry — wide plane, x/z aligned, many segments for smooth waves.
     120 × 80 = 9 600 quads → 19 200 triangles. Fast on any GPU for a pure
     vertex-displaced surface with no shadows or reflections. */
  const geo = new THREE.PlaneGeometry(40, 24, 120, 80);
  geo.rotateX(-Math.PI / 2);  // lay flat in the XZ plane

  const material = new THREE.ShaderMaterial({
    vertexShader:   silkVert,
    fragmentShader: silkFrag,
    uniforms: {
      uTime:  { value: 0 },
      uInk:   { value: new THREE.Color().copy(ink) },    // clone so the caller's Color isn't captured by ref
      uGold:  { value: new THREE.Color().copy(gold) },
      uCream: { value: new THREE.Color().copy(cream) },
    },
    side: THREE.FrontSide,
  });

  const mesh = new THREE.Mesh(geo, material);
  scene.add(mesh);

  /* update — called each RAF frame by the director.
     No new object allocations — sets uTime uniform only. */
  function update(dt, elapsed) {
    material.uniforms.uTime.value = elapsed;
  }

  /* dispose — owns geometry + material.
     No texture uniforms or owned RTs — nothing else to release. */
  function dispose() {
    geo.dispose();
    material.dispose();
    scene.remove(mesh);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
