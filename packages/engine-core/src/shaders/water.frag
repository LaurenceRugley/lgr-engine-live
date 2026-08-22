/* ============================================================
   water.frag (A12 WATER, PROPERLY) — mobile-safe contextual water.
   ------------------------------------------------------------
   Everything here is ANALYTIC / in-shader — NO texture sampling, NO render-target reads — so it rides the
   MOBILE DIRECT PATH with no half-float dependency (the exact gap, OES_texture_half_float_linear missing on
   the owner's iPhone, that blacked out the beauty path). It delivers, in one transparent pass:
     • ripple LIFE   — the surface normal comes from the GRADIENT of a sum of directional sine waves, so the
                       water shimmers + catches light without a normal map. This also KILLS A9's banding:
                       the shading is per-fragment analytic, never the flat CircleGeometry fan normal.
     • a DEPTH RAMP  — shallow (near shore) -> deep (centre), from the shore-depth attribute.
     • soft SHORELINE— shallow water fades to transparent so it LAPS the land instead of butting a hard edge.
     • cheap REFLECTION — a Fresnel sky-tint at grazing angles (no planar-reflection RT) + a sharp sun glint.
     • FogExp2       — matched to scene.fog so the water sits in the same atmosphere as everything else.
   ============================================================ */
precision highp float;

// A14 GLINT — the constant-time glinty-NDF term (own implementation from the SIGGRAPH-Asia-2025
// paper; see the header of glint-ndf.glsl for provenance + commercial-licence reasoning). vite-plugin-
// glsl inlines this at import time, so Three never sees the #include. No textures/RTs → mobile-safe.
#include './glint-ndf.glsl';

varying float vDepth;
varying vec3  vWorldPos;
varying vec3  vView;

uniform float uTime;
uniform vec3  uShallow;    // near-shore water colour
uniform vec3  uDeep;       // deep water colour
uniform vec3  uSky;        // horizon/sky tint reflected at grazing angles
uniform vec3  uSunDir;     // world sun direction (points toward the sun)
uniform vec3  uSunColor;   // sun colour for the specular glint
uniform float uOpacity;    // max (deep) opacity
uniform float uRipple;     // ripple spatial frequency
uniform float uSpeed;      // ripple temporal speed
uniform float uGlint;      // sun-glint gain (0 = off; lakes shimmer more than a stagnant pond)
uniform float uFoam;       // A13 analytic shoreline-foam gain (0 = off; pond/lake)
uniform float uRain;       // A16 LIFT#2 rain-ripple gain (0 = OFF → exact no-op; drives dimpled impact rings)
uniform float uGlintDensity; // A14 glinty-NDF facet grid resolution (0 = OFF → exact no-op; the default)
uniform float uGlintRough;   // A14 facet-slope spread (how wide an arc the glints fire over)
uniform float uGlintMicro;   // A14 single-facet sharpness (small = tight sparkle, large = soft sheen)
uniform float uGlintGain;    // A14 glint intensity multiplier
uniform vec3  uFogColor;
uniform float uFogDensity;

/* ---- ARC A-NIGHTFALL: uLight — HOW MUCH LIGHT IS ON THIS WATER. -------------------------------
   This shader writes base (the shallow/deep depth ramp) STRAIGHT to the framebuffer: there is no
   N.L term and no light multiply anywhere in it, which is a deliberate and mostly good choice for a
   stylised surface. Its one real consequence is that the sea CANNOT GET DARK. At midnight it was
   still emitting 0x24576f at full value under a sky the atmosphere had let fall to near-zero, so
   the water measured BRIGHTER THAN THE SKY ABOVE IT (world-lab, measured: sky luma 3.9 vs water
   18.0). Water is not a light source; that ordering is simply wrong.

   One scalar, because that is all the fix needs — a body of water at night is dark BECAUSE the sky
   lighting it is dark, and the fresnel term already carries the sky's own colour on top. Kept off
   the glint on purpose: moonlight glitter on a swell is a real and wanted night effect, and it is
   already dim because it rides uSunColor.

   DEFAULT 1.0 = the exact pre-arc frame, so hoard2 and every recipe-built water are untouched. */
uniform float uLight;

varying vec3  vMacroNormal; // A13: the analytic Gerstner swell normal (up-vector for pond/lake)
varying float vCrest;       // A13: summed wave-crest factor for the analytic foam

// ANALYTIC ripple GRADIENT: h(xz,t) = sum of small directional sine waves; grad = amp*cos(...)*f*d. Returned
// as the XZ slope so it composes ON TOP of the (possibly Gerstner) macro normal below.
vec2 rippleGrad(vec2 p, float t) {
  vec2 d1 = vec2(0.80, 0.60), d2 = vec2(-0.50, 0.86), d3 = vec2(0.15, -0.99);
  float f1 = uRipple, f2 = uRipple * 1.7, f3 = uRipple * 2.9;
  float amp = 0.09;
  return amp        * cos(dot(p, d1) * f1 + t * 1.10) * f1 * d1
       + amp * 0.60 * cos(dot(p, d2) * f2 + t * 1.55) * f2 * d2
       + amp * 0.35 * cos(dot(p, d3) * f3 + t * 0.80) * f3 * d3;
}

