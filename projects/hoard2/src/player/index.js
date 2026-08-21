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
import { createCharacterRig, createFirstPersonWalker, createBallistics, createWeaponKit, heightFieldProbe } from '@lgr/engine-core';
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
// A8-3 WEAPON BEATS — a cosmetic magazine gives firing a RHYTHM: fire → recoil settle → (mag empty) reload
// dip → ready. FEEL values (owner to tune): a roomy 14-round mag so the reload is an occasional beat, not a
// constant interruption, and a brisk 0.85 s dip. Presentation + a fire-rate gate only — the sim (seeded
// zombie step) is untouched, so the determinism trace is unmoved (it drives no player fire). DRAW = the
// un-holster raise when you enter the FP dive (the embodiment moment). No ammo HUD — the DIP animation +
// the gun coming off aim IS the feedback (kept to the animation beat the brief asked for, not a UI add).
const MAG = { size: 14, reloadS: 0.85 };
const DRAW_S = 0.5;
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

  // A8-1: survivor foot-lock opt-in — the SAME ?footik=1 flag the zombie horde reads (sim/index.js), so one
  // switch A/B-s the plant on both the horde and the hero. Default OFF pending the owner's by-feel review.
  const _footIkOn = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('footik') === '1');
  // ARC A-NEXT: ?reloadclip=1 A/B-s the AUTHORED "Reload" clip (tools/blender/build_reload.py →
  // models/survivor-reload.glb, Path B of the asset pipeline) against the A8-3 PROCEDURAL reloadBeat()
  // layer. Additive only — default OFF means byte-identical to before (no extra clip fetch, reloadBeat()
  // stays the fallback), per the prior decision this arc does not re-litigate. Measured in
  // docs/captures/hoard2/a-next-reload-ab/ (tools/capture-reload-ab.mjs).
  const _reloadClipOn = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('reloadclip') === '1');

  /* ---- the ground pose (the pinned facade field SIM/FX read) ---- */
  const player = { x: 0, z: 0, facing: 0, vx: 0, vz: 0 };

  /* ---- the rigged survivor (async; a stand-in nothing until the GLB lands) ---- */
  let survivor = null, isoGun = null;
  let _groundArm = null;   // A-CENSUS: the survivor's measured-floor receipt (see setFootIK below; read by probe.groundContact)
  // A-CLAMP: the survivor's ground-clamp receipt + its own kill switch (`?clamp=0`). Deliberately NOT the
  // `?footik` flag — a separate mechanism needs a separate lever or the two can never be A/B-ed apart.
  let _clampArm = null;
  const _clampOn = !(ctx.flags && ctx.flags.q && ctx.flags.q.get('clamp') === '0');
  let _workCd = 0;   // A2: harvest/build gesture cooldown (s) — throttles the Working clip re-trigger
  // A2 ACTION COVERAGE: the survivor.glb ships a WORKING clip — wire it as the harvest/build gesture so the
  // survivor visibly chops/works instead of standing idle at a node. (Clip inventory: Idle/Walk/Run/Punch/
  // Death/Jump/Working — no eat clip, and that event doesn't exist in the sim, so it's out of scope this
  // arc; fire-recoil + melee are the existing B4 procedural gestures. Reload NOW has an authored clip too —
  // Arc A-NEXT, gated behind ?reloadclip=1 — see startReload() below.)
  // A8-1: ?locoease=<n> A/B lever for the blend-ease rate (1/s). Omitted → the rig default (10). A large
  // value (?locoease=200) ≈ the pre-A8 instant blend, so the transition probe can measure the pop it removes.
  const _locoEaseFlag = ctx.flags && ctx.flags.q && ctx.flags.q.get('locoease');
  const charRig = createCharacterRig({
    url: 'models/survivor.glb',
    // ARC A-NEXT: the authored clip only loads when the A/B flag is on — the default path fetches
    // nothing extra (extraClips: [] is the engine's own no-op default, see createCharacterRig.js:145).
    extraClips: _reloadClipOn ? ['models/survivor-reload.glb'] : [],
    states: { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Punch', hit: 'HitReact', death: 'Death', work: 'Working', reload: 'Reload' },
    locoEase: _locoEaseFlag != null ? +_locoEaseFlag : undefined,
  });
  charRig.ready.then(() => {
    // M1 MOBILE TRUTH: the survivor opts OUT of shadow-casting on mobile. The shadow map is near-frozen there
    // (static casters only — see world.setShadowThrottle), and a MOVING caster under a frozen map would drag a
    // detached ghost shadow. The arena reads via the static ruins/building shadows; the hero loses only its own
    // (which in the phone-proven v1 was a frozen ghost anyway). Desktop keeps the survivor's real cast shadow.
    survivor = charRig.spawn({ castShadow: !ctx.mobile });
    survivor.object.scale.setScalar(CHAR_SCALE);
    survivor.object.position.set(player.x, GROUND_Y, player.z);
    scene.add(survivor.object);
    survivor.setState('idle');
    survivor.setIdleRelax(true);   // A2: soften the survivor's braced 'lunge' idle when standing calm
    // A8-1 SURVIVOR FOOT-LOCK — the A7-2 plant-and-hold, now on the survivor (the owner's own character).
    // Same engine seam (setFootIK), same flag family as the horde: ?footik=1 opts in (DEFAULT OFF pending the
    // owner's by-feel review — his 2026-07-29 ruling; the slip probe reports the plant delta either way).
    // Params are SCALE-AWARE: the survivor renders at 0.32 (a ~1.68-unit body), so its foot-lift + stride in
    // WORLD metres are ~0.32× a full-scale rig — plantBand/maxStride scale with CHAR_SCALE so the contact
    // test tracks the survivor's actual gait, not the zombie's. Desktop-only (mobile skips the motion layers).
    /* A-GROUND (2026-08-20): the foot-lock's floor goes from INFERRED to MEASURED. Without a wired
       surface probe the rig computes a leaky-min over its own feet — self-referential, so it locks the
       feet wherever the body was put and can never contradict a sunk stance. `heightFieldProbe` adapts
       this project's ground authority (`world.groundAt`) to the `segmentHit` dialect the ability speaks.
       BOTH halves are required (createCharacterRig.js:834), which is why the probe is wired on the same
       line as the flag rather than somewhere it could drift away from it. */
    if (!ctx.mobile && _footIkOn) {
      // Resolved INSIDE the guard so the default (flag-off) path stays a true no-op — it does not even
      // look the world up. Lazily, because this runs after a GLB fetch and the registry is not
      // guaranteed populated at module-construction time.
      const _w = registry.has('world') ? registry.get('world') : null;
      const _gp = _w && heightFieldProbe(_w.groundAt);
      if (_gp) survivor.setSurfaceProbe(_gp);
      /* A-CENSUS (2026-08-20): CONSUME THE RECEIPT. `setFootIK` now returns the engine's ground report
         (createCharacterRig `groundReport`), so "I asked for a measured floor" and "I am getting one" stop
         being the same sentence. The survivor is a mixamo rig — articulated, so it CAN take the measured
         branch — but that was true by luck of the asset, not by anything this call site checked; on a rig
         that could not, this used to be silent in exactly the way the zombie horde's was. */
      _groundArm = survivor.setFootIK({ plantBand: 0.22 * CHAR_SCALE, maxStride: 1.25 * CHAR_SCALE, groundProbe: true });
      if (!_groundArm || !_groundArm.ok) console.warn(`[hoard2] survivor: MEASURED ground floor requested but NOT armed — ${!_gp ? 'no world.groundAt to build a probe from' : (_groundArm ? _groundArm.reason : 'the rig returned no receipt')}. The foot-lock is running on the INFERRED floor.`);
    }
    /* ── A-CLAMP (2026-08-21): THE GROUND CLAMP on the survivor, on its own lever (`?clamp=0` off) and
       NOT behind `!ctx.mobile`. Different mechanism from the foot-lock above and therefore a different
       switch — see sim/index.js's `_clampOn` block for the full argument. The survivor is the least sunk
       of the three classes (census: −0.0014, 0 of 1 sunk) so this changes almost nothing for it today;
       it is wired because leaving one of three classes out is precisely the wiring drift CLAUDE.md names,
       and because the class that is fine on flat hoard2 ground is the one that will not be on a slope. */
    if (_clampOn) {
      const _cw = registry.has('world') ? registry.get('world') : null;
      _clampArm = _cw && typeof _cw.groundAt === 'function' ? survivor.setGroundClamp({ groundAt: _cw.groundAt }) : null;
      if (!_clampArm || !_clampArm.ok) console.warn(`[hoard2] survivor: GROUND CLAMP requested but NOT armed — ${!_cw ? 'no world.groundAt to clamp against' : (_clampArm ? _clampArm.reason : 'the rig returned no receipt')}. The body keeps whatever Y it is placed at, including below the floor.`);
    }
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
  let fpRecoil = 0, fpRecoilVel = 0;   // A5: fire kick as a damped SPRING (kicks back, then settles with a small bounce)
  const fpGun = createWeaponKit({ material: ctx.weaponSkins ? ctx.weaponSkins.gunmetal_worn : null });
  fpGun.group.visible = false; fpGun.group.renderOrder = 20;
  fpGun.mesh.frustumCulled = false;
  scene.add(fpGun.group);
  const _vmFwd = new THREE.Vector3(), _vmRight = new THREE.Vector3(), _vmUp = new THREE.Vector3(), _vmBasis = new THREE.Matrix4();
  const _vmTilt = new THREE.Quaternion();   // A8-3: muzzle-down tilt while the viewmodel is lowered (reload/draw)
  const _WORLD_UP = new THREE.Vector3(0, 1, 0);
  let _vmBob = 0;
  // A8-3 FP viewmodel LOWER — the reload DIP (drop off aim, hold, raise: dipEnvelope) + the DRAW (raise from
  // holstered on dive-enter). 0 = at ready, 1 = fully lowered. Computed each frame in update, read here.
  const _dipEnv = (u) => { if (u <= 0 || u >= 1) return 0; const ss = (a) => a * a * (3 - 2 * a); if (u < 0.22) return ss(u / 0.22); if (u > 0.72) return ss((1 - u) / 0.28); return 1; };
  const _drawEnv = (u) => (u <= 0 ? 1 : u >= 1 ? 0 : 1 - (u * u * (3 - 2 * u)));  // holstered (1) → ready (0)
  let _fpLower = 0;

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
    // A5 FP-GUN LOOK FIX (owner mobile bug #2): the gun must ROTATE with the look. The old basis used
    // right = fwd×up and up = right×fwd, which is a REFLECTION (det −1) — `setFromRotationMatrix` on a
    // reflection yields a DEGENERATE quaternion that stayed constant, so the gun never tracked yaw (its +Z
    // happened to point forward-ish, hiding it). right = up×fwd + up = fwd×right is the proper right-handed
    // rotation (det +1): right points look-right, up stays world-up (no roll), and the quaternion now yaws
    // with the look. Verified by the touch probe (gun world-dir Δ tracks facing Δ). Desktop inherits the fix.
    _vmRight.crossVectors(_WORLD_UP, _vmFwd).normalize();
    _vmUp.crossVectors(_vmFwd, _vmRight);
    _vmBasis.makeBasis(_vmRight, _vmUp, _vmFwd);   // gun +Z → look direction, +Y up, +X right (upright)
    fpGun.group.quaternion.setFromRotationMatrix(_vmBasis);
    _vmBob += rdt * (moving ? (sprint ? 15 : 9) : 2.2);
    const bob = Math.sin(_vmBob) * (moving ? 0.010 : 0.0035);
    const kick = fpRecoil * 0.07;                  // recoil pulls the gun back + up
    // A8-3: the reload dip + draw LOWER the gun toward the hip (down + back + a slight muzzle-down tilt) so it
    // reads as coming off aim to work the mag / being raised on the draw. _fpLower is 0 at ready.
    if (_fpLower > 0.001) { _vmTilt.setFromAxisAngle(_vmRight, _fpLower * 0.55); fpGun.group.quaternion.premultiply(_vmTilt); }  // muzzle dips
    fpGun.group.position.copy(eyePos)
      .addScaledVector(_vmFwd, 0.30 - kick - _fpLower * 0.12)
      .addScaledVector(_vmRight, 0.11)
      .addScaledVector(_vmUp, -0.15 + bob + kick * 0.6 - _fpLower * 0.26);
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
      _fpDrawT = DRAW_S;                             // A8-3: DRAW the gun up into view as you embody the survivor
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
    fpRecoilVel += 9;                         // A5: impulse the FP-viewmodel recoil spring (settles in update)
    muzzleFlash.position.copy(_muzWP); flashT = 1;   // B4: flash light at the same muzzle (was pulseMuzzle)
  }
  // A8-3 MAGAZINE — a cosmetic ammo count that drives the reload beat. Presentation + fire gate only.
  let _ammo = MAG.size, _reloadT = 0, _fpDrawT = 0;
  const _reloadEvt = { };
  function startReload() {
    if (_reloadT > 0) return;
    _reloadT = MAG.reloadS;
    // ARC A-NEXT A/B: ?reloadclip=1 plays the AUTHORED "Reload" clip (a real Blender-made action,
    // findClip-bound like any built-in state) instead of the A8-3 PROCEDURAL reloadBeat() layer. Default
    // OFF → reloadBeat() stays the fallback (prior decision #3 — additive only, not re-litigated).
    if (survivor) { if (_reloadClipOn) survivor.playAction('reload'); else survivor.reloadBeat(); }
    events.emit('weapon:reload', _reloadEvt);      // named hook (future SFX); no listener required
  }
  function doFire() {
    if (fireCd > 0 || getSim().state.dead) return;
    if (_reloadT > 0) return;                      // mid-reload → the gun is down, can't fire (the rhythm)
    if (_ammo <= 0) { startReload(); return; }     // empty → begin the reload dip
    fireCd = GUN.cooldownS;
    _ammo--;
    fireShot();
    if (_ammo <= 0) startReload();                 // that was the last round → dip to ready
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
      // A5 FP recoil SPRING — a lightly-damped 2nd-order settle (ζ≈0.66): the gun kicks back then eases home
      // with a small overshoot, instead of a linear ramp-to-zero. k=stiffness, c=damping; clamped for safety.
      if (fpRecoil !== 0 || fpRecoilVel !== 0) {
        fpRecoilVel += (-130 * fpRecoil - 15 * fpRecoilVel) * rdt;
        fpRecoil += fpRecoilVel * rdt;
        if (fpRecoil > 1.2) { fpRecoil = 1.2; fpRecoilVel = 0; }
        if (Math.abs(fpRecoil) < 1e-4 && Math.abs(fpRecoilVel) < 1e-3) { fpRecoil = 0; fpRecoilVel = 0; }
      }
      if (!dive.active) fpGun.group.visible = false;                   // viewmodel is dive-only (placed in the eye source)
      // A8-3: tick the reload + draw timers (wall-clock, pause-aware); refill the mag when the dip completes;
      // compute the FP viewmodel lower amount (max of the reload dip + the draw raise).
      if (_reloadT > 0) { _reloadT = Math.max(0, _reloadT - rdt); if (_reloadT === 0) _ammo = MAG.size; }
      _fpDrawT = Math.max(0, _fpDrawT - rdt);
      const _reloadLower = _reloadT > 0 ? _dipEnv(1 - _reloadT / MAG.reloadS) : 0;
      const _drawLower = _fpDrawT > 0 ? _drawEnv(1 - _fpDrawT / DRAW_S) : 0;
      _fpLower = Math.max(_reloadLower, _drawLower);
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
        // A8-3: drop the aim layer while reloading so the gun-arm actually comes OFF aim for the dip (the rig
        // reloadBeat lowers it; a held aim would fight that). It re-aims the instant the reload completes.
        // ARC A-NEXT FIX: gate on the LOCAL _reloadT (this file's single source of truth for "mid-reload",
        // already used at every other reload check above), not survivor.reloading — that getter only
        // reflects the RIG's OWN procedural reloadT timer, which stays -1 the whole time when the ?reloadclip=1
        // A/B branch plays the authored clip via playAction() instead of reloadBeat(). Reading the wrong flag
        // meant the aim layer kept fighting the authored clip's arm rotation for its entire duration — found
        // BY the A/B measurement (the authored clip's gun-hand travel measured ~5x smaller than the
        // procedural version's, despite matching angles) before it was traced to this stale check.
        if (!dive.active && !dead && _reloadT === 0) {
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
      /* A-CLAMP: run the clamp AFTER the mixer + layer pass (so it measures THIS frame's pose) and after
         the body was re-placed above (line ~597 sets y = GROUND_Y every frame — the clamp's offset is
         re-derived from scratch each frame and never accumulates). A no-op when `?clamp=0`. */
      if (survivor) survivor.groundClampStep(rdt);
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
  ctx.probe.survivorBlend = () => (survivor ? survivor.locoBlend : null);   // A8-1: transition-probe reads the blend weights
  ctx.probe.weaponState = () => ({ ammo: _ammo, reloading: _reloadT > 0, drawing: _fpDrawT > 0, fpLower: +_fpLower.toFixed(3) });   // A8-3: reload/draw beat probe
  // ARC A-NEXT: the gun-hand's WORLD position, so a capture script can measure how far the reload beat
  // actually moves the arm — the same "did the clip/layer really drive the rig" proof capture-custom-clip.mjs
  // uses, applied here to A/B the authored clip against the procedural reloadBeat() layer.
  /* A-CENSUS: the survivor is the third class of rendered character and the census could not see it as one
     — it was inferred as "whichever group has exactly one member", which is how a lone CORPSE came to be
     labelled `survivor`. Its root is its own direct scene child (scene.add(survivor.object)), so the census
     can name it by identity; the expectation is 1 by construction (this game has one player), which is an
     INDEPENDENT number — a survivor.glb that failed to load must read as a DISAGREE, not vanish from both
     sides of the comparison at once. `groundContact` reports the measured floor the survivor actually got. */
  (ctx.probe.characterClasses = ctx.probe.characterClasses || []).push(
    () => ({ name: 'survivor', rootId: survivor ? survivor.object.id : -1, expected: 1, source: 'one player by construction' }),
  );
  ctx.probe.survivorGroundContact = () => ({ arm: _groundArm, live: survivor ? survivor.groundReport : null });
  // A-CLAMP: the survivor's clamp receipt, same shape as the hordes' (sim/index.js probe.groundClamp).
  ctx.probe.survivorGroundClamp = () => ({ on: _clampOn, arm: _clampArm, live: survivor ? survivor.groundClampReport : null });
  // A-CLAMP: the survivor's half of the live re-arm (sim/index.js probe.rearmClamp does the two hordes).
  ctx.probe.rearmSurvivorClamp = (cfg) => {
    const w = registry.has('world') ? registry.get('world') : null;
    if (!survivor || !w || typeof w.groundAt !== 'function') return 0;
    _clampArm = survivor.setGroundClamp({ groundAt: w.groundAt, ...(cfg || {}) });
    return 1;
  };
  ctx.probe.gunHandPos = () => {
    if (!survivor) return null;
    const b = survivor.object.getObjectByName('RightHand'); if (!b) return null;
    b.updateWorldMatrix(true, false);
    const p = new THREE.Vector3(); b.getWorldPosition(p);
    return { x: p.x, y: p.y, z: p.z };
  };

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
        #h2-touch .btn.sm { width: 62px; height: 62px; font-size: 11px; }
        #h2-touch .confirm { width: 96px; height: 62px; border-radius: 14px; background: rgba(40,120,50,0.62); border-color: rgba(120,230,120,0.5); display: none; }
        #h2-touch .build.on { background: rgba(40,120,50,0.55); border-color: rgba(120,230,120,0.45); }
        #h2-touch .row { display: flex; gap: 12px; align-items: flex-end; }
        #h2-touch .btn:active { filter: brightness(1.4); }
      </style>
      <div class="stick"><div class="knob"></div></div>
      <div class="btns"><div class="confirm btn">✓ PLACE</div><div class="fire btn">FIRE</div><div class="row"><div class="melee btn sm">MELEE</div><div class="build btn sm">BUILD</div><div class="dive btn sm">DIVE</div></div></div>`;
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
    // A5 (owner bug #1): DIVE is a clear TOGGLE — label + tint flip so touch users know it surfaces. onDiveToggle
    // seeds/exits the walker (same path the desktop key uses) then flips the controller; the label follows the events.
    const diveBtn = root.querySelector('.dive');
    diveBtn.addEventListener('touchstart', (e) => { e.preventDefault(); onDiveToggle(); }, { passive: false });
    events.on('dive:enter', () => { diveBtn.textContent = 'EXIT'; diveBtn.style.background = 'rgba(40,90,110,0.62)'; });
    events.on('dive:exit', () => { diveBtn.textContent = 'DIVE'; diveBtn.style.background = ''; });

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

    // A5 ISO PINCH-ZOOM (owner bug #3): two fingers on the canvas in ISO → pinch to zoom. rig.zoomBy CLAMPS to
    // the rig's zoomMin/zoomMax (1.5–16 world half-height; iso default 6) so the read stays intact. Never fights
    // the FP look above (that path is single-touch AND dive-gated; pinch is two-touch AND iso-gated), and the
    // stick/buttons are separate elements so their touches never reach the canvas. Spreading apart = zoom in.
    const ptrs = new Map();
    let pinchPrev = 0;
    const pinchDist = () => { const p = [...ptrs.values()]; return Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); };
    dom.addEventListener('touchstart', (e) => {
      if (dive.active) return;
      for (const t of e.changedTouches) ptrs.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (ptrs.size === 2) { pinchPrev = pinchDist(); e.preventDefault(); }
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      if (dive.active || ptrs.size < 2) return;
      let moved = false;
      for (const t of e.changedTouches) if (ptrs.has(t.identifier)) { ptrs.set(t.identifier, { x: t.clientX, y: t.clientY }); moved = true; }
      if (moved && ptrs.size === 2) { const d = pinchDist(); if (pinchPrev > 0 && d > 0) rig.zoomBy(pinchPrev / d); pinchPrev = d; e.preventDefault(); }
    }, { passive: false });
    const endPinch = (e) => { for (const t of e.changedTouches) ptrs.delete(t.identifier); if (ptrs.size < 2) pinchPrev = 0; };
    dom.addEventListener('touchend', endPinch); dom.addEventListener('touchcancel', endPinch);

    // A5 TOUCH BUILD-MODE (owner's original item 5): the desktop ghost build-mode (B toggles · cursor previews ·
    // click places) has no touch path. Here: BUILD toggles it, a single TAP on the ground moves the ghost
    // preview (coarse pointers skip the per-frame aim raycast, so we set _aimPt from the tap), and ✓ PLACE
    // commits — the same placeGhost/updateGhost/anti-stack line-extend the desktop path uses. Iso only.
    const buildBtn = root.querySelector('.build'), confirmBtn = root.querySelector('.confirm');
    const showBuildUi = (on) => { buildBtn.classList.toggle('on', on); buildBtn.textContent = on ? 'CANCEL' : 'BUILD'; confirmBtn.style.display = on ? 'grid' : 'none'; };
    // raycast a client point to the ground → _aimPt + aimValid (the ghost tracks _aimPt every frame while valid)
    const touchAimAt = (cx, cy) => { setPointer(cx, cy); raycaster.setFromCamera(pointerNdc, rig.camera); aimValid = !!raycaster.ray.intersectPlane(groundPlane, _aimPt); };
    buildBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (dive.active) return; setBuildMode(!buildMode); showBuildUi(buildMode); }, { passive: false });
    confirmBtn.addEventListener('touchstart', (e) => { e.preventDefault(); if (buildMode && aimValid) placeGhost(); }, { passive: false });   // keep build-mode ON → place several (line-extends)
    // single-finger TAP on the canvas while building → move the ghost preview to the tapped ground point
    let tapId = null, tapX = 0, tapY = 0, tapMoved = false;
    dom.addEventListener('touchstart', (e) => {
      if (!buildMode || dive.active || ptrs.size > 1) return;
      const t = e.changedTouches[0]; tapId = t.identifier; tapX = t.clientX; tapY = t.clientY; tapMoved = false;
      touchAimAt(t.clientX, t.clientY); e.preventDefault();   // tap-to-preview: immediate
    }, { passive: false });
    dom.addEventListener('touchmove', (e) => {
      if (tapId === null) return;
      for (const t of e.changedTouches) if (t.identifier === tapId) { if (Math.hypot(t.clientX - tapX, t.clientY - tapY) > 6) tapMoved = true; touchAimAt(t.clientX, t.clientY); }   // drag to fine-tune the preview
    }, { passive: false });
    const endTap = (e) => { for (const t of e.changedTouches) if (t.identifier === tapId) tapId = null; };
    dom.addEventListener('touchend', endTap); dom.addEventListener('touchcancel', endTap);
    // leaving iso (dive) force-exits build-mode + its UI (build is iso-only; setBuildMode already guards)
    events.on('dive:enter', () => { if (buildMode) { setBuildMode(false); showBuildUi(false); } });
  }
  if (coarse) createTouchControls();

  registry.register('player', facade);
  return facade;
}
