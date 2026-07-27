/* ============================================================
   hoard2 · src/core/config.js — THE PINNED CONFIG (lead-owned, set at scaffold).
   ------------------------------------------------------------
   The single authoritative source for every balance/timing knob the run's DONE criteria are
   asserted against. Per HOARD-CONTRACT.md the wave curve + day length + dilation + night axes are
   PINNED HERE at scaffold — NOT tunable by the graded party (owners READ these, never redefine
   them). All ratified owner defaults (prompt sign-off sheet, 2026-07-26) live here as constants so
   the probe trace and the game read ONE number.

   C++ anchor: this is the `constexpr` header every translation unit includes — compile-time
   constants, not runtime state. Nobody mutates it; the sim/world/player just read the fields.
   ============================================================ */

/* ---- SEED (determinism spine) ---- */
// Master seed → rng.fork(name) derives named sub-streams (see rng.js). ?seed= overrides for playtest;
// the harness pins its own seed for the determinism probe (same seed → identical traces, DONE #10).
export const DEFAULT_SEED = 1337;

/* ---- ARENA ---- */
// ~2–3× v1's play field (v1 forest arenaR ≈ city.extent-0.7 ≈ 12). PLAY_RADIUS is the survivable
// disc; ARENA_EXTENT is the world half-size the rim/visuals reserve. Play area is FLAT (ratified #8 —
// no groundAt micro-lesson); terrain height is reserved for the arena rim / backdrop only.
export const PLAY_RADIUS = 26;
export const ARENA_EXTENT = 34;
export const GROUND_Y = 0.3; // shared floor plane (matches v1's plinthTop so decals/eye-height math port)

/* ---- WAVES (endless, escalating — ratified #5) ---- */
// waveCount(n): monotonic ↑ so DONE #3's "wave N+1 spawn count > wave N" holds by construction.
// Reaches ≥40 spawns by wave 10 so the perf probe (DONE #9) can stand up ≥40 concurrent zombies.
export const WAVE = {
  base: 6, // wave 1 = base + step
  step: 4, // +4 spawns per wave  → wave 10 = 6 + 10*4 = 46 spawns
  count: (n) => WAVE.base + n * WAVE.step,
  buildLullSeconds: 18, // scavenge/fortify window between waves
  spawnBurst: 6, // zombies released per spawn tick (concurrency builds fast → ≥40 alive mid-wave)
  spawnIntervalS: 0.9,
};
export const MAXZ = 96; // live-zombie pool cap (≥40 concurrent + headroom); 1:1 with the rig horde
// SPAWN RING — zombies appear on a ring around the SURVIVOR (not world-centre) at this distance, so the
// approach time is short + CONSISTENT wherever you stand (playtest #2: centre-spawn at r≈27 left early
// waves empty for ~30s). Difficulty-neutral: same zombies, same speed — they just start closer. Runners
// close in ~6s, walkers ~14s. Kept ≥ a fair pop-in distance (never on top of you).
export const SPAWN_RING = 16;
export const SPAWN_JITTER = 3; // ± ring wobble so the ring doesn't read as a perfect circle
export const CORPSE_CAP = 48; // corpse pool cap (DONE #5: corpses persist ≥10s OR to pool cap)
export const CORPSE_TTL_S = 14; // ≥10s persistence floor before a corpse recycles

/* ---- ZOMBIE TYPES (≥3 visibly distinct — DONE #3) ---- */
// speed/hp/scale tuned off v1's ZTYPE ordering. Silhouette distinctness is the fx/world job; these
// are the sim axes. night* multipliers are applied on top of these by the night factor (below).
export const ZTYPE = {
  walker: { speed: 1.15, hp: 40, scale: 0.82, weight: 0.62, dmg: 8 }, // the slow tanky mass
  runner: { speed: 2.65, hp: 18, scale: 0.66, weight: 0.30, dmg: 6 }, // the fast fragile fear
  tank: { speed: 0.85, hp: 220, scale: 1.2, weight: 0.08, dmg: 22 }, // the big rare event
};

/* ---- NIGHT (harder AND measurable — ratified: speed ×1.4 AND count ×1.5 at full night) ---- */
// nightFactor nf ∈ [0,1] (0 = day, 1 = deep night) is produced by the world day/night wiring and read
// by the sim. Multipliers are LINEAR in nf so the probe can assert the exact value at a known phase.
export const NIGHT = {
  speedMulFull: 1.4, // v1 precedent (speed-only ×1.4)
  countMulFull: 1.5, // v2 adds count ×1.5 at full night
  speedMul: (nf) => 1 + (NIGHT.speedMulFull - 1) * nf,
  countMul: (nf) => 1 + (NIGHT.countMulFull - 1) * nf,
};

/* ---- DAY / NIGHT CYCLE (ratified: 8–10 min → a run crosses a full night) ---- */
export const DAY_LENGTH_S = 540; // 9 min real per full day→night→day cycle
// Phase t ∈ [0,1] over the cycle maps to sunRig.goTo(t). night = t in the dark arc; nightFactor is a
// smooth ramp across dusk→midnight→dawn so combat difficulty eases in, not a hard switch.
// startT is a READABLE mid-morning (sun well up) so the opening arena is legible; the cycle then
// descends through dusk (duskT) into night across DAY_LENGTH_S, so a run still crosses a full night.
export const SUN = { dawnT: 0.22, duskT: 0.72, startT: 0.42 };

/* ---- DIVE (iso ↔ first-person — ratified dilation ~0.5) ---- */
export const DIVE_TIMESCALE = 0.5; // world clock while dived; the walker moves at real dt (matrix stride)
export const EYE_Y = 1.42; // survivor eye height (head local × scale + GROUND_Y)

/* ---- SURVIVAL (health / hunger / stamina — thirst folded into hunger, ratified #4) ---- */
export const SURVIVE = {
  hpMax: 100,
  hungerMax: 100,
  hungerDrainPerS: 100 / (7 * 60), // empties in ~7 min of not eating
  starveHpPerS: 4, // starvation chips health once hunger hits 0
  staminaMax: 100,
  staminaRegenPerS: 18,
  meleeStaminaCost: 34, // melee is stamina-priced (new in v2)
  sprintStaminaPerS: 22,
};

/* ---- FORTIFICATION (both material sources must matter — DONE #4) ---- */
// A full barrier rebuild costs MORE than either single source yields in one wave, so wood AND scrap
// both matter. drops = scrap-ish from the dead; harvest = wood from forest + scrap from ruins.
export const BUILD = {
  barrierHpMax: 120,
  barrierCostWood: 30, // one barrier = 30 wood + 20 scrap → 50 total
  barrierCostScrap: 20,
  repairKitHp: 60,
  // per-wave yields (tuned so neither source alone funds a full rebuild — probe-asserted in DONE #4):
  woodPerWaveEstimate: 24, // forest harvest headroom in a wave
  scrapPerWaveEstimate: 16, // ruins + drops headroom in a wave
};

/* ---- INVENTORY (per v1 hoard.js:52-54,212 — 8-slot bag, bag pauses the sim) ---- */
export const BAG_SLOTS = 8;

/* ---- QUALITY (DONE #9: governor pinned level 0, DPR cap 2, p95 ≤ 16.7ms) ---- */
export const DPR_CAP = 2; // engine already caps; restated for the probe's expectation
export const PERF_BUDGET_MS = 16.7; // p95 ceiling at DPR 2, wave-10, ≥40 concurrent

/* ---- SCORE ---- */
export const SCORE = { perKill: 10, perWave: 100 };