// A16 LIFT#2 RAIN RIPPLES (from lgr-live-sky ocean.frag) — expanding concentric rings from raindrop impacts.
// The near surface is diced into cells; each cell repeatedly spawns a drop at a random spot with a staggered
// lifetime, and the ring is a thin outward-travelling wave packet whose radius grows and fades over its life.
// Returns the ripple's radial height GRADIENT to perturb the surface normal → the sea visibly DANCES where the
// rain lands. Pure hash + sine math: NO textures, so it keeps createWaterSurface on the mobile direct path.
vec2 hash22(vec2 p) { p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3))); return fract(sin(p) * 43758.5453); }
vec2 rainRippleGrad(vec2 p, float t) {
  vec2 g = p * 0.7;                                  // world → ripple cells (density)
  vec2 id = floor(g);
  vec2 grad = vec2(0.0);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 cid = id + vec2(float(i), float(j));
    vec2 rnd = hash22(cid);
    vec2 center = cid + 0.15 + rnd * 0.7;            // impact point inside the cell
    float life = fract(t * 0.85 + rnd.x * 7.0 + rnd.y * 3.0);   // 0..1 ripple age, staggered per cell
    vec2 dv = g - center;
    float d = length(dv);
    float band = d - life * 0.85;                    // distance from the expanding ring radius
    float env = exp(-band * band * 42.0) * (1.0 - life) * smoothstep(0.0, 0.07, life);
    if (d > 1e-4) grad += (dv / d) * (sin(band * 62.0) * env);
  }
  return grad;
}

void main() {
  // compose the micro-ripple slope over the macro normal. For pond/lake the macro is the up-vector, so this
  // is IDENTICAL to the old rippleNormal(); for the ocean it perturbs the Gerstner swell with fine chop.
  vec2 g = rippleGrad(vWorldPos.xz, uTime * uSpeed);
  vec3 n = normalize(vMacroNormal + vec3(-g.x, 0.0, -g.y));

  // A16 RAIN RIPPLES — dimpled impact rings dance across the near surface where drops land, so reflections
  // + the sun path shatter into rain-pocked water. Faded with view distance (far rings would alias into a
  // moiré grid). uRain=0 (the default) → skipped entirely → existing pond/lake/ocean water is byte-identical.
  if (uRain > 0.01) {
    float rdet = 1.0 - smoothstep(12.0, 95.0, length(vView));
    vec2 rg = rainRippleGrad(vWorldPos.xz, uTime) * (uRain * rdet * 1.6);
    n = normalize(n + vec3(rg.x, 0.0, rg.y));
  }
  vec3 v = normalize(vView);

  // DEPTH RAMP — shallow near the shore, deepening toward the centre.
  vec3 base = mix(uShallow, uDeep, smoothstep(0.02, 0.55, vDepth)) * uLight;

  // FRESNEL sky-tint — grazing angles pick up the sky (cheap reflection, no RT). A firmer mix so the water
  // reads as a distinct REFLECTIVE surface (not just darker mud) even in the cool-dark grade.
  float fres = pow(1.0 - max(dot(v, n), 0.0), 3.5);
  vec3 col = mix(base, uSky, fres * 0.8);

  // SUN GLINT — a BROAD specular sheen off the rippled normal (a low power = a wide highlight band that reads
  // as "water catching the light", not a pinpoint). Plus a sharp sparkle on top for the shimmer.
  vec3 hlf = normalize(v + uSunDir);
  float ndh = max(dot(n, hlf), 0.0);
  float sheen = pow(ndh, 22.0);          // broad band
  float sparkle = pow(ndh, 150.0);       // tight sparkle
  col += uSunColor * (sheen * 0.6 + sparkle * 0.9) * uGlint;

  // A14 GLINTY-NDF SUN GLITTER — discrete-facet sparkle on top of the broad sheen: the water breaks
  // into a field of moving pinpoints in the sun's glare path (the "sun glitter on the swell" payoff),
  // constant-time and anti-aliasing to the smooth sheen with distance. uGlintDensity = 0 → skipped
  // entirely, so pond/lake and any un-opted water are byte-identical to the A13 shader.
  if (uGlintDensity > 0.0) {
    float glint = lgrGlint(vWorldPos.xz, n, v, uSunDir, uGlintDensity, uGlintRough, uGlintMicro);
    col += uSunColor * glint * uGlintGain;
  }

  // SOFT SHORELINE — shallow water (vDepth -> 0) eases to transparent so it laps the land.
  float alpha = uOpacity * smoothstep(0.0, 0.20, vDepth);

  // ANALYTIC SHORELINE FOAM (A13) — surf where breaking waves (high crest) meet the shallows (low shore-
  // depth). Wave-height x shore-depth, PURE — NO depth-buffer grab (which needs an RT and breaks the mobile
  // path). A waterline band of foam + foam riding the crests as they run up the beach; opaque white. uFoam=0
  // (pond/lake) → no foam.
  if (uFoam > 0.0001) {
    float shoreBand = 1.0 - smoothstep(0.0, 0.17, vDepth);      // a TIGHT waterline band -> 0 just offshore
    float crestFoam = smoothstep(0.45, 0.92, vCrest);           // foam only on the sharpest wave crests
    // a foam LINE at the waterline (shoreBand²) + crest caps that fade offshore — not a white sheet.
    float foam = clamp(shoreBand * shoreBand * 0.85 + crestFoam * shoreBand * 0.6, 0.0, 1.0) * uFoam;
    col = mix(col, vec3(0.90, 0.95, 0.98), foam);
    alpha = max(alpha, foam * uOpacity);                        // foam is opaque
  }

  // FogExp2 (matches scene.fog): factor from the view distance carried in vView.
  float dist = length(vView);
  float fogF = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, clamp(fogF, 0.0, 1.0));

  gl_FragColor = vec4(col, alpha);
}
