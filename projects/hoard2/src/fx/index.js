/* ============================================================
   hoard2 · src/fx — the fx-audio owner (THREE glue over the pure fx graph).
   ------------------------------------------------------------
   OWNS: GPU impact particles (createParticles) + projected decals (createDecals) + the CORPSE POOL (a
   SECOND createCharacterHorde over createCharacterRig({url:'models/zombie.glb'}), slots pinned to the death
   state, fed by `zombie:death` — HOARD-CONTRACT §Game-layer builds; DONE #5: corpses persist ≥ CORPSE_TTL_S
   / to CORPSE_CAP, never vanish) + combat SFX (createCombatSfx over createAudioBus) + the dread ambient bed
   (createAmbientBed). Everything is EVENT-DRIVEN and COSMETIC — fx never perturbs the sim (its only rolls
   come off the decorrelated `rng.fork('fx')` stream, in fx-graph.js).

   This file is only WIRING: it builds the THREE-touching adapters from the frozen engine factories and hands
   them to `createFxCore` (the pure, node-tested orchestration in fx-graph.js). The corpse-pool math and the
   null-RT degrade posture are tested in `*.test.mjs` WITHOUT the engine barrel (which dies under node).

   REAL-TIME AGEING: particles/decals/corpses age on `ctx.time.realDt` (v1 main.js:359-360) — a blood pool
   fades on wall-clock, not the dive-dilated sim clock. The fx graph owns that clock discipline.

   GROUND RECEIVER (flagged): the world's ground mesh is NOT exposed on the `world` facade (only groundAt()).
   So decals project onto a receiver WE register — an invisible flat plane at GROUND_Y spanning the arena
   (the play area is FLAT, ratified config #8, so a plane is exact). It is a math-only receiver (never added
   to the scene, renders nothing). See report for the proposed world.groundMesh()/registerDecalReceiver seam.

   C++ anchor: main-side wiring that links the engine lib, constructs the concrete subsystems, and injects
   them into the pure orchestrator — the orchestrator (#includes nothing GPU) stays unit-testable.
   ============================================================ */
import {
  createParticles, createDecals, createCharacterRig, createCharacterHorde,
  createAudioBus, createAmbientBed,
} from '@lgr/engine-core';
import { createFxCore } from './fx-graph.js';
import { createCombatSfx } from './combat-sfx.js';

const ZBASE = 0.9;   // world scale for the Quaternius zombie (~1.8 tall → ~1.6 in-game) — matches v1 main.js:74

