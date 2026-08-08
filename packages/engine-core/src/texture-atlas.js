/* ============================================================
   texture-atlas.js — a runtime SHELF packer over one shared canvas texture.
   ------------------------------------------------------------
   Batching is worthless without this (2D-plan §4 gap #2): an InstancedMesh sprite batch is ONE draw
   call because every instance samples the SAME texture — the moment two sprites need two different
   textures, that's two draw calls, and the whole point of createSpriteBatcher is gone. An atlas turns
   "N sprite images" into "1 texture, N sub-rects."

   SHELF PACKING (not MaxRects/guillotine): rows ("shelves") of a fixed height, each holding images left-
   to-right until it's full, a new shelf started below. It is NOT the tightest possible packing (a
   MaxRects packer wastes less area on wildly mixed sizes) — but sprite atlases in practice hold mostly
   similar-sized images (a tile set, an icon set, N variants of one sprite), where a shelf packer is
   within a few % of optimal and is a fraction of the code. Phase 1 scope (brief §8): if this needs to
   grow into a true bin-packer, that's a module of its own — flagged, not silently built.

   `createShelfPacker` is the PURE layout half (no canvas, no THREE — node-testable, see
   texture-atlas.test.mjs) — the same "pull the math out of the DOM-touching function" shape forge-math.js
   established for createTextureForge. `createTextureAtlas` is the thin DOM half that calls it, then
   actually draws pixels.

   flipY IS SET FALSE (see addImage): a canvas's own pixel row 0 is its visual TOP (ctx.drawImage's own
   coordinate convention), and with flipY:false three.js uploads the canvas AS-IS — so canvas pixel (x,y)
   maps directly to texture uv (x/size, y/size) with NO flip to reason about. The default flipY:true
   would invert that relationship (silently upside-down sprites) for no benefit here, since nothing else
   in this atlas depends on the OpenGL bottom-left-origin convention.

   C++ anchor: a bump allocator with one twist — “bump along X within a shelf, start a new shelf when a
   shelf is full,” the 2D-texture equivalent of a slab allocator's free-list-per-size-class, except the
   “size class” here is “this shelf's fixed height.”
   ============================================================ */
import * as THREE from 'three';

/* createShelfPacker({size, padding}) → { place(w,h) → {x,y,w,h}|null, usedFraction(), full } — pure,
   no DOM. `place` returns the INNER (unpadded) rect an image of size w×h should draw at; the padding is
   already reserved around it so neighbouring sprites can't bleed into each other under bilinear filtering
   at atlas seams. */
export function createShelfPacker({ size = 1024, padding = 1 } = {}) {
  const shelves = [];   // { y, height, x } — x is the next free column inside this shelf
  let cursorY = 0;
  let full = false;

  function place(w, h) {
    if (full) return null;
    const pw = w + padding * 2, ph = h + padding * 2;
    if (pw > size || ph > size) return null;   // a single image bigger than the whole atlas — not packable

    // best-fit among EXISTING shelves that are tall enough (fewest wasted rows), else start a new one.
    let shelf = null;
    for (let i = 0; i < shelves.length; i++) {
      const s = shelves[i];
      if (ph <= s.height && s.x + pw <= size && (!shelf || s.height < shelf.height)) shelf = s;
    }
    if (!shelf) {
      if (cursorY + ph > size) { full = true; return null; }
      shelf = { y: cursorY, height: ph, x: 0 };
      shelves.push(shelf);
      cursorY += ph;
    }

    const x = shelf.x + padding, y = shelf.y + padding;
    shelf.x += pw;
    return { x, y, w, h };
  }

  /* usedFraction() — the packed images' bounding area (shelf height × placed width) over the atlas's
     total area. A shelf's unplaced tail is still free for more images and correctly excluded — this is
     a fast estimate, not exact tight-packing occupancy. */
  function usedFraction() {
    let used = 0;
    for (const s of shelves) used += s.x * s.height;
    return Math.min(1, used / (size * size));
  }

  return { place, usedFraction, get size() { return size; }, get full() { return full; } };
}

export function createTextureAtlas({ size = 1024, padding = 1 } = {}) {
  const packer = createShelfPacker({ size, padding });
  const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
  if (canvas) { canvas.width = size; canvas.height = size; }
  const ctx = canvas ? canvas.getContext('2d') : null;

  const texture = canvas ? new THREE.CanvasTexture(canvas) : null;
  if (texture) {
    texture.colorSpace = THREE.SRGBColorSpace;     // sprite art is authored sRGB (same rule as any albedo)
    texture.flipY = false;                         // see header — canvas pixel space IS uv space, no flip
    texture.minFilter = THREE.LinearFilter;         // shrinking a sprite (mid-flight zoom-out) should filter, not shimmer
    texture.magFilter = THREE.NearestFilter;        // enlarging pixel-art sprites should stay crisp, not blur
    texture.generateMipmaps = false;                // mip generation bleeds ACROSS shelf padding into neighbours — off for Phase 1
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
  }

  /* addImage(source, {w,h}) → {u0,v0,uWidth,vHeight, x,y,w,h} (normalized uv rect) or null if the atlas
     is full (caller's call whether to grow into a second atlas — out of Phase 1 scope, see header). */
  function addImage(source, { w, h } = {}) {
    if (!ctx) return null;
    const iw = w != null ? w : source.width, ih = h != null ? h : source.height;
    const rect = packer.place(iw, ih);
    if (!rect) return null;
    ctx.drawImage(source, rect.x, rect.y, iw, ih);
    texture.needsUpdate = true;
    return { u0: rect.x / size, v0: rect.y / size, uWidth: iw / size, vHeight: ih / size, x: rect.x, y: rect.y, w: iw, h: ih };
  }

  function dispose() { if (texture) texture.dispose(); }

  return { texture, canvas, addImage, usedFraction: packer.usedFraction, get size() { return size; }, get full() { return packer.full; }, dispose };
}
