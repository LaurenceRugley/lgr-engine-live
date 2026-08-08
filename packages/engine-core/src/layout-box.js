/* ============================================================
   layout-box.js — anchor / align / padding. NOT a flexbox engine (brief §3.4: "enough to place a HUD").
   ------------------------------------------------------------
   Pure, no THREE, no DOM — a single function, one honest job: given a PARENT rect (typically the 2D
   layer's own `{width, height}`, center-origin Y-up — create2DLayer.js) and a CHILD's own size, return
   the child's CENTER (x, y) — the same convention `batcher.addSprite({x,y,...})` already uses — anchored
   to one of the 9 standard positions and inset from the parent's edges by `padding`. That is the entire
   feature set: no flex-grow, no wrapping, no nested boxes computing each other's size. A HUD's score in
   the top-left, a button bar bottom-center, a dialogue panel bottom-center-but-taller — all nine anchors
   cover the whole "place one thing near one edge/corner of the screen" job a HUD actually needs.
   ============================================================ */

const ANCHORS = {
  'top-left': [-1, 1], 'top-center': [0, 1], 'top-right': [1, 1],
  'center-left': [-1, 0], 'center': [0, 0], 'center-right': [1, 0],
  'bottom-left': [-1, -1], 'bottom-center': [0, -1], 'bottom-right': [1, -1],
};

export const LAYOUT_ANCHORS = Object.freeze(Object.keys(ANCHORS));

/* layoutBox({parentWidth, parentHeight, width, height, anchor, padding}) → {x, y, width, height}
   `padding`: a number (uniform) or {left, right, top, bottom} (any omitted side defaults to 0). Insets
   are measured from the PARENT's edge the box is anchored toward; a center-anchored axis ignores
   padding on that axis (there's no edge to inset from — matches CSS's own convention for a centered
   flex/grid item, where margin on the cross axis has nothing to push against). */
export function layoutBox({ parentWidth, parentHeight, width = 0, height = 0, anchor = 'center', padding = 0 } = {}) {
  const dir = ANCHORS[anchor];
  if (!dir) throw new Error(`layoutBox: unknown anchor "${anchor}" — expected one of ${LAYOUT_ANCHORS.join(', ')}`);
  const [hx, vy] = dir;
  const p = typeof padding === 'number' ? { left: padding, right: padding, top: padding, bottom: padding } : { left: 0, right: 0, top: 0, bottom: 0, ...padding };

  const halfW = parentWidth / 2, halfH = parentHeight / 2;
  const leftEdge = -halfW + p.left, rightEdge = halfW - p.right;
  const topEdge = halfH - p.top, bottomEdge = -halfH + p.bottom;   // Y-up: "top" is the LARGER y

  const x = hx < 0 ? leftEdge + width / 2 : hx > 0 ? rightEdge - width / 2 : (leftEdge + rightEdge) / 2;
  const y = vy > 0 ? topEdge - height / 2 : vy < 0 ? bottomEdge + height / 2 : (topEdge + bottomEdge) / 2;

  return { x, y, width, height };
}
