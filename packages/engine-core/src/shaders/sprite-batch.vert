// sprite-batch.vert — one draw call for THOUSANDS of atlas sprites (createSpriteBatcher).
//
// Straight InstancedMesh transform (no billboarding trick, unlike graph-node.vert): the 2D layer's
// camera is an OrthographicCamera looking straight down -Z at a flat XY plane, so a quad's own
// instanceMatrix (position.xy, a Z rotation, scale.xy) already IS its on-screen placement -- there is no
// "always face the camera" problem to solve, because everything already faces the camera by construction.
//
// instanceMatrix / instanceColor are declared for us by three's InstancedMesh shader prefix (same as
// graph-node.vert -- see that file's C++ anchor). aUvRect is the one attribute THIS shader owns: which
// rectangle of the shared atlas texture this instance's quad should sample, so one draw call can show
// N different sprites -- the entire reason a texture atlas exists (a texture SWAP breaks the batch;
// an atlas turns "N sprites, N textures" into "N sprites, 1 texture, 1 draw").
//
// aAlpha (2D LAYER PHASE 2, bundled per the owner's Q2 call -- see sprite-batcher.js header): a SEPARATE
// per-instance float, not folded into aUvRect (already a fully-used vec4). instanceColor (vec3) has no
// alpha channel of its own, so without this every sprite/glyph/panel-slice would be permanently opaque --
// no fade-in HUD, no dimmed disabled button, no cross-fade between two text states.

attribute vec4 aUvRect;   // (u0, v0, uWidth, vHeight) -- this instance's sub-rect of the shared atlas, normalized [0,1]
attribute float aAlpha;   // this instance's opacity multiplier, 0..1 (default 1 -- see sprite-batcher.js's writeSlot)

varying vec2 vUv;
varying vec3 vColor;
varying float vAlpha;

void main() {
  // PlaneGeometry's own uv attribute spans [0,1] with V=0 at the quad's BOTTOM edge, V=1 at its TOP
  // (three's own plane-geometry convention). texture-atlas.js's v0 is the TOP of the source canvas
  // (flipY:false, canvas-pixel-space IS uv-space -- see that file's header). Those two "top"s point in
  // OPPOSITE directions, so sampling with the geometry's raw V would show every sprite upside down --
  // invisible for a radially-symmetric disc sprite (Phase 1's own test art), but immediately obvious on
  // real text (2D LAYER PHASE 2's own screenshot caught this -- see HANDOFF.md). Flipping V here, once,
  // is the fix: geometry-top (V=1) now samples atlas-top (v0), geometry-bottom (V=0) samples the atlas
  // row at v0+vHeight.
  vUv = aUvRect.xy + vec2(uv.x, 1.0 - uv.y) * aUvRect.zw;
  vColor = instanceColor;
  vAlpha = aAlpha;

  vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
}
