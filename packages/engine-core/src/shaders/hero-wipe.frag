/* ============================================================
   hero-wipe.frag — Lesson: createHeroWipe. A screen-space WIPE compositor between two
   already-rendered scenes: A (the from-scene) and B (the to-scene). Sibling to post-dive.frag
   (which zooms A into B for a fly-through); this one REVEALS B through a moving, cell-based
   pattern — the engine incarnation of tonight's IG dissolve language (GLOSSARY: dithered
   dissolve + AM/FM halftone).

   Both inputs arrive already beauty-graded (the JS renders each pack through the filmic pipeline
   into its own capture target first), so the shader's ONLY job is: for each output pixel, decide
   how much of B vs A to show, based on progress uT and the pixel's cell.

   ── THE ONE IDEA: localT ──
   A wipe is a moving BAND. Ahead of the band it is all A; behind it, all B; inside the band each
   cell makes its own A->B decision. dirp is the pixel's position along the wipe direction (0..1);
   localT is how far THIS pixel is through its own hand-off as the band sweeps past it (0 = still A,
   1 = now B). Every mode below is just a different way of turning localT into a coverage mask.

   ── THE MODES ──
     0 fade      — no cells at all: a plain eased global cross-fade. The baseline.
     1 ash       — FM (frequency-modulated): snap to a cell grid, hash each cell to a threshold;
                   the cell flips to B the instant localT passes its threshold. HARD step => whole
                   cells flip => visible squares crumbling like ash. Two grid scales fragment it.
     2 honeycomb — AM (amplitude-modulated) on a HEX grid: every hexagon grows from its centre as
                   localT climbs. Hexagons TILE, so at full size neighbours meet with no gaps and no
                   crossover seam — the reveal merges seamlessly. The print-premium wipe.
     3 halftone  — AM on a SQUARE grid of circular dots: dots grow with localT. Circles do NOT tile,
                   so we grow them PAST the half-cell to close the corner gaps (the overdraw fix from
                   the GLOSSARY halftone gotcha) — otherwise a dotted line of background leaks along
                   the fill edge.

   C++ anchor: a compositor kernel run once per output texel — two texture inputs, a handful of
   uniforms, one blended colour out. localT is a local parameter computed per fragment, exactly
   like a per-pixel lerp factor in a software blitter.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uA;       // from-scene (SDR, already beauty-graded)
uniform sampler2D uB;       // to-scene   (SDR, already beauty-graded)
uniform float uT;           // linear progress 0..1 (JS drives it; the shader eases where useful)
uniform float uMode;        // 0 fade, 1 ash, 2 honeycomb, 3 halftone
uniform float uDensity;     // cells across the aspect-corrected frame (bigger = smaller cells)
uniform float uBand;        // width of the sweeping transition band, in progress units (0..1)
uniform vec2  uDir;         // wipe direction (diagonal default); any 2D vector, sign picks the corner
uniform float uAspect;      // drawBuffer.x / y — keeps cells square and dirp geometrically true

/* 2D value hash -> 0..1. Cheap, stable per cell (same input => same threshold every frame). */
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

/* Hex metric on the pointy-top lattice below: 0 at a hex centre, 0.5 at the flat edge midpoint.
   A hexagon grown to radius 0.5 exactly TILES its neighbours — that is why honeycomb has no seam. */
float hexDist(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}

/* Nearest hex-cell local coordinate: two rectangular lattices interleaved by half a cell tile the
   plane with hexagons; the pixel belongs to whichever centre is closer. Returns the offset from
   that centre (so hexDist(hexGV(p)) is the pixel's distance within its hex). */
vec2 hexGV(vec2 p) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(p, r) - h;
  vec2 b = mod(p - h, r) - h;
  return dot(a, a) < dot(b, b) ? a : b;
}

