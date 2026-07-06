/* ============================================================
   flow-depth.frag — L87 GPGPU flow, PASS 2 of 2: the DEPTH update.
   ------------------------------------------------------------
   GPU port of step (3) of the CPU sim: apply the net flux to the water depth.
     W += dt · (inflow − outflow)
   INFLOW into this cell = the four neighbours' flux pointing AT us:
     • left  neighbour's RIGHTWARD flux  (its .g)   ← CPU fR[c-1]
     • right neighbour's LEFTWARD flux   (its .r)   ← CPU fL[c+1]
     • below neighbour's TOP flux        (its .a)   ← CPU fT[c-N]
     • above neighbour's BOTTOM flux     (its .b)   ← CPU fB[c+N]
   OUTFLOW = this cell's own four fluxes summed. Then clamp W≥0, and DRAIN any cell
   below the ocean rim (terrain < seaY−0.02) to 0 — the sea absorbs it (off-world).
   Reads the CLAMPED flux written by flow-flux.frag this same tick.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;   // (W, S, ·, ·)
uniform sampler2D uTerr;    // terrain world-Y in .r
uniform sampler2D uFlux;    // CURRENT (clamped) flux (L, R, B, T)
uniform vec2  uTexel;
uniform float uN;
uniform float uDt;
uniform float uSeaY;        // sea level (ocean drain threshold = uSeaY − 0.02)

void main() {
  vec2 uv = vUv;
  float i = floor(uv.x * uN);
  float j = floor(uv.y * uN);

  vec4 fc = texture2D(uFlux, uv);                 // our own outflow (L, R, B, T)
  float inflow = 0.0;
  if (i > 0.5)      inflow += texture2D(uFlux, uv + vec2(-uTexel.x, 0.0)).g;  // left's rightward
  if (i < uN - 1.5) inflow += texture2D(uFlux, uv + vec2( uTexel.x, 0.0)).r;  // right's leftward
  if (j > 0.5)      inflow += texture2D(uFlux, uv + vec2(0.0, -uTexel.y)).a;  // below's top
  if (j < uN - 1.5) inflow += texture2D(uFlux, uv + vec2(0.0,  uTexel.y)).b;  // above's bottom
  float outflow = fc.r + fc.g + fc.b + fc.a;

  vec4 st = texture2D(uState, uv);                // (W, S, ·, ·)
  float Wn = st.r + uDt * (inflow - outflow);
  if (Wn < 0.0) Wn = 0.0;
  float Tc = texture2D(uTerr, uv).r;
  if (Tc < uSeaY - 0.02) Wn = 0.0;               // ocean rim → drains away
  gl_FragColor = vec4(Wn, st.g, 0.0, 0.0);        // carry sediment .g through (erosion lands in sub-commit 3)
}
