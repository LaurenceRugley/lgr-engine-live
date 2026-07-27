/* ============================================================
   silk-depth.frag — Dusk Silk shadow-CAST depth pass (Lesson SHADOWS).
   ------------------------------------------------------------
   The fragment half of the silk's customDepthMaterial. Under the engine's PCFShadowMap the sun's
   shadow map is a hardware DEPTH texture, so the depth that matters is written by the rasterizer
   from gl_Position — this colour output is not what getShadow() samples. We still pack the depth
   into RGBA the way three's own MeshDepthMaterial does: it is the conventional, self-documenting
   output and keeps this material correct if the shadow type is ever changed to a packed variant.
   'packDepthToRGBA' comes from three's <packing> chunk.
   ============================================================ */
#include <common>
#include <packing>

varying vec2 vHighPrecisionZW;

void main() {
  /* Normalised device depth in [0,1], then packed to RGBA (three's MeshDepthMaterial recipe). */
  float fragCoordZ = 0.5 * vHighPrecisionZW.x / vHighPrecisionZW.y + 0.5;
  gl_FragColor = packDepthToRGBA(fragCoordZ);
}
