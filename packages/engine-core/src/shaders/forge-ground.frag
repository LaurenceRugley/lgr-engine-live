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
  // A7-1: a MID-scale mottle (damp mud drifts / trodden hollows) between the tile-wide macro and the fine
  // grit — this is the band the ISO eye reads as "the floor has terrain", not a flat tint. period 5, 4 oct
  // → finest octave 40 cells = 25.6 texels @1024, well above the 6.4 Nyquist floor.
  float mud = fbm(warp(uv * 5.0, 5.0, 0.35), 5.0, 4);
  // dead-leaf LITTER: worley cores as scattered leaves, stronger + tinted so the floor reads ORGANIC.
  vec2 w = worley(uv * 18.0, 18.0);
  float leaf = 1.0 - smoothstep(0.0, 0.45, w.x);
  float leafBig = 1.0 - smoothstep(0.0, 0.55, worley(uv * 9.0, 9.0).x);  // a coarser drift of leaves
  float grit = fbm(uv * 40.0, 40.0, 3);   // fine tooth (kept coarse enough to survive mips)
  // A7-1 MOSS/damp patches: sparse cool-green decay pooling where the mud sits low + damp — a forest floor
  // reads as decayed EARTH, not clean dirt. Driven by the mid band so it clusters, not speckles.
  float moss = smoothstep(0.62, 0.9, mud) * (0.55 + 0.45 * clods);

  // A7-1: give the height more RANGE (mud hollows carve deeper; clods still lead) so the Sobel normal — now
  // baked at a stronger relief (recipe) — has real surface to shape. Bias the mean down a touch (trodden).
  height = clamp(0.34 * clods + 0.26 * leaf + 0.16 * macro + 0.18 * mud + 0.10 * grit + 0.06 * leafBig, 0.0, 1.0);

  // Off-red: desaturated ochre-grey-brown woodland dirt (was too Martian). Green nudged up, red eased.
  // A7-1: deepen the low so damp mud pools DARK (albedo range = depth read at iso), and let the mid mottle
  // drive the lo↔hi mix so the tone varies across the floor, not just with the tile-wide macro.
  vec3 dirtLo = vec3(0.072, 0.07, 0.055);      // damp, trodden earth (deeper low → wider range)
  vec3 dirtHi = vec3(0.225, 0.21, 0.158);      // dry raised clods (a touch lighter)
  vec3 col = mix(dirtLo, dirtHi, clamp(0.28 + 0.30 * macro + 0.30 * clods + 0.24 * mud, 0.0, 1.0));
  vec3 mudCol = vec3(0.055, 0.05, 0.04);       // wet-dark mud pooled in the hollows
  col = mix(col, mudCol, (1.0 - smoothstep(0.3, 0.62, mud)) * 0.35);
  vec3 mossCol = vec3(0.10, 0.135, 0.075);     // cool decayed moss/lichen tint
  col = mix(col, mossCol, moss * 0.5);
  vec3 leafCol = vec3(0.27, 0.185, 0.10);      // dead brown leaf litter (warm, but sparse over cool dirt)
  vec3 leafCol2 = vec3(0.20, 0.19, 0.12);      // greyed decayed leaf
  col = mix(col, leafCol, leaf * 0.55);
  col = mix(col, leafCol2, leafBig * 0.3);
  col *= mix(0.58, 1.0, height);               // occlude the crevices into the albedo (deeper → more depth)
  col *= 0.92 + 0.16 * hash1(floor(uv * 6.0));
  albedo = col;

  // A7-1: AO tracks the deeper height range; damp mud + moss read a touch LESS rough (wetter) than dry
  // litter, so the raking iso sun catches a subtle sheen difference across the floor (variety, not gloss).
  float ao = mix(0.46, 1.0, height);
  float rough = mix(0.84, 1.0, 1.0 - clods);
  rough = mix(rough, 0.72, (1.0 - smoothstep(0.3, 0.62, mud)) * 0.5 + moss * 0.3);
  orm = vec3(ao, clamp(rough, 0.0, 1.0), 0.0);
}

#include './forge-emit.glsl';
