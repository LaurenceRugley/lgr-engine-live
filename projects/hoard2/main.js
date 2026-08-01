/* ============================================================
   THE HOARD v2 — composition root (lead-owned; HOARD-CONTRACT.md).
   ------------------------------------------------------------
   This file is the WIRING, not the game. It boots the FROZEN engine, stands up the core seams (ctx
   registry · event bus · pinned config · seeded rng forks · the clock authority), constructs the six
   subsystem owners over that registry, owns the render present (the dive crossfade is a frame-
   composition concern), and exposes the deterministic `?capture=1` probe contract the harness drives.

   BOOT DECISION (surfaced in the run report, Rule 6): hoard2 boots via `createEngine` — the proven,
   frozen render pipeline (renderCityPipeline/updateWorld/fitShadowFrustum all live in createCityWorld;
   replicating them under the freeze is the high-risk path). The default baked city is HIDDEN by the
   world owner (setUrbanVisible(false), v1's forest pattern), which then composes the decrepit world by
   calling createCity({ profile }) DIRECTLY — calling an exported factory is not editing frozen core.

   DIVE OWNERSHIP SPLIT (surfaced, Rule 6): the ownership map lists createDiveController under `player`.
   The dive controller IS the frame present (its renderFrom/renderTo call the pipeline), which is
   structurally lead's. Resolution: LEAD instantiates + presents the controller here and exposes a thin
   `ctx.dive` seam; PLAYER owns the walker, look/aim/fire/melee, the eye pose it feeds via
   setEyeSource(), and the enter/exit DECISION (the game-feel half the map intended).

   C++ anchor: main() that constructs the subsystems, injects a shared context, and runs the frame loop
   — the systems never `#include` each other, they talk through the injected registry + event bus.
   ============================================================ */
import { THREE, createEngine, CAM, createAppShell, readAppFlags, createDiveController, createDebugOverlay } from '@lgr/engine-core';

import * as config from './src/core/config.js';
import { createRegistry } from './src/core/registry.js';
import { createEventBus } from './src/core/events.js';
import { createRng } from './src/core/rng.js';
import { createTime } from './src/core/time.js';

import { createWorld } from './src/world/index.js';
import { createSim } from './src/sim/index.js';
import { createPlayer } from './src/player/index.js';
import { createBuild } from './src/build/index.js';
import { createFx } from './src/fx/index.js';
import { createUi } from './src/ui/index.js';

/* ---------- flags ---------- */
const app = readAppFlags(window.location.search);
const CAPTURE = app.capture;
const seed = (app.q.get('seed') ? Number(app.q.get('seed')) : 0) || config.DEFAULT_SEED;
window.__seed = seed;
// iOS-BLACK DIAGNOSTICS (owner's real-iPhone field debug — the phone IS the debugger):
//  ?debug=gl  → a screenshot-able DOM overlay of the GL stack (renderer, highp-fragment precision,
//               extensions, context attrs, getError sweep, lights/env, canvas luminance).
//  ?safe=1    → bypass the post pipeline (render straight to screen) AND force flat UNLIT bright
//               materials, to bisect pipeline/lighting vs textures/precision. Renders → the former;
//               still black → the latter (deeper iOS Metal-WebGL issue).
const DEBUG_GL = app.q.get('debug') === 'gl';
const SAFE = app.q.get('safe') === '1';
//  ?noenv=1   → drop the IBL environment (scene.environment). A one-tap bisect for "is the PMREM/half-float
//               env the thing blacking iOS?" — documented in field-debug-doctrine.md, previously parsed
//               NOWHERE (a debug switch that silently did nothing). Wired at scene-setup below.
const NOENV = app.q.get('noenv') === '1';

