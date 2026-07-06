/* ============================================================
   post-pixelkit.frag — Lesson 10: the generalized pixel-art core.
   ------------------------------------------------------------
   Lesson 06's pixel pass hard-coded a 5-colour palette in a uniform array. PixelKit
   generalizes it into a reusable engine shared by BOTH the live 3D scene (the `B`-key
   "era" looks) and a standalone image tool (tools/pixelate.html). The pipeline is the
   same three moves — SNAP, DITHER, QUANTIZE — but every constraint is now a knob:

     uGridWidth   — virtual pixels across (resolution): the "how chunky" knob.
     uDither      — ordered-dither strength.
     uPalette     — the palette as a TEXTURE (1×N), so we're no longer capped at the
                    8-entry uniform array: up to 64 colours (uPaletteSize live count).
     uUsePalette  — 0 for the "modern/32-bit" era (snap + dither only, full colour).

   WHY A PALETTE TEXTURE. A `uniform vec3[8]` can't grow — GLSL array sizes are fixed
   and large uniform arrays are costly. A texture is the natural variable-length buffer
   on a GPU: store the palette as a 1-row image and SAMPLE entry i. That's how indexed-
   colour hardware worked too (a palette is a look-up table — see GLOSSARY: LUT). The
   tool can hand us a 64-colour palette extracted from a photo; the same shader runs.

   "8-bit / 16-bit" were never about a magic filter — they were HARDWARE LIMITS (palette
   registers, colours-per-tile, screen resolution). PixelKit emulates the LIMITS as
   parameters, which is the honest way to get the look.
   ============================================================ */
precision highp float;

const int   MAX_PALETTE = 64;   // GLSL needs a constant loop bound; we break at the live size
const float BAYER_DIV   = 16.0; // 4×4 ordered-dither matrix normaliser

varying vec2 vUv;
uniform sampler2D uScene;        // the image/scene to pixelate
uniform vec2      uResolution;   // output pixel size (for square virtual cells)
uniform float     uGridWidth;    // virtual pixels across the width
uniform float     uDither;       // dither strength (fractions of a palette step)
uniform sampler2D uPalette;      // palette as a 1×N texture (the LUT)
uniform int       uPaletteSize;  // live palette length (≤ MAX_PALETTE)
uniform float     uUsePalette;   // 1 = quantize to palette, 0 = full-colour (modern era)

/* 4×4 Bayer threshold (0..15) for a virtual-pixel cell — laid out column-major. */
float bayer4(vec2 cell) {
  int x = int(mod(cell.x, 4.0));
  int y = int(mod(cell.y, 4.0));
  mat4 m = mat4(
     0.0, 12.0,  3.0, 15.0,
     8.0,  4.0, 11.0,  7.0,
     2.0, 14.0,  1.0, 13.0,
    10.0,  6.0,  9.0,  5.0
  );
  return m[x][y];
}

/* Read palette entry i from the LUT texture (centre-sample the i-th texel). */
vec3 paletteEntry(int i) {
  float u = (float(i) + 0.5) / float(uPaletteSize);
  return texture2D(uPalette, vec2(u, 0.5)).rgb;
}

void main() {
  /* 1) SNAP — sample the CENTRE of the virtual cell so each cell is one flat colour.
     Cell height follows the real aspect so cells stay square on screen. */
  float aspect = uResolution.x / uResolution.y;
  vec2  grid   = vec2(uGridWidth, uGridWidth / aspect);
  vec2  cell   = floor(vUv * grid);
  vec2  snapUv = (cell + 0.5) / grid;
  vec3  col    = texture2D(uScene, snapUv).rgb;

  if (uUsePalette < 0.5) {
    /* MODERN era — no palette cap: just the chunky grid, plus a whisper of ordered
       dither so flat regions don't look dead. Full 24-bit colour survives. */
    col += (bayer4(cell) / BAYER_DIV - 0.5) * uDither * 0.04;
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  /* 2) DITHER — bias by ± half a palette step (ordered, per virtual cell) BEFORE the
     snap-to-palette, so gradients resolve into a stable crosshatch instead of bands. */
  float threshold = (bayer4(cell) + 0.5) / BAYER_DIV - 0.5;   // −0.5..+0.5
  float palStep   = 1.0 / max(float(uPaletteSize - 1), 1.0);
  col += threshold * palStep * uDither;

  /* 3) QUANTIZE — nearest palette colour by squared RGB distance (sqrt unneeded). */
  vec3  best  = paletteEntry(0);
  float bestD = 1e9;
  for (int i = 0; i < MAX_PALETTE; i++) {
    if (i >= uPaletteSize) break;
    vec3  p  = paletteEntry(i);
    vec3  d  = col - p;
    float dd = dot(d, d);
    if (dd < bestD) { bestD = dd; best = p; }
  }

  gl_FragColor = vec4(best, 1.0);
}
