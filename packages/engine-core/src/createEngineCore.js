/* ============================================================
   LGR WebGL Lab — createEngineCore — renderer + loop + post primitives (ZERO world content)
   ------------------------------------------------------------
   PURE RELOCATION from createEngine.js (the generality fix). This module owns everything a
   non-city project needs: the WebGLRenderer, scene, rig, sunRig, the full post chain (RTs +
   materials + passes), the quality governor, style state, and the resize + context-restore
   reliability backbone. It has NO city content — no wave sim, no water surface, no citygen,
   no terrain — so Mission Control / websites / games / apps can boot it and add their own content.

   Two SEAMS bridge the core/city boundary:
     core.onContextRestored(fn)       — city registers its cache-invalidator (sky-IBL + shadow)
     core.registerContentResizer(fn)  — city registers its RT resizers (grabRT + planarRefl)
   Both follow the app-shell onResize precedent (same one-callback pattern).

   createEngine.js is now a thin flat-merge wrapper: const core = createEngineCore(opts);
   const city = createCityWorld(core, opts); return { ...core, ...city };
   ============================================================ */
import * as THREE from 'three';

import { createCameraRig } from './camera-rig.js';
import { createSunRig, lowSunWashK } from './sun-rig.js';
import { createEngineProfiler } from './profiler.js';
import { createQualityGovernor } from './quality-governor.js';
import { ERA_PRESETS, SCENE_ERA_ORDER, makePaletteTexture } from './pixelkit/pixelkit.js';
import { vectorOn } from './vector-style.js';   // shared singleton — ONE module copy per package

import fullscreenVert    from './shaders/fullscreen.vert';
import postFilmicFrag    from './shaders/post-filmic.frag';
import postPixelFrag     from './shaders/post-pixel.frag';
import postToonFrag      from './shaders/post-toon.frag';
import postMixFrag       from './shaders/post-mix.frag';
import postBrightFrag    from './shaders/post-bright.frag';
import postBlurFrag      from './shaders/post-blur.frag';
import postGodraysFrag   from './shaders/post-godrays.frag';
import postPixelkitFrag  from './shaders/post-pixelkit.frag';

// L112 — the NIGHT factor (beauty-only): 0 in full day INCLUDING noon (the byte-identical anchor),
// ramping to 1 as the sun drops below the horizon across the dusk window. Used by bloomPass.
const sunDownK = (y) => 1.0 - THREE.MathUtils.smoothstep(y, -0.02, 0.45);

/* ---- PIXEL / PALETTE PARAMS ---- */
const PIXEL_SIZE = 220;   // virtual pixels across the screen width

/* L09 — each THEME now has FOUR authored time-of-day palettes (night/dawn/noon/dusk). */
const THEME_INK_GOLD = {
  night: ['#0A0C16', '#1C2236', '#3A3A52', '#5A5A78', '#8A92B0'],
  dawn:  ['#1A1008', '#43281A', '#7A4A30', '#B07A4E', '#E8A86A'],
  noon:  ['#16100A', '#3A2F1E', '#6B563A', '#937B54', '#B89968'],
  dusk:  ['#140A0A', '#3E1E1A', '#7A3828', '#B85A36', '#F0884A'],
};
const THEME_TERMINAL = {
  night: ['#020604', '#06180E', '#10401E', '#1E9040', '#7FE0FF'],
  dawn:  ['#060603', '#1A2410', '#3A6B22', '#6CC040', '#FFC060'],
  noon:  ['#050805', '#0E2912', '#1E6B2F', '#3CF06A', '#FFB000'],
  dusk:  ['#080402', '#241408', '#6B4A12', '#E0A030', '#FF7030'],
};

