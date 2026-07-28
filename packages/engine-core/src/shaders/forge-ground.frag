/* ============================================================
   forge-ground.frag — DECREPIT FOREST FLOOR (family: ground). BASELINE — refined by the B1 builder.
   ------------------------------------------------------------
   The big read: a 4 m tile of dead-leaf litter over trodden dirt, seen mostly at 1-3 m from the iso
   cam and underfoot in the dive. Composition is designed to read at THAT distance (Nyquist-honest).
   ============================================================ */
#include './forge-common.glsl';

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // CRITIC R1: cut the visible macro TILING (a 2-octave macro at incommensurate periods so no single
  // repeat reads) and DECORRELATE the warp (independent x/y offsets + a rotated second sample) so the
  // old diagonal "combed" streak cancels. Lower macro contrast too — the cheapest tiling mitigation.
  vec2 wu = warp(uv * 2.2, 2.2, 0.22);
  float macroA = fbm(wu, 2.2, 4);
  float macroB = fbm(vec2(uv.y, -uv.x) * 3.1 + 5.0, 3.1, 3);   // rotated + prime-ish period, decorrelated
  float macro = mix(macroA, macroB, 0.4);
  // trodden clods.
  float clods = fbm(uv * 10.0, 10.0, 5);
  // dead-leaf LITTER: worley cores as scattered leaves, stronger + tinted so the floor reads ORGANIC.
  vec2 w = worley(uv * 18.0, 18.0);
  float leaf = 1.0 - smoothstep(0.0, 0.45, w.x);
  float leafBig = 1.0 - smoothstep(0.0, 0.55, worley(uv * 9.0, 9.0).x);  // a coarser drift of leaves
  float grit = fbm(uv * 40.0, 40.0, 3);   // fine tooth (kept coarse enough to survive mips)

  height = clamp(0.38 * clods + 0.3 * leaf + 0.16 * macro + 0.10 * grit + 0.06 * leafBig, 0.0, 1.0);

  // Off-red: desaturated ochre-grey-brown woodland dirt (was too Martian). Green nudged up, red eased.
  vec3 dirtLo = vec3(0.095, 0.09, 0.072);
  vec3 dirtHi = vec3(0.22, 0.205, 0.155);
  vec3 col = mix(dirtLo, dirtHi, clamp(0.35 + 0.42 * macro + 0.35 * clods, 0.0, 1.0));
  vec3 leafCol = vec3(0.27, 0.185, 0.10);      // dead brown leaf litter (warm, but sparse over cool dirt)
  vec3 leafCol2 = vec3(0.20, 0.19, 0.12);      // greyed decayed leaf
  col = mix(col, leafCol, leaf * 0.55);
  col = mix(col, leafCol2, leafBig * 0.3);
  col *= mix(0.7, 1.0, height);                // occlude the crevices into the albedo
  col *= 0.92 + 0.16 * hash1(floor(uv * 6.0));
  albedo = col;

  float ao = mix(0.52, 1.0, height);
  float rough = mix(0.86, 1.0, 1.0 - clods);
  orm = vec3(ao, rough, 0.0);
}

#include './forge-emit.glsl';
