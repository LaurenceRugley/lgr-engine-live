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
  // ARC A-CAM+WALK Part A2 — the ATV had NO collide config at all (unlike CRAFT_PROFILE below), so
  // pilot.js's `const cfg = p.profile && p.profile.collide` gate was always false for it: an ATV drove
  // straight through every building, unbounded, on the world-mode terrain map (no buildings there to
  // notice) — invisible until this arc drove it through a CITY. Same shape as CRAFT_PROFILE's own
  // collide block, sized for a smaller, grounded vehicle (lower yOff — it rides ON the ground, not
  // hovering at cabin height; a touch smaller radius; slightly more slide friction for a "grippier"
  // ground feel). Confirmed by a real dispatched-throttle test: before this line, position crossed
  // straight through a building's full AABB (z: -6.5 -> +19.3, never slowed); after, the drive stops
  // at the wall (see HANDOFF.md Arc A-CAM+WALK for the measured before/after).
  collide: { r: 0.4, yOff: 0.3, PUSH_MAX: 10.0, SLIDE_FRICTION: 2.2, SKIN: 0.02 },
  boost: { speed: 1.5, accel: 1.25 },   // A-SPRINT: inert until a consumer sends axes.boost (see below)
};

/* ── BOOST — ONE AXIS, FIVE PHYSICAL MEANINGS (A-SPRINT, 2026-08-07) ──────────
   Owner's ask: "a sprint ability … for all of the walk, drive, helicopter, boat" — and the walker
   already had one (createFirstPersonWalker's `input.sprint`) while every PILOTED body had none. So
   the axis belongs in the seam all five bodies already share, not bolted onto each project.

   The interesting part is that "give it everything" is NOT one behaviour. Each medium spends the
   extra differently, and each spends it at a cost the model already knows how to charge:
     • road (car)  — higher top speed AND a wider corner, for free: R = v²/aLat is the model's own
                     law, so boost pushes you past the radius the street corridor allows. You must
                     lift off to make the turn. The header of createRoadModel already predicted this
                     teachable moment; boost is what makes a player meet it.
     • boat        — "full ahead". Rudder authority scales with way, so more speed = MORE bite.
     • spacecraft  — more thrust and a higher ceiling on the medium's own maxSpeed.
     • bird        — NOT a speed dial. A gull sprints by flapping HARDER (`flap`), and it still
                     cannot out-flap a dive: maxSpeed is untouched, so terminal velocity stays the
                     reward for trading height. Flapping buys climb, diving buys speed.
     • walker      — already `sprint`; the one-word vocabulary is unified below (see the alias).

   `boost` is ANALOG in [0,1] (a keyboard sends 0/1; a thumbstick pushed past its rim sends a ramp),
   so bk() lerps 1 → the profile's multiplier. A profile with no `boost` block, or a consumer that
   never sends the axis, gets exactly 1 — every existing tier stays byte-identical.
   C++ anchor: a per-term scale factor read from a const config struct, not a branch in the integrator. */
function bk(profile, axes, key) {
  const cfg = profile && profile.boost;
  if (!cfg || !axes) return 1;
  const m = cfg[key];
  if (m === undefined) return 1;
  return 1 + (m - 1) * clamp(axes.boost || 0, 0, 1);
}

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
    const maxS = profile.maxSpeed * bk(profile, axes, 'speed');   // A-SPRINT: 1× unless boost is held
    const speedFrac = clamp(Math.abs(state.speed) / maxS, 0, 1);
    const dirSign = state.speed >= 0 ? 1 : -1;
    state.yaw += axes.steer * profile.turnRate * (0.35 + 0.65 * speedFrac) * dirSign * dt;

    // 2) THROTTLE → SPEED (semi-implicit: velocity FIRST). Held throttle accelerates; released, the
    //    craft COASTS to a stop under friction (momentum is the whole feel). Reverse is capped slower.
    if (axes.throttle !== 0) {
      state.speed += axes.throttle * profile.accel * bk(profile, axes, 'accel') * dt;
    } else {
      const f = Math.min(Math.abs(state.speed), profile.drag * dt);   // friction can't overshoot zero
      state.speed -= Math.sign(state.speed) * f;
    }
    state.speed = clamp(state.speed, -maxS * 0.5, maxS);

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
  // A-SPRINT: more thrust and a higher ceiling on whatever medium you are in. `lift` is deliberately
  // NOT boosted — sprint is a translation verb; a helicopter that also climbs 60% faster on the same
  // key would make the vertical axis feel like it had lost its own throttle.
  boost: { speed: 1.6, accel: 1.35 },
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
/* PER-WORLD SPEED SCALE (2026-08-06, A-HELI). The table above is tuned for the ORIGINAL city/hoard
   world scale. metropolis's island is ~15 world units across, so air maxSpeed 8.0 crosses the whole
   map in under two seconds — measured on the first flight: 27.5 units travelled in 2 s, i.e. the
   craft left the city before you could look at it. This is the same class as the A-FEEL walker/car
   finding (numbers authored for one world scale, inherited by another).
   A profile may scale the speed-ish terms with `mediumScale` (default 1 => byte-identical for the
   city, hoard and showcase). drag/vDrag/buoyancy are RATES (1/s) and are deliberately NOT scaled —
   scaling them would change the FEEL (how quickly it settles), not the reach. */
const SCALED_KEYS = new Set(['maxSpeed']);
function mediumParams(profile) {
  const k = profile && Number.isFinite(profile.mediumScale) ? profile.mediumScale : 1;
  if (k === 1) return MEDIUM_PARAMS;
  const out = {};
  for (const [medium, set] of Object.entries(MEDIUM_PARAMS)) {
    out[medium] = {};
    for (const [key, v] of Object.entries(set)) out[medium][key] = SCALED_KEYS.has(key) ? v * k : v;
  }
  return out;
}
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
  const MP = mediumParams(profile);   // A-HELI: per-world speed scale (profile.mediumScale; 1 = the original table)
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
    const P = MP[medium], Pp = MP[(state.crossingT > 0 && state.crossFrom) ? state.crossFrom : medium], t = 1 - (state.crossingT || 0);
    const par = _par; for (const k of PARAM_KEYS) par[k] = lerp(Pp[k], P[k], t);   // L86 audit: fill the reused scratch (was `{}` per frame)

    // --- STEER → yaw ---
    // L110 (HOTFIX, Laurence's live phone test): the steer sense was REVERSED. `steer` is +1 for RIGHT input (main.js:334),
    // but the chase cam trails at azimuth = yaw+π (pilot.js), so +yaw swings the nose toward +X = screen-LEFT in that view —
    // i.e. pressing RIGHT turned the view LEFT. Empirically proven (a world point dead-ahead swept screen-RIGHT on +steer =
    // the left-turn sensation). NEGATE here (the shared seam → fixes ground AND air consistently; keys + stick both feed
    // `steer`, so they stay in agreement). Now RIGHT input turns the craft visibly RIGHT in the chase view.
    state.yaw -= axes.steer * par.turn * dt;

    // --- THROTTLE → forward speed along heading (semi-implicit: velocity first) ---
    if (axes.throttle !== 0) state.speed += axes.throttle * profile.accel * bk(profile, axes, 'accel') * dt;
    else state.speed -= Math.sign(state.speed) * Math.min(Math.abs(state.speed), par.drag * dt);
    const maxS = par.maxSpeed * bk(profile, axes, 'speed');   // A-SPRINT: the medium's own ceiling, lifted
    state.speed = clamp(state.speed, -maxS * 0.6, maxS);
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
      const speedFrac = clamp(Math.abs(state.speed) / maxS, 0, 1);   // maxS, not par.maxSpeed: under boost the
      const bMax = profile.bankMax || 0.4;                            // bank must stay proportional, not pin at full lean
      const targetBank = clamp(axes.steer * speedFrac * bMax, -bMax, bMax);
      state.bank = damp(state.bank, targetBank, 1 / (profile.bankTau || 0.14), dt);
      const pitch = clamp(-state.vy * 0.06, -0.3, 0.3);
      _e.set(pitch, state.yaw, state.bank, 'YXZ'); state.quat.setFromEuler(_e);
    }
    return state;
  }
  return { step };
}

