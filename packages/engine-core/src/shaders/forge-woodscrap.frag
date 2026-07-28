/* ============================================================
   forge-woodscrap.frag — BARRIER PLANKS + SALVAGED METAL (family: wood-scrap). BASELINE — refined by
   the B1 builder. One shader, two recipes: uMetalMix 0 = weathered wood plank, 1 = scratched sheet
   metal. The barriers the survivor builds are lashed-together wood + scrap; sharing a shader keeps the
   fortification kit visually of-a-piece.
   ============================================================ */
#include './forge-common.glsl';

uniform float uMetalMix;   // 0 = wood plank, 1 = scrap metal (recipe-set)

void woodSurface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // planks: hard bands across u; grain ridges run along the plank (v).
  float plankId = floor(uv.x * 4.0);
  float seam = abs(fract(uv.x * 4.0) - 0.5);          // 0.5 at plank centre, 0 at the seam
  float gap = 1.0 - smoothstep(0.02, 0.06, seam);     // dark gap between planks
  vec2 grainUv = vec2(uv.x * 3.0, uv.y * 1.0 + plankId * 0.37);
  float grain = ridge(grainUv, 3.0, 4);
  float knots = fbm(uv * 8.0, 8.0, 4);

  height = clamp(0.55 + 0.3 * grain + 0.15 * knots - 0.7 * gap, 0.0, 1.0);

  vec3 woodLo = vec3(0.16, 0.10, 0.05);
  vec3 woodHi = vec3(0.40, 0.27, 0.14);
  vec3 col = mix(woodLo, woodHi, clamp(0.3 + 0.55 * grain + 0.3 * knots, 0.0, 1.0));
  col *= mix(0.35, 1.0, 1.0 - gap);                   // seams go dark
  col *= 0.9 + 0.2 * hash1(vec2(plankId, 0.0));       // per-plank tone break
  albedo = col;

  float ao = mix(0.5, 1.0, height) * mix(0.4, 1.0, 1.0 - gap);
  orm = vec3(ao, mix(0.7, 0.95, 1.0 - grain), 0.0);
}

void metalSurface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // CRITIC R2: metalness alone can't read on a thin ~40px slab at iso distance (no strong env specular),
  // and a cool steel gets confounded by the warm grade — so scrap kept reading as tan stone. Switch the
  // read to a SHAPE cue that survives distance + grade: CORRUGATED IRON. Strong periodic ribs give hard
  // light/shadow banding (via the normal map) that says "metal sheet" at any range, plus a distinctly
  // DARKER, COOLER value so it separates from the pale warm concrete by brightness, not just hue.
  float ribs = 0.5 + 0.5 * cos(uv.y * 6.2831853 * 9.0);           // 9 ribs/tile (~11 cm) — tiles by integer
  ribs = pow(ribs, 0.7);                                           // flatten crests, sharpen valleys
  float brush = ridge(vec2(uv.x * 2.0, uv.y * 30.0), 2.0, 2);      // faint brushed grain along the ribs
  float rust = smoothstep(0.55, 0.95, fbm(warp(uv * 4.0, 4.0, 0.5), 4.0, 4));   // oxide blooms
  float valleyRust = (1.0 - ribs) * 0.5;                          // rust pools in the rib valleys
  float rustMix = clamp(rust + valleyRust * 0.6, 0.0, 1.0);

  height = clamp(0.25 + 0.7 * ribs + 0.05 * brush, 0.0, 1.0);      // ribs dominate the relief

  vec3 steel = vec3(0.11, 0.12, 0.135);                           // DARK cool galvanised sheet (near-charcoal)
  vec3 rustCol = vec3(0.32, 0.15, 0.07);                          // warm oxide (the one warm accent)
  vec3 col = mix(steel * (0.55 + 0.75 * ribs), rustCol, rustMix); // rib crests catch light, valleys go dark
  albedo = col;

  // still metallic on bare steel (glint where env hits), dielectric on rust. The corrugation is the
  // primary read; metalness is the bonus when a specular does land.
  float metal = mix(0.9, 0.05, rustMix);
  float rough = mix(0.38, 0.9, rustMix);
  float ao = mix(0.55, 1.0, ribs);                                // valleys ambient-occluded
  orm = vec3(ao, clamp(rough, 0.0, 1.0), metal);
}

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  vec3 aW, oW, aM, oM; float hW, hM;
  woodSurface(uv, aW, oW, hW);
  metalSurface(uv, aM, oM, hM);
  albedo = mix(aW, aM, uMetalMix);
  orm = mix(oW, oM, uMetalMix);
  height = mix(hW, hM, uMetalMix);
}

#include './forge-emit.glsl';
