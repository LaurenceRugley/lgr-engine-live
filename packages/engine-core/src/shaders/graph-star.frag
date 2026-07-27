// graph-star.frag -- VIZ SLICE 15: the twinkle's other half. Brightness rides the ALPHA channel
// because the points blend additively (src * alpha added to the frame): scaling alpha scales the
// star's contribution exactly the way PointsMaterial's opacity did, so uTwinkle = 0 is byte-faithful
// to the slice-5 material. Clamped so a deep trough never goes negative-additive (impossible anyway,
// but a clamp is cheaper than an argument with a driver).

precision highp float;

uniform float uOpacity;

varying float vTw;
varying vec3  vColor;   // slice 16: per-star tint (variety) -- was a uniform; uniform-filled when off

void main() {
  gl_FragColor = vec4(vColor, uOpacity * clamp(vTw, 0.0, 2.0));
}
