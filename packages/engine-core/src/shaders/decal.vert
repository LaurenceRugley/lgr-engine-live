/* ============================================================
   decal.vert — Lesson M5: render the batched decal geometry with a per-vertex AGE.
   ------------------------------------------------------------
   All decals live in ONE geometry (one draw call). Each vertex carries its projected atlas uv and the
   time it was born; the fragment shader fades it out by age. Nothing fancy here — just forward uv + age.
   ============================================================ */
precision highp float;
attribute float aBorn;
uniform float uTime;
varying vec2 vUv;
varying float vAge;

void main() {
  vUv = uv;
  vAge = uTime - aBorn;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
