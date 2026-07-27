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
import starVert from './shaders/graph-star.vert';
import starFrag from './shaders/graph-star.frag';
import skyVert from './shaders/graph-skysprite.vert';
import skyFrag from './shaders/graph-skysprite.frag';

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
  twinkle = 0.0,   // slice 15: star scintillation amplitude. 0 = the slice-5 static field (byte-faithful);
                   // harbor/observatory run a whisper (~0.12), PIXEL turns it up (~0.55, chunky sparkle).
  starShape = 0,   // slice 22: 1 = square stars (pixel), 0 = round (harbor/observatory)
  skyStars = 0,    // slice 22 (FULL-BLEED SKY): procedural screen-space star density. 0 = the pre-22
                   // output exactly (the world slab alone — which has a visible EDGE when you zoom out).
                   // (Named skyStars, not stars: `stars` is already the world-slab Points mesh below.)
  extraSmudge = 0, // slice 15: 2 extra galaxy smudges (pixel sky); 0 = shader output identical to slice 12
  starSize = 1.6,  // slice 15: point size, DEVICE px. THE PIXEL-SKY LESSON (found by looking): a 1.6px
                   // star box-filtered into a 4px quantizer cell averages to ~16% and rounds to BLACK —
                   // 760 stars, zero visible. The pixel instance passes ~one-virtual-pixel (4+) so each
                   // star OWNS a cell; density was never the problem, survival was.
  art = 0,         // slice 16: the AUTHORED sky (gold cloud masses + cool wisps). 0 = shader output
                   // identical to slice 15 (the uExtraSmudge pattern, again).
  clearing = 0,    // slice 16: radial center clearing — the readability guardrail (0 = off).
  starVariety = null,  // slice 16: { sizes: [[px, weight], …], colors: [[hex, weight], …] } — mixed
                       // star sizes/colors from their OWN seeded stream (placement stays byte-stable).
                       // null = every star at starSize/THEME dim, exactly the slice-15 field.
  skySprites = null,   // slice 16: authored landmark sprites — [{ kind: 'planet'|'moon'|'sparkle'|
                       // 'galaxy', x, z, size, tint, phase?, tilt?, y? }]. One merged billboard mesh,
                       // one draw call. null = no layer at all.
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
      uExtraSmudge: { value: extraSmudge },                         // slice 15: pixel's 2 extra galaxies
      uStars:       { value: skyStars },                            // slice 22: the full-bleed field
      uStarTwinkle: { value: twinkle },                             //   "" : shares the look's twinkle amp
      uStarShape:   { value: starShape },                           // slice 22: square (pixel) vs round
      uArt:       { value: art },                                   // slice 16: authored-sky gate
      uClearing:  { value: clearing },                              // slice 16: readability guardrail
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
  /* TWINKLE PHASES (slice 15) — a SEPARATE LCG stream, deliberately. The main `rnd` stream feeds star
     positions and then continues into the glint placement below; inserting per-star draws into it would
     silently move every star and glint (a byte-stability break the captures would catch, but the right
     fix is to never cause it). Phases get their own seeded stream, so placement is untouched. */
  const rndPhase = lcg((seed ^ 0x7717) >>> 0);
  const phase = new Float32Array(starCount);
  for (let i = 0; i < starCount; i++) phase[i] = rndPhase();

  /* STAR VARIETY (slice 16) — per-star size + color attributes, drawn from a THIRD seeded stream
     (placement and phase streams untouched — the slice-15 discipline). With variety null the buffers
     are uniform-filled with the slice-15 values, so the shader change is output-identical. */
  const rndVar = lcg((seed ^ 0x51ab) >>> 0);
  const weightedPick = (list, u) => {
    let total = 0; for (const [, w] of list) total += w;
    let acc = 0;
    for (const [v, w] of list) { acc += w; if (u <= acc / total) return v; }
    return list[list.length - 1][0];
  };
  const sSize = new Float32Array(starCount);
  const sColor = new Float32Array(starCount * 3);
  const _dim = new THREE.Color(THEME.NEUTRAL.dim);
  const _vc = new THREE.Color();
  for (let i = 0; i < starCount; i++) {
    if (starVariety) {
      sSize[i] = weightedPick(starVariety.sizes, rndVar());
      _vc.set(weightedPick(starVariety.colors, rndVar()));
    } else {
      sSize[i] = starSize;
      _vc.copy(_dim);
    }
    sColor[i * 3] = _vc.r; sColor[i * 3 + 1] = _vc.g; sColor[i * 3 + 2] = _vc.b;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phase, 1));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(sSize, 1));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(sColor, 3));
  /* PointsMaterial → ShaderMaterial (slice 15): twinkle needs a clock + per-star phase, which the
     built-in material can't carry. uTwinkle = 0 reproduces the old output (see graph-star.vert). */
  const starMat = new THREE.ShaderMaterial({
    vertexShader: starVert,
    fragmentShader: starFrag,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uOpacity: { value: 0.5 },
      uTime:    { value: 0 },
      uTwinkle: { value: twinkle },
      // uColor/uSize became per-star attributes in slice 16 (variety); uniform-filled when it's off.
    },
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

  /* ---- SKY SPRITES (slice 16, PIXEL WONDER): the ringed planet, its moon, the cross sparkles,
     the tiny galaxies — ONE merged billboard mesh, one material, one draw call. Every sprite is
     AUTHORED (the consumer passes the list): a landmark composition, not a scatter. World-anchored
     at slab depth, so they parallax with the star layer when the camera pans — unlike the nebula
     quad, which is glued to the screen (that contrast IS the depth illusion). ---- */
  let skyMesh = null, skyMat = null, skyGeo = null;
  if (skySprites && skySprites.length) {
    const KIND = { planet: 0, moon: 1, sparkle: 2, galaxy: 3 };
    const N = skySprites.length;
    const kPos = new Float32Array(N * 4 * 3);
    const kCorner = new Float32Array(N * 4 * 2);
    const kSize = new Float32Array(N * 4);
    const kKind = new Float32Array(N * 4);
    const kTint = new Float32Array(N * 4 * 3);
    const kPhase = new Float32Array(N * 4);
    const kIndex = new Uint16Array(N * 6);
    const CORNERS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
    const _tint = new THREE.Color();
    skySprites.forEach((s, i) => {
      const kind = KIND[s.kind] ?? 2;
      const y = s.y ?? -depth - 1.5;
      const tilt = s.tilt ?? 0;                  // radians; baked into the corner basis (galaxies)
      const ct = Math.cos(tilt), st = Math.sin(tilt);
      _tint.set(s.tint);
      for (let c = 0; c < 4; c++) {
        const v = i * 4 + c;
        kPos[v * 3] = s.x; kPos[v * 3 + 1] = y; kPos[v * 3 + 2] = s.z;
        kCorner[v * 2]     = CORNERS[c][0] * ct - CORNERS[c][1] * st;
        kCorner[v * 2 + 1] = CORNERS[c][0] * st + CORNERS[c][1] * ct;
        kSize[v] = s.size;
        kKind[v] = kind;
        kTint[v * 3] = _tint.r; kTint[v * 3 + 1] = _tint.g; kTint[v * 3 + 2] = _tint.b;
        kPhase[v] = s.phase ?? 0;
      }
      const b = i * 4, ib = i * 6;
      kIndex[ib] = b; kIndex[ib + 1] = b + 1; kIndex[ib + 2] = b + 2;
      kIndex[ib + 3] = b; kIndex[ib + 4] = b + 2; kIndex[ib + 5] = b + 3;
    });
    skyGeo = new THREE.BufferGeometry();
    skyGeo.setAttribute('position', new THREE.BufferAttribute(kPos, 3));
    skyGeo.setAttribute('aCorner', new THREE.BufferAttribute(kCorner, 2));
    skyGeo.setAttribute('aSize', new THREE.BufferAttribute(kSize, 1));
    skyGeo.setAttribute('aKind', new THREE.BufferAttribute(kKind, 1));
    skyGeo.setAttribute('aTint', new THREE.BufferAttribute(kTint, 3));
    skyGeo.setAttribute('aPhase', new THREE.BufferAttribute(kPhase, 1));
    skyGeo.setIndex(new THREE.BufferAttribute(kIndex, 1));
    skyMat = new THREE.ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uTime:      { value: 0 },
        uTwinkle:   { value: twinkle },   // the instance's twinkle amp drives the sparkles too
        uIntensity: { value: 1.0 },
      },
    });
    skyMesh = new THREE.Mesh(skyGeo, skyMat);
    skyMesh.frustumCulled = false;
    skyMesh.renderOrder = -9;             // the star layer; flybys (-8) pass in front, the graph over all
    group.add(skyMesh);
  }

  /* PARALLAX_RATES (slice 9) — mirrored constants of the per-layer uPan multipliers in the frag. Exposed
     via debugLayerOffsets so a probe can assert the layers genuinely move at DIFFERENT rates when the
     camera pans (the whole point of the fake-depth trick — ortho translation gives zero real parallax). */
  const PARALLAX_RATES = { dustNear: 0.55, dustFar: 0.25, patches: 0.12, smudges: 0.08 };
  const PAN_SCALE = 0.06;   // world units → noise-domain units (tuned so a full pan reads as a gentle slide)

  /* update(now, panX, panZ) — panX/panZ optional (the camera's world position); omitted = no parallax
     (backward-compatible with the slice-5 call shape). */
  function update(now, panX, panZ) {
    nebulaMat.uniforms.uTime.value = now;
    starMat.uniforms.uTime.value = now;   // slice 15: the twinkle clock. The CONSUMER chooses the clock —
                                          // atlas hands pixel mode its 10fps-quantized tick (chunky retro
                                          // sparkle) and every other look the smooth one.
    if (skyMat) skyMat.uniforms.uTime.value = now;   // slice 16: the sparkles ride the same clock
    if (panX !== undefined) nebulaMat.uniforms.uPan.value.set(panX * PAN_SCALE, panZ * PAN_SCALE);
  }
  function debugLayerOffsets() {
    const p = nebulaMat.uniforms.uPan.value;
    const out = {};
    for (const [k, r] of Object.entries(PARALLAX_RATES)) out[k] = { x: p.x * r, y: p.y * r };
    return out;
  }
  /* REDUCED MOTION now gates TWO things: the nebula's autonomous drift (uDrift, slice 5) and the star
     twinkle (slice 15) — "stars stay lit, no oscillation": amplitude to 0, never opacity. The chosen
     amplitude is remembered so toggling reduced motion off restores the look's tuning. */
  let _twinkleAmp = twinkle;
  let _reduced = false;
  function _applyTwinkle() {
    starMat.uniforms.uTwinkle.value = _reduced ? 0 : _twinkleAmp;
    if (skyMat) skyMat.uniforms.uTwinkle.value = _reduced ? 0 : _twinkleAmp;   // sparkles freeze LIT too
    nebulaMat.uniforms.uStarTwinkle.value = _reduced ? 0 : _twinkleAmp;        // slice 22: procedural field too
  }
  function setReducedMotion(on) { _reduced = !!on; nebulaMat.uniforms.uDrift.value = on ? 0 : 1; _applyTwinkle(); }
  function setTwinkle(amp) { _twinkleAmp = amp; _applyTwinkle(); }
  function setAspect(a) { nebulaMat.uniforms.uAspect.value = a; }
  function dispose() {
    nebula.geometry.dispose(); nebulaMat.dispose();
    starGeo.dispose(); starMat.dispose();
    glintGeo.dispose(); glintMat.dispose();
    if (skyGeo) { skyGeo.dispose(); skyMat.dispose(); }
  }

  return {
    group, nebula, stars, glints, update, setReducedMotion, setTwinkle, setAspect, debugLayerOffsets, dispose,
    /* probe seam (gate AE/AG): the live GPU-bound twinkle state — proves reduced-motion actually zeroed
       the amplitude rather than "the screenshot looked still". */
    debugTwinkle: () => ({ amp: starMat.uniforms.uTwinkle.value, time: starMat.uniforms.uTime.value }),
    /* probe seams (slice 16): the art gates read GPU-bound state, sprites expose world anchors (gate AJ
       projects the planet through the live camera and compares its screen delta to a node's). */
    skyMesh,
    debugArt: () => ({ art: nebulaMat.uniforms.uArt.value, clearing: nebulaMat.uniforms.uClearing.value }),
    debugSprites: () => (skySprites ? skySprites.map((s) => ({ kind: s.kind, x: s.x, z: s.z, y: s.y ?? -depth - 1.5, size: s.size })) : []),
  };
}
