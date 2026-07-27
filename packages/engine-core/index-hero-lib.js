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
export { createHeroWipe }      from './src/hero/createHeroWipe.js';
export { createCameraDirector } from './src/hero/createCameraDirector.js';
export { createBuildIn }         from './src/hero/createBuildIn.js';
export { createShadowRig }       from './src/hero/createShadowRig.js';
export { createBeautyPresenter } from './src/hero/createBeautyPresenter.js';
export { createDuskSilk }      from './src/hero/createDuskSilk.js';
export { createConstellation } from './src/hero/createConstellation.js';
export { createAurora }        from './src/hero/createAurora.js';
export { createProductMoment } from './src/hero/createProductMoment.js';
export { createObservatory }  from './src/hero/createObservatory.js';
export { createPixelMorph }   from './src/hero/createPixelMorph.js';
export { createMaterialStudy } from './src/hero/createMaterialStudy.js';
export { createLattice }       from './src/hero/createLattice.js';
export { createLiquidMetal }  from './src/hero/createLiquidMetal.js';
export { createLivingInk }    from './src/hero/createLivingInk.js';
export { createCaustics }     from './src/hero/createCaustics.js';
export { createLetterpress }  from './src/hero/createLetterpress.js';
export { createCathedralLight } from './src/hero/createCathedralLight.js';
export { createFirstLight }     from './src/hero/createFirstLight.js';
export { createEdgeField }     from './src/createEdgeField.js';
export { createBeforeAfter }  from './src/createBeforeAfter.js';
export { createLookReel }     from './src/createLookReel.js';
// Keyframe injection helper (a client re-skin can validate its env set before boot).
export { validateSunKeyframes } from './src/sun-rig.js';
