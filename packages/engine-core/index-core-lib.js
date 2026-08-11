/* ============================================================
   @lgr/engine-core — SLIM CORE LIB barrel (J3)
   ------------------------------------------------------------
   Exports the renderer/post/rig/sun layer and general-purpose tools —
   everything a no-build consumer needs WITHOUT the city content pack.

   Omitted vs index.js: 5 categories (city / hoard / 2D-UI / scroll-narrative / shiki), 78 names as of
   2026-08-02. The exhaustive, CHECKED list lives in `tools/barrel-coverage.test.mjs`'s `CORE_OMISSIONS`
   constant, not here — a prose list in this comment previously claimed only ~11 categories/~16 names
   and rotted silently as index.js grew (adversarial guard audit, 2026-08-02: real count was 78). A test
   now asserts that list is complete (every real omission named) and non-stale (every named one still
   actually omitted), so this comment can't drift from reality unnoticed again.
   The workspace projects still import from index.js (full barrel, unchanged).
   ============================================================ */

export * as THREE from 'three';

export { createEngineCore, showWebGLUnsupported } from './src/createEngineCore.js';
export { createCameraRig, CAM, cameraNearRadius } from './src/camera-rig.js';
export { measureBounds, autoFrame } from './src/asset-viewer.js';   // Arc A-VIEW: bbox auto-framing
export { createSunRig, validateSunKeyframes, lowSunWashK } from './src/sun-rig.js';
export { createCapture } from './src/capture.js';
// CLIENT-CRITICAL (audit 2026-07-30): client sites consume THIS core micro-barrel via the no-build fx/ path,
// so the field debug overlay + the recorder MUST be reachable here — they were in index.js only (barrel bug,
// 4th/5th instance). field-debug-doctrine.md promises client sites diagnose "the same one-tap way".
export { createDebugOverlay } from './src/debug-overlay.js';
export { VIDEO_TYPES, createRecorder, pickVideoType, recorderExt } from './src/createRecorder.js';
export { createViewerUI } from './src/viewer-ui.js';
export { createHints } from './src/hints.js';
export { createTouchControls } from './src/touch-controls.js';   // 2026-08-06: the floating thumbstick + look-drag — touch input was built 5x in projects and never in core
export { resolveAimPoint, createAimReticle, createPointerLockAim, applyLook } from './src/aim.js';   // 2026-08-08 A-AIM: what is under the crosshair, the crosshair itself, and pointer-lock
export { createTargetLock, createLockMarker, projectToScreen } from './src/aim.js';                  // 2026-08-09 A-LOCK: pick a point, keep it, SEE it (left-click lock / right-click web)
// createPedestrians is OMITTED here (CORE_OMISSIONS.city): it imports citygen + ships a city-content
// asset — a no-city renderer consumer must not pay for it. index.js/index-lib.js carry it.
export { createAppShell, readAppFlags } from './src/app-shell.js';
export { THEME, applyThemeToRoot } from './src/diagram-theme.js';
export { createMorphTimeline, easeInOutCubic } from './src/math/morph-timeline.js';
export { createMatrixGrid } from './src/math/matrix-grid.js';
export { createTween } from './src/math/tween.js';   // Arc A-TWEEN: fixed-duration eased tween (gap 5)
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
export { createPilotController, createGroundModel, createSpacecraftModel, createRoadModel, createBoatModel, createBirdModel, createFishModel, createGrappleModel, carryMomentum, ATV_PROFILE, CRAFT_PROFILE, ROAD_PROFILE, BOAT_PROFILE, BIRD_PROFILE, FISH_PROFILE, GRAPPLE_PROFILE } from './src/pilot.js';   // A-FEEL: createRoadModel = a car that corners on a street grid (curvature-limited steering, R grows with v squared)
export { createCockpit } from './src/cockpit.js';
export { createGyroLook, mapGyroToLook } from './src/gyro-look.js';
export { createTracer }                  from './src/tracer.js';
export { createTracePlayer }             from './src/trace-player.js';
export { createCellField, CELL_COLORS }  from './src/cell-field.js';
// createCodePanel OMITTED — shiki dep (200+ grammar chunks, 13 MB).
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
// Arena game abilities (flat-arena forest + flow-field horde pathing) — reusable engine modules, so the
// no-build lib barrel exposes them too (engine-first: every consumer, build or no-build, can inherit).
export { createForest, placeForest } from './src/createForest.js';
export { createFlowField } from './src/createFlowField.js';
export { createBallistics } from './src/createBallistics.js';
export { createFirstPersonWalker } from './src/createFirstPersonWalker.js';
// A-CHAR (2026-08-09): ONE character — walk/sprint/JUMP/fall/land + collision + a crosshair + the web as an ABILITY, with third-person and first-person cameras. Composes the walker (horizontal) + createGrappleModel (the rope); the vertical axis the walker never had lives here.
export { createCharacterController } from './src/character.js';
export { createBoxArena, swingableHeight, swingableRope } from './src/box-arena.js';   // A-LAB: parameterised proving-ground geometry (flat floor + tower grid) that hands back the four-function world bag
export { createColliderWorld } from './src/collide.js';                 // A-LAB: the collider itself — was reachable ONLY by booting the whole procedural city
export { createParticles } from './src/createParticles.js';
export { createDecals } from './src/createDecals.js';
export { createCharacterRig } from './src/createCharacterRig.js';
export { createAnimStateMachine, ZOMBIE_STATES, ZOMBIE_LOOP_ONCE } from './src/character-anim.js';
export { createCharacterHorde } from './src/createCharacterHorde.js';
export { detectLakes, buildLakeGroup, createWorldLakes } from './src/world-water.js';
export { createWaterFlow } from './src/water-flow.js';
export { reprojectScatter } from './src/scatter.js';
export { scatterAdd, scatterErase } from './src/scatter.js';
export { createCatalog, seedWorldEditorCatalog, registerAssetCatalog } from './src/catalog.js';
export { createSkyAtmosphere } from './src/sky-atmosphere.js';
export { createHillaireSky, GROUND_MM, ATMOS_MM } from './src/hillaire-sky.js';   // A-SKYDOME: the physically-based all-hours sky (Rayleigh+Mie+ozone, RGBA8 LUTs — mobile-safe). Lifted from lgr-live-sky 2026-08-05; barrel-exported so it is reachable through the public API, not just as an internal seam (the index's CORE_UNBARRELED class).
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
// A19 RISO LIFT — the Risograph print effect as a core ability (lifted from lgr-image-studio; engine-first).
export { createRiso, RISO_INKS } from './src/riso.js';
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

