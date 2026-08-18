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
export { createCameraRig, CAM, cameraNearRadius } from './src/camera-rig.js';
export { measureBounds, autoFrame } from './src/asset-viewer.js';   // Arc A-VIEW: bbox auto-framing
export { createCameraPath, bankAngleFromCurvature } from './src/camera-path.js';
export { createCity, makePalm, PROFILES, PROFILE_KEYS, LAYOUT, mulberry32, tintTower, seabedY, SEABED } from './src/citygen.js';   // A-FISH: seabedY is THE shared depth function — the seabed mesh and the physics sampler both call it
// A9 text→world + A18 portable bundle — so a no-build consumer can build a world from a recipe/bundle.
export { defaultRecipe, normalizeRecipe, mergeRecipes, RECIPE_BIOMES } from './src/world-recipe.js';
export { createWorldFromRecipe } from './src/createWorldFromRecipe.js';
export { recipeFromText, describeVocabulary } from './src/world-recipe-text.js';
export { BUNDLE_FORMAT, BUNDLE_VERSION, buildManifest, validateManifest, isVersionCompatible, parseVersion } from './src/world-bundle.js';
export { createSunRig, validateSunKeyframes, lowSunWashK } from './src/sun-rig.js';
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
export { createTouchControls } from './src/touch-controls.js';   // 2026-08-06: the floating thumbstick + look-drag — touch input was built 5x in projects and never in core
export { resolveAimPoint, createAimReticle, createPointerLockAim, applyLook } from './src/aim.js';   // 2026-08-08 A-AIM: what is under the crosshair, the crosshair itself, and pointer-lock
export { createTargetLock, createLockMarker, projectToScreen } from './src/aim.js';                  // 2026-08-09 A-LOCK: pick a point, keep it, SEE it (left-click lock / right-click web)
export { createPedestrians } from './src/pedestrians.js';   // A-PEDS 2026-08-06: skinned humans strolling block perimeters (bible §6 item 4) — composes createCharacterRig + the promoted survivor.glb
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
export { createPilotController, createGroundModel, createSpacecraftModel, createRoadModel, createBoatModel, createBirdModel, createFishModel, createBikeModel, createGrappleModel, carryMomentum, ATV_PROFILE, CRAFT_PROFILE, ROAD_PROFILE, BOAT_PROFILE, BIRD_PROFILE, FISH_PROFILE, BIKE_PROFILE, GRAPPLE_PROFILE } from './src/pilot.js';   // A-FEEL: createRoadModel = a car that corners on a street grid (curvature-limited steering, R grows with v squared). A-MOTO: createBikeModel = the two-phase dirtbike
export { jumpableWavelength, launchSpeed, airtimeForFlip, flipRampSpec, createMotoTerrain, createBikeMesh, createMotoChaseCam } from './src/moto.js';   // A-MOTO: jumpable-by-construction terrain + bike silhouette + ground-clamped chase
export { createCockpit } from './src/cockpit.js';
export { createGyroLook, mapGyroToLook } from './src/gyro-look.js';
export { createTracer }                  from './src/tracer.js';
export { createTracePlayer }             from './src/trace-player.js';
export { createCellField, CELL_COLORS }  from './src/cell-field.js';

// ── BARREL-COVERAGE FIX (2026-07-30) ─────────────────────────────────────────
// These engine abilities were in the workspace `index.js` but reachable from NO built lib barrel, so any
// no-build / cross-repo / examples consumer importing `lgr-engine.es.js` could not use them — the same class
// of gap that hid createRecorder (A10) and createWorldFromRecipe (A18); see the audit doc. Completing the
// full lib per its documented "identical to index.js except createCodePanel" contract costs ~50 KB (most is
// already pulled transitively). tools/barrel-coverage.test.mjs fails RED if a future export slips this net.
export { createContactShadows } from './src/contact-shadow.js';
export { createCorpsePool } from './src/corpse-pool.js';
export { createDiveController } from './src/createDiveController.js';
export { applyGlint, createGlintMaterial } from './src/createGlintMaterial.js';
export { createIndirectField } from './src/createIndirectField.js';
export { planSpawn } from './src/createParticles.js';
export { VIDEO_TYPES, createRecorder, pickVideoType, recorderExt } from './src/createRecorder.js';
export { createSfxKit } from './src/createSfxKit.js';
export { FORGE_MIN_TEXELS, createTextureForge, nyquistFeatureFloor, repeatFor } from './src/createTextureForge.js';
export { createTorchLight, torchFlicker } from './src/createTorchLight.js';
export { createWaterSurface } from './src/createWaterSurface.js';
export { createWeaponKit } from './src/createWeaponKit.js';
export { createDebugOverlay } from './src/debug-overlay.js';
export { HOARD_SURFACES, WEAPON_SKINS, forgeHoardMaterials, CITY_SURFACES, forgeCityMaterials, CITY_LOOKS } from './src/forge-recipes.js';
export { SIM_DEFAULTS } from './src/graph-sim.js';
export { applyGroundMacro } from './src/ground-macro.js';
export { createTriplanarForgeMaterial, tilesPerUnit } from './src/triplanar-forge.js';
// Arc A-DRESS — the street rather than the buildings: road markings as a world-XZ material patch
// (zero draw calls, chains onto an existing onBeforeCompile) + instanced street furniture whose mesh
// count does not grow with the city. Both opt-in.
export { applyStreetGrid } from './src/street-grid.js';
export { createStreetKit } from './src/street-kit.js';
// Arc A-CROWD — the people on that same grid: a sparse gathering-place set that is a createAgentSim
// placer, so a crowd clusters and loiters instead of spreading uniformly thin. Imports nothing.
export { createStreetPlaces } from './src/createStreetPlaces.js';
export { DECREPIT_TOWERS, buildDecrepitProfile, buildIntactProfile } from './src/world-profiles.js';
export { deriveHarvest, placeCoverBuildings, scatterProps, scatterRuins, citySolidsToObstacles } from './src/world-scatter.js';
export { cityProfileFromUrban, URBAN_ERAS } from './src/urban-profile.js';
// ─────────────────────────────────────────────────────────────────────────────

