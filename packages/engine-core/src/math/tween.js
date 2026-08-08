/* ============================================================
   tween.js — Arc A-TWEEN: the fixed-duration eased tween (2D track gap ⑤).
   ------------------------------------------------------------
   A GENUINELY DIFFERENT CONTRACT FROM math.js's `damp()` — do not confuse the two, both exist on
   purpose:
     damp(curr, goal, rate, dt)   — continuous exponential ease TOWARD A LIVE, possibly-moving target.
                                     No fixed duration, no defined end, no completion event. The right
                                     tool for "the camera should always be easing toward wherever the
                                     player currently is."
     createTween({from,to,...})  — from → to, over a FIXED duration D, along a CHOSEN curve, then
                                     DONE (fires onComplete once). The right tool for "fade this in
                                     over 0.3s" or "this label rises and fades over 0.6s, then it's over."
   A tween built as "damp with a timeout" is the wrong primitive (DESIGN's brief, verbatim) — it
   never truly finishes (exponential decay only approaches the goal) and has no real completion event.

   REUSES THE EXISTING EASING CURVES (math/easing.js) — linear/smoothstep/easeIn·Out·InOutCubic/
   easeInOutSine, already homed here, already tested, already used by 4 real consumers
   (scroll-narrative.js, createSmoothScroll.js, hero/createBuildIn.js, hero/createCameraDirector.js).
   This module does not re-derive a curve set; `ease` accepts a function OR a name string exactly as
   `resolveEasing` already resolves it — one curve vocabulary for the whole engine.

   THE dt CONTRACT (docs/engine-invariants.md:59, `frame(dt, t)` is engine-supplied) — this module
   NEVER reads performance.now()/Date.now(). `step(dt)` takes the caller's own frame delta, exactly
   like damp/scroll-director/camera-rig. That is also WHY this is dt-independent by construction, not
   by careful accounting: `_value` is computed as a PURE FUNCTION of the ACCUMULATED elapsed time
   (`_elapsed`, a running sum of every dt ever passed to step()), never as an incremental step-to-step
   recurrence — so summing 1×0.5s or 5×0.1s produces the identical `_elapsed` and therefore the
   identical `_value`. Contrast with `damp()`, whose exponential recurrence is genuinely SEQUENCE-
   dependent (many small steps ≠ one big step, by design — that's what makes it frame-rate-independent
   AT A GIVEN dt granularity, not immune to how a duration decomposes into steps). Two different kinds
   of "frame-rate independent" for two different jobs.

   ZERO PER-FRAME ALLOCATION (invariant #7): `step()` mutates only the closure's own scalar locals —
   no `new`, no array, no object literal. A tween instance itself is allocated ONCE at creation (the
   same "set up once, mutate every frame" shape createParticles/createScrollDirector/createSpriteAnim
   already use) — invariant #7 governs the per-frame body, not one-time construction.

   DELAY is folded into the SAME accumulator, not a separate phase machine: `_elapsed` starts at
   `-delay`, so a single large dt that jumps past both the delay AND into the tween itself still lands
   on the exact right value — no double-bookkeeping, and it's why delay doesn't break dt-independence.
   ============================================================ */
import { resolveEasing } from './easing.js';

export function createTween({ from = 0, to = 1, duration = 1, ease, delay = 0, onComplete } = {}) {
  const easeFn = resolveEasing(ease);
  let _elapsed = -delay;   // negative = still in the delay window; `from` is held until it crosses 0
  let _value = from;
  let _playing = true;     // false once complete OR cancelled — step() becomes a cheap no-op either way
  let _done = false;       // true only on natural completion (NOT on cancel — a cancelled tween never "completes")

  function step(dt) {
    if (!_playing) return _value;
    _elapsed += dt;
    if (_elapsed < 0) return _value;              // still delayed — hold at `from`, no allocation, no work
    const t = duration > 0 ? Math.min(1, _elapsed / duration) : 1;   // resolveEasing's own curves clamp t<0 too; duration<=0 jumps straight to `to`
    _value = from + (to - from) * easeFn(t);
    if (_elapsed >= duration) {
      _playing = false; _done = true;
      if (onComplete) onComplete();
    }
    return _value;
  }

  // cancel() freezes `value` at whatever it currently is and suppresses onComplete — the tween never
  // reaches `done`, matching "cancel stops it" (the brief's own words), not "cancel fast-forwards it."
  function cancel() { _playing = false; }

  return {
    step,
    cancel,
    get value() { return _value; },
    get playing() { return _playing; },
    get done() { return _done; },
  };
}
