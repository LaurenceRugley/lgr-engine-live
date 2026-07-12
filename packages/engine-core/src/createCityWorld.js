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
import { createCelestials } from './celestials.js';
import { createColliderWorld } from './collide.js';
import { lowSunWashK } from './sun-rig.js';
import { createPlanarReflection } from './planar-reflection.js';
import { createAircraftLights } from './aircraft-lights.js';
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

export function createCityWorld(core, { demo = false, citySeed = 0, profileIndex = 0, onEggFound = null } = {}) {
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

  /* L108 PLANAR MIRROR — city-owned RT + mirror camera. */
  const planarRefl = createPlanarReflection({ drawBuffer, planeY: 0 });
  waterMaterial.uniforms.uReflect.value = planarRefl.reflRT.texture;

  /* SEAM A: city registers its cache-invalidator with core's context-restore listener.
     Runs once after envTex/skyAtmo exist (they're created in the sky section below). */
  // Forward-ref: set after the sky section creates envTex/_lastEnvSeg.
  // Done via core.onContextRestored() call below (after envTex is declared).

  /* SEAM B: register city's content resizers with core's resize registry. */
  core.registerContentResizer((db) => {
    grabRT.setSize(db.x, db.y);     // L112 foam: resizes grabRT's attached grabDepth DepthTexture too
    planarRefl.setSize(db);          // L108: half-res mirror RT tracks resize
    waterMaterial.uniforms.uResolution.value.set(db.x, db.y);
  });

  /* 7b) THE CITY */
  const windowGlow = { value: 0.0 };
  const loaderProgress = createLoaderProgress();
  const landmarkFactory = createLandmarkFactory({ windowGlow, manager: loaderProgress.manager });
  const city = createCity({ seed: citySeed, profileIndex, landmarkFactory, windowGlow });
  scene.add(city.group);

  /* 7c) CITY LIFE */
  const cityLife = createCityLife({ plinthTop: 0.3, extent: city.extent, profile: city.state.profile });
  scene.add(cityLife.group);

  /* 7c-b) STREET LIGHTS */
  const streetLights = createStreetLights({ graph: buildGraph() });
  scene.add(streetLights.group);

  /* 7d) WATER LIFE */
  const waterLife = createWaterLife({ extent: city.extent, waterSize: WATER_SIZE, plinthTop: 0.3 });
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
  let _skyOn = false;
  function setSkyTier(beauty) {
    const on = beauty && sunRig.sunArc.y > -0.04;
    if (on === _skyOn) return;
    _skyOn = on;
    skyAtmo.mesh.visible = on;
    backdrop.visible = !on;
  }

  /* L67 SKY-IBL throttle */
  let envTex = null, _lastEnvSeg = -1;
  // SEAM A: now that envTex/_lastEnvSeg exist, register the context-restore invalidator.
  core.onContextRestored(() => { envTex = null; _lastEnvSeg = -1; renderer.shadowMap.needsUpdate = true; });
  function ensureEnv() {
    const seg = Math.floor((sunRig.t % 1) * 4) % 4;
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
      water.visible = worldActive && !_editing;
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
  } });

  /* 7e) SUN SHADOW */
  city.group.remove(city.key);
  scene.add(city.key);
  city.key.castShadow = true;
  city.key.shadow.mapSize.set(2048, 2048);
  city.key.shadow.bias = -0.00018;
  city.key.shadow.normalBias = 0.028;
  scene.add(city.key.target);
  const SHADOW_DIST = 24;
  function fitShadowFrustum() {
    const cam = city.key.shadow.camera;
    const h = city.extent + 4.5;
    cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
    cam.near = 1; cam.far = SHADOW_DIST * 2;
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
  let _loaderFrames = 0;
  const _washProbe = { alt: 0, k: 0, u: 0, v: 0, z: 0 };

  /* Render the CITY through an arbitrary camera into `dest`, beauty only (no post). */
  function renderCityBeautyTo(cam, dest) {
    setSkyTier(true);
    scene.environment = ensureEnv();
    aoStrength.value = 1.0;
    waterMaterial.uniforms.uFoamStrength.value = 1.0;
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
    water.visible = true;
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
    waterMaterial.uniforms.uFoamStrength.value = beauty ? 1.0 : 0.0;
    waterMaterial.uniforms.uNear.value = rig.camera.near;
    waterMaterial.uniforms.uFar.value  = rig.camera.far;
    waterMaterial.uniforms.uIsPerspective.value = rig.camera.isPerspectiveCamera ? 1.0 : 0.0;
    const midK = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(sunRig.sunArc.y, 0, 1), 0.22, 0.8);
    const lw = lowSunWashK(sunRig.sunArc.y);
    waterMaterial.uniforms.uGlintK.value = beauty ? lw : 0.0;
    const sd = sunDownK(sunRig.sunArc.y);
    // F2b: nightFillGate gates the fill boost to engage only below the horizon (0 at y≥0, 1 at y≤-0.06).
    city.fill.intensity = beauty ? _baseFill * (1 - 0.60 * midK - 0.35 * lw) + 0.35 * sd * nightFillGate(sunRig.sunArc.y) : _baseFill;
    windowRecess.value = beauty ? midK : 0;
    if (beauty) {
      filmicMaterial.uniforms.uWarmBal.value = 0.90 * midK;
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
    reflStrength.value = (beauty && core._qualityRefl) ? 1.0 : 0.0;
    waterMaterial.uniforms.uReflStrength.value = reflStrength.value;
    if (reflStrength.value > 0.0) renderReflection(rig.camera);
    water.visible = false;
    renderer.setRenderTarget(grabRT);
    renderer.render(scene, rig.camera);
    water.visible = !_editing;

    if (mode === 1 && !beauty) {
      renderer.setRenderTarget(finalDest);
      renderer.render(scene, rig.camera);
      window.__style = 'raw';           // F1: label truth — raw (vector+mode1, no post)
    } else if (mode === 1) {
      renderer.setRenderTarget(beautyRT);
      renderer.render(scene, rig.camera);
      bloomPass(beautyRT);
      if (governor.level < 2) godraysPass(beautyRT);
      filmicMaterial.uniforms.uScene.value = beautyRT.texture;
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
        if (beauty) bloomPass(beautyRT);
        if (beauty && governor.level < 2) godraysPass(beautyRT);
        filmicMaterial.uniforms.uScene.value = beauty ? beautyRT.texture : sceneRT.texture;
        filmicMaterial.uniforms.uAces.value = beauty ? 1.0 : 0.0;
        filmicMaterial.uniforms.uGrade.value = beauty ? 1.0 : 0.0;
        filmicMaterial.uniforms.uGrain.value = 1.0;
        filmicMaterial.uniforms.uChroma.value = 1.0;
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
      sp.rayleigh  = sp.rayleigh + 2.4 * _lw;
      sp.mie       = sp.mie * (1 - 0.50 * _lw);
      sp.mieG      = Math.max(0.50, sp.mieG - 0.25 * _lw);
    }
    skyAtmo.setSun(sunRig.sunArc); skyAtmo.setParams(sunRig.skyParams);
    filmicMaterial.uniforms.uGradeSat.value = sunRig.grade.sat;
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
    if (shadowsOn && (!_lastShadowsOn || _lastShadowSunDir.distanceToSquared(sunRig.sunDir) > SHADOW_EPS2)) {
      renderer.shadowMap.needsUpdate = true;
      _lastShadowSunDir.copy(sunRig.sunDir);
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

    if (waveOk) {
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
    // water
    grabRT, card, backdrop, WATER_SIZE, water, waterMaterial, planarRefl,
    SIM, targets, simScene, simCamera, simMaterial,
    // pilot samplers + collider
    setPilotWaterSampler, setPilotGroundSampler, collider,
    fitShadowFrustum, SHADOW_DIST,
  };
}
