/* ============================================================
   @lgr/engine-core — the PUBLIC API of the LGR WebGL engine (Lesson 39, E2)
   ------------------------------------------------------------
   The engine extraction's final shape: the city/water/post stack, the day-night SunRig,
   weather, the pixel/toon style chain, the capture director and the viewer control-bar are
   a reusable workspace PACKAGE. Each project (`projects/city|office|hoard`) declares
   `"@lgr/engine-core": "*"` (npm's local-workspace specifier — pnpm/yarn write `workspace:*`) and
   imports from HERE — not from deep `../../core` paths.

   ONE THREE (the single-instance rule): the engine binds SunRig colours / weather scalars into
   shader uniforms BY REFERENCE, and uses `instanceof` in places. Two copies of three (e.g. a
   project resolving its own duplicate) would be two incompatible sets of classes → the by-ref
   coupling silently dies and `instanceof` fails. So this package RE-EXPORTS three, and every
   project imports `{ THREE }` from here — guaranteeing all app + engine code shares one module.

   C++ anchor: this barrel is the library's public header — it surfaces the API and hides the
   internal `src/` modules. A local-workspace dep (`*` in npm) is a symlinked sibling package (like
   `add_subdirectory` linking a sibling lib); one `three` = one ABI shared across every translation unit.
   ============================================================ */

// ONE three — projects import `{ THREE }` from the package, never a second copy.
export * as THREE from 'three';

// The engine + its building blocks.
export { createEngine } from './src/createEngine.js';
export { createCameraRig, CAM } from './src/camera-rig.js';
export { createCity, PROFILES, PROFILE_KEYS, LAYOUT, mulberry32 } from './src/citygen.js';
export { createSunRig } from './src/sun-rig.js';
export { createCityLife } from './src/agents.js';
export { createWaterLife } from './src/water-life.js';
export { createLandmarkFactory } from './src/landmarks.js';
export { createWeatherRig } from './src/weather-rig.js';
export { createCloudField } from './src/clouds.js';
export { createCelestials } from './src/celestials.js';
export { createCapture } from './src/capture.js';

// The viewer control-bar widget (tap bar + shareable-link command bus).
export { createViewerUI } from './src/viewer-ui.js';

// First-run coachmark/hints system (L42).
export { createHints } from './src/hints.js';

// L114 — createAppShell + readAppFlags: the ONE place per-page BOOT plumbing lives (loop brackets, pause-on-hidden,
// readiness flag, footer policy, hints/resize/capture wiring) so the three project pages can't drift it.
export { createAppShell, readAppFlags } from './src/app-shell.js';

// L109 — SceneSpec v1: one versioned scene document (validate/from-URL/to-URL/apply). The contract the embed SDK,
// poster generator, site-gen + prompt layer target; the seed of the site-builder cockpit (versioned, tolerant of
// unknown top-level sections).
export { validateSceneSpec, fromURLParams, toURLParams, applySceneSpec, SCENE_SPEC_VERSION } from './src/scene-spec.js';

// L-stress-2 — createProductStage: a self-contained studio-lit GLB inspector (own scene/camera/IBL/loader/orbit +
// variant swap), sharing the engine renderer with save/restore state isolation. Engine-first: the capability lives
// here (parameterized, never product-specific); office/hoard/showcase could all wire it. (This is the ONLY existing-
// engine-file edit the whole product-stage capability needed — the extensibility measure: a new file + this one line.)
export { createProductStage } from './src/product-stage.js';

// L104 P3 — owner-only Developer Mode sandbox (8 toggleable dev toys; client tiers untouched, gizmos off-by-default).
export { createDevMode } from './src/dev-mode.js';

// Sprite-sheet flip-book animator (L43); L61 v2 — luminance×tint variants + swappable-sheet seam.
export { createSpriteAnim, toLuminanceTexture, loadSpriteSheet } from './src/sprite-anim.js';

// L60 — the reusable "dive" SCENE TRANSITION (city↔office is the first consumer; generic A↔B).
export { createSceneTransition } from './src/scene-transition.js';

// L63 — the INSPECTION LENS: free-fly + click-to-follow any world object (followables registry).
export { createInspector } from './src/inspect.js';

// L73 — PLACE-ENTITIES: the world editor's "drop in life" pool (gull/boat/fish/cloud/wander-person).
export { createPlacedLife } from './src/placed-life.js';