// ── BARREL-COVERAGE FIX #2 (2026-07-31, A20 audit) ───────────────────────────
// The owner independently verified the A20 astronomy lift and found this file had drifted from its
// OWN documented "identical to index.js except createCodePanel" contract — not just the 5 astronomy
// exports this arc added, but 30 MORE pre-existing gaps (the whole sky-lift FX family + a batch of
// character/combat abilities). tools/barrel-coverage.test.mjs passed throughout because it only
// asserted "reachable from lib OR core" (index-core-lib.js already had all of these) — a WEAKER
// property than what this file's header promises. Guard-scope blindness, 4th instance (see
// docs/second-consumer-audit-2026-07-29.md). Fixed by completing the lib, not by excusing the gap —
// same remediation style as the 2026-07-30 fix block above. `planSpawn` (createParticles.js) already
// exported above — omitted here to avoid a duplicate export.
export { createAtmosphereGrade } from './src/createAtmosphereGrade.js';
export { createGodRays, godRayVisibility } from './src/createGodRays.js';
export { createMilkyWay } from './src/createMilkyWay.js';
export { createVolumetricClouds, CLOUD_TIERS } from './src/createVolumetricClouds.js';
export { createCelestial } from './src/createCelestial.js';
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
export { limitingMagnitude, skyGlow, skyBrightnessSQM, skyGlowIntensity, LA_BORTLE, BORTLE_MIN, BORTLE_MAX } from './src/bortle.js';
export { planetPosition, PLANET_KEYS } from './src/planets.js';
export { createTrueStars } from './src/createTrueStars.js';
export { createConstellations } from './src/createConstellations.js';
export { createSolarSystem } from './src/createSolarSystem.js';
export { createMessier } from './src/createMessier.js';
export { ASTRONOMY_CREDITS, getAttribution } from './src/astronomy-credits.js';
export { createForest, placeForest } from './src/createForest.js';
export { createFlowField } from './src/createFlowField.js';
export { createBallistics } from './src/createBallistics.js';
export { createFirstPersonWalker } from './src/createFirstPersonWalker.js';
// A-CHAR (2026-08-09): ONE character — walk/sprint/JUMP/fall/land + collision + a crosshair + the web as an ABILITY, with third-person and first-person cameras. Composes the walker (horizontal) + createGrappleModel (the rope); the vertical axis the walker never had lives here.
export { createCharacterController } from './src/character.js';
export { createBoxArena, swingableHeight, swingableRope, topAtPercentile, percentileOf } from './src/box-arena.js';   // A-LAB: parameterised proving-ground geometry (flat floor + tower grid) that hands back the four-function world bag
export { createColliderWorld } from './src/collide.js';                 // A-LAB: the collider itself — was reachable ONLY by booting the whole procedural city
export { createParticles } from './src/createParticles.js';
export { createDecals } from './src/createDecals.js';
export { createCharacterRig } from './src/createCharacterRig.js';
export { createAnimStateMachine, ZOMBIE_STATES, ZOMBIE_LOOP_ONCE } from './src/character-anim.js';
export { createCharacterHorde } from './src/createCharacterHorde.js';
// A-CITIZENS (2026-08-12): the SEIR agent population (THREE-free, node-tested) + the tier A/B crowd
// renderer over it (rigs near, one instanced-capsule draw far). Lifted from hoard2 — engine-first.
export { createAgentSim, createAgentRng } from './src/createAgentSim.js';
export { createCrowdTiers } from './src/createCrowdTiers.js';
// A-BODY (2026-08-13): the player's own skinned body over the same rig — idle/walk/sprint gait blend,
// held jump/fall/swing/cling poses, first- and third-person. The pure gait/pose math rides with it.
export { createHeroBody } from './src/createHeroBody.js';
export { gaitBlend, gaitName, heroPose } from './src/hero-body-pose.js';
// ─────────────────────────────────────────────────────────────────────────────
// createCodePanel OMITTED — its shiki dynamic import emits 200+ grammar chunks that lib consumers never load.
export { damp, clamp, angleDelta } from './src/math.js';
export { createScrollDirector } from './src/scroll-director.js';
export { buildChapterChain, readChapterChain, createScrollNarrative } from './src/scroll-narrative.js';
export { create2DLayer } from './src/create2DLayer.js';
export { createSpriteBatcher } from './src/sprite-batcher.js';
export { createSlotAllocator } from './src/sprite-slots.js';
export { createTextureAtlas, createShelfPacker } from './src/texture-atlas.js';
export { create2DPicking } from './src/2d-picking.js';
export { createGlyphAtlas } from './src/glyph-atlas.js';
export { computeTextLayout, createTextBlock } from './src/text-block.js';
export { computeNineSliceLayout, createNineSlicePanel } from './src/nine-slice.js';
export { layoutBox, LAYOUT_ANCHORS } from './src/layout-box.js';
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
