/* ============================================================
   forge-stone.frag — RUIN CONCRETE / PLASTER (family: stone). BASELINE — refined by the B1 builder.
   ------------------------------------------------------------
   The ruined settlement + the interactive rubble: weathered grey concrete with cracked, spalling
   plaster — worley cell edges become the cracks, fbm grime stains the surface, chips expose a
   darker aggregate beneath.
   ============================================================ */
#include './forge-common.glsl';

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  float grime = fbm(warp(uv * 3.0, 3.0, 0.4), 3.0, 5);
  // cracks: the ridge between worley cells (F2-F1 small = on an edge).
  vec2 w = worley(uv * 7.0, 7.0);
  float crack = 1.0 - smoothstep(0.0, 0.05, w.y - w.x);
  // spall chips: a second worley, cores punched out as shallow craters.
  vec2 w2 = worley(uv * 14.0, 14.0);
  float chip = 1.0 - smoothstep(0.0, 0.18, w2.x);
  float tooth = fbm(uv * 26.0, 26.0, 3);

  height = clamp(0.55 + 0.25 * grime + 0.1 * tooth - 0.6 * crack - 0.4 * chip, 0.0, 1.0);

  vec3 concLo = vec3(0.16, 0.155, 0.14);
  vec3 concHi = vec3(0.40, 0.39, 0.36);
  vec3 col = mix(concLo, concHi, clamp(0.35 + 0.5 * grime + 0.2 * tooth, 0.0, 1.0));
  col = mix(col, vec3(0.10, 0.09, 0.08), crack * 0.8);   // cracks read dark
  col = mix(col, vec3(0.22, 0.19, 0.16), chip * 0.5);    // exposed aggregate is browner
  col *= 0.92 + 0.16 * hash1(floor(uv * 4.0));
  albedo = col;

  float ao = mix(0.4, 1.0, height);
  float rough = mix(0.8, 0.98, 1.0 - grime);
  orm = vec3(ao, rough, 0.0);
}

#include './forge-emit.glsl';
