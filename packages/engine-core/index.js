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
// Generality fix (2026-07-08): the core/city split — future projects boot createEngineCore without the city.
export { createEngineCore, showWebGLUnsupported } from './src/createEngineCore.js';
export { createCityWorld } from './src/createCityWorld.js';
export { createCameraRig, CAM, cameraNearRadius } from './src/camera-rig.js';
// C2-ish flight path + curvature-derived banking (2026-08-01) — pairs with camera-rig's setEye(pos,lookDir,roll).
export { createCameraPath, bankAngleFromCurvature } from './src/camera-path.js';
// Arc A-VIEW — auto-frame a camera-rig from a loaded object's bounding box (the asset viewer's one new ability).
export { measureBounds, autoFrame } from './src/asset-viewer.js';
export { createCity, makePalm, PROFILES, PROFILE_KEYS, LAYOUT, mulberry32, tintTower, seabedY, SEABED } from './src/citygen.js';   // A-FISH: seabedY is THE shared depth function — the seabed mesh and the physics sampler both call it, so they cannot disagree
export { createSunRig, validateSunKeyframes, lowSunWashK } from './src/sun-rig.js';   // lowSunWashK: THE shared low-sun curve (celestials/createCityWorld already treat it as canon) — exported so a project shaping a per-frame drive (metropolis dusk windows) reuses the curve instead of duplicating it
export { createCityLife, buildGraph } from './src/agents.js';
// L-streetlamps — warm glow sprites along the city street graph (night-only, byte-identical-safe).
export { createStreetLights } from './src/street-lights.js';
export { createWaterLife } from './src/water-life.js';
export { createLandmarkFactory } from './src/landmarks.js';
export { createWeatherRig } from './src/weather-rig.js';
export { createCloudField } from './src/clouds.js';
export { createCelestials } from './src/celestials.js';
export { createCapture } from './src/capture.js';
// Arc A10 — the generic recorder was reachable only THROUGH createCapture (city's inline wiring); export it
// directly so any demo project can arm the reel recorder (?rec=1 → R toggles an MP4/WebM) without re-wiring.
export { createRecorder, pickVideoType, recorderExt, VIDEO_TYPES } from './src/createRecorder.js';

// The viewer control-bar widget (tap bar + shareable-link command bus).
export { createViewerUI } from './src/viewer-ui.js';

// First-run coachmark/hints system (L42).
export { createHints } from './src/hints.js';
export { createTouchControls } from './src/touch-controls.js';   // 2026-08-06: the floating thumbstick + look-drag — touch input was built 5x in projects and never in core
export { resolveAimPoint, createAimReticle, createPointerLockAim, applyLook } from './src/aim.js';   // 2026-08-08 A-AIM: what is under the crosshair, the crosshair itself, and pointer-lock
export { createTargetLock, createLockMarker, projectToScreen } from './src/aim.js';                  // 2026-08-09 A-LOCK: pick a point, keep it, SEE it (left-click lock / right-click web)
export { createPedestrians } from './src/pedestrians.js';   // A-PEDS 2026-08-06: skinned humans strolling block perimeters (bible §6 item 4) — composes createCharacterRig + the promoted survivor.glb

// L114 — createAppShell + readAppFlags: the ONE place per-page BOOT plumbing lives (loop brackets, pause-on-hidden,
// readiness flag, footer policy, hints/resize/capture wiring) so the three project pages can't drift it.
export { createAppShell, readAppFlags } from './src/app-shell.js';

// VIZ SLICE 0+1 — diagram-theme (dusk-harbor OKLCH tokens), morph-timeline (one-scalar t engine),
// matrix-grid factory (index-stable 2×2 transform lattice + colored basis arrows).
export { THEME, THEMES, applyThemeToRoot } from './src/diagram-theme.js';   // THEMES.paper = the STUDIO light set (slice 12)
export { createMorphTimeline, easeInOutCubic } from './src/math/morph-timeline.js';
export { createMatrixGrid } from './src/math/matrix-grid.js';
// Arc A-TWEEN — the fixed-duration eased tween (2D track gap ⑤): from->to over D seconds along a
// chosen curve, then done. A DIFFERENT primitive from damp() (continuous ease toward a live target) —
// see tween.js's own header. Reuses math/easing.js's existing curve set; does not duplicate it.
export { createTween } from './src/math/tween.js';

// L109 — SceneSpec v1: one versioned scene document (validate/from-URL/to-URL/apply). The contract the embed SDK,
// poster generator, site-gen + prompt layer target; the seed of the site-builder cockpit (versioned, tolerant of
// unknown top-level sections).
export { validateSceneSpec, fromURLParams, toURLParams, applySceneSpec, SCENE_SPEC_VERSION } from './src/scene-spec.js';

