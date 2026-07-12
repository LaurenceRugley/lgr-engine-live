/* ============================================================
   LGR WebGL Lab — Lesson 37: EXTRACTION E1b-1 — main.js is now a createEngine() CONSUMER
   ------------------------------------------------------------
   For ~30 lessons this file was the god-module: it CONSTRUCTED the whole engine AND ran
   all the behaviour. L37 (E1b-1) lifts the construction into `createEngine()` (see
   src/core/createEngine.js). main.js keeps the BEHAVIOUR — the style state, the
   scene-mode machine, the office-dive, the Hoard game, input, the tick loop, capture +
   the viewer/boot wiring — and reads the engine's handles (`scene`, `rig`, the post
   materials, …) destructured below. This phase is behaviour-IDENTICAL: the same code
   runs in the same order, just split across two files. The behavioural REDESIGN (a
   scene-mode registry, office/hoard through a thin API, an engine.probe object) is the
   second commit (E1b-2).

   The full per-frame pipeline is unchanged:
     SIM PASS    — evolve the height field            (L03)
     GRAB PASS   — behind-water content → uScene      (L05; refracts the city/island)
     BEAUTY PASS — the whole 3D scene → sceneRT       (L06)
     POST CHAIN  — filmic → pixel-art / toon          (L06–L08, zoom-driven L27)

   Keys: 1/2/3 = post mode (raw / filmic / AUTO) · 7/8 = force pixel/toon · P = palette ·
         4/5/6 = camera (perspective orbit / true isometric / dimetric 2:1) · 0 = vector ·
         W weather · K season · G reroll · C city · T/[/]/9 time · B era · O office · X Hoard.
   Mouse: LEFT-drag ripples / clicks a building to dive in · RIGHT-drag orbits · wheel zooms ·
          arrows pan. (Touch: 1 finger ripple/tap, 2 fingers orbit + pinch zoom.)

   C++ anchor: `createEngine()` returns an opaque handle (an engine object); this file is
   the program that drives it. The destructure below is grabbing the handle's members into
   locals — like binding references to a constructed object's public fields before use.
   ============================================================ */
// One three for the whole app — imported from the engine package (see @lgr/engine-core/index.js).
import {
  THREE, createEngine, CAM, PROFILES, PROFILE_KEYS, createCapture, createViewerUI,
  createAppShell, readAppFlags, fromURLParams, createSceneTransition, createDevMode,
  createAudioBus, createAmbientBed, createPositionalField, createRotor,
  createGyroLook,
} from '@lgr/engine-core';
// L114: the loop Timer is now owned by createAppShell (was `const { Timer } = THREE` here); createHints is wrapped by shell.hints.

import { createHoard } from '@lgr/hoard';
import { createOffice } from '@lgr/office';

/* PRESENTATION MODE — `?demo=1` strips all lab branding so the engine can be screen-
   captured for a public/marketing context (captures go out without "LGR" on them):
   the hint bar is hidden and the refraction floor card loses its lettering (a neutral
   seabed). Everything else is identical — every key still works, so captures drive the
   same controls. URLSearchParams reads the query string (?demo=1) the page was opened with. */
const _q = new URLSearchParams(window.location.search);

/* L79 CLIENT-PREVIEW / SHOWCASE MODE — `?preview=<slug>`. A clean, chrome-free, GPU-pre-warmed view that opens on
   a scripted 🛸 hero flythrough → a short guided tour, behind an unlisted-link SOFT GATE. The `<slug>` is a
   CAPABILITY URL: possession of the unguessable string IS the auth (a bearer token — weak but standard for unlisted
   shares; NOT real security, and the guide says so — fine for a sales preview, not for secrets). `?preview=1` opens
   it for our own use. A missing/unknown slug → normal boot (the gate doesn't open). The allowed list is a config
   swap (L80 steel-client content). */
const PREVIEW_SLUGS = ['1', 'steel', 'showcase'];           // soft-gate allow-list ('1' = open-for-us)
const PREVIEW = _q.has('preview') && PREVIEW_SLUGS.includes(_q.get('preview'));
window.__preview = { mode: PREVIEW ? _q.get('preview') : null, gated: _q.has('preview') && !PREVIEW, phase: PREVIEW ? 'boot' : 'off', heroT: 0, tourBeat: -1 };
// `?capture=<seq>` (L15) implies demo mode too: a hands-off recording should carry no branding. Preview is demo-like.
const DEMO = _q.get('demo') === '1' || _q.has('capture') || PREVIEW;
window.__demo = DEMO;               // exposed so a capture harness can confirm the mode

/* L-audio-sketch — `?audio=1|2|3` selects an ambient-bed preset for the listening sketch.
   NEVER in ?preview (audience gate). No ?audio = SILENT (off by default). */
const AUDIO_PRESET = !PREVIEW && _q.has('audio') ? (['1','2','3'].includes(_q.get('audio')) ? Number(_q.get('audio')) : 2) : 0;

/* `?city=<seed>` + `?profile=<name>` pick the starting city. main owns citySeed/profileIndex
   as MUTABLE state (`G` rerolls the seed, `C` cycles the profile) and re-drives city.generate()
   from regenerateCity below; createEngine takes the initial values for its first createCity. */
const params = new URLSearchParams(window.location.search);
let citySeed = (params.get('city') ? Number(params.get('city')) : 0) || ((Math.random() * 1e9) | 0);
let profileIndex = Math.max(0, PROFILE_KEYS.indexOf(params.get('profile') || 'manhattan'));

/* THE "!" STING — the hidden cardboard box's payoff (egg v2). The ENGINE owns noticing (the
   proximity latch in createHiddenProp); this consumer owns REACTING. Same fixed-chip idiom as
   the mute button below: inject a <style> once, append one element, no framework, no audio.
   Hoisted `function` so it can be handed to createEngine on the next line.
   Shown in ?preview too — a harmless delight, and the owner's default. */
function _showEggChip() {
  const style = document.createElement('style');
  style.textContent = '.lgr-egg{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;'
    + 'font:700 64px/1 system-ui,sans-serif;color:#e2564d;text-shadow:0 0 18px rgba(226,86,77,.75);'
    + 'pointer-events:none;}'
    + '@keyframes lgr-egg-sting{0%{opacity:0;transform:translate(-50%,-50%) scale(.4);}'
    + '12%{opacity:1;transform:translate(-50%,-50%) scale(1.15);}'
    + '20%{transform:translate(-50%,-50%) scale(1);}'
    + '80%{opacity:1;}100%{opacity:0;}}'
    + '.lgr-egg--anim{animation:lgr-egg-sting 1.6s ease-out forwards;}'
    // Reduced motion: keep the chip, drop the scale-punch — WCAG 2.3.3 (idiom: the takeover at :560).
    + '@media (prefers-reduced-motion: reduce){.lgr-egg--anim{animation:lgr-egg-sting 1.6s step-end forwards;}}';
  document.head.appendChild(style);

  const chip = document.createElement('div');
  chip.className = 'lgr-egg lgr-egg--anim';
  chip.textContent = '!';
  chip.setAttribute('role', 'status');            // announce it; it is the only feedback (no audio)
  chip.setAttribute('aria-label', 'You found the hidden cardboard box');
  document.body.appendChild(chip);
  // The latch guarantees ONE call, so a one-shot self-cleanup is sufficient — no timer to cancel.
  chip.addEventListener('animationend', () => { chip.remove(); style.remove(); }, { once: true });
  window.__eggFound = true;                        // harness/probe handle (cf. __engine, __world)
}

/* ENGINE BOOTSTRAP — build the renderer/scene/sim/city/post stack and grab the handles.
   Everything below is the consumer: behaviour that reads these handles. */
const engine = createEngine({ demo: DEMO, citySeed, profileIndex, onEggFound: _showEggChip });
window.__engine = engine;   // L114 debug/harness handle (cf. __worldApi) — tools/dive-probe.mjs drives the reset-siting regression guard through it

// L114 app-shell — city is the FULL, blocking adoption (the money path). The shell owns the loop skeleton +
// pause-on-hidden + readiness + footer + resize/visibility wiring; the loop BODY (below) stays 100% city.
//   • flags carries DEMO (which includes PREVIEW) so the shell's footer-hide rule EXACTLY matches city's canonical
//     _hideHint (DEMO || ?ui=0 || ?capture || coarse). readAppFlags is the app-half parse; `_q` stays the SCENE
//     parse (L109's contract — untouched here).
//   • onResize sizes the dive-crossfade RTs + the office camera that engine.resize() doesn't know about (it returns
//     the same drawing-buffer size the shell hands us). city keeps its inline createCapture (poke/verbs are defined
//     deep in the file) + tap-pick (interwoven inline touch) — both deliberately NOT via the shell here.
// I — read lgr_dev_on ONCE here so resolveProfile has it and line 2079 doesn't re-read localStorage.
const _devOnRaw = (() => { try { return localStorage.getItem('lgr_dev_on') === '1'; } catch(e) { return false; } })();
const app = readAppFlags(window.location.search, { devOn: _devOnRaw });
const shell = createAppShell(engine, {
  name: 'city',
  flags: { ...app, demo: DEMO },
  onResize: (db) => {
    cityScreenRT.setSize(db.x, db.y);             // L19 dive crossfade buffers (screen-sized)
    officeScreenRT.setSize(db.x, db.y);
    office.camera.aspect = window.innerWidth / window.innerHeight;   // the office view fills the screen
    office.camera.updateProjectionMatrix();
  },
});
const {
  // construction handles the app still touches directly
  renderer, drawBuffer, scene, rig, sunRig, simMaterial, water, waterMaterial,
  landmarkFactory, city, cityLife, weatherRig, fitShadowFrustum, runPass,
  // the L39 render-loop API (style state + render pipeline now live in the engine)
  updateWorld, decideStyle, renderCityPipeline, renderCityBeautyTo, styleHintName,
  setPostMode, toggleVector, cycleEra, togglePalette,
} = engine;
// L106 (audit a11y): make the WebGL canvas a real keyboard target — focusable + named so seize/fly is reachable
// without a pointer (Enter/Space seize is wired in the keydown handler below). Screen readers now announce the
// scene as an interactive control instead of an opaque canvas.
renderer.domElement.tabIndex = 0;
renderer.domElement.setAttribute('aria-label', 'Interactive 3D city — press F or Enter to fly the craft, W A S D or drag to move and look, click a building to go inside.');
// Style state (engine.mode / engine.vector / engine.sceneEra) is read live via getters where needed.

/* L-audio-sketch — AMBIENT BED (?audio=1|2|3, city bare URL only, NOT ?preview).
   The bus owns the ONE AudioContext. The bed is unlocked + started on the first user gesture
   (canvas pointerdown OR the mute chip click) so the autoplay law is never violated.
   `?preview` stays silent (AUDIO_PRESET = 0 when PREVIEW is true). */

/* L-audio-full-layer-slice1 — per-frame audio tick (positionalField.update + rotor.update).
   Declared at module scope so `frame` (defined below) can call it.
   Assigned inside the if (AUDIO_PRESET) block only when the bus is available. */
let _audioTick = null;

if (AUDIO_PRESET) {
  const _audioBus = createAudioBus();
  if (_audioBus) {
    let _audioUnlocked = false;
    let _audioBed = null;

    /* L-audio-full-layer-slice1: positional field + rotor.
       Both are CREATED here at boot (capturing bus + camera refs) but NOT initialised until
       the user's first gesture — bus.context is null until unlock() is called. */
    const _positionalField = createPositionalField(_audioBus, rig.camera);
    const _rotor = createRotor(_audioBus, _positionalField, {
      // Returns 0 when not piloting — the rotor fades to silence automatically.
      getThrottle:  () => engine.pilot.piloting ? Math.min(1, Math.abs(engine.pilot.speed) / 8) : 0,
      getAltitude:  () => (engine.pilot.telemetry ? engine.pilot.telemetry.altitude : 0),
      getWorldPos:  (v) => { const c = engine.seizeCraft; if (c && c.getWorldPos) c.getWorldPos(v); else v.set(0, 5, 0); },
    });

    function _unlockAudio() {
      if (_audioUnlocked) return;
      _audioUnlocked = true;

      // CRITICAL INIT ORDER (per REFUTE CORRECTION 1):
      // bus.unlock() creates the AudioContext (bus.context goes from null → live).
      _audioBus.unlock();

      // positionalField.init() calls THREE.AudioContext.setContext(bus.context) FIRST,
      // then creates the AudioListener and attaches it to camera.
      // MUST come before new AudioListener() anywhere — including inside _rotor.init().
      _positionalField.init();

      // Proof positional source: looped white-noise at a fixed island-shore position.
      // Demonstrates distance attenuation — loud near the shore, silent from far away.
      // Replaced by a real CC0 ocean/gull clip in slice 2.
      const _ctx = _audioBus.context;
      const _noiseLen = _ctx.sampleRate * 3;   // 3-second loop
      const _noiseBuf = _ctx.createBuffer(1, _noiseLen, _ctx.sampleRate);
      const _nd = _noiseBuf.getChannelData(0);
      for (let i = 0; i < _noiseLen; i++) _nd[i] = Math.random() * 2 - 1;
      // Fade edges to zero so the loop point is click-free.
      const _FADE = 256;
      for (let i = 0; i < _FADE; i++) {
        const f = i / _FADE;
        _nd[i]               *= f;
        _nd[_noiseLen - 1 - i] *= f;
      }
      _positionalField.add({
        getPos:      (v) => v.set(8, 0.5, 8),  // island shore corner — fixed world position
        buffer:      _noiseBuf,
        refDistance: 5,
        maxDistance: 35,
        loop:        true,
        gain:        0.04,   // whisper-level: proves spatial attenuation without adding hiss
      });

      // Rotor init AFTER positionalField.init() so getListener() is non-null.
      _rotor.init();

      // Ambient bed — unchanged from the L-audio-sketch, started last.
      _audioBed = createAmbientBed(_audioBus, { preset: AUDIO_PRESET });
      _audioBed.start();
      if (_muteChip) _updateMuteChip();
    }

    /* Mute chip — simple fixed-position button. Top-right so it doesn't overlap the bottom chips. */
    let _muteChip = null;
    function _updateMuteChip() {
      if (!_muteChip) return;
      const muted = _audioBus.muted;
      _muteChip.textContent = muted ? '🔇' : '🔊';
      _muteChip.setAttribute('aria-label', muted ? 'Unmute ambient sound' : 'Mute ambient sound');
      _muteChip.setAttribute('aria-pressed', String(!muted));
    }

    const _style = document.createElement('style');
    _style.textContent = '.lgr-mute{position:fixed;top:14px;right:14px;z-index:10;width:40px;height:40px;'
      + 'border-radius:50%;background:rgba(27,29,36,.72);border:1.5px solid rgba(232,180,106,.35);'
      + 'color:#e8c069;font-size:18px;cursor:pointer;display:grid;place-items:center;backdrop-filter:blur(6px);}'
      + '.lgr-mute:hover{border-color:rgba(232,180,106,.65);}'
      + '.lgr-mute:focus-visible{outline:2px solid #e8c069;outline-offset:3px;}'
      + '.lgr-vol{position:fixed;top:26px;right:58px;z-index:10;width:72px;accent-color:#e8c069;cursor:pointer;}';
    document.head.appendChild(_style);
    _muteChip = document.createElement('button');
    _muteChip.className = 'lgr-mute'; _muteChip.type = 'button';
    _muteChip.textContent = '🔊'; _muteChip.setAttribute('aria-label', 'Mute ambient sound');
    _muteChip.setAttribute('aria-pressed', 'false');
    _muteChip.addEventListener('click', () => {
      _unlockAudio();                   // gesture: create ctx + start bed (idempotent)
      _audioBus.setMuted(!_audioBus.muted);
      _updateMuteChip();
    });
    document.body.appendChild(_muteChip);
    const _volSlider = document.createElement('input');
    _volSlider.type = 'range'; _volSlider.className = 'lgr-vol';
    _volSlider.min = '0'; _volSlider.max = '1'; _volSlider.step = '0.01'; _volSlider.value = '1';
    _volSlider.setAttribute('aria-label', 'Volume');
    _volSlider.addEventListener('input', () => { _unlockAudio(); _audioBus.setMasterGain(Number(_volSlider.value)); });
    document.body.appendChild(_volSlider);

    /* First canvas interaction also unlocks (pointerdown fires for both mouse + touch). */
    renderer.domElement.addEventListener('pointerdown', _unlockAudio, { once: true });

    /* L-audio-full-layer-slice1 — per-frame tick: update spatial positions + rotor gain. */
    _audioTick = (dt) => {
      if (!_audioUnlocked) return;
      _positionalField.update();
      _rotor.update(dt);
    };
  }
}

// Re-generate the city (G reroll / C profile) → rebuild + retint the flat-cyan water + refit the
// shadow frustum + refresh the hint. The landmark factory fills heroes in once its GLBs are loaded.
function regenerateCity() {
  city.generate(citySeed, profileIndex);
  waterMaterial.uniforms.uVecWater.value.set(city.waterColor);
  cityLife.setProfile(city.state.profile);   // L24: retint the street centre-lines for the new profile
  fitShadowFrustum();
  cityHint();
  // L34: the city rebuilt → its meshes are NEW; if we're mid-Hoard (e.g. the async landmark-ready
  // regen right after a ?hoard=1 boot), re-open the base plaza on the fresh buildings.
  if (sceneMode === 'hoard') { restorePlaza(); clearPlaza(PLAZA_R); }
}
landmarkFactory.whenReady.then(() => { regenerateCity(); shell.ready(); });   // L114: shell.ready() = __appReady (+ __cityReady alias)
waterMaterial.uniforms.uVecWater.value.set(city.waterColor);

/* 7g) SEASONS (L18, light) — ONE scalar 0 spring → 1 winter; `K` steps through four stops. Phase 1
   only recolours tree leaves (green→autumn→bare, via the season uniform the leaf shaders read). We
   ease the shared uniform toward the stop each frame so the colour change glides, not snaps. */
const SEASON_STOPS = [0.0, 0.33, 0.66, 1.0];   // spring · summer · autumn · winter
let seasonStep = 0;
window.__season = SEASON_STOPS[seasonStep];

/* 7e) SUN SHADOW toggle (L16) — `H` flips it; the per-frame strength fades with the sun in tick. */
let shadowsOn = true;
window.__shadows = shadowsOn;

/* ============================================================
   13b) THE OFFICE-DIVE (Lesson 19, Phase A) — click a building → fly into its window →
   resolve inside a warm office, the LIVING city behind the glass.
   It's mostly ASSEMBLY of what the engine already owns:
     • render-to-texture (the FBO lineage: water → post → capture → now the window-city)
     • the L08 fullscreen-quad compositor (for the dive crossfade)
     • raycast picking (the water-poke, re-pointed at buildings)
     • the whole live city (SunRig + weather + agents) rendered into the office window
   (Stays in main.js this phase; E1b-2 moves it behind engine.registerMode('office', …).)
   ============================================================ */
const office = createOffice({ tier: 'corner' });
office.camera.aspect = window.innerWidth / window.innerHeight;
office.camera.updateProjectionMatrix();

/* The WINDOW camera: a separate perspective lens that frames the skyline as seen from a high
   office window — a near-horizontal look across the city so the towers stand up against the
   sky. We render the REAL city scene through THIS camera into a texture each frame; the office
   maps that texture onto its corner glass. (Its own camera, so the window view is independent
   of wherever the city camera/rig happens to be.) */
const windowCam = new THREE.PerspectiveCamera(55, 1.4, 0.1, 100);
windowCam.position.set(2.2, 3.4, 11.5);
windowCam.lookAt(0, 2.0, 0);

/* cityWindowRT — the live skyline texture for the glass. L40 WIN B: dropped 1024×720 → 640×448 (it's a
   small window seen through glass, not the screen; fill cost ≈ w×h, so ~2.6× cheaper) — the skyline still
   reads sharply behind the panes. The glass city is also re-rendered only every WIN_EVERY frames (below). */