// MOBILE TIER (ARC M1 MOBILE TRUTH). The mobile RENDERING tier keys off a COARSE POINTER (a touch device)
// — deliberately NOT off LOWP (computed below). LOWP is the iOS-p0 fragment-PRECISION path (a separate
// axis); the owner's phone plays v1's FULL PBR beauty smoothly, so it is very likely NOT p0 (LOWP off) yet
// still a phone that must shed the v2-ONLY extra load (13 lights, a sun re-rendering a 2048² soft shadow
// map every ~1.4 s, 144 skinned characters, two city clusters). So the tier is ORTHOGONAL to LOWP: it
// degrades scene COST regardless of which render path (beauty present OR the LOWP direct Lambert) draws.
// v1 proves the beauty pipeline itself is fine on his phone — the extra load is the killer. ?mobile=1 forces
// the tier on any device (the harness BEFORE/AFTER handle); ?mobile=0 forces it off. Desktop is untouched.
// C++ anchor: MOBILE is a compile-time device-class branch the owners read to size their budgets.
const _coarsePtr = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const _mobileParam = app.q.get('mobile');
const MOBILE = _mobileParam === '1' || (_mobileParam !== '0' && !!_coarsePtr);
window.__mobile = MOBILE;

// ARC A5-BLACK (owner field data 2026-07-29 — CORRECTS the M1 assumption above). His iPhone banner:
// highp p23 (so LOWP off), MOBILE on, 6 lights, 0 GL errors, env SET, tone 0 — yet lum 0.6/255 = BLACK.
// The ONE anomaly: OES_texture_half_float_linear MISSING. The iOS device silently CANNOT linear-filter
// half-float textures (it's nominally core in WebGL2, so no error fires) — which is exactly what the BEAUTY
// pipeline needs: its HDR half-float render targets (grab/beauty/bloom, composited with linear sampling)
// AND the PMREM env map (half-float, sampled by every MeshStandardMaterial). Either blacks the frame with
// no GL error. The forge's baked maps are 8-bit (safe), so this is purely the beauty PATH. The proxy can't
// reproduce it (Mac WebGL2 honors half-float-linear), so the DEVICE is the oracle via the ?debug=gl lum.
// FIX: on mobile, take the DIRECT render path (the same one LOWP uses) — no beauty RTs, Lambert ignores the
// PMREM env, 8-bit forge maps sample fine. This sidesteps the entire half-float-linear class. It also lands
// the owner's accepted blocky look (M1). ?mobilebeauty=1 forces the OLD beauty path back for on-device A/B
// (expected: black) so he can CONFIRM the diagnosis by watching the lum number flip.
const _mobileBeauty = app.q.get('mobilebeauty') === '1';
const MOBILE_DIRECT = MOBILE && !_mobileBeauty;   // mobile → direct render (the half-float-safe path)
window.__mobileDirect = MOBILE_DIRECT;

// M1 item 5 — THE MOBILE QUALITY LADDER (governor teeth). The default engine ladder can only drop
// dpr/shadows/reflection — it can NEVER shed lights, characters, or scene mass, so a struggling phone
// grinds at ~12 fps for ~14 s and still can't recover. This mobile ladder adds a `shed` level the engine
// forwards to a project listener (registered below) that ACTUALLY sheds load: shed 1 → hide the corpse
// pool (drops ~8 skinned mixers), shed 2 → shadows off + hide the backdrop ruins cluster (draw calls).
// Rungs are still cheap-first (dpr before the destructive sheds). Desktop keeps the engine default ladder.
const MOBILE_QUALITY_LADDER = [
  { dpr: null, shadows: true,  refl: false, shed: 0 },   // 0 — full mobile tier (no-op; byte-identical to boot)
  { dpr: 1.25, shadows: true,  refl: false, shed: 1 },   // 1 — shed the corpse pool first (cheapest to lose)
  { dpr: 1.0,  shadows: false, refl: false, shed: 2 },   // 2 — shadows off + hide the backdrop ruins cluster
  { dpr: 0.75, shadows: false, refl: false, shed: 2 },   // 3 — last resort: dpr floor (load already shed)
];

