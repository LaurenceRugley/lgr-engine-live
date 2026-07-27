/* ============================================================
   @lgr/engine-core — createLivingInk (Lesson W, scene 10).
   ------------------------------------------------------------
   A pattern that GROWS. Nothing in this scene is authored: it runs a Gray-Scott reaction-diffusion
   chemistry on the GPU (living-ink-sim.frag explains the maths), and the coral/fingerprint/maze
   structures you see are what those two rules do when left alone. Seed it differently and you get a
   different organism; nudge feed/kill and you get a different species.

   ── PING-PONG, AND WHY IT EXISTS ──────────────────────────────────────────────
   A shader cannot read the texture it is writing to (the result would depend on which pixels the GPU
   happened to finish first — undefined by construction). So the simulation keeps TWO targets and swaps
   them every step: read A → write B, then read B → write A. That's the whole trick.
   C++ anchor: double-buffering a grid — you never mutate the array you're iterating.

   ── THE RTs ARE OURS, SO WE FREE THEM ─────────────────────────────────────────
   Both targets are pack-owned and disposed in dispose(). This is the discipline the Material Study
   lesson paid for: an RT that nobody frees is a full-screen leak per pack instance, and the probe's
   dispose-loop is what catches it. FloatType (not HalfFloat) matters here: the chemistry lives in a
   narrow band around f/k, and half-float's ~3 decimal digits let the state drift into a dead flat field
   after a few thousand steps. This is a SIMULATION, not a picture — it needs the precision.

   ── PERF ──────────────────────────────────────────────────────────────────────
   Cost = simRes² × itersPerFrame. The sim runs at a FIXED 256², independent of the display: R-D has no
   notion of screen pixels, and a bigger grid just means a finer organism, not a sharper image. The
   display pass then samples it up. Both `simRes` and `iters` are options — the honest dials.

   Reduced motion: the director calls update(0, 0) once, so the loop below never advances the chemistry —
   what renders is the SEEDED, settled field. Static by construction, no branch needed.
   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:true, tone:'dark' }.
   No hot allocation in update().
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import blitFrag from '../shaders/blit.frag';
import simFrag from '../shaders/living-ink-sim.frag';
import showFrag from '../shaders/living-ink-show.frag';

/* L-N re-skin defaults (linear).
   The GROUND is deliberately a deep PLUM, not the near-black it started as. Same lesson Liquid Metal
   learned an hour earlier: the probe put the first cut 3.8 from Observatory (floor 6), because a nearly
   black frame with a small bright thing in it IS Observatory, whatever the bright thing happens to be.
   A dark scene still has to own a HUE. Ink also needs a surface to be ink ON. */
const PAPER = new THREE.Color(0.105, 0.045, 0.150);   // deep plum ground
const INK   = new THREE.Color(0.62, 0.28, 0.95);      // violet pigment
const GLOW  = new THREE.Color(1.00, 0.94, 0.86);      // warm-white front. (Amber over violet made KHAKI —
                                                     // complementary hues muddy where they blend; a near-white
                                                     // front reads as wet pigment instead of sludge.)

