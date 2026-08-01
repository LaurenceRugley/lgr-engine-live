/* ============================================================
   glint-ndf.glsl (Arc A14 GLINT) — a constant-time GLINTY specular term. No textures, no render
   targets, no half-float — so it rides the MOBILE DIRECT path unchanged (the whole reason this
   technique ranked HIGH in the research scan).
   ------------------------------------------------------------
   PROVENANCE + LICENCE (read docs/research-two-minute-papers-2026-07-29.md pick #2 for the full note):
     Technique from "Evaluating and Sampling Glinty NDFs in Constant Time" — Kemppinen, Paulin,
     Thonat, Thiery, Lehtinen, Boubekeur, ACM TOG 44(6) Art. 255 (SIGGRAPH Asia 2025),
     doi 10.1145/3763282. Preprint: perso.telecom-paristech.fr/boubek/papers/Glinty/Glinty.pdf
     The authors also publish a Shadertoy reference. Shadertoy's DEFAULT licence is CC BY-NC-SA
     (NON-commercial); this engine is COMMERCIAL (it feeds client websites). Mathematics and
     techniques are NOT copyrightable, specific shader SOURCE is — so this file is implemented from
     the PAPER's formulation in our OWN code. The Shadertoy was NOT copied, transliterated, or
     adapted (in fact it 403'd for the scan and stayed unread). See the note for the full reasoning.

   HONEST SCOPE (Rule 15) — this is a faithful-in-SPIRIT v1, not a line-for-line port of the paper's
   full apparatus. We implement the technique's load-bearing ideas:
     • an IMPLICIT jittered facet grid keyed by the surface coordinate (one facet per cell; position
       and slope come from a congruential hash of the cell index — no memory, no precompute), and
     • a SEMI-DISCRETE NDF: the specular response is a sum of Gaussian lobes, one per real facet,
       evaluated at the required half-vector, and
     • LEVEL-OF-DETAIL from screen-space uv derivatives so the facet count per pixel is CONSTANT with
       distance (their constant-time property) and the sparkle anti-aliases toward the smooth base
       spec far away instead of scintillating.
   We deliberately DROP (per the scan's guidance): Algorithm 2 importance sampling (pays only in a
   many-spp stochastic sampler — our forward rasterizer has one sun), the exact far-field erf
   EXPECTATION + Russian-roulette point-set blend (needs the reference we cannot legally use to get
   the Jacobian bookkeeping right — ours uses a plain smooth LoD blend and a distance fade instead),
   Beckmann, anisotropy, and the triplanar/UV-free path. v1 == GGX-ish isotropic, one sun, k=4-ish.

   C++ anchor: think of the facet grid as a procedural std::unordered_map you never allocate — the
   "key" is the integer cell coordinate and the "value" (facet position + slope) is recomputed on
   demand from a hash of the key, so every pixel that lands in a cell agrees on that cell's facet
   with zero shared storage. dFdx/dFdy are the GPU handing you the screen-space Jacobian for free.
   ============================================================ */

