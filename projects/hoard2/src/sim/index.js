/* ============================================================
   hoard2 · src/sim — the SIM owner (game state, wave director, zombies, survival, drops, determinism).
   ------------------------------------------------------------
   Composition root for the simulation. The pure, node-tested RULES live in sibling modules
   (survival.js · wave-director.js · zombies.js); THIS file wires them to the engine (flow-field pathing +
   the rigged render horde), the ctx registry (player/world/build facades), the event bus, and the probe
   hooks — the parts that need THREE and therefore can't run under node.

   PINNED FACADE (register('sim', …)), EXACTLY per INTEGRATION.md:
     state · queryTargets(seg) · trySpendStamina(cost) · damagePlayer(amount,from) · probe() · update(dt,t)
   EMITS:   wave:start/clear · zombie:spawn/death · player:damage · player:death · item:pickup
   CONSUMES: weapon:hit / melee:hit (apply damage to the hit zombie) · barrier:place / barrier:breach
             (rebuild the flow field's obstacle set) · world.nightFactor() · player.player · build.aabbs()/hitBarrier()
   PROBE HOOKS: ctx.probe.spawnWave(n) · ctx.probe.starve() · ctx.probe.hurt(amount)

   Engine is FROZEN — we only CALL factories (createCharacterRig/Horde, createFlowField). Determinism
   (DONE #10): every roll is off rng.fork('sim'); the sim clock is time.simDt(dt). No Math.random, no
   per-frame allocation in update (all scratch hoisted). C++ anchor: ctx ≈ a service locator handed to a
   subsystem's ctor; the facade ≈ its public vtable.
   ============================================================ */
import { createCharacterRig, createCharacterHorde, createFlowField } from '@lgr/engine-core';
import { createSurvival } from './survival.js';
import { createWaveDirector } from './wave-director.js';
import { createZombiePool } from './zombies.js';

const CONTACT_R = 0.6;  // player maul radius (v1 hoard.js:108 CONTACT_R 0.52 + horde body slack)
const IFRAME = 0.5;     // seconds between contact-damage TICKS (so player:damage isn't emitted 60×/s)
const DROP_SLOTS = 32;  // active dropped-item pool (bounded; a drop past the cap is skipped)
const DROP_TTL = 30;    // seconds a dropped item lingers before it despawns

