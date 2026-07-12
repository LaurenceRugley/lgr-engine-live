/* ============================================================
   edge-flow.vert — engine-first FLOWING-EDGE ribbon (K2 / shared with Mission Control).
   ------------------------------------------------------------
   Scene-AGNOSTIC: given node positions + index pairs, createEdgeField builds a
   feathered glow RIBBON (a camera-facing quad) per edge — NEVER a 1px GL_LINE
   (the forbidden cheap look). Energy flows along each edge in the fragment shader.

   Each ribbon is 4 verts carrying:
     aEndA / aEndB — the two node endpoints (object space; the pack's group
                     transform tracks any drift/rotation via modelViewMatrix).
     aAlong        — 0 at end A, 1 at end B (position along the ribbon).
     aSide         — -1 / +1 (which edge of the ribbon; feathered in the frag).

   Billboarding: we transform both endpoints to VIEW space, take the 2D edge
   direction there, and offset by its screen-plane perpendicular — so the ribbon
   always faces the camera with a constant world-space width, from any angle.

   HOUSE CONVENTION (ShaderMaterial): Three auto-injects position/uv/matrices +
   precision. We declare ONLY our own attributes/uniforms/varyings.
   ============================================================ */
uniform float uWidth;   // ribbon half-width in world units

attribute vec3  aEndA;
attribute vec3  aEndB;
attribute float aAlong;
attribute float aSide;

varying float vAlong;
varying float vSide;

void main() {
  vAlong = aAlong;
  vSide  = aSide;

  /* Endpoints → view space (tracks the group's slow rotation/drift). */
  vec3 aV = (modelViewMatrix * vec4(aEndA, 1.0)).xyz;
  vec3 bV = (modelViewMatrix * vec4(aEndB, 1.0)).xyz;

  vec3 baseV = mix(aV, bV, aAlong);

  /* Screen-plane perpendicular of the edge (epsilon guards a degenerate
     end-on edge where both endpoints project to the same xy). */
  vec2 dir  = bV.xy - aV.xy;
  dir = normalize(dir + vec2(1e-6, 0.0));
  vec2 perp = vec2(-dir.y, dir.x);

  baseV.xy += perp * aSide * uWidth;

  gl_Position = projectionMatrix * vec4(baseV, 1.0);
}
