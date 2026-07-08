/* ============================================================
   trace-player.js — VIZ SLICE 2: trace playback controller
   ------------------------------------------------------------
   Controls stepIndex over a recorded trace (ops + keyframes from createTracer).

   SEEK SEMANTICS (Opus-refute correction 5):
     - Backward step/scrub: SNAPS to the discrete post-step state (no reverse-animation;
       `swap` isn't invertible, and replaying backward would be wrong anyway).
     - Forward step: starts a morph-timeline tween (fractional-t for visual effects).
     - Line-highlight at tween-START: the code panel is updated at step change, BEFORE
       the visual tween completes — cause before effect.

   FRACTIONAL-T: a morph-timeline drives the within-step blend (0=step start, 1=step end).
   The consumer uses `tween.t` (exposed via the update callback) to animate swap arcs,
   color pulses, etc. Backward scrub snaps tween.t to 1 (settled state).

   NO-HOT-ALLOC: update() path never allocates. All primitives are captured in the closure.
   ============================================================ */
import { createMorphTimeline } from './math/morph-timeline.js';

export function createTracePlayer(tracer, { msPerStep = 700 } = {}) {
  const ops        = tracer.getOps();
  const keyframes  = tracer.getKeyframes();
  let stepIndex    = 0;
  let playing      = false;
  let _cb          = null;
  // Per-step morph tween (80% of step duration — leaves a short rest before the next op).
  const _tween     = createMorphTimeline({ duration: msPerStep * 0.8 });

  function onUpdate(fn) { _cb = fn; }

  function _fire() {
    if (_cb) _cb(stepIndex, _tween.t, ops, keyframes);
  }

  function _forward() {
    if (stepIndex >= ops.length) return false;
    stepIndex++;
    _tween.play(0, 1);   // kick off forward tween
    _fire();              // line highlight at tween-START (cb fires with t≈0)
    return true;
  }

  function _backward() {
    if (stepIndex <= 0) return false;
    stepIndex--;
    _tween.scrub(1);     // SNAP backward — no reverse animation
    _fire();
    return true;
  }

  function step(delta) {
    const dir = delta > 0 ? 1 : -1;
    const n   = Math.abs(delta);
    for (let i = 0; i < n; i++) { if (!(dir > 0 ? _forward() : _backward())) break; }
  }

  // Scrub to absolute position t ∈ [0,1] — maps to stepIndex ∈ [0, ops.length]. SNAPS.
  function scrub(t) {
    const tc = Math.max(0, Math.min(1, t));
    stepIndex = Math.round(tc * ops.length);
    _tween.scrub(1);  // snap to settled state
    _fire();
  }

  function play()  { playing = true; }
  function pause() { playing = false; }

  function update(dt) {
    _tween.update(dt);
    if (playing) {
      if (!_tween.playing) {
        // Current step's tween finished — try to advance.
        if (!_forward()) playing = false;  // reached the end
      }
      _fire();  // fire every frame during play so tween.t drives visuals continuously
    }
  }

  // Expose the underlying morph tween so consumers can read .t directly.
  return {
    onUpdate, step, scrub, play, pause, update,
    get stepIndex() { return stepIndex; },
    get playing()   { return playing; },
    get ops()       { return ops; },
    get keyframes() { return keyframes; },
    get stepCount() { return ops.length; },
    get tween()     { return _tween; },
  };
}
