// graph-edge.frag — VIZ SLICE 5: gradient ribbon + a soft traveling band riding the curve.
//
// Keeps the section-6 uniform contract verbatim (uTime/uColor/uSpeed/uDashRatio/uFlow/uOpacity) so the
// slice-3 caller needs no rewrite -- but the HARD DASH is gone. A hard dash on a curved ribbon reads as
// a dotted line drawn over an arc; a soft exponential band reads as light MOVING along the arc, which
// is the thing we actually wanted (section 8, leverage #4).
//
// uFlow = 0 (prefers-reduced-motion) parks the band instead of freezing a dash pattern: the edge stays
// fully legible by colour, width and position. State is never encoded in motion alone.
//
// PIXEL-MODE NOTE: the band's phase is quantized on the JS side (uTime is stepped at ~10 logical fps),
// not here. Marching ants at 10 fps read as authentic pixel-art animation; the same band at 60 fps
// strobes against the palette's colour steps. Quantizing the CLOCK rather than the shader keeps this
// file look-agnostic.
//
// vCross is the signed cross-ribbon coordinate (-1 at one edge, +1 at the other). fwidth(vCross) is its
// screen-space rate of change, i.e. how many units of vCross one pixel spans -- so smoothstepping over
// that width gives us exactly one pixel of anti-aliasing at any width, zoom or angle. This is the
// standard analytic-AA trick, and it is why the ribbon has clean shoulders without MSAA.

// uRest — how bright the edge is BETWEEN flow bands. It exists because of a quantization failure the
// motion gate caught: an edge at rest contributed luminance ~16 to the frame, and DB32's darkest non-black
// swatch sits at 33.9, so the nearest palette entry to a resting edge was #000000. Away from the central
// glow the graph's wiring quantized OUT OF EXISTENCE, flickering back only as a flow band swept past. The
// pixel look therefore raises the resting floor until it clears the palette's first step; the harbor look
// leaves it low, because a continuous-tone renderer has no such step to clear.
uniform float uTime;
uniform float uSpeed;
uniform float uDashRatio;   // now the band's WIDTH along the edge (kept under its contract name)
uniform float uFlow;        // 1 = travel, 0 = parked (reduced motion)
uniform float uOpacity;
uniform float uRest;        // resting brightness (see above)
uniform vec3  uColor;       // the flow band's own tint, added on top of the gradient

varying float vT;
varying float vCross;
varying vec3  vColor;
varying float vDim;   // focus-dim, per edge (1 = lit; < 1 = this edge does not touch the selection)

void main() {
  // Cross-axis analytic AA: soft shoulders, hard core.
  float aa   = fwidth(vCross);
  float edge = 1.0 - smoothstep(1.0 - aa * 1.5, 1.0, abs(vCross));
  if (edge <= 0.0) discard;

  // The traveling band. Distance from the band's head, wrapped into [-0.5, +0.5] so it loops
  // seamlessly off the end of the edge and back onto its start.
  float head = fract(uTime * uSpeed * uFlow);
  float d    = vT - head;
  d = d - floor(d + 0.5);

  float sigma = max(uDashRatio * 0.35, 1e-4);
  float band  = exp(-(d * d) / (sigma * sigma));

  // A quiet resting edge (the graph's wiring) plus a bright crest (the flow). The crest borrows the
  // gradient's own colour so a warm edge flows warm -- and adds uColor so every flow shares one accent.
  vec3  col = vColor * uRest + (vColor * 0.6 + uColor * 0.5) * band;
  float a   = uOpacity * edge * (uRest + 0.85 * band);

  // vDim > 1 = the emphasized neighborhood: brightness rides in full (feeds bloom), alpha capped at
  // x1.25 -- additive alpha past that clips and bleaches the gradient (tuned by looking, slice 9).
  gl_FragColor = vec4(col * vDim, a * min(vDim, 1.25));
}
