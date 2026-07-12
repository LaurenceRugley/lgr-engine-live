/* ============================================================
   disc-glow.frag — Constellation node (K2). Soft radial glow disc.
   ------------------------------------------------------------
   Pure procedural radial falloff — NO texture (dispose stays geo+material only).
   The disc is a feathered glow (soft to its edge), never a hard-edged sprite.

   HDR + capped: the core reaches ~2.4× in the HalfFloat beautyRT (trips bloom),
   the halo stays sub-1. Additive-blended; ACES compresses the rest with no clip.
   ============================================================ */
precision highp float;

uniform vec3 uColor;   // linear-sRGB node color (gold)

varying vec2  vUv;
varying float vPulse;

void main() {
  /* Distance from disc centre: 0 at centre → 1 at the quad edge. */
  float d = length(vUv - 0.5) * 2.0;

  /* Two-part glow: a bright tight core + a soft wide halo. Both feather to 0 at
     the rim so there is no hard sprite edge. */
  float core = smoothstep(0.35, 0.0, d);
  float halo = smoothstep(1.0,  0.0, d);
  halo = pow(halo, 2.0);

  float glow = halo + core * 1.6;          // core pushes HDR for bloom
  vec3  col  = uColor * glow * vPulse * 1.5;

  gl_FragColor = vec4(col, halo);          // additive; alpha gates the soft edge
}
