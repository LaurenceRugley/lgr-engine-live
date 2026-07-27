/* ============================================================
   silk-displace.glsl — the Dusk-Silk wave displacement, as a SHARED include.
   ------------------------------------------------------------
   WHY THIS FILE EXISTS (the shadow lesson's #1 correctness trap):
   A shadow map is cast by rendering the scene from the SUN's point of view into a depth
   texture. For that cast shadow to line up with the surface you actually see, the mesh must
   be displaced IDENTICALLY in two different shaders:
     • silk.vert       — the surface you see (the beauty render)
     • silk-depth.vert — the surface the sun sees (the shadow-cast depth pass, via the
                         mesh's customDepthMaterial)
   If those two displacements differ by even one term, the wave you see and the wave that
   casts the shadow are DIFFERENT wave — the shadows land in the wrong place and swim. The
   only safe way to guarantee they match is to compute the displacement in ONE place and
   #include it into both. That is this file.

   vite-plugin-glsl resolves a QUOTED hash-include of this file at BUILD time (it inlines the
   text). It leaves three.js's own '#include <chunk>' alone because its include regex excludes
   angle brackets — so this file coexists with the three shadow chunks in the same shader.

   C++ anchor: a shared header ('silk_displace.h') included by two translation units so both
   compute the field with the same code — the classic cure for "two copies drifted apart".

   The math is byte-for-byte the original silk.vert body (three layered fields: long swells +
   diagonal ripple + value-noise detail), just lifted into a function so it has one home. A
   default (uShadow=0) Dusk-Silk build therefore looks exactly as it did before shadows.
   ============================================================ */

/* Smooth value noise — 2D hash + bilinear blend with a quintic (C2) fade. Prefixed 'silk_'
   so it can't collide with any function three's chunks bring in. */
float silk_hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float silk_noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(silk_hash2(i),                 silk_hash2(i + vec2(1.0, 0.0)), u.x),
    mix(silk_hash2(i + vec2(0.0, 1.0)), silk_hash2(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

/* The wave height at a plane position, at time t. Returns the raw y-offset (also the value
   silk.frag maps to the ink→gold→cream gradient, so silk.vert still passes it on as
   vDisplacement). Identical expressions to the original inline body — do not "tidy" the
   constants; both the render and the depth pass depend on them matching exactly. */
float silkDisplacement(vec3 pos, float t) {
  float x = pos.x;
  float z = pos.z;
  /* L1 — long slow swells: primary fabric drape (λ ≈ 25 units, T ≈ 18s). */
  float d1 = sin(x * 0.25 + t * 0.35) * cos(z * 0.18 + t * 0.26) * 1.8;
  /* L2 — medium diagonal ripple (λ ≈ 8 units, T ≈ 11s, 45° bias). */
  float d2 = sin((x * 0.55 + z * 0.40) + t * 0.57 + 1.2) * 0.9;
  /* L3 — smooth noise detail (fine silk texture). */
  float d3 = (silk_noise2(vec2(x * 0.70 + t * 0.32, z * 0.70 + t * 0.24)) - 0.5) * 1.0;
  return d1 + d2 + d3;
}
