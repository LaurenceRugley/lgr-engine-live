/* ============================================================
   math.js — Lesson 76: the engine's shared scalar-math helpers.
   ------------------------------------------------------------
   WHY THIS FILE EXISTS NOW: the camera rig (L07) and the day/night SunRig (L09) each
   carry a PRIVATE copy of the same frame-rate-independent ease — the "damp" helper. The
   pilot/possession arc (L76) adds a THIRD consumer: the movement integrators smooth their
   throttle/steer with the exact same maths (the "weighty, not twitchy" backbone). Three
   copies of one helper is the moment to lift it into a shared module the rig + models +
   future systems all import — one dt-correct ease, defined once.

   ── FRAME-RATE-INDEPENDENT DAMPING (the one idea here) ───────────────────────
   Raw easing toward a goal a fixed fraction per frame (`x += (goal-x)*0.1`) is WRONG: it
   runs more times per second on a 120 Hz monitor than a 60 Hz one, so the same "drag"
   converges at different speeds on different machines. The studio-standard fix makes the
   per-frame fraction depend on the real elapsed time `dt`:

        x += (goal - x) * (1 - exp(-rate * dt));     // dt-correct exponential approach

   This is the closed-form of exponential decay sampled at dt — take one big step or many
   small ones, you land in the same place after the same wall-clock time. `rate` is the
   speed (bigger = snappier); 1/rate ≈ seconds to close ~63% of the remaining gap.

   C++ anchor: a free function in a math header (`namespace lgr::math`) — a pure,
   stateless `inline float damp(...)`; every translation unit includes it and shares one
   definition instead of each .cpp re-deriving the same exponential.

   NOTE (reconciliation, Rule 7): `camera-rig.js` now imports `damp` from here (its old
   private copy baked the rate constant K=8 in; it keeps K by passing it as `rate`, so the
   rig's motion is BYTE-IDENTICAL). `sun-rig.js` still has its own copy (a different rate,
   EASE_K) — left untouched this lesson to keep the diff scoped to the pilot work; it's a
   candidate to route through here too (noted in the L76 handoff).
   ============================================================ */

/* exp-damp one scalar from `curr` toward `goal`, at `rate` (per second), over `dt` seconds.
   Returns the new current value. Stateless + pure — the caller owns the stored value. */
export const damp = (curr, goal, rate, dt) => curr + (goal - curr) * (1 - Math.exp(-rate * dt));

/* clamp a scalar into [lo, hi]. (Three.MathUtils.clamp exists, but the pure integrators in
   pilot.js take no THREE dependency — they're plain maths — so they use this.) */
export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* the SHORTEST signed angular delta from `a` to `b` (radians), wrapped into (-π, π]. Used by
   the chase camera: easing the orbit azimuth toward "behind the craft" must take the short
   way round, never unwind several turns (the same nearest-angle idea the rig uses to snap to
   45°). C++: fmod-based angle wrap. */
export const angleDelta = (a, b) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
