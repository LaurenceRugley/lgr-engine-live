/* ============================================================
   living-ink-sim.frag — Lesson W: the Gray-Scott reaction-diffusion STEP.
   ------------------------------------------------------------
   This shader is not drawing anything. It is running a SIMULATION — one tick of a chemistry, where the
   image IS the state. Each texel holds two chemical concentrations (A in .r, B in .g), and each frame
   we compute what they become next. The picture that emerges (coral, fingerprints, spots, mazes) is not
   authored anywhere: it falls out of two rules applied everywhere at once.

   THE RULES (Gray-Scott):
     A' = A + (Da·∇²A − A·B² + f·(1 − A)) · dt      A diffuses, is EATEN by B, and is fed in
     B' = B + (Db·∇²B + A·B² − (k + f)·B) · dt      B diffuses, GROWS by eating A, and decays

   The whole universe is in A·B²: B consumes A to make more of itself — autocatalysis. Left alone that
   would explode, so B also decays (k) and A is replenished (f). Life happens in the narrow band where
   those three fight to a draw. Nudge f/k a little and you get a completely different organism; that's
   why they're uniforms.

   ∇² is the LAPLACIAN — "how different am I from my neighbours". We take it with the standard 3×3
   9-point stencil (weights 0.05 / 0.2 / −1), which is the discrete form of the diffusion operator.
   C++ anchor: a stencil kernel over a 2-D grid — a convolution, run on the GPU because every cell's
   update is independent, which is the exact shape the GPU is built for.

   PING-PONG: a shader cannot read the texture it is writing. So the pack keeps TWO targets and alternates
   — read A, write B; next frame read B, write A. (createLivingInk.js owns and frees both.)
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uState;   // .r = chemical A, .g = chemical B
uniform vec2      uTexel;   // 1 / resolution — the distance to a neighbour
uniform float     uFeed;    // f — how fast A is replenished
uniform float     uKill;    // k — how fast B decays
uniform float     uDt;      // step size (kept ≤ 1.0 for stability)

void main() {
  vec2 s = texture2D(uState, vUv).rg;

  /* The 9-point Laplacian: neighbours pull, the centre pushes back. */
  vec2 lap = vec2(0.0);
  lap += texture2D(uState, vUv + vec2(-uTexel.x, -uTexel.y)).rg * 0.05;
  lap += texture2D(uState, vUv + vec2( 0.0,      -uTexel.y)).rg * 0.20;
  lap += texture2D(uState, vUv + vec2( uTexel.x, -uTexel.y)).rg * 0.05;
  lap += texture2D(uState, vUv + vec2(-uTexel.x,  0.0)).rg     * 0.20;
  lap += s * -1.0;
  lap += texture2D(uState, vUv + vec2( uTexel.x,  0.0)).rg     * 0.20;
  lap += texture2D(uState, vUv + vec2(-uTexel.x,  uTexel.y)).rg * 0.05;
  lap += texture2D(uState, vUv + vec2( 0.0,       uTexel.y)).rg * 0.20;
  lap += texture2D(uState, vUv + vec2( uTexel.x,  uTexel.y)).rg * 0.05;

  float A = s.r, B = s.g;
  float reaction = A * B * B;            // autocatalysis: B eats A to make B

  float dA = 1.00 * lap.r - reaction + uFeed * (1.0 - A);
  float dB = 0.50 * lap.g + reaction - (uKill + uFeed) * B;

  /* Clamp: the system is only conditionally stable, and one NaN would poison the whole field forever
     (it would ping-pong back in next frame and spread through the Laplacian). Cheap insurance. */
  gl_FragColor = vec4(clamp(A + dA * uDt, 0.0, 1.0),
                      clamp(B + dB * uDt, 0.0, 1.0),
                      0.0, 1.0);
}
