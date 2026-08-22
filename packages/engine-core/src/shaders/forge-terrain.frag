/* ============================================================
   forge-terrain.frag — OPEN-GROUND SURFACES (family: terrain). A-FLORA, 2026-08-21.
   ------------------------------------------------------------
   The three surfaces a district-based world stands on — SAND, ROCK, GRASS — as one family shader
   with a uniform knob, the same shape forge-bark.frag (uHealth) and forge-woodscrap.frag
   (uMetalMix) already use. Not three files, because the three share their whole skeleton: a broad
   macro band that says "this ground is not flat", a mid band that gives it terrain, a fine band
   for tooth, and a colour ramp. Only the bands' periods and the ramp differ, which is exactly what
   a uniform is for.

   WHY THIS EXISTS ALONGSIDE forge-ground.frag: that one is the HOARD's decrepit forest floor —
   dead-leaf litter over trodden dirt, composed to read at 1-3 m from an isometric camera. These
   are OPEN TERRAIN at a world scale, seen from a vehicle or from the air, and they need to survive
   being tiled over a whole district. Different subject, different composition, different tile size.
   Reusing the litter shader for a desert would have been cheaper and wrong.

   BRANCHING IS FREE HERE, which is the only reason one shader can carry three subjects. This runs
   ONCE PER TEXEL AT BAKE TIME into a render target, not per fragment per frame — the cost of an
   'if' in a bake is measured in milliseconds of boot, once. (In the RUNTIME shader that samples
   these maps, a branch like this would be a real cost and would not be written.)
   C++ anchor: this is a texture-generation kernel run offline into a buffer, not a per-pixel
   shading function — like generating a lookup table at startup instead of computing in the loop.

   THE NYQUIST RULE (forge-common.glsl's headline lesson) is obeyed per band: at a 1024 bake the
   finest period used below is 48 cells => 21 texels per feature, comfortably over the ~6.4 floor.
   Sand deliberately stops at 48 rather than going finer: individual sand GRAINS are far under a
   texel at any honest world scale, so asking for them buys white noise that mips to flat grey.
   ============================================================ */
#include './forge-common.glsl';

