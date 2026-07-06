/* ============================================================
   flow-erode-sed.frag — L87 GPGPU erosion, PASS 1b: write the new SEDIMENT.
   ------------------------------------------------------------
   Sibling of flow-erode-terr.frag: the IDENTICAL erosion delta `d`, applied to sediment
   instead of terrain. Conservation: soil removed from terrain is added to the water's
   sediment load and vice-versa, so dS = −d (erode d<0 → S rises; deposit d>0 → S falls).
   Reads the SAME old state as the terrain pass (both run before either swaps) so the two
   stay consistent. Carries depth W through unchanged in .r.
   ============================================================ */
precision highp float;
varying vec2 vUv;

uniform sampler2D uState;   // (W, S, ·, ·)
uniform sampler2D uTerr;    // terrain world-Y in .r
uniform sampler2D uFlux;    // (L, R, B, T)
uniform vec2  uTexel;
uniform float uN, uDt, uCell, uSeaY;
uniform float uKC, uKE, uKD, uMaxD, uMinDepth, uErosK;

// MUST be byte-identical to flow-erode-terr.frag's erodeDelta (so terrain & sediment agree).
float erodeDelta(vec2 uv, float i, float j, float W, float S, float T) {
  if (W <= uMinDepth) {
    return S > 0.0 ? min(uMaxD, uKD * S * uDt) : 0.0;
  }
  vec4 f = texture2D(uFlux, uv);
  float tf = f.r + f.g + f.b + f.a;
  float v = tf / (W + 0.02);
  float hl = i > 0.5      ? texture2D(uTerr, uv + vec2(-uTexel.x, 0.0)).r : T;
  float hr = i < uN - 1.5 ? texture2D(uTerr, uv + vec2( uTexel.x, 0.0)).r : T;
  float hd = j > 0.5      ? texture2D(uTerr, uv + vec2(0.0, -uTexel.y)).r : T;
  float hu = j < uN - 1.5 ? texture2D(uTerr, uv + vec2(0.0,  uTexel.y)).r : T;
  float slope = min(2.0, length(vec2(hr - hl, hu - hd)) / (2.0 * uCell));
  float cap = uKC * v * max(0.05, slope) * uErosK;
  if (cap > S) return -min(uMaxD, uKE * (cap - S) * uDt);
  return            min(uMaxD, uKD * (S - cap) * uDt);
}

void main() {
  vec2 uv = vUv;
  float i = floor(uv.x * uN), j = floor(uv.y * uN);
  vec2 st = texture2D(uState, uv).rg;                     // (W, S)
  float T = texture2D(uTerr, uv).r;
  float d = erodeDelta(uv, i, j, st.x, st.y, T);
  float Snew = st.y - d;                                  // dS = −d (conservation)
  if (Snew < 0.0) Snew = 0.0;
  gl_FragColor = vec4(st.x, Snew, 0.0, 0.0);              // carry W (.r); new S (.g)
}
