/* ============================================================
   hoard2 · src/world/scatter.js — RE-EXPORT of the engine's world-scatter (A9 lift).
   ------------------------------------------------------------
   These deterministic play-ring generators (scatterRuins / scatterProps / deriveHarvest) were born here
   and were LIFTED to @lgr/engine-core (packages/engine-core/src/world-scatter.js) for the A9 world-recipe
   interpreter — the same code, moved, so the sim trace is byte-identical. This file stays as the stable
   import path for hoard2's runtime (world/index.js) AND its node tests (world.test.mjs), re-exporting from
   the engine via the DEEP path (node-safe: world-scatter.js is pure, no barrel / no .frag re-exports — the
   same pattern world.test.mjs uses to deep-import citygen.js). placeCoverBuildings joined them in the lift.
   ============================================================ */
export { scatterRuins, scatterProps, deriveHarvest, placeCoverBuildings } from '../../../../packages/engine-core/src/world-scatter.js';
