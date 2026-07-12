// graph-halo.frag — VIZ SLICE 5: the additive glow that surrounds each node core.
//
// WHY A HALO LAYER EXISTS AT ALL. The engine's bloom pass thresholds the scene and blurs what survives.
// Feed it a flat disc and it returns a flat disc with a blurry outline -- the "bloom crank" look, where
// nothing is authored and everything is smeared. Feed it a graduated falloff and the bloom has a real
// gradient to work with, so the glow reads as the node EMITTING light. That is the whole difference
// between "a graph with bloom on" and art direction (section 8, leverage #2).
//
// The falloff is exp(-d^2 * k) -- a Gaussian in disc space, i.e. the shape a defocused point source
// actually makes. We subtract the value at the rim so the halo reaches exactly zero at the quad's edge
// instead of being cut off mid-gradient (a cut leaves a faint visible square, which additive blending
// then advertises).
//
// HEAT: graph-view folds the node's heat into this layer's instanceColor as an INTENSITY multiplier, so
// a freshly-edited note's halo is brighter and hotter, and it is that brightness -- not a separate
// effect -- that crosses the bloom threshold. Recency literally becomes light.

uniform float uFalloff;

varying vec2 vP;
varying vec3 vColor;

void main() {
  float d2 = dot(vP, vP);
  if (d2 > 1.0) discard;   // stay inside the inscribed disc; the quad's corners are not ours

  float i = exp(-d2 * uFalloff) - exp(-uFalloff);   // Gaussian, rebased so it hits 0 exactly at the rim
  i = max(i, 0.0);

  gl_FragColor = vec4(vColor * i, i);   // additive: alpha carries the same falloff so the blend is smooth
}