/* ---- THE ROAD CAR (A-FEEL, 2026-08-05) — a car that can actually turn a corner on a street grid.
   WHY A THIRD MODEL rather than tuning ATV_PROFILE: createGroundModel is an ALL-TERRAIN model and its
   steering law says so — yaw authority GROWS with speed (`0.35 + 0.65 * speedFrac` above), which is
   backwards for a car. A real car's turn radius grows with v² (lateral grip is finite), so it corners
   TIGHTEST slowly and washes wide fast. On the city grid the old law gave a 3.46-unit radius against
   a 0.89-unit street corridor — 3.9× too wide to make a 90° turn, measured live. ATV_PROFILE is left
   untouched: placed-life.js is a second consumer (Rule 7), and a dune buggy SHOULD drive like one.

   THE LAW (one line, the whole model): R = max(turnRadiusMin, v²/latAccelMax); yaw += steer·(v/R)·dt.
   It self-caps — peak yaw is at v = √(R_lock·aLat) and the rate FALLS as aLat/v above that, so no
   separate cap is needed — and it kills the parked-pirouette for free (v→0 ⇒ ω→0). It also creates
   the teachable moment a driving game wants: past √(R_corridor·aLat) you must lift off to make the
   turn. Terrain-follow/orientation are deliberately SIMPLER than the ATV's slope basis: a road car
   sits flat on a road, so it damps to the ground height and banks into the corner instead.
   C++ anchor: same Strategy interface as the other two models — one `step`, swapped by key. */
export const ROAD_PROFILE = {
  maxSpeed: 2.4,          // ~2.6× the city's own traffic (agents.js runs 0.78-0.98 u/s)
  accel: 6.0,             // u/s² — ~0.4 s to top speed
  drag: 6.0,              // coast friction; momentum, never an instant stop
  turnRadiusMin: 0.70,    // LOW-SPEED lock radius (u) — 23% inside the 0.905u the street corridor allows a 0.18-radius car
  latAccelMax: 8.0,       // u/s² of grip — sets how fast the radius opens with speed
  chaseDist: 2.2, chaseElev: 0.35,
  bankMax: 0.10, bankTau: 0.14,
  rideHeight: 0.15,
  /* A-SPRINT: 2.4 → 3.72 u/s. This is the profile where boost is most than a number: the model's own
     law R = v²/aLat opens the turning circle to 1.73 u at full boost, and the city's street corridor
     only allows 0.905 u. So a boosted car PHYSICALLY cannot make a 90° turn — you have to lift off
     before the junction. Nothing enforces that; it falls out of the curvature law already here. */
  boost: { speed: 1.55, accel: 1.3 },
};
export function createRoadModel(profile = ROAD_PROFILE) {
  const _e = new THREE.Euler();
  function step(state, axes, dt, world) {
    const H = (world && world.heightAt) || (() => 0);
    // SELF-SEEDING: a model must not assume the caller pre-created fields only IT uses. createGroundModel
    // never touches `bank`, so a project's transform object (metropolis's carState) legitimately lacks it —
    // and damp(undefined, …) returns NaN, which propagates into the quaternion and poisons the whole
    // transform. Seed on first step instead of demanding every consumer know this model's internals.
    if (typeof state.bank !== 'number') state.bank = 0;
    const v = Math.abs(state.speed);
    const dirSign = state.speed >= 0 ? 1 : -1;

    // 1) STEER → HEADING, curvature-limited (the fix). Radius is the larger of the mechanical lock
    //    and what grip allows at this speed; ω = v/R follows directly.
    //    The ?? defaults are load-bearing, not decoration: a consumer that spreads ATV_PROFILE (which
    //    has neither field) would otherwise compute Math.max(undefined, NaN) → NaN yaw → NaN position,
    //    silently teleporting the craft out of the world. Hit exactly that on the first wiring.
    const rMin = profile.turnRadiusMin ?? ROAD_PROFILE.turnRadiusMin;
    const aLat = profile.latAccelMax ?? ROAD_PROFILE.latAccelMax;
    const R = Math.max(rMin, (v * v) / aLat);
    state.yaw += axes.steer * (v / R) * dirSign * dt;

    // 2) THROTTLE → SPEED — identical semantics to the ground model (coast on release, reverse capped).
    if (axes.throttle !== 0) state.speed += axes.throttle * profile.accel * bk(profile, axes, 'accel') * dt;
    else {
      const f = Math.min(Math.abs(state.speed), profile.drag * dt);
      state.speed -= Math.sign(state.speed) * f;
    }
    const maxS = profile.maxSpeed * bk(profile, axes, 'speed');   // A-SPRINT — and step 1 already charged for it
    state.speed = clamp(state.speed, -maxS * 0.5, maxS);

    // 3) POSITION along the heading (same +Z-nose convention as every other model).
    const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
    state.x += s * state.speed * dt;
    state.z += c * state.speed * dt;

    // 4) SIT ON THE ROAD — damp to ground height (a road car does not conform to slope normals).
    state.y = damp(state.y, H(state.x, state.z), 18, dt);

    // 5) BANK into the corner, proportional to actual lateral acceleration (v·ω), so it reads as
    //    weight transfer rather than a steering-input animation.
    const omega = axes.steer * (v / R) * dirSign;
    const bMax = profile.bankMax || 0.1;
    state.bank = damp(state.bank, clamp(-(v * omega) / aLat * bMax * 3, -bMax, bMax), 1 / (profile.bankTau || 0.14), dt);
    _e.set(0, state.yaw, state.bank, 'YXZ');
    state.quat.setFromEuler(_e);
    return state;
  }
  return { step };
}

