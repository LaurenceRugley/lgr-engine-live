/* ============================================================
   @lgr/engine-core — createPixelMorph (Lesson Q, scene 6).
   ------------------------------------------------------------
   The studio's signature move, city-free: a lit, faceted solid that DISSOLVES from
   filmic beauty into crisp palette-quantized pixel art, holds, and dissolves back.

   ── THE HARD EDGE, AND HOW THIS PACK GETS AROUND IT ──────────────────────────
   The hero director presents every pack through ONE path: presentBeauty → beautyRT →
   bloom → ACES (createHeroDirector.js:124). There is no pixel-quantize stage in the
   hero pipeline — the city's lives in createCityWorld (pixMat → pixelRT), which the
   hero lib deliberately does not ship.

   So this pack does its own post INTERNALLY and hands the director a finished picture:

     1. update() renders the REAL 3D subject into innerRT      (pack-owned HDR target)
     2. update() runs the UNMODIFIED post-pixelkit pass         innerRT → pixRT
     3. pack.scene is a single fullscreen quad whose material   (pixel-morph.frag)
        lerps innerRT ↔ pixRT by uMorph.

   The director then renders THAT quad exactly like any other pack — it never learns
   what happened. Zero director edits, zero new seams. The trick that makes it legal:
   the director calls update() BEFORE it binds beautyRT, so a pack is free to render to
   its own targets during update() — the render target is rebound underneath us anyway.
   C++ anchor: a scene object that owns a private framebuffer and presents a textured
   quad — the compositor's interface is unchanged, the object just does more inside.

   WHY NOT extend post-pixelkit.frag with a uMorph uniform: it's SHARED with the city's
   pixel tier, and an unset GLSL uniform reads 0 — the city would silently render the
   raw branch. See pixel-morph.frag's header. The quantize is reused verbatim.

   L-Q's ACCEPTED DEVIATION — NOW CLOSED (L-S). Lesson Q shipped with the palette landing
   darker/tinted vs the authored hex, because the director's grade multiplied a tint over the
   quantizer's output; the header flagged it for "a per-pack filmic bypass — a director seam".
   Lesson S built that seam, and this pack opts in (see NEUTRAL_FILMIC below): the LUT's colours
   now reach the screen as authored. The ACES tonemap still runs — that's wanted, it's what keeps
   the beauty end of the morph from clipping — but the ring's colour TINT no longer overwrites a
   palette that was chosen, not lit.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'dark' }.
   No hot allocation in update(): it sets uniforms and issues two renders.
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import postPixelkitFrag from '../shaders/post-pixelkit.frag';
import pixelMorphFrag from '../shaders/pixel-morph.frag';
import { ERA_PRESETS, LGR_PALETTES, makePaletteTexture } from '../pixelkit/pixelkit.js';

/* L-N re-skin defaults (linear-sRGB THREE.Color). */
const SOLID    = new THREE.Color(0.85, 0.55, 0.18);   // warm gold — the subject
const KEY      = new THREE.Color(1.00, 0.78, 0.42);   // warm key light
const RIM      = new THREE.Color(0.35, 0.62, 1.00);   // cool rim — separates the solid from the backdrop
const BACKDROP = new THREE.Color(0x0b0714);           // deep plum — distinct from the ring's other darks

/* L-S: this scene wants a NEUTRAL grade, and for a reason unique to it — it is the one pack whose
   colours are AUTHORED, not lit. The quantizer snaps every pixel to an exact palette entry (a LUT
   of specific hex values); the ring's grade then multiplies a tint over the top, so the colour that
   reaches the screen is no longer the colour in the palette. Pixel art whose palette isn't the
   palette is just a lie with big pixels. Opting out of the tint hands the LUT back its own hues.
   (The L-Q header called this an "accepted deviation" and flagged it for a future seam. This is it.) */
const NEUTRAL_FILMIC = { sat: 1.0, contrast: 1.0 };

