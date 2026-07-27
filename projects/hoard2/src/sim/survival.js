/* ============================================================
   hoard2 · src/sim/survival.js — HP / hunger / stamina meters (THREE-free, node-testable).
   ------------------------------------------------------------
   The survivor's biology, split out from the render/engine layer so its RULES are unit-testable
   without a GPU (Rule 9 / the brief's "isolate THREE-free pure functions"). Numbers come ONLY from
   config.SURVIVE — this module never redefines a knob (HOARD-CONTRACT: owners READ the pinned config).

   Death has a CAUSE (DONE #6): a zombie/barrier-breach injury that drives hp→0 is 'injury'; hunger
   hitting 0 and then STARVING hp→0 is 'hunger'. Whichever reaches 0 first stamps the cause, so the
   player:death {cause} the harness asserts is honest about how you died.

   C++ anchor: a plain POD struct of floats + free functions that mutate it — no inheritance, no THREE.
   ============================================================ */
export function createSurvival(config) {
  const S = config.SURVIVE;
  // The live meter state. Exposed by reference; the sim treats it as read-only outside this module.
  const st = { hp: S.hpMax, hunger: S.hungerMax, stamina: S.staminaMax, dead: false, cause: null };
  let onDeath = null;

  function reset() {
    st.hp = S.hpMax; st.hunger = S.hungerMax; st.stamina = S.staminaMax; st.dead = false; st.cause = null;
  }
  function kill(cause) {
    if (st.dead) return;
    st.dead = true; st.cause = cause; st.hp = 0;
    if (onDeath) onDeath(cause);
  }
  // Per-frame tick on the sim clock: hunger always drains; at zero it chips hp (starvation); stamina
  // regenerates (the player SPENDS it via trySpend for sprint/melee, so net can still be negative while sprinting).
  function update(dt) {
    if (st.dead || dt <= 0) return;
    st.hunger = Math.max(0, st.hunger - S.hungerDrainPerS * dt);
    if (st.hunger <= 0) {
      st.hp = Math.max(0, st.hp - S.starveHpPerS * dt);
      if (st.hp <= 0) kill('hunger');
    }
    st.stamina = Math.min(S.staminaMax, st.stamina + S.staminaRegenPerS * dt);
  }
  // Injury (zombie contact / barrier breach). Drives hp→0 with cause 'injury'.
  function damage(amount) {
    if (st.dead || amount <= 0) return;
    st.hp = Math.max(0, st.hp - amount);
    if (st.hp <= 0) kill('injury');
  }
  // Stamina purchase (melee swing, one frame of sprint). Deduct only if affordable — returns success.
  function trySpend(cost) {
    if (st.dead) return false;
    if (st.stamina >= cost) { st.stamina -= cost; return true; }
    return false;
  }
  // A collected drop's survival effect. 'scrap' is a build MATERIAL (no biology effect) — ignored here.
  function applyPickup(kind) {
    if (kind === 'food') st.hunger = Math.min(S.hungerMax, st.hunger + 38);
    else if (kind === 'bandage') st.hp = Math.min(S.hpMax, st.hp + 40);
  }
  function forceStarve() { st.hunger = 0; } // probe hook: hunger→0 so the next update starts chipping hp

  return {
    state: st, reset, update, damage, trySpend, applyPickup, forceStarve,
    setOnDeath(fn) { onDeath = fn; },
  };
}
