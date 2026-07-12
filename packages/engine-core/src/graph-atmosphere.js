/* ============================================================
   graph-atmosphere.js — VIZ SLICE 5: the layer that turns "a graph on a webpage" into "a graph in space".
   ------------------------------------------------------------
   Two objects, both static buffers, both effectively free:

     NEBULA     one screen-space quad running a 3-octave FBM at 2-6% luminance with a radial vignette.
                It does NOT move with the camera (see graph-atmosphere.vert) because atmosphere that
                parallaxes is just a texture on a plane.
     STARFIELD  one THREE.Points cloud sitting BEHIND the graph plane. This one DOES live in the world and
                DOES parallax as you pan — which is the entire reason it exists. Depth under an ortho
                camera cannot come from perspective, so it has to come from relative motion.

   Together they are the fourth-ranked technique in the design doc's leverage list, and the cheapest:
   two draw calls, no textures, no lights, no per-frame allocation.

   DETERMINISM: star positions come from a tiny first-party LCG seeded with a constant, never Math.random().
   The atlas must look identical on every machine and every reload — the same discipline the layout engine
   already holds. (A "random" starfield that reshuffles on refresh is a bug you notice subconsciously.)

   REDUCED MOTION: setReducedMotion(true) drives uDrift to 0. The nebula freezes; its tone and vignette
   stay, because composition is not motion. The stars were never animated.

   C++ anchor: an LCG is `seed = seed * A + C` on a uint32 — the same three lines every game shipped before
   <random>, and still the right tool when you want a reproducible sequence rather than an unpredictable one.
   ============================================================ */
import * as THREE from 'three';
import { THEME } from './diagram-theme.js';
import atmosphereVert from './shaders/graph-atmosphere.vert';
import atmosphereFrag from './shaders/graph-atmosphere.frag';
import glintVert from './shaders/graph-glint.vert';
import glintFrag from './shaders/graph-glint.frag';

/* A 32-bit LCG (numerical-recipes constants). Deterministic, seeded, and dependency-free. */
function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* createGraphAtmosphere(opts) -> { group, update(now), setReducedMotion(bool), dispose() }
     starCount:  how many points (default 340 — enough to read as a field, few enough to stay a whisper)
     starRadius: the disc radius the stars scatter across, in world units
     depth:      how far BELOW the graph plane (y=0) the star slab sits; this gap is what creates parallax
     intensity:  nebula peak luminance. Above ~0.08 it stops being atmosphere and becomes wallpaper. */