// A12 CROSS-REPO SKY LIFT (docs/sky-lift-manifest.md) — the reusable atmosphere post-passes + the
// EffectComposer machinery a consumer builds them into. Slim-core exports so the examples/consumers reach
// them from lgr-engine-core.es.js. Each pass defaults to a NO-OP (byte-identical); desktop-beauty when run
// in an HDR composer (the manifest's half-float finding).
export { createAtmosphereGrade } from './src/createAtmosphereGrade.js';
export { createGodRays, godRayVisibility } from './src/createGodRays.js';
export { createMilkyWay } from './src/createMilkyWay.js';
export { createVolumetricClouds, CLOUD_TIERS } from './src/createVolumetricClouds.js';
// SKY LIFT #2 (manifest §8) — celestial-coordinate foundation: sidereal star spin + REAL-LOCATION sun/moon.
// Pure math, no-op by construction; feeds createMilkyWay.starRotMatrix for rotating stars. Client-site capable.
export { createCelestial } from './src/createCelestial.js';
// ARC A20 — THE REAL-ASTRONOMY LIFT (from lgr-live-sky): real stars (BSC5), 88 constellations, all 7
// planets, all 110 Messier objects, and the Bortle light-pollution model (one shared shader mechanism
// for star/planet/Messier visibility). No-op by construction; real-location-mode only.
export { limitingMagnitude, skyGlow, skyBrightnessSQM, skyGlowIntensity, LA_BORTLE, BORTLE_MIN, BORTLE_MAX } from './src/bortle.js';
export { planetPosition, PLANET_KEYS } from './src/planets.js';
export { createTrueStars } from './src/createTrueStars.js';
export { createConstellations } from './src/createConstellations.js';
export { createSolarSystem } from './src/createSolarSystem.js';
// ⚠️ createMessier renders CC BY-SA (OpenNGC) data — any consumer that ships it MUST surface
// astronomy-credits.js's getAttribution() (docs/engine-invariants.md #8, assets/astronomy/CREDITS.md).
export { createMessier } from './src/createMessier.js';
export { ASTRONOMY_CREDITS, getAttribution } from './src/astronomy-credits.js';
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
