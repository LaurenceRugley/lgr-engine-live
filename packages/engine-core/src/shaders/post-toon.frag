/* ============================================================
   post-toon.frag — the ZOOMED-IN style: cel posterize + depth outlines.
   ------------------------------------------------------------
   Lesson 08 teaches STYLE-LOD: the look of the render is a function of camera
   zoom. Far away we want chunky pixel art (post-pixel.frag, board-game read);
   up close we want a smooth "cartoon / vector" read — THIS pass. Two cheap moves
   make a 3D frame look hand-drawn:

   1. CEL (TOON) SHADING via SCREEN-SPACE POSTERIZATION.
      Real cel shading quantizes the LIGHTING inside each material (snap N·L into
      a few steps). We don't have one material — we have water, a shader backdrop,
      the diorama, and (soon) GLTF. So we posterize at the SCREEN level instead:
      take each pixel's luminance, snap it to one of uBands flat levels, and keep
      the original hue. It is an approximation of cel shading that works over ANY
      content, for the price of a few instructions. (Trade-off: it bands by final
      brightness, not by surface lighting, so it can't know a dark-but-lit face
      from a bright-but-shadowed one — close enough, and universal.)

   2. SCREEN-SPACE OUTLINES from the DEPTH BUFFER.
      A depth texture stores how far each pixel is from the camera. An OUTLINE is
      just a place where that distance jumps — a silhouette. We read four depths in
      a little 2×2 block and take the ROBERTS CROSS (the cheapest edge operator:
      the two diagonal differences |a−d| + |b−c|). Big value -> an edge -> paint it
      the ink outline colour. This is the SAME neighbour-stencil thinking as the
      L03 wave-equation laplacian: sample the neighbourhood, react to the
      discontinuity. (A 3×3 SOBEL is the heavier, smoother cousin — more samples,
      softer gradient; Roberts is plenty for our blocky towers. Reconstructing
      surface NORMALS from depth would additionally catch interior creases where
      depth is continuous but orientation changes — noted as a future enhancement.)

   READING DEPTH NEEDS LINEARIZATION. The depth stored in the texture is NOT
   linear distance: a perspective camera packs most of its precision near the eye,
   so raw depth differences are huge up close and tiny far away — a fixed threshold
   would draw fat lines near and none far. We convert raw depth back to real
   view-space distance first; THEN a distance threshold means the same thing
   everywhere. An ORTHOGRAPHIC camera's depth is already linear, so its conversion
   is a plain remap — which is exactly why we pass uIsPerspective and branch.
   ============================================================ */
precision highp float;

// ---- PARAMS — tune the look here -------------------------------------------
const float OUTLINE_LO = 0.030;  // relative depth-jump where an outline starts
const float OUTLINE_HI = 0.075;  // ...and where it is fully drawn (soft edge between)
// uBands is a uniform so the day/night lesson can drive it later; default 3.
// -----------------------------------------------------------------------------

varying vec2 vUv;
uniform sampler2D uScene;        // previous pass: the graded (grain-free) beauty
uniform sampler2D uDepth;        // the beauty pass's DEPTH texture
uniform vec2      uResolution;   // drawing-buffer size in pixels
uniform float     uBands;        // posterize levels (e.g. 4.0)
uniform float     uToonGain;     // exposure lift before banding (moody scene -> visible bands)
uniform float     uToonGamma;    // tone curve (<1 lifts the shadows the most)
uniform vec3      uToonFloor;    // L09: a night ambient floor (deep blue at night, black by
                                 // day) so night posterizes to readable blue, not a void.
uniform vec3      uOutline;      // ink line colour
uniform float     uNear;         // active camera near plane
uniform float     uFar;          // active camera far plane
uniform float     uIsPerspective;// 1.0 perspective, 0.0 orthographic

/* Raw depth sample → real view-space distance (positive, in world units). */
float linearDepth(vec2 uv) {
  float d = texture2D(uDepth, uv).x;          // window-space depth, 0..1
  if (uIsPerspective > 0.5) {
    float z = d * 2.0 - 1.0;                   // back to NDC −1..1
    return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear));
  }
  return uNear + d * (uFar - uNear);          // ortho: depth is already linear
}

void main() {
  vec2 texel = 1.0 / uResolution;

  /* --- 1) CEL POSTERIZE — snap luminance to flat bands, keep the hue. --------
     Rec.601 luma, then a TONE LIFT (gain + gamma) BEFORE banding. The lab scene
     is deliberately deep-ink/moody; without the lift almost every pixel sits in
     the lowest band and the toon look collapses to black blobs. The lift maps the
     scene's dark range up into the band range (gamma < 1 raises the shadows most),
     so towers AND water resolve into a few flat tones — and the dark outline then
     has a lit surface to sit on. Banding the LIFTED luminance, we re-apply the
     original hue (chroma = colour / luma) at the quantized brightness: shade snaps,
     hue survives. */
  vec3  c      = texture2D(uScene, vUv).rgb;
  c            = max(c, uToonFloor);     // L09: never below the night floor (no black void)
  float lum    = dot(c, vec3(0.299, 0.587, 0.114));
  float lifted = pow(clamp(lum * uToonGain, 0.0, 1.0), uToonGamma);
  float levels = max(uBands, 2.0);
  float qlum   = clamp(floor(lifted * levels) / (levels - 1.0), 0.0, 1.0);
  vec3  cel    = (c / max(lum, 1e-4)) * qlum;

  /* --- 2) DEPTH OUTLINE — Roberts cross over a 2×2 block of linear depths. ----
     Normalise the jump by the centre distance (a RELATIVE threshold) so a far
     silhouette reads the same as a near one, and a gently receding surface (the
     water toward the horizon) doesn't trip a false line. */
  float dA = linearDepth(vUv);
  float dB = linearDepth(vUv + vec2(texel.x, 0.0));
  float dC = linearDepth(vUv + vec2(0.0, texel.y));
  float dD = linearDepth(vUv + texel);
  float grad = abs(dA - dD) + abs(dB - dC);            // Roberts cross
  float rel  = grad / max(dA, 1e-3);
  float edge = smoothstep(OUTLINE_LO, OUTLINE_HI, rel);

  gl_FragColor = vec4(mix(cel, uOutline, edge), 1.0);
}
