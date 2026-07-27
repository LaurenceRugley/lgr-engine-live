/* ============================================================
   @lgr/engine-core — createCaustics (Lesson W, scene 11).
   ------------------------------------------------------------
   The light on the bottom of a swimming pool: a searing aqua web that writhes, over a lit floor
   falling off into deep water. The technique (cellular/Worley ridges, domain-warped, with a chromatic
   fringe) is explained in caustics.frag — including why it is NOT Aurora, which the brief required:
   Aurora is soft vertical gold curtains, this is a sharp cyan cellular net. Different structure,
   different edge, different hue.

   The simplest pack in the batch: one fullscreen quad, one fragment shader, no render targets at all.
   That's worth noticing after the other two — Liquid Metal needed a half-res RT and Living Ink needed a
   ping-pong pair, but this scene is pure per-pixel maths, so it owns nothing and there is nothing to
   leak. `sharp` and `scale` are the dials.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'dark' }.
   Reduced motion: every term is f(elapsed) → the director's static frame (elapsed=0) is a still,
   fully-formed web. No hot allocation in update().
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import causticsFrag from '../shaders/caustics.frag';

/* L-N re-skin defaults (linear). Aqua on blue — deliberately nowhere near Aurora's gold-on-ink. */
const DEEP    = new THREE.Color(0.010, 0.050, 0.090);   // deep water at the edges
const SHALLOW = new THREE.Color(0.040, 0.180, 0.230);   // the lit floor
const CAUSTIC = new THREE.Color(0.55, 0.95, 1.00);      // the filaments themselves

export function createCaustics(core, {
  sharp   = 14.0,     // ridge exponent — the higher, the thinner and more searing the filaments
  deep    = DEEP,     // L-N re-skin
  shallow = SHALLOW,
  caustic = CAUSTIC,
} = {}) {
  const { drawBuffer } = core;

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);   // fullscreen.vert ignores it

  const material = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: causticsFrag,
    uniforms: {
      uTime:     { value: 0 },
      uRes:      { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uDeep:     { value: new THREE.Color().copy(deep) },
      uShallow:  { value: new THREE.Color().copy(shallow) },
      uCaustic:  { value: new THREE.Color().copy(caustic) },
      uSharp:    { value: sharp },
    },
    depthTest: false, depthWrite: false,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo, material);
  quad.frustumCulled = false;
  scene.add(quad);

  function update(dt, elapsed) {
    material.uniforms.uTime.value = elapsed;
    /* Read the live size straight off core.drawBuffer rather than registering a resizer:
       registerContentResizer is push-only, so a registered closure would outlive dispose(). Two float
       writes, no allocation. */
    material.uniforms.uRes.value.set(drawBuffer.x, drawBuffer.y);
  }

  function dispose() {
    material.dispose();
    quadGeo.dispose();
    scene.remove(quad);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
