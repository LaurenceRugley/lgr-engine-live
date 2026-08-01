// ============================================================
// @lgr/engine-core — indirect-field.glsl (Arc A15 BAKED RADIANCE PROBES): the RUNTIME lookup.
// ------------------------------------------------------------
// A sparse, BAKED irradiance volume — one RGBA8 3D texture whose texels store the bounced
// (indirect) light at a grid of points over the play ring. At build time we path-trace one bounce
// per probe (albedo x shadowed-sun + hemisphere sky) and average it to a single incident-radiance
// colour per probe: SH band 0 (the DC / ambient term). See tools/bake-probes.mjs.
//
// WHY band-0 only (and why that is the RIGHT v1, not a shortcut): the owner's ratified cool-dark
// grade crushes subtle DIRECTIONAL colour bleed — the adoption note (docs/research-two-minute-
// papers-2026-07-29.md, pick #1) flags exactly this. What DOES read under the grade is the band-0
// signal: (a) OCCLUSION — a probe in a cavity/behind a wall bakes darker, so cavities ground; and
// (b) COLOURED AMBIENT — a probe near a lit ochre wall bakes ochre, so the bounce carries the
// palette by construction (we authored the bake). Both are direction-independent, i.e. band 0.
// Band-1 directional is the cheap follow-up IF band 0 measurably pays (it is the thing the grade
// eats first). Keeping v1 at band 0 is the "don't let it become a full GI system" discipline.
//
// WHY RGBA8 and not the engine's vendored light-probe-grid feature: three's fork carries a dormant
// order-2 SH probe grid (USE_LIGHT_PROBES_GRID / probesSH), but its shader reads texels DIRECTLY as
// signed HDR coefficients — that implies a float/half-float 3D texture with linear filtering, which
// needs OES_texture_(half_)float_linear, the exact extension the owner's iPhone LACKS. So it fails
// the mobile WebKit gate this arc is built around. RGBA8 + LinearFilter 3D sampling, by contrast,
// is core WebGL2 (noise3d.js / createVolumetricClouds.js already ship it on the direct path). So we
// bake our OWN mobile-safe encoding. See the module header in createIndirectField.js.
//
// ENCODING (must match the baker byte-for-byte): each texel rgb = clamp(irradiance / uIndScale, 0,1)
// quantised to 8 bits; decode = texel.rgb * uIndScale (a single global exponent/scale = the "RGBM
// or similar" the brief asks for, but LDR-scaled so hardware trilinear stays exactly correct — RGBM
// would interpolate its shared multiplier non-linearly across texels). Direction-independent, so
// one texture() fetch reconstructs the term — no per-normal math, trivially mobile.
//
// C++ anchor: this is a lookup table baked offline (a `constexpr` array on disk) sampled with
// trilinear interpolation — the runtime does zero lighting maths, it just reads precomputed answers.
// ============================================================

uniform highp sampler3D uIndField;   // RGBA8 DC-irradiance volume (x fastest, then y, then z)
uniform vec3  uIndMin;               // world-space AABB min of the probe grid
uniform vec3  uIndInvSize;           // 1.0 / (AABBmax - AABBmin), per axis
uniform vec3  uIndRes;               // grid resolution (texels per axis) — for the half-texel clamp
uniform float uIndScale;             // decode: irradiance = texel.rgb * uIndScale
uniform float uIndStrength;          // master multiplier on the bounce (0 = off)
uniform vec3  uIndTint;              // linear palette nudge applied at the injection site (white = as-baked)

// Sample the baked bounce at a world position. Clamped to texel centres so the ClampToEdge border
// never bleeds the outermost probe past the grid (a fragment outside the grid reads the nearest
// probe, which is the sane fallback for a receiver just past the ring).
vec3 lgrIndirect(vec3 wpos) {
  vec3 uvw = (wpos - uIndMin) * uIndInvSize;               // 0..1 across the grid AABB
  uvw = clamp(uvw, 0.5 / uIndRes, 1.0 - 0.5 / uIndRes);    // stay on texel centres (no edge wrap/bleed)
  return texture(uIndField, uvw).rgb * uIndScale;          // decode the LDR-scaled DC irradiance
}
