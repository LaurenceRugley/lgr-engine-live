/* ============================================================
   hoard2 · src/world/profile.js — RE-EXPORT of the engine's world-profiles (A9 lift).
   ------------------------------------------------------------
   The DECREPIT / INTACT custom city profiles were born here and were LIFTED to @lgr/engine-core
   (packages/engine-core/src/world-profiles.js) for the A9 world-recipe interpreter — the same objects,
   moved, so createCity produces the byte-identical ruined settlement. This file stays as the stable import
   path for hoard2's runtime (world/index.js) AND its node tests (world.test.mjs + citygen-profile diff),
   re-exporting from the engine via the DEEP path (node-safe: world-profiles.js is pure, no barrel import).
   ============================================================ */
export { buildDecrepitProfile, buildIntactProfile, DECREPIT_TOWERS } from '../../../../packages/engine-core/src/world-profiles.js';
