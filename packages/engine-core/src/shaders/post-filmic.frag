/* ============================================================
   post-filmic.frag — PASS 1 of the post chain: the "filmic" look.
   ------------------------------------------------------------
   WHAT A POST-PROCESSING PASS IS. By Lesson 05 we already render the scene into
   a texture (the grab pass). Post-processing is the same muscle pointed at the
   WHOLE frame: render the 3D scene into an off-screen texture — the BEAUTY PASS —
   then draw a fullscreen quad whose fragment shader reads that texture, transforms
   every pixel, and writes the result out. Chain several of these and you have a
   pass chain: scene → RT → pass → RT → pass → screen.

   WHY PASSES READ TEXTURES, NOT "THE SCREEN". A fragment shader cannot read the
   buffer it is currently writing to (undefined behaviour / feedback loop). So each
   pass reads the PREVIOUS pass's render target and writes to its own. That's the
   whole architecture; everything else is just what math you do per pixel.

   This pass layers three classic film artifacts (each one cheap, all subtle):
     1. CHROMATIC ABERRATION — real lenses bend red/green/blue by slightly
        different amounts, fringing high-contrast edges. We fake it by sampling
        the three channels at slightly different radial offsets (same idea the
        L05 water used, now at the screen level). It grows with distance from
        the image centre, like a real lens.
     2. VIGNETTE — light falls off toward the corners of a lens. We darken the
        edges toward LGR deep ink and let the centre stay warm/golden. Brand
        first: "deep ink edges, golden centre".
     3. FILM GRAIN — animated per-pixel noise, like emulsion grain. A hash of
        the pixel coordinate + time gives a new random value every frame; we
        nudge brightness by ±GRAIN. Still frames look textured, motion looks alive.
   ============================================================ */

// ---- PARAMS — tune the look here -------------------------------------------
const float CA_STRENGTH   = 0.0030;  // max screen-UV offset between R and B at the corners
const float VIGNETTE_EDGE = 1.20;    // radius where the vignette is fully dark (centre = 0)
const float VIGNETTE_SOFT = 0.45;    // radius where darkening starts
const float VIGNETTE_MIN  = 0.55;    // how dark the far corners get (0 = black, 1 = off)
const float GRAIN         = 0.045;   // grain amplitude (± this much brightness)
const vec3  TINT_WARM     = vec3(1.03, 1.00, 0.94); // gentle golden lift at the centre
// -----------------------------------------------------------------------------

varying vec2 vUv;
uniform sampler2D uScene;      // the previous pass (here: the beauty pass)
uniform float     uTime;       // seconds — animates the grain
uniform vec2      uResolution; // drawing-buffer size in pixels — aspect + grain seed
uniform float     uGrain;      // grain multiplier — main.js sets 0 when a STYLE pass
                               // (pixel/toon) follows, so dancing noise never feeds
                               // the quantizer/posterizer (the L06 grain-order fix).
uniform float     uChroma;     // chromatic-aberration multiplier — also 0 for STYLE
                               // passes, else CA fringes posterize into colour edges.
uniform float     uExposure;   // L09: the SunRig dims/lifts the whole frame by time
                               // of day (a touch darker at night).
uniform float     uAces;       // L66: 1 = apply ACES filmic tonemap (beauty tiers); 0 = off (the
                               // pixel/toon PRE-pass must stay byte-identical → no tonemap there).
uniform sampler2D uBloom;        // L66: the blurred bright-pass (sun/moon/star glow)
uniform float     uBloomStrength;// L66: how hard the glow adds (0 on non-beauty tiers → no-op)
uniform float     uGrade;        // L67: 1 = apply the colour-grade mood (beauty tiers); 0 = off (pixel/toon identical)
uniform vec3      uGradeTint;    // L67: gain multiply toward a hue (warm dawn/dusk, clean noon, cool night)
uniform vec3      uGradeLift;    // L67: a tiny shadow tint added in
uniform float     uGradeSat;     // L67: saturation (>1 punchy, <1 desaturated/moody)
uniform float     uGradeContrast;// L69: contrast around 0.5 (>1 separates lights/darks → crisp noon city)
uniform float     uWarmBal;       // L105: noon warm white-balance amount (0 = none / golden hour) — kills the residual blue sky-IBL cast
uniform float     uDither;        // L80: output dither amount (1 = ±1 LSB triangular) — BEAUTY only; 0 on the
                                  // pixel/toon pre-pass (+ vector) → byte-identical there. Kills 8-bit sky banding.
