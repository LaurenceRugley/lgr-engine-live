/* ============================================================
   hoard2 · src/fx — the fx-audio owner (THREE glue over the pure fx graph).
   ------------------------------------------------------------
   OWNS: GPU impact particles (createParticles) + projected decals (createDecals) + the CORPSE POOL (a
   SECOND createCharacterHorde over createCharacterRig({url:'models/zombie.glb'}), slots pinned to the death
   state, fed by `zombie:death` — HOARD-CONTRACT §Game-layer builds; DONE #5: corpses persist ≥ CORPSE_TTL_S
   / to CORPSE_CAP, never vanish) + the synthesized game voice (B5: createSfxKit over createAudioBus —
   layered gunshot + all event classes + positional zombie vocals) + the night/wave-keyed dread ambient bed
   (createAmbientBed.setDread) + a positional-groan scheduler ("hear them flanking"). Everything is EVENT-DRIVEN and COSMETIC — fx never perturbs the sim (its only rolls
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
  createAudioBus, createAmbientBed, createSfxKit,
} from '@lgr/engine-core';
import { createFxCore } from './fx-graph.js';

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
  let _nfLastFill = -1;   // A2: last night-factor the corpse horde's night-fill was set to
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
  const sfx = createSfxKit(bus);                         // B5: synthesized game voice (layered gunshot, all events, positional vocals)
  const ambient = bus ? createAmbientBed(bus, { preset: 3 }) : null;   // preset 3 DEEP DRIFT — Lusion-lean dread

  // B5 — the LISTENER for positional vocals: the FP eye when dived, else the iso survivor pose. Hoisted
  // scratch (getListener is called on death events + the groan scheduler, not per-frame-hot).
  const _lis = { x: 0, z: 0, fx: 0, fz: 1 }, _fwd = new THREE.Vector3();
  function getListener() {
    if (ctx.dive && ctx.dive.active && ctx.rig && ctx.rig.camera) {
      const c = ctx.rig.camera; _fwd.set(0, 0, -1).applyQuaternion(c.quaternion);
      const l = Math.hypot(_fwd.x, _fwd.z) || 1;
      _lis.x = c.position.x; _lis.z = c.position.z; _lis.fx = _fwd.x / l; _lis.fz = _fwd.z / l;
    } else if (registry.has('player')) {
      const p = registry.get('player').player; _lis.x = p.x; _lis.z = p.z; _lis.fx = Math.sin(p.facing); _lis.fz = Math.cos(p.facing);
    }
    return _lis;
  }
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
    particles, decals, sfx, sink, getListener,
  });

  // B5 CONTINUOUS AUDIO — the dread keying + the positional-groan scheduler run here (glue with registry
  // access), not in the pure graph. Both no-op headless (bus locked pre-gesture) so determinism is untouched.
  let _dreadClock = 0, _groanClock = 1.5;
  function stepAudio(dt) {
    // DREAD: swell/crawl the bed with night + wave pressure (day = quiet-uneasy, deep-night swarm = crawl).
    _dreadClock += dt;
    if (ambient && _dreadClock > 0.4) {
      _dreadClock = 0;
      const world = registry.has('world') ? registry.get('world') : null;
      const sim = registry.has('sim') ? registry.get('sim') : null;
      const nf = world ? world.nightFactor() : 0;
      const wavePressure = sim ? Math.min(1, sim.state.alive / 18) : 0;
      ambient.setDread(Math.min(1, nf * 0.65 + wavePressure * 0.5));
    }
    // POSITIONAL GROANS: an ambient moan from a nearby LIVE zombie, paced by density (faster when swarmed).
    // Only when the audio context is actually running (sfx.ready) — so it never fires (or allocs) headless.
    if (sfx && sfx.ready) {
      _groanClock -= dt;
      if (_groanClock <= 0) {
        const sim = registry.has('sim') ? registry.get('sim') : null;
        const zs = sim ? sim.audioSample(8) : [];
        if (zs.length) sfx.groan({ pos: zs[(Math.random() * zs.length) | 0], listener: getListener() });
        const density = Math.min(1, zs.length / 8);
        _groanClock = 2.4 - 1.5 * density + Math.random() * 0.8;   // ~0.9–3.2 s, faster in a swarm
      }
    }
  }

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
      stepAudio(dt);   // B5: dread keying + positional-groan scheduler (wall-clock; no-op headless/pre-unlock)
      // A2 ALIVE-AT-NIGHT: the CORPSES read at night too (a body in the moonlight, not a black hole), same
      // night-fill as the live swarm; re-applied only when the night factor moves.
      if (horde) {
        const w = registry.has('world') ? registry.get('world') : null;
        const nf = w ? w.nightFactor() : 0;
        if (Math.abs(nf - _nfLastFill) > 0.004) { horde.setNightFill(nf); _nfLastFill = nf; }
      }
    },
    counts() { return core.counts(); },
    dispose() { core.dispose(); if (ambient) ambient.stop(); if (gpu) gpu.dispose(); dec.dispose(); if (horde) horde.dispose(); corpseRig.dispose(); },
  };
  registry.register('fx', facade);
  ctx.probe.counts = () => core.counts();   // DONE #5: the harness reads counts() for corpse persistence
  // B5 AUDIO probe handle — the measured-sanity harness unlocks + taps the bus, fires each voice, reads
  // levels (headless audio can't be HEARD, so the owner's ears are the exit gate — this proves it's WIRED).
  ctx.probe.audio = { get bus() { return bus; }, get sfx() { return sfx; }, get ambient() { return ambient; } };
  return facade;
}
