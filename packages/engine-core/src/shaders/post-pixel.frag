/* ============================================================
   post-pixel.frag — PASS 2: pixel-art. 3D scene in, authored-looking pixels out.
   ------------------------------------------------------------
   This is the seed of the John Rutherford game-art pipeline: take any rendered
   frame and make it look like deliberate, hand-placed pixel art. Three steps,
   in this exact order:

     1. SNAP the UVs to a coarse virtual grid → big square "pixels".
        We pretend the screen is only uPixelSize pixels wide (≈220). Every real
        pixel inside one virtual cell samples the SAME texel of the previous
        pass, so each cell is one flat colour — that's the blockiness. Because
        we snap the *sample coordinate* (nearest-neighbour by construction),
        the blocks stay razor sharp; no filtering ever blurs them.

     2. DITHER with a 4×4 BAYER MATRIX (ordered dithering), THEN
     3. QUANTIZE to a small fixed palette via nearest-colour.

   WHY DITHER BEFORE QUANTIZE: quantization alone produces flat bands wherever
   the source gradient crosses between two palette colours. Dithering adds a
   tiny, PATTERNED bias (±half a quantization step) before the snap-to-palette,
   so border regions resolve as a checker-ish mix of the two neighbouring
   colours — the eye averages them back into a gradient. It's how 16-colour-era
   games faked thousands of shades.

   WHY ORDERED (Bayer) AND NOT RANDOM NOISE: the Bayer matrix is FIXED in screen
   space — the same cell always gets the same bias. Under motion the pattern
   stays put, like an artist's crosshatch. Random dithering re-rolls every frame
   and the image "swims" with noise. Stable > organic for pixel art.

   THE 4×4 BAYER MATRIX — thresholds 0..15 arranged so consecutive values are
   maximally far apart spatially (each quadrant recursively repeats the 2×2
   pattern). Normalized to 0..1 by /16, then centered (−0.5) to a ±0.5 bias:

         0   8   2  10
        12   4  14   6
         3  11   1   9
        15   7  13   5

   PALETTE QUANTIZATION — for each (dithered) colour, walk the palette and keep
   the entry with the smallest distance. We measure distance simply in RGB
   space (sqrt not needed — comparing squared distances picks the same winner).
   Perceptual spaces (Lab/OKLab) weight channels like the human eye and pick
   "nicer" neighbours — worth knowing they exist; overkill for ≤8 colours.

   Palettes are UNIFORMS (uPalette/uPaletteSize) so JS can swap them live —
   press P: LGR ink→gold ramp ↔ "financial terminal" (the John proof-of-concept).
   The palette definitions live in the PARAMS block at the top of main.js.
   ============================================================ */

// ---- PARAMS — tune the look here -------------------------------------------
const float DITHER = 0.55;   // dither bias strength, in fractions of a palette step
// uPixelSize (virtual pixels across) is a uniform — default set in main.js (≈220)
// -----------------------------------------------------------------------------

varying vec2 vUv;
uniform sampler2D uScene;        // the previous pass (filmic output)
uniform vec2      uResolution;   // real drawing-buffer size (for aspect)
uniform float     uPixelSize;    // virtual horizontal resolution, e.g. 220.0
uniform vec3      uPalette[8];   // the CURRENT time-of-day palette (sRGB values)
uniform vec3      uPaletteB[8];  // the NEXT time-of-day palette (L09 day/night)
uniform float     uPaletteBlend; // 0 = palette A … 1 = palette B
uniform int       uPaletteSize;  // how many entries are valid (≤ 8)

/* Bayer threshold for a virtual-pixel coordinate. mat4 columns are written
   column-major, so matrix[column][row] — laid out here so it reads like the
   table above. Returns 0..15. */
float bayer4(vec2 cell) {
  int x = int(mod(cell.x, 4.0));
  int y = int(mod(cell.y, 4.0));
  mat4 m = mat4(
     0.0, 12.0,  3.0, 15.0,   // column 0 (x=0), rows y=0..3
     8.0,  4.0, 11.0,  7.0,   // column 1
     2.0, 14.0,  1.0, 13.0,   // column 2
    10.0,  6.0,  9.0,  5.0    // column 3
  );
  return m[x][y];
}

void main() {
  /* 1) SNAP — virtual grid: uPixelSize cells across, height follows the real
     aspect ratio so the cells are square on screen. floor() + 0.5 samples the
     CENTRE of each cell (sampling an edge invites bleeding between texels). */
  float aspect = uResolution.x / uResolution.y;
  vec2  grid   = vec2(uPixelSize, uPixelSize / aspect);
  vec2  cell   = floor(vUv * grid);             // which virtual pixel are we in?
  vec2  snapUv = (cell + 0.5) / grid;           // its centre, back in 0..1 UV
  vec3  col    = texture2D(uScene, snapUv).rgb;

  /* 2) DITHER — Bayer threshold for THIS CELL (not this real pixel: dithering
     must operate at virtual-pixel scale or the pattern vanishes inside blocks).
     Bias is ± half a "palette step" (≈ 1/paletteSize of full range) × DITHER. */
  float threshold = (bayer4(cell) + 0.5) / 16.0 - 0.5;        // −0.5..+0.5
  float step      = 1.0 / max(float(uPaletteSize - 1), 1.0);  // size of one band
  col += threshold * step * DITHER;

  /* 3) QUANTIZE — nearest palette colour by squared RGB distance. The loop has a
     constant bound (GLSL requirement) and breaks at the live palette size.
     LESSON 09: we don't grade a fixed palette to "tint" it for time of day — that
     fights the quantizer (a graded source maps to the wrong fixed buckets). Instead
     we INTERPOLATE between two AUTHORED palettes (current → next time-of-day) and
     quantize against the blended entries. Each pixel still snaps to a clean palette
     colour; the palette itself drifts dawn→day→dusk→night (the Pokémon Gold/Silver
     trick, made continuous). */
  vec3  best  = mix(uPalette[0], uPaletteB[0], uPaletteBlend);
  float bestD = 1e9;
  for (int i = 0; i < 8; i++) {
    if (i >= uPaletteSize) break;
    vec3  pal = mix(uPalette[i], uPaletteB[i], uPaletteBlend);
    vec3  d   = col - pal;
    float dd  = dot(d, d);                       // squared distance — no sqrt needed
    if (dd < bestD) { bestD = dd; best = pal; }
  }

  gl_FragColor = vec4(best, 1.0);
}
