/* ============================================================
   edge-flow.frag — engine-first FLOWING-EDGE ribbon (K2 / shared with Mission Control).
   ------------------------------------------------------------
   Two effects, both scene-agnostic:
     1. FEATHER across the ribbon width (|vSide| → 1 fades to 0) so the edge reads
        as a soft glow ribbon, NOT a hard 1px line (the forbidden cheap look).
     2. A comet of ENERGY flowing along the ribbon: a bright moving segment driven
        by uTime, so the graph feels alive (data flowing between nodes).

   Additive-blended + CAPPED (peak ≈ 2.3× in the HalfFloat beautyRT) so crests
   trip bloom without white blow-out. ACES in the filmic pass compresses the rest.
   ============================================================ */
precision highp float;

uniform vec3  uColor;   // linear-sRGB ribbon color (gold)
uniform float uTime;    // elapsed seconds
uniform float uSpeed;   // comets per second along the edge
uniform float uDash;    // number of comets spaced along the edge

varying float vAlong;
varying float vSide;

void main() {
  /* Across-width feather: soft glow, no hard edge. */
  float feather = smoothstep(1.0, 0.0, abs(vSide));
  feather = pow(feather, 1.4);

  /* Flowing comet along the length: a triangle wave peaked in a short window
     that slides with uTime. tri is 1 at a comet centre, 0 between comets. */
  float phase = fract(vAlong * uDash - uTime * uSpeed);
  float tri   = 1.0 - abs(phase - 0.5) * 2.0;
  float comet = smoothstep(0.55, 1.0, tri);

  /* Base rail glow (dim, always present) + bright moving comet on top. */
  float bright = 0.35 + 1.9 * comet;

  vec3 col = uColor * feather * bright;
  gl_FragColor = vec4(col, feather);   // additive: alpha only gates the soft edge
}
