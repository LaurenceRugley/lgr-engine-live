/* ============================================================
   hoard2 · src/sim — the SIM owner (game state, wave director, zombies, survival, drops, determinism).
   ------------------------------------------------------------
   Composition root for the simulation. The pure, node-tested RULES live in sibling modules
   (survival.js · wave-director.js · zombies.js); THIS file wires them to the engine (flow-field pathing +
   the rigged render horde), the ctx registry (player/world/build facades), the event bus, and the probe
   hooks — the parts that need THREE and therefore can't run under node.

   PINNED FACADE (register('sim', …)), EXACTLY per INTEGRATION.md:
     state · queryTargets(seg) · trySpendStamina(cost) · damagePlayer(amount,from) · probe() · update(dt,t)
   EMITS:   wave:start/clear · zombie:spawn/death · infection:bite/turn · player:damage · player:death · item:pickup
   CONSUMES: weapon:hit / melee:hit (apply damage to the hit zombie) · barrier:place / barrier:breach
             (rebuild the flow field's obstacle set) · world.nightFactor() · player.player · build.aabbs()/hitBarrier()
   PROBE HOOKS: ctx.probe.spawnWave(n) · ctx.probe.starve() · ctx.probe.hurt(amount) · ctx.probe.infect(n)
     · ctx.probe.kill(n) (A-CENSUS: n real zombie deaths → n corpses) · ctx.probe.groundProbeCount()
     (possession) · ctx.probe.groundContact() (CONSUMPTION — the engine's measured-floor receipt)
     · ctx.probe.characterClasses (the shared class registry — see main.js's contract block)

   Engine is FROZEN — we only CALL factories (createCharacterRig/Horde, createFlowField). Determinism
   (DONE #10): every roll is off rng.fork('sim'); the sim clock is time.simDt(dt). No Math.random, no
   per-frame allocation in update (all scratch hoisted). C++ anchor: ctx ≈ a service locator handed to a
   subsystem's ctor; the facade ≈ its public vtable.
   ============================================================ */
import { createCharacterRig, createCharacterHorde, createFlowField, heightFieldProbe } from '@lgr/engine-core';
import { createSurvival } from './survival.js';
import { createWaveDirector } from './wave-director.js';
import { createZombiePool } from './zombies.js';
import { createCivilianPool } from './civilians.js';

const CONTACT_R = 0.6;  // player maul radius (v1 hoard.js:108 CONTACT_R 0.52 + horde body slack)
const IFRAME = 0.5;     // seconds between contact-damage TICKS (so player:damage isn't emitted 60×/s)
const DROP_SLOTS = 32;  // active dropped-item pool (bounded; a drop past the cap is skipped)
const DROP_TTL = 30;    // seconds a dropped item lingers before it despawns