/* ---------- engine boot (frozen pipeline; default city hidden by world) ---------- */
const container = document.getElementById('app') || document.body;
// A3: opt into SOFT shadows (PCFSoftShadowMap) — softer, more realistic shadow edges than the engine's
// default hard PCF. The city stays byte-identical (it never passes shadowType). On MOBILE we drop to plain
// PCF and a SMALLER shadow map (M1): PCFSoft is the priciest filter and the map re-renders over the whole
// caster set — mobile can't afford either. Desktop keeps soft. (The governor still drops shadows on weak
// GPUs; M1 adds the mobile-tier freeze/shrink on top so the phone matches v1's static-shadow class.)
const engine = createEngine({
  demo: app.demo, citySeed: seed, profileIndex: 0, container,
  shadowType: MOBILE ? 'pcf' : 'soft',
  // A11 THE LIGHT CEILING — desktop shadow map 2048 → 4096. The A11 frustum-fit (world/index.js) grows the
  // ortho frustum from ±12u to ±30u to cover the play ring, which alone would drop texel density 84 → 34
  // texels/u; the 4096 bump restores it to 68 texels/u (crisp near shadows across the WHOLE arena, not just
  // the centre). MEASURED to hold perf: 42-concurrent p95 8.8 → 9.4 ms (budget 16.7), 0 mid-play compiles,
  // governor L0. Mobile UNTOUCHED (1024 + its small frustum + the 15 s freeze). The governor still sheds
  // shadows first under desktop load, so the 4096 map is a ceiling, not a floor.
  shadowMapSize: MOBILE ? 1024 : 4096,
  qualityLadder: MOBILE ? MOBILE_QUALITY_LADDER : undefined,   // M1 item 5: a mobile ladder that SHEDS load
});
const { renderer, scene, rig, sunRig } = engine;
// ?noenv=1 — trap scene.environment to stay null so the beauty pipeline's per-frame assignment
// (createCityWorld sets it every present) becomes a no-op → the IBL env is dropped for the whole run.
if (NOENV) Object.defineProperty(scene, 'environment', { get: () => null, set: () => {}, configurable: true });
const shell = createAppShell(engine, { name: 'hoard2', flags: app });

// PRECISION-SAFE MOBILE PATH (owner iPhone root-cause: FRAG highp = p0). No high-precision fragment math
// → PBR (MeshStandardMaterial, per-FRAGMENT lighting) underflows to BLACK on iOS, while unlit renders
// (?safe=1 confirmed). Auto-detect it and route game meshes to MeshLambertMaterial (much simpler lighting,
// mediump-tolerant) rendered DIRECT (the proven safe path, keeping real colours/maps). ?lowp=1 forces it
// for testing on any device; ?lowp=0 disables the auto path.
const _fragHighp = (() => { try { const gl = renderer.getContext(); const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT); return f ? f.precision : 0; } catch { return 1; } })();
const _lowpParam = app.q.get('lowp');
const LOWP = !SAFE && (_lowpParam === '1' || (_lowpParam !== '0' && _fragHighp === 0));
window.__lowp = LOWP;

// iOS PORTRAIT VIEWPORT FIX (owner: "can't see the map; look only works in landscape"). On real iOS
// Safari portrait the fixed #app sized to the LAYOUT viewport (taller than visible under the URL bar), so
// the canvas overflowed the screen — the map was panned off + look-drags panned the page. Fit the
// container to the VISUAL viewport and re-resize the engine on every orientation / URL-bar / rotate event
// (+ a few delayed passes, since iOS settles the viewport AFTER load). Rotating "fixed it" precisely
// because rotation fired a resize; now every case does.
function fitViewport() {
  const vv = window.visualViewport;
  const w = Math.round(vv ? vv.width : window.innerWidth);
  const h = Math.round(vv ? vv.height : window.innerHeight);
  container.style.width = w + 'px';
  container.style.height = h + 'px';
  if (engine.resize) engine.resize();
}
if (typeof window !== 'undefined') {
  fitViewport();
  window.addEventListener('resize', fitViewport);
  window.addEventListener('orientationchange', () => { fitViewport(); setTimeout(fitViewport, 300); });
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', fitViewport); window.visualViewport.addEventListener('scroll', fitViewport); }
  for (const ms of [120, 400, 900, 1800]) setTimeout(fitViewport, ms); // iOS settles the viewport late
}

