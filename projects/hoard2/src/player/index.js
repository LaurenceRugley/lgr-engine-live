/* ============================================================
   hoard2 · src/player — THE PLAYER OWNER (survivor + iso controls + gun + melee + the dive embodiment).
   ------------------------------------------------------------
   OWNS (per INTEGRATION.md + HOARD-CONTRACT ownership map):
     • the rigged SURVIVOR — models/survivor.glb via createCharacterRig (NOT a capsule), driven through the
       idle/walk/run/attack/death states. (The GLB has no HitReact clip → 'hit' is a graceful no-op, the
       state machine simply doesn't re-fade; pre-flight-noted.)
     • the ground pose `player = {x,z,facing}` (SIM targets it, FX reads it) — iso WASD/arrow movement at
       real dt, camera-relative, clamped to config.PLAY_RADIUS, pushed out of build.aabbs() + world.obstacles().
     • AIM — face + aim at the cursor's ground point (v1 main.js:352 raycast pattern).
     • the GUN — createBallistics (real projectiles: travel + gravity drop + swept hit). castWorld = ground +
       build.castBarriers; castTargets = sim.queryTargets. Emits weapon:fire / weapon:hit.
     • MELEE — close, risky, STAMINA-PRICED via sim.trySpendStamina; resolves a forward arc. Emits
       melee:swing / melee:hit.
     • the DIVE embodiment — createFirstPersonWalker fed into the LEAD-owned ctx.dive: sets focusUv, the
       setEyeSource() (walker strides at REAL dt while the world crawls — the matrix moment), toggle()/exit().

   Cross-owner talk is registry + events ONLY (resolved LAZILY in update — all six register before frame 1).
   The pure maths (movement clamp / push-out / aim / ballistics adapters / melee gate) live in movement.js +
   combat.js and are unit-tested THREE-free.
   ============================================================ */
import { createCharacterRig, createFirstPersonWalker, createBallistics } from '@lgr/engine-core';
import { clampToRadius, resolveCircles, resolveAabbs, aimFacing, isoStep } from './movement.js';
import { makeCastWorld, makeCastTargets, meleeArcHits, gateMelee } from './combat.js';

// ---- player-local tuning (cite v1 hoard.js; NOT balance-pinned config, so it lives here) ----
// FEEL-PASS (playtest #1 — gun connect): the bottleneck was TRAVEL TIME — a slow (30) arcing shot let
// the target walk out of the way before it arrived (~9% connect). speed 30→58 makes it near-hitscan so it
// lands on the target's CURRENT position (little lead needed); gravity 3.5→2 keeps a hint of drop for
// style without falling short; targetRadius 0.68→0.8 forgives aim on these chunky bodies. dmg 16→20 →
// a walker (hp40) dies in ~2 solid hits, so connecting FEELS lethal.
const GUN = { dmg: 20, speed: 58, gravity: 2, cooldownS: 0.15, maxLive: 32, maxLifeS: 1.2, targetRadius: 0.8 };
const MELEE = { dmg: 34, range: 1.15, arcCosMin: 0.2, cooldownS: 0.42 };  // v1 MELEE_DMG/RANGE/CD + dot>0.2
const MOVE = { walkSpeed: 3.0, sprintSpeed: 5.2, accel: 14, playerRadius: 0.28 };
// LEAD look-pass fix: the survivor.glb (Quaternius "Animated Human") exports ~5.26 units tall — NOT
// ~1.8m as assumed. At scale 1 it dwarfs the arena + zombies (~1.07 tall) and the iso cam frames its
// knees. 0.32 brings it to ~1.68 units — a head taller than the hunched horde, eye ≈ config.EYE_Y.
const CHAR_SCALE = 0.32;

