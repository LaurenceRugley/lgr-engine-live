// graph-comet.frag -- VIZ SLICE 15: a comet is a GRADIENT, not a sprite. Three terms along the quad:
//
//   TAIL   brightness ramps toward the head as pow(u, 2.2) -- a linear ramp reads as a painted wedge,
//          a gamma-ish curve reads as light falling off (the same reason display gamma exists).
//   HEAD   a tight exponential knot at u = 1 -- the "star" being dragged across the sky.
//   ACROSS a gaussian cross-section so the ribbon has soft edges. THE WIDTH LESSON (thin-line death,
//          section 8): the quad is built ~0.2 world units wide so the tail holds >= 1-2 virtual pixels
//          through the DB32 quantizer -- a hairline tail would sample in and out of existence, which is
//          exactly the strobe the ribbon-edge keystone was built to kill. Same trap, same cure.
//
// uFade: 0->1->0 over the flight (set by JS): the comet ignites entering the sky and dies leaving it,
// so there is never a hard pop-in rectangle at the spawn ring.
// Additive blending over the near-black sky; the graph draws AFTER this layer (renderOrder), so a
// comet can only ever add light UNDER the graph, never occlude it.

precision highp float;

uniform vec3  uColor;
uniform float uIntensity;
uniform float uFade;

varying vec2 vUv;

void main() {
  float u = vUv.x;                                     // 0 = tail tip, 1 = head
  float tail = pow(u, 2.2);
  float head = exp(-(1.0 - u) * 26.0) * 1.7;
  float d = (vUv.y - 0.5) * 2.0;                       // -1..1 across the ribbon
  float across = exp(-d * d * 5.0);
  // The tail thins as it trails: pinch the cross-section by u so the streak is a teardrop, not a bar.
  across *= mix(0.35, 1.0, u);
  float g = (tail * 0.85 + head) * across * uIntensity * uFade;
  gl_FragColor = vec4(uColor * g, 1.0);                // additive: color carries everything, alpha is moot
}
