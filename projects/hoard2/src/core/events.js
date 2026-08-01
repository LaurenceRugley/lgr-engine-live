/* ============================================================
   hoard2 · src/core/events.js — THE EVENT BUS (the game's decoupled nervous system).
   ------------------------------------------------------------
   The second half of the coordination law: subsystems fire semantic events and listen for them
   without importing each other. The sim emits `zombie:death`; fx-audio and ui both listen and react
   (corpse pool, kill count) — neither knows the other exists. The VOCABULARY is fixed in
   HOARD-CONTRACT.md §Event vocabulary; adding an event means adding a row there in the SAME commit.

   No per-frame hot allocation (engine-invariants #7): emit() iterates the listener array in place and
   passes the caller's payload object straight through — it does NOT copy the payload or build a new
   array. Emitters that fire every frame MUST reuse a hoisted payload object (mutate its fields), never
   `emit('x', { … })` in the loop. One-shot events (death, breach, pickup) may allocate their payload.

   C++ anchor: a signal/slot bus — `std::vector<std::function>` per event id; emit just walks the
   vector. Unsubscribe returns a disposer (RAII-ish) so listeners can detach on teardown.
   ============================================================ */

// Frozen list of legal event names — emit()/on() of anything else throws (fail loud: a typo'd event
// name is a silently-dead wire otherwise). Mirrors HOARD-CONTRACT §Event vocabulary exactly.
export const EVENTS = new Set([
  'wave:start', 'wave:clear',
  'zombie:spawn', 'zombie:death',
  'player:damage', 'player:death',
  'weapon:fire', 'weapon:hit', 'weapon:reload',
  'melee:swing', 'melee:hit',
  'harvest:gain',
  'barrier:place', 'barrier:damage', 'barrier:breach', 'barrier:repair',
  'item:pickup', 'item:consume',
  'craft',
  'game:pause', 'game:resume',
  'dive:enter', 'dive:exit',
  'daynight:phase',
]);

export function createEventBus() {
  const map = new Map(); // name → Set<fn>

  function on(name, fn) {
    if (!EVENTS.has(name)) throw new Error(`[events] '${name}' is not in the vocabulary — add a row to HOARD-CONTRACT §Event vocabulary in the same commit.`);
    let set = map.get(name);
    if (!set) map.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn); // disposer
  }

  function emit(name, payload) {
    if (!EVENTS.has(name)) throw new Error(`[events] emit('${name}') — not in the vocabulary.`);
    const set = map.get(name);
    if (!set || set.size === 0) return;
    // Iterate a live Set; listeners that throw must not kill the frame for the others (fail loud but
    // isolated — one bad listener ≠ a stalled sim). We log and continue.
    for (const fn of set) {
      try { fn(payload); } catch (e) { console.error(`[events] listener for '${name}' threw:`, e); }
    }
  }

  return { on, emit, EVENTS };
}