const cityWindowRT = new THREE.WebGLRenderTarget(640, 448, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false,
});
office.setCityTexture(cityWindowRT.texture);
// L54 FIX: the office boots into the L50 STRAIGHT-ON hero layout (its single flat pane, glassMatS, is the
// visible one — the corner panes are hidden). setCityTexture only feeds the hidden corner panes, so the
// straight pane's map stayed null → MeshBasic('#ffffff') rendered PURE WHITE in the dive. The standalone
// /office/ page wires setStraightCityTexture; the city dive (this file) was left on the old single-camera
// wiring when L49b added the straight layout. Our single `windowCam` already renders a straight-on view,
// so it maps 1:1 onto the single flat pane. (C++: a renderer whose output buffer was never bound to the
// consumer's sampler — it reads the texture's clear/default, here white, like an uninitialised read.)
office.setStraightCityTexture(cityWindowRT.texture);
let _winFrame = 0;                  // L40 WIN B: throttle the glass-city re-render (it's a background)
const WIN_EVERY = 3;

/* L23 — vignetteRT: the basement's "dynamic picture". The office owns a tiny self-contained
   vignette scene (its OWN day/night); we render it into THIS small target each frame the basement
   fitout is showing, and the office maps it onto the framed picture (setVignetteTexture). SAME RTT
   machinery as the city window — render a scene into a texture, hang it on the wall. Small (it's a
   framed picture, not the screen) and depth-buffered (its sun/hills/tree depth-sort). */
const vignetteRT = new THREE.WebGLRenderTarget(512, 320, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false,
});
office.setVignetteTexture(vignetteRT.texture);

/* Dive crossfade buffers: during the ~1s transition we render the city to one screen-sized
   target and the office to another, then post-dive.frag zoom-blends them. Outside the
   transition only ONE scene renders straight to the screen — this double work is dive-only. */
let cityScreenRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
});
let officeScreenRT = new THREE.WebGLRenderTarget(drawBuffer.x, drawBuffer.y, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false, stencilBuffer: false,
});
/* L60 — the dive is now a REUSABLE engine-core SCENE TRANSITION (createSceneTransition): it owns the eased
   progress + the a→in→b→out→a state machine + the crossfade/focus material. CITY = source A, OFFICE = source
   B. We still own the two screen-sized targets (they resize with the canvas) and hand their textures in once;
   the module's material presents the mix during a dive. Same rate (4.6) + shader → byte-identical feel. */
const dive = createSceneTransition({ rate: 4.6 });
dive.setSources(cityScreenRT.texture, officeScreenRT.texture);

/* SCENE-MODE STATE MACHINE — which world we draw this frame. The city↔office states are DERIVED from the
   dive module's mode (mapped below); 'hoard' is the app's own separate (instant) mode, not a dive.
   'city' → the engine as it was. 'diving-in' → city push-in crossfading to office.
   'office' → the room (live city in the glass). 'diving-out' → the reverse, back to the city. */
const MODE_MAP = { a: 'city', in: 'diving-in', b: 'office', out: 'diving-out' };
let sceneMode = 'city';
window.__scene = sceneMode;
let viewerUI = null;                            // L20: the tap bar handle (assigned at boot); M toggles it
let _lookHintShown = false;            // L55: show the "drag to look around" coach once per session

/* L63 INSPECT MODE — a CITY sub-mode: free-fly + click-to-follow any world object via the engine's
   inspection lens (`engine.inspector`). Forces perspective; while it's on, a click FOLLOWS the nearest
   entity (instead of diving into a building), left-drag orbits around it, WASD flies, Tab cycles, Esc
   releases (or exits the mode). Engine owns the registry + the damped follow; main owns the input. */
let inspecting = false;
window.__inspect = false;
const _inspScratch = new THREE.Vector3();        // L63: scratch for the per-frame follow-pos probe
if (typeof window !== 'undefined') window.__inspector = engine.inspector;   // debug/harness handle (like __office / __hoardApi)

/* L64 WORLD MODE — a CITY sub-mode that swaps the urban scene for a generated procedural terrain world
   (engine.world, built in engine-core). Forces perspective so you can fly it (drag/arrows/inspect-lens
   explore it); SunRig day/night + weather + clouds keep running OVER the terrain. 🎲 reroll + biome
   presets live on the bar. Like `inspecting`, it's a visibility toggle — the render path is unchanged
   (the scene renders through the same post chain; only what's visible in it swaps). */
let worldMode = false;
window.__worldMode = false;
if (typeof window !== 'undefined') window.__worldApi = engine.world;   // debug/harness handle

// L107 (heli-water-lift GATE fix) — teach the pilot's medium probe about the CITY sea. In city mode the built world
// is flat (worldHeightAt→0), so the default sampler reported NO water and a descending heli "landed on an invisible
// floor" at the waterline (descend dead). Register a sampler that returns the sea (y=0) over OPEN water (outside the
// coastline), else null to DEFER to the engine default. (Refinement over the spec: gate on !worldMode + return null
// so world-mode's own sea + office are untouched — the spec's plain sceneMode check would have clobbered them.)
const _isCityBay = (x, z) => sceneMode === 'city' && !worldMode && !city.isLand(x, z);   // open water outside the coastline
engine.setPilotWaterSampler((x, z) => _isCityBay(x, z) ? 0 : null);                  // sea SURFACE at y=0 over the bay
// L108 (collision part C): over city LAND the craft now settles on the STREET (y ≥ 0.3 = PLINTH_TOP, the island top),
// not the flat y=0 that let it sink 0.3 into the island. Over the BAY it still dives to the seabed (-2.4). World/office
// defer to the default (null). This is the pilot-scoped ground (never worldHeightAt → the ambient heli/attract unmoved).
engine.setPilotGroundSampler((x, z) => _isCityBay(x, z) ? -2.4 : (sceneMode === 'city' && !worldMode ? 0.3 : null));
function toggleWorld() {
  if (sceneMode !== 'city') return;                   // only from the open city view
  endAttract();                                       // L110 (audit P0-2): leaving the city ends the boot attract-loop — else the heli camera-follow, the coach chip, and the canvas seize-intercept leak into the wrong mode
  worldMode = !worldMode;
  if (worldMode) {
    engine.world.enter(); rig.setMode(CAM.PERSPECTIVE); window.__camMode = rig.mode;
    // L104 — guarantee a pilotable craft in the FREE-ROAM world too: the all-medium SAUCER (flies + dives the sea),
    // placed near the world centre, IF the player hasn't already placed one. (The city's craft is the heli; the
    // world's is the saucer — flyPossess picks the scene-appropriate one.)
    if (!pilotables().some((f) => f !== engine.seizeCraft)) engine.world.placeEntity('craft', 0, 0);
  } else { if (piloting) releasePilot(); if (sculpting) toggleSculpt(); engine.world.exit(); }   // L76: leaving the world drops the pilot
  window.__worldMode = worldMode;
  if (viewerUI) viewerUI.refresh();
}

/* L69 TERRAIN SCULPT — a world sub-mode: the pointer raycasts the terrain and a Gaussian brush raises
   (drag) / lowers (Shift-drag or right-drag) the heightfield; the touched chunks rebuild live + the water
   re-pools (engine.world.sculpt). A brush RING decal shows size+position; the wheel sizes the brush. Only
   inside world mode; orbit still works (right-drag lowers, so orbit moves to... we keep orbit on right-drag
   but Shift-left = lower to avoid the clash). */
let sculpting = false, sculptStroke = 0;   // L74: edit-mode on/off + the active stroke direction (per-gesture state)
// L74 — the editor STATE + tool ROUTING were LIFTED into engine-core (`engine.editor`, the createEditor consolidation).
// `sculpting` = the ✎ Edit brush is active; `engine.editor` now owns the active TOOL, the ONE shared brush
// (radius/strength/density/drop-count + direction), the per-tool SELECTION (material/scatter/entity), and the
// apply-ROUTING (→ world.{sculpt,paintBiome,paintScatter,placeEntity}). This project keeps only the raw input
// plumbing below (raycast + ring decal + pointer handlers) and forwards to `editor.applyAt`/`beginStroke`/`pickAt`.
const editor = engine.editor;
window.__sculpt = false;
const refreshUI = () => { if (viewerUI) viewerUI.refresh(); };
// thin wrappers the viewer UI / boot call (delegate to the editor + refresh the chip bar).
function setEditTool(t) { editor.setTool(t); refreshUI(); }
function toggleSculptDir() { editor.toggleDir(); refreshUI(); }

/* L75 SAVE / LOAD — persist the authored world. The ENGINE owns serialize/deserialize (pure data); the PROJECT
   wires the three transports: localStorage named SLOTS (quick, same-device), a JSON FILE export/import (portable,
   lossless, the universal path), and a best-effort ?world= LINK (compact, size-guarded). Mirrors the ?city=/?world=1
   boot handling. C++: the engine fwrites/freads the buffer; the app picks the sink (a keyed store, a file, a URL). */
const SLOT_PREFIX = 'lgr-world:';
let lastStatus = '';
const setStatus = (m) => { lastStatus = m; refreshUI(); };
// L110 (audit P0-7): merely TOUCHING window.localStorage throws SecurityError when storage is blocked (Chrome
// "block all cookies", a sandboxed iframe without allow-same-origin, some private modes). listWorlds() runs at
// module-eval time (viewerState → createViewerUI's synchronous refresh(), BEFORE tick()), so an unguarded throw here
// wedges the WHOLE city boot — a blank canvas for that visitor. Guard every localStorage touch (matches hints.js:63 /
// dev-mode.js:67 / setDev — the rest of the codebase already guards this exact hazard; this was a convention fork).
function listWorlds() { try { return Object.keys(localStorage).filter((k) => k.startsWith(SLOT_PREFIX)).map((k) => k.slice(SLOT_PREFIX.length)).sort(); } catch (e) { return []; } }
function saveWorld(name) {
  const blob = engine.world.serialize(); if (!blob || !name) { setStatus('Nothing to save'); return false; }
  try { localStorage.setItem(SLOT_PREFIX + name, JSON.stringify(blob)); setStatus(`Saved “${name}”`); return true; }
  catch (e) { setStatus('Save failed (storage full?)'); return false; }
}
function loadWorld(name) {
  let s = null; try { s = localStorage.getItem(SLOT_PREFIX + name); } catch (e) { setStatus('Saves unavailable (storage blocked)'); return false; }
  if (!s) { setStatus(`No save “${name}”`); return false; }
  try { const ok = engine.world.deserialize(JSON.parse(s)); syncWorldUI(); setStatus(ok ? `Loaded “${name}”` : 'Load failed'); return ok; }
  catch (e) { setStatus('Load failed (corrupt?)'); return false; }
}
function deleteWorld(name) { try { localStorage.removeItem(SLOT_PREFIX + name); setStatus(`Deleted “${name}”`); } catch (e) { setStatus('Saves unavailable (storage blocked)'); } }
function exportWorld(name) {
  const blob = engine.world.serialize(); if (!blob) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(blob)], { type: 'application/json' }));
  a.download = `world-${name || 'export'}.json`; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000); setStatus('Exported JSON');
}
function importWorld(file) {
  if (!file) return; const r = new FileReader();
  r.onload = () => { try { const ok = engine.world.deserialize(JSON.parse(r.result)); syncWorldUI(); setStatus(ok ? 'Imported world' : 'Import failed'); } catch (e) { setStatus('Import failed (bad file)'); } };
  r.readAsText(file);
}
function shareLink() {
  const compact = engine.world.serializeCompact(); if (!compact) { setStatus('No world'); return; }
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(compact))));
  if (enc.length > 6144) { setStatus('Too detailed to share — use Export'); return; }   // size guard (~6 KB)
  const url = `${location.origin}${location.pathname}?world=${enc}`;
  if (navigator.clipboard) navigator.clipboard.writeText(url).then(() => setStatus(`Link copied (${enc.length} B)`)).catch(() => setStatus('Link ready (copy from address bar)'));
  else setStatus('Link ready');
  return url;
}
// after a load/import the city's own world flags + UI must follow the engine (it entered world mode on deserialize).
function syncWorldUI() { worldMode = engine.world.active; if (!sculpting && worldMode) { /* keep editor state */ } if (viewerUI) viewerUI.refresh(); }
if (typeof window !== 'undefined') {
  window.__sculptApi = { toggle: () => toggleSculpt(), dir: () => toggleSculptDir(), undo: () => editor.undo(), reset: () => engine.world.reset(), get on() { return sculpting; }, get radius() { return editor.brush.radius; }, get raise() { return editor.raise; } };   // debug/harness handle
  window.__catalog = { ids: () => engine.catalog.all().map((e) => e.id), byKind: (k) => engine.catalog.byKind(k).map((e) => e.id), get: (id) => engine.catalog.get(id), setArt: (id, a) => engine.catalog.setArt(id, a), size: () => engine.catalog.size };
  // L72/L73/L74 — the headless editor seam, now backed by engine.editor (state lifted; SAME shape so the verifiers keep working).
  // L81 — the live water-flow seam (headless verification of pour → flow → pool + dig-a-channel).
  window.__flow = {
    get total() { return engine.world.flowTotal; }, at: (wx, wz) => engine.world.flowAt(wx, wz),
    pourAt: (wx, wz, amount, radius) => engine.world.flowPourAt(wx, wz, amount, radius),
    rain: (a) => engine.world.flowRain(a), clear: () => engine.world.flowClear(),
    // L82 erosion: toggle/strength + a terrain-height probe (verify the carve) + a sediment-total stability probe.
    setErosion: (on, k) => engine.world.flowErosion(on, k), get erosion() { return engine.world.flowErosionOn; },
    get sediment() { return engine.world.flowSediment; }, heightAt: (wx, wz) => engine.world.heightAt(wx, wz),
    // L87: selectable sim backend (cpu = default + oracle; gpu = the new GPGPU backend once wired + parity-proven).
    setBackend: (b) => engine.world.setSimBackend(b), get backend() { return engine.world.simBackend; },
    readW: () => engine.world._flowReadW(), readTerr: () => engine.world._flowReadTerr(),   // L87 test-only: full W + terrain fields (parity harness)
    stepN: (n, dt) => engine.world._flowStepN(n, dt),   // L87 test-only: deterministic fixed-dt step burst (parity harness)
  };
  window.__editor = {
    get mode() { return sculpting; }, get tool() { return editor.tool; },
    get material() { return editor.material; }, get scatterType() { return editor.scatterType; }, get entity() { return editor.entity; },
    get counts() { return engine.world.scatterCounts; }, get placed() { return engine.world.placedCounts; }, get dropN() { return editor.brush.dropN; },
    setTool: (t) => setEditTool(t), setMaterial: (i) => { editor.setMaterial(i); refreshUI(); }, setScatter: (k) => { editor.setScatter(k); refreshUI(); }, setEntity: (k) => { editor.setEntity(k); refreshUI(); }, setDropN: (n) => { editor.setDropN(n); refreshUI(); }, toggle: () => toggleSculpt(),
    sculptAt: (wx, wz, dir) => engine.world.sculpt(wx, wz, dir || 1, editor.brush.radius, editor.brush.strength),   // L75 headless sculpt
    paintAt: (wx, wz) => engine.world.paintBiome(wx, wz, editor.material, editor.brush.radius),
    scatterAt: (wx, wz) => engine.world.paintScatter(wx, wz, { type: editor.scatterType, density: editor.brush.density, radius: editor.brush.radius, erase: false }),
    eraseAt: (wx, wz) => engine.world.paintScatter(wx, wz, { type: editor.scatterType, radius: editor.brush.radius, erase: true }),
    placeAt: (wx, wz) => engine.world.placeEntity(editor.entity, wx, wz), dropAt: (wx, wz, n) => editor.dropEntities(wx, wz, n || editor.brush.dropN), removeAt: (wx, wz) => engine.world.removeEntityNear(wx, wz, editor.brush.radius), heightAt: (wx, wz) => engine.world.heightAt(wx, wz),
    snapshot: () => editor.snapshot(), undo: () => editor.undo(), hideScatter: () => editor.toggleHideScatter(),
    // L75 save/load probes (headless round-trip verification)
    serialize: () => engine.world.serialize(), serializeCompact: () => engine.world.serializeCompact(), deserialize: (o) => engine.world.deserialize(o) };
}
/* ============================================================
   L76 PILOT / FREE-ROAM — possess a placed craft (the ATV) and DRIVE it over the terrain.
   ------------------------------------------------------------
   The ENGINE owns possession (engine.pilot — the state machine + the ground MovementModel + the chase
   cam); this project wires only the three thin things a project must: (1) INPUT → a device-independent
   AXIS BUNDLE {throttle, steer} the model reads (keyboard + on-screen touch share one held-key set, so
   both fill the same axes); (2) the POSSESS TRIGGER — "drive" the entity you're inspecting; (3) a MINIMAL
   HUD (speed + the always-there Exit cue). ONE camera owner: possessing releases the inspector's follow
   first, so the pilot and the inspector never both drive rig.setFollow (the brief's pause-point). */
let piloting = false;                                  // does the pilot own input + the camera this frame?
window.__piloting = false;
let pilotLooking = false;                              // L-cockpit: right-drag look-around is active (bypasses the piloting early-return)
let cockpitTouchId = null;                             // VIZ MOBILE: active touch identifier for cockpit one-finger look (null = not active)
const pilotAxes = { throttle: 0, steer: 0, lift: 0 };   // the axis bundle (a POD struct the model reads; L77 + lift)
const heldPilot = new Set();                           // tokens currently held (keyboard ∪ touch d-pad) → axes
let stickThrottle = 0, stickSteer = 0;                 // L104 P2: ANALOG axes from the floating thumbstick (touch) — compose with the keys/lift
function recomputeAxes() {                             // derive the bundle from the held set + the analog stick (both fill the same axes)
  const h = (t) => heldPilot.has(t);
  pilotAxes.throttle = stickThrottle || ((h('up') ? 1 : 0) + (h('down') ? -1 : 0));   // analog stick wins when active, else the digital keys/d-pad
  pilotAxes.steer = stickSteer || ((h('right') ? 1 : 0) + (h('left') ? -1 : 0));
  pilotAxes.lift = (h('rise') ? 1 : 0) + (h('fall') ? -1 : 0);   // L77: vertical (climb/dive buttons + Space/Shift; the ground ATV ignores it)
}
function pilotHold(tok, on) { if (on) heldPilot.add(tok); else heldPilot.delete(tok); recomputeAxes(); }
// L77: Space = climb, Shift = descend (the universal flight verbs) — added alongside the L76 throttle/steer keys.
const PILOT_KEY = { w: 'up', s: 'down', a: 'left', d: 'right', ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', ' ': 'rise', Shift: 'fall' };

const pilotables = () => engine.world.placedLife.getFollowables().filter((f) => f.pilot);   // placed pilotable craft
// CANONICAL possess: hand the camera from inspector → pilot (one owner), set the flags, refresh the HUD.
function doPossess(f) {
  // L104: relaxed the worldMode gate (was `|| !worldMode`) so FLY possesses the seize craft in the CITY skyline too
  // (the pilot's world heightAt→0 there = a flat city ground). Craft EXISTENCE is the real gate; office/hoard have none.
  if (!f || !f.pilot) return false;
  if (engine.inspector.focus) engine.inspector.release();   // drop the inspect follow BEFORE the pilot takes rig.setFollow
  rig.setMode(CAM.PERSPECTIVE); window.__camMode = rig.mode; // L110 (audit B12): a chase cam IS a perspective view — switch BEFORE possess so it never drives setElevation() while an ISO/DIMETRIC pitch is locked (which corrupted the canonical iso angle). Matches startAttract. No-op if already perspective.
  if (!engine.pilot.possess(f)) return false;
  piloting = true; window.__piloting = true; heldPilot.clear(); recomputeAxes();
  renderer.domElement.style.cursor = 'default';
  refreshPilotHUD();
  // L104 a11y (WCAG 4.1.3): announce the takeover + the controls on the shared .vui-live region (the d-pad is
  // visual-only; a screen-reader pilot needs to hear how to fly).
  // L110 (audit B13): touch users have no keyboard — announce the on-screen controls (thumbstick + Climb/Descend + ✕), not WASD.
  if (viewerUI) viewerUI.announce(coarse
    ? `Now piloting ${f.label || 'the craft'}. Drag the lower-left of the screen to steer, use the Climb and Descend buttons, tap the ✕ to exit.`
    : `Now piloting ${f.label || 'the craft'}. Arrow keys or W A S D to fly, Space to climb, Shift to dive, Escape to exit.`);
  // L107 (2nd ask) — a one-time VISIBLE climb/dive key prompt on the first DESKTOP possess. The keys are bound + spoken
  // once + shown on button hover, but that's quiet; a brief toast makes the vertical controls discoverable (esp. now
  // you can dive the bay). Desktop only — touch has no keys (the touch announce above already omits them). Auto-dismisses.
  if (!coarse && !_climbHintShown) { _climbHintShown = true; officeUI.toast('⤒ Space climb  ·  ⤓ Shift dive'); }
  return true;
}
let _climbHintShown = false;   // L107: the one-time desktop climb/dive prompt fires on the first possess
function tryPossess() { return doPossess(engine.inspector.focus); }   // "drive" the thing you're following
// L104 — the FLY action: deterministically possess the AIR craft (the `spacecraft` model — heli or saucer), NEVER the
// ground ATV (which ignores climb/dive). Picks from the live pilotables; the seize heli over the city is one. (P1.1
// seam: the air-craft pick is a one-liner over the engine's pilotables; Phase 2's verb bar will call this.)
function flyPossess() {
  // L110 (audit B13): remember if the keyboard focus was on the FLY chip or the canvas — the chip HIDES itself on
  // possess (refreshFlyChip), which would drop focus to <body>. We re-home it onto the pilot Exit button below.
  const _fromFocus = document.activeElement === _flyChip || document.activeElement === renderer.domElement;
  endAttract();                              // L104 P2: taking the craft ends the attract-loop (no double camera owner)
  const seize = engine.seizeCraft;
  const air = pilotables().filter((f) => f.pilot && f.pilot.model === 'spacecraft');
  // CITY → the seize heli; WORLD/preview → a world-placed air craft (skip the city heli, which is hidden in the world).
  const pick = worldMode ? air.find((f) => f !== seize) : ((seize && seize.pilot && seize.pilot.model === 'spacecraft') ? seize : air[0]);
  const ok = pick ? doPossess(pick) : false;
  if (ok) {
    takeoverMorph(); if (_cityHints) _cityHints.dismiss(false);   // item 6 morph; item-8 fix: drop the first-run hints so they don't overlap the pilot stick
    if (_fromFocus) { const x = document.querySelector('.pilot-exit'); if (x) x.focus(); }   // L110 (audit B13): hand keyboard focus to the pilot Exit so it isn't dropped when the chip hides
  }
  return ok;
}
let _cityHints = null;                        // the first-run coachmark handle (assigned at boot) — dismissed on seize

// L104 Phase 2 (item 6) — the TAKEOVER MORPH: the engine's REAL post tiers pulse beauty→toon→pixel→beauty (~330ms) the
// instant you seize the craft — the unforgeable engine signature (a competitor copies a gold ring, not beauty→toon→pixel).
// It drives the ACTUAL post pipeline (setPostMode), NOT a CSS fake, then restores your prior tier (resolves to beauty by
// default). `prefers-reduced-motion` → SKIP (no stylize flicker; the takeover just happens in beauty). 3D scene untouched.
let _morphTimers = [];
const BEAUTY_TIER = 2;                        // filmic beauty (ACES + grade) — the premium pilot view the takeover resolves to
function takeoverMorph() {
  _morphTimers.forEach(clearTimeout); _morphTimers = [];
  // The narrative beat: the stylized attract-loop city RESOLVES TO CINEMATIC BEAUTY as you seize control.
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setPostMode(BEAUTY_TIER); return; }   // reduced-motion → straight to beauty (no toon/pixel frames)
  setPostMode(BEAUTY_TIER);                                            // beauty (start)
  _morphTimers.push(setTimeout(() => setPostMode(8), 110));            // → toon
  _morphTimers.push(setTimeout(() => setPostMode(7), 220));            // → pixel
  _morphTimers.push(setTimeout(() => setPostMode(BEAUTY_TIER), 330));  // → beauty (resolves; premium floor)
}

