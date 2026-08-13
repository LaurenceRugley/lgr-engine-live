/* ============================================================
   hoard2 · src/sim/civilians.js — the civilian population, now a CONSUMER of the engine's agent sim.
   ------------------------------------------------------------
   A-CITIZENS (2026-08-12, mass-agents Phase 2): the SEIR civilian sim this file used to IMPLEMENT
   (A-OUTBREAK, 84c0667) was lifted VERBATIM into engine-core as `createAgentSim`
   (packages/engine-core/src/createAgentSim.js) so the A-SKYLINE city — and every future project —
   inherits it (CLAUDE.md engine-first §1). This adapter is what remains: it maps hoard2's config shape
   (config.CIVS + config.PLAY_RADIUS) onto the sim's params and hands through the same srng stream.

   NOT A FORK — the choice, surfaced: the S/E code path in createAgentSim is the hoard2 original,
   parameterised in name only, and every capability added for the city (in-pool 'i' chasers, the
   internal bite scan, `clampBlocked`) is gated on params/opts this adapter never sets. Same stream,
   same roll ORDER, same numbers — civilians.test.mjs (the determinism trace) and
   tools/hoard2-outbreak-probe.mjs pin that claim; they now test THROUGH this adapter.

   The BARREL is un-importable under node (it pulls shaders — see civilians.test.mjs's header), so the
   import is the corpse-pool route: a node-safe DEEP import, exposed in engine-core's exports map.

   API is unchanged: createCivilianPool(config, srng, { cap, sepCap, flee }) → the pool
   (populate/step/forceExpose/nearestS/reset/forEach/get/max/alive/sCount/eCount).
   ============================================================ */
import { createAgentSim } from '@lgr/engine-core/src/createAgentSim.js';

export function createCivilianPool(config, srng, opts = {}) {
  // playRadius: the rim clamp was config.PLAY_RADIUS read directly in the original step; it is now a
  // param of the lifted sim. Spread order matters not at all (CIVS carries no playRadius key).
  return createAgentSim({ ...config.CIVS, playRadius: config.PLAY_RADIUS }, srng, opts);
}