// VIZ SLICE 3 — GraphSpec v1 (scene-spec's sibling for graph data): validate/index + the deterministic
// radial layout + the memory-vault ingester. Lifted from projects/atlas/ once createEngineCore landed.
export { validateGraphSpec, indexNodes, KINDS, RELS, STATES, GRAPH_SPEC_VERSION, heatFromAgeDays, HEAT_TAU_DAYS, classifyMedia, hasMedia, DEEP_CHARS, ALGORITHM_KINDS, mediaGlyph, mediaGlyphCode, MEDIA_GLYPHS, classifyHealth, worstState, SLOW_MS } from './src/graph-spec.js';
export { createGraphLayout, DEFAULT_RINGS } from './src/graph-layout.js';
export { parseFrontmatter, extractLinks, extractMarkdownLinks, noteToRecords, buildGraphSpec, extractExcerpt } from './src/ingest-vault.js';

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
export { createHiddenProp } from './src/hidden-prop.js';
export { pickStreetIntersection, createProximityLatch } from './src/hidden-prop-logic.js';

// L74 — the WORLD-EDITOR tool dispatcher (createEditor): one reusable object owning the tool state + brush + routing.
export { createEditor } from './src/editor.js';

// L76 — POSSESSION: the PilotController + ground MovementModel (drive a placed craft, e.g. the all-terrain vehicle).
export { createPilotController, createGroundModel, createSpacecraftModel, createRoadModel, createBoatModel, createBirdModel, createFishModel, createBikeModel, createGrappleModel, carryMomentum, ATV_PROFILE, CRAFT_PROFILE, ROAD_PROFILE, BOAT_PROFILE, BIRD_PROFILE, FISH_PROFILE, BIKE_PROFILE, GRAPPLE_PROFILE } from './src/pilot.js';   // A-FEEL: createRoadModel = a car that corners on a street grid (curvature-limited steering, R grows with v squared). A-FISH: createFishModel = neutral buoyancy + pivot-in-place turning + a ballistic breach. A-MOTO: createBikeModel = the two-phase dirtbike (terrain-follow + ballistic air with pitch control + a landing verdict)
export { jumpableWavelength, launchSpeed, airtimeForFlip, flipRampSpec, createMotoTerrain, createBikeMesh, createBikeGlbMesh, createMotoChaseCam } from './src/moto.js';   // A-MOTO: jumpable-by-construction terrain derived from the bike's own numbers (the swingableHeight discipline, ported), + the box-bike silhouette and the ground-clamped chase camera; A-MOTO-ASSET adds the Blender-pipeline GLB bike (articulated, box fallback)
export { createTrickScorer, TRICK_PROFILE } from './src/tricks.js';   // A-TRICKS: sport-agnostic trick detection + scoring as a PURE CONSUMER of a body's air state (flips off accumulated air pitch; the landing banks by the physics' own kept fraction; grounded input structurally scores zero)

// L-cockpit: bare canopy-frame ring (A-pillars + roof arc + dash bar). Parented to the craft at profile.eye;
// placed-life.js wires it; pilot.js toggles visibility on cockpit/chase transitions.
export { createCockpit } from './src/cockpit.js';

// VIZ MOBILE — gyro-look: DeviceOrientation → cockpit seated-look seam.
// mapGyroToLook: pure exported function (node-testable); createGyroLook: stateful controller.
export { createGyroLook, mapGyroToLook } from './src/gyro-look.js';

// VIZ SLICE 2 — step-through code/algorithm TRACER seams:
// createTracer: element-addressed op recording (compare/swap/mark/edgeVisit — structural faithfulness).
// createTracePlayer: discrete stepIndex + morph-timeline tween for within-step visual blending.
// createCellField: InstancedMesh N cells + DOM overlay labels (N≤16). Engine-first, no dependencies.
// createCodePanel: DOM <pre> code panel with per-line highlight (lit at tween-START).
export { createTracer }                  from './src/tracer.js';
export { createTracePlayer }             from './src/trace-player.js';
export { createCellField, CELL_COLORS }  from './src/cell-field.js';
export { createCodePanel }               from './src/code-panel.js';

// VIZ SLICE 3/5 — createGraphView: GraphSpec + positions -> the live node/edge mesh group. Instanced
// ribbon-quad edges (curved, gradient, flow band) + two-layer billboard nodes (SDF core + additive halo),
// with heat/pulse/focus-dim. Mission Control's renderer ability; the ribbon is what unlocks the pixel look.
export { createGraphView, getKindColors } from './src/graph-view.js';   // getKindColors: the legend's anti-drift color source (slice 8)

// VIZ SLICE 9 — renderNoteHtml: the READER's first-party mini markdown renderer (escape-first,
// [[wikilinks]] as graph navigation, fenced-block islands). No markdown dep (dependency-minimalism).
export { renderNoteHtml, scanFileRefs } from './src/render-markdown.js';