/* ---- THE BOAT (A-BOAT, 2026-08-06) — the WATER medium as its own model.
   RECONCILE NOTE, so nobody repeats the mistake I nearly made: the plan was to LIFT createBoats from
   lgr-live-sky. Reading it first killed that — its own header says "This is the SCENERY half of the
   boat work; piloting one (dive-to-control, 3rd/1st person) is its own later arc". It is scenery,
   it depends on live-sky's creatures.js, and water-life.js's boats here are already BETTER (they
   carve real wakes into the wave sim). The thing neither repo had is this: a boat you can STEER.

   WHY NOT createRoadModel with different numbers: a hull has no grip. It carries huge inertia, it
   keeps turning after you centre the wheel, and — the characteristic bit — it only steers while
   water is moving past the rudder, so a stopped boat cannot turn at all. That last property is the
   whole feel, and it is the opposite of the road model's curvature law.

   It also RIDES THE SWELL: y damps toward world.waterHeightAt(x,z) (the sampler the spacecraft's
   medium probe already uses), so the pilot rises and falls with the sea the wave sim is running. */
export const BOAT_PROFILE = {
  maxSpeed: 1.6,          // u/s — deliberately slower than the road car (2.4); a boat is not a car
  accel: 0.9,             // slow to build way
  drag: 0.35,             // very low: a hull COASTS — this is the inertia that reads as displacement
  turnRate: 0.85,         // rad/s at full way — a wide, ponderous arc
  steerMinWay: 0.12,      // u/s below which the rudder does nothing (no water past it)
  rideDamp: 3.0,          // how quickly the hull settles onto the swell (1/s)
  chaseDist: 2.4, chaseElev: 0.30,
  bankMax: 0.09, bankTau: 0.5,   // slow, heavy roll into a turn
  /* A-SPRINT "full ahead" — 1.6 → 2.32 u/s, and the accel multiplier matters more than the top speed
     here because the hull is so slow to build way (0.9 u/s²).
     I first wrote here that a boosted boat also STEERS better "for free". A test refuted it: the
     rudder-authority ramp normalised against maxSpeed, so raising maxSpeed raised the DENOMINATOR and
     made authority WORSE at any given speed. Rudder force follows absolute way past the blade, not a
     fraction of whatever ceiling the throttle is set to — so the ramp is now pinned to the UNBOOSTED
     ceiling (see step 2). Unboosted maths is untouched; boosted way now genuinely bites harder. */
  boost: { speed: 1.45, accel: 1.7 },
};
export function createBoatModel(profile = BOAT_PROFILE) {
  const _e = new THREE.Euler();
  function step(state, axes, dt, world) {
    if (typeof state.bank !== 'number') state.bank = 0;
    /* A-SPRINT — TWO ceilings, and the distinction is the whole correction (see the profile note):
         hullMax  — the boosted top speed. Governs the CLAMP only: how fast full ahead can push her.
         rateMax  — the UNBOOSTED design speed. Governs anything that reads as "how hard is the water
                    working": rudder authority and heel. Those follow absolute way past the hull, so
                    normalising them against a raised ceiling would make a faster boat steer and heel
                    LESS — which is what my first version did, and what the test caught. */
    const rateMax = profile.maxSpeed ?? BOAT_PROFILE.maxSpeed;
    const hullMax = rateMax * bk(profile, axes, 'speed');

    // 1) THROTTLE → WAY. Low drag = long coast; this is the entire "heavy hull" read.
    if (axes.throttle !== 0) state.speed += axes.throttle * (profile.accel ?? BOAT_PROFILE.accel) * bk(profile, axes, 'accel') * dt;
    else {
      const f = Math.min(Math.abs(state.speed), (profile.drag ?? BOAT_PROFILE.drag) * dt);
      state.speed -= Math.sign(state.speed) * f;
    }
    state.speed = clamp(state.speed, -hullMax * 0.4, hullMax);   // astern is slow

    // 2) RUDDER — authority is proportional to WAY, and ZERO below steerMinWay. Dead in the water =
    //    no steering, which is the property that makes a boat feel like a boat.
    const v = Math.abs(state.speed);
    const minWay = profile.steerMinWay ?? BOAT_PROFILE.steerMinWay;
    if (v > minWay) {
      const authority = Math.min(1, (v - minWay) / (rateMax - minWay));   // rateMax: absolute way, not % of throttle setting
      state.yaw += axes.steer * (profile.turnRate ?? BOAT_PROFILE.turnRate) * authority * Math.sign(state.speed) * dt;
    }

    // 3) POSITION along the heading (+Z nose at yaw 0 — the house convention), CONSTRAINED TO WATER.
    //    Without this a boat sails straight up the beach and into the city — found by sailing it and
    //    looking (the hull ended up parked between two towers). The shoreline test is the water
    //    sampler itself: a candidate position with no water under it is land. Classic wall-slide —
    //    try the full step, then X-only, then Z-only — so running along a coast GLIDES instead of
    //    dead-stopping, and only a head-on grounding actually stops you.
    const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
    const dx = s * state.speed * dt, dz = c * state.speed * dt;
    const wet = (x, z) => !world || !world.waterHeightAt || world.waterHeightAt(x, z) > NO_WATER;
    if (wet(state.x + dx, state.z + dz)) { state.x += dx; state.z += dz; }
    else if (wet(state.x + dx, state.z)) { state.x += dx; state.speed *= 0.985; }
    else if (wet(state.x, state.z + dz)) { state.z += dz; state.speed *= 0.985; }
    else state.speed *= 0.55;   // hard aground — the way comes off fast

    // 4) RIDE THE SWELL — damp onto the live water height (NOT a hard set: a hard set would transmit
    //    every sim ripple as a jolt). Falls back to y=0 where a consumer supplies no sampler.
    const wy = world && world.waterHeightAt ? world.waterHeightAt(state.x, state.z) : NO_WATER;
    state.y = damp(state.y, wy > NO_WATER ? wy : 0, profile.rideDamp ?? BOAT_PROFILE.rideDamp, dt);

    // 5) HEEL into the turn — slow and heavy (bankTau 0.5 vs the car's 0.14).
    const bMax = profile.bankMax ?? BOAT_PROFILE.bankMax;
    const target = clamp(-axes.steer * (v / rateMax) * bMax, -bMax, bMax);   // heel follows absolute way too — and
    // yes, this means a hard turn at full ahead PINS the heel at bankMax. That is correct: a boat driven flat out
    // into a hard turn does lay over on her ear. The clamp was always there; boost just makes you reach it.
    state.bank = damp(state.bank, target, 1 / (profile.bankTau ?? BOAT_PROFILE.bankTau), dt);
    _e.set(0, state.yaw, state.bank, 'YXZ');
    state.quat.setFromEuler(_e);
    return state;
  }
  return { step };
}

/* ---- THE BIRD (A-BIRD, 2026-08-06) — flight as an ENERGY TRADE, not a hover.
   The spacecraft already flies, so why a second air model: the craft HOVERS — release the stick and
   it holds station. A bird cannot. It is always falling forward, and its whole character is the
   exchange the spacecraft has no notion of:
     DIVE  -> gravity converts height into airspeed (you speed up)
     CLIMB -> airspeed converts back into height (you slow down, and stall if you ask too much)
   Below stallSpeed the wing stops flying and the nose drops on its own until speed returns. Turning
   is BANKED, not yawed: steer rolls the body, and the yaw rate comes from the roll angle — so a
   hard turn costs you altitude exactly the way it does for a real wing.
   POV NOTE: consumers should fly this in COCKPIT view (controller.setView('cockpit')). The engine's
   gulls are THREE.Sprite billboards — a chase camera behind one watches it swivel to face the
   camera, which reads as broken. First person is both the correct view for flight and the one that
   sidesteps that entirely. */
