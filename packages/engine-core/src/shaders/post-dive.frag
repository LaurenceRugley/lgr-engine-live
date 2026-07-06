/* ============================================================
   post-dive.frag — Lesson 19 / generalized L60: the "dive" SCENE-TRANSITION compositor.
   ------------------------------------------------------------
   A fullscreen pass that blends render-source A into render-source B over a ~1s dive. The trick
   that sells "I flew through that window" with zero camera-path code: we ZOOM image A toward the
   focus point (the building the user clicked) while B fades in. When B's own window shows the SAME
   content as A (a live render target — the office glass), the scene "continues" through it as B
   resolves, so the push-in reads as diving in, not a cut.

   L60 generalized the uniforms from city/office → A/B so ANY two scenes can use it (the city↔office
   dive is just the first consumer; Hoard iso↔FPS, showcase zoom, etc. instantiate their own).
     • uA     — source A this frame (the "from" scene; zooms toward uFocus)
     • uB     — source B this frame (the "to" scene; resolves in the 2nd half)
     • uT     — dive progress 0 (all A) → 1 (all B)
     • uFocus — the focus point in screen UV; A zooms toward IT, not the centre

   In C++ terms this is a tiny compositor: two image inputs, one parameter, one blended out.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uA;
uniform sampler2D uB;
uniform float uT;
uniform vec2  uFocus;

void main() {
  // EASE the progress so the dive accelerates in then settles (cubic ease-in-out).
  float t = uT * uT * (3.0 - 2.0 * uT);

  // ZOOM source A toward the focus point: scale UVs around uFocus from 1.0 down to ~0.32, so
  // the focused region rushes up to fill the frame as we "approach" it.
  float scale = mix(1.0, 0.32, t);
  vec2 aUv = uFocus + (vUv - uFocus) * scale;
  vec3 a = texture2D(uA, aUv).rgb;

  // Source B resolves over the SECOND HALF of the dive (we're "inside" by then).
  float bMix = smoothstep(0.40, 1.0, uT);
  vec3 b = texture2D(uB, vUv).rgb;

  // a vignette pulling inward at the mid-point sells the threshold.
  vec3 col = mix(a, b, bMix);
  float v = 1.0 - smoothstep(0.2, 1.1, distance(vUv, vec2(0.5))) * (0.35 * (1.0 - abs(uT - 0.5) * 2.0));
  col *= v;

  gl_FragColor = vec4(col, 1.0);
}
