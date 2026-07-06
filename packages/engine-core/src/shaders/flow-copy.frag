/* ============================================================
   flow-copy.frag — L87 GPGPU: seed the terrain render-target from a CPU upload.
   ------------------------------------------------------------
   The GPU erosion step MUTATES the terrain, so terrain has to live in a render target
   (you can't write CPU-side into an RT). This trivial pass copies the CPU-uploaded
   terrain DataTexture (uSrc.r = world-Y) into the terrain RT — used to SEED it (on a
   new world / sculpt / when GPU erosion is enabled). Between seeds, erosion evolves the
   RT on its own (the on-GPU feedback loop the brief asks for).
   ============================================================ */
precision highp float;
varying vec2 vUv;
uniform sampler2D uSrc;
void main() { gl_FragColor = vec4(texture2D(uSrc, vUv).r, 0.0, 0.0, 0.0); }