export function createSim(ctx) {
  const { config, rng, time, registry, events, probe, scene, rig } = ctx;
  const srng = rng.fork('sim'); // the ONLY randomness source in the sim (determinism spine)

  const pool = createZombiePool(config, srng);
  const survival = createSurvival(config);

  let kills = 0, score = 0, _nf = 0;
  let field = null, _fieldDirty = false;
  let horde = null, zRig = null;
  const _zType = new Array(pool.max).fill(null);       // last type mirrored per slot (avoid redundant setType)
  const _typeMat = { walker: null, runner: null, tank: null };
  const _zPrevFlash = new Float32Array(pool.max);      // B3: prev-frame flash per slot → hit-react on the rising edge
  // B3 per-TYPE motion personality (cheap character): runner TWITCHY (fast wide head-look, sharp flinch),
  // tank PONDEROUS (slow narrow head-look, heavy slow flinch). Zombie flinch amp is modest — they also play
  // the HitReact CLIP on flash; the layer adds a DIRECTIONAL recoil the clip lacks.
  const ZLAYER = {
    walker: { headLook: { cone: 1.3, speed: 5 },   hitReact: { amp: 0.6, dur: 0.4 } },
    runner: { headLook: { cone: 1.6, speed: 11 },  hitReact: { amp: 0.7, dur: 0.26 } },
    tank:   { headLook: { cone: 1.0, speed: 2.5 }, hitReact: { amp: 0.8, dur: 0.6, lean: 0.6 } },
  };

  // ---- read-only game snapshot other owners + the HUD read (mutated in place; never reallocated) ----
  const state = {
    wave: 0, kills: 0, score: 0, alive: 0,
    hp: config.SURVIVE.hpMax, hunger: config.SURVIVE.hungerMax, stamina: config.SURVIVE.staminaMax,
    dead: false, cause: null, runTime: 0,
  };

  // ---- hoisted event payloads (no per-frame alloc; listeners consume synchronously in the same tick) ----
  const _waveP = { n: 0, count: 0, night: 0 };
  const _spawnP = { id: 0, type: 'walker', pos: { x: 0, y: 0, z: 0 } };
  const _deathP = { id: 0, type: 'walker', pos: { x: 0, y: 0, z: 0 }, drops: undefined };
  const _dmgP = { amount: 0, from: 'zombie', hp: 0 };
  const _deathPl = { cause: 'injury' };
  const _pickP = { kind: 'food' };

  // ---- hoisted step scratch ----
  const _player = { x: 0, z: 0 };
  const _cen = { x: 0, z: 0 };
  const _stepS = { player: _player, field: null, contactR: CONTACT_R, nf: 0, aabbs: null, hitBarrier: null, damagePlayer: null };
  let _build = null; // per-frame cached build facade (barrier hits / aabbs)

  // ---- dropped items (food/scrap/bandage from the dead) — a small fixed pool ----
  const drops = [];
  for (let i = 0; i < DROP_SLOTS; i++) drops.push({ active: false, kind: 'food', x: 0, z: 0, ttl: 0 });

  // ---- contact-damage accumulator (batch a maul into one iframed tick) ----
  let _contactAcc = 0, _contactTimer = 0;

  /* ---- injury application (shared by zombie contact, build breach, probe.hurt) ---- */
  function applyPlayerDamage(amount, from) {
    if (amount <= 0) return;
    survival.damage(amount);
    _dmgP.amount = amount; _dmgP.from = from; _dmgP.hp = survival.state.hp;
    events.emit('player:damage', _dmgP);
  }
  function onContactDamage(amount) { _contactAcc += amount; } // hoisted callback the zombie step calls

  survival.setOnDeath((cause) => { _deathPl.cause = cause; events.emit('player:death', _deathPl); });

  /* ---- spawn n zombies for the current wave; returns how many actually fit the pool ---- */
  function requestSpawn(nWant) {
    let got = 0;
    for (let i = 0; i < nWant; i++) {
      const z = pool.spawn(director.wave, _nf, _player.x, _player.z); // ring around the survivor (playtest #2 pacing)
      if (!z) break;
      got++;
      _spawnP.id = z.id; _spawnP.type = z.type;
      _spawnP.pos.x = z.x; _spawnP.pos.y = config.GROUND_Y; _spawnP.pos.z = z.z;
      events.emit('zombie:spawn', _spawnP);
    }
    return got;
  }

  const director = createWaveDirector(config, {
    nightAt: () => _nf,
    requestSpawn,
    onStart: (n, count, night) => { _waveP.n = n; _waveP.count = count; _waveP.night = night; events.emit('wave:start', _waveP); },
    onClear: (n, count, night) => { score += config.SCORE.perWave; _waveP.n = n; _waveP.count = count; _waveP.night = night; events.emit('wave:clear', _waveP); },
  });

  /* ---- a zombie died → score it, announce it, scatter its drop ---- */
  function onKill(death) {
    const z = death.z;
    kills++; score += config.SCORE.perKill;
    _deathP.id = z.id; _deathP.type = z.type;
    _deathP.pos.x = z.x; _deathP.pos.y = config.GROUND_Y; _deathP.pos.z = z.z;
    _deathP.drops = death.drops.length ? death.drops : undefined;
    events.emit('zombie:death', _deathP);
    for (let i = 0; i < death.drops.length; i++) spawnDrop(death.drops[i], z.x, z.z);
  }
  function idOf(t) { return typeof t === 'number' ? t : (t && t.id); }
  // Player weapons resolve their hit target, then tell the sim to apply the damage (sim owns zombie HP).
  events.on('weapon:hit', (p) => { if (p && p.target != null) { const d = pool.damage(idOf(p.target), p.damage || 0); if (d) onKill(d); } });
  events.on('melee:hit', (p) => { if (p && p.target != null) { const d = pool.damage(idOf(p.target), p.damage || 0); if (d) onKill(d); } });
  // Placing/breaching a barrier changes the blocked cells → rebuild the flow field's obstacle mask.
  events.on('barrier:place', () => { _fieldDirty = true; });
  events.on('barrier:breach', () => { _fieldDirty = true; });

  /* ---- dropped-item pool ---- */
  function spawnDrop(kind, x, z) {
    for (let i = 0; i < DROP_SLOTS; i++) { const d = drops[i]; if (!d.active) { d.active = true; d.kind = kind; d.x = x; d.z = z; d.ttl = DROP_TTL; return; } }
  }
  function updateDrops(sdt) {
    const px = _player.x, pz = _player.z;
    for (let i = 0; i < DROP_SLOTS; i++) {
      const d = drops[i]; if (!d.active) continue;
      d.ttl -= sdt; if (d.ttl <= 0) { d.active = false; continue; }
      const dx = px - d.x, dz = pz - d.z;
      if (dx * dx + dz * dz < 1.2 * 1.2) { // survivor walks over it → pick up
        d.active = false;
        survival.applyPickup(d.kind);
        _pickP.kind = d.kind; events.emit('item:pickup', _pickP);
      }
    }
  }

  /* ---- flow field (lazy: world + build register before frame 1, so first update is safe) ---- */
  function initField(world) {
    field = createFlowField({ center: { x: 0, z: 0 }, radius: config.ARENA_EXTENT, cellSize: 0.6, agentRadius: 0.3, maxAgents: pool.max });
    rebuildField(world);
  }
  function rebuildField(world) {
    if (!field) return;
    const obs = world.obstacles ? world.obstacles() : [];
    // build.aabbs() uses lowercase keys; createFlowField wants {minX,minZ,maxX,maxZ}. Adapter runs only on rebuild.
    const aabbs = _build && _build.aabbs ? _build.aabbs().map((a) => ({ minX: a.minx, minZ: a.minz, maxX: a.maxx, maxZ: a.maxz })) : [];
    field.rebuildObstacles(obs, aabbs);
  }

  /* ---- render mirror: 1:1 sim → rigged horde (v1 main.js:364-381 pattern). Loads async; guarded. ---- */
  zRig = createCharacterRig({ url: 'models/zombie.glb' });
  zRig.ready.then(() => {
    horde = createCharacterHorde(zRig, { size: pool.max, lodDistance: 14, lodHz: 3, baseScale: 1 });
    scene.add(horde.group);
    buildTypeMaterials();
  }).catch(() => { /* asset missing → sim still runs headless-correct; render is graceful (HitReact) */ });

  function buildTypeMaterials() {
    try {
      let base = null; horde.get(0).object.traverse((n) => { if (n.isMesh && !base) base = n.material; });
      if (!base) return;
      const tints = { walker: 0x8fae5a, runner: 0xbfe06a, tank: 0x415033 }; // baseline distinctness; fx owns the final look
      for (const k of Object.keys(tints)) { const m = base.clone(); if (m.color) m.color.setHex(tints[k]); _typeMat[k] = m; }
    } catch (_e) { /* tint is cosmetic — scale-only fallback keeps types distinct */ }
  }

  function mirror(sdt) {
    if (!horde) return;
    const p = _player, cr = CONTACT_R + 0.35;
    for (let i = 0; i < pool.max; i++) {
      const z = pool.get(i);
      if (!z.alive) { if (_zType[i] !== null) { horde.setActive(i, false); _zType[i] = null; } continue; }
      horde.setActive(i, true);
      if (_zType[i] !== z.type) { _zType[i] = z.type; horde.setType(i, { scale: config.ZTYPE[z.type].scale, material: _typeMat[z.type] || undefined }); horde.setLayerParams(i, ZLAYER[z.type] || ZLAYER.walker); }
      const dx = p.x - z.x, dz = p.z - z.z, d = Math.hypot(dx, dz), sp = Math.hypot(z.vx, z.vz);
      let stt;
      if (z.flash > 0.06) stt = 'hit';
      else if (z.attacking || d < cr) stt = 'attack';
      else if (z.type === 'runner' || sp > 1.3) stt = 'run';
      else if (sp > 0.15) stt = 'walk';
      else stt = 'idle';
      horde.setState(i, stt);
      // B3: the body faces where it's MOVING (velocity) when in motion, else the survivor — so a walker
      // flanking around a ruin turns its BODY along its path while its HEAD cranes toward you (the dread
      // read). A directional flinch fires on the rising edge of the hit flash (recoil AWAY from the shot).
      const yaw = sp > 0.5 ? Math.atan2(z.vx, z.vz) : Math.atan2(dx, dz);
      horde.setTransform(i, z.x, config.GROUND_Y, z.z, yaw);
      if (z.flash > 0.06 && _zPrevFlash[i] <= 0.06) horde.hitReact(i, z.x - p.x, z.z - p.z);
      _zPrevFlash[i] = z.flash;
    }
    // every live head tracks the survivor within its cone (the "walkers turn to look at you" dread layer).
    horde.setLookTarget(p.x, config.EYE_Y, p.z);
    const cp = (rig && rig.camera && rig.camera.position) || null;
    horde.update(sdt, cp ? cp.x : p.x, cp ? cp.y : 2, cp ? cp.z : p.z);
  }

  function syncState() {
    state.wave = director.wave; state.kills = kills; state.score = score; state.alive = pool.alive;
    state.hp = survival.state.hp; state.hunger = survival.state.hunger; state.stamina = survival.state.stamina;
    state.dead = survival.state.dead; state.cause = survival.state.cause;
  }

  // ---- hoisted step callbacks (created once) ----
  const _hitBarrier = (id, amt) => { if (_build && _build.hitBarrier) _build.hitBarrier(id, amt); };
  _stepS.hitBarrier = _hitBarrier;
  _stepS.damagePlayer = onContactDamage;

  const facade = {
    state,
    queryTargets: (seg) => pool.queryTargets(seg),
    // B5 AUDIO: sample up to `max` LIVE zombie positions for the positional-groan scheduler (fx-audio owns
    // the pacing/panning). Read-only snapshot of {x,z}; never a sim roll (audio is decorrelated cosmetics).
    audioSample(max = 8) { const out = []; for (let i = 0; i < pool.max && out.length < max; i++) { const z = pool.get(i); if (z.alive) out.push({ x: z.x, z: z.z }); } return out; },
    queryCone: (px, pz, dx, dz, cosHalf, range) => pool.queryCone(px, pz, dx, dz, cosHalf, range), // gun aim-assist

    trySpendStamina: (cost) => survival.trySpend(cost),
    damagePlayer: (amount, from) => applyPlayerDamage(amount, from || 'unknown'),
    probe: () => {
      let px = _player.x, pz = _player.z;
      if (pool.centroid(_cen)) { px = _cen.x; pz = _cen.z; }
      return { rt: state.runTime, wave: director.wave, kills, score, alive: pool.alive, hp: survival.state.hp, hunger: survival.state.hunger, night: _nf, px, pz };
    },
    update(dt, _t) {
      const sdt = time.simDt(dt);                 // dilated sim clock (zombies crawl while dived)
      const world = registry.get('world');
      _build = registry.has('build') ? registry.get('build') : null;
      _nf = world.nightFactor();
      const pp = registry.get('player').player; _player.x = pp.x; _player.z = pp.z;

      if (!field) initField(world);
      else if (_fieldDirty) { rebuildField(world); _fieldDirty = false; }

      director.step(sdt, pool.alive);             // spawn schedule / wave transitions

      _stepS.field = field; _stepS.nf = _nf; _stepS.aabbs = _build ? _build.aabbs() : null;
      pool.step(sdt, _stepS);                     // crowd pathing + barrier/contact damage

      // Batch contact damage into one iframed tick so player:damage isn't spammed every frame.
      _contactTimer -= sdt;
      if (_contactAcc > 0 && _contactTimer <= 0) { applyPlayerDamage(_contactAcc, 'zombie'); _contactAcc = 0; _contactTimer = IFRAME; }

      survival.update(sdt);
      updateDrops(sdt);
      state.runTime += sdt;
      syncState();
      mirror(sdt);
    },
  };

  // ---- probe hooks (the harness drives these; no silent caps) ----
  if (probe) {
    probe.spawnWave = (n) => director.forceWave(n);
    probe.starve = () => survival.forceStarve();
    probe.hurt = (amount) => applyPlayerDamage(amount, 'probe');
  }

  registry.register('sim', facade);
  return facade;
}
