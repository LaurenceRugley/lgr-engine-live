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
  /* ---- A-SOLID (2026-08-09): THE ROAD CAR HAD NO COLLIDER AT ALL, and it is the SAME omission the
     ATV note above records — the identical bug, in the identical shape, one profile down. pilot.js
     gates the whole push-out on `p.profile && p.profile.collide`, ROAD_PROFILE never declared one, so
     `collideOn` was false for every road car ever piloted and the hook was dead code for it.
     FOUND BY DRIVING IT, not by reading: the owner's report was about the SWING, but he said "I
     shouldn't be MOVING through buildings" generally, so the car and the walker were driven at real
     facades too. The walker stops dead (8/8 facades, 0/1440 frames inside — it has its own collider).
     The car, placed 1.2 u from a facade and given throttle, drove 10.8-12.5 u THROUGH the building and
     out the far side on 6 of 6 headings, 222/1800 frames inside the geometry at the probe's full 0.4 u.
     WHY 0.18 AND NOT THE ATV'S 0.4: this profile's own turnRadiusMin note already sizes the car it is
     for — "a 0.18-radius car" in "the 0.905 u the street corridor allows". A 0.4 sphere is wider than
     half the corridor, so an ATV-sized collider would grind both kerbs down every street in the city.
     yOff mirrors `rideHeight` so the sphere sits at the body's centre rather than under the axles. */
  collide: { r: 0.18, yOff: 0.15, PUSH_MAX: 8.0, SLIDE_FRICTION: 2.2, SKIN: 0.02 },
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

/* ---- THE DIRTBIKE (A-MOTO, 2026-08-18) — a ground vehicle that can LEAVE the ground.
   WHY A NEW MODEL rather than tuning ATV_PROFILE — the reconcile, written down (the fish-precedent
   rule): createGroundModel's terrain-follow is `state.y = damp(state.y, groundY, 18, dt)` — it has
   no vertical velocity state AT ALL, so it structurally cannot leave the ground: at any crest it
   glues to the downslope. Airtime — the entire subject of this arc — is unreachable by parameter,
   which is the same argument shape as createRoadModel's "the steering law says so" and
   createBoatModel's "a hull has no grip". ATV_PROFILE itself is left untouched: placed-life.js is a
   second consumer (Rule 7), and a dune buggy that hugs the terrain SHOULD keep hugging it.

   WHAT IS REUSED, term for term, because it was right: the ATV's speed-scaled steer authority
   (`0.35 + 0.65·speedFrac` — mushy parked, bites at speed: correct for a bike too), the
   semi-implicit throttle/coast order, the central-difference slope basis, and the +Z-nose heading
   convention every model in this file shares.

   WHAT IS NEW, and each is the point:
   1. TWO PHASES with a decompose/recompose seam — the FISH's own architecture ("one integrator
      with a branch on a boolean the world answers, not two classes"), with the ground for the
      water. Grounded: y follows the heightfield and `vy` TRACKS the slope's vertical rate. The
      LAUNCH TEST each frame: where would ballistics put me (`y + (vy − g·dt)·dt`) vs where the
      ground is. If the ground falls away below the ballistic path, you are AIRBORNE — which makes
      crest launches emerge from the terrain's own curvature (v²·A·k² > g, the arithmetic moto.js
      derives the level from) with no scripted "jump" anywhere.
   2. AIR PITCH CONTROL — the half the fish deliberately lacks (a breaching fish is a projectile;
      a rider is not). `axes.lift` is the lean axis: lean back (S, lift −1) pitches the nose UP and
      over — hold it and that is the backflip; lean forward pushes the nose down. Yaw and steering
      are FROZEN in the air (whips/spins are phase-2 scoring vocabulary, stated not smuggled).
   3. A LANDING VERDICT — the fish re-enters water, and water does not care about attitude; dirt
      does. At touchdown the bike's pitch is compared to the slope's own pitch along the heading,
      WRAPPED to (−π, π] — so a full 2π backflip that comes round lands CLEAN, which is the one
      arithmetic detail the whole trick system hangs on. Clean keeps speed; a botch scrubs speed
      proportionally down to `keepMin` — phase-1 forgiving BY DESIGN: no wreck state, no ragdoll,
      the worst landing is a slow exit (a crash animation is a later, separate ability).
   C++ anchor: a two-state integrator with an explicit state transition test, not a physics engine —
   the MM2 read ("crazy enough to be fun, real enough to look right") is a real parabola + full
   authorial control of the three constants that matter (g, pitch rate, scrub). */
