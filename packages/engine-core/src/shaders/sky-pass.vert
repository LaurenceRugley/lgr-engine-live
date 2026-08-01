/* ============================================================
   sky-pass.vert — the shared fullscreen-triangle/quad vertex shader for the A12-lift sky POST-PASSES
   (atmosphere-grade, god-rays, milky-way). A THREE ShaderPass renders a unit quad; this just forwards uv.
   ============================================================ */
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