/* ---------- core seams ---------- */
const registry = createRegistry();
const events = createEventBus();
const rng = createRng(seed);
const time = createTime();
registry.register('rng', rng); // core registers rng + time (HOARD-CONTRACT §ctx registry)
registry.register('time', time);

// The shared context handed to every owner. Owners talk to each other ONLY through registry + events;
// engine handles + config + rng + time are read-only capability, not a cross-owner backchannel.
let curStyle = null; // this frame's engine style — the dive present callbacks close over it
const ctx = {
  THREE, engine, scene, renderer, rig, sunRig, CAM,
  registry, events, rng, time, config,
  capture: CAPTURE,
  mobile: MOBILE,   // M1 MOBILE TRUTH: the device-class tier flag every owner reads to size its budgets
  flags: app,
  // renderWorld(dest): the ONE pixel-pipeline call, owned by lead. The dive controller and any owner
  // that needs to draw the world routes through this so curStyle stays lead's.
  renderWorld: (dest) => engine.renderCityPipeline(curStyle, dest),
  // probe: the CAPTURE-HOOK CONTRACT (lead defines, owners attach). tools/hoard2-capture.mjs drives
  // window.__probe.* to script the game deterministically. Owners populate their methods at construction:
  //   sim   → spawnWave(n), starve(), hurt(amt), setNightSpawn?, counts snapshot fields (alive/wave/…)
  //   player→ fire(), melee(), face(rad)
  //   build → placeBarrier(), breachNearest(), repairNearest(), harvestWood(), harvestScrap()
  //   world → setNight(nf), colliders() (AABBs/trees for the penetration-bounds probe)
  //   fx    → counts() { particles, decals, corpses }
  // A probe the harness calls that no owner attached is a LOUD miss (the harness logs the skip — no
  // silent caps). See each owner brief for the exact methods it must attach.
  probe: {},
};

/* ---------- the dive present (lead owns the frame; player owns the feel) ---------- */
// One rig, two views (iso ortho ↔ FP perspective eye). freezeFrom:true — capture the iso frame at dive()
// and hold it through the descent while the FP eye renders live (v1 main.js:229). Both callbacks are the
// same world pipeline; the RIG STATE (set each frame) picks the view.
// A5-BLACK: on the mobile DIRECT path these callbacks are NO-OPS. renderWorld = renderCityPipeline (the
// beauty pass) — and on mobile we never present through the dive controller (gameStep calls lowpRender), so
// its freeze-capture render is pure waste AND it's the source of the dive bugs: that one beauty pass sets
// scene.environment (PMREM half-float → iOS black silhouettes) AND shows the Sky mesh (raw ShaderMaterial,
// ignores tonemapping → blown-white sky). Skipping it on mobile stops both at the source; lowpRender renders
// the live view either way. Desktop keeps the real freeze-capture.
const diveCtl = createDiveController(engine, {
  rate: 2.0,
  freezeFrom: true,
  renderFrom: (t) => { if (!MOBILE_DIRECT) ctx.renderWorld(t); },
  renderTo: (t) => { if (!MOBILE_DIRECT) ctx.renderWorld(t); },
});
let _eyeSource = null; // player sets this: () => ({ pos:Vector3, dir:Vector3 }) | writes rig.setEye itself
const dive = {
  get active() { return diveCtl.mode !== 'a'; },
  get mode() { return diveCtl.mode; },
  setEyeSource(fn) { _eyeSource = fn; },
  focusUv: null, // player sets a () => THREE.Vector2 for the descent zoom target (survivor's screen point)
  enter() {
    if (diveCtl.mode !== 'a') return;
    curStyle = engine.decideStyle(); // fresh style for the freeze capture (rig still iso ortho)
    diveCtl.dive(dive.focusUv ? dive.focusUv() : new THREE.Vector2(0.5, 0.5));
    // A5 MOBILE EXIT-TRAP FIX (owner bug #1): on the mobile DIRECT path gameStep calls lowpRender, never
    // dive.present → diveCtl.update never runs → the transition state machine never eases past 'in'/'out'.
    // So SNAP it to a settled endpoint here: enter → 'b' (dived), exit → 'a' (iso). Without this, exit left
    // mode stuck at 'out' (dive.active stayed true) so the rig never returned to iso — the FP was a one-way
    // trap. Desktop keeps the eased crossfade (mobile never presented it anyway — lowpRender draws live).
    if (MOBILE_DIRECT) diveCtl.transition.snap('b');
    rig.setMode(CAM.PERSPECTIVE); // …then the FP eye renders through perspective (real depth)
    time.setDived(true);
    events.emit('dive:enter', { mode: 'walk' });
  },
  exit() {
    if (diveCtl.mode === 'a') return;
    diveCtl.surface();
    if (MOBILE_DIRECT) diveCtl.transition.snap('a');   // settle to iso immediately (see enter() — no update() on mobile)
    time.setDived(false);
    events.emit('dive:exit', { mode: 'walk' });
  },
  toggle() { (diveCtl.mode === 'a') ? dive.enter() : dive.exit(); },
  present(dt) { diveCtl.update(dt); }, // presents: iso→screen · FP→screen when dived · crossfade mid-descent
};
ctx.dive = dive;
window.__dive = { toggle: () => dive.toggle(), get mode() { return diveCtl.mode; } };

