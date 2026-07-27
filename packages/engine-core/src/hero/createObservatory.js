/* ============================================================
   @lgr/engine-core — createObservatory (Lesson Q, scene 5).
   ------------------------------------------------------------
   A calm deep-sky hero: a drifting starfield with a few bright cross-glint stars.
   The quietest scene in the ring — it exists to be the BREATH between the busy ones
   (Constellation's graph, Aurora's curtains, Product's turntable).

     • Stars  — a THREE.Points field (starfield.vert/frag): per-star size, base
                brightness and twinkle phase. Density is biased toward a soft
                GALACTIC BAND so the field reads as a sky, not as noise.
     • Glints — a handful of bright stars with diffraction arms (graph-glint.vert/frag):
                the "seen through real optics" cue. Static by design (a twinkling
                cross fights the calm), so they need no reduced-motion gate.
     • Drift  — the whole field is ONE Group rotating very slowly. Stars + glints share
                the transform, so they drift together for free (no per-frame rebuild).

   THE LEAN CONSTRAINT (load-bearing, Lesson O): this pack imports NO city module —
   not night-sky.js, not createGraphAtmosphere. It reuses the SHADERS only, which are
   standalone .vert/.frag text: importing GLSL pulls zero JavaScript behind it, so the
   hero lib's 216 KB budget is untouched by the city. (createGraphAtmosphere was the
   other candidate — rejected: it's coupled to the atlas's diagram THEME + nebula/dust
   layers this scene doesn't want.) Technique borrowed, module not.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'dark' }.
   Reduced motion: handled by the DIRECTOR (it renders one static frame with elapsed=0,
   and every animated term here is a pure function of `elapsed` → a still sky at t=0).
   No hot allocation in update(): it sets two scalars and one uniform.
   C++ anchor: a particle system with an immutable, seed-generated vertex buffer — you
   upload the points ONCE and animate them entirely with uniforms on the GPU.
   ============================================================ */
import * as THREE from 'three';
import starfieldVert from '../shaders/starfield.vert';
import starfieldFrag from '../shaders/starfield.frag';
import glintVert from '../shaders/graph-glint.vert';
import glintFrag from '../shaders/graph-glint.frag';
import atmosphereVert from '../shaders/graph-atmosphere.vert';
import atmosphereFrag from '../shaders/graph-atmosphere.frag';

/* Tiny deterministic PRNG (mulberry32) — same seam as createConstellation: the sky must
   be IDENTICAL every boot or the probe's mean-RGB baseline drifts under us. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* L-N re-skin defaults (linear-sRGB THREE.Color, per the Lesson-N palette pattern). */
const STAR     = new THREE.Color(0.62, 0.72, 1.00);   // cool white-blue — the point field
const GLOW     = new THREE.Color(0.86, 0.92, 1.00);   // near-white — the bright cross-glints
const BACKDROP = new THREE.Color(0x080b1c);           // deep indigo — night sky, not dead black
const HAZE     = new THREE.Color(0x2a3f7a);           // the galactic band's lift tone (blue-violet)
const HAZE_ALT = new THREE.Color(0x1d5c6e);           // cool counter-tone for the patches (teal)

/* COUNTS ARE SKY-WIDE, NOT SCREEN-WIDE — the correction the probe forced.
   The camera sits INSIDE the shell and sees a ~52° cone, which is only ~8% of the sphere.
   The first cut authored 620 stars + 5 glints as if they'd all be on screen; ~30 stars
   landed in frame and (by odds) NO glints at all — the field read as an almost-empty
   black rectangle (probe: maxLum 24, below the >30 "did it render" gate). These counts are
   therefore ~12× the visible target on purpose. Points are one draw call and 3 floats each,
   so the off-screen 92% costs a vertex-shader invocation and nothing more — and keeping the
   scatter FULL-SPHERE (rather than only in front of the camera) is what lets the slow drift
   run for an entire session without ever running out of sky. */
