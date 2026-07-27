// graph-atmosphere.frag — VIZ SLICE 5: a 3-octave FBM nebula at 2-6% luminance, plus a radial vignette.
//
// "The background does work." A graph on a flat black rectangle reads as a graph on a webpage; the same
// graph over a faint drifting nebula reads as something floating in space (section 8). The entire effect
// lives between 2% and 6% luminance -- if you can SEE it as a texture, it is too strong. It should only
// register when it is removed.
//
// FBM = fractal Brownian motion: sum octaves of value noise, each at double the frequency and roughly
// half the amplitude. Three octaves is plenty here because we are painting a whisper, not terrain.
// The noise is first-party (hash -> value noise -> fbm); no texture, no dependency, ~free.
//
// uDrift is scaled by the reduced-motion gate on the JS side (it goes to 0), so the nebula holds
// perfectly still for anyone who asked for that -- while the vignette and the tone remain, because
// those are composition, not motion.

precision highp float;

uniform float uTime;
uniform float uDrift;      // 0 = frozen (prefers-reduced-motion). Gates AUTONOMOUS drift only --
                           // uPan parallax stays live under reduced motion (it is camera-driven state).
uniform float uIntensity;  // peak luminance of the nebula (base band 0.02-0.06)
uniform vec3  uColorA;     // deep tone (THEME surface)
uniform vec3  uColorB;     // lift tone (THEME guide -- the muted plum from dusk's hemisphere)
uniform vec3  uColorC;     // cool counter-tone for patches/smudges (THEME jhat family, slice 9)
uniform vec3  uBg;         // the page background: what the vignette falls back to
uniform float uAspect;
uniform vec2  uPan;
uniform float uBandMul;   // slice 12: OBSERVATORY turns the sky up via params, not a shader fork
uniform float uDustMul;
uniform float uExtraSmudge;  // slice 15 (PIXEL sky): two MORE galaxy smudges, gated by this uniform --
                             // 0.0 (the default) multiplies them away entirely, so the shared shader
                             // stays output-identical for harbor/observatory (params, never a fork).
uniform float uArt;          // slice 16 (PIXEL WONDER): the AUTHORED sky -- gold cloud masses + cool
                             // wisps. 0.0 = every art term multiplied away (the uExtraSmudge pattern).
uniform float uClearing;     // slice 16: radial CLEARING behind the graph center -- the readability
                             // guardrail. Scales ALL additive sky terms down toward the middle so the
                             // art can be loud at the edges while nodes/labels keep their contrast.
uniform float uStars;        // slice 22 (FULL-BLEED SKY): density of the PROCEDURAL screen-space
                             // starfield. 0 = off (the pre-22 look). WHY IT EXISTS: the world-space star
                             // slab is a DISC of radius ~17 -- zoom out and its edge lands inside the
                             // frame, so the corners go black and the sky reads as "one patch" (exactly
                             // the owner's complaint). A screen-space field cannot have an edge: it is
                             // generated per pixel, so it reaches every corner at every zoom, forever.
                             // The world slab STAYS -- it is what actually parallaxes; this fills the sky.
uniform float uStarTwinkle;  // slice 22: scintillation amplitude for the procedural field (0 = frozen)
uniform float uStarShape;    // slice 22: 1 = SQUARE stars (pixel — a square is the only shape that
                             // survives the box filter + DB32 snap), 0 = ROUND stars (harbor/observatory:
                             // the photographic looks, where a square star reads as a rendering bug).
                             // Found by LOOKING at the harbor capture: the same field, two substrates.        // camera pan (world xz, scaled by JS) -- each layer samples it at its own
                           // RATE, faking depth parallax under an orthographic camera (real depth gives
                           // none on translation; rate-scaled domain offsets do). Rates mirror
                           // PARALLAX_RATES in graph-atmosphere.js.

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise: hash the four lattice corners, smoothstep-interpolate between them.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

/* --- SLICE 16: THE AUTHORED SKY (all gated by uArt) ---
   goldRamp maps cloud density to DB32's gold/orange ramp. The stops ARE palette entries, on purpose:
   the quantizer then snaps the smooth gradient into 3-5 VISIBLE BANDS that land on real swatches --
   banding as the pixel-art aesthetic (the slice-15 comet lesson, inverted: instead of fighting the
   palette, author the pre-quantize colors to fall ON its steps). */