void main() {
  vec3 A = texture2D(uA, vUv).rgb;
  vec3 B = texture2D(uB, vUv).rgb;

  /* MODE 0 — FADE (baseline). No cells, no direction: a plain eased global cross-fade. This is the
     graceful-degradation target for reduced motion too (the JS forces this mode there). */
  if (uMode < 0.5) {
    float e = uT * uT * (3.0 - 2.0 * uT);      // smoothstep cubic (matches easeInOut in wipe-machine.js)
    gl_FragColor = vec4(mix(A, B, e), 1.0);
    return;
  }

  /* ── shared wipe geometry (ash / honeycomb / halftone) ── */

  /* dirp: position along the wipe direction, remapped to 0..1 across the unit square. dmin/dmax are
     the direction's reach over the square's corners, so any direction vector normalises correctly
     (the default diagonal sweeps corner-to-corner). */
  vec2 nd = normalize(uDir);
  float dmin = min(0.0, nd.x) + min(0.0, nd.y);
  float dmax = max(0.0, nd.x) + max(0.0, nd.y);
  float dirp = (dot(vUv, nd) - dmin) / max(dmax - dmin, 1e-3);

  /* localT: the band has width uBand and its trailing edge is at progress uT*(1+bw). A pixel at
     dirp is fully A ahead of the band, fully B once the band has passed, and mid-handoff inside it.
     Band-limited BY CONSTRUCTION: clamp to 0..1 means solid A ahead and solid B behind — the dither
     never bleeds outside the moving band. */
  float bw = max(uBand, 1e-3);
  float localT = clamp((uT * (1.0 + bw) - dirp) / bw, 0.0, 1.0);

  /* Aspect-corrected cell space: multiply x by aspect so a "cell" is square (and a hex regular /
     a dot round) no matter the viewport shape. uDensity sets how many cells span the frame. */
  vec2 cuv = vec2(vUv.x * uAspect, vUv.y) * uDensity;

  float m;  // coverage: 1 => show B, 0 => show A
  if (uMode < 1.5) {
    /* MODE 1 — ASH (FM dissolve). Coarse + fine cell thresholds; the cell flips the instant localT
       passes its threshold. step() (not smoothstep) keeps the flip HARD so whole cells switch at
       once — that hard cell boundary is what reads as crumbling squares, not a soft gradient. */
    float thC = hash21(floor(cuv) + 0.5);
    float thF = hash21(floor(cuv * 2.3) + 11.7);
    float th  = thC * 0.68 + thF * 0.32;       // coarse dominates, fine fragments the edge
    m = step(th, localT);
  } else if (uMode < 2.5) {
    /* MODE 2 — HONEYCOMB (hex AM). Grow each hexagon from its centre. radius runs to 0.58 (a touch
       past the 0.5 tiling radius) so that by localT=1 even the hex CORNERS are covered — no residual
       seams. The small smoothstep is a fixed-width anti-alias on the growing edge (no derivatives
       needed, since cells are uniform in cuv space). */
    vec2 gv = hexGV(cuv);
    float radius = localT * 0.58;
    m = smoothstep(radius + 0.045, radius - 0.045, hexDist(gv));
    m *= smoothstep(0.0, 0.015, localT);       // guarantee pure A at the leading edge (localT==0)
  } else {
    /* MODE 3 — HALFTONE (circle AM). A square grid of dots that grow with localT. Circles cannot
       tile, so radius runs to 0.78 (past the 0.707 cell-corner distance) — the overdraw closes the
       corner gaps that would otherwise leave a dotted line of background along the fill edge
       (the GLOSSARY overdraw-past-boundary fix). Single-sided growth => no crossover seam. */
    vec2 gv = fract(cuv) - 0.5;
    float radius = localT * 0.78;
    m = smoothstep(radius + 0.045, radius - 0.045, length(gv));
    m *= smoothstep(0.0, 0.015, localT);
  }

  gl_FragColor = vec4(mix(A, B, m), 1.0);
}
