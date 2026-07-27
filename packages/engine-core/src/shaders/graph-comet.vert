// graph-comet.vert -- VIZ SLICE 15: the comet's ribbon. Nothing clever lives here -- the quad is a
// PlaneGeometry pre-rotated flat into the XZ plane (baked at build time) and the MESH carries the
// trajectory: position + yaw are set per frame by graph-ambient.js. The shader only forwards UVs;
// the whole comet look is the fragment's gradient.
//
// Why a flat world-space quad and not a billboard: the graph's own edges are flat ribbons lifted out
// of the same plane, and the iso camera's fixed oblique view means a flat streak foreshortens exactly
// the way the edges do -- the comet reads as living in the SAME sky, not pasted on the glass.

precision highp float;

varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
