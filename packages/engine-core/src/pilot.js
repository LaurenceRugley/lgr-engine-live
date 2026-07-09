/* ============================================================
   pilot.js — Lesson 76: POSSESSION + the ground MovementModel (the pilot/free-roam arc kickoff).
   ------------------------------------------------------------
   The world editor (L71–L75) lets you BUILD + persist a world. This lesson lets you GO INTO it:
   possess a placed entity and DRIVE it. The first craft is the ALL-TERRAIN VEHICLE — Laurence's
   "rule-breaker" that ignores roads/biomes and rides straight over the valleys/grass/dirt you
   sculpted, following the terrain heightfield. But the REUSABLE thing this builds is the seam every
   future craft (the all-medium spacecraft, boat, bird, plane, heli) inherits:

     PilotController   the CONTEXT (one instance, engine-core): owns the FREECAM → ENTERING →
                       PILOTING state machine + possess()/release(). Drives the camera-rig follow,
                       steps the active model, suspends/restores the craft's autonomy.
     MovementModel     a PURE integrator per craft: step(state, axes, dt, world) advances the
                       craft's state. The ATV is the first; adding the spacecraft = a new step(),
                       ZERO controller edits. (This is the GoF STRATEGY pattern — chosen over ECS
                       because it matches our factory-closure style, Rule 6.)
     PilotProfile      a descriptor a placeable entity exposes (the sibling of the L63 followable):
                       binds the entity to a model + getTransform/setTransform + suspend/resume
                       autonomy + the chase-cam profile + control hints. "Inspect → pilot" is ONE
                       registry, two verbs — a followable that also carries `.pilot` is pilotable.

   ── C++ ANCHORS (Laurence learns via C++) ────────────────────────────────────
   • STRATEGY = an abstract base `struct MovementModel { virtual void step(State&, const Axes&,
     float dt, const World&) = 0; };`. The controller holds a `MovementModel*` and calls it
     polymorphically — exactly the shape of the inspector's `std::vector<IFollowable*>`. Adding a
     craft is a new subclass; the controller never changes (the open/closed principle).
   • SEMI-IMPLICIT EULER = update VELOCITY first, then move POSITION with the NEW velocity. It's the
     stable cheap integrator games use; plain ("explicit") Euler — move with the OLD velocity — drifts
     and feels twitchy. One line's difference, a world of stability.
   • `axes` = a POD float struct (`struct Axes { float throttle, steer; };`) = a const uniform block
     the model reads each frame; the input layer (keyboard/touch) just fills it. Devices in, motion out.
   • The chase camera is a control loop chasing a moving setpoint: we set the rig's GOAL azimuth to
     "behind the craft's heading" and the rig's existing exponential damp eases toward it — the lag +
     swing-on-turn that sells "a body in motion" falls out for free (the research's "feel = camera +
     momentum, not physics").
   ============================================================ */
import * as THREE from 'three';
import { damp, clamp } from './math.js';
import { createSeatedLook } from './interior.js';

/* L107 — the ONE "no open water here" sentinel, shared by the medium probe's guard (`waterY > NO_WATER`) and by
   every waterHeightAt sampler (the engine default + the city sea sampler). Was two mismatched locals (pilot -900 /
   engine -999): harmless today only because the engine returns exactly -999, but any future sampler value in
   (-999, -900) would spuriously flip the probe to water. Export once, guard once. */
export const NO_WATER = -999;

/* ---- CRAFT PROFILES — distinctiveness is NUMBERS, not new code (the research's data-table lever).
   The all-terrain vehicle: brisk but controllable across a ~26-unit world. Reverse is slower than
   forward (like a real car). chaseDist/chaseElev frame the over-the-shoulder chase. Tunable; the
   values here were dialled in the browser (reported in the L76 handoff). ------------------------- */