// L104 Phase 2 (item 5) — the ATTRACT-LOOP: the city opens FRAMED on the helicopter flying over the skyline (the
// "seize the flight" hook). Interruptible from frame 1: a canvas touch/click OR F seizes the in-motion craft (state
// handoff at its current transform — no respawn, no gate); the heli flies its own ambient circle (placed-life). A
// scroll/zoom just drops to free control. DESIGN's frame-the-craft-on-load note.
let attractActive = false;
const _reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
function startAttract() {
  const heli = engine.seizeCraft; if (!heli || !heli.getWorldPos) return;
  attractActive = true;
  rig.setMode(CAM.PERSPECTIVE); window.__camMode = rig.mode;
  rig.setFollow((o) => heli.getWorldPos(o), { frame: 15, snap: true });   // auto-frame the craft (perspective dolly)
  rig.setElevation(0.52);                                                  // look DOWN past the heli to the skyline below
  // L104 (DESIGN review finding) — open the demo at GOLDEN HOUR, not noon. The seize→photoreal beat resolves to Realistic,
  // which washes pale-blue + low-contrast at noon (the L100 midday-cut is strongest then); at a low golden sun the cut fades
  // to ~zero and Realistic shines. A flattering default for the prospect view; explicit ?t=/?time= links still win.
  // L107 investigation (measured): t=0.30 sits in a narrow Preetham TROUGH where the sky is bright but DESATURATED (gray
  // wash, skySat ~34) — NOT the god rays or bloom (both isolation-ruled-out); the sky only gains warm colour by ~t=0.34
  // (skySat ~60→70). So the "golden" open was landing GRAY. Nudged to 0.34 → the first frame is actually warm/golden, as
  // L104 intended. (A deeper low-sun overexposure/low-contrast remains — flagged for DESIGN's lighting pass.)
  if (!_q.has('t') && !_q.has('time')) sunRig.goTo(0.34);
  showCoach();                                                            // L104 P2 item 8 — the contextual coach (dismiss-by-doing)
  // narrated path (.vui-live) — and under reduced-motion the slow auto-orbit is GATED in the tick (render-layer, not just CSS).
  if (viewerUI) viewerUI.announce((coarse ? 'A helicopter is flying over the city. Tap the scene to take control'
    : 'A helicopter is flying over the city. Press F to take control') + (_reduceMotion ? '. Motion is reduced; the camera is held still.' : '.'));
  if (typeof window !== 'undefined') window.__attract = true;
}
function endAttract() {
  if (!attractActive) return;
  attractActive = false; rig.clearFollow(); hideCoach();
  if (typeof window !== 'undefined') window.__attract = false;
}
function seizeFromAttract() { if (attractActive) { flyPossess(); } }   // touch/click during attract → seize (flyPossess ends attract)

// L104 P2 item 8 — the CONTEXTUAL COACH: a tethered whisper ("…to fly") that fades in during the attract-loop and
// self-dismisses the instant the user does ANY verb (seize/input). A visible WORD label (not a lone ⓘ), on touch AND
// desktop. aria-hidden because the startAttract `.vui-live` announce is its AT-equivalent (avoids double-speaking).
let _coachEl = null;
function ensureCoach() {
  if (_coachEl) return _coachEl;
  const s = document.createElement('style');
  s.textContent = '.lgr-coach{position:fixed;left:50%;bottom:16%;transform:translateX(-50%);z-index:7;padding:11px 20px;'
    + 'border-radius:999px;background:rgba(16,18,24,.78);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);'
    + 'color:#f0e6d4;font:600 14px/1 ui-monospace,monospace;letter-spacing:.04em;border:1px solid rgba(184,153,104,.5);'
    + 'pointer-events:none;opacity:0;transition:opacity .5s ease;box-shadow:0 6px 24px rgba(0,0,0,.45);white-space:nowrap;}'
    + '.lgr-coach.on{opacity:1;} .lgr-coach .k{color:#e8c069;}'
    + '@media (prefers-reduced-motion:reduce){.lgr-coach{transition:none;}}';
  document.head.appendChild(s);
  _coachEl = document.createElement('div'); _coachEl.className = 'lgr-coach'; _coachEl.setAttribute('aria-hidden', 'true');
  document.body.appendChild(_coachEl);
  return _coachEl;
}
function showCoach() {
  const el = ensureCoach();
  el.innerHTML = coarse ? 'Tap to fly the helicopter' : 'Click or press <span class="k">F</span> to fly';
  if (_reduceMotion) el.classList.add('on'); else requestAnimationFrame(() => el.classList.add('on'));
}
function hideCoach() { if (_coachEl) _coachEl.classList.remove('on'); }

// L106 + L110 (HOTFIX) — a bottom-center ROW of PERSISTENT, audience-safe DEMO chips (gold, real <button>s → keyboard +
// AT + 44px + :focus-visible). Standalone (not hidden by body.preview) → they work on the bare URL AND in ?preview. The
// flex row keeps the visible ones centered so they never overlap; each toggles its OWN visibility every frame (refreshChips
// runs from refreshPilotHUD in the tick):
//   🚁 FLY  — re-seize the craft (the coach covers the attract-loop; the chip covers "flight after you exit"). Not piloting.
//   🌅 TIME — cycle dawn→noon→dusk→night via sunRig.goTo (DAMPED — the sun POURS to the new time; that mid-flight morph IS
//             the showcase), shown whenever the city scene is active INCLUDING while piloting. Starts from the current ?t=.
//   🏙 CITY — reroll the procedural city (next profile + fresh seed) — "every city is generated" made tappable. Not piloting.
let _chipRow = null, _flyChip = null, _timeChip = null, _cityChip = null;
function ensureChips() {
  if (_chipRow) return;
  const s = document.createElement('style');
  s.textContent = '.lgr-chips{position:fixed;left:50%;bottom:58px;transform:translateX(-50%);z-index:7;display:flex;'
    + 'gap:10px;align-items:center;pointer-events:none;max-width:96vw;flex-wrap:wrap;justify-content:center;}'
    + '.lgr-chip{display:none;align-items:center;gap:7px;min-height:44px;padding:0 20px;border-radius:999px;cursor:pointer;'
    + 'background:#b89968;color:#1b1d24;border:0;font:700 14px/1 ui-monospace,monospace;letter-spacing:.04em;'
    + 'box-shadow:0 6px 24px rgba(0,0,0,.45);pointer-events:auto;}'
    + '.lgr-chip.on{display:inline-flex;} .lgr-chip:active{scale:.95;}'
    + '.lgr-chip:focus-visible{outline:3px solid #e8c069;outline-offset:3px;}';
  document.head.appendChild(s);
  _chipRow = document.createElement('div'); _chipRow.className = 'lgr-chips';
  const mk = (cls, label, aria, onClick) => {
    const b = document.createElement('button'); b.className = 'lgr-chip ' + cls; b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.addEventListener('click', () => { navigator.vibrate?.(10); onClick(); });
    _chipRow.appendChild(b); return b;
  };
  _flyChip  = mk('lgr-fly-chip',  '🚁 Fly',  'Fly the helicopter', () => flyPossess());
  _timeChip = mk('lgr-time-chip', '🌅 Time', 'Change the time of day', () => cycleTime());
  _cityChip = mk('lgr-city-chip', '🏙 City', 'Generate a new procedural city', () => cityChipCycle());
  document.body.appendChild(_chipRow);
}
// cycle to the NEXT time-of-day stop strictly after the current sun time (so it continues from a ?t= boot); night 0.0
// is ordered as 1.0 then wraps to Dawn. sunRig.goTo eases (damped), so the sun visibly POURS to the new time.
function cycleTime() {
  const now = sunRig.t;
  const order = [{ k: 0.25, name: 'Dawn' }, { k: 0.5, name: 'Noon' }, { k: 0.75, name: 'Dusk' }, { k: 1.0, name: 'Night' }];
  const hit = order.find((o) => o.k > now + 1e-3) || order[0];
  sunRig.goTo(hit.k === 1.0 ? 0.0 : hit.k);
  officeUI.toast('🌅  ' + hit.name);
}
function cityChipCycle() {
  if (piloting || sceneMode !== 'city' || worldMode) return;   // v1: regen only from the free city view (regen-under-craft = untested lifecycle)
  profileIndex = (profileIndex + 1) % PROFILES.length;
  citySeed = (Math.random() * 1e9) | 0;
  regenerateCity();
  officeUI.toast('🏙  ' + city.state.profile.name);
}
function refreshChips() {
  ensureChips();
  const air = engine.seizeCraft && engine.seizeCraft.pilot && engine.seizeCraft.pilot.model === 'spacecraft';
  const cityScene = sceneMode === 'city';
  _flyChip.classList.toggle('on', !!air && !piloting && !attractActive && (cityScene || worldMode));
  _timeChip.classList.toggle('on', cityScene && !attractActive);                            // incl. while piloting — the mid-flight sun-morph is the money shot
  _cityChip.classList.toggle('on', cityScene && !worldMode && !piloting && !attractActive);
}
// L104 — auto FLY/DRIVE label by the nearest/possessed craft's medium (air→Fly, ground ATV→Drive). For Phase 2's verb bar.
function flyVerbLabel() {
  const c = engine.pilot.craft || pilotables()[0];
  return (c && c.pilot && (c.pilot.model === 'spacecraft')) ? 'Fly' : (c ? 'Drive' : 'Fly');
}

// L104 P3 — OWNER-ONLY DEVELOPER MODE. Gated: NEVER in the client ?preview or ?demo path. Enabled by ?dev=1 OR a
// persisted localStorage flag; the backtick (`) key toggles it at runtime (the hidden key). create/destroy on toggle so
// when OFF nothing exists → client tiers byte-identical. The seam lives in engine-core; main just wires the data accessors.
let devMode = null;
const DEV_OK = app.mode.can('devTools');   // I: thin alias — AUTHOR (lgr_dev_on) grants devTools; PRESENT + ?preview do not
function setDev(on) {
  if (!DEV_OK || on === !!devMode) return;
  if (on) {
    devMode = createDevMode({
      engine,
      getCraft: () => engine.pilot.craft || engine.seizeCraft || (engine.inspector && engine.inspector.focus) || null,
      getAxes: () => pilotAxes,
      setPostMode,
    });
  } else { devMode.destroy(); devMode = null; }
  try { localStorage.setItem('lgr_dev_on', on ? '1' : '0'); } catch (e) {}
  if (typeof window !== 'undefined') window.__devOn = !!devMode;
}
// L-cockpit: toggle between the external chase cam and the first-person cockpit eye.
// Only callable while piloting; guards inside engine.pilot.setView (no-op with no craft).
let _cockpitActive = false;
function toggleCockpit() {
  _cockpitActive = !_cockpitActive;
  engine.pilot.setView(_cockpitActive ? 'cockpit' : 'chase');
  if (_cockpitView) _cockpitView.textContent = _cockpitActive ? '👁 Chase' : '🎯 Cockpit';
  // VIZ MOBILE: show motion chip only while in cockpit view + coarse pointer; disable gyro on exit.
  if (_gyroChip) _gyroChip.style.display = (_cockpitActive && _coarsePointer) ? '' : 'none';
  if (!_cockpitActive && _gyroLook && _gyroLook.enabled) _gyroLook.disable();
}
let _cockpitView = null;   // the cockpit-toggle button in the pilot HUD (created in pilotHUD below)
let _gyroChip = null;      // VIZ MOBILE: the "📱 Motion" chip button (null until the pilot HUD is built)
let _gyroLook = null;      // VIZ MOBILE: createGyroLook instance (null until cockpit is first entered)

function releasePilot() {
  if (!piloting) return false;
  // L110 (audit B13): the pilot Exit button is about to inert (HUD hides) — if it (or the canvas) had keyboard focus,
  // return focus to the FLY chip once refreshPilotHUD re-shows it, so focus isn't dropped to <body> on exit.
  const _exitEl = document.querySelector('.pilot-exit');
  const _returnFocus = document.activeElement === _exitEl || document.activeElement === renderer.domElement || document.activeElement === document.body;
  _morphTimers.forEach(clearTimeout); _morphTimers = [];   // L106 (audit fix): cancel any in-flight takeover-morph so its trailing setPostMode() can't stomp the tier you pick right after exiting
  _cockpitActive = false; if (_cockpitView) _cockpitView.textContent = '🎯 Cockpit';   // L-cockpit: reset toggle on exit
  // VIZ MOBILE: disable gyro + hide chip when we leave the craft entirely.
  if (_gyroLook && _gyroLook.enabled) _gyroLook.disable();
  if (_gyroChip) _gyroChip.style.display = 'none';
  engine.pilot.release(); piloting = false; window.__piloting = false; heldPilot.clear(); recomputeAxes();
  refreshPilotHUD();
  if (_returnFocus && _flyChip && _flyChip.classList.contains('on')) _flyChip.focus();
  if (viewerUI) viewerUI.announce('Exited the craft. Free camera restored.');   // L104 a11y (WCAG 4.1.3)
  return true;
}

/* The MINIMAL HUD — a self-contained DOM overlay (the same cheap "real UI over the canvas" pattern as the
   office laptop panel; deliberately NOT in viewer-ui.js, so the editor chrome stays byte-identical). Two
   states: a DRIVE prompt when you're following a pilotable, and the PILOT readout (speed + the always-there
   Exit + an on-screen d-pad for touch) while driving. The full attitude/altitude HUD is deferred to L77. */
