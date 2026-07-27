/* ============================================================
   living-ink-show.frag — Lesson W: paint the simulation.
   ------------------------------------------------------------
   The Gray-Scott state (living-ink-sim.frag) is just two numbers per texel — it has no colour and no
   lighting. This shader is where it becomes an image.

   Two moves do all the work:

   1. The RAMP. Chemical B's concentration is mapped through a 3-stop palette (paper → ink → a bright
      accent at the reacting front). Mapping the raw value straight to grey would look like a heightmap;
      the ramp is what makes it read as INK — pigment blooming in water.

   2. The EDGE. The most alive part of the pattern is where B is CHANGING fastest, not where it is
      highest. So we take the gradient of B across the texel (a cheap 2-tap central difference) and use
      its magnitude to lay a bright rim along the growth front. That rim is the "wet" line a real ink
      blot has at its advancing edge, and it's what stops the whole thing looking like a flat stain.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;
uniform vec2      uTexel;
uniform vec3      uPaper;   // the ground the ink sits on
uniform vec3      uInk;     // the pigment
uniform vec3      uGlow;    // the bright front where the reaction is actively eating

void main() {
  float b = texture2D(uState, vUv).g;

  /* Gradient of B → where is the pattern GROWING right now. */
  float bx = texture2D(uState, vUv + vec2(uTexel.x, 0.0)).g - texture2D(uState, vUv - vec2(uTexel.x, 0.0)).g;
  float by = texture2D(uState, vUv + vec2(0.0, uTexel.y)).g - texture2D(uState, vUv - vec2(0.0, uTexel.y)).g;
  float edge = clamp(length(vec2(bx, by)) * 9.0, 0.0, 1.0);

  /* Paper → ink through the concentration, then the glowing front laid on top. */
  vec3 col = mix(uPaper, uInk, smoothstep(0.08, 0.34, b));
  col = mix(col, uGlow, edge * 0.60);

  gl_FragColor = vec4(col, 1.0);
}
