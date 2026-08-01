/* ============================================================
   debug-overlay.test.mjs — the createDebugOverlay CONTRACT (Rule 9: encode WHY, not "runs").
   The overlay is DOM+GL code, but its two invariants ARE node-testable and matter: (1) it FAILS LOUD without
   a renderer (a silent no-op instrument is worse than none — the whole doctrine is "ship an instrument, read
   the answer"), and (2) it is INERT with no DOM (a headless/SSR import must not throw — default-inert is the
   byte-identical guarantee the arc rests on).
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDebugOverlay } from './debug-overlay.js';

test('fails loud without a renderer — a debug instrument must never silently no-op', () => {
  assert.throws(() => createDebugOverlay({}), /WebGLRenderer is required/);
  assert.throws(() => createDebugOverlay({ renderer: {} }), /WebGLRenderer is required/, 'a non-renderer object is rejected');
});

test('inert (no throw) in a no-DOM environment — safe to import headless', () => {
  // node has no `document`; with a renderer present the factory returns an inert stub instead of touching GL.
  const fakeRenderer = { getContext: () => ({}) };
  const o = createDebugOverlay({ renderer: fakeRenderer });
  assert.equal(o.el, null, 'no element created without a DOM');
  assert.doesNotThrow(() => { o.update(); o.dispose(); }, 'the stub methods are safe no-ops');
  assert.equal(typeof o.snapshot(), 'string');
});
