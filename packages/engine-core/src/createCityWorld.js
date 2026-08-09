/* ============================================================
   LGR WebGL Lab — createCityWorld — city content + render orchestration
   ------------------------------------------------------------
   PURE RELOCATION from createEngine.js (the generality fix). Takes a core handle
   (createEngineCore) and adds all city content: wave sim, water surface, city/life/
   weather, terrain/world, the pilot controller, and the render orchestration
   (updateWorld, renderCityPipeline, renderCityBeautyTo, renderReflection, prewarm).

   Wires two core seams at construction time:
     core.onContextRestored(fn)       — invalidates sky-IBL env + shadow map on GL restore
     core.registerContentResizer(fn)  — resizes grabRT + planarRefl + waterMaterial.uResolution

   createEngine.js flat-merges this with the core handle so all 4 projects work unchanged.
   ============================================================ */
import * as THREE from 'three';

import { createCity, LAYOUT, mulberry32 } from './citygen.js';
import { createHiddenProp } from './hidden-prop.js';
import { pickStreetIntersection } from './hidden-prop-logic.js';
import { createCityLife, buildGraph } from './agents.js';
import { createStreetLights } from './street-lights.js';
import { createWaterLife } from './water-life.js';
import { createLandmarkFactory } from './landmarks.js';
import { createWeatherRig } from './weather-rig.js';
import { createCloudField } from './clouds.js';
import { createInspector } from './inspect.js';
import { createPlacedLife } from './placed-life.js';
import { createWaterFlow } from './water-flow.js';
import { createDust } from './dust.js';
import { createEditor } from './editor.js';
import { createPilotController, NO_WATER } from './pilot.js';
import { createLoaderProgress } from './loader-progress.js';
import { generateTerrain, buildTerrainMesh, rebuildTerrainChunks, PRESET_KEYS, BIOMES } from './terrain.js';
import { createScatter, buildScatterGroup, reprojectScatter, scatterAdd, scatterErase, SLOPE_BY_TYPE } from './scatter.js';
import { createWorldLakes } from './world-water.js';
import { seedWorldEditorCatalog } from './catalog.js';
import { createSkyAtmosphere } from './sky-atmosphere.js';
import { createHillaireSky, GROUND_MM as HILLAIRE_GROUND_MM } from './hillaire-sky.js';   // A-SKYDOME: the Live Sky physically-based sky, opt-in via skyModel:'hillaire'
import { createCelestials } from './celestials.js';
import { createColliderWorld } from './collide.js';
import { lowSunWashK } from './sun-rig.js';
import { createPlanarReflection } from './planar-reflection.js';
import { createAircraftLights } from './aircraft-lights.js';
import { createTextureForge } from './createTextureForge.js';
import { forgeCityMaterials, CITY_LOOKS } from './forge-recipes.js';
// ARC A-LIVE: createVolumetricClouds is DYNAMICALLY imported below (only when a caller passes
// `volumetricClouds`), not statically here — a static import measurably grew EVERY consumer's
// entry bundle by ~30-40KB gzip (office/hoard/hoard2/showcase-lab included, none of which ever
// construct it), tripping tools/size-budget.test.mjs on projects with zero relationship to
// ?live=1. A dynamic import() lets Vite split the module + its shaders into their own chunk that
// is only ever fetched by a project that actually opts in — every non-opting-in consumer's
// money-path entry JS is unaffected (measured, not assumed — see HANDOFF.md Arc A-LIVE).
import {
  vectorOn, vectorTint, fogCharm, vectorShadow, weatherSnow, weatherCloud, weatherCloudOff, weatherSeason, windowRecess,
  aoStrength, reflStrength, swayTime, swayWind,
} from './vector-style.js';

import backdropVert      from './shaders/backdrop.vert';
import backdropFrag      from './shaders/backdrop.frag';
import fullscreenVert    from './shaders/fullscreen.vert';
import waterSimFrag      from './shaders/water-sim.frag';
import waterSurfaceVert  from './shaders/water-surface.vert';
import waterSurfaceFrag  from './shaders/water-surface.frag';

// L112 — night factor (city-side: renderCityPipeline + renderCityBeautyTo)
const sunDownK = (y) => 1.0 - THREE.MathUtils.smoothstep(y, -0.02, 0.45);
// F2b — horizon gate for the +0.35·sunDownK fill boost (grazing-sun washout fix).
// 0 when sun is at or above the horizon (y >= 0), ramps to 1 at y = -0.06 (sun 6° below).
// Formula: 1 - smoothstep(y, -0.06, 0). Unit-tested in city-fill-gate.test.mjs.
const nightFillGate = (y) => 1 - THREE.MathUtils.smoothstep(y, -0.06, 0);
const NIGHT_STREET_WARM = new THREE.Color('#3a2c22');
// L114 fix D: WRAP the water clock (bounds hash inputs; seamless for sin(uTime*0.9))
const WATER_CLOCK_PERIOD = (2 * Math.PI / 0.9) * 9;   // ≈62.8 s
const AERIAL_BASE = 0.016;   // always-on aerial perspective floor (additive with weather fog)