/* ---------- construct the owners (each registers its facade) ---------- */
// Order is construction-only; cross-owner calls resolve via registry.get at UPDATE time, so a stub or a
// real owner in any order is fine as long as all six register before the first frame.
const world = createWorld(ctx);
const sim = createSim(ctx);
const player = createPlayer(ctx);
const build = createBuild(ctx);
const fx = createFx(ctx);
const ui = createUi(ctx);

// M1 item 5 — GOVERNOR TEETH. The engine governor's ladder can only drop dpr/shadows/reflection — it can
// NEVER shed lights, characters, or scene mass, so a struggling phone grinds at ~12 fps and can't recover.
// The mobile ladder (MOBILE_QUALITY_LADDER above) adds a `shed` level per rung; here we subscribe and turn
// that level into real project actions: shed ≥ 1 → drop the corpse pool (draws + mixers), shed ≥ 2 → hide the
// distant backdrop ruins cluster (draw calls). Reversible — when headroom returns the governor steps back up
// and we restore. Registered only on mobile (the desktop ladder carries no `shed`, so this is inert there).
if (MOBILE && engine.addQualityListener) {
  engine.addQualityListener((_level, rung) => {
    const shed = (rung && rung.shed) | 0;
    if (registry.has('fx')) registry.get('fx').setCorpsesActive?.(shed < 1);          // shed ≥ 1 → corpses off
    if (registry.has('world')) registry.get('world').setBackdropVisible?.(shed < 2);  // shed ≥ 2 → backdrop hidden
  });
}

// Hide engine scene-clutter that leaks into the decrepit arena once the urban world is hidden (critic
// look-pass): the hiddenProp easter-egg, the engine ground DUST field (additive motes → blobby fuzz at
// the FPS eyeline, the dive's worst artifact), and the stray low cloud sprites. Signature-matched so we
// DON'T hit fx's particle system (additive but 4096 pts) or celestials (sky stars/moon, high on the dome).
const _hp = scene.getObjectByName?.('hiddenProp');
if (_hp) _hp.visible = false;
scene.traverse((o) => {
  const g = o.geometry;
  const n = g && g.attributes && g.attributes.position ? g.attributes.position.count : 0;
  // engine dust: additive Points, near the ground, a modest count (fx particles are 4096 → excluded).
  if (o.isPoints && o.material && o.material.blending === 2 && o.position.y < 2.5 && n > 30 && n < 1000) o.visible = false;
  // low cloud puffs (Y≈4–7); the sun/moon sprites ride the skydome far higher → untouched.
  if (o.isSprite && o.position.y > 2 && o.position.y < 11) o.visible = false;
});