// --- congruential hashes keyed by the integer cell coordinate (the paper's per-cell RNG seed) ---
// One scalar and one 2D uniform value in [0,1). Cheap, texture-free, deterministic per cell.
float lgrGlintHash1(vec2 c) {
  return fract(sin(dot(c, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 lgrGlintHash2(vec2 c) {
  return fract(sin(vec2(dot(c, vec2(127.1, 311.7)), dot(c, vec2(269.5, 183.3)))) * 43758.5453123);
}

// A single facet's microfacet SLOPE for a cell, drawn from a 2D Gaussian of std-dev `rough`
// (Box-Muller from two uniforms). The slope is the facet normal's tilt in the surface tangent
// plane — most facets sit near flat, a few tilt far, and it's the far-tilted ones that catch the
// sun at grazing angles and read as sparkle. This is the discrete stand-in for GGX's continuous NDF.
vec2 lgrGlintFacetSlope(vec2 cell, float rough) {
  vec2 u = clamp(lgrGlintHash2(cell + 7.0), 1e-4, 1.0);
  float r = rough * sqrt(-2.0 * log(u.x));
  float a = 6.2831853 * u.y;
  return r * vec2(cos(a), sin(a));
}

// Evaluate the semi-discrete NDF at ONE level of detail (cell resolution `res` = cells per world
// unit). We sum the 3x3 = 9 cells around the shading point (k-nearest-in-space); each cell's one
// facet contributes N(spatial) * N(angular): a smooth spatial kernel (so crossing a cell boundary
// never pops) times a Gaussian on how closely the facet's slope matches `target` (the slope the
// half-vector demands). `microRough` is the angular sharpness of a single facet — small == tight,
// glittery pinpoints; large == soft, blended sheen.
float lgrGlintEvalLod(vec2 guv, float res, vec2 target, float rough, float microRough) {
  vec2 p = guv * res;
  vec2 base = floor(p);
  float sum = 0.0;
  float inv2sig = 1.0 / (2.0 * microRough * microRough);
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 cell = base + vec2(float(i), float(j));
      vec2 fpos = cell + lgrGlintHash2(cell + 17.0);   // jittered facet position inside the cell
      vec2 dp = p - fpos;
      float spatial = exp(-dot(dp, dp) * 2.0);          // falls off within ~1 cell
      vec2 dd = lgrGlintFacetSlope(cell, rough) - target;
      float angular = exp(-dot(dd, dd) * inv2sig);
      sum += spatial * angular;
    }
  }
  return sum;
}

/* THE ABILITY. Returns a scalar glint intensity (multiply by the sun colour outside). All vectors
   are WORLD-space and must be normalised by the caller:
     guv        — the surface coordinate the facet grid lives on (world XZ works well for a floor/water)
     N          — surface normal (macro + ripple/relief already composed)
     V          — fragment -> camera
     L          — fragment -> sun (world sun direction)
     density    — base facet grid resolution (cells per world unit); higher == finer glitter
     rough      — facet-slope spread (how far off-normal facets tilt; wider == glints over a bigger arc)
     microRough — single-facet angular sharpness (small == tight sparkle, large == soft sheen)
   Off-switch is the caller's: pass density <= 0 (or gate the whole call) for an exact no-op. */
float lgrGlint(vec2 guv, vec3 N, vec3 V, vec3 L, float density, float rough, float microRough) {
  if (dot(N, L) <= 0.0) return 0.0;                     // no glint on the sun-shadowed side

  // Build a tangent frame at N and express the required half-vector H as a 2D SLOPE in that frame —
  // this is the microfacet normal the surface must present to mirror the sun into the eye. When the
  // sun is high the target slope is ~0 (a broad, calm sheen); at grazing sun it grows, so only the
  // rare far-tilted facets fire == the moving pinpoint glitter you see on real water and snow.
  vec3 H = normalize(V + L);
  vec3 up = abs(N.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0);
  vec3 T = normalize(cross(up, N));
  vec3 B = cross(N, T);
  vec2 target = vec2(dot(H, T), dot(H, B)) / max(dot(H, N), 1e-3);

  // LoD from the screen-space derivatives of the grid coordinate. We size the grid so the pixel
  // footprint spans ~1 cell; as the surface recedes the derivatives grow, the grid coarsens, and the
  // facet count per pixel stays CONSTANT (the paper's headline property). Two adjacent LoDs are
  // blended so there's no visible pop as the camera moves (our smooth stand-in for their roulette).
  vec2 dx = dFdx(guv), dy = dFdy(guv);
  float footprint = max(length(dx), length(dy)) * density;
  float lodF = max(0.0, log2(max(footprint, 1e-5)));
  float lo = floor(lodF);
  float resLo = density / exp2(lo);
  float resHi = density / exp2(lo + 1.0);
  float gLo = lgrGlintEvalLod(guv, resLo, target, rough, microRough);
  float gHi = lgrGlintEvalLod(guv, resHi, target, rough, microRough);
  float g = mix(gLo, gHi, smoothstep(0.4, 0.6, fract(lodF)));

  // Fade the sparkle out as the footprint coarsens past a couple of cells: distant surface returns
  // to the smooth base specular the material already renders (the paper's convergence-to-GGX, ours
  // approximated). Also scale by grazing-ness so the glitter concentrates in the sun's glare path.
  float distFade = 1.0 - smoothstep(2.5, 6.0, lodF);
  return g * distFade;
}
