/* text-block.test.mjs — node:test, headless, no THREE/DOM/canvas (createTextBlock itself needs a real
   batcher — browser-verified via tools/2d-layer-probe.mjs). Tests computeTextLayout, the pure half.
   Rule 9: each test states the consequence of failure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeTextLayout } from './text-block.js';

// a tiny synthetic glyph set — widths chosen to be distinct so a transposition bug (using 'a's advance
// for 'b', etc.) would be caught, not accidentally masked by two glyphs sharing a width.
const GLYPHS = {
  a: { advance: 10, w: 12, h: 20, frame: { u0: 0, v0: 0, uWidth: 0.1, vHeight: 0.1 } },
  b: { advance: 14, w: 16, h: 20, frame: { u0: 0.1, v0: 0, uWidth: 0.1, vHeight: 0.1 } },
  ' ': { advance: 6, w: 0, h: 0, frame: null },
};

test('glyphs are placed left-to-right, each cursor advancing by the PRIOR glyph\'s own advance width', () => {
  const { placed } = computeTextLayout('ab', GLYPHS);
  assert.equal(placed.length, 2);
  assert.equal(placed[0].cx, GLYPHS.a.w / 2);                    // 'a' centered in its own cell, cell starts at 0
  assert.equal(placed[1].cx, GLYPHS.a.advance + GLYPHS.b.w / 2);  // 'b' starts where 'a' ADVANCED to (10), not where 'a' ENDED (12)
});

test('a space advances the cursor but places NOTHING (no zero-size sprite for whitespace)', () => {
  const { placed, totalWidth } = computeTextLayout('a b', GLYPHS);
  assert.equal(placed.length, 2, 'only the two visible glyphs should be placed, not the space');
  assert.equal(placed[1].cx, GLYPHS.a.advance + GLYPHS[' '].advance + GLYPHS.b.w / 2, 'b\'s cell must start where the cursor reached AFTER a + the space, not before');
  assert.equal(totalWidth, GLYPHS.a.advance + GLYPHS[' '].advance + GLYPHS.b.advance);
});

test('an unknown character falls back to the space-advance width and places nothing, never throws', () => {
  assert.doesNotThrow(() => computeTextLayout('a?b', GLYPHS, { spaceAdvance: 5 }));
  const { placed, totalWidth } = computeTextLayout('a?b', GLYPHS, { spaceAdvance: 5 });
  assert.equal(placed.length, 2, 'the unknown "?" must be skipped, not crash the whole label');
  assert.equal(totalWidth, GLYPHS.a.advance + 5 + GLYPHS.b.advance);
});

test('totalWidth is exactly the sum of every character\'s advance (the value alignment/centering relies on)', () => {
  const { totalWidth } = computeTextLayout('aab', GLYPHS);
  assert.equal(totalWidth, GLYPHS.a.advance * 2 + GLYPHS.b.advance);
});

test('an empty string places nothing and has zero width', () => {
  const { placed, totalWidth } = computeTextLayout('', GLYPHS);
  assert.deepEqual(placed, []);
  assert.equal(totalWidth, 0);
});
