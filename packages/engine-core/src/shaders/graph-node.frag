// graph-node.frag — VIZ SLICE 5: the crisp node CORE. An SDF disc, lit from within, with a fake rim.
//
// "Nothing flat-shaded" is the one thing every premium reference agreed on (section 8). A node drawn as
// a flat disc of constant colour reads as a UI dot; the same node with a view-dependent term reads as an
// object. We buy that term for pennies, with no lights, no normals buffer and no texture:
//
//   FAKE NORMAL   Treat the unit disc as the silhouette of a unit SPHERE. At disc coordinate p, the
//                 sphere's surface normal is (p.x, p.y, sqrt(1 - |p|^2)). The z we reconstruct is the
//                 only piece missing from a flat quad -- and it is exactly what a real sphere's normal
//                 would be, so the shading is not an approximation of a sphere, it IS one.
//   INNER LIGHT   Brightness rises toward the disc's centre (where the fake normal points at the camera).
//                 Lit from within, not from a lamp -- these are glowing markers, not lit geometry.
//   FRESNEL RIM   pow(1 - n.z, k) peaks where the surface turns away from the eye, i.e. the silhouette.
//                 Under an orthographic camera the view direction IS (0,0,1), so n.z is already n dot v
//                 and the whole grazing-angle term collapses to one pow(). This is the single line that
//                 kills the "flat lit disc" look.
//
// ANALYTIC AA: fwidth(d) is how much the SDF changes across one pixel, so smoothstepping the last pixel
// before the rim gives a clean circle at any radius or zoom -- and, crucially, the circle stays a CIRCLE
// after the pixel post quantizes it, because we never relied on multisampling to round it off.

uniform float uRimPower;
uniform float uRimGain;
uniform float uPrint;   // slice 12 (STUDIO): 1 = PRINT mode -- solid publication fill, no sphere illusion.
                        // On paper the inner-light/fresnel read as a glassy button, not premium print;
                        // print keeps only the crisp fwidth edge + a thin darker ink outline.
uniform float uOutlinePx;  // slice 17 (PIXEL): SELECTIVE OUTLINE width in DEVICE px (0 = off). Pixel-art
                           // "sel-out": the ring is a darkened tint of the node's OWN color (aOutline),
                           // not pure black -- and because the core draws AFTER the halo layer, the ring
                           // punches through any merged glow field. The cure for node bleed.

uniform float uBadgePx;    // slice 19: badge pip size in DEVICE px (0 = off). Same fwidth trick as the
                           // outline: a constant on-screen size at any node radius or zoom.
uniform vec3  uBadgeColor; // the pip's ink -- a RESERVED palette step (see graph-view BADGE_COLOR), so
                           // the quantizer keeps it instead of rounding it into the fill (slice-17 lesson).

varying vec2 vP;
varying vec3 vColor;
varying vec3 vOutline;
varying float vBadge;

