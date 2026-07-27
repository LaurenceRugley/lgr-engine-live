/* wipe-machine.test.mjs — node:test, headless, no DOM/GPU.
   Rule 9: tests encode WHY behavior matters, not just WHAT it does.
   Each test documents the user-visible consequence of failure. */
import { test } from 'node:test';
import assert   from 'node:assert/strict';
import {
  WIPE_MODES, resolveModeId, easeInOut, applyReducedMotion, createWipeMachine,
} from './wipe-machine.js';

// ── mode mapping ──────────────────────────────────────────────────────────────

test('resolveModeId maps every named mode to the shader int the frag compares', () => {
  // WHY: the name->int map is the ONLY contract between JS and hero-wipe.frag's uMode ladder.
  // If it drifts, the demo asks for 'honeycomb' and the shader draws 'ash' — a silent wrong render.
  assert.equal(resolveModeId('fade'), 0);
  assert.equal(resolveModeId('ash'), 1);
  assert.equal(resolveModeId('honeycomb'), 2);
  assert.equal(resolveModeId('halftone'), 3);
  assert.deepEqual(Object.keys(WIPE_MODES).sort(), ['ash', 'fade', 'halftone', 'honeycomb']);
});

test('resolveModeId throws on an unknown mode — no silent fallback to fade', () => {
  // WHY: a typo'd mode ('honycomb') must FAIL LOUD (Rule 12), not quietly cross-fade and look
  // "kind of right" — that hides the bug until someone notices the wrong transition shipped.
  assert.throws(() => resolveModeId('honycomb'), /unknown mode/);
  assert.throws(() => resolveModeId(undefined), /unknown mode/);
});

// ── ease curve ──────────────────────────────────────────────────────────────

test('easeInOut pins the endpoints and midpoint symmetry', () => {
  // WHY: the fade baseline must read identically in JS and GLSL. A curve that does not hit
  // 0 and 1 exactly at the ends leaves a visible pop at the start/end of a fade.
  assert.equal(easeInOut(0), 0, 'starts fully at A');
  assert.equal(easeInOut(1), 1, 'ends fully at B');
  assert.equal(easeInOut(0.5), 0.5, 'symmetric at the midpoint');
  assert.ok(easeInOut(0.25) < 0.25, 'eases IN (slower than linear early)');
});

test('easeInOut clamps out-of-range t', () => {
  // WHY: floating-point progress can overshoot slightly; the curve must not return >1 / <0
  // (which would over/undershoot the colour mix and flash).
  assert.equal(easeInOut(-0.3), 0);
  assert.equal(easeInOut(1.4), 1);
});

// ── reduced motion ──────────────────────────────────────────────────────────

test('applyReducedMotion downgrades ANY geometric wipe to a gentle 150ms fade', () => {
  // WHY: WCAG 2.3.3 — a motion-sensitive visitor must never get flying ash squares or swelling
  // hexes. We degrade to a short cross-fade, not a hard cut (a cut can still read as a flash).
  const out = applyReducedMotion({ mode: 'ash', duration: 1800, cell: 30 }, true);
  assert.equal(out.mode, 'fade', 'forced to fade');
  assert.equal(out.duration, 150, 'capped at 150ms');
  assert.equal(out.cell, 30, 'unrelated params pass through');
});

test('applyReducedMotion is a pure pass-through when reduced-motion is off', () => {
  // WHY: the common path must be untouched — no accidental clamping of a normal 1800ms wipe.
  const opts = { mode: 'honeycomb', duration: 1800 };
  const out = applyReducedMotion(opts, false);
  assert.equal(out, opts, 'same object returned, not a copy');
});

test('applyReducedMotion never mutates the caller opts', () => {
  // WHY: the caller may reuse its opts object across transitions; mutating it would poison
  // the next (non-reduced) run.
  const opts = { mode: 'ash', duration: 1800 };
  applyReducedMotion(opts, true);
  assert.equal(opts.mode, 'ash', 'caller mode intact');
  assert.equal(opts.duration, 1800, 'caller duration intact');
});

// ── the state machine ────────────────────────────────────────────────────────

test('createWipeMachine: idle until started, then progresses linearly', () => {
  const m = createWipeMachine();
  assert.equal(m.active, false, 'starts idle');
  assert.equal(m.t, 0);
  m.start(1000);
  assert.equal(m.active, true, 'wiping after start');
  const a = m.advance(250);
  assert.ok(Math.abs(a.t - 0.25) < 1e-9, '250ms of 1000ms => t=0.25');
  assert.equal(a.active, true);
  assert.equal(a.justFinished, false);
});

test('createWipeMachine: justFinished fires EXACTLY once, on the crossing tick', () => {
  // WHY: the completion promise resolves on justFinished. If it fired every tick after 1.0,
  // a caller awaiting it (or chaining the next scene) would fire repeatedly — duplicate advances.
  const m = createWipeMachine();
  m.start(1000);
  assert.equal(m.advance(900).justFinished, false, 'not done at 0.9');
  const done = m.advance(200);   // crosses 1.0
  assert.equal(done.justFinished, true, 'fires on the crossing');
  assert.equal(done.t, 1, 'clamped to exactly 1');
  assert.equal(done.active, false, 'back to idle');
  const after = m.advance(100);  // further ticks while idle
  assert.equal(after.justFinished, false, 'does NOT re-fire while idle');
  assert.equal(after.active, false);
});

test('createWipeMachine: start(0) is safe (no divide-by-zero) and finishes next tick', () => {
  // WHY: a caller could pass duration 0 (or negative). It must clamp, not produce NaN t.
  const m = createWipeMachine();
  m.start(0);
  const a = m.advance(16);
  assert.ok(Number.isFinite(a.t), 't stays finite');
  assert.equal(a.justFinished, true, 'a 0ms wipe completes immediately');
});

test('createWipeMachine.finish snaps to done and reports whether it interrupted', () => {
  const m = createWipeMachine();
  m.start(1000);
  m.advance(300);
  assert.equal(m.finish(), true, 'reports it interrupted an active wipe');
  assert.equal(m.t, 1);
  assert.equal(m.active, false);
  assert.equal(m.finish(), false, 'finishing an idle machine reports no interruption');
});
