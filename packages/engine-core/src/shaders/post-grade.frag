/* ============================================================
   post-grade.frag — PASS N+1 of the post chain: the COLOR GRADE ("the look").
   ------------------------------------------------------------
   post-filmic.frag is PASS 1 (chromatic aberration + vignette + grain + the ACES tonemap that turns
   the HDR beauty buffer into a display image). This is the pass AFTER it — the "finishing layer" every
   colourist adds last: a consistent, branded colour signature laid over the already-tonemapped image.

   WHY IT MUST COME AFTER THE TONEMAP (the load-bearing invariant). ACES tonemapping is a non-linear
   HDR->SDR compression. If we graded BEFORE it, the tonemap would re-map our graded colours and the
   look would double-apply / fight the exposure curve (the beauty-HDR-buffer invariant: grade the SDR
   result, not the HDR scene). So this pass reads filmic's OUTPUT (an 8-bit SDR image) and only pushes
   colour around — no exposure, no tonemap. In the chain: beautyRT(HDR) -> filmic(ACES ->SDR) -> HERE.

   THE MATH — a first-party parametric grade (no external .cube LUT asset; the engine stays dependency-
   minimal and an identity is bit-exact). Four classic controls, in the order a colourist uses them:
     1. LIFT / GAMMA / GAIN (ASC-CDL shape): gain scales (highlights), lift offsets (shadows), gamma
        powers (midtones). Per-channel vec3s, so each can tint a tonal range.
     2. CONTRAST about a 0.5 pivot (the S-curve that gives digital footage "body").
     3. SATURATION (pull toward / push from Rec.709 luma).
     4. SPLIT-TONE: tint the shadows one hue and the highlights another (the cinematic teal-shadow /
        warm-highlight signature), blended by luma so it never flattens the midtones.
   Then uStrength MIXES the graded result back over the ungraded one. Research bar: real grades sit at
   ~40-70% strength ("avoid LUT overdose") — the point is a subtle, consistent signature, not a filter.

   BYTE-IDENTICAL / IDENTITY. At uStrength == 0.0 the final mix returns the input UNTOUCHED — a bit-exact
   passthrough (this pass reads filmic's SDR output at the same resolution, texel-aligned). That is the
   "grade disabled = identity" guarantee the lesson proves via present-parity: the engine leaves the look
   OFF by default (the pass is skipped entirely), and even when forced on at strength 0 it is a no-op.

   C++ anchor: a pure function (vec3)->(vec3) applied per pixel, then linearly interpolated with the
   original by uStrength — the graphics equivalent of lerp(src, f(src), k).
   ============================================================ */
varying vec2 vUv;
uniform sampler2D uScene;        // filmic's SDR output (already tonemapped)

uniform vec3  uLift;             // added into shadows      (identity 0,0,0)
uniform vec3  uGamma;            // midtone power           (identity 1,1,1)
uniform vec3  uGain;             // highlight scale         (identity 1,1,1)
uniform float uContrast;         // about a 0.5 pivot        (identity 1.0)
uniform float uSat;              // saturation               (identity 1.0)
uniform vec3  uShadowTint;       // split-tone shadow hue    (identity 1,1,1)
uniform vec3  uHighlightTint;    // split-tone highlight hue (identity 1,1,1)
uniform float uSplitStrength;    // split-tone amount        (identity 0.0)
uniform float uStrength;         // overall look mix         (0 = passthrough / identity)

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);   // Rec.709

void main() {
  vec3 base = texture2D(uScene, vUv).rgb;   // the ungraded, already-tonemapped pixel
  vec3 c = base;

  // 1. Lift / gamma / gain. gain first (scale), then lift (offset), then the gamma power.
  c = c * uGain + uLift;
  c = pow(max(c, 0.0), 1.0 / uGamma);

  // 2. Contrast about mid-grey.
  c = (c - 0.5) * uContrast + 0.5;

  // 3. Saturation about the pixel's luma.
  float luma = dot(max(c, 0.0), LUMA);
  c = mix(vec3(luma), c, uSat);

  // 4. Split-tone: cool the shadows / warm the highlights (or whichever hues the look picks), blended
  //    by luma so midtones stay neutral. A tint of (1,1,1) is a no-op, so identity split = no shift.
  float t = smoothstep(0.0, 1.0, clamp(luma, 0.0, 1.0));   // 0 in shadows -> 1 in highlights
  vec3 splitTint = mix(uShadowTint, uHighlightTint, t);
  c *= mix(vec3(1.0), splitTint, uSplitStrength);

  vec3 graded = clamp(c, 0.0, 1.0);

  // Final: mix the look back over the original. uStrength 0 -> exactly 'base' (bit-exact identity).
  gl_FragColor = vec4(mix(base, graded, uStrength), 1.0);
}
