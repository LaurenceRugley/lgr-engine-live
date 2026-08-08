/* ============================================================
   forge-glass.frag — CURTAIN-WALL GLASS (family: glass). Arc A-ART.
   ------------------------------------------------------------
   A glass tower facade is NOT a noisy procedural surface — real curtain-wall glass is close to
   flat and mostly SPECULAR (the sky/city it reflects does the visual work, not an albedo texture).
   MeshStandardMaterial has no transmission channel, so this approximates the look the way the
   existing forge families approximate everything else — a near-flat cool-tinted albedo, LOW
   roughness + HIGH metalness (so the engine's existing IBL/env reflection carries the "glass"
   read), and a periodic MULLION grid (the thin metal frame between panes) as the only real height
   feature — a tower reads as glazed panels, not a smooth blue box.
   ============================================================ */
#include './forge-common.glsl';

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  float panesX = 4.0, panesY = 3.0;
  float mx = fract(uv.x * panesX), my = fract(uv.y * panesY);
  float mullion = 1.0 - smoothstep(0.0, 0.06, min(min(mx, 1.0 - mx), min(my, 1.0 - my)));
  // a very faint per-pane tint variation (real curtain walls aren't perfectly uniform panes).
  float paneTint = hash1(floor(vec2(uv.x * panesX, uv.y * panesY)));
  // a subtle low-frequency sheen gradient standing in for "the sky it's reflecting shifts with angle".
  float sheen = fbm(uv * 1.5, 1.5, 2);

  height = clamp(0.5 - 0.4 * mullion, 0.0, 1.0);   // the mullion frame is the only real relief; panes stay flat

  vec3 paneLo = vec3(0.10, 0.14, 0.17);    // deep sky-blue glass
  vec3 paneHi = vec3(0.20, 0.26, 0.30);    // lighter, slightly warmer reflection catch
  vec3 col = mix(paneLo, paneHi, clamp(0.35 + 0.5 * sheen + 0.15 * paneTint, 0.0, 1.0));
  vec3 mullionCol = vec3(0.06, 0.065, 0.07);   // dark anodised aluminium frame
  col = mix(col, mullionCol, mullion);
  albedo = col;

  float ao = mix(0.9, 1.0, height);   // barely any occlusion — a flat facade, not a cracked surface
  // panes are near-mirror smooth + metallic (reflection carries the "glass" read); the mullion frame
  // is a duller brushed metal — still metallic, a touch rougher.
  float rough = mix(0.06, 0.35, mullion);
  float metal = mix(0.85, 0.9, mullion);
  orm = vec3(ao, rough, metal);
}

#include './forge-emit.glsl';
