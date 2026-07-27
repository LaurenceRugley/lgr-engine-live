/* ============================================================
   hoard2 · src/core/registry.js — THE ctx REGISTRY (the ONLY cross-subsystem seam).
   ------------------------------------------------------------
   Per HOARD-CONTRACT.md the ctx registry is the one mechanism subsystems use to reach each other:
   an owner `register(name, facade)`s its public surface, another `get(name)`s it. Cross-directory
   imports are forbidden (only src/core/ and @lgr/engine-core may be imported across owners), so this
   indirection IS the decoupling — the sim never imports the world's file, it asks the registry for
   `world` and calls `world.groundAt(x,z)`.

   Fail loud (Rule 12): get() of an unregistered name throws — a missing wire is a boot-time crash,
   not a silent undefined that corrupts a frame 200ms later. Double-register throws too (two owners
   fighting over one name is a coordination bug to surface, not average).

   C++ anchor: a tiny service locator — a `std::map<string, void*>` of interface pointers, except
   the missing-key and duplicate-key cases assert instead of returning garbage.

   PINNED FACADE CONTRACT (owners must expose at least these; see HOARD-CONTRACT §ctx registry):
     sim   : { queryTargets(segment), state (read-only), update(dt,t,ctx) }
     player: { update(dt,t,ctx), … }
     build : { castBarriers(segment), update(dt,t,ctx), … }
     world : { groundAt(x,z), nightFactor(), update(dt,t,ctx), … }
     fx    : { update(dt,t,ctx), … }
     ui    : { update(dt,t,ctx), … }
   `rng` and `time` are registered by core itself at scaffold.
   ============================================================ */
export function createRegistry() {
  const facades = new Map();

  function register(name, facade) {
    if (facades.has(name)) {
      throw new Error(`[ctx] '${name}' already registered — two owners are fighting over one seam (coordination bug).`);
    }
    if (!name || typeof name !== 'string') throw new Error('[ctx] register() needs a string name');
    if (facade == null) throw new Error(`[ctx] register('${name}') got a null facade`);
    facades.set(name, facade);
    return facade;
  }

  function get(name) {
    const f = facades.get(name);
    if (f === undefined) {
      throw new Error(`[ctx] '${name}' not registered — missing wire. Registered: [${[...facades.keys()].join(', ')}]`);
    }
    return f;
  }

  // has() — a soft probe for OPTIONAL wiring (e.g. fx present only if the float RT exists). Prefer
  // get() everywhere a subsystem is REQUIRED so a missing wire fails loud.
  const has = (name) => facades.has(name);

  return { register, get, has, _names: () => [...facades.keys()] };
}
