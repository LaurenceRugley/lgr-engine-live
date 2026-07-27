/* ============================================================
   @lgr/engine-core — createLetterpress (Lesson AA, the STUDIO print-look hero).
   ------------------------------------------------------------
   The ring's missing BRIGHT editorial tone (it was 5 dark / 1 bright when this was briefed). A warm
   kraft-paper world with a large serif letterform pressed INTO the sheet — a letterpress DEBOSS — lit by
   a low raking light that slowly sweeps, so the impression breathes the way a real pressed sheet does
   under a lamp. It is the scene that sits on the showcase's own kraft/editorial ground instead of
   fighting it, and the calm one a prospect reads copy over.

   ── WHY A BAKED-TEXT MASK, NOT AN SDF ──
   The letterform is real type, drawn once into a <canvas> with the browser's own serif renderer and
   uploaded as a coverage mask (white glyph on black). That is "reuse-first": no hand-authored SDF, no
   font-geometry dependency, and the curves are a genuine typeface's. letterpress.frag reads the mask as a
   heightfield — its gradient is the wall of the impression — and rakes light across it (see that file's
   header for the three moves). This shader outputs LINEAR light: hero packs are tonemapped + graded by the
   shared post-filmic pass downstream, so colours are authored linear here (the createLivingInk convention).

   ── WHY usesBloom:false, and a warm `filmic` override ──
   There are no lights to bleed on a sheet of paper — bloom would just fog it (the createLattice argument).
   And the ring is graded at NOON (a cool #d6e6f4 slate — see createHeroDirector invariant 3); a kraft page
   under that cast goes grey. So this pack opts out via `filmic`, taking a warm neutral grade instead. Both
   are the same calls createLattice makes for the same reasons.

   Pack contract: { scene, camera, update(dt,elapsed), dispose(), usesBloom:false, tone:'bright', filmic }.
   Reduced motion: every animated term is f(elapsed); the director's static frame (elapsed=0) is a fully
   pressed, fully lit still. No hot allocation in update() (uniforms are mutated in place).
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import letterpressFrag from '../shaders/letterpress.frag';

/* Colours in LINEAR (see the header). The page is a genuinely warm KRAFT — deliberately warmer/more
   saturated than createLattice's cooler blueprint cream, so the two bright scenes stay mean-RGB DISTINCT
   for the ring's pairwise-distinctness gate (the same distinctness discipline Lattice's header describes
   against Constellation). Kraft = high red, low blue; that spread is the separation. */
const PAPER = new THREE.Color(0.91, 0.84, 0.71);   // warm CREAM paper. Iterated per DESIGN's L-AA verdict
                                                   // (PASS + optional tint note): the first ship
                                                   // (0.88,0.79,0.58) read olive/khaki, so this lifts blue
                                                   // 0.58→0.71 and brightens toward the showcase's paper tone —
                                                   // a warm sheet, not a gold one. LIGHTER than Lattice's
                                                   // DEEP-graded tan, so the two bright scenes stay mean-RGB
                                                   // distinct (the gap actually GROWS — verified on the probe).
const INK   = new THREE.Color(0.045, 0.038, 0.030); // warm near-black — ink pooled in the impression

/* Warm neutral grade — escapes the ring's cool noon slate so the kraft reads as paper under a lamp.
   A gain slightly below 1 keeps the raised bright page off pure-white; gentle contrast seats the deboss
   without crushing the tooth; saturation held (the kraft warmth IS the identity — don't wash it out). */
const LETTERPRESS_FILMIC = {
  /* The grade TINT is a per-channel multiply, so a low blue here is what actually casts the sheet olive —
     the paper colour can't out-argue a grade that pulls blue down. L-AA polish lifts blue 0.86→0.92 (and
     green a hair) to de-khaki toward the showcase's cream, keeping a gentle warm bias (blue still < 1). */
  tint:     new THREE.Color(0.98, 0.95, 0.92),
  lift:     new THREE.Color(0, 0, 0),
  sat:      1.0,
  contrast: 1.12,
};

/* Bake `text` into a coverage mask: white glyph on black, on a tightly-cropped canvas whose aspect the
   shader uses to place the letterform without distortion. 1024px tall is comfortably above the on-screen
   size at DPR-2, so the deboss walls stay crisp. */