/* ---------- ?safe=1 — pipeline/materials bisect (render bare scene with flat unlit bright mats) ---------- */
const _safeMat = new THREE.MeshBasicMaterial({ color: 0x66cc66, fog: false }); // unlit · no texture · bright
const _safeSeen = new WeakSet();
const _isLit = (m) => m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial || m.isMeshPhongMaterial || m.isMeshLambertMaterial);
function safeRender() {
  // Swap ONLY lit materials (the ones going black on iOS) → flat unlit bright. LEAVE the engine's
  // ShaderMaterials (sky/water/celestials — they render fine on iOS, and updateWorld pokes their uTime;
  // swapping them crashed with 'material.uniforms.uTime undefined'). GLBs get swapped as they appear.
  scene.traverse((o) => {
    if (!(o.isMesh || o.isSkinnedMesh) || _safeSeen.has(o)) return;
    if (Array.isArray(o.material)) { if (o.material.some(_isLit)) { o.material = o.material.map((m) => (_isLit(m) ? _safeMat : m)); _safeSeen.add(o); } }
    else if (_isLit(o.material)) { o.material = _safeMat; _safeSeen.add(o); }
  });
  renderer.setRenderTarget(null);
  renderer.setClearColor(0x203a55, 1); // a distinct blue clear so "did it even clear?" is obvious
  renderer.clear(true, true, true);
  renderer.render(scene, rig.camera);
}

/* ---------- LOWP — the auto precision-safe path: LIT (Lambert) game mats, direct render, no post ---------- */
const _lowpCache = new Map(); // origMaterial → its MeshLambertMaterial twin (keeps colour/map, per-vertex-safe lighting)
const _lowpSeen = new WeakSet();
function _toLambert(m) {
  let L = _lowpCache.get(m);
  if (!L) {
    L = new THREE.MeshLambertMaterial({
      color: m.color ? m.color.clone() : new THREE.Color(0xffffff), map: m.map || null,
      emissive: m.emissive ? m.emissive.clone() : new THREE.Color(0x000000), emissiveMap: m.emissiveMap || null,
      transparent: !!m.transparent, opacity: m.opacity != null ? m.opacity : 1, side: m.side,
      flatShading: !!m.flatShading, vertexColors: !!m.vertexColors, alphaTest: m.alphaTest || 0,
    });
    _lowpCache.set(m, L);
  }
  // A15 GI on the mobile DIRECT path: the twin is a fresh MeshLambert (no onBeforeCompile), so if the
  // source carried a baked indirect field, re-apply it to the twin (Lambert uses Three's `irradiance`
  // term, so the same injection works). Zero cost when GI is off — the tag is only set under ?gi=1.
  if (m.userData && m.userData.__lgrIndirectField && !(L.userData && L.userData.__lgrIndirectApplied)) {
    m.userData.__lgrIndirectField.apply(L);
  }
  return L;
}
// A5-BLACK sky tonemap — the Sky mesh ignores renderer.toneMapping (raw ShaderMaterial), so the mobile
// direct path's sky (the fog-colour clear) reads as blown-white paper by day. We tonemap that ONE colour
// ourselves with the Narkowicz ACES approximation — the same S-curve the beauty ACES post applies — so the
// horizon compresses to a readable sky. ?mobiletone=<n> is the A/B exposure knob: 0 = RAW (no tonemap, the
// blown-white baseline), 1 = ACES @ exposure 1 (default), 1.4 = brighter. fog.color is linear (managed),
// ACES → display-linear, and setClearColor srgb-encodes it — colour-correct. Hoisted out, no per-frame alloc.
const _toneParam = app.q.get('mobiletone');
const MOBILE_TONE_EXPOSURE = _toneParam != null ? (Number(_toneParam) || 0) : 1;
const _skyFallback = new THREE.Color(0x8a8f80);
const _clearOut = new THREE.Color();
function _aces1(x) { x = Math.max(0, x); return Math.min(1, (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14)); }
function _acesColor(src, exposure, out) { return out.setRGB(_aces1(src.r * exposure), _aces1(src.g * exposure), _aces1(src.b * exposure)); }

