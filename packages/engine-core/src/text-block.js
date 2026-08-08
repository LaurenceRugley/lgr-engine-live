/* ============================================================
   text-block.js — batched text, on the SAME sprite batcher (no second mesh, no second draw call).
   ------------------------------------------------------------
   "Text rendering on the 2D layer — batched (do not regress to one draw call per label)" (brief §3.2).
   The simplest way to satisfy that literally: a glyph IS a sprite (an atlas sub-rect on a quad, exactly
   what createSpriteBatcher already draws) — so a text block doesn't need its own mesh, shader, or draw
   call at all. It calls `batcher.addSprite()` once per visible glyph on the EXACT SAME InstancedMesh
   every other sprite/panel-slice lives on. N labels of any length still cost ONE draw call, the same one
   the sprite field already pays for (verified empirically in 2d-layer-probe.mjs, not just asserted here).

   `computeTextLayout` is the PURE half (no THREE, no batcher, no DOM) — node-testable, same "pull the
   math out" shape sprite-slots.js/texture-atlas.js established. `createTextBlock` is the thin stateful
   half: lays a string out once, tracks each glyph's LOCAL offset from the block's origin so `setPosition`
   is an O(glyphs) write, not a full re-layout, and `setText`/`destroy` manage the group's sprite ids as
   one unit (swap-remove-safe: every id this module owns goes through `batcher.removeSprite`, the same
   path anything else using the batcher would).

   SINGLE LINE ONLY this pass — no wrapping, no multi-line layout. "A minimal layout box… enough to place
   a HUD" (brief §3.4) covers block POSITIONING; line-wrapping a paragraph is a genuinely different
   problem (word-breaking, justification) that no Phase 1/2 consumer (a HUD label, a score, a button
   caption) actually needs yet — named as the natural follow-up if a consumer needs paragraph text.
   ============================================================ */

/* computeTextLayout(str, glyphs, {spaceAdvance}) → { placed: [{ch,cx,w,h,frame}], totalWidth }
   `cx` is the LOCAL center-x of each glyph's quad, relative to the block's own origin (before any
   scale/align/position is applied — createTextBlock applies all three). Glyphs missing from the atlas
   (or the literal space character) advance the cursor but place nothing — no missing-glyph box, no
   throw; a HUD string with one untracked character shouldn't lose the rest of the label. */
export function computeTextLayout(str, glyphs, { spaceAdvance = 8 } = {}) {
  let cursor = 0;
  const placed = [];
  for (const ch of str) {
    const g = glyphs[ch];
    if (!g || ch === ' ' || !g.frame) {
      cursor += g ? g.advance : spaceAdvance;
      continue;
    }
    placed.push({ ch, cx: cursor + g.w / 2, w: g.w, h: g.h, frame: g.frame });
    cursor += g.advance;
  }
  return { placed, totalWidth: cursor };
}

/* createTextBlock({ batcher, glyphAtlas, text, x, y, scale, tint, alpha, align })
   → { setText, setPosition, setTint, setAlpha, getWidth, destroy, ids }
   `align`: 'left' (default) | 'center' | 'right' — shifts the WHOLE block relative to (x,y), same
   convention layout-box.js's anchors use for children. */
export function createTextBlock({ batcher, glyphAtlas, text = '', x = 0, y = 0, scale = 1, tint = 0xffffff, alpha = 1, align = 'left' } = {}) {
  if (!batcher || !glyphAtlas) throw new Error('createTextBlock: batcher and glyphAtlas required');

  let _x = x, _y = y, _scale = scale, _tint = tint, _alpha = alpha, _align = align, _text = text;
  let entries = [];    // [{id, dx}] — dx is this glyph's LOCAL offset from the block origin, post-scale/align
  let _width = 0;

  function rebuild() {
    for (const e of entries) batcher.removeSprite(e.id);
    entries = [];
    const { placed, totalWidth } = computeTextLayout(_text, glyphAtlas.glyphs, { spaceAdvance: glyphAtlas.lineHeight * 0.5 });
    const alignShift = _align === 'center' ? totalWidth / 2 : _align === 'right' ? totalWidth : 0;
    for (const p of placed) {
      const dx = (p.cx - alignShift) * _scale;
      const id = batcher.addSprite({
        x: _x + dx, y: _y,
        width: p.w * _scale, height: p.h * _scale,
        tint: _tint, alpha: _alpha, frame: p.frame,
      });
      if (id != null) entries.push({ id, dx });
    }
    _width = totalWidth * _scale;
  }
  rebuild();

  function setText(next) { if (next === _text) return; _text = next; rebuild(); }
  function setPosition(nx, ny) { _x = nx; _y = ny; for (const e of entries) batcher.setSprite(e.id, { x: _x + e.dx, y: _y }); }
  function setTint(t) { _tint = t; for (const e of entries) batcher.setSprite(e.id, { tint: t }); }
  function setAlpha(a) { _alpha = a; for (const e of entries) batcher.setSprite(e.id, { alpha: a }); }
  function destroy() { for (const e of entries) batcher.removeSprite(e.id); entries = []; }

  return {
    setText, setPosition, setTint, setAlpha, destroy,
    getWidth() { return _width; },
    getHeight() { return glyphAtlas.lineHeight * _scale; },
    get ids() { return entries.map((e) => e.id); },
  };
}
