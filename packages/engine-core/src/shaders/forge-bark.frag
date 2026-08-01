/* ============================================================
   forge-bark.frag — DEAD-TREE BARK (family: bark). BASELINE — refined by the B1 builder.
   ------------------------------------------------------------
   Wraps a trunk cylinder: vertical ridged grain (bark runs up the tree), broken into plates by a
   stretched worley, weathered grey-brown. UV.y runs up the trunk, so ridges are along y.
   B2 finding #3 (live trees among the dead): uHealth blends this from DEAD weathered grey (0) to a
   HEALTHY warm brown with a faint green lichen in the crevices (1) — one shader, two recipes.
   ============================================================ */
#include './forge-common.glsl';

uniform float uHealth;   // 0 = dead grey bark, 1 = living warm bark w/ lichen (recipe-set)

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // stretch so grain runs UP the trunk: compress u (around-the-trunk), keep v (up).
  vec2 g = vec2(uv.x * 8.0, uv.y * 2.0);
  float grain = ridge(g, 8.0, 4);                     // vertical fibre ridges
  // bark plates: a stretched worley cracks the trunk into weathered scales.
  vec2 pc = vec2(uv.x * 6.0, uv.y * 3.0);
  vec2 w = worley(pc, 6.0);
  float crack = smoothstep(0.0, 0.08, w.y - w.x);     // dark fissures between plates
  float coarse = fbm(vec2(uv.x * 4.0, uv.y * 1.5), 4.0, 4);

  // A6-3 tree refinement: deepen the plate fissures a touch (0.2→0.26) so the Sobel-normal reads more relief
  // on the trunk — the dead bark catches the raking sun instead of looking sanded flat. (Low-freq inputs →
  // still well above the forge Nyquist floor at size 768 / worldSize 0.9.)
  height = clamp(0.46 * grain + 0.28 * coarse + 0.26 * crack, 0.0, 1.0);

  // CRITIC R1: bark was too dark (holes in the frame). Lift the whole ramp to a weathered dead-birch
  // grey-brown so trunks READ as trees at gameplay distance, and soften the fissure darkening.
  // uHealth shifts the palette warm/living: dead grey (health 0) → warm brown (health 1).
  vec3 barkLo = mix(vec3(0.17, 0.155, 0.135), vec3(0.19, 0.135, 0.085), uHealth);
  vec3 barkHi = mix(vec3(0.46, 0.42, 0.36),   vec3(0.44, 0.33, 0.19),  uHealth);
  vec3 col = mix(barkLo, barkHi, clamp(0.3 + 0.6 * grain + 0.3 * coarse, 0.0, 1.0));
  col *= mix(0.72, 1.0, crack);                        // fissures go dark (but not to black)
  col *= mix(0.85, 1.0, height);
  // living trees grow lichen: a low-freq green mottle pooled in the crevices (only when healthy).
  float lichen = uHealth * smoothstep(0.45, 0.8, fbm(uv * vec2(5.0, 3.0), 5.0, 3)) * (1.0 - height);
  col = mix(col, vec3(0.22, 0.28, 0.14), lichen * 0.5);
  // A6-3: dead trunks WEATHER too — a desaturated grey-green ROT/mould pools in the deepest fissures (pooled
  // by (1-height)*crack), stronger the DEADER the tree (1-uHealth). So a dead trunk reads decayed + organic
  // instead of a uniform grey; a living trunk keeps mostly its warm bark + lichen. One low-freq mottle layer.
  float rot = smoothstep(0.5, 0.86, fbm(uv * vec2(4.0, 2.5), 4.0, 3)) * (1.0 - height) * crack;
  col = mix(col, vec3(0.20, 0.215, 0.175), rot * (0.30 + 0.30 * (1.0 - uHealth)));
  // A6-3: weathered vertical DRIP-STAINS — a slow-up, banded-around fbm reads as rain-streaked dead wood
  // running DOWN the trunk. This is a LARGER-scale feature than the fine grain (bands ~0.13 m wide), so it
  // breaks the uniform-pole look at GAMEPLAY distance, not just at nose range. Kept subtle so it darkens the
  // stains without re-introducing the "black hole" trunks the R1 critic fixed.
  float streak = fbm(vec2(uv.x * 7.0, uv.y * 0.8), 7.0, 3);
  col *= mix(0.84, 1.08, streak);
  albedo = col;

  float ao = mix(0.6, 1.0, height) * mix(0.72, 1.0, crack);
  float rough = mix(0.85, 1.0, 1.0 - grain);
  orm = vec3(ao, rough, 0.0);
}

#include './forge-emit.glsl';
