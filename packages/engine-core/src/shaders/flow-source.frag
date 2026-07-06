/* ============================================================
   flow-source.frag — L87 GPGPU flow: the SOURCES splat (pour / rain).
   ------------------------------------------------------------
   Adds water into the depth field. Run on demand (a pour click, a rain tick) — NOT
   in the per-tick hot loop — so it exactly mirrors the CPU's immediate `pourAt`/`rain`
   (which mutate the W array the instant they're called).
     • POUR: up to 8 discs, each (gi, gj) = fractional grid centre, radius R in CELLS,
       cone weight (1 − d/R) for cells within R — identical to the CPU disc.
     • RAIN: a flat amount added to every LAND cell (terrain > seaY).
   Reads the current depth, writes depth+added; sediment (.g) passes through untouched.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;   // (W, S, ·, ·)
uniform sampler2D uTerr;    // terrain world-Y in .r
uniform float uN;
uniform float uSeaY;
uniform float uRain;        // rain amount this call (0 = none)
uniform int   uPourCount;   // active pour discs (0..8)
uniform vec3  uPours[8];    // (gi, gj, amount) per disc
uniform float uPourR[8];    // radius in CELLS per disc

void main() {
  vec2 uv = vUv;
  float i = floor(uv.x * uN);
  float j = floor(uv.y * uN);
  vec4 st = texture2D(uState, uv);
  float Tc = texture2D(uTerr, uv).r;

  float add = 0.0;
  if (uRain > 0.0 && Tc > uSeaY) add += uRain;        // drizzle on land only
  for (int p = 0; p < 8; p++) {
    if (p >= uPourCount) break;
    vec3 po = uPours[p];                              // (gi, gj, amount)
    float R = uPourR[p];
    float d = length(vec2(i - po.x, j - po.y));
    if (d <= R) add += po.z * (1.0 - d / R);          // cone falloff (matches CPU)
  }
  gl_FragColor = vec4(st.r + add, st.g, 0.0, 0.0);
}
