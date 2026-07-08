/* ============================================================
   morph-timeline.js — Slice 1a: one-scalar animation engine
   ------------------------------------------------------------
   Owns ONE scalar t ∈ [0,1].
   - scrub(t) — set t directly (for a slider / drag); immediate.
   - play(from, to, { ease, duration }) — start auto-playback from `from` to `to`.
   - update(dt) — advance playback by dt ms; call inside the render loop.
   - onUpdate(fn) — register a callback fired on every t change.
   - get t — current value.

   Generalizes the sun-rig one-scalar-t pattern (sun-rig.js:update(dt) → t advances
   along keyframes) into a reusable tween engine. No GSAP — first-party ease.

   NO HOT ALLOC: no `new` per frame. All state is plain scalars + the user's callback ref.
   ============================================================ */

/* ease-in-out-cubic: smooth S-curve, zero velocity at both endpoints.
   WHY cubic (not linear): linear motion looks mechanical; cubic gives the "object has weight"
   feel that makes matrix morphs read as physical transformations, not data jumps.
   f(0)=0, f(1)=1, monotonically increasing — critical for faithful interpolation (Rule: ease
   must be monotonic so intermediate states are real linear maps, not backtracked ones). */
export function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export function createMorphTimeline({ duration = 1000, ease = easeInOutCubic } = {}) {
  let _t       = 0;      // current value (output, ∈ [0,1] for play; exact for scrub)
  let _from    = 0;      // play start value
  let _to      = 1;      // play end value
  let _elapsed = 0;      // ms since play() was called
  let _dur     = duration;
  let _ease    = ease;
  let _playing = false;
  let _cb      = null;   // onUpdate callback

  // onUpdate — register the subscriber. Only one; replaces any prior registration.
  function onUpdate(fn) { _cb = fn; }

  // scrub — set t directly (slider-driven). Stops any active playback.
  function scrub(t) {
    _playing = false;
    _t = Math.max(0, Math.min(1, t));
    if (_cb) _cb(_t);
  }

  // play — begin timed playback from `from` to `to`.
  function play(from, to, { ease: e = _ease, duration: d = _dur } = {}) {
    _from = from; _to = to; _ease = e; _dur = d;
    _elapsed = 0;
    _playing = true;
    _t = from;
    if (_cb) _cb(_t);
  }

  // update — advance playback by dt milliseconds. Call inside the render loop.
  function update(dt) {
    if (!_playing) return;
    _elapsed += dt;
    if (_elapsed >= _dur) { _elapsed = _dur; _playing = false; }
    // Compute: alpha = ease(progress), then lerp from→to by alpha.
    // WHY: this is the one-scalar pattern from sun-rig — a single t drives all state.
    const alpha = _ease(_elapsed / _dur);
    _t = _from + alpha * (_to - _from);
    if (_cb) _cb(_t);
  }

  return {
    onUpdate,
    scrub,
    play,
    update,
    get t() { return _t; },
    get playing() { return _playing; },
  };
}
