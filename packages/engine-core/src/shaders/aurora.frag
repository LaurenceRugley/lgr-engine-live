/* ============================================================
   aurora.frag — Aurora hero scene (K3). Vertical curtain gradient + shimmer.
   ------------------------------------------------------------
   The curtain is:
     • bright in its vertical MIDDLE, fading to transparent at top and bottom
       (a floating sheet, no hard edges),
     • shimmering with slow vertical striations that ride the wave from the vert,
     • gold at the base rising to cream at the top (dusk-harbor restraint).

   Additive-blended + CAPPED (peak ≈ 1.9× in HalfFloat beautyRT) so stacked
   layers trip bloom without white blow-out. ACES compresses the rest.
   ============================================================ */
precision highp float;

uniform float uTime;
uniform vec3  uColorLow;    // linear-sRGB, curtain base (gold)
uniform vec3  uColorHigh;   // linear-sRGB, curtain crown (cream)
uniform float uPhase;

varying vec2  vUv;
varying float vWave;

void main() {
  /* Vertical envelope: 0 at top & bottom, 1 across the middle band. */
  float vgrad = smoothstep(0.0, 0.35, vUv.y) * smoothstep(1.0, 0.62, vUv.y);

  /* Horizontal envelope: soft left/right edges so each curtain reads as a
     distinct vertical light RIBBON, not a hard-edged sheet. */
  float hgrad = smoothstep(0.0, 0.32, vUv.x) * smoothstep(1.0, 0.68, vUv.x);

  /* Slow vertical shimmer striations, nudged by the curtain's wave. */
  float shimmer = 0.60 + 0.40 * sin(vUv.x * 9.0 + uTime * 0.7 + uPhase + vWave * 2.2);

  float alpha = vgrad * hgrad * shimmer * 0.72;   // restrained — additive stacks

  /* Gold base → cream crown. Cream rises through the upper curtain so the crests
     read as luminous light (not a red smear), while the base stays warm gold.
     Brightness capped (peak ≈ 1.5×) — trips bloom on the crests, no blow-out. */
  vec3 col = mix(uColorLow, uColorHigh, smoothstep(0.15, 1.0, vUv.y)) * alpha * 1.5;
  gl_FragColor = vec4(col, alpha);
}