vec3 goldRamp(float t) {
  vec3 c0 = vec3(0.271, 0.157, 0.235);   // #45283c deep brown-violet (shadow floor)
  vec3 c1 = vec3(0.400, 0.224, 0.192);   // #663931
  vec3 c2 = vec3(0.561, 0.337, 0.231);   // #8f563b
  vec3 c3 = vec3(0.875, 0.443, 0.149);   // #df7126 burnt orange
  vec3 c4 = vec3(0.851, 0.627, 0.400);   // #d9a066 amber
  vec3 c5 = vec3(0.933, 0.765, 0.604);   // #eec39a lit gold rim
  float s = clamp(t, 0.0, 1.0) * 5.0;
  vec3 col = mix(c0, c1, clamp(s, 0.0, 1.0));
  col = mix(col, c2, clamp(s - 1.0, 0.0, 1.0));
  col = mix(col, c3, clamp(s - 2.0, 0.0, 1.0));
  col = mix(col, c4, clamp(s - 3.0, 0.0, 1.0));
  col = mix(col, c5, clamp(s - 4.0, 0.0, 1.0));
  return col;
}

vec3 coolRamp(float t) {
  vec3 c0 = vec3(0.247, 0.247, 0.455);   // #3f3f74
  vec3 c1 = vec3(0.357, 0.431, 0.882);   // #5b6ee1 dusty blue
  vec3 c2 = vec3(0.388, 0.608, 1.000);   // #639bff
  float s = clamp(t, 0.0, 1.0) * 2.0;
  vec3 col = mix(c0, c1, clamp(s, 0.0, 1.0));
  return mix(col, c2, clamp(s - 1.0, 0.0, 1.0));
}

/* --- SLICE 22: THE PROCEDURAL STARFIELD (screen space, edge-to-edge, endless) ---
   The trick is the classic one: chop the plane into cells, put at most ONE star in each, and hash the
   cell to decide where it sits and how bright it is. Because the cells are generated on demand there is
   no array, no bound, and no edge -- the field is as big as the screen, at any zoom.

   PARALLAX WITHOUT DEPTH: an orthographic camera gives zero real parallax on translation (the slice-9
   lesson), so depth is FAKED by sampling two layers at different uPan rates -- the near layer slides
   more than the far one as you pan, and the eye reads the difference as distance.

   THE QUANTIZER RULE (slice 15's star lesson, again): a star must own a whole virtual pixel or the box
   filter averages it into the background and DB32 rounds it to black. So these are drawn as small SQUARE
   cores (a smoothstep on the chebyshev distance), not gaussian points -- a square survives. */
float starLayer(vec2 uv, float cells, float density, float bright, float tw) {
  vec2 gv = uv * cells;
  vec2 id = floor(gv);
  vec2 f  = fract(gv) - 0.5;
  float h = hash(id);
  if (h > density) return 0.0;                       // most cells are empty -- stars are RARE, not a grid
  vec2 off = vec2(hash(id + 3.7) - 0.5, hash(id + 9.1) - 0.5) * 0.7;   // jitter off the cell centre
  vec2 q = f - off;
  float dSq = max(abs(q.x), abs(q.y));      // chebyshev -> a SQUARE star (pixel: survives the quantizer)
  float dRo = length(q);                     // euclidean -> a ROUND star (the photographic looks)
  float d = mix(dRo, dSq, uStarShape);
  /* LOOK-ROUND 2: at 0.10-0.24 of a cell the stars quantized into 8-16px BLOCKS and the sky read as
     confetti, not distance. A star must be BRIGHT (to clear DB32's black floor) and SMALL (to read as
     far away) — those pull in opposite directions, and the resolution is: keep the brightness, shrink
     the core to ~one virtual pixel. Big and bright is snow; small and bright is a star. */
  float size = 0.035 + 0.05 * hash(id + 17.3);
  float core = 1.0 - smoothstep(size, size + 0.035, d);
  float phase = hash(id + 41.7);
  float t = 1.0 + tw * 0.5 * (sin(uTime * (0.9 + phase * 1.3) + phase * 6.28318)
                            + sin(uTime * 1.618 + phase * 4.0));
  return core * bright * (0.45 + 0.55 * hash(id + 5.5)) * clamp(t, 0.0, 2.0);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * vnoise(p);
    p *= 2.02;      // not exactly 2.0: an irrational-ish step keeps octaves from aligning into grids
    amp *= 0.5;
  }
  return v;
}

