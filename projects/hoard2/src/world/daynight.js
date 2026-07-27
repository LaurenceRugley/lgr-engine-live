/* ============================================================
   hoard2 · src/world/daynight.js — the canonical DAY/NIGHT curve (pure, engine-free).
   ------------------------------------------------------------
   DONE #8: a run crosses ≥1 full day→night→day cycle, and night is HARDER (sim reads nightFactor for the
   speed×1.4 / count×1.5 multipliers, config.NIGHT) AND playable. The night ramp is a SMOOTH ease, not a
   hard switch, so difficulty eases in — and it is the SINGLE source of truth read by both the sim
   (difficulty) and fx/world (torches, fog, sun placement). This module holds only the MATH so it is
   node-testable without THREE (the facade in index.js wires it to sunRig + the probe override).

   PHASE t ∈ [0,1) maps to sunRig.goTo(t): dawnT=sunrise, duskT=sunset, t=0/1=midnight, t≈0.5≈noon.
   nightFactor nf ∈ [0,1]: 0 across the day arc [dawnT,duskT]; smoothstep up after dusk to a plateau of 1
   through deep night; smoothstep back down before dawn. LINEAR-ish in the ramp so the probe can assert a
   known value at a known phase.

   C++ anchor: `float nightFactor(float t)` — a pure free function, unit-testable with no renderer.
   ============================================================ */

/** smoothstep — the classic Hermite ease. Clamped, so x outside [a,b] returns 0/1. */
export function smoothstep(a, b, x) {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Ease width (in phase units) for the dusk-in / dawn-out ramps. 0.12 of a 540s day ≈ 65s of gathering
// dark — long enough to feel gradual, short enough that a 9-min run spends real time at full night.
export const NIGHT_RAMP = 0.12;

/** nightFactorAt(t, sun) → nf ∈ [0,1]. Pure fn of phase t and the pinned SUN axes {dawnT,duskT}.
 *  Day arc → 0; ramps to a 1-plateau through deep night; back to 0 by dawn. Monotonic from noon→midnight. */
export function nightFactorAt(t, sun) {
  const { dawnT, duskT } = sun;
  if (t >= dawnT && t <= duskT) return 0;                                   // full daylight
  if (t > duskT) return smoothstep(duskT, Math.min(1, duskT + NIGHT_RAMP), t); // dusk → deep night
  return 1 - smoothstep(Math.max(0, dawnT - NIGHT_RAMP), dawnT, t);         // deep night → dawn
}

/** phaseAt(startT, elapsedS, dayLenS) → t ∈ [0,1). The world clock: start just after dawn and creep the
 *  sun forward one full cycle every dayLenS seconds. Wraps cleanly (double-mod guards negatives). */
export function phaseAt(startT, elapsedS, dayLenS) {
  const t = (startT + elapsedS / dayLenS) % 1;
  return (t + 1) % 1;
}

/** resolveNight(override, phase, sun) → the canonical nightFactor the facade returns. The probe's
 *  setNight(nf) sets `override` (a number in [0,1]); when non-null it WINS over the clock-driven value —
 *  driving BOTH sim difficulty and visuals for the harness night assertion + capture. null ⇒ the clock. */
export function resolveNight(override, phase, sun) {
  return override != null ? override : nightFactorAt(phase, sun);
}

/** phaseForNight(nf, sun) → a sun phase that VISUALLY matches a forced nightFactor, so a probe.setNight
 *  override also darkens the sky (not just the sim). nf≤0 ⇒ the daytime start phase; nf→1 ⇒ deep midnight. */
export function phaseForNight(nf, sun, startT) {
  if (nf <= 0) return startT;
  return sun.duskT + 0.02 + (0.995 - (sun.duskT + 0.02)) * Math.min(1, nf); // dusk-edge → ~midnight
}
