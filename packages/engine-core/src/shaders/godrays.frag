/* ============================================================
   godrays.frag — FIRST-PARTY. Crepuscular rays / god rays (fidelity C-2).
   ------------------------------------------------------------
   Screen-space volumetric light scattering (Kenny Mitchell, GPU Gems 3). A ShaderPass AFTER the clouds
   and BEFORE bloom (so the shafts themselves bloom into glow). For each pixel it marches a line back
   toward the SUN's screen position, sampling the composited sky+cloud image as the occlusion source:
   bright samples (the sun + bright cloud gaps) add light, dark samples (cloud bodies) don't — so the
   light streams THROUGH the gaps between clouds. Classic god rays, no extra geometry.

   uVisible fades the effect out as the sun drops below the horizon or leaves the frame (computed on
   the CPU by projecting the sun direction), so shafts never pop.
   ============================================================ */
precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform vec2  uSun;         // sun position in screen UV (0..1)
uniform float uVisible;     // 0..1 — CPU-side fade (below horizon / off-screen)
uniform vec3  uColor;       // shaft tint (sun colour)
uniform float uIntensity;   // overall strength
uniform int   uSamples;     // march samples (tier)

const int MAX_SAMPLES = 48;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  if (uVisible < 0.001) { gl_FragColor = vec4(scene, 1.0); return; }

  // step from this pixel toward the sun, in screen space
  vec2 delta = (vUv - uSun) * (0.85 / float(uSamples));
  vec2 coord = vUv;
  float illum = 1.0, accum = 0.0;
  const float decay = 0.965;
  for (int i = 0; i < MAX_SAMPLES; i++) {
    if (i >= uSamples) break;
    coord -= delta;
    // bright samples (sun + bright gaps) scatter; cloud bodies are dark → they occlude. A lower knee
    // lets partial/thin cloud contribute too, so shafts streak further from the sun instead of forming
    // a tight glow blob.
    float s = smoothstep(0.38, 0.95, lum(texture2D(tDiffuse, coord).rgb));
    accum += s * illum;
    illum *= decay;
  }
  accum /= float(uSamples);
  vec3 rays = uColor * accum * uIntensity * uVisible;
  gl_FragColor = vec4(scene + rays, 1.0);
}