uniform float     uTonemap;       // L83: 0 = ACES, 1 = AgX — only consulted on the beauty path (uAces>0.5).
uniform sampler2D uRaysTex;       // L107: god-ray shafts (half-res). Added in HDR before tonemap.
uniform float     uRays;          // L107: god-ray strength — 0 on stylized/pre-pass frames → the add is a no-op → byte-identical.
uniform float     uBeautyExp;     // L108: beauty-only post-exposure trim (1 = none). INSIDE the uGrade gate → NEVER touches the pixel pre-pass's uExposure → byte-identical.

/* Cheap screen-space hash (the classic sin-dot trick): one pseudo-random number
   per pixel per frame. Not statistically perfect — perfectly fine for grain. */
float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

/* L66 ACES FILMIC TONEMAP (Narkowicz 2015 fit) — maps unbounded HDR → a filmic [0,1] display curve.
   Bright highlights (suns/speculars) roll off toward white CINEMATICALLY instead of clipping flat, and
   the toe lifts shadows. The instant "looks pro, not a demo" lever. C++: a fixed rational-polynomial
   kernel applied per pixel on the framebuffer. */
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

/* L83 AgX TONEMAP (Troy Sobotka's AgX, minimal sRGB-space impl by Benjamin Wrensch — iolite-engine.com, MIT).
   vs ACES: AgX desaturates highlights more gracefully (no ACES "notorious six" hue shift / skin-orange clip) and
   keeps a cleaner neutral. A 6th-order polynomial sigmoid in a log2 working space, between two 3×3 inset/outset
   matrices. Drop-in for aces(): linear HDR in, display [0,1] out. C++: a fixed transfer curve (matrix·log2·poly·matrix). */
