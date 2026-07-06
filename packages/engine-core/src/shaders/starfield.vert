/* starfield.vert (L57) — a point-cloud of stars on a dome behind the city.
   Each star carries a per-point SIZE, base BRIGHTNESS, and a twinkle PHASE. The star's brightness
   oscillates around its base by a small amount; uTwinkle scales that to 0 under prefers-reduced-motion
   (freeze). gl_PointSize is screen-space pixels (no distance attenuation → stars stay crisp points in
   both the ortho iso/dimetric and the perspective camera). */
attribute float aSize;
attribute float aBright;
attribute float aPhase;

uniform float uTime;       // elapsed seconds (one shared clock)
uniform float uTwinkle;    // 1 = twinkle, 0 = frozen (reduced motion)
uniform float uSizeScale;  // per-tier point-size multiplier

varying float vBright;

void main() {
  // per-star shimmer: base ± up to 30%, staggered by aPhase so the field doesn't pulse in unison.
  float tw = 1.0 - uTwinkle * 0.3 * (0.5 + 0.5 * sin(uTime * 2.2 + aPhase));
  vBright = aBright * tw;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uSizeScale;
}
