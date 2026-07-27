/* ============================================================
   silk-depth.vert — Dusk Silk shadow-CAST depth pass (Lesson SHADOWS).
   ------------------------------------------------------------
   This is the vertex shader of the silk mesh's 'customDepthMaterial'. Three renders the scene
   from the SUN's point of view through this material to build the shadow depth map. The default
   MeshDepthMaterial would displace nothing — it would cast the FLAT plane's shadow, and the
   waves you see would have no shadows at all. So this pass must apply the EXACT same wave
   displacement as the beauty pass — which is why the displacement lives in the shared include.

   We only need the DEPTH here (three's PCF shadow map is a hardware depth texture — the fragment
   COLOUR is not sampled), so this outputs the clip-space position and hands the depth's z/w to
   the fragment for the conventional packed-depth write (harmless, and correct if the shadow type
   is ever switched to a packed-RGBA one).
   ============================================================ */
uniform float uTime;

varying vec2 vHighPrecisionZW;

#include './silk-displace.glsl';

void main() {
  /* Same displacement as silk.vert — identical field, identical time. */
  float disp = silkDisplacement(position, uTime);
  vec3 transformed = position;
  transformed.y += disp;

  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  vHighPrecisionZW = gl_Position.zw;
}