// VIZ SLICE 4 — createGraphLabels: the first-party DOM label overlay (world→screen per frame, degree-ranked
// LOD, focus-aware, pointer-transparent). No SDF/troika dep — the browser already renders text (dep-minimalism).
export { createGraphLabels } from './src/graph-labels.js';

// VIZ SLICE 5 — createGraphAtmosphere: the screen-space FBM nebula + a parallaxing starfield slab. The
// layer that turns "a graph on a webpage" into "a graph in space" (design doc §8). Two draw calls, no deps.
export { createGraphAtmosphere } from './src/graph-atmosphere.js';

/* graph-ambient (VIZ SLICE 15): rare seeded background flybys (comet + tiny ship) behind the graph —
   the sky's delight beat. The scheduler half is pure + node-tested (graph-ambient-core.js). */
export { createGraphAmbient } from './src/graph-ambient.js';
export { createAmbientScheduler, lcg } from './src/graph-ambient-core.js';   // lcg: the house seeded RNG (slice 16: consumers author seeded content)

// VIZ SLICE 6 — createGraphSim: the LIVING GRAPH. A first-party force simulation (semi-implicit Euler,
// d3-force as REFERENCE SPEC not dependency) that mutates the shared positions Map in place. Pure math,
// no THREE — node-testable. Obsidian-style pinned drag, alpha cooling, and an exact hard-stop at rest.
export { createGraphSim, SIM_DEFAULTS } from './src/graph-sim.js';

// L76 — shared scalar maths (the dt-correct `damp` ease, lifted out of camera-rig so rig + models share one).
export { damp, clamp, angleDelta } from './src/math.js';

// F02 lift — native-scroll → damped [0,1] progress, PUMPED from the host loop (NOT self-driven → cannot repro F07).
export { createScrollDirector } from './src/scroll-director.js';

// The chaptered CONTENT layer that consumes createScrollDirector's scalar — segment-chain math (also
// importable standalone for a project's camera code) + the DOM copy/nav/rail layer. See scroll-narrative.js.
export { buildChapterChain, readChapterChain, createScrollNarrative } from './src/scroll-narrative.js';

// 2D LAYER PHASE 1 — a first-party 2D capability (owner decision 2026-08-01: build on Three.js, not
// Pixi/Phaser — see create2DLayer.js header). Composition seam (create2DLayer) + InstancedMesh sprite
// batcher + texture atlas/packer + pointer picking. sprite-slots.js is the pure id<->slot allocator
// the batcher's swap-remove compaction is built on (node-tested standalone).
export { create2DLayer } from './src/create2DLayer.js';
export { createSpriteBatcher } from './src/sprite-batcher.js';
export { createSlotAllocator } from './src/sprite-slots.js';
export { createTextureAtlas, createShelfPacker } from './src/texture-atlas.js';
export { create2DPicking } from './src/2d-picking.js';

// 2D LAYER PHASE 2 — text + UI. Bitmap glyph atlas (defended vs SDF in HANDOFF.md) batched onto the
// SAME sprite batcher as everything else; 9-slice panels (also just batcher sprites, no new shader);
// a minimal anchor/align/padding box for HUD placement. Per-sprite alpha landed in sprite-batcher.js
// itself (Phase 2's Q2 — bundled, not a separate export).
export { createGlyphAtlas } from './src/glyph-atlas.js';
export { computeTextLayout, createTextBlock } from './src/text-block.js';
export { computeNineSliceLayout, createNineSlicePanel } from './src/nine-slice.js';
export { layoutBox, LAYOUT_ANCHORS } from './src/layout-box.js';

