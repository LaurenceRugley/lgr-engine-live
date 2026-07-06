/* ============================================================
   post-mix.frag — the STYLE CROSSFADE: dissolve toon ↔ pixel in the band.
   ------------------------------------------------------------
   STYLE-LOD switches between the toon look (near) and the pixel look (far). A
   hard cut at one zoom level would pop; instead we leave a transition BAND where
   both styles are rendered to their own textures and we blend between them. This
   pass is the blend: a single `mix()` driven by `uBlend` (0 = all toon, 1 = all
   pixel), which main.js computes as a smoothstep across the band so the dissolve
   eases in and out instead of being linear. Cheapest possible pass — two reads
   and a lerp — and it only runs while you are actually inside the band.
   ============================================================ */
precision highp float;

varying vec2 vUv;
uniform sampler2D uToon;   // the toon-styled frame
uniform sampler2D uPixel;  // the pixel-styled frame
uniform float     uBlend;  // 0 → toon, 1 → pixel

void main() {
  vec3 t = texture2D(uToon, vUv).rgb;
  vec3 p = texture2D(uPixel, vUv).rgb;
  gl_FragColor = vec4(mix(t, p, uBlend), 1.0);
}
