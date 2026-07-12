/* ============================================================
   @lgr/engine-core — HERO-ONLY LIB barrel (L-O)
   ------------------------------------------------------------
   The smallest entry for a SITE's above-the-fold hero: createEngineCore + the 4 scene packs +
   the director + their transitive deps ONLY. Vite tree-shakes everything the slim-core barrel
   exports that the hero never imports — editor, pilot, cockpit, terrain, scatter, world-water,
   catalog, audio, sprite-anim, tracer, inspector, placed-life, dev-mode, product-stage, scene/
   graph-spec, viewer-ui, hints, app-shell (~185 KB raw of hero-unused source per the audit).

   Single entry, no shared chunk (the J self-containment rule: a shared chunk breaks drop-in use).
   Pair with `createEngineCore({ lean: true })` for the minimal beauty-only RT footprint.
   ============================================================ */

export * as THREE from 'three';

export { createEngineCore, showWebGLUnsupported } from './src/createEngineCore.js';
export { createHeroDirector } from './src/hero/createHeroDirector.js';
export { createDuskSilk }      from './src/hero/createDuskSilk.js';
export { createConstellation } from './src/hero/createConstellation.js';
export { createAurora }        from './src/hero/createAurora.js';
export { createProductMoment } from './src/hero/createProductMoment.js';
export { createEdgeField }     from './src/createEdgeField.js';
// Keyframe injection helper (a client re-skin can validate its env set before boot).
export { validateSunKeyframes } from './src/sun-rig.js';