const mat3 AGX_IN = mat3(
  0.842479062253094,  0.0423282422610123, 0.0423756549057051,
  0.0784335999999992, 0.878468636469772,  0.0784336,
  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
const mat3 AGX_OUT = mat3(
   1.19687900512017,   -0.0528968517574562, -0.0529716355144438,
  -0.0980208811401368,  1.15190312990417,   -0.0980434501171241,
  -0.0990297440797205, -0.0989611768448433,  1.15107367264116);
vec3 agxContrast(vec3 x) {                          // the AgX default-contrast sigmoid (6th-order fit)
  vec3 x2 = x * x, x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
vec3 agx(vec3 col) {
  const float minEv = -12.47393, maxEv = 4.026069;
  col = AGX_IN * max(col, vec3(0.0));
  col = clamp(log2(max(col, vec3(1e-10))), minEv, maxEv);
  col = (col - minEv) / (maxEv - minEv);            // normalise the log range to [0,1]
  col = agxContrast(col);
  col = AGX_OUT * col;
  return clamp(col, 0.0, 1.0);
}

void main() {
  /* Distance from the image centre, ASPECT-CORRECTED: without the correction a
     vignette on a wide screen is an ellipse squashed the wrong way. We scale x
     by aspect so "radius" means the same thing horizontally and vertically. */
  vec2  toCentre = vUv - 0.5;
  float aspect   = uResolution.x / uResolution.y;
  float r        = length(toCentre * vec2(aspect, 1.0));

  /* 1) CHROMATIC ABERRATION — sample R pushed outward, B pulled inward, G true.
     The offset grows with r² so the centre stays clean and edges fringe. */
  vec2 dir = (r > 0.0001) ? normalize(toCentre) : vec2(0.0);
  vec2 off = dir * (r * r) * CA_STRENGTH * uChroma;  // uChroma 0 when a STYLE pass
                                                     // follows: coloured fringes must
                                                     // not feed the posterizer/quantizer.
  vec3 col;
  col.r = texture2D(uScene, vUv + off).r;
  col.g = texture2D(uScene, vUv).g;
  col.b = texture2D(uScene, vUv - off).b;

  /* 2) VIGNETTE — smoothstep from "no effect" inside VIGNETTE_SOFT to full
     darkening at VIGNETTE_EDGE; never below VIGNETTE_MIN so blacks stay readable.
     The centre gets a slight warm tint instead — ink edges, golden heart. */
  float vig = 1.0 - smoothstep(VIGNETTE_SOFT, VIGNETTE_EDGE, r) * (1.0 - VIGNETTE_MIN);
  col *= mix(vec3(1.0), TINT_WARM, 1.0 - smoothstep(0.0, VIGNETTE_SOFT, r));
  col *= vig;

  /* 3) FILM GRAIN — re-seed the hash every frame via uTime so the noise dances.
     fract(uTime) cycles 0..1; multiplying into the pixel coord shifts the
     pattern. Centered around 0 (±0.5) so grain doesn't brighten the image. */
  float g = hash(gl_FragCoord.xy + fract(uTime * 13.37) * uResolution) - 0.5;
  col += g * GRAIN * uGrain;

  // L66 BLOOM — ADD the blurred bright-pass back in (HDR, before tonemap so the glow rolls off through
  // ACES with everything else). uBloomStrength is 0 on the pixel/toon pre-pass → exactly a no-op there.
  col += texture2D(uBloom, vUv).rgb * uBloomStrength;

  // L107 GOD RAYS — ADD the radial shafts in HDR too (so they roll through ACES + get tinted warm by the L67 grade
  // below — no separate colour uniform, Rule 2). uRays is 0 on every stylized/pre-pass frame → exact no-op → the
  // pixel/toon/vector tiers stay BYTE-IDENTICAL (the pass itself also never runs there — see createEngine godraysPass).
  col += texture2D(uRaysTex, vUv).rgb * uRays;

  col *= uExposure;                              // L09 time-of-day exposure
  // L66/L83: filmic tonemap on the beauty tiers only (uAces gates it → pixel/toon pre-pass byte-identical). The
  // CURVE is ACES (default) or AgX (uTonemap=1) — both HDR→display [0,1], so the L67 grade below works under either.
  if (uAces > 0.5) col = (uTonemap > 0.5) ? agx(col) : aces(col);

  /* L67 COLOUR GRADE (display-referred, AFTER ACES, beauty-tier only) — pulls every surface into ONE
     art-directed mood: a saturation tweak, a hue-tinted gain, and a small shadow lift. Keyframed by the
     SunRig (warm dawn/dusk, clean noon, cool-moody night). uGrade = 0 on the pixel/toon pre-pass → no-op. */
  if (uGrade > 0.5) {
    col *= uBeautyExp;   // L108 (Lever 2): beauty-only exposure trim (1 − 0.12·midK at noon) so the noon hero doesn't over-expose. FIRST line inside the uGrade gate → display-gated, never the pre-tonemap uExposure that feeds pixel → byte-identical.
    float l = dot(col, vec3(0.2126, 0.7152, 0.0722));     // luma
    col = mix(vec3(l), col, uGradeSat);                   // saturation around luma
    col = col * uGradeTint + uGradeLift * (1.0 - col);    // tinted gain + lift weighted into shadows
    col = (col - 0.5) * uGradeContrast + 0.5;             // L69: contrast around mid-grey (crisps the pale noon city)
    col = clamp(col, 0.0, 1.0);
    /* L105 NOON WARM-BALANCE — kill the residual blue sky-IBL cast at high sun (uWarmBal = midK·strength from the
       engine; 0 at golden hour → no-op there). Push R up / B down, then rescale to PRESERVE LUMA (a white-balance,
       NOT exposure). Inside the uGrade gate → pixel/toon/vector (uGrade=0) stay BYTE-IDENTICAL. */
    if (uWarmBal > 0.0) {
      vec3 warm = vec3(1.0 + 0.20 * uWarmBal, 1.0, 1.0 - 0.26 * uWarmBal);
      float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 cw = col * warm;
      float l1 = dot(cw, vec3(0.2126, 0.7152, 0.0722));
      col = clamp(cw * (l1 > 1e-4 ? l0 / l1 : 1.0), 0.0, 1.0);
    }

    /* L92 CINEMATIC GRADE DISCIPLINE — layered ON the SunRig time-of-day mood above to read "shot, not
       rendered". STATIC (not keyframed): the discipline is constant; the SunRig handles the daily mood.
       Beauty-tier only (this whole block is uGrade-gated) → pixel/vector/toon stay byte-identical.
       C++: rgb' = grade(rgb) — three per-pixel functions composed. */
    // (a) SPLIT-TONE — a warm/cool SEPARATION (not an overall cast): only the deepest shadows go teal, only
    //     the brightest highlights go amber, so the mid-tone masses keep their own colour (the teal-orange
    //     spine without a blue wash). Tight luma gates + restrained amounts.
    float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += vec3(-0.018, 0.005, 0.028) * (1.0 - smoothstep(0.0, 0.28, lum));   // deep darks → teal-blue
    col += vec3( 0.040, 0.015, -0.030) * smoothstep(0.62, 1.0, lum);          // bright lights → warm amber
    col = clamp(col, 0.0, 1.0);
    // (b) S-CURVE — a touch of filmic toe/shoulder (lift ~0.02, hold ~0.98) + a real mid S so the flat masses
    //     gain separation/punch (the pale city reads crisper, not matte). smoothstep is the S; blend 0.42.
    col = mix(vec3(0.02), vec3(0.98), col);
    col += (smoothstep(0.0, 1.0, col) - col) * 0.42;
    // (c) VIBRANCE — saturation boost weighted by INVERSE current sat (vivid pixels protected; the pale,
    //     low-sat placeholder masses get the lift). +22%.
    float mx = max(col.r, max(col.g, col.b)), mn = min(col.r, min(col.g, col.b)), sat = mx - mn;
    float lv = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col = mix(vec3(lv), col, 1.0 + 0.22 * (1.0 - sat));
    col = clamp(col, 0.0, 1.0);

    /* L93 BEAUTY HERO POP — the L92 caveat: at midday the bright Preetham sun over-lights the pale building
       albedo, blowing it toward white and drowning the L92 varied albedo / AO / window grid. A soft-knee
       HIGHLIGHT SHOULDER pulls the blown top back into a readable bright range so the buildings POP (detail
       reads), + a tiny black-point lift for depth/separation. Beauty-tier ONLY (this whole block is uGrade-
       gated → pixel/vector/toon untouched). We do NOT touch uExposure (it feeds the pixel pre-pass). */
    float Lp = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col *= 1.0 - smoothstep(0.50, 1.0, Lp) * 0.36;        // luma-keyed highlight SHOULDER: pull the over-lit
                                                          // (blown) buildings down up to 36% so albedo/AO/
                                                          // windows read; the sky/sun dim a touch → moodier hero
    col = (col - 0.44) * 1.14 + 0.44;                     // mild contrast around a low-ish pivot → deepen the
                                                          // mid-shadows the shared hemisphere fill can't be cut → SEPARATION
    col = mix(vec3(0.030), vec3(1.0), col);              // small black-point lift → depth
    col = clamp(col, 0.0, 1.0);

    /* L93 HERO VIGNETTE — a soft EXTRA corner darken on the BEAUTY hero, AFTER the grade (display-referred)
       so it frames the eye on the city without muddying the tonemap. Subtle (~10% at the extreme corners) on
       top of the universal base vignette above. Beauty-tier ONLY (this block is uGrade-gated) → pixel/vector/
       toon keep their byte-identical base vignette. (r = the aspect-corrected radius computed up top.) */
    col *= 1.0 - smoothstep(0.62, 1.20, r) * 0.11;
  }

  /* L80 OUTPUT DITHER (beauty only) — smooth gradients (the Preetham sky, fog, soft lighting) quantize into
     visible STAIR-STEP BANDS at 8-bit output, glaring on a phone. Add a tiny TRIANGULAR (TPDF) noise of ~±1 LSB
     so the quantization error averages out across neighbouring pixels → the eye integrates it to a smooth ramp
     (the same noise-shaping trick as audio dithering). Two hashes → a triangular distribution (softer than flat).
     uDither is 0 on the pixel/toon pre-pass (+ vector) → exactly a no-op → those tiers stay byte-identical. */
  if (uDither > 0.0) {
    float d = (hash(gl_FragCoord.xy * 0.7919) + hash(gl_FragCoord.xy * 1.137 + 19.19) - 1.0) / 255.0;
    col += d * uDither;
  }

  gl_FragColor = vec4(col, 1.0);
}