// M1 item 4 — DON'T re-traverse the whole scene graph every frame. The Lambert swap only needs to catch NEW
// lit meshes, which appear solely while the async GLBs (survivor/horde/corpses) load — a bounded early window.
// So scan every frame for the first ~4 s (covers the loads), then only every 30th frame afterward (a late
// material would still get swapped within ~0.5 s). The `_lowpSeen` WeakSet already makes each swap one-shot;
// this removes the per-frame full-graph walk the diagnosis flagged as pure CPU tax on the p0 phone.
let _lowpFrame = 0;
function lowpRender() {
  if (_lowpFrame < 240 || (_lowpFrame % 30) === 0) {
    scene.traverse((o) => {
      if (!(o.isMesh || o.isSkinnedMesh) || _lowpSeen.has(o)) return;
      if (Array.isArray(o.material)) { if (o.material.some(_isLit)) { o.material = o.material.map((m) => (_isLit(m) ? _toLambert(m) : m)); _lowpSeen.add(o); } }
      else if (_isLit(o.material)) { o.material = _toLambert(o.material); _lowpSeen.add(o); }
    });
  }
  _lowpFrame++;
  // A5-BLACK (owner field data): keep scene.environment NULL on the mobile direct path in BOTH iso AND dive.
  // The dive's freeze-capture calls renderCityPipeline ONCE, which sets scene.environment = the PMREM sky
  // (half-float). On iOS that env can't be linear-filtered, so every material sampling it goes BLACK — the
  // dive "silhouettes against white sky" the owner saw (iso was fine because it never ran that capture).
  // Lambert here needs no env; forcing null each frame removes the dependency. (Only recompiles the single
  // frame it flips set→null, then no-ops — cheap.)
  scene.environment = null;
  renderer.setRenderTarget(null);
  // A5-BLACK sky fix — the Sky mesh is beauty-tier-gated (visible=false here), so the background is this
  // CLEAR colour (scene.fog.color, which updateWorld drives bright/hazy by day). Raw, with no tonemapping,
  // it reads as blown-white paper in the FP dive (the owner's report). Run it through a cheap ACES-approx
  // tonemap (the same curve the beauty post pass applies) so the horizon reads as SKY, not paper. Hoisted
  // scratch, no per-frame alloc. Desktop is untouched (it never takes this path).
  const _fc = scene.fog ? scene.fog.color : _skyFallback;
  if (MOBILE_TONE_EXPOSURE > 0) renderer.setClearColor(_acesColor(_fc, MOBILE_TONE_EXPOSURE, _clearOut), 1);
  else renderer.setClearColor(_fc, 1);   // ?mobiletone=0 — RAW (the blown-white A/B baseline)
  renderer.clear(true, true, true);
  renderer.render(scene, rig.camera);
}

/* ---------- ?debug=gl — the engine FIELD-DEBUG overlay (A10: lifted to core createDebugOverlay) ----------
   The exact instrument that overturned three rounds of confident-wrong iOS diagnosis, now an engine ability
   every project inherits (docs/field-debug-doctrine.md). hoard2 passes its own tier CHIPS (LOWP/MOBILE/SAFE)
   + its render-path getter; the overlay owns the caps dump, the unmissable highp verdict, and the live
   luminance/lights/env/tone/err ticker. Behaviour is equivalent to the old inline buildGlDebug it replaces. */
if (DEBUG_GL) createDebugOverlay({
  renderer, scene,
  chips: [
    { label: `LOWP ${LOWP ? 'ON' : 'off'}`, on: LOWP, color: '#ffcc33' },
    { label: `MOBILE ${MOBILE ? 'ON' : 'off'}`, on: MOBILE, color: '#66ccff' },
    { label: `SAFE ${SAFE ? 'ON' : 'off'}`, on: SAFE, color: '#ff99ff' },
  ],
  getPath: () => window.__renderPath,
});

