/* ============================================================
   edge-ink.frag — Lesson R: the BLUEPRINT ribbon (Lattice's edge material).
   ------------------------------------------------------------
   The same ribbon geometry as edge-flow.frag, inked instead of lit.

   WHY A SECOND FRAGMENT SHADER AT ALL. edge-flow is ADDITIVE: it ADDS light to a dark
   scene, which is exactly right for Constellation (gold energy on ink). Add light to a
   PAPER-CREAM ground, though, and every line races toward white — the brighter the ink,
   the more invisible it gets. A drawing on paper is SUBTRACTIVE: ink is darker than the
   page. So the blueprint needs alpha-blended DARK ink, not additive glow. Same seam
   (createEdgeField's injectable material), same vertex shader (edge-flow.vert,
   untouched — it just billboards the ribbon), different ink.

   And that difference is doing double duty: it is also what keeps Lattice from reading as
   a re-coloured Constellation. Two scenes on one edge seam, opposite ends of the blending
   model. C++ anchor: one container, two policies — the traversal is shared, the operation
   isn't.

   uFlow lets a faint draw-on pulse travel the edge (a surveyor's line being drawn) without
   ever brightening it: the pulse DEEPENS the ink instead of adding light.
   ============================================================ */
precision highp float;

uniform vec3  uColor;   // linear-sRGB ink (a dark blueprint navy)
uniform float uTime;    // elapsed seconds
uniform float uSpeed;   // pulses per second along the edge
uniform float uDash;    // number of pulses spaced along the edge
uniform float uFlow;    // 0 = dead-flat ink, 1 = full draw-on pulse

varying float vAlong;
varying float vSide;

void main() {
  /* Across-width feather — but TIGHTER than edge-flow's glow: a drawn line has a crisp
     core and only a hair of softness at the rim (that hair is the anti-alias). A wide
     feather here would read as an airbrush, not a pen. */
  float feather = smoothstep(1.0, 0.55, abs(vSide));

  /* The draw-on pulse: a slow bright-DARK wave along the length. It modulates OPACITY,
     never luminance — the ink can get denser, never lighter than the page. */
  float phase = fract(vAlong * uDash - uTime * uSpeed);
  float tri   = 1.0 - abs(phase - 0.5) * 2.0;
  float pulse = smoothstep(0.35, 1.0, tri);

  float ink = feather * (0.62 + uFlow * 0.38 * pulse);

  /* Alpha-blended: the fragment IS the ink colour; alpha decides how much page shows
     through. (Additive would do the opposite and wash the page out.) */
  gl_FragColor = vec4(uColor, ink);
}
