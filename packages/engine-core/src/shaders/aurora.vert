/* ============================================================
   aurora.vert — Aurora hero scene (K3). Waving light-curtain ribbon.
   ------------------------------------------------------------
   Each aurora layer is a tall plane (a "curtain") displaced HORIZONTALLY by
   layered sine waves so it drifts and folds like a real aurora sheet. The wave
   amount is passed to the fragment shader to modulate the shimmer.

   Very slow: the time terms are scaled down hard so the curtain breathes over
   ~20-40s, never strobes. Per-layer uPhase de-syncs the layers.

   HOUSE CONVENTION (ShaderMaterial): built-ins auto-injected — declare only ours.
   ============================================================ */
uniform float uTime;
uniform float uPhase;   // per-layer phase offset (de-sync)

varying vec2  vUv;
varying float vWave;

void main() {
  vUv = uv;
  vec3 p = position;

  /* Two horizontal folds at different wavelengths/speeds → organic drape. */
  float w =
      sin(p.y * 0.45 + uTime * 0.28 + uPhase)        * 1.30
    + sin(p.y * 1.20 - uTime * 0.17 + uPhase * 1.7)  * 0.55;

  p.x += w;
  vWave = w;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
