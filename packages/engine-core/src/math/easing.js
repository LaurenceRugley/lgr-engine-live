/* ============================================================
   easing.js — first-party easing curves. The house tween math, no libraries.
   ------------------------------------------------------------
   The LGR dependency-minimalism doctrine: we build our own curves rather than pull GSAP / tween.js.
   These are the SHARED home for eased motion — createCameraDirector's shot moves use them now, and
   createSmoothScroll (the Lenis rip-out) will share the same functions, so a scroll and a camera dolly
   read with one motion language.

   Every curve maps t in [0,1] -> [0,1], with f(0)=0 and f(1)=1, and is MONOTONIC (never backtracks) so
   an intermediate value is a real point on the path, not an overshoot. Inputs are clamped, so a caller
   that overshoots t (floating-point drift past 1) gets a clean endpoint, not a wild extrapolation.

   C++ anchor: a header of free functions `float ease(float)` — pure, branch-light, inlineable; the same
   shape a game engine's `Mathf` easing set has.
   ============================================================ */

const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);

/* linear — no easing. The honest baseline; also the right choice for a constant-rate sweep
   (e.g. a timelapse where the sun should advance at a steady pace, not accelerate). */
export function linear(t) { return clamp01(t); }

/* smoothstep — the classic 3t^2 - 2t^3 S-curve (== GLSL smoothstep on [0,1]). Gentle ease at both
   ends, zero velocity at the endpoints. Matches the shader-side ease used across the hero packs. */
export function smoothstep(t) { t = clamp01(t); return t * t * (3 - 2 * t); }

/* easeInOutCubic — a stronger S-curve than smoothstep (steeper middle, softer ends): the "object has
   weight" feel. Good default for camera moves — an orbit/dolly should accelerate in and settle out. */
export function easeInOutCubic(t) {
  t = clamp01(t);
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/* easeOutCubic — fast start, long settle. Reads as "arriving": momentum bleeding off. Good for a
   push-in that lunges then eases to rest. */
export function easeOutCubic(t) { t = clamp01(t); return 1 - Math.pow(1 - t, 3); }

/* easeInCubic — slow start, accelerating. Reads as "departing". */
export function easeInCubic(t) { t = clamp01(t); return t * t * t; }

/* easeInOutSine — the gentlest S-curve. Ideal for a breathing HOLD micro-drift where any visible
   acceleration would read as mechanical. */
export function easeInOutSine(t) { t = clamp01(t); return (1 - Math.cos(Math.PI * t)) / 2; }

/* By-name lookup — lets a data-driven shot spec pass `easing: 'easeInOutCubic'` as a string.
   Unknown names FAIL LOUD (Rule 12) rather than silently defaulting to linear. */
export const EASINGS = Object.freeze({
  linear, smoothstep, easeInOutCubic, easeOutCubic, easeInCubic, easeInOutSine,
});

export function resolveEasing(easing) {
  if (typeof easing === 'function') return easing;
  if (easing == null) return easeInOutCubic;   // house default
  const fn = EASINGS[easing];
  if (!fn) throw new Error(`easing: unknown curve ${JSON.stringify(easing)} — expected one of ${Object.keys(EASINGS).join(', ')} (or a function)`);
  return fn;
}
