/* ============================================================
   @lgr/engine-core — createLiquidMetal (Lesson W, scene 9) ⭐ the marquee.
   ------------------------------------------------------------
   Mercury blobs that drift, stretch and FUSE — rendered with no geometry whatsoever. The whole scene
   is one flat quad running an SDF raymarcher (liquid-metal.frag, which explains sphere-tracing and
   smooth-min in full). It's in the ring to prove the engine isn't a triangle pump: it can host a
   completely different rendering paradigm behind the exact same pack contract.

   ── THE PERF ARCHITECTURE (this scene is the lesson's limit-test) ─────────────
   Raymarch cost = pixels × steps × cost(SDF). The pixel term dominates and is the one we control from
   JS, so the pack renders the march into its OWN half-resolution target and presents that upscaled:

     update()  →  runPass(marchMat, lowRT)      the expensive pass, at 1/4 the pixels
     scene     =  a fullscreen quad sampling lowRT (LinearFilter — the upscale is the cheap blur)

   Half-res is nearly free visually here and is not a cheat: a liquid-metal surface is all smooth
   gradients and broad highlights, so it has almost no high-frequency detail for the extra pixels to
   resolve. (It would be a terrible idea for Lattice's hairline ink.) This is the same own-your-RT
   architecture Pixel Morph uses, and the same discipline: the pack owns the target and frees it in
   dispose() — see the transmission-leak lesson in createMaterialStudy.

   `scale` is the honest perf dial. If a device can't hold frame budget, this is the knob to turn (or
   `blobs`, which cuts SDF cost directly) — both are options, not hard-codes.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'dark' }.
   Reduced motion: every animated term is f(elapsed) → the director's static frame (elapsed=0) is a
   still, fully-formed cluster. No hot allocation in update().
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import liquidMetalFrag from '../shaders/liquid-metal.frag';
import blitFrag from '../shaders/blit.frag';

/* L-N re-skin defaults (linear). */
const TINT   = new THREE.Color(0.82, 0.84, 0.90);   // cool chrome-silver
/* A GRAPHITE STUDIO, not a void — and the probe is why. The first cut used a near-black backdrop, which
   put this scene 5.6 from Observatory on the pairwise-distinctness gate (floor is 6): two dark frames
   with a small bright thing in the middle read as the same picture. Lifting the backdrop to graphite
   separates them AND makes the metal better — chrome is nothing but its environment, so giving it a
   studio to reflect is what turns a silhouette into a surface. */
const BG_TOP = new THREE.Color(0.170, 0.180, 0.205);   // lit studio wall
const BG_BOT = new THREE.Color(0.030, 0.032, 0.042);   // the floor falls off

export function createLiquidMetal(core, {
  scale  = 0.5,      // internal render scale — THE perf dial. 0.5 = quarter the pixels.
  blobs  = 6,        // 3..6 metaballs. Fewer = cheaper SDF, still reads as liquid metal.
  tint   = TINT,     // L-N re-skin
  bgTop  = BG_TOP,
  bgBot  = BG_BOT,
} = {}) {
  const { drawBuffer, runPass } = core;

  const _w = () => Math.max(1, Math.floor(drawBuffer.x * scale));
  const _h = () => Math.max(1, Math.floor(drawBuffer.y * scale));

  /* HalfFloat: the metal's specular and the overhead band go well above 1.0, and the director's bloom
     wants that HDR headroom — an 8-bit target would clip the highlights flat (the beauty-HDR lesson). */
  const lowRT = new THREE.WebGLRenderTarget(_w(), _h(), {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,   // Linear = the upscale IS the filter
    depthBuffer: false, stencilBuffer: false,
    type: THREE.HalfFloatType,
  });

  const marchMat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: liquidMetalFrag,
    uniforms: {
      uTime:  { value: 0 },
      uRes:   { value: new THREE.Vector2(_w(), _h()) },
      uTint:  { value: new THREE.Color().copy(tint) },
      uBgTop: { value: new THREE.Color().copy(bgTop) },
      uBgBot: { value: new THREE.Color().copy(bgBot) },
      uBlobs: { value: blobs },
    },
  });

  /* What the director sees: a quad that just shows the low-res render, upscaled. */
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);   // fullscreen.vert ignores it
  const presentMat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: blitFrag,
    uniforms: { uTex: { value: lowRT.texture } },
    depthTest: false, depthWrite: false,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo, presentMat);
  quad.frustumCulled = false;
  scene.add(quad);

  /* Resize by polling drawBuffer (core.registerContentResizer is push-only — a registered closure would
     outlive dispose() holding a freed RT, and the probe creates/disposes packs in a loop). Two int
     compares per frame; setSize is a no-op when unchanged. */
  let rtW = _w(), rtH = _h();
  function syncSize() {
    const w = _w(), h = _h();
    if (w === rtW && h === rtH) return;
    rtW = w; rtH = h;
    lowRT.setSize(w, h);
    marchMat.uniforms.uRes.value.set(w, h);
  }

  function update(dt, elapsed) {
    syncSize();
    marchMat.uniforms.uTime.value = elapsed;
    /* The expensive pass — into our own half-res target. The director rebinds beautyRT for us
       afterwards (it calls update() BEFORE it binds), so we don't restore the target here. */
    runPass(marchMat, lowRT);
  }

  function dispose() {
    lowRT.dispose();          // own your RTs, free your RTs
    marchMat.dispose();
    presentMat.dispose();
    quadGeo.dispose();
    scene.remove(quad);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