function bakeGlyph(text, fontStack, weight) {
  const REF = 820;                                   // reference glyph height in px
  const probe = document.createElement('canvas').getContext('2d');
  probe.font = `${weight} ${REF}px ${fontStack}`;
  const m = probe.measureText(text);
  const ascent  = m.actualBoundingBoxAscent  || REF * 0.72;
  const descent = m.actualBoundingBoxDescent || REF * 0.24;
  const glyphW  = (m.actualBoundingBoxLeft || 0) + (m.actualBoundingBoxRight || m.width);
  const pad = REF * 0.16;
  const W = Math.max(2, Math.ceil(glyphW + pad * 2));
  const H = Math.max(2, Math.ceil(ascent + descent + pad * 2));

  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `${weight} ${REF}px ${fontStack}`;
  ctx.fillText(text, W / 2, pad + ascent);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;               // a mask, not a photo — no sRGB decode
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = THREE.ClampToEdgeWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return { tex, w: W, h: H };
}

export function createLetterpress(core, {
  text       = '&',            // the specimen: a single serif ampersand — the classic typographic OBJECT,
                               // large and uncluttered so overlaid dark copy stays legible (tone:'bright')
  fontStack  = 'Georgia, "Times New Roman", "Times", serif',   // a serif present on every target platform
  weight     = 700,
  textScale  = 0.62,           // letterform height as a fraction of screen height
  maxWidth   = 0.82,           // ...but never wider than this fraction of screen WIDTH (contain on portrait
                               // phones — a min() of the two axes; slack on desktop so that frame is unchanged)
  paper      = PAPER,          // LINEAR kraft page
  ink        = INK,            // LINEAR impression ink
  grain      = 0.05,           // paper tooth (0 = a dead-flat sheet)
  inkFill    = 0.30,           // ink in the body of the impression — LOW so copy stays legible on top
  inkEdge    = 0.55,           // ink concentrated at the bitten edges (where real ink pools)
  relief     = 0.32,           // deboss depth (smaller = steeper walls, deeper press)
  sweepAmp   = 0.55,           // how far the raking light's azimuth swings (radians)
  sweepSpeed = 0.16,           // how fast it breathes (slow, confident)
  filmic     = LETTERPRESS_FILMIC,   // warm grade; pass null to take the ring's cool noon grade
} = {}) {
  const scene = new THREE.Scene();
  /* Fullscreen quad in clip space — no projection needed (fullscreen.vert passes corners through). The
     orthographic camera exists only because three requires *a* camera to .render(). */
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const glyph = bakeGlyph(text, fontStack, weight);

  const uniforms = {
    uTime:       { value: 0 },
    uResolution: { value: new THREE.Vector2(core.drawBuffer.x, core.drawBuffer.y) },
    uText:       { value: glyph.tex },
    uTextAspect: { value: new THREE.Vector2(glyph.w, glyph.h) },
    uTextScale:  { value: textScale },
    uMaxWidth:   { value: maxWidth },
    uPaper:      { value: new THREE.Color().copy(paper) },   // clone: never capture the caller's ref
    uInk:        { value: new THREE.Color().copy(ink) },
    uGrain:      { value: grain },
    uInkFill:    { value: inkFill },
    uInkEdge:    { value: inkEdge },
    uRelief:     { value: relief },
    uSweepAmp:   { value: sweepAmp },
    uSweepSpeed: { value: sweepSpeed },
    uBuild:      { value: 1 },        // build-in press progress; 1 = fully stamped (byte-identical default)
  };

  const material = new THREE.ShaderMaterial({
    vertexShader:   fullscreenVert,
    fragmentShader: letterpressFrag,
    uniforms,
    depthTest:  false,
    depthWrite: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const quad = new THREE.Mesh(geo, material);
  quad.frustumCulled = false;
  scene.add(quad);

  /* update — advance the raking sweep, keep the box aspect current. Mutates cached objects only (no alloc
     in the loop — engine invariant 7). uTime = elapsed makes every term f(elapsed), so elapsed=0 is a still. */
  function update(dt, elapsed) {
    uniforms.uTime.value = elapsed;
    uniforms.uResolution.value.set(core.drawBuffer.x, core.drawBuffer.y);
  }

  function dispose() {
    geo.dispose();
    material.dispose();
    glyph.tex.dispose();
    scene.remove(quad);
  }

  /* build-in casting via the SHADER path (createBuildIn detects setBuild): a fullscreen deboss can't be
     transform-assembled (no mesh), so the mark stamps into the paper by ramping uBuild — the ampersand
     punched in with an impact bite. setBuild(1) is the un-built default, so a scene that never builds is
     byte-identical. */
  function setBuild(v) { uniforms.uBuild.value = v < 0 ? 0 : v > 1 ? 1 : v; }

  return { scene, camera, update, dispose, usesBloom: false, tone: 'bright', filmic, setBuild };
}