/* cloudField -- ONE billowed noise sample shared by every authored mass (fbm is the expensive part;
   masks are cheap). billow = 1-|2n-1| squared: ridged peaks read as lit cumulus, not fog. The three
   gaussian masks are the COMPOSITION -- a diagonal river of cloud sweeping the upper-right corner
   region, a counter-mass lower-left, a small connector -- authored, deliberately NOT centered. */
float cloudField(vec2 p, float t) {
  // SLICE 17 ("cleaner, smoother" — owner verdict on 16): the noise domain dropped 2.3 → 1.5 and the
  // warp got gentler/coarser, so the DB32 bands follow the big MASS SHAPES instead of tracing every
  // noise wrinkle into speckle; the masses themselves grew softer (smaller gaussian exponents). Same
  // composition, same palette — fewer, larger, dreamier forms.
  vec2 d = p * 1.5 + vec2(t * 0.004, t * -0.003);
  float n = fbm(d + fbm(d * 1.25) * 0.38);
  float billow = 1.0 - abs(2.0 * n - 1.0);
  billow *= billow;
  vec2 q1 = p - vec2(0.62, -0.34);   // main mass: upper-right, long axis on the diagonal
  vec2 a1 = vec2(0.803, 0.596);
  float m1 = exp(-pow(dot(q1, a1), 2.0) * 1.7 - pow(dot(q1, vec2(-a1.y, a1.x)), 2.0) * 8.0);
  vec2 q2 = p - vec2(-0.68, 0.42);   // counter-mass: lower-left, smaller
  vec2 a2 = vec2(0.921, 0.390);
  float m2 = exp(-pow(dot(q2, a2), 2.0) * 2.8 - pow(dot(q2, vec2(-a2.y, a2.x)), 2.0) * 10.5);
  vec2 q3 = p - vec2(0.05, -0.55);   // connector wisp toward the top edge
  float m3 = exp(-dot(q3, q3) * 5.5);
  return (m1 * 1.15 + m2 * 0.8 + m3 * 0.5) * billow;
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;                       // square the noise domain so clouds aren't stretched on wide screens

  vec2 q = p * 2.6 + vec2(uTime * 0.006 * uDrift, uTime * -0.004 * uDrift);
  float n = fbm(q + fbm(q * 1.7) * 0.35);   // domain warp: one fbm bends the other -> wispy, not blobby

  // GALAXY DUST (slice 8; slice 9 makes it TWO PARALLAX LAYERS) -- finer-octave fields drifting slower
  // than the nebula, each sampling uPan at its OWN rate: the near layer slides more than the far one as
  // the camera pans, and the depth illusion appears the moment the graph moves. Cubed: grain, not cloud.
  vec2 qd1 = p * 6.3 + uPan * 0.55 + vec2(uTime * 0.0022 * uDrift, uTime * 0.0016 * uDrift);
  vec2 qd2 = p * 10.7 + uPan * 0.25 + vec2(uTime * -0.0013 * uDrift, uTime * 0.0009 * uDrift);
  float dust = fbm(qd1);
  dust = dust * dust * dust * 0.35 * uDustMul;
  float dust2 = fbm(qd2);
  dust2 = dust2 * dust2 * dust2 * 0.22 * uDustMul;

  // NEBULA PATCHES (slice 9, owner-authorized notch-up) -- 2-3 larger soft blobs: a VERY low-frequency
  // field thresholded high, so only its rare peaks surface, tinted toward the cool counter-tone. Mid
  // parallax rate: they sit between the dust sheets.
  vec2 qp = p * 1.15 + uPan * 0.12 + vec2(uTime * 0.003 * uDrift, 0.0);
  float wisp = smoothstep(0.62, 0.85, fbm(qp)) * 0.5 * uDustMul;

  // GALAXY SMUDGES (slice 9) -- two tiny distant ellipses: rotated anisotropic gaussians with a faint
  // fbm arm texture. Fixed constants (one sky, deterministic), slow parallax (they are the far field).
  vec2 ps = p + uPan * 0.08;
  vec2 g1 = vec2((ps.x - 0.31) * 0.766 + (ps.y - 0.22) * 0.643, (ps.x - 0.31) * -0.643 + (ps.y - 0.22) * 0.766);
  float sm1 = exp(-(g1.x * g1.x * 90.0 + g1.y * g1.y * 900.0)) * (0.7 + 0.3 * fbm(g1 * 24.0));
  vec2 g2 = vec2((ps.x + 0.36) * 0.5 - (ps.y + 0.27) * 0.866, (ps.x + 0.36) * 0.866 + (ps.y + 0.27) * 0.5);
  float sm2 = exp(-(g2.x * g2.x * 140.0 + g2.y * g2.y * 1200.0)) * (0.7 + 0.3 * fbm(g2 * 24.0));
  float smudge = (sm1 + sm2) * 0.55;
  // EXTRA SMUDGES (slice 15, pixel-only via uExtraSmudge): a big soft one upper-left, a small tilted one
  // lower-right -- placed OFF the graph's center mass so they live in the sky gaps the quantizer shows.
  vec2 g3 = vec2((ps.x + 0.42) * 0.906 + (ps.y - 0.30) * 0.423, (ps.x + 0.42) * -0.423 + (ps.y - 0.30) * 0.906);
  float sm3 = exp(-(g3.x * g3.x * 60.0 + g3.y * g3.y * 520.0)) * (0.7 + 0.3 * fbm(g3 * 18.0));
  vec2 g4 = vec2((ps.x - 0.44) * 0.259 - (ps.y + 0.33) * 0.966, (ps.x - 0.44) * 0.966 + (ps.y + 0.33) * 0.259);
  float sm4 = exp(-(g4.x * g4.x * 170.0 + g4.y * g4.y * 1500.0)) * (0.7 + 0.3 * fbm(g4 * 24.0));
  smudge += (sm3 * 0.7 + sm4 * 0.5) * uExtraSmudge;

  // GALACTIC BAND -- SCALES the fields (boost, not flat light). SLICE-9 CEILING: the owner asked for a
  // richer sky ("a little more... nebula and galaxies"), so the restraint cap moves ~10% -> ~18%
  // (boost <= 2.2 x the 0.06 base + patches). The judgment line stands: a beautiful telescope sky BEHIND
  // a graph, never nebula wallpaper -- the graph's quietest node must still outrank the sky's loudest px.
  float bandY = p.x * -0.342 + p.y * 0.940;      // rotate ~110 degrees: band runs lower-left -> upper-right
  float band  = exp(-bandY * bandY * 18.0);
  float boost = 1.0 + band * 1.2 * uBandMul;

  /* THE PROCEDURAL FIELD (slice 22): three layers at different cell sizes and parallax rates -- far
     (dense, faint, barely moves), mid, and a sparse bright foreground. Sampled in the SCREEN-SPACE uv,
     so it fills the frame corner to corner no matter where the camera is or how far it is zoomed out. */
  vec3 stars = vec3(0.0);
  if (uStars > 0.0) {
    vec2 sp = p;
    /* LOOK-ROUND 1 (measured, not guessed): at 26 cells across the frame, a screen CORNER contains ~2
       cells — at 16% occupancy that is 0.3 expected stars, so corners came up EMPTY (max luminance 18)
       and the "full-bleed" sky still had holes. Finer cells + higher occupancy make coverage a
       certainty rather than a coin flip: the far layer now lays ~45 cells across at 30%. */
    float far  = starLayer(sp + uPan * 0.05, 46.0, 0.22, 0.50, uStarTwinkle * 0.5);
    float mid  = starLayer(sp + uPan * 0.14, 27.0, 0.13, 0.80, uStarTwinkle);
    float near = starLayer(sp + uPan * 0.30, 13.0, 0.06, 1.15, uStarTwinkle);
    float s = (far + mid + near) * uStars;
    // A touch of colour: most stars pale-blue-white, a few warm -- the same DB32 family the sprites use.
    stars = mix(vec3(0.796, 0.859, 0.988), vec3(0.933, 0.765, 0.604), step(0.82, hash(floor(sp * 15.0)))) * s;
  }

  // Radial vignette: full nebula at the centre, falling to bare background at the corners.
  float r   = length(p);
  float vig = 1.0 - smoothstep(0.15, 0.95, r);

  // SLICE 16 -- THE CLEARING (readability guardrail): every additive sky term scales DOWN toward the
  // graph's center. 1.0 everywhere when uClearing = 0; at 0.7 the middle drops to ~30% while r > 0.6
  // keeps full art. The art lives at the edges; the data lives in the middle. Both win.
  float clearing = 1.0 - uClearing * (1.0 - smoothstep(0.14, 0.62, r));

  // SLICE 16 -- THE GOLD NEBULA. Density -> DB32 ramp; a fake light direction (upper-left) via a
  // second field sample: the density DIFFERENCE along the light ray brightens the lit flank of every
  // billow (rim light), which is what sells "lit cumulus in space" instead of "orange fog".
  // Its OWN gentle falloff (artVig), NOT the house vignette -- vig hits 0 exactly where this art
  // lives (the corners), and a corner-dead art layer would be pointless.
  vec3 gold = vec3(0.0);
  vec3 cool = vec3(0.0);
  if (uArt > 0.0) {
    float artVig = 1.0 - smoothstep(0.85, 1.3, r);
    vec2 L = vec2(-0.55, 0.835);
    float cd  = cloudField(p, uTime * uDrift);
    float cdL = cloudField(p + L * 0.05, uTime * uDrift);
    float rim = clamp((cd - cdL) * 2.4, -0.3, 1.0);
    // ROUND-2 (judged by looking): most of a cloud lives in the ramp's LOWER half (brown-violet ->
    // burnt orange); only dense cores reach amber and only lit rims touch the pale gold. The first
    // pass ran shade too hot and the whole sky terraced into an elevation map.
    float shade = clamp(cd * 0.8 + rim * 0.4, 0.0, 1.0);
    gold = goldRamp(shade) * smoothstep(0.16, 0.72, cd) * artVig * 0.62;
    // COOL WISPS: two small counter-tone masses, well away from the gold (left edge / lower-right).
    // Same billow sample -- masks are the only new cost.
    vec2 w1 = p - vec2(-0.72, -0.30);
    vec2 w2 = p - vec2(0.55, 0.48);
    float wd = (exp(-dot(w1, w1) * 9.0) * 0.9 + exp(-dot(w2, w2) * 12.0) * 0.7)
             * (1.0 - abs(2.0 * fbm(p * 3.4 + vec2(17.3, 9.1) + uPan * 0.2) - 1.0));
    // ROUND-2: the first pass quantized these into flat pale-blue LAKES. Wisps are an accent --
    // threshold high (only the densest core survives) and keep the amplitude at a murmur.
    cool = coolRamp(clamp(wd * 0.9, 0.0, 1.0)) * smoothstep(0.22, 0.75, wd) * artVig * 0.4;
    cool += vec3(0.843, 0.482, 0.729) * exp(-dot(w2, w2) * 16.0) * wd * 0.12 * artVig;
  }

  // ROUND-2 PURITY RULE (the green-terrace lesson): the plum/blue dust ADDING UNDER the gold masses
  // desaturated them toward olive, and DB32's nearest-neighbor then painted the sky GREEN. Inside an
  // authored mass the authored color OWNS the pixel — the legacy layers yield (suppress), instead of
  // mixing into a third hue nobody chose (the don't-average discipline, applied to a palette).
  float artOwn = 1.0 - clamp((gold.r + gold.g + cool.b) * 1.8, 0.0, 0.95) * step(0.001, uArt);   // round 3: deeper — the last olive fringe was residual dust under the gold
  vec3 neb = mix(uColorA, uColorB, n);
  vec3 col = uBg
           + (neb * (n * n) * uIntensity * boost * vig * artOwn            // n*n biases dark: void + wisp
           + uColorB * dust  * uIntensity * boost * vig * artOwn           // near dust sheet (fast parallax)
           + mix(uColorB, uColorC, 0.5) * dust2 * uIntensity * boost * vig * artOwn // far dust sheet
           + mix(uColorB, uColorC, 0.7) * wisp * uIntensity * 1.6 * vig * artOwn   // nebula patches
           + mix(uColorC, vec3(1.0), 0.35) * smudge * uIntensity * 1.8 * vig * artOwn // galaxy smudges
           + (gold + cool) * uArt                                          // slice 16: the authored sky
           + stars                                                          // slice 22: the full-bleed field
           ) * clearing;                                                    // slice 16: the guardrail

  gl_FragColor = vec4(col, 1.0);
}
