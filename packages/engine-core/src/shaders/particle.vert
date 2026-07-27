/* ============================================================
   particle.vert — Lesson M6: render one GL_POINT per particle via VERTEX-TEXTURE FETCH.
   ------------------------------------------------------------
   The geometry is a cloud of texSize*texSize points, each carrying only aUv — the texel it should read.
   This shader pulls that particle's live position + colour + size straight from the GPU state textures
   (VTF — the same trick the water surface uses), so the CPU never touches per-particle data. Dead
   particles (life <= 0) are parked off-screen at zero size so they draw nothing. Point size falls off with
   distance (perspective) and fades in the last fraction of life.
   ============================================================ */
precision highp float;
attribute vec2 aUv;
uniform sampler2D uPos;
uniform sampler2D uCol;
uniform float uSizeScale;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 pos = texture2D(uPos, aUv);
  vec4 col = texture2D(uCol, aUv);
  float life = pos.w;
  if (life <= 0.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; vAlpha = 0.0; return; }
  vec4 mv = modelViewMatrix * vec4(pos.xyz, 1.0);
  gl_Position = projectionMatrix * mv;
  float fade = clamp(life * 4.0, 0.0, 1.0);        // fade out over the final 0.25 s of life
  gl_PointSize = col.w * uSizeScale * fade / max(0.1, -mv.z);
  vColor = col.rgb;
  vAlpha = fade;
}
