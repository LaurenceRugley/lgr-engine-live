/* ============================================================
   backdrop.vert — the VERTEX shader for the backdrop plane.
   Runs ONCE PER VERTEX. Our plane has 4 corners, so this runs 4 times.
   Its one required job: set gl_Position (where this corner lands).
   ============================================================ */

// A VARYING is our own channel from vertex -> fragment shader. We write it
// here per-vertex; the rasterizer interpolates it smoothly to every pixel in
// between before the fragment shader reads it. `vUv` = "varying UV".
varying vec2 vUv;

void main() {
  // `uv` is a built-in ATTRIBUTE Three.js attaches to PlaneGeometry: each
  // corner's 2D texture coordinate, running 0->1 across the plane. We just
  // forward it so the fragment shader can use it as a gradient coordinate.
  vUv = uv;

  // THE POSITION MATH. `position` is the vertex in the model's own local space.
  // We multiply by two matrices Three.js injects for us automatically:
  //   modelViewMatrix  : local space -> camera (eye) space
  //   projectionMatrix : eye space   -> CLIP SPACE (what the GPU clips against)
  // gl_Position is the required output: the corner's position in clip space.
  // (After this, fixed hardware divides by w to get Normalized Device
  //  Coordinates — the -1..1 cube that maps onto the screen.)
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
