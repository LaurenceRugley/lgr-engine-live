/* ============================================================
   @lgr/engine-core — hero-body-pose (ARC A-BODY, 2026-08-13): the PURE math behind a player's body.
   ------------------------------------------------------------
   Split out of createHeroBody.js for the same reason character-anim.js is split out of
   createCharacterRig.js: this is decision logic over plain numbers, so it can be node-tested without a
   GPU, a GLB or a browser. The module that owns bones owns bones; this owns the WHY.

   TWO QUESTIONS, TWO FUNCTIONS:

     • gaitBlend(hs, walkSpeed, sprintSpeed) — "how fast does the body LOOK like it is going", as the
       0..1 scalar createCharacterRig's locomotion blend consumes. THE NON-OBVIOUS PART, and the reason
       this is a function rather than a division: that blend is PIECEWISE at 0.5. Reading the rig's own
       weight split (createCharacterRig.js `_applyLayers`):
             s < 0.5 → idle = 1-2s, walk = 2s          s >= 0.5 → walk = 2-2s, run = 2s-1
       so s = 0.5 is the ONLY value that plays the walk clip at full weight and nothing else. A naive
       `hs / sprintSpeed` therefore mis-reads every walk: swing-lab walks at 0.55 u/s and sprints at
       0.95, so the naive scalar hands 0.58 to the blend and the character walks with 16% of a RUN
       mixed in — feet at one cadence, body at another, which is exactly the "floaty" read a placeholder
       capsule can never show you. This maps walkSpeed onto 0.5 EXACTLY and sprintSpeed onto 1.0, so
       each named gait gets its own clip cleanly and everything between is an honest interpolation.

     • heroPose(s, riseEps) — which BODY MODE the controller is in this frame, as one interned string.
       Priority is not alphabetical, it is exclusivity: a roped body is swinging even though it is also
       airborne; a clinging body is not falling even though gravity is off. The order below mirrors
       character.js's own branch order (rope owns the frame → cling owns the frame → free), so the body
       can never disagree with the physics about which mode it is in.

   ZERO ALLOCATION. Both return primitives, and every string returned is a module-level literal (the
   engine's no-hot-alloc invariant — these run once per frame forever).

   C++ anchor: two pure free functions over floats/enums — `float gait_blend(float,float,float)` and a
   `HeroPose classify(const State&)` returning an enum. No state, no ownership, unit-testable alone.
   ============================================================ */

// The body MODES. Not the same list as the rig's clip states: `ground` covers idle/walk/sprint (one
// continuous blend, not three states), while jump/fall/swing/cling are held poses.
export const HERO_POSES = ['ground', 'jump', 'fall', 'swing', 'cling'];

/* Map a horizontal world speed onto the locomotion blend's 0..1 scalar, PIECEWISE so that
     hs = 0           → 0    (pure idle)
     hs = walkSpeed   → 0.5  (pure walk — the blend's only clean walk point)
     hs = sprintSpeed → 1    (pure run)
   Clamped at both ends: a body faster than sprintSpeed does not get a >1 scalar (the rig clamps too,
   but a caller reading this number for a HUD should see the truth). */
export function gaitBlend(hs, walkSpeed, sprintSpeed) {
  if (!(hs > 0)) return 0;
  const w = walkSpeed > 1e-6 ? walkSpeed : 1e-6;
  if (hs <= w) return 0.5 * (hs / w);
  const r = sprintSpeed > w ? sprintSpeed : w * 2;   // guard a mis-configured pair (sprint <= walk)
  const t = (hs - w) / (r - w);
  return t >= 1 ? 1 : 0.5 + 0.5 * t;
}

/* A human-readable name for a gait scalar — for a HUD line or a probe receipt, never for the blend
   itself (the blend is continuous; this is a label on it). The thresholds are the blend's own
   boundaries, so the word and the pose can never disagree. */
export function gaitName(g) {
  if (g < 0.04) return 'idle';
  if (g < 0.72) return 'walk';
  return 'sprint';
}

/* Which body mode the controller state is in. `s` is a createCharacterController state (or anything
   carrying the same four booleans + vy). `riseEps` is the vertical speed above which an airborne body
   counts as still RISING — a small band rather than `vy > 0` so the single frame at the apex, where vy
   passes through zero, does not flicker jump→fall→jump. */
export function heroPose(s, riseEps = 0.05) {
  if (!s) return 'ground';
  if (s.swinging || s.anchor) return 'swing';   // a rope owns the frame (character.js branch 2a)
  if (s.clinging) return 'cling';               // a wall owns the frame (branch 2b-i)
  if (s.grounded) return 'ground';
  return s.vy > riseEps ? 'jump' : 'fall';
}
