/* ============================================================
   blit.frag — Lesson W: show a texture, unchanged. The whole shader is one fetch.
   ------------------------------------------------------------
   Packs that do their own rendering into a private target (Liquid Metal's half-res raymarch, Living
   Ink's simulation) still have to hand the DIRECTOR a normal Scene to render — so they present a
   fullscreen quad whose only job is to display that target. This is that quad's material.

   Not reusing an existing shader here is deliberate, not laziness: flow-copy.frag looks similar but
   writes only the RED channel (it's the terrain heightfield seeder), and post-mix.frag blends two
   textures. Neither means "show this image". Borrowing either would have been a subtle bug in a file
   nobody would think to re-read.

   The upscale is free: the sampler's LinearFilter does the interpolation in hardware.
   ============================================================ */
precision highp float;

varying vec2 vUv;
uniform sampler2D uTex;

void main() {
  gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 1.0);
}
