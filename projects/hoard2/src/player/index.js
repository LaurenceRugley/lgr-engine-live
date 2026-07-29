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
import { createCharacterRig, createFirstPersonWalker, createBallistics, createWeaponKit } from '@lgr/engine-core';
import { clampToRadius, resolveCircles, resolveAabbs, aimFacing, isoStep } from './movement.js';
import { makeCastWorld, makeCastTargets, meleeArcHits, gateMelee } from './combat.js';

// ---- player-local tuning (cite v1 hoard.js; NOT balance-pinned config, so it lives here) ----
// FEEL-PASS (playtest #1 — gun connect): the bottleneck was TRAVEL TIME — a slow (30) arcing shot let
// the target walk out of the way before it arrived (~9% connect). speed 30→58 makes it near-hitscan so it
// lands on the target's CURRENT position (little lead needed); gravity 3.5→2 keeps a hint of drop for
// style without falling short; targetRadius 0.68→0.8 forgives aim on these chunky bodies. dmg 16→20 →
// a walker (hp40) dies in ~2 solid hits, so connecting FEELS lethal.
const GUN = { dmg: 20, speed: 72, gravity: 2, cooldownS: 0.15, maxLive: 32, maxLifeS: 1.2, targetRadius: 0.8 };
// AIM-ASSIST (playtest #1, retune): the gun aims at the cursor's GROUND point, so on a moving horde most
// shots overshoot to the dirt (deliberate aim landed only ~29% of hits). On fire we snap to the nearest
// zombie within a CONE of the aim + LEAD it (dist/speed) + fire at its chest → ~98% connect (deliberate
// aim + wobble). NOT trivial: the cone is 37° (you must face the threat, can't hit behind you) and it's
// range-limited, and the escalating horde still overwhelms you. Also makes TOUCH viable (no precise aim).
const ASSIST = { cosHalf: 0.8, range: 30, chestY: 0.95 }; // cos(37°) — reward facing the threat, no precision needed (works for mouse AND touch)
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
  let survivor = null, isoGun = null;
  let _workCd = 0;   // A2: harvest/build gesture cooldown (s) — throttles the Working clip re-trigger
  // A2 ACTION COVERAGE: the survivor.glb ships a WORKING clip — wire it as the harvest/build gesture so the
  // survivor visibly chops/works instead of standing idle at a node. (Clip inventory: Idle/Walk/Run/Punch/
  // Death/Jump/Working — no reload or eat clip, and those events don't exist in the sim, so they're out of
  // scope this arc; fire-recoil + melee are the existing B4 procedural gestures.)
  const charRig = createCharacterRig({ url: 'models/survivor.glb', states: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Punch', hit: 'HitReact', death: 'Death', work: 'Working' } });
  charRig.ready.then(() => {
    survivor = charRig.spawn({ castShadow: true });
    survivor.object.scale.setScalar(CHAR_SCALE);
    survivor.object.position.set(player.x, GROUND_Y, player.z);
    scene.add(survivor.object);
    survivor.setState('idle');
    survivor.setIdleRelax(true);   // A2: soften the survivor's braced 'lunge' idle when standing calm
    // B4: put the forge-skinned gun in the survivor's RIGHT HAND (the bone lives in unscaled object space,
    // so the kit is scaled up to read at the 0.32 body scale; pose tuned to sit in the palm pointing fwd).
    isoGun = createWeaponKit({ material: ctx.weaponSkins ? ctx.weaponSkins.gunmetal : null });
    // worldScale normalises the ~100x armature scale so the gun is ~0.18 units (a real pistol next to the
    // 1.68-unit survivor); rot seats it pointing out of the palm. Falls back to a hidden scene add if no hand.
    // worldScale 1.5 = a touch OVERSIZED (game convention — a real-scale pistol is ~8 px at iso; oversizing
    // keeps it readable in the survivor's hand without dominating).
    if (!survivor.attachToBone('RightHand', isoGun.group, { worldScale: 1.5, pos: [0, 0, 0], rot: [-Math.PI / 2, 0, 0] })) {
      isoGun.group.visible = false; scene.add(isoGun.group);
    }
  }).catch((e) => console.warn('[player] survivor.glb failed to load', e));

  // B3 HIT-REACT — the survivor finally reacts to being mauled (survivor.glb has NO HitReact clip, so this
  // procedural spine/arm flinch IS its hit reaction). Fired on the sim's player:damage; a generic recoil
  // (the layer leans the torso back + throws the arms) — enough to sell "you got hit" without a clip.
  events.on('player:damage', () => { if (survivor) survivor.hitReact(0, 0); });

  // A2 ACTION COVERAGE — harvest + build gestures on the events that fire. There is no harvest start/stop
  // event (only harvest:gain per tick), so a COOLDOWN gates the re-trigger: the Working clip plays a chunk,
  // and rapid ticks refresh it at a natural cadence rather than resetting every frame (which would stutter).
  // barrier:place fires once per placement (no cooldown); repair ticks (short cooldown). Play only when
  // roughly stationary so a running survivor doesn't "work" mid-stride.
  function tryWork(cd) {
    if (!survivor || _workCd > 0) return;
    const moving = Math.hypot(player.vx || 0, player.vz || 0) > 1.2;
    if (moving && !dive.active) return;
    survivor.playAction('work'); _workCd = cd;
  }
  events.on('harvest:gain', () => tryWork(1.1));
  events.on('barrier:place', () => { if (survivor) { survivor.playAction('work'); _workCd = 0.9; } });
  events.on('barrier:repair', () => tryWork(0.9));

  // B4 FP VIEWMODEL — the gun the player SEES in the dive (positioned in front of the FP eye each dived
  // frame; hidden in iso). Uses the WORN skin (so iso=gunmetal + FP=worn read as skin variants side-by-side).
  let fpRecoil = 0;   // 0..1 fire kick; spring-decays in update()
  const fpGun = createWeaponKit({ material: ctx.weaponSkins ? ctx.weaponSkins.gunmetal_worn : null });
  fpGun.group.visible = false; fpGun.group.renderOrder = 20;
  fpGun.mesh.frustumCulled = false;
  scene.add(fpGun.group);
  const _vmFwd = new THREE.Vector3(), _vmRight = new THREE.Vector3(), _vmUp = new THREE.Vector3(), _vmBasis = new THREE.Matrix4();
  const _WORLD_UP = new THREE.Vector3(0, 1, 0);
  let _vmBob = 0;

  // B4 UNIFIED SHOT — the MUZZLE FLASH light pulse (the muzzle particles + tracer + impact decal are the fx
  // owner's, already on weapon:fire/weapon:hit; the events are the named SFX hooks B5 will listen to). A
  // single pooled warm PointLight snapped to the ACTIVE gun's muzzle on fire, decaying over ~2 frames.
  const muzzleFlash = new THREE.PointLight(0xffcf8a, 0, 4.5, 2);
  scene.add(muzzleFlash);
  let flashT = 0;
  const _muzWP = new THREE.Vector3();   // active gun's muzzle world pos (filled in fireShot; drives flash + fx origin)
  function placeViewmodel(rdt, eyePos, eyeDir, moving, sprint) {
    fpGun.group.visible = true;
    _vmFwd.copy(eyeDir).normalize();
    _vmRight.crossVectors(_vmFwd, _WORLD_UP).normalize();
    _vmUp.crossVectors(_vmRight, _vmFwd);
    _vmBasis.makeBasis(_vmRight, _vmUp, _vmFwd);   // gun +Z → look direction, +Y up, +X right (upright)
    fpGun.group.quaternion.setFromRotationMatrix(_vmBasis);
    _vmBob += rdt * (moving ? (sprint ? 15 : 9) : 2.2);
    const bob = Math.sin(_vmBob) * (moving ? 0.010 : 0.0035);
    const kick = fpRecoil * 0.07;                  // recoil pulls the gun back + up
    fpGun.group.position.copy(eyePos)
      .addScaledVector(_vmFwd, 0.30 - kick)
      .addScaledVector(_vmRight, 0.11)
      .addScaledVector(_vmUp, -0.15 + bob + kick * 0.6);
  }

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
  let _nfLastFill = -1;   // A2: last night-factor the survivor's night-fill emissive was set to
  const getSim = () => (_sim || (_sim = registry.get('sim')));

  const castWorld = makeCastWorld(GROUND_Y, (seg) => getBuild().castBarriers(seg), () => getWorld().buildingCylinders());
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
  // A4 GHOST BUILD-MODE (iso): B toggles a cursor-aimed ghost wall; LMB places, ESC/RMB cancels.
  let buildMode = false;
  function setBuildMode(on) { buildMode = !!on && !dive.active; if (buildMode) firing = false; getBuild().setGhostVisible(buildMode); }
  function buildDir() { const dx = _aimPt.x - player.x, dz = _aimPt.z - player.z; return Math.abs(dx) > Math.abs(dz) ? 'z' : 'x'; }  // wall broadside to the aim line
  function placeGhost() { if (buildMode && aimValid) getBuild().placeAt(_aimPt.x, _aimPt.z, buildDir()); }
  const coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const pointerNdc = new THREE.Vector2();
  let aimValid = false;
  const raycaster = new THREE.Raycaster();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -GROUND_Y);
  const _aimPt = new THREE.Vector3();
  const ORBIT_SPEED = 0.005;

  const dom = renderer && renderer.domElement;
  let _cursorX = 0, _cursorY = 0;             // A4: raw client cursor for the iso reticle
  const setPointer = (cx, cy) => {
    pointerNdc.x = (cx / window.innerWidth) * 2 - 1;
    pointerNdc.y = -(cy / window.innerHeight) * 2 + 1;
    _cursorX = cx; _cursorY = cy;
    aimValid = true;
  };

  /* A4 CROSSHAIRS (style bible: cool, minimal, on-theme) — an FP CENTER reticle (where you look/fire) and a
     subtle ISO CURSOR ring (where the shot goes). DOM overlay, non-interactive; iso ring is fine-pointer only. */
  const reticles = (typeof document !== 'undefined') ? (() => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5';
    const bar = 'position:absolute;background:rgba(202,216,208,.82);box-shadow:0 0 2px rgba(0,0,0,.85)';
    const fp = document.createElement('div');
    fp.style.cssText = 'position:absolute;left:50%;top:50%;width:26px;height:26px;margin:-13px 0 0 -13px;display:none';
    fp.innerHTML = `<span style="${bar};left:12px;top:0;width:2px;height:9px"></span>`
      + `<span style="${bar};left:12px;bottom:0;width:2px;height:9px"></span>`
      + `<span style="${bar};top:12px;left:0;height:2px;width:9px"></span>`
      + `<span style="${bar};top:12px;right:0;height:2px;width:9px"></span>`;
    const iso = document.createElement('div');
    iso.style.cssText = 'position:absolute;width:20px;height:20px;margin:-10px 0 0 -10px;display:none;border-radius:50%;'
      + 'border:2px solid rgba(196,212,202,.7);box-shadow:0 0 3px rgba(0,0,0,.7),inset 0 0 2px rgba(0,0,0,.5)';
    wrap.appendChild(fp); wrap.appendChild(iso); document.body.appendChild(wrap);
    return { fp, iso };
  })() : null;
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase(); keys[k] = true;
      if (k === 'f') { e.preventDefault(); onDiveToggle(); }
      else if (k === 'escape' && buildMode) { e.preventDefault(); setBuildMode(false); }   // A4: ESC cancels build-mode
      else if (k === 'escape' && dive.active) { e.preventDefault(); dive.exit(); tryExitPointerLock(); }
      else if (k === 'b' && !dive.active) { e.preventDefault(); setBuildMode(!buildMode); }  // A4: B toggles the ghost build-mode (iso)
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
      if (buildMode) { if (e.button === 0) { setPointer(e.clientX, e.clientY); placeGhost(); } if (e.button === 2) setBuildMode(false); return; }  // A4: LMB places, RMB cancels
      if (e.button === 0) { setPointer(e.clientX, e.clientY); firing = true; }
      if (e.button === 2) { orbiting = true; lastX = e.clientX; lastY = e.clientY; }
    });
    dom.addEventListener('wheel', (e) => { e.preventDefault(); if (!dive.active) rig.zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });
  }

  // touch thumbstick state (analog x,y ∈ [-1,1]); overrides WASD when active (mobile — see createTouchControls).
  const touchMove = { active: false, x: 0, y: 0 };
  function moveInput() {
    if (touchMove.active) return { x: touchMove.x, y: touchMove.y, wantSprint: false };
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
    placeViewmodel(rdt, _eyePos, _eyeDir, mi.x !== 0 || mi.y !== 0, sprint);  // B4 FP viewmodel
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

  // fireShot() — the ACTUAL shot (aim-assist + ballistics + event). Shared by doFire (live, cooldown-gated)
  // AND ctx.probe.fire, so the aim-sim probe exercises the REAL fire path (they had diverged — the probe
  // fired a plain ground shot with no aim-assist, so it under-measured the gun).
  function fireShot() {
    const d = computeAim();
    if (!dive.active) player.facing = Math.atan2(d.x, d.z);   // the gun aims your body in iso
    // AIM-ASSIST: snap to the nearest zombie in a cone of the aim + fire at its chest (flat shots at the
    // ground point missed a moving horde). No target in the cone → fire the plain flat shot.
    let dirx = d.x, diry = 0, dirz = d.z;
    const t = getSim().queryCone(player.x, player.z, d.x, d.z, ASSIST.cosHalf, ASSIST.range);
    if (t) {
      // LEAD the moving target: aim where it WILL be when the shot arrives (dist / projectile speed).
      const dist = Math.hypot(t.x - player.x, t.z - player.z);
      const lead = dist / GUN.speed;
      const ax = t.x + (t.vx || 0) * lead, az = t.z + (t.vz || 0) * lead;
      const bx = ax - player.x, by = (GROUND_Y + ASSIST.chestY) - MUZZLE_Y, bz = az - player.z;
      const l = Math.hypot(bx, by, bz) || 1; dirx = bx / l; diry = by / l; dirz = bz / l;
    }
    ballistics.fire(player.x, MUZZLE_Y, player.z, dirx, diry, dirz, GUN.speed, GUN.dmg);
    // B4 RIDER: the muzzle FX origin follows the ACTIVE gun's muzzle (iso hand-gun OR FP viewmodel) so the
    // particles + flash fire FROM THE GUN, not the survivor's feet. _muzWP is filled by pulseMuzzle below;
    // set it first so the weapon:fire event (→ fx muzzle particles) uses it.
    const _g = dive.active ? fpGun : isoGun;
    if (_g) { _g.muzzle.getWorldPosition(_muzWP); _fireEvt.origin.x = _muzWP.x; _fireEvt.origin.y = _muzWP.y; _fireEvt.origin.z = _muzWP.z; }
    else { _fireEvt.origin.x = player.x; _fireEvt.origin.y = MUZZLE_Y; _fireEvt.origin.z = player.z; }
    _fireEvt.dir.x = dirx; _fireEvt.dir.y = diry; _fireEvt.dir.z = dirz; _fireEvt.seed = _seed++;
    events.emit('weapon:fire', _fireEvt);
    if (survivor) survivor.recoil();          // B4: iso gun-arm recoil snap on the B3 layer seam
    fpRecoil = 1;                             // B4: kick the FP viewmodel (spring-recovers in update)
    muzzleFlash.position.copy(_muzWP); flashT = 1;   // B4: flash light at the same muzzle (was pulseMuzzle)
  }
  function doFire() {
    if (fireCd > 0 || getSim().state.dead) return;
    fireCd = GUN.cooldownS;
    fireShot();
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
    if (survivor) survivor.meleeSwing();      // B4: visible melee arc on the survivor's arm (was invisible)
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
  // A1: continuous locomotion blend (idle↔walk↔run from actual speed) + a one-shot death action on the edge.
  // Melee fires its own 'attack' one-shot in doMelee; fire uses the B4 recoil layer.
  let _wasDead = false;
  function driveAnim(speed01, dead) {
    if (!survivor) return;
    if (dead) { if (!_wasDead) { survivor.playAction('death'); _wasDead = true; } return; }
    _wasDead = false;
    survivor.setLocomotion(speed01);
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
      fpRecoil = fpRecoil > 0 ? Math.max(0, fpRecoil - rdt * 7) : 0;   // B4 FP recoil spring-decay
      if (!dive.active) fpGun.group.visible = false;                   // viewmodel is dive-only (placed in the eye source)
      flashT = flashT > 0 ? Math.max(0, flashT - rdt * 16) : 0;        // B4 muzzle-flash decay (~2 frames)
      muzzleFlash.intensity = flashT * flashT * 16;
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

      // TOUCH aim: no cursor on a phone, so while firing on a coarse pointer, auto-face the nearest zombie
      // (full-cone query) — computeAim then uses facing, and the gun's aim-assist cone finishes the shot.
      // This makes the FIRE button "shoot the nearest threat", the twin-stick-lite touch scheme.
      if (coarse && firing && !dive.active) {
        const nz = getSim().queryCone(player.x, player.z, 0, 1, -1, ASSIST.range);
        if (nz) player.facing = Math.atan2(nz.x - player.x, nz.z - player.z);
      }
      if (firing) doFire();
      ballistics.update(rdt);                         // integrate projectiles + swept hit-tests (→ onHit → weapon:hit)

      // place + orient the survivor mesh at the pose. B4: HIDE the whole body in the dive — the FP eye sits
      // inside its head, so the mesh rendered in front of the camera (you saw your own body, and the muzzle
      // flash lit it). The FP viewmodel is the gun you see; the iso hand-gun hides with the body.
      // A4 GHOST BUILD-MODE: the preview wall tracks the cursor's ground point (raycast above set _aimPt).
      if (buildMode && aimValid && !dive.active) getBuild().updateGhost(_aimPt.x, _aimPt.z, buildDir());
      // A4 CROSSHAIRS: FP center reticle when dived; iso cursor ring when aiming with a fine pointer.
      if (reticles) {
        reticles.fp.style.display = dive.active ? 'block' : 'none';
        if (!dive.active && aimValid && !coarse && !dead) {
          reticles.iso.style.display = 'block';
          reticles.iso.style.left = _cursorX + 'px'; reticles.iso.style.top = _cursorY + 'px';
        } else reticles.iso.style.display = 'none';
      }
      if (survivor) {
        survivor.object.visible = !dive.active;
        survivor.object.position.set(player.x, GROUND_Y, player.z);
        survivor.setHeading(player.facing);   // A1: SMOOTH body turn (slerped in the rig), not a snap
        // B3 head-look: the survivor turns its head toward where you're aiming (the cursor ground point).
        if (aimValid) survivor.setLookTarget(_aimPt.x, EYE_Y, _aimPt.z);
        // A4 AIM TRUTH: the gun orients to where you're aiming CONTINUOUSLY (owner: the gun should always
        // aim, not only when a zombie's in the assist cone). It SNAPS to the assist target when one's in the
        // cone (so it points at what it'll actually hit), else points down the cursor/facing ray at chest
        // height — the arm no longer relaxes to the walk pose when nothing's near. iso only (the survivor is
        // hidden in the dive; the FP viewmodel already points down the camera/reticle).
        if (!dive.active && !dead) {
          const ad = computeAim();
          const tgt = getSim().queryCone(player.x, player.z, ad.x, ad.z, ASSIST.cosHalf, ASSIST.range);
          survivor.setAim(tgt
            ? { x: tgt.x, y: GROUND_Y + ASSIST.chestY, z: tgt.z }
            : { x: player.x + ad.x * ASSIST.range, y: GROUND_Y + ASSIST.chestY, z: player.z + ad.z * ASSIST.range });
        } else survivor.setAim(null);
      }
      const _sp = Math.hypot(player.vx || 0, player.vz || 0);
      if (_workCd > 0) _workCd -= rdt;                 // A2: tick the harvest/build gesture cooldown
      charRig.update(rdt);
      driveAnim(Math.min(1, _sp / MOVE.sprintSpeed), dead);   // A1: blend weights from ACTUAL velocity
      // A2 ALIVE-AT-NIGHT: the survivor gets the same cool night lift as the horde (consistency + it reads
      // in FP/deep night); re-applied only when the night factor moves. The lantern stays the warm anchor.
      // The survivor already reads via its warm LANTERN, so it needs only a LIGHT cool fill — a lower max
      // than the horde (0.62) so its head doesn't read as a glowing bulb on top of the lantern (critic nit).
      const _nf = getWorld().nightFactor();
      if (Math.abs(_nf - _nfLastFill) > 0.004) { charRig.setNightFill(_nf, { max: 0.28 }); _nfLastFill = _nf; }
      rig.update(dt);                                 // rig eases on the real frame dt (matches main's present)
    },
    // handles for critics / debug
    get diveActive() { return dive.active; },
    get liveBolts() { return ballistics.liveCount; },
  };

  /* ---- probe hooks (harness-driven; no silent caps) ---- */
  ctx.probe.fire = () => fireShot(); // the REAL fire path (aim-assist incl.) — probes measure reality
  ctx.probe.melee = () => doMelee();

  /* ============================================================
     TOUCH CONTROLS (mobile) — v2 was WASD/mouse-only; this is the v1-style touch layer so a phone tap
     lands on a PLAYABLE game. Shown only on coarse pointers. Left thumb-stick = move (feeds moveInput);
     right FIRE (hold) / MELEE / DIVE buttons. The gun's aim-assist + the auto-face-nearest above make
     FIRE "shoot the closest threat", so no precise aiming is needed on touch.
     ============================================================ */
  function createTouchControls() {
    if (typeof document === 'undefined') return;
    const root = document.createElement('div');
    root.id = 'h2-touch';
    root.innerHTML = `
      <style>
        #h2-touch { position: fixed; inset: 0; z-index: 40; pointer-events: none; touch-action: none;
          font: 700 13px/1 system-ui, sans-serif; -webkit-user-select: none; user-select: none; }
        #h2-touch .stick { position: absolute; left: 22px; bottom: 22px; width: 130px; height: 130px;
          border-radius: 50%; background: rgba(255,255,255,0.06); border: 2px solid rgba(255,255,255,0.18);
          pointer-events: auto; }
        #h2-touch .knob { position: absolute; left: 50%; top: 50%; width: 58px; height: 58px; margin: -29px 0 0 -29px;
          border-radius: 50%; background: rgba(220,210,180,0.55); box-shadow: 0 0 12px rgba(0,0,0,0.4); }
        #h2-touch .btns { position: absolute; right: 20px; bottom: 26px; display: grid; gap: 12px; pointer-events: none; }
        #h2-touch .btn { pointer-events: auto; width: 78px; height: 78px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.22);
          background: rgba(30,20,16,0.55); color: #e8dcc2; letter-spacing: 0.04em; display: grid; place-items: center; }
        #h2-touch .fire { width: 96px; height: 96px; background: rgba(150,40,30,0.6); border-color: rgba(255,120,90,0.5); font-size: 15px; }
        #h2-touch .row { display: flex; gap: 12px; }
        #h2-touch .btn:active { filter: brightness(1.4); }
      </style>
      <div class="stick"><div class="knob"></div></div>
      <div class="btns"><div class="fire btn">FIRE</div><div class="row"><div class="melee btn">MELEE</div><div class="dive btn">DIVE</div></div></div>`;
    document.body.appendChild(root);
    const stick = root.querySelector('.stick'), knob = root.querySelector('.knob'), R = 48;
    let sid = null;
    const center = () => { const r = stick.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
    const set = (dx, dy) => { const d = Math.hypot(dx, dy) || 1, c = d > R ? R / d : 1; knob.style.transform = `translate(${dx * c}px,${dy * c}px)`; touchMove.active = true; touchMove.x = (dx * c) / R; touchMove.y = -(dy * c) / R; };
    stick.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; sid = t.identifier; const [cx, cy] = center(); set(t.clientX - cx, t.clientY - cy); }, { passive: false });
    root.addEventListener('touchmove', (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { e.preventDefault(); const [cx, cy] = center(); set(t.clientX - cx, t.clientY - cy); } }, { passive: false });
    const endStick = (e) => { for (const t of e.changedTouches) if (t.identifier === sid) { sid = null; touchMove.active = false; touchMove.x = touchMove.y = 0; knob.style.transform = ''; } };
    root.addEventListener('touchend', endStick); root.addEventListener('touchcancel', endStick);
    const fireBtn = root.querySelector('.fire');
    fireBtn.addEventListener('touchstart', (e) => { e.preventDefault(); firing = true; }, { passive: false });
    fireBtn.addEventListener('touchend', (e) => { e.preventDefault(); firing = false; }, { passive: false });
    fireBtn.addEventListener('touchcancel', () => { firing = false; });
    root.querySelector('.melee').addEventListener('touchstart', (e) => { e.preventDefault(); doMelee(); }, { passive: false });
    root.querySelector('.dive').addEventListener('touchstart', (e) => { e.preventDefault(); dive.toggle(); }, { passive: false });

    // FP TOUCH LOOK (owner defect #3 + "look only works in landscape"): ANY drag on the canvas while dived
    // → walker.addLook. The old "right half of innerWidth" test was orientation-fragile (portrait's narrow
    // right column above the buttons left almost no room); the stick + buttons (pointer-events:auto) swallow
    // their own touches, so any OTHER canvas touch is safely a look. touchmove is NON-passive +
    // preventDefault so iOS rotates the view instead of panning the page (the portrait failure).
    const dom = renderer.domElement, LOOK_SENS = 0.6;
    let lookId = null, lx = 0, ly = 0;
    dom.addEventListener('touchstart', (e) => { if (!dive.active) return; for (const t of e.changedTouches) if (lookId === null) { lookId = t.identifier; lx = t.clientX; ly = t.clientY; e.preventDefault(); break; } }, { passive: false });
    dom.addEventListener('touchmove', (e) => { if (!dive.active || lookId === null) return; for (const t of e.changedTouches) if (t.identifier === lookId) { walker.addLook((t.clientX - lx) * LOOK_SENS, (t.clientY - ly) * LOOK_SENS); lx = t.clientX; ly = t.clientY; e.preventDefault(); } }, { passive: false });
    const endLook = (e) => { for (const t of e.changedTouches) if (t.identifier === lookId) lookId = null; };
    dom.addEventListener('touchend', endLook); dom.addEventListener('touchcancel', endLook);
  }
  if (coarse) createTouchControls();

  registry.register('player', facade);
  return facade;
}