export function createPlayer(ctx) {
  const { THREE, scene, rig, CAM, config, registry, events, time, dive, renderer } = ctx;
  const { GROUND_Y, EYE_Y, PLAY_RADIUS, SURVIVE } = config;
  const MUZZLE_Y = GROUND_Y + 0.5;
  // Determinism: the player consumes NO seeded rolls — the gun fires straight (no spread), so it never
  // touches ctx.rng. If cosmetic spread is added later, use ctx.rng.fork('player') (never the sim stream).

  /* ---- the ground pose (the pinned facade field SIM/FX read) ---- */
  const player = { x: 0, z: 0, facing: 0, vx: 0, vz: 0 };

  /* ---- the rigged survivor (async; a stand-in nothing until the GLB lands) ---- */
  let survivor = null;
  const charRig = createCharacterRig({ url: 'models/survivor.glb' });
  charRig.ready.then(() => {
    survivor = charRig.spawn({ castShadow: true });
    survivor.object.scale.setScalar(CHAR_SCALE);
    survivor.object.position.set(player.x, GROUND_Y, player.z);
    scene.add(survivor.object);
    survivor.setState('idle');
  }).catch((e) => console.warn('[player] survivor.glb failed to load', e));

  /* ---- iso follow-cam framed on the survivor (v1 enterHoard pattern) ---- */
  // LOOK-PASS (both critics): zoom 3.2 framed a ~6-unit window — too tight to SEE the horde close in
  // (they spawn at the rim); a wave-survival read needs the approach visible. 6.0 keeps the survivor
  // readable while opening the field so you watch the dead converge.
  rig.setMode(CAM.DIMETRIC);
  rig.setZoom(6.0, true);
  rig.setTarget(player.x, 0.6, player.z, true);

  /* ---- the first-person WALKER (dive embodiment) — colliders fed from build+world (below) ---- */
  const walker = createFirstPersonWalker({
    eyeY: EYE_Y, moveSpeed: MOVE.walkSpeed, sprintSpeed: MOVE.sprintSpeed,
    radius: MOVE.playerRadius, arenaRadius: PLAY_RADIUS,
  });

  /* ---- the GUN: engine ballistics + injected cross-owner casts ---- */
  // castWorld/castTargets resolve BUILD's barriers + SIM's zombies lazily (registry.get is cheap; the
  // facades exist by frame 1). onHit → damage the target via the event (SIM listens to weapon:hit and
  // applies the damage by target.id — there is no sim.damageZombie in the contract, so the EVENT is the
  // channel). onExpire (a pure miss) needs no reaction.
  let _build = null, _world = null, _sim = null;
  const getBuild = () => (_build || (_build = registry.get('build')));
  const getWorld = () => (_world || (_world = registry.get('world')));
  const getSim = () => (_sim || (_sim = registry.get('sim')));

  const castWorld = makeCastWorld(GROUND_Y, (seg) => getBuild().castBarriers(seg));
  const castTargets = makeCastTargets((seg) => getSim().queryTargets(seg), GUN.targetRadius);

  const _hitEvt = { point: { x: 0, y: 0, z: 0 }, normal: { x: 0, y: 0, z: 0 }, target: null, damage: 0 };
  const ballistics = createBallistics({
    gravity: GUN.gravity, maxLive: GUN.maxLive, maxLife: GUN.maxLifeS, castWorld, castTargets,
    onHit: (h) => {
      _hitEvt.point.x = h.point.x; _hitEvt.point.y = h.point.y; _hitEvt.point.z = h.point.z;
      _hitEvt.normal.x = h.normal.x; _hitEvt.normal.y = h.normal.y; _hitEvt.normal.z = h.normal.z;
      _hitEvt.target = h.target || null;               // sim record (has id) on an actor hit, else null (world)
      _hitEvt.damage = h.target ? (h.meta || GUN.dmg) : 0;
      events.emit('weapon:hit', _hitEvt);
      _hitEvt.target = null;                           // don't retain the sim's object between shots
    },
  });

  /* ---- INPUT state (keys tracked here; the rig azimuth drives camera-relative move) ---- */
  const keys = Object.create(null);
  let firing = false, orbiting = false, lastX = 0, lastY = 0;
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const pointerNdc = new THREE.Vector2();
  let aimValid = false;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y);
  const _aimPt = new THREE.Vector3();
  const ORBIT_SPEED = 0.005;

  const dom = renderer && renderer.domElement;
  const setPointer = (cx, cy) => {
    pointerNdc.x = (cx / window.innerWidth) * 2 - 1;
    pointerNdc.y = -(cy / window.innerHeight) * 2 + 1;
    aimValid = true;
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase(); keys[k] = true;
      if (k === 'f') { e.preventDefault(); onDiveToggle(); }
      else if (k === 'escape' && dive.active) { e.preventDefault(); dive.exit(); tryExitPointerLock(); }
      else if (k === ' ' || k === 'v') { e.preventDefault(); doMelee(); }
    });
    window.addEventListener('keyup', (e) => { keys[e.key.toLowerCase()] = false; });
    window.addEventListener('mousemove', (e) => {
      if (dive.active) { walker.addLook(e.movementX || 0, e.movementY || 0); return; }
      setPointer(e.clientX, e.clientY);
      if (orbiting) { rig.orbit(-(e.clientX - lastX) * ORBIT_SPEED, -(e.clientY - lastY) * ORBIT_SPEED); lastX = e.clientX; lastY = e.clientY; }
    });
    window.addEventListener('mouseup', () => { firing = false; orbiting = false; });
  }
  if (dom) {
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
    dom.addEventListener('mousedown', (e) => {
      if (dive.active) { if (e.button === 0) firing = true; return; }   // dived: mouse turns your head; LMB still fires forward
      if (e.button === 0) { setPointer(e.clientX, e.clientY); firing = true; }
      if (e.button === 2) { orbiting = true; lastX = e.clientX; lastY = e.clientY; }
    });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); if (!dive.active) rig.zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  }

  function moveInput() {
    const ix = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    const iy = (keys.w || keys.arrowup ? 1 : 0) - (keys.s || keys.arrowdown ? 1 : 0);
    return { x: ix, y: iy, wantSprint: !!keys.shift };
  }

  /* ---- COLLIDERS: circles (world.obstacles, static) + AABBs (build.aabbs, dynamic). Rebuilt ONLY when
     dirty (barrier events) so the hot path never allocates. The walker's setAabbs wants CAPITAL keys;
     build.aabbs() gives lowercase → convert into a persistent list we mutate in place. ---- */
  let circles = [];
  let aabbsLower = [];                      // build.aabbs() shape {minx,minz,maxx,maxz} — iso push-out reads this
  let walkerAabbs = [];                     // walker shape {minX,minZ,maxX,maxZ}
  let collidersDirty = true;
  function rebuildColliders() {
    circles = getWorld().obstacles() || [];
    aabbsLower = getBuild().aabbs() || [];
    walkerAabbs = aabbsLower.map((b) => ({ minX: b.minx, minZ: b.minz, maxX: b.maxx, maxZ: b.maxz }));
    walker.setColliders(circles);
    walker.setAabbs(walkerAabbs);
    collidersDirty = false;
  }
  events.on('barrier:place', () => { collidersDirty = true; });
  events.on('barrier:breach', () => { collidersDirty = true; });
  events.on('barrier:repair', () => { collidersDirty = true; });

  /* ---- DIVE wiring (lead presents the controller; player supplies the feel) ---- */
  const _focus = new THREE.Vector3(), _focusUv = new THREE.Vector2();
  dive.focusUv = () => {
    _focus.set(player.x, 0.9, player.z).project(rig.camera);   // survivor's on-screen point for the descent zoom
    _focusUv.set(_focus.x * 0.5 + 0.5, _focus.y * 0.5 + 0.5);
    return _focusUv;
  };
  const _eyePos = new THREE.Vector3(), _eyeDir = new THREE.Vector3();
  let _frameDt = 0;
  // The eye source runs each dived frame AFTER player.update (main.js). The walker strides at REAL dt
  // (time.realDt honours pause) while the world clock is dilated — you move at full speed, the horde crawls.
  dive.setEyeSource(() => {
    const rdt = time.realDt(_frameDt);
    const mi = moveInput();
    const sprint = mi.wantSprint && (mi.x !== 0 || mi.y !== 0) && consumeSprint(rdt);
    walker.update(rdt, { x: mi.x, y: mi.y, sprint });
    player.x = walker.x; player.z = walker.z; player.facing = walker.yaw;   // write the pose back (SIM targets the walker)
    walker.eyePosition(_eyePos); walker.eyeDirection(_eyeDir);
    rig.setEye(_eyePos, _eyeDir);
  });

  function tryPointerLock() {
    // best-effort desktop gesture; swallow the headless rejection ("root document not valid for pointer
    // lock") exactly like v1 main.js:251 — the capture harness drives look via events, not the real lock.
    try { const pl = dom && dom.requestPointerLock && dom.requestPointerLock(); if (pl && pl.catch) pl.catch(() => {}); } catch { /* headless */ }
  }
  function tryExitPointerLock() {
    try { if (typeof document !== 'undefined' && document.pointerLockElement) document.exitPointerLock && document.exitPointerLock(); } catch { /* headless */ }
  }
  function onDiveToggle() {
    if (getSim().state.dead) return;                 // no diving while dead
    if (!dive.active) {                              // about to descend → seed the walker at the survivor's stance
      if (collidersDirty) rebuildColliders();
      walker.setPosition(player.x, player.z);
      walker.setYaw(player.facing);
      walker.recenterPitch();
      tryPointerLock();
    } else {
      tryExitPointerLock();
    }
    dive.toggle();                                    // lead flips the controller + emits dive:enter/exit
  }

  /* ---- sprint pricing: SIM owns stamina; a continuous sprint spends it per frame via the sanctioned
     trySpendStamina seam. If SIM can't afford this frame's slice, sprint drops to a walk (out of breath). ---- */
  function consumeSprint(dt) {
    const cost = SURVIVE.sprintStaminaPerS * dt;
    return gateMelee(getSim(), cost);                 // reuse the pure gate (spend-if-available); name is generic
  }

  /* ---- firing (both modes): iso aims at the cursor ground point, dived aims where you look ---- */
  let fireCd = 0, meleeCd = 0, attackLock = 0;
  const _aimDir = { x: 0, z: 0 };
  let _seed = 0;
  const _fireEvt = { origin: { x: 0, y: 0, z: 0 }, dir: { x: 0, y: 0, z: 0 }, weapon: 'gun', seed: 0 };

  function computeAim() {
    // aim direction (x,z), normalized. Dived → walker facing; iso → cursor ground point (else facing).
    let ax, az;
    if (dive.active) { ax = Math.sin(player.facing); az = Math.cos(player.facing); }
    else if (aimValid) { ax = _aimPt.x - player.x; az = _aimPt.z - player.z; }
    else { ax = Math.sin(player.facing); az = Math.cos(player.facing); }
    const al = Math.hypot(ax, az) || 1; _aimDir.x = ax / al; _aimDir.z = az / al;
    return _aimDir;
  }

  function doFire() {
    if (fireCd > 0 || getSim().state.dead) return;
    fireCd = GUN.cooldownS;
    const d = computeAim();
    if (!dive.active) player.facing = Math.atan2(d.x, d.z);   // the gun aims your body in iso
    ballistics.fire(player.x, MUZZLE_Y, player.z, d.x, 0, d.z, GUN.speed, GUN.dmg);
    _fireEvt.origin.x = player.x; _fireEvt.origin.y = MUZZLE_Y; _fireEvt.origin.z = player.z;
    _fireEvt.dir.x = d.x; _fireEvt.dir.y = 0; _fireEvt.dir.z = d.z; _fireEvt.seed = _seed++;
    events.emit('weapon:fire', _fireEvt);
  }

  const _swingEvt = { origin: { x: 0, y: 0, z: 0 }, arc: 0 };
  const _meleeHitEvt = { target: null, damage: MELEE.dmg };
  const _meleeSeg = { o: { x: 0, y: 0, z: 0 }, e: { x: 0, y: 0, z: 0 } };
  function doMelee() {
    if (meleeCd > 0 || getSim().state.dead) return;
    // RISK + PRICE: a swing costs stamina up front (v2). Refused (too tired) → no swing, no cooldown burned.
    if (!gateMelee(getSim(), SURVIVE.meleeStaminaCost)) return;
    meleeCd = MELEE.cooldownS; attackLock = 0.4;
    const fx = Math.sin(player.facing), fz = Math.cos(player.facing);
    _swingEvt.origin.x = player.x; _swingEvt.origin.y = GROUND_Y + 0.5; _swingEvt.origin.z = player.z;
    _swingEvt.arc = player.facing;
    events.emit('melee:swing', _swingEvt);
    // broadphase a short forward segment, then keep only what's inside the arc.
    _meleeSeg.o.x = player.x; _meleeSeg.o.y = GROUND_Y + 0.5; _meleeSeg.o.z = player.z;
    _meleeSeg.e.x = player.x + fx * MELEE.range; _meleeSeg.e.y = GROUND_Y + 0.5; _meleeSeg.e.z = player.z + fz * MELEE.range;
    const cands = getSim().queryTargets(_meleeSeg) || [];
    const hits = meleeArcHits(player.x, player.z, player.facing, MELEE.range, MELEE.arcCosMin, cands);
    for (let i = 0; i < hits.length; i++) { _meleeHitEvt.target = hits[i]; _meleeHitEvt.damage = MELEE.dmg; events.emit('melee:hit', _meleeHitEvt); }
    _meleeHitEvt.target = null;
  }

  /* ---- animation state from motion/action (idle/walk/run/attack/death). 'hit' is intentionally unused
     (no clip in the survivor GLB → graceful no-op). ---- */
  function driveAnim(moving, sprinting, dead) {
    if (!survivor) return;
    if (dead) { survivor.setState('death'); return; }
    if (attackLock > 0) { survivor.setState('attack'); return; }
    survivor.setState(moving ? (sprinting ? 'run' : 'walk') : 'idle');
  }

  /* ---- scratch for the iso step result (hoisted; no per-frame alloc) ---- */
  const _step = { x: 0, z: 0, vx: 0, vz: 0, moving: false, facing: 0 };
  const _clamp = { x: 0, z: 0 };
  const _res = { x: 0, z: 0 };

  const facade = {
    player,
    update(dt, _t) {
      _frameDt = dt;
      const rdt = time.realDt(dt);                    // the survivor + gun run on wall-clock (pause-aware)
      fireCd = Math.max(0, fireCd - rdt);
      meleeCd = Math.max(0, meleeCd - rdt);
      attackLock = Math.max(0, attackLock - rdt);
      if (collidersDirty) rebuildColliders();
      const dead = getSim().state.dead;

      let moving = false, sprinting = false;
      if (!dive.active) {
        // ISO god-view: camera-relative move, clamp to the play disc, push out of trees/ruins/barriers.
        const mi = moveInput();
        sprinting = mi.wantSprint && (mi.x !== 0 || mi.y !== 0) && consumeSprint(rdt);
        isoStep(player, { x: mi.x, y: mi.y, sprint: sprinting }, rig.azimuth, rdt, MOVE, _step);
        clampToRadius(_step.x, _step.z, PLAY_RADIUS, _clamp);
        resolveCircles(_clamp.x, _clamp.z, MOVE.playerRadius, circles, _res);
        resolveAabbs(_res.x, _res.z, MOVE.playerRadius, aabbsLower, _clamp);
        player.x = _clamp.x; player.z = _clamp.z; player.vx = _step.vx; player.vz = _step.vz;
        moving = _step.moving;

        // AIM: raycast the cursor onto the ground; face the aim (v1 main.js:352). Coarse pointers skip it.
        if (!coarse && aimValid) {
          raycaster.setFromCamera(pointerNdc, rig.camera);
          if (raycaster.ray.intersectPlane(groundPlane, _aimPt)) player.facing = aimFacing(player.x, player.z, _aimPt.x, _aimPt.z, player.facing);
        } else if (moving) {
          player.facing = _step.facing;
        }

        // re-assert the iso follow-cam (idempotent) + release any FP eye override.
        rig.setMode(CAM.DIMETRIC);
        rig.clearEye();
        rig.setTarget(player.x, 0.6, player.z);
      } else {
        // DIVED: the eye source (post-update) drives the walker + writes the pose back. Reflect motion for anim.
        const mi = moveInput();
        moving = walker.moving; sprinting = mi.wantSprint && moving;
      }

      if (firing) doFire();
      ballistics.update(rdt);                         // integrate projectiles + swept hit-tests (→ onHit → weapon:hit)

      // place + orient the survivor mesh at the pose (both modes; body is behind the FP eye when dived).
      if (survivor) { survivor.object.position.set(player.x, GROUND_Y, player.z); survivor.object.rotation.y = player.facing; }
      charRig.update(rdt);
      driveAnim(moving, sprinting, dead);
      rig.update(dt);                                 // rig eases on the real frame dt (matches main's present)
    },
    // handles for critics / debug
    get diveActive() { return dive.active; },
    get liveBolts() { return ballistics.liveCount; },
  };

  /* ---- probe hooks (harness-driven; no silent caps) ---- */
  ctx.probe.fire = () => { const d = computeAim(); ballistics.fire(player.x, MUZZLE_Y, player.z, d.x, 0, d.z, GUN.speed, GUN.dmg); _fireEvt.origin.x = player.x; _fireEvt.origin.y = MUZZLE_Y; _fireEvt.origin.z = player.z; _fireEvt.dir.x = d.x; _fireEvt.dir.y = 0; _fireEvt.dir.z = d.z; _fireEvt.seed = _seed++; events.emit('weapon:fire', _fireEvt); };
  ctx.probe.melee = () => doMelee();

  registry.register('player', facade);
  return facade;
}