export function createFx(ctx) {
  const { THREE, scene, renderer, registry, config } = ctx;
  const GROUND_Y = config.GROUND_Y;

  /* ---------- PARTICLES: GPU pool; null (no float RT) → the game just runs without sparks (v1 M6) ---------- */
  const gpu = createParticles(renderer, { texSize: 64, gravity: { x: 0, y: -7, z: 0 }, drag: 0.3, sizeScale: 42 });
  if (gpu) scene.add(gpu.points);
  const _burst = gpu ? gpu.emitter('burst') : null;
  const _muzzle = gpu ? gpu.emitter('muzzle') : null;
  const particles = gpu ? {
    muzzle: (x, y, z, dx, dy, dz) => _muzzle.emit(x, y, z, dx, dy, dz),
    burst: (x, y, z, dx, dy, dz) => _burst.emit(x, y, z, dx, dy, dz),
    update: (dt) => gpu.update(dt),
    get live() { return gpu.liveEstimate; },
  } : null;

  /* ---------- DECALS: bullet holes (world hits) + blood pools (deaths), projected onto a flat receiver ---------- */
  // A local fx-stream handle for the cosmetic decal size jitter (decorrelated — never touches the sim trace).
  const fxRng = ctx.rng.fork('fx');
  const dec = createDecals({ maxVerts: 6144, life: 22 });   // pools linger then fade (~22 s, wall-clock)
  scene.add(dec.mesh);
  // Math-only receiver: an arena-spanning flat plane at GROUND_Y (world is FLAT). Not added to the scene —
  // createDecals extracts world-space triangles at register time; it needs geometry + a world matrix, not a
  // draw. A tiny fxRng-free (cosmetic) blood size jitter uses Math.random via the graph's fx stream instead.
  const R = (config.ARENA_EXTENT || 34) * 2;
  const recv = new THREE.Mesh(new THREE.PlaneGeometry(R, R, 1, 1), new THREE.MeshBasicMaterial({ visible: false }));
  recv.rotation.x = -Math.PI / 2; recv.position.set(0, GROUND_Y, 0);
  recv.updateWorldMatrix(true, false);
  dec.registerReceiver(recv);
  // `count` is the cumulative number of decals actually STAMPED (project() returned geometry) — a meaningful
  // activity figure for counts(), unlike receiverCount (always 1 here). project() returns 0 when the
  // projector missed every receiver triangle, so misses don't inflate it.
  let _decalCount = 0;
  const decals = {
    hole: (x, y, z, nx, ny, nz) => { if (dec.project(x, y, z, nx, ny, nz, { kind: 'hole', size: 0.32 }) > 0) _decalCount++; },
    blood: (x, z) => { if (dec.project(x, GROUND_Y, z, 0, 1, 0, { kind: 'blood', size: 0.7 + fxRng.range(0, 0.4) }) > 0) _decalCount++; },
    update: (dt) => dec.update(dt),
    get count() { return _decalCount; },
  };

  /* ---------- CORPSE POOL: a SECOND horde over the zombie rig, slots pinned to the death state ---------- */
  // The engine's `rig` in ctx is the CAMERA rig — the corpse pool needs its OWN character rig (the zombie
  // GLB), exactly as the sim's live horde does. Async: until the GLB lands, `sink.ready()` is false and the
  // pool bookkeeping runs headless; syncActive() catches the horde up the moment it is built.
  let horde = null;
  const _camPos = new THREE.Vector3();
  const corpseRig = createCharacterRig({ url: 'models/zombie.glb' });
  const sink = {
    ready: () => !!horde,
    apply(i, s) {
      horde.setActive(i, true);
      horde.setType(i, { scale: ZBASE * ((config.ZTYPE[s.type] && config.ZTYPE[s.type].scale) || 1) });
      horde.setState(i, 'death');                       // pinned to the death pose (plays once, clamps)
      horde.setTransform(i, s.x, s.y, s.z, s.yaw);
    },
    recycle(i) { horde.setActive(i, false); },
    step(dt) {
      const cam = ctx.rig && ctx.rig.camera;
      if (cam) cam.getWorldPosition(_camPos); else _camPos.set(0, 0, 0);
      horde.update(dt, _camPos.x, _camPos.y, _camPos.z);
    },
  };

  /* ---------- AUDIO: bus + procedural combat SFX + the dread ambient bed (all gesture-gated) ---------- */
  const bus = createAudioBus();                          // null headless / no Web Audio → sfx stays null
  const sfx = createCombatSfx(bus);                      // 2-D one-shots (positional gap flagged in report)
  const ambient = bus ? createAmbientBed(bus, { preset: 3 }) : null;   // preset 3 DEEP DRIFT — Lusion-lean dread
  if (bus) {
    // AUTOPLAY LAW (audio-bus.js): unlock() MUST run inside a real user gesture. Unlock + rise the bed once.
    const unlock = () => {
      bus.unlock();
      if (ambient) ambient.start();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('pointerdown', unlock, { once: false });
      window.addEventListener('keydown', unlock, { once: false });
    }
  }

  /* ---------- the pure orchestrator (owns the corpse pool + all event handlers) ---------- */
  const core = createFxCore({
    events: ctx.events, rng: ctx.rng, time: ctx.time, config, groundY: GROUND_Y,
    particles, decals, sfx, sink,
  });

  // Build the horde once the GLB is ready, then catch up any corpses that already died during the load.
  corpseRig.ready.then(() => {
    horde = createCharacterHorde(corpseRig, { size: config.CORPSE_CAP, lodDistance: 16, lodHz: 2, baseScale: ZBASE });
    scene.add(horde.group);
    core.syncActive();
  }).catch((e) => { if (typeof console !== 'undefined') console.warn('[fx] corpse rig failed to load — corpses disabled (game runs):', e); });

  /* ---------- facade + probe ---------- */
  const facade = {
    update(dt, _t) {
      // The corpse horde's mixers are stepped by sink.step (inside core.update) — LOD-throttled and on
      // wall-clock. We deliberately do NOT also call corpseRig.update (that would double-step every mixer).
      core.update(dt);
    },
    counts() { return core.counts(); },
    dispose() { core.dispose(); if (ambient) ambient.stop(); if (gpu) gpu.dispose(); dec.dispose(); if (horde) horde.dispose(); corpseRig.dispose(); },
  };
  registry.register('fx', facade);
  ctx.probe.counts = () => core.counts();   // DONE #5: the harness reads counts() for corpse persistence
  return facade;
}
