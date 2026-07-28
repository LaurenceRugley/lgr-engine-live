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
