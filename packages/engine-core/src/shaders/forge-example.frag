/* ============================================================
   forge-example.frag — the FORGE reference surface (harness proof + family template).
   ------------------------------------------------------------
   Not shipped on any hoard surface; it is (a) the built-in default recipe that lets
   createTextureForge bake with no family wired (a smoke path), and (b) the worked example every
   family shader is written against. It shows the whole contract in one screen:
     - include forge-common.glsl (uniforms + noise) FIRST,
     - define surface(uv, out albedo, out orm, out height) using periodic noise only,
     - include forge-emit.glsl (main + channel routing) LAST.

   The surface itself: a warped-fbm dirt with worley grit and a low macro blotch — a neutral,
   honest "reads at 1-2 m" ground. Every band is kept above the Nyquist floor (periods are small
   enough in CELLS that a 1024 bake gives >= ~6.4 texels per feature).
   ============================================================ */
#include './forge-common.glsl';

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // macro variation (large, low-freq) so the tile does not read as one flat colour across a floor.
  float macro = fbm(warp(uv * 3.0, 3.0, 0.3), 3.0, 4);

  // mid detail — clods + trodden unevenness (period 12 cells -> ~85 texels at 1024, well above Nyquist).
  float mid = fbm(uv * 12.0, 12.0, 5);

  // fine grit via worley F1 (period 24 -> ~42 texels). 1 - F1 makes tight pebble cores.
  vec2 w = worley(uv * 24.0, 24.0);
  float grit = 1.0 - smoothstep(0.0, 0.35, w.x);

  // HEIGHT: mid unevenness minus pebble cores sitting proud, plus a touch of macro dip.
  height = clamp(0.45 * mid + 0.30 * grit + 0.25 * macro, 0.0, 1.0);

  // ALBEDO: two dirt tones lerped by macro+mid, darkened in the crevices (grit valleys), so the
  // normal + albedo agree about where the surface is low. Seed shifts tone via a hash of uSeed.
  vec3 lo = vec3(0.13, 0.11, 0.08);
  vec3 hi = vec3(0.32, 0.27, 0.19);
  vec3 col = mix(lo, hi, clamp(0.35 + 0.5 * macro + 0.4 * mid, 0.0, 1.0));
  col *= mix(0.7, 1.0, height);                 // ambient-occlude the low spots into the albedo
  col *= 0.9 + 0.2 * hash1(floor(uv * 5.0));    // subtle per-patch tone break-up
  albedo = col;

  // ORM: ao from height (low = occluded), roughness high (dirt), no metal. Damp spots slightly glossier.
  float ao = mix(0.55, 1.0, height);
  float rough = mix(0.82, 1.0, 1.0 - mid);      // trodden clods a touch smoother than loose grit
  orm = vec3(ao, rough, 0.0);
}

#include './forge-emit.glsl';