void main() {
  float d = length(vP);

  float aa    = fwidth(d);
  float alpha = 1.0 - smoothstep(1.0 - aa * 1.5, 1.0, d);
  if (alpha <= 0.0) discard;

  float nz    = sqrt(max(0.0, 1.0 - d * d));   // the reconstructed sphere normal's z component
  float inner = 0.55 + 0.45 * nz;              // lit from within: brightest facing the eye
  float rim   = pow(1.0 - nz, uRimPower) * uRimGain;

  // Rim adds a touch of achromatic light so it reads as a highlight rather than more of the same hue.
  vec3 glow = vColor * inner + vColor * rim + vec3(rim * 0.12);

  // SELECTIVE OUTLINE (slice 17, pixel): replace the disc's outer band with the ink ring. aa is
  // ~one device pixel in d units (fwidth), so aa * uOutlinePx is a ring exactly that many device px
  // wide at ANY node radius or zoom -- the same trick the analytic AA edge uses, pointed inward.
  if (uOutlinePx > 0.0) {
    float ring = smoothstep(1.0 - aa * (uOutlinePx + 1.0), 1.0 - aa * uOutlinePx + aa, d);
    glow = mix(glow, vOutline, ring);
  }

  /* THE MATERIAL GLYPHS (slice 22 — was one generic square in slice 19). Four silhouettes, drawn in
     the disc's lower-right quadrant, each ~4 virtual pixels and each built from RECTANGLES: at this size
     a rectangle is the only shape that survives the box filter and the DB32 snap (the slice-17 outline
     lesson; a curve or a diagonal dissolves into grey mush). The silhouettes are chosen to be
     distinguishable at 4px, which is a harder constraint than being pretty:
        1 PLAY  ▶  a right-pointing wedge, stepped like pixel art (interactive: step through it)
        2 FRAME ▣  a hollow square with a filled bar (a picture in a frame)
        3 PAGE  ▤  a tall rect with two "text" lines cut out (a document)
        4 BOOK  ▥  two stacked bars with a spine gap (prose)
     Seated on an ink pad (vOutline), so a glyph never floats on a bright fill. */
  if (uBadgePx > 0.0 && vBadge > 0.5) {
    vec2 bc = (vP - vec2(0.40, -0.40)) / (aa * uBadgePx);   // glyph space: [-1..1] is the pad
    float pad = 1.0 - step(1.35, max(abs(bc.x), abs(bc.y)));
    glow = mix(glow, vOutline, pad);                        // the seat

    float g = 0.0;
    float kind = vBadge;
    /* SLICE 27: the codes shifted when ROCKET took the top priority slot (1 rocket · 2 play · 3 frame ·
       4 page · 5 book). The branch order follows mediaGlyphCode's list — if that list changes, this
       ladder changes with it, which is why the priority lives in ONE place (graph-spec) and not here. */
    if (kind < 1.5) {
      // ROCKET: you can RUN this. A nose (stepped triangle), a body, two fins, a flame — all rectangles,
      // because at 4 virtual pixels a curve dissolves into grey mush (the slice-17 lesson).
      float nose = step(abs(bc.x), 0.30) * step(0.30, bc.y) * step(bc.y, 0.95)
                 * step(abs(bc.x), 0.30 * (0.95 - bc.y) / 0.65 + 0.08);
      float body = step(abs(bc.x), 0.30) * step(-0.45, bc.y) * step(bc.y, 0.35);
      float fins = step(0.28, abs(bc.x)) * step(abs(bc.x), 0.72) * step(-0.45, bc.y) * step(bc.y, -0.05);
      float flame = step(abs(bc.x), 0.17) * step(-0.85, bc.y) * step(bc.y, -0.45);
      g = max(max(nose, body), max(fins, flame));
    } else if (kind < 2.5) {
      // PLAY: a stepped wedge — x from -0.7..0.7, the half-height shrinks as x grows.
      float h = 0.75 * (1.0 - (bc.x + 0.7) / 1.4);
      g = step(-0.7, bc.x) * step(bc.x, 0.7) * step(abs(bc.y), max(h, 0.0));
    } else if (kind < 3.5) {
      // FRAME: hollow square + a filled bar across the bottom third (a mounted picture).
      float outer = 1.0 - step(0.8, max(abs(bc.x), abs(bc.y)));
      float inner = 1.0 - step(0.48, max(abs(bc.x), abs(bc.y)));
      float bar   = (1.0 - step(0.8, abs(bc.x))) * step(0.15, bc.y) * (1.0 - step(0.55, bc.y));
      g = max(outer - inner, bar);
    } else if (kind < 4.5) {
      // PAGE: a tall rectangle with two lines cut out of it.
      float body = (1.0 - step(0.55, abs(bc.x))) * (1.0 - step(0.85, abs(bc.y)));
      float l1 = (1.0 - step(0.3, abs(bc.x))) * (1.0 - step(0.12, abs(bc.y - 0.3)));
      float l2 = (1.0 - step(0.3, abs(bc.x))) * (1.0 - step(0.12, abs(bc.y + 0.15)));
      g = body - max(l1, l2);
    } else {
      // BOOK: two stacked bars with a spine gap between them.
      float top = (1.0 - step(0.8, abs(bc.x))) * (1.0 - step(0.28, abs(bc.y - 0.42)));
      float bot = (1.0 - step(0.8, abs(bc.x))) * (1.0 - step(0.28, abs(bc.y + 0.42)));
      g = max(top, bot);
    }
    glow = mix(glow, uBadgeColor, clamp(g, 0.0, 1.0) * pad);
  }

  // PRINT: flat fill with a thin darker ink outline over the outer 6% of the radius.
  float outline = smoothstep(0.94 - aa, 0.94 + aa, d);
  vec3 print = mix(vColor, vColor * 0.55, outline);
  // studio: the glyph as INK. Print has no glow to mix into, so the pad is skipped and the silhouette
  // is stamped straight onto the fill (its own ink colour already contrasts with the paper palette).
  if (uBadgePx > 0.0 && vBadge > 0.5) {
    vec2 bc = (vP - vec2(0.40, -0.40)) / (aa * uBadgePx);
    float box = 1.0 - step(0.9, max(abs(bc.x), abs(bc.y)));
    print = mix(print, uBadgeColor, box);
  }

  gl_FragColor = vec4(mix(glow, print, uPrint), alpha);
}
