/* ============================================================
   flow-advect.frag — L87 GPGPU erosion, PASS 2: advect SEDIMENT downstream.
   ------------------------------------------------------------
   GPU port of step (2) of the CPU erode(): carry suspended sediment along the outflow so it
   deposits where the flow SLOWS (deltas/banks). The CPU does this as a SCATTER (each cell
   pushes a share to its neighbours); the GPU does the equivalent GATHER (each cell pulls the
   shares its neighbours push toward it):

     move(x)   = min(S_x, S_x · KADV · dt)          (sediment cell x sends out, if it has flux)
     Snew[c]   = S[c] − move(c) + Σ move(neighbour)·(neighbour's flux toward c)/(neighbour tot)

   A cell pulls from: right(its L flux), left(its R), above(its B), below(its T) — the exact
   mirror of the CPU's push. Then clamp S≥0 and zero sediment lost to the sea (terrain < rim).
   ============================================================ */
precision highp float;
varying vec2 vUv;

uniform sampler2D uState;   // (W, S, ·, ·) — S already updated by the erode/deposit pass
uniform sampler2D uTerr;    // terrain world-Y in .r (for the sea cutoff)
uniform sampler2D uFlux;    // (L, R, B, T)
uniform vec2  uTexel;
uniform float uN, uDt, uSeaY, uKADV;

float moveOut(float S, vec4 f) {                          // sediment a cell sends out this tick
  float tot = f.r + f.g + f.b + f.a;
  return (tot > 1e-9 && S > 1e-9) ? min(S, S * uKADV * uDt) : 0.0;
}

void main() {
  vec2 uv = vUv;
  float i = floor(uv.x * uN), j = floor(uv.y * uN);
  vec2 st = texture2D(uState, uv).rg;                     // (W, S)
  vec4 fc = texture2D(uFlux, uv);
  float out_ = moveOut(st.y, fc);

  float inflow = 0.0;
  if (i < uN - 1.5) {                                     // right neighbour pushes via its L flux
    vec2 n = uv + vec2(uTexel.x, 0.0); vec4 fn = texture2D(uFlux, n); float Sn = texture2D(uState, n).g;
    float tn = fn.r + fn.g + fn.b + fn.a; if (tn > 1e-9) inflow += moveOut(Sn, fn) * fn.r / tn;
  }
  if (i > 0.5) {                                          // left neighbour pushes via its R flux
    vec2 n = uv + vec2(-uTexel.x, 0.0); vec4 fn = texture2D(uFlux, n); float Sn = texture2D(uState, n).g;
    float tn = fn.r + fn.g + fn.b + fn.a; if (tn > 1e-9) inflow += moveOut(Sn, fn) * fn.g / tn;
  }
  if (j < uN - 1.5) {                                     // above neighbour pushes via its B flux
    vec2 n = uv + vec2(0.0, uTexel.y); vec4 fn = texture2D(uFlux, n); float Sn = texture2D(uState, n).g;
    float tn = fn.r + fn.g + fn.b + fn.a; if (tn > 1e-9) inflow += moveOut(Sn, fn) * fn.b / tn;
  }
  if (j > 0.5) {                                          // below neighbour pushes via its T flux
    vec2 n = uv + vec2(0.0, -uTexel.y); vec4 fn = texture2D(uFlux, n); float Sn = texture2D(uState, n).g;
    float tn = fn.r + fn.g + fn.b + fn.a; if (tn > 1e-9) inflow += moveOut(Sn, fn) * fn.a / tn;
  }

  float Snew = st.y - out_ + inflow;
  if (Snew < 0.0) Snew = 0.0;
  if (texture2D(uTerr, uv).r < uSeaY - 0.02) Snew = 0.0;  // sediment lost to the sea
  gl_FragColor = vec4(st.x, Snew, 0.0, 0.0);
}
