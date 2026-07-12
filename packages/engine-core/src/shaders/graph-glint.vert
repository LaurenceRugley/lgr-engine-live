// graph-glint.vert -- VIZ SLICE 8: billboard vertex for the bright cross-glint stars.
// Classic view-space billboard: take the star's CENTER through modelView, then push the quad's corner
// out in view-space x/y so the sprite always faces the camera (ortho or perspective, same math).
// aCorner is the unit quad corner (-0.5..0.5); aSize is the star's world size.

precision highp float;

attribute vec2 aCorner;
attribute float aSize;

varying vec2 vC;   // corner coords (-0.5..0.5) -- the frag draws the glint in this space

void main() {
  vC = aCorner;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xy += aCorner * aSize;
  gl_Position = projectionMatrix * mv;
}
