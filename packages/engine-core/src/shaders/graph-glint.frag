// graph-glint.frag -- VIZ SLICE 8: a soft stellar core with two thin diffraction arms (the telescope
// cue: bright points through real optics grow a cross). Procedural, no texture; STATIC by design --
// a twinkling glint would fight the restraint brief, and a static one needs no reduced-motion gate.
// Additive over the near-black sky; uIntensity keeps the whole thing a whisper.

precision highp float;

uniform vec3  uColor;
uniform float uIntensity;

varying vec2 vC;   // -0.5..0.5 across the sprite

void main() {
  vec2 c = vC;
  float core = exp(-dot(c, c) * 160.0);
  // Two gaussian arms: thin across (y*y * 2600), fading along the arm (x*x * 22). And the transpose.
  float armH = exp(-c.y * c.y * 2600.0) * exp(-c.x * c.x * 22.0);
  float armV = exp(-c.x * c.x * 2600.0) * exp(-c.y * c.y * 22.0);
  float g = core + (armH + armV) * 0.55;
  gl_FragColor = vec4(uColor, 1.0) * g * uIntensity;   // premultiplied-ish for additive blending
}
