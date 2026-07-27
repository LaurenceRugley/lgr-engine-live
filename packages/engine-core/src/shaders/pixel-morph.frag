/* ============================================================
   pixel-morph.frag — Lesson Q: the beauty↔pixel dissolve.
   ------------------------------------------------------------
   The whole shader is one lerp. That is deliberate.

   The QUANTIZE already exists (post-pixelkit.frag: snap → dither → palette) and the
   city ships it. This pass does NOT reimplement any of it — it takes the two finished
   images and cross-fades:

     uRaw   — the pack's scene rendered straight (continuous tone, HDR)
     uPix   — that SAME scene put through the UNMODIFIED post-pixelkit pass
     uMorph — 0 = pure beauty · 1 = pure pixel

   WHY A SEPARATE SHADER, not a uMorph uniform bolted onto post-pixelkit.frag: that
   file is SHARED with the city's pixel tier. A new uniform defaults to 0 in GLSL, so
   the city (which would never set it) would silently start rendering the raw branch —
   a tier-guard break dressed up as a feature. A shared shader is a shared signature:
   extend it and you have changed every caller. So the morph lives HERE, in the hero's
   own pass, and post-pixelkit stays byte-identical for the city.
   C++ anchor: don't add a defaulted parameter to a function ten call-sites depend on —
   wrap it.

   A straight mix() (not a fancy wipe) is the right dissolve: the two images are the same
   scene from the same camera, so corresponding pixels agree on WHERE things are and
   disagree only on HOW they're coloured. Lerping between them reads as the image
   "resolving" into pixels rather than as two pictures fighting.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uRaw;    // continuous-tone render
uniform sampler2D uPix;    // the post-pixelkit (snapped + dithered + palette-quantized) render
uniform float     uMorph;  // 0 → beauty, 1 → pixel

void main() {
  vec3 raw = texture2D(uRaw, vUv).rgb;
  vec3 pix = texture2D(uPix, vUv).rgb;
  gl_FragColor = vec4(mix(raw, pix, uMorph), 1.0);
}