uniform float uSurface;   // 0 = sand, 1 = rock, 2 = grass (recipe-set; see TERRAIN_SURFACES)

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // ---- the shared skeleton: three decorrelated bands every surface reads differently ----------
  // macro: the tile-wide drift. Warped + mixed with a ROTATED second sample at an incommensurate
  // period, the same de-tiling trick forge-ground.frag's critic pass landed on — without it the
  // repeat grid reads as a plaid across a whole district.
  vec2 wu = warp(uv * 2.0, 2.0, 0.26);
  float macro = mix(fbm(wu, 2.0, 4), fbm(vec2(uv.y, -uv.x) * 3.3 + 5.0, 3.3, 3), 0.4);
  float mid = fbm(warp(uv * 6.0, 6.0, 0.30), 6.0, 4);    // "the ground has terrain" band
  float fine = fbm(uv * 24.0, 24.0, 3);                  // tooth (24 cells = 42 texels @1024)

  if (uSurface < 0.5) {
    // ---- SAND -------------------------------------------------------------------------------
    // DUNE RIPPLES are the whole read. They are directional (wind has a direction) and they are
    // RIDGED, not sinusoidal — a dune crest is sharp and its lee is soft. ridge() gives exactly
    // that asymmetry for free, and squashing the sample coordinate on one axis makes the ripples
    // run as bands instead of blobs.
    float ripple = ridge(vec2(uv.x * 3.0 + macro * 0.7, uv.y * 34.0), 34.0, 3);
    float ripple2 = ridge(vec2(uv.x * 48.0, uv.y * 6.0 + mid * 0.5), 48.0, 2);  // cross-hatch, finer
    float grain = fine;
    height = clamp(0.42 * ripple + 0.16 * ripple2 + 0.26 * macro + 0.16 * grain, 0.0, 1.0);
    vec3 loSand = vec3(0.300, 0.232, 0.140);   // damp/shadowed sand in the ripple troughs
    vec3 hiSand = vec3(0.640, 0.530, 0.352);   // dry, sun-bleached crests
    albedo = mix(loSand, hiSand, clamp(0.24 + 0.52 * ripple + 0.30 * macro, 0.0, 1.0));
    // a faint mineral darkening where the wind has scoured down to coarser grit
    albedo = mix(albedo, vec3(0.255, 0.205, 0.150), smoothstep(0.62, 0.92, mid) * 0.30);
    orm = vec3(0.72 + 0.28 * height, 0.94, 0.0);      // near-matte; AO from the trough depth
  } else if (uSurface < 1.5) {
    // ---- ROCK -------------------------------------------------------------------------------
    // FRACTURE is the read: worley F2-F1 is small along cell borders and large inside, so
    // 1 - smoothstep(F2-F1) draws the CRACK NETWORK directly. Two scales so big slabs are broken
    // by smaller fissures, which is what stops it looking like a single tiled pattern.
    vec2 wBig = worley(uv * 5.0, 5.0);
    vec2 wSml = worley(uv * 13.0, 13.0);
    float crackBig = 1.0 - smoothstep(0.0, 0.10, wBig.y - wBig.x);
    float crackSml = 1.0 - smoothstep(0.0, 0.07, wSml.y - wSml.x);
    float crack = clamp(crackBig + crackSml * 0.65, 0.0, 1.0);
    float slab = fbm(uv * 5.0 + 11.0, 5.0, 2);        // per-slab value drift, so no two read alike
    // cracks CUT DOWN into the surface — the height must fall in them, not rise
    height = clamp(0.30 + 0.34 * mid + 0.22 * slab + 0.14 * fine - 0.62 * crack, 0.0, 1.0);
    vec3 loRock = vec3(0.052, 0.048, 0.043);   // deep in the fissures
    vec3 hiRock = vec3(0.310, 0.288, 0.258);   // exposed, weathered faces
    albedo = mix(loRock, hiRock, clamp(0.20 + 0.44 * slab + 0.36 * mid, 0.0, 1.0));
    albedo = mix(albedo, loRock, crack * 0.82);
    // a cool lichen bloom on the flatter, damper slabs — the thing that stops grey reading as dead
    albedo = mix(albedo, vec3(0.115, 0.140, 0.088), smoothstep(0.70, 0.95, mid) * (1.0 - crack) * 0.34);
    orm = vec3(0.55 + 0.45 * height, 0.88, 0.0);
  } else {
    // ---- GRASS ------------------------------------------------------------------------------
    // CLUMPS, not blades. At any world scale a blade is sub-texel (the Nyquist rule again), so the
    // honest subject is the TUFT — worley cores as clumps, with the gaps between them showing the
    // soil underneath. That soil showing through is what separates turf from a green rectangle.
    vec2 wc = worley(uv * 16.0, 16.0);
    float clump = 1.0 - smoothstep(0.0, 0.42, wc.x);
    float clumpBig = 1.0 - smoothstep(0.0, 0.52, worley(uv * 7.0, 7.0).x);
    float dry = smoothstep(0.58, 0.90, macro);         // sun-scorched patches, clustered not speckled
    height = clamp(0.30 * clump + 0.22 * clumpBig + 0.24 * mid + 0.14 * macro + 0.10 * fine, 0.0, 1.0);
    vec3 soil = vec3(0.088, 0.070, 0.046);     // the earth between the tufts
    vec3 loGrass = vec3(0.072, 0.135, 0.048);  // shaded turf
    vec3 hiGrass = vec3(0.185, 0.310, 0.098);  // lit blade tips
    albedo = mix(soil, loGrass, clamp(0.30 + 0.70 * clumpBig, 0.0, 1.0));
    albedo = mix(albedo, hiGrass, clump * 0.62);
    albedo = mix(albedo, vec3(0.290, 0.268, 0.128), dry * 0.52);   // straw yellow where it is dry
    orm = vec3(0.62 + 0.38 * height, 0.96, 0.0);
  }

  // occlude the crevices into the albedo, the whole family's shared last step (forge-ground.frag's
  // own move): deeper = darker, so the Sobel normal and the albedo agree about where the ground is.
  albedo *= mix(0.62, 1.0, height);
}

#include './forge-emit.glsl';
