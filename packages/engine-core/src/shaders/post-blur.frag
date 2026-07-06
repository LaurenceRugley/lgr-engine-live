/* ============================================================
   post-blur.frag — L66 BLOOM step 2: a SEPARABLE GAUSSIAN blur.
   ------------------------------------------------------------
   A 2D Gaussian blur is SEPARABLE: blurring horizontally then vertically gives the same result as a
   full 2D kernel, but for 2·N taps instead of N² (the key perf trick). So we run this shader twice —
   once with uDir = (texelX, 0), once with uDir = (0, texelY) — ping-ponging between two targets. A
   9-tap symmetric Gaussian (weights below) gives a soft, wide glow. C++: two 1-D convolutions instead
   of one 2-D convolution.
   ============================================================ */
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2      uDir;     // one texel step along the blur axis × the spread (set per H/V pass)

void main() {
  // normalised 9-tap Gaussian (sigma ~2): centre + 4 symmetric pairs.
  float w0 = 0.227027, w1 = 0.1945946, w2 = 0.1216216, w3 = 0.054054, w4 = 0.016216;
  vec3 sum = texture2D(uScene, vUv).rgb * w0;
  sum += texture2D(uScene, vUv + uDir * 1.0).rgb * w1;
  sum += texture2D(uScene, vUv - uDir * 1.0).rgb * w1;
  sum += texture2D(uScene, vUv + uDir * 2.0).rgb * w2;
  sum += texture2D(uScene, vUv - uDir * 2.0).rgb * w2;
  sum += texture2D(uScene, vUv + uDir * 3.0).rgb * w3;
  sum += texture2D(uScene, vUv - uDir * 3.0).rgb * w3;
  sum += texture2D(uScene, vUv + uDir * 4.0).rgb * w4;
  sum += texture2D(uScene, vUv - uDir * 4.0).rgb * w4;
  gl_FragColor = vec4(sum, 1.0);
}