export const ATV_PROFILE = {
  maxSpeed: 6.0,     // world units / second forward (reverse capped at half this)
  accel: 9.0,        // throttle acceleration (u/s²)
  drag: 5.0,         // coast friction when throttle released (u/s²) — momentum, not an instant stop
  turnRate: 2.1,     // max yaw rate (rad/s) at speed
  chaseDist: 7.0,    // camera dolly distance behind the craft (perspective)
  chaseElev: 0.42,   // camera pitch (rad ≈ 24°) — a low over-the-shoulder chase
  // H — feel envelope (tunable; owner's hands are final judge)
  steerAttack: 0.18, steerRelease: 0.22, liftAttack: 0.12,   // damp τ (seconds) for each axis
  expo: 0.5,         // steer expo curve steepness (0=linear, 1=cubic; 0.5 = mild S-curve)
  bankMax: 0.35, bankTau: 0.18,   // lean angle (rad) + damp τ for coordinated bank
  camLead: 0.14,     // camera azimuth lead (rad per normalised steer at turn=2 rad/s)
};

/* ── THE GROUND MOVEMENT MODEL (Strategy) ────────────────────────────────────
   A PURE arcade integrator: throttle → speed along heading, steer → heading, project onto the
   terrain heightfield, orient the chassis to the slope. No physics engine — the research's "feel =
   camera + momentum." `state` is the entity's live, mutable movement record (so `speed` accumulates
   across frames); `world.heightAt(x,z)` is the terrain sampler (L73). Reusable scratch lives in the
   closure so step() allocates nothing per frame (the per-frame allocation = GC-hitch trap).

   Returns the model object `{ step }`. createGroundModel(profile) is the FACTORY a PilotProfile names
   via `model:'ground'`; a future craft is createSpacecraftModel(profile) with the same signature. */
export function createGroundModel(profile = ATV_PROFILE) {
  // scratch THREE objects reused every frame (no per-frame `new`)
  const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
  const _fwd2 = new THREE.Vector3(), _m = new THREE.Matrix4();
  const EPS = 0.45;   // world-unit offset for the central-difference terrain normal (small = local slope)

  function step(state, axes, dt, world) {
    const H = (world && world.heightAt) || (() => 0);

    // 1) STEER → HEADING. Authority scales gently with speed (mushy parked, bites moving) so you
    //    can't pirouette in place — the cheap "stall feel" the research notes. Reversing flips the
    //    steer sense (back up and the wheel turns you the natural way, like a real car).
    const speedFrac = clamp(Math.abs(state.speed) / profile.maxSpeed, 0, 1);
    const dirSign = state.speed >= 0 ? 1 : -1;
    state.yaw += axes.steer * profile.turnRate * (0.35 + 0.65 * speedFrac) * dirSign * dt;

    // 2) THROTTLE → SPEED (semi-implicit: velocity FIRST). Held throttle accelerates; released, the
    //    craft COASTS to a stop under friction (momentum is the whole feel). Reverse is capped slower.
    if (axes.throttle !== 0) {
      state.speed += axes.throttle * profile.accel * dt;
    } else {
      const f = Math.min(Math.abs(state.speed), profile.drag * dt);   // friction can't overshoot zero
      state.speed -= Math.sign(state.speed) * f;
    }
    state.speed = clamp(state.speed, -profile.maxSpeed * 0.5, profile.maxSpeed);

    // 3) POSITION along the heading (semi-implicit: move with the NEW speed). forward = (sinθ, cosθ)
    //    matches the placed-life heading convention (so +Z is the craft's nose at yaw 0).
    const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
    state.x += s * state.speed * dt;
    state.z += c * state.speed * dt;

    // 4) TERRAIN-FOLLOW (the rule-breaker): snap Y to the heightfield — drives across any valley/grass/
    //    dirt, ignoring roads + biomes. Damp Y (not a hard set) so a steep single-step doesn't pop the
    //    chassis — the pause-point the brief flagged: clamp/damp the Y on steep slopes. Fast rate (≈ on
    //    the ground) but spike-smoothed.
    const groundY = H(state.x, state.z);
    state.y = damp(state.y, groundY, 18, dt);

    // 5) ORIENT TO SLOPE → a QUATERNION (never Euler — gimbal lock). Sample the heightfield around the
    //    craft → a surface normal via central differences → a basis (right, up=normal, forward-on-slope)
    //    → the chassis banks on side-slopes + pitches up/down hills + yaws to heading, all in one quat.
    const hL = H(state.x - EPS, state.z), hR = H(state.x + EPS, state.z);
    const hD = H(state.x, state.z - EPS), hU = H(state.x, state.z + EPS);
    _up.set(hL - hR, 2 * EPS, hD - hU).normalize();          // gradient → upward surface normal
    _fwd.set(s, 0, c);                                        // flat heading (the nose direction)
    _right.crossVectors(_up, _fwd).normalize();              // right = up × forward
    _fwd2.crossVectors(_right, _up).normalize();             // re-orthogonalize forward onto the slope plane
    _m.makeBasis(_right, _up, _fwd2);                        // columns X,Y,Z of the chassis frame
    state.quat.setFromRotationMatrix(_m);
    return state;
  }
  return { step };
}