export const BIRD_PROFILE = {
  cruiseSpeed: 1.5,       // u/s the wing settles at in level flight
  maxSpeed: 3.0,          // terminal-ish, in a full dive
  stallSpeed: 0.55,       // below this the wing stops flying and the nose drops
  /* flap — throttle-up thrust (u/s²), i.e. wingbeats.
     CORRECTED 2026-08-07 (owner: "I don't have a way to flap and fly up. I just have a way to fly
     down"). He was right, and the arithmetic says exactly why: a full climb costs sin(pitchMax)·
     gravityTrade = sin(0.55)·2.6 = 1.359 u/s², plus glideDrag 0.28 = 1.639 u/s² of drain. The old
     flap of 1.1 was BELOW that, so W+Space netted −0.54 u/s² — you always bled to stallSpeed and the
     nose dropped. Measured before the fix: 2 s of W+Space gained +0.173 u and ended STALLING.
     2.2 clears the 1.639 drain with +0.56 u/s² to spare: flapping now sustains a climb, and stopping
     immediately resumes the glide/trade that is the whole point of the model. maxSpeed is NOT boosted
     anywhere — you cannot out-flap a dive, so terminal speed stays the reward for spending height. */
  flap: 2.2,
  glideDrag: 0.28,        // very low: a gull glides for a long time
  gravityTrade: 2.6,      // how strongly pitch converts height <-> speed (the whole feel)
  pitchRate: 0.9,         // rad/s of nose authority
  pitchMax: 0.55,         // rad — climb/dive limit
  bankRate: 1.8,          // rad/s of roll authority
  bankMax: 0.85,          // rad — a steep wingover
  turnFromBank: 1.5,      // yaw rate per radian of bank (the banked-turn coupling)
  chaseDist: 1.6, chaseElev: 0.22,
  eye: { x: 0, y: 0.04, z: 0.06 },   // just behind the beak
  /* A-SPRINT for a BIRD is not a speed dial — it is flapping harder. Only `flap` scales (2.2 → 3.96),
     which nets +2.32 u/s² even in a full climb: the hard climb-out a startled gull actually does.
     No `speed` key on purpose (see the flap note above): the dive stays the only way to reach terminal. */
  boost: { flap: 1.8 },
};
export function createBirdModel(profile = BIRD_PROFILE) {
  const _e = new THREE.Euler();
  const P = (k) => (profile[k] !== undefined ? profile[k] : BIRD_PROFILE[k]);
  function step(state, axes, dt, world) {
    if (typeof state.bank !== 'number') state.bank = 0;
    if (typeof state.pitch !== 'number') state.pitch = 0;
    if (state.speed === 0) state.speed = P('cruiseSpeed');   // launched already flying — a bird never starts from rest mid-air

    // 1) PITCH from the lift axis (Space/Shift, or a stick's Y) — damped toward the commanded angle.
    const wantPitch = clamp((axes.lift || 0) * P('pitchMax'), -P('pitchMax'), P('pitchMax'));
    state.pitch = damp(state.pitch, wantPitch, 1 / 0.25, dt);

    // 2) BANK from steer, and the TURN comes from the bank (not from steer directly).
    const wantBank = clamp(-axes.steer * P('bankMax'), -P('bankMax'), P('bankMax'));
    state.bank = damp(state.bank, wantBank, P('bankRate'), dt);
    state.yaw += -state.bank * P('turnFromBank') * dt;

    // 3) THE ENERGY TRADE — the model's reason to exist. Nose down converts height to speed; nose up
    //    spends speed to climb. Plus wingbeat thrust and a low glide drag.
    state.speed += -Math.sin(state.pitch) * P('gravityTrade') * dt;
    if ((axes.throttle || 0) > 0) state.speed += axes.throttle * P('flap') * bk(profile, axes, 'flap') * dt;
    state.speed -= P('glideDrag') * dt;
    state.speed = clamp(state.speed, 0.05, P('maxSpeed'));

    // 4) STALL — too slow and the wing quits: the nose drops until speed comes back. Not an error
    //    state, just the physics reasserting itself.
    let effPitch = state.pitch;
    if (state.speed < P('stallSpeed')) {
      const deficit = 1 - state.speed / P('stallSpeed');
      effPitch = state.pitch - deficit * 0.7;          // forced nose-down
      state.pitch = damp(state.pitch, -0.4, 1 / 0.4, dt);
      state.stalling = true;
    } else state.stalling = false;

    // 5) MOVE along the heading + the vertical component of the flight path.
    const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
    const horiz = state.speed * Math.cos(effPitch);
    state.x += s * horiz * dt;
    state.z += c * horiz * dt;
    state.y += Math.sin(effPitch) * state.speed * dt;

    // 6) FLOOR — do not fly through the ground or the sea. Skim, do not tunnel.
    const gy = world && world.heightAt ? world.heightAt(state.x, state.z) : 0;
    const wy = world && world.waterHeightAt ? world.waterHeightAt(state.x, state.z) : NO_WATER;
    const floor = Math.max(gy, wy > NO_WATER ? wy : gy) + (profile.skim !== undefined ? profile.skim : 0.06);
    if (state.y < floor) { state.y = floor; if (state.pitch < 0) state.pitch = 0; }

    _e.set(effPitch, state.yaw, state.bank, 'YXZ');
    state.quat.setFromEuler(_e);
    return state;
  }
  return { step };
}

/* ---- THE FISH (A-FISH, 2026-08-07) — the sixth body, and the first one that does not FALL.
   ---------------------------------------------------------------------------------------------
   WHY NOT ONE OF THE FIVE MODELS WE ALREADY HAVE. This was interrogated rather than assumed, because
   "same integrator, new numbers" is a fair criticism and the spacecraft ALREADY carries a water medium
   (MEDIUM_PARAMS.water: drag 4.6, buoyancy 1.1). Three properties kill every reuse:

     • NEUTRAL BUOYANCY. The bird is always falling — that IS the bird. The boat is pinned to a surface.
       The spacecraft's water row applies +1.1 buoyancy, so releasing the stick FLOATS you up: it models
       a submarine that wants to surface, not an animal that holds its depth. A fish at rest simply
       stays where it is, at any depth, and that costs it nothing.
     • IT TURNS BY BENDING, NOT BY MOVING. Every other model gates yaw on speed — the car's ω = v/R, the
       boat's dead-in-the-water rudder, the bird's banked turn. A fish pivots almost in place, so its
       turn rate has NO speed term at all. That single missing multiplication is most of the feel.
     • IT DOES NOT COAST. The boat's whole character is inertia (drag 0.35, a hull coasts forever); the
       fish is the opposite. Drag here is PROPORTIONAL to speed, not a constant subtraction, so it has a
       natural terminal velocity and stops in about 1/drag seconds — roughly a body length, like a fish.

   AND THE PAYOFF: the surface is a CEILING you can break. Above the waterline there is no thrust (a fish
   cannot swim in air), no buoyancy, and no steering — just gravity and the momentum you left with. The
   breach is genuinely ballistic, the nose follows the arc because the velocity vector rotates, and you
   re-enter nose-first. Nothing scripts that; it falls out of running two force mixes either side of one
   surface. C++ anchor: one integrator with a branch on a boolean the world answers, not two classes.

   PREREQUISITE, and it is not optional: this needs somewhere to swim. Before A-FISH, metropolis's pilot
   floor at sea was the BEACH CAP (0.12) — above the y=0 waterline — so the sea had negative depth and a
   descending craft "landed" on it. citygen's `seabed` option and its shared seabedY() supply the real
   water column; without one, this model has a two-centimetre pond. */
