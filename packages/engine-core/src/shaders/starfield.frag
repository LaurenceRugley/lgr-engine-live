/* starfield.frag (L57) — shape the point sprite per fidelity TIER + fade with night.
   uMode: 0 = realistic (soft round), 1 = vector (hard-edged round dot), 2 = pixel (square block).
   uNight fades the whole field in at night (0 by day → 1 deep night), mirroring the moon's gate.
   Additive blending (set on the material) makes the stars read as light against the dark sky. */
precision highp float;

uniform vec3  uColor;
uniform float uNight;
uniform float uMode;

varying float vBright;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float a;
  if (uMode > 1.5)      a = 1.0;                       // pixel: full square cell (the post-crunch blocks it)
  else if (uMode > 0.5) a = step(d, 0.45);             // vector: clean hard dot
  else                  a = smoothstep(0.5, 0.06, d);  // realistic: soft round point
  float alpha = a * vBright * uNight;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(uColor, alpha);
}
