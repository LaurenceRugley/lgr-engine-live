/* ============================================================
   @lgr/engine-core — LIB barrel (J3: code-panel/shiki excised)
   ------------------------------------------------------------
   Identical to index.js EXCEPT createCodePanel is omitted so
   dist-lib stops emitting 200+ shiki grammar chunks (13 MB detritus).
   createCodePanel is a BUILT-project feature (tracer lesson); it is
   NOT a lib feature — no-build static consumers never use it.
   The workspace projects still import from index.js (unchanged).
   ============================================================ */

export * as THREE from 'three';

export { createEngine } from './src/createEngine.js';
export { createEngineCore, showWebGLUnsupported } from './src/createEngineCore.js';
export { createCityWorld } from './src/createCityWorld.js';
export { createCameraRig, CAM } from './src/camera-rig.js';
export { createCity, PROFILES, PROFILE_KEYS, LAYOUT, mulberry32 } from './src/citygen.js';
export { createSunRig, validateSunKeyframes } from './src/sun-rig.js';
export { createCityLife, buildGraph } from './src/agents.js';
export { createStreetLights } from './src/street-lights.js';
export { createWaterLife } from './src/water-life.js';
export { createLandmarkFactory } from './src/landmarks.js';
export { createWeatherRig } from './src/weather-rig.js';
export { createCloudField } from './src/clouds.js';
export { createCelestials } from './src/celestials.js';
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
// createCodePanel OMITTED — its shiki dynamic import emits 200+ grammar chunks that lib consumers never load.
export { damp, clamp, angleDelta } from './src/math.js';
export { createScrollDirector } from './src/scroll-director.js';
export { createSmoothScroll } from './src/createSmoothScroll.js';
export { createHeroDirector } from './src/hero/createHeroDirector.js';
export { createHeroWipe }      from './src/hero/createHeroWipe.js';
export { createCameraDirector } from './src/hero/createCameraDirector.js';
export { createBuildIn }         from './src/hero/createBuildIn.js';
export { createShadowRig }       from './src/hero/createShadowRig.js';
export { createBeautyPresenter } from './src/hero/createBeautyPresenter.js';
export { createDuskSilk }     from './src/hero/createDuskSilk.js';
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
export { validateGraphSpec, indexNodes, KINDS, RELS, STATES, GRAPH_SPEC_VERSION, heatFromAgeDays, HEAT_TAU_DAYS, classifyMedia, hasMedia, DEEP_CHARS, ALGORITHM_KINDS, mediaGlyph, mediaGlyphCode, MEDIA_GLYPHS, classifyHealth, worstState, SLOW_MS } from './src/graph-spec.js';
export { createGraphLayout, DEFAULT_RINGS } from './src/graph-layout.js';
export { parseFrontmatter, extractLinks, extractMarkdownLinks, noteToRecords, buildGraphSpec, extractExcerpt } from './src/ingest-vault.js';
export { createGraphView, getKindColors } from './src/graph-view.js';
export { createGraphLabels } from './src/graph-labels.js';
export { createGraphAtmosphere } from './src/graph-atmosphere.js';
export { createGraphAmbient } from './src/graph-ambient.js';   // slice 15: ambient flybys (comet/ship)
export { createAmbientScheduler, lcg } from './src/graph-ambient-core.js';   // lcg: the house seeded RNG (slice 16: consumers author seeded content)
export { createGraphSim } from './src/graph-sim.js';
export { renderNoteHtml, scanFileRefs } from './src/render-markdown.js';
export { THEMES } from './src/diagram-theme.js';

// VIZ SLICE 20 — THE CURRICULUM SEAM: instrumented algorithms (shared by projects/tracer AND the atlas
// reader — the algorithm IS the teaching artifact, so it lives in the core), a general first-party CHART
// primitive (the cockpit's charting foundation; Big-O is only its first consumer), and a DOM step-panel
// render adapter for the atlas reader (the WebGL cell-field adapter stays in the tracer).
export { ALGORITHMS, bubbleSort, binarySearch, mergeSort, quickSort, heapSort, countOps, measureComplexity, raceAlgorithms, makeCaseInput, SORT_KINDS } from './src/algorithms.js';
export { createChart, chartLayout, niceTicks, logTicks, makeScale, seriesToPoints } from './src/chart.js';
export { createStepPanel } from './src/step-panel.js';

// VIZ SLICE 24 — SEMANTIC ZOOM: pure cluster/aggregate/zoom-policy math (the renderer only obeys it).
export {
  clusterBy, clusterIndex, clusterOfNode, clusterMembersOf, clusterCentroids, summaryLayout, aggregateEdges, summarySpec,
  zoomState, nearestCluster, visibleSet, ZOOM_DEFAULTS,
} from './src/graph-clusters.js';

// CURRICULUM T2 — DATA STRUCTURES: the tree ability (layout + panel) and the structures themselves.
// tree-layout is pure geometry (every T2 structure reuses it); data-structures instruments a BST through
// the SAME tracer/player the T1 sorts use (one step engine, three painters).
export { treeLayout, treeEdges, treeDepth } from './src/tree-layout.js';
export {
  bstInsert, bstFromKeys, bstContains, bstInOrder, bstSearchCost,
  heapIsValid, heapPush, heapPop, traceHeap, heapSortCost,
  traceBST, balancedKeys, degenerateKeys, measureBST, STRUCTURES,
} from './src/data-structures.js';
export { createTreePanel } from './src/tree-panel.js';