export const FISH_PROFILE = {
  maxSpeed: 2.6,          // u/s in a full burst
  accel: 3.4,             // tail-beat thrust
  drag: 2.4,              // PROPORTIONAL (1/s): coasts ~0.4 s. The boat's 0.35 is a SUBTRACTION — different animal, literally
  turnRate: 1.9,          // rad/s, with NO speed gate — the signature property
  pitchRate: 5.0,         // 1/s damp toward the commanded pitch — a fish reorients almost instantly
  pitchMax: 1.15,         // ~66°: steep enough to drive straight up at the surface and breach
  gravity: 5.2,           // AIRBORNE only — what makes a breach an arc instead of a hop
  airDrag: 0.3,           // proportional, and nearly nothing: you keep your speed through the air
  floorSkim: 0.1,         // how far off the seabed the body rides
  bankMax: 0.5, bankTau: 0.22,   // fish roll hard into a turn — it is most of what makes them read as alive
  /* The largest breacher is 0.40 u nose-to-tail. The rig's default dolly floor is 4.0 u — ten body
     lengths — so without chaseMin the "fish" would be a speck and this whole body would be pointless
     to look at. chaseMin is the opt-in that makes chaseDist mean anything (camera-rig.setDistanceClamp). */
  chaseDist: 1.3, chaseElev: 0.16, chaseMin: 0.7,
  eye: { x: 0, y: 0.03, z: 0.05 },
  /* A-SPRINT: the burst. A fish's sprint is a genuine multiple of cruise, not a 20% nudge — this is the
     one body where boost is the difference between a patrol and a hunt. */
  boost: { speed: 1.7, accel: 1.9 },
};
export function createFishModel(profile = FISH_PROFILE) {
  const _e = new THREE.Euler();
  const P = (k) => (profile[k] !== undefined ? profile[k] : FISH_PROFILE[k]);
  function step(state, axes, dt, world) {
    if (typeof state.bank !== 'number') state.bank = 0;
    if (typeof state.pitch !== 'number') state.pitch = 0;
    if (typeof state.vy !== 'number') state.vy = 0;

    const waterAt = (x, z) => (world && world.waterHeightAt ? world.waterHeightAt(x, z) : NO_WATER);
    const wy = waterAt(state.x, state.z);
    const wet = wy > NO_WATER;
    const submerged = wet && state.y < wy;
    const maxS = P('maxSpeed') * bk(profile, axes, 'speed');

    if (submerged) {
      /* ── UNDER ──────────────────────────────────────────────────────────────────────────────
         On the frame we RE-ENTER, recompose the ballistic velocity back into the model's
         speed+pitch representation, so a breach lands with the momentum it left with instead of
         resetting. Without this the fish would hit the water and forget it had been moving. */
      if (state.airborne) {
        const h = Math.abs(state.speed);
        state.speed = Math.hypot(h, state.vy);
        state.pitch = Math.atan2(state.vy, Math.max(1e-4, h));
        state.airborne = false;
      }
      // TURN — no speed term anywhere in this line. That absence is the fish.
      state.yaw += axes.steer * P('turnRate') * dt;
      // PITCH — near-total authority, fast. Point it and it points.
      const wantPitch = clamp((axes.lift || 0) * P('pitchMax'), -P('pitchMax'), P('pitchMax'));
      state.pitch = damp(state.pitch, wantPitch, P('pitchRate'), dt);
      // THRUST + PROPORTIONAL drag (v' = -k·v): exponential decay, a real terminal speed, no coasting.
      if ((axes.throttle || 0) !== 0) state.speed += axes.throttle * P('accel') * bk(profile, axes, 'accel') * dt;
      state.speed -= state.speed * P('drag') * dt;
      state.speed = clamp(state.speed, -maxS * 0.4, maxS);
      // NO buoyancy term, deliberately: neutral. Depth is held for free — see the header.
    } else {
      /* ── OVER — the breach. No thrust, no steering, no buoyancy: you are a projectile now. ──── */
      if (!state.airborne) {                       // the frame we LEAVE the water: decompose once
        state.vy = state.speed * Math.sin(state.pitch);
        state.speed = state.speed * Math.cos(state.pitch);   // `speed` now means HORIZONTAL speed
        state.airborne = true;
      }
      state.vy -= P('gravity') * dt;
      state.speed -= state.speed * P('airDrag') * dt;
      state.y += state.vy * dt;
      // The nose follows the velocity vector — which is exactly what a breaching fish looks like.
      state.pitch = Math.atan2(state.vy, Math.max(1e-4, Math.abs(state.speed)));
    }

    /* MOVE in the horizontal plane, CONSTRAINED TO WATER — the boat's wall-slide, for the same reason
       and with a sharper one: a fish that swims onto the beach is stranded with no way to move (it has
       no thrust out of water), i.e. a soft-lock. Sliding along the shore instead of stopping dead also
       means hugging the coast feels like hugging a coast. */
    const horiz = state.airborne ? state.speed : state.speed * Math.cos(state.pitch);
    const dx = Math.sin(state.yaw) * horiz * dt, dz = Math.cos(state.yaw) * horiz * dt;
    const swimmable = (x, z) => waterAt(x, z) > NO_WATER;
    if (swimmable(state.x + dx, state.z + dz)) { state.x += dx; state.z += dz; }
    else if (swimmable(state.x + dx, state.z)) { state.x += dx; state.speed *= 0.985; }
    else if (swimmable(state.x, state.z + dz)) { state.z += dz; state.speed *= 0.985; }
    else state.speed *= 0.5;                       // nosed into the shore

    if (submerged) state.y += Math.sin(state.pitch) * state.speed * dt;

    /* THE SEABED — you cannot swim through the floor. Uses the same world.heightAt every other model
       uses, which in metropolis is now citygen's real seabed rather than a constant above the waterline. */
    const gy = world && world.heightAt ? world.heightAt(state.x, state.z) : 0;
    const floor = gy + P('floorSkim');
    if (state.y < floor) { state.y = floor; if (state.pitch < 0) state.pitch = 0; if (state.vy < 0) state.vy = 0; }

    /* ROLL into the turn. Fish bank HARD — much harder than the boat heels — and it is the single
       strongest "this is alive, not a vehicle" cue the body has. Only while submerged: mid-breach the
       body should hold whatever attitude it launched with, not keep steering. */
    const bMax = P('bankMax');
    const target = submerged ? clamp(-axes.steer * bMax, -bMax, bMax) : state.bank * 0.9;
    state.bank = damp(state.bank, target, 1 / P('bankTau'), dt);

    _e.set(state.pitch, state.yaw, state.bank, 'YXZ');
    state.quat.setFromEuler(_e);
    state.submerged = submerged;                   // published for the project's HUD / camera treatment
    return state;
  }
  return { step };
}