export function createCityWorld(core, { demo = false, citySeed = 0, profileIndex = 0, cityProfile = null, onEggFound = null, shadowMapSize = 2048, volumetricClouds = null, population = null, forgeLook = null, skyModel = 'preetham' } = {}) {
  // ARC A-LIVE — both additive, opt-in options, same shape as cityProfile above: default null
  // means zero behavioural OR allocation change for every existing consumer. NOTE: named
  // `volumetricClouds`, not `clouds` — this file already has a local `clouds` (createCloudField,
  // the existing 2D drifting sprite-clouds, wired below at "7f) WEATHER"); this new raymarched
  // pass is a DIFFERENT, additional system, not a replacement, and the name collision would have
  // been a `const clouds` redeclaration syntax error if left unrenamed.
  //   volumetricClouds — { coverage, noiseN, seed } | null. null (default) never constructs
  //                      createVolumetricClouds or its scratch RT — no cost unless opted in.
  //   population       — { cars, peds, boats, gulls } | null. null (default) passes through to
  //                      createCityLife/createWaterLife's own defaults (12/14/4/4) unchanged.
  // BLENDER BOUNDED PROOF — additive passthrough for citygen.js's existing `profile` override
  // (createCity() has supported a custom profile OBJECT since ARC A21; createWorldFromRecipe.js
  // already uses it — this project's OWN city just never exposed it). Default null preserves
  // every existing caller's behaviour EXACTLY (createCity falls back to PROFILES[profileIndex]),
  // so manhattan/paris/neoTokyo stay byte-identical; only an explicit cityProfile opts in.
  // Destructure stable references from core (these don't change after construction).
  const {
    renderer, scene, rig, sunRig, drawBuffer,
    sceneRT, filmicRT, beautyRT, toonRT, pixelRT,
    bloomA, bloomB, postScene, postCamera, postQuad,
    filmicMaterial, brightMaterial, blurMaterial,
    pixelMaterial, pixelkitMaterial, toonMaterial, mixMaterial,
    PALCACHE, ERA_TEX, runPass, bloomPass, godraysPass,
    OVERCAST_GREY, FOG_DENSITY, FOG_NIGHT_TINT, _fogColor,
    governor,
    updatePixelPalette, setEra, decideStyle,
  } = core;
  // Live state from core accessed via getters: core.mode, core.vector, core._qualityRefl, core._qualityShadows

  const _coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const _rmQuery = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;

  /* 3) THE SIMULATION STATE — three wave-sim render targets.
     L90 H1 — WAVE-SIM PRECISION GATE: probe for signed float buffer; fall back to flat sea when absent. */
  const _simGl = renderer.getContext();
  const waveOk = !!(_simGl && _simGl.getExtension && (_simGl.getExtension('EXT_color_buffer_float') || _simGl.getExtension('EXT_color_buffer_half_float')));
  if (!waveOk && typeof console !== 'undefined') console.info('[L90 H1] No float colour buffer — wave sim OFF, flat-sea fallback.');
  const SIM = 256;
  const rtOptions = {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false,
  };
  let targets = waveOk ? [
    new THREE.WebGLRenderTarget(SIM, SIM, rtOptions),
    new THREE.WebGLRenderTarget(SIM, SIM, rtOptions),
    new THREE.WebGLRenderTarget(SIM, SIM, rtOptions),
  ] : null;
  if (targets) { for (const t of targets) { renderer.setRenderTarget(t); renderer.clear(); } renderer.setRenderTarget(null); }
  const flatHeightTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  flatHeightTex.needsUpdate = true;

  /* 4) THE SIM PASS */
  const simScene = new THREE.Scene();
  const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const simMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: waterSimFrag,
    uniforms: {
      uCurr: { value: null }, uPrev: { value: null },
      uTexel: { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
      uMouse: { value: new THREE.Vector2(-1, -1) }, uMouseStrength: { value: 0 },
      uC2: { value: 0.25 }, uDamping: { value: 0.992 },
      uRainCount: { value: 0 },
      uRainDrops: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uWakeCount: { value: 0 },
      uWakeDrops: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uWash: { value: new THREE.Vector4(0, 0, 0, 0.02) },
    },
  });
  simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial));

  /* 5) THE GRAB-PASS TARGET */
  const grabDepth = new THREE.DepthTexture(drawBuffer.x, drawBuffer.y);
  const grabRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, depthTexture: grabDepth,
  });

  /* 6) BEHIND-WATER CONTENT */
  function makeCardTexture(neutral) {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d');
    x.fillStyle = neutral ? '#0c1418' : '#15110b'; x.fillRect(0, 0, 1024, 1024);
    x.strokeStyle = neutral ? 'rgba(120,150,170,0.22)' : 'rgba(184,153,104,0.30)'; x.lineWidth = 2;
    for (let i = 0; i <= 1024; i += 64) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke();
    }
    if (!neutral) {
      x.fillStyle = '#B89968';
      x.font = 'bold 360px Georgia, serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('LGR', 512, 470);
      x.font = '600 64px ui-monospace, monospace';
      x.fillText('WEB · STUDIO', 512, 720);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const WATER_SIZE = 28;
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE),
    new THREE.MeshBasicMaterial({ map: makeCardTexture(demo) })
  );
  const _cardTint = new THREE.Color(1, 1, 1);   // seabed albedo the per-frame night-dim multiplies (white = legacy)
  card.rotation.x = -Math.PI / 2;
  card.position.y = -0.35;
  scene.add(card);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.ShaderMaterial({
      depthWrite: false, vertexShader: backdropVert, fragmentShader: backdropFrag,
      uniforms: {
        uTime: { value: 0 },
        uInk:  { value: sunRig.horizon },
        uGold: { value: sunRig.sky },
        uFogColor: { value: _fogColor },
        uFogAmt:   { value: 0 },
        uFogCharm: fogCharm,
      },
    })
  );
  backdrop.position.set(0, 3, -8);
  scene.add(backdrop);

  /* 7) THE VISIBLE WATER */
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterSurfaceVert,
    fragmentShader: waterSurfaceFrag,
    uniforms: {
      uHeight:         { value: waveOk ? null : flatHeightTex },
      uScene:          { value: grabRT.texture },
      uTexel:          { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
      uResolution:     { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uDisplace:       { value: 0.42 },
      uNormalStrength: { value: 22.0 },
      uRefractStrength:{ value: 0.06 },
      uChromaScale:    { value: 1.0 },
      uNormalMatrix:   { value: new THREE.Matrix3() },
      uLightDir:       { value: sunRig.sunDir },
      uInk:            { value: new THREE.Color('#2A2218') },
      // art pass 2026-08-06 (look bible §4): the beauty sea's own depth colours — shallow teal → deep
      // sea blue. Stylized tiers never read these (their path keeps uInk at flat 0.12 absorb).
      uDeepCol:        { value: new THREE.Color('#1B4A66') },
      uShallowCol:     { value: new THREE.Color('#4FA3A8') },
      uStylizedSea:    { value: 0 },   // A-SEA: stylized tiers' sea read, opt-in (0 = legacy, baselines green)
      uGold:           { value: new THREE.Color('#B89968') },
      uSkyRefl:        { value: 0.0 },
      uSkyReflCol:     { value: sunRig.sky },
      uReflect:        { value: null },
      uReflStrength:   { value: 0.0 },
      uReflDistortMul: { value: 0.6 },
      uFoamStrength:   { value: 0.0 },
      uTime:           { value: 0 },
      uGrabDepth:      { value: grabDepth },
      uNear:           { value: 0.1 }, uFar: { value: 100 }, uIsPerspective: { value: 1.0 },
      uGlintK:         { value: 0.0 },
      uSunCol:         { value: sunRig.sunColor },
      uVector:         vectorOn,
      uVecWater:       { value: new THREE.Color('#1fb8d8') },
      uVecTint:        { value: vectorTint },
    },
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE, SIM - 1, SIM - 1), waterMaterial);
  water.rotation.x = -Math.PI / 2;
  water.updateMatrixWorld(true);
  waterMaterial.uniforms.uNormalMatrix.value.getNormalMatrix(water.matrixWorld);
  scene.add(water);

  /* 7b) THE UNDERSIDE OF THE SEA (A-FISH, 2026-08-07) — the ceiling you see when you are under it.
     -------------------------------------------------------------------------------------------
     The visible water above is a FrontSide plane with an up normal (no `side:` key → three's default),
     so from below the waterline it is backface-culled and you see straight through to the sky. Measured,
     not assumed: `water.material.side` reads 0 (THREE.FrontSide) at runtime. That is the difference
     between "I am underwater" and "the renderer is broken".

     WHY A SECOND MESH INSTEAD OF `side: DoubleSide` ON THE REAL ONE: water-surface.frag is grab-pass
     refraction + depth absorption authored strictly for looking DOWN through the surface, and it has no
     gl_FrontFacing branch anywhere. Turning it double-sided would run that whole model backwards on the
     underside, and — the deciding reason — that shader sits under the byte-identical tier baselines
     (docs/engine-invariants.md), which projects/city depends on. A separate, opaque, down-facing plane
     costs one draw call, cannot perturb the tier guard, and is the shape the look actually wants: from
     below, water reads as a bright flat ceiling, not as refraction.

     DEFAULT OFF. `visible = false` until a consumer calls setUnderwater(), so every existing city is
     byte-identical and pays nothing. */
  const underMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color('#2f7f96'), side: THREE.BackSide, fog: true, depthWrite: false,
  });
  const underside = new THREE.Mesh(new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE), underMaterial);
  underside.rotation.x = -Math.PI / 2;
  underside.position.y = -0.012;      // a hair under the real surface: never z-fights, never pokes through
  underside.visible = false;
  underside.raycast = () => {};
  scene.add(underside);

  /* The underwater STATE, owned here because a project physically cannot own it: the per-frame block
     below rewrites scene.fog.density AND scene.fog.color every frame INSIDE the render, after any
     project frame callback has run. This engine has already been bitten by that twice (see the notes
     at the nightFill and seabed-tint seams). Underwater fog has to live in the writer or it does not
     live at all. */
  const UW_FILL = 3.2;                              // hemisphere intensity while fully submerged
  const UW_GROUND = new THREE.Color('#0a2b33');     // the dark bottom half of the underwater hemisphere
  const WHITE_C = new THREE.Color(1, 1, 1);
  let _uw = null;   // null = the feature does not exist for this city (byte-identical)
  const _uwColor = new THREE.Color();   // scratch, built once (the no-hot-alloc invariant)
  const _uwFloor = new THREE.Color();   // ditto — the stylized-tier toon floor while submerged
  const _uwFill = new THREE.Color();    // ditto — the submerged hemisphere fill colour
  let _uwK = 0;   // 0 above water, 1 fully submerged. Computed in updateWorld, CONSUMED in
                  // renderCityPipeline — those run in that order every frame, and the fill light must
                  // be written in the LATTER or the render's own fill line overwrites it.

  /* L108 PLANAR MIRROR — city-owned RT + mirror camera. */
  const planarRefl = createPlanarReflection({ drawBuffer, planeY: 0 });
  waterMaterial.uniforms.uReflect.value = planarRefl.reflRT.texture;

  /* ARC A-LIVE — the volumetric clouds pass + its scratch composite RT. Constructed ONLY when a
     caller opts in via `volumetricClouds` (default null — every existing consumer, incl. plain
     `city` with no ?live=1, allocates nothing extra and pays nothing extra, and now — after the
     dynamic-import fix above — DOWNLOADS nothing extra either). `let`, not `const`: both start
     null and are filled in a beat later once the dynamically-imported module resolves; every
     reader (cloudsComposite, updateWorld's clouds-update block) already null-checks cloudsHandle,
     so the few frames before it resolves simply render with clouds off — a graceful cold start,
     not a race. HalfFloat, NOT the default UnsignedByte: this target sits between the HDR beauty
     render and the ACES tonemap, and letting HDR beauty data pass through an 8-bit buffer clips it
     flat before tonemap ever sees it (the same invariant beautyRT itself exists to protect). Not
     multisampled (unlike beautyRT) — only the WRITE side needs its own target; the READ side
     samples beautyRT.texture directly, the exact same multisampled-RT read bloomPass/godraysPass
     already do every frame. */
  let cloudsHandle = null, cloudsRT = null;
  const _cloudTint = new THREE.Color(), _cloudGrey = new THREE.Color(), _cloudSun = new THREE.Color();   // scratch for the low-sun cloud-ambient desat (no-hot-alloc)
  if (volumetricClouds) {
    import('./createVolumetricClouds.js').then(({ createVolumetricClouds }) => {
      cloudsHandle = createVolumetricClouds({
        noiseN: volumetricClouds.noiseN ?? 32, seed: volumetricClouds.seed ?? 1337, coverage: volumetricClouds.coverage ?? 0.5,
      });
      cloudsRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
        minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
        depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType,
      });
      /* Feed the pass this frame's scene depth so buildings occlude cloud. grabDepth is the RIGHT
         source and costs nothing: renderCityPipeline renders the full scene into grabRT with the
         SAME camera immediately before the beauty render (:1064), so it is current and aligned —
         no second depth attachment, and none of the MSAA-depth-resolve trouble beautyRT would bring. */
      cloudsHandle.setSceneDepth(grabDepth);
    }).catch((e) => { if (typeof console !== 'undefined') console.warn('[ARC A-LIVE] volumetric clouds failed to load', e); });
  }
  /* cloudsComposite(srcRT) — called from BOTH beauty branches in renderCityPipeline, right after
     the scene renders into beautyRT and BEFORE bloomPass/godraysPass read it, so bright cloud edges
     bloom and god-rays can shaft through cloud gaps — the same ordering the proven reference
     consumer (examples/sky-lift's EffectComposer chain: clouds -> rays -> grade) already uses; city
     just drives the pass's own public render(renderer, writeBuffer, readBuffer) method directly
     instead of through an EffectComposer (city has no EffectComposer — its whole post chain is the
     hand-rolled runPass() below). Off or governor-degraded -> returns srcRT UNCHANGED (a real
     passthrough the caller always uses via the return value, not a silent skip). Governor cutoff
     matches godraysPass's own `governor.level < 2` exactly — a raymarched pass is at least as
     expensive as god-rays, so it degrades on the same schedule, not a new one. */
  function cloudsComposite(srcRT) {
    if (!cloudsHandle || governor.level >= 2) return srcRT;
    cloudsHandle.pass.render(renderer, cloudsRT, srcRT);
    return cloudsRT;
  }

  /* SEAM A: city registers its cache-invalidator with core's context-restore listener.
     Runs once after envTex/skyAtmo exist (they're created in the sky section below). */
  // Forward-ref: set after the sky section creates envTex/_lastEnvSeg.
  // Done via core.onContextRestored() call below (after envTex is declared).

  /* SEAM B: register city's content resizers with core's resize registry. */
  core.registerContentResizer((db) => {
    grabRT.setSize(db.x, db.y);     // L112 foam: resizes grabRT's attached grabDepth DepthTexture too
    planarRefl.setSize(db);          // L108: half-res mirror RT tracks resize
    cloudsRT?.setSize(db.x, db.y);   // ARC A-LIVE: no-op when clouds is off (cloudsRT is null)
    waterMaterial.uniforms.uResolution.value.set(db.x, db.y);
  });

  /* ARC A-ART — the CITY TEXTURE FORGE. `createTextureForge` (Beauty B1) had exactly one consumer
     before this arc (hoard2) and the city wired NONE of it — the module's own header says its
     purpose is "so a project's world stops being flat-coloured", which is precisely why city
     buildings render as flat tinted boxes. Opt-in only (`forgeLook` null by default — every
     existing consumer of createCityWorld, and the default city itself, allocates zero forge state
     and stays byte-identical, same additive shape as volumetricClouds/population above). When a
     look is requested: bake CITY_SURFACES (facade/concrete/asphalt/roof/glass, forge-recipes.js)
     with that look's recipe overrides, and hand citygen.js a small, decoupled map-bundle — `wall`
     (facade for warm/contrast, glass for the glass-and-steel look — CITY_LOOKS.wallSurface decides
     which), `roof`, `road`, `concrete`. citygen.js itself stays look-agnostic; it only ever sees
     "the wall material" / "the roof material", never the look name.
     PRECISION FLOOR (same guard hoard2 already relies on): forge.supported === false on iOS-p0 (no
     highp fragment) → makeMaterial() returns the recipe's flat fallbackColor, so a phone that can't
     bake never regresses below today's flat-box look — it just doesn't gain the new one either. */
  let cityForge = null, cityForgeMaterials = null;
  if (forgeLook) {
    cityForge = createTextureForge({ renderer });
    cityForgeMaterials = forgeCityMaterials(cityForge, { look: forgeLook });
  }
  const forgeMaterials = cityForgeMaterials ? {
    wall: cityForgeMaterials[(CITY_LOOKS[forgeLook] && CITY_LOOKS[forgeLook].wallSurface) || 'facade'],
    roof: cityForgeMaterials.roof,
    road: cityForgeMaterials.asphalt,
    concrete: cityForgeMaterials.concrete,
  } : null;

  /* 7b) THE CITY */
  const windowGlow = { value: 0.0 };
  const loaderProgress = createLoaderProgress();
  const landmarkFactory = createLandmarkFactory({ windowGlow, manager: loaderProgress.manager });
  const city = createCity({ seed: citySeed, profileIndex, profile: cityProfile, landmarkFactory, windowGlow, forgeMaterials });
  scene.add(city.group);

  /* 7c) CITY LIFE */
  const cityLife = createCityLife({
    plinthTop: 0.3, extent: city.extent, profile: city.state.profile,
    // ARC A-LIVE: population?.cars/peds undefined → createCityLife's own defaults (12/14) apply.
    ...(population?.cars != null ? { carCount: population.cars } : {}),
    ...(population?.peds != null ? { pedCount: population.peds } : {}),
  });
  scene.add(cityLife.group);

  /* 7c-b) STREET LIGHTS */
  const streetLights = createStreetLights({ graph: buildGraph() });
  scene.add(streetLights.group);

  /* 7d) WATER LIFE */
  const waterLife = createWaterLife({
    extent: city.extent, waterSize: WATER_SIZE, plinthTop: 0.3,
    // ARC A-LIVE: population?.boats/gulls undefined → createWaterLife's own defaults (4/4) apply.
    ...(population?.boats != null ? { boatCount: population.boats } : {}),
    ...(population?.gulls != null ? { gullCount: population.gulls } : {}),
  });
  scene.add(waterLife.group);
  simMaterial.uniforms.uWakeDrops.value = waterLife.wakeDrops;

  /* 7f) WEATHER */
  const weatherRig = createWeatherRig({ extent: city.extent });
  scene.add(weatherRig.group);
  simMaterial.uniforms.uRainDrops.value = weatherRig.rainDrops;

  /* 7h) CLOUDS */
  const clouds = createCloudField({ extent: city.extent });
  scene.add(clouds.group);

  /* L63 INSPECTION LENS */
  const inspectorSources = [cityLife, waterLife, clouds];
  const inspector = createInspector({ rig, getCamera: () => rig.camera, sources: inspectorSources });

  /* L52 CELESTIALS */
  const celestials = createCelestials();
  scene.add(celestials.group);

  /* L66 PREETHAM ATMOSPHERIC SKY */
  const skyAtmo = createSkyAtmosphere({ scale: 90 });
  scene.add(skyAtmo.mesh);
  scene.environmentIntensity = 0.32;
  /* A-SKYDOME (2026-08-05): the Hillaire physically-based sky, lifted from lgr-live-sky (see
     hillaire-sky.js's header). OPT-IN (`skyModel: 'hillaire'`) — the default 'preetham' path is
     byte-identical for every existing consumer. Under Hillaire the sky is correct at ALL hours
     (real ozone twilight, the sunrise wavefront, physical night darkening), so beauty never falls
     back to the backdrop plane at any time of day — the whole dome/backdrop regime-boundary class
     (the twilight red wall, the -0.22 gate pops) does not exist on this path. sunDisc:false — the
     city's ONE visible sun stays celestials' depth-occluded sprite (the L98c rule). IBL note,
     deliberate + documented: ensureEnv still PMREMs the PREETHAM env twin — the ambient tracks the
     same sun through the same keyframes, and one env source keeps the throttled bucket machinery
     untouched; revisit only if lit surfaces visibly disagree with the Hillaire dome. */
  const hillaire = skyModel === 'hillaire' ? createHillaireSky({ renderer, sunDisc: false }) : null;
  if (hillaire) {
    hillaire.computeStaticLUTs(); scene.add(hillaire.skyMesh); hillaire.skyMesh.visible = false;
    /* EXPOSURE CALIBRATION (measured, 2026-08-05): live-sky's 18 is tuned for its flat-ACES chain
       (expoScale 0.20); the engine's beauty chain (sunRig exposure → ACES → grade) needs ~220 for
       the noon sky to land on the art targets (mid-sky ≈ #6FA0D8 — pixel-swept e18→e240 live).
       Night stays physically near-black at any exposure (radiance ≈ 0). */
    hillaire.setExposure(220);
  }
  const _hillView = new THREE.Vector3(0, HILLAIRE_GROUND_MM + 0.0002, 0);   // ~200 m eye — city scale
  let _skyOn = false;
  let _backdropAllowed = true;   // setUrbanVisible records intent here; applySky is the ONE writer of backdrop.visible
  let _submerged = false;        // A-FISH: camera below the waterline — hides the (unfogged) sky + backdrop
  function setSkyTier(beauty) {
    /* TWILIGHT GATE (2026-08-05, metropolis day-sweep; PREETHAM PATH ONLY): was -0.04 — the dome cut
       out the moment the sun dipped, handing the sky to the legacy 40×24 BACKDROP PLANE for ~47% of
       the cycle — a free camera renders that plane as a floating blood-red wall at twilight (measured
       t=0.21/0.76). -0.22 keeps the Preetham dome through civil+nautical twilight; the backdrop only
       rules deep night, where its navy reads as dark sky. Beauty-gated → stylized byte-identical. */
    const on = hillaire ? beauty : (beauty && sunRig.sunArc.y > -0.22);
    if (on === _skyOn) return;
    _skyOn = on;
    applySky();
  }
  /* applySky() — A-FISH. The visibility WRITE, split out of setSkyTier so submersion can re-run it
     without becoming a second writer of backdrop.visible. That single-owner rule is not stylistic:
     the comment above it records a real dual-writer bug (setUrbanVisible vs setSkyTier) that this
     file already paid for once, and setSkyTier early-returns on an unchanged tier, so an underwater
     branch writing these directly from the frame loop would be overwritten or would fight it.

     WHY SUBMERSION MUST HIDE THE SKY AT ALL: fog is geometry-only. The dome and the backdrop plane
     both render unfogged, so from under the surface you could see a bright blue horizon band past the
     edge of the seabed — sky, underwater, at eye level. Caught by looking at a capture, not a number.
     With them hidden, anything past the geometry is the clear colour, which the frame writer has
     already tinted to the water column. */
  function applySky() {
    const on = _skyOn && !_submerged;
    if (hillaire) {
      hillaire.skyMesh.visible = on;
      skyAtmo.mesh.visible = false;                  // Preetham never draws on the hillaire path (it still feeds buildEnv via its env twin)
    } else {
      skyAtmo.mesh.visible = on;
    }
    backdrop.visible = !_skyOn && _backdropAllowed && !_submerged;   // single owner (the setUrbanVisible dual-writer fix)
  }

  /* L67 SKY-IBL throttle */
  let envTex = null, _lastEnvSeg = -1;
  // A6-0a — the IBL env is a PMREM of the Preetham sky, REBUILT only when the quantized `seg` bucket changes
  // (else it holds a stale snapshot — PMREM is too costly to rebuild every frame). The CITY default is 4
  // buckets/cycle, whose boundaries fall AT the horizon crossings (t=.25/.75): so the afternoon bucket's env is
  // built at NOON (bright) and HELD all the way to dusk, then SNAPS to the below-horizon dark env at the
  // crossing — measured as the dusk "flash-to-dark" (env-on 119→54 in one second while lights stay put; the
  // sunDir swap is byte-stable, ruled out). Consumers that want a SMOOTH dusk raise the bucket count so the env
  // tracks the descending sun in small steps instead of holding noon then snapping. Default 4 → CITY
  // BYTE-IDENTICAL (never raised there); hoard2 opts in via setEnvSegments.
  let _envSegments = 4;
  const setEnvSegments = (n) => { _envSegments = Math.max(4, Math.floor(n) || 4); };
  // art pass 2026-08-06 — daytime hemisphere boost for street-level consumers (see the fill drive)
  let _dayFillBoost = 0;
  const setDayFillBoost = (v) => { _dayFillBoost = Number.isFinite(v) ? Math.max(0, v) : 0; };
  // SEAM A: now that envTex/_lastEnvSeg exist, register the context-restore invalidator.
  core.onContextRestored(() => { envTex = null; _lastEnvSeg = -1; renderer.shadowMap.needsUpdate = true; });
  function ensureEnv() {
    const seg = Math.floor((sunRig.t % 1) * _envSegments) % _envSegments;
    if (seg !== _lastEnvSeg || !envTex) { _lastEnvSeg = seg; envTex = skyAtmo.buildEnv(renderer); }
    return envTex;
  }

  /* 7g) PROCEDURAL TERRAIN WORLD */
  let terrainGroup = null, scatterGroup = null, lakeGroup = null, worldData = null, worldActive = false, worldSeed = 1234, worldPreset = 'valley';
  const WORLD_SIZE = 26;
  const BIOME_KEYS = BIOMES.map((b) => b.key);
  const lakeMat = new THREE.MeshStandardMaterial({ color: '#3f6f8c', roughness: 0.07, metalness: 0.4, transparent: true, opacity: 0.9 });
  const URBAN = () => [city.group, cityLife.group, waterLife.group, streetLights.group];
  const WORLD_GROUPS = () => [terrainGroup, scatterGroup, lakeGroup].filter(Boolean);
  function buildWorld() {
    for (const g of WORLD_GROUPS()) { scene.remove(g); g.userData.dispose?.(); }
    const data = generateTerrain({ seed: worldSeed, size: 160, preset: worldPreset });
    worldData = data;
    terrainGroup = buildTerrainMesh(data, { worldSize: WORLD_SIZE, baseY: 0, chunks: 6 });
    scatterGroup = createScatter({ terrain: data, seed: worldSeed, worldSize: WORLD_SIZE, baseY: 0, biomeKeys: BIOME_KEYS });
    lakeGroup = createWorldLakes(data, { worldSize: WORLD_SIZE, baseY: 0, maxLakes: 3, material: lakeMat });
    for (const g of WORLD_GROUPS()) { g.visible = worldActive; scene.add(g); }
    if (typeof placedLife !== 'undefined' && placedLife) placedLife.clear();
    if (typeof waterFlow !== 'undefined' && waterFlow) waterFlow.clear();
    if (typeof window !== 'undefined') window.__world = { seed: worldSeed, preset: worldPreset, active: worldActive, chunks: terrainGroup.children.length, scatter: scatterGroup.userData.counts, lakes: lakeGroup.userData.count };
  }
  const setWorldVisible = (on) => { for (const g of WORLD_GROUPS()) g.visible = on; };

  /* L HOARD-3 — RUN THE ENGINE WITHOUT THE CITY. A non-city map (the forest arena) needs the renderer +
     rig + post + SunRig but NOT the urban world. This hides every city-ground group (buildings/streets +
     traffic + boats + street-lights, which aren't otherwise exposed) plus the bay water + the far-city
     backdrop, while KEEPING the sky (atmosphere + sun/moon + clouds) so day/night still plays overhead.
     Default (on=true) is the city's normal state → byte-identical when never called. */
  const setUrbanVisible = (on) => {
    for (const g of URBAN()) g.visible = on;   // city.group · cityLife · waterLife · streetLights
    water.visible = on;
    /* BACKDROP SINGLE-OWNER FIX (A-SKYDOME design pass, 2026-08-05): this line used to write
       backdrop.visible directly — and setSkyTier's else-branch would then RE-SHOW the plane at the
       next twilight crossing, resurrecting the hidden backdrop in metropolis/hoard2 (the dual-writer
       conflict the constraints agent flagged). Now this seam records INTENT (_backdropAllowed) and
       setSkyTier — the one owner — ANDs it in on every flip. */
    _backdropAllowed = on;
    backdrop.visible = on && !_skyOn;
  };

  /* B2 WORLD-TRUTH — WATER IS CONTEXTUAL (the parameterized enable seam). The bay water plane + its
     ripple sim belong to the CITY; a non-city map (hoard2's forest arena) has no water body and must
     not render one. Before this, setUrbanVisible(false) set water.visible=false but the per-frame
     refraction-grab in renderCityPipeline RESTORED it (`water.visible = !_editing`), so the square
     rippling sim plane re-appeared under the map every frame (owner's phantom-water bug). `_waterOn`
     (DEFAULT true → city byte-identical, never called there) gates every per-frame water-visibility
     restore; setWaterEnabled(false) is the world's declaration of "no water body here".
     FUTURE LIFT (owner's manifest, "for now" = not this arc): contextual ponds/lakes/shorelines placed
     ON TOP of a world's ground via a region seam — this enable flag is its foundation. */
  let _waterOn = true;
  const setWaterEnabled = (on) => {
    _waterOn = !!on;
    water.visible = _waterOn;
    if (!_waterOn) { waterFlow.group.visible = false; if (lakeGroup) lakeGroup.visible = false; }
  };

  /* B2 finding #6 — POST chromatic aberration. The beauty grade adds a screen-space CA (uChroma×CA_STRENGTH,
     scaling with r² — strongest at frame edges, per post-filmic.frag); on hoard2's bright thin dead/live
     tree trunks it read as loud rainbow fringing (both B1 critics flagged it), so hoard2 dialled it to
     ~0.3 (a filmic hint, not a rainbow).
     ARC A-BEAUTY ROOT CAUSE (Finding 1, "chromatic fringing on every edge" — measured, not asserted): the
     CITY never took hoard2's own fix. At the OLD default (1.0 — full CA_STRENGTH at the frame edges), a
     typical city camera framing puts the skyline and most on-screen content well off-centre (large r), so
     the r²-scaled offset is severe enough to read as a whole-frame SMEAR, not a subtle edge hint — directly
     confirmed: forcing the SAME chromaScale hoard2 already uses (0.3), same camera/time/seed, turned an
     illegible smeared frame into a fully legible one (see HANDOFF.md Arc A-BEAUTY for the screenshots).
     City now ships hoard2's already-validated value as its OWN default — this changes the BEAUTY tier only
     (post-filmic.frag forces uChroma=0 for every stylized pass regardless of this scale, so tier-guard's
     noon/stylized byte-identical proof is untouched); `setChromaScale` remains available for any consumer
     that wants a different value. */
  let _chromaScale = 0.3;
  const setChromaScale = (s) => { _chromaScale = Math.max(0, s); };

  /* B2 finding #5 — GRADE warm→cool "rot" candidate (owner decides taste; this is the knob for the A/B).
     _gradeCool (0 = the keyframed WARM grade, city default, byte-identical; 1 = full cool/grim) pulls the
     beauty white-balance OFF warm (→ the cooler sky-IBL cast reads) and desaturates toward a rotting mood.
     Scoped per-consumer (each project owns its engine); hoard2 exposes it as ?gradecool for the owner A/B. */
  let _gradeCool = 0.0;
  const setGradeCool = (a) => { _gradeCool = Math.min(1, Math.max(0, a)); };

  /* A6-0b — SUN EXCEPTION amount for the filmic grade. 0 = off → the grade darkens/cools the sun with the rest
     (city default → byte-identical); >0 (hoard2 opts in) → the bright+warm sun disc survives the cool grade as
     its post-ACES HOT self while the cool palette holds everywhere else (DESIGN ruling). Feeds uSunException. */
  let _sunException = 0.0;
  const setSunException = (a) => { _sunException = Math.min(1, Math.max(0, +a || 0)); };
  const _sunProj = new THREE.Vector3(), _camFwd = new THREE.Vector3();   // A6-0b scratch: project the sun to screen

  function worldHeightAt(wx, wz) {
    if (!worldData) return 0;
    const { size, height, sea, relief } = worldData;
    const cell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2;
    const ci = Math.round((wx + half) / cell), cj = Math.round((wz + half) / cell);
    const i = ci < 0 ? 0 : ci >= size ? size - 1 : ci, j = cj < 0 ? 0 : cj >= size ? size - 1 : cj;
    return (height[j * size + i] - sea) * relief;
  }

  const placedLife = createPlacedLife({ heightAt: worldHeightAt, seaSurfaceY: 0, waterY: 0.06 });
  placedLife.group.visible = false;
  scene.add(placedLife.group);
  inspectorSources.push(placedLife);

  /* ---- THE HIDDEN CARDBOARD BOX (egg v2) ------------------------------------------------
     A box dropped on a street crossing somewhere in the city. Fly near it once and the "!"
     chip stings. `createHiddenProp` adds its OWN always-visible group to the scene — note we
     do NOT parent it to `placedLife.group` two lines above, which is `visible = false` in
     city mode: a box there would be invisible in flight while still shifting the render
     baseline. (Being wrong in two directions at once is how a bug hides from its own test.)

     Placement is a seed-picked STREET INTERSECTION from the exported LAYOUT. Buildings only
     ever stand on blocks, so a street crossing is collision-free by construction — no probe,
     no raycast, no retry loop. The salt keeps the egg's PRNG stream independent of the city's
     own, so the two never share a draw order.

     SCOPE OF THE DETERMINISM: the spot is a pure function of the citySeed the world was
     CONSTRUCTED with, so `?city=X` always hides the box in the same place — that is the
     "tell a friend" property. It is computed ONCE here: an in-session reroll (`G` →
     `city.generate(...)`) rebuilds the blocks but does NOT re-site the box. That is safe (the
     street grid is seed-INVARIANT — always ±4.9/±2.45/0 — so the box stays on a real street,
     never inside a new building), it just means a rerolled city keeps the previous city's
     hiding spot. Re-siting on reroll is a DESIGN call (it would teleport the box mid-flight
     and needs a latch-reset policy), so it is flagged in HANDOFF, not silently invented. */
  const EGG_SEED_SALT = 0xB0B1E5;
  const EGG_SIZE = 0.5;
  const _eggRnd = mulberry32((citySeed ^ EGG_SEED_SALT) >>> 0)();
  const _eggAt = pickStreetIntersection(LAYOUT, _eggRnd);
  const hiddenBox = createHiddenProp({
    scene,
    // street slab sits at PLINTH_TOP + 0.02 (citygen.js:316); rest the box ON it, not in it.
    at: { x: _eggAt.x, y: LAYOUT.PLINTH_TOP + 0.02 + EGG_SIZE / 2, z: _eggAt.z },
    radius: 5,
    size: EGG_SIZE,
    onEnter: () => { if (onEggFound) onEggFound(); },
  });

  /* L104 SEIZE-CRAFT SEAM */
  const seizeGroup = new THREE.Group(); seizeGroup.raycast = () => {}; scene.add(seizeGroup);
  let seizeEnt = null;
  let _aircraftLights = null;
  function spawnSeizeCraft(kind, sx = 0, sz = 0, opts = {}) {
    if (seizeEnt) { seizeGroup.remove(seizeEnt.obj); placedLife.despawn(seizeEnt); seizeEnt = null; }
    _aircraftLights = null;
    seizeEnt = placedLife.spawn(kind, sx, sz, { ...opts, ephemeral: true });
    if (seizeEnt) { placedLife.group.remove(seizeEnt.obj); seizeGroup.add(seizeEnt.obj); }
    if (seizeEnt && kind === 'heli') { _aircraftLights = createAircraftLights(); seizeEnt.obj.add(_aircraftLights.group); }
    return seizeEnt ? seizeEnt.followable : null;
  }

  /* L81 LIVE WATER FLOW */
  let _erosTick = 0;
  function applyErosion(delta, n) {
    if (!worldData || !terrainGroup) return;
    const { size, height, relief } = worldData;
    const fineCell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2, coarseCell = WORLD_SIZE / (n - 1);
    const invRelief = relief > 1e-6 ? 1 / relief : 0;
    let touched = false;
    for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++) {
      const d = delta[cj * n + ci]; if (d === 0) continue;
      touched = true;
      const dNorm = d * invRelief;
      const fi = (ci * coarseCell) / fineCell, fj = (cj * coarseCell) / fineCell;
      const i0 = Math.max(0, Math.round(fi - 1)), i1 = Math.min(size - 1, Math.round(fi + 1));
      const j0 = Math.max(0, Math.round(fj - 1)), j1 = Math.min(size - 1, Math.ceil(fj + 1));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const idx = j * size + i; const h = height[idx] + dNorm; height[idx] = h < 0 ? 0 : h > 1 ? 1 : h;
      }
    }
    if (!touched) return;
    _erosTick++;
    if (_erosTick % 8 === 0) rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children);
    if (_erosTick % 24 === 0 && scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });
  }
  function syncErodedTerrain(delta, n) {
    if (!worldData || !terrainGroup) return;
    const { size, height, relief } = worldData;
    const invRelief = relief > 1e-6 ? 1 / relief : 0;
    const scale = (n - 1) / (size - 1);
    let touched = false;
    for (let j = 0; j < size; j++) {
      const cj = j * scale, j0 = Math.floor(cj), fj = cj - j0, j1 = Math.min(n - 1, j0 + 1);
      for (let i = 0; i < size; i++) {
        const ci = i * scale, i0 = Math.floor(ci), fi = ci - i0, i1 = Math.min(n - 1, i0 + 1);
        const d00 = delta[j0 * n + i0], d10 = delta[j0 * n + i1], d01 = delta[j1 * n + i0], d11 = delta[j1 * n + i1];
        const d = (d00 * (1 - fi) + d10 * fi) * (1 - fj) + (d01 * (1 - fi) + d11 * fi) * fj;
        if (d !== 0) { touched = true; const idx = j * size + i; const h = height[idx] + d * invRelief; height[idx] = h < 0 ? 0 : h > 1 ? 1 : h; }
      }
    }
    if (!touched) return;
    rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children);
    if (scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });
  }
  const waterFlow = createWaterFlow({ worldHeightAt, applyErosion, syncErodedTerrain, worldSize: WORLD_SIZE, grid: 96, seaY: 0, renderer });
  waterFlow.group.visible = false;
  scene.add(waterFlow.group);

  const dust = createDust({ extent: WORLD_SIZE, count: _coarse ? 500 : 2000 });
  dust.group.visible = false;
  scene.add(dust.group);

  /* L69 SCULPT */
  let _repoolTimer = null;
  let _editing = false;
  const _dirty = new Set();
  function repoolWater() {
    if (!worldData || !lakeGroup) return;
    scene.remove(lakeGroup); lakeGroup.userData.dispose?.();
    lakeGroup = createWorldLakes(worldData, { worldSize: WORLD_SIZE, baseY: 0, maxLakes: 3, material: lakeMat });
    lakeGroup.visible = worldActive && !_editing;
    scene.add(lakeGroup);
    if (window.__world) window.__world.lakes = lakeGroup.userData.count;
  }
  function settleSculpt() {
    repoolWater();
    if (scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });
  }
  function rebuildAllChunks() { if (terrainGroup) rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children); }
  function sculpt(wxx, wzz, dir = 1, radius = 2.2, strength = 0.05) {
    if (!worldData || !terrainGroup) return;
    const size = worldData.size, cell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2;
    const gi = (wxx + half) / cell, gj = (wzz + half) / cell;
    const R = radius / cell;
    const iMin = Math.max(0, Math.floor(gi - R)), iMax = Math.min(size - 1, Math.ceil(gi + R));
    const jMin = Math.max(0, Math.floor(gj - R)), jMax = Math.min(size - 1, Math.ceil(gj + R));
    const h = worldData.height, sig2 = 2 * (R * 0.5) * (R * 0.5);
    for (let j = jMin; j <= jMax; j++) for (let i = iMin; i <= iMax; i++) {
      const d2 = (i - gi) * (i - gi) + (j - gj) * (j - gj);
      if (d2 > R * R) continue;
      const v = h[j * size + i] + dir * strength * Math.exp(-d2 / sig2);
      h[j * size + i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    _dirty.clear();
    for (const mesh of terrainGroup.children) {
      const m = mesh.userData.chunk;
      if (m && m.i0 <= iMax && m.i1 >= iMin - 1 && m.j0 <= jMax && m.j1 >= jMin - 1) _dirty.add(mesh);
    }
    rebuildTerrainChunks(terrainGroup, worldData, _dirty);
    if (_repoolTimer) clearTimeout(_repoolTimer);
    _repoolTimer = setTimeout(settleSculpt, 140);
  }
  function paintBiome(wxx, wzz, biomeIdx, radius = 2.2) {
    if (!worldData || !terrainGroup || biomeIdx == null) return;
    const size = worldData.size, cell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2;
    const gi = (wxx + half) / cell, gj = (wzz + half) / cell;
    const R = radius / cell, R2 = R * R;
    const iMin = Math.max(0, Math.floor(gi - R)), iMax = Math.min(size - 1, Math.ceil(gi + R));
    const jMin = Math.max(0, Math.floor(gj - R)), jMax = Math.min(size - 1, Math.ceil(gj + R));
    const bi = worldData.biome;
    for (let j = jMin; j <= jMax; j++) for (let i = iMin; i <= iMax; i++) {
      if ((i - gi) * (i - gi) + (j - gj) * (j - gj) <= R2) bi[j * size + i] = biomeIdx;
    }
    _dirty.clear();
    for (const mesh of terrainGroup.children) {
      const m = mesh.userData.chunk;
      if (m && m.i0 <= iMax && m.i1 >= iMin - 1 && m.j0 <= jMax && m.j1 >= jMin - 1) _dirty.add(mesh);
    }
    rebuildTerrainChunks(terrainGroup, worldData, _dirty, true);
  }
  const SCATTER_KEYS = ['tree', 'rock', 'tuft'];
  function paintScatter(wxx, wzz, { type = 'tree', density = 0.5, radius = 2.2, erase = false } = {}) {
    if (!worldData || !scatterGroup) return 0;
    if (erase) return scatterErase(scatterGroup, type || 'all', wxx, wzz, radius);
    const size = worldData.size, cell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2;
    const h = worldData.height, sea = worldData.sea, relief = worldData.relief;
    const clampI = (i) => (i < 0 ? 0 : i >= size ? size - 1 : i);
    const sampleH = (x, z) => h[clampI(Math.round((z + half) / cell)) * size + clampI(Math.round((x + half) / cell))];
    const slopeAt = (x, z) => {
      const i = Math.max(1, Math.min(size - 2, Math.round((x + half) / cell)));
      const j = Math.max(1, Math.min(size - 2, Math.round((z + half) / cell)));
      const dx = (h[j * size + i + 1] - h[j * size + i - 1]) * relief / (2 * cell);
      const dz = (h[(j + 1) * size + i] - h[(j - 1) * size + i]) * relief / (2 * cell);
      return Math.hypot(dx, dz);
    };
    const maxSlope = SLOPE_BY_TYPE[type] ?? 1.2;
    const candidates = Math.max(1, Math.round((density || 0.5) * 6));
    let added = 0;
    for (let c = 0; c < candidates; c++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * radius;
      const x = wxx + Math.cos(a) * rr, z = wzz + Math.sin(a) * rr;
      const hh = sampleH(x, z);
      if (hh < sea + 0.005) continue;
      if (slopeAt(x, z) > maxSlope) continue;
      const y = (hh - sea) * relief;
      if (scatterAdd(scatterGroup, type, x, y, z, 0.7 + Math.random() * 0.6, Math.random() * Math.PI * 2, 0.82 + Math.random() * 0.36)) added++;
    }
    if (window.__world && scatterGroup.userData.counts) {
      for (const t of SCATTER_KEYS) scatterGroup.userData.counts[t] = (scatterGroup.userData.placements[t] || []).length;
    }
    return added;
  }

  /* L70/L71/L72 UNDO */
  const _undo = []; const UNDO_MAX = 12;
  function snapshotScatter() {
    if (!scatterGroup) return null;
    const p = scatterGroup.userData.placements, out = {};
    for (const t of SCATTER_KEYS) out[t] = (p[t] || []).map((o) => ({ ...o }));
    return out;
  }
  function snapshot() {
    if (!worldData) return;
    _undo.push({ h: worldData.height.slice(), b: worldData.biome.slice(), sc: snapshotScatter(), pl: placedLife.snapshot() });
    if (_undo.length > UNDO_MAX) _undo.shift();
  }
  function undo() {
    if (!worldData || !_undo.length) return false;
    const s = _undo.pop();
    worldData.height.set(s.h); worldData.biome.set(s.b);
    if (s.sc && scatterGroup) { const p = scatterGroup.userData.placements; for (const t of SCATTER_KEYS) p[t] = (s.sc[t] || []).map((o) => ({ ...o })); }
    if (s.pl) placedLife.restore(s.pl);
    rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children, true);
    settleSculpt();
    return true;
  }
  const WATER_KINDS = new Set(['boat', 'fish']), LAND_KINDS = new Set(['person', 'atv']);
  function placeEntity(kind, wx, wz) {
    if (!worldData) return null;
    const underwater = worldHeightAt(wx, wz) < 0.0;
    if (WATER_KINDS.has(kind) && !underwater) return null;
    if (LAND_KINDS.has(kind) && underwater) return null;
    return placedLife.spawn(kind, wx, wz);
  }
  function removeEntityNear(wx, wz, r = 2.5) { return placedLife.removeNear(wx, wz, r); }

  /* L75 SAVE / LOAD */
  function bytesToB64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length))); return btoa(s); }
  function b64ToBytes(b64) { const s = atob(b64); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; }
  const f32B64 = (f) => bytesToB64(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  const u8B64 = (u) => bytesToB64(u);
  function scatterPlacements() { const p = scatterGroup ? scatterGroup.userData.placements : {}; const out = {}; for (const t of SCATTER_KEYS) out[t] = (p[t] || []).map((o) => ({ ...o })); return out; }
  function serialize() {
    if (!worldData) return null;
    return { v: 1, seed: worldSeed, preset: worldPreset, size: worldData.size,
      height: f32B64(worldData.height), biome: u8B64(worldData.biome),
      scatter: scatterPlacements(), entities: placedLife.snapshot() };
  }
  function serializeCompact() {
    if (!worldData) return null;
    const base = generateTerrain({ seed: worldSeed, size: 160, preset: worldPreset });
    const h = worldData.height, b = worldData.biome, hd = [], bd = [];
    for (let i = 0; i < h.length; i++) { if (Math.abs(h[i] - base.height[i]) > 1e-6) { hd.push(i, Math.round(h[i] * 1e4) / 1e4); } }
    for (let i = 0; i < b.length; i++) { if (b[i] !== base.biome[i]) { bd.push(i, b[i]); } }
    return { v: 1, c: 1, seed: worldSeed, preset: worldPreset, hd, bd, entities: placedLife.snapshot() };
  }
  function loadScatterPlacements(placements) {
    if (scatterGroup) { scene.remove(scatterGroup); scatterGroup.userData.dispose?.(); }
    scatterGroup = buildScatterGroup(placements || { tree: [], rock: [], tuft: [] });
    scatterGroup.userData.counts = SCATTER_KEYS.reduce((o, t) => (o[t] = (scatterGroup.userData.placements[t] || []).length, o), {});
    scatterGroup.visible = worldActive; scene.add(scatterGroup);
  }
  function deserialize(obj) {
    if (!obj || obj.v !== 1) return false;
    const GRID = 160 * 160;
    if (obj.height != null || obj.biome != null) {
      if (typeof obj.height !== 'string' || typeof obj.biome !== 'string') return false;
      let hb, bb;
      try { hb = b64ToBytes(obj.height); bb = b64ToBytes(obj.biome); } catch (e) { return false; }
      if (hb.byteLength % 4 !== 0 || (hb.byteLength >> 2) !== GRID || bb.length < GRID) return false;
      const hf = new Float32Array(hb.buffer, hb.byteOffset, hb.byteLength >> 2);
      for (let i = 0; i < hf.length; i++) if (!Number.isFinite(hf[i])) return false;
    }
    if (obj.hd != null && !Array.isArray(obj.hd)) return false;
    if (obj.bd != null && !Array.isArray(obj.bd)) return false;
    if (Array.isArray(obj.hd)) for (let i = 0; i < obj.hd.length; i += 2) { const k = obj.hd[i]; if (!Number.isInteger(k) || k < 0 || k >= GRID || !Number.isFinite(obj.hd[i + 1])) return false; }
    if (Array.isArray(obj.bd)) for (let i = 0; i < obj.bd.length; i += 2) { const k = obj.bd[i]; if (!Number.isInteger(k) || k < 0 || k >= GRID) return false; }
    worldSeed = obj.seed | 0;
    worldPreset = PRESET_KEYS.includes(obj.preset) ? obj.preset : worldPreset;
    _undo.length = 0;
    buildWorld();
    worldActive = true; setWorldVisible(true); placedLife.group.visible = true; waterFlow.group.visible = true; dust.group.visible = true; for (const g of URBAN()) g.visible = false;
    if (window.__world) window.__world.active = true;
    const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
    const nb = BIOMES.length;
    if (obj.height && obj.biome) {
      const hb = b64ToBytes(obj.height); const hf = new Float32Array(hb.buffer, hb.byteOffset, hb.byteLength >> 2);
      for (let i = 0; i < hf.length; i++) worldData.height[i] = clamp01(hf[i]);
      const bb = b64ToBytes(obj.biome); for (let i = 0; i < worldData.biome.length; i++) worldData.biome[i] = Math.min(nb - 1, bb[i] | 0);
    } else if (obj.hd || obj.bd) {
      const hd = obj.hd || [], bd = obj.bd || [];
      for (let i = 0; i < hd.length; i += 2) worldData.height[hd[i]] = clamp01(hd[i + 1]);
      for (let i = 0; i < bd.length; i += 2) worldData.biome[bd[i]] = Math.min(nb - 1, Math.max(0, bd[i + 1] | 0));
    }
    rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children, true);
    if (obj.scatter) loadScatterPlacements(obj.scatter);
    repoolWater();
    if (scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });
    placedLife.restore(obj.entities);
    if (window.__world) { window.__world.scatter = scatterGroup.userData.counts; window.__world.seed = worldSeed; window.__world.preset = worldPreset; }
    return true;
  }

  const world = {
    enter() { if (!terrainGroup) buildWorld(); worldActive = true; setWorldVisible(true); placedLife.group.visible = true; waterFlow.group.visible = true; dust.group.visible = true; for (const g of URBAN()) g.visible = false; if (window.__world) window.__world.active = true; },
    exit() { _editing = false; worldActive = false; setWorldVisible(false); placedLife.group.visible = false; waterFlow.group.visible = false; dust.group.visible = false; for (const g of URBAN()) g.visible = true; if (window.__world) window.__world.active = false; },
    setEditing(on) {
      _editing = !!on;
      water.visible = _waterOn && worldActive && !_editing;
      if (lakeGroup) lakeGroup.visible = worldActive && !_editing;
      waterFlow.group.visible = worldActive && !_editing;
      if (!_editing && worldActive) repoolWater();
      return _editing;
    },
    get editing() { return _editing; },
    get waterHidden() { return _editing && !water.visible; },
    reroll() { worldSeed = (Math.random() * 1e9) | 0; _undo.length = 0; buildWorld(); world.enter(); return worldSeed; },
    reset() { _undo.length = 0; buildWorld(); world.enter(); return worldSeed; },
    setPreset(p) { if (PRESET_KEYS.includes(p)) { worldPreset = p; _undo.length = 0; buildWorld(); world.enter(); } return worldPreset; },
    sculpt, paintBiome, paintScatter, repoolWater, snapshot, undo,
    placeEntity, removeEntityNear, heightAt: worldHeightAt,
    serialize, serializeCompact, deserialize,
    flowPourAt: (wx, wz, amount, radius) => waterFlow.pourAt(wx, wz, amount, radius),
    flowRain: (a) => waterFlow.rain(a), flowClear: () => waterFlow.clear(),
    get flowTotal() { return waterFlow.totalWater(); }, flowAt: (wx, wz) => waterFlow.cellAt(wx, wz),
    flowErosion: (on, strength) => waterFlow.setErosion(on, strength), get flowErosionOn() { return waterFlow.erosion; }, get flowSediment() { return waterFlow.totalSediment(); },
    setSimBackend: (b) => waterFlow.setBackend(b), get simBackend() { return waterFlow.backend; },
    _flowReadW: () => waterFlow._debugReadW(), _flowReadTerr: () => waterFlow._debugReadTerr(),
    _flowStepN: (n, dt) => waterFlow._debugStepN(n, dt),
    get terrainGroup() { return terrainGroup; },
    get biomes() { return BIOMES; },
    get scatterCounts() { return scatterGroup ? scatterGroup.userData.placements && SCATTER_KEYS.reduce((o, t) => (o[t] = (scatterGroup.userData.placements[t] || []).length, o), {}) : null; },
    get placedCounts() { return placedLife.counts(); },
    setScatterHidden(on) { if (scatterGroup) scatterGroup.visible = !on; },
    get placedLife() { return placedLife; },
    get canUndo() { return _undo.length > 0; },
    get active() { return worldActive; }, get seed() { return worldSeed; }, get preset() { return worldPreset; }, get presets() { return PRESET_KEYS; },
  };

  /* L71 OBJECT CATALOG + EDITOR + PILOT */
  const catalog = seedWorldEditorCatalog();
  const editor = createEditor({ world, catalog, inspector });

  /* L77 water/ground samplers for pilot */
  const SEA_Y = 0;
  let _pilotWaterSampler = null, _pilotGroundSampler = null;
  function setPilotWaterSampler(fn) { _pilotWaterSampler = fn || null; }
  function setPilotGroundSampler(fn) { _pilotGroundSampler = fn || null; }
  function worldWaterAt(wx, wz) {
    if (_pilotWaterSampler) { const w = _pilotWaterSampler(wx, wz); if (w != null) return w; }
    return worldHeightAt(wx, wz) < SEA_Y ? SEA_Y : NO_WATER;
  }
  function pilotHeightAt(wx, wz) {
    if (_pilotGroundSampler) { const h = _pilotGroundSampler(wx, wz); if (h != null) return h; }
    return worldHeightAt(wx, wz);
  }
  const collider = createColliderWorld({ cell: LAYOUT.PITCH });
  const pilot = createPilotController({ rig, world: {
    heightAt: pilotHeightAt, waterHeightAt: worldWaterAt,
    collide: (state, dt, cfg) => collider.resolveSphere(state, dt, cfg),
    collideActive: () => collider.active(),
    segmentHit: (ox, oy, oz, ex, ey, ez, r) => collider.segmentHit(ox, oy, oz, ex, ey, ez, r),
    surfaceAt: (x, z, yMax, r) => collider.surfaceAt(x, z, yMax, r),   // A-ROOF: what am I standing on
  } });

  /* 7e) SUN SHADOW */
  city.group.remove(city.key);
  scene.add(city.key);
  city.key.castShadow = true;
  // M1 MOBILE TRUTH: the shadow map resolution is now a per-project option (default 2048, city byte-identical).
  // Mobile passes 1024 — a quarter of the shadow-pass pixels — since the phone can't afford a 2048 re-render.
  city.key.shadow.mapSize.set(shadowMapSize, shadowMapSize);
  city.key.shadow.bias = -0.00018;
  city.key.shadow.normalBias = 0.028;
  scene.add(city.key.target);
  const SHADOW_DIST = 24;
  // A11 THE LIGHT CEILING — an opt-in shadow-frustum extent override. Default null → EXACTLY today's path
  // (h = city.extent + 4.5, far = SHADOW_DIST*2), so city/hub/showcase are byte-identical. A consumer whose
  // PLAY AREA is larger than the city footprint (hoard2's arena: play ring r=26 vs city.extent ~7.6) opts in
  // to a bigger extent so its objects at play distance actually CAST shadows instead of falling outside the
  // frustum — the measured A11 "floating" cause (4/6 sampled objects had no shadow). When set, the ortho far
  // plane grows with it so tall rim casters aren't depth-clipped; the default branch is left untouched.
  let _shadowExtentOverride = null;
  function fitShadowFrustum() {
    const cam = city.key.shadow.camera;
    const h = _shadowExtentOverride != null ? _shadowExtentOverride : city.extent + 4.5;
    cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
    cam.near = 1; cam.far = _shadowExtentOverride != null ? SHADOW_DIST * 2 + h : SHADOW_DIST * 2;
    cam.updateProjectionMatrix();
    renderer.shadowMap.needsUpdate = true;
    collider.rebuild(city.state.solids);
  }
  fitShadowFrustum();

  /* ============================================================
     RENDER ORCHESTRATION (city-owned: grabs core primitives via destructured refs)
     ============================================================ */

  // L100: per-frame lighting baselines captured in updateWorld; renderCityPipeline cuts them for BEAUTY.
  let _baseFill = 1.0, _baseEnvI = 0.34;
  const NOON_NEUTRAL = new THREE.Color('#cdaa80');

  // Shadow dirty-flag state (local to city — only used in updateWorld).
  const SHADOW_EPS2 = 0.00002;
  const _lastShadowSunDir = new THREE.Vector3(1, 1, 1);
  let _lastShadowsOn = false;
  // M1 MOBILE TRUTH — SHADOW-REFRESH THROTTLE. By default the map re-renders whenever the sun moves past
  // SHADOW_EPS2 — fine for the city (frozen-ish sun), catastrophic for hoard2 mobile where the A4 sun sweeps
  // ~98° over 9 min, forcing a full 2048² PCFSoft re-render over ~144 skinned casters ~every 1.4 s. This
  // throttle caps that: with `_shadowThrottleS > 0` the map re-renders at MOST once per N seconds (mobile
  // pairs it with a static-only caster set + 1024 map + plain PCF, so the few refreshes are cheap and the
  // static building shadows only lag the moving sun by a couple of degrees between updates — imperceptible).
  // 0 (city default) = the original every-move behaviour, byte-identical. Also drives the panic tier's freeze.
  let _shadowThrottleS = 0;
  let _shadowClock = 1e9;   // start large so the FIRST eligible frame refreshes immediately (boot already dirtied it)
  let _loaderFrames = 0;
  const _washProbe = { alt: 0, k: 0, u: 0, v: 0, z: 0 };

  /* Render the CITY through an arbitrary camera into `dest`, beauty only (no post). */
  function renderCityBeautyTo(cam, dest) {
    setSkyTier(true);
    scene.environment = ensureEnv();
    aoStrength.value = 1.0;
    waterMaterial.uniforms.uFoamStrength.value = 1.0 - 0.85 * nightFillGate(sunRig.sunArc.y);   // same foam night gate as the live beauty branch (defect-2) — captures agree with the screen
    waterMaterial.uniforms.uNear.value = cam.near; waterMaterial.uniforms.uFar.value = cam.far; waterMaterial.uniforms.uIsPerspective.value = cam.isPerspectiveCamera ? 1.0 : 0.0;
    const _midK = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(sunRig.sunArc.y, 0, 1), 0.22, 0.8);
    const _lw = lowSunWashK(sunRig.sunArc.y);
    waterMaterial.uniforms.uGlintK.value = _lw;
    const _sd = sunDownK(sunRig.sunArc.y);
    city.fill.intensity = _baseFill * (1 - 0.60 * _midK - 0.35 * _lw) + 0.35 * _sd * nightFillGate(sunRig.sunArc.y);
    scene.environmentIntensity = _baseEnvI * (1 - 0.45 * _midK - 0.58 * _lw);
    windowRecess.value = _midK;
    city.fill.groundColor.copy(sunRig.hemiGround).lerp(NIGHT_STREET_WARM, 0.55 * _sd);
    waterMaterial.uniforms.uSkyRefl.value = 0.55;
    celestials.place(cam);
    water.visible = false;
    renderer.setRenderTarget(grabRT);
    renderer.render(scene, cam);
    water.visible = _waterOn;   // B2: respect the contextual-water seam (was unconditional true)
    renderer.setRenderTarget(beautyRT);
    renderer.render(scene, cam);
    bloomPass(beautyRT);
    filmicMaterial.uniforms.uScene.value = beautyRT.texture;
    filmicMaterial.uniforms.uAces.value = 1.0;
    filmicMaterial.uniforms.uGrade.value = 1.0;
    filmicMaterial.uniforms.uGrain.value = 0.0;
    filmicMaterial.uniforms.uChroma.value = 0.0;
    filmicMaterial.uniforms.uDither.value = 1.0;
    filmicMaterial.uniforms.uWarmBal.value = 0.90 * _midK;
    filmicMaterial.uniforms.uBeautyExp.value = 1.0 - 0.12 * _midK - 0.17 * _lw;
    filmicMaterial.uniforms.uRays.value = 0.0;
    runPass(filmicMaterial, dest);
    celestials.place(rig.camera);
  }

  /* Render the mirrored skyline into planarRefl.reflRT. */
  function renderReflection(srcCam) {
    const _wv = water.visible, _cl = cityLife.group.visible, _pl = placedLife.group.visible,
          _wf = waterFlow.group.visible, _du = dust.group.visible;
    water.visible = false; cityLife.group.visible = false; placedLife.group.visible = false;
    waterFlow.group.visible = false; dust.group.visible = false;
    const mCam = planarRefl.updateCamera(srcCam);
    celestials.place(mCam);
    renderer.setRenderTarget(planarRefl.reflRT);
    renderer.render(scene, mCam);
    celestials.place(srcCam);
    water.visible = _wv; cityLife.group.visible = _cl; placedLife.group.visible = _pl;
    waterFlow.group.visible = _wf; dust.group.visible = _du;
  }

  /* The full CITY pipeline (grab → beauty → post/style chain) into a parameterized final target. */
  function renderCityPipeline(style, finalDest) {
    // Snapshot live style state from core for this frame.
    const mode = core.mode, vector = core.vector;

    // Moved from core's decideStyle (which is now pure): update waterMaterial uniforms from style.
    const toonAmount = style.kind === 'toon' ? 1 : style.kind === 'blend' ? (1 - style.blend) : 0;
    waterMaterial.uniforms.uChromaScale.value = THREE.MathUtils.lerp(1.0, 0.5, toonAmount);
    waterMaterial.uniforms.uSkyRefl.value = (!vector && (mode === 1 || mode === 2)) ? 0.55 : 0.0;

    const beauty = !vector && (mode === 1 || mode === 2);
    setSkyTier(beauty);
    scene.environment = beauty ? ensureEnv() : null;
    aoStrength.value = beauty ? 1.0 : 0.0;
    /* FOAM NIGHT GATE (2026-08-05, metropolis defect-2 — probe-proven): water-surface.frag paints foam a
       CONSTANT unlit near-white (vec3(.93,.95,.94)) — at midnight the ferry's ring train + boat wakes +
       the shoreline band rendered as blown white blobs that then cleared bloom's night threshold (0.60).
       Pinning uFoamStrength to 0 in the live page removed every ring/patch in one frame. Scale by
       nightFillGate (0 at y≥0 → dusk/day BYTE-IDENTICAL; 1 below y=-0.06) leaving 15% so night foam
       still reads faintly, as moonlit foam should. */
    waterMaterial.uniforms.uFoamStrength.value = beauty ? 1.0 - 0.85 * nightFillGate(sunRig.sunArc.y) : 0.0;
    /* CARD NIGHT DIMMING (2026-08-05, metropolis defect-3): the business-card plate is MeshBasic —
       UNLIT, constant-bright — so at midnight the tan expanse glowed through the dark water as if
       floodlit (Fable-5's night bar: "the bright tan underside currently visible must go"). Dim it
       with the same below-horizon gate as the foam; beauty-gated + 0 at y≥0 → daytime and every
       stylized tier byte-identical. */
    /* SEABED TINT (2026-08-06): this line forced the card to WHITE on every stylized frame
       (setScalar(1)), silently overwriting any colour a consumer set at boot — which is why
       metropolis's seabed tint appeared to have "zero influence" in an A/B test, and why removing
       the card's business-card MAP left a pure-white plate refracting through the bay as a bright
       band. _cardTint defaults to white → the multiply is identity → city byte-identical. */
    card.material.color.copy(_cardTint).multiplyScalar(beauty ? 1 - 0.85 * nightFillGate(sunRig.sunArc.y) : 1);
    waterMaterial.uniforms.uNear.value = rig.camera.near;
    waterMaterial.uniforms.uFar.value  = rig.camera.far;
    waterMaterial.uniforms.uIsPerspective.value = rig.camera.isPerspectiveCamera ? 1.0 : 0.0;
    const midK = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(sunRig.sunArc.y, 0, 1), 0.22, 0.8);
    const lw = lowSunWashK(sunRig.sunArc.y);
    waterMaterial.uniforms.uGlintK.value = beauty ? lw : 0.0;
    const sd = sunDownK(sunRig.sunArc.y);
    // F2b: nightFillGate gates the fill boost to engage only below the horizon (0 at y≥0, 1 at y≤-0.06).
    /* + the DAY FILL BOOST (art pass 2026-08-06, default 0 → byte-identical): a consumer whose camera
       lives at street level (metropolis) needs more shadow-face ambient than the aerial diorama this
       fill was tuned for — measured live, shaded plaster only reaches the look-bible's 35-40%-of-
       sunlit band at an absolute fill of ~2.4-2.8 vs the driven 0.406. Gated on sun height so the
       approved night look is untouched; a per-frame write from the project CANNOT do this (this line
       runs inside the render, after any project frame code — found the hard way). */
    city.fill.intensity = (beauty ? _baseFill * (1 - 0.60 * midK - 0.35 * lw) + 0.35 * sd * nightFillGate(sunRig.sunArc.y) : _baseFill)
      + _dayFillBoost * Math.max(0, Math.min(1, sunRig.sunArc.y * 2.2));
    /* UNDERWATER LIGHTING (A-LIGHT, 2026-08-07) — the fix the A-LIFT commit named as owed.
       Underwater fog alone produced a readable but DEAD picture on the stylized tiers: swept the fog
       density across 0.4/1.0/1.8/3.0 and every value produced the identical pixel, because the scene
       had no luminance of its own for post-toon.frag to band — the toon floor WAS the whole image.
       Fog cannot fix that; it only tints what light already reached. So light the water.
       PHYSICALLY: below the surface the sun is gone as a disc and essentially all light arrives from
       ABOVE, scattered and steeply blue-green — which is exactly a hemisphere light whose sky colour
       is the water and whose ground colour is the dark bottom. That is the light this rig already has.
       Written HERE rather than in updateWorld because this line is the canonical fill writer and runs
       AFTER it; setting the light in updateWorld gets silently overwritten one function later. */
    if (_uwK > 0) {
      /* `dayness` is a local of updateWorld and is NOT in scope here — using it threw a per-frame
         ReferenceError that killed the whole render pipeline (both tiers went pure black, and the
         vite build passed clean, because a ReferenceError inside a function is a RUNTIME fault). Use
         the same day gate the _dayFillBoost line directly above already uses. */
      const dayK = Math.max(0, Math.min(1, sunRig.sunArc.y * 2.2));
      city.fill.intensity += (UW_FILL * dayK - city.fill.intensity * 0.35) * _uwK;
      city.fill.color.lerp(_uwFill.copy(_uw.color).lerp(WHITE_C, 0.35), _uwK);
      city.fill.groundColor.lerp(UW_GROUND, _uwK * 0.85);
    }
    windowRecess.value = beauty ? midK : 0;
    if (beauty) {
      filmicMaterial.uniforms.uWarmBal.value = 0.90 * midK * (1 - _gradeCool);   // B2: cool candidate kills the warm balance
      scene.environmentIntensity = _baseEnvI * (1 - 0.66 * midK - 0.58 * lw);
      filmicMaterial.uniforms.uBeautyExp.value = 1.0 - 0.12 * midK - 0.17 * lw;
      city.fill.color.lerp(NOON_NEUTRAL, 0.45 * midK);
      city.fill.groundColor.copy(sunRig.hemiGround).lerp(NIGHT_STREET_WARM, 0.55 * sd);
    } else {
      filmicMaterial.uniforms.uWarmBal.value = 0.0; filmicMaterial.uniforms.uBeautyExp.value = 1.0;
      // L114 fix A+H — THE byte-identical violation. Reset groundColor + uSkyRefl dirtied by a prior
      // office-window beauty render THE SAME FRAME. MUST stay immediately before the stylized render.
      city.fill.groundColor.copy(sunRig.hemiGround);
      waterMaterial.uniforms.uSkyRefl.value = 0.0;
    }
    filmicMaterial.uniforms.uBloomStrength.value = 0.0;
    filmicMaterial.uniforms.uRays.value = 0.0;
    filmicMaterial.uniforms.uSunException.value = _sunException;   // A6-0b: 0 (city) → no-op inside the uGrade gate → byte-identical
    // A6-0b: project the sun onto the ACTIVE render camera so the filmic pass knows WHERE the sun is (colour/luma
    // can't separate it from the bright sky). Only when a consumer opted in (_sunException>0) and the sun is in
    // front of the camera; else radius 0 → mask 0. Point = camPos + sunDir·R (R matches the celestials skydome).
    if (_sunException > 0) {
      rig.camera.getWorldDirection(_camFwd);
      const inFront = _camFwd.dot(sunRig.sunArc) > 0.05;
      if (inFront) {
        _sunProj.copy(rig.camera.position).addScaledVector(sunRig.sunArc, 88).project(rig.camera);
        filmicMaterial.uniforms.uSunScreenPos.value.set(_sunProj.x * 0.5 + 0.5, _sunProj.y * 0.5 + 0.5);
        filmicMaterial.uniforms.uSunRadius.value = 0.40;
      } else {
        filmicMaterial.uniforms.uSunRadius.value = 0.0;   // sun behind the camera → no exception this frame
      }
    }
    /* ART PASS (2026-08-06, bible §4): reflection strength BY HOUR instead of a constant 1.0 —
       noon ~0.15 (mostly diffuse sea colour), golden hour ~0.6 (the long sun streak), night ~0.35
       (window glints, moon path). lowSunWashK peaks at golden hour; nightFillGate below the horizon. */
    reflStrength.value = (beauty && core._qualityRefl)
      ? 0.15 + 0.45 * lowSunWashK(sunRig.sunArc.y) + 0.20 * nightFillGate(sunRig.sunArc.y)
      : 0.0;
    waterMaterial.uniforms.uReflStrength.value = reflStrength.value;
    if (reflStrength.value > 0.0) renderReflection(rig.camera);
    water.visible = false;
    renderer.setRenderTarget(grabRT);
    renderer.render(scene, rig.camera);
    water.visible = _waterOn && !_editing;   // B2: the phantom-water fix — was `!_editing`, re-showed the
    // bay sim plane under hoard2's map every frame despite setUrbanVisible(false). _waterOn defaults true
    // (city byte-identical); hoard2 calls setWaterEnabled(false).

    if (mode === 1 && !beauty) {
      renderer.setRenderTarget(finalDest);
      renderer.render(scene, rig.camera);
      window.__style = 'raw';           // F1: label truth — raw (vector+mode1, no post)
    } else if (mode === 1) {
      renderer.setRenderTarget(beautyRT);
      renderer.render(scene, rig.camera);
      const beautySrc = cloudsComposite(beautyRT);   // ARC A-LIVE: no-op passthrough when clouds is off
      bloomPass(beautySrc);
      if (governor.level < 2) godraysPass(beautySrc);
      filmicMaterial.uniforms.uScene.value = beautySrc.texture;
      filmicMaterial.uniforms.uAces.value = 1.0;
      filmicMaterial.uniforms.uGrade.value = 1.0;
      filmicMaterial.uniforms.uGrain.value = 0.0;
      filmicMaterial.uniforms.uChroma.value = 0.0;
      filmicMaterial.uniforms.uDither.value = 1.0;
      runPass(filmicMaterial, finalDest);
      window.__style = 'beauty';        // F1: label truth — mode-1 filmic beauty
    } else {
      renderer.setRenderTarget(beauty ? beautyRT : sceneRT);
      renderer.render(scene, rig.camera);
      if (mode === 2) {
        const beautySrc = beauty ? cloudsComposite(beautyRT) : sceneRT;   // ARC A-LIVE
        if (beauty) bloomPass(beautySrc);
        if (beauty && governor.level < 2) godraysPass(beautySrc);
        filmicMaterial.uniforms.uScene.value = beautySrc.texture;
        filmicMaterial.uniforms.uAces.value = beauty ? 1.0 : 0.0;
        filmicMaterial.uniforms.uGrade.value = beauty ? 1.0 : 0.0;
        filmicMaterial.uniforms.uGrain.value = 1.0;
        filmicMaterial.uniforms.uChroma.value = 1.0 * _chromaScale;   // B2: scaled (hoard2 dials CA down)
        filmicMaterial.uniforms.uDither.value = beauty ? 1.0 : 0.0;
        runPass(filmicMaterial, finalDest);
        window.__style = beauty ? 'beauty' : 'raw';  // F1: label truth — mode-2 beauty or raw (vector)
      } else {
        filmicMaterial.uniforms.uScene.value = sceneRT.texture;
        filmicMaterial.uniforms.uAces.value = 0.0;
        filmicMaterial.uniforms.uGrade.value = 0.0;
        filmicMaterial.uniforms.uGrain.value = 0.0;
        filmicMaterial.uniforms.uChroma.value = 0.0;
        filmicMaterial.uniforms.uDither.value = 0.0;
        runPass(filmicMaterial, filmicRT);
        const cam = rig.camera;
        toonMaterial.uniforms.uNear.value = cam.near;
        toonMaterial.uniforms.uFar.value  = cam.far;
        toonMaterial.uniforms.uIsPerspective.value = cam.isPerspectiveCamera ? 1.0 : 0.0;
        const pixMat = style.era ? (setEra(style.era), pixelkitMaterial) : (core.sceneEra === 'native' ? pixelMaterial : pixelkitMaterial);
        if (style.kind === 'pixel') {
          runPass(pixMat, finalDest); window.__style = 'pixel';
        } else if (style.kind === 'toon') {
          runPass(toonMaterial, finalDest); window.__style = 'toon';
        } else {
          runPass(toonMaterial, toonRT);
          runPass(pixMat, pixelRT);
          mixMaterial.uniforms.uBlend.value = style.blend;
          runPass(mixMaterial, finalDest); window.__style = 'blend';
        }
      }
    }
  }

  /* L79 GPU PRE-WARM — city-owned because it drives updateWorld + renderCityPipeline. */
  function prewarm() {
    try {
      renderer.compile(scene, rig.camera);
      updateWorld(1 / 60, 0, { shadowsOn: true });
      renderCityPipeline(decideStyle(), sceneRT);
      renderer.setRenderTarget(null);
    } catch (e) { if (typeof console !== 'undefined') console.warn('[L79] prewarm', e); }
  }

  /* The UNIVERSAL per-frame step. */
  function updateWorld(dt, elapsed, { shadowsOn = true, seasonTarget = 0 } = {}) {
    // __frames is now incremented in createEngineCore.frameEnd() (lifted from here to fix the
    // city-free page gap: lesson pages call frameEnd() but never updateWorld())
    shadowsOn = shadowsOn && core._qualityShadows;
    backdrop.material.uniforms.uTime.value = elapsed;
    filmicMaterial.uniforms.uTime.value    = elapsed;
    waterMaterial.uniforms.uTime.value     = elapsed % WATER_CLOCK_PERIOD;

    sunRig.update(dt);
    city.key.position.copy(sunRig.sunDir).multiplyScalar(SHADOW_DIST);
    city.key.color.copy(sunRig.sunColor);
    city.key.intensity = sunRig.sunIntensity;
    city.fill.color.copy(sunRig.hemiSky);
    city.fill.groundColor.copy(sunRig.hemiGround);
    windowGlow.value = sunRig.windowGlow;
    const _lw = lowSunWashK(sunRig.sunArc.y);
    if (_lw > 0.001) {
      const sp = sunRig.skyParams;
      sp.turbidity = Math.max(1.5, sp.turbidity - 3.6 * _lw);
      /* RAYLEIGH CAP (2026-08-05, metropolis defect-4a): uncapped, this push reaches ~5.5 at the dusk
         peak and turns the MID/HIGH dome band olive-green — a band only street-level/upward cameras
         ever frame, which is exactly the residual risk docs/dusk-washout-fix-2026-07-07.md flagged
         ("boosts rayleigh under a low RED sun") and pre-authorized capping ("cap the sky-block's
         rayleigh add"). 3.6 = the noon keyframe's own maximum — the dome may deepen to noon-blue
         physics but never past it into green. Aerial dusk (near-horizon band) is barely touched;
         noon byte-identical (lowSunWashK(noon)=0). */
      sp.rayleigh  = Math.min(sp.rayleigh + 2.4 * _lw, 3.6);
      sp.mie       = sp.mie * (1 - 0.50 * _lw);
      sp.mieG      = Math.max(0.50, sp.mieG - 0.25 * _lw);
    }
    /* WEATHER→DOME (2026-08-05, metropolis weather sweep): the Preetham dome ignored weather
       entirely — rain fell out of a cloudless pastel-blue sky, fog washed the city under crisp
       blue (measured: wx-rain/wx-fog captures). Haze IS turbidity: drive it from the same
       weatherRig the rest of the world already reads, so a storm sky goes milky-grey and fog
       whites the dome out. Scaled by the weather factors → clear weather byte-identical. */
    const _wxHaze = Math.min(1, weatherRig.fog + weatherRig.cloud);
    if (_wxHaze > 0.001) {
      const sp = sunRig.skyParams;
      sp.turbidity = Math.min(10, sp.turbidity + 8 * _wxHaze);
      sp.mieG = Math.max(0.45, sp.mieG - 0.2 * _wxHaze);
    }
    skyAtmo.setSun(sunRig.sunArc); skyAtmo.setParams(sunRig.skyParams);
    /* A-SKYDOME per-frame drive: the Sky-View LUT re-marches for the current sun (cheap, 200×100
       RGBA8); camera matrices bind per-draw in the mesh's own onBeforeRender (multi-camera rule).
       Weather haze maps onto the Mie dial — setHaze recomputes the two static LUTs, so only call it
       on a REAL change (the ramp crosses 0.08 steps ~a dozen times per weather transition, not per
       frame). Clear weather: haze target is exactly 1 → byte-stable. */
    if (hillaire) {
      hillaire.updateSkyView(sunRig.sunArc, _hillView);
      hillaire.updateRender(sunRig.sunArc, _hillView);
      const _hazeTarget = 1 + 4.5 * _wxHaze;
      if (Math.abs(_hazeTarget - hillaire.haze) > 0.08) hillaire.setHaze(_hazeTarget);
    }
    // ARC A-LIVE — feed the clouds pass this frame's camera/sun state. The actual GPU pass runs
    // later, in renderCityPipeline's beauty branches (only there is `beauty` known and the scratch
    // RT read/write-safe to use); this just keeps its uniforms current, the same update/render split
    // filmicMaterial.uniforms.uTime already uses above. Tier mirrors the SAME governor level godrays
    // already gates on (this file's godraysPass(beautyRT) call, `governor.level < 2`) — a raymarched
    // pass is at least as expensive, so it degrades on the same schedule rather than a new one.
    if (cloudsHandle) {
      const cloudTier = governor.level === 0 ? 'HIGH' : governor.level === 1 ? 'MED' : 'LOW';
      /* CLOUD-AMBIENT DESATURATION at low sun (2026-08-05, metropolis defect-4): the raymarcher's
         shadow ambient is uSkyTint·0.7 + uSunColor·0.15 — at dusk BOTH inputs are deep red, so the
         deck's underside rendered as a saturated blood-red ceiling from any street-level camera,
         which dusk bloom then amplified. Feed the clouds a hemiSky pulled halfway toward its own
         luma on the low-sun curve: undersides go rosy-grey while the sun-facing lighting (uSunColor,
         untouched) keeps the golden sunset rims. Noon/night byte-identical (curve is 0 there). */
      _cloudTint.copy(sunRig.hemiSky);
      _cloudSun.copy(sunRig.sunColor);
      if (_lw > 0.001) {
        const _cl = _cloudTint.r * 0.2126 + _cloudTint.g * 0.7152 + _cloudTint.b * 0.0722;
        _cloudTint.lerp(_cloudGrey.setScalar(_cl), 0.5 * _lw);
        // …and the SUN the raymarcher sees, more gently (0.4·lw): the multi-scatter octaves carry
        // uSunColor into every underside, so a fully-saturated dusk red painted the whole deck
        // blood-red from below. At 60% residual saturation the sun-facing rims stay golden-red
        // while shadowed undersides fall to brick/rosy-grey. Scene lighting reads the REAL
        // sunRig.sunColor — this desat exists only on the clouds' private copy.
        const _sl = _cloudSun.r * 0.2126 + _cloudSun.g * 0.7152 + _cloudSun.b * 0.0722;
        _cloudSun.lerp(_cloudGrey.setScalar(_sl), 0.55 * _lw);
      }
      // WEATHER→DECK (2026-08-05): a storm must LOOK like a storm from below — fill the deck toward
      // overcast on weatherRig.cloud (+ half-weight fog) and darken the raymarcher's light copies by
      // the overcast factor (storm decks are dark grey, not sunlit white). Clear weather: both terms
      // are 0 → byte-identical to the golden-hour behavior below.
      const _oc = weatherRig.overcast;
      if (_oc > 0.001) { _cloudTint.multiplyScalar(1 - 0.45 * _oc); _cloudSun.multiplyScalar(1 - 0.6 * _oc); }
      // …and THIN the deck through golden hour (coverage × down-to-45%): a full overcast lit from
      // below reads as a blood-red ceiling; scattered clouds catching the low sun over open sky is
      // the classic sunset — and lets street-level cameras see the (rayleigh-capped) warm dome at
      // the canyon end. Noon/night coverage byte-identical (lw=0 there). Weather overrides the
      // thinning: a storm at sunset is still a storm.
      const _wxCloud = Math.min(1, weatherRig.cloud + 0.5 * weatherRig.fog);
      cloudsHandle.setCoverage(THREE.MathUtils.lerp((volumetricClouds.coverage ?? 0.5) * (1 - 0.55 * _lw), 0.92, _wxCloud));
      cloudsHandle.update({ camera: rig.camera, sunDir: sunRig.sunDir, sunColor: _cloudSun, skyTint: _cloudTint, time: elapsed, tierName: cloudTier, overcast: _oc });
    }
    filmicMaterial.uniforms.uGradeSat.value = sunRig.grade.sat * (1 - 0.4 * _gradeCool);   // B2: cool candidate desaturates toward rot
    filmicMaterial.uniforms.uGradeContrast.value = sunRig.grade.contrast;
    scene.environmentIntensity = 0.34 * (1 - 0.6 * THREE.MathUtils.clamp(sunRig.sunArc.y * 1.5, 0, 1));
    _baseEnvI = scene.environmentIntensity;

    const overcast = weatherRig.overcast;
    city.key.intensity *= (1.0 - 0.5 * overcast);
    city.key.color.lerp(OVERCAST_GREY, 0.45 * overcast);
    city.fill.intensity = 1.0 + 0.7 * overcast;
    _baseFill = city.fill.intensity;

    const grazeFade = THREE.MathUtils.smoothstep(sunRig.sunDir.y, 0.06, 0.34);
    const nightF = THREE.MathUtils.lerp(0.28, 1.0, 1.0 - sunRig.windowGlow);
    const sFactor = shadowsOn ? grazeFade * nightF : 0.0;
    city.key.shadow.intensity = 0.72 * sFactor;
    vectorShadow.value = 0.52 * sFactor;
    // M1 throttle: only ALLOW a re-render once the throttle window has elapsed (0 → always, city default).
    // The sun-moved / first-frame test still gates WHETHER a refresh is needed; the throttle gates HOW OFTEN.
    _shadowClock += dt;
    const _throttleReady = _shadowThrottleS <= 0 || _shadowClock >= _shadowThrottleS;
    if (shadowsOn && _throttleReady && (!_lastShadowsOn || _lastShadowSunDir.distanceToSquared(sunRig.sunDir) > SHADOW_EPS2)) {
      renderer.shadowMap.needsUpdate = true;
      _lastShadowSunDir.copy(sunRig.sunDir);
      _shadowClock = 0;
      if (typeof window !== 'undefined') window.__shadowUpdates = (window.__shadowUpdates | 0) + 1;   // M1 probe: shadow-pass re-renders
    }
    _lastShadowsOn = shadowsOn;
    const dayness = 1.0 - sunRig.windowGlow;
    vectorTint.setRGB(
      THREE.MathUtils.lerp(0.46, 1.0, dayness),
      THREE.MathUtils.lerp(0.52, 1.0, dayness),
      THREE.MathUtils.lerp(0.74, 1.0, dayness),
    );
    filmicMaterial.uniforms.uExposure.value = sunRig.exposure;
    toonMaterial.uniforms.uToonGain.value = sunRig.toonGain;
    renderer.setClearColor(sunRig.horizon, 1);
    updatePixelPalette(sunRig.t);
    window.__t = sunRig.t;

    cityLife.update(dt, elapsed, sunRig);
    city.update(elapsed);
    waterLife.update(dt, elapsed, sunRig);
    streetLights.update(sunRig.windowGlow);
    simMaterial.uniforms.uWakeCount.value = waterLife.wakeCount;
    weatherRig.update(dt, elapsed);
    simMaterial.uniforms.uRainCount.value = weatherRig.rainDropCount;
    const fogNight = weatherRig.fog * (1.0 - dayness);
    scene.fog.density = AERIAL_BASE + weatherRig.fog * FOG_DENSITY;
    _fogColor.copy(sunRig.horizon).lerp(FOG_NIGHT_TINT, 0.85 * fogNight);
    /* A-FISH — UNDERWATER. The eye crossing the waterline swaps the whole atmosphere: dense blue-green
       absorption instead of aerial haze, and the sea's underside becomes visible as a ceiling. Written
       HERE, after the normal fog, because this writer is the last word on scene.fog every frame.
       The fog EASES across the boundary (0.35 u of blend) rather than snapping — a hard switch at y=0
       reads as a bug when a swell lifts you through it, and the surface here is a live wave sim.
       Night-aware: the underwater colour is scaled by the same `dayness` the rest of the frame uses, so
       diving at 2 a.m. is dark water, not a lit aquarium. */
    if (_uw) {
      const eyeY = rig.camera.position.y;
      const k = Math.min(1, Math.max(0, (_uw.y - eyeY) / _uw.blend));   // 0 above, 1 fully submerged
      if (k > 0) {
        _uwColor.copy(_uw.color).multiplyScalar(0.25 + 0.75 * dayness);
        scene.fog.density = scene.fog.density + (_uw.density - scene.fog.density) * k;
        _fogColor.lerp(_uwColor, k);
      }
      underside.visible = k > 0;
      if (k > 0) underMaterial.color.copy(_uwColor).lerp(sunRig.sky, 0.35 * dayness);
      /* STYLIZED TIERS — the black-void fix, and it is not optional: the whole mobile experience runs
         the toon tier. post-toon.frag bands by LUMINANCE, and its own comment warns that a dark scene
         "collapses to black blobs"; its guard against that is uToonFloor, which sun-rig drives to pure
         black at noon (it was authored as a NIGHT ambient floor). An underwater scene at midday is
         exactly the case neither anticipated. Measured on a 390x844 phone before this line: the frame
         below 55% height read rgb(0,0,0) while the fog colour was rgb(31,143,166) — not dim, GONE.
         Lifting the floor toward the water colour gives the lowest band somewhere to land.
         toonFloor is bound BY REFERENCE into the uniform and rewritten by sunRig.update() every frame,
         so this override is naturally transient — the same "write inside the engine's own writer"
         discipline the fog above needs, for the same reason. */
      if (k > 0) sunRig.toonFloor.lerp(_uwFloor.copy(_uwColor).multiplyScalar(_uw.floorMul), k);
      // Hide the unfogged sky/backdrop once we are properly under. Latched on a CHANGE only, so the
      // single-writer applySky() runs once per crossing rather than every frame.
      _uwK = k;   // published for renderCityPipeline's fill writer (see the note there)
      const sub = k > 0.6;
      if (sub !== _submerged) { _submerged = sub; applySky(); }
    }
    scene.fog.color.copy(_fogColor);
    renderer.setClearColor(_fogColor, 1);
    fogCharm.value = weatherRig.fog;
    backdrop.material.uniforms.uFogAmt.value = 0.7 * weatherRig.fog;
    weatherSnow.value = weatherRig.snow;
    weatherCloud.value = weatherRig.cloud * 0.55;
    weatherCloudOff.x += dt * 0.018; weatherCloudOff.y += dt * 0.009;
    weatherSeason.value += (seasonTarget - weatherSeason.value) * Math.min(1, dt * 1.5);
    swayTime.value = elapsed;
    swayWind.value = 0.035 + 0.05 * overcast;
    clouds.update(dt, elapsed, sunRig, weatherRig);
    if (worldActive) placedLife.update(dt, elapsed, sunRig);
    /* The egg ticks UNCONDITIONALLY — unlike placedLife above, it is not gated on
       `worldActive`, because the box lives in the CITY and the craft flies the city.
       `seizeEnt` is null until the player seizes a craft, so guard it: no craft, no
       proximity test, no hop. */
    hiddenBox.update(seizeEnt ? seizeEnt.obj.position : null, dt);
    seizeGroup.visible = !worldActive;
    if (seizeEnt && !worldActive) seizeEnt.update(dt, elapsed, sunRig);
    if (_aircraftLights && !worldActive) {
      const _arcY = sunRig.sunArc.y;
      const _t = Math.max(0, Math.min(1, (-_arcY - (-0.05)) / (0.18 - (-0.05))));
      _aircraftLights.update(_t * _t * (3 - 2 * _t), elapsed, !!(_rmQuery && _rmQuery.matches));
    }
    if (worldActive) waterFlow.step(dt);
    if (worldActive) dust.update(dt, elapsed, sunRig, { wind: 0.6 * weatherRig.cloud, qualityLevel: (window.__quality && window.__quality.level) || 0 });
    const _cs = decideStyle();   // pure call to core's _computeStyle wrapper
    const celTier = (_cs.kind === 'pixel' || _cs.kind === 'blend') ? 'pixel'
      : core.vector ? 'vector'
      : (_cs.kind === 'toon') ? 'charm' : 'realistic';
    celestials.update(dt, elapsed, sunRig, weatherRig, celTier, rig.camera);

    let _wz = 0, _wu = 0, _wv = 0, _wsig = 0.02, _walt = 99, _wk = 0;
    if (waveOk) {
      const _wt = pilot.active && pilot.craft ? pilot.craft.pilot.getTransform()
                : (seizeEnt && !worldActive && seizeEnt.followable ? seizeEnt.followable.pilot.getTransform() : null);
      if (_wt) {
        const wx = _wt.x, wz = _wt.z;
        const overWater = worldActive
          ? (worldWaterAt(wx, wz) === SEA_Y)
          : (Math.abs(wx) <= WATER_SIZE / 2 && Math.abs(wz) <= WATER_SIZE / 2 && !city.isLand(wx, wz));
        if (overWater) {
          _wu = wx / WATER_SIZE + 0.5; _wv = 0.5 - wz / WATER_SIZE;
          _walt = _wt.y;
          const WASH_MAX_ALT = 3.0;
          _wk = _walt >= 0 ? Math.pow(THREE.MathUtils.clamp(1 - _walt / WASH_MAX_ALT, 0, 1), 2) : 0;
          const splash = _wt.crossingT > 0.999 && _wt.crossing && _wt.crossing.endsWith('>water') && _wt.crossFrom === 'air';
          if (splash) { _wz = 0.10; _wsig = 0.03; }
          else if (_wk > 0) { _wz = -0.035 * _wk; _wsig = 0.018 + 0.014 * THREE.MathUtils.clamp(_walt / WASH_MAX_ALT, 0, 1); }
        }
      }
      simMaterial.uniforms.uWash.value.set(_wu, _wv, _wz, _wsig);
    }
    if (typeof window !== 'undefined') { _washProbe.alt = +(_walt).toFixed(2); _washProbe.k = +(_wk).toFixed(3); _washProbe.u = +(_wu).toFixed(3); _washProbe.v = +(_wv).toFixed(3); _washProbe.z = +(_wz).toFixed(4); window.__wash = _washProbe; }

    // M1 item 4 — gate the wave-sim RT ping-pong on `_waterOn`, not just `waveOk`. Before this it ran EVERY
    // frame (a full-screen RT render + 3-target rotation) even when the water body was disabled (hoard2's
    // setWaterEnabled(false)) — pure waste the diagnosis flagged, paid by v1 too. The water material only
    // draws when `_waterOn` (water.visible), so when it's off nothing consumes uHeight and skipping is safe.
    if (waveOk && _waterOn) {
      const [prev, curr, next] = targets;
      simMaterial.uniforms.uPrev.value = prev.texture;
      simMaterial.uniforms.uCurr.value = curr.texture;
      renderer.setRenderTarget(next);
      renderer.render(simScene, simCamera);
      targets = [curr, next, prev];
      waterMaterial.uniforms.uHeight.value = targets[1].texture;
    }

    if (_loaderFrames < 2 && typeof document !== 'undefined') {
      if (++_loaderFrames === 2) {
        const el = document.getElementById('lgr-loader');
        if (el) el.classList.add('gone');
        window.__loaded = true;
      }
    }
  }

  /* City handle — flat-merged with core by createEngine.js. */
  return {
    updateWorld, renderCityPipeline, renderCityBeautyTo, prewarm,
    // city content
    windowGlow, landmarkFactory, city, cityLife, waterLife, weatherRig, clouds,
    inspector, world, catalog, editor, pilot,
    hiddenBox,
    spawnSeizeCraft,
    get seizeCraft() { return seizeEnt ? seizeEnt.followable : null; },
    /* Every body in this world you could BE, not just the one seizeCraft names. A consumer offering a
       CHOICE of bodies (rather than a single "take the controls") reads this. See inspect.js's note on
       why it is not filtered by active(). */
    get pilotables() { return inspector.pilotables; },
    // water
    grabRT, card, backdrop, WATER_SIZE, water, waterMaterial, planarRefl,
    SIM, targets, simScene, simCamera, simMaterial,
    // pilot samplers + collider
    setPilotWaterSampler, setPilotGroundSampler, collider,
    fitShadowFrustum, SHADOW_DIST,
    // A11: opt-in shadow-frustum extent (null → today's city.extent+4.5 default; a bigger play area opts in).
    setShadowFrustumExtent: (h) => { _shadowExtentOverride = (h != null && +h > 0) ? +h : null; fitShadowFrustum(); },
    setUrbanVisible,   // L HOARD-3: hide the whole city for a non-city map (keeps the sky)
    setWaterEnabled,   // B2 WORLD-TRUTH: contextual-water enable seam (false → no bay water body; city default true)
    // M1 MOBILE TRUTH: cap how often the sun shadow map re-renders (seconds). 0 = every sun-move (city default);
    // mobile sets a large value to near-freeze the map (its casters are static, so the staleness is invisible).
    setShadowThrottle: (s) => { _shadowThrottleS = Math.max(0, +s || 0); },
    get waterEnabled() { return _waterOn; },
    setCloudsEnabled: (on) => clouds.setEnabled(on),   // B2 CLOUD-SCALE LIFT: false → no head-height puffs in a small arena
    setCloudAltitude: (m) => clouds.setAltitude(m),    // A4: lift the clear band into real sky (city default 1 → byte-identical)
    // A6-1 FP SKY SHOW: drive the (already-built, always-updated) weather rig. The city never calls this →
    // weatherRig stays 'clear' → byte-identical; hoard2 opts in with a seeded day-cycle schedule so the sky is
    // "packed with the weather" (overcast/rain/fog roll through). setKind only changes the GOAL — the rig eases
    // every scalar (overcast/fog/cloud/intensity) toward it, so transitions are smooth by construction.
    setWeatherKind: (k) => weatherRig.setKind(k),      // k ∈ WEATHER_KINDS ('clear'|'rain'|'snow'|'fog')
    get weatherKind() { return weatherRig.kind; },
    // A6-1: how GRADUALLY weather eases in (1 = city default/byte-identical; hoard2 sets it low so weather
    // gathers over several seconds — looks like real weather rolling in AND keeps the cycle smoothness gate green).
    setWeatherEaseScale: (s) => weatherRig.setEaseScale(s),
    setSunCore: (v) => celestials.setSunCore(v),       // A5: fill the sun's dull centre with a solid hot core (city default 0/off → byte-identical)
    setEnvSegments,    // A6-0a: IBL-env rebuild cadence (buckets/cycle; city default 4 → byte-identical; hoard2 raises it for a smooth dusk)
    setDayFillBoost,   // art pass 2026-08-06: daytime hemisphere boost for street-level consumers (default 0 → byte-identical)
    setSeabedTint: (hex) => { _cardTint.set(hex); },   // 2026-08-06: the seabed card's albedo (white = legacy business-card look)
    /* setSeabedCard(visible) — A-FISH. The "seabed" under the bay is an OPAQUE full-size plane at
       y = -0.35 (the demo business card). A city that grows a real, sloping seabed must switch it off:
       it is above the new floor, so it would both hide the geometry and — because the refraction grab
       renders it — swallow any fish that swims below -0.35. Default true = every existing city
       unchanged. */
    setSeabedCard: (v) => { card.visible = v !== false; },
    /* setSeabedCardY(y) — put the VISIBLE sea floor where the PHYSICS floor actually is.
       The card ships at y = -0.35 while a consumer's pilot ground sampler may put the real floor far
       below it (city and showcase-lab both use -2.4). Nothing noticed while the only submersible thing
       was a camera, but a FISH swims to its physics floor and ends up under an opaque plane — you get
       a black band across the middle of the frame and no visible bottom. That is the see-versus-hit
       disagreement this repo keeps paying for; this lets a consumer make them agree.
       Default -0.35 is untouched, so every existing city stays byte-identical. */
    setSeabedCardY: (y) => { if (Number.isFinite(y)) card.position.y = y; },
    setStylizedSea: (v) => { waterMaterial.uniforms.uStylizedSea.value = v ? 1 : 0; },   // A-SEA: opt-in sea read on stylized tiers
    /* setUnderwater(opts | null) — A-FISH. Turns on the submerged atmosphere for this city.
         color   the water-column colour the fog becomes (absorption, so: blue-green and DARK)
         density FogExp2 density under the surface — an order above aerial haze; this is what makes
                 distance vanish and gives a dive its claustrophobia
         y       the waterline (default 0, the sea plane)
         blend   world units over which the swap eases, so a swell lifting you through reads smooth
       Pass null to switch it back off. Never called ⇒ the branch in the frame writer never runs ⇒
       byte-identical, which the tier guard proves. */
    setUnderwater: (o) => {
      _uw = o ? {
        color: new THREE.Color(o.color ?? '#12556b'),
        density: Number.isFinite(o.density) ? o.density : 0.42,
        y: Number.isFinite(o.y) ? o.y : 0,
        blend: Number.isFinite(o.blend) ? o.blend : 0.35,
        /* floorMul — how much of the water colour becomes the toon tier's luminance floor.
           SWEPT, not guessed. 0.55 and 0.35 give a clean readable water field; at 0.2 and below the
           frame drops straight to rgb(0,0,0) with NO intermediate range, which is the finding worth
           recording: on the stylized tiers the submerged scene has essentially no luminance of its
           own, so this floor IS the picture rather than a safety net under it. A knob to make the
           water darker is therefore also a knob to make it black — treat 0.35 as the practical floor.
           (A density multiplier was tried alongside this and REMOVED: swept 0.4/1.0/1.8/3.0 and every
           value produced the identical pixel, because the floor clamp dominates. A control that
           cannot change the output should not ship.) */
        floorMul: Number.isFinite(o.floorMul) ? o.floorMul : 0.55,
      } : null;
      if (!_uw) { underside.visible = false; _uwK = 0; }
    },
    get underwater() { return !!_uw; },
    waterHeightAt: worldWaterAt,   // A-BOAT: the live sea-surface sampler — it existed only inside the pilot-world injection, so a project could not reach it to ride the swell
    hillaire,          // A-SKYDOME: the Hillaire sky handle (null unless skyModel:'hillaire') — exposure/haze dials + calibration probes
    setSunException,   // A6-0b: sun survives the cool grade as an exception (0 = off/byte-identical; hoard2 opts in)
    get cloudsEnabled() { return clouds.enabled; },
    setChromaScale,    // B2: scale the beauty chromatic-aberration (1 = city default; hoard2 dials down)
    setGradeCool,      // B2: warm→cool grade candidate (0 = city warm default; hoard2 baked cool per owner ruling)
    get gradeCool() { return _gradeCool; },
    // ARC A-LIVE: read-only probe — true only when a caller opted in via `volumetricClouds` at
    // construction (city default: false, byte-identical). No live setter this arc (no art pass;
    // coverage is fixed at construction, tuned via the ?live=1 profile's own config).
    get volumetricCloudsEnabled() { return !!cloudsHandle; },
  };
}