export function createSim(ctx) {
  const { THREE, config, rng, time, registry, events, probe, scene, rig } = ctx;
  const srng = rng.fork('sim'); // the ONLY randomness source in the sim (determinism spine)

  // M1 MOBILE TRUTH: mobile caps the live horde near v1's class (config.MAXZ_MOBILE). pool.max flows into the
  // render horde size below, so this ONE number sizes both the sim pool and the skinned-rig count.
  const pool = createZombiePool(config, srng, ctx.mobile ? config.MAXZ_MOBILE : config.MAXZ);
  const survival = createSurvival(config);

  // OUTBREAK Phase 1 — the civilian population (S/E of SEIR; the zombie pool is I, the corpse pool is R).
  // Density is the DIRECTOR-OWNED dial: config.CIVS.count (mobile: countMobile — the same skinned-rig
  // budget law as MAXZ_MOBILE). ?civs=<n> overrides for A/B; ?noflee=1 disables flee steering — the
  // control arm for the "flee actually flees" measurement. sepCap sizes the SHARED separation list
  // (civilians + zombies ride one spatial-hash build — see civilians.js header).
  const _oq = ctx.flags && ctx.flags.q;
  const _civCap = _oq && _oq.get('civs') != null ? Math.max(0, +_oq.get('civs') || 0) : (ctx.mobile ? config.CIVS.countMobile : config.CIVS.count);
  const civs = createCivilianPool(config, srng, { cap: _civCap, sepCap: pool.max, flee: !(_oq && _oq.get('noflee') === '1') });

  let kills = 0, score = 0, _nf = 0;
  let field = null, _fieldDirty = false;
  let horde = null, zRig = null;
  let _nfLastFill = -1;   // A2: last night-factor the swarm's night-fill emissive was set to (re-apply on change)
  const _zType = new Array(pool.max).fill(null);       // last type mirrored per slot (avoid redundant setType)
  const _typeMat = { walker: null, runner: null, tank: null };
  const _zPrevFlash = new Float32Array(pool.max);      // B3: prev-frame flash per slot → hit-react on the rising edge
  const _zAtk = new Uint8Array(pool.max);              // A1: prev-frame "attacking" per slot → attack one-shot on the rising edge
  const _zYaw = new Float32Array(pool.max).fill(999);  // A6-2 turn-in-place: displayed body yaw per slot (999 = uninit → snap on first active frame)
  // B3 per-TYPE motion personality (cheap character): runner TWITCHY (fast wide head-look, sharp flinch),
  // tank PONDEROUS (slow narrow head-look, heavy slow flinch). Zombie flinch amp is modest — they also play
  // the HitReact CLIP on flash; the layer adds a DIRECTIONAL recoil the clip lacks.
  // A8-4 PER-TYPE ATTACK PERSONALITY — the lunge (the procedural attack beat) now differs by type so a crowd
  // reads as a mix, not a synchronised line: a runner SNAPS in fast + shallow with a head thrust; a tank
  // LEANS in slow + deep + heavy; a walker is the medium default. hitReact tuned as before.
  const ZLAYER = {
    walker: { headLook: { cone: 1.3, speed: 5 },   hitReact: { amp: 0.6, dur: 0.4 },  lunge: { amp: 1.0, dur: 0.34, lean: 0.55, head: 0.35 } },
    runner: { headLook: { cone: 1.6, speed: 11 },  hitReact: { amp: 0.7, dur: 0.26 }, lunge: { amp: 0.85, dur: 0.22, lean: 0.42, head: 0.55 } },
    tank:   { headLook: { cone: 1.0, speed: 2.5 }, hitReact: { amp: 0.8, dur: 0.6, lean: 0.6 }, lunge: { amp: 1.35, dur: 0.5, lean: 0.8, head: 0.22 } },
  };
  // A8-4 per-type ATTACK-CLIP rate (the Punch one-shot plays faster on a runner, ponderously on a tank).
  const ZATK = { walker: 1.0, runner: 1.5, tank: 0.72 };
  // A8-4 PER-INSTANCE DESYNC — a deterministic per-slot jitter (golden-ratio index hash, ~[0.85,1.15]; NO rng
  // → determinism-safe) that stretches/compresses each rig's lunge timing, so even two adjacent walkers don't
  // lunge in lockstep. Applied to the layer params when a slot's type is (re)assigned.
  const _PHI = 0.6180339887;
  const slotLayer = (i, type) => {
    const base = ZLAYER[type] || ZLAYER.walker;
    const jit = 0.85 + 0.3 * (((i + 1) * _PHI) % 1);
    return base.lunge ? { ...base, lunge: { ...base.lunge, dur: base.lunge.dur * jit } } : base;
  };

  // ---- read-only game snapshot other owners + the HUD read (mutated in place; never reallocated) ----
  const state = {
    wave: 0, kills: 0, score: 0, alive: 0,
    hp: config.SURVIVE.hpMax, hunger: config.SURVIVE.hungerMax, stamina: config.SURVIVE.staminaMax,
    dead: false, cause: null, runTime: 0,
    civs: 0, exposed: 0, // OUTBREAK: live susceptibles / incubating victims (HUD + telemetry read these)
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
  const _stepS = { player: _player, field: null, contactR: CONTACT_R, nf: 0, aabbs: null, hitBarrier: null, damagePlayer: null, civs };
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

  /* ---- flow fields (lazy: world + build register before frame 1, so first update is safe) ----
     TWO fields over the same grid/obstacles: `field` (single-target, toward the survivor — the zombies'
     hunt, unchanged) and `fleeField` (MULTI-SOURCE, seeded from every live zombie — cost = grid distance
     to the nearest infectious; civilians ASCEND it). The flee field re-seeds on its own throttle
     (CIVS.fleeResolveS) because its sources are the whole horde, not one point — update()'s
     moved-a-cell epsilon has no meaning for it (see createFlowField's multi-source note). */
  function initField(world) {
    field = createFlowField({ center: { x: 0, z: 0 }, radius: config.ARENA_EXTENT, cellSize: 0.6, agentRadius: 0.3, maxAgents: pool.max });
    fleeField = createFlowField({ center: { x: 0, z: 0 }, radius: config.ARENA_EXTENT, cellSize: 0.6, agentRadius: 0.3, maxAgents: pool.max + civs.max });
    rebuildField(world);
    // The population arrives with the field (deterministic: same call order every boot; scatter rolls
    // ride rng.fork('sim') before the first wave's spawn rolls).
    civs.populate(fleeField);
    reseedFlee(); // zero zombies at boot → an empty solve = every cell reads SAFE
  }
  function rebuildField(world) {
    if (!field) return;
    const obs = world.obstacles ? world.obstacles() : [];
    // build.aabbs() uses lowercase keys; createFlowField wants {minX,minZ,maxX,maxZ}. Adapter runs only on rebuild.
    const aabbs = _build && _build.aabbs ? _build.aabbs().map((a) => ({ minX: a.minx, minZ: a.minz, maxX: a.maxx, maxZ: a.maxz })) : [];
    field.rebuildObstacles(obs, aabbs);
    fleeField.rebuildObstacles(obs, aabbs);
  }

  /* ---- OUTBREAK: flee-field seeding + the SEIR event hooks ---- */
  let fleeField = null, _fleeAcc = 0;
  let bites = 0, turns = 0;
  // Hoisted threat list: reused {x,z} records + a rebuilt array, but only on the throttle (≈2.5 Hz),
  // never per frame — the push churn is off the hot path (events.js's one-shot-alloc precedent).
  const _threatObjs = []; for (let i = 0; i < pool.max; i++) _threatObjs.push({ x: 0, z: 0 });
  const _threatList = [];
  function reseedFlee() {
    _threatList.length = 0;
    for (let i = 0; i < pool.max; i++) {
      const z = pool.get(i);
      if (z.alive) { const o = _threatObjs[_threatList.length]; o.x = z.x; o.z = z.z; _threatList.push(o); }
    }
    fleeField.solve(_threatList); // multi-source: cost = grid steps to the NEAREST live zombie
  }
  const _biteP = { id: 0, pos: { x: 0, y: 0, z: 0 }, incubateS: 0 };
  const _turnP = { id: 0, zid: 0, type: 'walker', pos: { x: 0, y: 0, z: 0 } };
  function onBite(c) {
    bites++;
    _biteP.id = c.id; _biteP.incubateS = c.incubDur;
    _biteP.pos.x = c.x; _biteP.pos.y = config.GROUND_Y; _biteP.pos.z = c.z;
    events.emit('infection:bite', _biteP);
  }
  function onTurn(c) {
    const z = pool.spawnAt(c.x, c.z, director.wave, _nf); // the victim rises WHERE IT FELL
    if (!z) return false; // pool saturated → civilians.js holds the victim at the threshold and retries
    turns++;
    _spawnP.id = z.id; _spawnP.type = z.type;
    _spawnP.pos.x = z.x; _spawnP.pos.y = config.GROUND_Y; _spawnP.pos.z = z.z;
    events.emit('zombie:spawn', _spawnP); // the new zombie is an ordinary pool member — every listener sees it
    _turnP.id = c.id; _turnP.zid = z.id; _turnP.type = z.type;
    _turnP.pos.x = c.x; _turnP.pos.y = config.GROUND_Y; _turnP.pos.z = c.z;
    events.emit('infection:turn', _turnP);
    return true;
  }
  const _civS = { field: null, zpool: pool, threatCount: 0, aabbs: null, onBite, onTurn };

  /* ---- render mirror: 1:1 sim → rigged horde (v1 main.js:364-381 pattern). Loads async; guarded. ---- */
  // A6-2 STRIDE-RATE — MEASURED NEGATIVE RESULT (slip probe, tools/hoard2-slip-probe.mjs): physically-correct
  // stride-rate scaling does NOT beat the rig's existing sublinear speed→timeScale heuristic for foot-plant on
  // this shambling zombie clip (plantRatio ~0.31 heuristic vs ~0.41 stride, consistent across seeds/tunings).
  // The clip's stance foot doesn't hold cleanly at any playback rate → the real fix would be foot IK (the
  // B3-skipped work), per the brief's fallback. So the zombies stay on the heuristic (walkStride unset = off);
  // strideTimeScale stays a tested, opt-in engine ability for a future clip with a proper stance phase.
  const _zq = ctx.flags && ctx.flags.q;
  const _noTurn = !!(_zq && _zq.has('noturn'));   // A6-2 A/B knob: disable turn-in-place (snap facing) for the slip probe
  const _turnRate = _zq && _zq.has('turnrate') ? +_zq.get('turnrate') : config.ZOMBIE_TURN_RATE;   // owner taste knob
  // A7-2 FOOT IK — the MEASURED lever A6-2's slip probe pointed at (stride-rate was proven not to help this
  // clip → foot IK is the real fix). plant-and-hold: the support foot pins to the ground while the hips move,
  // killing the skate. Desktop-only (mobile skips the motion layers → no IK, keeps its M1 clip-only class).
  // DEFAULT OFF pending the owner's by-feel review (his ruling 2026-07-29) — ?footik=1 opts in (the A/B lever;
  // the slip probe measured NEAR-cohort plantRatio 0.041 → 0.005 with it on). Flip the default back once reviewed.
  const _footIkOn = !!(_zq && _zq.get('footik') === '1');
  /* ── ARC A-GROUND (2026-08-20) — ARM THE MEASURED FLOOR. The rig takes the measured path only when it
     has BOTH halves (createCharacterRig.js:834 `_footIK.groundProbe && _surfaceProbe`); with either
     missing it silently computes the original INFERRED floor — a leaky-min over the rig's own feet,
     which is self-referential and therefore cannot notice that a body was placed below the real ground.
     `heightFieldProbe` is the engine's adapter from this project's ground AUTHORITY (`world.groundAt`,
     a flat constant here by ratification #8) to the `segmentHit` dialect the ability speaks. The world
     is resolved LAZILY, inside the rig's async ready callback, because this runs after a GLB fetch and
     the registry is not guaranteed populated at module-construction time. Presentation-only: the probe
     is read by the foot-lock, which moves BONES — never a sim position, never the determinism trace. */
  /* ARC A-CENSUS (2026-08-20) — ONE CALL, ONE RECEIPT, AND NO BOOLEAN LEFT TO DROP. `armGroundProbe`
     returned a boolean saying whether the probe was built, and BOTH call sites discarded it: a live
     silent-failure path that merely happened not to fire (if the world registry were empty, or `groundAt`
     absent, the horde would keep the INFERRED floor and nothing would say so). Two calls that had to be
     kept in step — arm the probe, then ask for `groundProbe:true` — were also two chances to drift apart.
     They are now ONE call that returns the engine's own receipt (createCharacterRig/Horde `groundReport`),
     records it where a probe can read it, and WARNS when the measured floor is not actually armed. There is
     no longer a return value whose loss is silent: ignoring this one still leaves the warning and the
     recorded report. C++ anchor: replacing a `bool` return nobody checked with a status struct plus a
     logged assert — the caller can be lazy, the failure cannot be quiet. */
  /* ── ARC A-CLAMP (2026-08-21) — THE GROUND CLAMP, ON BY DEFAULT, ON ITS OWN SWITCH. -----------------
     A-GROUND's negative result stands: the plant-and-hold foot lock cannot fix clip-driven ground
     penetration, and `?footik=1` measurably made it worse. The clamp is a DIFFERENT mechanism (lift the
     body by the minimum that puts its lowest sole geometry on the floor — engine-core/ground-clamp.js),
     so it gets a DIFFERENT lever: `?clamp=0` turns it off. `?footik`'s OFF default is the owner's
     2026-07-29 by-feel ruling on a different question and is not touched here — sharing one flag would
     make the two impossible to A/B apart, which is exactly how A-GROUND's determinism proof nearly went
     vacuous. NOT gated on `!ctx.mobile`, unlike the foot-lock: the clamp runs outside the motion-layer
     budget (see createCharacterHorde's update loop) and mobile is where the owner playtests, so a phone
     showing bodies in the ground is the bug, not the saving. */
  const _clampOn = !(_zq && _zq.get('clamp') === '0');
  const _clampArm = {};   // class name → the engine's clamp receipt (read by probe.groundClamp)
  function armGroundClamp(h, who) {
    const w = registry.has('world') ? registry.get('world') : null;
    const rep = w && typeof w.groundAt === 'function' ? h.setGroundClamp({ groundAt: w.groundAt }) : null;
    _clampArm[who] = { who, worldFound: !!w, ...(rep || {}), armed: !!rep && !!rep.ok };
    if (!_clampArm[who].armed) {
      console.warn(`[hoard2] ${who}: GROUND CLAMP requested but NOT armed — ${!w ? 'no world.groundAt to clamp against' : (rep ? rep.reason : 'the rig returned no receipt')}. Bodies keep whatever Y they are placed at, including below the floor.`);
    }
    return _clampArm[who];
  }
  const _groundArm = {};   // class name → the receipt from the last arm attempt (read by probe.groundContact)
  function armMeasuredFloor(h, who, cfg) {
    const w = registry.has('world') ? registry.get('world') : null;
    const p = w && heightFieldProbe(w.groundAt);
    if (p) h.setSurfaceProbe(p);
    const rep = h.setFootIK({ ...cfg, groundProbe: true }) || null;
    const armed = !!p && !!rep && !!rep.ok;
    _groundArm[who] = { who, probeBuilt: !!p, ...(rep || {}), armed };
    if (!armed) {
      console.warn(`[hoard2] ${who}: MEASURED ground floor requested but NOT armed — ${!p ? 'no world.groundAt to build a probe from' : (rep ? rep.reason : 'the rig returned no receipt')}. The foot-lock is running on the INFERRED floor, which cannot notice a body placed below the real ground.`);
    }
    return _groundArm[who];
  }
  zRig = createCharacterRig({ url: 'models/zombie.glb' });
  zRig.ready.then(() => {
    // M1 MOBILE TRUTH: on mobile the horde opts OUT of shadow-casting (characters leave the shadow pass, so
    // its caster set stays static + cheap) and skips the procedural motion layers (head-look IK / flinch) —
    // the walk/attack/death CLIPS still play, so the swarm reads; only the extra per-bone IK math is dropped.
    horde = createCharacterHorde(zRig, { size: pool.max, lodDistance: 14, lodHz: 3, baseScale: 1, castShadow: !ctx.mobile, motionLayers: !ctx.mobile });
    scene.add(horde.group);
    // A7-2: enable plant-and-hold foot IK on the whole zombie pool (near rigs only — the horde's ikDistance
    // gates it to lodDistance). Presentation-only → the determinism trace is untouched. Opt-in (?footik=1)
    // until the owner's by-feel review; default OFF ships the pre-A7-2 clip-only locomotion.
    // A-CENSUS: the arm + the config are one call now, and its receipt is kept (see armMeasuredFloor). On
    // the shipped Quaternius zombie this WARNS — correctly: the rig is flat, so the measured branch cannot
    // run and the horde is on the inferred floor. That is a report of the state, not a change to it.
    if (!ctx.mobile && _footIkOn) armMeasuredFloor(horde, 'zombie horde', { plantBand: 0.14 });
    // A-CLAMP: the zombies are the class no prior arc could touch — flat rig, no toe bone, so every
    // bone-based ruler read them CLEAR (+0.0178) while their foot MESH was at −0.0567. The clamp measures
    // the geometry, so it is the first mechanism that can see them at all.
    if (_clampOn) armGroundClamp(horde, 'zombie horde');
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
      if (!z.alive) { if (_zType[i] !== null) { horde.setActive(i, false); _zType[i] = null; _zYaw[i] = 999; } continue; }
      horde.setActive(i, true);
      if (_zType[i] !== z.type) { _zType[i] = z.type; horde.setType(i, { scale: config.ZTYPE[z.type].scale, material: _typeMat[z.type] || undefined }); horde.setLayerParams(i, slotLayer(i, z.type)); }
      const dx = p.x - z.x, dz = p.z - z.z, d = Math.hypot(dx, dz), sp = Math.hypot(z.vx, z.vz);
      // A1: CONTINUOUS locomotion blend replaces the discrete idle/walk/run state snaps. The rig crossfades
      // idle↔walk↔run from actual speed (0..1, runner top speed 2.65 = full run), so a walker TRUDGES, a
      // runner SPRINTS, a tank LUMBERS — the type read now lives in the gait, not just the scale. Presentation
      // only: the sim speeds are untouched (no balance drift). HIT (flash) and ATTACK (in strike range) ride
      // OVER the blend as one-shots on their rising edges, so a lunging zombie keeps its legs moving.
      horde.setLocomotion(i, Math.min(1, sp / 2.65));   // A1: velocity-driven idle/walk/run blend (heuristic timeScale in the rig)
      const atk = z.attacking || d < cr;
      if (z.flash > 0.06 && _zPrevFlash[i] <= 0.06) { horde.playAction(i, 'hit'); horde.hitReact(i, z.x - p.x, z.z - p.z); }
      else if (atk && !_zAtk[i]) { horde.playAction(i, 'attack', ZATK[z.type] || 1); horde.lunge(i); }   // A5 attack CLIP + A8-4 per-type rate + a forward lunge on the layer seam
      _zAtk[i] = atk ? 1 : 0; _zPrevFlash[i] = z.flash;
      // B3: the body faces where it's MOVING (velocity) when in motion, else the survivor — so a walker
      // flanking around a ruin turns its BODY along its path while its HEAD cranes toward you (the dread read).
      const tgtYaw = sp > 0.5 ? Math.atan2(z.vx, z.vz) : Math.atan2(dx, dz);
      // A6-2 TURN-IN-PLACE: slew the displayed yaw toward the target at a capped rate instead of snapping —
      // a snap teleport-rotates the whole body, sweeping the feet across the ground (the visible "slide" on
      // curves). A newly-active slot (_zYaw=999) snaps once so it doesn't spin up from a stale angle.
      let curYaw = _zYaw[i];
      if (_noTurn || curYaw === 999) { curYaw = tgtYaw; }   // noturn → snap every frame (the pre-A6-2 behaviour)
      else {
        let d = tgtYaw - curYaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const step = _turnRate * sdt;
        curYaw += d > step ? step : d < -step ? -step : d;   // clamp the per-frame turn to the rate
      }
      _zYaw[i] = curYaw;
      horde.setTransform(i, z.x, config.GROUND_Y, z.z, curYaw);
    }
    // every live head tracks the survivor within its cone (the "walkers turn to look at you" dread layer).
    // M1: skipped on mobile — the head-look layer pass is off there, so this per-frame all-slots loop would
    // only set state nothing reads. The walk/attack/death clips still carry the swarm's read.
    if (!ctx.mobile) horde.setLookTarget(p.x, config.EYE_Y, p.z);
    const cp = (rig && rig.camera && rig.camera.position) || null;
    horde.update(sdt, cp ? cp.x : p.x, cp ? cp.y : 2, cp ? cp.z : p.z);
    // A2 ALIVE-AT-NIGHT: lift the swarm off pure black with the night emissive fill (R1's money-shot gap).
    // Re-apply only when the night factor actually moved (the cycle is slow) — a handful of set-calls, not
    // per-frame churn. Visual only; never touches the sim trace (determinism holds).
    if (Math.abs(_nf - _nfLastFill) > 0.004) { horde.setNightFill(_nf); _nfLastFill = _nf; }
  }

  /* ---- OUTBREAK render mirror: civilians ride the SURVIVOR rig (human silhouette, CHAR scale 0.32 —
     the same asset/scale the player renders at, so civilians read as PEOPLE against the zombie horde).
     THE TELEGRAPH (spectator legibility is Phase 1's whole point): an exposed civilian's material color
     LERPS from its street tint to sickly green across the incubation window, its gait drops to a
     stagger (setLocomotion off the slowed sim speed), and a HitReact stumble one-shot fires on a beat
     that TIGHTENS as the turn approaches — so a watcher can pick the next zombie out of the crowd
     seconds early. Presentation only: reads incubT/incubDur, never rolls, never writes the sim. ---- */
  const CIV_SCALE = 0.32; // survivor.glb world scale (player/index.js CHAR_SCALE — same asset)
  // Street-clothes palette, cycled. DELIBERATELY NO GREENS: green is the infection's color axis (zombie
  // types + the E-state ramp below), and the first capture pass proved a sage-tinted healthy civilian
  // reads as mid-incubation from across the arena — the telegraph must own its hue outright.
  const CIV_TINTS = [0xd9c8a6, 0x9db3d1, 0xc98f7d, 0x9a7f63, 0xcdb8c2, 0x8fa0a8];
  const E_TINT = 0x7fae4e; // the sickly green every base tint ramps toward (matches the walker's family)
  let cHorde = null;
  const _civMats = [], _civBase = [];
  const _civOn = new Uint8Array(civs.max);
  const _civYaw = new Float32Array(civs.max).fill(999);
  const _eColor = new THREE.Color(E_TINT);
  let _nfLastFillC = -1;
  if (civs.max > 0) {
    const civRig = createCharacterRig({ url: 'models/survivor.glb', states: { idle: 'Idle', walk: 'Walk', run: 'Run', hit: 'HitReact', death: 'Death' } });
    civRig.ready.then(() => {
      cHorde = createCharacterHorde(civRig, { size: civs.max, lodDistance: 14, lodHz: 3, baseScale: CIV_SCALE, castShadow: !ctx.mobile, motionLayers: !ctx.mobile });
      scene.add(cHorde.group);
      /* A-GROUND: THE CIVILIANS WERE THE SUNK CLASS, AND THEY HAD NO FOOT-LOCK AT ALL. The A-CONTACT
         recon read four sunk feet and attributed them to the horde; the A-GROUND census (35 bodies, one
         per rig root — tools/hoard2-ground-census.mjs) showed the sunk readings were CIVILIANS: 10 of 24
         below ground, worst −0.078 u, while the zombies read +0.0178 and the survivor +0.0009. The cause,
         measured on a single tracked body over 90 frames, is NOT placement — the group origin holds a
         constant 0.3000 — it is the walk clip's TOE dipping to −0.0784 below its own origin plane at
         toe-off. Civilians use the SAME survivor.glb as the hero, so they inherit the same dip; the hero
         had the foot-lock wired and they never did. This is CLAUDE.md's named wiring-drift failure:
         the ability lived in core, one sibling path wired it, another never did.
         Same flag as the horde and the survivor, so one switch still A/B-s all three (see _footIkOn). */
      if (!ctx.mobile && _footIkOn) armMeasuredFloor(cHorde, 'civilians', { plantBand: 0.22 * CIV_SCALE, maxStride: 1.25 * CIV_SCALE });
      if (_clampOn) armGroundClamp(cHorde, 'civilians');   // A-CLAMP: 13 of 24 sunk on the mesh ruler — the biggest class of the defect
      buildCivMaterials();
    }).catch(() => { /* asset missing → sim still runs headless-correct (the zombie-rig precedent) */ });
  }
  function buildCivMaterials() {
    try {
      let base = null; cHorde.get(0).object.traverse((n) => { if (n.isMesh && !base) base = n.material; });
      if (!base) return;
      // Per-SLOT material clones (one-time, pool-sized — not per-frame) so each civilian can tint-shift
      // independently as it incubates. _civBase keeps the street color the lerp starts from.
      for (let i = 0; i < civs.max; i++) {
        const m = base.clone();
        if (m.color) m.color.setHex(CIV_TINTS[i % CIV_TINTS.length]);
        _civMats.push(m); _civBase.push(m.color ? m.color.clone() : null);
        cHorde.setType(i, { material: m });
      }
    } catch (_e) { /* tint is cosmetic — untinted civilians still read via silhouette + gait */ }
  }
  function mirrorCivs(sdt) {
    if (!cHorde) return;
    for (let i = 0; i < civs.max; i++) {
      const c = civs.get(i);
      if (!c.alive) { if (_civOn[i]) { cHorde.setActive(i, false); _civOn[i] = 0; _civYaw[i] = 999; } continue; }
      if (!_civOn[i]) { cHorde.setActive(i, true); _civOn[i] = 1; }
      const sp = Math.hypot(c.vx, c.vz);
      cHorde.setLocomotion(i, Math.min(1, sp / 2.2)); // amble / flee-run / stagger all read straight off sim speed
      if (c.state === 'e' && _civMats[i] && _civBase[i]) {
        const k = Math.min(1, c.incubT / (c.incubDur || 1)); // 0 = just bitten … 1 = turning now
        _civMats[i].color.lerpColors(_civBase[i], _eColor, k);
        // The stumble beat: fires roughly every 1.6 s at first, tightening toward ~0.7 s near the turn.
        const period = 1.6 - 0.9 * k;
        if (c.incubT % period < sdt) { cHorde.playAction(i, 'hit'); cHorde.hitReact(i, c.vx, c.vz); }
      }
      // Face the velocity with a capped slew (the zombies' A6-2 turn-in-place rule, same reason).
      let yaw = _civYaw[i];
      const tgt = sp > 0.15 ? Math.atan2(c.vx, c.vz) : (yaw === 999 ? 0 : yaw);
      if (yaw === 999) yaw = tgt;
      else {
        let d = tgt - yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const stp = 6 * sdt; yaw += d > stp ? stp : d < -stp ? -stp : d;
      }
      _civYaw[i] = yaw;
      cHorde.setTransform(i, c.x, config.GROUND_Y, c.z, yaw);
    }
    const cp = (rig && rig.camera && rig.camera.position) || null;
    cHorde.update(sdt, cp ? cp.x : _player.x, cp ? cp.y : 2, cp ? cp.z : _player.z);
    if (Math.abs(_nf - _nfLastFillC) > 0.004) { cHorde.setNightFill(_nf); _nfLastFillC = _nf; }
  }

  function syncState() {
    state.wave = director.wave; state.kills = kills; state.score = score; state.alive = pool.alive;
    state.hp = survival.state.hp; state.hunger = survival.state.hunger; state.stamina = survival.state.stamina;
    state.dead = survival.state.dead; state.cause = survival.state.cause;
    state.civs = civs.sCount; state.exposed = civs.eCount;
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
    // A11 THE LIGHT CEILING: live zombie FOOTPRINTS for the contact-shadow dynamic pool (read-only snapshot,
    // like audioSample — never a sim roll, purely cosmetic grounding). r = footprint × per-type scale.
    contactSample() { const out = []; for (let i = 0; i < pool.max; i++) { const z = pool.get(i); if (z.alive) out.push({ x: z.x, z: z.z, r: 0.42 * z.scale }); } return out; },
    queryCone: (px, pz, dx, dz, cosHalf, range) => pool.queryCone(px, pz, dx, dz, cosHalf, range), // gun aim-assist

    trySpendStamina: (cost) => survival.trySpend(cost),
    damagePlayer: (amount, from) => applyPlayerDamage(amount, from || 'unknown'),
    probe: () => {
      let px = _player.x, pz = _player.z;
      if (pool.centroid(_cen)) { px = _cen.x; pz = _cen.z; }
      return { rt: state.runTime, wave: director.wave, kills, score, alive: pool.alive, hp: survival.state.hp, hunger: survival.state.hunger, night: _nf, px, pz, civs: civs.sCount, exposed: civs.eCount, bites, turns };
    },
    // OUTBREAK: on-demand civilian snapshot for the flee measurement (read-only, like audioSample —
    // never a sim roll). state 's' | 'e'.
    civSample() { const out = []; for (let i = 0; i < civs.max; i++) { const c = civs.get(i); if (c.alive) out.push({ x: c.x, z: c.z, state: c.state }); } return out; },
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

      // OUTBREAK: the flee field re-seeds from the LIVE zombie set on a throttle (staleness ≤ fleeResolveS
      // — civilian panic tolerates imprecision; the bite prefilter's contactCells covers the drift), then
      // the civilians step: wander → flee → bite → incubate → turn (events fire from the hooks above).
      _fleeAcc += sdt;
      if (_fleeAcc >= config.CIVS.fleeResolveS) { _fleeAcc = 0; reseedFlee(); }
      _civS.field = fleeField; _civS.threatCount = pool.alive; _civS.aabbs = _stepS.aabbs;
      civs.step(sdt, _civS);

      // Batch contact damage into one iframed tick so player:damage isn't spammed every frame.
      _contactTimer -= sdt;
      if (_contactAcc > 0 && _contactTimer <= 0) { applyPlayerDamage(_contactAcc, 'zombie'); _contactAcc = 0; _contactTimer = IFRAME; }

      survival.update(sdt);
      updateDrops(sdt);
      state.runTime += sdt;
      syncState();
      mirror(sdt);
      mirrorCivs(sdt);
    },
  };

  // ---- probe hooks (the harness drives these; no silent caps) ----
  if (probe) {
    probe.spawnWave = (n) => director.forceWave(n);
    probe.starve = () => survival.forceStarve();
    probe.hurt = (amount) => applyPlayerDamage(amount, 'probe');
    // A16 sustained-load probe: refill the meters (hp/hunger/stamina) and clear death. Capture-only
    // infrastructure (like starve/hurt) — it lets tools/hoard2-sustained.mjs hold the survivor alive
    // for a full 15-min run so the probe measures a STEADY load, not a 3-min death. Never called in play.
    probe.topUp = () => survival.reset();
    // OUTBREAK: force-bite n susceptible civilians THROUGH the real bite path (flag consumed by the
    // next civs.step — the incubation roll + infection:bite fire exactly as a street bite would).
    probe.infect = (n = 1) => civs.forceExpose(n, _player.x, _player.z); // nearest-to-survivor first (on-camera)
    /* A-CENSUS: kill n live zombies THROUGH THE REAL PATH — the same `weapon:hit` the gun emits, so the
       damage, the score, the drops and (the point here) the `zombie:death` that books a CORPSE all fire
       exactly as they would in play. The ground census needs a corpse to exist in order to prove it can
       see one; fabricating a corpse by poking the fx pool directly would prove only that the tool can
       poke the fx pool. Returns how many actually died, so a caller cannot assume a kill it did not get. */
    probe.kill = (n = 1) => {
      let k = 0;
      for (let i = 0; i < pool.max && k < n; i++) {
        const z = pool.get(i);
        if (!z.alive) continue;
        events.emit('weapon:hit', { target: z.id, damage: 9999 });
        k++;
      }
      return k;
    };
    /* A-GROUND: report how many pooled rigs ACTUALLY hold a surface probe, per horde. The measured
       ground path needs `groundProbe` AND a wired probe (createCharacterRig.js:834), and the failure
       mode this exposes is silent by construction: the config is accepted, the flag reads true, and the
       probe it depends on never arrived. Without this hook a harness can only observe that foot
       positions CHANGED and infer the probe landed — but `setFootIK` alone moves feet too, so that
       inference cannot separate the two halves. A count, not a boolean, because a fan-out that ran
       before the pool finished spawning would wire SOME slots, and a boolean would call that success. */
    probe.groundProbeCount = () => ({
      zombies: horde ? horde.surfaceProbedCount : -1,
      civilians: cHorde ? cHorde.surfaceProbedCount : -1,
      zombieSlots: horde ? horde.size : -1,
      civilianSlots: cHorde ? cHorde.size : -1,
    });
    /* A-CENSUS: the hook `groundProbeCount` should have been — CONSUMPTION, not possession. It reports the
       engine's own per-class receipt (`horde.groundReport`) plus what the arming call actually concluded,
       so a probe can print "probed 96, measuredFrames 0" instead of "96/96 ✓". This is the API half of the
       fail-loud: the console warning tells a developer at boot, this tells a TOOL at any time. */
    probe.groundContact = () => ({
      arm: { ...(_groundArm['zombie horde'] ? { 'zombie horde': _groundArm['zombie horde'] } : {}), ...(_groundArm.civilians ? { civilians: _groundArm.civilians } : {}) },
      live: {
        'zombie horde': horde ? horde.groundReport : null,
        civilians: cHorde ? cHorde.groundReport : null,
      },
    });
    /* A-CLAMP: the clamp's own receipt, one class per row — the same shape and the same reason as
       `groundContact` above. `boxes 0` is the inert state (a rig whose skinned geometry has no sole bone
       to measure); `frames > 0, clampedFrames 0` means the clamp ran and never needed to lift, which is a
       real and different answer from "the clamp is not running". `liftMax` is how deep the underlying
       clip defect goes, which is the number that stops a green census being mistaken for a clean clip. */
    probe.groundClamp = () => ({
      on: _clampOn,
      arm: { ...(_clampArm['zombie horde'] ? { 'zombie horde': _clampArm['zombie horde'] } : {}), ...(_clampArm.civilians ? { civilians: _clampArm.civilians } : {}) },
      live: {
        'zombie horde': horde ? horde.groundClampReport : null,
        civilians: cHorde ? cHorde.groundClampReport : null,
      },
      // per-active-body {want, lift} — the only shape a BOB (one body over time) or FLOAT (lift − want)
      // number can honestly be computed from. Probe-time only, like contactSample().
      samples: {
        'zombie horde': horde ? horde.clampSamples() : [],
        civilians: cHorde ? cHorde.clampSamples() : [],
      },
    });
    /* A-CLAMP: re-arm the LIVE clamp with a different config, so a probe can A/B one CONSTANT (the
       release rate) instead of one build against another — the contamination A-GROUND's refuter had to
       throw a whole run away over. Goes through the same public engine seam the arming path uses, so what
       the probe measures is the shipped mechanism, not a test-only copy. Returns how many pools re-armed. */
    probe.rearmClamp = (cfg) => {
      const w = registry.has('world') ? registry.get('world') : null;
      if (!w || typeof w.groundAt !== 'function') return 0;
      let n = 0;
      for (const h of [horde, cHorde]) { if (h) { h.setGroundClamp({ groundAt: w.groundAt, ...(cfg || {}) }); n++; } }
      return n;
    };
    /* A-CENSUS: the CLASS REGISTRY the ground census reads. Each module that owns a class of rendered
       characters pushes a provider here; the tool asks every provider at census time. Three properties
       matter and each fixes a measured defect in the old instrument:
         rootId   — the scene node the class's bodies hang under, so the census can name a group by
                    IDENTITY. The old tool labelled groups BY SIZE ("the largest is the horde, a singleton
                    is the survivor") and a single corpse therefore got labelled `survivor`.
         expected — read from the owner's own LIST (`contactSample()`, `civSample()`, `counts().corpses`),
                    never from the scene, so the two halves of the census stay independent.
         source   — printed beside the number, so nobody has to trust that it came from where it claims. */
    (probe.characterClasses = probe.characterClasses || []).push(
      () => ({ name: 'zombie horde', rootId: horde ? horde.group.id : -1, expected: facade.contactSample().length, source: 'sim.contactSample().length' }),
      () => ({ name: 'civilians', rootId: cHorde ? cHorde.group.id : -1, expected: facade.civSample().length, source: 'sim.civSample().length' }),
    );
  }

  registry.register('sim', facade);
  return facade;
}
