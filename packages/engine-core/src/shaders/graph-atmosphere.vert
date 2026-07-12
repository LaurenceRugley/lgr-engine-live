// graph-atmosphere.vert — VIZ SLICE 5: a screen-space backdrop quad, drawn behind everything.
//
// The quad is a unit PlaneGeometry pushed straight to clip space, ignoring the camera entirely. That is
// deliberate: the nebula is ATMOSPHERE, not scenery. If it moved with the camera you would parallax it
// against the graph and the illusion would collapse into "a texture on a plane". The starfield -- which
// DOES live in the world and DOES parallax -- is what supplies depth. Two different jobs, two layers.
//
// z = 1.0 in clip space is the far plane; combined with depthTest:false and depthWrite:false on the
// material, this paints first and never occludes anything.

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position.xy * 2.0, 1.0, 1.0);   // PlaneGeometry(1,1) -> full NDC coverage
}
