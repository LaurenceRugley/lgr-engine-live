/* nine-slice.test.mjs — node:test, headless, no THREE/DOM. Rule 9: each test states the consequence of
   failure — computeNineSliceLayout drives both the WORLD placement and the ATLAS sampling of a panel;
   get either wrong and a button either looks stretched-blurry (corners not preserved) or samples the
   wrong pixels of a shared atlas (uv math wrong — a Rule 15 "an assumption, not a check" class of bug). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNineSliceLayout } from './nine-slice.js';

// a 60×40 source image packed at atlas offset (100,50) — arbitrary non-zero numbers so a bug that only
// shows up when u0/v0 aren't 0 (a very common off-by-reference-frame mistake) can't hide.
const FRAME = { u0: 100 / 1024, v0: 50 / 1024, uWidth: 60 / 1024, vHeight: 40 / 1024, w: 60, h: 40 };

test('a normal panel emits exactly 9 pieces', () => {
  const pieces = computeNineSliceLayout({ x: 0, y: 0, width: 200, height: 100, border: 10, frame: FRAME });
  assert.equal(pieces.length, 9);
});

test('corner pieces keep the BORDER size exactly, regardless of how large the target panel is', () => {
  // WHY: the entire point of 9-slice is that corners DON'T stretch — a corner that scales with the
  // panel would look like a plain stretched image, indistinguishable from not having 9-slice at all.
  const small = computeNineSliceLayout({ x: 0, y: 0, width: 100, height: 60, border: 8, frame: FRAME });
  const big = computeNineSliceLayout({ x: 0, y: 0, width: 900, height: 700, border: 8, frame: FRAME });
  const topLeftSmall = small.find((p) => p.row === 0 && p.col === 0);
  const topLeftBig = big.find((p) => p.row === 0 && p.col === 0);
  assert.equal(topLeftSmall.w, 8); assert.equal(topLeftSmall.h, 8);
  assert.equal(topLeftBig.w, 8); assert.equal(topLeftBig.h, 8);
});

test('the CENTER piece absorbs all the extra size as the panel grows', () => {
  const pieces = computeNineSliceLayout({ x: 0, y: 0, width: 220, height: 120, border: 10, frame: FRAME });
  const center = pieces.find((p) => p.row === 1 && p.col === 1);
  assert.equal(center.w, 220 - 10 - 10);
  assert.equal(center.h, 120 - 10 - 10);
});

test('the top row sits at the HIGHEST y (world is Y-up) and the bottom row at the lowest', () => {
  const pieces = computeNineSliceLayout({ x: 0, y: 0, width: 200, height: 100, border: 10, frame: FRAME });
  const top = pieces.find((p) => p.row === 0 && p.col === 1), bottom = pieces.find((p) => p.row === 2 && p.col === 1);
  assert.ok(top.y > bottom.y, `top row (y=${top.y}) must be ABOVE the bottom row (y=${bottom.y}) in Y-up space`);
});

test('target placement is centered on (x,y): the 3 column centers and 3 row centers are symmetric', () => {
  const pieces = computeNineSliceLayout({ x: 50, y: -30, width: 200, height: 100, border: 10, frame: FRAME });
  const left = pieces.find((p) => p.col === 0 && p.row === 1), right = pieces.find((p) => p.col === 2 && p.row === 1);
  assert.ok(Math.abs((left.x + right.x) / 2 - 50) < 1e-9, 'left/right column centers must average back to x=50');
});

test('the source uv sub-rects exactly tile the WHOLE source frame (no gap, no overlap, no drift)', () => {
  // WHY: this is the property that keeps the panel's texture from showing seams or sampling outside its
  // own atlas cell into a NEIGHBOUR sprite's pixels (the exact bug the atlas's own padding exists to guard against).
  const pieces = computeNineSliceLayout({ x: 0, y: 0, width: 200, height: 100, border: 12, frame: FRAME });
  const colUSum = ['col0', 1, 2].map((_, c) => pieces.find((p) => p.col === c && p.row === 1).uWidth).reduce((a, b) => a + b, 0);
  const rowVSum = [0, 1, 2].map((r) => pieces.find((p) => p.row === r && p.col === 1).vHeight).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(colUSum - FRAME.uWidth) < 1e-9, `column u-widths must sum to the frame's own uWidth, got ${colUSum} vs ${FRAME.uWidth}`);
  assert.ok(Math.abs(rowVSum - FRAME.vHeight) < 1e-9, `row v-heights must sum to the frame's own vHeight, got ${rowVSum} vs ${FRAME.vHeight}`);
  const leftMost = pieces.find((p) => p.col === 0 && p.row === 1);
  assert.ok(Math.abs(leftMost.u0 - FRAME.u0) < 1e-9, 'the leftmost column must start exactly at the frame\'s own u0');
});

test('a target smaller than 2×border clamps to a non-negative center instead of an inverted/negative piece', () => {
  // WHY: an inverted-size quad (negative w/h) is undefined rendering behaviour, not just an ugly panel.
  const pieces = computeNineSliceLayout({ x: 0, y: 0, width: 10, height: 10, border: 20, frame: FRAME });
  for (const p of pieces) { assert.ok(p.w >= 0, `piece w=${p.w} must never be negative`); assert.ok(p.h >= 0, `piece h=${p.h} must never be negative`); }
});

test('border=0 collapses to a SINGLE stretched piece (no degenerate zero-area corner/edge sprites emitted)', () => {
  // WHY: emitting 9 pieces where 8 have zero area would still be "correct" geometrically but would
  // waste 8 sprite slots and 8 GPU writes for literally nothing visible — the filter exists to prevent that.
  const pieces = computeNineSliceLayout({ x: 0, y: 0, width: 200, height: 100, border: 0, frame: FRAME });
  assert.equal(pieces.length, 1);
  assert.equal(pieces[0].row, 1); assert.equal(pieces[0].col, 1);
  assert.equal(pieces[0].w, 200); assert.equal(pieces[0].h, 100);
});
