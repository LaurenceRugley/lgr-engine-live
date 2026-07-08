/* ============================================================
   LGR WebGL Lab — createEngine — thin flat-merge wrapper (the generality fix)
   ------------------------------------------------------------
   createEngine = createEngineCore + createCityWorld, flat-merged so all 4 projects
   (city / office / hoard / showcase-lab) work unchanged with zero API drift.

   History: through L-streetlamps / L-cockpit this was a 1855-line monolith. The
   createEngineCore extraction (2026-07-08) split it into:
     createEngineCore  — renderer + loop + post primitives (ZERO world content)
     createCityWorld   — all city content + render orchestration
     createEngine      — this file: a ~30-line composition root

   C++ anchor: this is the top-level factory that calls two sub-constructors and
   returns a merged "vtable" — the merged handle is exactly the prior public API.
   Object.defineProperties preserves live getters (mode/vector/paused/contextLost)
   that a plain { ...spread } would snapshot into stale values.
   ============================================================ */
import { createEngineCore, showWebGLUnsupported } from './createEngineCore.js';
import { createCityWorld } from './createCityWorld.js';

export { showWebGLUnsupported };

export function createEngine(opts = {}) {
  const core = createEngineCore(opts);
  const city = createCityWorld(core, opts);

  // Flat-merge: city properties win on conflict (there are none currently); live getters
  // (mode, vector, sceneEra, paused, contextLost) are preserved via descriptor copy.
  const engine = Object.create(null);
  Object.defineProperties(engine, {
    ...Object.getOwnPropertyDescriptors(core),
    ...Object.getOwnPropertyDescriptors(city),
  });
  return engine;
}
