/* ============================================================
   @lgr/engine-core — character-layers (Beauty B3): the PURE math for procedural motion layers.
   ------------------------------------------------------------
   Split from createCharacterRig so it is node-testable without THREE (bones/quaternions need a GPU-ish
   context). These are the tiny scalar functions the rig applies additively ON TOP of the baked clips —
   the difference between a clip-PLAYER and a motion SYSTEM. The rig owns the bone glue; this owns the WHY.

     • flinchEnvelope(u)   — a hit-reaction impulse over normalised time u∈[0,1]: sharp attack, slow decay,
                             zero at both ends. It is what makes a struck body recoil then settle.
     • headYawDelta(...)   — how far a head should TURN to look at a target: the signed yaw from the
                             character's facing to the target, wrapped to [-π,π] and CLAMPED to a cone (a
                             walker cranes toward you but can't spin its head all the way around).

   C++ anchor: pure free functions over floats — no state, no allocation; unit-testable in isolation, then
   fed into the bone matrices by the rig (like a shader's helper funcs vs the draw call).
   ============================================================ */

// wrap an angle to [-π, π] so a yaw difference is the SHORT way round (never a 350° head-turn).
export function wrapPi(a) {
  const TWO_PI = Math.PI * 2;
  a = a % TWO_PI;
  if (a > Math.PI) a -= TWO_PI;
  else if (a < -Math.PI) a += TWO_PI;
  return a;
}

// Hit-reaction impulse: 0 at u≤0, a sharp attack to ~1 near u≈attack, then a smooth decay to 0 at u≥1.
// `attack` is the fraction of the window spent rising (default 0.14 → a fast snap, slow release).
export function flinchEnvelope(u, attack = 0.14) {
  if (u <= 0 || u >= 1) return 0;
  if (u < attack) { const a = u / attack; return a * a * (3 - 2 * a); }        // smoothstep up
  const d = (u - attack) / (1 - attack);                                       // 0→1 across the decay
  const s = 1 - (d * d * (3 - 2 * d));                                          // smoothstep down
  return s;
}

// A5 — MELEE-SWING impulse over normalised time u∈[0,1]. Returns a SIGNED factor (~[-0.32, 1]) that reads
// as a real strike in three beats instead of one symmetric pose: a short WIND-UP that cocks the arm back
// (anticipation → negative), a fast IMPACT that whips forward through the +1 peak, then a slower RECOVERY
// that eases back to rest (the "settle"). `windup` = fraction spent cocking; `strike` = u of the peak.
// C++ anchor: a hand-authored ease curve — the animator's anticipation/action/follow-through as a function.
export function swingEnvelope(u, windup = 0.24, strike = 0.5) {
  if (u <= 0 || u >= 1) return 0;
  const back = 0.32;                                                         // how far the arm cocks back
  const ss = (a) => a * a * (3 - 2 * a);                                     // smoothstep
  if (u < windup) return -back * ss(u / windup);                            // ease back to -back (wind-up)
  if (u < strike) return -back + (1 + back) * ss((u - windup) / (strike - windup)); // whip -back → +1 (impact)
  return 1 - ss((u - strike) / (1 - strike));                               // +1 → 0 (recovery / settle)
}

// A8-3 — RELOAD DIP envelope over normalised time u∈[0,1]. Returns 0..1 = how far the gun is LOWERED from
// ready: a quick drop as the weapon comes off aim, a HOLD at the bottom (the hands work the magazine), then
// a raise back to ready. Three beats read as a real reload, not a single pose — the "dip" the owner wants
// between fire and ready. `down`/`up` are the fractions spent dropping / raising (the middle is the hold).
// C++ anchor: a trapezoidal envelope — ramp up, plateau, ramp down — the classic ADSR "sustain" shape.
export function dipEnvelope(u, down = 0.22, up = 0.28) {
  if (u <= 0 || u >= 1) return 0;
  const ss = (a) => a * a * (3 - 2 * a);                 // smoothstep
  if (u < down) return ss(u / down);                     // drop off aim → 1 (fully lowered)
  if (u > 1 - up) return ss((1 - u) / up);               // raise back to ready → 0
  return 1;                                              // HOLD at the bottom (working the mag)
}

// Signed head-turn (radians) to look at a target: from the character's facing `charYaw` toward the world
// direction (dx,dz), wrapped short and clamped to ±cone. Facing convention matches the game (yaw 0 = +z:
// forward = (sin yaw, cos yaw)), so the target bearing is atan2(dx, dz). Returns 0 when the target is
// dead ahead; ±cone when it is at or beyond the cone edge (the head holds at its limit, never over-rotates).
export function headYawDelta(charYaw, dx, dz, cone) {
  if (dx === 0 && dz === 0) return 0;
  const bearing = Math.atan2(dx, dz);
  const delta = wrapPi(bearing - charYaw);
  return delta < -cone ? -cone : delta > cone ? cone : delta;
}