export function createObservatory(core, {
  count     = 3400,   // sky-wide point stars → ~270 in frame
  glints    = 14,     // sky-wide cross-glints → ~1-2 in frame (a FEW bright stars, not a sparkle field)
  seed      = 0xA57E4,
  radius    = 62,     // the shell the stars scatter on (world units)
  band      = 0.55,   // 0..1 — how strongly density hugs the galactic band
  /* NOT the atlas's 0.055 — and the gap is a lesson, not a typo. There the nebula is a
     WHISPER BEHIND A GRAPH, composited in the atlas's own pipeline. Here it runs through the
     hero's ACES tonemap + dusk grade, which multiply it down hard: at 0.10 the haze landed
     ~0.001 linear, i.e. mathematically present and visually invisible (the first cut rendered a
     black rectangle). Same shader, different pipeline → different calibration. The sky is the
     SUBJECT in this scene, so it gets a subject's intensity. */
  nebula    = 1.15,       // peak luminance of the galactic haze
  star      = STAR,       // L-N re-skin: point-star colour
  glow      = GLOW,       // L-N re-skin: cross-glint colour
  backdrop  = BACKDROP,   // L-N re-skin: scene background
  haze      = HAZE,       // L-N re-skin: galactic-band lift tone
  hazeAlt   = HAZE_ALT,   // L-N re-skin: the band's cool counter-tone
} = {}) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color().copy(backdrop);   // clone: never capture the caller's ref

  const { x: w, y: h } = core.drawBuffer;
  const camera = new THREE.PerspectiveCamera(52, w / h, 0.1, 400);
  camera.position.set(0, 0, 0.001);   // we sit INSIDE the star shell, looking out
  camera.lookAt(0, 0, -1);

  /* ── The galactic HAZE: a screen-space nebula quad, painted behind everything ──
     Reusing graph-atmosphere.* — the atlas's own backdrop shader, whose slice-12 preset
     was already named OBSERVATORY. It takes plain colour uniforms, so this pack injects
     its OWN palette and imports no diagram THEME (shader reused, module not).

     This layer is what makes the scene a SKY rather than a black rectangle with dots. It
     also earns its place empirically: with stars alone the field's mean colour sat 2.4
     away from Constellation's — under the probe's >6 pairwise-distinctness floor, i.e. two
     scenes in the ring that a viewer couldn't tell apart at a glance. The haze gives
     Observatory its own blue, which is both the honest look and the passing sample.

     Clip-space quad (the vertex shader ignores the camera), so it does NOT join the
     drifting group: atmosphere shouldn't parallax — the stars supply the depth cue. */
  const nebulaMat = new THREE.ShaderMaterial({
    vertexShader:   atmosphereVert,
    fragmentShader: atmosphereFrag,
    depthTest:  false,
    depthWrite: false,
    uniforms: {
      uTime:      { value: 0 },
      uDrift:     { value: 1 },
      uIntensity: { value: nebula },
      uColorA:    { value: new THREE.Color().copy(backdrop) },   // deep tone
      uColorB:    { value: new THREE.Color().copy(haze) },       // the band's lift
      uColorC:    { value: new THREE.Color().copy(hazeAlt) },    // cool counter-tone
      uBg:        { value: new THREE.Color().copy(backdrop) },   // vignette fallback
      uAspect:    { value: w / h },
      uPan:       { value: new THREE.Vector2() },                // no camera pan in the hero
      uBandMul:   { value: 1.0 },
      uDustMul:   { value: 1.0 },
    },
  });
  const nebulaMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), nebulaMat);
  nebulaMesh.frustumCulled = false;   // clip-space: no meaningful world bounds
  nebulaMesh.renderOrder = -10;       // paints first, occludes nothing
  scene.add(nebulaMesh);

  /* One group holds stars + glints and does the slow drift. */
  const group = new THREE.Group();
  scene.add(group);

  const rng = mulberry32(seed);

  /* ── Point stars: scattered on a shell, density biased toward a galactic band ──
     A uniform sphere gives visual NOISE. Real skies have structure, so we pull each
     star's latitude toward the equator by `band` — cheap, and the eye reads "sky". */
  const sPos    = new Float32Array(count * 3);
  const sSize   = new Float32Array(count);
  const sBright = new Float32Array(count);
  const sPhase  = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const az = rng() * Math.PI * 2;
    /* Uniform-on-sphere latitude, then LERPed toward the band plane (y≈0) by `band`. */
    const uniformY = rng() * 2 - 1;
    const y = uniformY * (1 - band) + uniformY * Math.abs(uniformY) * band * 0.35;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const R = radius * (0.82 + rng() * 0.18);   // slight depth spread → parallax under drift
    sPos[i * 3]     = Math.cos(az) * r * R;
    sPos[i * 3 + 1] = y * R;
    sPos[i * 3 + 2] = Math.sin(az) * r * R;
    /* A few bright ones, many faint — a magnitude distribution (pow biases toward faint). */
    const mag = Math.pow(rng(), 2.2);
    sSize[i]   = 1.1 + mag * 3.4;
    sBright[i] = 0.22 + mag * 0.78;
    sPhase[i]  = rng() * Math.PI * 2;
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
  starGeo.setAttribute('aSize',    new THREE.BufferAttribute(sSize, 1));
  starGeo.setAttribute('aBright',  new THREE.BufferAttribute(sBright, 1));
  starGeo.setAttribute('aPhase',   new THREE.BufferAttribute(sPhase, 1));

  const starMat = new THREE.ShaderMaterial({
    vertexShader:   starfieldVert,
    fragmentShader: starfieldFrag,
    uniforms: {
      uTime:      { value: 0 },
      uTwinkle:   { value: 1 },      // elapsed=0 under reduced motion → a still sky anyway
      uSizeScale: { value: 1.7 },    // gl_PointSize is in device px — nudge up or the field reads as dust
      uColor:     { value: star.clone() },
      uNight:     { value: 1 },      // hero sky is always night (the city gates this by sun height)
      uMode:      { value: 0 },      // 0 = realistic soft round point
    },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    depthTest:   false,
  });
  const stars = new THREE.Points(starGeo, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  /* ── Cross-glints: billboarded quads with diffraction arms ────────────────────
     Same merged-quad build as the atlas atmosphere (one geometry, one material, one
     draw call): 4 verts + 6 indices per glint, the corner offset applied in view space
     by the vertex shader so they always face the camera. */
  const gPos    = new Float32Array(glints * 4 * 3);
  const gCorner = new Float32Array(glints * 4 * 2);
  const gSize   = new Float32Array(glints * 4);
  const gIndex  = new Uint16Array(glints * 6);
  const CORNERS = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]];
  for (let i = 0; i < glints; i++) {
    const az = rng() * Math.PI * 2;
    const y  = (rng() * 2 - 1) * 0.42;            // keep them off the poles (they'd sit out of frame)
    const r  = Math.sqrt(Math.max(0, 1 - y * y));
    const R  = radius * 0.9;
    const x = Math.cos(az) * r * R, yy = y * R, z = Math.sin(az) * r * R;
    const size = 2.6 + rng() * 1.8;               // world units at shell distance — restrained: a glint is
                                                  // a BRIGHT STAR seen through optics, not a lens flare
    for (let c = 0; c < 4; c++) {
      const v = i * 4 + c;
      gPos[v * 3] = x; gPos[v * 3 + 1] = yy; gPos[v * 3 + 2] = z;
      gCorner[v * 2] = CORNERS[c][0]; gCorner[v * 2 + 1] = CORNERS[c][1];
      gSize[v] = size;
    }
    const b = i * 4, ib = i * 6;
    gIndex[ib] = b; gIndex[ib + 1] = b + 1; gIndex[ib + 2] = b + 2;
    gIndex[ib + 3] = b; gIndex[ib + 4] = b + 2; gIndex[ib + 5] = b + 3;
  }
  const glintGeo = new THREE.BufferGeometry();
  glintGeo.setAttribute('position', new THREE.BufferAttribute(gPos, 3));
  glintGeo.setAttribute('aCorner',  new THREE.BufferAttribute(gCorner, 2));
  glintGeo.setAttribute('aSize',    new THREE.BufferAttribute(gSize, 1));
  glintGeo.setIndex(new THREE.BufferAttribute(gIndex, 1));

  const glintMat = new THREE.ShaderMaterial({
    vertexShader:   glintVert,
    fragmentShader: glintFrag,
    uniforms: {
      uColor:     { value: glow.clone() },
      uIntensity: { value: 1.7 },    // >1 so it lands above the bloom threshold (0.78 in HalfFloat) and blooms
    },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthWrite:  false,
    depthTest:   false,
  });
  const glintMesh = new THREE.Mesh(glintGeo, glintMat);
  glintMesh.frustumCulled = false;
  group.add(glintMesh);

  /* ── update — two rotation scalars + one uniform. No allocation. ───────────────
     The drift is SLOW on purpose (a sky, not a screensaver): ~1 revolution per 9 min.
     Every term is f(elapsed), so the director's reduced-motion path (update(0,0)) is a
     still frame with no extra branch here. */
  function update(dt, elapsed) {
    group.rotation.y = elapsed * 0.0115;
    group.rotation.x = Math.sin(elapsed * 0.021) * 0.045;
    starMat.uniforms.uTime.value = elapsed;
    nebulaMat.uniforms.uTime.value = elapsed;
    /* The haze is a clip-space quad, so it needs the live aspect to stay un-stretched.
       Read it off core.drawBuffer each frame rather than registering a core resizer —
       registerContentResizer() is push-only (no unregister), so a registered closure would
       outlive dispose() and the probe creates/disposes this pack in a loop. Two float
       writes; no allocation. */
    nebulaMat.uniforms.uAspect.value = core.drawBuffer.x / core.drawBuffer.y;
  }

  /* ── dispose — owns three geometries + three materials. No RTs, no textures. ─── */
  function dispose() {
    starGeo.dispose();
    starMat.dispose();
    glintGeo.dispose();
    glintMat.dispose();
    nebulaMesh.geometry.dispose();
    nebulaMat.dispose();
    group.remove(stars, glintMesh);
    scene.remove(group, nebulaMesh);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
