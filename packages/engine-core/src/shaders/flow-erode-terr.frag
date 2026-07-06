/* ============================================================
   flow-erode-terr.frag — L87 GPGPU erosion, PASS 1a: write the new TERRAIN.
   ------------------------------------------------------------
   GPU port of step (1) of the CPU erode(): hydraulic erosion/deposition. Fast water on a
   slope picks soil UP (terrain down); slow/over-loaded water DROPS it (terrain up); dry
   cells settle their remaining sediment out. Capacity = KC · speed · slope.

   A fragment shader writes ONE target, but erosion changes TWO fields (terrain AND sediment).
   So we run the IDENTICAL math in two sibling passes reading the SAME old state: THIS pass
   writes terrain (T + d); flow-erode-sed.frag writes sediment (S − d). `d` is the per-cell
   terrain delta: + = deposit (up), − = erode (down). The KEY stability guard is the per-tick
   clamp |d| ≤ MAXD (erosion is a positive-feedback loop — this stops spikes/pits/NaN).
   ============================================================ */
precision highp float;
varying vec2 vUv;

uniform sampler2D uState;   // (W, S, ·, ·)
uniform sampler2D uTerr;    // terrain world-Y in .r
uniform sampler2D uFlux;    // (L, R, B, T)
uniform vec2  uTexel;
uniform float uN, uDt, uCell, uSeaY;
uniform float uKC, uKE, uKD, uMaxD, uMinDepth, uErosK;

// the shared per-cell terrain delta (+ deposit / − erode), clamped to ±MAXD.
float erodeDelta(vec2 uv, float i, float j, float W, float S, float T) {
  if (W <= uMinDepth) {                                   // dry → settle remaining sediment out (deposit)
    return S > 0.0 ? min(uMaxD, uKD * S * uDt) : 0.0;
  }
  vec4 f = texture2D(uFlux, uv);
  float tf = f.r + f.g + f.b + f.a;                       // total throughflow → flow-speed proxy
  float v = tf / (W + 0.02);
  float hl = i > 0.5      ? texture2D(uTerr, uv + vec2(-uTexel.x, 0.0)).r : T;
  float hr = i < uN - 1.5 ? texture2D(uTerr, uv + vec2( uTexel.x, 0.0)).r : T;
  float hd = j > 0.5      ? texture2D(uTerr, uv + vec2(0.0, -uTexel.y)).r : T;
  float hu = j < uN - 1.5 ? texture2D(uTerr, uv + vec2(0.0,  uTexel.y)).r : T;
  float slope = min(2.0, length(vec2(hr - hl, hu - hd)) / (2.0 * uCell));
  float cap = uKC * v * max(0.05, slope) * uErosK;        // sediment the flow CAN carry here
  if (cap > S) return -min(uMaxD, uKE * (cap - S) * uDt); // under-loaded → ERODE (terrain down)
  return            min(uMaxD, uKD * (S - cap) * uDt);    // over-loaded  → DEPOSIT (terrain up)
}

void main() {
  vec2 uv = vUv;
  float i = floor(uv.x * uN), j = floor(uv.y * uN);
  vec2 st = texture2D(uState, uv).rg;                     // (W, S)
  float T = texture2D(uTerr, uv).r;
  float d = erodeDelta(uv, i, j, st.x, st.y, T);
  gl_FragColor = vec4(T + d, 0.0, 0.0, 0.0);
}
