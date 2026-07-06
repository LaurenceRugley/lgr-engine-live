/* ============================================================
   water-surface.vert — VERTEX shader for the VISIBLE water plane.
   ------------------------------------------------------------
   The plane is a dense 256×256 grid of vertices laid flat. This shader reads the
   height the simulation computed (uHeight) and pushes each vertex UP by it (VTF —
   Vertex Texture Fetch), turning the flat grid into a rippling surface.

   Lesson 04 change: we now also output the vertex's WORLD-space position
   (vWorldPos) so the fragment shader can do proper world-space lighting (a real
   view direction from the camera, a world-space light). To get world space we
   multiply by `modelMatrix` alone (object → world); splitting the usual
   modelViewMatrix into viewMatrix * modelMatrix lets us grab the world position
   on the way through.
   ============================================================ */
precision highp float;

uniform sampler2D uHeight;   // the simulation's output (height in the red channel)
uniform float uDisplace;     // how tall the ripples stand in world units

varying vec2 vUv;
varying vec3 vWorldPos;      // NEW: world-space position, for the fragment's lighting

void main() {
  vUv = uv;

  float h = texture2D(uHeight, uv).r;            // this vertex's water height
  vec3 displaced = position + vec3(0.0, 0.0, h * uDisplace); // local +Z = up

  vec4 worldPos = modelMatrix * vec4(displaced, 1.0); // object → WORLD space
  vWorldPos = worldPos.xyz;

  // viewMatrix * worldPos == modelViewMatrix * displaced; we split it only so we
  // could capture worldPos above.
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
