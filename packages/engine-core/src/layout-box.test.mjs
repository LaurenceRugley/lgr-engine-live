/* layout-box.test.mjs — node:test, headless, no THREE/DOM. Rule 9: each test states the consequence of
   failure — layoutBox drives WHERE a HUD element actually appears, so a wrong sign/axis here means a
   score display renders off-screen or a button bar sits under the wrong edge. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutBox, LAYOUT_ANCHORS } from './layout-box.js';

const PARENT = { parentWidth: 800, parentHeight: 600 };

test('top-left anchor with no padding puts the box just inside the parent\'s top-left corner', () => {
  const box = layoutBox({ ...PARENT, width: 100, height: 40, anchor: 'top-left' });
  // parent spans x:[-400,400] y:[-300,300] (center-origin). A 100-wide box's LEFT edge at x=-400 means
  // its CENTER is at -400+50=-350; a 40-tall box's TOP edge at y=300 means its center is at 300-20=280.
  assert.ok(Math.abs(box.x - -350) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - 280) < 1e-9, `y=${box.y}`);
});

test('bottom-right anchor with padding insets from BOTH the right and bottom edges', () => {
  const box = layoutBox({ ...PARENT, width: 100, height: 40, anchor: 'bottom-right', padding: 20 });
  // right edge inset to 400-20=380 → center x = 380-50=330. bottom edge inset to -300+20=-280 → center y = -280+20=-260.
  assert.ok(Math.abs(box.x - 330) < 1e-9, `x=${box.x}`);
  assert.ok(Math.abs(box.y - -260) < 1e-9, `y=${box.y}`);
});

test('center anchor ignores padding on the centered axis (nothing to inset from)', () => {
  // WHY: padding pushes a box AWAY from an edge it's anchored to — a fully-centered box isn't anchored
  // to any edge on either axis, so padding must be a no-op, the same way CSS margin on a centered flex
  // item along the cross axis has nothing to push against.
  const noPad = layoutBox({ ...PARENT, width: 100, height: 40, anchor: 'center' });
  const padded = layoutBox({ ...PARENT, width: 100, height: 40, anchor: 'center', padding: 50 });
  assert.deepEqual(noPad, padded);
  assert.equal(noPad.x, 0); assert.equal(noPad.y, 0);
});

test('a per-side padding object only insets the sides it names', () => {
  const box = layoutBox({ ...PARENT, width: 100, height: 40, anchor: 'top-left', padding: { left: 30 } });
  assert.ok(Math.abs(box.x - (-400 + 30 + 50)) < 1e-9, `left padding must shift x by 30, got x=${box.x}`);
  assert.ok(Math.abs(box.y - 280) < 1e-9, 'an un-named side (top) must default to 0 padding, not inherit left\'s 30');
});

test('every one of the 9 documented anchors resolves without throwing, and LAYOUT_ANCHORS lists all 9', () => {
  assert.equal(LAYOUT_ANCHORS.length, 9);
  for (const anchor of LAYOUT_ANCHORS) {
    assert.doesNotThrow(() => layoutBox({ ...PARENT, width: 10, height: 10, anchor }));
  }
});

test('an unknown anchor throws (fails loud) rather than silently defaulting somewhere unexpected', () => {
  assert.throws(() => layoutBox({ ...PARENT, width: 10, height: 10, anchor: 'top-outside' }));
});
