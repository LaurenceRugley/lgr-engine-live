/* createSmoothScroll.test.mjs — node:test, headless (imports only the PURE math, no DOM touched).
   Rule 9: each test states the user-visible consequence of failure. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lerp, clampScroll, scrollProgress, scrollVelocity } from './createSmoothScroll.js';

test('lerp hits both endpoints and the midpoint', () => {
  // WHY: scrollTo animates currentY = lerp(from, to, ease(t)); if it does not reach `to` at t=1 the
  // page lands short of the anchor.
  assert.equal(lerp(100, 300, 0), 100);
  assert.equal(lerp(100, 300, 1), 300);
  assert.equal(lerp(100, 300, 0.5), 200);
});

test('clampScroll pins the virtual position inside [0, limit]', () => {
  // WHY: a wheel flick past the end must not drive scrollTop negative or beyond the document — that
  // is the iOS rubber-band / dead-zone-at-the-bottom bug.
  assert.equal(clampScroll(-50, 1000), 0, 'no negative overscroll');
  assert.equal(clampScroll(1200, 1000), 1000, 'no past-end overscroll');
  assert.equal(clampScroll(400, 1000), 400, 'in-range passes through');
});

test('clampScroll treats a non-positive limit as a zero ceiling (unscrollable page)', () => {
  // WHY: a short page (content <= viewport) has limit 0 or negative; the target must stay pinned at 0,
  // never a NaN/negative that would jitter a non-scrolling page.
  assert.equal(clampScroll(300, 0), 0);
  assert.equal(clampScroll(300, -200), 0);
});

test('scrollProgress maps scroll to [0,1], and 0 on an unscrollable page (no divide-by-zero)', () => {
  // WHY: motion.js drives reveals off progress; a NaN (limit 0) would break every scroll-linked effect
  // at the top of a short page.
  assert.equal(scrollProgress(0, 1000), 0);
  assert.equal(scrollProgress(500, 1000), 0.5);
  assert.equal(scrollProgress(1000, 1000), 1);
  assert.equal(scrollProgress(1500, 1000), 1, 'clamps past the end');
  assert.equal(scrollProgress(200, 0), 0, 'unscrollable => 0, not NaN');
});

test('scrollVelocity is px/s and guards a zero/backward dt', () => {
  // WHY: velocity feeds motion effects; a dt<=0 (a doubled rAF timestamp) must not produce Infinity.
  assert.equal(scrollVelocity(100, 160, 0.1), 600, '60px over 0.1s = 600px/s');
  assert.equal(scrollVelocity(160, 100, 0.1), -600, 'negative on upward scroll');
  assert.equal(scrollVelocity(100, 160, 0), 0, 'dt=0 guarded, not Infinity');
  assert.equal(scrollVelocity(100, 160, -0.01), 0, 'backward dt guarded');
});