/* The morph cycle, in seconds. Long HOLDS at each end are load-bearing, not taste: the
   consumer-probe samples a scene only once two reads ~4 frames apart agree, and under
   CI's ~1 fps SwiftShader 4 frames is 4 SECONDS. A short hold would never let the
   sampler settle. beauty-hold → ramp → pixel-hold → ramp. */
const HOLD = 5.0, RAMP = 3.0;
const CYCLE = HOLD * 2 + RAMP * 2;   // 16 s

/* smoothstep — the same ease the engine's shaders use, in JS. */
const smoothstep = (t) => t * t * (3 - 2 * t);

/* Where in the cycle are we → 0 (beauty) .. 1 (pixel). */
function morphAt(elapsed) {
  const t = ((elapsed % CYCLE) + CYCLE) % CYCLE;    // guard: elapsed can be 0 (reduced motion)
  if (t < HOLD) return 0;                            // beauty hold
  if (t < HOLD + RAMP) return smoothstep((t - HOLD) / RAMP);          // dissolve in
  if (t < HOLD + RAMP + HOLD) return 1;              // pixel hold
  return 1 - smoothstep((t - HOLD - RAMP - HOLD) / RAMP);             // dissolve out
}

export function createPixelMorph(core, {
  era      = '16-bit',                    // ERA_PRESETS key → gridWidth + dither
  palette  = LGR_PALETTES['warm (sunset)'],   // the LUT the quantizer snaps to
  solid    = SOLID,       // L-N re-skin: subject colour
  key      = KEY,         // L-N re-skin: key light
  rim      = RIM,         // L-N re-skin: rim light
  backdrop = BACKDROP,    // L-N re-skin: scene background
  detail   = 0,           // icosahedron subdivision — 0 = boldly faceted (quantizes best)
  filmic   = NEUTRAL_FILMIC,   // L-S: per-scene grade override; pass null to take the ring's grade
} = {}) {
  const { renderer, drawBuffer, runPass } = core;
  const preset = ERA_PRESETS[era] ?? ERA_PRESETS['16-bit'];

  /* ── The INNER scene: what actually gets rendered in 3D ──────────────────────
     A faceted solid, not a smooth one: flat shading gives large regions of constant
     colour, which is exactly what a palette quantizer flatters. A sphere would band. */
  const innerScene = new THREE.Scene();
  innerScene.background = new THREE.Color().copy(backdrop);

  const innerCam = new THREE.PerspectiveCamera(45, drawBuffer.x / drawBuffer.y, 0.1, 100);
  innerCam.position.set(0, 0, 9);
  innerCam.lookAt(0, 0, 0);

  const solidGeo = new THREE.IcosahedronGeometry(2.6, detail);
  const solidMat = new THREE.MeshStandardMaterial({
    color:        solid.clone(),
    flatShading:  true,
    metalness:    0.10,   // NOT metal: with no env map a metallic surface renders black
    roughness:    0.45,
    emissive:     solid.clone().multiplyScalar(0.06),   // a floor so the dark side never crushes to 0
  });
  const solidMesh = new THREE.Mesh(solidGeo, solidMat);
  innerScene.add(solidMesh);

  const keyLight = new THREE.DirectionalLight(key.clone(), 3.2);
  keyLight.position.set(4, 5, 6);
  const rimLight = new THREE.DirectionalLight(rim.clone(), 2.4);
  rimLight.position.set(-6, -1, -4);
  const ambient  = new THREE.AmbientLight(0xffffff, 0.18);
  innerScene.add(keyLight, rimLight, ambient);

  /* ── Pack-owned render targets ────────────────────────────────────────────────
     innerRT is HalfFloat: the subject is lit above 1.0 in places and the director's
     bloom + ACES want that HDR headroom (an 8-bit target would clip it flat — the
     beauty-HDR-buffer lesson). pixRT holds palette colours (all ≤1), so it needs no
     HDR, but NearestFilter matters: we must not blend between quantized cells. */
  const innerRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
  });
  const pixRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    depthBuffer: false, stencilBuffer: false,
  });

  /* ── The QUANTIZE pass — post-pixelkit.frag, unmodified, exactly as the city runs it ── */
  const paletteTex = makePaletteTexture(palette);
  const pixMat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: postPixelkitFrag,
    uniforms: {
      uScene:       { value: innerRT.texture },
      uResolution:  { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uGridWidth:   { value: preset.gridWidth },
      uDither:      { value: preset.dither },
      uPalette:     { value: paletteTex },
      uPaletteSize: { value: palette.length },
      uUsePalette:  { value: 1 },
    },
  });

  /* ── What the DIRECTOR sees: one fullscreen quad that lerps the two images ─────
     fullscreen.vert passes its corners straight through as clip space, so this quad
     covers the frame regardless of the camera — the camera exists only because
     renderer.render() demands one. */
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const morphMat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: pixelMorphFrag,
    uniforms: {
      uRaw:   { value: innerRT.texture },
      uPix:   { value: pixRT.texture },
      uMorph: { value: 0 },
    },
    depthTest:  false,
    depthWrite: false,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo, morphMat);
  quad.frustumCulled = false;
  scene.add(quad);

  /* Resize WITHOUT registering a core resizer: core.registerContentResizer() is
     push-only (no unregister), so a pack that registered one would leave a live closure
     holding disposed RTs behind after dispose() — and this pack is created/disposed in a
     loop by the probe. Instead we compare against core.drawBuffer each frame (two int
     compares) and resize on change. setSize() is a no-op when the size is unchanged. */
  let rtW = drawBuffer.x, rtH = drawBuffer.y;
  function syncSize() {
    const w = drawBuffer.x, h = drawBuffer.y;
    if (w === rtW && h === rtH) return;
    rtW = w; rtH = h;
    innerRT.setSize(w, h);
    pixRT.setSize(w, h);
    pixMat.uniforms.uResolution.value.set(w, h);
    innerCam.aspect = w / h;
    innerCam.updateProjectionMatrix();
  }

  /* ── update — the whole pack's frame: animate, render inner, quantize, set the lerp ── */
  function update(dt, elapsed) {
    syncSize();

    /* The subject turns slowly; every term is f(elapsed), so the director's
       reduced-motion path (update(0,0)) yields a still frame at morph=0 (pure beauty). */
    solidMesh.rotation.y = elapsed * 0.28;
    solidMesh.rotation.x = Math.sin(elapsed * 0.19) * 0.35;

    const m = morphAt(elapsed);
    morphMat.uniforms.uMorph.value = m;

    /* The grid COARSENS as the pixels arrive: fine cells while the image is still mostly
       continuous, chunky once it's fully quantized. Selling the "resolving into pixels"
       read — a fixed grid would just cross-fade two static looks. */
    pixMat.uniforms.uGridWidth.value = 460 - (460 - preset.gridWidth) * m;

    /* 1) the 3D subject → innerRT (HDR). */
    renderer.setRenderTarget(innerRT);
    renderer.render(innerScene, innerCam);

    /* 2) innerRT → post-pixelkit → pixRT. core.runPass owns the fullscreen quad + ortho
          cam, so this is the same call the city's pixel tier makes. */
    runPass(pixMat, pixRT);

    /* 3) …and the director now renders our quad (uRaw × uPix × uMorph) into beautyRT.
          It rebinds the render target itself, so we don't need to restore it here. */
  }

  /* ── dispose — this pack owns RTs and a texture as well as geo/materials ─────── */
  function dispose() {
    innerRT.dispose();
    pixRT.dispose();
    paletteTex.dispose();
    pixMat.dispose();
    morphMat.dispose();
    quadGeo.dispose();
    solidGeo.dispose();
    solidMat.dispose();
    innerScene.remove(solidMesh, keyLight, rimLight, ambient);
    scene.remove(quad);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark', filmic };
}
