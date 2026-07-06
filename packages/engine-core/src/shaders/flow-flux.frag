/* ============================================================
   flow-flux.frag — L87 GPGPU flow, PASS 1 of 2: the OUTFLOW FLUX update.
   ------------------------------------------------------------
   This is the GPU port of step (1)+(2) of the CPU virtual-pipes sim in water-flow.js.
   Each output texel == one grid cell; this fragment shader IS the per-cell kernel
   (a CUDA kernel, but `gl_FragColor`). It reads the cell's depth+terrain and its four
   neighbours, and writes the cell's four outflow fluxes packed in RGBA = (L, R, B, T).

   THE MATH (identical to the CPU oracle — that's what makes them parity-match):
     • Each pipe ACCELERATES by the TOTAL-HEAD difference (terrain+water) to that
       neighbour, times dt·FLOW (gravity), plus the previous flux × DAMP (friction).
       max(0,…) = a pipe only pushes water OUT (downhill), never sucks it back.
     • Then the TRANSFER CLAMP: total outflow this step can't exceed the water present
       (k = min(1, W/out)) — conservation + the stability guard the research warns about.

   Boundaries: a cell on the grid edge has no neighbour on that side → that flux is 0
   (the CPU does `if (i>0) …`). We replicate with index guards (floor(uv·N)).
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;   // (W depth, S sediment, ·, ·) — we read .r here
uniform sampler2D uTerr;    // terrain world-Y in .r (uploaded from the live heightfield)
uniform sampler2D uFlux;    // PREVIOUS flux (L, R, B, T) — for the DAMP term
uniform vec2  uTexel;       // 1.0 / N (the step to a neighbour texel)
uniform float uN;           // grid size N (for edge guards)
uniform float uDt;          // clamped timestep
uniform float uFlow;        // FLOW = G·cell (pipe coefficient)
uniform float uDamp;        // DAMP (flux friction per tick)

void main() {
  vec2 uv = vUv;
  float i = floor(uv.x * uN);          // this cell's column index
  float j = floor(uv.y * uN);          // this cell's row index

  float Wc = texture2D(uState, uv).r;
  float Tc = texture2D(uTerr,  uv).r;
  float hc = Tc + Wc;                   // this cell's TOTAL head
  vec4  fp = texture2D(uFlux,  uv);     // previous (L, R, B, T)

  float l = 0.0, r = 0.0, b = 0.0, t = 0.0;
  if (i > 0.5) {                                          // left neighbour exists (i>0)
    vec2 n = uv + vec2(-uTexel.x, 0.0);
    float hn = texture2D(uTerr, n).r + texture2D(uState, n).r;
    l = max(0.0, fp.r * uDamp + uDt * uFlow * (hc - hn));
  }
  if (i < uN - 1.5) {                                     // right neighbour exists (i<N-1)
    vec2 n = uv + vec2(uTexel.x, 0.0);
    float hn = texture2D(uTerr, n).r + texture2D(uState, n).r;
    r = max(0.0, fp.g * uDamp + uDt * uFlow * (hc - hn));
  }
  if (j > 0.5) {                                          // bottom neighbour (j>0, −z)
    vec2 n = uv + vec2(0.0, -uTexel.y);
    float hn = texture2D(uTerr, n).r + texture2D(uState, n).r;
    b = max(0.0, fp.b * uDamp + uDt * uFlow * (hc - hn));
  }
  if (j < uN - 1.5) {                                     // top neighbour (j<N-1, +z)
    vec2 n = uv + vec2(0.0, uTexel.y);
    float hn = texture2D(uTerr, n).r + texture2D(uState, n).r;
    t = max(0.0, fp.a * uDamp + uDt * uFlow * (hc - hn));
  }

  // TRANSFER CLAMP: scale all four so total outflow ≤ the water present this step.
  float outv = (l + r + b + t) * uDt;
  float k = outv > 1e-9 ? min(1.0, Wc / outv) : 1.0;
  gl_FragColor = vec4(l * k, r * k, b * k, t * k);        // (L, R, B, T) clamped
}
