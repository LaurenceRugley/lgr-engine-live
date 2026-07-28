/* ============================================================
   forge-gunmetal.frag — WEAPON GUNMETAL skin (Beauty B4). A forge surface for the weapon kit: dark cool
   blued steel with fine machining scratches, a faint patina, and honed edges — high metalness, low-ish
   roughness so it catches the specular line the chamfers were built for. Skins = seed/tint recipe variants.
   ============================================================ */
#include './forge-common.glsl';

uniform float uWear;   // 0 = factory-fresh, 1 = worn/scratched (recipe-set; a skin variant knob)

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // fine machining scratches — a directional brushed grain along the slide, tight so it reads as metal.
  float brush = ridge(vec2(uv.x * 2.0, uv.y * 60.0), 2.0, 2);
  // sparse deeper scratches (wear) + a low patina blotch.
  float scratch = smoothstep(0.6, 0.95, fbm(vec2(uv.x * 30.0, uv.y * 8.0), 30.0, 2));
  float patina = fbm(warp(uv * 5.0, 5.0, 0.3), 5.0, 4);

  height = clamp(0.5 + 0.25 * brush + 0.35 * scratch * uWear, 0.0, 1.0);

  vec3 steel = vec3(0.055, 0.06, 0.075);                 // dark blued gunmetal
  vec3 worn  = vec3(0.14, 0.145, 0.16);                  // scratched-bright metal exposed
  vec3 col = steel * (0.85 + 0.3 * brush);
  col = mix(col, worn, scratch * uWear);                 // scratches expose brighter steel
  col = mix(col, col * 0.8, patina * 0.3);               // faint darkening patina
  albedo = col;

  // metallic everywhere except the deepest scratches (micro-oxide); honed = smooth, scratches = rougher.
  float metal = 1.0 - 0.3 * scratch * uWear;
  float rough = mix(0.35, 0.7, scratch * uWear) + 0.06 * (1.0 - brush);
  float ao = mix(0.7, 1.0, height);
  orm = vec3(ao, clamp(rough, 0.0, 1.0), clamp(metal, 0.0, 1.0));
}

#include './forge-emit.glsl';
