/* ============================================================
   glyph-atlas.js — a BITMAP glyph rasterizer over createTextureAtlas.
   ------------------------------------------------------------
   2D-plan §4 gap #3, the biggest one: no app/HUD/website ships without readable text. The choice this
   module embodies — BITMAP, not SDF (signed distance field) — is deliberate, not the easy default. Both
   were weighed; here is the actual tradeoff and why bitmap won THIS pass:

     SDF: one atlas serves ANY on-screen size crisply (a distance field is resolution-independent by
     construction) — the textbook right answer for text a camera can zoom arbitrarily close to. The cost
     is a SECOND pipeline stage: rasterize each glyph, then compute a signed distance transform from its
     alpha mask (either at BUILD TIME from a TTF via a tool like msdfgen — the brief's own §6 explicitly
     flags "if the font pipeline needs a build-time tool, STOP and report" as a legitimate separate piece
     — or at RUNTIME via a JS distance-transform pass, e.g. 8SSEDT, a genuinely correctness-sensitive
     numerical algorithm with its own spread/cell-size tuning). Either path is real, additional risk for
     a Phase 1 foundation pass.

     BITMAP: rasterize each glyph ONCE via canvas 2D `fillText` straight into the SAME shelf-packed atlas
     `createTextureAtlas` already provides (createSpriteBatcher already knows how to batch atlas sub-
     rects — text costs ZERO new rendering infrastructure). The tradeoff is real: a glyph rasterized at
     size X looks crisp displayed AT OR BELOW X, and progressively softer scaled well past it — bitmap
     fonts don't have SDF's "any zoom, one atlas" property.

   WHY THAT TRADEOFF DOESN'T BITE THIS USE CASE: this is TEXT FOR A 2D UI/HUD layer (labels, scores,
   dialogue, panel captions) — a BOUNDED, KNOWN size range chosen by whoever authors the HUD, not a
   world-space label a 3D camera can zoom arbitrarily close to (that problem already has a different,
   working answer in THIS codebase: `createScrollNarrative`'s copy is real DOM/CSS text, which scales
   perfectly for free). Rasterizing at a generously high base size (default 48px, well above typical
   14–24px on-screen UI text) and displaying AT OR BELOW that size — the normal HUD-text case — reads
   crisp at DPR 2 with zero extra pipeline. The honest limit: an oversized headline pulled from this same
   atlas would visibly soften. SDF is the correct follow-up the DAY something needs that (documented as
   the seam to grow, not silently worked around).

   GLYPHS ARE RASTERIZED OPAQUE WHITE, never a caller-supplied color: `createSpriteBatcher` already has a
   colour channel — `instanceColor` (native THREE tint) — so ONE white glyph raster serves ANY text
   colour a caller wants, the same way an atlas image serves any sprite tint. Baking a colour into the
   raster would mean one atlas entry per (glyph, colour) pair instead of per glyph.
   ============================================================ */

const DEFAULT_CHARSET =
  ' !"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~';

function parseFontPx(font) {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]) : 16;
}

/* createGlyphAtlas({ atlas, font, chars, padding }) → { glyphs, lineHeight, fontPx, measureText, addChar }
   `atlas` is a createTextureAtlas() instance — glyphs are packed into the SAME shared atlas a project's
   sprites already use (one texture, one draw call, across sprites AND text — see text-block.js). */
export function createGlyphAtlas({ atlas, font = '600 48px system-ui, -apple-system, sans-serif', chars = DEFAULT_CHARSET, padding = 3 } = {}) {
  if (typeof document === 'undefined' || !atlas) {
    return { glyphs: {}, lineHeight: 0, fontPx: parseFontPx(font), measureText: () => ({ width: 0, height: 0 }), addChar: () => null };
  }

  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  const fontPx = parseFontPx(font);
  // actualBoundingBox{Ascent,Descent} give the TIGHT vertical extent of this font (better cell-height
  // fit than a fixed multiple of fontPx); fall back to a conservative multiple where unsupported.
  const probe = measure.measureText('Mgjpqy');
  const ascent = probe.actualBoundingBoxAscent != null ? Math.ceil(probe.actualBoundingBoxAscent) : Math.ceil(fontPx * 0.8);
  const descent = probe.actualBoundingBoxDescent != null ? Math.ceil(probe.actualBoundingBoxDescent) : Math.ceil(fontPx * 0.25);
  const lineHeight = ascent + descent + padding * 2;

  const glyphs = {};

  function addChar(ch) {
    if (glyphs[ch]) return glyphs[ch];
    const advance = Math.max(1, Math.round(measure.measureText(ch).width));
    if (ch === ' ') { const g = { advance, frame: null, w: 0, h: 0 }; glyphs[ch] = g; return g; }

    const cellW = advance + padding * 2, cellH = lineHeight;
    const c = document.createElement('canvas'); c.width = cellW; c.height = cellH;
    const cx = c.getContext('2d');
    cx.font = font; cx.fillStyle = '#fff'; cx.textBaseline = 'alphabetic';
    cx.fillText(ch, padding, padding + ascent);   // opaque white — see header

    const frame = atlas.addImage(c);
    if (!frame) return null;   // atlas full — caller's call whether to grow a second atlas (Phase 1 scope)
    const g = { advance, frame, w: cellW, h: cellH };
    glyphs[ch] = g;
    return g;
  }

  for (const ch of chars) addChar(ch);

  /* measureText(str) → {width, height} in the SAME world units the glyph advances/lineHeight are in
     (i.e. the rasterized pixel size — a caller applies its own display `scale` on top, same as
     text-block.js does). An unknown character falls back to a space-width blank rather than throwing. */
  function measureText(str) {
    let width = 0;
    const spaceAdvance = glyphs[' '] ? glyphs[' '].advance : lineHeight * 0.5;
    for (const ch of str) width += glyphs[ch] ? glyphs[ch].advance : spaceAdvance;
    return { width, height: lineHeight };
  }

  return { glyphs, lineHeight, fontPx, measureText, addChar };
}
