// dust.frag — L94 ambient dust/pollen motes (extracted from dust.js inline GLSL, invariant 4).
// Soft round additive sprite: a smoothstep on the point-sprite radius so motes GLOW and never read as hard dots.
uniform vec3 uColor;
uniform float uOpacity;
varying float vSp;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);                      // soft round falloff (no hard dots)
  if (a <= 0.0) discard;
  gl_FragColor = vec4(uColor, a * uOpacity);              // additive: rgb glows, scaled by softness × opacity
}
