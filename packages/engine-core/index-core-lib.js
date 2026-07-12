/* ============================================================
   @lgr/engine-core — SLIM CORE LIB barrel (J3)
   ------------------------------------------------------------
   Exports the renderer/post/rig/sun layer and general-purpose tools —
   everything a no-build consumer needs WITHOUT the city content pack.
   Omitted vs index-lib.js:
     - createEngine           (wraps createCityWorld — city dep)
     - createCityWorld        (city content)
     - createCity/citygen     (city generation)
     - createCityLife/agents  (city NPC system)
     - createStreetLights     (city night lights)
     - createWaterLife        (boat/gull water life)
     - createLandmarkFactory  (GLB building kit)
     - createWeatherRig       (city weather)
     - createCloudField       (city clouds)
     - createCelestials       (city moon/stars)
     - createCodePanel        (shiki dep — omitted from all lib entries)
   The workspace projects still import from index.js (full barrel, unchanged).
   ============================================================ */

export * as THREE from 'three';

export { createEngineCore, showWebGLUnsupported } from './src/createEngineCore.js';
export { createCameraRig, CAM } from './src/camera-rig.js';
export { createSunRig, validateSunKeyframes } from './src/sun-rig.js';
export { createCapture } from './src/capture.js';
export { createViewerUI } from './src/viewer-ui.js';
export { createHints } from './src/hints.js';
export { createAppShell, readAppFlags } from './src/app-shell.js';
export { THEME, applyThemeToRoot } from './src/diagram-theme.js';
export { createMorphTimeline, easeInOutCubic } from './src/math/morph-timeline.js';
export { createMatrixGrid } from './src/math/matrix-grid.js';
export { validateSceneSpec, fromURLParams, toURLParams, applySceneSpec, SCENE_SPEC_VERSION } from './src/scene-spec.js';
export { createProductStage } from './src/product-stage.js';
export { createDevMode } from './src/dev-mode.js';
export { createSpriteAnim, toLuminanceTexture, loadSpriteSheet } from './src/sprite-anim.js';
export { createSceneTransition } from './src/scene-transition.js';
export { createInspector } from './src/inspect.js';
export { createPlacedLife } from './src/placed-life.js';
export { createHiddenProp } from './src/hidden-prop.js';
export { pickStreetIntersection, createProximityLatch } from './src/hidden-prop-logic.js';
export { createEditor } from './src/editor.js';
export { createPilotController, createGroundModel, createSpacecraftModel, ATV_PROFILE, CRAFT_PROFILE } from './src/pilot.js';
export { createCockpit } from './src/cockpit.js';
export { createGyroLook, mapGyroToLook } from './src/gyro-look.js';
export { createTracer }                  from './src/tracer.js';
export { createTracePlayer }             from './src/trace-player.js';
export { createCellField, CELL_COLORS }  from './src/cell-field.js';
// createCodePanel OMITTED — shiki dep (200+ grammar chunks, 13 MB).
export { damp, clamp, angleDelta } from './src/math.js';
export { createScrollDirector } from './src/scroll-director.js';
export { createHeroDirector } from './src/hero/createHeroDirector.js';
export { createDuskSilk }     from './src/hero/createDuskSilk.js';
export { createConstellation } from './src/hero/createConstellation.js';
export { createAurora }        from './src/hero/createAurora.js';
export { createProductMoment } from './src/hero/createProductMoment.js';
export { createEdgeField }     from './src/createEdgeField.js';
export { createEngineProfiler } from './src/profiler.js';
export { createQualityGovernor } from './src/quality-governor.js';
export { generateTerrain, buildTerrainMesh, rebuildTerrainChunks, BIOMES, TERRAIN_PRESETS, PRESET_KEYS } from './src/terrain.js';
export { generateScatter, buildScatterGroup, createScatter } from './src/scatter.js';
export { detectLakes, buildLakeGroup, createWorldLakes } from './src/world-water.js';
export { createWaterFlow } from './src/water-flow.js';
export { reprojectScatter } from './src/scatter.js';
export { scatterAdd, scatterErase } from './src/scatter.js';
export { createCatalog, seedWorldEditorCatalog } from './src/catalog.js';
export { createSkyAtmosphere } from './src/sky-atmosphere.js';
export { makeContactShadow, makeVignette, createSeatedLook } from './src/interior.js';
export {
  vectorOn, vectorTint, vectorShadow, weatherSnow, weatherCloud, weatherCloudOff,
  weatherSeason, fogCharm, vectorize, vectorizeTower, attachVectorUniforms, spliceVectorVertex,
  VEC_VERT_PARS, VEC_VERT_MAIN, VEC_FRAG_PARS,
} from './src/vector-style.js';
export {
  ERA_PRESETS, ERA_ORDER, SCENE_ERA_ORDER, LGR_PALETTES, makePaletteTexture, medianCut,
} from './src/pixelkit/pixelkit.js';
export { createAudioBus } from './src/audio-bus.js';
export { createAmbientBed } from './src/ambient-bed.js';
export { createPositionalField } from './src/positional-field.js';
export { createRotor } from './src/rotor.js';
export { default as fullscreenVert } from './src/shaders/fullscreen.vert';
export { default as postDiveFrag } from './src/shaders/post-dive.frag';
export { default as postPixelkitFrag } from './src/shaders/post-pixelkit.frag';

// ============================================================
// MISSION CONTROL GRAPH (VIZ slices 3-13) — the full knowledge/live-ops graph stack.
// A consumer wires: validateGraphSpec → createGraphLayout → createGraphSim (optional physics) →
// createGraphView(core, spec, positions) + createGraphLabels + createGraphAtmosphere; content via
// buildGraphSpec/ingest + renderNoteHtml (escape-first markdown w/ [[wikilink]] navigation).
// createEdgeField is the UNIFIED edge seam (slice 14) — the hero Constellation and the graph share it.
// ============================================================
export { validateGraphSpec, indexNodes, KINDS, RELS, STATES, GRAPH_SPEC_VERSION, heatFromAgeDays, HEAT_TAU_DAYS } from './src/graph-spec.js';
export { createGraphLayout, DEFAULT_RINGS } from './src/graph-layout.js';
export { parseFrontmatter, extractLinks, extractMarkdownLinks, noteToRecords, buildGraphSpec, extractExcerpt } from './src/ingest-vault.js';
export { createGraphView, getKindColors } from './src/graph-view.js';
export { createGraphLabels } from './src/graph-labels.js';
export { createGraphAtmosphere } from './src/graph-atmosphere.js';
export { createGraphSim } from './src/graph-sim.js';
export { renderNoteHtml, scanFileRefs } from './src/render-markdown.js';
export { THEMES } from './src/diagram-theme.js';
