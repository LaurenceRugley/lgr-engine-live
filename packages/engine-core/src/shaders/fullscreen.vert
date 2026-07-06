/* ============================================================
   fullscreen.vert — the VERTEX shader for a FULLSCREEN pass.
   ------------------------------------------------------------
   A "fullscreen pass" isn't drawing a 3D object — it's running a fragment
   shader once for every texel of an off-screen image (our water heightfield).
   To make that happen we draw a single quad that exactly covers the screen.

   Trick: the quad we pair this with is a 2×2 PlaneGeometry, so its four corners
   already sit at x,y ∈ {-1, +1} — which IS clip space (the −1..1 box the GPU
   draws). So we don't need the camera or projection matrices at all: we pass the
   corner straight through as the clip-space position. The orthographic camera in
   JS is only there because Three.js requires *some* camera to call .render().

   Our only real job: forward `uv` (0..1 across the quad) so the fragment shader
   knows which texel of the heightfield it is computing.
   ============================================================ */
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0); // corners are already in clip space
}