export function createGraphAtmosphere(opts = {}) {
  const {
  starCount = 340,
  starRadius = 17,
  depth = 5,
  intensity = 0.055,
  seed = 0x5eed,
  aspect = 1.6,
  bandMul = 1.0,   // slice 12 (OBSERVATORY): scales the galactic band's boost inside the banked ~18% cap
  dustMul = 1.0,   //   "": scales both dust sheets + patches
} = opts;
  const group = new THREE.Group();

  // ---- NEBULA: one screen-space quad, painted first, occluding nothing ----
  const nebulaMat = new THREE.ShaderMaterial({
    vertexShader: atmosphereVert,
    fragmentShader: atmosphereFrag,
    depthTest: false,
    depthWrite: false,
    uniforms: {
      uTime:      { value: 0 },
      uDrift:     { value: 1 },
      uIntensity: { value: intensity },
      uColorA:    { value: new THREE.Color(THEME.NEUTRAL.surface) },
      uColorB:    { value: new THREE.Color(THEME.ACCENT.guide) },   // dusk's muted plum hemisphere
      uColorC:    { value: new THREE.Color(THEME.ACCENT.jhat) },    // cool counter-tone (patches/smudges, slice 9)
      uBg:        { value: new THREE.Color(THEME.NEUTRAL.bg) },
      uAspect:    { value: aspect },
      uPan:       { value: new THREE.Vector2() },                   // camera pan → per-layer parallax (slice 9)
      uBandMul:   { value: bandMul },                               // slice 12: observatory preset knobs
      uDustMul:   { value: dustMul },
    },
  });
  const nebula = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nebulaMat);
  nebula.frustumCulled = false;   // it has no meaningful world bounds; it lives in clip space
  nebula.renderOrder = -10;       // before every graph layer
  group.add(nebula);

  // ---- STARFIELD: a thin slab of points below the graph plane ----
  const rnd = lcg(seed);
  const pos = new Float32Array(starCount * 3);
  for (let i = 0; i < starCount; i++) {
    // sqrt(u) for the radius, or the points bunch at the centre (area grows as r², so r must go as √u).
    const r = Math.sqrt(rnd()) * starRadius;
    const a = rnd() * Math.PI * 2;
    pos[i * 3]     = Math.cos(a) * r;
    pos[i * 3 + 1] = -depth - rnd() * 3;   // a slab, not a plane: a little y-spread reads as volume
    pos[i * 3 + 2] = Math.sin(a) * r;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({
    color: new THREE.Color(THEME.NEUTRAL.dim),
    size: 1.6,
    sizeAttenuation: false,   // ortho: a "distant" star is not smaller, it is just further back
    transparent: true,
    opacity: 0.5,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.renderOrder = -9;
  group.add(stars);

  // ---- GLINT STARS (slice 8): 3 brighter billboards with soft diffraction crosses — the telescope cue.
  // Deterministic (same LCG stream, continuing after the starfield draw), STATIC (no time uniform: a
  // twinkle would fight the restraint brief, and stillness needs no reduced-motion gate). One merged
  // geometry, one material, one draw call. renderOrder ties them to the star slab, under every graph layer.
  const GLINTS = opts.glintCount ?? 3;
  const gPos = new Float32Array(GLINTS * 4 * 3);
  const gCorner = new Float32Array(GLINTS * 4 * 2);
  const gSize = new Float32Array(GLINTS * 4);
  const gIndex = new Uint16Array(GLINTS * 6);
  const CORNERS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let i = 0; i < GLINTS; i++) {
    // Mid-field placement (0.45–0.85 of the radius): never dead-centre (the hub lives there), never at the
    // vignetted rim. Same slab depth band as the point stars.
    const r = (0.45 + rnd() * 0.4) * starRadius;
    const a = rnd() * Math.PI * 2;
    const x = Math.cos(a) * r, y = -depth - rnd() * 3, z = Math.sin(a) * r;
    const size = 1.1 + rnd() * 0.7;
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      gPos[v * 3] = x; gPos[v * 3 + 1] = y; gPos[v * 3 + 2] = z;
      gCorner[v * 2] = CORNERS[c][0]; gCorner[v * 2 + 1] = CORNERS[c][1];
      gSize[v] = size;
    }
    const b = i * 4, ib = i * 6;
    gIndex[ib] = b; gIndex[ib + 1] = b + 1; gIndex[ib + 2] = b + 2;
    gIndex[ib + 3] = b; gIndex[ib + 4] = b + 2; gIndex[ib + 5] = b + 3;
  }
  const glintGeo = new THREE.BufferGeometry();
  glintGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  glintGeo.setAttribute('aCorner', new THREE.BufferAttribute(gCorner, 2));
  glintGeo.setAttribute('aSize', new THREE.BufferAttribute(gSize, 1));
  glintGeo.setIndex(new THREE.BufferAttribute(gIndex, 1));
  const glintMat = new THREE.ShaderMaterial({
    vertexShader: glintVert,
    fragmentShader: glintFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor:     { value: new THREE.Color(THEME.NEUTRAL.text) },   // lamplight warm-white, like the hub
      uIntensity: { value: 0.5 },
    },
  });
  const glints = new THREE.Mesh(glintGeo, glintMat);
  glints.frustumCulled = false;
  glints.renderOrder = -9;
  group.add(glints);

  /* PARALLAX_RATES (slice 9) — mirrored constants of the per-layer uPan multipliers in the frag. Exposed
     via debugLayerOffsets so a probe can assert the layers genuinely move at DIFFERENT rates when the
     camera pans (the whole point of the fake-depth trick — ortho translation gives zero real parallax). */
  const PARALLAX_RATES = { dustNear: 0.55, dustFar: 0.25, patches: 0.12, smudges: 0.08 };
  const PAN_SCALE = 0.06;   // world units → noise-domain units (tuned so a full pan reads as a gentle slide)

  /* update(now, panX, panZ) — panX/panZ optional (the camera's world position); omitted = no parallax
     (backward-compatible with the slice-5 call shape). */
  function update(now, panX, panZ) {
    nebulaMat.uniforms.uTime.value = now;
    if (panX !== undefined) nebulaMat.uniforms.uPan.value.set(panX * PAN_SCALE, panZ * PAN_SCALE);
  }
  function debugLayerOffsets() {
    const p = nebulaMat.uniforms.uPan.value;
    const out = {};
    for (const [k, r] of Object.entries(PARALLAX_RATES)) out[k] = { x: p.x * r, y: p.y * r };
    return out;
  }
  function setReducedMotion(on) { nebulaMat.uniforms.uDrift.value = on ? 0 : 1; }
  function setAspect(a) { nebulaMat.uniforms.uAspect.value = a; }
  function dispose() {
    nebula.geometry.dispose(); nebulaMat.dispose();
    starGeo.dispose(); starMat.dispose();
    glintGeo.dispose(); glintMat.dispose();
  }

  return { group, nebula, stars, glints, update, setReducedMotion, setAspect, debugLayerOffsets, dispose };
}