export const BIKE_PROFILE = {
  maxSpeed: 7.5,          // u/s — faster than the ATV (6.0); speed is what a dirtbike is FOR
  accel: 8.0,             // u/s² — ~1.5 s to the launch-speed band
  brake: 12.0,            // u/s² — S is a BRAKE first (a bike stops much harder than it accelerates)
  reverseMax: 1.2,        // u/s — paddle-walk reverse, not a gear
  drag: 3.0,              // coast friction (u/s²) — a bike coasts further than the ATV's 5.0
  turnRate: 2.6,          // rad/s at speed (the ATV's law, slightly quicker — it is lighter)
  gravity: 5.4,           // u/s² — the GRAPPLE/character constant, so a moto world and a walker world agree
  airPitchRate: 3.6,      // rad/s of air rotation authority — 2π in 1.75 s: the backflip budget
  /* A-WHIP (2026-08-19, phase 3): the second air axis. 2π in 1.90 s — a full 360 fits the derived
     ramp's ~2.14 s of air, and (deliberately) so does a flip AND a 360 held TOGETHER: pitch and yaw
     are separate hands (arrows vs A/D), so the combo the scorer already pays is finally DRIVABLE.
     Slightly under airPitchRate because the whip is the easier rotation (no gravity asymmetry). */
  airYawRate: 3.3,        // rad/s of air yaw (whip/spin) authority — 0 restores the frozen-yaw phase-1 air
  airDrag: 0.12,          // proportional (1/s) — you keep ~90% of speed through a 1 s flight (hang-time feel)
  launchMinSpeed: 0.3,    // u/s below which the launch test is off (a parked bike nudged at a lip stays a parked bike)
  cleanAngle: 0.5,        // rad of pitch-vs-slope mismatch that still lands clean (~29° — forgiving)
  /* A-WHIP: the yaw half of the verdict — the SAME 29° forgiveness cone as pitch (one philosophy,
     two axes; inside it the cross-wheel momentum component is ≤ sin(0.5) ≈ 0.48 of speed, which the
     knobby-tyre phase-1 forgiveness absorbs). The SCRUB normalisation is π/2, NOT π (a stated
     asymmetry, not a drift): yawErr wraps to [0, π] where π = landing BACKWARDS, and a bike fully
     crossed-up (90°) has already lost its rolling direction entirely — so the floor arrives at π/2
     and everything past it IS the floor. "Scrubbed, never wrecked" stays phase-1's contract; a real
     crash state is phase-4 vocabulary (the ledger's open question, on the record). */
  cleanYawAngle: 0.5,     // rad of yaw-vs-heading mismatch that still lands square (~29°)
  scrub: 0.75, keepMin: 0.30,   // a botched landing scrubs toward keepMin·speed, never a wreck (phase 1)
  landPitchTau: 10,       // 1/s — how fast the chassis re-seats onto the slope after touchdown
  bankMax: 0.42, bankTau: 0.16, // bikes LEAN — most of the cornering read
  steerAttack: 0.14, steerRelease: 0.2, liftAttack: 0.1, expo: 0.5,   // input envelope (pilot controller)
  chaseDist: 2.8, chaseElev: 0.3, chaseMin: 1.0, camLead: 0.14,
  eye: { x: 0, y: 0.62, z: 0.06 },
  collide: { r: 0.35, yOff: 0.25, PUSH_MAX: 12.0, SLIDE_FRICTION: 2.0, SKIN: 0.02 },
  boost: { speed: 1.2, accel: 1.2 },
};
export function createBikeModel(profile = BIKE_PROFILE) {
  const _up = new THREE.Vector3(), _fwd = new THREE.Vector3(), _right = new THREE.Vector3();
  const _fwd2 = new THREE.Vector3(), _m = new THREE.Matrix4(), _e = new THREE.Euler(), _qLean = new THREE.Quaternion();
  const _upS = new THREE.Vector3();               // scratch for the damped surface normal (the STATE carries it)
  const EPS = 0.45;                               // central-difference offset — the ATV's own constant
  const P = (k) => (profile[k] !== undefined ? profile[k] : BIKE_PROFILE[k]);
  const wrapPi = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a <= -Math.PI) a += 2 * Math.PI; return a; };

  function step(state, axes, dt, world) {
    const H = (world && world.heightAt) || (() => 0);
    // SELF-SEEDING (the road model's rule): a consumer's transform object owes this model nothing.
    if (typeof state.vy !== 'number') state.vy = 0;
    if (typeof state.pitch !== 'number') state.pitch = 0;
    if (typeof state.bank !== 'number') state.bank = 0;
    if (typeof state.airborne !== 'boolean') { state.airborne = false; state.y = H(state.x, state.z); }
    if (typeof state.airtime !== 'number') { state.airtime = 0; state.airTotal = 0; state.jumps = 0; }
    if (typeof state.upY !== 'number') { state.upX = 0; state.upY = 1; state.upZ = 0; }   // the damped chassis normal — STATE, so two bikes never share one model's smoothing
    /* A-WHIP: `headYaw` is the TRAVEL heading — momentum's line, not the chassis'. On the ground the
       two are one number (wheels grip: you travel where you point). The air splits them: the launch
       edge freezes headYaw (a ballistic body cannot steer its momentum) and the whip rotates the
       BODY yaw underneath it. Landing re-unifies them the wheels' way — see the touchdown verdict. */
    if (typeof state.headYaw !== 'number') state.headYaw = state.yaw;
    if (!state.landing) state.landing = { err: 0, yawErr: 0, kept: 1, clean: true, count: 0 };
    const g = P('gravity');
    const maxS = P('maxSpeed') * bk(profile, axes, 'speed');
    const th = axes.throttle || 0;

    if (!state.airborne) {
      /* ── GROUNDED — the ATV's laws + the launch test ─────────────────────────────────────── */
      const speedFrac = clamp(Math.abs(state.speed) / maxS, 0, 1);
      const dirSign = state.speed >= 0 ? 1 : -1;
      /* SIGN — a Rule-6 conflict SURFACED, not averaged: this file already ships two yaw
         conventions (the spacecraft's `yaw -= steer` at its own line vs the ground/road models'
         `+=`), while every project wires the same key map (steer = D − A). Measured ground truth
         for a chase camera directly behind the body (a −5 z eye looking at the origin projects
         world +x to NDC −0.17, i.e. +x is screen-LEFT), plus the character's owner-verified
         convention (swing-ledger A-LOCK: "a right turn DECREASES atan2(vx,vz)"): D-turns-right
         requires yaw to DECREASE on positive steer. The bike therefore takes the SPACECRAFT's
         sign — the one craft whose chase feel is flown daily — and keeps the uniform D−A wiring. */
      state.yaw -= axes.steer * P('turnRate') * (0.35 + 0.65 * speedFrac) * dirSign * dt;
      state.headYaw = state.yaw;                  // A-WHIP: grounded, the wheels make one line of the two
      // throttle forward; S brakes hard to a stop, then paddle-reverses; released → coast (momentum)
      if (th > 0) state.speed += th * P('accel') * bk(profile, axes, 'accel') * dt;
      else if (th < 0) {
        if (state.speed > 0.02) state.speed = Math.max(0, state.speed + th * P('brake') * dt);
        else state.speed = Math.max(-P('reverseMax'), state.speed + th * P('accel') * 0.4 * dt);
      } else {
        const f = Math.min(Math.abs(state.speed), P('drag') * dt);
        state.speed -= Math.sign(state.speed) * f;
      }
      state.speed = clamp(state.speed, -P('reverseMax'), maxS);

      const s = Math.sin(state.yaw), c = Math.cos(state.yaw);
      state.x += s * state.speed * dt;
      state.z += c * state.speed * dt;
      const y0 = state.y;
      const g1 = H(state.x, state.z);
      const hL = H(state.x - EPS, state.z), hR = H(state.x + EPS, state.z);
      const hD = H(state.x, state.z - EPS), hU = H(state.x, state.z + EPS);

      /* THE LAUNCH TEST — accelerations, not positions, and the distinction cost a red test to
         learn (kept, because it is the whole design): a position test ("is the ground below the
         one-frame ballistic step?") compares two paths that BOTH drop quadratically, so its signal
         is ½·(v²Ak² − g)·dt² ≈ 1e-4 u/frame — two orders below any usable skin, and dt-dependent.
         The first-order statement is the physical one, and it is LITERALLY the inequality moto.js
         derives the terrain from: the wheel leaves the dirt when following the surface would demand
         more downward acceleration than gravity can supply (normal force < 0):
             required = d(vyGround)/dt < −g      with   vyGround = v · slope-along-heading
         vyGround is taken from the SAME ±EPS central differences the chassis basis uses — smoothed
         over ~a cell, so bilinear facet corners do not fire it — and `state.vy` carries last frame's
         value, which is the vertical velocity the body ACTUALLY has. The decompose at launch is the
         fish's: horizontal speed rides through; vy is inherited from the slope — a kicker's face
         hands you its own climb rate (v·tanθ, exactly flipRampSpec's vy₀), a crest hands ≈0 and the
         falling ground makes the air. A cliff lip is the same test at large magnitude: the forward
         EPS sample already sees the basin, vyGround plunges, `required` goes hugely negative. */
      const dhdx = (hR - hL) / (2 * EPS), dhdz = (hU - hD) / (2 * EPS);
      const vyG = state.speed * (s * dhdx + c * dhdz);
      const required = dt > 0 ? (vyG - state.vy) / dt : 0;
      if (dt > 0 && Math.abs(state.speed) > P('launchMinSpeed') && required < -g) {
        state.airborne = true;
        state.jumps++;
        state.airtime = 0;
        state.headYaw = state.yaw;                // A-WHIP: momentum's line is set at the lip; the whip rotates the body under it
        state.vy -= g * dt;                       // gravity owns vy from here (first ballistic step)
        /* FLOORED at the ground on the launch frame — the accel test can fire while the surface is
           still RISING (a convex kink mid-upslope), where the raw ballistic step lands ~1.6 mm
           INSIDE the field for one frame. The wheel is still touching at the instant of leaving;
           the no-sink contract (y ≥ heightAt, every frame) is the probe's containment analog and
           it caught exactly this. */
        state.y = Math.max(y0 + state.vy * dt, g1);
        // pitch continuity: you leave the lip AT the slope angle you left with; the air owns it now.
      } else {
        state.y = g1;
        state.vy = vyG;

        /* ORIENT TO SLOPE — the ATV's central-difference basis, with the normal DAMPED
           (landPitchTau) so a touchdown re-seats over ~0.1 s instead of snapping the chassis. */
        _up.set(hL - hR, 2 * EPS, hD - hU).normalize();
        state.upX = damp(state.upX, _up.x, P('landPitchTau'), dt);
        state.upY = damp(state.upY, _up.y, P('landPitchTau'), dt);
        state.upZ = damp(state.upZ, _up.z, P('landPitchTau'), dt);
        _upS.set(state.upX, state.upY, state.upZ).normalize();
        _fwd.set(s, 0, c);
        _right.crossVectors(_upS, _fwd).normalize();
        _fwd2.crossVectors(_right, _upS).normalize();
        _m.makeBasis(_right, _upS, _fwd2);
        state.quat.setFromRotationMatrix(_m);
        // LEAN into the corner (bikes bank; the ATV's basis alone only rolls on side-slopes)
        const lean = clamp(-(axes.steer || 0) * speedFrac * P('bankMax'), -P('bankMax'), P('bankMax'));
        state.bank = damp(state.bank, lean, 1 / P('bankTau'), dt);
        state.quat.premultiply(_qLean.setFromAxisAngle(_fwd2, state.bank));
        // the landing-test pitch: the slope's own pitch along the heading (+ = nose up)
        state.pitch = Math.asin(clamp(_fwd2.y, -1, 1));
      }
    } else {
      /* ── AIRBORNE — ballistics + the rider's lean ────────────────────────────────────────── */
      state.airtime += dt;
      state.airTotal += dt;
      state.vy -= g * dt;
      state.speed -= state.speed * P('airDrag') * dt;
      /* THE LEAN AXIS: lift −1 (lean BACK / S) pitches the nose UP and over — the backflip
         direction; lift +1 noses down. */
      state.pitch += -(axes.lift || 0) * P('airPitchRate') * dt;
      /* THE WHIP AXIS (A-WHIP, phase 3 — the seam tricks.js named): steer gains its AIR meaning.
         Same sign as the ground turn (D whips screen-right — the spacecraft convention, OPEN #34
         untouched), its own rate constant, and — the physics that makes it a WHIP rather than a
         turn — it rotates the BODY, not the momentum: position keeps integrating along headYaw
         (frozen at the lip), so the bike travels its launch line while the chassis spins under it.
         With steer 0 this whole branch is arithmetic-identical to the phase-1 frozen-yaw air
         (yaw === headYaw, sin/cos equal), which is the re-baseline claim made checkable. */
      state.yaw -= (axes.steer || 0) * P('airYawRate') * dt;
      const s = Math.sin(state.headYaw), c = Math.cos(state.headYaw);
      state.x += s * state.speed * dt;
      state.z += c * state.speed * dt;
      const yN = state.y + state.vy * dt;
      const g1 = H(state.x, state.z);
      if (yN <= g1) {
        /* ── TOUCHDOWN — the verdict. Slope pitch ALONG THE BODY'S OWN HEADING (state.yaw — the
           line the wheels roll on, which after a whip is NOT the travel line) from the full
           central-difference gradient (both axes — an early draft sampled only z and was wrong for
           every diagonal heading); the error is WRAPPED so a completed flip (2π) reads as 0 — land
           it round and it is a clean landing, which is the entire contract of the trick. */
        const sb = Math.sin(state.yaw), cb = Math.cos(state.yaw);
        const dhdx = (H(state.x + EPS, state.z) - H(state.x - EPS, state.z)) / (2 * EPS);
        const dhdz = (H(state.x, state.z + EPS) - H(state.x, state.z - EPS)) / (2 * EPS);
        const slopeAlong = sb * dhdx + cb * dhdz;
        const slopePitch = Math.atan(slopeAlong);              // rise per unit travelled; + = uphill = nose up
        const err = Math.abs(wrapPi(state.pitch - slopePitch));
        /* A-WHIP: the yaw term — pitch-only RETIRES here (the A-TRICKS seam, second item). Land
           SQUARE (wheels along the travel line) = clean; the wrap forgives a completed 360 exactly
           as it forgives a completed flip, and π (backwards) is the worst — not a wrapped-clean. */
        const yawErr = Math.abs(wrapPi(state.yaw - state.headYaw));
        const cleanP = err <= P('cleanAngle');
        const cleanY = yawErr <= P('cleanYawAngle');
        const keptP = cleanP ? 1 : Math.max(P('keepMin'), 1 - P('scrub') * (err - P('cleanAngle')) / (Math.PI - P('cleanAngle')));
        /* yaw scrub reaches the keepMin floor at π/2 (fully crossed) — see cleanYawAngle's note. */
        const keptY = cleanY ? 1 : Math.max(P('keepMin'), 1 - P('scrub') * (yawErr - P('cleanYawAngle')) / (Math.PI / 2 - P('cleanYawAngle')));
        const clean = cleanP && cleanY;
        const kept = Math.min(keptP, keptY);       // the WORST axis governs — one landing, one number
        state.speed *= kept;
        state.landing = { err, yawErr, kept, clean, count: state.landing.count + 1 };
        state.lastAir = state.airtime;
        state.airborne = false;
        state.y = g1;
        /* vy hands over as the slope's OWN rate — the launch continuity rule in reverse. Landing on
           a downslope with vy = 0 would make next frame's `required` read the whole slope rate as
           one frame of acceleration and phantom-relaunch the bike off every descent it lands on. */
        state.vy = state.speed * slopeAlong;
        state.pitch = wrapPi(state.pitch);         // unwind the flip count; the ground damp takes it from here
        state.headYaw = state.yaw;                 // A-WHIP: wheels grip — the body's line IS the travel line again
        /* seed the damped normal from the bike's ACTUAL air attitude, so the re-seat eases from
           where the body really is rather than snapping through level first. */
        _up.set(0, 1, 0).applyQuaternion(state.quat);
        state.upX = _up.x; state.upY = _up.y; state.upZ = _up.z;
      } else {
        state.y = yN;
      }
      /* attitude in the air: yaw + the rider's pitch (+pitch = nose up ⇒ euler.x = −pitch).
         A-WHIP: the bank now LAYS INTO the whip (same sign law as the ground carve, full
         expression — no speedFrac in the air) instead of easing to 0, so the whip READS as the
         bike laying over, not a flat lazy-susan spin. steer 0 → target 0 → the phase-1 ease-out,
         byte for byte. */
      const whipLean = clamp(-(axes.steer || 0) * P('bankMax'), -P('bankMax'), P('bankMax'));
      state.bank = damp(state.bank, whipLean, 1 / P('bankTau'), dt);
      _e.set(-state.pitch, state.yaw, state.bank, 'YXZ');
      state.quat.setFromEuler(_e);
    }
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

   ---- A-FLOW (2026-08-08): THE ASSIST *IS* THE MECHANIC, and that is the correction ----------------
   A-AIM made the player pick the anchor with a crosshair. Measured on the auto path with nothing but
   the button held, that build swung 0.6 times in 20 seconds, covered 1.16 u, and was STRANDED (never
   moved 1 u) from 5 of 12 starts. It was a grappling hook — precise, and not fun.

   The reference mechanic is the opposite of precise. In SM2 (2004) and the Insomniac games you HOLD A
   BUTTON and the GAME picks the anchor, forward and above, chosen to give a long forward arc. Fristrom's
   post-mortem is explicit that the fun came from the assists, not from the simulation. So five named
   assists now carry the feel, and each one exists because a measured failure demanded it:

     1. `findAnchor` SCORES FOR A LONG FORWARD ARC instead of taking the nearest hit. Nearest is exactly
        backwards: the nearest anchor is the SHORTEST rope, which is the TIGHTEST arc. A pendulum on a
        rope whose anchor sits horizontal distance h ahead of you carries you ~2h forward, so the search
        maximises h — as far ahead as the rope reaches, biased to where you are already going.
     2. `arcClear` REPLACES THE ropeMax ARITHMETIC. ropeMax was 2.2 because a 3.2 rope put the bottom of
        every arc at pavement level. That was a GLOBAL constant doing a PER-ANCHOR job: whether an arc
        grounds out depends on how high THAT anchor is. Rejecting candidates whose predicted arc bottom
        (anchorY − rope) would clip the street lets the rope grow to 3.2 and the arcs grow with it.
     3. `assist` — a forward tangential push that FADES OUT as you approach maxSpeed. This is the
        "never dead-hang" rule: stall under an anchor and it walks you forward again, but it can never
        do more than the cap, so top speed is still earned by a good release.
     4. `autoRelease` + `launchUp`/`launchFwd` — hold the button and the line CUTS ITSELF at the top of
        the forward arc, throwing you into free flight, and the next web is a new forward anchor. That
        loop is what "hold the button and fly" actually is; without it, holding the button is a hang.
     5. `zipAccel` — a WINCH along the line toward an anchor above you. This is the takeoff, and it is
        the fix for a bug that had nothing to do with aiming: a grounded swinger could not leave the
        street. Measured cause (not the one guessed) — `findAnchor` DOES find an anchor from the street
        at 9 of 9 spots, but the floor clamp below set `state.anchor = null` on the same frame it was
        made, and nothing pulled along the line anyway. Both halves are fixed: a line to something
        OVERHEAD now survives ground contact, and the winch reels you up it.

   C++ anchor: the constraint solve is one Gram-Schmidt projection — remove the component of v along
   the rope, keep the tangential part. `v -= n * dot(v, n)`. */
export const GRAPPLE_PROFILE = {
  gravity: 5.4,           // u/s² — heavier than the bird's trade; a swing should feel weighty
  /* ropeMax WAS 2.2 by arithmetic: anchors land near y=3.5 and the street near 0.3, so a 3.2 rope put
     the bottom of every arc at pavement level. A-FLOW moved that job to where it belongs — `arcClear`
     rejects the individual anchors whose arc would ground out, which is a per-anchor question a global
     constant could only answer by assuming the WORST anchor. With the per-anchor guard in place the
     rope can be long again, and rope length is the single biggest lever on travel-per-swing: a swing
     carries you roughly 2× the horizontal distance to its anchor. */
  ropeMax: 3.2,           // u — longest web you can fire
  ropeMin: 0.55,          // u — how far in you can reel before it reads as a collision
  /* A-AIM (2026-08-08) / A-FLOW (2026-08-08). 'point' = the PLAYER aims: the consumer resolves a world
     point under its own crosshair (aim.js resolveAimPoint) and hands it in as `axes.aimPoint`; this
     model only asks "can I reach that from HERE". 'auto' = the game picks, forward and above, scored
     for a long forward arc.
     THE DEFAULT IS 'auto', and that is a REVERSAL of A-AIM's default, made on the owner's call and on
     a measurement. Crosshair aiming is the grappling-hook feel (Just Cause, Sekiro); the reference
     mechanic here is a HELD BUTTON with the game choosing. 'point' is NOT deleted — it is the right
     answer for an aimed zip, for an NPC given a specific target, and for any consumer that wants
     precision — it just is not what "make it feel like swinging" means. ('fan' is accepted as the
     legacy alias for 'auto'; anything not 'point' takes the auto path.) */
  aimMode: 'auto',        // 'auto' (the game picks; 'fan' = legacy alias) | 'point' (player-aimed)
  aimCone: 1.35,          // rad — half-angle of the forward YAW sweep. Wide: this is an assist, not a test.
  aimRays: 9,             // yaw samples across the cone; odd so one is dead ahead
  /* The fan sweeps ELEVATION too, and that is the difference between finding a long arc and finding a
     wall. A single upward bias (the old `aimLift` 0.42) only ever looked along one slope, so the far,
     shallow anchors that make a wide arc were invisible to it — every hit came back short and steep.
     WHY IT REACHES ALL THE WAY TO 1.25 rad (72°): a ray's slope IS sin(el) — the hit is on the ray, so
     rise = d·sin(el) exactly, and rise/d cancels the distance out. That makes `zipSlopeMin` a filter on
     the ELEVATION LIST, not on the world: with slopes stopping at 0.66 (sin 0.61), a single ray was the
     only one that could ever produce a zip, and a body next to a climbable wall would report no line
     at all. The steep entries are the climbing lines. */
  aimEl: [0.10, 0.26, 0.44, 0.66, 0.95, 1.25],
  aimRadius: 0,           // u — thickness of an anchor-search ray. 0 = a line (see findAnchor's note)
  aimLift: 0.42,          // rad — retained for consumers pinned to the pre-A-FLOW single-slope fan
  minRise: 0.35,          // u — an anchor must be at least this far ABOVE you (never web the pavement)
  minAlign: -0.15,        // cos — how far off your direction of travel an anchor may sit and still count
  arcClear: 0.45,         // u — the predicted arc bottom must clear the ground by this (see ropeMax)
  /* THE NEVER-DEAD-HANG ASSIST. A forward tangential push while roped, scaled by how far BELOW maxSpeed
     you are, so it is a rescue at 1 u/s and nothing at all at the cap. Fixed thrust would make every
     swing identical; this makes a stall recoverable without making a good release worthless. */
  assist: 4.2,            // u/s² forward tangential help while roped, fading to 0 at maxSpeed
  autoRelease: true,      // hold the button and the line cuts itself at the top of the forward arc
  /* releasePitch, aimCone and the two launch constants were SWEPT against travel-per-swing on the real
     city geometry (40 starts inside the tall core, 8 s each, button held and nothing else). They trade
     along one axis: cut earlier and launch harder and each swing covers more ground, but it throws you
     further out of the core, where there is nothing to web and the run just ends.
     WITH `topOut` GUARANTEEING A RELEASE, a LATE releasePitch became strictly better rather than a
     trade — it stops meaning "hang until the arc earns 57°" and starts meaning "take the steep launch
     when the arc offers one, otherwise leave at the top". Measured: 0.62 → 2.1 webs per trial, 30 of
     40 starts stranded, 30% of frames on the pavement; 1.0 → 2.6 webs, 18 stranded, 8% grounded, with
     the same ground covered. These are LEVEL-FITTED, which is why they are named constants: a taller,
     wider city wants them pushed back up. */
  releasePitch: 1.0,      // rad — the launch angle a cut is timed to when the arc EARNS it (≈57°)
  /* THE TWO BACKSTOPS THAT MAKE `releasePitch` SAFE TO RAISE. A pitch target alone is a release the arc
     has to EARN, and a shallow arc never earns it: the velocity on a small-amplitude pendulum simply
     never tilts 49° up, so the line never cut and "hold the button" became a five-second hang again —
     the exact bug this arc exists to kill, wearing a new hat (measured: 69% of frames attached, 1.1
     webs per 8 s trial, and the roped path GROWING with releasePitch because the body was swinging
     back and forth rather than travelling). `topOut` releases at the far extreme of the arc, where vy
     falls back through zero — every pendulum reaches that, so a release is guaranteed. `maxHang` is the
     last word: no line outlives it, whatever the geometry does. */
  topOut: true,           // release at the far top of the arc even if releasePitch was never reached
  maxHang: 2.2,           // s — the longest any single web may last (the literal never-dead-hang rule)
  /* ---- A-LOCK: THE SAME BACKSTOP, SIZED FOR A ROPE THE PLAYER CUTS. ----------------------------
     `maxHang` 2.2 s was fitted to a scheme where `topOut` cut the line FIRST and this was only ever
     the safety net behind it. Take `topOut` away — which is exactly what the latched scheme does, so
     that "swing all the way up if you want" means something — and 2.2 s becomes the PRIMARY rule, and
     it is far too short to be one. The arithmetic says so rather than a feel report: a pendulum's
     period is 2π√(L/g), so at ropeMax 3.2 under gravity 5.4 a FULL swing takes 2π√(3.2/5.4) ≈ 4.84 s
     and a half-swing to the far top takes ≈2.4 s. A 2.2 s cap would fire before the arc ever reached
     the point the player is waiting to release at — the cut would feel random, and it would be
     random, because it would be a clock racing a pendulum it was never sized against.
     6.0 s is that full period plus margin: long enough for a full there-and-back plus a pump, short
     enough that a rope forgotten on a dead hang still ends. Recompute it if you move ropeMax or
     gravity — this number is derived from them, not chosen beside them. */
  maxHangLatched: 6.0,    // s — the cap when the PLAYER owns the release (axes.latched)
  launchUp: 0.7,          // u/s added UP on any release — the flick that turns an arc into a jump
  launchFwd: 0.5,         // u/s added FORWARD on any release
  /* ---- A-LOCK (2026-08-09): THE *PLAYER-COMMANDED* RELEASE IS A BIGGER LAUNCH THAN THE AUTOMATIC ONE,
     and the two are separate constants because they are separate verbs. `launchUp`/`launchFwd` above
     are the flick on an AUTOMATIC cut (`topOut`, `maxHang`, a zip arriving) — the game tidying up after
     an arc that ended on its own, where a large impulse would read as the game throwing you somewhere
     you did not ask to go. `releaseUp`/`releaseFwd` are what a SPACE PRESS buys, and the owner's ask is
     explicit about what that has to feel like: "you can swing low, you can swing all the way up if you
     want and jump off and get more air".
     WHY THIS IS AN IMPULSE AND NOT A MULTIPLIER. The arc already supplies the direction and most of the
     magnitude — releasing at the bottom is fast and flat, releasing on the way up is slower and steep —
     and scaling that would amplify the difference between a good and a bad release into a cliff. An
     additive up+forward kick keeps the arc's own shape and adds a constant, so the timing still decides
     WHERE you go and the press decides HOW FAR. The apex it buys is not the impulse squared over 2g but
     the CROSS term: at vy = 3 u/s a +1.8 u/s kick adds (4.8² − 3²)/2g = 1.30 u, i.e. ten jump-heights,
     which is the difference between "the rope ended" and "I launched".
     Both default to a value MEASURED against a bare cut (docs/design/swing-ledger.md, A-LOCK table);
     set them to `launchUp`/`launchFwd` to make the two releases identical again. */
  releaseUp: 1.8,         // u/s added UP when the PLAYER cuts the line (Space) — the "get air" verb
  releaseFwd: 1.2,        // u/s added FORWARD when the player cuts the line
  refireDelay: 0.10,      // s — the shortest gap between two webs (a cut must read as a cut)
  refireVy: 0.55,         // u/s — do not re-web while still climbing faster than this (let the launch fly)
  zipAccel: 15.0,         // u/s² pull ALONG the line toward an anchor above you — the takeoff winch
  /* THE WINCH IS GOVERNED ON CLIMB RATE, and the first version was governed on horizontal speed, which
     did not work for a reason worth keeping: the winch's own forward pull raised horizontal speed, so
     it throttled ITSELF off. Traced frame by frame — the line steepened correctly (slope 0.61 → 1.00)
     while `vy` never once exceeded 0.15 and the body never left the pavement. A winch's governor has to
     read the thing the winch is FOR. */
  zipClimb: 3.2,          // u/s — the climb rate the winch drives toward, and fades out at
  /* HOW STEEP A LINE HAS TO BE TO BE WORTH WINCHING, as a sine (rise ÷ rope). The winch can only lift
     you if its vertical component beats gravity: zipAccel × slope > gravity, i.e. slope > 5.4/15 = 0.36.
     0.45 keeps margin. Below it the winch does not lift, it DRAGS — measured, and it looked exactly
     like the stranding it was meant to cure: attached, 4.3 u covered, 83% of frames still on the
     pavement, peak height 0.64. A shallow line is not a way up; it is a leash. */
  zipSlopeMin: 0.45,
  /* ---- A-WALL (2026-08-09) — HOW FAR SHORT OF A FACADE A SWEPT MOVE STOPS (0 = pass through) ----
     This is the takeoff bug's real cause, and it was never in the anchor search at all. The swinger
     declares no `collide` config (like ROAD/BOAT/BIRD/FISH — only ATV and CRAFT do), and unlike those
     it enters by an UNCONTROLLED FALL into a canyon rather than under power in open sky or on a road,
     so nothing at all stopped it crossing a facade. The entry drop — spawn y 3.4 with
     speed 1.4 — carried it straight THROUGH a facade and it came to rest on the street INSIDE a tower.
     Measured on the real path at 8 camera headings: 6 of 8 entries ended inside a building, and the
     correlation with the stranding is total — INSIDE ⇒ 0/240 frames attached and 0.00 u moved, every
     time; the 2 that landed in open air took off on the SAME code (47/240 and 209/240 attached, peaks
     2.42 and 3.08, 3.48 u and 5.32 u travelled). From inside a solid every one of `findAnchor`'s 126
     rays comes back at d≈0, fails `d < ropeMin`, and the search returns null forever — so the zip
     tier, the winch and the ground-contact survival rule were all working and all unreachable.
     WHY A SWEPT STOP RATHER THAN THE `collide` PROFILE HOOK every other craft uses (pilot.js:1481).
     Three measured mismatches, not a preference: (1) that hook is a post-hoc DEPENETRATION — it lets
     the body get inside and then pushes it out, and "inside" is the exact state that kills the anchor
     search; (2) its slide-friction scrubs `state.speed`, which this model RECOMPUTES from vx/vy/vz
     every frame, so half the resolve is a no-op here; (3) its sphere radius would have to exceed
     `clingReach` (0.24) to behave like the car's, which would hold the body off every facade and make
     A-CLIMB unreachable. A ray-thin sweep stops you 0.02 u off the wall — still well inside cling range.
     0.02 u is the backoff, not a radius: the sweep is a zero-radius ray, so the body stops ON the
     facade plane and is nudged clear by this much, which is what stops the next frame's ray starting
     inside the box it is testing against. */
  wallStop: 0.02,
  /* ---- A-SOLID (2026-08-09) — IS A FACADE SOLID WHILE THE ROPE IS UP? ----------------------------
     THIS REVERSES A-WALL'S MEASURED TRADE, ON THE OWNER'S CALL. A-WALL gated the sweep on `!anchor`
     and priced the gate honestly: gated, net ground per swing 2.02 u; ungated, 1.53 u — a 24% worse
     swing to fix a fall-through "that only ever happened in FREE flight". The premise was wrong, and
     the bench that replaced it says so: driven straight at a facade WHILE ROPED from 8 headings, the
     gated build put the body inside the geometry on 6 of 8 and spent 7.7% of all roped frames
     enclosed. Swinging through a facade was never a free-flight-only bug; nothing had driven the
     roped case. The owner's ruling: "I shouldn't be swinging through buildings" — travel distance is
     not worth paying for with solidity, so the ability is now a NAMED OPTION rather than a hard gate.
     A consumer that wants the old pass-through (an NPC on rails, a cutscene) sets it false and says so.
     The trade it was supposed to cost did not materialise once the sweep was made 3D-honest — the
     numbers are at 4c, and travel went UP, not down. */
  wallWhileRoped: true,
  /* THE CURE HALF OF A-WALL (the sweep above is the PREVENTION half). A swept stop cannot help a body
     that is ALREADY inside — its own origin is enclosed, so every test comes back blocked and the
     clamp pins it where it stands. That state still happens, rarely and by a route the sweep is
     deliberately not on: while ROPED the rope owns your position (see 4c), and an arc can be carried
     down through a rooftop, which A-ROOF also ignores while roped. Measured on the 40-start bench:
     2 of 40 runs ENDED enclosed before this arc, i.e. 5% of runs died exactly the way the owner's
     street start died. 0 u/s disables the squeeze-out. */
  unstick: 4.0,           // u/s a body found INSIDE a solid is squeezed toward the nearest open air
  /* 2. THE PIVOT CHEAT — the simulation hangs from a point pushed OUT from the facade, while the
     visible web still lands on the building. Insomniac ship exactly this and say why: a pendulum hung
     from a point ON a wall settles UNDER that point, i.e. flush against the wall, so the arc grinds
     the building at the one moment it is fastest. That is not a theory here — it is the measured cause
     of the ledger's OPEN #6 ("peak speed down 15% since walls became solid… an arc hung off a vertical
     face grinds that face at its fastest moment"), and the ledger even names the lever it could not
     find: "score anchors for arcs with air beneath". This is the cheaper answer to the same problem —
     move the PIVOT, not the anchor, so the arc swings down the street instead of down the wall.
     Applied to SWING lines only. A ZIP is a line you climb, and offsetting a climb from its wall would
     leave you winching to a point in mid-air. 0 disables it (the pre-A-LAB behaviour, exactly).

     ---- AND IT SHIPS OFF (0), BECAUSE THE BENCH REFUSED IT. THIS IS THE HONEST RESULT, NOT THE ONE
     I EXPECTED. ----------------------------------------------------------------------------------
     Two independent 12-start benches in projects/swing-lab (`node tools/swing-lab-bench.mjs`), same
     starts, same seconds, button held: at 0.55 the swing STRANDED on 5 of 12 runs, spent 49.9% of
     frames on the pavement (control: 7.3%), covered 0.59 u per swing (control: 3.32 u) and 5.40 u of
     net ground (control: 12.23 u). The web count roughly doubled while each web went nowhere — the
     churn signature. That is a WORSE mechanic on every axis the lab measures, and the theory behind
     it is a good theory from a shipped AAA game.
     The reading I trust: Insomniac's version is one assist inside a stack that also includes a
     scored volume-based anchor search, a line-shortening lookahead and a swing floor derived from
     real collision. Ours picks its anchor by raycast fan and hangs a shorter rope; displacing that
     pivot spends amplitude the arc does not have to spare. It is kept, named, measured and OFF —
     which is strictly more useful than deleting it, because the next person to have this idea will
     find the number instead of re-running the experiment. Set it non-zero only with a bench to hand.
     (It also stays the right lever to REVISIT if the anchor search ever gets Insomniac's scoring —
     see the ledger's OPEN list.) */
  pivotOut: 0,            // u the SIM pivot is pushed away from the facade — OFF, refuted by bench
  /* 3. VELOCITY BLEND ON ATTACH — the anti-whiplash, and it is where a chain's momentum leaks. The
     rope constraint deletes the radial component of your velocity the first frame it goes taut
     (`v -= n·(v·n)`, correct physics for an inextensible rope). At an ATTACH that projection is a
     transient, not physics: you threw a web while flying away from the anchor, and the game answers
     by silently subtracting most of your speed. Insomniac blend the incoming velocity ROTATIONALLY
     toward the arc tangent over the solver's iterations instead. Same idea, one step: keep the
     tangential DIRECTION, restore the SPEED. 0 = pure strip (old behaviour), 1 = speed fully
     preserved. It can never exceed the speed you arrived with, so it is not a boost.
     VERDICT: NEUTRAL on the 12-start bench (within variance). It costs nothing measurable and is the
     right answer for the case it is FOR — attaching while already fast and moving away from the
     anchor — which a held-button auto-chain from a standing start barely produces. Unproven, kept. */
  attachBlend: 0.8,
  /* 4. THE SWING FLOOR — shorten the line rather than let the arc plough the street. `arcClear`
     already rejects anchors whose arc would bottom out, but it decides ONCE, at attach, from where
     you were standing; an arc that gains speed, or one taken over a rooftop that then runs out, can
     still descend into the ground. Both reference games shorten the line for exactly this: Fristrom's
     own write-up keeps a `desiredLength` the current length chases "so the avatar never scrapes the
     street", and Insomniac derive a "swing floor" from collision and scale the descent against it.
     Reeling in is also the physically honest response — it is the same work `pump` does, which is why
     it costs no energy to justify. u/s of shortening; 0 disables.
     VERDICT: NEUTRAL-to-slightly-positive on net ground (13.25 u vs 12.34 u without it, inside
     variance) and it shortens the mean swing, which is the trade it exists to make: a reeled-in arc
     covers less ground than one that would have ploughed the street, and a ploughed arc covers none.
     Kept as a correctness guard rather than on a performance claim. u/s of shortening; 0 disables. */
  floorAssist: 2.6,
  pump: 1.5,              // u/s of rope shortening while the lift axis is held (the energy input)
  airControl: 2.1,        // u/s² of lateral nudge while attached (steering the arc)
  freeControl: 3.4,       // u/s² of control while NOT attached (more, since you have nothing else)
  airDrag: 0.06,          // per-second velocity bleed; low, so momentum carries between swings
  /* ---- A-LAB (2026-08-09): FOUR ASSISTS FROM THE SHIPPED GAMES, each sourced, each a named knob —
     AND THE HEADLINE RESULT IS THAT THREE OF THEM MEASURE NEUTRAL AND THE FOURTH IS REFUTED. That is
     stated first because it is the finding, and because a reader skimming for "what made the swing
     good" should not mistake these for the answer.

     THE BENCH (12 street starts × 10 s, button held, identical starts per variant, trigger verified
     per run — `node tools/swing-lab-bench.mjs`), net ground covered:
        control, all four off ......... 13.09 u   3.36 u/swing   5.6% grounded   0/12 stranded
        + horizontal cap .............. 12.34 u   3.68 u/swing   5.8%            0/12
        + horiz cap + swing floor ..... 13.25 u   2.82 u/swing   8.3%            0/12
        + all three ................... 12.73 u   3.21 u/swing   5.2%            0/12
        + all three + pivot 0.55 ....... 9.51 u   0.58 u/swing   9.5%            0/12   (21.4 webs/run — churn)
     A ±7% spread on 12 samples is inside this bench's own run-to-run variance, so the honest reading
     is: the three below neither help nor hurt at this level's proportions, and `pivotOut` genuinely
     hurts. What DID move the mechanic was the LEVEL (see projects/swing-lab and the ledger's A-LAB
     table) and, embarrassingly, fixing the harness — three earlier benches had been measuring a
     dropped pointer lock rather than a swing.
     They are kept ON (except `pivotOut`) because each is sourced, none costs measured ground, and the
     swing floor is a correctness guard as much as a feel one. Each carries its measured verdict below
     so nobody has to take the ledger's word for it. ----

     1. THE CAP IS HORIZONTAL, NOT 3D. `maxSpeed` used to clamp hypot(vx,vy,vz), which throttles the
     DOWNSWING — the fastest, most earned part of an arc — for no reason but bookkeeping. Insomniac
     cap horizontal speed only and explicitly let 3D speed exceed it on the way down ("Concrete Jungle
     Gym", GDC 2019, Doug Sheahan: terminal velocity ~30 m/s on a 10-second rolling average, 3D speed
     unbounded by it). `maxVertSpeed` is the separate guard that keeps a pump chain out of orbit.
     VERDICT: INERT IN EVERY LEVEL MEASURED SO FAR, and that is why the bench reads it as neutral —
     peak speed in the lab is 6.28 u/s and in metropolis was 8.17 (pre-A-SOLID) / 6.97 (post), all
     BELOW the 9.0 cap, so neither the old rule nor the new one has ever actually fired. Kept because
     it is the correct semantics for the day a level is tall enough to reach it; labelled rather than
     claimed, because an untriggered code path is not a tested one. */
  maxSpeed: 9.0,          // u/s cap on the HORIZONTAL velocity (was the 3D magnitude — see above)
  maxVertSpeed: 14.0,     // u/s cap on |vy| — the dive is allowed to be faster than the cruise
  climbRate: 1.15,        // u/s up a wall while clinging (Space up, C down)
  clingReach: 0.24,       // u — how close a facade has to be to stick to it
  skim: 0.06,             // clearance above ground/water/ROOFTOP, same idiom as the bird
  chaseDist: 1.9, chaseElev: 0.35,
  /* A-AIM: let the chase camera drop BELOW the body. The rig's free-orbit elevation floor is +0.03 rad
     (camera-rig EL_MIN — authored so the inspection camera never sinks under the city), and an orbit
     camera looks AT its target, so a floor at "just above level" means the view can only ever point
     DOWNWARD. On a grapple that is fatal: the anchors worth taking are ABOVE you, and with the default
     clamp there is no camera angle from which the crosshair can reach one. -1.05 rad (-60°) lets the
     eye swing under you so the forward vector tilts up. Same shape as A-FISH's chaseMin: a clamp
     authored for the free camera is the wrong clamp for a piloted body, so the profile states its own
     and the controller restores the default on release. */
  chaseElevMin: -1.05,
  eye: { x: 0, y: 0.06, z: 0.04 },
  /* A-SPRINT for a swinger is a harder pull: reel faster and steer harder. Not a speed multiplier —
     top speed stays the reward for a well-timed release, exactly like the bird's dive. */
  boost: { pump: 1.9, airControl: 1.5 },
};
export function createGrappleModel(profile = GRAPPLE_PROFILE) {
  const _e = new THREE.Euler();
  const P = (k) => (profile[k] !== undefined ? profile[k] : GRAPPLE_PROFILE[k]);

  /* ---- THE AUTO-ANCHOR (A-FLOW) — the game picks, and it picks for a LONG FORWARD ARC ------------
     Fire a fan of rays over yaw × elevation and keep the best SCORING hit. `segmentHit` returns the
     blocking fraction t∈[0,1] (1 = clear), so an anchor exists iff some ray comes back < 1.

     THE SCORE IS PREDICTED TRAVEL, not distance. Hang from an anchor whose horizontal offset ahead of
     you is h and the arc carries you to roughly h on the far side — about 2h of ground per swing. So
     the thing to maximise is h, weighted by how well the anchor lines up with where you are ALREADY
     GOING (`align`); a web sideways spends the swing turning instead of travelling.
     The previous version kept the NEAREST hit, which maximises exactly the wrong quantity: nearest =
     shortest rope = tightest arc = the pendulum that swings in place. That one line is most of why the
     old build bounced (measured 0.51 u of net ground per swing) instead of flying.

     TWO REJECTIONS AND A FALLBACK TIER:
       · `minRise` — an anchor at or below your feet is a wall to smack into or a pavement to web. On
         the ground this is the difference between a line that can lift you and one that cannot.
       · `minAlign` — behind you is not a swing, it is a stop.
       · `arcClear` SORTS the survivors rather than rejecting them. An anchor whose arc bottom
         (anchorY − rope) clears the street is a SWING; one whose does not is still a perfectly good
         ZIP — a line you get winched UP rather than swung under. A zip is taken only when no swing
         exists, and it is scored by HEIGHT, because the whole point of a zip is to buy the altitude
         that makes the NEXT line a swing.
         THAT TIER IS THE TAKEOFF. A first pass that simply rejected arc-clear failures still left a
         grounded player stranded (measured 0/12 lift-offs): from the street, essentially every anchor
         in this city fails arc-clear — a 1.2 u shopfront cannot be swung from by someone standing next
         to it, and that is true, not a bug. What a stranded player needs is not a better swing; it is
         a way UP. */
  function findAnchor(state, world) {
    if (!world || !world.segmentHit) return null;
    const rays = P('aimRays'), len = P('ropeMax'), els = P('aimEl');
    const ropeMin = P('ropeMin'), minRise = P('minRise'), minAlign = P('minAlign'), arcClear = P('arcClear');
    /* Bias toward where you are GOING when you are moving, where you FACE when you are not. Momentum is
       the better predictor mid-flight (yaw is derived FROM velocity anyway); yaw is all there is at a
       standstill, which is the takeoff case. */
    const sp = Math.hypot(state.vx || 0, state.vz || 0);
    const moving = sp > 0.35;
    const hx = moving ? state.vx / sp : Math.sin(state.yaw);
    const hz = moving ? state.vz / sp : Math.cos(state.yaw);
    const baseYaw = Math.atan2(hx, hz);
    /* WITH NO MOMENTUM THERE IS NO "FORWARD", so the cone opens to the whole circle. This is not a
       nicety — it is the fix for a permanent dead end. `state.yaw` only updates while the body is
       actually moving, so a swinger who lands on a roof and stops keeps a FROZEN heading, and a fixed
       forward cone then searches the same empty 120° for as long as the game runs. Traced: one good
       swing, a landing at y 1.14, and then 14 seconds of vy 0, hs 0, no anchor, no escape — while
       usable lines existed the whole time, just not in the direction the body happened to stop facing. */
    const cone = moving ? P('aimCone') : Math.PI;
    /* ANGULAR RESOLUTION IS THE THING TO HOLD CONSTANT, not the ray count. Opening the cone to the full
       circle while keeping 9 rays spread them to 45° apart, so which 8 directions got sampled depended
       on whatever heading the body happened to stop facing — and a stationary swinger in a canyon could
       miss every climbable wall around it. Measured as a 2-of-4 flake on the street-takeoff check whose
       only variable was the starting yaw. Scale the count with the cone and the search stops caring. */
    const n = Math.max(rays, Math.round(rays * cone / P('aimCone')));
    let best = null, zip = null;
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0 : (i / (n - 1)) * 2 - 1;            // -1..1 across the fan
      const yaw = baseYaw + frac * cone;
      const sy = Math.sin(yaw), cy = Math.cos(yaw);
      for (let e = 0; e < els.length; e++) {
        const el = els[e], ce = Math.cos(el);
        const dx = sy * ce, dz = cy * ce, dy = Math.sin(el);
        /* A ZERO-RADIUS RAY, and this is the SECOND half of the takeoff bug (A-WALL, 2026-08-09) — the
           half that survived stopping the body falling through facades. `segmentHit` inflates every box
           by the radius it is given and returns t=0 for an origin inside that skin (collide.js:254), so
           a swinger resting flush against a building was inside the fat box of the wall it was touching
           in EVERY direction: measured on the real path, 126 of 126 rays came back t=0 → d=0 → rejected
           by `ropeMin`, at 6 of 8 headings. A 0.05 u skin is nothing in open sky and total in a 0.55 u
           canyon, where a swinger is against a facade most of the time — the one place the search has
           to work. `aimRadius` keeps it tunable for a consumer whose geometry is thin enough to need a
           fat ray; here the city is boxes, so the honest probe is a line. */
        const t = world.segmentHit(state.x, state.y, state.z, state.x + dx * len, state.y + dy * len, state.z + dz * len, P('aimRadius'));
        if (t >= 1) continue;                                      // clear sky down this ray
        const d = t * len;
        if (d < ropeMin) continue;                                 // too close to swing from
        const ax = state.x + dx * d, ay = state.y + dy * d, az = state.z + dz * d;
        const rise = ay - state.y;
        if (rise < minRise) continue;                              // at or below your feet — not an anchor
        const h = Math.hypot(ax - state.x, az - state.z);
        if (h < 1e-4) continue;                                    // straight overhead: no arc to swing
        const align = ((ax - state.x) * hx + (az - state.z) * hz) / h;
        if (align < minAlign) continue;
        const gy = world.heightAt ? world.heightAt(ax, az) : 0;
        if (ay - d < gy + P('skim') + arcClear) {                  // arc bottoms out in the street → ZIP tier
          /* SCORED BY SLOPE, NOT BY HEIGHT, and that distinction is the whole tier. Scoring by absolute
             rise picks the FAR, SHALLOW line — the one that reaches highest by reaching furthest — and
             a shallow line cannot lift you, so the winch just towed the body along the pavement. */
          const slope = rise / d;
          if (slope < P('zipSlopeMin')) continue;
          const zs = slope + 0.2 * Math.max(0, align);             // steepest wins; forward breaks ties
          if (!zip || zs > zip.score) zip = { d, x: ax, y: ay, z: az, score: zs, zip: true };
          continue;
        }
        /* h is the travel; the align term keeps a wide fan from picking a sideways anchor just because
           it is far. The 0.35 floor means a slightly-off anchor still beats no anchor at all. */
        const score = h * (0.35 + 0.65 * Math.max(0, align));
        if (!best || score > best.score) best = { d, x: ax, y: ay, z: az, score };
      }
    }
    return best || zip;
  }

  /* A-AIM: the PLAYER-aimed path. The consumer has already resolved a world point under its crosshair
     (it owns the camera; we do not — see aim.js's header). All this does is ask the one question the
     model is entitled to an opinion on: CAN I REACH THAT FROM WHERE I AM.

     RANGE IS MEASURED FROM THE PLAYER, NOT THE CAMERA, and that is the whole reason this validation
     lives here rather than in the consumer's raycast. A chase camera sits ~1.9 u behind the body, so a
     point 2.0 u from the eye can be 0.4 u from the body (reachable) or 3.9 u (a whiff) depending only
     on which way the eye is facing. Validate at the eye and `ropeMax` stops meaning anything.

     OUT OF RANGE RETURNS NULL — a WHIFF, deliberately, not a shortened rope to the nearest point along
     the ray. You either got the anchor you aimed at or you got nothing; anything in between would be
     the game quietly correcting your aim, which is exactly the assist A-AIM exists to remove. */
  function reachFromAim(state, aim) {
    if (!aim || typeof aim.x !== 'number') return null;
    const dx = aim.x - state.x, dy = aim.y - state.y, dz = aim.z - state.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < P('ropeMin') || d > P('ropeMax')) return null;
    return { d, x: aim.x, y: aim.y, z: aim.z };
  }

  /* ---- A-WALL (2026-08-09): A FACADE IS SOLID TO A SWINGER TOO ---------------------------------
     `px,py,pz` is where the body was at the top of the frame, which is a position we KNOW was clear —
     that is what makes this a sweep rather than a depenetration, and it is why a body cannot cross
     into the geometry the anchor search has to see past. One `segmentHit` in the common case.

     AXIS-SEPARATED, because a graze has to SLIDE. Stopping dead on any contact would kill the arc
     every time it brushed a facade — the swing runs down a 0.55 u canyon, so brushing is the normal
     case, not the exception. Testing each single-axis move independently against the same clear
     origin recovers the wall NORMAL that `segmentHit` does not return: whichever axis is blocked is
     the one pointing into the wall, so zeroing that component alone leaves the tangential half of the
     velocity intact and you slide along the building instead of sticking to it. (The city is a set of
     AABBs, which is what makes per-axis a real normal here and not an approximation.)

     ---- A-SOLID (2026-08-09): WHY THE SWEEP IS NOW 3D, and it is a PRECONDITION of running it while
     roped rather than a tidy-up. The old version tested a HORIZONTAL segment at the body's NEW y from
     its OLD xz — which is only sound while the body cannot cross a roof plane. A roped body can (the
     rooftop catch in step 6 is gated on `!anchor`), so an arc that dips past a roof edge put the
     sweep's own ORIGIN inside the tower: `segmentHit` returns 0 for an enclosed origin (collide.js:254),
     every axis reads blocked, and the body is pinned in mid-air at the roofline with vx=vz=0. A swept
     test is only as honest as its origin, so the origin now carries the y it was actually clear at,
     and the y move is swept like the other two — which is also what makes a roof solid to a swing.

     C++ anchor: this is the classic move-and-slide of a character controller — `v -= n * dot(v, n)`
     again, the same projection the rope constraint does, except the axis test IS the normal. */
  function wallSweep(state, px, py, pz, world) {
    const back = P('wallStop');
    if (!(back > 0) || !world || !world.segmentHit) return;
    const dx = state.x - px, dy = state.y - py, dz = state.z - pz;
    if (dx === 0 && dy === 0 && dz === 0) return;
    // radius 0 on purpose: an INFLATED box reports t=0 for an origin inside the skin, so a body
    // resting against a facade would read as blocked in every direction and freeze — a new stranding.
    if (world.segmentHit(px, py, pz, state.x, state.y, state.z, 0) >= 1) return;
    const tx = dx !== 0 ? world.segmentHit(px, py, pz, px + dx, py, pz, 0) : 1;
    const ty = dy !== 0 ? world.segmentHit(px, py, pz, px, py + dy, pz, 0) : 1;
    const tz = dz !== 0 ? world.segmentHit(px, py, pz, px, py, pz + dz, 0) : 1;
    if (tx < 1 || ty < 1 || tz < 1) {
      if (tx < 1) { state.x = px + dx * tx - Math.sign(dx) * back; state.vx = 0; }
      if (ty < 1) { state.y = py + dy * ty - Math.sign(dy) * back; state.vy = 0; }
      if (tz < 1) { state.z = pz + dz * tz - Math.sign(dz) * back; state.vz = 0; }
      return;
    }
    /* NO SINGLE AXIS IS BLOCKED BUT THE DIAGONAL IS — you clipped an outside corner. Drop the
       SMALLEST component and keep the rest: a corner should deflect a swing, not stop it. */
    const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
    if (ax <= ay && ax <= az) { state.x = px; state.vx = 0; }
    else if (az <= ay) { state.z = pz; state.vz = 0; }
    else { state.y = py; state.vy = 0; }
  }

  /* "AM I INSIDE A SOLID" IN ONE QUERY, and it assumes nothing about the world. `segmentHit` clips at
     the ORIGIN when the origin sits inside a box (collide.js:254), so a 1 cm ray straight up comes back
     exactly 0 iff the point is enclosed, and 1 otherwise. The obvious alternative — surfaceAt(x,z) >
     y — is a FOOTPRINT test with a 0.18 u pad, not a containment test; it called a body resting 0.1 u
     OUTSIDE a facade "inside", which is a wrong answer this arc already paid for once in a diagnostic. */
  function enclosed(world, x, y, z) {
    return !!world && !!world.segmentHit && world.segmentHit(x, y, z, x, y + 0.01, z, 0) === 0;
  }

  /* Squeeze a body that is already inside the city back out to the nearest open air. Bounded on both
     axes of cost: 8 compass directions at 4 radii, and it stops at the FIRST clear one, so the usual
     answer is 8 queries and the worst case is 32 — on a frame that is otherwise a dead end. It moves at
     a RATE rather than teleporting, because being extruded through a wall over a few frames reads as
     the game recovering, and a snap reads as the game breaking. */
  const UNSTICK_R = [0.25, 0.6, 1.0, 1.5];
  function unstick(state, world, dt) {
    const rate = P('unstick');
    if (!(rate > 0) || !enclosed(world, state.x, state.y, state.z)) return;
    for (let r = 0; r < UNSTICK_R.length; r++) {
      const rr = UNSTICK_R[r];
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2, sx = Math.sin(a), sz = Math.cos(a);
        if (enclosed(world, state.x + sx * rr, state.y, state.z + sz * rr)) continue;
        state.x += sx * rate * dt; state.z += sz * rate * dt;
        return;
      }
    }
  }

  /* CUT THE LINE, and a cut is a LAUNCH (A-FLOW). Whatever velocity the arc built is kept — that part
     was always true — plus a small up+forward flick, which is what turns "the rope ended" into "I threw
     myself". `refire` is the gap before the next web can be taken: without it, a held button re-attaches
     on the very next frame and the launch never happens, so the cut would be invisible. */
  function cutLine(state, launch, up, fwd) {
    state.anchor = null;
    state.refire = P('refireDelay');
    state.hang = 0; state.rose = false;      // per-web bookkeeping dies with the web that owns it
    if (!launch) return;
    const u = up != null ? up : P('launchUp');
    const f = fwd != null ? fwd : P('launchFwd');
    const h = Math.hypot(state.vx, state.vz);
    state.vy += u;
    if (h > 1e-4) { state.vx += (state.vx / h) * f; state.vz += (state.vz / h) * f; }
  }

  /* ---- A-LOCK (2026-08-09): THE RELEASE AS A VERB A CONSUMER CAN CALL -----------------------------
     `step` already cuts the line when the trigger goes false, and that was the whole release story for
     as long as the trigger WAS the rope ("hold the button to stay attached"). The owner's new scheme
     separates them — the web is fired once and LATCHES, and a separate key cuts it — so the consumer
     that owns the body (createCharacterController) needs to be able to say "cut it, now, with this much
     launch" without pretending the trigger dropped. That is this function, and it is deliberately the
     SAME `cutLine` the automatic paths use: one implementation of "what a cut does to your velocity",
     called with different constants, so a player release and a top-out release can never drift into two
     different physics.
     Returns the speed the body left with, so a caller (or a probe) can measure the launch rather than
     infer it. `{ up, fwd }` default to the profile's PLAYER constants (`releaseUp`/`releaseFwd`), and
     `{ up: 0, fwd: 0 }` is a BARE cut — the control arm of the A/B in the ledger. */
  function release(state, opts = {}) {
    if (!state || !state.anchor) return 0;
    cutLine(state, true, opts.up != null ? opts.up : P('releaseUp'), opts.fwd != null ? opts.fwd : P('releaseFwd'));
    state.speed = Math.hypot(state.vx, state.vy, state.vz);
    return state.speed;
  }

  /* ---- ATTACH, LIFTED OUT OF `step` (A-CHAR, 2026-08-09) --------------------------------------
     It was section 1 of step() verbatim and it still is — the lift is a MOVE, not a rewrite, so the
     swing behaves identically (step() calls this on the same frame with the same arguments it used to
     compute inline). What changed is that it is now REACHABLE ON ITS OWN, and that is the whole seam
     the unified character controller hangs off: a walking character must be able to throw a web
     WITHOUT surrendering the frame's movement to a swing integrator that has no walk in it. `attach`
     is a pure query-and-assign — it hangs a rope or it does nothing, and it never integrates — so
     "hold fire while nothing is in range" costs a walker exactly zero movement.

     THE TWO GATES ON RE-ATTACHING both exist so that "hold the button" reads as a CHAIN OF SWINGS
     rather than one continuous hang. `refire` is the beat after a cut; `refireVy` says do not take a
     new line while the last launch is still climbing — let it fly, web again on the way down. That is
     the rhythm of the reference games, and it is the difference between flying and being winched.
     Returns the anchor it took, or null — so a caller can react to the attach edge without polling. */
  function attach(state, axes, world) {
    if (state.anchor) return null;
    const pointMode = P('aimMode') === 'point';
    if ((state.refire || 0) > 0) return null;
    if (!pointMode && !((state.vy || 0) <= P('refireVy'))) return null;
    const a = pointMode ? reachFromAim(state, axes && axes.aimPoint) : findAnchor(state, world);
    if (!a) return null;
    /* A-CHAR (2026-08-09) — A PLAYER-AIMED LINE GETS THE SAME ZIP TIER THE AUTO SEARCH ALREADY GRANTS.
       Measured on the character's first driven swing: web a high anchor from the street and you HANG —
       peak y 0.385, 0.40 u displaced over 160 frames. That is the correct pendulum and the wrong verb.
       The reason is a gap, not a physics error: `zip` is what arms the winch (`zipAccel`), and only
       `findAnchor` was setting it, so every aimed web was a pure pendulum. From the street a pendulum
       hung above you cannot start — there is no height to trade for speed — which is the exact
       stranding A-FLOW's zip tier was built to cure for the auto verb and never carried to this one.
       THE RULE IS THE SAME RULE, not a second one: `zipSlopeMin` (rise ÷ rope) is the slope at which
       the winch's vertical component beats gravity, so a line steeper than it can LIFT you and a
       shallower one would only drag you along the pavement. Deciding it once, at attach, is also why
       it lives here rather than in the per-frame winch. */
    if (pointMode && a.d > 1e-6 && (a.y - state.y) / a.d >= P('zipSlopeMin')) a.zip = true;
    /* `zip` is the TIER the search put this line in, carried on the anchor because it decides what
       the line is FOR. A swing line is swung on; a zip line is climbed. Deciding that once, at
       attach, is what stops the winch from yanking a working swing straight every time the arc
       passes under its own anchor (where the line is, momentarily, perfectly steep). */
    /* ---- A-LAB: THE PIVOT the simulation actually hangs from, which is NOT the point the web is
       drawn to. See `pivotOut`. The offset direction is the HORIZONTAL vector from the anchor back to
       the body — no surface normal needed, and it is the right answer anyway: it pushes the pivot to
       YOUR side of the wall, which is the side the arc has to have air on. A zip keeps its real point
       (you climb a wall by pulling toward the wall). ---- */
    let px = a.x, py = a.y, pz = a.z;
    const out = P('pivotOut');
    if (out > 0 && !a.zip) {
      /* THE OFFSET IS THE COMPONENT PERPENDICULAR TO TRAVEL, and that qualifier is a MEASURED
         correction rather than a refinement. The first version pushed the pivot along the WHOLE
         horizontal from anchor back to body, and the bench went the wrong way hard: 28 webs in 12 s
         (one every 0.43 s) covering 0.47 u each, net displacement 5.50 u against a 13.25 u baseline
         — churn, not swinging. The cause is geometric. From a standing street start the anchor is
         AHEAD of you, so "anchor → body" points BACKWARD along your travel, and offsetting along it
         drags the pivot toward you — which is precisely the initial horizontal offset, i.e. the
         pendulum's AMPLITUDE. The arc collapsed, hit its top in a few frames, `topOut` cut it, and
         the loop repeated.
         Split that vector against the direction of travel and only the PERPENDICULAR part is the
         "off the wall" the cheat is asking for. Swinging down a street parallel to a facade, travel
         is along the wall and the whole offset survives — the case Insomniac describe. Webbing
         something dead ahead, the perpendicular part is ~0 and the arc keeps every unit of its
         amplitude. One dot product buys both. */
      const ox = state.x - a.x, oz = state.z - a.z;
      const sp0 = Math.hypot(state.vx || 0, state.vz || 0);
      const tx = sp0 > 0.35 ? state.vx / sp0 : Math.sin(state.yaw);
      const tz = sp0 > 0.35 ? state.vz / sp0 : Math.cos(state.yaw);
      const along = ox * tx + oz * tz;
      const nx = ox - tx * along, nz = oz - tz * along;      // the perpendicular residue
      const nl = Math.hypot(nx, nz);
      if (nl > 1e-3) { px = a.x + (nx / nl) * out; pz = a.z + (nz / nl) * out; }
    }
    state.anchor = { x: a.x, y: a.y, z: a.z, px, py, pz, zip: !!a.zip };
    // the rope is measured to the PIVOT, or the line would be slack (or pre-taut) on its first frame
    state.rope = Math.max(P('ropeMin'), Math.hypot(state.x - px, state.y - py, state.z - pz));

    /* ---- A-LAB: THE ATTACH BLEND. Rotate the velocity you arrived with onto the tangent plane of the
       new rope instead of letting the constraint delete its radial half next frame. Speed-preserving
       by construction (`want` is interpolated toward the INCOMING speed and never past it), so this
       redirects momentum, it does not manufacture any. See `attachBlend`. ---- */
    const blend = P('attachBlend');
    if (blend > 0 && state.rope > 1e-4) {
      const nx = (state.x - px) / state.rope, ny = (state.y - py) / state.rope, nz = (state.z - pz) / state.rope;
      const radial = state.vx * nx + state.vy * ny + state.vz * nz;
      if (radial > 0.01) {
        const sp0 = Math.hypot(state.vx, state.vy, state.vz);
        const tx = state.vx - nx * radial, ty = state.vy - ny * radial, tz = state.vz - nz * radial;
        const tl = Math.hypot(tx, ty, tz);
        if (tl > 1e-4) {
          const k = (tl + (sp0 - tl) * blend) / tl;
          state.vx = tx * k; state.vy = ty * k; state.vz = tz * k;
        }
      }
    }
    return state.anchor;
  }
  /* The simulation pivot, with a fallback to the visual point — so a state object built by an older
     consumer (or by a probe that assigns `state.anchor` by hand) still solves correctly. */
  const pivX = (a) => (a.px !== undefined ? a.px : a.x);
  const pivY = (a) => (a.py !== undefined ? a.py : a.y);
  const pivZ = (a) => (a.pz !== undefined ? a.pz : a.z);

  function step(state, axes, dt, world) {
    /* Adopt the shared fields into a real vector ONCE. Coming from another body we inherit a scalar
       speed + yaw, so convert it — that is what makes walk→swing keep your momentum instead of
       dropping you. carryMomentum() resets vy for every other model; we re-derive the rest here. */
    if (typeof state.vx !== 'number') {
      const s0 = state.speed || 0;
      state.vx = Math.sin(state.yaw) * s0; state.vz = Math.cos(state.yaw) * s0; state.vy = 0;
      state.anchor = null; state.rope = 0; state.refire = 0; state.hang = 0; state.rose = false;
    }
    state.refire = Math.max(0, (state.refire || 0) - dt);

    const boost = clamp(axes.boost || 0, 0, 1);
    /* FIRE is `axes.fire` OR a held throttle. Two sources on purpose, and this is not indecision:
       A-AIM binds fire to the MOUSE BUTTON under pointer lock, which a phone does not have and an
       existing consumer never sent. Keeping the throttle edge means the touch stick and the W key
       still fire exactly as they did before this arc — the new input is added, nothing is taken. */
    const fire = axes.fire === true || (axes.throttle || 0) > 0;

    /* Resolve the reachable anchor EVERY frame, whether or not the trigger is down, and publish the
       verdict on state. That is what lets the consumer's crosshair dim on the same rule the attach
       uses — one implementation of "in range", read two ways. Computing it twice (once here, once in
       the HUD) is how the mark and the mechanic drift apart, and the drift is invisible until the day
       the player fires at a bright crosshair and nothing happens. */
    const pointMode = P('aimMode') === 'point';
    const reach = pointMode ? reachFromAim(state, axes.aimPoint) : null;
    state.aimInRange = pointMode ? !!reach : undefined;

    /* 1) ATTACH / RELEASE. Holding fire keeps the line; letting go cuts it, and whatever velocity the
       arc has built is kept — the release IS the launch. */
    if (fire && !state.anchor) attach(state, axes, world);
    else if (!fire && state.anchor) cutLine(state, true);

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
      /* Lateral nudge, perpendicular to travel — steers the arc without adding raw speed.
         PERPENDICULAR TO *WHAT*, THOUGH: with vx = vz = 0 the old `state.vz / sp` was 0/1 = 0 on both
         axes, so steering a stopped swinger did precisely nothing. Land on a roof, come to rest, and
         the controls were dead. Fall back to the FACING frame when there is no travel to be
         perpendicular to — then the nudge starts the motion and yaw follows it from the next frame. */
      const sp = Math.hypot(state.vx, state.vz);
      const dx = sp > 0.05 ? state.vx / sp : Math.sin(state.yaw);
      const dz = sp > 0.05 ? state.vz / sp : Math.cos(state.yaw);
      state.vx += dz * -axes.steer * ctl * dt;
      state.vz += -dx * -axes.steer * ctl * dt;
    }

    if (state.anchor) {
      /* 3a) THE NEVER-DEAD-HANG ASSIST (A-FLOW). Push forward along the arc, scaled by how far below
         maxSpeed you are — full help at a standstill, none at the cap. The rope constraint below strips
         whatever part of this points along the line, so it only ever adds TANGENTIAL speed, which is
         the same thing pumping does and the same thing Fristrom's post-mortem describes as the reason
         the 2004 game felt good: the simulation is real, the energy is given. At a true dead hang there
         is no travel direction to push along, so fall back to facing — otherwise the one state the
         assist exists to rescue is the one state it cannot act in. */
      const hs = Math.hypot(state.vx, state.vz);
      const ux = hs > 0.05 ? state.vx / hs : Math.sin(state.yaw);
      const uz = hs > 0.05 ? state.vz / hs : Math.cos(state.yaw);
      const fade = Math.max(0, 1 - state.speed / P('maxSpeed'));
      const a = P('assist') * fade * dt;
      state.vx += ux * a; state.vz += uz * a;

      /* 3b) THE WINCH / WEB-ZIP. Reel yourself UP the line toward an anchor above you while you are
         slow. This is the takeoff: from the street you web something high, the winch pulls you up it,
         and the arc takes over the moment you have speed. It fades out above `zipBelow` so it never
         competes with a swing that is already working — a permanent pull along the rope would flatten
         every arc into a straight line to the anchor. */
      if (state.anchor.zip) {
        const rise = state.anchor.y - state.y;
        const dx = state.anchor.x - state.x, dz = state.anchor.z - state.z;
        const L = Math.hypot(dx, rise, dz) || 1e-6;
        const fade = clamp(1 - state.vy / P('zipClimb'), 0, 1);
        if (fade > 0) {
          const k = P('zipAccel') * fade * dt;
          state.vx += (dx / L) * k; state.vy += (rise / L) * k; state.vz += (dz / L) * k;
        }
      }
    }

    // 3) PUMP — the whole reason a swing accelerates instead of decaying. Reeling in on the downswing
    //    does work on the pendulum; letting rope out lengthens the arc. Mirrors how a child pumps a
    //    swing by standing up at the bottom.
    if (state.anchor && axes.lift) {
      const rate = P('pump') * (1 + (P('boost').pump - 1) * boost);
      state.rope = clamp(state.rope - axes.lift * rate * dt, P('ropeMin'), P('ropeMax'));
    }

    /* 3b) THE SWING FLOOR (A-LAB) — reel in rather than plough the street. `arcClear` decided once, at
       attach, from where you were standing; this is the same rule enforced CONTINUOUSLY, against the
       ground under you NOW. Shortening only (never lengthening) is Insomniac's own "no-slack" rule and
       it is also what keeps this from oscillating: the line ratchets in over a bad patch and stays
       there. Runs only while descending on a SWING line — a zip is climbing a wall on purpose, and a
       rising arc is already leaving the problem. */
    const fa = P('floorAssist');
    if (fa > 0 && state.anchor && !state.anchor.zip && state.vy < 0) {
      const gy0 = world && world.heightAt ? world.heightAt(state.x, state.z) : 0;
      const want = pivY(state.anchor) - gy0 - P('skim') - P('arcClear');
      if (want > P('ropeMin') && state.rope > want) state.rope = Math.max(want, state.rope - fa * dt);
    }

    // 4) INTEGRATE, then satisfy the rope CONSTRAINT. Position first, then pull back onto the sphere
    //    and strip the radial velocity — that projection is the rope going taut, and it is the only
    //    place the arc actually comes from.
    // A-WALL: remember the last KNOWN-CLEAR position before moving — the sweep below needs an origin
    // it can trust, and after the rope constraint has fired there is no other way back to one.
    // A-SOLID: the y goes with it. See wallSweep's note — an origin carrying the WRONG y is how the
    // sweep pinned a roped body at a roofline it had legitimately dropped past.
    const clearX = state.x, clearY = state.y, clearZ = state.z;
    state.x += state.vx * dt; state.y += state.vy * dt; state.z += state.vz * dt;
    if (state.anchor) {
      // THE CONSTRAINT SOLVES AGAINST THE PIVOT, not the drawn anchor (A-LAB `pivotOut`).
      const cx = pivX(state.anchor), cy = pivY(state.anchor), cz = pivZ(state.anchor);
      const ax = state.x - cx, ay = state.y - cy, az = state.z - cz;
      const dist = Math.hypot(ax, ay, az) || 1e-6;
      if (dist > state.rope) {
        const nx = ax / dist, ny = ay / dist, nz = az / dist;
        state.x = cx + nx * state.rope;
        state.y = cy + ny * state.rope;
        state.z = cz + nz * state.rope;
        const radial = state.vx * nx + state.vy * ny + state.vz * nz;
        if (radial > 0) { state.vx -= nx * radial; state.vy -= ny * radial; state.vz -= nz * radial; }
      }

      /* 4b) AUTO-RELEASE (A-FLOW) — the line cuts ITSELF at the top of the forward arc, and this is
         what makes a HELD BUTTON mean "keep swinging" instead of "keep hanging". Tested AFTER the
         constraint, because the velocity that matters is the tangential one the rope just left us.
         THREE CONDITIONS, and all three are needed:
           · you have passed UNDER the anchor and are climbing the far side (`ahead > 0`) — otherwise
             the swing-in, which also rises, would cut on the way to the bottom;
           · the arc has turned your velocity up to `releasePitch` — that is the launch angle, and near
             35° is where a ballistic arc covers the most ground;
           · there is real speed to launch with; cutting a slow swing just drops you.
         A player who lets go earlier still gets the same launch — this only supplies the release for a
         player who is holding the button and expecting the game to fly them. */
      /* A ZIP ENDS ON ARRIVAL. Without this the winch reels you all the way into the facade it webbed
         and holds you there, which is a different way of being stuck. Cutting a rope-length short of
         the anchor, with the launch flick, pops you up over the roof edge with the altitude the zip was
         taken to buy — and the next search, run from up there, finds a real SWING. */
      if (state.anchor && state.anchor.zip && state.y > state.anchor.y - P('minRise')) cutLine(state, true);

      /* A-LOCK: `axes.latched` NAMES THE CONTROL SCHEME, and both of its consequences follow from that
         one word rather than from two independent flags a consumer could set inconsistently.
         · HOLD-TO-SWING (metropolis, the auto-anchor chain): the game must cut the line at the top of
           the arc, or "hold the button" is a hang. autoRelease ON, `maxHang` behind it.
         · LATCHED (the owner's new scheme): the rope stays up until SPACE, so a game that cut it at the
           first top-out would be taking the verb back — "you can swing all the way up if you want" is
           exactly the freedom `topOut` removes. The clock therefore becomes the PRIMARY rule, so it is
           the longer, pendulum-derived `maxHangLatched` rather than the number fitted to sit behind
           topOut. See that constant for the arithmetic.
         Absent ⇒ the profile decides, so a consumer that never passes it is unchanged. */
      const latched = !!axes.latched;
      const autoRel = latched ? false : P('autoRelease');
      const hangCap = latched ? P('maxHangLatched') : P('maxHang');
      if (state.anchor && fire) {
        /* THE HANG CLOCK AND ITS BACKSTOP RUN WHETHER OR NOT `autoRelease` IS ON, and separating them
           is the point of this edit rather than a tidy-up. They used to live inside the autoRelease
           gate, so switching that off would have produced a rope with NO upper bound at all — the
           "never dead-hang" rule silently deleted by a flag that reads like it only governs the
           top-out. `maxHang` is the last word in every scheme (its own comment says so); only the
           TIMED-TO-THE-ARC cuts belong to the game. */
        state.hang = (state.hang || 0) + dt;
        const hs = Math.hypot(state.vx, state.vz);
        // "past the anchor" is a fact about the ARC, so it is measured from the pivot the arc turns on
        const ahead = hs > 1e-4
          ? ((state.x - cx) * state.vx + (state.z - cz) * state.vz) / hs : 0;
        if (state.vy > 0.05) state.rose = true;             // this web has carried you upward at least once
        const earned = autoRel && hs > 0.4 && state.vy > 0 && ahead > 0 && Math.atan2(state.vy, hs) >= P('releasePitch');
        // the far extreme of the arc: you rose, you are past the anchor, and vy has fallen back to zero
        const topped = autoRel && P('topOut') && state.rose && ahead > 0 && state.vy <= 0;
        if (earned || topped || state.hang >= hangCap) cutLine(state, true);
      }
    }

    /* 4c) A-WALL — LAST, after the rope constraint, because the constraint is itself a teleport: it
       snaps the body onto the sphere around the anchor, and the final word each frame has to be "not
       inside the city" or the anchor search goes blind.

       ---- A-SOLID (2026-08-09): THE ROPE NO LONGER BUYS YOU PASSAGE THROUGH A WALL ----------------
       A-WALL ran this only while FREE, on a measured trade (see `wallWhileRoped`). The owner rejected
       the trade after driving it: a facade you can swing through is not a building. Ungating it does
       cost the arc, exactly as A-WALL predicted and for the reason it named — the rope constraint has
       already stripped the radial half of the velocity, and the wall now strips the normal half of
       what is left. It costs MORE than A-WALL measured, because of a geometric fact about this
       mechanic that neither build had looked at: `findAnchor` webs a point ON A FACADE, and the
       bottom of a pendulum hung from a point on a vertical wall is FLUSH WITH THAT WALL. So the arc
       grinds the building it is attached to at the one moment it is fastest.

       AND THE COST DID NOT ARRIVE — measured, 8 headings x 480 frames, button held, same bench either
       way. Roped frames spent INSIDE the city 170 → 0 (7.74% → 0.00%); driven deliberately at a facade
       while roped, runs that got inside 6/8 → 0/8. Net ground per swing went UP, 1.31 → 1.93 u, and
       mean displacement 6.04 → 6.52 u. The reason is the thing A-WALL's own note had already proved
       about the free case and did not carry across: from INSIDE a solid every anchor ray comes back
       d≈0 and the search is blind, so the arcs that "travelled further" through walls were partly runs
       thrashing inside geometry with no line at all (attached 57.2% → 40.5%, path 28.3 → 19.1 u — less
       swinging back and forth in place, more ground). What DID cost is peak speed, 8.17 → 6.97 u/s
       (-15%): the wall now strips the normal half of what the rope constraint left. That is the honest
       price, it is paid in top speed rather than in distance, and if it ever needs buying back the
       lever is the anchor SCORE (prefer lines whose arc has air under them), never soft walls. */
    if (!state.anchor || P('wallWhileRoped')) wallSweep(state, clearX, clearY, clearZ, world);
    // …and the cure runs UNGATED: a body that is already enclosed has to get out whether or not it is
    // holding a line, because enclosed is the one state from which nothing else in this model can act.
    unstick(state, world, dt);

    // 5) DRAG + CAP. Low drag so momentum survives between swings; the cap stops a pump chain
    //    compounding into escape velocity.
    const bleed = Math.max(0, 1 - P('airDrag') * dt);
    state.vx *= bleed; state.vy *= bleed; state.vz *= bleed;
    /* A-LAB: THE CAP IS HORIZONTAL. Clamping the 3D magnitude throttled the downswing — the part of an
       arc the player earned — and did it hardest at exactly the moment the swing is supposed to feel
       fastest. Insomniac cap horizontal speed and let 3D exceed it on the way down; `maxVertSpeed` is
       the separate ceiling that still stops a pump chain compounding to orbit. */
    const hcap = P('maxSpeed'), vcap = P('maxVertSpeed');
    const hsp = Math.hypot(state.vx, state.vz);
    if (hsp > hcap) { const k = hcap / hsp; state.vx *= k; state.vz *= k; }
    if (state.vy > vcap) state.vy = vcap; else if (state.vy < -vcap) state.vy = -vcap;

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
      /* A LINE TO SOMETHING OVERHEAD SURVIVES A LANDING — and this one line is the measured cause of
         "a grounded swinger is stranded" (A-FLOW). The guess was that the aim accepted the pavement;
         the measurement said otherwise: the anchor search finds a real anchor from the street at 9 of 9
         spots, attaches, and then THIS branch cut it on the very same frame, every frame, forever. A
         rope to something above you is not a crash, it is the way out of one — keep it and let the
         winch above reel you up.
         IT HAS TO BE A LINE THAT CAN LIFT, not merely one that points upward — the same `zipSlopeMin`
         the winch uses. A shallow line kept through a landing is a tow-rope, and the body slides along
         the street on it (measured: 83% of frames grounded, peak height 0.64 u, which reads as exactly
         the stranding it was supposed to cure). */
      if (state.anchor) {
        const r = state.anchor.y - state.y;
        const L = Math.hypot(state.anchor.x - state.x, r, state.anchor.z - state.z) || 1e-6;
        // reset the per-web bookkeeping with the web, or the NEXT one inherits a spent hang timer
        if (r / L < P('zipSlopeMin')) { state.anchor = null; state.hang = 0; state.rose = false; }
      }
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
  /* `attach`, `reach` and `release` are exposed for a consumer that owns the body itself (the unified
     character controller) — the pilot-controller path only ever needs `step`, and calls all three
     internally. `release` is A-LOCK's addition: a latched rope needs a cut that is not "the trigger
     went false". */
  return { step, attach, reach: reachFromAim, release };
}

