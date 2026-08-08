/* ============================================================
   forge-facade.frag — PAINTED/PLASTER BUILDING FACADE (family: facade). Arc A-ART.
   ------------------------------------------------------------
   A city wall, not a ruin: subtle plaster grain + light grime streaking, broken by periodic
   horizontal FLOOR-LINE grooves (the storey divisions every building silhouette already implies)
   and fainter vertical panel seams. Warmer and lighter than forge-stone.frag's ruin-grey — a
   maintained building reads clean at a distance, not weathered.
   ============================================================ */
#include './forge-common.glsl';

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  float grain = fbm(warp(uv * 4.0, 4.0, 0.25), 4.0, 4);
  // storey lines: periodic horizontal grooves — uWorldSize is metres-per-tile, so a fixed groove
  // count reads as a consistent storey height across facades of different tile sizes.
  float storeys = 5.0;
  float sy = fract(uv.y * storeys);
  float storeyLine = 1.0 - smoothstep(0.0, 0.05, min(sy, 1.0 - sy));
  // panel seams: sparser vertical grooves than storey lines, offset per-storey by a hashed jitter
  // (real panelised facades don't align seam-to-seam across floors).
  float panels = 3.0;
  float px = fract(uv.x * panels + hash1(vec2(floor(uv.y * storeys), 0.0)) * 0.3);
  float panelLine = 1.0 - smoothstep(0.0, 0.03, min(px, 1.0 - px));
  // light rain-streak grime, mostly below window-band height (biased toward the lower half of each storey).
  float streak = fbm(vec2(uv.x * 8.0, uv.y * 1.5), 8.0, 3) * smoothstep(0.15, 0.9, sy);

  height = clamp(0.6 + 0.08 * grain - 0.35 * storeyLine - 0.15 * panelLine - 0.06 * streak, 0.0, 1.0);

  vec3 plasterLo = vec3(0.52, 0.50, 0.46);
  vec3 plasterHi = vec3(0.74, 0.72, 0.67);
  vec3 col = mix(plasterLo, plasterHi, clamp(0.4 + 0.5 * grain, 0.0, 1.0));
  col = mix(col, col * 0.72, streak * 0.5);              // grime darkens, doesn't recolour
  col = mix(col, col * 0.55, storeyLine * 0.6);           // grooves read as shadow, not paint change
  col = mix(col, col * 0.75, panelLine * 0.4);
  col *= 0.94 + 0.1 * hash1(floor(uv * 3.0));
  albedo = col;

  float ao = mix(0.55, 1.0, height);
  float rough = mix(0.78, 0.92, 1.0 - grain);
  orm = vec3(ao, rough, 0.0);
}

#include './forge-emit.glsl';
