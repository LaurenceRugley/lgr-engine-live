/* ============================================================
   quality-governor.js — Lesson 78: adaptive quality — lock a smooth frame rate on the client's phone.
   ------------------------------------------------------------
   The profiler MEASURES; the governor ACTS. A client preview must not stutter on a prospect's random
   mid-range Android — but we don't know that device's GPU ahead of time. So instead of guessing, we
   close a FEEDBACK LOOP: watch the profiler's p95 frame time, and if it's over budget for a sustained
   stretch, step the rendering quality DOWN a fixed ladder until it fits; when there's headroom for a
   while, step back UP. The result is "lock ~30 fps on weak devices, full quality on strong" — automatically.

   ── THE CONTROL LOOP (a feedback controller with a deadband) ─────────────────
   measure (p95) → compare to the budget → actuate (step the ladder) — but with HYSTERESIS so it doesn't
   oscillate. Two thresholds (the same Schmitt-trigger idea as the L77 medium probe): step DOWN only when
   p95 is clearly OVER budget for N consecutive frames; step UP only when p95 is clearly UNDER a lower
   "headroom" threshold for M consecutive frames. The gap between them is a deadband that kills flapping.

   ── THE LADDER (cheapest-visual-cost-first; LEVEL 0 = full = a NO-OP) ─────────
   Level 0 is the engine exactly as it boots (so at full headroom the render is BYTE-IDENTICAL — the
   governor never touches anything at level 0). Each step down trades a bit of fidelity for fill-rate /
   draw cost, dpr first (the biggest, safest lever — dpr is a supersample factor, so 2→1 is 4×→1× the
   pixels shaded). The engine supplies the actual knobs via `apply(level)`; this module owns only the
   POLICY (when to move). v1 ladder: dpr 2 → 1.5 → 1 → 0.75, then shadows off at the deepest rung. The
   rungs are data — pt.2 can splice in bloom-off / post-simplify / scatter-density without touching the loop.

   C++ anchor: a PID-lite controller — error = p95 − setpoint; the actuator is a discrete gear (the
   ladder index) rather than a continuous signal; the deadband prevents gear-hunting.
   ============================================================ */

/* The ladder. Each level is a target the engine's `apply(level, rung)` realizes. Level 0 = untouched.
   `dpr` is a CAP (min'd with the device dpr by the engine); `shadows:false` suppresses the shadow pass. */
const LADDER = [
  { dpr: null, shadows: true },     // 0 — full (no-op; byte-identical)
  { dpr: 1.5,  shadows: true },     // 1
  { dpr: 1.0,  shadows: true },     // 2
  { dpr: 1.0,  shadows: false },    // 3 — drop the shadow re-render too
  { dpr: 0.75, shadows: false },    // 4 — last resort for very weak GPUs
];

export function createQualityGovernor({ profiler, apply, targetFps = 30, strongFps = 58 } = {}) {
  // budget = the frame-time we must stay UNDER (p95). Over this → too slow → step down.
  const DOWN_MS = 1000 / targetFps;          // e.g. 33.3 ms (30 fps) — the floor we defend
  const UP_MS = 1000 / strongFps;            // e.g. 17.2 ms — comfortably fast → headroom to restore quality
  const N_DOWN = 45;                         // frames over budget before stepping down (~0.75 s — ignore one-off hitches)
  const N_UP = 180;                          // frames of headroom before stepping up (~3 s — restore cautiously)
  // L110 (audit B12): a COOLDOWN of one full ring after any step. p95 is a percentile over the profiler's 120-frame
  // ring; N_DOWN (45) < RING (120), so the frames that triggered a down-step STAY in the p95 window and re-trigger the
  // next step ~45 frames later — one load spike cascades 2–3 rungs down. Freezing judgement for RING frames lets the
  // ring flush the stale samples so we re-evaluate on POST-step timings (did the step actually fix it?) before moving again.
  const COOLDOWN = 120;                      // = profiler RING (see profiler.js)

  let level = 0, overFrames = 0, underFrames = 0, reason = 'full', cooldown = 0;

  function update() {
    const p95 = profiler.p95Now();
    if (p95 <= 0) return level;              // no data yet
    if (cooldown > 0) { cooldown--; overFrames = 0; underFrames = 0; return level; }   // post-step: let the ring flush before judging again
    if (p95 > DOWN_MS) {
      overFrames++; underFrames = 0;
      if (overFrames >= N_DOWN && level < LADDER.length - 1) { level++; overFrames = 0; cooldown = COOLDOWN; reason = `p95 ${p95.toFixed(1)}ms > ${DOWN_MS.toFixed(0)}ms`; apply(level, LADDER[level]); publish(p95); }
    } else if (p95 < UP_MS) {
      underFrames++; overFrames = 0;
      if (underFrames >= N_UP && level > 0) { level--; underFrames = 0; cooldown = COOLDOWN; reason = `p95 ${p95.toFixed(1)}ms < ${UP_MS.toFixed(0)}ms (headroom)`; apply(level, LADDER[level]); publish(p95); }
    } else { overFrames = Math.max(0, overFrames - 1); underFrames = Math.max(0, underFrames - 1); }   // in the deadband → decay both
    return level;
  }

  function publish(p95) { if (typeof window !== 'undefined') window.__quality = { level, of: LADDER.length - 1, reason, p95: +(p95 || 0).toFixed(1) }; }
  publish(0);

  return {
    update,
    get level() { return level; },
    get reason() { return reason; },
    reset() { level = 0; overFrames = underFrames = 0; cooldown = 0; reason = 'full'; apply(0, LADDER[0]); publish(0); },
  };
}
