/* ============================================================
   post-bright.frag — L66 BLOOM step 1: the BRIGHT-PASS (threshold).
   ------------------------------------------------------------
   Bloom = "bright things bleed light into their surroundings" (the sun, the moon, star-cores,
   speculars). Step 1 isolates ONLY the bright pixels: compute each pixel's luminance and keep it
   (soft-thresholded) above `uThreshold`, zeroing everything dimmer. So the low-poly albedo (a green
   tree, a grey building) is dropped and only the hot sources survive into the blur. Run at HALF
   resolution (the blur is wide + soft, so half-res is invisible and 4× cheaper). C++: a per-pixel
   high-pass filter on luminance.
   ============================================================ */
varying vec2 vUv;
uniform sampler2D uScene;
uniform float     uThreshold;   // luminance cut (~0.8 → only suns/speculars qualify)

void main() {
  vec3 c = texture2D(uScene, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));        // Rec.709 luma
  float k = smoothstep(uThreshold, uThreshold + 0.22, l); // soft knee → no hard edge on the bright blobs
  gl_FragColor = vec4(c * k, 1.0);
}