/* Deterministic PRNG — the seed must be identical every boot or the probe's baseline drifts under us. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createLivingInk(core, {
  simRes = 256,     // the chemistry's grid. Not the screen's — R-D doesn't know what a screen is.
  iters  = 12,      // sim steps per frame. R-D evolves SLOWLY; 1 step/frame would look frozen.
  /* f and k ARE THE SPECIES — and the first pair I picked was the wrong animal. (0.0367, 0.0649) is in
     the SOLITON regime: the seeds survive as stable isolated spots and simply sit there, which rendered
     as eight dots on an empty field — technically a working simulation, visibly a dead one. (0.0545,
     0.062) is the CORAL-GROWTH regime: fronts advance, branch, and colonise the whole plane, which is
     the thing worth watching. The lesson generalises — in R-D the parameters aren't a tuning detail,
     they select which organism you get. */
  feed   = 0.0545,  // f
  kill   = 0.0620,  // k
  seed   = 0xC0FFEE,
  paper  = PAPER,   // L-N re-skin
  ink    = INK,
  glow   = GLOW,
} = {}) {
  const { renderer, runPass } = core;

  const rtOpts = {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
    type: THREE.FloatType,          // see the header: half-float lets the chemistry die
    wrapS: THREE.RepeatWrapping,    // the organism wraps — no edge artefacts, no visible border
    wrapT: THREE.RepeatWrapping,
  };
  let rtA = new THREE.WebGLRenderTarget(simRes, simRes, rtOpts);
  let rtB = new THREE.WebGLRenderTarget(simRes, simRes, rtOpts);

  /* ── SEED the chemistry ────────────────────────────────────────────────────────
     A = 1 everywhere (a full tank of food), B = 0 except in a few blots. Those blots are the only
     asymmetry in the entire system — everything you will ever see grows out of them. */
  const data = new Float32Array(simRes * simRes * 4);
  const rng = mulberry32(seed);
  for (let i = 0; i < simRes * simRes; i++) { data[i * 4] = 1.0; data[i * 4 + 3] = 1.0; }
  for (let blot = 0; blot < 26; blot++) {
    const cx = Math.floor(rng() * simRes), cy = Math.floor(rng() * simRes);
    const r = 3 + Math.floor(rng() * 5);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r) continue;
        const px = (cx + x + simRes) % simRes, py = (cy + y + simRes) % simRes;
        const idx = (py * simRes + px) * 4;
        data[idx] = 0.35;          // A depleted here
        data[idx + 1] = 0.92;      // B injected — the spark
      }
    }
  }
  const seedTex = new THREE.DataTexture(data, simRes, simRes, THREE.RGBAFormat, THREE.FloatType);
  seedTex.needsUpdate = true;

  /* Blit the seed into rtA (a DataTexture can't BE a render target, so it has to be drawn into one).
     Reuses blit.frag — GLSL lives in real files in this repo, never in a JS string. It carries .rgb, and
     the state only lives in .rg, so nothing is lost. */
  const seedMat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: blitFrag,
    uniforms: { uTex: { value: seedTex } },
  });
  runPass(seedMat, rtA);
  seedMat.dispose();

  /* ── The simulation step ─────────────────────────────────────────────────────── */
  const simMat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: simFrag,
    uniforms: {
      uState: { value: rtA.texture },
      uTexel: { value: new THREE.Vector2(1 / simRes, 1 / simRes) },
      uFeed:  { value: feed },
      uKill:  { value: kill },
      uDt:    { value: 1.0 },
    },
  });

  /* ── What the director renders: a quad that paints the current state ─────────── */
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const showMat = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: showFrag,
    uniforms: {
      uState: { value: rtA.texture },
      uTexel: { value: new THREE.Vector2(1 / simRes, 1 / simRes) },
      uPaper: { value: new THREE.Color().copy(paper) },
      uInk:   { value: new THREE.Color().copy(ink) },
      uGlow:  { value: new THREE.Color().copy(glow) },
    },
    depthTest: false, depthWrite: false,
  });
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(quadGeo, showMat);
  quad.frustumCulled = false;
  scene.add(quad);

  /* Warm the field up so the FIRST frame a viewer sees is a colony, not 26 dots on a void. R-D is slow:
     structure needs thousands of steps to spread, and a hero cannot open on an empty screen. This is also
     exactly the "settled pattern" the reduced-motion path wants — it renders this and never advances. */
  for (let i = 0; i < 1600; i++) step();

  function step() {
    simMat.uniforms.uState.value = rtA.texture;   // read A …
    runPass(simMat, rtB);                          // … write B
    const t = rtA; rtA = rtB; rtB = t;             // swap: no allocation, just two handles
    showMat.uniforms.uState.value = rtA.texture;
  }

  function update(dt, elapsed) {
    /* elapsed=0 → the director's reduced-motion single frame. dt is 0 there too, so guard on dt:
       the chemistry simply doesn't advance and the seeded, warmed field is what renders. */
    if (dt <= 0) return;
    for (let i = 0; i < iters; i++) step();
  }

  function dispose() {
    rtA.dispose();
    rtB.dispose();
    seedTex.dispose();
    simMat.dispose();
    showMat.dispose();
    quadGeo.dispose();
    scene.remove(quad);
  }

  return { scene, camera, update, dispose, usesBloom: true, tone: 'dark' };
}
