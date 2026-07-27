/* ============================================================
   letterpress.frag — Lesson AA: the STUDIO print-look hero (the ring's missing BRIGHT editorial tone).
   ------------------------------------------------------------
   A bright kraft-paper world with a large serif letterform pressed INTO the sheet — a letterpress
   DEBOSS. Everything here is a 2D surface effect on a fullscreen quad; there is no 3D geometry. The
   letterform arrives as a baked coverage MASK (white glyph on black, drawn once into a <canvas> in JS —
   reuse-first, real type instead of an SDF guess), and this shader turns that flat mask into something
   that reads as PHYSICALLY pressed into paper, using three moves:

   1. DEBOSS RELIEF. The mask's gradient is the wall of the impression. Build a surface normal from it
      (N = normalize(vec3(-gx, -gy, relief))) — flat on the open sheet, steeply sloped on the edges of
      each stroke. That normal is what a raking light can catch.
   2. RAKING LIGHT. A low, near-grazing light whose azimuth slowly SWEEPS back and forth (uTime). Against
      the deboss walls it throws a bright lip on the light-facing side of every stroke and a shadow on the
      far side — and because the azimuth breathes, those lips shift side to side: the impression "breathes"
      the way a real pressed sheet does when you tilt it under a lamp. This is the scene's motion.
   3. INK-EDGE DARKENING + PAPER GRAIN. Real letterpress ink pools where the impression bites deepest — the
      edges — so darkening is driven by the mask gradient, not a flat fill (the interior stays paper-bright,
      which is what keeps dark copy legible ON TOP of this — the tone:'bright' contract). A little value
      noise gives the sheet its tooth.

   ── COLOUR SPACE (the thing that silently breaks a hero pack if you get it wrong) ──
   Hero packs render into beautyRT (HalfFloat HDR) and are then tonemapped + graded + sRGB-encoded by the
   shared post-filmic pass (see createHeroDirector.presentBeauty). So this shader must output LINEAR light,
   NOT display-sRGB — the encode happens downstream. That is the opposite of image-transition.frag (which
   renders straight to screen and must encode itself). Consequently every colour uniform here is authored
   in LINEAR by the pack (createLetterpress.js), the same convention createLivingInk uses.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform float     uTime;         // seconds — drives ONLY the raking-light sweep (the front is static)
uniform vec2      uResolution;   // drawBuffer size in px — for screen-aspect correction
uniform sampler2D uText;         // baked serif letterform: white glyph on black, .r = coverage 0..1
uniform vec2      uTextAspect;   // (texW, texH) of uText — preserves the letterform's own proportions
uniform float     uTextScale;    // letterform height as a fraction of screen height (e.g. 0.62)
uniform float     uMaxWidth;     // cap: the glyph never exceeds this fraction of screen WIDTH (contain on phones)
uniform vec3      uPaper;        // LINEAR kraft-cream ground
uniform vec3      uInk;          // LINEAR ink — the edge darkening / impression colour
uniform float     uGrain;        // paper-grain amount (0 = a dead-flat sheet)
uniform float     uInkFill;      // how much ink sits in the body of the impression (kept low for legibility)
uniform float     uInkEdge;      // extra ink concentrated at the bitten edges
uniform float     uRelief;       // deboss depth: the z of the surface normal (smaller = steeper walls)
uniform float     uSweepAmp;     // how far the raking light's azimuth swings (radians)
uniform float     uSweepSpeed;   // how fast it breathes
uniform float     uBuild;        // build-in press: 0 = flat unpressed sheet, 1 = fully stamped. Default 1.

/* Value noise — the same cheap hash+vnoise the other engine shaders inline (image-transition.frag). A
   full fbm would be wasted on paper tooth; one octave of value noise is the grain. */
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

/* Map a fullscreen uv into the letterform's own texture space, preserving its aspect and centring it.
   Returns the text-space uv; the caller tests whether it landed inside [0,1] (outside = open sheet). */
vec2 toTextUv(vec2 uv) {
  float screenA = uResolution.x / max(uResolution.y, 1.0);
  float textA   = uTextAspect.x / max(uTextAspect.y, 1.0);
  /* Height-driven scale, but CONTAINED: at uTextScale of the height the glyph is uTextScale*textA wide in
     screen-HEIGHT units, i.e. uTextScale*textA/screenA of the WIDTH — which blows past 1.0 on a portrait
     phone (a huge cropped '&'). Cap the scale so that width stays ≤ uMaxWidth; min() picks the axis that
     fits. On a wide desktop the cap is slack, so s == uTextScale and the settled desktop frame is unchanged. */
  float s = min(uTextScale, uMaxWidth * screenA / textA);
  vec2 c = uv - 0.5;
  c.x *= screenA;                                   // undo screen stretch → 1 unit == screen height
  vec2 t;
  t.y = c.y / s + 0.5;                              // glyph is s of screen height...
  t.x = c.x / (s * textA) + 0.5;                    // ...and s*textA wide, so it never distorts or overflows
  return t;
}