/* ---- THE SPACECRAFT — the all-medium "master rule-breaker" (L77). One craft that flows AIR ↔ WATER ↔ GROUND. */
export const CRAFT_PROFILE = {
  accel: 7.0,        // forward thrust (u/s²)
  lift: 9.0,         // vertical control authority (u/s²) — climb/descend
  maxV: 5.0,         // max vertical speed (u/s)
  chaseDist: 9.5,    // a wider chase than the ATV (it's airborne)
  chaseElev: 0.40,   // ≈ 23° chase pitch
  // H — feel envelope (tunable; owner's hands are final judge)
  steerAttack: 0.15, steerRelease: 0.20, liftAttack: 0.10,   // damp τ (seconds) for each axis
  expo: 0.5,         // steer expo curve steepness (0=linear, 1=cubic; 0.5 = mild S-curve)
  bankMax: 0.40, bankTau: 0.14,   // lean angle (rad) + damp τ for coordinated bank
  camLead: 0.18,     // camera azimuth lead (rad per normalised steer at turn=1.8 rad/s)
  // L-cockpit: the eye anchor in the craft's LOCAL frame (right/up/forward). Used by the cockpit POV only;
  // profiles without `eye` (e.g. ATV_PROFILE) fall back to a safe default in the pilot controller.
  eye: { x: 0, y: 0.35, z: 0.1 },   // centred, 0.35 u above craft origin, 0.1 u forward (cockpit sill)
  // L108 (part C): the collision SPHERE — cabin-sized, NOT rotor-tip (studio demos cheat small so grazes feel
  // forgiving). A profile carrying `collide` opts the craft into building push-out; the ATV omits it (v1 = air craft).
  // PUSH_MAX must exceed maxSpeed (8) so a full-throttle head-on ram can't out-run the push-out and tunnel
  // through — 12 beats the 8 u/s inward motion with margin, yet still eases a deep teleport-in over ~5 frames.
  collide: { r: 0.5, yOff: 0.45, PUSH_MAX: 12.0, SLIDE_FRICTION: 1.8, SKIN: 0.02 },
};
/* Per-MEDIUM force mix — a small PARAMETER swap, NOT three models (the research §A insight). Same integrator,
   different drag/buoyancy/top-speed per medium. We EASE between sets on a crossing (see crossingT) so motion
   doesn't snap. AIR: low drag, floaty, fast. UNDERWATER: high drag + gentle buoyancy (slow glide, surfaces if you
   stop diving). GROUND: high drag + settle (the ATV's terrain-follow); throttle-up lifts back into AIR. */
const MEDIUM_PARAMS = {
  air:    { drag: 2.0, maxSpeed: 8.0, turn: 1.8, vDrag: 2.2, buoyancy: 0.0 },
  water:  { drag: 4.6, maxSpeed: 3.6, turn: 1.3, vDrag: 4.5, buoyancy: 1.1 },   // buoyancy floats it up when you release descend
  ground: { drag: 5.5, maxSpeed: 5.0, turn: 2.0, vDrag: 9.0, buoyancy: 0.0 },
};
const PARAM_KEYS = ['drag', 'maxSpeed', 'turn', 'vDrag', 'buoyancy'];
const lerp = (a, b, t) => a + (b - a) * t;

/* ── THE SPACECRAFT MOVEMENT MODEL (Strategy) ────────────────────────────────
   A yaw + throttle + vertical-LIFT "saucer/drone" integrator (intuitive, never-stalls, crosses mediums cleanly).
   NOTE (scope, Rule 2/3): the brief's full body-relative pitch/roll *flight physics* is deferred to L78 ("full
   flight physics"); this v1 = steer-to-aim + forward-thrust + a vertical axis, which hits every L77 criterion
   (climb, descend into ocean, surface, land) and is far more reliable to pilot for the Father's-Day demo.

   The ONE new idea is the MEDIUM PROBE: each step we classify where the craft is (AIR/GROUND/UNDERWATER) from the
   terrain + water surfaces the `world` object reports, with a SCHMITT TRIGGER (two thresholds) so it doesn't chatter
   at a boundary, then swap the force mix. C++: a `medium` enum recomputed per step → a switch over params; the
   Strategy stays ONE class (the medium is DATA, not a subclass — avoids a craft-explosion). */