/* ---------- pause + dive are core-executed (owners emit, core acts) ---------- */
events.on('game:pause', () => time.setPaused(true));
events.on('game:resume', () => time.setPaused(false));

/* ---------- the frame ---------- */
// World advances on REAL time (day/night, ambient — v1: "the WORLD stays real-time"). Sim/combat read
// the dilated clock via time.simDt inside their own update. The present is ALWAYS through the dive
// controller (mode 'a' = a straight iso present), so there is exactly one present path.
function gameStep(dt, t) {
  time.update(dt); // ease dive dilation / honor pause (scale + elapsed)

  world.update(dt, t); // day/night, weather, fog — real time
  sim.update(dt, t);   // waves, zombies, hunger/stamina — dilated inside via time.simDt
  build.update(dt, t); // barrier HP, breach/repair, harvest
  player.update(dt, t); // iso controls or FP walker (real dt), aim, gun, melee; drives dive enter/exit
  fx.update(dt, t);    // particles/decals/corpses (real-time ageing) + audio
  ui.update(dt, t);    // HUD, bag, menus (DOM overlay)

  // FP eye: when dived, the player-provided eye source drives the rig eye each frame.
  if (dive.active && _eyeSource) _eyeSource();

  engine.updateWorld(dt, t, { shadowsOn: true, seasonTarget: 0 }); // day/night, ambient, shadows
  curStyle = engine.decideStyle();
  if (SAFE) { safeRender(); window.__renderPath = 'safe'; }              // ?safe=1 — bare scene, flat unlit mats, no post
  else if (LOWP || MOBILE_DIRECT) { lowpRender(); window.__renderPath = 'direct'; }  // A5-BLACK: mobile-safe DIRECT render (no beauty half-float RTs / PMREM env → un-blacks iOS)
  else { dive.present(dt); window.__renderPath = 'beauty'; }             // desktop (or ?mobilebeauty=1) — the full beauty present
}

/* ---------- readiness (drop the boot cover once the world is dressed) ---------- */
function ready() {
  shell.ready();
  const boot = document.getElementById('boot');
  if (boot) { boot.classList.add('gone'); setTimeout(() => boot.remove(), 700); }
}
// The world owner resolves ctx.worldReady (a promise) once its GLBs/scatter land; fall back to a timer
// so the cover never sticks on a slow asset.
Promise.race([
  (ctx.worldReady instanceof Promise ? ctx.worldReady : Promise.resolve()),
  new Promise((r) => setTimeout(r, 4000)),
]).then(ready);

/* ---------- capture probe contract (tools/hoard2-capture.mjs) ---------- */
// ?capture=1 → suppress the live rAF; window.__step(dt) is the SOLE clock (fixed-timestep → smooth by
// construction, deterministic). Mirrors v1's contract so the forked harness drives the same hooks.
// window.__hoard is the probe snapshot (sim owns its shape); __gameReady gates the harness.
window.__hoard = () => (registry.has('sim') ? registry.get('sim').probe?.() : null) ?? {};
window.__hoard2 = { ctx, engine, registry, events }; // dev handle
// Governor probe (DONE #9): verify the quality ladder + force a load spike. Mirrors v1 main.js:90.
window.__quality = { get level() { return engine.governor.level; }, forceLoad: (ms) => engine.profiler.forceLoad(ms) };
window.__probe = ctx.probe; // the owner-populated capture hooks
if (CAPTURE) {
  let _capT = 0;
  window.__step = (dt = 1 / 60) => {
    const d = Math.min(dt, 0.05);
    engine.frameStart && engine.frameStart();
    gameStep(d, _capT); _capT += d;
    engine.frameEnd && engine.frameEnd();
    return window.__hoard();
  };
  window.__gameReady = true;
} else {
  shell.start(gameStep);
}
