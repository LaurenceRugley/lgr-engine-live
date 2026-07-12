/* ============================================================
   silk.frag — Dusk Silk hero scene (K1).
   Fragment shader: ink→gold→cream gradient from diagram-theme tokens.
   ------------------------------------------------------------
   Color is entirely displacement-driven (no lighting).
   The gradient maps:
     trough (disp ≈ -3)  → ink  (near-black warm)
     mid-wave (disp ≈ 0) → gold (warm orange #ff8a5a, dusk.sky)
     crest (disp ≈ +3)   → cream (warm off-white)

   Colors are in linear sRGB for the HalfFloat beautyRT.
   Crest values exceed 1.0 → captured by bloomPass threshold (0.78).
   ACES in the filmic pass compresses highlights without clipping.

   Beauty guards:
     • No GL_LINES (geometry is a triangle mesh, no lines)
     • Additive capped: uBrightness clamps crest to 2.5× (no white blowout)
     • No clipped highlights: ACES handles compression
     • Banding-free: smooth gradient in linear space + dither in filmic pass
   ============================================================ */
precision highp float;

varying vec2 vUv;
varying float vDisplacement;

/* Dusk-harbor palette — linear sRGB (sRGB^2.2 ≈ linear).
   L-N re-skin: lifted from const to UNIFORMS so a client build can inject its own gradient
   via createDuskSilk ink/gold/cream options, WITHOUT editing this shader. The JS factory defaults
   them to the exact values below, so a default build is byte-identical.
   Defaults (from diagram-theme.js OKLCH tokens):
     Ink   = NEUTRAL.bg  = oklch(10, 0.022, 40)  ≈ #1a1208 → linear = vec3(0.009, 0.004, 0.001)
     Gold  = ACCENT.ihat = #ff8a5a                           → linear = vec3(1.000, 0.258, 0.101)
     Cream = NEUTRAL.text = oklch(85, 0.018, 52)  ≈ #d1c5b5 → linear = vec3(0.650, 0.563, 0.474)  */
uniform vec3 uInk;    /* trough — very dark warm near-black */
uniform vec3 uGold;   /* mid-wave — warm orange (dusk.sky linear) */
uniform vec3 uCream;  /* crest — warm cream (NEUTRAL.text linear) */

/* uBrightness: HDR multiplier — crests are 2.4× to trigger bloom.
   Troughs use 0.6× to stay dark. Cap at 2.5× avoids white blowout. */
const float BRIGHT_LOW  = 0.60;
const float BRIGHT_HIGH = 2.40;

void main() {
  /* Map raw displacement to [0, 1]:
     range [-3.0, +3.0] covers >99% of wave values. */
  float t = clamp((vDisplacement + 3.0) / 6.0, 0.0, 1.0);

  /* Two-stop gradient: ink → gold → cream. */
  vec3 col;
  if (t < 0.5) {
    col = mix(uInk, uGold, t * 2.0);
  } else {
    col = mix(uGold, uCream, (t - 0.5) * 2.0);
  }

  /* HDR brightness ramp — crests bright enough for bloom, troughs stay dark. */
  float brightness = mix(BRIGHT_LOW, BRIGHT_HIGH, t);
  col *= brightness;

  gl_FragColor = vec4(col, 1.0);
}
