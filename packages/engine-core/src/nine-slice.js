/* ============================================================
   nine-slice.js — 9-slice panels, as NINE sprites on the SAME shared batcher.
   ------------------------------------------------------------
   "The one primitive that makes HUDs and buttons possible" (brief §3.3) — a panel whose CORNERS stay a
   fixed size while its EDGES/CENTER stretch to fill any target size, from one source image.

   No new shader, no new mesh: a 9-slice panel is just nine `createSpriteBatcher` sprites, each sampling
   its own sub-rect of the SAME atlas sub-rect (`frame`) the panel's source image already occupies, sized
   and positioned by `computeNineSliceLayout` below. This is the same "reuse the batcher, add a thin
   layout layer" shape `text-block.js` uses for glyphs — one draw call keeps covering ANY number of
   sprites, glyphs, AND panel-slices, because they are all, mechanically, the same kind of instance.

   `computeNineSliceLayout` is the PURE half (no THREE, no batcher — node-testable, see
   nine-slice.test.mjs): given a target rect + a border inset + the source `frame` (an
   `atlas.addImage()` result), it returns up to 9 `{x,y,w,h, u0,v0,uWidth,vHeight}` pieces — WORLD-space
   placement paired with the matching ATLAS sub-rect for each. `createNineSlicePanel` is the thin
   stateful half.
   ============================================================ */

/* computeNineSliceLayout({x,y,width,height,border,frame}) → [{x,y,w,h,u0,v0,uWidth,vHeight,row,col}]
   `border`: a number (uniform) or {left,right,top,bottom}, in the SOURCE IMAGE's own pixel units (the
   same units as `frame.w`/`frame.h` — NOT world units, NOT uv fractions). Borders are clamped so a
   panel smaller than its own border never produces a negative-size or inverted center piece; a
   degenerate (zero-size) row/column is simply omitted, not emitted as a zero-area sprite.
   Rows are TOP→BOTTOM in WORLD space (this engine's 2D layer is Y-up — create2DLayer.js), matching
   texture-atlas.js's v0=TOP convention on the source side, so "row 0 / top" means the same thing in
   both the target rect and the source image without a flip to reason about. */
export function computeNineSliceLayout({ x = 0, y = 0, width, height, border, frame }) {
  if (!frame || width <= 0 || height <= 0) return [];
  const b = typeof border === 'number' ? { left: border, right: border, top: border, bottom: border } : (border || {});
  const bl = Math.max(0, Math.min(b.left || 0, width / 2));
  const br = Math.max(0, Math.min(b.right || 0, width / 2));
  const bt = Math.max(0, Math.min(b.top || 0, height / 2));
  const bb = Math.max(0, Math.min(b.bottom || 0, height / 2));

  const colW = [bl, Math.max(0, width - bl - br), br];
  const colX = [x - width / 2 + colW[0] / 2, x - width / 2 + bl + colW[1] / 2, x + width / 2 - colW[2] / 2];
  const rowH = [bt, Math.max(0, height - bt - bb), bb];   // row 0 = TOP
  const rowY = [y + height / 2 - rowH[0] / 2, y + height / 2 - bt - rowH[1] / 2, y - height / 2 + rowH[2] / 2];

  // source-side column/row sizes in PIXELS, clamped the same way against the source image's own size.
  const sbl = Math.max(0, Math.min(b.left || 0, frame.w / 2)), sbr = Math.max(0, Math.min(b.right || 0, frame.w / 2));
  const sbt = Math.max(0, Math.min(b.top || 0, frame.h / 2)), sbb = Math.max(0, Math.min(b.bottom || 0, frame.h / 2));
  const uColPx = [sbl, Math.max(0, frame.w - sbl - sbr), sbr];
  const vRowPx = [sbt, Math.max(0, frame.h - sbt - sbb), sbb];   // row 0 = TOP (v0 is the image's top edge)
  const uCol = uColPx.map((px) => (px / frame.w) * frame.uWidth);
  const vRow = vRowPx.map((px) => (px / frame.h) * frame.vHeight);
  const uOff = [frame.u0, frame.u0 + uCol[0], frame.u0 + uCol[0] + uCol[1]];
  const vOff = [frame.v0, frame.v0 + vRow[0], frame.v0 + vRow[0] + vRow[1]];

  const pieces = [];
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      if (colW[col] <= 0 || rowH[row] <= 0) continue;
      pieces.push({
        x: colX[col], y: rowY[row], w: colW[col], h: rowH[row],
        u0: uOff[col], v0: vOff[row], uWidth: uCol[col], vHeight: vRow[row],
        row, col,
      });
    }
  }
  return pieces;
}

/* createNineSlicePanel({ batcher, frame, border, x, y, width, height, tint, alpha })
   → { setSize, setPosition, setTint, setAlpha, destroy, ids } */
export function createNineSlicePanel({ batcher, frame, border, x = 0, y = 0, width, height, tint = 0xffffff, alpha = 1 } = {}) {
  if (!batcher || !frame) throw new Error('createNineSlicePanel: batcher and frame required');

  let _x = x, _y = y, _width = width, _height = height, _tint = tint, _alpha = alpha;
  let entries = [];   // [{id, dx, dy}] — LOCAL offsets (layout computed at origin 0,0) so setPosition is cheap

  function rebuild() {
    for (const e of entries) batcher.removeSprite(e.id);
    entries = [];
    const pieces = computeNineSliceLayout({ x: 0, y: 0, width: _width, height: _height, border, frame });
    for (const p of pieces) {
      const id = batcher.addSprite({
        x: _x + p.x, y: _y + p.y, width: p.w, height: p.h,
        tint: _tint, alpha: _alpha,
        frame: { u0: p.u0, v0: p.v0, uWidth: p.uWidth, vHeight: p.vHeight },
      });
      if (id != null) entries.push({ id, dx: p.x, dy: p.y });
    }
  }
  rebuild();

  function setPosition(nx, ny) { _x = nx; _y = ny; for (const e of entries) batcher.setSprite(e.id, { x: _x + e.dx, y: _y + e.dy }); }
  function setSize(w, h) { _width = w; _height = h; rebuild(); }   // a resize genuinely changes every piece's own w/h — cheap reposition doesn't apply
  function setTint(t) { _tint = t; for (const e of entries) batcher.setSprite(e.id, { tint: t }); }
  function setAlpha(a) { _alpha = a; for (const e of entries) batcher.setSprite(e.id, { alpha: a }); }
  function destroy() { for (const e of entries) batcher.removeSprite(e.id); entries = []; }

  return { setPosition, setSize, setTint, setAlpha, destroy, get ids() { return entries.map((e) => e.id); } };
}