/* L90 H2 — the no-WebGL2 fallback panel. */
export function showWebGLUnsupported(msg) {
  if (typeof document === 'undefined' || document.getElementById('lgr-nowebgl')) return;
  const el = document.createElement('div');
  el.id = 'lgr-nowebgl';
  el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;'
    + 'background:#0e1116;color:#cdd6e4;font:16px/1.6 system-ui,-apple-system,sans-serif;text-align:center;padding:2rem;';
  el.innerHTML = '<div style="max-width:30rem"><div style="font-size:2.4rem;margin-bottom:1rem">🌊</div>'
    + '<h1 style="font-size:1.3rem;margin:0 0 .6rem;color:#fff;font-weight:600">This experience needs a modern browser</h1>'
    + '<p style="margin:0;color:#9aa6b8">' + msg + '</p></div>';
  document.body && document.body.appendChild(el);
}

export function createEngineCore(opts = {}) {
  /* Container seam — boot `createEngineCore({ container: el })` to mount the canvas inside `el`
     instead of document.body. Falls back to document.body when omitted (city/office/hoard unchanged). */
  const _container = opts.container instanceof Element ? opts.container : document.body;
  const _cW = () => _container.clientWidth  || window.innerWidth;
  const _cH = () => _container.clientHeight || window.innerHeight;

  /* 1) RENDERER. */
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch (err) {
    showWebGLUnsupported('This experience needs WebGL2 — please open it in an up-to-date browser (Chrome, Edge, Firefox, or Safari on iOS 15+) with hardware acceleration enabled.');
    throw err;
  }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
  const _coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const _rmQuery = (typeof window !== 'undefined' && window.matchMedia) ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const BOOT_DPR_CAP = _coarse ? 1.5 : 2;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, BOOT_DPR_CAP));
  renderer.setSize(_cW(), _cH());
  renderer.setClearColor(0x0e0b07, 1);
  _container.appendChild(renderer.domElement);
  const drawBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());

  /* L78 CONTEXT-LOSS RECOVERY + PAUSE.
     Core registers the webglcontextrestored listener; city fills the invalidator via
     core.onContextRestored(fn) (rebuild sky-IBL PMREM + shadow re-render). */
  let _contextLost = false, _paused = false;
  let _onContextRestored = () => {};   // seam: city registers its cache-invalidator here
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    _contextLost = true; if (typeof window !== 'undefined') window.__contextLost = true;
  }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    _onContextRestored();
    _contextLost = false; if (typeof window !== 'undefined') window.__contextLost = false;
  }, false);

  /* 2) SCENE + CAMERA RIG */
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x9fb0be, 0.0);
  const OVERCAST_GREY = new THREE.Color('#aeb6c0');
  const FOG_DENSITY = 0.062;
  const AERIAL_BASE = 0.016;
  const FOG_NIGHT_TINT = new THREE.Color('#74508f');
  const _fogColor = new THREE.Color();
  const rig = createCameraRig({ aspect: _cW() / _cH() });

  /* 2b) SUN RIG (MOVED to core — post materials bind sunRig.* BY REFERENCE at construction). */
  const sunRig = createSunRig({ t: 0.5 });

  /* ------------------------------------------------------------
     8) THE POST CHAIN — render targets + fullscreen passes.
     ------------------------------------------------------------ */
  const sceneDepth = new THREE.DepthTexture(drawBuffer.x, drawBuffer.y);
  const sceneRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, depthTexture: sceneDepth,
  });
  const filmicRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  /* L83 MSAA — isolated multisampled beauty RT. Beauty renders here; pixel/toon/vector keep sceneRT. */
  const beautyRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, samples: 4,
    type: THREE.HalfFloatType,   // L-dusk-washout-r4: true HDR so ACES sees unbounded values
  });
  const toonRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  const pixelRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  /* L66 BLOOM buffers — half resolution. */
  let bloomW = Math.max(1, Math.floor(drawBuffer.x / 2)), bloomH = Math.max(1, Math.floor(drawBuffer.y / 2));
  const bloomA = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  const bloomB = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  /* L107 GOD-RAY buffers — also half-res. */
  const raysBright = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  const raysRT     = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  // NOTE: planarRefl is city-owned (city registers it with the resize registry below).

  const postScene  = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postQuad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  postScene.add(postQuad);

  const filmicMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postFilmicFrag,
    uniforms: {
      uScene:      { value: sceneRT.texture },
      uTime:       { value: 0 },
      uResolution: { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uGrain:      { value: 1.0 },
      uChroma:     { value: 1.0 },
      uExposure:   { value: 1.0 },
      uAces:       { value: 0.0 },
      uBloom:        { value: bloomA.texture },
      uBloomStrength:{ value: 0.0 },
      uGrade:        { value: 0.0 },
      uGradeTint:    { value: sunRig.grade.tint },   // by-ref — SunRig drives this
      uGradeLift:    { value: sunRig.grade.lift },
      uGradeSat:     { value: 1.0 },
      uGradeContrast:{ value: 1.0 },
      uWarmBal:      { value: 0.0 },
      uDither:       { value: 0.0 },
      uTonemap:      { value: 0.0 },
      uRaysTex:      { value: raysRT.texture },
      uRays:         { value: 0.0 },
      uBeautyExp:    { value: 1.0 },
    },
  });

  /* L66 BLOOM materials + pass. */
  const brightMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: postBrightFrag,
    uniforms: { uScene: { value: sceneRT.texture }, uThreshold: { value: 0.78 } },
  });
  const blurMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: postBlurFrag,
    uniforms: { uScene: { value: bloomA.texture }, uDir: { value: new THREE.Vector2() } },
  });
  const BLOOM_BASE = 0.85;
  function bloomPass(srcRT) {
    const lowSun = 1.0 - THREE.MathUtils.clamp(sunRig.sunArc.y * 2.2, 0, 1);
    const _duskGate = lowSunWashK(sunRig.sunArc.y);
    brightMaterial.uniforms.uThreshold.value = Math.max(0.60 + 0.08 * _duskGate, (0.92 + 0.30 * lowSun) - 0.62 * sunDownK(sunRig.sunArc.y));
    brightMaterial.uniforms.uScene.value = srcRT.texture;
    runPass(brightMaterial, bloomA);
    blurMaterial.uniforms.uScene.value = bloomA.texture;
    blurMaterial.uniforms.uDir.value.set(1.6 / bloomW, 0);
    runPass(blurMaterial, bloomB);
    blurMaterial.uniforms.uScene.value = bloomB.texture;
    blurMaterial.uniforms.uDir.value.set(0, 1.6 / bloomH);
    runPass(blurMaterial, bloomA);
    filmicMaterial.uniforms.uBloom.value = bloomA.texture;
    filmicMaterial.uniforms.uBloomStrength.value = BLOOM_BASE * (0.32 + 0.95 * lowSun);
  }

  /* L107 GOD RAYS — screen-space crepuscular shafts, beauty-tier only. */
  const RAY_THRESHOLD = 1.9, RAYS_MAX = 0.22;
  const godraysMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: postGodraysFrag,
    uniforms: { uBright: { value: raysBright.texture }, uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uDensity: { value: 0.9 }, uDecay: { value: 0.96 }, uWeight: { value: 0.05 } },
  });
  const _sunClip = new THREE.Vector4();
  function godraysPass(srcRT) {
    _sunClip.set(rig.camera.position.x + sunRig.sunDir.x * 88, rig.camera.position.y + sunRig.sunDir.y * 88, rig.camera.position.z + sunRig.sunDir.z * 88, 1.0)
      .applyMatrix4(rig.camera.matrixWorldInverse).applyMatrix4(rig.camera.projectionMatrix);
    const w = _sunClip.w;
    const ndcx = _sunClip.x / w, ndcy = _sunClip.y / w;
    const inFrame = w > 0 ? (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(ndcx), Math.abs(ndcy)), 0.9, 1.35)) : 0;
    const lowSun = 1.0 - THREE.MathUtils.clamp(sunRig.sunArc.y * 2.2, 0, 1);
    const sunUp = THREE.MathUtils.smoothstep(sunRig.sunArc.y, -0.05, 0.06);
    const strength = RAYS_MAX * lowSun * inFrame * sunUp;
    if (strength <= 0.001) { filmicMaterial.uniforms.uRays.value = 0.0; return; }
    godraysMaterial.uniforms.uSunUv.value.set(ndcx * 0.5 + 0.5, ndcy * 0.5 + 0.5);
    brightMaterial.uniforms.uThreshold.value = RAY_THRESHOLD;
    brightMaterial.uniforms.uScene.value = srcRT.texture;
    runPass(brightMaterial, raysBright);
    godraysMaterial.uniforms.uBright.value = raysBright.texture;
    runPass(godraysMaterial, raysRT);
    filmicMaterial.uniforms.uRaysTex.value = raysRT.texture;
    filmicMaterial.uniforms.uRays.value = strength;
  }

  /* PALETTES (L09) */
  const PAL_SIZE = 5;
  const pad8 = (hexes) => {
    const a = hexes.map((h) => new THREE.Color(h));
    while (a.length < 8) a.push(new THREE.Color(0, 0, 0));
    return a;
  };
  const SLOTS = ['night', 'dawn', 'noon', 'dusk'];
  const PALCACHE = {
    inkgold:  SLOTS.map((s) => pad8(THEME_INK_GOLD[s])),
    terminal: SLOTS.map((s) => pad8(THEME_TERMINAL[s])),
  };

  const pixelMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postPixelFrag,
    uniforms: {
      uScene:        { value: filmicRT.texture },
      uResolution:   { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uPixelSize:    { value: PIXEL_SIZE },
      uPalette:      { value: PALCACHE.inkgold[2] },
      uPaletteB:     { value: PALCACHE.inkgold[2] },
      uPaletteBlend: { value: 0.0 },
      uPaletteSize:  { value: PAL_SIZE },
    },
  });

  const pixelkitMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postPixelkitFrag,
    uniforms: {
      uScene:       { value: filmicRT.texture },
      uResolution:  { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uGridWidth:   { value: 160 },
      uDither:      { value: 0.55 },
      uPalette:     { value: makePaletteTexture(ERA_PRESETS['8-bit'].palette) },
      uPaletteSize: { value: 1 },
      uUsePalette:  { value: 1.0 },
    },
  });
  const ERA_TEX = {};
  for (const name of SCENE_ERA_ORDER) ERA_TEX[name] = ERA_PRESETS[name].palette ? makePaletteTexture(ERA_PRESETS[name].palette) : null;

  const toonMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postToonFrag,
    uniforms: {
      uScene:         { value: filmicRT.texture },
      uDepth:         { value: sceneDepth },
      uResolution:    { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uBands:         { value: 4.0 },
      uToonGain:      { value: 1.7 },
      uToonGamma:     { value: 0.6 },
      uToonFloor:     { value: sunRig.toonFloor },   // by-ref
      uOutline:       { value: sunRig.outline },      // by-ref
      uNear:          { value: 0.1 },
      uFar:           { value: 100 },
      uIsPerspective: { value: 1.0 },
    },
  });

  const mixMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postMixFrag,
    uniforms: {
      uToon:  { value: toonRT.texture },
      uPixel: { value: pixelRT.texture },
      uBlend: { value: 0.0 },
    },
  });

  function runPass(material, target) {
    postQuad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(postScene, postCamera);
  }

  /* 11) RESIZE — core RTs + uResolution. Content RTs (grabRT, planarRefl) are registered by city
     via registerContentResizer so the engine-core module has no city knowledge. */
  const _contentResizers = [];
  function registerContentResizer(fn) { _contentResizers.push(fn); }
  function resize() {
    rig.setViewport(_cW(), _cH());
    renderer.setSize(_cW(), _cH());
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    sceneRT.setSize(db.x, db.y);
    filmicRT.setSize(db.x, db.y);
    beautyRT.setSize(db.x, db.y);
    toonRT.setSize(db.x, db.y);
    pixelRT.setSize(db.x, db.y);
    bloomW = Math.max(1, db.x >> 1); bloomH = Math.max(1, db.y >> 1);
    bloomA.setSize(bloomW, bloomH); bloomB.setSize(bloomW, bloomH);
    raysBright.setSize(bloomW, bloomH); raysRT.setSize(bloomW, bloomH);
    filmicMaterial.uniforms.uResolution.value.set(db.x, db.y);
    pixelMaterial.uniforms.uResolution.value.set(db.x, db.y);
    pixelkitMaterial.uniforms.uResolution.value.set(db.x, db.y);
    toonMaterial.uniforms.uResolution.value.set(db.x, db.y);
    for (const fn of _contentResizers) fn(db);   // city: grabRT + planarRefl + waterMaterial.uResolution
    return db;
  }

  /* ============================================================
     L78 ENGINE HARDENING — profiler + quality governor.
     ============================================================ */
  const profiler = createEngineProfiler({ renderer });
  let _qualityShadows = true;
  let _qualityRefl = true;
  function applyQuality(level, rung) {
    const cap = rung.dpr == null ? BOOT_DPR_CAP : rung.dpr;
    const want = Math.min(window.devicePixelRatio, cap);
    if (Math.abs(renderer.getPixelRatio() - want) > 1e-3) {
      renderer.setPixelRatio(want);
      if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('resize'));
      else resize();
    }
    _qualityShadows = rung.shadows !== false;
    if (!_qualityShadows) renderer.shadowMap.needsUpdate = false;
    _qualityRefl = rung.refl !== false;
  }
  const governor = createQualityGovernor({ profiler, apply: applyQuality });

  function frameStart() { if (!_paused && !_contextLost) profiler.frameStart(); }
  function frameEnd() { if (_paused || _contextLost) return; profiler.frameEnd(); governor.update(); if (typeof window !== 'undefined') window.__frames++; }
  function setActive(visible) { _paused = !visible; if (typeof window !== 'undefined') window.__paused = _paused; }

  /* ============================================================
     STYLE STATE (mode/vector/palette/era) + style functions + setters.
     decideStyle() is PURE here — the waterMaterial uniform side-effects moved to
     city's renderCityPipeline (which runs immediately after in the caller's loop).
     ============================================================ */
  let mode = 3, vector = false, terminalPalette = false, sceneEra = 'native';
  const STYLE_NEAR = 0.30, STYLE_FAR = 0.46, ERA_8BIT = 0.62, ERA_GB = 0.80;
  const SCENE_ERAS = ['native', ...SCENE_ERA_ORDER];
  const ERA_LABEL = { '16-bit': '16-bit', '8-bit': '8-bit', 'gb': 'Game Boy', 'modern': 'Modern', 'native': 'Pixel', '1-bit': '1-bit' };
  if (typeof window !== 'undefined') { window.__mode = mode; window.__vector = vector; window.__era = sceneEra; }
  if (typeof window !== 'undefined') window.__frames = 0;
  if (typeof window !== 'undefined') window.__loaded = false;

  function updatePixelPalette(t) {
    const cache = terminalPalette ? PALCACHE.terminal : PALCACHE.inkgold;
    const seg = (t % 1) * 4;
    const i = Math.floor(seg) % 4;
    pixelMaterial.uniforms.uPalette.value  = cache[i];
    pixelMaterial.uniforms.uPaletteB.value = cache[(i + 1) % 4];
    pixelMaterial.uniforms.uPaletteBlend.value = seg - Math.floor(seg);
  }
  function setEra(name) {
    const p = ERA_PRESETS[name];
    if (!p) return;
    pixelkitMaterial.uniforms.uGridWidth.value = p.gridWidth;
    pixelkitMaterial.uniforms.uDither.value = p.dither;
    pixelkitMaterial.uniforms.uUsePalette.value = p.palette ? 1.0 : 0.0;
    if (p.palette) { pixelkitMaterial.uniforms.uPalette.value = ERA_TEX[name]; pixelkitMaterial.uniforms.uPaletteSize.value = p.palette.length; }
  }
  function applySceneEra() { if (sceneEra !== 'native') setEra(sceneEra); }
  const pixelPass = () => (sceneEra === 'native' ? pixelMaterial : pixelkitMaterial);

  /* decideStyle — PURE: returns _computeStyle() result. The waterMaterial uniform updates
     (uChromaScale, uSkyRefl) that lived here previously now run at the head of city's
     renderCityPipeline (called immediately after in every project's loop). */
  function decideStyle() { return _computeStyle(); }
  function _computeStyle() {
    if (mode === 1 || mode === 2) return { kind: 'none' };
    if (mode === 7) return { kind: 'pixel' };
    if (mode === 8) return { kind: 'toon' };
    const t = rig.styleT; window.__styleT = t;
    if (t <= STYLE_NEAR) return { kind: 'toon' };
    const era = t < ERA_8BIT ? '16-bit' : t < ERA_GB ? '8-bit' : 'gb';
    if (t >= STYLE_FAR) return { kind: 'pixel', era };
    return { kind: 'blend', blend: THREE.MathUtils.smoothstep(t, STYLE_NEAR, STYLE_FAR), era: '16-bit' };
  }
  function styleHintName(style) {
    if (mode === 1 || mode === 2) return '';
    if (vector && mode !== 7 && mode !== 8) return 'Vector';
    if (style.kind === 'toon') return 'Toon';
    if (style.kind === 'pixel') return ERA_LABEL[style.era || sceneEra] || 'Pixel';
    if (style.kind === 'blend') return 'Toon → ' + (ERA_LABEL[style.era] || 'Pixel');
    return '';
  }

  function setPostMode(n) { mode = n; window.__mode = mode; }
  function toggleVector() { vector = !vector; vectorOn.value = vector ? 1 : 0; window.__vector = vector; return vector; }
  function setVector(v) { vector = !!v; vectorOn.value = vector ? 1 : 0; window.__vector = vector; return vector; }
  function cycleEra() { sceneEra = SCENE_ERAS[(SCENE_ERAS.indexOf(sceneEra) + 1) % SCENE_ERAS.length]; window.__era = sceneEra; applySceneEra(); return sceneEra; }
  function togglePalette() { terminalPalette = !terminalPalette; return terminalPalette; }

  /* SEAM: city registers its context-restore cache-invalidator (rebuild sky-IBL + shadow). */
  function onContextRestored(fn) { _onContextRestored = fn; }

  return {
    // seams (city registers its content at construction time)
    onContextRestored, registerContentResizer,
    // renderer + core geometry
    renderer, drawBuffer, scene, rig, sunRig,
    // post RTs
    sceneDepth, sceneRT, filmicRT, beautyRT, toonRT, pixelRT,
    bloomA, bloomB, raysBright, raysRT,
    // post geometry + materials
    postScene, postCamera, postQuad,
    filmicMaterial, brightMaterial, blurMaterial, godraysMaterial,
    pixelMaterial, pixelkitMaterial, toonMaterial, mixMaterial,
    // passes + caches
    PALCACHE, ERA_TEX, runPass, bloomPass, godraysPass,
    // lifecycle
    resize,
    // profiler + governor
    profiler, governor, frameStart, frameEnd, setActive,
    get paused() { return _paused; },
    get contextLost() { return _contextLost; },
    // quality knobs (city's renderCityPipeline reads these)
    get _qualityRefl() { return _qualityRefl; },
    get _qualityShadows() { return _qualityShadows; },
    // style state (getters for live access)
    get mode() { return mode; },
    get vector() { return vector; },
    get sceneEra() { return sceneEra; },
    // style API
    decideStyle, styleHintName, updatePixelPalette, setEra,
    setPostMode, toggleVector, setVector, cycleEra, togglePalette,
    setTonemap: (m) => { const agx = (m === 'agx' || m === 1 || m === true); filmicMaterial.uniforms.uTonemap.value = agx ? 1.0 : 0.0; if (typeof window !== 'undefined') window.__tonemap = agx ? 'agx' : 'aces'; return agx ? 'agx' : 'aces'; },
    // fog state (shared by the tick loop, by reference)
    OVERCAST_GREY, FOG_DENSITY, FOG_NIGHT_TINT, _fogColor,
  };
}
