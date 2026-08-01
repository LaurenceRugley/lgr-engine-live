/* realstars.vert — the TRUE-SKY star field (Yale BSC5, real positions). First-party (not
   vendored): the procedural night-sky's starfield.vert/frag are a vendored copy from engine-core
   and must stay byte-identical, so real stars get their OWN small shader pair instead of editing
   that one. Same point-sprite recipe (screen-space gl_PointSize, additive blend, twinkle) as the
   procedural field, for visual consistency — the two differences are REAL per-star COLOR (aColor,
   from the catalog's B-V index) and that 'position' here is recomputed every frame on the CPU
   (real alt/az, not a rotated static dome — see createTrueStars.js for why: refraction depends on
   each star's live altitude, which a rigid rotation can't bake in).
   C++ anchor: an 'attribute' here is exactly a per-element field in a struct-of-arrays vertex
   buffer — one value per star, streamed to the GPU once per draw call. */
attribute float aSize;
attribute float aBright;
attribute float aPhase;
attribute vec3  aColor;
attribute float aMag;      // the star's real visual magnitude (Bortle fade reads this directly)

uniform float uTime;
uniform float uTwinkle;
uniform float uSizeScale;
uniform float uLimitMag;   // naked-eye limiting magnitude for the current Bortle class (bortle.js)
uniform float uFadeBand;   // magnitudes of smooth transition around the limit (never a hard cutoff)

varying float vBright;
varying vec3  vColor;

void main() {
  float tw = 1.0 - uTwinkle * 0.25 * (0.5 + 0.5 * sin(uTime * 2.0 + aPhase));
  // BORTLE FADE: stars well brighter (lower mag) than the limit stay fully visible; stars fainter
  // than the limit vanish; a smooth band around the limit itself, so raising the limit reveals
  // fainter stars gradually — never a step function.
  float visible = 1.0 - smoothstep(uLimitMag - uFadeBand, uLimitMag, aMag);
  vBright = aBright * tw * visible;
  vColor = aColor;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uSizeScale;
}