/* the model registry the controller dispatches on (a PilotProfile names its model by key). Adding a
   craft type = one entry here + its model factory + a PilotProfile on the entity. */
const MODEL_FACTORIES = { ground: createGroundModel, spacecraft: createSpacecraftModel, road: createRoadModel, boat: createBoatModel, bird: createBirdModel, fish: createFishModel, bike: createBikeModel, grapple: createGrappleModel };

const ENTER_TIME = 0.55;                 // seconds the ENTERING camera-move runs (input ignored) — "the move is the onboarding"
const ZERO_AXES = { throttle: 0, steer: 0, lift: 0, boost: 0, aimPoint: null, fire: false };

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
  // A-AIM adds two PASS-THROUGH fields: `aimPoint` (a resolved world point the consumer owns) and
  // `fire` (a trigger edge). Neither is eased — a damped aim point would smear the anchor across the
  // geometry you were looking at half a second ago, and a damped trigger is just input lag.
  let _ax = { throttle: 0, steer: 0, lift: 0, boost: 0, aimPoint: null, fire: false };
  /* A-AIM FREE-LOOK. When a consumer takes over the aim, it also takes over the chase AZIMUTH: the
     reactive chase below snaps the camera behind the craft's heading every frame, which would fight
     a player turning the view to aim (and on a grapple the heading changes continuously, since it is
     derived from the arc's velocity — so the camera would be dragged off the aim by the physics).
     Default OFF ⇒ every existing craft chases exactly as before. Reset on possess AND release: this
     repo's most-repeated bug is an ownership flag that an exit path clears and no entry path guards. */
  let freeLook = false;
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
    _ax.aimPoint = null; _ax.fire = false;                   // A-AIM: a stale aim/trigger must never survive a body swap
    freeLook = false;                                        // …nor may a stale camera-ownership flag
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
    /* A-AIM: the ELEVATION twin of that clamp. A profile that needs to aim upward declares its own
       floor (GRAPPLE_PROFILE.chaseElevMin) because the rig's free-orbit floor keeps the eye above the
       target, and an orbit camera above its target can only look DOWN. Profiles that declare neither
       never touch the clamp → every existing craft frames byte-identically. */
    if (rig.setElevationClamp && (p.profile.chaseElevMin !== undefined || p.profile.chaseElevMax !== undefined)) {
      rig.setElevationClamp(p.profile.chaseElevMin, p.profile.chaseElevMax);
    }
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
    if (rig.setElevationClamp) rig.setElevationClamp();   // A-AIM: hand the pitch clamp back too (same contract)
    freeLook = false;                                 // A-AIM: the consumer's camera ownership ends with the possession
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
    // A-AIM pass-through. `aimPoint` is the consumer's own reused {x,y,z} — we hold the REFERENCE, we
    // never copy it into a fresh object (no-hot-alloc invariant #7); the model only reads it this frame.
    _ax.aimPoint = ax.aimPoint || null;
    _ax.fire = ax.fire === true;

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
      // A-AIM: with free-look ON the consumer owns the azimuth (it is driving rig.orbit from the
      // player's mouse), so the reactive chase stands down rather than fighting it every frame.
      if (!freeLook) rig.setAzimuth(s.yaw + Math.PI - camLead * _ax.steer);   // reactive chase: rig K-damps curr→goal = lag/swing
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

  /* setFreeLook(on) — A-AIM. Hand the chase AZIMUTH to the consumer (it is aiming with it) or take it
     back. Deliberately a runtime toggle rather than a profile flag: a consumer turns it on only while
     an aim surface is actually engaged (pointer lock captured, an aim mode entered) and off the moment
     it is not, so the automatic chase remains the resting state of every body. */
  function setFreeLook(on) { freeLook = !!on; }

  return {
    possess, release, step, setView, addLookDrag, setFreeLook,
    // Gyro seam: expose the look controller so createGyroLook can call look.setTarget directly.
    get look() { return pilotLook; },
    get fpBlend() { return fpBlend; },
    get freeLook() { return freeLook; },
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