const pilotHUD = (() => {
  if (typeof document === 'undefined') return { update() {} };
  const css = document.createElement('style');
  css.textContent = `
  .pilot-drive { position:fixed; left:50%; bottom:96px; transform:translateX(-50%); z-index:6; padding:10px 18px;
    border-radius:999px; background:rgba(16,18,24,.82); color:#e8edf4; font:600 13px/1 ui-monospace,monospace;
    letter-spacing:.04em; border:1px solid #2a2f3a; cursor:pointer; opacity:0; pointer-events:none; transition:opacity .2s; }
  .pilot-drive.on { opacity:1; pointer-events:auto; }
  .pilot-hud { position:fixed; inset:0; z-index:6; pointer-events:none; opacity:0; transition:opacity .2s; font:600 13px/1 ui-monospace,monospace; }
  .pilot-hud.on { opacity:1; }
  .pilot-speed { position:absolute; left:50%; top:18px; transform:translateX(-50%); padding:8px 16px; border-radius:999px;
    background:rgba(16,18,24,.78); color:#e8edf4; letter-spacing:.04em; }
  /* G — coarse: left-align + shrink pill; push below the 📱 Motion chip (top:16px + h:44px + 16px gap = top:76px). */
  @media (pointer:coarse){.pilot-speed{left:16px;transform:none;font-size:12px;top:76px;}}
  .pilot-exit { position:absolute; right:16px; top:16px; min-width:44px; height:44px; border-radius:10px; border:1px solid #2a2f3a;
    background:rgba(16,18,24,.85); color:#ff9b8a; cursor:pointer; pointer-events:auto; font:inherit; }
  .pilot-cockpit { position:absolute; right:72px; top:16px; padding:0 14px; height:44px; border-radius:10px; border:1px solid #2a2f3a;
    background:rgba(16,18,24,.85); color:#e8edf4; cursor:pointer; pointer-events:auto; font:inherit; white-space:nowrap; }
  /* L107 (UI audit M1) — the DESKTOP movement d-pad sits bottom-LEFT (mirrors the mobile thumbstick zone + gamepad
     convention), leaving bottom-CENTRE for the chip row (🌅 Time while piloting) and bottom-RIGHT for CLIMB/DESCEND.
     Was bottom-centre, which collided with the chips. (On touch the pad is clipped away — .pilot-hud.touch below.) */
  .pilot-pad { position:absolute; left:24px; bottom:24px; display:grid;
    grid-template-columns:repeat(3,52px); grid-template-rows:repeat(2,52px); gap:8px; pointer-events:auto; }
  .pilot-lift { position:absolute; right:24px; bottom:24px; display:grid; grid-template-rows:repeat(2,52px); gap:8px; pointer-events:auto; }
  .pilot-pad button, .pilot-lift button { width:52px; border-radius:12px; border:1px solid #2a2f3a; background:rgba(16,18,24,.8);
    color:#cdd3dc; font:600 18px/1 ui-monospace,monospace; touch-action:none; user-select:none; -webkit-user-select:none; }
  .pilot-pad button:active, .pilot-lift button:active { background:#2a3140; color:#7fe0ff; }
  /* L106 (Laurence feedback): VISIBLE climb/descend labels — the bare ⤒/⤓ glyphs were ambiguous next to the d-pad's ▼ ("how do I descend?"). */
  .pilot-lift { grid-template-rows:repeat(2,58px); }
  .pilot-lift button { width:72px; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:1px; }
  .pilot-lift button .g { font-size:18px; line-height:1; }
  .pilot-lift button .lab { font-size:9px; font-weight:600; letter-spacing:.04em; opacity:.92; }
  .pilot-speed[data-medium="water"] { color:#7fd0ff; border-color:#2a567a; }
  .pilot-speed[data-medium="air"]   { color:#e8edf4; }
  .pilot-speed[data-medium="ground"]{ color:#9fe6a0; border-color:#2a5a32; }
  /* L104 P2 (item 7) — the FLOATING DYNAMIC THUMBSTICK (touch): spawns where the thumb lands (NippleJS-style) and
     drives throttle+steer analog. On touch it REPLACES the fixed d-pad (which stays in the a11y tree, clipped, as the
     keyboard parallel — plus the physical W/A/S/D + the possess announce). Lift/exit get safe-area-inset padding. */
  .pilot-stick-zone { position:absolute; left:0; bottom:0; width:60%; height:64%; pointer-events:auto; touch-action:none; display:none; }
  .pilot-hud.touch .pilot-stick-zone { display:block; }
  .pilot-stick { position:absolute; width:120px; height:120px; margin:-60px 0 0 -60px; border-radius:50%;
    background:rgba(16,18,24,.34); border:2px solid rgba(184,153,104,.5); display:none; pointer-events:none; }
  .pilot-stick.on { display:block; }
  .pilot-knob { position:absolute; left:50%; top:50%; width:56px; height:56px; margin:-28px 0 0 -28px; border-radius:50%;
    background:rgba(184,153,104,.9); box-shadow:0 2px 12px rgba(0,0,0,.55); will-change:transform; }
  .pilot-hud.touch .pilot-pad { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); clip-path:inset(50%); pointer-events:none; }
  .pilot-hud.touch .pilot-lift { right:max(20px, env(safe-area-inset-right)); bottom:max(24px, env(safe-area-inset-bottom)); }
  .pilot-hud.touch .pilot-exit { right:max(16px, env(safe-area-inset-right)); top:max(16px, env(safe-area-inset-top)); }
  /* VIZ MOBILE — motion/gyro chip: top-left corner of the cockpit overlay (hidden by default; shows only on coarse-pointer + cockpit). */
  .pilot-gyro { position:absolute; left:16px; top:16px; padding:0 14px; height:44px; border-radius:10px; border:1px solid #2a2f3a;
    background:rgba(16,18,24,.85); color:#e8edf4; cursor:pointer; pointer-events:auto; font:inherit; display:none; }
  .pilot-gyro.active { color:#7fe0ff; border-color:#2a567a; }
  `;
  document.head.appendChild(css);
  const drive = document.createElement('div'); drive.className = 'pilot-drive'; drive.textContent = '▶ Drive — Enter / tap';
  const hud = document.createElement('div'); hud.className = 'pilot-hud';
  // L104 a11y (WCAG 4.1.2): every glyph button carries an aria-label (its text is a bare arrow/glyph), and the
  // d-pad + lift are labelled groups so a screen reader announces the cluster on entry.
  hud.innerHTML = `<div class="pilot-speed">—</div><button class="pilot-exit" title="Exit (Esc)" aria-label="Exit the craft (Escape)">✕</button>
    <button class="pilot-cockpit" title="Cockpit view (C)" aria-label="Toggle cockpit view (C key)">🎯 Cockpit</button>
    <button class="pilot-gyro" title="Gyroscope look-around" aria-label="Toggle gyroscope look-around">📱 Motion</button>
    <div class="pilot-pad" role="group" aria-label="Flight — thrust and steering (hold a control)">
      <span></span><button data-tok="up" aria-label="Thrust forward — hold">▲</button><span></span>
      <button data-tok="left" aria-label="Turn left — hold">◀</button><button data-tok="down" aria-label="Reverse — hold">▼</button><button data-tok="right" aria-label="Turn right — hold">▶</button>
    </div>
    <div class="pilot-lift" role="group" aria-label="Climb and dive"><button data-tok="rise" title="Climb (Space)" aria-label="Climb — hold"><span class="g">⤒</span><span class="lab">CLIMB</span></button><button data-tok="fall" title="Descend (Shift)" aria-label="Descend — hold"><span class="g">⤓</span><span class="lab">DESCEND</span></button></div>`;
  document.body.append(drive, hud);
  drive.inert = true; hud.inert = true;   // L104 a11y: hidden at boot → out of the tab order until update() activates them
  drive.addEventListener('click', () => tryPossess());
  hud.querySelector('.pilot-exit').addEventListener('click', () => releasePilot());
  _cockpitView = hud.querySelector('.pilot-cockpit');   // L-cockpit: store ref so toggleCockpit() can update its label
  _cockpitView.addEventListener('click', () => toggleCockpit());
  // VIZ MOBILE: gyro chip — tap IS the iOS permission gesture (must be direct click handler, not async at arm time).
  _gyroChip = hud.querySelector('.pilot-gyro');
  _gyroChip.addEventListener('click', async () => {
    if (!_gyroLook) _gyroLook = createGyroLook({ look: engine.pilot.look });
    if (_gyroLook.enabled) { _gyroLook.disable(); _gyroChip.classList.remove('active'); return; }
    const r = await _gyroLook.enable();
    if (r.ok) {
      _gyroChip.classList.add('active');
    } else {
      _gyroChip.style.display = 'none';   // denied/unsupported → remove the chip; recurs to toast
      officeUI.toast('Motion access denied — use the cockpit drag to look around.');
    }
  });
  // on-screen d-pad + climb/dive → the SAME held-set as the keyboard (press to engage, release/leave to disengage).
  hud.querySelectorAll('.pilot-pad button, .pilot-lift button').forEach((b) => {
    const tok = b.dataset.tok;
    const on = (e) => { e.preventDefault(); pilotHold(tok, true); };
    const off = (e) => { e.preventDefault(); pilotHold(tok, false); };
    b.addEventListener('pointerdown', on); b.addEventListener('pointerup', off);
    b.addEventListener('pointerleave', off); b.addEventListener('pointercancel', off);
    // L104 a11y (WCAG 2.1.1): the d-pad was pointer-only — a focusable button that did nothing on keyboard.
    // Enter/Space now engage sustained thrust while HELD (keydown → on, keyup → off); e.repeat ignores OS
    // key-repeat (pilotHold is Set-based / idempotent anyway); blur releases if focus leaves mid-hold.
    const isAct = (e) => e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar';
    b.addEventListener('keydown', (e) => { if (!isAct(e)) return; e.preventDefault(); if (!e.repeat) pilotHold(tok, true); });
    b.addEventListener('keyup', (e) => { if (!isAct(e)) return; e.preventDefault(); pilotHold(tok, false); });
    b.addEventListener('blur', () => pilotHold(tok, false));
  });
  // L104 P2 (item 7) — the FLOATING DYNAMIC THUMBSTICK (touch only): on a pointerdown in the lower-left zone, spawn the
  // stick UNDER the thumb; drag → analog throttle (up) + steer (sideways); release → recentre + zero the analog axes.
  const coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  if (coarse) {
    hud.classList.add('touch');                        // → hide the fixed d-pad (kept clipped for AT), show the stick zone
    const zone = document.createElement('div'); zone.className = 'pilot-stick-zone'; zone.setAttribute('aria-hidden', 'true');
    const stick = document.createElement('div'); stick.className = 'pilot-stick';
    const knob = document.createElement('div'); knob.className = 'pilot-knob';
    stick.appendChild(knob); hud.appendChild(zone); hud.appendChild(stick);   // stick is a HUD child (fixed/viewport coords), zone is the pointer-capture area
    let sid = null, ox = 0, oy = 0; const MAXR = 52;
    zone.addEventListener('pointerdown', (e) => {
      if (sid !== null) return;
      sid = e.pointerId; ox = e.clientX; oy = e.clientY;
      stick.style.left = ox + 'px'; stick.style.top = oy + 'px'; knob.style.transform = 'translate(0px,0px)';
      stick.classList.add('on'); try { zone.setPointerCapture(e.pointerId); } catch (_) {}
      navigator.vibrate?.(8); e.preventDefault();
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== sid) return;
      let dx = e.clientX - ox, dy = e.clientY - oy; const m = Math.hypot(dx, dy);
      if (m > MAXR) { dx = dx / m * MAXR; dy = dy / m * MAXR; }
      knob.style.transform = `translate(${dx}px,${dy}px)`;
      stickSteer = dx / MAXR;                           // right = +steer
      stickThrottle = -dy / MAXR;                       // up = +throttle (forward)
      recomputeAxes(); e.preventDefault();
    });
    const end = (e) => { if (e.pointerId !== sid) return; sid = null; stick.classList.remove('on'); stickThrottle = 0; stickSteer = 0; recomputeAxes(); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }
  const speedEl = hud.querySelector('.pilot-speed');
  let _last = '';
  return {
    update(mode, telem, hints) {
      drive.classList.toggle('on', mode === 'drive');
      hud.classList.toggle('on', mode === 'pilot');
      // L104 a11y: until active, the prompt + the full d-pad sit at opacity:0 but were still focusable + in the
      // a11y tree (a keyboard user would tab into invisible flight controls). `inert` removes them from BOTH the
      // tab order and the a11y tree while hidden; the opacity fade is unaffected.
      drive.inert = mode !== 'drive';
      hud.inert = mode !== 'pilot';
      if (mode === 'pilot' && telem) {
        // spacecraft → MEDIUM · ALT/DEPTH · climb arrow · speed; ATV (no medium) → the control hint + speed.
        const arrow = telem.climb > 0.3 ? ' ↑' : telem.climb < -0.3 ? ' ↓' : '';
        // G — coarse/narrow: drop medium prefix + use integer values so the pill never wraps at 390px.
        const coarse = window.matchMedia && window.matchMedia('(pointer:coarse)').matches;
        const txt = telem.medium
          ? coarse
            ? `${telem.depth > 0.1 ? 'DEPTH ' + Math.round(telem.depth) : 'ALT ' + Math.round(telem.altitude)}${arrow} · ${Math.round(Math.abs(telem.speed))} m/s`
            : `${telem.medium.toUpperCase()} · ${telem.depth > 0.1 ? 'DEPTH ' + telem.depth.toFixed(1) : 'ALT ' + telem.altitude.toFixed(1)}${arrow} · ${Math.abs(telem.speed).toFixed(1)} m/s`
          : `${hints || 'driving'} · ${Math.abs(telem.speed).toFixed(1)} m/s`;
        if (txt !== _last) { speedEl.textContent = txt; speedEl.dataset.medium = telem.medium || 'air'; _last = txt; }
      } else _last = '';
    },
  };
})();
function refreshPilotHUD() {
  const focus = engine.inspector.focus;
  const mode = piloting ? 'pilot' : (inspecting && focus && focus.pilot ? 'drive' : 'off');
  pilotHUD.update(mode, engine.pilot.telemetry, engine.pilot.controlHints);
  refreshChips();   // L106+L110: the persistent demo chips (FLY / 🌅 TIME / 🏙 CITY) — each toggles its own visibility
  // L110 (audit P0-5): hide the ⌘K FAB while the pilot HUD is up — on touch the always-on FAB (bottom-right, z6) sits
  // exactly over the pilot CLIMB/DESCEND lift cluster (same corner, same z), and it paints on top (appended later).
  if (viewerUI && viewerUI.setFabVisible) viewerUI.setFabVisible(mode !== 'pilot');
  // G — hide "⌃ Controls" pill while piloting on fine pointers (coarse already handled by CSS media query).
  if (viewerUI && viewerUI.setPillVisible) viewerUI.setPillVisible(mode !== 'pilot');
  document.body.classList.toggle('piloting', mode === 'pilot');
}
if (typeof window !== 'undefined') {
  // headless probe (state + callable possess/release/drive) — the same convention as __editor / __inspector.
  window.__pilot = {
    get state() { return engine.pilot.state; }, get active() { return engine.pilot.active; },
    get piloting() { return engine.pilot.piloting; }, get speed() { return engine.pilot.speed; },
    get craft() { return engine.pilot.craft ? engine.pilot.craft.label : null; },
    get pos() { const c = engine.pilot.craft; if (!c) return null; const t = c.pilot.getTransform(); return [t.x, t.y, t.z, t.yaw]; },   // [x,y,z,yaw] of the driven craft (terrain-follow probe)
    get telemetry() { return engine.pilot.telemetry; },   // L77: {medium, altitude, depth, climb, speed, y}
    axes: pilotAxes, count: () => pilotables().length,
    possess: (i = 0) => doPossess(pilotables()[i | 0]),
    release: () => releasePilot(),
    setAxes: (t = 0, s = 0, l = 0) => { pilotAxes.throttle = t; pilotAxes.steer = s; pilotAxes.lift = l; },   // headless drive (no key events) — L77 + lift
    setCollision: (on) => { engine.collider.enabled = !!on; },   // L108: the "ghost" toggle (S7 — ram passes through when off)
  };
  // L108 (collision part C) headless probe: solids count + the max penetration depth at the driven craft (S1: a
  // full-throttle tower ram → depthAt ≤ SKIN every frame). Read-only + the ghost enable flag.
  window.__collide = {
    get count() { return engine.collider.count; },
    get enabled() { return engine.collider.enabled; },
    set enabled(v) { engine.collider.enabled = !!v; },
    depthAt: (x, y, z) => engine.collider.depthAt(x, y, z),
    craftDepth: () => { const c = engine.pilot.craft; if (!c) return 0; const t = c.pilot.getTransform(); return engine.collider.depthAt(t.x, t.y, t.z); },
    probe: (x, y, z) => engine.collider.probe(x, y, z),   // L108 S1: does a sphere inside a building get pushed out?
    boxAt: (i) => engine.collider.boxAt(i),               // the i-th building AABB [minX,minY,minZ,maxX,maxY,maxZ]
    resolve: (st, dt, cfg) => engine.collider.resolveSphere(st, dt, cfg),   // L108 S1: raw resolve for a synthetic ram sim
    segmentHit: (ox, oy, oz, ex, ey, ez, r) => engine.collider.segmentHit(ox, oy, oz, ex, ey, ez, r),   // L108 spring-arm: sweep target→eye
  };
}

/* ============================================================
   L79 CLIENT-PREVIEW / SHOWCASE — the conversion deliverable. A COMPOSITION of existing seams (world + pilot +
   chase cam + the L78 pre-warm + the chrome-strip), not a new system: hide all lab chrome → GPU-pre-warm →
   auto-play a scripted 🛸 hero (sky → splash → surface → land) → a short captioned guided tour → an "Explore"
   button into the live (chrome-light) world. The hero drives the possessed craft's transform DIRECTLY along a
   keyframed path (NOT pilot.step) so it's a deterministic cinematic; the pilot's chase cam follows for free. */
let heroActive = false, heroT = 0, heroCraft = null, heroKF = null;
let tourActive = false, tourBeat = -1, tourT = 0;
const HERO_DUR = 15;                                   // seconds of the hero flythrough
const TOUR_BEAT_DUR = 4.0;                             // seconds per tour caption
const _heroEuler = new THREE.Euler();
// Captions are DATA (a steel-client copy/branding swap is a config change later — L80 content pass).
const TOUR = [
  { cap: 'An editable world — sculpt the land, paint it, plant it.' },
  { cap: 'Dawn to night — one living world.', sweep: true },
  { cap: 'Pilot anything — drive the land, dive the sea, fly the sky.' },
  { cap: 'A world built for you.' },
];

// The preview overlay (captions + Explore) + the chrome-hide CSS — self-contained DOM, like the pilot HUD.
const previewUI = (() => {
  if (typeof document === 'undefined') return { caption() {}, showExplore() {} };
  const css = document.createElement('style');
  css.textContent = `
  /* preview hides ALL lab/editor chrome; preview-cinematic additionally hides the pilot HUD during the hero+tour */
  body.preview .vui, body.preview .hint, body.preview .lgr-hints, body.preview-cinematic .pilot-hud,
  body.preview-cinematic .pilot-drive { display: none !important; }
  /* piloting hides all dev/editor chrome — only the clean flight HUD + chips + mute/vol remain */
  body.piloting .vui, body.piloting .hint, body.piloting .lgr-hints,
  body.piloting .pv-explore { display: none !important; }
  .pv-cap { position: fixed; left: 50%; bottom: 13%; transform: translateX(-50%); z-index: 7; max-width: 80vw; text-align: center;
    font: 600 clamp(18px,3.2vw,30px)/1.3 Georgia, serif; color: #f4ece0; text-shadow: 0 2px 18px rgba(0,0,0,.7);
    opacity: 0; transition: opacity .6s; pointer-events: none; letter-spacing: .01em; }
  .pv-cap.on { opacity: 1; }
  .pv-explore { position: fixed; right: 22px; bottom: 22px; z-index: 7; padding: 13px 22px; border-radius: 999px;
    border: 1px solid rgba(184,153,104,.5); background: rgba(16,18,24,.72); color: #f0e6d4; cursor: pointer;
    font: 600 14px/1 ui-monospace, monospace; letter-spacing: .04em; opacity: 0; transition: opacity .4s; pointer-events: none; }
  .pv-explore.on { opacity: 1; pointer-events: auto; }
  `;
  document.head.appendChild(css);
  const cap = document.createElement('div'); cap.className = 'pv-cap';
  const explore = document.createElement('button'); explore.className = 'pv-explore'; explore.textContent = '✏ Explore';
  document.body.append(cap, explore);
  explore.addEventListener('click', () => endPreviewToExplore());
  return {
    caption(text, show) { cap.textContent = text || ''; cap.classList.toggle('on', !!show); },
    showExplore(show) { explore.classList.toggle('on', !!show); },
  };
})();

// scan the authored world for an OCEAN column (deep enough to dive) + a LAND point (to touch down on).
function findHeroSpots() {
  const E = engine.world; let O = null, L = null, bo = 99, bl = 99;
  for (let r = 0; r < 3000; r++) {
    const x = (Math.random() * 2 - 1) * 11, z = (Math.random() * 2 - 1) * 11, h = E.heightAt(x, z);
    if (h < -1.5 && h > -3.5 && Math.abs(h + 2.2) < bo) { bo = Math.abs(h + 2.2); O = { x, z, h }; }
    if (h > 1.0 && Math.abs(h - 1.6) < bl) { bl = Math.abs(h - 1.6); L = { x, z, h }; }
  }
  return { O, L };
}
// keyframed path: sky over ocean → descend → SPLASH under → glide → SURFACE → climb to land → TOUCH DOWN.
function buildHeroPath(O, L) {
  const Hl = L.h;
  return [
    { t: 0,    x: O.x,             y: 9.5,  z: O.z - 7 },
    { t: 3,    x: O.x,             y: 1.2,  z: O.z - 1 },
    { t: 4.6,  x: O.x,             y: -2.3, z: O.z + 1.5 },
    { t: 7,    x: O.x + 2.5,       y: -1.9, z: O.z + 3.5 },
    { t: 9,    x: O.x + 2.5,       y: 1.0,  z: O.z + 5 },
    { t: 11.5, x: (O.x + L.x) / 2, y: 7.5,  z: (O.z + L.z) / 2 },
    { t: 13.8, x: L.x,             y: Hl + 3, z: L.z - 2.5 },
    { t: 15,   x: L.x,             y: Hl + 0.5, z: L.z },
  ];
}
function samplePath(kf, t) {
  if (t <= kf[0].t) return { x: kf[0].x, y: kf[0].y, z: kf[0].z };
  const last = kf[kf.length - 1];
  if (t >= last.t) return { x: last.x, y: last.y, z: last.z };
  let i = 0; while (i < kf.length - 1 && t > kf[i + 1].t) i++;
  const a = kf[i], b = kf[i + 1], u = THREE.MathUtils.smoothstep(t, a.t, b.t);
  return { x: THREE.MathUtils.lerp(a.x, b.x, u), y: THREE.MathUtils.lerp(a.y, b.y, u), z: THREE.MathUtils.lerp(a.z, b.z, u) };
}

