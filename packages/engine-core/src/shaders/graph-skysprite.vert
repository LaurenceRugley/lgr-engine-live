// graph-skysprite.vert -- VIZ SLICE 16 (PIXEL WONDER): one billboard vertex for EVERY authored sky
// sprite -- the ringed planet, its distant moon, the 4-point cross sparkles, the tiny galaxies.
//
// Same view-space billboard as graph-glint.vert, with three additions: a per-sprite KIND selector
// (the fragment branches on it -- one geometry, one material, ONE draw call for the whole layer),
// a per-sprite TINT, and a per-sprite PHASE (sparkle twinkle stagger; galaxies use it as an arm-angle
// seed so no two spirals match). aCorner arrives PRE-ROTATED from the builder for tilted sprites
// (galaxies): rotating the billboard basis in JS is free and keeps the fragment's math axis-aligned.
//
// C++ anchor: aKind is a tagged-union discriminant packed per-vertex -- the fragment's branch is
// uniform across each sprite's pixels, so the GPU pays for one path, not four.

precision highp float;

attribute vec2  aCorner;   // unit quad corner, possibly pre-rotated (galaxy tilt)
attribute float aSize;     // world size of the sprite
attribute float aKind;     // 0 planet · 1 moon · 2 sparkle · 3 galaxy
attribute vec3  aTint;
attribute float aPhase;    // 0..1 stagger / seed

varying vec2  vC;
varying float vKind;
varying vec3  vTint;
varying float vPhase;

void main() {
  vC = aCorner;
  vKind = aKind;
  vTint = aTint;
  vPhase = aPhase;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  mv.xy += aCorner * aSize;
  gl_Position = projectionMatrix * mv;
}