export function createSpacecraftModel(profile = CRAFT_PROFILE) {
  const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
  const _fwd2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler();
  const _par = { drag: 0, maxSpeed: 0, turn: 0, vDrag: 0, buoyancy: 0 };   // L86 audit: reused per-medium param scratch (no per-frame {} alloc)
  const SKIN = 0.4;          // water-surface deadband (hysteresis half-width)
  const GROUND_SKIN = 0.3;   // "on the ground" band above the terrain surface
  // NO_WATER is the shared module-level export above (was a local -900 that mismatched the engine's -999).

  /* SCHMITT-TRIGGER medium classify: only FLIP when clearly past a surface; inside the deadband, keep the current
     medium (prevents AIR↔WATER flicker riding the waves). `cur` = last frame's medium. */
  function probeMedium(state, world) {
    const terrainY = world.heightAt(state.x, state.z);
    const waterY = world.waterHeightAt ? world.waterHeightAt(state.x, state.z) : NO_WATER;
    const y = state.y, cur = state.medium || 'air';
    if (waterY > NO_WATER) {                                  // there IS water here (ocean / lake)
      if (cur === 'water') { if (y <= waterY + SKIN) return 'water'; }   // stay submerged until clearly above the surface
      else if (y < waterY - SKIN) return 'water';            // dip clearly below the surface → enter water
    }
    if (cur === 'ground') { if (y <= terrainY + GROUND_SKIN + SKIN) return 'ground'; }   // stay landed until clearly lifted off
    else if (y < terrainY + GROUND_SKIN) return 'ground';
    return 'air';
  }

  function step(state, axes, dt, world) {
    // --- MEDIUM PROBE + crossing bookkeeping (for the eased transition + the project's juice/HUD) ---
    const prev = state.medium || 'air';
    const medium = probeMedium(state, world);
    state.medium = medium;
    if (medium !== prev) { state.crossing = prev + '>' + medium; state.crossFrom = prev; state.crossingT = 1; }   // a fresh crossing — remember the ORIGIN medium
    else if (state.crossingT > 0) state.crossingT = Math.max(0, state.crossingT - dt / 0.6); // ease out over ~0.6s
    // EASE the params from the crossing's ORIGIN medium → the current one over ~0.6s (motion glides, not snaps).
    // L110 (audit B12): the origin must be state.crossFrom, NOT `prev`. prev is last frame's medium, which becomes the
    // NEW medium one frame after the crossing → the old `MEDIUM_PARAMS[prev]` snapped to the destination on frame 2,
    // making the whole ease dead code. crossFrom is pinned at the crossing and held until crossingT decays to 0.
    const P = MEDIUM_PARAMS[medium], Pp = MEDIUM_PARAMS[(state.crossingT > 0 && state.crossFrom) ? state.crossFrom : medium], t = 1 - (state.crossingT || 0);
    const par = _par; for (const k of PARAM_KEYS) par[k] = lerp(Pp[k], P[k], t);   // L86 audit: fill the reused scratch (was `{}` per frame)

    // --- STEER → yaw ---
    // L110 (HOTFIX, Laurence's live phone test): the steer sense was REVERSED. `steer` is +1 for RIGHT input (main.js:334),
    // but the chase cam trails at azimuth = yaw+π (pilot.js), so +yaw swings the nose toward +X = screen-LEFT in that view —
    // i.e. pressing RIGHT turned the view LEFT. Empirically proven (a world point dead-ahead swept screen-RIGHT on +steer =
    // the left-turn sensation). NEGATE here (the shared seam → fixes ground AND air consistently; keys + stick both feed
    // `steer`, so they stay in agreement). Now RIGHT input turns the craft visibly RIGHT in the chase view.
    state.yaw -= axes.steer * par.turn * dt;

    // --- THROTTLE → forward speed along heading (semi-implicit: velocity first) ---
    if (axes.throttle !== 0) state.speed += axes.throttle * profile.accel * dt;
    else state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), par.drag * dt);
    state.speed = clamp(state.speed, -par.maxSpeed * 0.6, par.maxSpeed);
    const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
    state.x += s * state.speed * dt;
    state.z += c * state.speed * dt;

    const terrainY = world.heightAt(state.x, state.z);
    const waterY = world.waterHeightAt ? world.waterHeightAt(state.x, state.z) : NO_WATER;
    if (medium === 'ground' && axes.lift <= 0) {
      // GROUND: settle onto the terrain + orient to the slope (reuse the ATV's terrain-follow). Throttle-up
      // (lift>0) is handled by the airborne branch → lifts back off into AIR.
      state.vy = 0;
      state.y = damp(state.y, terrainY, 14, dt);
      const e = 0.45;
      const hL = world.heightAt(state.x - e, state.z), hR = world.heightAt(state.x + e, state.z);
      const hD = world.heightAt(state.x, state.z - e), hU = world.heightAt(state.x, state.z + e);
      _up.set(hL - hR, 2 * e, hD - hU).normalize();
      _fwd.set(s, 0, c); _right.crossVectors(_up, _fwd).normalize(); _fwd2.crossVectors(_right, _up).normalize();
      _m.makeBasis(_right, _up, _fwd2); state.quat.setFromRotationMatrix(_m);
    } else {
      // AIRBORNE / UNDERWATER: vertical velocity from the LIFT axis + medium buoyancy, damped by vertical drag.
      state.vy += (axes.lift * profile.lift + par.buoyancy) * dt;
      state.vy -= Math.sign(state.vy) * Math.min(Math.abs(state.vy), par.vDrag * dt);
      state.vy = clamp(state.vy, -profile.maxV, profile.maxV);
      state.y += state.vy * dt;
      if (state.y < terrainY) { state.y = terrainY; if (state.vy < 0) state.vy = 0; }   // can't sink through the ground
      // WATER SURFACE FLOOR: only block DOWNWARD motion — positive lift always escapes, no sticky latch.
      if (waterY > NO_WATER && state.y < waterY) { state.y = waterY; if (state.vy < 0) state.vy = 0; }
      // ORIENT: a saucer — yaw + a coordinated BANK into turns + a little PITCH from climb/dive. Small cosmetic
      // angles, so an Euler→quaternion build is safe (gimbal lock only bites near ±90° pitch, which we never reach).
      // H — coordinated bank: derive from the EASED steer (axes is _ax from the controller) × speed fraction.
      // Damped toward the target so the craft leans gradually INTO a turn and levels on exit — not a snap.
      // state.bank persists across frames; init to 0 on first step (no prior value on a fresh possess).
      state.bank ??= 0;
      const speedFrac = clamp(Math.abs(state.speed) / par.maxSpeed, 0, 1);
      const bMax = profile.bankMax || 0.4;
      const targetBank = clamp(axes.steer * speedFrac * bMax, -bMax, bMax);
      state.bank = damp(state.bank, targetBank, 1 / (profile.bankTau || 0.14), dt);
      const pitch = clamp(-state.vy * 0.06, -0.3, 0.3);
      _e.set(pitch, state.yaw, state.bank, 'YXZ'); state.quat.setFromEuler(_e);
    }
    return state;
  }
  return { step };
}