function startPreview() {
  // L106 — route the prospect link (?preview=<slug>) into the SEIZE-FLIGHT, the spec's ACTUAL experience, replacing the
  // old scripted world-hero flythrough: the CITY opens FRAMED on the helicopter (the attract-loop) → tap / F seizes the
  // in-motion craft → the takeover morph → fly. Clean preview chrome (lab UI hidden via body.preview + showUI=0); we do
  // NOT add `preview-cinematic` — that hid the pilot HUD, and the prospect now actually flies. Golden hour + the framing
  // are set by startAttract; prewarm keeps frame 1 smooth. (The old hero/tour/explore fns below are now inert — heroActive/
  // tourActive are never set — kept for the standalone capture path / a future guided-tour option.)
  document.body.classList.add('preview');
  engine.prewarm();                                   // L78/L79: compile shaders + warm RTT passes → smooth frame 1
  if (sceneMode === 'city') { engine.spawnSeizeCraft('heli', 4, 3, { hover: 11 }); startAttract(); }
  window.__preview.phase = 'attract';
}
function heroUpdate(dt) {
  heroT += dt; window.__preview.heroT = Math.round(heroT * 100) / 100;
  const p = samplePath(heroKF, heroT);
  const ahead = samplePath(heroKF, Math.min(heroT + 0.15, HERO_DUR));
  const dx = ahead.x - p.x, dz = ahead.z - p.z;
  const st = heroCraft.pilot.getTransform();
  const yaw = (Math.abs(dx) + Math.abs(dz) > 1e-4) ? Math.atan2(dx, dz) : st.yaw;
  st.x = p.x; st.y = p.y; st.z = p.z; st.yaw = yaw;
  _heroEuler.set(0, yaw, 0, 'YXZ'); st.quat.setFromEuler(_heroEuler);
  heroCraft.pilot.setTransform(st);
  rig.setAzimuth(yaw + Math.PI);                       // trailing chase, eased by the rig's damp
  if (heroT >= HERO_DUR) { heroActive = false; startTour(); }
}
function startTour() {
  tourActive = true; tourBeat = 0; tourT = 0;
  window.__preview.phase = 'tour'; window.__preview.tourBeat = 0;
  previewUI.caption(TOUR[0].cap, true); previewUI.showExplore(true);
}
function tourUpdate(dt) {
  tourT += dt;
  if (TOUR[tourBeat] && TOUR[tourBeat].sweep) sunRig.nudge(dt * 9);   // animate the day during the "dawn to night" beat
  if (tourT >= TOUR_BEAT_DUR && tourBeat < TOUR.length - 1) {
    tourBeat++; tourT = 0; window.__preview.tourBeat = tourBeat;
    previewUI.caption(TOUR[tourBeat].cap, true);
  }
}
function endPreviewToExplore() {                       // the Explore button: drop into the live, chrome-light world
  tourActive = false; heroActive = false; window.__preview.phase = 'explore';
  previewUI.caption('', false); previewUI.showExplore(false);
  document.body.classList.remove('preview-cinematic');
  engine.pilot.release();                             // free the camera → drag to orbit the authored world
}

const brushRing = new THREE.Mesh(
  new THREE.RingGeometry(0.9, 1.0, 40),
  new THREE.MeshBasicMaterial({ color: '#7fe0ff', transparent: true, opacity: 0.85, depthTest: false, depthWrite: false, fog: false, toneMapped: false }),
);
brushRing.rotation.x = -Math.PI / 2; brushRing.visible = false; brushRing.renderOrder = 9; brushRing.raycast = () => {};
scene.add(brushRing);
function setBrushRing(x, y, z) { brushRing.position.set(x, y + 0.05, z); brushRing.scale.setScalar(editor.brush.radius); }
function toggleSculpt() {
  if (!worldMode) return;                             // sculpt only in a world
  if (!sculpting && inspecting) toggleInspect();      // sculpt + inspect are mutually exclusive
  sculpting = !sculpting;
  if (!sculpting) sculptStroke = 0;
  brushRing.visible = sculpting;
  engine.world.setEditing(sculpting);                 // L96: hide the sea/lakes/flow while editing → dug pits are visible; restore + re-pool on exit
  renderer.domElement.style.cursor = sculpting ? 'crosshair' : 'default';
  window.__sculpt = sculpting;
  if (viewerUI) viewerUI.refresh();
}
const _sculptRay = new THREE.Raycaster();
function sculptAt(cx, cy, dir) {                       // raycast the terrain at the pointer → stamp + show the ring
  if (!engine.world.terrainGroup) return null;
  setPointer(cx, cy);
  _sculptRay.setFromCamera(pointer, rig.camera);
  const hit = _sculptRay.intersectObjects(engine.world.terrainGroup.children, false)[0];
  if (!hit) return null;
  setBrushRing(hit.point.x, hit.point.y, hit.point.z);
  if (dir !== 0) editor.applyAt(hit.point.x, hit.point.z, dir);   // L74: the editor routes the apply by active tool
  return hit;
}
function toggleInspect() {
  if (sceneMode !== 'city') return;                   // only from the open city view
  if (piloting) releasePilot();                        // L76: exiting inspect drops the pilot (it rode the inspect follow)
  if (!inspecting && sculpting) toggleSculpt();        // L69: sculpt + inspect are mutually exclusive
  inspecting = !inspecting;
  if (inspecting) { rig.setMode(CAM.PERSPECTIVE); window.__camMode = rig.mode; }
  else { engine.inspector.release(); window.__followKind = null; window.__followLabel = null; }
  window.__inspect = inspecting;
  renderer.domElement.style.cursor = inspecting ? 'crosshair' : 'default';
  if (viewerUI) viewerUI.refresh();
}
function enterOffice(focusUv) {
  if (sceneMode !== 'city') return;
  if (!audienceModes().includes('office')) return;      // L110 (audit P0-6): prospect links (?preview=steel) must not dive into the office — gate the VERB (O key, building-click, goToMode), not just the switcher chrome
  endAttract();                                         // L110 (audit P0-2): end the boot attract-loop before diving — heli-follow/coach/seize-intercept must not survive the mode change
  if (piloting) releasePilot();                         // L76: stop driving before a dive
  if (worldMode) toggleWorld();                         // L64: leave the terrain world before diving
  if (inspecting) toggleInspect();                      // L63: leave the inspection lens before diving
  dive.enter(focusUv || new THREE.Vector2(0.5, 0.5));   // L60: focus push-in toward the clicked window
  sceneMode = 'diving-in'; window.__scene = sceneMode;
  office.look.recenter();              // L55: every dive starts facing forward (then drag/arrows to look around)
  lookKeys.left = lookKeys.right = lookKeys.up = lookKeys.down = false;   // clear any held arrows from city mode
  if (!_lookHintShown) { _lookHintShown = true; officeUI.toast(coarse ? 'Drag to look around' : 'Drag to look around · ⬅ ➡ ⬆ ⬇ keys too'); }   // L110 (audit B13): no arrow-keys line for touch users
}
function exitOffice() {
  if (sceneMode !== 'office' && sceneMode !== 'diving-in') return;
  dive.exit();                                          // L60: reverse the transition (B→A)
  sceneMode = 'diving-out'; window.__scene = sceneMode;
}

/* 7i) THE HOARD (L32) — the GAME LAYER. A new scene mode (?hoard=1 / X) where you move a survivor
   around this very city while a horde seeks you. It reuses the city as the arena + the iso camera +
   SunRig; we only ADD the player + horde. Created HERE (before main's keydown handler registers) so
   its movement-key listeners register FIRST and can claim WASD/arrows while the game is on. */
const hoard = createHoard({ extent: city.extent, plinthTop: 0.3 });
scene.add(hoard.group);
if (typeof window !== 'undefined') window.__hoardApi = hoard;   // debug/capture handle (seed items, open bag…)

/* L32 HOARD mode — enter/exit the game. Reuses the iso camera (dimetric, a closer game zoom, snapped
   onto the player) and the city as the arena; the per-frame camera-follow lives in the tick loop. */
function enterHoard() {
  if (sceneMode !== 'city') return;
  if (!audienceModes().includes('hoard')) return; // L110 (audit P0-6): the Hoard is personal — hidden from curated previews; gate the verb (X key, goToMode) so a prospect link can't open it
  endAttract();                                   // L110 (audit P0-2): end the boot attract-loop before the game mode (else the cinematic rig.follow stomps the game camera every frame)
  if (piloting) releasePilot();                   // L76: stop driving before the game mode
  if (worldMode) toggleWorld();                   // L64: leave the terrain world before the game mode
  if (inspecting) toggleInspect();                // L63: leave the inspection lens before the game mode
  sceneMode = 'hoard'; window.__scene = sceneMode;
  hoard.setActive(true);
  clearPlaza(PLAZA_R);                             // L34: open the base plaza (hide the central towers)
  rig.setMode(CAM.DIMETRIC);
  rig.setZoom(2.8, true);                          // a close, character-scale game framing (snap)
  rig.setTarget(hoard.player.x, 0.6, hoard.player.z, true);  // snap onto the player so there's no swoop
}
function exitHoard() {
  if (sceneMode !== 'hoard') return;
  hoard.setActive(false);
  restoreOccluders();                              // un-fade any towers the game faded
  restorePlaza();                                  // L34: restore the buildings hidden for the plaza
  sceneMode = 'city'; window.__scene = sceneMode;
  rig.setTarget(0, 0.8, 0);                        // ease back to the city centre
}

/* ============================================================
   L97 UNIFIED MODE-SWITCH — one segmented City·World·Office·Hoard control drives the scene mode (the redesign's
   audience-aware "engine hub" switcher). `goToMode(target)` is a small state machine over the existing enter/exit
   verbs: it normalises to the open CITY first, THEN enters the target. Because the office dive is ASYNC (it sits in
   'diving-in'/'diving-out' for ~1s), we DEFER via requestAnimationFrame until the scene settles before the next
   step — so even office→hoard works in one click (exit office → wait for city → enter hoard). C++: a tiny FSM that
   re-fires on the next frame until the transition guard (sceneMode==='city') is satisfiable. ============================================================ */
function currentMode() {
  if (sceneMode === 'office' || sceneMode === 'diving-in') return 'office';
  if (sceneMode === 'hoard') return 'hoard';
  return worldMode ? 'world' : 'city';
}
let _pendingMode = null;
function goToMode(target) { if (currentMode() === target) return; _pendingMode = target; _applyMode(); }
function _applyMode() {
  const target = _pendingMode; if (!target) return;
  if (sceneMode === 'diving-in' || sceneMode === 'diving-out') { requestAnimationFrame(_applyMode); return; }  // wait out the dive
  if (sceneMode === 'office') { exitOffice(); requestAnimationFrame(_applyMode); return; }   // → diving-out → (next frames) → city
  if (sceneMode === 'hoard') { exitHoard(); requestAnimationFrame(_applyMode); return; }     // → city (sync)
  // now in the open city — reach the target
  if (target === 'world') { if (!worldMode) toggleWorld(); }
  else if (target === 'office') enterOffice();
  else if (target === 'hoard') enterHoard();
  else if (target === 'city') { if (worldMode) toggleWorld(); }
  _pendingMode = null;
}

/* L97 AUDIENCE → MODES — which scene modes the switcher shows, gated by audience (spec §2). Owner/no-preview sees
   ALL; a generic ?preview=1 hides the personal projects (Office, Hoard); named slugs map to a
   curated set (Laurence tunes per client). One config object; the shell reads `audienceModes()` via state. */
const ALL_MODES = ['city', 'world', 'office', 'hoard'];
const AUDIENCE_MODES = { steel: ['city', 'world'] };
function audienceModes() {
  const slug = (typeof window !== 'undefined' && window.__preview && window.__preview.mode) || null;
  if (!slug) return ALL_MODES;                                  // owner / dev — all projects
  return AUDIENCE_MODES[slug] || ['city', 'world'];             // named slug → curated; generic preview → city/world
}

/* L22 OFFICE INTERACTIONS — the phone "TRAVEL" (hot-swap the window-city profile in place),
   and a shared flash/toast. Both are DOM siblings of the canvas, composited via z-index. */
const officeUI = (() => {
  if (typeof document === 'undefined') return { toast() {}, flash() {} };
  const css = document.createElement('style');
  css.textContent = `
  .otoast { position:fixed; left:50%; top:18px; transform:translateX(-50%); z-index:5; padding:9px 18px; border-radius:999px;
    background:rgba(16,18,24,.85); color:#e8edf4; font:600 13px/1 ui-monospace,monospace; letter-spacing:.04em;
    opacity:0; transition:opacity .3s; pointer-events:none; }
  .otoast.on { opacity:1; }
  .oflash { position:fixed; inset:0; z-index:4; background:#dfe8ff; opacity:0; pointer-events:none; }
  `;
  document.head.appendChild(css);
  const toast = document.createElement('div'); toast.className = 'otoast';
  const flash = document.createElement('div'); flash.className = 'oflash';
  document.body.append(toast, flash);
  let toastT = 0;
  return {
    toast(msg) { toast.textContent = msg; toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 1400); },
    flash() { flash.style.transition = 'none'; flash.style.opacity = '0.85';
      requestAnimationFrame(() => { flash.style.transition = 'opacity .55s'; flash.style.opacity = '0'; }); },
  };
})();
function travelCity() {
  profileIndex = (profileIndex + 1) % PROFILES.length;   // cycle to the next city
  officeUI.flash();                                       // a quick whoosh masks the rebuild (no re-dive)
  regenerateCity();                                       // the window-city becomes the new profile in place
  officeUI.toast('✈  ' + city.state.profile.name);        // "flying to <city>"
  window.__profile = city.state.profile.key;
}
/* L23 FITOUT swap — corner office ⇄ basement starter tier. The office keeps both shells built and
   just toggles visibility (instant), so this is a one-liner + a toast. `window.__tier` is exposed
   for the verify harness; the SAME call drives the `F` key, the viewer bar, and `?office=basement`. */
function setFitout(t) {
  const tier = office.setFitout(t);
  officeUI.toast(tier === 'basement' ? '🏚  Basement office' : '🏙  Corner office');
  window.__tier = tier;
  return tier;
}
function toggleFitout() { return setFitout(office.tier === 'corner' ? 'basement' : 'corner'); }
window.__tier = office.tier;

/* L29 OFFICE SKIN — cycle the room's look: stylized-3D (default) → smooth-diffusion → charm-diffusion.
   The skin is a 2.5D backplate inside office.js; here we just drive + announce + expose the choice
   (the SAME path for the `J` key, the viewer bar, and `?officeskin=`). Default stays 3d (no surprise). */
const OFFICE_SKINS = ['3d', 'dressed2', 'night2', 'modern', 'charm'];   // L59: 4 ControlNet skins + stylized-3D
const SKIN_LABEL = { '3d': '🧊  Stylized 3D office', dressed2: '📚  Dressed office (day)', night2: '🌙  Night office', modern: '🏙  Modern office (day)', charm: '🎨  Charm office' };
function setOfficeSkin(s) {
  const skin = office.setSkin(s);
  window.__officeSkin = skin;
  if (sceneMode !== 'city') officeUI.toast(SKIN_LABEL[skin]);   // toast only when you're in the room
  return skin;
}
function cycleOfficeSkin() { return setOfficeSkin(OFFICE_SKINS[(OFFICE_SKINS.indexOf(office.skin) + 1) % OFFICE_SKINS.length]); }
window.__officeSkin = office.skin;

/* L30 OFFICE PROPS mode — under a diffusion skin, choose whether the desk/laptop/cat/etc. are the
   PAINTED ones (baked in the skin → fully cohesive, but static) reached via invisible hotspots, or the
   live 3D props (animated cat/fish, but they clash with the painting). No skin → always live 3D. */
const PROPS_LABEL = { painted: '🎨  Painted props (cohesive)', '3d': '🧊  Live 3D props (animated)' };
function setOfficeProps(p) {
  const m = office.setProps(p);
  window.__officeProps = m;
  if (sceneMode !== 'city' && office.skin !== '3d') officeUI.toast(PROPS_LABEL[m]);   // only meaningful under a skin
  return m;
}
function toggleOfficeProps() { return setOfficeProps(office.props === 'painted' ? '3d' : 'painted'); }
window.__officeProps = office.props;

/* Mode + camera + style are driven by the keyboard (no UI framework — a listener). The POST/STYLE
   state now lives in the ENGINE (engine.setPostMode / toggleVector / cycleEra / togglePalette +
   engine.mode/vector/sceneEra getters); the rig camera mode (4/5/6) is the rig's. POST modes:
   1 raw · 2 filmic · 3 AUTO zoom-ladder · 7 force pixel · 8 force toon. Boot on 3/AUTO. */