/* Coverage of the letterform at a text-space uv: 0 on the open sheet (outside the tile), the mask's red
   channel inside. Sampled several times to build the relief gradient, so it is its own function. */
float cov(vec2 t) {
  if (t.x < 0.0 || t.x > 1.0 || t.y < 0.0 || t.y > 1.0) return 0.0;
  return texture2D(uText, t).r;
}

void main() {
  vec2 t = toTextUv(vUv);

  /* Sample the coverage and its gradient. The step is a small fraction of the tile — big enough to span a
     couple of baked texels (a soft wall the light can rake), small enough to stay crisp. */
  float e = 0.0035;
  float m  = cov(t);
  float gx = cov(t + vec2(e, 0.0)) - cov(t - vec2(e, 0.0));
  float gy = cov(t + vec2(0.0, e)) - cov(t - vec2(0.0, e));
  float edge = clamp(length(vec2(gx, gy)) * 6.0, 0.0, 1.0);   // strong on stroke walls, ~0 on flats

  /* BUILD-IN PRESS. uBuild 0->1 stamps the impression IN: the deboss tilt, ink and lips all scale up from a
     flat sheet, with an impact BITE near landing (a brief over-press that settles). At uBuild=1 the bite is
     0 and press == 1.0 EXACTLY, so the built sheet is byte-identical to the un-built shader (present-parity
     contract — the pack defaults uBuild to 1). The mark thus appears to be punched into the paper. */
  float b     = clamp(uBuild, 0.0, 1.0);
  /* bite is gated to the OPEN interval (0.62, 1.0): at b==1 it is exactly 0, so press is exactly 1.0 and
     every "* press" below becomes "* 1.0" (an identity) — the built sheet is bit-for-bit the original
     shader (sin PI is NOT exactly 0 in float, which would otherwise flip an LSB and break present-parity). */
  float bite  = (b > 0.62 && b < 1.0) ? sin(((b - 0.62) / 0.38) * 3.14159265) : 0.0;   // 0->1->0 landing
  float press = clamp(b + bite * 0.16, 0.0, 1.15);                        // overshoot the bite, settle to 1.0

  /* THE DEBOSS NORMAL. The glyph is pressed IN, so the surface tilts down into it: the gradient (paper→ink)
     is the outward slope. Flatter uRelief → steeper walls → a deeper-looking press. Scaled by press so the
     sheet is FLAT (no tilt) until the stamp bites. */
  vec3 N = normalize(vec3(-gx * press, -gy * press, uRelief));

  /* THE RAKING LIGHT. Low azimuth, grazing elevation, azimuth breathing on uTime — the whole point. */
  float a = uTime * uSweepSpeed;
  float az = 0.9 + sin(a) * uSweepAmp;              // base direction + the slow sweep
  vec3 L = normalize(vec3(cos(az), sin(az), 0.55)); // z low = grazing = long lip shadows
  float lit = dot(N, L);                            // -1..1 across the two walls of each stroke

  /* THE SHEET. Kraft cream + a whisper of tooth, plus a broad soft gradient that reads as one low lamp
     washing across the paper from the light's direction (makes the flat areas feel lit, not printed-flat). */
  float grain = (vnoise(vUv * vec2(220.0, 220.0)) - 0.5) * uGrain;
  vec3 col = uPaper * (1.0 + grain);
  float lamp = 0.5 + 0.5 * dot(normalize(vec2(cos(az), sin(az))), (vUv - 0.5));
  col *= mix(0.94, 1.05, lamp);

  /* INK. A little in the body of the impression (kept low so copy stays legible on top), more concentrated
     at the bitten edges where real ink pools. */
  col = mix(col, uInk, clamp((m * uInkFill + edge * uInkEdge) * press, 0.0, 1.0));

  /* THE DEBOSS LIPS. The wall facing the light catches a warm highlight; the far wall drops into shadow.
     Both live on the edge term (the walls), and both track the sweeping azimuth — this is the breathing.
     Scaled by press so they only appear as the impression bites. */
  col += edge * press * max(lit, 0.0)  * 0.42 * vec3(1.0, 0.985, 0.95);   // lit lip
  col -= edge * press * max(-lit, 0.0) * 0.34 * vec3(1.0, 1.0, 1.0);      // shadowed lip
  col  = max(col, vec3(0.0));

  /* LINEAR out — the post-filmic pass tonemaps (ACES), grades, dithers and sRGB-encodes downstream. */
  gl_FragColor = vec4(col, 1.0);
}
