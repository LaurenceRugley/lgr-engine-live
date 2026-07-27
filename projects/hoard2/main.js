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
import { THREE, createEngine, CAM, createAppShell, readAppFlags, createDiveController } from '@lgr/engine-core';

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

/* ---------- engine boot (frozen pipeline; default city hidden by world) ---------- */
const container = document.getElementById('app') || document.body;
const engine = createEngine({ demo: app.demo, citySeed: seed, profileIndex: 0, container });
const { renderer, scene, rig, sunRig } = engine;
const shell = createAppShell(engine, { name: 'hoard2', flags: app });

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
const diveCtl = createDiveController(engine, {
  rate: 2.0,
  freezeFrom: true,
  renderFrom: (t) => ctx.renderWorld(t),
  renderTo: (t) => ctx.renderWorld(t),
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
    rig.setMode(CAM.PERSPECTIVE); // …then the FP eye renders through perspective (real depth)
    time.setDived(true);
    events.emit('dive:enter', { mode: 'walk' });
  },
  exit() {
    if (diveCtl.mode === 'a') return;
    diveCtl.surface();
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
  dive.present(dt); // the single present
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