window.__camMode = rig.mode;
if (typeof window !== 'undefined') window.__rig = rig;   // L88 harness handle (like __inspector/__worldApi): read rig.camera.position to confirm WASD pan moved the view
// L88: is the keystroke aimed at a text field? (save-name input, any future field) — if so, let the
// browser have it and never hijack WASD into camera flight. `isContentEditable` covers rich fields.
const isTextTarget = (e) => {
  const t = e.target;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
};
window.addEventListener('keydown', (e) => {
  // L110 (audit P0-4): the text-field guard MUST run before EVERYTHING — the pilot intercept (WASD→throttle), the
  // inspect Enter-possess + WASD-fly, AND the global verbs. It used to sit below the pilot/inspect blocks, so typing a
  // world's save-name (or in the ⌘K search) leaked keys both ways: 'w' flew the craft instead of typing, Esc ejected
  // you mid-word. One early-return at the top closes every leak. (`isContentEditable` covers rich fields.)
  if (isTextTarget(e)) return;
  // L76 PILOT owns WASD/arrows (→ throttle/steer) + Esc (always-available exit) while driving — intercept
  // FIRST. Movement keys are consumed; everything else (T time, 9 auto, 1/2/3 post…) falls through so
  // day/night + the beauty tier still read while you drive (success criterion 5).
  if (piloting) {
    if (e.key === 'Escape') { releasePilot(); e.preventDefault(); return; }
    if (e.key === 'c' || e.key === 'C') { toggleCockpit(); e.preventDefault(); return; }   // L-cockpit: toggle cockpit POV (consumed so it never reaches cycleCityProfile)
    const tok = PILOT_KEY[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (tok) { pilotHold(tok, true); e.preventDefault(); return; }
  }
  // L76: while INSPECTING a pilotable (a followed ATV), Enter / Return possesses it ("drive" the craft).
  if (e.key === 'Enter' && inspecting && !piloting) { tryPossess(); e.preventDefault(); return; }
  // L63 INSPECT MODE owns WASD-fly + Tab-cycle + Esc-release while active — intercept BEFORE the global
  // letter verbs (so 'w' FLIES, not weather). Style/cam/time keys still fall through (not consumed here).
  if (inspecting) {
    const FLY = 2.4;                                  // a brisk pan step → reads as flying through the city
    const k = e.key.toLowerCase();
    if (k === 'w') { rig.pan(0,  FLY); e.preventDefault(); return; }
    if (k === 's') { rig.pan(0, -FLY); e.preventDefault(); return; }
    if (k === 'a') { rig.pan(-FLY, 0); e.preventDefault(); return; }
    if (k === 'd') { rig.pan( FLY, 0); e.preventDefault(); return; }
    // L110 (audit B13): only HIJACK Tab (to cycle inspect targets) when focus is on the 3D scene (the canvas) or
    // nowhere — otherwise let Tab do normal keyboard focus navigation, so the lens being on doesn't trap a keyboard
    // user on whatever control they'd tabbed to. (Mirrors how WASD is already scoped away from text targets.)
    if (e.key === 'Tab' && (document.activeElement === renderer.domElement || document.activeElement === document.body || !document.activeElement)) {
      const f = engine.inspector.cycle(e.shiftKey ? -1 : 1);   // hop to the next/prev followable
      window.__followKind = f ? f.kind : null; window.__followLabel = f ? f.label : null;
      e.preventDefault(); return;
    }
    if (e.key === 'Escape') {
      if (engine.inspector.focus) { engine.inspector.release(); window.__followKind = null; window.__followLabel = null; }
      else toggleInspect();                          // not following → Esc exits the mode
      e.preventDefault(); return;
    }
  }
  // L88 DEFAULT-EXPLORE FREE-FLY — the headline preview fix. Outside pilot/inspect/sculpt, WASD now
  // PANS the camera so "move around the world" works in the open city + the preview-explore view
  // (before this, W cycled weather and S downloaded a screenshot — "WASD keeps taking photos"). We
  // reuse the SAME shared `rig.pan` verb the INSPECT lens flies with (engine-first — one movement
  // primitive, not a fork). Guards: city scene only (office uses arrows for the seated head-turn);
  // not while a text field is focused; not when Shift is held (Shift+W is weather); and not under
  // `?capture` (the director drives the camera itself, and an author's manual S should grab a still).
  if (sceneMode === 'city' && !piloting && !inspecting && !sculpting && !e.shiftKey
      && !_q.has('capture') && !isTextTarget(e)) {
    const FLY = 2.4;                                  // a brisk pan step → reads as flying through the city
    const k = e.key.toLowerCase();
    if (attractActive && 'wasd'.includes(k)) endAttract();   // L106: WASD = explore intent → drop to free control (dismisses the coach)
    if (k === 'w') { rig.pan(0,  FLY); e.preventDefault(); return; }   // forward
    if (k === 's') { rig.pan(0, -FLY); e.preventDefault(); return; }   // back
    if (k === 'a') { rig.pan(-FLY, 0); e.preventDefault(); return; }   // left
    if (k === 'd') { rig.pan( FLY, 0); e.preventDefault(); return; }   // right
  }
  // (L110: the isTextTarget early-return moved to the TOP of this handler — see P0-4 note above.)
  // L74: while the ✎ editor is open, number keys 1–5 are the MODE RAIL (pick tool), not post/cam.
  if (sculpting && '123456'.includes(e.key)) { editor.setToolByKey(e.key); refreshUI(); e.preventDefault(); return; }   // L81: +💧 Water (key 6 = Select)
  if ((e.key === 'i' || e.key === 'I') && sceneMode === 'city') toggleInspect();   // L63: enter/exit the inspection lens
  // L110 (audit B13): Enter/Space seizes during the attract loop OR when the canvas is focused + a seizable craft exists —
  // so the canvas aria-label's promise ("press F or Enter to fly") is TRUE for a keyboard user, not only mid-attract.
  if ((e.key === 'Enter' || e.key === ' ') && !piloting
      && (attractActive || (document.activeElement === renderer.domElement && engine.seizeCraft && engine.seizeCraft.pilot && (sceneMode === 'city' || worldMode)))) {
    flyPossess(); e.preventDefault(); return;
  }
  if ((e.key === 'f' || e.key === 'F') && !piloting && (sceneMode === 'city' || worldMode)) { flyPossess(); e.preventDefault(); }   // L104: FLY → seize the air craft (the city heli)
  if (e.key === '`' && DEV_OK) { setDev(!devMode); e.preventDefault(); return; }   // L104 P3: hidden key — toggle owner Developer Mode
  if (e.key === '1' || e.key === '2' || e.key === '3') setPostMode(Number(e.key));
  if (e.key === '7' || e.key === '8') setPostMode(Number(e.key));
  if (e.key === '4') { rig.setMode(CAM.PERSPECTIVE); window.__camMode = rig.mode; }
  if (e.key === '5') { rig.setMode(CAM.ISOMETRIC);   window.__camMode = rig.mode; }
  if (e.key === '6') { rig.setMode(CAM.DIMETRIC);    window.__camMode = rig.mode; }
  // Arrow keys: in the OFFICE dive they turn the seated head (L55, held → continuous in the tick); in the
  // city they pan the rig's look-at target across the ground plane (damped in the rig).
  if (sceneMode === 'office' && LOOK_KEY[e.key]) { lookKeys[LOOK_KEY[e.key]] = true; e.preventDefault(); return; }
  if (attractActive && e.key.startsWith('Arrow')) endAttract();   // L106: arrow-key move during attract = explore intent → free control
  if (e.key === 'ArrowLeft')  { rig.pan(-1,  0); e.preventDefault(); }
  if (e.key === 'ArrowRight') { rig.pan( 1,  0); e.preventDefault(); }
  if (e.key === 'ArrowUp')    { rig.pan( 0,  1); e.preventDefault(); }
  if (e.key === 'ArrowDown')  { rig.pan( 0, -1); e.preventDefault(); }
  if (e.key === '0') toggleVector();                                                                   // flat-vector style
  // L88: weather moved off plain `W` (now WASD free-fly) to SHIFT+W — it also has a viewer-bar button.
  // L95: keymap + bus both call the SAME action helpers (cycleWeather/cycleSeason/contextualReroll) → no drift.
  if ((e.key === 'w' || e.key === 'W') && e.shiftKey) cycleWeather();   // weather cycle (Shift+W)
  if (e.key === 'k' || e.key === 'K') cycleSeason();                    // season cycle
  if ((e.key === 'g' || e.key === 'G')) contextualReroll();            // 🎲 reroll — contextual (no-op mid-Hoard)
  if ((e.key === 'z' || e.key === 'Z') && worldMode) engine.world.undo();   // L70: undo the last sculpt stroke
  if ((e.key === 'e' || e.key === 'E') && worldMode) {                      // L82: toggle EROSION (rain → rivers carve themselves)
    const on = !engine.world.flowErosionOn; engine.world.flowErosion(on, 1.0); window.__erosion = on;
    if (viewerUI) viewerUI.setStyleHint && viewerUI.setStyleHint(on ? 'erosion ON — rain to carve rivers' : '');
  }
  if (e.key === 'c' || e.key === 'C') cycleCityProfile();        // cycle city profile (no-op mid-Hoard)
  if (e.key === 'h' || e.key === 'H') toggleShadows();           // sun shadows (L97: shared helper, also the bar button)
  if (e.key === 'p' || e.key === 'P') toggleTheme();             // theme swap (L97: shared helper, also the bar button)
  if (e.key === 'b' || e.key === 'B') cycleEra();                // cycle PixelKit eras
  // --- DAY/NIGHT controls (L09) ---
  if (e.key === 't' || e.key === 'T') sunRig.cyclePreset();      // dawn→noon→dusk→night
  if (e.key === '[') sunRig.nudge(-0.5);                          // scrub −30 min
  if (e.key === ']') sunRig.nudge( 0.5);                          // scrub +30 min
  if (e.key === '9') toggleSunAuto();                            // slow auto day/night cycle
  // L90 H12: Esc exits the ✎ sculpt/editor brush — it's a `city` sub-mode, so without this it fell through
  // to exitOffice() (a no-op), breaking the universal-escape convention every other mode honours.
  if (e.key === 'Escape' && sculpting) { toggleSculpt(); e.preventDefault(); return; }
  // L19 OFFICE-DIVE: Esc exits the Hoard, else exits the office.
  if (e.key === 'Escape') { if (sceneMode === 'hoard') exitHoard(); else exitOffice(); }
  if (e.key === 'o' || e.key === 'O') { if (sceneMode === 'city') enterOffice(); else exitOffice(); }
  if (e.key === 'x' || e.key === 'X') { if (sceneMode === 'hoard') exitHoard(); else if (sceneMode === 'city') enterHoard(); }  // L32: toggle the Hoard
  // L23: F swaps the office FITOUT (corner ⇄ basement) — only meaningful while inside the office.
  if ((e.key === 'f' || e.key === 'F') && sceneMode !== 'city' && sceneMode !== 'hoard') toggleFitout();   // B13: guard hoard mode (was: !==city only, so Hoard-F triggered a confusing fitout toast)
  if (e.key === 'j' || e.key === 'J') cycleOfficeSkin();        // L29: cycle the office skin (3d→smooth→charm)
  if (e.key === 'u' || e.key === 'U') toggleOfficeProps();      // L30: painted ↔ live-3D props (under a skin)
  // L20: M minimizes / restores the viewer bar (so you can watch the scene unobstructed).
  if (e.key === 'm' || e.key === 'M') { if (viewerUI) viewerUI.toggle(); }
});
// L55: release the office look-around arrow keys (held-key state cleared on keyup).
window.addEventListener('keyup', (e) => {
  if (LOOK_KEY[e.key]) lookKeys[LOOK_KEY[e.key]] = false;
  // L76: release the held throttle/steer token (so the ATV coasts to a stop when you let go).
  if (piloting) { const tok = PILOT_KEY[e.key.length === 1 ? e.key.toLowerCase() : e.key]; if (tok) pilotHold(tok, false); }
});

/* prefers-reduced-motion → freeze the auto-cycle (WCAG 2.3.1: don't animate the whole
   screen on a fast loop). Presets and nudge still work — those are discrete, not motion. */
const reduceMQ = window.matchMedia('(prefers-reduced-motion: reduce)');
sunRig.setReducedMotion(reduceMQ.matches);
reduceMQ.addEventListener('change', (e) => sunRig.setReducedMotion(e.matches));

/* 9) INPUT — two jobs sharing the pointer, split by button:
     LEFT-drag  → poke the WATER (raycast the plane, inject a ripple) — unchanged.
     RIGHT-drag → ORBIT the rig. We suppress the context menu so the right button
                  is ours. Both feed the SAME rig the renderer reads.
     wheel      → zoom (rig decides dolly-vs-zoom by projection).
     touch      → 1 finger ripples, 2 fingers orbit + pinch-zoom (mobile path).
   The raycaster takes whatever camera the rig is in, so ripples keep working in
   the orthographic iso/dimetric modes too (parallel rays — Three handles it). */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

/* L55 WATER RAILS — keep ripples IN the water. The coastline (citygen) is a closed world-space polygon
   (`city.state.coast.points`, an array of THREE.Vector2 in x/z); LAND is INSIDE it, WATER is outside. So a
   poke is only injected when its world hit-point is OUTSIDE the polygon. Classic ray-casting point-in-polygon
   (count edge crossings of a ray to +∞; odd = inside). Pure + cheap (~112 edges), recomputed only on a poke.
   C++ anchor: a stencil/predicate guarding a buffer write — only inject where `!inLand(p)`. */
// L107: the point-in-polygon land test now lives in engine-core (city.isLand) so the pilot water sampler +
// downwash + collision all share it (do-once). This thin wrapper keeps the L55 water-rails call sites unchanged.
function pointInLand(x, z) { return city.isLand(x, z); }
let poking = false;                 // left-drag: rippling the water
let orbiting = false;               // right-drag: orbiting the rig
let lastX = 0, lastY = 0;           // previous pointer pos, for orbit deltas
const ORBIT_SPEED = 0.005;          // radians per pixel dragged

/* L55 LOOK-AROUND IN THE DIVE — the seated free-look (office.look = createSeatedLook, L51) is built in core
   and wired on the standalone /office/ page, but the CITY-DIVE path never wired its INPUT (stale-wiring, the
   same class as L54's white windows). Port it here: while sceneMode==='office', a pointer DRAG turns the head
   (a small press+release stays a click on the laptop/phone/cat — same press-vs-drag discrimination the dive
   already uses), held arrow keys turn it, and the look recenters on exit so a fresh dive starts forward. */
let looking = false, lookDragging = false, lookLX = 0, lookLY = 0;   // office left-drag head-turn state
const lookKeys = { left: false, right: false, up: false, down: false };
const LOOK_KEY = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };

const setPointer = (cx, cy) => {
  pointer.x =  (cx / window.innerWidth)  * 2 - 1;
  pointer.y = -(cy / window.innerHeight) * 2 + 1;
};

/* L33 HOARD helpers — (a) AIM: the cursor's point on the ground plane (desktop ranged aim);
   (b) OCCLUDER FADE: the iso follow-cam can hide the survivor behind towers, so each frame we cast a
   few rays camera→player and alpha-DOWN any building they pass through — a per-frame visibility query
   that keeps the player + nearby zombies readable (the playability fix). C++: a ray/visibility query
   over the scene, then write the result (here: lower the occluder's alpha). */
const hoardRay = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(0.3 + 0.02));   // y = GROUND_Y
const _aimPt = new THREE.Vector3(), _camToP = new THREE.Vector3(), _chest = new THREE.Vector3(), _wp = new THREE.Vector3();
// L110 (audit B12): the wave-sim water is a flat PlaneGeometry at y=0. The ripple poke used to intersectObject()
// the ~130k-tri water MESH every frame while dragging (BVH-less brute force). A ray-PLANE intersect against y=0 is
// O(1) and the CPU geometry IS exactly this plane, so the sim-UV is identical. UV: PlaneGeometry(W,W) rotated
// rotation.x=-PI/2 maps world (x,z) → u = x/W + 0.5, v = 0.5 - z/W (derived + matches the old hit.uv).
const waterPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const WATER_SIZE = water.geometry.parameters.width;   // the PlaneGeometry span (world units)
const _pokePt = new THREE.Vector3();
const _faded = new Set();
/* L34 ARENA READABILITY — on entering Hoard we OPEN a base PLAZA by hiding the (tallest, densest)
   downtown buildings within a radius, so the survivor + horde + barriers play in clear, character-scale
   space instead of being lost among towers. Restored on exit. (Reuses the city as the arena — we just
   suppress the central towers for the game mode.) */
const _plazaHidden = new Set();
const PLAZA_R = 6.5;                                // radius of the cleared base plaza
function clearPlaza(r) {
  city.group.traverse((o) => {
    if (!o.isMesh || o.userData.ground || !o.visible) return;
    o.getWorldPosition(_wp);
    if (Math.hypot(_wp.x, _wp.z) < r) { o.visible = false; _plazaHidden.add(o); }
  });
}
function restorePlaza() { for (const o of _plazaHidden) o.visible = true; _plazaHidden.clear(); }
function restoreOccluders() {
  for (const m of _faded) {
    if (!m.material) continue;
    m.material.opacity = 1; m.material.transparent = !!m.userData._wasT; m.material.depthWrite = m.userData._wasDW !== false;
  }
  _faded.clear();
}
function updateOccluders(P) {
  restoreOccluders();
  const cam = rig.camera;
  for (const [ox, oz] of [[0, 0], [0.7, 0.4], [-0.7, 0.4]]) {           // a few rays → fade side-occluders too
    _chest.set(P.x + ox, 0.6, P.z + oz);
    _camToP.subVectors(_chest, cam.position);
    const dist = _camToP.length();
    hoardRay.set(cam.position, _camToP.normalize());
    hoardRay.far = dist - 0.4;
    for (const h of hoardRay.intersectObject(city.group, true)) {
      const m = h.object;
      if (!m.material || m.userData.ground || _faded.has(m)) continue;
      m.userData._wasT = m.material.transparent; m.userData._wasDW = m.material.depthWrite;
      m.material.transparent = true; m.material.opacity = 0.16; m.material.depthWrite = false;
      _faded.add(m);
    }
  }
}

/* L19 building PICK — a left CLICK (down+up with little movement) on a building enters the
   office; a left DRAG still ripples the water. We disambiguate by movement+time, so the dive
   and the ripple share the left button without fighting. `pickBuilding` raycasts the CITY group
   only (not the water/backdrop), so clicking the bay just ripples. Returns the screen-UV of the
   hit so the dive can zoom toward exactly where you clicked. */
let downX = 0, downY = 0, downT = 0;
function pickBuilding() {
  raycaster.setFromCamera(pointer, rig.camera);
  const hit = raycaster.intersectObject(city.group, true)[0];
  if (!hit) return null;
  return new THREE.Vector2(pointer.x * 0.5 + 0.5, pointer.y * 0.5 + 0.5);  // NDC → screen UV
}

/* L22 OFFICE PICK — the same hit-test as the building-pick, but against the OFFICE props (through
   the office camera). Walk up to the object carrying `userData.role` (laptop / phone / cat) and
   return that role; main dispatches a `switch` on it. (C++: a hit-test returns an entity, then a
   switch on its kind — exactly the Phase-A pattern, re-pointed at the room.) */
function pickOfficeRole() {
  raycaster.setFromCamera(pointer, office.camera);
  const hit = raycaster.intersectObjects(office.interactables, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o && !o.userData.role) o = o.parent;
  return o ? o.userData.role : null;
}

renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  // L-cockpit: right-drag while piloting feeds cockpit head-turn — bypasses the piloting guard below.
  if (piloting && e.button === 2) { pilotLooking = true; lastX = e.clientX; lastY = e.clientY; e.preventDefault(); return; }
  if (piloting) return;                                 // L76: the chase cam is locked while driving (drive via keys / the HUD d-pad)
  if (e.button === 0) {
    poking = sceneMode === 'city' && !inspecting && !sculpting;  // L63/L69: inspect orbits/follows, sculpt brushes — not poke
    setPointer(e.clientX, e.clientY); downX = e.clientX; downY = e.clientY; downT = performance.now();
    if (sceneMode === 'hoard') hoard.setFiring(true);                 // L33: hold-to-fire the ranged weapon
    if (sceneMode === 'office') { looking = true; lookDragging = false; lookLX = e.clientX; lookLY = e.clientY; }   // L55: arm head-turn
    if (inspecting) { orbiting = true; lastX = e.clientX; lastY = e.clientY; }   // L63: left-drag orbits around the followed object
    if (sculpting) {   // L74: a press opens an undo transaction (editor.beginStroke), then routes by tool — Select picks, the rest brush
      sculptStroke = e.shiftKey ? -1 : editor.dir; editor.beginStroke();
      if (editor.tool === 'select') { setPointer(e.clientX, e.clientY); engine.inspector.pickAt(pointer.x, pointer.y); }
      else sculptAt(e.clientX, e.clientY, sculptStroke);
    }
  }
  if (e.button === 2) { orbiting = true; lastX = e.clientX; lastY = e.clientY; }  // right-drag orbits (also while sculpting)
});
window.addEventListener('mousemove', (e) => {
  // L-cockpit: feed right-drag deltas to the pilot head-turn (bypasses the piloting guard below).
  if (pilotLooking && piloting) { engine.pilot.addLookDrag(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; return; }
  if (piloting) return;                                 // L76: no orbit/hover while driving
  if (poking) setPointer(e.clientX, e.clientY);
  if (orbiting) {
    // "grab and turn": drag right spins the world right (azimuth down); drag up
    // lifts the eye over the top (elevation up). Signs chosen to feel natural.
    rig.orbit(-(e.clientX - lastX) * ORBIT_SPEED, -(e.clientY - lastY) * ORBIT_SPEED);
    lastX = e.clientX; lastY = e.clientY;
  } else if (sculpting) {
    // L69: track the brush ring on the terrain; if a stroke is held (LMB), keep stamping the heightfield.
    sculptAt(e.clientX, e.clientY, sculptStroke);
  } else if (sceneMode === 'city' && !poking && !inspecting) {
    // hover affordance: pointer cursor over a clickable building (cheap raycast per move).
    setPointer(e.clientX, e.clientY);
    renderer.domElement.style.cursor = pickBuilding() ? 'pointer' : 'default';
  } else if (sceneMode === 'office') {
    if (looking) {
      // L55: a drag past the threshold turns the seated head (deltas fed to office.look). Below the
      // threshold it stays a click candidate (handled on mouseup), so the laptop/phone/cat still work.
      if (!lookDragging && Math.hypot(e.clientX - downX, e.clientY - downY) > 6) lookDragging = true;
      if (lookDragging) { office.look.addDrag(e.clientX - lookLX, e.clientY - lookLY); renderer.domElement.style.cursor = 'grabbing'; }
      lookLX = e.clientX; lookLY = e.clientY;
    } else {
      // hover affordance: pointer cursor over a clickable prop (laptop / phone / cat).
      setPointer(e.clientX, e.clientY);
      renderer.domElement.style.cursor = pickOfficeRole() ? 'pointer' : 'grab';
    }
  } else if (sceneMode === 'hoard') {
    setPointer(e.clientX, e.clientY);                                  // L33: keep the ranged aim on the cursor
  }
});
window.addEventListener('mouseup', (e) => {
  if (pilotLooking) { pilotLooking = false; return; }   // L-cockpit: end right-drag head-turn
  if (piloting) return;                                 // L76: clicks don't follow/dive while driving
  if (sceneMode === 'hoard') hoard.setFiring(false);                   // L33: stop firing on release
  const isClick = Math.hypot(e.clientX - downX, e.clientY - downY) < 6 && performance.now() - downT < 350;
  // a quick, still left-click on a building → DIVE IN (otherwise it was a water ripple).
  if (inspecting && isClick) {
    // L63: a still click in inspect mode → FOLLOW the nearest world object (or release on empty).
    setPointer(e.clientX, e.clientY);
    const f = engine.inspector.pickAt(pointer.x, pointer.y);
    if (!f) engine.inspector.release();
    window.__followKind = f ? f.kind : null; window.__followLabel = f ? f.label : null;
  } else if (poking && sceneMode === 'city' && isClick) {
    setPointer(e.clientX, e.clientY);
    const focus = pickBuilding();
    if (focus) enterOffice(focus);
  } else if (sceneMode === 'office' && isClick) {
    // L22: click an office prop → run its interaction (phone travel / pet cat / feed fish).
    setPointer(e.clientX, e.clientY);
    const role = pickOfficeRole();
    if (role === 'phone') travelCity();
    else if (role === 'cat') office.petCat();
    else if (role === 'tank') office.feedFish();
  }
  poking = false; orbiting = false; looking = false; lookDragging = false; sculptStroke = 0;   // L55/L69: end head-turn / sculpt stroke
});

renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (attractActive) endAttract();                      // L106: scroll/zoom = explore intent → drop to free control (dismisses the coach)
  if (piloting) return;                                 // L76: chase distance is fixed by the craft profile while driving
  if (sculpting) {   // L69/L74: the wheel SIZES the brush (not zoom) while editing — radius now lives on the editor
    editor.setRadius(editor.brush.radius * Math.exp(-e.deltaY * 0.0012));
    brushRing.scale.setScalar(editor.brush.radius);
    return;
  }
  // deltaY > 0 (scroll down) → factor > 1 → zoom OUT; up → factor < 1 → zoom IN.
  rig.zoomBy(Math.exp(e.deltaY * 0.0015));
}, { passive: false });

