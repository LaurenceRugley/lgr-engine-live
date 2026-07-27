/* ============================================================
   wipe-machine.js — pure progress/mode logic for createHeroWipe.
   ------------------------------------------------------------
   Extracted (exactly like hero-ring.js) so the state machine can be node:test'd
   WITHOUT a WebGL context or a real core. createHeroWipe.js imports it and wires the
   numbers to uniforms; NOTHING here touches THREE, the GPU, or the DOM.

   A "wipe" is a TIME behaviour: linear progress t runs 0 -> 1 over a duration, and the
   fragment shader turns that one scalar into the per-cell reveal (see hero-wipe.frag).
   So the only state this module owns is: which mode, how long, and how far through.

   C++ anchor: a tiny finite-state machine (idle <-> wiping) plus an enum of modes — the
   same shape a tween/animation controller uses; `advance(dtMs)` is its `tick`, returning a
   small POD result struct rather than mutating a caller's object.
   ============================================================ */

/* The wipe modes, as the ints the shader compares uMode against. Keep in sync with
   hero-wipe.frag's `if (uMode < 0.5)` ladder — this object IS the source of truth for the
   mapping, and resolveModeId() is the only place a name becomes a number. */
export const WIPE_MODES = Object.freeze({
  fade:      0,   // baseline: plain eased global crossfade (no cells, no direction)
  ash:       1,   // FM hash dissolve — cell-snapped squares crumbling, band-limited
  honeycomb: 2,   // hex AM size-ramp — hexagons tile, so they merge seamless (no crossover seam)
  halftone:  3,   // circle AM size-ramp — dots grow; overdraw past the cell closes corner gaps
});

/* resolveModeId(name) — name -> shader int. Unknown names FAIL LOUD (Rule 12): a silent
   fallback to fade would hide a typo'd mode as "it just faded", the worst kind of no-op. */
export function resolveModeId(name) {
  const id = WIPE_MODES[name];
  if (id === undefined) {
    throw new Error(`createHeroWipe: unknown mode ${JSON.stringify(name)} — expected one of ${Object.keys(WIPE_MODES).join(', ')}`);
  }
  return id;
}

/* easeInOut(t) — the smoothstep cubic, matching post-dive.frag's ease. Exposed so a test can
   pin the curve (symmetry, endpoints) and so the fade baseline reads identically in JS + GLSL. */
export function easeInOut(t) {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3.0 - 2.0 * c);
}

/* applyReducedMotion(opts, reduced) — WCAG 2.3.3: a motion-sensitive visitor must never get the
   geometric wipe (ash squares flying, hexes swelling). We degrade to a GENTLE 150 ms cross-fade —
   present but non-vestibular — rather than a hard cut (a cut can still read as a flash). Returns a
   NEW opts object; never mutates the caller's. When reduced is false, opts pass through unchanged. */
export function applyReducedMotion(opts, reduced) {
  if (!reduced) return opts;
  return { ...opts, mode: 'fade', duration: Math.min(150, opts.duration ?? 150) };
}

/* createWipeMachine() — the idle<->wiping state + linear progress.
   Returns:
     start(durationMs) — begin a wipe; t resets to 0. duration is clamped to >= 1 ms so a
                         zero/negative duration can't divide-by-zero (it finishes next tick).
     advance(dtMs)     — step progress by real elapsed ms; returns { t, active, justFinished }.
                         `justFinished` is true on the SINGLE tick that crosses 1.0 — the edge the
                         caller resolves the completion promise on (one-shot, never re-fires).
     finish()          — snap to done (t=1, idle) — for interrupting a wipe cleanly.
     get t / get active */
export function createWipeMachine() {
  let state = 'idle';   // 'idle' | 'wiping'
  let t = 0;
  let duration = 1;     // ms

  function start(durationMs) {
    duration = Math.max(1, durationMs);
    t = 0;
    state = 'wiping';
  }

  function advance(dtMs) {
    if (state !== 'wiping') return { t, active: false, justFinished: false };
    t += dtMs / duration;
    if (t >= 1) {
      t = 1;
      state = 'idle';
      return { t: 1, active: false, justFinished: true };
    }
    return { t, active: true, justFinished: false };
  }

  function finish() {
    const wasActive = state === 'wiping';
    t = 1;
    state = 'idle';
    return wasActive;
  }

  return {
    start, advance, finish,
    get t() { return t; },
    get active() { return state === 'wiping'; },
  };
}