/* ---- carryMomentum(from, to, opts) — A-CROSSING (2026-08-07): hand one body's motion to another.
   ---------------------------------------------------------------------------------------------
   The ability behind "the gull hits the water and becomes the fish". Deliberately a PURE FUNCTION over
   two transforms rather than a new controller method, and that shape was argued into place:

   I first specced a `handoff(next)` on the controller that would release + possess in one call and skip
   the ENTERING phase. Three independent reviews killed it, and the decisive point is that it solves a
   problem that does not exist — possess() ALREADY self-releases (see its `if (craft) release()`), and
   nothing in it assumes the incoming body is at rest. A second possession path would have duplicated
   the state machine to change nothing, while quietly desynchronising every consumer's own mode/HUD
   bookkeeping, which only the consumer can keep straight.

   So the split is: the ENGINE owns "what motion means when you change bodies"; the PROJECT owns when
   it happens and what its UI says about it. This function is the first half.

   WHY THE LATCH RESETS ARE THE LOAD-BEARING PART, not the position copy. Each model keeps medium state
   that is meaningless — or actively wrong — in the next body:
     • `airborne`  the fish's ballistic latch. Inherited true, the fish would arrive under water in
                   projectile mode: no thrust, no steering, and its own re-entry branch would then
                   overwrite the pitch you just copied. This is the exact "entry paths do not guard
                   what exit paths clear" class this repo has logged.
     • `medium` / `crossing` / `crossFrom` / `crossingT`  the spacecraft's Schmitt-trigger bookkeeping;
                   a stale crossing keeps easing force parameters toward a medium you already left.
     • `vy`, `bank`, `stalling`  vertical velocity and attitude that belonged to the old wing/hull.
   Speed is scaled, not copied raw: it is the same quantity in both models (units along the heading),
   but water is not air, so `speedScale` is how much of a stoop survives the surface.
   C++ anchor: a converting assignment between two state structs that share a coordinate convention —
   the fields that mean the same thing carry, the regime flags are explicitly reset, never memcpy'd. */
export function carryMomentum(from, to, { speedScale = 1, y = null, pitch = null } = {}) {
  if (!from || !from.pilot || !to || !to.pilot) return false;
  const a = from.pilot.getTransform(), b = to.pilot.getTransform();
  if (!a || !b) return false;
  b.x = a.x; b.z = a.z;
  b.yaw = a.yaw;                                   // all six models share the +Z-nose convention
  b.speed = Math.abs(a.speed || 0) * speedScale;
  b.pitch = pitch !== null ? pitch : (a.pitch || 0);
  if (y !== null) b.y = y;
  // regime latches — reset explicitly, never inherited (see the note above)
  b.vy = 0; b.bank = 0; b.airborne = false; b.stalling = false;
  b.medium = undefined; b.crossing = undefined; b.crossFrom = undefined; b.crossingT = 0;
  /* A-SWING: the grapple's velocity VECTOR and its rope are latches too, and the nastiest kind —
     its model adopts the shared scalar speed only when `vx` is still undefined, so a leftover vx from
     a previous swing would silently skip that adoption and hand you the OLD arc's velocity instead of
     the speed you actually arrived with. Clearing them here is what makes drive→swing inherit your
     momentum and swing→walk forget it. */
  b.vx = undefined; b.vz = undefined; b.anchor = null; b.rope = 0;
  return true;
}

/* ---- THE GRAPPLE (A-SWING, 2026-08-08) — the seventh body, and the first one whose motion is not
   "speed along a heading".
   ---------------------------------------------------------------------------------------------
   WHY IT CANNOT REUSE A MODEL WE HAVE. Every model above integrates a SCALAR `speed` down a yaw
   heading; even the bird, which climbs and dives, is really speed + pitch + yaw. A pendulum is not
   expressible that way: on a rope the velocity direction is set by the CONSTRAINT (always tangent to
   the sphere around the anchor), and it changes continuously without the player steering. So this
   model carries a real velocity VECTOR on state (vx/vy/vz) and derives the visible yaw/bank FROM it,
   which is the exact inverse of every other model here. Same `step(state, axes, dt, world)` contract,
   opposite internals — which is the point of having a contract.

   THE RESEARCH IT IMPLEMENTS. Spider-Man 2 (2004, Jamie Fristrom) is still the reference because of
   one decision: the web attaches to REAL GEOMETRY. It casts rays from the character and wherever they
   intersect the world becomes the anchor — as opposed to firing into empty sky and animating a fake
   arc, which is what the games before it (and several after) did. We can do the real version cheaply
   because `world.segmentHit` already exists for the camera spring-arm, and its own comment in
   collide.js anticipated exactly this reuse: "a future line-of-sight test reuses it".

   WHY THIS CITY SUITS IT. Swinging dies if buildings are short or far apart — the arc bottoms out in
   the street. Measured before building: blocks are 1.9u with 0.55u streets (PITCH 2.45) and downtown
   towers reach hMax 4.6-5.2, a height:pitch ratio around 2.1. That is Manhattan-midtown proportion and
   plenty of canyon. It DOES fall off at the city edge where the downtown gradient drops the towers,
   so "no anchor in range" is a first-class state here, not an error — you fall, with air control, and
   can re-fire the moment something comes into reach.

   FEEL OVER PHYSICS, deliberately. A pure pendulum feels bad, which is the other half of what the
   post-mortems say. Three assists, all of them named constants below rather than hidden fudge:
   `aimCone` (the anchor search forgives sloppy aim), `pump` (shortening the rope on the downswing adds
   energy — this is what makes a swing accelerate instead of decaying to a dead hang), and `release`
   preserving momentum so letting go converts the arc into a launch.

   C++ anchor: the constraint solve is one Gram-Schmidt projection — remove the component of v along
   the rope, keep the tangential part. `v -= n * dot(v, n)`. */