/* TOUCH — minimal multitouch: one finger pokes the water; two fingers orbit by
   their midpoint motion and pinch-zoom by the change in spread. (Written to spec;
   verify on a real touch device — the desktop browser used for QA can't.) */
let pinchDist = 0;
const touchMid = (t0, t1) => [(t0.clientX + t1.clientX) / 2, (t0.clientY + t1.clientY) / 2];
const touchDist = (t0, t1) => Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
let tapMoved = false;   // L22: a one-finger TAP (no drag) acts like a left-click (enter office / a prop)
renderer.domElement.addEventListener('touchstart', (e) => {
  // VIZ MOBILE: cockpit one-finger look — arm BEFORE the piloting early-return (must not conflict with d-pad/lift).
  if (piloting && _cockpitActive && e.touches.length === 1) {
    cockpitTouchId = e.touches[0].identifier;
    lastX = e.touches[0].clientX; lastY = e.touches[0].clientY;
    e.preventDefault(); return;
  }
  if (piloting) return;                                 // L76: drive via the on-screen d-pad (its own DOM listeners), not the canvas
  if (e.touches.length === 1) {
    poking = sceneMode === 'city' && !sculpting;        // L69: in sculpt mode a one-finger drag brushes, not ripples
    setPointer(e.touches[0].clientX, e.touches[0].clientY);
    downX = e.touches[0].clientX; downY = e.touches[0].clientY; downT = performance.now(); tapMoved = false;
    if (sceneMode === 'office') { looking = true; lookDragging = false; lookLX = downX; lookLY = downY; }   // L55: arm head-turn (touch)
    if (sculpting) {   // L74: touch press → open undo transaction, then route by tool (no Shift on touch; the dir toggle is the 2nd action)
      sculptStroke = editor.dir; editor.beginStroke();
      if (editor.tool === 'select') { setPointer(downX, downY); engine.inspector.pickAt(pointer.x, pointer.y); }
      else sculptAt(downX, downY, sculptStroke);
    }
  }
  if (e.touches.length === 2) {
    poking = false; orbiting = true;
    [lastX, lastY] = touchMid(e.touches[0], e.touches[1]);
    pinchDist = touchDist(e.touches[0], e.touches[1]);
  }
}, { passive: false });
renderer.domElement.addEventListener('touchmove', (e) => {
  e.preventDefault();
  // VIZ MOBILE: cockpit look — route drag to addLookDrag BEFORE the piloting early-return.
  if (piloting && _cockpitActive && cockpitTouchId !== null) {
    for (let i = 0; i < e.touches.length; i++) {
      if (e.touches[i].identifier === cockpitTouchId) {
        engine.pilot.addLookDrag(e.touches[i].clientX - lastX, e.touches[i].clientY - lastY);
        lastX = e.touches[i].clientX; lastY = e.touches[i].clientY;
        return;
      }
    }
  }
  if (piloting) return;                                 // L76: no canvas-drag while driving
  if (e.touches.length === 1) {
    const tx = e.touches[0].clientX, ty = e.touches[0].clientY;
    setPointer(tx, ty);
    if (Math.hypot(tx - downX, ty - downY) > 8) tapMoved = true;
    if (sculpting) { sculptAt(tx, ty, sculptStroke); }   // L69: one-finger drag brushes the terrain
    // L55: in the office dive, a one-finger drag turns the seated head (a still tap stays a prop tap).
    if (sceneMode === 'office' && looking) {
      if (!lookDragging && Math.hypot(tx - downX, ty - downY) > 8) lookDragging = true;
      if (lookDragging) office.look.addDrag(tx - lookLX, ty - lookLY);
      lookLX = tx; lookLY = ty;
    }
  } else if (e.touches.length === 2) {
    const [mx, my] = touchMid(e.touches[0], e.touches[1]);
    rig.orbit(-(mx - lastX) * ORBIT_SPEED, -(my - lastY) * ORBIT_SPEED);
    lastX = mx; lastY = my;
    const d = touchDist(e.touches[0], e.touches[1]);
    if (pinchDist > 0) rig.zoomBy(pinchDist / d); // fingers apart → factor<1 → zoom in
    pinchDist = d;
  }
}, { passive: false });
window.addEventListener('touchend', (e) => {
  // VIZ MOBILE: clear cockpit touch tracker BEFORE the piloting early-return.
  if (cockpitTouchId !== null) { cockpitTouchId = null; }
  if (piloting) return;                                 // L76: taps don't follow/dive while driving
  // a quick, still ONE-finger tap = a click: follow (inspect) / enter the office (city) or run a prop (office).
  if (!tapMoved && performance.now() - downT < 350 && (!e.touches || e.touches.length === 0)) {
    if (inspecting) {                                  // L70: wire inspect tap-to-follow on TOUCH (the L63 gap)
      const f = engine.inspector.pickAt(pointer.x, pointer.y);
      if (!f) engine.inspector.release();
      window.__followKind = f ? f.kind : null; window.__followLabel = f ? f.label : null;
    } else if (sceneMode === 'city' && !sculpting && !worldMode) { const f = pickBuilding(); if (f) enterOffice(f); }   // L69: no building-dive while sculpting/in a world
    else if (sceneMode === 'office') {
      const role = pickOfficeRole();
      if (role === 'phone') travelCity(); else if (role === 'cat') office.petCat(); else if (role === 'tank') office.feedFish();
    }
  }
  poking = false; orbiting = false; pinchDist = 0; looking = false; lookDragging = false; sculptStroke = 0;   // L55/L69: end head-turn / sculpt stroke
  if (e.touches && e.touches.length === 1) { poking = true; } // dropped to one finger
});

/* 10) RENDER LOOP — sim → grab → beauty → post chain (per the current mode). The loop skeleton (rAF + pause/
   context skip + frameStart/timer/dt-clamp/frameEnd) is now owned by the shell (createAppShell above). */

/* (the FPS probe + decideStyle + styleHintName now live in the engine — L39; the app calls engine.decideStyle()
   each frame and engine.styleHintName(style) for the viewer hint.) */

/* Clock in the hint bar — only rewrite the DOM when the HH:MM string changes.
   The static `.hint` footer is the DESKTOP key list. We hide it when: DEMO mode (no branding), a
   clean embed (`?ui=0`), or a TOUCH device (L31 — the key list is meaningless on a phone, and the
   tap-bar covers discovery there). `_q`/`DEMO` are set up top; the matching `showUI` for the viewer
   bar is recomputed identically at the createViewerUI call below. */
const _showHintUI = _q.get('ui') !== '0' && !_q.has('capture');
const _coarsePointer = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
const _hideHint = DEMO || !_showHintUI || _coarsePointer;
const hintEl = _hideHint ? null : document.querySelector('.hint');   // L114: the shell already applied the DOM hide (its footer rule == this _hideHint); we keep _hideHint only to null hintEl so the clock skips a hidden bar
const baseHint = hintEl ? hintEl.textContent : '';
let lastClock = '';
let cityLabel = '';                                 // "seed 1234 · manhattan", set by cityHint()
// L-N (SITE finding 2026-07-10): the bare /live/ URL is a PROSPECT surface, and `seed 1234 · manhattan`
// reads as internal dev telemetry to them. Reclassify under the profile gate: AUTHOR keeps the full
// seed·profile·clock line (owner needs it); PRESENT gets the prospect-clean line — the helpful controls
// hint + the time-of-day clock, WITHOUT the seed/profile internals. Taste call: keep the clock (it's
// ambient/atmospheric, not telemetry), drop only the seed·profile. AUTHOR is byte-identical to before.
const _hintAuthor = app.mode.can('editorChrome');   // AUTHOR only; PRESENT + ?preview → false
function updateClock(clock) {
  if (!hintEl || clock === lastClock) return;
  lastClock = clock;
  hintEl.textContent = _hintAuthor
    ? `${baseHint} · ${cityLabel} · ${clock}`
    : `${baseHint} · ${clock}`;
}
// Refresh the city label (seed + profile) in the hint after a reroll / profile cycle.
function cityHint() {
  cityLabel = `seed ${city.state.seed} · ${city.state.profile.name}`;
  window.__profile = city.state.profile.key;
  lastClock = '';                                   // force updateClock to rewrite next frame
}
cityHint();

// L114 app-shell: `frame` is the city loop BODY. The shell wraps it (pause/context skip → frameStart → timer.update
// → dt-clamp → BODY → frameEnd → rAF, byte-for-byte the old tick skeleton) and runs it via shell.start(frame) at boot
// (line kept at the old tick() invocation site so the boot ORDER — preview/attract/seize setup THEN loop — is exact).
// dt + t (elapsed) come from the shell's timer; the body below is byte-identical to the old tick body.
const frame = (dt, t) => {
  if (attractActive && !_reduceMotion) rig.orbit(dt * 0.08, 0);   // L104 P2: slow cinematic orbit while the attract-loop frames the heli (item 8: GATED under reduced-motion → camera held still)
  if (devMode) devMode.update(dt);                                 // L104 P3: dev-mode toys (reads telemetry/profiler/governor; gizmos draw only when their toy is on)
  // L32: in Hoard mode, step the game (player + horde) and aim the camera at the player BEFORE the
  // rig damps this frame, so the follow is smooth. (night is read from last frame — fine, it eases.)
  if (sceneMode === 'hoard') {
    hoard.setAzimuth(rig.azimuth);
    // desktop ranged AIM: the cursor's point on the ground (last-frame camera is fine — it eases).
    if (!coarse) { raycaster.setFromCamera(pointer, rig.camera); if (raycaster.ray.intersectPlane(groundPlane, _aimPt)) hoard.setAim(_aimPt.x, _aimPt.z); }
    hoard.update(dt, t, sunRig);
    rig.setTarget(hoard.player.x, 0.6, hoard.player.z);
  }
  // L76 PILOT — step the possessed craft (input axes → the MovementModel → its transform) and swing the
  // chase cam to behind the heading, BEFORE the rig damps this frame (same ordering as the Hoard follow), so
  // the camera eases toward the craft's NEW pose the same frame. The piloted entity's own idle/park loop sits
  // out via its `piloted` gate (it runs inside updateWorld, after this). If the controller released itself, sync.
  if (piloting) { engine.pilot.step(dt, pilotAxes); if (!engine.pilot.active) { piloting = false; window.__piloting = false; refreshPilotHUD(); } }
  else if (heroActive) heroUpdate(dt);                  // L79: the scripted hero drives the possessed craft + chase cam
  rig.update(dt);
  // L-audio-full-layer-slice1: update positional source positions + rotor gain (after rig + pilot, before render).
  if (_audioTick) _audioTick(dt);
  if (sceneMode === 'hoard') updateOccluders(hoard.player);            // L33: fade towers between the camera + player

  // --- inject a drop where the pointer is poking (city mode only) — set uMouse BEFORE updateWorld's
  //     SIM PASS (the engine's world-step runs the wave sim, which reads this poke). ---
  let strength = 0;
  if (poking && sceneMode === 'city') {
    raycaster.setFromCamera(pointer, rig.camera);
    // L110 (audit B12): ray-PLANE hit on the y=0 water surface (was a per-frame 130k-tri mesh raycast). Bounds-check
    // to the plane's extent, then the analytic sim-UV. L55 WATER RAILS: only inject on OPEN WATER (`pointInLand`
    // tests the world x/z against the coastline polygon) — a tap on the island/land injects nothing.
    if (raycaster.ray.intersectPlane(waterPlane, _pokePt)
        && Math.abs(_pokePt.x) <= WATER_SIZE / 2 && Math.abs(_pokePt.z) <= WATER_SIZE / 2
        && !pointInLand(_pokePt.x, _pokePt.z)) {
      simMaterial.uniforms.uMouse.value.set(_pokePt.x / WATER_SIZE + 0.5, 0.5 - _pokePt.z / WATER_SIZE);
      strength = 0.06;
    }
  }
  simMaterial.uniforms.uMouseStrength.value = strength;
  if (typeof window !== 'undefined') window.__pokeStrength = strength;   // harness probe (L55 water-rails)

  // --- THE UNIVERSAL WORLD-STEP (L39, in the engine): sun + weather + cityLife/water/clouds + fog/
  //     season + fps + the wave SIM PASS. The app passes its shadow toggle + current season stop. ---
  engine.updateWorld(dt, t, { shadowsOn, seasonTarget: SEASON_STOPS[seasonStep] });
  updateClock(sunRig.clock);                       // app-owned hint bar (DOM)

  // Decide the style for this frame (engine; also scales the water's refraction colour-split) and
  // tell the viewer UI the look name (empty in the office — no city style on screen there).
  const style = decideStyle();
  if (viewerUI) viewerUI.setStyleHint(sceneMode === 'city' ? styleHintName(style) : '');

  // L63 INSPECT — drop a focus that went inactive (its car got thinned out / cloud recycled) and feed
  // the behaviour overlay: the live readout while following, else a prompt while flying, else nothing.
  if (inspecting && !piloting) {                          // L76: while driving, the pilot owns the readout/HUD, not inspect
    engine.inspector.prune();
    const r = engine.inspector.readout;
    window.__followKind = r ? r.kind : null; window.__followLabel = r ? r.label : null;
    // harness probes: the followed object's world pos + the live camera pos (so a test can confirm the
    // camera actually TRACKS the moving object). Cheap; same convention as the other window.__ probes.
    if (engine.inspector.focus) { engine.inspector.focus.getWorldPos(_inspScratch); window.__followObjPos = [_inspScratch.x, _inspScratch.y, _inspScratch.z]; window.__camPos = [rig.camera.position.x, rig.camera.position.y, rig.camera.position.z]; }
    if (viewerUI) viewerUI.setInspect(r || { hint: 'click a car · person · bird · boat · cloud to follow it' });
  } else if (viewerUI) viewerUI.setInspect(null);

  // L76: keep the pilot HUD in sync — the "Drive" prompt when following a pilotable, the speed while driving.
  refreshPilotHUD();
  if (tourActive) tourUpdate(dt);                       // L79: advance the guided-tour captions / day sweep

  // --- L60 SCENE-MODE: advance the city↔office dive (module-owned) unless we're in the Hoard; the
  //     module's mode drives our sceneMode for the four city/office states. ---
  if (sceneMode !== 'hoard') {
    dive.update(dt);
    sceneMode = MODE_MAP[dive.mode]; window.__scene = sceneMode;
  }

  if (sceneMode === 'city' || sceneMode === 'hoard') {
    // CITY (or the L32 HOARD arena — same scene + post chain, the player/horde are in the scene and
    // the camera follows the player) — the L06–L08 pipeline straight to the screen.
    renderCityPipeline(style, null);
  } else {
    // OFFICE / DIVE — not a city frame; clear __style so it never carries a stale stylized value
    // off-city (F1 label-truth: the city pipeline writes __style every frame it runs; off-city we clear).
    window.__style = '';
    // render the room's "window" texture first (so it's alive), then draw the room
    // (and the crossfade if diving). The CORNER fitout's window is the live city; the BASEMENT
    // fitout's "window" is the little vignette diorama. We render only the active tier's source.
    office.update(dt, t, sunRig);   // sunRig → the cat sleeps at night, wakes by day
    office.look.addKeys(dt, lookKeys);               // L55: held arrow-keys turn the seated head (dive look-around)
    window.__lookYaw = office.look.yaw; window.__lookPitch = office.look.pitch;   // L51 harness probes (now in city too)
    if (office.tier === 'basement') {
      renderer.setRenderTarget(vignetteRT);
      renderer.render(office.vignette.scene, office.vignette.camera);
    } else if (_winFrame % WIN_EVERY === 0) {
      renderCityBeautyTo(windowCam, cityWindowRT);     // L40 WIN B: glass city at ~1/3 rate (it's a background)
    }
    _winFrame++;

    if (sceneMode === 'office') {
      renderer.setRenderTarget(null);
      renderer.render(office.scene, office.camera);
    } else {
      // transition: city pipeline → cityScreenRT (source A) · office → officeScreenRT (source B) · the
      // scene-transition material presents the focus push-in + crossfade to the screen (uT set in update()).
      renderCityPipeline(style, cityScreenRT);
      renderer.setRenderTarget(officeScreenRT);
      renderer.render(office.scene, office.camera);
      runPass(dive.material, null);
    }
  }

};   // L114: end of the `frame` body — the shell adds frameEnd + rAF (and owns the pause-on-hidden DOM wiring, removed from here).

// L78 headless test hooks — synthesize GPU load to exercise the QualityGovernor ladder + read its level
// (window.__perf is the profiler's live data object; this is the control surface the verify harness pokes).
if (typeof window !== 'undefined') window.__perfCtl = {
  forceLoad: (ms) => engine.profiler.forceLoad(ms),
  get level() { return engine.governor.level; },
  resetQuality: () => engine.governor.reset(),
  gpuTimer: () => engine.profiler.gpuTimerAvailable,
};

/* 12) CAPTURE (L15) — S = still PNG · R = toggle video · ?capture=tour|daycycle|cities = a
   hands-off recorded shot list. We hand the module the few verbs it needs (it reuses, never
   re-implements): the renderer (its canvas is the media source), the rig + sunRig for camera/
   time moves, a `poke` to ripple the water, and a `getState` for filenames. The director drives
   everything else by dispatching the same keydowns the user presses. See src/core/capture.js. */
const poke = {
  at: (cx, cy) => { setPointer(cx, cy); poking = true; },   // start rippling at a screen point
  stop: () => { poking = false; },
};
function captureState() {
  // F1: derive tier from engine.mode directly — a stale __style (e.g. 'pixel' persisting after switching to beauty)
  // must never win. For stylized modes (3/7/8), __style carries the fine-grained label (pixel/toon/blend/auto).
  const style = engine.mode === 1 ? 'raw' : engine.mode === 2 ? 'filmic' : (window.__style || 'auto');
  return { lesson: 23, clock: sunRig.clock, style: (engine.vector ? 'vec-' : '') + style, profile: city.state.profile.key, weather: weatherRig.kind, scene: sceneMode };
}
/* L23: the office verbs the director needs that have NO keyboard binding (the dive/exit/weather DO
   have keys — 'o'/Esc/'W' — and the director dispatches those directly). */
const officeVerbs = {
  pet: () => office.petCat(),
  feed: () => office.feedFish(),
  travel: () => travelCity(),
  fitout: () => toggleFitout(),
};
createCapture({ renderer, rig, sunRig, poke, getState: captureState, office: officeVerbs, world: engine.world, sequences: true });   // L94: world handle → the ?capture=hero sequence drives world-enter + the flow splash. L114: sequences:true → city arms the director (unchanged); office/hoard default false.

/* L95 CONTROL ACTIONS — the INTENT, decoupled from input. A viewer-bar button calls these DIRECTLY; the
   keydown handler calls the SAME functions. Rule: a button must never synthesize a keystroke that some other
   handler re-interprets — that indirection is exactly how the weather button drifted onto WASD-free-fly when
   L88 repurposed `W` (the button fired `W`, which now PANS the camera). Decouple intent (the action) from input
   (the key) so a button can never drift from the keymap again. C++ anchor: call the method directly, don't post
   a synthetic input event for another handler to decode. (`function` declarations hoist → the keydown handler
   above can call these even though they're defined here.) */
