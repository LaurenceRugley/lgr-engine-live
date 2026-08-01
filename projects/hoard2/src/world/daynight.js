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

/* ============================================================
   A6-1 THE SKY SHOW — weather across the day (the pure SCHEDULE; the engine rig owns the visuals).
   ------------------------------------------------------------
   The owner's word: the FP sky should be "packed with the weather". The engine's weatherRig is always built +
   updated (createCityWorld) but nobody ever changed its KIND, so it sat on 'clear' forever. This is the
   schedule hoard2 pushes at it: a pure fn phase→kind. setWeatherKind only sets the GOAL — the rig eases every
   output scalar (overcast/fog/cloud/rain) toward it, so the transitions are smooth by construction (no snap).

   WHY THESE WINDOWS: weather is confined to the DAY ARC and kept OFF two sensitive spots — (a) the dusk/dawn
   light crossing (so a weather onset never stacks on the cycle's own biggest brightness step → protects the
   real-clock smoothness gate), and (b) deep night is left CLEAR because the star field + constellations ARE
   the night show. Two eased spells per 9-min day (a midday rain, an afternoon haze) so the sky has visible
   moods without being metronomic.

   Determinism: pure fn of (phase, seed) — a seed-derived jitter shifts the windows a hair so different seeds
   feel different, but a given seed is byte-reproducible (the harness needs that). Weather is VISUAL ONLY:
   the sim's difficulty input is nightFactor (the sun clock), which this never touches — so the sim trace is
   unperturbed. C++ anchor: a pure `enum Weather kindAt(float phase, uint32 seed)` — no renderer, no globals.
   ============================================================ */

/** hash01(n) → a deterministic [0,1) from an int seed (a tiny xorshift-mul finalizer). Kept LOCAL so this
 *  module stays engine-free (no mulberry32 import); we only need one stable roll per seed for the jitter. */
function hash01(n) {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** weatherKindAt(phase, seed) → the weather GOAL kind at day-phase t. Returns one of
 *  'clear'|'rain'|'fog' (string literals matching the engine's WEATHER_KINDS; snow is left out — a grim
 *  rain+haze reads on-theme for the decrepit forest). Pure + node-testable. */
export function weatherKindAt(phase, seed = 1) {
  const j = (hash01(seed) - 0.5) * 0.03;                        // ±0.015 phase per-seed jitter (days vary)
  // WHY these exact edges: the run BOOTS at SUN.startT≈0.52 and the harness sweeps the cycle from there, so
  // the boot phase (and a margin around it) is left CLEAR — else weather eases in from frame 0 and reads as a
  // startup discontinuity. The morning-brightening step (~0.38) and the dusk crossing (0.72) are also avoided
  // so weather is never the cycle's biggest brightness jump (the slow ease keeps each ≤ the natural dusk step).
  if (phase >= 0.44 + j && phase < 0.50 + j) return 'fog';      // late-morning haze, clears before the ~0.52 boot phase
  if (phase >= 0.56 + j && phase < 0.64 + j) return 'rain';     // afternoon rain, starts after boot, clears before dusk
  return 'clear';                                               // boot (~0.52), dawn, the dusk crossing, deep night: clear
}

/** rainAmountAt(phase, seed) → a smooth 0..1 rain INTENSITY over the SAME afternoon-rain window weatherKindAt
 *  returns 'rain' for (edges kept in lock-step below). A sine hump (0 → 1 → 0) so rain-on-water ripples ease
 *  IN as the rain gathers and OUT as it clears, instead of snapping on. >0 exactly when weatherKindAt=='rain'.
 *  A16 LIFT#2 rain-on-water coupling; pure + node-testable. */
export function rainAmountAt(phase, seed = 1) {
  const j = (hash01(seed) - 0.5) * 0.03;
  const a = 0.56 + j, b = 0.64 + j;                            // MUST match weatherKindAt's rain window
  if (phase < a || phase >= b) return 0;
  return Math.sin(((phase - a) / (b - a)) * Math.PI);          // smooth ease-in/out, peaks mid-window
}