export const GRAPPLE_PROFILE = {
  gravity: 5.4,           // u/s² — heavier than the bird's trade; a swing should feel weighty
  /* ropeMax is set by ARITHMETIC, not taste. Anchors in this city land around y=3.5 and the street
     sits near 0.3, so a 3.2u rope put the bottom of every arc exactly at pavement level — you swung
     once, grounded out, and the rope was cut (measured: attached on 3 of 18 samples). 2.2 leaves the
     arc bottoming out around y=1.3, clear of the street, which is what lets a swing CONTINUE instead
     of becoming a series of landings. A taller city profile can raise this. */
  ropeMax: 2.2,           // u — longest web you can fire
  ropeMin: 0.55,          // u — how far in you can reel before it reads as a collision
  aimCone: 0.62,          // rad — half-angle of the anchor search fan (the aim assist)
  aimRays: 7,             // how many rays in the fan; odd so one is dead ahead
  aimLift: 0.42,          // rad — the fan is biased UP by this: you swing from above, not from a wall
  pump: 1.5,              // u/s of rope shortening while the lift axis is held (the energy input)
  airControl: 2.1,        // u/s² of lateral nudge while attached (steering the arc)
  freeControl: 3.4,       // u/s² of control while NOT attached (more, since you have nothing else)
  airDrag: 0.06,          // per-second velocity bleed; low, so momentum carries between swings
  maxSpeed: 7.5,          // u/s hard cap so a long pump chain cannot go to orbit
  climbRate: 1.15,        // u/s up a wall while clinging (Space up, C down)
  clingReach: 0.24,       // u — how close a facade has to be to stick to it
  skim: 0.06,             // clearance above ground/water/ROOFTOP, same idiom as the bird
  chaseDist: 1.9, chaseElev: 0.35,
  eye: { x: 0, y: 0.06, z: 0.04 },
  /* A-SPRINT for a swinger is a harder pull: reel faster and steer harder. Not a speed multiplier —
     top speed stays the reward for a well-timed release, exactly like the bird's dive. */
  boost: { pump: 1.9, airControl: 1.5 },
};
export function createGrappleModel(profile = GRAPPLE_PROFILE) {
  const _e = new THREE.Euler();
  const P = (k) => (profile[k] !== undefined ? profile[k] : GRAPPLE_PROFILE[k]);

  /* Fire a fan of rays and keep the nearest real hit. `segmentHit` returns the blocking fraction
     t∈[0,1] (1 = clear), so an anchor exists iff some ray comes back < 1. The fan is biased upward:
     an anchor BELOW you is a wall to smack into, not something to swing from. */
  function findAnchor(state, world) {
    if (!world || !world.segmentHit) return null;
    const rays = P('aimRays'), cone = P('aimCone'), len = P('ropeMax');
    let best = null;
    for (let i = 0; i < rays; i++) {
      const frac = rays === 1 ? 0 : (i / (rays - 1)) * 2 - 1;      // -1..1 across the fan
      const yaw = state.yaw + frac * cone;
      const el = P('aimLift') + Math.abs(frac) * 0.18;             // edges of the fan aim slightly higher
      const dx = Math.sin(yaw) * Math.cos(el), dz = Math.cos(yaw) * Math.cos(el), dy = Math.sin(el);
      const ex = state.x + dx * len, ey = state.y + dy * len, ez = state.z + dz * len;
      const t = world.segmentHit(state.x, state.y, state.z, ex, ey, ez, 0.05);
      if (t >= 1) continue;                                        // clear sky down this ray
      const d = t * len;
      if (d < P('ropeMin')) continue;                              // too close to swing from
      if (!best || d < best.d) best = { d, x: state.x + dx * d, y: state.y + dy * d, z: state.z + dz * d };
    }
    return best;
  }

  function step(state, axes, dt, world) {
    /* Adopt the shared fields into a real vector ONCE. Coming from another body we inherit a scalar
       speed + yaw, so convert it — that is what makes walk→swing keep your momentum instead of
       dropping you. carryMomentum() resets vy for every other model; we re-derive the rest here. */
    if (typeof state.vx !== 'number') {
      const s0 = state.speed || 0;
      state.vx = Math.sin(state.yaw) * s0; state.vz = Math.cos(state.yaw) * s0; state.vy = 0;
      state.anchor = null; state.rope = 0;
    }

    const boost = clamp(axes.boost || 0, 0, 1);
    const fire = (axes.throttle || 0) > 0;

    // 1) ATTACH / RELEASE. Holding throttle keeps the line; letting go cuts it, and whatever velocity
    //    the arc has built is simply kept — the release IS the launch, no special case.
    if (fire && !state.anchor) {
      const a = findAnchor(state, world);
      if (a) {
        state.anchor = { x: a.x, y: a.y, z: a.z };
        state.rope = Math.max(P('ropeMin'), a.d);
      }
    } else if (!fire && state.anchor) {
      state.anchor = null;
    }

    /* 2) WALL CLING (A-CLIMB). Before gravity, because clinging is the absence of falling. A short
       ray along the facing direction asks "is there a facade within arm's reach"; if so you stick,
       and the lift axis becomes a climb instead of a pump. Only while NOT roped — a rope already
       owns your vertical, and letting both run at once produced a jitter where the constraint and
       the climb fought for the same axis. Costs one segmentHit per frame, and only when free. */
    const fx = Math.sin(state.yaw), fz = Math.cos(state.yaw);
    let clinging = false;
    if (!state.anchor && world && world.segmentHit) {
      /* CLING IS OPT-IN, and that is a correction, not a preference. Sticking automatically on wall
         contact shipped a swinger that could not swing: it spawns in a canyon, touched a facade on
         the first fall, and froze there at speed 0 — measured on the deployed build. Most of this
         city is within arm's reach of a wall, so "near a wall" cannot be the trigger. Holding the
         lift axis is the ask; let go and you fall past the facade like anything else. */
      const wants = (axes.lift || 0) !== 0;
      if (wants) {
        const reach = P('clingReach');
        const t = world.segmentHit(state.x, state.y, state.z, state.x + fx * reach, state.y, state.z + fz * reach, 0.05);
        clinging = t < 1;
      }
    }
    state.clinging = clinging;

    // 3) FORCES. Gravity always — except while stuck to a wall, which is the whole point of sticking.
    if (!clinging) state.vy -= P('gravity') * dt;
    else {
      /* Hold position against the facade and climb under the lift axis. Zeroing the horizontal
         velocity is what makes it read as ADHESION rather than a very slow slide. */
      state.vx *= 0.12; state.vz *= 0.12;
      state.vy = (axes.lift || 0) * P('climbRate');
    }
    const ctl = (state.anchor ? P('airControl') * (1 + (P('boost').airControl - 1) * boost) : P('freeControl'));
    if (axes.steer) {
      // lateral nudge, perpendicular to travel — steers the arc without adding raw speed
      const sp = Math.hypot(state.vx, state.vz) || 1;
      const px = state.vz / sp, pz = -state.vx / sp;
      state.vx += px * -axes.steer * ctl * dt;
      state.vz += pz * -axes.steer * ctl * dt;
    }

    // 3) PUMP — the whole reason a swing accelerates instead of decaying. Reeling in on the downswing
    //    does work on the pendulum; letting rope out lengthens the arc. Mirrors how a child pumps a
    //    swing by standing up at the bottom.
    if (state.anchor && axes.lift) {
      const rate = P('pump') * (1 + (P('boost').pump - 1) * boost);
      state.rope = clamp(state.rope - axes.lift * rate * dt, P('ropeMin'), P('ropeMax'));
    }

    // 4) INTEGRATE, then satisfy the rope CONSTRAINT. Position first, then pull back onto the sphere
    //    and strip the radial velocity — that projection is the rope going taut, and it is the only
    //    place the arc actually comes from.
    state.x += state.vx * dt; state.y += state.vy * dt; state.z += state.vz * dt;
    if (state.anchor) {
      const ax = state.x - state.anchor.x, ay = state.y - state.anchor.y, az = state.z - state.anchor.z;
      const dist = Math.hypot(ax, ay, az) || 1e-6;
      if (dist > state.rope) {
        const nx = ax / dist, ny = ay / dist, nz = az / dist;
        state.x = state.anchor.x + nx * state.rope;
        state.y = state.anchor.y + ny * state.rope;
        state.z = state.anchor.z + nz * state.rope;
        const radial = state.vx * nx + state.vy * ny + state.vz * nz;
        if (radial > 0) { state.vx -= nx * radial; state.vy -= ny * radial; state.vz -= nz * radial; }
      }
    }

    // 5) DRAG + CAP. Low drag so momentum survives between swings; the cap stops a pump chain
    //    compounding into escape velocity.
    const bleed = Math.max(0, 1 - P('airDrag') * dt);
    state.vx *= bleed; state.vy *= bleed; state.vz *= bleed;
    const sp = Math.hypot(state.vx, state.vy, state.vz);
    if (sp > P('maxSpeed')) { const k = P('maxSpeed') / sp; state.vx *= k; state.vy *= k; state.vz *= k; }

    // 6) FLOOR — land, do not tunnel. Hitting the deck kills the line and the downward component;
    //    horizontal momentum survives so you skid out of a bad swing rather than stopping dead.
    const gy = world && world.heightAt ? world.heightAt(state.x, state.z) : 0;
    const wy = world && world.waterHeightAt ? world.waterHeightAt(state.x, state.z) : NO_WATER;
    /* A-ROOF: the floor is whichever is highest — terrain, water, or a BUILDING TOP under you.
       Without the third term a swinger fell straight through every roof in the city to the street,
       which made "land on that tower" impossible and is why perching needed a collider query rather
       than a new model. yMax is the feet plus a small step tolerance, so you land ON a roof you are
       descending onto but never snap UP onto one you are swinging past. */
    /* ROOFS CATCH YOU ONLY WHEN YOU ARE FREE. While roped you are HANGING, and a hang that clips
       every rooftop it passes over is not a swing — measured, the arc died on 18 of 20 samples at
       y 4.35-5.12, landing on the towers it was swinging above rather than grounding out. Gating on
       !anchor is the whole fix: swing over the skyline, release, and the same query lands you on it. */
    const roof = (!state.anchor && world && world.surfaceAt) ? world.surfaceAt(state.x, state.z, state.y + 0.12) : -Infinity;
    let floor = Math.max(gy, wy > NO_WATER ? wy : gy);
    if (roof > floor) floor = roof;
    floor += P('skim');
    if (state.y < floor) {
      state.y = floor;
      if (state.vy < 0) state.vy = 0;
      state.anchor = null;
      state.vx *= 0.86; state.vz *= 0.86;
      state.perched = roof > gy + 0.05;   // standing on a building, not the street — HUD/probe signal
    } else state.perched = false;

    // 7) ORIENTATION DERIVED FROM MOTION — the inverse of every other model. You face where the arc
    //    is throwing you, and bank into the turn, because that is what reads as a swing.
    const horiz = Math.hypot(state.vx, state.vz);
    if (horiz > 0.05) state.yaw = Math.atan2(state.vx, state.vz);
    state.speed = Math.hypot(state.vx, state.vy, state.vz);     // keep the shared field meaningful (HUD/chase cam)
    const wantPitch = clamp(Math.atan2(state.vy, Math.max(horiz, 0.05)), -0.9, 0.9);
    state.pitch = damp(typeof state.pitch === 'number' ? state.pitch : 0, wantPitch, 1 / 0.18, dt);
    const wantBank = clamp(-(axes.steer || 0) * 0.7 + (state.anchor ? 0.25 : 0), -0.9, 0.9);
    state.bank = damp(typeof state.bank === 'number' ? state.bank : 0, wantBank, 2.2, dt);
    state.airborne = !state.anchor && !clinging && state.y > floor + 0.02;

    _e.set(state.pitch, state.yaw, state.bank, 'YXZ');
    state.quat.setFromEuler(_e);
    return state;
  }
  return { step };
}