function cycleWeather()     { weatherRig.cycle(); window.__weather = weatherRig.kind; }                       // clear→rain→snow→fog
function cycleSeason()      { seasonStep = (seasonStep + 1) % SEASON_STOPS.length; window.__season = SEASON_STOPS[seasonStep]; }  // spring→summer→autumn→winter
function cycleCityProfile() { if (sceneMode === 'hoard') return; profileIndex = (profileIndex + 1) % PROFILES.length; regenerateCity(); }   // next city profile
function contextualReroll() { if (sceneMode === 'hoard') return; if (worldMode) engine.world.reroll(); else { citySeed = (Math.random() * 1e9) | 0; regenerateCity(); } }   // 🎲 new seed (world or city)
function toggleSunAuto()    { sunRig.toggleAuto(); window.__auto = sunRig.auto; }                             // slow auto day/night cycle
function toggleOfficeDive() { if (sceneMode === 'city') enterOffice(); else exitOffice(); }                   // dive into / exit the office
function toggleShadows()    { shadowsOn = !shadowsOn; window.__shadows = shadowsOn; }                         // L97: sun shadows (was key-only H)
function toggleTheme()      { window.__theme = togglePalette(); }                                            // L97: ink/gold ↔ terminal palette (was key-only P)

/* 13) VIEWER CONTROLS (L17) — a tap-friendly bar + shareable URL params, so the live demo works on phones and a
   link can boot a pre-framed view. L95: the bar now calls the ACTION FUNCTIONS DIRECTLY (above) instead of
   synthesizing keydowns — so a button does EXACTLY what its label says and can't drift from the keymap. The bar
   shows by default + in ?demo=1; it hides during ?capture= and when ?ui=0. */
const viewerControls = {
  cam: (m) => { rig.setMode({ iso: CAM.ISOMETRIC, dimetric: CAM.DIMETRIC, persp: CAM.PERSPECTIVE }[m]); window.__camMode = rig.mode; },
  // L55: POST-mode (the crunch chain) and VECTOR (the flat-shade material flag) are INDEPENDENT — the UI exposes
  // them as a radio + a chip, so they compose (Vector + Pixel, etc.). Direct calls into the engine.
  post: (s) => setPostMode({ auto: 3, pixel: 7, toon: 8, none: 1 }[s]),   // 3=auto-LOD 7=pixel 8=toon 1=raw
  vector: () => toggleVector(),          // toggle flat-vector materials
  era: () => cycleEra(),                 // L27: cycle the pixel era (native→GB→8-bit→16-bit→Modern)
  city: () => cycleCityProfile(),        // next city profile
  shuffle: () => contextualReroll(),     // 🎲 new random seed (world or city, by mode)
  weather: () => cycleWeather(),         // cycle clear→rain→snow→fog (L18) — DIRECT (was the W-free-fly drift bug)
  season: () => cycleSeason(),           // cycle spring→summer→autumn→winter (L18)
  office: () => toggleOfficeDive(),      // enter / exit the office-dive (L19)
  officeSkin: () => cycleOfficeSkin(),   // L29: cycle the office skin (3d→smooth→charm)
  officeProps: () => toggleOfficeProps(),// L30: painted ↔ live-3D props (under a skin)
  time: (t) => sunRig.goTo(t),
  auto: () => toggleSunAuto(),           // slow auto day/night cycle
  inspect: () => toggleInspect(),        // L63: enter/exit the inspection lens (free-fly + follow)
  inspectNext: () => { const f = engine.inspector.cycle(1); window.__followKind = f ? f.kind : null; window.__followLabel = f ? f.label : null; },  // L63: tap-friendly "next target"
  mode: (m) => goToMode(m),              // L97: the unified segmented mode-switch (City·World·Office·Hoard)
  shadows: () => toggleShadows(),        // L97: sun shadows on/off (env expander)
  theme: () => toggleTheme(),            // L97: UI palette ink/gold ↔ terminal (env expander)
  world: () => toggleWorld(),            // L64: enter/exit the procedural terrain world
  worldReroll: () => { if (worldMode) engine.world.reroll(); },                  // 🎲 new world
  worldPreset: () => { const ps = engine.world.presets, i = ps.indexOf(engine.world.preset); engine.world.setPreset(ps[(i + 1) % ps.length]); },  // cycle biome preset
  sculpt: () => toggleSculpt(),          // L69/L71: enter/exit the ✎ editor brush
  sculptDir: () => toggleSculptDir(),    // L70: flip the touch/no-mod brush direction (raise ↔ lower)
  editTool: (t) => setEditTool(t),       // L71–L74: pick the tool — 'place'|'sculpt'|'paint'|'scatter'|'select'
  material: (i) => { editor.setMaterial(i); refreshUI(); },    // L71: pick the paint-terrain material (biome index)
  scatterType: (k) => { editor.setScatter(k); refreshUI(); },  // L72: pick the object-brush type (tree | rock | tuft)
  entity: (k) => { editor.setEntity(k); refreshUI(); },        // L73: pick the entity to place
  dropN: (n) => { editor.setDropN(n); refreshUI(); },          // L73: set the drop-count (×1 | ×10 | ×50)
  brushSize: (r) => { editor.setRadius(r); brushRing.scale.setScalar(editor.brush.radius); refreshUI(); },   // L74: control-card brush size
  brushStrength: (s) => { editor.setStrength(s); refreshUI(); },                                             // L74: control-card sculpt strength
  brushDensity: (d) => { editor.setDensity(d); refreshUI(); },                                               // L74: control-card scatter density
  hideScatter: () => { editor.toggleHideScatter(); refreshUI(); },   // L74: 👁 hide-scatter / show-ground toggle
  // L75 save/load transports (engine owns serialize/deserialize; these wire the sinks)
  saveWorld: (n) => saveWorld(n), loadWorld: (n) => loadWorld(n), deleteWorld: (n) => deleteWorld(n),
  exportWorld: (n) => exportWorld(n), importWorld: (f) => importWorld(f), shareLink: () => shareLink(), listWorlds: () => listWorlds(),
  worldUndo: () => { if (worldMode) engine.world.undo(); },     // L70: undo the last sculpt stroke (Z)
  worldReset: () => { if (worldMode) engine.world.reset(); },   // L70: ↺ regenerate the SAME world (discard sculpt) — distinct from 🎲 reroll
  // L67: the "Realistic" showcase preset — one tap to the beauty tier (filmic mode 2, non-vector) so the
  // gorgeous ACES+bloom+graded Preetham sky is the FIRST thing a client sees. Direct engine calls (L95).
  realistic: () => { if (engine.vector) toggleVector(); setPostMode(2); window.__camMode = rig.mode; },
};
// the live state the bar reads to highlight the active style/camera + sync the slider.
const viewerState = () => ({
  cam: { 4: 'persp', 5: 'iso', 6: 'dimetric' }[rig.mode],
  // L55: post-mode (the crunch radio) + vector (the independent chip) reported SEPARATELY. mode 3 = auto-LOD,
  // 7 = pixel, 8 = toon, 1/2 = none (raw/filmic). vector layers on top of whichever.
  post: engine.mode === 7 ? 'pixel' : engine.mode === 8 ? 'toon' : engine.mode === 3 ? 'auto' : 'none',
  vector: engine.vector,
  era: engine.sceneEra,
  auto: sunRig.auto,
  t: sunRig.t,
  weather: weatherRig.kind,
  season: seasonStep,
  // L97: the precise scene mode + world flag → the shell shows mode-contextual controls (office tools only in the
  // office, inspect only in the open city, world tools only in the world). `preview` = a client/preview audience
  // (?preview=…) → the mode-switch hides the personal projects (the Hoard, Office) per the spec §2.
  sceneMode,                                  // 'city' | 'office' | 'hoard' | diving states
  worldMode,                                  // the procedural terrain world is up (a sub-mode of 'city')
  preview: !!(typeof window !== 'undefined' && window.__preview && window.__preview.mode),
  currentMode: currentMode(),                 // L97: 'city'|'world'|'office'|'hoard' → highlight the active switch segment
  audienceModes: audienceModes(),             // L97: which modes the switcher shows (audience-gated)
  shadows: shadowsOn,                         // L97: sun-shadows state (env expander button highlight)
  theme: !!(typeof window !== 'undefined' && window.__theme),   // L97: terminal-palette state (env expander button highlight)
  office: sceneMode !== 'city',
  officeSkin: office.skin,                  // L29: '3d' | 'smooth' | 'charm' (for the bar label)
  officeProps: office.props,                // L30: 'painted' | '3d'
  inspect: inspecting,                      // L63: inspection-lens on/off (for the Inspect button highlight)
  world: worldMode,                         // L64: terrain-world on/off
  worldPreset: engine.world.preset,         // L64: current biome preset (for the chip label)
  realistic: engine.mode === 2 && !engine.vector,   // L67: beauty/realistic tier active (for the chip highlight)
  sculpt: sculpting,                        // L69/L71: editor brush on/off (chip highlight; only shown in world mode)
  sculptRaise: editor.raise,                // L70/L74: brush direction (for the ↑/↓ · add/erase · place/delete label)
  canUndo: worldMode && engine.world.canUndo,  // L70: enable the Undo chip only when there's a stroke to undo
  editTool: editor.tool,                    // L71–L74: active tool id (rail/toggle highlight)
  tools: editor.tools,                      // L74: the mode-rail list [{id,label,icon,key}]
  material: editor.material,                // L71: the selected paint material index
  materials: engine.world.biomes,           // L71: [{key,color}] → the paint palette swatches
  scatterType: editor.scatterType,          // L72: the selected object-brush type (for the palette highlight)
  scatterKinds: engine.catalog.byKind('scatter').map((e) => ({ id: e.id, key: e.defaults.geoKey, label: e.label, icon: e.art.icon })),   // L72: catalog-driven object palette
  entityKind: editor.entity,                // L73: the selected entity to place (palette highlight)
  dropN: editor.brush.dropN,                // L73: the drop-count (×1/×10/×50 chip highlight)
  entityKinds: engine.catalog.byKind('entity').map((e) => ({ key: e.id.replace('ent-', ''), label: e.label, icon: e.art.icon })).filter((e) => editor.placeKinds.includes(e.key)),   // L73: catalog entity palette (world-supported mediums only)
  brushRadius: editor.brush.radius, brushStrength: editor.brush.strength, brushDensity: editor.brush.density, scatterHidden: editor.scatterHidden,   // L74: control-card live values
  saveSlots: listWorlds(), saveStatus: lastStatus,   // L75: save/load panel (slot list + last status line)
});
// I: PRESENT always hides; AUTHOR + !?ui=0 + !?capture shows. ?preview handled by resolveProfile → PRESENT.
const showUI = app.mode.can('editorChrome') && _q.get('ui') !== '0' && !_q.has('capture');
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
viewerUI = createViewerUI({ controls: viewerControls, state: viewerState, show: showUI, coarse });
// I — OWNER badge: always-visible tag when AUTHOR mode is active (shared-screen / screen-cast safety indicator).
if (app.mode.badge) {
  const _b = document.createElement('div');
  _b.id = 'lgr-owner-badge';
  _b.textContent = '◆ OWNER';
  _b.style.cssText = 'position:fixed;top:44px;right:8px;z-index:5;padding:0 10px;height:22px;line-height:22px;border-radius:11px;background:rgba(90,60,200,.82);color:#e8deff;font:700 9px/22px ui-monospace,monospace;letter-spacing:.12em;pointer-events:none;';
  document.body.appendChild(_b);
}

/* Apply the boot URL params (the shareable-link half). `?profile`/`?city` were applied in
   createCity; here we set camera / style / time of day. We drive them through the SAME command
   bus, so a link and a tap take identical code paths. */
// L109 SceneSpec: the SCENE-LOOK URL subset is now parsed + validated ONCE by fromURLParams (one vocabulary,
// isFinite kills ?t=Infinity centrally, ?time overrides ?t, ?style=vector/?vector=1 → the orthogonal vector axis),
// then APPLIED through city's existing viewerControls/sunRig/weatherRig bus so a link and a tap take identical code
// paths AND the viewer UI stays in sync (why city feeds fromURLParams into its bus rather than applySceneSpec, which
// applies straight to the engine). BYTE-IDENTICAL for valid inputs; the one INTENTIONAL delta (Rule 6): an INVALID
// ?time=<garbage> now DROPS (validate-and-drop, consistent with ?style/?cam/?weather) instead of jumping to noon
// (the old `?? 0.5`). Seed/profile stay boot-parsed above (?city/?profile) — the engine-owns-scene refactor is L109's
// deferred follow-up, not smuggled here. The ?world/?office/?edit/… app-flag handling below is untouched (out-of-spec).
const sceneSpec = fromURLParams(_q);
if (sceneSpec.camera) viewerControls.cam(sceneSpec.camera);
if (sceneSpec.post) viewerControls.post(sceneSpec.post);
if (sceneSpec.vector && !engine.vector) viewerControls.vector();
if (sceneSpec.time != null) sunRig.goTo(sceneSpec.time);
if (sceneSpec.weather) { weatherRig.setKind(sceneSpec.weather); window.__weather = weatherRig.kind; }
const skinParam = _q.get('officeskin'); if (['3d', 'smooth', 'charm'].includes(skinParam)) setOfficeSkin(skinParam);  // L29
const propsParam = _q.get('officeprops'); if (['painted', '3d'].includes(propsParam)) setOfficeProps(propsParam);   // L30
// L19/L23: ?office=1|corner|basement boots straight into the office (snap, no dive — demos/captures).
// `basement` also selects the basement starter fitout; `1`/`corner` keep the corner office.
const officeParam = _q.get('office');
if (officeParam === '1' || officeParam === 'corner' || officeParam === 'basement') {
  if (officeParam === 'basement') setFitout('basement');
  dive.snap('b'); sceneMode = 'office'; window.__scene = sceneMode;   // L60: boot straight into the office (no dive)
}
// L32: ?hoard=1 boots straight into the Hoard game mode.
if (_q.get('hoard') === '1') enterHoard();
// L64: ?world=1 (optionally &preset=valley|archipelago|mountains|plains) boots straight into a terrain world.
// L75: ?world=<base64> (NOT the plain '1' flag) boots a SHARED authored world (compact link → deserialize).
const _wparam = _q.get('world');
// L90 H3 — length-guard the inbound link BEFORE atob/JSON.parse (mirror the 6144-byte outbound guard at
// shareLink): a multi-MB param would spike CPU/memory before failing. A legit compact link is ≤6144 B; reject
// anything absurd. deserialize() then validates the decoded payload (no NaN/half-loaded world from a bad link).
if (_wparam && _wparam !== '1' && _wparam.length <= 8192 && sceneMode === 'city') {
  try { const ok = engine.world.deserialize(JSON.parse(decodeURIComponent(escape(atob(_wparam))))); worldMode = engine.world.active; if (viewerUI) viewerUI.refresh(); if (!ok) console.warn('[L75] ?world= link rejected (bad payload) — base world kept'); }
  catch (e) { console.warn('[L75] bad ?world= link', e); }
} else if (_wparam && _wparam !== '1' && _wparam.length > 8192) {
  console.warn('[L90] ?world= link too large — ignored');
}
if ((_q.get('world') === '1' || _q.get('edit') === '1') && sceneMode === 'city') {
  const wp = _q.get('preset'); if (wp && engine.world.presets.includes(wp)) engine.world.setPreset(wp);
  toggleWorld();
  if (_q.get('edit') === '1') { toggleSculpt(); const tp = _q.get('tool'); if (['paint', 'scatter', 'place', 'flow'].includes(tp)) setEditTool(tp); }   // L71–L81: ?edit=1 → open the editor (opt-in); &tool=paint|scatter|place|flow
}
// L67: ?look=beauty (or ?realistic=1) boots straight into the Realistic beauty tier (the showcase first-impression).
if (_q.get('look') === 'beauty' || _q.get('realistic') === '1') viewerControls.realistic();
// L83: ?tonemap=agx (A/B the beauty tonemap curve; default ACES). window.__tonemap reports the active curve.
window.__tonemap = 'aces';
if (_q.get('tonemap') === 'agx') engine.setTonemap('agx');
// L87: ?simgpu=1 opts into the GPU sim backend (no-op until it's wired + parity-proven; CPU stays the default oracle).
if (_q.get('simgpu') === '1') engine.world.setSimBackend('gpu');

// L79: the CLIENT-PREVIEW takes over the boot — enters the world, pre-warms, and starts the scripted hero. Runs
// BEFORE tick() so shaders are compiled before the first rendered frame (smooth reveal). Skips the normal chrome.
if (PREVIEW) startPreview();

// L104 — guarantee the CITY's flyover HELICOPTER: one seize craft hovering over the skyline (rooftop height over the
// flat city ground). Press F (or call window.__fly()) to take it — the FLY action possesses the air craft, never an ATV.
// Skipped in preview (the scripted hero owns its craft) + non-city boots. The world's own craft is a follow-up (HANDOFF).
if (sceneMode === 'city' && !PREVIEW) {
  engine.spawnSeizeCraft('heli', 4, 3, { hover: 11 });   // ~rooftop height so the skyline reads behind/below it
  // L104 P2 — open the city FRAMED on the flying heli (the attract-loop), unless a boot param wants a specific camera/mode.
  if (!worldMode && !_q.has('cam') && _q.get('world') !== '1' && _q.get('edit') !== '1') startAttract();
}
// L110 (audit P0-1, THE funnel-breaker): register the attract seize-intercept for BOTH the bare-URL AND the ?preview
// boot. It used to live inside the `!PREVIEW` block above, so on the exact link built to sell the engine, a prospect on
// a phone tapped the framed helicopter and NOTHING seized — the tap fell through to the city click path (touchend →
// pickBuilding → enterOffice), diving them into the office with no chrome to escape. startPreview() spawns the same
// seize craft + attract in city mode, so this listener belongs to whichever city boot set them up. Guarded on
// attractActive at event time (registration order vs startPreview/startAttract doesn't matter). pointerdown fires on
// touch too (pointerType 'touch'), and it runs BEFORE touchend — so the seize sets piloting=true and the touchend
// building-dive early-returns (`if (piloting) return`), which is why a seized tap never dives.
if (sceneMode === 'city') {
  renderer.domElement.addEventListener('pointerdown', (e) => { if (!attractActive) return; if (e.button === 2) endAttract(); else seizeFromAttract(); });
}
if (typeof window !== 'undefined') {
  window.__fly = () => flyPossess();                                    // headless/verify trigger for the FLY action
  window.__heli = () => (engine.seizeCraft ? engine.seizeCraft.label : null);   // the seize craft's label (null if none)
  window.__flyLabel = () => flyVerbLabel();                            // 'Fly' (air) | 'Drive' (ground) — for Phase-2's verb bar
  window.__postMode = () => engine.mode;                               // L104 P2: current post tier (1/2 beauty · 7 pixel · 8 toon · 3 auto) — morph probe
  window.__setPostMode = (m) => setPostMode(m);                        // F1: harness setter — tier-guard preflight drives setPostMode(2) then asserts __style==='beauty'
  window.__pilotLookYaw = () => engine.pilot && engine.pilot.look ? engine.pilot.look.yaw : null;  // F5: expose look.yaw for mobile-cockpit-probe assertion
}

// L104 P3 — boot owner Developer Mode if enabled via ?dev=1 or the persisted hidden-key flag (never in ?preview/?demo).
if (DEV_OK && (_q.get('dev') === '1' || _devOnRaw)) setDev(true);   // I: _devOnRaw already read at boot (eliminates second localStorage call)

shell.start(frame);   // L114: start the loop HERE (was tick()) — after preview/attract/seize setup, so the boot order is exact.

// L42: first-run coachmark — surfaces the killer-but-hidden interactions (zoom→style morph, the dive)
// once per visitor (per-project localStorage key). Only on the city showcase itself (not office/hoard boots).
// L114: shell.hints derives the key from the shell name → `lgr_hints_city` (was an explicit key:'city').
if (sceneMode === 'city' && !PREVIEW) _cityHints = shell.hints({      // L79: no coachmark in the clean preview view
  title: 'LGR City',
  tips: [
    'WASD to move · right-drag / two-finger drag to orbit · scroll / pinch to zoom',
    'Zoom out and the art style MORPHS — toon → 16-bit → 8-bit → Game Boy',
    'Click a building to dive into the office · the bar below has camera, weather, time…',
  ],
});

/* 11) RESIZE — L114: the shell wires the ONE window.resize listener (engine.resize() first, then our onResize(db)
   defined at the createAppShell call up top: it sizes the dive-crossfade RTs + the office camera the engine doesn't
   know about). WebGLRenderTarget.setSize keeps the same .texture object, so materials holding rt.texture stay valid. */