// L78 — ENGINE HARDENING: honest profiling (p95/p99 + GPU-ms + leak gate) + adaptive quality (lock a smooth fps).
export { createEngineProfiler } from './src/profiler.js';
export { createQualityGovernor } from './src/quality-governor.js';
// Arc A10 — the FIELD-DEBUG instrument lifted to core (docs/field-debug-doctrine.md): a screenshot-able
// GL-stack overlay (caps · tier/path state · live luminance · unmissable highp verdict) every project
// inherits behind its own ?debug=gl gate. Default-inert → shipped looks stay byte-identical when off.
export { createDebugOverlay } from './src/debug-overlay.js';
// Arc A11 THE LIGHT CEILING — procedural contact grounding: soft radial dark patches on the ground under
// objects so they read as PLACED, not floating (chosen over SSAO by measurement + cost — see the module).
// Opt-in, default-inert → byte-identical for any project that doesn't create it.
export { createContactShadows } from './src/contact-shadow.js';
// Arc A12 WATER, PROPERLY — a CONTEXTUAL water body (pond/lake/shoreline, never a global plane) with an
// ANALYTIC ripple/depth/shoreline/Fresnel shader that rides the MOBILE direct path (no half-float, no texture
// sampling → no OES_texture_half_float_linear dependency). Opt-in via the recipe's `water` field.
export { createWaterSurface } from './src/createWaterSurface.js';
// Cross-repo SKY LIFT (docs/sky-lift-manifest.md, from lgr-live-sky) — reusable atmosphere fidelity as core
// abilities, each an OPT-IN EffectComposer post-pass whose default is a NO-OP (byte-identical). DESKTOP-
// BEAUTY-ONLY when run in an HDR composer (the manifest's half-float finding); a consumer builds the composer.
export { createAtmosphereGrade } from './src/createAtmosphereGrade.js';
export { createGodRays, godRayVisibility } from './src/createGodRays.js';
export { createMilkyWay } from './src/createMilkyWay.js';
export { createVolumetricClouds, CLOUD_TIERS } from './src/createVolumetricClouds.js';
// SKY LIFT #2 (manifest §8) — the celestial-coordinate foundation: sidereal star spin + REAL-LOCATION mode
// (physical sun/moon for a place, date & longitude). Pure math, no-op by construction. A client-site
// capability ("the sky over <place> right now"); createMilkyWay accepts its starRotMatrix(t) for rotating stars.
export { createCelestial } from './src/createCelestial.js';
// ARC A20 — THE REAL-ASTRONOMY LIFT (docs/real-astronomy-lift-manifest.md in lgr-live-sky, from
// lgr-live-sky): "what is in the sky above this place at this time" — real stars (Yale BSC5), 88
// constellations, all 7 planets, all 110 Messier objects, and the Bortle light-pollution model that
// governs visibility for stars/planets/Messier through ONE shared shader mechanism (createCelestial's
// starAltAz feeds all three catalogs the same precession+sidereal+refraction pipeline the sun/moon use).
// No-op by construction (each factory's group starts invisible); real-location-mode only.
export { limitingMagnitude, skyGlow, skyBrightnessSQM, skyGlowIntensity, LA_BORTLE, BORTLE_MIN, BORTLE_MAX } from './src/bortle.js';
export { planetPosition, PLANET_KEYS } from './src/planets.js';
export { createTrueStars } from './src/createTrueStars.js';
export { createConstellations } from './src/createConstellations.js';
export { createSolarSystem } from './src/createSolarSystem.js';
// ⚠️ createMessier renders CC BY-SA (OpenNGC) data — any consumer that ships it MUST surface
// astronomy-credits.js's getAttribution() (docs/engine-invariants.md #8, assets/astronomy/CREDITS.md).
export { createMessier } from './src/createMessier.js';
export { ASTRONOMY_CREDITS, getAttribution } from './src/astronomy-credits.js';
// The EffectComposer machinery a consumer needs to run those passes (a project builds its OWN composer;
// the engine's beauty pipeline is not one). Re-exported so a consumer shares ONE three instance with the
// passes (no dual-three). Projects import from src → tree-shaken out unless used; only dist-lib bundles them.
export { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
export { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
export { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// L64 — PROCEDURAL TERRAIN: seeded heightfield + biome generator + flat-shaded chunked mesh.
// L69 — `rebuildTerrainChunks` for live sculpting (dirty-chunk update).
// A-MARRIAGE — `createTerrainSampler`: the world-Y bilinear ground query over the ONE field (world.heightAt's terrain half).
export { generateTerrain, buildTerrainMesh, rebuildTerrainChunks, createTerrainSampler, BIOMES, TERRAIN_PRESETS, PRESET_KEYS } from './src/terrain.js';

// A-MARRIAGE (2026-08-19) — THE CITYGEN↔TERRAIN MARRIAGE, route 1 (research-aaa-environments.md §2):
// carveCityPads flattens a PAD under each city cell and RAMPS the streets between pads (smoothstep,
// grade-budgeted, embankment-blended), writing into the EXISTING heightfield — mutate the one field,
// then rebuildTerrainChunks the dirty meshes (dirtyMeshesFor picks them). Pairs with createBoxArena's
// groundYAt/heightAt opt-ins: towers stand on pads, heights author relative to pad top, ONE world bag.
export { carveCityPads, dirtyMeshesFor } from './src/carve-pads.js';

// A-PATCHWORK — REGIONS: a capacity-constrained priority flood that partitions the world into a few
// large, CONTIGUOUS districts (city · woods · desert · lakes · sea), each of which decides its own
// CONTENT while the per-texel biome keeps deciding colour. shapeRegionTerrain applies each district's
// height OFFSET, faded to zero at every seam, so the region system's whole grade contribution is one
// sweepable field. regionReport is the anti-speckle count (largest connected component per region).
export { generateRegions, shapeRegionTerrain, regionReport, regionAt, UNASSIGNED } from './src/regions.js';

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
export { createCatalog, seedWorldEditorCatalog, registerAssetCatalog } from './src/catalog.js';

// L66 — PREETHAM atmospheric sky (realistic-tier; ACES + bloom live in the post chain / createEngine).
export { createSkyAtmosphere } from './src/sky-atmosphere.js';
export { createHillaireSky, GROUND_MM, ATMOS_MM } from './src/hillaire-sky.js';   // A-SKYDOME: the physically-based all-hours sky (Rayleigh+Mie+ozone, RGBA8 LUTs — mobile-safe). Lifted from lgr-live-sky 2026-08-05; barrel-exported so it is reachable through the public API, not just as an internal seam (the index's CORE_UNBARRELED class).

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

// Beauty B5 AUDIO DREAD — the synthesized game voice: a bank of Web-Audio one-shot recipes per event class
// (layered gunshot, impacts, melee, positional zombie vocals, barrier, UI, death sting). Zero asset files.
export { createSfxKit } from './src/createSfxKit.js';
// L-audio-full-layer-slice1 — positional audio field + helicopter rotor synth.
export { createPositionalField } from './src/positional-field.js';
export { createRotor } from './src/rotor.js';

// Lesson HOARD-1 — a flickering warm light pool (born in The Hoard's cavern; reusable for any flame).
export { createTorchLight, torchFlicker } from './src/createTorchLight.js';

// Lesson HOARD-2 — the reusable DIVE (from-view zoom-crossfades into a to-view). One impl for the cavern,
// the survivor game, and (staged) the city dive. Owns the two RTs + present; wraps createSceneTransition.
export { createDiveController } from './src/createDiveController.js';

// Lesson HOARD-3 — a sparse instanced forest for a flat arena (keep-out clearings + min-spacing + gameplay
// colliders). Sibling of scatter.js (terrain scatter); this is the flat-arena, gameplay-collider forest.
export { createForest, placeForest } from './src/createForest.js';

// ARC A-TREEKIT — the MODELED forest: the Blender conifer kit (4 variants, one generator, albedo×AO in
// COLOR_0) instanced over any placer's placements, with seeded per-instance hue/value tints — the bounded
// proof's colour-variety gap, closed as an engine seam. Pure helpers exported for node tests + receipts.
export { createTreeKit, assignTreeVariants, makeTreeTints, hashTreeInstances, TREE_KIT_VARIANTS } from './src/createTreeKit.js';

// Beauty B1 GROUND TRUTH — the GPU TEXTURE FORGE: seeded procedural PBR (albedo/ORM/Sobel-normal) baked
// at boot from periodic-noise family shaders, so a world stops being flat-coloured. Recipes live in
// forge-recipes.js; a project wires the materials. supported=false on iOS-p0 (bake skipped, flat fallback).
export { createTextureForge, nyquistFeatureFloor, repeatFor, FORGE_MIN_TEXELS } from './src/createTextureForge.js';
export { HOARD_SURFACES, forgeHoardMaterials, WEAPON_SKINS, CITY_SURFACES, forgeCityMaterials, CITY_LOOKS } from './src/forge-recipes.js';
// Arc A7-1 — world-scale macro de-tiling for a tiled floor (breaks the iso-distance repeat grid a single
// tile can't, since a tile holds no feature bigger than itself). Opt-in via onBeforeCompile → byte-safe.
export { applyGroundMacro } from './src/ground-macro.js';
// Arc A-AERIAL — the research doc's `triplanarForge`: a forge-baked map set sampled by WORLD POSITION
// (three axis projections blended by normal, side set on X/Z + top set on Y) so UV-less, wildly
// differently-sized instanced boxes can share ONE textured material at ONE draw call. Opt-in.
export { createTriplanarForgeMaterial, tilesPerUnit } from './src/triplanar-forge.js';
// Arc A-DRESS — the street, as opposed to the buildings. `applyStreetGrid` paints asphalt/sidewalk/
// kerb/lane-dashes/zebra-crossings as a FUNCTION OF WORLD XZ on a ground material already being drawn
// (zero extra draw calls, and it CHAINS onto an existing onBeforeCompile rather than clobbering it);
// `createStreetKit` places lamps/trees/benches/hydrants/shelters on the same grid as three instanced
// meshes total, whatever the city's size. Both opt-in, both no-ops for every existing consumer.
export { applyStreetGrid } from './src/street-grid.js';
export { createStreetKit } from './src/street-kit.js';
// Arc A-CROWD — the THIRD thing that lives on that same street grid, after the paint and the props:
// the PEOPLE. `createStreetPlaces` turns the grid into a sparse set of gathering places (junction
// corners, mid-block stops, a plaza) and is a `createAgentSim` placer, so a crowd clusters where a
// crowd would and loiters once it gets there. Imports nothing; node-testable; opt-in.
export { createStreetPlaces } from './src/createStreetPlaces.js';

// Arc A14 GLINT — constant-time glinty-NDF specular (own implementation from the SIGGRAPH-Asia-2025
// paper; no textures/RTs/half-float). applyGlint decorates a lit MeshStandardMaterial (composes with
// applyGroundMacro); createGlintMaterial mints a fresh one. Opt-in via onBeforeCompile → byte-safe.
export { applyGlint, createGlintMaterial } from './src/createGlintMaterial.js';

// Arc A15 BAKED RADIANCE PROBES — the engine's FIRST indirect-light term. A build-time bake
// (tools/bake-probes.mjs) writes a sparse RGBA8 irradiance volume; createIndirectField uploads it as a
// Data3DTexture and adds the bounce to Three's `irradiance` via onBeforeCompile — mobile-safe (8-bit 3D
// linear, no half-float), composes with macro/glint. Opt-in (a caller must build+apply a field) → byte-safe.
export { createIndirectField } from './src/createIndirectField.js';

// Arc A9 TEXT→WORLD — map generation as a LIBRARY. A world RECIPE (plain data) + an INTERPRETER that
// composes the modules above (terrain/forest/city clusters/ruins/buildings/scatter/water) into a playable
// arena + a keyword TEXT front-end (description → recipe, no runtime AI). The recipe is the API. The pure
// play-ring generators (scatterRuins/scatterProps/deriveHarvest/placeCoverBuildings) + the decrepit/intact
// city profiles were lifted here from hoard2 so the interpreter is self-contained (engine-first).
export { defaultRecipe, normalizeRecipe, mergeRecipes, RECIPE_BIOMES } from './src/world-recipe.js';
export { createWorldFromRecipe } from './src/createWorldFromRecipe.js';
export { recipeFromText, describeVocabulary } from './src/world-recipe-text.js';
// A18 portable experience format — the bundle manifest schema + validator (pure; the spec's reference impl).
export { BUNDLE_FORMAT, BUNDLE_VERSION, buildManifest, validateManifest, isVersionCompatible, parseVersion } from './src/world-bundle.js';
export { scatterRuins, scatterProps, deriveHarvest, placeCoverBuildings, citySolidsToObstacles } from './src/world-scatter.js';
export { buildDecrepitProfile, buildIntactProfile, DECREPIT_TOWERS } from './src/world-profiles.js';
// ARC A21 — THE CITY GENERATOR: the urban-recipe → citygen-profile translator (unifies citygen.js's
// profile-based generator with the world-recipe schema; see docs/world-recipe-schema.md's "Urban city"
// section for the round-trip proof this rests on).
export { cityProfileFromUrban, URBAN_ERAS } from './src/urban-profile.js';

// Beauty B4 COMBAT FEEL — the weapon kit: a chamfered-primitive hard-surface gun (NO fingers), merged to a
// handful of draw calls, skinned by a forge gunmetal material. The wielder (hand bone / FP viewmodel) + the
// recoil layer + the unified shot event give it FEEL; this builds the ART.
export { createWeaponKit } from './src/createWeaponKit.js';

// Lesson M3 — flow-field horde pathing: one grid solve steers a whole crowd around obstacles (a moving
// target, tree colliders + barriers), each agent paying a single array lookup per step. Pure math (no
// THREE) + an optional spatial-hash separation helper. The Hoard swaps its straight-line seek for this.
export { createFlowField } from './src/createFlowField.js';

// Lesson M4 — projectile simulation: pooled bullets with velocity + gravity drop, swept per step, hit
// tests INJECTED as castWorld/castTargets callbacks (the module never depends on a collision system).
// The Hoard's gun fires these instead of an instant hitscan.
export { createBallistics } from './src/createBallistics.js';

// Lesson M2 — first-person walk controller: full 360° pointer-lock look + yaw-relative WASD at eye height
// with circle/AABB/arena collision. The Hoard's forest dive lands you WALKING (a NEW module, not a seated
// mode — full unbounded yaw + move coupled to yaw ≠ createSeatedLook's clamped head-turn).
export { createFirstPersonWalker } from './src/createFirstPersonWalker.js';
// A-CHAR (2026-08-09): ONE character — walk/sprint/JUMP/fall/land + collision + a crosshair + the web as an ABILITY, with third-person and first-person cameras. Composes the walker (horizontal) + createGrappleModel (the rope); the vertical axis the walker never had lives here.
export { createCharacterController } from './src/character.js';
/* A-LAB (2026-08-09) — PROVING-GROUND GEOMETRY, and the collider that was unreachable behind it.
   `createColliderWorld` had exactly one caller in the whole repo (createCityWorld), was
   CORE_UNBARRELED, and the package `exports` map does not expose `./src/collide.js` — so a project
   that wanted COLLISION WITHOUT A PROCEDURAL CITY physically could not get it. That is the gap
   projects/swing-lab hit on its first line. `createBoxArena` is the level on top of it: a flat floor
   and a parameterised tower grid that hands back the four-function world bag every body here speaks,
   sized from the SWING's own numbers (`swingableHeight`) rather than copied off a city. */
export { createBoxArena, swingableHeight, swingableRope, topAtPercentile, percentileOf } from './src/box-arena.js';
export { createColliderWorld } from './src/collide.js';

// Lesson M6 — GPU particle system: ping-pong FBO sim (pos/vel state textures) + scissor-ring spawn +
// parameterized emitters (burst/muzzle/dust), additive point render. Generalizes the water-flow-gpu GPGPU
// pattern. HalfFloat-or-null fallback. The Hoard wires M4's onHit → burst and gun-fire → muzzle.
export { createParticles, planSpawn } from './src/createParticles.js';

// Lesson M5 — projected decals: box-projector → gather receiver triangles → Sutherland–Hodgman clip →
// vertex ring → one draw call with GPU age-fade (bullet holes / blood / scorch, procedural atlas). The
// Hoard wires M4's onHit → bullet hole and zombie death → ground splat.
export { createDecals } from './src/createDecals.js';

// Lesson M1a — skinned character rig: load a GLB, drive a six-state (idle/walk/run/attack/hit/death)
// animation machine with cross-fade blending; SkeletonUtils-cloned instances share geometry, own their
// skeleton. The Hoard's zombies become characters (M1b pools this). Pure state machine in character-anim.
export { createCharacterRig } from './src/createCharacterRig.js';
export { createAnimStateMachine, ZOMBIE_STATES, ZOMBIE_LOOP_ONCE } from './src/character-anim.js';

// Lesson M1b — character horde: a pooled, index-addressed, distance-LOD scale-up of the rig (the
// Hoard swaps its instanced-capsule zombies for these, same sim).
export { createCharacterHorde } from './src/createCharacterHorde.js';

/* ARC A-GROUND (2026-08-20) — the adapter that lets a project with a HEIGHT FIELD feed the A-CONTACT
   ground ability. contact.js's other exports stay off this list under the A-AIR rule three notes below
   (a barrel export with no consumer is ORPHANED): `planeContactTarget` / `groundContactTarget` /
   `surfaceAlong` still have exactly one runtime consumer, createCharacterRig, which imports them
   directly. `heightFieldProbe` is here because it now has a real second consumer — hoard2 wires its
   `world.groundAt` through it to arm the measured floor on the survivor and both hordes. */
export { heightFieldProbe } from './src/contact.js';

/* ARC A-BODY (2026-08-13) — THE PLAYER GETS A BODY. The engine could render a CROWD of skinned humans
   (rig → horde → tiers) but not the ONE human the player is, so every project hung a CapsuleGeometry
   off createCharacterController and called it a stand-in. createHeroBody reads a controller state and
   poses a rigged character from it: idle/walk/sprint off a continuous gait blend, held poses for
   jump/fall/swing/cling, the aim-IK arm extended at the swing anchor, and a first-person mode that
   collapses the head bone so the eye never renders the inside of its own skull. Presentation only —
   the collider stays a capsule, the sim is untouched. The pure decision math (gaitBlend / heroPose) is
   node-tested in hero-body-pose.js; the piecewise gait map exists because the rig's blend is piecewise
   at 0.5 and a naive speed ratio walks with 16% of a run mixed in.
   NOTE ON WHAT IS *NOT* EXPORTED HERE: `SURVIVOR_STATES` / `HERO_AIR_POSE` / `HERO_POSES` are real
   exports of their own modules (the node test reads them) but stay OFF this barrel until something
   consumes them — the capability index counts a barrel export with no consumers as ORPHANED, and
   growing that list to look generous is how a public API becomes furniture. */
export { createHeroBody } from './src/createHeroBody.js';
export { gaitBlend, gaitName, heroPose } from './src/hero-body-pose.js';

/* ARC A-AIR (2026-08-15) — THE HELD FRAMES START BREATHING. A-BODY above shipped jump/fall/swing/cling
   as one FROZEN frame of the Jump clip each and named the gap in its own header: "It does not breathe",
   and "a cling reads as reaching at the wall, not spread-eagled on it". The cure is a procedural layer
   (`handle.setAirMotion` on the rig; `createHeroBody` wires it from a controller state) composed on top
   of that held frame — a launch crunch, a fall that spreads with the fall speed, a swing whose legs pump
   with the pendulum, and a cling that finally uses BOTH arms because an additive layer is not limited to
   the rig's one aimable arm. Every angle is a function of `vy`, which is the half a baked clip cannot do.
   OFF by default at the rig (`setAirMotion` never called → the block is one failed `if`; the horde, the
   city crowd and hoard2 are untouched), ON by default in createHeroBody with `airMotion:false` kept as
   the A/B control arm.
   NOTHING IS EXPORTED HERE, on the same rule the A-BODY note above states: `airPose` / `riseFall` /
   `makeAirPose` / `AIR_MODES` are real exports of hero-air.js and the node test reads them, but the only
   runtime consumer is createCharacterRig, which imports the module directly. A barrel export with no
   consumer is counted ORPHANED by the capability index, and it stays off this list until a second
   consumer (a thrown body, a vehicle ejection) actually wants the curves. */

/* A-CITIZENS (2026-08-12, mass-agents Phase 2) — the SEIR agent population, LIFTED from hoard2's
   civilians.js (84c0667) so every project inherits it: pooled S/E(/in-pool I) state machine, wander +
   multi-source-field flee, contact×dt×p transmission, telegraphed turns, the nearest(state) target-set
   seam. THREE-free, node-tested, byte-identical to the original for hoard2 (its adapter + trace tests
   pin it). createAgentRng = mulberry32 + the helper vocabulary, for consumers without a fork infra.
   Node-safe deep import: '@lgr/engine-core/src/createAgentSim.js' (barrel-free, the corpse-pool route). */
export { createAgentSim, createAgentRng } from './src/createAgentSim.js';
// The tier A/B crowd renderer over it: skinned rigs (createCharacterHorde) near the camera, one
// instanced-capsule draw far, promote/demote by distance with hysteresis + colour continuity. The
// infection telegraph (street→green ramp + tightening stumble beat) is worn by BOTH tiers.
export { createCrowdTiers } from './src/createCrowdTiers.js';

// Beauty B3 CHARACTERS ALIVE — the corpse pool as a core ability (the dead persist, never blink out): a
// pure fixed-slot allocator (TTL floor + oldest-first cap eviction). Node-safe deep-import at
// '@lgr/engine-core/src/corpse-pool.js' (barrel-free) for a project's node-tested fx orchestration.
export { createCorpsePool } from './src/corpse-pool.js';

// HERO abilities in the MAIN barrel (were -lib-only) so workspace projects inherit them, not just the
// no-build /live/ bundles. The Hoard's cavern is the first workspace consumer (assembly + self-shadow +
// the shared beauty present). Tree-shaken out of any project that doesn't import them (sideEffects:false).
export { createBuildIn }         from './src/hero/createBuildIn.js';
export { createShadowRig }       from './src/hero/createShadowRig.js';
export { createBeautyPresenter } from './src/hero/createBeautyPresenter.js';
// The REST of the hero family + a few non-hero lib-only abilities — added 2026-08-02 (adversarial guard
// audit): these were reachable from index-lib.js/index-core-lib.js (so a no-build/lib consumer already
// had them) but ABSENT from this workspace barrel, so `import { createAurora } from '@lgr/engine-core'`
// inside any project failed while the built lib had it — the exact reverse-direction wiring-drift
// barrel-coverage.test.mjs never checked for. Engine-first: these belong in the one barrel every
// consumer inherits from, same as the three above.
export { createSmoothScroll }   from './src/createSmoothScroll.js';
export { createHeroDirector }   from './src/hero/createHeroDirector.js';
export { createHeroWipe }       from './src/hero/createHeroWipe.js';
export { createCameraDirector } from './src/hero/createCameraDirector.js';
export { createDuskSilk }       from './src/hero/createDuskSilk.js';
export { createConstellation }  from './src/hero/createConstellation.js';
export { createAurora }         from './src/hero/createAurora.js';
export { createProductMoment }  from './src/hero/createProductMoment.js';
export { createObservatory }    from './src/hero/createObservatory.js';
export { createPixelMorph }     from './src/hero/createPixelMorph.js';
export { createMaterialStudy }  from './src/hero/createMaterialStudy.js';
export { createLattice }        from './src/hero/createLattice.js';
export { createLiquidMetal }    from './src/hero/createLiquidMetal.js';
export { createLivingInk }      from './src/hero/createLivingInk.js';
export { createCaustics }       from './src/hero/createCaustics.js';
export { createLetterpress }    from './src/hero/createLetterpress.js';
export { createCathedralLight } from './src/hero/createCathedralLight.js';
export { createFirstLight }     from './src/hero/createFirstLight.js';
export { createEdgeField }      from './src/createEdgeField.js';
export { createBeforeAfter }    from './src/createBeforeAfter.js';
export { createLookReel }       from './src/createLookReel.js';

// Raw shader strings a few app-level materials compose directly (the dive crossfade; the
// pixelate tool). Exporting them keeps projects from reaching into the package's src/shaders.
export { default as fullscreenVert } from './src/shaders/fullscreen.vert';
// A19 RISO LIFT — the Risograph print effect as a core ability (lifted from lgr-image-studio; engine-first).
export { createRiso, RISO_INKS } from './src/riso.js';
export { default as postDiveFrag } from './src/shaders/post-dive.frag';
export { default as postPixelkitFrag } from './src/shaders/post-pixelkit.frag';

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