// L74 — the WORLD-EDITOR tool dispatcher (createEditor): one reusable object owning the tool state + brush + routing.
export { createEditor } from './src/editor.js';

// L76 — POSSESSION: the PilotController + ground MovementModel (drive a placed craft, e.g. the all-terrain vehicle).
export { createPilotController, createGroundModel, createSpacecraftModel, ATV_PROFILE, CRAFT_PROFILE } from './src/pilot.js';

// L76 — shared scalar maths (the dt-correct `damp` ease, lifted out of camera-rig so rig + models share one).
export { damp, clamp, angleDelta } from './src/math.js';

// F02 lift — native-scroll → damped [0,1] progress, PUMPED from the host loop (NOT self-driven → cannot repro F07).
export { createScrollDirector } from './src/scroll-director.js';

// L78 — ENGINE HARDENING: honest profiling (p95/p99 + GPU-ms + leak gate) + adaptive quality (lock a smooth fps).
export { createEngineProfiler } from './src/profiler.js';
export { createQualityGovernor } from './src/quality-governor.js';

// L64 — PROCEDURAL TERRAIN: seeded heightfield + biome generator + flat-shaded chunked mesh.
// L69 — `rebuildTerrainChunks` for live sculpting (dirty-chunk update).
export { generateTerrain, buildTerrainMesh, rebuildTerrainChunks, BIOMES, TERRAIN_PRESETS, PRESET_KEYS } from './src/terrain.js';

// L65 — WORLD SCATTER: biome-keyed instanced trees/rocks/tufts on the terrain.
export { generateScatter, buildScatterGroup, createScatter } from './src/scatter.js';

// L68 — WORLD WATER: lake-basin detection (flood-fill) + reflective lake surfaces.
export { detectLakes, buildLakeGroup, createWorldLakes } from './src/world-water.js';

// L81 — LIVE WATER FLOW: a virtual-pipes shallow-water sim coupled to the sculptable terrain (From-Dust).
export { createWaterFlow } from './src/water-flow.js';

// L70 — SCULPT POLISH: re-project scatter onto the sculpted terrain (trees ride the new surface).
export { reprojectScatter } from './src/scatter.js';

// L72 — PAINT-SCATTER: the mutable, capacity-backed instance store's edit ops (add/erase props by brush).
export { scatterAdd, scatterErase } from './src/scatter.js';

// L71 — WORLD EDITOR: the object catalog (extensible registry of materials/scatter/entities).
export { createCatalog, seedWorldEditorCatalog } from './src/catalog.js';

// L66 — PREETHAM atmospheric sky (realistic-tier; ACES + bloom live in the post chain / createEngine).
export { createSkyAtmosphere } from './src/sky-atmosphere.js';

// Reusable interior toolkit (L48/L51) — contact shadows / fake-AO, a cinematic vignette, + a seated free-look.
export { makeContactShadow, makeVignette, createSeatedLook } from './src/interior.js';

// Flat-vector style: shared toggle/tint/weather singletons (bound by reference) + the helpers.
export {
  vectorOn, vectorTint, vectorShadow, weatherSnow, weatherCloud, weatherCloudOff,
  weatherSeason, fogCharm, vectorize, vectorizeTower, attachVectorUniforms, spliceVectorVertex,
  VEC_VERT_PARS, VEC_VERT_MAIN, VEC_FRAG_PARS,
} from './src/vector-style.js';

// PixelKit eras + palettes (used by the scene's style chain AND the pixelate tool).
export {
  ERA_PRESETS, ERA_ORDER, SCENE_ERA_ORDER, LGR_PALETTES, makePaletteTexture, medianCut,
} from './src/pixelkit/pixelkit.js';

// L-audio-sketch — the engine's one AudioContext owner + ambient-bed presets (no external assets).
export { createAudioBus } from './src/audio-bus.js';
export { createAmbientBed } from './src/ambient-bed.js';
// L-audio-full-layer-slice1 — positional audio field + helicopter rotor synth.
export { createPositionalField } from './src/positional-field.js';
export { createRotor } from './src/rotor.js';

// Raw shader strings a few app-level materials compose directly (the dive crossfade; the
// pixelate tool). Exporting them keeps projects from reaching into the package's src/shaders.
export { default as fullscreenVert } from './src/shaders/fullscreen.vert';
export { default as postDiveFrag } from './src/shaders/post-dive.frag';
export { default as postPixelkitFrag } from './src/shaders/post-pixelkit.frag';
