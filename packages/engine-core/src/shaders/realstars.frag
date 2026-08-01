/* realstars.frag — soft round point sprite, tinted by each star's real B-V colour, faded in at
   night (uNight, same convention as the procedural field). Always the "realistic" soft-dot look —
   true-sky is about accuracy, not a pixel/vector art-tier match. */
precision highp float;

uniform float uNight;

varying float vBright;
varying vec3  vColor;

void main() {
  vec2 p = gl_PointCoord - 0.5;
  float d = length(p);
  float a = smoothstep(0.5, 0.06, d);
  float alpha = a * vBright * uNight;
  if (alpha < 0.01) discard;
  gl_FragColor = vec4(vColor, alpha);
}
