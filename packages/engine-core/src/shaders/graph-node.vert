// graph-node.vert — VIZ SLICE 5: a camera-facing billboard quad per node, instanced.
//
// Shared by the CORE layer and the HALO layer; the only difference is uSizeMul (the halo is bigger) and
// the fragment shader they pair with. Slice 3-4 drew real spheres; a sphere under a MeshBasicMaterial is
// a flat disc with extra triangles -- all cost, no shading. A billboard quad plus an SDF gives us a
// crisper circle, an analytic rim, and a procedural glow, for two triangles.
//
// BILLBOARDING IN VIEW SPACE: transform the instance's ORIGIN to view space, then offset by the quad's
// corner in view XY. View XY is parallel to the screen by construction, so the quad always faces the
// camera without ever touching a rotation matrix. Under the atlas's orthographic camera this also means
// one world unit is a constant number of pixels -- the property the whole look leans on.
//
// The per-instance radius rides inside instanceMatrix (graph-view writes a uniform scale). We recover it
// as the length of the matrix's first basis vector rather than passing a redundant attribute --
// length(m[0].xyz) is the x-axis scale of a uniformly-scaled transform.
//
// C++ anchor: instanceMatrix / instanceColor are declared for us by three's shader prefix when the
// object is an InstancedMesh -- the equivalent of a divisor-1 attribute the driver feeds per instance.

uniform float uSizeMul;   // 1.0 for the core layer, >1 for the halo layer
uniform float uScale;     // global node scale (pixel mode boosts this so small discs stay readable)
uniform float uHaloCap;   // slice 17: 1 = apply aHaloCap (the HALO material in pixel mode), 0 = ignore

attribute float aHaloCap; // slice 17: per-node halo radius cap, as a fraction of the default halo --
                          // written on SETTLE from nearest-neighbor distance (graph-view), so crowded
                          // neighborhoods stop pooling their glow into one blob. 1 everywhere else.
attribute vec3  aOutline; // slice 17: this node's outline INK color (darkened kind tint; warms with
                          // heat; carries the red/gold state channel). Only the core frag reads it.
attribute float aBadge;   // slice 19: 1 = this node carries real material (figma/pdf/img/deep note).
                          // CONTENT, not state -- deliberately a different channel from the hot ring.

varying vec2 vP;
varying vec3 vColor;
varying vec3 vOutline;
varying float vBadge;

void main() {
  vP     = uv * 2.0 - 1.0;   // -1..1 across the quad; length(vP) is the unit-disc SDF coordinate
  vColor = instanceColor;    // graph-view has already folded kind, heat, focus-dim and selection into this

  vOutline = aOutline;
  vBadge = aBadge;
  float radius = length(instanceMatrix[0].xyz) * uScale * uSizeMul * mix(1.0, aHaloCap, uHaloCap);

  vec4 mv = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  mv.xy += position.xy * 2.0 * radius;   // PlaneGeometry spans -0.5..0.5, so *2*radius gives radius units

  gl_Position = projectionMatrix * mv;
}