/* the model registry the controller dispatches on (a PilotProfile names its model by key). Adding a
   craft type = one entry here + its model factory + a PilotProfile on the entity. */
const MODEL_FACTORIES = { ground: createGroundModel, spacecraft: createSpacecraftModel };

const ENTER_TIME = 0.55;                 // seconds the ENTERING camera-move runs (input ignored) — "the move is the onboarding"
const ZERO_AXES = { throttle: 0, steer: 0, lift: 0 };

/* ── THE PILOT CONTROLLER (the CONTEXT / state machine) ───────────────────────
   createPilotController({ rig, world }) — engine-core singleton. The project wires input → axes,
   the possess trigger (a "drive" on a followed pilotable), and the HUD; everything else is here.
   ONE camera owner: possess() takes over rig.setFollow; we never run the inspector's follow AND a
   pilot follow at once (the project releases the inspector before possessing — the brief's pause-point). */
export function createPilotController({ rig, world } = {}) {
  let phase = 'free';        // 'free' | 'entering' | 'piloting'
  let craft = null;          // the possessed pilotable (a followable carrying `.pilot`)
  let model = null;          // the active MovementModel (Strategy instance)
  let enterT = 0;            // ENTERING countdown
  let fpBlend = 0;           // 0 = chase view · 1 = cockpit POV (today only integer values; named for future tween)
  // H — eased axis closure: steer/lift damp toward the raw input each frame; throttle bypass (has accel/drag).
  let _ax = { throttle: 0, steer: 0, lift: 0 };
  // expo(x, a): gentle S-curve on the steer axis — soft near centre, full authority at the edge.
  // a=0: linear (identity). a=1: cubic. a≈0.5: mild curve. Formula: x*(a·x²+(1-a)).
  const expo = (x, a) => x * (a * x * x + (1 - a));

  // L-cockpit: a SEATED LOOK instance owned by this controller (not reused from the office — one instance each).
  // Drives head-turn from right-drag / touch look-zone while in cockpit mode; smooth recenter on exit.
  const pilotLook = createSeatedLook({ yawLimit: 70, pitchUp: 25, pitchDown: 20 });
  // Scratch vectors: built once in the closure, never allocated in the hot path.
  const _eyeWorld = new THREE.Vector3();
  const _eyeDir   = new THREE.Vector3();

  /* possess(pilotable): bind the craft's model, freeze its autonomy, and start the ENTERING camera
     MOVE (a swing-in to the chase view — never a cut). Returns false if the thing isn't pilotable. */
  function possess(pilotable) {
    if (!pilotable || !pilotable.pilot) return false;
    if (craft) release();                                   // only one craft at a time
    craft = pilotable;
    const p = craft.pilot;
    const make = MODEL_FACTORIES[p.model] || MODEL_FACTORIES.ground;
    model = make(p.profile);
    _ax.throttle = 0; _ax.steer = 0; _ax.lift = 0;          // H — zero envelope on each new possession (no carry-over)
    p.suspendAutonomy();                                     // stop the entity's idle/park loop while piloted
    // CAMERA MOVE (not a cut): follow the craft's live position + ease the chase dolly; SNAP the orbit
    // azimuth behind the heading so the swing-in takes the short way, then let the rig ease the rest.
    rig.setFollow((out) => p.getWorldPos(out), { frame: p.profile.chaseDist });
    rig.setElevation(p.profile.chaseElev);
    rig.setAzimuth(p.getTransform().yaw + Math.PI, true);   // +π = behind the nose, looking along the heading
    // L108 CHASE SPRING-ARM: arm the rig with the collider's segment sweep + the pilot's ground sampler so the
    // chase camera shortens instead of clipping through towers. Universal to chase → armed at the controller (every
    // current + future pilotable inherits it, zero per-entry-path wiring). Gate is `piloting` (armed here, disarmed
    // in release). NOTE for when the cockpit POV ships: also gate `enabled` on `fpBlend < 0.5` (unshipped now → don't
    // reference it, or `undefined < 0.5` disables the arm — spec decision R2).
    if (rig.setSpringArm) rig.setSpringArm({ segmentQuery: world.segmentHit, getGroundY: world.heightAt, radius: 0.25, enabled: fpBlend < 0.5 });
    phase = 'entering'; enterT = ENTER_TIME;
    return true;
  }

  /* release(): the ALWAYS-AVAILABLE exit (Esc / ✕ — the Mario-Odyssey "you can always get out" rule).
     Resume the craft's autonomy (it parks itself again) and hand the camera back to free control. */
  function release() {
    if (!craft) return false;
    // L-cockpit: restore hull + hide canopy frame BEFORE nulling craft (we need craft.pilot).
    if (craft.pilot.setBodyVisible) craft.pilot.setBodyVisible(true);
    if (craft.pilot.setCockpitVisible) craft.pilot.setCockpitVisible(false);
    craft.pilot.resumeAutonomy();
    rig.clearFollow();
    if (rig.setSpringArm) rig.setSpringArm(null);   // L108: disarm the spring-arm → the free/attract camera is byte-identical again
    fpBlend = 0; pilotLook.recenter();               // L-cockpit: exit fp mode, smooth recenter of head-turn
    if (rig.clearEye) rig.clearEye();               // let camera-rig's orbit block resume
    craft = null; model = null; phase = 'free'; enterT = 0;
    return true;
  }

  /* step(dt, axes): called every frame BEFORE rig.update() (like the Hoard follow), so the camera
     damps toward the craft's NEW transform the same frame. ENTERING ignores driver input (the
     onboarding move); PILOTING integrates the model + swings the chase cam behind the heading. */
  function step(dt, axes) {
    if (!craft) return;
    const p = craft.pilot;
    if (phase === 'entering') {
      enterT -= dt;
      rig.setAzimuth(p.getTransform().yaw + Math.PI);       // keep trailing while the move eases in
      if (enterT <= 0) phase = 'piloting';
      return;
    }
    // PILOTING — the Strategy does the work; the controller just routes + drives the camera.
    const s = p.getTransform();                             // the live mutable movement state
    const ax = axes || ZERO_AXES;

    // H — INPUT ENVELOPE: ease raw steer/lift to analog before the model (all input sources share this path).
    // Throttle passes through unchanged — it already has accel/drag smoothing; double-smoothing = laggy.
    // steerAttack guards against missing fields on old profiles (fall-through = byte-identical pre-H).
    const prof = p.profile || {};
    if (prof.steerAttack) {
      const steerK = Math.abs(ax.steer) > 0.01 ? 1 / prof.steerAttack : 1 / prof.steerRelease;
      const liftK  = Math.abs(ax.lift)  > 0.01 ? 1 / prof.liftAttack  : 1 / prof.steerRelease;
      _ax.steer    = damp(_ax.steer, expo(ax.steer, prof.expo), steerK, dt);
      _ax.lift     = damp(_ax.lift,  ax.lift, liftK, dt);
    } else {
      _ax.steer = ax.steer; _ax.lift = ax.lift;
    }
    _ax.throttle = ax.throttle;

    // L108 (part C) — the ONE collision hook: integrate, then push the craft-sphere out of buildings BEFORE the
    // transform is written (the move-and-slide resolve slot). Strategy-agnostic → every craft with a `collide`
    // profile inherits it with zero model edits. TUNNELING GUARD: a fast craft (|speed|·dt > 0.3) on a spike
    // frame could step past a thin footprint in one go, so we SUBSTEP model.step+resolve at dt/2 (dt-correct
    // damping → motion-safe; ≤2 substeps at the 0.1 s dt clamp). Only when there ARE solids → world mode with no
    // props stays on the exact single-step path below (byte-identical to today; collision code never runs there).
    const cfg = p.profile && p.profile.collide;
    const collideOn = cfg && world.collide && world.collideActive && world.collideActive();
    if (collideOn && Math.abs(s.speed) * dt > 0.3) {
      const h = dt * 0.5;
      model.step(s, _ax, h, world); world.collide(s, h, cfg);
      model.step(s, _ax, h, world); world.collide(s, h, cfg);
    } else {
      model.step(s, _ax, dt, world);
      if (collideOn) world.collide(s, dt, cfg);
    }
    p.setTransform(s);                                      // write the new transform onto the entity's mesh

    // Tick the seated look every PILOTING frame (smooth recenter when fpBlend=0, active head-turn when =1).
    pilotLook.update(dt);

    if (fpBlend >= 0.5) {
      // COCKPIT POV: place the eye inside the craft and aim it along heading + seated look offset.
      // `eye` is a LOCAL offset from the craft's centre (right/up/forward in the craft's frame).
      // Fallback to a safe centred position for profiles without an `eye` (e.g. ATV_PROFILE).
      const eye = (p.profile && p.profile.eye) || { x: 0, y: 0.3, z: 0 };
      const sinY = Math.sin(s.yaw), cosY = Math.cos(s.yaw);
      // Rotate the local eye offset by the craft's yaw (Y-axis rotation):
      //   worldX += localRight*cos(yaw) + localForward*sin(yaw)
      //   worldZ += -localRight*sin(yaw) + localForward*cos(yaw)
      _eyeWorld.set(
        s.x + eye.x * cosY + eye.z * sinY,
        s.y + eye.y,
        s.z - eye.x * sinY + eye.z * cosY,
      );
      // Look direction = craft heading rotated by the seated-look yaw+pitch offsets.
      // At combinedYaw=0 / lPitch=0 this gives (0,0,1) = straight forward along +Z. C++ anchor:
      // equivalent to composing a Y-rotation (combinedYaw) then an X-rotation (lPitch) on the +Z axis.
      const combinedYaw = s.yaw + pilotLook.yaw;   // heading + head-turn yaw offset
      const lPitch = pilotLook.pitch;               // head-tilt (positive = looking up)
      _eyeDir.set(
        Math.sin(combinedYaw) * Math.cos(lPitch),
        Math.sin(lPitch),
        Math.cos(combinedYaw) * Math.cos(lPitch),
      );
      rig.setEye(_eyeWorld, _eyeDir);
    } else {
      // H — camera lead: sweep azimuth slightly ahead of the turn so the scene opens up as you steer.
      // camLead (rad) × eased steer (signed) — subtle offset; the rig's own K-damp provides the sweep lag.
      const camLead = (p.profile && p.profile.camLead) || 0;
      rig.setAzimuth(s.yaw + Math.PI - camLead * _ax.steer);   // reactive chase: rig K-damps curr→goal = lag/swing
    }
  }

  /* setView('chase'|'cockpit'): toggle between the external chase cam and the first-person cockpit eye.
     Guards: no-op if no craft possessed (can't mount a cockpit eye with no craft). */
  function setView(view) {
    if (!craft) return;
    const next = (view === 'cockpit') ? 1 : 0;
    if (next === fpBlend) return;
    fpBlend = next;
    if (fpBlend < 0.5) {
      // RETURNING to chase — recenter head-turn, re-arm the spring-arm, snap chase azimuth behind the craft
      pilotLook.recenter();
      if (rig.clearEye) rig.clearEye();
      if (rig.setSpringArm) rig.setSpringArm({ segmentQuery: world.segmentHit, getGroundY: world.heightAt, radius: 0.25, enabled: true });
      if (craft) rig.setAzimuth(craft.pilot.getTransform().yaw + Math.PI, true);
      // L-cockpit: restore the hull, hide the canopy frame.
      if (craft.pilot.setBodyVisible) craft.pilot.setBodyVisible(true);
      if (craft.pilot.setCockpitVisible) craft.pilot.setCockpitVisible(false);
    } else {
      // ENTERING cockpit — disarm the spring-arm (it would clip the eye through the hull)
      if (rig.setSpringArm) rig.setSpringArm({ enabled: false });
      // L-cockpit: hide the hull so the eye doesn't see its own cabin shell; show the canopy frame.
      if (craft.pilot.setBodyVisible) craft.pilot.setBodyVisible(false);
      if (craft.pilot.setCockpitVisible) craft.pilot.setCockpitVisible(true);
    }
  }

  /* addLookDrag(dx, dy): feed pointer deltas into the cockpit head-turn (called by main.js from the
     right-drag / touch look-zone path that bypasses the piloting early-return). */
  function addLookDrag(dx, dy) { pilotLook.addDrag(dx, dy); }

  return {
    possess, release, step, setView, addLookDrag,
    // Gyro seam: expose the look controller so createGyroLook can call look.setTarget directly.
    get look() { return pilotLook; },
    get fpBlend() { return fpBlend; },
    get active() { return !!craft; },
    get piloting() { return phase === 'piloting'; },
    get state() { return phase; },
    get craft() { return craft; },
    get controlHints() { return craft ? craft.pilot.controlHints : ''; },
    get speed() { return craft ? craft.pilot.getTransform().speed : 0; },
    /* L77 telemetry — medium (AIR/WATER/GROUND), altitude above terrain, depth below the water surface. Drives the
       HUD + headless verification of the air→water→ground crossings. Falls back gracefully for the ATV (no medium). */
    get telemetry() {
      if (!craft) return null;
      const t = craft.pilot.getTransform();
      const ground = world && world.heightAt ? world.heightAt(t.x, t.z) : 0;
      const waterY = world && world.waterHeightAt ? world.waterHeightAt(t.x, t.z) : NO_WATER;
      return {
        medium: t.medium || null, speed: t.speed || 0, y: t.y,
        altitude: Math.max(0, t.y - ground),
        depth: waterY > NO_WATER ? Math.max(0, waterY - t.y) : 0,
        climb: t.vy || 0,
      };
    },
  };
}
