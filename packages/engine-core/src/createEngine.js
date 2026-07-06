/* ============================================================
   LGR WebGL Lab — Lesson 37: EXTRACTION E1b-1 — createEngine() (engine bootstrap)
   ------------------------------------------------------------
   This module is the first half of the engine extraction (E1b). For ~30 lessons the
   whole engine lived as a god `main()` in src/main.js: it CONSTRUCTED everything
   (renderer, scene, water sim, city, the post chain) AND ran all the behaviour
   (input, scene-modes, the office-dive, the Hoard game, the tick loop). E1a (L36)
   moved the reusable modules into src/core/. E1b-1 (this lesson) lifts the engine
   BOOTSTRAP — the pure CONSTRUCTION — into `createEngine()`, which returns an opaque
   HANDLE (renderer, scene, rig, city, the post materials, …). `main.js` becomes the
   consumer: it destructures the handle and keeps the BEHAVIOUR (style state, the
   scene-mode machine, office/hoard wiring, input, the tick loop) referencing those
   handles. The behavioural REDESIGN (a scene-mode registry, office/hoard through a
   thin API, an engine.probe object) is E1b-2 — kept as a second commit so this one
   stays a behaviour-IDENTICAL relocation you can verify by diffing the running app.

   C++ anchor: `createEngine()` is a CONSTRUCTOR returning an opaque handle + a couple
   of methods (an engine OBJECT) instead of a free-floating `main()` with hundreds of
   file-scope globals. The returned object is the `this` the rest of the program talks
   to — accessor over extern. The vector-style singletons (vectorOn/vectorTint/fogCharm)
   are imported in BOTH this module and main.js; an ES `import` binding is the same
   underlying object in every importer (like one `extern` symbol linked into two .o
   files), so a uniform bound to `vectorOn` here still flips when main.js sets
   `vectorOn.value` — no need to thread them through the handle.
   ============================================================ */
import * as THREE from 'three';

import { createCameraRig } from './camera-rig.js';
import { createCity } from './citygen.js';
import { createSunRig } from './sun-rig.js';
import { createCityLife } from './agents.js';
import { createWaterLife } from './water-life.js';
import { createLandmarkFactory } from './landmarks.js';
import { createWeatherRig } from './weather-rig.js';
import { createCloudField } from './clouds.js';
import { createInspector } from './inspect.js';
import { createPlacedLife } from './placed-life.js';
import { createWaterFlow } from './water-flow.js';   // L81: live virtual-pipes water flow (From-Dust)
import { createDust } from './dust.js';               // L94: ambient drifting dust/pollen (the "alive" air)
import { createEditor } from './editor.js';
import { createPilotController, NO_WATER } from './pilot.js';   // L76: possession + ground MovementModel; L107: the shared no-water sentinel
import { createEngineProfiler } from './profiler.js';        // L78: honest perf (p95/p99 + GPU-ms + leak gate)
import { createQualityGovernor } from './quality-governor.js'; // L78: adaptive quality (lock a smooth fps)
import { createLoaderProgress } from './loader-progress.js';   // L107: one shared LoadingManager → a 0..1 boot-progress signal
import { generateTerrain, buildTerrainMesh, rebuildTerrainChunks, PRESET_KEYS, BIOMES } from './terrain.js';
import { createScatter, buildScatterGroup, reprojectScatter, scatterAdd, scatterErase, SLOPE_BY_TYPE } from './scatter.js';
import { createWorldLakes } from './world-water.js';
import { seedWorldEditorCatalog } from './catalog.js';
import { createSkyAtmosphere } from './sky-atmosphere.js';
import { createCelestials } from './celestials.js';
import { createColliderWorld } from './collide.js';   // L108 (part C): flight collision — grid + sphere-vs-AABB soft push-out
import { LAYOUT } from './citygen.js';                 // L108: PITCH (the city grid) sizes the collider cells
import {
  vectorOn, vectorTint, fogCharm, vectorShadow, weatherSnow, weatherCloud, weatherCloudOff, weatherSeason, windowRecess,
  aoStrength,   // L80: shared beauty-tier AO gate (1 on the beauty scene render, 0 on pixel/vector/toon)
  swayTime, swayWind,   // L94: shared ambient-sway clock + amplitude (foliage breathes; terrain opts out)
} from './vector-style.js';

// L108 A2 — the LOW-MID-SUN WASHOUT band (money-path GATE). A BUMP on the sun ELEVATION (sunArc.y): ~0 below
// the horizon (deep dawn t≈0.20 = the great dark frame → PROTECTED) and at noon (sunArc.y≈0.765 → midK owns it),
// ramping to ~1 through golden (sunArc.y≈0.14–0.41, t≈0.28–0.34 — the ATTRACT OPEN) + afternoon (t≈0.65–0.72,
// same elevations, covered symmetrically for free). Complements midK; the A2 levers add a *lowSunWashK* term
// ALONGSIDE the midK term (never replacing it). Live-tuned in the browser against building≠sky ≥20 + a rich sky.
const lowSunWashK = (y) => THREE.MathUtils.smoothstep(y, 0.02, 0.20) * (1 - THREE.MathUtils.smoothstep(y, 0.45, 0.70));

// L112 — the NIGHT factor (beauty-only): 0 in full day INCLUDING noon (the byte-identical anchor), ramping to 1
// as the sun drops below the horizon across the dusk window (t≈0.72→0.78, sunArc.y +0.22→−0.02). Mirrors the
// lowSunWashK/midK family. Drives the dusk/night city lights (windows bloom + warm street fill).
const sunDownK = (y) => 1.0 - THREE.MathUtils.smoothstep(y, -0.02, 0.22);
const NIGHT_STREET_WARM = new THREE.Color('#3a2c22');   // L112 A-ii: warm ambient the night hemi-fill leans toward (lights building faces → the city gets FORM)
// L114 fix D: WRAP the water clock here. uTime feeds foam `sin(uTime*0.9)` (SMOOTH) + glint `hash21(floor(uTime*10))` +
// foam-churn `hash21(vUv*512+uTime)` (both NOISE). Unbounded `elapsed` pushed the hash inputs into float32 ulp → the
// glint twinkle collapsed to ~4 levels by ~5–10 min. Wrap at a MULTIPLE of the lapPulse period (2π/0.9) so the only
// smooth consumer, sin(uTime*0.9), is SEAMLESS across the wrap; the two hashes are per-frame noise → their wrap
// discontinuity is invisible. ~63 s keeps uTime tiny (hashes crisp) and the reset far rarer than a session matters.
const WATER_CLOCK_PERIOD = (2 * Math.PI / 0.9) * 9;    // ≈ 62.8 s (9 lapPulse cycles)

import backdropVert      from './shaders/backdrop.vert';
import backdropFrag      from './shaders/backdrop.frag';
import fullscreenVert    from './shaders/fullscreen.vert';
import waterSimFrag      from './shaders/water-sim.frag';
import waterSurfaceVert  from './shaders/water-surface.vert';
import waterSurfaceFrag  from './shaders/water-surface.frag';
import postFilmicFrag    from './shaders/post-filmic.frag';
import postPixelFrag     from './shaders/post-pixel.frag';
import postToonFrag      from './shaders/post-toon.frag';
import postMixFrag       from './shaders/post-mix.frag';
import postBrightFrag    from './shaders/post-bright.frag';   // L66 bloom bright-pass
import postBlurFrag      from './shaders/post-blur.frag';     // L66 bloom separable blur
import postGodraysFrag   from './shaders/post-godrays.frag';  // L107 crepuscular rays (beauty-gated)
import postPixelkitFrag  from './shaders/post-pixelkit.frag';
import { ERA_PRESETS, SCENE_ERA_ORDER, makePaletteTexture } from './pixelkit/pixelkit.js';

/* ---- PARAMS — Lesson 06 tunables ------------------------------------------
   The two pixel palettes live HERE (they're uniforms, swappable live with P).
   Shader-side constants (dither strength, vignette shape) live at the top of
   the respective .frag files. */
const PIXEL_SIZE = 220;            // virtual pixels across the screen width

/* L09 — each THEME now has FOUR authored time-of-day palettes (night/dawn/noon/dusk),
   same order + length so the pixel pass can lerp them entry-by-entry as the day turns
   (the Pokémon Gold/Silver trick, made continuous). Slot order matches the SunRig
   keyframes: [night, dawn, noon, dusk] at t = 0 / .25 / .5 / .75. Noon = the L06 ramp. */
const THEME_INK_GOLD = {
  night: ['#0A0C16', '#1C2236', '#3A3A52', '#5A5A78', '#8A92B0'], // cool moonlit
  dawn:  ['#1A1008', '#43281A', '#7A4A30', '#B07A4E', '#E8A86A'], // warm low sun
  noon:  ['#16100A', '#3A2F1E', '#6B563A', '#937B54', '#B89968'], // brand day
  dusk:  ['#140A0A', '#3E1E1A', '#7A3828', '#B85A36', '#F0884A'], // red dusk
};
const THEME_TERMINAL = {
  night: ['#020604', '#06180E', '#10401E', '#1E9040', '#7FE0FF'], // green + cool moon glow
  dawn:  ['#060603', '#1A2410', '#3A6B22', '#6CC040', '#FFC060'], // warm amber sunrise
  noon:  ['#050805', '#0E2912', '#1E6B2F', '#3CF06A', '#FFB000'], // phosphor day
  dusk:  ['#080402', '#241408', '#6B4A12', '#E0A030', '#FF7030'], // amber/orange dusk
};

/* createEngine — build the whole renderer/scene/sim/city/post stack and return the
   handle. `opts.demo` strips lab branding from the refraction card (?demo=1/?capture=,
   computed by main.js). `opts.citySeed`/`opts.profileIndex` pick the starting city —
   main owns those as mutable state (G rerolls, C cycles) and re-drives city.generate(). */
/* L90 H2 — the no-WebGL2 fallback panel. A full-screen, self-contained message (no engine assets needed,
   since the engine couldn't start). Shown once; halts the black-screen failure mode on old/locked devices. */
