/* ============================================================
   forge-math.js — the PURE, GPU-free guards of the texture forge (node-testable).
   ------------------------------------------------------------
   Kept separate from createTextureForge.js because that module imports .frag/.glsl shaders (which
   node can't load as ESM); these functions must stay importable in a plain node test. They encode
   the two invariants a recipe must respect — the Nyquist feature floor and the tiling repeat count.
   createTextureForge.js re-exports them so callers see one surface.
   ============================================================ */

// The minimum feature size, in TEXELS, below which a noise band bakes as white noise (see
// forge-common.glsl). Lowering this chasing detail is the classic forge mistake — the test pins it.
export const FORGE_MIN_TEXELS = 6.4;

// The smallest meaningful feature, in WORLD METRES, a bake at `size` px over `worldSize` m can hold.
// A recipe's finest band must stay above this. floor = MIN_TEXELS * worldSize / size.
export function nyquistFeatureFloor(size, worldSize) {
  return (FORGE_MIN_TEXELS * worldSize) / Math.max(1, size);
}

// Repeat count so a recipe tile (worldSize m) covers a surface of worldExtent m. Clamped to >= 1 and
// guarded against a zero worldSize (which would leak Infinity into a UV transform).
export function repeatFor(worldExtent, worldSize) {
  return Math.max(1, worldExtent / Math.max(1e-4, worldSize));
}