/* the model registry the controller dispatches on (a PilotProfile names its model by key). Adding a
   craft type = one entry here + its model factory + a PilotProfile on the entity. */
const MODEL_FACTORIES = { ground: createGroundModel, spacecraft: createSpacecraftModel, road: createRoadModel, boat: createBoatModel, bird: createBirdModel, fish: createFishModel, grapple: createGrappleModel };

const ENTER_TIME = 0.55;                 // seconds the ENTERING camera-move runs (input ignored) — "the move is the onboarding"
const ZERO_AXES = { throttle: 0, steer: 0, lift: 0, boost: 0 };

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
  let _ax = { throttle: 0, steer: 0, lift: 0, boost: 0 };
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
    // TAKING CAMERA OWNERSHIP MEANS CLEARING WHAT OWNED IT BEFORE. If the project was driving a
    // first-person eye (a walker feeding rig.setEye every frame), fpActive is still true — and
    // camera-rig.update() early-branches on it (camera-rig.js:320), skipping BOTH the orbit block and
    // the chase spring-arm we arm just below. Result: the craft drives away and the camera sits frozen
    // at the walker's last eye. Every exit path in the tree clears the eye (pilot release, city
    // stopWalking, hoard/hoard2 dive-exit) but NO entry path guarded it, so walk→drive latched in any
    // project that offers both. Clearing here fixes it once for every current and future pilotable.
    // (Cockpit POV re-establishes the eye itself each frame in step() below — this never fights it.)
    if (rig.clearEye) rig.clearEye();
    // CAMERA MOVE (not a cut): follow the craft's live position + ease the chase dolly; SNAP the orbit
    // azimuth behind the heading so the swing-in takes the short way, then let the rig ease the rest.
    /* A-FISH: a body smaller than the rig's 4.0 dolly floor must be allowed closer, or `chaseDist` is
       decorative (it silently was, for every craft — see camera-rig.setDistanceClamp). Applied BEFORE
       setFollow, since setFollow clamps `frame` on the spot. Only profiles that declare `chaseMin`
       touch it, so every existing craft frames exactly as before. */
    if (rig.setDistanceClamp && p.profile.chaseMin !== undefined) rig.setDistanceClamp(p.profile.chaseMin);
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
    /* ORDER MATTERS, and it is not obvious (A-CROSSING, 2026-08-07): clearEye() re-seeds the orbit
       from where the eye actually is, and to do that it needs the object still being FOLLOWED. This
       used to run after clearFollow(), so the re-seed found followFn already null, bailed, and the
       camera resumed from a snapshot frozen since the moment cockpit view began. Clearing the eye
       first is what makes leaving a cockpit continuous instead of a cut — found by measuring the
       crossing three times and being wrong twice about the cause. */
    if (rig.clearEye) rig.clearEye();
    rig.clearFollow();
    if (rig.setSpringArm) rig.setSpringArm(null);   // L108: disarm the spring-arm → the free/attract camera is byte-identical again
    /* A-FISH: hand the dolly clamp back. Entry paths that take ownership must have an exit path that
       returns it — this repo has a logged failure class of exactly the opposite (latched modes). */
    if (rig.setDistanceClamp) rig.setDistanceClamp();
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
    /* A-SPRINT: boost is NOT eased with steer/lift. Those are damped because a snapped control surface
       reads as twitchy; boost is a gearbox, and a gearbox that fades in over 0.15 s feels broken. It
       passes through raw (already analog from the stick, 0/1 from a key). */
    _ax.boost = ax.boost || 0;

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
