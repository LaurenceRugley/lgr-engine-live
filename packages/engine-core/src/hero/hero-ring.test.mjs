/* hero-ring.test.mjs — node:test, headless, no DOM/GPU.
   Rule 9: tests encode WHY behavior matters, not just WHAT it does.
   Each test documents the user-visible consequence of failure. */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import { createRing, shouldAutoAdvance, disposeAll } from './hero-ring.js';

// ── createRing ──────────────────────────────────────────────────────────────

test('ring(1): next/prev are no-ops — single scene carousel never switches', () => {
  // WHY: a director with 1 scene must never transition (no "next" exists).
  const r = createRing(1);
  assert.equal(r.next(), 0, 'next stays at 0');
  assert.equal(r.prev(), 0, 'prev stays at 0');
  assert.equal(r.current, 0, 'current unchanged');
});

test('ring(3): next wraps 0→1→2→0', () => {
  // WHY: the carousel must cycle — advancing past the last scene returns to first.
  const r = createRing(3);
  assert.equal(r.next(), 1);
  assert.equal(r.next(), 2);
  assert.equal(r.next(), 0, 'wraps past end');
  assert.equal(r.current, 0);
});

test('ring(3): prev wraps 0→2→1→0', () => {
  // WHY: backward navigation must also wrap — prevents a dead-end at scene 0.
  const r = createRing(3);
  assert.equal(r.prev(), 2, 'wraps below 0 to last');
  assert.equal(r.prev(), 1);
  assert.equal(r.prev(), 0);
});

test('ring.goTo: jumps to valid index without side effects', () => {
  const r = createRing(4);
  r.next(); // current = 1
  r.goTo(3);
  assert.equal(r.current, 3, 'goTo(3) lands at 3');
  // next after goTo still wraps correctly
  assert.equal(r.next(), 0, 'wraps after goTo');
});

test('ring.goTo: throws RangeError on out-of-bounds — avoids silent undefined scenes', () => {
  // WHY: an out-of-range index would either crash the render or silently show nothing.
  const r = createRing(3);
  assert.throws(() => r.goTo(3),  RangeError, 'index == count throws');
  assert.throws(() => r.goTo(-1), RangeError, 'negative index throws');
  assert.throws(() => r.goTo(99), RangeError, 'far out-of-range throws');
});

test('ring(1): throws on count < 1', () => {
  assert.throws(() => createRing(0),  RangeError);
  assert.throws(() => createRing(-1), RangeError);
});

// ── shouldAutoAdvance ────────────────────────────────────────────────────────

test('shouldAutoAdvance: advances only when dwell elapsed and motion allowed', () => {
  // WHY: advancing before dwell creates a jarring strobe; reduced-motion must never advance.
  assert.equal(shouldAutoAdvance(false, 18000, 17999), false, 'dwell not elapsed');
  assert.equal(shouldAutoAdvance(false, 18000, 18000), true,  'exactly at dwell');
  assert.equal(shouldAutoAdvance(false, 18000, 99999), true,  'well past dwell');
});

test('shouldAutoAdvance: reduced-motion NEVER advances regardless of elapsed', () => {
  // WHY: WCAG 2.3.3 — animation from interactions. Must never move without user intent.
  assert.equal(shouldAutoAdvance(true, 18000, 0),      false, 'reduced + zero elapsed');
  assert.equal(shouldAutoAdvance(true, 18000, 18001),  false, 'reduced + past dwell');
  assert.equal(shouldAutoAdvance(true, 18000, 999999), false, 'reduced + far past dwell');
});

// ── disposeAll ───────────────────────────────────────────────────────────────

test('disposeAll: calls dispose on each pack in index order', () => {
  // WHY: skipping a pack dispose leaks GPU memory (geometries + materials stay on GPU).
  //      Wrong order can cause use-after-free on shared resources.
  const order = [];
  const packs = [
    { dispose() { order.push(0); } },
    { dispose() { order.push(1); } },
    { dispose() { order.push(2); } },
  ];
  disposeAll(packs);
  assert.deepEqual(order, [0, 1, 2], 'packs disposed in declaration order');
});

test('disposeAll: each pack dispose called exactly once', () => {
  const counts = [0, 0];
  disposeAll([
    { dispose() { counts[0]++; } },
    { dispose() { counts[1]++; } },
  ]);
  assert.deepEqual(counts, [1, 1], 'each dispose called exactly once');
});