function showWebGLUnsupported(msg) {
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

export function createEngine({ demo = false, citySeed = 0, profileIndex = 0 } = {}) {
  /* 1) RENDERER. */
  // preserveDrawingBuffer keeps the last frame readable so L15's `S` still (canvas.toBlob) captures
  // exactly what's on screen. (Small always-on cost; the zero-cost alternative is re-render+toBlob
  // in one task — see capture.js. Video/captureStream doesn't need it.)
  // L90 H2 — WebGL2 capability gate. three r184 requires WebGL2; `new WebGLRenderer()` THROWS when the
  // browser/device can't give a context (old iOS Safari, locked-down webviews, GPU disabled). Catch it and
  // show a friendly full-screen panel instead of a blank/black page, then halt boot cleanly.
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  } catch (err) {
    showWebGLUnsupported('This experience needs WebGL2 — please open it in an up-to-date browser (Chrome, Edge, Firefox, or Safari on iOS 15+) with hardware acceleration enabled.');
    throw err;
  }
  // L16 SHADOWS: a shadow map is just another render-to-texture — the scene's DEPTH rendered from
  // the sun's point of view. PCF (percentage-closer filtering) samples a few neighbouring texels
  // and averages, for soft edges instead of hard aliased ones. (PCFSoftShadowMap is deprecated in
  // this Three version — PCFShadowMap is the current soft default.)
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // L40 WIN A: by default the 2048² directional shadow map re-renders the WHOLE city EVERY frame, even
  // though the sun moves slowly (or not at all). autoUpdate=false turns it into a DIRTY FLAG — updateWorld
  // sets `needsUpdate=true` only when the sun direction actually moved (or the city regenerated), so most
  // frames skip the shadow re-render entirely. (C++: cache an expensive result, invalidate on change.)
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;            // render it once at boot
  // L40: dPR capped at 2 on desktop, but 1.5 on COARSE pointers (touch/mobile) — a big fill-rate win on
  // retina phones (dPR is a supersampling factor: 2 = 4× the pixels) for negligible visible loss at phone DPI.
  const _coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const BOOT_DPR_CAP = _coarse ? 1.5 : 2;           // L78: the governor's level-0 dpr ceiling (so level 0 == boot == byte-identical)
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, BOOT_DPR_CAP));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x0e0b07, 1);
  document.body.appendChild(renderer.domElement);
  const drawBuffer = renderer.getDrawingBufferSize(new THREE.Vector2());

  /* L78 CONTEXT-LOSS RECOVERY + PAUSE — the reliability backbone. A phone WILL lose the GL context
     (backgrounding, GPU memory pressure, a tab switch); without handling it that's a PERMANENT BLACK
     SCREEN = a lost client booking. We (1) preventDefault the loss (tells the browser we'll recover) +
     flag it, and (2) on restore, invalidate the app-level caches the GPU can't auto-rebuild — the
     sky-IBL PMREM env + the shadow map — and clear the flag (Three re-uploads textures/geometries/
     programs + recreates render-target framebuffers lazily on the next render). `_paused` (pause-on-
     hidden) and `_contextLost` both tell the project's loop to skip the frame. */
  let _contextLost = false, _paused = false;
  let _invalidateCaches = () => {};                 // bound below once envTex/shadow exist (closure forward-ref)
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();                             // REQUIRED — without it the context never restores
    _contextLost = true; if (typeof window !== 'undefined') window.__contextLost = true;
  }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    _invalidateCaches();                            // rebuild sky-IBL env + force a shadow re-render
    _contextLost = false; if (typeof window !== 'undefined') window.__contextLost = false;
  }, false);

  /* 2) SCENE + CAMERA RIG — the rig owns BOTH a perspective and an orthographic
     camera and hands back whichever the current mode needs. Everywhere we used to
     pass `camera` to a render/raycast we now pass `rig.camera` (a live getter), so
     the whole pipeline re-aims the instant the mode switches. The water shader reads
     the built-in `cameraPosition`/`viewMatrix` uniforms, which Three refreshes from
     whatever camera renders — so specular and refraction follow the rig for free. */
  const scene = new THREE.Scene();
  // L18 FOG — set at boot (density 0) so every lit material COMPILES with the fog chunks; the
  // weather rig raises the density and we tint it to the SunRig horizon each frame (foggy dawn =
  // warm, foggy night = blue), so distant buildings fade into the sky backdrop. FogExp2 (density
  // grows with the SQUARE of distance) suits a stylised look — a soft, fast falloff, no hard plane.
  scene.fog = new THREE.FogExp2(0x9fb0be, 0.0);
  const OVERCAST_GREY = new THREE.Color('#aeb6c0');   // L18: the sun's colour drifts toward this under cloud
  /* L20 DRAMATIC fog tunables. FOG_DENSITY (was 0.075) is pushed up so distance genuinely melts while
     near neon stays readable; FOG_NIGHT_TINT is the moody violet haze the night fog drifts toward
     (instead of flat sky-grey) — the "neon through purple murk" charm John asked for. */
  const FOG_DENSITY = 0.062;                            // moderate: lets the near→far melt GRADIENT show (in
                                                       // ortho a high density just saturates uniformly)
  /* L92 AERIAL PERSPECTIVE — a subtle ALWAYS-ON FogExp2 baseline (atop any weather fog) tinted to the sky
     HORIZON each frame, so distant blocky geometry fades into the sky, the palette unifies, and depth reads
     even in clear weather. Beer–Lambert (FogExp2: factor = 1 − exp(−density²·dist²)). This is the UNIVERSAL
     low-tier path — vertex fog, NO depth texture (depth-texture fog BANDS on some Android) — so it ships on
     every device/tier; the colour already tracks `sunRig.horizon` (warm dawn/dusk → cool noon → blue night). */
  const AERIAL_BASE = 0.016;
  const FOG_NIGHT_TINT = new THREE.Color('#74508f');   // luminous violet — the city melts into purple murk
  const _fogColor = new THREE.Color();                 // scratch (no per-frame alloc)
  const rig = createCameraRig({ aspect: window.innerWidth / window.innerHeight });

  /* 2b) SUN RIG (L09) — one scalar `t` drives the day/night cycle. It exposes Color/
     Vector3 objects it mutates in place; consumers below bind them BY REFERENCE so the
     sun, water, towers, sky and post all stay phase-locked with zero per-frame alloc.
     Portable: this module knows nothing about our scene — see src/core/sun-rig.js. */
  const sunRig = createSunRig({ t: 0.5 });   // boot at noon

  /* 3) THE SIMULATION STATE — three render targets (unchanged from L03/04).
     L90 H1 — WAVE-SIM PRECISION GATE. The always-on wave sim (ALL three projects, not opt-in) renders into
     HalfFloat RTs every frame; heights oscillate ± (Verlet integration), so it needs a SIGNED float colour
     buffer. iOS/Safari WebGL2 has historically lacked EXT_color_buffer_(half_)float → rendering into the RT
     fails (black/garbage), the scariest "prospect opens it on their iPhone → black screen" path. So we PROBE
     the extension (same pattern as water-flow-gpu.js) and, when absent, fall back to a FLAT lit sea: skip the
     RTs + the sim pass and feed the water a constant-0 height. Calm water, fully lit/reflective, never black. */
  const _simGl = renderer.getContext();
  const waveOk = !!(_simGl && _simGl.getExtension && (_simGl.getExtension('EXT_color_buffer_float') || _simGl.getExtension('EXT_color_buffer_half_float')));
  if (!waveOk && typeof console !== 'undefined') console.info('[L90 H1] No float colour buffer (EXT_color_buffer_float/half_float) — wave sim OFF, flat-sea fallback.');
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
  // L90 H1: a 1×1 black texture → uHeight.r = 0 → the water surface stays flat (the fallback's calm sea).
  const flatHeightTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1, THREE.RGBAFormat);
  flatHeightTex.needsUpdate = true;

  /* 4) THE SIM PASS (unchanged). */
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
      // L18 RAIN drops fed into the sim (bound by reference to the weather rig's pool below).
      uRainCount: { value: 0 },
      uRainDrops: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      // L26 WAKE/BREACH drops fed into the sim (bound by reference to water-life's pool below).
      uWakeCount: { value: 0 },
      uWakeDrops: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
      uWash: { value: new THREE.Vector4(0, 0, 0, 0.02) },   // L112: rotor downwash (uv.x, uv.y, strength, sigma) — set per-frame in updateWorld from the piloted craft's altitude over water
    },
  });
  simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMaterial));

  /* ------------------------------------------------------------
     5) THE GRAB-PASS TARGET — a screen-sized texture we render the behind-water
     content into each frame, then sample from the water shader. LinearFilter so the
     refracted image is smooth; it carries a depth buffer so the card/backdrop sort.
     ------------------------------------------------------------ */
  // L112 foam/shoreline: attach a sampleable DepthTexture (a renderbuffer depth can't be read in a shader) so the
  // water frag can compare "what's behind me" depth vs its own → a soft depth-faded shoreline. WebGLRenderTarget
  // .setSize resizes an attached depthTexture for us (documented at the sceneDepth site; grabRT.setSize IS called in
  // resize() :1228 → decision #3 proof obligation met by tracing, not assumed). Pixel-neutral vs a renderbuffer.
  const grabDepth = new THREE.DepthTexture(drawBuffer.x, drawBuffer.y);
  const grabRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, depthTexture: grabDepth,
  });

  /* 6) BEHIND-WATER CONTENT — what the ripples will refract.
     (a) A "floor" card just below the surface: a CanvasTexture with an LGR mark + a
         grid, so the refraction distortion is obvious. (b) The Lesson 02 backdrop,
         back in service as the wall/sky behind the horizon. */
  function makeCardTexture(neutral) {
    const c = document.createElement('canvas');
    c.width = c.height = 1024;
    const x = c.getContext('2d');
    // DEMO/neutral: a plain dark seabed with a faint cool grid, NO lettering. Default: the
    // branded card (an LGR mark + gold grid) that the L05 refraction distorts so visibly.
    x.fillStyle = neutral ? '#0c1418' : '#15110b'; x.fillRect(0, 0, 1024, 1024);
    x.strokeStyle = neutral ? 'rgba(120,150,170,0.22)' : 'rgba(184,153,104,0.30)'; x.lineWidth = 2;
    for (let i = 0; i <= 1024; i += 64) {
      x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 1024); x.stroke();
      x.beginPath(); x.moveTo(0, i); x.lineTo(1024, i); x.stroke();
    }
    if (!neutral) {                                                  // branding only off-demo
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
  // L25: the water plane + seabed card grow 16 → 28 so the IRREGULAR coastline (headlands reach ~8.5
  // from centre) reads as an island in OPEN OCEAN — the far edge tucks behind the backdrop/sky horizon
  // and the near edge stays off-frame even when the viewer zooms out for a coastline shot (a 16-unit
  // plane left the island's flank poking past the water into the void). The wave sim is unchanged (it
  // runs on its own 2×2 FBO, uv-mapped onto this plane) so ripples still work; the slightly larger
  // plane just spreads each ripple over a touch more world (a calmer, sea-scale swell).
  const WATER_SIZE = 28;
  const card = new THREE.Mesh(
    new THREE.PlaneGeometry(WATER_SIZE, WATER_SIZE),
    new THREE.MeshBasicMaterial({ map: makeCardTexture(demo) })
  );
  card.rotation.x = -Math.PI / 2;   // lie flat, just below the water
  card.position.y = -0.35;
  scene.add(card);

  const backdrop = new THREE.Mesh(
    new THREE.PlaneGeometry(40, 24),
    new THREE.ShaderMaterial({
      depthWrite: false, vertexShader: backdropVert, fragmentShader: backdropFrag,
      uniforms: {
        uTime: { value: 0 },
        // L09: the backdrop IS the sky — bind its two gradient ends to the SunRig's
        // horizon/sky colours (by reference), so it turns dawn→day→dusk→night with
        // everything else (and the toon pass posterizes a real sky, not a stale gradient).
        uInk:  { value: sunRig.horizon },
        uGold: { value: sunRig.sky },
        // L20: the sky melts into the fog haze (uFogColor = the per-frame fog colour, by ref) and
        // bands when foggy (uFogCharm shared with the city). uFogAmt is driven each frame.
        uFogColor: { value: _fogColor },
        uFogAmt:   { value: 0 },
        uFogCharm: fogCharm,
      },
    })
  );
  backdrop.position.set(0, 3, -8);
  scene.add(backdrop);

  /* 7) THE VISIBLE WATER — refractive (unchanged from Lesson 05). */
  const waterMaterial = new THREE.ShaderMaterial({
    vertexShader: waterSurfaceVert,
    fragmentShader: waterSurfaceFrag,
    uniforms: {
      uHeight:         { value: waveOk ? null : flatHeightTex },  // L90 H1: flat-sea fallback when no float buffer
      uScene:          { value: grabRT.texture },                 // the grab pass
      uTexel:          { value: new THREE.Vector2(1 / SIM, 1 / SIM) },
      uResolution:     { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uDisplace:       { value: 0.42 },
      uNormalStrength: { value: 22.0 },
      uRefractStrength:{ value: 0.06 },                           // screen-UV shift under a slope
      uChromaScale:    { value: 1.0 },                            // L09: dialed down in toon mode
      uNormalMatrix:   { value: new THREE.Matrix3() },
      uLightDir:       { value: sunRig.sunDir },                  // L09: tracks the sun (by ref)
      uInk:            { value: new THREE.Color('#2A2218') },
      uGold:           { value: new THREE.Color('#B89968') },
      uSkyRefl:        { value: 0.0 },                            // L108: sky-reflection amount (0 = off; decideStyle raises it to 0.55 on beauty tiers)
      uSkyReflCol:     { value: sunRig.sky },                     // L108: the sky colour the sea mirrors — BY-REF so it tracks day/night with the SunRig
      // L112 FOAM + soft shoreline (THE gate: 0 on stylized → the whole term is a no-op → byte-identical):
      uFoamStrength:   { value: 0.0 },                            // beauty ? 1 : 0 (set in both render paths)
      uTime:           { value: 0 },                              // churn/lapping animation (set per-frame in updateWorld)
      uGrabDepth:      { value: grabDepth },                      // the grab pass's DEPTH → shoreline thinness + depth tint
      uNear:           { value: 0.1 }, uFar: { value: 100 }, uIsPerspective: { value: 1.0 },   // set per-render-camera to linearize grab depth
      // L112 SUN GLINT (beauty-only glitter path; uGlintK=0 stylized → byte-identical):
      uGlintK:         { value: 0.0 },                            // beauty ? lowSunWashK : 0 (set in both render paths) — peaks at golden hour
      uSunCol:         { value: sunRig.sunColor },                // the sun's actual colour BY-REF → the glitter tracks day/night

      // L11B FLAT-VECTOR water: shares the global toggle + tint (by ref) so key `0` flips the
      // water cyan in lock-step with the towers/agents; uVecWater is the authored flat colour.
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

  /* 7b) THE CITY (L13) — a SEEDED procedural city replaces the hand-placed district.
     `?city=<seed>` + `?profile=<name>` pick the starting city (resolved by main.js); `G` rerolls
     the seed and `C` cycles the profile (Manhattan / Paris / Neo-Tokyo). It owns the SunRig key/fill
     lights and shares ONE `windowGlow` (created here) with the GLTF landmark heroes so towers +
     landmarks light up together. The island still straddles the water, so the grab pass refracts its
     flank. (diorama.js — the L07–12 hand-placed district — is retired but kept as lesson history.) */
  const windowGlow = { value: 0.0 };
  // L107: one shared loader-progress (a LoadingManager + a 0..1 signal). The landmark GLBs load through its
  // manager; the app subscribes via `loaderProgress.onProgress` to drive the #lgr-loader bar, and markReady()
  // (called after prewarm) releases the synthetic final item so the bar hits 100% exactly at the reveal.
  const loaderProgress = createLoaderProgress();
  // Landmark FACTORY (L13): loads the GLB prototypes once, then clones them into city slots on
  // every (re)generation. citygen calls `make(key, slot, opts)`; it pops landmarks in once loaded.
  const landmarkFactory = createLandmarkFactory({ windowGlow, manager: loaderProgress.manager });
  const city = createCity({ seed: citySeed, profileIndex, landmarkFactory, windowGlow });
  scene.add(city.group);

  /* 7c) CITY LIFE (L11 → L24) — instanced traffic + pedestrians. L24: the cars now DRIVE the
     generated street grid (a node/edge graph laid in the gaps citygen reserves), turning at
     intersections, with headlight + tail-light pools at night; pedestrians still walk the rim.
     `profile` sets the per-city centre-line paint colour (retinted in regenerateCity). */
  const cityLife = createCityLife({ plinthTop: 0.3, extent: city.extent, profile: city.state.profile });
  scene.add(cityLife.group);

  /* 7d) WATER LIFE (L26) — the showpiece. Boats on looped water lanes that INJECT real impulses into
     the L03 wave sim each frame (the same drop path as rain + the poke) → genuine V-wakes; a harbor
     ferry visits the L25 docks; fish/whale breaches splash ripple-rings; gulls skim by day; boats get
     night running lights. We hand it WATER_SIZE so it can map world→sim-uv, and bind its wake-drop
     pool into the sim by reference (exactly like the rain pool). See src/core/water-life.js. */
  const waterLife = createWaterLife({ extent: city.extent, waterSize: WATER_SIZE, plinthTop: 0.3 });
  scene.add(waterLife.group);
  simMaterial.uniforms.uWakeDrops.value = waterLife.wakeDrops;   // the sim now reads the wake pool too

  /* 7f) WEATHER (L18) — rain / snow / fog over the city. Rain feeds the L03 water sim its drops
     (bound by reference here), so the rain genuinely ripples the surface. The rig exposes eased
     scalars (overcast / fog / snow / cloud) the scene's lights + shaders read each frame. `W`
     cycles clear→rain→snow→fog. See src/core/weather-rig.js. */
  const weatherRig = createWeatherRig({ extent: city.extent });
  scene.add(weatherRig.group);
  simMaterial.uniforms.uRainDrops.value = weatherRig.rainDrops;   // the sim now reads the rig's drop pool

  /* 7h) CLOUDS (L21) — soft drifting billboard clouds in the sky, weather-driven (sparse+bright when
     clear, heavy+dark+low in rain, low ultra-transparent mist in fog) and SunRig-tinted. Sprites, so
     they billboard toward BOTH the city camera and the office RTT window for free. See src/core/clouds.js. */
  const clouds = createCloudField({ extent: city.extent });
  scene.add(clouds.group);
  /* L63 INSPECTION LENS — the reusable follow/registry camera over the living world. It assembles
     followables from the entity modules (cars/people, boats/gulls/fish, clouds) and drives the rig's
     L63 follow seam; the app wires the click/cycle/overlay. Engine-first: built here so every project
     that boots the engine inherits the lens. See src/inspect.js. */
  const inspectorSources = [cityLife, waterLife, clouds];   // L73: placedLife pushed below (after the world section builds heightAt)
  const inspector = createInspector({ rig, getCamera: () => rig.camera, sources: inspectorSources });
  /* L52 CELESTIALS — a visible sun + moon billboard on the SunRig arc, in the sky behind the city (so
     buildings occlude a low sun). In the scene → styled by the post/PixelKit tier chain + visible through
     the office window RTT for free. Driven by sunRig.sunArc in updateWorld (one clock). */
  const celestials = createCelestials();
  scene.add(celestials.group);

  /* L66 PREETHAM ATMOSPHERIC SKY (realistic/charm tier) — a real Rayleigh+Mie horizon→zenith sky that
     reddens at low sun (golden hour for free). Scene geometry → it appears in the office-window RTT for
     FREE. Driven by the SunRig (one clock). TIER-GATED: only the beauty tiers (post mode 1/2, non-vector)
     AND while the sun is up show the Sky; the stylized tiers (pixel/toon/vector) + night keep the flat
     `backdrop` gradient + the starfield, so they render IDENTICAL to before. `setSkyTier` does the swap. */
  const skyAtmo = createSkyAtmosphere({ scale: 90 });   // ±45 < camera far 100
  scene.add(skyAtmo.mesh);
  // L67/L68: the sky-IBL is a SUBTLE coherence tint, NOT a second key light. It's driven DYNAMICALLY in
  // updateWorld (low at noon to kill the washout, normal at golden hour). Seed a sane value for any render
  // before the first updateWorld.
  scene.environmentIntensity = 0.32;
  let _skyOn = false;
  function setSkyTier(beauty) {
    const on = beauty && sunRig.sunArc.y > -0.04;       // Preetham breaks below the horizon → night keeps the backdrop
    if (on === _skyOn) return;
    _skyOn = on;
    skyAtmo.mesh.visible = on;
    backdrop.visible = !on;                             // the flat gradient is the fallback (pixel/vector/night)
  }
  /* L67 SKY-IBL throttle — rebuild the env map only when the day crosses a keyframe boundary (4×/cycle),
     never per-frame (PMREM is expensive). `ensureEnv()` returns the cached env texture; the SCENE-LEVEL
     gate (scene.environment = beauty ? env : null, set in the render paths) keeps it OUT of the pixel/
     toon lit render so they stay byte-identical (the L54/L55 wiring-drift trap the brief flagged). */
  let envTex = null, _lastEnvSeg = -1;
  // L78: bind the context-restore cache-invalidator now that the env cache exists — on a restored GL context
  // we rebuild the PMREM sky-IBL (its GPU texture is gone) + force one shadow-map re-render (the dirty-flag
  // would otherwise skip it because the sun hasn't moved). Three handles the rest (RT framebuffers, textures).
  _invalidateCaches = () => { envTex = null; _lastEnvSeg = -1; renderer.shadowMap.needsUpdate = true; };
  function ensureEnv() {
    const seg = Math.floor((sunRig.t % 1) * 4) % 4;
    if (seg !== _lastEnvSeg || !envTex) { _lastEnvSeg = seg; envTex = skyAtmo.buildEnv(renderer); }
    return envTex;
  }

  /* 7g) L64 PROCEDURAL TERRAIN WORLD (Arc 1 of the world-builder). The generator + flat-shaded mesh
     live in terrain.js (engine-core, reusable); HERE we wire it into the live scene as a swap-in for
     the city. The wave-sim WATER plane is at sea level (y=0), so terrain below 0 reads as ocean and
     land pokes through — "an island / land-with-a-lake". Entering WORLD mode hides the urban geometry
     and shows the terrain; SunRig day/night + weather + clouds keep running globally → they light +
     weather the terrain for FREE. Generated lazily (first entry) so pure-city use pays nothing. */
  let terrainGroup = null, scatterGroup = null, lakeGroup = null, worldData = null, worldActive = false, worldSeed = 1234, worldPreset = 'valley';
  const WORLD_SIZE = 26;                                              // 26 < WATER_SIZE 28 → the ocean rims the terrain
  const BIOME_KEYS = BIOMES.map((b) => b.key);
  // L68: ONE shared lake material across all lakes + rerolls (the reuse anchor) — low roughness so the L67
  // sky-IBL reflects on the beauty tier (a still lake), flat-tinted on the stylized tiers.
  const lakeMat = new THREE.MeshStandardMaterial({ color: '#3f6f8c', roughness: 0.07, metalness: 0.4, transparent: true, opacity: 0.9 });
  const URBAN = () => [city.group, cityLife.group, waterLife.group];   // hidden in world mode (the SEA = the shared wave-sim water plane stays visible)
  const WORLD_GROUPS = () => [terrainGroup, scatterGroup, lakeGroup].filter(Boolean);
  function buildWorld() {
    for (const g of WORLD_GROUPS()) { scene.remove(g); g.userData.dispose?.(); }
    const data = generateTerrain({ seed: worldSeed, size: 160, preset: worldPreset });
    worldData = data;                                                // L69: kept live so the sculpt brush can mutate it
    terrainGroup = buildTerrainMesh(data, { worldSize: WORLD_SIZE, baseY: 0, chunks: 6 });
    // L65 SCATTER — biome-keyed instanced trees/rocks/tufts ON the terrain (same seed → identical), so the
    // generated world feels inhabited. Reads the terrain heightfield/biome buffers; one draw call per type.
    scatterGroup = createScatter({ terrain: data, seed: worldSeed, worldSize: WORLD_SIZE, baseY: 0, biomeKeys: BIOME_KEYS });
    // L68 LAKES — interior basins (flood-fill over the heightfield) get a reflective water disc at their fill
    // level. The SEA is the shared wave-sim water plane at y=0 (already visible in world mode). Same seed → same lakes.
    lakeGroup = createWorldLakes(data, { worldSize: WORLD_SIZE, baseY: 0, maxLakes: 3, material: lakeMat });
    for (const g of WORLD_GROUPS()) { g.visible = worldActive; scene.add(g); }
    if (typeof placedLife !== 'undefined' && placedLife) placedLife.clear();   // L73: a NEW world wipes manual placed life (like scatter/sculpt edits)
    if (typeof waterFlow !== 'undefined' && waterFlow) waterFlow.clear();      // L81: a NEW world empties the flow field
    if (typeof window !== 'undefined') window.__world = { seed: worldSeed, preset: worldPreset, active: worldActive, chunks: terrainGroup.children.length, scatter: scatterGroup.userData.counts, lakes: lakeGroup.userData.count };
  }
  const setWorldVisible = (on) => { for (const g of WORLD_GROUPS()) g.visible = on; };

  /* L73 — `heightAt(x,z)`: the world-Y of the terrain surface at a world (x,z). Same coord math as the
     sculpt brush / reproject: nearest heightfield cell, mapped `wy = baseY + (h-sea)·relief` (baseY=0).
     Used to seat placed land/air entities on the terrain (and the wander-person re-reads it as it walks). */
  function worldHeightAt(wx, wz) {
    if (!worldData) return 0;
    const { size, height, sea, relief } = worldData;
    const cell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2;
    const ci = Math.round((wx + half) / cell), cj = Math.round((wz + half) / cell);
    const i = ci < 0 ? 0 : ci >= size ? size - 1 : ci, j = cj < 0 ? 0 : cj >= size ? size - 1 : cj;
    return (height[j * size + i] - sea) * relief;                    // baseY = 0
  }
  /* L73 PLACED LIFE — the world-editor's "drop in life" pool (gull/boat/fish/cloud/wander-person). Its OWN
     group (shown only in world mode — `waterLife.group` is HIDDEN in world mode, so we can't reuse it) and a
     4th inspector source so a placed entity is followable the instant it's dropped. Cleared on a new world. */
  const placedLife = createPlacedLife({ heightAt: worldHeightAt, seaSurfaceY: 0, waterY: 0.06 });
  placedLife.group.visible = false;                                  // world.enter()/exit() toggle it
  scene.add(placedLife.group);
  inspectorSources.push(placedLife);

  /* L104 SEIZE-CRAFT SEAM (engine-first) — a single GUARANTEED pilotable craft that lives in its OWN
     always-visible group, so it shows in the CITY skyline too (where `placedLife.group` is hidden by
     enter/exit). It's still spawned through placedLife (so it's a registered followable+pilotable that
     `pilot.possess()` accepts), then its mesh is re-parented into `seizeGroup`. We tick it every frame in
     the CITY (placedLife.update only runs in world mode); in world mode placedLife.update already ticks it.
     The flat city ground is free: `worldHeightAt`→0 + `worldWaterAt`→NO_WATER when no world is built. */
  const seizeGroup = new THREE.Group(); seizeGroup.raycast = () => {}; scene.add(seizeGroup);
  let seizeEnt = null;
  function spawnSeizeCraft(kind, sx = 0, sz = 0, opts = {}) {
    if (seizeEnt) { seizeGroup.remove(seizeEnt.obj); placedLife.despawn(seizeEnt); seizeEnt = null; }
    seizeEnt = placedLife.spawn(kind, sx, sz, { ...opts, ephemeral: true });   // L110 (audit B12): mark it ephemeral so world save/undo/?world= never serialize or clear this engine-owned craft
    if (seizeEnt) { placedLife.group.remove(seizeEnt.obj); seizeGroup.add(seizeEnt.obj); }
    return seizeEnt ? seizeEnt.followable : null;     // hand back the pilotable followable (what pilot.possess wants)
  }

  /* L81 LIVE WATER FLOW (From-Dust) — a virtual-pipes shallow-water sim coupled to the LIVE terrain: pour/rain
     water, it flows downhill + pools, and a dug channel routes it. Opt-in (the 💧 Flow editor tool feeds it; the
     surface hides itself when the field is empty → byte-identical when unused). Reads worldHeightAt every tick so
     a sculpt edit is reflected next frame. Its own group (shown in world mode like the terrain), stepped in
     updateWorld, cleared on a new world. See src/water-flow.js. */
  /* L82 EROSION write-back — the flow sim produces a COARSE per-cell terrain delta (world-Y); here we map it onto
     the 160² heightfield (world-Y → normalized ÷ relief), clamp, and THROTTLE the expensive geometry rebuild +
     scatter reproject (erosion is gradual — no need to rebuild every frame). The flow re-reads worldHeightAt each
     tick, so the carved channel feeds straight back into the next flow step (the erosion feedback loop). */
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
      const dNorm = d * invRelief;                                   // world-Y delta → normalized height delta
      const fi = (ci * coarseCell) / fineCell, fj = (cj * coarseCell) / fineCell;   // coarse → fine index
      const i0 = Math.max(0, Math.round(fi - 1)), i1 = Math.min(size - 1, Math.round(fi + 1));
      const j0 = Math.max(0, Math.round(fj - 1)), j1 = Math.min(size - 1, Math.round(fj + 1));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const idx = j * size + i; const h = height[idx] + dNorm; height[idx] = h < 0 ? 0 : h > 1 ? 1 : h;
      }
    }
    if (!touched) return;
    _erosTick++;
    if (_erosTick % 8 === 0) rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children);   // throttle the GPU rebuild
    if (_erosTick % 24 === 0 && scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });   // trees ride the eroded banks (less often)
  }

  /* L87 (step 2 + C-2) GPU EROSION → TERRAIN SYNC — the deliberate, bounded GPU→CPU read-back. The GPU erodes its 96²
     terrain texture entirely on-GPU (no per-frame stall); water-flow.js reads it back on a THROTTLE (~3×/sec) and hands
     us the INCREMENTAL erosion delta since the last sync (coarse 96² world-Y). We add it to the fine 160² worldData
     .height so the mesh + scatter + save-load + heightAt all see the carve. C-2 (DESIGN's call): upsample the coarse
     delta with a SMOOTH BILINEAR filter — NOT applyErosion's amplifying full-delta 3×3 splat — so the GPU terrain reads
     as smooth as the CPU's WITHOUT enshrining the CPU artifact, and the 160² base detail is preserved (we ADD a delta,
     never overwrite). C++ anchor: glReadPixels is a pipeline stall, so it's throttled + off the hot loop (the whole
     reason the sim itself never reads back). */
  function syncErodedTerrain(delta, n) {
    if (!worldData || !terrainGroup) return;
    const { size, height, relief } = worldData;
    const invRelief = relief > 1e-6 ? 1 / relief : 0;
    const scale = (n - 1) / (size - 1);                              // fine index → fractional coarse index
    let touched = false;
    for (let j = 0; j < size; j++) {
      const cj = j * scale, j0 = Math.floor(cj), fj = cj - j0, j1 = Math.min(n - 1, j0 + 1);
      for (let i = 0; i < size; i++) {
        const ci = i * scale, i0 = Math.floor(ci), fi = ci - i0, i1 = Math.min(n - 1, i0 + 1);
        const d00 = delta[j0 * n + i0], d10 = delta[j0 * n + i1], d01 = delta[j1 * n + i0], d11 = delta[j1 * n + i1];
        const d = (d00 * (1 - fi) + d10 * fi) * (1 - fj) + (d01 * (1 - fi) + d11 * fi) * fj;   // bilinear
        if (d !== 0) { touched = true; const idx = j * size + i; const h = height[idx] + d * invRelief; height[idx] = h < 0 ? 0 : h > 1 ? 1 : h; }
      }
    }
    if (!touched) return;
    rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children);   // the sync is already throttled (~3×/sec) → rebuild per-sync is cheap
    if (scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });
  }

  const waterFlow = createWaterFlow({ worldHeightAt, applyErosion, syncErodedTerrain, worldSize: WORLD_SIZE, grid: 96, seaY: 0, renderer });   // L87: renderer enables the optional GPU backend; syncErodedTerrain = the throttled GPU-erosion read-back
  waterFlow.group.visible = false;                                  // world.enter()/exit() toggle it (+ the surface self-hides when dry)
  scene.add(waterFlow.group);

  // L94 AMBIENT DUST — drifting motes that fill the air over the world (the second half of the "alive" pass).
  // Count is tier-capped at creation: ~500 on touch/mobile, ~2000 on desktop. Created once, toggled with world mode.
  const dust = createDust({ extent: WORLD_SIZE, count: _coarse ? 500 : 2000 });
  dust.group.visible = false;                                       // world.enter()/exit() toggle it
  scene.add(dust.group);

  /* L69 SCULPT — a Gaussian brush over the heightfield + a live dirty-chunk rebuild + a debounced water
     re-pool. Dig below the waterline → the sea covers it (the y=0 plane is static; the terrain moved);
     raise a rim → a basin forms → re-`detectLakes` spawns a lake. The terrain heightfield is the single
     source of truth, so editing it + re-deriving the pools keeps them consistent (no hidden sim state). */
  let _repoolTimer = null;
  let _editing = false;     // L96: ✎ editor open → suppress the water surfaces so pits dug below y=0 are VISIBLE
  const _dirty = new Set();
  function repoolWater() {
    if (!worldData || !lakeGroup) return;
    scene.remove(lakeGroup); lakeGroup.userData.dispose?.();
    lakeGroup = createWorldLakes(worldData, { worldSize: WORLD_SIZE, baseY: 0, maxLakes: 3, material: lakeMat });
    lakeGroup.visible = worldActive && !_editing;   // L96: a mid-edit re-pool keeps lakes hidden while editing
    scene.add(lakeGroup);
    if (window.__world) window.__world.lakes = lakeGroup.userData.count;
  }
  /* L70 — the debounced "edit settled" step: re-pool the lakes AND re-project the scatter so the trees/rocks
     ride the new surface (the bald-mesa fix) + cull ones pushed underwater/steep (lets a dug pool show). */
  function settleSculpt() {
    repoolWater();
    if (scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });
  }
  function rebuildAllChunks() { if (terrainGroup) rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children); }
  function sculpt(wxx, wzz, dir = 1, radius = 2.2, strength = 0.05) {
    if (!worldData || !terrainGroup) return;
    const size = worldData.size, cell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2;
    const gi = (wxx + half) / cell, gj = (wzz + half) / cell;     // pointer → grid coords (float)
    const R = radius / cell;                                       // brush radius in grid cells
    const iMin = Math.max(0, Math.floor(gi - R)), iMax = Math.min(size - 1, Math.ceil(gi + R));
    const jMin = Math.max(0, Math.floor(gj - R)), jMax = Math.min(size - 1, Math.ceil(gj + R));
    const h = worldData.height, sig2 = 2 * (R * 0.5) * (R * 0.5);
    for (let j = jMin; j <= jMax; j++) for (let i = iMin; i <= iMax; i++) {
      const d2 = (i - gi) * (i - gi) + (j - gj) * (j - gj);
      if (d2 > R * R) continue;
      const v = h[j * size + i] + dir * strength * Math.exp(-d2 / sig2);   // gaussian falloff stamp
      h[j * size + i] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
    _dirty.clear();                                               // which chunk meshes own touched cells (+1 cell of slop)
    for (const mesh of terrainGroup.children) {
      const m = mesh.userData.chunk;
      if (m && m.i0 <= iMax && m.i1 >= iMin - 1 && m.j0 <= jMax && m.j1 >= jMin - 1) _dirty.add(mesh);
    }
    rebuildTerrainChunks(terrainGroup, worldData, _dirty);
    if (_repoolTimer) clearTimeout(_repoolTimer);                 // re-pool + re-scatter once the edit settles (debounced)
    _repoolTimer = setTimeout(settleSculpt, 140);
  }

  /* L71 PAINT-TERRAIN — sculpt's twin: the SAME brush footprint, but a HARD write into the biome[] field
     (no falloff — a material index can't partially apply on a flat-shaded per-face mesh, and hard biome
     borders ARE the low-poly look), then rebuild the dirty chunks WITH colour (re-bakes biome→vertex colour).
     No height change → no water re-pool, no re-scatter. Tier-agnostic (it edits CPU buffers + geometry colour). */
  function paintBiome(wxx, wzz, biomeIdx, radius = 2.2) {
    if (!worldData || !terrainGroup || biomeIdx == null) return;
    const size = worldData.size, cell = WORLD_SIZE / (size - 1), half = WORLD_SIZE / 2;
    const gi = (wxx + half) / cell, gj = (wzz + half) / cell;
    const R = radius / cell, R2 = R * R;
    const iMin = Math.max(0, Math.floor(gi - R)), iMax = Math.min(size - 1, Math.ceil(gi + R));
    const jMin = Math.max(0, Math.floor(gj - R)), jMax = Math.min(size - 1, Math.ceil(gj + R));
    const bi = worldData.biome;
    for (let j = jMin; j <= jMax; j++) for (let i = iMin; i <= iMax; i++) {
      if ((i - gi) * (i - gi) + (j - gj) * (j - gj) <= R2) bi[j * size + i] = biomeIdx;   // hard write
    }
    _dirty.clear();
    for (const mesh of terrainGroup.children) {
      const m = mesh.userData.chunk;
      if (m && m.i0 <= iMax && m.i1 >= iMin - 1 && m.j0 <= jMax && m.j1 >= jMin - 1) _dirty.add(mesh);
    }
    rebuildTerrainChunks(terrainGroup, worldData, _dirty, true);   // writeColor → retint the touched chunks
  }

  /* L72 PAINT-SCATTER — the editable object brush. ERASE swap-removes every prop under the ring; otherwise it's a
     DENSITY brush: roll `density·6` candidate points in the disc (rejection sampling), reject underwater / over-slope
     (the SAME SLOPE_BY_TYPE cut reproject uses, so a painted prop never instantly culls itself), and scatterAdd each
     with scale/yaw/tint jitter so a grove doesn't look stamped. Returns how many props were added/erased.
     In C++ terms: append into a std::vector over a GPU buffer; grow-2× is hidden inside scatterAdd. */
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
    const candidates = Math.max(1, Math.round((density || 0.5) * 6));   // density → candidates per stroke step
    let added = 0;
    for (let c = 0; c < candidates; c++) {
      const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * radius;   // uniform in the disc
      const x = wxx + Math.cos(a) * rr, z = wzz + Math.sin(a) * rr;
      const hh = sampleH(x, z);
      if (hh < sea + 0.005) continue;                  // underwater → skip
      if (slopeAt(x, z) > maxSlope) continue;          // too steep → skip
      const y = (hh - sea) * relief;                   // baseY = 0; reproject recomputes this on sculpt anyway
      if (scatterAdd(scatterGroup, type, x, y, z, 0.7 + Math.random() * 0.6, Math.random() * Math.PI * 2, 0.82 + Math.random() * 0.36)) added++;
    }
    if (window.__world && scatterGroup.userData.counts) {   // keep the live count probe fresh
      for (const t of SCATTER_KEYS) scatterGroup.userData.counts[t] = (scatterGroup.userData.placements[t] || []).length;
    }
    return added;
  }

  /* L70/L71/L72 UNDO — snapshot height (sculpt) + biome (paint-terrain) + the scatter placement lists (paint-scatter)
     at each STROKE start (a memento); restore on undo. Bounded ring. Scatter is restored by re-pointing the
     placement arrays then letting reprojectScatter rebuild every instance matrix + colour + live count from them. */
  const _undo = []; const UNDO_MAX = 12;
  function snapshotScatter() {
    if (!scatterGroup) return null;
    const p = scatterGroup.userData.placements, out = {};
    for (const t of SCATTER_KEYS) out[t] = (p[t] || []).map((o) => ({ ...o }));   // deep copy (records are flat)
    return out;
  }
  function snapshot() {
    if (!worldData) return;
    _undo.push({ h: worldData.height.slice(), b: worldData.biome.slice(), sc: snapshotScatter(), pl: placedLife.snapshot() });   // L73: + placed-life records
    if (_undo.length > UNDO_MAX) _undo.shift();
  }
  function undo() {
    if (!worldData || !_undo.length) return false;
    const s = _undo.pop();
    worldData.height.set(s.h); worldData.biome.set(s.b);
    if (s.sc && scatterGroup) { const p = scatterGroup.userData.placements; for (const t of SCATTER_KEYS) p[t] = (s.sc[t] || []).map((o) => ({ ...o })); }
    if (s.pl) placedLife.restore(s.pl);                                           // L73: rebuild placed life from the snapshot → undo a drop/delete
    rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children, true);   // rebuild shape AND colour
    settleSculpt();                                                               // re-pool water + reproject scatter (rebuilds props from restored lists)
    return true;
  }
  /* L73 PLACE — medium-aware drop. The catalog carries each kind's `medium`; here we only enforce the two the
     brief calls out as demonstrable: a BOAT/FISH must land on WATER (terrain below the sea cut), a PERSON on
     LAND (terrain above it). Gull/cloud (air) place anywhere. Y is decided by the pool per kind. Returns the
     handle, or null if the medium guard rejects the spot. */
  const WATER_KINDS = new Set(['boat', 'fish']), LAND_KINDS = new Set(['person', 'atv']);   // L76: the ATV drops on land
  function placeEntity(kind, wx, wz) {
    if (!worldData) return null;
    const underwater = worldHeightAt(wx, wz) < 0.0;            // sea surface = baseY = 0
    if (WATER_KINDS.has(kind) && !underwater) return null;     // boat/fish only on water
    if (LAND_KINDS.has(kind) && underwater) return null;       // person only on land
    return placedLife.spawn(kind, wx, wz);
  }
  function removeEntityNear(wx, wz, r = 2.5) { return placedLife.removeNear(wx, wz, r); }

  /* ============================================================
     L75 SAVE / LOAD — serialize the authored world to plain JSON-able data, and rebuild it losslessly.
     The world is a PURE FUNCTION of (seed, preset) → the deterministic base + a set of EDITS. So we store
     the base KEY (seed+preset) + the edits: the mutated height/biome buffers (sculpt + paint-terrain), the
     scatter placement lists (L70/L72), and the placed-life records (L73, via its own snapshot). On load we
     regenerate the base and replay the edits. Pure data, art-agnostic (placements carry ids/transforms, not
     meshes — a project's setArt swap re-renders the same saved world). C++: fwrite the typed-array buffers
     (base64 = the raw bytes) + the placement structs; on read, rebuild from seed + replay. ============ */
  // base64 of a typed array's raw bytes (chunked so a 100 KB buffer doesn't blow String.fromCharCode's arg limit).
  function bytesToB64(u8) { let s = ''; const CH = 0x8000; for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CH, u8.length))); return btoa(s); }
  function b64ToBytes(b64) { const s = atob(b64); const u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); return u8; }
  const f32B64 = (f) => bytesToB64(new Uint8Array(f.buffer, f.byteOffset, f.byteLength));
  const u8B64 = (u) => bytesToB64(u);
  // deep-copy the scatter placement lists (plain {x,y,z,s,r,t} records) for the save blob.
  function scatterPlacements() { const p = scatterGroup ? scatterGroup.userData.placements : {}; const out = {}; for (const t of SCATTER_KEYS) out[t] = (p[t] || []).map((o) => ({ ...o })); return out; }

  // FULL serialize — exact (raw height/biome buffers). The robust localStorage/file path.
  function serialize() {
    if (!worldData) return null;
    return { v: 1, seed: worldSeed, preset: worldPreset, size: worldData.size,
      height: f32B64(worldData.height), biome: u8B64(worldData.biome),
      scatter: scatterPlacements(), entities: placedLife.snapshot() };
  }
  /* COMPACT serialize — a SPARSE delta vs the deterministic base (only changed height/biome cells), for a best-effort
     ?world= link. It DELIBERATELY OMITS scatter: the ~1200 procedural props regenerate from the seed (they're part of
     the deterministic base), so storing them would bloat the link to ~250 KB and trip the size guard every time. The
     trade: manual brush-painted/erased TREES are not carried by the link — those need the full Export. So the link
     shares a world's SHAPE + GROUND-PAINT + LIFE; the JSON file is the lossless universal path. */
  function serializeCompact() {
    if (!worldData) return null;
    const base = generateTerrain({ seed: worldSeed, size: 160, preset: worldPreset });   // the pure base to diff against
    const h = worldData.height, b = worldData.biome, hd = [], bd = [];
    for (let i = 0; i < h.length; i++) { if (Math.abs(h[i] - base.height[i]) > 1e-6) { hd.push(i, Math.round(h[i] * 1e4) / 1e4); } }
    for (let i = 0; i < b.length; i++) { if (b[i] !== base.biome[i]) { bd.push(i, b[i]); } }
    return { v: 1, c: 1, seed: worldSeed, preset: worldPreset, hd, bd, entities: placedLife.snapshot() };
  }

  // load saved scatter placements → rebuild the InstancedMesh group from them (swap the procedural one out).
  function loadScatterPlacements(placements) {
    if (scatterGroup) { scene.remove(scatterGroup); scatterGroup.userData.dispose?.(); }
    scatterGroup = buildScatterGroup(placements || { tree: [], rock: [], tuft: [] });
    scatterGroup.userData.counts = SCATTER_KEYS.reduce((o, t) => (o[t] = (scatterGroup.userData.placements[t] || []).length, o), {});
    scatterGroup.visible = worldActive; scene.add(scatterGroup);
  }

  /* DESERIALIZE — regenerate the base at the saved seed/preset, then replay the edits. Handles BOTH the full
     blob (raw buffers) and the compact link (sparse deltas). Lossless for the full path. */
  function deserialize(obj) {
    if (!obj || obj.v !== 1) return false;
    /* L90 H3 — VALIDATE THE WHOLE PAYLOAD BEFORE MUTATING ANY STATE. A `?world=` link is pasted from email/
       Slack — corruptible + attacker-controllable. Typed-array writes coerce NaN/Infinity SILENTLY (so the
       caller's try/catch never fires), and a bad index/length throws mid-replay → a half-built, shattered, or
       NaN-bounding-sphere (invisible) world. So we check the FULL payload up front and bail cleanly (return
       false, NO buildWorld, NO worldActive flip) on anything wrong → the prior valid world stands. */
    const GRID = 160 * 160;                          // worldData.height/biome length (buildWorld uses size:160)
    if (obj.height != null || obj.biome != null) {   // full-buffer form: both base64 strings, exact grid length, finite
      if (typeof obj.height !== 'string' || typeof obj.biome !== 'string') return false;
      let hb, bb;
      try { hb = b64ToBytes(obj.height); bb = b64ToBytes(obj.biome); } catch (e) { return false; }   // atob throws on bad b64
      if (hb.byteLength % 4 !== 0 || (hb.byteLength >> 2) !== GRID || bb.length < GRID) return false;
      const hf = new Float32Array(hb.buffer, hb.byteOffset, hb.byteLength >> 2);
      for (let i = 0; i < hf.length; i++) if (!Number.isFinite(hf[i])) return false;
    }
    if (obj.hd != null && !Array.isArray(obj.hd)) return false;     // sparse-delta form: in-bounds index + finite value
    if (obj.bd != null && !Array.isArray(obj.bd)) return false;
    if (Array.isArray(obj.hd)) for (let i = 0; i < obj.hd.length; i += 2) { const k = obj.hd[i]; if (!Number.isInteger(k) || k < 0 || k >= GRID || !Number.isFinite(obj.hd[i + 1])) return false; }
    if (Array.isArray(obj.bd)) for (let i = 0; i < obj.bd.length; i += 2) { const k = obj.bd[i]; if (!Number.isInteger(k) || k < 0 || k >= GRID) return false; }

    worldSeed = obj.seed | 0;
    worldPreset = PRESET_KEYS.includes(obj.preset) ? obj.preset : worldPreset;
    _undo.length = 0;
    buildWorld();                                   // the deterministic base (also clears placed life + scatter)
    worldActive = true; setWorldVisible(true); placedLife.group.visible = true; waterFlow.group.visible = true; dust.group.visible = true; for (const g of URBAN()) g.visible = false;
    if (window.__world) window.__world.active = true;
    const clamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v;
    const nb = BIOMES.length;                        // biome index bound
    // replay the height/biome edits — full buffers OR sparse deltas (all values now validated + clamped on write)
    if (obj.height && obj.biome) {
      const hb = b64ToBytes(obj.height); const hf = new Float32Array(hb.buffer, hb.byteOffset, hb.byteLength >> 2);
      for (let i = 0; i < hf.length; i++) worldData.height[i] = clamp01(hf[i]);
      const bb = b64ToBytes(obj.biome); for (let i = 0; i < worldData.biome.length; i++) worldData.biome[i] = Math.min(nb - 1, bb[i] | 0);
    } else if (obj.hd || obj.bd) {
      const hd = obj.hd || [], bd = obj.bd || [];
      for (let i = 0; i < hd.length; i += 2) worldData.height[hd[i]] = clamp01(hd[i + 1]);
      for (let i = 0; i < bd.length; i += 2) worldData.biome[bd[i]] = Math.min(nb - 1, Math.max(0, bd[i + 1] | 0));
    }
    rebuildTerrainChunks(terrainGroup, worldData, terrainGroup.children, true);   // shape + colour
    if (obj.scatter) loadScatterPlacements(obj.scatter);                          // FULL blob: saved props (compact omits → keep procedural)
    repoolWater();                                                                // lakes at the loaded height
    if (scatterGroup) reprojectScatter(scatterGroup, worldData, { worldSize: WORLD_SIZE, baseY: 0 });   // seat props on loaded height
    placedLife.restore(obj.entities);                                             // placed life
    if (window.__world) { window.__world.scatter = scatterGroup.userData.counts; window.__world.seed = worldSeed; window.__world.preset = worldPreset; }
    return true;
  }

  const world = {
    enter() { if (!terrainGroup) buildWorld(); worldActive = true; setWorldVisible(true); placedLife.group.visible = true; waterFlow.group.visible = true; dust.group.visible = true; for (const g of URBAN()) g.visible = false; if (window.__world) window.__world.active = true; },
    exit() { _editing = false; worldActive = false; setWorldVisible(false); placedLife.group.visible = false; waterFlow.group.visible = false; dust.group.visible = false; for (const g of URBAN()) g.visible = true; if (window.__world) window.__world.active = false; },
    // L96 EDITOR WATER-VISIBILITY SEAM — while the ✎ editor is open, SUPPRESS the water surfaces (the y=0 sea
    // plane, the interior lakes, the live flow surface) so a pit dug below the waterline is VISIBLE instead of
    // hidden under blue (the L95 "can't dig a basin" finding). Pure RENDER state — the terrain + the water sim
    // data never change (an editor "ghost mode": swap what's DRAWN for legibility while authoring, then restore).
    // On exit we re-pool so the freshly-dug basins fill as lakes. Engine-first: any project's editor inherits
    // this by calling world.setEditing(on) on its sculpt toggle.
    setEditing(on) {
      _editing = !!on;
      water.visible = worldActive && !_editing;                 // the shared wave-sim plane = the SEA in world mode
      if (lakeGroup) lakeGroup.visible = worldActive && !_editing;
      waterFlow.group.visible = worldActive && !_editing;
      if (!_editing && worldActive) repoolWater();              // exiting → re-detect lakes so the new basins fill
      return _editing;
    },
    get editing() { return _editing; },                         // L96: editor water-suppression state (also a harness probe)
    get waterHidden() { return _editing && !water.visible; },   // L96: true ⇢ the sea/lakes/flow are suppressed for editing
    reroll() { worldSeed = (Math.random() * 1e9) | 0; _undo.length = 0; buildWorld(); world.enter(); return worldSeed; },   // 🎲 NEW random world (throws the current one away)
    reset() { _undo.length = 0; buildWorld(); world.enter(); return worldSeed; },   // L70 ↺ regenerate the SAME world (seed/preset unchanged) → discards sculpt edits
    setPreset(p) { if (PRESET_KEYS.includes(p)) { worldPreset = p; _undo.length = 0; buildWorld(); world.enter(); } return worldPreset; },
    sculpt, paintBiome, paintScatter, repoolWater, snapshot, undo,   // L69/L70/L71/L72
    placeEntity, removeEntityNear, heightAt: worldHeightAt,       // L73: drop-in life (medium-aware) + terrain sampler
    serialize, serializeCompact, deserialize,                    // L75: save/load the authored world (full + compact)
    // L81 LIVE WATER FLOW — pour/rain a source, clear it, read the field (coupled to the live sculpted terrain).
    flowPourAt: (wx, wz, amount, radius) => waterFlow.pourAt(wx, wz, amount, radius),
    flowRain: (a) => waterFlow.rain(a), flowClear: () => waterFlow.clear(),
    get flowTotal() { return waterFlow.totalWater(); }, flowAt: (wx, wz) => waterFlow.cellAt(wx, wz),
    flowErosion: (on, strength) => waterFlow.setErosion(on, strength), get flowErosionOn() { return waterFlow.erosion; }, get flowSediment() { return waterFlow.totalSediment(); },   // L82
    setSimBackend: (b) => waterFlow.setBackend(b), get simBackend() { return waterFlow.backend; },   // L87: cpu (default+oracle) | gpu
    _flowReadW: () => waterFlow._debugReadW(), _flowReadTerr: () => waterFlow._debugReadTerr(),   // L87 test-only: field read-back for the parity harness
    _flowStepN: (n, dt) => waterFlow._debugStepN(n, dt),   // L87 test-only: deterministic fixed-dt step burst (parity harness)
    get terrainGroup() { return terrainGroup; },                 // for the app's brush raycast
    get biomes() { return BIOMES; },                             // L71: the paint-terrain material list (key + colour)
    get scatterCounts() { return scatterGroup ? scatterGroup.userData.placements && SCATTER_KEYS.reduce((o, t) => (o[t] = (scatterGroup.userData.placements[t] || []).length, o), {}) : null; },   // L72 live prop counts
    get placedCounts() { return placedLife.counts(); },          // L73 live placed-entity counts
    setScatterHidden(on) { if (scatterGroup) scatterGroup.visible = !on; },   // L74 hide-scatter QoL (see the ground under a dense canopy)
    get placedLife() { return placedLife; },
    get canUndo() { return _undo.length > 0; },
    get active() { return worldActive; }, get seed() { return worldSeed; }, get preset() { return worldPreset; }, get presets() { return PRESET_KEYS; },
  };

  /* L71 OBJECT CATALOG — the world-editor's extensible registry (materials/scatter/entities under one shape).
     Seeded from BIOMES + the scatter/entity kinds; the art seam lets a project swap placeholder→real art. */
  const catalog = seedWorldEditorCatalog();
  /* L74 — the WORLD-EDITOR tool dispatcher: one reusable object owning the active tool + shared brush +
     per-tool selection + apply-routing (it routes to world.{sculpt,paintBiome,paintScatter,placeEntity}).
     Engine-first: every project that boots the engine inherits the editor; the project only wires input. */
  const editor = createEditor({ world, catalog, inspector });
  /* L76 — the PILOT CONTROLLER: possess a placed pilotable (the ATV) and drive it. Engine-first: built
     here so every project that boots the engine inherits possession; the project wires only input→axes +
     the possess trigger + the HUD. It needs the rig (the chase cam it drives) + a `world` query object
     (just `heightAt` for the ground model; the spacecraft will read the water/medium probes too, L77). */
  /* L77 — `waterHeightAt(x,z)`: the world-Y of the WATER SURFACE at (x,z), for the spacecraft's medium probe.
     The SEA is the wave-sim plane at y=0; it's present wherever the terrain dips below sea level (the ocean that
     rims the island — WORLD_SIZE 26 < WATER_SIZE 28). Over dry land there's no open sea, so we return a deep
     sentinel (the probe reads "no water here"). Interior LAKES (a raised surface) are a future refinement — flagged
     in the L77 handoff; the ocean is what the "splash into the sea" demo flies into. */
  const SEA_Y = 0;   // NO_WATER is the shared pilot.js export (was a local -999)
  // L107 (heli-water-lift GATE fix) — the pilot's waterHeightAt is now OVERRIDABLE. In city mode the built world is
  // flat (worldHeightAt→0), so the default below reports NO_WATER everywhere and the heli "lands on an invisible floor"
  // at the visual sea's waterline (descend dead). A project registers a sampler that knows the REAL sea (the city wires
  // it from the coastline); the sampler wins, and returns null to DEFER to the default (world mode / no sampler).
  // The empirical test caught a gap in the spec (which covered WATER only): the airborne branch clamps y ≥ heightAt
  // (pilot "can't sink through the ground"), and in city heightAt is a FLAT 0, so the craft can't descend below the
  // surface to even ENTER the water medium — it stalls at y≈0. The WORLD sea works only because its terrain dips below
  // sea level. So heightAt is ALSO overridable, and the city lowers it to a SEABED over open water. Both samplers
  // return null to DEFER to the engine default (world mode / office / no sampler → unchanged).
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
  // L108 (part C) — the FLIGHT COLLIDER. Cells sized to the city block PITCH (the grid the city IS). The pilot's
  // world gains `collide` (resolve the craft-sphere out of buildings) + `collideActive` (only substep/resolve when
  // there ARE solids → world mode with no props stays on the exact single-step path = byte-identical to today).
  const collider = createColliderWorld({ cell: LAYOUT.PITCH });
  const pilot = createPilotController({ rig, world: {
    heightAt: pilotHeightAt, waterHeightAt: worldWaterAt,
    collide: (state, dt, cfg) => collider.resolveSphere(state, dt, cfg),
    collideActive: () => collider.active(),
    // L108 (spring-arm): the chase camera sweeps this against the SAME collider grid → shortens instead of clipping
    // through towers. Lives on the pilot's world literal (engine-core), NOT main.js — the world object is a closure
    // built here, unreachable from the project; wiring it in main.js would leave the arm silently inert (decision R1).
    segmentHit: (ox, oy, oz, ex, ey, ez, r) => collider.segmentHit(ox, oy, oz, ex, ey, ez, r),
  } });

  /* 7e) SUN SHADOW (L16) — the SunRig key light now casts. Its shadow camera is an ORTHOGRAPHIC
     box (directional light = parallel rays) that we FIT to the island: a tight frustum packs the
     2048² shadow map's texels onto the city, so the texel density (map pixels per world unit) stays
     high → crisp shadows. A loose frustum wastes texels on empty water → blur. We re-fit on each
     regenerate in case the city size changes. The light's target sits at the origin (the island
     centre); we add it to the scene so its world matrix updates. */
  city.group.remove(city.key);           // a shadow-casting light is happiest at the scene ROOT
  scene.add(city.key);                    // (nested in a group, its shadow matrices can misbehave)
  city.key.castShadow = true;
  city.key.shadow.mapSize.set(2048, 2048);
  city.key.shadow.bias = -0.00018;       // pull samples toward the light to kill self-shadow ACNE…
  city.key.shadow.normalBias = 0.028;    // …offset along the normal (geometry-scaled) — the main fix
  scene.add(city.key.target);            // directional light aims position → target (origin)
  const SHADOW_DIST = 24;                // how far up the sun-direction we place the light (shadow cam origin)
  function fitShadowFrustum() {
    const cam = city.key.shadow.camera;  // an OrthographicCamera
    const h = city.extent + 4.5;         // half-size, generous for low-sun (grazing) projection
    cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h;
    cam.near = 1; cam.far = SHADOW_DIST * 2;
    cam.updateProjectionMatrix();        // the L09-noted gotcha: changes don't apply without this
    renderer.shadowMap.needsUpdate = true;   // L40: frustum/geometry changed (boot or city regen) → re-render the shadow once
    // L108 (part C): the city geometry just changed → re-bucket the building AABBs. This is THE post-generate
    // engine hook (main.js calls it after every city.generate() → reroll/profile-swap), so the collider tracks
    // the live city with zero project wiring (engine-first — no drift surface). Safe before the first generate:
    // state.solids is undefined then → rebuild(null) clears to an empty world (no-op resolve).
    collider.rebuild(city.state.solids);
  }
  fitShadowFrustum();

  /* ------------------------------------------------------------
     8) THE POST CHAIN — render targets + fullscreen passes.

     sceneRT is the BEAUTY PASS: the finished 3D frame (water and all) rendered
     into a texture instead of the screen. It needs a depth buffer (the 3D scene
     still has to depth-sort INTO it); the pass RTs after it do not — a fullscreen
     quad has no depth to sort.

     Each pass = a ShaderMaterial on a shared fullscreen quad. runPass(material,
     target) draws the quad with that material into `target` (null = the screen).
     A pass reads the PREVIOUS pass's texture via its uScene uniform — never the
     buffer it writes (a shader can't read its own output; that's why chains hop
     between targets at all). Mode 3 is the only one that needs the intermediate
     filmicRT hop: beauty → (filmic) → filmicRT → (pixel) → screen.
     ------------------------------------------------------------ */
  /* The beauty pass now also captures a DEPTH TEXTURE (Lesson 08): a sampler the
     toon pass reads to find silhouettes. A plain depthBuffer (renderbuffer) can't be
     sampled in a shader; a DepthTexture can. WebGLRenderTarget.setSize resizes the
     attached depthTexture for us, so resize stays a one-liner. */
  const sceneDepth = new THREE.DepthTexture(drawBuffer.x, drawBuffer.y);
  const sceneRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, depthTexture: sceneDepth,
  });
  const filmicRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  /* L83 MSAA — an ISOLATED multisampled beauty render target. The BEAUTY 3D frame (mode 1/2, non-vector) renders
     HERE (4× MSAA → the GPU antialiases the low-poly geometry edges + resolves to `.texture`); the beauty post
     chain (bloom + filmic) reads the resolved texture. The PIXEL/TOON/VECTOR tiers keep rendering to the plain
     `sceneRT` (no MSAA), so their crunch input is UNCHANGED → byte-identical. `samples:4` needs WebGL2 (we have it);
     if a context can't multisample it silently falls back to 0 (no AA, no error). No depthTexture: beauty doesn't
     sample depth (only the toon pre-pass does, off the plain sceneRT). */
  const beautyRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: true, stencilBuffer: false, samples: 4,
  });
  /* Style-LOD crossfade buffers: in the transition band we render BOTH styles to
     their own targets, then post-mix.frag lerps them. Outside the band only one
     style runs, straight to the screen — so this double work is band-only. */
  const toonRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  const pixelRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
  });
  /* L66 BLOOM buffers — HALF resolution (the glow is wide + soft, so half-res is invisible + 4× cheaper).
     A = bright-pass + the horizontal blur target; B = the vertical blur target ping-pong. */
  let bloomW = Math.max(1, Math.floor(drawBuffer.x / 2)), bloomH = Math.max(1, Math.floor(drawBuffer.y / 2));
  const bloomA = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  const bloomB = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  // L107 GOD-RAY buffers — also half-res (radial shafts are wide + soft). raysBright = the high-threshold bright pass
  // (sun + sky only); raysRT = the radial-march output the filmic composite adds in. Beauty-only; unused on stylized frames.
  const raysBright = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });
  const raysRT     = new THREE.WebGLRenderTarget(bloomW, bloomH, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false });

  const postScene  = new THREE.Scene();
  const postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); // required by .render(); fullscreen.vert ignores it
  const postQuad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  postScene.add(postQuad);

  const filmicMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postFilmicFrag,
    uniforms: {
      uScene:      { value: sceneRT.texture },
      uTime:       { value: 0 },
      uResolution: { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uGrain:      { value: 1.0 },              // 1 for pure filmic; 0 feeding a style pass
      uChroma:     { value: 1.0 },              // chromatic aberration; 0 feeding a style pass
      uExposure:   { value: 1.0 },              // L09: time-of-day exposure from the SunRig
      uAces:       { value: 0.0 },              // L66: ACES tonemap gate (1 on beauty tiers, 0 for pixel/toon)
      uBloom:        { value: bloomA.texture },   // L66: the blurred glow (read; added by uBloomStrength)
      uBloomStrength:{ value: 0.0 },              // L66: 0 = no glow (non-beauty tiers stay identical)
      uGrade:        { value: 0.0 },              // L67: colour-grade gate (1 on beauty tiers, 0 for pixel/toon)
      uGradeTint:    { value: sunRig.grade.tint },// L67: by-ref — the SunRig drives the mood each frame
      uGradeLift:    { value: sunRig.grade.lift },
      uGradeSat:     { value: 1.0 },
      uGradeContrast:{ value: 1.0 },              // L69: noon contrast push
      uWarmBal:      { value: 0.0 },              // L105: noon warm-balance (beauty-only; set per-frame in renderCityPipeline, read inside the uGrade gate)
      uDither:       { value: 0.0 },              // L80: output dither (beauty only; 0 on pixel/toon pre-pass)
      uTonemap:      { value: 0.0 },              // L83: 0 = ACES, 1 = AgX (beauty tonemap curve; A/B via setTonemap)
      uRaysTex:      { value: raysRT.texture },   // L107: god-ray shafts (added in HDR before tonemap; grade tints them warm)
      uRays:         { value: 0.0 },              // L107: 0 = no rays (stylized tiers stay identical; beauty raises it per-frame)
      uBeautyExp:    { value: 1.0 },              // L108: beauty-only noon exposure trim (1 = none; inside the uGrade gate → pixel path untouched)
    },
  });

  /* L66 BLOOM materials + the pass. brightMaterial isolates the hot pixels (sun/moon/star cores), then
     blurMaterial runs twice (H, then V) to spread them; `bloomPass(srcRT)` leaves the soft glow in
     bloomA + sets the filmic composite's strength (tied to a low-sun boost so dusk blooms harder). */
  const brightMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: postBrightFrag,
    uniforms: { uScene: { value: sceneRT.texture }, uThreshold: { value: 0.78 } },
  });
  const blurMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: postBlurFrag,
    uniforms: { uScene: { value: bloomA.texture }, uDir: { value: new THREE.Vector2() } },
  });
  const BLOOM_BASE = 0.85;                       // base glow strength on the beauty tiers
  function bloomPass(srcRT) {
    // L107 review FIX (HIGH) — bloomPass is now SELF-CONTAINED: set the bright-pass threshold BEFORE the bright pass
    // consumes it. It used to be written at the END, so godraysPass's later `uThreshold = RAY_THRESHOLD` (1.9) leaked
    // into the NEXT frame's bright pass (per-frame order bloomPass→godraysPass) — every golden-hour frame's bloom ran
    // at 1.9 not ~1.22, excluding the golden sky + sun halo the L106 tuning deliberately kept. No cross-pass coupling now.
    const lowSun = 1.0 - THREE.MathUtils.clamp(sunRig.sunArc.y * 2.2, 0, 1);   // low-sun boost: the sun blooms harder at golden hour than noon
    // L106 WASHOUT FIX (lighting panel): raise the bright-pass threshold above ORDINARY sunlit-facade luminance (cream
    // facades ~1.17 pre-tonemap) so BUILDINGS stop feeding bloom — ~1.22 at low sun (facades hottest), ~0.92 at noon.
    // The sun disc + sky are HDR-bright (>>1) so they still glow → golden hour preserved. Beauty-only → byte-identical.
    // L112 A-i: DROP the threshold at night so lit WINDOW panes (~1.2–1.6) clear it and HALO — the dusk/night city
    // gets a glowing lit skyline instead of window-dots-on-black. sunDownK=0 in day incl. noon → the L106 day tuning
    // (and the noon byte-identical anchor) is untouched; beauty-only (bloom is a beauty pass). ~0.60 at full night.
    brightMaterial.uniforms.uThreshold.value = (0.92 + 0.30 * lowSun) - 0.62 * sunDownK(sunRig.sunArc.y);
    brightMaterial.uniforms.uScene.value = srcRT.texture;
    runPass(brightMaterial, bloomA);                                   // bright-pass → bloomA (half-res)
    blurMaterial.uniforms.uScene.value = bloomA.texture;               // H blur: A → B
    blurMaterial.uniforms.uDir.value.set(1.6 / bloomW, 0);
    runPass(blurMaterial, bloomB);
    blurMaterial.uniforms.uScene.value = bloomB.texture;               // V blur: B → A
    blurMaterial.uniforms.uDir.value.set(0, 1.6 / bloomH);
    runPass(blurMaterial, bloomA);
    filmicMaterial.uniforms.uBloom.value = bloomA.texture;
    filmicMaterial.uniforms.uBloomStrength.value = BLOOM_BASE * (0.32 + 0.95 * lowSun);
  }

  /* L107 GOD RAYS — screen-space crepuscular shafts, beauty-tier only. From the design spec: reuse brightMaterial with
     a HIGHER threshold (sun+sky only, not lit facades) into raysBright, then march toward the sun's screen position
     (godraysMaterial) into raysRT; post-filmic adds raysRT × uRays in HDR (the grade tints it warm — Rule 2, no new
     colour knob). Runs ONLY when called (in the beauty branch, governor rung < 2) and only when the sun is up + in
     frame + low → zero cost + byte-identical elsewhere. */
  const RAY_THRESHOLD = 1.9, RAYS_MAX = 0.22;   // subtle garnish: a HIGH threshold so only the sun DISC (not the bright golden sky) feeds the shafts + a low max so it enhances, never washes. Verified: an isolation build (RAYS_MAX=0) proved the t=0.30 golden wash is PRE-EXISTING, not the rays. Tunable — Laurence's aesthetic call on the live link.
  const godraysMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: postGodraysFrag,
    uniforms: { uBright: { value: raysBright.texture }, uSunUv: { value: new THREE.Vector2(0.5, 0.5) },
      uDensity: { value: 0.9 }, uDecay: { value: 0.96 }, uWeight: { value: 0.05 } },
  });
  const _sunClip = new THREE.Vector4();
  function godraysPass(srcRT) {
    // project the sun (celestials place it at cameraPos + sunDir·88) into clip space → screen UV + an in-frame/behind test.
    _sunClip.set(rig.camera.position.x + sunRig.sunDir.x * 88, rig.camera.position.y + sunRig.sunDir.y * 88, rig.camera.position.z + sunRig.sunDir.z * 88, 1.0)
      .applyMatrix4(rig.camera.matrixWorldInverse).applyMatrix4(rig.camera.projectionMatrix);
    const w = _sunClip.w;
    const ndcx = _sunClip.x / w, ndcy = _sunClip.y / w;
    const inFrame = w > 0 ? (1 - THREE.MathUtils.smoothstep(Math.max(Math.abs(ndcx), Math.abs(ndcy)), 0.9, 1.35)) : 0;
    const lowSun = 1.0 - THREE.MathUtils.clamp(sunRig.sunArc.y * 2.2, 0, 1);    // peaks at golden hour, ~0 at noon
    const sunUp = THREE.MathUtils.smoothstep(sunRig.sunArc.y, -0.05, 0.06);      // die out below the horizon (no night shafts)
    const strength = RAYS_MAX * lowSun * inFrame * sunUp;
    if (strength <= 0.001) { filmicMaterial.uniforms.uRays.value = 0.0; return; }  // sun off-screen / behind / high → skip the passes entirely (no cost)
    godraysMaterial.uniforms.uSunUv.value.set(ndcx * 0.5 + 0.5, ndcy * 0.5 + 0.5);
    brightMaterial.uniforms.uThreshold.value = RAY_THRESHOLD;                    // bloomPass already ran; safe to re-use with a raised threshold
    brightMaterial.uniforms.uScene.value = srcRT.texture;
    runPass(brightMaterial, raysBright);                                         // high-threshold bright pass → raysBright
    godraysMaterial.uniforms.uBright.value = raysBright.texture;
    runPass(godraysMaterial, raysRT);                                            // radial march → raysRT
    filmicMaterial.uniforms.uRaysTex.value = raysRT.texture;
    filmicMaterial.uniforms.uRays.value = strength;
  }

  /* PALETTES (L09) — pre-build padded 8-Color arrays per (theme, time-of-day) ONCE,
     then just point the pixel uniforms at them each frame (zero per-frame alloc). The
     shader lerps uPalette→uPaletteB by uPaletteBlend, so the palette drifts with the day. */
  const PAL_SIZE = 5;
  const pad8 = (hexes) => {
    const a = hexes.map((h) => new THREE.Color(h));
    while (a.length < 8) a.push(new THREE.Color(0, 0, 0));
    return a;
  };
  const SLOTS = ['night', 'dawn', 'noon', 'dusk'];           // matches the SunRig keyframes
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
      uPalette:      { value: PALCACHE.inkgold[2] },           // noon ink-gold to start
      uPaletteB:     { value: PALCACHE.inkgold[2] },
      uPaletteBlend: { value: 0.0 },
      uPaletteSize:  { value: PAL_SIZE },
    },
  });

  /* ------------------------------------------------------------
     PIXELKIT in the live scene (Lesson 10). The default pixel style is the L09
     day/night palette (above). Pressing `B` cycles ERA presets — 1-bit / 8-bit /
     16-bit / modern — that re-skin the dimetric district with the SAME shader the
     tools/pixelate.html page uses. 'native' = the day/night look (no era override).
     ------------------------------------------------------------ */
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
  /* Pre-build one palette texture per era (modern has none) so `B` is instant. */
  const ERA_TEX = {};
  for (const name of SCENE_ERA_ORDER) ERA_TEX[name] = ERA_PRESETS[name].palette ? makePaletteTexture(ERA_PRESETS[name].palette) : null;

  /* The TOON pass (Lesson 08 zoomed-in style): cel posterize + depth outlines. It
     reads the graded (grain-free) beauty for colour and the beauty's depth texture
     for silhouettes. uNear/uFar/uIsPerspective are refreshed each frame from the
     active camera (the rig can be perspective OR ortho — depth linearizes differently). */
  const toonMaterial = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postToonFrag,
    uniforms: {
      uScene:         { value: filmicRT.texture },
      uDepth:         { value: sceneDepth },
      uResolution:    { value: new THREE.Vector2(drawBuffer.x, drawBuffer.y) },
      uBands:         { value: 4.0 },
      uToonGain:      { value: 1.7 },                          // lift the moody scene… (driven by rig)
      uToonGamma:     { value: 0.6 },                          // …shadows most, into the bands
      uToonFloor:     { value: sunRig.toonFloor },             // L09: night ambient floor (by ref)
      uOutline:       { value: sunRig.outline },               // L09: black by day → navy at night (by ref)
      uNear:          { value: 0.1 },
      uFar:           { value: 100 },
      uIsPerspective: { value: 1.0 },
    },
  });

  /* The crossfade mix (post-mix.frag): lerp toonRT ↔ pixelRT by uBlend. */
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

  /* 11) RESIZE (engine half) — keep the rig, canvas, every ENGINE-owned screen-sized RT
     and uResolution in sync. main.js's resize listener calls this, then sizes its own
     office/dive RTs + office camera. WebGLRenderTarget.setSize keeps the same .texture
     object (it reallocates the GPU storage behind it), so materials holding rt.texture
     stay valid. Returns the fresh drawing-buffer size so main can size its RTs to match. */
  function resize() {
    rig.setViewport(window.innerWidth, window.innerHeight); // persp aspect + ortho frustum
    renderer.setSize(window.innerWidth, window.innerHeight);
    const db = renderer.getDrawingBufferSize(new THREE.Vector2());
    grabRT.setSize(db.x, db.y);                   // L112 foam: resizes grabRT's attached grabDepth DepthTexture too (decision #3)
    sceneRT.setSize(db.x, db.y);                  // resizes the attached depthTexture too
    filmicRT.setSize(db.x, db.y);
    beautyRT.setSize(db.x, db.y);                 // L83: the multisampled beauty RT tracks the canvas
    toonRT.setSize(db.x, db.y);
    pixelRT.setSize(db.x, db.y);
    bloomW = Math.max(1, db.x >> 1); bloomH = Math.max(1, db.y >> 1);   // L66: half-res bloom buffers track resize
    bloomA.setSize(bloomW, bloomH); bloomB.setSize(bloomW, bloomH);
    raysBright.setSize(bloomW, bloomH); raysRT.setSize(bloomW, bloomH);   // L107: god-ray half-res buffers track resize
    waterMaterial.uniforms.uResolution.value.set(db.x, db.y);
    filmicMaterial.uniforms.uResolution.value.set(db.x, db.y);
    pixelMaterial.uniforms.uResolution.value.set(db.x, db.y);
    pixelkitMaterial.uniforms.uResolution.value.set(db.x, db.y);
    toonMaterial.uniforms.uResolution.value.set(db.x, db.y);
    return db;
  }

  /* ============================================================
     L78 ENGINE HARDENING — the profiler (measure honestly) + the quality governor (degrade gracefully).
     ------------------------------------------------------------ */
  const profiler = createEngineProfiler({ renderer });
  let _qualityShadows = true;                        // the governor's shadow knob (ANDed with the caller's shadowsOn)
  // apply(level, rung): the governor owns the POLICY (when); the engine owns the KNOBS (what). Level 0's rung
  // (dpr:null, shadows:true) restores the boot state exactly → byte-identical at full headroom. A dpr change
  // re-dispatches 'resize' so the project's resize handler resizes ALL render targets through the one path.
  function applyQuality(level, rung) {
    const cap = rung.dpr == null ? BOOT_DPR_CAP : rung.dpr;
    const want = Math.min(window.devicePixelRatio, cap);
    if (Math.abs(renderer.getPixelRatio() - want) > 1e-3) {
      renderer.setPixelRatio(want);
      if (typeof window !== 'undefined' && window.dispatchEvent) window.dispatchEvent(new Event('resize'));
      else resize();
    }
    _qualityShadows = rung.shadows !== false;
    if (!_qualityShadows) renderer.shadowMap.needsUpdate = false;   // stop re-rendering the shadow map at deep levels
  }
  const governor = createQualityGovernor({ profiler, apply: applyQuality });

  // The project's loop brackets each frame with these (CPU+GPU timing wraps the render it dispatches between
  // them); frameEnd also ticks the governor. Engine-first: the loop just calls two methods.
  function frameStart() { if (!_paused && !_contextLost) profiler.frameStart(); }
  function frameEnd() { if (_paused || _contextLost) return; profiler.frameEnd(); governor.update(); }
  function setActive(visible) { _paused = !visible; if (typeof window !== 'undefined') window.__paused = _paused; }

  /* L79 GPU PRE-WARM — the smooth-first-impression fix. Three compiles a material's GLSL program LAZILY on its
     first render → a visible hitch/pop the first time each material/pass appears (the "looks broken on load"
     bug). Before a showcase hero plays we force it EAGER: renderer.compile() walks the live scene graph and
     compiles every material's program now; then we render ONE full pipeline frame to an OFFSCREEN target so the
     RTT post passes (bloom bright/blur, the Preetham sky, water, the filmic/pixel/toon chain) also compile +
     warm. Result: frame 1 of the hero is buttery. Call it AFTER the scene's content is in place (e.g. world
     mode entered + the craft placed). C++ anchor: touch every code path once to page it in before the hot loop. */
  function prewarm() {
    try {
      renderer.compile(scene, rig.camera);
      updateWorld(1 / 60, 0, { shadowsOn: true });          // populate uniforms for a representative frame
      renderCityPipeline(decideStyle(), sceneRT);           // warm the RTT post passes (render OFFSCREEN, not to screen)
      renderer.setRenderTarget(null);
    } catch (e) { if (typeof console !== 'undefined') console.warn('[L79] prewarm', e); }
  }

  /* ============================================================
     STYLE STATE + THE RENDER LOOP API (Lesson 39, E2 part 2 — migrated from city/main.js).
     For the projects split, office/hoard build standalone apps "calling the engine API". So the
     render pipeline + the per-frame world-step + the style state now live HERE (the engine), and
     each project drives them. The CITY showcase calls every one of these (the byte-identical city
     render is the acceptance proof that the relocation changed nothing). C++ anchor: these are the
     engine's member functions; the projects are the programs that call them.
     ------------------------------------------------------------ */
  /* POST/STYLE state. `mode` = the post chain (1 raw · 2 filmic · 3 AUTO zoom-ladder · 7 force
     pixel · 8 force toon). `vector` = the flat-vector material axis. `terminalPalette` = the P
     theme swap. `sceneEra` = the B-cycled PixelKit era ('native' = the day/night look). */
  let mode = 3, vector = false, terminalPalette = false, sceneEra = 'native';
  // STYLE-LOD thresholds on the rig's normalized zoom (styleT: 0 near … 1 far): toon → 16-bit →
  // 8-bit → Game Boy. The toon↔pixel boundary crossfades; the pixel eras snap at thresholds.
  const STYLE_NEAR = 0.30, STYLE_FAR = 0.46, ERA_8BIT = 0.62, ERA_GB = 0.80;
  const SCENE_ERAS = ['native', ...SCENE_ERA_ORDER];   // B cycles these (gb, not 1-bit)
  const ERA_LABEL = { '16-bit': '16-bit', '8-bit': '8-bit', 'gb': 'Game Boy', 'modern': 'Modern', 'native': 'Pixel', '1-bit': '1-bit' };
  if (typeof window !== 'undefined') { window.__mode = mode; window.__vector = vector; window.__era = sceneEra; }
  // L78: per-frame fps/percentiles/GPU-ms/leak now live in the EngineProfiler (window.__perf, populated each
  // second by frameEnd). The old `?perf`-gated 1-Hz console logger is superseded; `window.__frames` (below) is
  // the rendered-frame counter the pause-on-hidden verify watches freeze.
  if (typeof window !== 'undefined') window.__frames = 0;
  // L41 loading screen: the page shell shows #lgr-loader immediately (before this JS bundle even loads);
  // we fade it out on the first rendered frame (a one-shot latch in updateWorld). __loaded mirrors it.
  if (typeof window !== 'undefined') window.__loaded = false;
  let _loaderFrames = 0;
  // L40 WIN A shadow dirty-flag state: re-render the shadow map only when the sun moved past ε (≈0.25°)
  // or shadows were just toggled on. SHADOW_EPS2 is a squared-distance threshold on the unit sunDir.
  const SHADOW_EPS2 = 0.00002;
  const _lastShadowSunDir = new THREE.Vector3(1, 1, 1);   // forces a first-frame update (≠ any real sunDir)
  let _lastShadowsOn = false;

  /* Drive the pixel palette from the time of day (the L09 Pokémon-Gold trick, made continuous). */
  function updatePixelPalette(t) {
    const cache = terminalPalette ? PALCACHE.terminal : PALCACHE.inkgold;
    const seg = (t % 1) * 4;
    const i = Math.floor(seg) % 4;
    pixelMaterial.uniforms.uPalette.value  = cache[i];
    pixelMaterial.uniforms.uPaletteB.value = cache[(i + 1) % 4];
    pixelMaterial.uniforms.uPaletteBlend.value = seg - Math.floor(seg);
  }
  /* Configure the pixelkit material for a named era (grid coarseness + dither + palette LUT). */
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

  /* Render the live CITY through an arbitrary camera into `dest`, beauty only (no post) — used for
     the office glass. Includes the grab pass so the water still refracts. */
  function renderCityBeautyTo(cam, dest) {
    setSkyTier(true);                      // L66: the office-window view is always a beauty render → Preetham sky (day)
    scene.environment = ensureEnv();       // L67: lit by the sky in the window too
    aoStrength.value = 1.0;                // L80: the window is a beauty render → baked vertex AO on
    waterMaterial.uniforms.uFoamStrength.value = 1.0;   // L112 FOAM: the office window is a beauty render → foam on (wire ALL beauty paths, L54/L55)
    waterMaterial.uniforms.uNear.value = cam.near; waterMaterial.uniforms.uFar.value = cam.far; waterMaterial.uniforms.uIsPerspective.value = cam.isPerspectiveCamera ? 1.0 : 0.0;
    const _midK = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(sunRig.sunArc.y, 0, 1), 0.22, 0.8);   // L100: same beauty midday cut — the window is a beauty render too
    const _lw = lowSunWashK(sunRig.sunArc.y);   // L108 A2: same golden/afternoon wash factor in the office-window (L54/L55 — wire ALL beauty paths)
    waterMaterial.uniforms.uGlintK.value = _lw;   // L112 GLINT: office window is a beauty render → glitter on, weighted by the same lowSun factor
    const _sd = sunDownK(sunRig.sunArc.y);      // L112 MED1: same NIGHT factor — A-i (bloom threshold) was wired here but A-ii (warm fill) was MISSED (L54/L55 drift) → office-dive night streets were black
    city.fill.intensity = _baseFill * (1 - 0.60 * _midK - 0.35 * _lw) + 0.35 * _sd;   // L112 MED1: night fill LIFT (mirror the main-path A-ii) so office-window faces/streets read at night, not black
    scene.environmentIntensity = _baseEnvI * (1 - 0.45 * _midK - 0.58 * _lw);   // L108 A2: cut the golden/afternoon flood here too (office env stays 0.45·midK per A decision #4; the A2 wash term is shared)
    windowRecess.value = _midK;   // L106: same noon window-recess darken for the office-dive window (a beauty render)
    city.fill.groundColor.copy(sunRig.hemiGround).lerp(NIGHT_STREET_WARM, 0.55 * _sd);   // L112 MED1 (L114 fix A): warm the office-window night ambient. COPY-BEFORE-LERP = idempotent — the office corner calls this 3× per frame (S/L/R panes) and a city dive re-enters it; a bare in-place lerp COMPOUNDED (panes crept to 0.55/0.80/0.91). Recompute from hemiGround every call.
    waterMaterial.uniforms.uSkyRefl.value = 0.55;   // L108 (Lever 5): the window is a beauty render → the sea mirrors the sky here too (decision #1 — wire ALL beauty paths)
    celestials.place(cam);                 // L98b: re-place the skydome sun/moon for the WINDOW camera (camera-relative)
    water.visible = false;
    renderer.setRenderTarget(grabRT);
    renderer.render(scene, cam);
    water.visible = true;
    // L67: route the office-window through the BEAUTY POST CHAIN (ACES + bloom + grade) so the dive window
    // GLOWS like the main view (closes the L66 gap). The window renders BEFORE the main pipeline in tick
    // (sequential), so borrowing sceneRT + bloom here is safe; the fullscreen post quad samples normalised
    // UVs, so writing into a differently-sized `dest` (cityWindowRT) is fine.
    renderer.setRenderTarget(beautyRT);            // L83: the window is beauty → MSAA RT
    renderer.render(scene, cam);
    bloomPass(beautyRT);
    filmicMaterial.uniforms.uScene.value = beautyRT.texture;   // L83
    filmicMaterial.uniforms.uAces.value = 1.0;
    filmicMaterial.uniforms.uGrade.value = 1.0;
    filmicMaterial.uniforms.uGrain.value = 0.0;
    filmicMaterial.uniforms.uChroma.value = 0.0;
    filmicMaterial.uniforms.uDither.value = 1.0;   // L80: beauty window → dither
    filmicMaterial.uniforms.uWarmBal.value = 0.90 * _midK;   // L105: de-blue the office-window city at noon (match the main city)
    filmicMaterial.uniforms.uBeautyExp.value = 1.0 - 0.12 * _midK - 0.17 * _lw;   // L108 A2: same golden/afternoon exposure trim in the office window (wire ALL beauty paths)
    filmicMaterial.uniforms.uRays.value = 0.0;   // L107 review FIX (LOW, L54/L55 wiring-drift): the office-window beauty composite never sets uRays, so in a steady office frame (renderCityPipeline's per-frame reset doesn't run) it would composite the MAIN camera's stale shafts into the fixed windowCam view. Zero it (v1: no window rays).
    runPass(filmicMaterial, dest);
    celestials.place(rig.camera);          // L98b: restore the skydome placement for the MAIN view render that follows
  }

  // L100: per-frame lighting BASELINES captured in updateWorld; renderCityPipeline cuts them for the BEAUTY tier at noon.
  let _baseFill = 1.0, _baseEnvI = 0.34;
  // L105: a warm-neutral the BEAUTY noon fill lerps toward — counteracts the residual blue Preetham sky-IBL + hemiSky tint
  // (measured: city Realistic noon blue-dominance 1.52 vs golden 0.71). Only used in the beauty branch, midK-scaled.
  const NOON_NEUTRAL = new THREE.Color('#cdaa80');

  /* The full CITY pipeline (grab → beauty → post/style chain) into a PARAMETERIZED final target
     (screen `null` for city mode, or cityScreenRT during the dive). The exact L06–L08 chain. */
  function renderCityPipeline(style, finalDest) {
    // L66 tier gate: the BEAUTY tiers (raw mode 1 / filmic mode 2, non-vector) get the Preetham sky; the
    // stylized tiers (pixel/toon/auto = mode 3/7/8, or vector) keep the flat backdrop → identical to before.
    const beauty = !vector && (mode === 1 || mode === 2);
    setSkyTier(beauty);
    scene.environment = beauty ? ensureEnv() : null;      // L67 sky-IBL — SCENE-LEVEL gate (must NOT leak to pixel)
    aoStrength.value = beauty ? 1.0 : 0.0;                // L80: baked vertex AO ONLY on the beauty scene render → pixel/vector/toon byte-identical
    // L112 FOAM gate — the aoStrength pattern (0 stylized → the frag term is a no-op → byte-identical). Set the
    // grab-depth linearizer to THIS render's camera so the shoreline depth-fade is correct (persp city / office).
    waterMaterial.uniforms.uFoamStrength.value = beauty ? 1.0 : 0.0;
    waterMaterial.uniforms.uNear.value = rig.camera.near;
    waterMaterial.uniforms.uFar.value  = rig.camera.far;
    waterMaterial.uniforms.uIsPerspective.value = rig.camera.isPerspectiveCamera ? 1.0 : 0.0;
    // L100 BEAUTY-ONLY MIDDAY LIGHTING CALIBRATION — the L92/L93 fix was capped because the noon fill is the SHARED
    // HemisphereLight (cutting it in updateWorld would darken every tier). Here, gated on `beauty` (only one tier
    // renders per frame), we cut the hemisphere FILL + the sky-IBL further as the sun CLIMBS — so the direct key light
    // casts real shadows again and the buildings regain form/contrast (kills the flat high-key wash). At golden/low sun
    // (where the fill matters + the look is already great) the cut fades to zero. Stylized tiers re-use _baseFill via
    // the `: _baseFill` branch → BYTE-IDENTICAL; envIntensity is beauty-only-effective (env is null elsewhere).
    const midK = THREE.MathUtils.smoothstep(THREE.MathUtils.clamp(sunRig.sunArc.y, 0, 1), 0.22, 0.8);   // 0 low → 1 noon
    const lw = lowSunWashK(sunRig.sunArc.y);   // L108 A2: the golden/afternoon wash factor (0 at dawn+noon; ~1 golden+afternoon)
    waterMaterial.uniforms.uGlintK.value = beauty ? lw : 0.0;   // L112 GLINT: beauty-gate × lowSun weight (0 stylized → byte-identical; 0 at noon → glitter blooms at golden hour)
    const sd = sunDownK(sunRig.sunArc.y);      // L112: the night factor (0 in day incl. noon; ~1 at night)
    city.fill.intensity = beauty ? _baseFill * (1 - 0.60 * midK - 0.35 * lw) + 0.35 * sd : _baseFill;   // L108 A2 golden cut + L112 night LIFT (+0.35 at night so building faces/streets aren't black); stylized keeps _baseFill → byte-identical
    windowRecess.value = beauty ? midK : 0;   // L106: darken the window recess at NOON (beauty only; 0 on pixel/toon/vector → BYTE-IDENTICAL) so panes don't wash out
    if (beauty) {
      // L105 — kill the residual NOON-BLUE wash (DESIGN finding #2). All midK-scaled + beauty-only (golden hour, midK≈0,
      // is UNTOUCHED; stylized tiers never enter this branch + the warm-balance lives inside the uGrade gate + updateWorld
      // resets fill.color next frame → pixel/toon/vector BYTE-IDENTICAL):
      //   (a) a luma-preserving WARM WHITE-BALANCE in the filmic grade — the direct fix for a colour cast (measurement
      //       proved reducing IBL *intensity* alone doesn't shift the blue RATIO; this rebalances R↑/B↓, luma held);
      //   (b) deepen the sky-IBL cut a touch + warm the fill's blue hemiSky — trims the source so the balance does less work.
      filmicMaterial.uniforms.uWarmBal.value = 0.90 * midK;   // NOON only — golden stays warm (no de-blue term on lw)
      scene.environmentIntensity = _baseEnvI * (1 - 0.66 * midK - 0.58 * lw);   // L108 A2: cut the sky-IBL flood at golden/afternoon too (the main wash source) — separates the city from the sky
      filmicMaterial.uniforms.uBeautyExp.value = 1.0 - 0.12 * midK - 0.17 * lw;  // L108 A2: deepen the whole golden/afternoon frame (was over-exposed pale) → richer sky + more building separation (still FIRST inside the uGrade gate)
      city.fill.color.lerp(NOON_NEUTRAL, 0.45 * midK);   // NOON neutral-warm only — golden keeps its warm hemi fill
      city.fill.groundColor.copy(sunRig.hemiGround).lerp(NIGHT_STREET_WARM, 0.55 * sd);   // L112 A-ii (L114 fix A): warm the DOWN-facing night ambient (near-black #0c1018 hemiGround → warm) so streets read. COPY-BEFORE-LERP = idempotent: a DIVE frame runs the office-window RTT's lerp (:1369) first, so a bare in-place lerp here would DOUBLE-warm (pulsing).
    } else {
      filmicMaterial.uniforms.uWarmBal.value = 0.0; filmicMaterial.uniforms.uBeautyExp.value = 1.0;   // stylized: no cut (uGrade=0 no-ops both anyway; explicit for clarity → byte-identical)
      // L114 fix A+H — THE byte-identical violation. A DIVE renders the office-window RTT (a BEAUTY render) BEFORE this
      // stylized main render in the SAME frame: renderCityBeautyTo warms groundColor (:1369) + sets uSkyRefl=0.55 (:1370),
      // and NOTHING resets them before here (updateWorld's copy(hemiGround) + decideStyle's uSkyRefl=0 both ran EARLIER,
      // pre-window). Left un-reset, the stylized grab-pass + main render inherited them → a 1-in-3 warm flicker + a
      // sky-reflection leak = NOT byte-identical (and the noon-blind tier-guard is blind to it). Restore both to the
      // stylized baseline right here, immediately before the stylized render consumes them.
      city.fill.groundColor.copy(sunRig.hemiGround);
      waterMaterial.uniforms.uSkyRefl.value = 0.0;
    }
    filmicMaterial.uniforms.uBloomStrength.value = 0.0;   // L66: default no glow; bloomPass() raises it on beauty tiers
    filmicMaterial.uniforms.uRays.value = 0.0;            // L107: default no god rays; godraysPass() raises it on beauty tiers (0 → byte-identical stylized composite)
    water.visible = false;
    renderer.setRenderTarget(grabRT);
    renderer.render(scene, rig.camera);
    water.visible = !_editing;   // L96: the grab pass always hides water; restore to the EDIT state (hidden while the ✎ editor is open so dug pits show), else visible

    // L55: `vector` is a pure MATERIAL flag (the shared `vectorOn` uniform flat-shades every material) — it
    // is ORTHOGONAL to the post-crunch `mode`, so it composes with ALL of them: vector+pixel, vector+toon,
    // vector+auto-LOD. The ONLY no-post path is raw mode 1 (clean beauty, or clean flat-vector when vector is
    // on). Previously a `vectorClean` short-circuit forced a straight render whenever vector was on (except in
    // pixel/toon), which BLOCKED vector+auto from crunching; dropping it lets the post chain run on the
    // flat-vector materials. (C++: vector is an independent bitflag on the material, not a value of the mode
    // enum — see vector-style.js "any combination is valid".)
    // L66: the BEAUTY tiers (raw mode 1 / filmic mode 2, non-vector) route through the filmic pass for ACES
    // (+ the Preetham sky + IBL already swapped in, + bloom + grade below). Vector + pixel/toon keep their
    // exact prior paths (uAces/uGrade stay 0, scene.environment null → byte-identical). `beauty` set above.
    if (mode === 1 && !beauty) {                  // clean flat-vector beauty — unchanged (no post)
      renderer.setRenderTarget(finalDest);
      renderer.render(scene, rig.camera);
    } else if (mode === 1) {                       // L66: raw beauty → filmic(ACES, no grain/chroma) + bloom + grade
      renderer.setRenderTarget(beautyRT);          // L83: MSAA beauty RT (clean edges; resolves to .texture)
      renderer.render(scene, rig.camera);
      bloomPass(beautyRT);
      if (governor.level < 2) godraysPass(beautyRT);   // L107: god rays (beauty tier; governor sheds them first at rung ≥ 2)
      filmicMaterial.uniforms.uScene.value = beautyRT.texture;   // L83: read the resolved MSAA frame
      filmicMaterial.uniforms.uAces.value = 1.0;
      filmicMaterial.uniforms.uGrade.value = 1.0;     // L67
      filmicMaterial.uniforms.uGrain.value = 0.0;
      filmicMaterial.uniforms.uChroma.value = 0.0;
      filmicMaterial.uniforms.uDither.value = 1.0;    // L80: beauty → dither (kill sky banding)
      runPass(filmicMaterial, finalDest);
    } else {
      // L83: beauty renders to the MSAA beautyRT; the STYLIZED tiers (vector/pixel/toon) keep the plain sceneRT
      // (their crunch input unchanged → byte-identical). One render, target chosen by tier.
      renderer.setRenderTarget(beauty ? beautyRT : sceneRT);
      renderer.render(scene, rig.camera);
      if (mode === 2) {
        if (beauty) bloomPass(beautyRT);
        if (beauty && governor.level < 2) godraysPass(beautyRT);   // L107: god rays (beauty only; not on vector; governor sheds at rung ≥ 2)
        filmicMaterial.uniforms.uScene.value = beauty ? beautyRT.texture : sceneRT.texture;   // L83
        filmicMaterial.uniforms.uAces.value = beauty ? 1.0 : 0.0;   // ACES on beauty filmic; off for vector
        filmicMaterial.uniforms.uGrade.value = beauty ? 1.0 : 0.0;  // L67
        filmicMaterial.uniforms.uGrain.value = 1.0;
        filmicMaterial.uniforms.uChroma.value = 1.0;
        filmicMaterial.uniforms.uDither.value = beauty ? 1.0 : 0.0; // L80: dither on beauty filmic, OFF for vector
        runPass(filmicMaterial, finalDest);
      } else {
        filmicMaterial.uniforms.uScene.value = sceneRT.texture;     // L83: pixel/toon pre-pass reads the plain sceneRT (byte-identical)
        filmicMaterial.uniforms.uAces.value = 0.0;                  // pixel/toon PRE-pass: identical to before
        filmicMaterial.uniforms.uGrade.value = 0.0;                 // L67: no grade on the pre-pass (byte-identical)
        filmicMaterial.uniforms.uGrain.value = 0.0;
        filmicMaterial.uniforms.uChroma.value = 0.0;
        filmicMaterial.uniforms.uDither.value = 0.0;                // L80: NO dither on the pre-pass → pixel/toon byte-identical
        runPass(filmicMaterial, filmicRT);
        const cam = rig.camera;
        toonMaterial.uniforms.uNear.value = cam.near;
        toonMaterial.uniforms.uFar.value  = cam.far;
        toonMaterial.uniforms.uIsPerspective.value = cam.isPerspectiveCamera ? 1.0 : 0.0;
        const pixMat = style.era ? (setEra(style.era), pixelkitMaterial) : pixelPass();
        if (style.kind === 'pixel') {
          runPass(pixMat, finalDest); window.__style = 'pixel';
        } else if (style.kind === 'toon') {
          runPass(toonMaterial, finalDest);  window.__style = 'toon';
        } else {
          runPass(toonMaterial, toonRT);
          runPass(pixMat, pixelRT);
          mixMaterial.uniforms.uBlend.value = style.blend;
          runPass(mixMaterial, finalDest); window.__style = 'blend';
        }
      }
    }
  }

  /* Decide the style for THIS frame (modes 7/8 force; mode 3 follows the rig's zoom) and scale the
     water's refraction colour-split down in toon mode (flat cel bands make the fringe read loud).
     Returns the style object the render pipeline consumes. */
  function decideStyle() {
    const style = _computeStyle();
    const toonAmount = style.kind === 'toon' ? 1 : style.kind === 'blend' ? (1 - style.blend) : 0;
    waterMaterial.uniforms.uChromaScale.value = THREE.MathUtils.lerp(1.0, 0.5, toonAmount);
    // L108 (Lever 5): the sea reflects the sky ONLY on the beauty tiers (was pure-black looking down). 0 on
    // pixel/toon → the shader's sky mix is a no-op (byte-identical); vector already early-returns before it.
    waterMaterial.uniforms.uSkyRefl.value = (!vector && (mode === 1 || mode === 2)) ? 0.55 : 0.0;
    return style;
  }
  function _computeStyle() {
    if (mode === 1 || mode === 2) return { kind: 'none' };
    if (mode === 7) return { kind: 'pixel' };
    if (mode === 8) return { kind: 'toon' };
    const t = rig.styleT; window.__styleT = t;            // mode 3 AUTO — the zoom-driven ladder
    if (t <= STYLE_NEAR) return { kind: 'toon' };
    const era = t < ERA_8BIT ? '16-bit' : t < ERA_GB ? '8-bit' : 'gb';
    if (t >= STYLE_FAR) return { kind: 'pixel', era };
    return { kind: 'blend', blend: THREE.MathUtils.smoothstep(t, STYLE_NEAR, STYLE_FAR), era: '16-bit' };
  }

  /* The human-readable name of the look on screen (for the viewer's style hint). */
  function styleHintName(style) {
    if (mode === 1 || mode === 2) return '';
    if (vector && mode !== 7 && mode !== 8) return 'Vector';
    if (style.kind === 'toon') return 'Toon';
    if (style.kind === 'pixel') return ERA_LABEL[style.era || sceneEra] || 'Pixel';
    if (style.kind === 'blend') return 'Toon → ' + (ERA_LABEL[style.era] || 'Pixel');
    return '';
  }

  /* The UNIVERSAL per-frame half (the L39 world-step every project calls): advance the SunRig +
     push it to the lights/uniforms, the weather→sun coupling, shadow strength, the day/night
     vector tint, cityLife/city/waterLife/weather/clouds, fog/season, the fps probe, and the wave
     SIM PASS. The CALLER drives the camera (rig.update), any game pre-step, the water poke (sets
     uMouse before this), the style decision, and the scene-mode render dispatch. `shadowsOn` +
     `seasonTarget` (= the project's current season stop) come from the caller. */
  const _washProbe = { alt: 0, k: 0, u: 0, v: 0, z: 0 };   // L114 fix G: reused each frame so the __wash debug probe stops allocating a fresh object per frame
  function updateWorld(dt, elapsed, { shadowsOn = true, seasonTarget = 0 } = {}) {
    if (typeof window !== 'undefined') window.__frames++;   // L78: rendered-frame counter (freezes when paused-on-hidden)
    shadowsOn = shadowsOn && _qualityShadows;               // L78: the governor can suppress shadows at deep quality levels
    backdrop.material.uniforms.uTime.value = elapsed;
    filmicMaterial.uniforms.uTime.value    = elapsed;
    waterMaterial.uniforms.uTime.value     = elapsed % WATER_CLOCK_PERIOD;   // L112 foam: churn + lapping clock — L114 fix D: WRAPPED (bounds the glint/foam hash inputs; seamless for sin(uTime*0.9))

    sunRig.update(dt);
    city.key.position.copy(sunRig.sunDir).multiplyScalar(SHADOW_DIST);
    city.key.color.copy(sunRig.sunColor);
    city.key.intensity = sunRig.sunIntensity;
    city.fill.color.copy(sunRig.hemiSky);
    city.fill.groundColor.copy(sunRig.hemiGround);
    windowGlow.value = sunRig.windowGlow;
    // L108 A2 (money-path GATE): DEEPEN the golden/afternoon Preetham sky so it reads as a RICH warm-blue gradient,
    // not a flat sandy-tan wash. The wash is HAZE (high turbidity + Mie scatters everything to gray-tan); un-haze it
    // (turbidity↓, Mie↓) and add Rayleigh blue, scaled by lowSunWashK → 0 at deep dawn (untouched) + noon (untouched).
    // Mutating the lerped skyParams IN PLACE is safe: sunRig.update() re-lerps them from the keyframes every frame
    // (transient), and skyParams is consumed ONLY by the Preetham mesh (hidden on stylized) + the beauty IBL (null on
    // stylized) → byte-identical for pixel/toon/vector. Covers the office-window sky for free (same one-clock setParams).
    const _lw = lowSunWashK(sunRig.sunArc.y);
    if (_lw > 0.001) {
      const sp = sunRig.skyParams;
      sp.turbidity = Math.max(1.5, sp.turbidity - 3.6 * _lw);   // un-haze (biggest lever — haze is the flat-tan source)
      sp.rayleigh  = sp.rayleigh + 2.4 * _lw;                    // more blue scatter → the zenith deepens toward warm-blue
      sp.mie       = sp.mie * (1 - 0.50 * _lw);                  // shrink the broad warm flat-glow (keep some sun halo)
    }
    skyAtmo.setSun(sunRig.sunArc); skyAtmo.setParams(sunRig.skyParams);   // L66: drive the Preetham sky (one clock)
    filmicMaterial.uniforms.uGradeSat.value = sunRig.grade.sat;           // L67: grade saturation (tint/lift are by-ref)
    filmicMaterial.uniforms.uGradeContrast.value = sunRig.grade.contrast; // L69: grade contrast (crisp noon)
    // L68 item 0: ease the sky-IBL DOWN at high sun (noon) — when the direct key light dominates + the sky is
    // brightest, the IBL ambient over-lifts the surfaces (the noon washout). Low at noon, normal at golden hour
    // (where the sky-fill matters). Beauty-only (scene.environment is null on the pixel tier → no leak).
    scene.environmentIntensity = 0.34 * (1 - 0.6 * THREE.MathUtils.clamp(sunRig.sunArc.y * 1.5, 0, 1));
    _baseEnvI = scene.environmentIntensity;   // L100: the per-frame baseline (renderCityPipeline cuts it further for BEAUTY at noon)

    const overcast = weatherRig.overcast;
    city.key.intensity *= (1.0 - 0.5 * overcast);
    city.key.color.lerp(OVERCAST_GREY, 0.45 * overcast);
    city.fill.intensity = 1.0 + 0.7 * overcast;
    _baseFill = city.fill.intensity;          // L100: baseline hemisphere fill; renderCityPipeline cuts it for BEAUTY at noon only

    const grazeFade = THREE.MathUtils.smoothstep(sunRig.sunDir.y, 0.06, 0.34);
    const nightF = THREE.MathUtils.lerp(0.28, 1.0, 1.0 - sunRig.windowGlow);
    const sFactor = shadowsOn ? grazeFade * nightF : 0.0;
    city.key.shadow.intensity = 0.72 * sFactor;
    vectorShadow.value = 0.52 * sFactor;
    // L40 WIN A: re-render the shadow MAP only when the sun direction moved past ε, or shadows were just
    // toggled on. (Intensity/colour above are cheap per-frame uniforms — only the DEPTH map render is
    // gated.) This keeps shadows SWEEPING with the day/night arc while skipping the re-render when static.
    // L110 (audit B12): the WHOLE condition must be gated on shadowsOn. Previously the sun-motion clause
    // (distanceToSquared > EPS) fired the depth-map re-render on every sun tick EVEN WITH shadowsOn=false — so
    // the governor's shadows-OFF rung shed ZERO shadow cost while the day/night auto-cycle ran. The
    // `!_lastShadowsOn` clause still re-syncs once when shadows come back on (the cached sun-dir went stale).
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
    simMaterial.uniforms.uWakeCount.value = waterLife.wakeCount;
    weatherRig.update(dt, elapsed);
    simMaterial.uniforms.uRainCount.value = weatherRig.rainDropCount;
    const fogNight = weatherRig.fog * (1.0 - dayness);
    scene.fog.density = AERIAL_BASE + weatherRig.fog * FOG_DENSITY;   // L92: always-on aerial perspective + any weather fog
    _fogColor.copy(sunRig.horizon).lerp(FOG_NIGHT_TINT, 0.85 * fogNight);
    scene.fog.color.copy(_fogColor);
    renderer.setClearColor(_fogColor, 1);
    fogCharm.value = weatherRig.fog;
    backdrop.material.uniforms.uFogAmt.value = 0.7 * weatherRig.fog;
    weatherSnow.value = weatherRig.snow;
    weatherCloud.value = weatherRig.cloud * 0.55;
    weatherCloudOff.x += dt * 0.018; weatherCloudOff.y += dt * 0.009;
    weatherSeason.value += (seasonTarget - weatherSeason.value) * Math.min(1, dt * 1.5);
    // L94 ambient sway: a calm base breeze always on (the scene reads as a PLACE, not a model), picking up
    // with weather. Amplitude is height-weighted in the shader (~0.9 at a tree canopy) → ~0.03 units of drift
    // at rest, ~0.07 in a storm. swayTime is the breeze clock. Foliage only (terrain doesn't wire sway).
    swayTime.value = elapsed;
    swayWind.value = 0.035 + 0.05 * overcast;
    clouds.update(dt, elapsed, sunRig, weatherRig);
    if (worldActive) placedLife.update(dt, elapsed, sunRig);   // L73: placed life animates only in world mode (its group is shown there)
    seizeGroup.visible = !worldActive;                         // L104: the seize heli is a CITY craft → hidden in the terrain world (the world has its own craft)
    if (seizeEnt && !worldActive) seizeEnt.update(dt, elapsed, sunRig);   // L104: tick it in the CITY (placedLife.update covers it in world mode → no double-tick)
    if (worldActive) waterFlow.step(dt);                        // L81: advance the live water-flow sim (coupled to the live terrain)
    if (worldActive) dust.update(dt, elapsed, sunRig, { wind: 0.6 * weatherRig.cloud, qualityLevel: (window.__quality && window.__quality.level) || 0 });   // L94: drifting motes (faded by daytime, throttled by the governor)
    // L53 — the sun/moon look follows the scene's fidelity TIER (same style signal the LOD uses): pixel
    // (pixel/blend kinds), charm (Vector flat or the toon cel look), else realistic. One enum → the body art.
    const _cs = _computeStyle();
    // L89: pure flat-vector gets its OWN flat disc (was borrowing 'charm'). Precedence keeps the post-crunch
    // tiers first (vector+pixel still pixelates), then vector → its flat body, then toon → charm, else realistic.
    const celTier = (_cs.kind === 'pixel' || _cs.kind === 'blend') ? 'pixel'
      : vector ? 'vector'
      : (_cs.kind === 'toon') ? 'charm' : 'realistic';
    celestials.update(dt, elapsed, sunRig, weatherRig, celTier, rig.camera);   // L52/L53 place+colour+tier; L89 pass the active camera → frame-safe clamp

    // --- L112 ROTOR DOWNWASH — "the sea answers the flight". The piloted craft's altitude over water drives one
    // parameterized gaussian into the SAME tier-shared sim as rain/wakes (L18/L26 precedent → all tiers ripple).
    // Set BEFORE the sim pass so it's consumed this frame. Skipped when no float buffer (flat-sea fallback).
    // NOTE (L114 fix F — the comment was FALSE): the wash is NOT `beauty?…:0`-gated — it's a tier-SHARED sim input
    // (the L18/L26 rain/wake precedent: all tiers ripple from the same height field, on purpose). The real reason it
    // can't shift the stylized capture baseline is PHYSICAL: the idle seize heli hovers at 11 ≫ WASH_MAX_ALT=3 → _wk=0
    // → wash=0 in any idle/capture frame. (The C2 "belt-and-braces gate" was never written; don't claim one exists.)
    let _wz = 0, _wu = 0, _wv = 0, _wsig = 0.02, _walt = 99, _wk = 0;
    if (waveOk) {
      const _wt = pilot.active && pilot.craft ? pilot.craft.pilot.getTransform()
                : (seizeEnt && !worldActive && seizeEnt.followable ? seizeEnt.followable.pilot.getTransform() : null);
      if (_wt) {
        const wx = _wt.x, wz = _wt.z;
        const overWater = worldActive
          ? (worldWaterAt(wx, wz) === SEA_Y)                                                  // world: over open sea
          : (Math.abs(wx) <= WATER_SIZE / 2 && Math.abs(wz) <= WATER_SIZE / 2 && !city.isLand(wx, wz));  // city: inside the plane + off the island
        if (overWater) {
          _wu = wx / WATER_SIZE + 0.5; _wv = 0.5 - wz / WATER_SIZE;    // the water-life affine (water-life.js:124)
          _walt = _wt.y;                                               // sea surface is y=0
          const WASH_MAX_ALT = 3.0;
          // L114 fix B: a SUBMERGED craft (_walt<0) has its rotor UNDERWATER → no air-column downwash. The bare
          // formula made _walt<0 send `1 - _walt/3` past 1 → _wk clamped to 1 (a full pit chased the craft DOWN) and
          // σ (below) collapsed toward a single texel → ring-spike noise in ALL tiers (shared sim). Gate _wk to 0
          // below the surface; the splash one-shot (a water ENTRY at y≈0) still fires — it doesn't read _wk.
          _wk = _walt >= 0 ? Math.pow(THREE.MathUtils.clamp(1 - _walt / WASH_MAX_ALT, 0, 1), 2) : 0;   // quadratic altitude falloff → nothing by alt≈3, 0 when submerged
          // L114 fix E: fire the crown ONLY on a from-AIR water ENTRY. `includes('water')` also matched water>air
          // (exit) and water>ground (seabed touch-and-go) → repeated surface geysers on a single dive. crossing is
          // `origin>medium` (pilot.js:186); require it end in `>water` FROM crossFrom `air`.
          const splash = _wt.crossingT > 0.999 && _wt.crossing && _wt.crossing.endsWith('>water') && _wt.crossFrom === 'air';   // one-shot water-entry crown (world dives)
          if (splash) { _wz = 0.10; _wsig = 0.03; }                    // splash OVERRIDES the continuous wash this frame (decision C1)
          else if (_wk > 0) { _wz = -0.035 * _wk; _wsig = 0.018 + 0.014 * THREE.MathUtils.clamp(_walt / WASH_MAX_ALT, 0, 1); }   // downwash depression, σ widens with altitude (cone spread; clamped so it can't collapse)
        }
      }
      simMaterial.uniforms.uWash.value.set(_wu, _wv, _wz, _wsig);
    }
    if (typeof window !== 'undefined') { _washProbe.alt = +(_walt).toFixed(2); _washProbe.k = +(_wk).toFixed(3); _washProbe.u = +(_wu).toFixed(3); _washProbe.v = +(_wv).toFixed(3); _washProbe.z = +(_wz).toFixed(4); window.__wash = _washProbe; }   // L114 fix G: mutate the cached object (no per-frame alloc)

    // --- SIM PASS (the wave height field advances every frame; uMouse set by the caller's poke) ---
    // L90 H1: only when a signed float buffer is available; otherwise uHeight stays the flat-sea texture.
    if (waveOk) {
      const [prev, curr, next] = targets;
      simMaterial.uniforms.uPrev.value = prev.texture;
      simMaterial.uniforms.uCurr.value = curr.texture;
      renderer.setRenderTarget(next);
      renderer.render(simScene, simCamera);
      targets = [curr, next, prev];
      waterMaterial.uniforms.uHeight.value = targets[1].texture;
    }

    // L41: fade out the branded loading screen on the first rendered frame (one-shot). updateWorld runs
    // BEFORE the caller's screen render, so by the 2nd call frame 0 has painted → no flash of dark canvas.
    if (_loaderFrames < 2 && typeof document !== 'undefined') {
      if (++_loaderFrames === 2) {
        const el = document.getElementById('lgr-loader');
        if (el) el.classList.add('gone');
        window.__loaded = true;
      }
    }
  }

  /* STYLE SETTERS the showcase's viewer bar / keyboard drive (office/hoard just use defaults). */
  function setPostMode(n) { mode = n; window.__mode = mode; }
  function toggleVector() { vector = !vector; vectorOn.value = vector ? 1 : 0; window.__vector = vector; return vector; }
  function setVector(v) { vector = !!v; vectorOn.value = vector ? 1 : 0; window.__vector = vector; return vector; }
  function cycleEra() { sceneEra = SCENE_ERAS[(SCENE_ERAS.indexOf(sceneEra) + 1) % SCENE_ERAS.length]; window.__era = sceneEra; applySceneEra(); return sceneEra; }
  function togglePalette() { terminalPalette = !terminalPalette; return terminalPalette; }

  /* The engine HANDLE. Construction + the render-loop API; each PROJECT (city/office/hoard) builds
     its app — scene-mode machine, input, office-dive/hoard wiring, viewer, boot — on top. */
  return {
    // render-loop API (L39): the projects drive these each frame
    updateWorld, decideStyle, renderCityPipeline, renderCityBeautyTo, styleHintName,
    setPostMode, toggleVector, setVector, cycleEra, togglePalette,
    setTonemap: (m) => { const agx = (m === 'agx' || m === 1 || m === true); filmicMaterial.uniforms.uTonemap.value = agx ? 1.0 : 0.0; if (typeof window !== 'undefined') window.__tonemap = agx ? 'agx' : 'aces'; return agx ? 'agx' : 'aces'; },   // L83: ACES↔AgX A/B (beauty)
    get mode() { return mode; }, get vector() { return vector; }, get sceneEra() { return sceneEra; },
    // core
    renderer, drawBuffer, scene, rig, sunRig,
    // water sim
    SIM, targets, simScene, simCamera, simMaterial,
    // refraction + water surface
    grabRT, card, backdrop, WATER_SIZE, water, waterMaterial,
    // city + life + weather
    windowGlow, landmarkFactory, city, cityLife, waterLife, weatherRig, clouds,
    inspector,                                  // L63: the inspection lens (follow/registry over the world)
    world,                                      // L64: procedural terrain world (enter/exit/reroll/setPreset)
    catalog,                                    // L71: the world-editor object catalog (materials/scatter/entities)
    editor,                                     // L74: the world-editor tool dispatcher (active tool + brush + routing)
    pilot,                                      // L76: the pilot controller (possess + drive a placed craft)
    spawnSeizeCraft,                            // L104: guarantee ONE always-visible pilotable craft (the city flyover heli); returns its followable
    get seizeCraft() { return seizeEnt ? seizeEnt.followable : null; },   // L104: the current seize craft's followable (null if none)
    profiler, governor,                         // L78: honest perf (p95/p99/GPU-ms) + adaptive quality
    frameStart, frameEnd, setActive,            // L78: the loop brackets each frame; setActive(false) pauses (hidden tab)
    get paused() { return _paused; }, get contextLost() { return _contextLost; },
    prewarm,                                    // L79: eager shader compile + warm RTT passes (smooth first frame)
    setPilotWaterSampler, setPilotGroundSampler,   // L107: override the pilot's water + ground samplers (city registers the real sea + seabed → the heli dives instead of landing on an invisible floor)
    collider,                                      // L108 (part C): the flight collider — the project exposes it as window.__collide (ghost toggle + depthAt probe)
    fitShadowFrustum, SHADOW_DIST,
    // post chain
    sceneDepth, sceneRT, filmicRT, toonRT, pixelRT, postScene, postCamera, postQuad,
    filmicMaterial, pixelMaterial, pixelkitMaterial, toonMaterial, mixMaterial,
    PALCACHE, ERA_TEX, runPass,
    // fog state (shared by the tick loop, by reference)
    OVERCAST_GREY, FOG_DENSITY, FOG_NIGHT_TINT, _fogColor,
    // lifecycle
    resize,
  };
}
