// sprite-batch.frag — sample this instance's atlas sub-rect, tint, alpha-cutout.
//
// depthTest/depthWrite are OFF on the batch material (set in sprite-batcher.js) -- 2D sprites stack by
// DRAW ORDER (the painter's algorithm), the same convention LittleJS and Pixi both use for UI/game
// sprites, not by a depth buffer. That sidesteps a whole class of alpha-sorting bugs a depth-tested
// transparent quad would hit, at the cost of the caller owning draw order (createSpriteBatcher's
// swap-remove compaction preserves relative order of the sprites that DON'T move, see its header).
//
// ALPHA CUTOUT (discard below a threshold) rather than plain alpha blending: with depthWrite off, a
// low-alpha blended pixel would still fully occlude whatever the NEXT sprite draws behind it in the same
// instanced batch (no depth buffer to resolve it later) -- discard keeps genuinely transparent atlas
// padding from ever compositing as a faint gray box.

uniform sampler2D uMap;

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
  vec4 tex = texture2D(uMap, vUv);
  float a = tex.a * vAlpha;
  if (a < 0.02) discard;   // covers BOTH transparent atlas padding AND a fully-faded (aAlpha≈0) instance
  gl_FragColor = vec4(tex.rgb * vColor, a);
}
