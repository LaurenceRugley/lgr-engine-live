/* texture-atlas.test.mjs — node:test, headless (no DOM/canvas — tests createShelfPacker, the pure
   layout half; the pixel-drawing half needs a real canvas and is browser-verified, see
   tools/2d-layer-probe.mjs). Rule 9: each test states the consequence of failure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createShelfPacker } from './texture-atlas.js';

test('two same-height images land side-by-side on the SAME shelf, not stacked into two', () => {
  // WHY: this is the whole packing win — if every image started its own shelf, the "shelf" packer would
  // just be a worse column-stack and waste most of the atlas on similar-sized sprites (the common case).
  const p = createShelfPacker({ size: 256, padding: 1 });
  const a = p.place(30, 30), b = p.place(30, 30);
  assert.equal(a.y, b.y, 'same-height images on one shelf must share a y');
  assert.ok(b.x >= a.x + a.w + 1, 'the second image must sit to the right of the first, cleared by padding');
});

test('a padding gap is reserved so neighbours never share an edge', () => {
  // WHY: with 0 gap, bilinear filtering at a sub-rect's edge samples the NEXT sprite's pixels — the
  // classic atlas-bleed artifact (a colored fringe around every sprite).
  const p = createShelfPacker({ size: 256, padding: 2 });
  const a = p.place(10, 10), b = p.place(10, 10);
  assert.equal(b.x - (a.x + a.w), 2 * 2, 'gap between two packed rects must be exactly 2*padding');
});

test('a taller image starts a NEW shelf below, sized to its own height', () => {
  const p = createShelfPacker({ size: 256, padding: 0 });
  const short = p.place(20, 10);
  const tall = p.place(20, 40);   // doesn't fit the 10px-tall shelf → must start a new one
  assert.notEqual(short.y, tall.y);
  assert.ok(tall.y >= short.y + 10, "the new shelf must start below the first shelf's full height");
});

test('best-fit reuses a SHORTER existing shelf over a taller one when both fit', () => {
  // WHY: reusing the tallest shelf for a small image wastes that shelf's leftover height on everyone
  // else who could have used the shorter one instead — best-fit is what keeps packing density up.
  // Numbers chosen so each step is forced, not incidental:
  //   size=300 · tall(20,50) → shelf A: y=0 h=50, leaves 280px width on A.
  //   wide(285,20) → 285 > A's remaining 280, so it CANNOT reuse A → forces a new shelf B: y=50 h=20,
  //     leaving 15px width on B.
  //   small(10,15) fits BOTH A (h50, 260px still free) and B (h20, 15px free) — best-fit must pick B.
  const p = createShelfPacker({ size: 300, padding: 0 });
  const tall = p.place(20, 50);
  const wide = p.place(285, 20);
  assert.notEqual(wide.y, tall.y, 'setup check: the wide image must have been forced onto a NEW shelf');
  const small = p.place(10, 15);
  assert.equal(small.y, wide.y, 'a small image must prefer the shorter shelf (B) over the taller one (A)');
});

test('place() returns null once the atlas is genuinely full, and stays null (no silent overwrite)', () => {
  // WHY: `full` gates a caller's decision to pre-flight a second atlas — if place() ever returned a
  // rect PAST the point of no more room, it would silently draw one sprite's pixels over another's.
  const p = createShelfPacker({ size: 32, padding: 0 });
  const results = [];
  for (let i = 0; i < 20; i++) results.push(p.place(10, 10));
  assert.ok(results.some((r) => r === null), 'a 32×32 atlas cannot hold 20 non-overlapping 10×10 images');
  assert.equal(p.full, true);
  assert.equal(p.place(1, 1), null, 'once full, a later place() call must also fail, not reuse stale shelf state');
});

test('an image larger than the whole atlas is rejected outright, not partially placed', () => {
  const p = createShelfPacker({ size: 64, padding: 0 });
  assert.equal(p.place(100, 10), null);
  assert.equal(p.place(10, 100), null);
});

test('usedFraction() is 0 before any placement and grows monotonically as images are packed', () => {
  const p = createShelfPacker({ size: 100, padding: 0 });
  assert.equal(p.usedFraction(), 0);
  p.place(50, 50);
  const f1 = p.usedFraction();
  assert.ok(f1 > 0 && f1 <= 1);
  p.place(50, 50);
  const f2 = p.usedFraction();
  assert.ok(f2 >= f1, 'packing more images must never DECREASE reported usage');
});
