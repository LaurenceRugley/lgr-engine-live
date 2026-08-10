/* ============================================================
   @lgr/engine-core — createCharacterController (ARC A-CHAR, 2026-08-09).
   ------------------------------------------------------------
   ONE CHARACTER. You walk, you sprint, you JUMP, you FALL, you look with the mouse, and shooting a web
   is an ABILITY you use mid-stride — not a body you switch into. You land from a swing and keep
   walking. There is no mode button in the middle of play.

   WHY THIS MODULE EXISTS AT ALL, stated plainly because it looks like a duplicate of two things that
   already work:

     · `createFirstPersonWalker` HAS NO VERTICAL DIMENSION. It owns x and z, resolves horizontal
       collision, and asks a `groundY(x,z)` hook where the floor is — then it PUTS THE EYE THERE,
       unconditionally, every frame. That is why walking off a rooftop in metropolis STEPPED YOU DOWN
       to the street: there was never a fall to interrupt. Its own header says so ("KNOWN v1 LIMIT…
       the walker has no fall model, and giving it one is its own arc"). This is that arc. "Jump" is
       therefore not a keybind — it is the MISSING HALF of a character controller: gravity, an air
       state, an impulse, a landing, and the two forgiveness timers that make the impulse feel fair.
     · `createGrappleModel` is a complete, MEASURED swing (pendulum, rope constraint, pump/reel, cling,
       rooftop landing, release-as-launch — see docs/design/swing-ledger.md). It is reused WHOLE here,
       not re-derived. What changes is who owns the body: the grapple owns it only WHILE THE LINE IS
       UP; the moment the line cuts, this controller takes the same velocity back and flies it as a
       jump. One state object, two integrators, no conversion — which is exactly why the transition
       preserves momentum instead of approximating it.

   SO THE COMPOSITION IS: this module owns Y (gravity/jump/land) + the look + the camera, and DELEGATES
     · X/Z movement + horizontal collision  → `createFirstPersonWalker` (proven: 8/8 facades, 0/1440
       frames inside — swing-ledger.md PROVEN table). Not re-solved here.
     · the rope                             → `createGrappleModel` (proven, same table).
   Nothing that was already measured good is rebuilt. The new code is the vertical axis and the seams.

   TWO CAMERAS, BOTH DRIVEN FROM HERE, AND EACH TUNED SEPARATELY (the owner's second ruling). Third
   person over-the-shoulder is the default because the swing arc reads best from outside the body — you
   cannot time a release you cannot see. First person is a key away. They are NOT one camera with a
   distance of zero: a shared tuning is wrong in one of them (the shoulder offset that frames a TPS
   makes an FPS lopsided; the head-bob that sells an FPS is invisible-but-nauseating in a TPS), so each
   view carries its own block of options.

   THE LOOK IS NOT THE BODY'S FACING, and keeping the two apart is load-bearing rather than tidy. This
   controller owns `lookYaw`/`lookPitch` (where the crosshair points — the thing the mouse steers), and
   the shared `state.yaw`/`state.pitch` stay what every pilot model in this repo means by them: the
   BODY's orientation, which `createGrappleModel` derives FROM MOTION every frame ("you face where the
   arc is throwing you"). Had they been one field, the grapple would have wrenched the camera round on
   every swing and the crosshair would have become unaimable exactly when you most need it.

   C++ anchors: `state` is a plain struct passed by reference to two different `step()` free functions
   (no virtual dispatch, no ownership transfer — the caller owns the storage); the `_scratch` vectors
   are file-static reusable buffers, because allocating in the frame loop is the no-hot-alloc invariant
   (docs/engine-invariants.md #7); the walker/grapple handles are ≈ `std::unique_ptr` members held for
   the lifetime of the controller.

   CONTRACT
   --------
   createCharacterController({
     world: {                       // the project's queries — this module assumes NO renderer, NO scene
       heightAt(x,z)      -> y      // the BASE ground (street/terrain/beach). Required for a floor.
       surfaceAt(x,z,yMax,r) -> y   // the highest solid TOP at or below yMax (rooftops). -Infinity = none.
       segmentHit(ox,oy,oz,ex,ey,ez,r) -> t∈[0,1]   // 1 = clear. Camera spring-arm + the grapple's rays.
       resolveSphere(state,dt,cfg)  // horizontal depenetration (collide.js's own shape)
     },
     grapple: { step, attach } | null,   // createGrappleModel(profile); null = a character with no web
     grappleProfile,                     // the SAME profile object the model was built with (read live)
     … tuning, see the defaults block
   }) -> {
     update(dt, input), addLook(dx,dy), cameraPose(outPos,outDir),
     setPosition(x,y,z), setYaw(rad), setView('third'|'first'), toggleView(),
     state, view, grounded, airborne, swinging, jumps, landings, x, y, z, lookYaw, lookPitch,
   }

   `input` = { x, y, sprint|boost, jump, fire, lift, steer, aimPoint } — the same axis vocabulary the
   rest of the engine speaks, so a project wires ONE key map for the whole character.
   ============================================================ */
import * as THREE from 'three';
import { createFirstPersonWalker } from './createFirstPersonWalker.js';

export function createCharacterController(opts = {}) {
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const D = Math.PI / 180;
  const world = opts.world || {};

  /* ---- TUNING. Defaults are the metropolis scale (1 world unit ≈ 6 m — see main.js's A-FEEL note),
     because that is the only city this has been driven in; a project at a different scale passes its
     own rather than inheriting numbers fitted to someone else's metre. ---- */
  const eyeHeight = opts.eyeHeight != null ? opts.eyeHeight : 0.28;
  const radius = opts.radius != null ? opts.radius : 0.09;
  const footR = opts.footR != null ? opts.footR : 0.12;      // the ground query's own probe radius
  const moveSpeed = opts.moveSpeed != null ? opts.moveSpeed : 0.55;
  const sprintSpeed = opts.sprintSpeed != null ? opts.sprintSpeed : 0.95;
  const accel = opts.accel != null ? opts.accel : 14;
  /* AIR CONTROL IS A FRACTION OF GROUND ACCELERATION, not a separate speed. Scaling the ACCEL (rather
     than the target speed) is what makes a jump keep its momentum: the desired velocity is still full
     walk speed, you just converge on it slowly, so you arc instead of turning on a dime in mid-air.
     0.35 is enough to correct a landing and not enough to fly. */
  const airControl = opts.airControl != null ? opts.airControl : 0.35;
  /* GRAVITY MATCHES THE GRAPPLE'S 5.4 EXACTLY, and that is a seam requirement rather than a taste:
     the two integrators hand the same body back and forth mid-flight, so a mismatch would read as the
     character getting heavier the instant a web cut. One number, stated once. */
  const gravity = opts.gravity != null ? opts.gravity : 5.4;
  /* JUMP IS SPECIFIED AS A SPEED, and the apex it buys is v²/2g — 1.2 u/s under gravity 5.4 tops out
     0.133 u above the take-off foot, which at this city's scale is ≈0.81 m and ≈0.48 eye-heights: a
     readable human hop that clears a kerb and not a roof. Hang time is 2v/g ≈ 0.44 s. */
  const jumpSpeed = opts.jumpSpeed != null ? opts.jumpSpeed : 1.2;
  /* COYOTE TIME — you may still jump for this long AFTER walking off an edge. It exists because the
     honest simulation is unfair: a player presses jump at the visual edge, by which time the body has
     already left the floor, and the input is silently eaten. 0.12 s is the genre's standard window and
     is under the ~0.15 s a player can consciously perceive, so it reads as "it worked", never as a
     cheat. Set 0 for a strict simulation. */
  const coyoteTime = opts.coyoteTime != null ? opts.coyoteTime : 0.12;
  /* JUMP BUFFER — the mirror-image forgiveness. Press jump slightly BEFORE landing and it fires on
     touchdown rather than being dropped. Same reason, opposite sign of the same human error. */
  const jumpBuffer = opts.jumpBuffer != null ? opts.jumpBuffer : 0.12;
  const maxFall = opts.maxFall != null ? opts.maxFall : 12;   // terminal velocity (u/s), tunnel guard
  /* STEP-UP — how far above the feet the ground query may look. It is the kerb/step tolerance AND the
     anti-teleport clamp: ask for the highest solid with no ceiling and you snap onto the tower you are
     standing next to. Small on purpose. */
  const stepUp = opts.stepUp != null ? opts.stepUp : 0.06;
  const skim = opts.skim != null ? opts.skim : 0.06;          // clearance above the floor (grapple's own idiom)
  const sensitivity = opts.sensitivity != null ? opts.sensitivity : 0.0022;   // rad per pixel
  const pitchUp = (opts.pitchUp != null ? opts.pitchUp : 78) * D;
  const pitchDown = (opts.pitchDown != null ? opts.pitchDown : 78) * D;
  /* PITCH IS WIDER THAN THE WALKER'S ±55°, because this body AIMS. The web you want is directly
     overhead more often than not, and a 55° ceiling means the crosshair physically cannot reach the
     anchor above your head — the same class of clamp-blindness A-AIM had to widen chaseElevMin for. */

  /* ---- THE TWO CAMERAS, each with its own block. See the header for why they are not one. ---- */
  const third = Object.assign({
    dist: 0.9,        // u behind the pivot — ≈3.2 body-heights at this scale; the arc fits the frame
    height: 0.34,     // u above the feet the pivot sits (just over the shoulder line)
    side: 0.14,       // u to the RIGHT — the over-the-shoulder offset that keeps the body off the mark
    springR: 0.06,    // spring-arm probe radius; the eye pulls in when a facade gets behind you
    minDist: 0.12,    // …but never all the way into the body
    /* A-LAB: THE SPEED DOLLY. `dist` is the chase at rest; `distMax` is the chase at `distAtSpeed`
       and beyond, eased at `distRate`. Insomniac raise the follow distance WITH the FOV as speed
       climbs (the pair reads as a dolly-zoom, and a teardown of the shipped game notes both rising
       together). It also solves a framing problem measured here by LOOKING at a capture: a chase
       tuned to survive metropolis's 0.55 u street canyons is 0.9 u, and at 0.9 u — pulled to 0.42 u
       by the spring arm — the body FILLS the frame mid-swing. You cannot time a release you cannot
       see, which is this controller's own stated reason for defaulting to third person.
       DEFAULTS TO NO DOLLY (`distMax` null ⇒ `dist` at every speed), so an existing consumer is
       unchanged; a project with room opts in by naming one number. */
    distMax: null,
    distAtSpeed: 6,
    distRate: 2.4,
  }, opts.third || {});
  let chaseNow = third.dist;
  const first = Object.assign({
    bob: 0.03,        // u of head bob at full stride — sells footfall in FP and is meaningless in TP
    bobRate: 9,
  }, opts.first || {});
  /* ---- A-LAB (2026-08-09): FIELD OF VIEW AS THE SPEED CUE. -------------------------------------
     A swing's speed is almost invisible in a chase camera at a fixed FOV: the body barely moves in
     frame, so 3 u/s and 7 u/s look the same. Insomniac widen the FOV with speed for exactly this
     ("Concrete Jungle Gym", GDC 2019 — debug values around 53° at rest to 71° at pace), and an
     independent teardown of the shipped game notes the FOV and the follow distance rise together,
     producing a dolly-zoom that reads as acceleration.
     THIS IS OPT-IN BY CALL SITE, and that is what makes it regression-free: the curve and its easing
     live here, but nothing applies them unless a project calls `cameraFov(dt)` and writes the result
     to its camera. A consumer that never calls it renders byte-identically to before this existed. */
  const fov = Object.assign({
    base: 60,         // ° at rest
    max: 78,          // ° at `atSpeed` and beyond
    atSpeed: 7,       // u/s where the widening saturates
    rate: 3.2,        // easing rate — fast enough to feel like acceleration, slow enough not to pump
  }, opts.fov || {});
  let fovNow = fov.base;
  let view = opts.view === 'first' ? 'first' : 'third';   // THIRD is the default (the owner's ruling)

  /* ---- THE SHARED BODY STATE. This exact object is what `createGrappleModel.step` mutates, which is
     why it carries the pilot vocabulary (vx/vy/vz/yaw/pitch/bank/speed/quat/anchor/rope) verbatim.
     A conversion layer between "my character" and "the pilot state" is precisely the seam a momentum
     bug would hide in, so there isn't one. ---- */
  const state = {
    x: opts.x || 0, y: opts.y || 0, z: opts.z || 0,
    vx: 0, vy: 0, vz: 0,
    yaw: opts.yaw || 0, pitch: 0, bank: 0, speed: 0,
    quat: new THREE.Quaternion(),
    anchor: null, rope: 0, refire: 0, hang: 0, rose: false,
  };
  let lookYaw = opts.yaw || 0, lookPitch = 0;
  let grounded = false, coyote = 0, buffered = 0, jumpHeld = false, bobT = 0;
  let jumps = 0, landings = 0, airT = 0, lastAirT = 0, apex = -Infinity, jumpFromY = 0, lastJumpRise = 0;
  let swinging = false;
  const _euler = new THREE.Euler();          // hoisted: an Euler per frame is a hot-path allocation

  /* THE ONE GROUND ANSWER. Every part of this controller — the walk floor, the fall test, the landing
     snap, the walker's own collision probe height — reads THIS function, and the grapple reads the same
     `world` bag it is built from. Two ground functions that disagree by a few centimetres is how a body
     pops between owners on the frame a web cuts; there is exactly one here.
     `yMax` is the CEILING of the search and it is what stops a rooftop teleport: a roof is ground only
     if it is within a step of where your feet already are (collide.js's surfaceAt note). */
  function groundAt(x, z, yMax) {
    const base = world.heightAt ? world.heightAt(x, z) : 0;
    const roof = world.surfaceAt ? world.surfaceAt(x, z, yMax, footR) : -Infinity;
    return roof > base ? roof : base;
  }

  /* The horizontal half, delegated. `groundY` is fed the character's LIVE y so the walker's spatial
     collision probe tests the building slice you are actually standing in — at street level the facade
     blocks you, on a roof it does not. (That hook is why the walker did not have to be modified to
     gain a vertical axis: it already asked someone else where the floor was.) */
  const walker = createFirstPersonWalker({
    eyeHeight, moveSpeed, sprintSpeed, accel, radius, sensitivity,
    arenaRadius: opts.arenaRadius != null ? opts.arenaRadius : Infinity,
    colliders: opts.colliders || [], aabbs: opts.aabbs || [],
    groundY: () => state.y,
    resolveSpatial: world.resolveSphere
      ? (st, dt) => world.resolveSphere(st, dt, {
          r: radius, yOff: opts.collideYOff != null ? opts.collideYOff : eyeHeight * 0.5,
          PUSH_MAX: 6, SLIDE_FRICTION: 0.85, SKIN: 0.02,
        })
      : null,
    x: state.x, z: state.z, yaw: state.yaw,
  });

  const grapple = opts.grapple || null;
  const gProfile = opts.grappleProfile || null;
  const _gAxes = { steer: 0, lift: 0, throttle: 0, boost: 0, fire: false, aimPoint: null };

  /* ---- LOOK. Same 1:1 pointer-lock convention as the walker (grab-the-world: dragging right looks
     left), so a project that already routes drags to `walker.addLook` gets identical feel here. ---- */
  function addLook(dx, dy) {
    lookYaw -= dx * sensitivity;
    lookPitch = clamp(lookPitch - dy * sensitivity, -pitchDown, pitchUp);
  }

  /* ---- THE FRAME ------------------------------------------------------------------------------- */
  function update(dt, input = {}) {
    if (!(dt > 0)) dt = 0;
    const sprint = !!(input.sprint || (input.boost || 0) > 0.5);
    const fire = !!input.fire;
    /* THE RE-FIRE BEAT IS TICKED HERE, and forgetting it is a real bug this seam creates. `refire` is
       normally decremented inside `grapple.step`, which now only runs while the line is UP — so after
       a cut the timer would freeze at its full value and the character could never web again. Owning
       the body means owning its clocks. */
    state.refire = Math.max(0, (state.refire || 0) - dt);

    /* 1) THE WEB, FIRST, because attaching must be able to interrupt a walk on the very frame the
       button goes down — a web you have to be airborne to throw is a mode, and a mode is the thing
       this controller exists not to be. `attach` is a pure query+assign on the state (pilot.js's own
       section-1 block, factored out for exactly this): it either hangs a rope or does nothing, and it
       never integrates. So a fire with nothing in range costs you no movement at all. */
    if (grapple && grapple.attach && fire && !state.anchor) {
      _gAxes.aimPoint = input.aimPoint || null;
      _gAxes.fire = true; _gAxes.boost = input.boost || 0;
      _gAxes.steer = input.steer || 0; _gAxes.lift = input.lift || 0; _gAxes.throttle = 0;
      grapple.attach(state, _gAxes, world);
    }
    /* …and publish the reach verdict every frame whether or not the trigger is down, so a crosshair can
       dim on the SAME rule the attach uses. One implementation of "in range", read twice — the drift
       between a HUD's copy and the mechanic's is invisible until the day a bright mark fires nothing. */
    if (grapple && grapple.reach && gProfile && gProfile.aimMode === 'point') {
      state.aimInRange = !!grapple.reach(state, input.aimPoint || null);
    } else state.aimInRange = undefined;

    swinging = !!state.anchor;
    if (swinging) {
      /* 2a) ROPED — the grapple owns the whole body. Everything it does (pendulum constraint, pump,
         wall sweep, auto-release, the launch flick) is measured-good and is not second-guessed here.
         It cuts its own line when `fire` goes false, and on that frame `state.anchor` becomes null —
         so the very next frame falls through to 2b with the arc's velocity intact. That IS the landing
         path: no handoff code, because there is nothing to hand over. */
      _gAxes.steer = input.steer != null ? input.steer : (input.x || 0);
      _gAxes.lift = input.lift || 0;
      _gAxes.throttle = 0;                       // this body's forward is WALK, never a grapple throttle
      _gAxes.boost = input.boost || 0;
      _gAxes.fire = fire;
      _gAxes.aimPoint = input.aimPoint || null;
      grapple.step(state, _gAxes, dt, world);
      walker.setPosition(state.x, state.z);      // keep the horizontal half in sync for the frame we land
      walker.setYaw(state.yaw);
      grounded = false; coyote = 0;
      bobT *= (1 - Math.min(1, dt * 4));
      airT += dt;
      if (state.y > apex) apex = state.y;
    } else {
      /* 2b) FREE — walking, running, jumping, falling. All four are the same integrator; what changes
         is whether there is a floor under the feet and how much of the accel the air lets you use. */
      const prevY = state.y;

      // --- VERTICAL: gravity, then the floor, then the two forgiveness timers.
      state.vy -= gravity * dt;
      if (state.vy < -maxFall) state.vy = -maxFall;
      state.y += state.vy * dt;

      // --- HORIZONTAL: the walker, with the accel scaled by the air (see `airControl`).
      walker.setYaw(lookYaw);
      walker.update(dt, { x: input.x || 0, y: input.y || 0, sprint, control: grounded ? 1 : airControl });
      state.x = walker.x; state.z = walker.z;

      /* THE FLOOR — and the CEILING of the query is the position we were CLEAR AT, not the one we
         just fell to. That single choice is the anti-tunnel guard: a body falling 0.3 u in one frame
         past a 0.2 u-thick roof would, asked from its NEW y, see nothing above it and keep going. Ask
         from where the feet were and the roof is still in range to be landed on. */
      const floor = groundAt(state.x, state.z, Math.max(prevY, state.y) + stepUp) + skim;
      if (state.y <= floor && state.vy <= 0) {
        if (!grounded) { landings++; lastAirT = airT; lastJumpRise = apex - jumpFromY; }
        state.y = floor;
        state.vy = 0;
        grounded = true; coyote = coyoteTime; airT = 0; apex = -Infinity;
      } else if (grounded && state.y > floor + 1e-4) {
        /* WALKED OFF AN EDGE. Not a jump — no impulse, no counter, just the loss of the floor. This
           is the branch metropolis never had: the old walker re-seated the eye on whatever ground was
           under it, so a roof edge was a STAIRCASE down to the street. Now the floor simply stops
           being there and gravity is already running. */
        grounded = false; coyote = coyoteTime; jumpFromY = prevY; apex = prevY;
      } else if (!grounded) {
        coyote = Math.max(0, coyote - dt);
        airT += dt;
        if (state.y > apex) apex = state.y;
      }

      // --- THE JUMP. Edge-triggered (a HELD key must not re-fire on landing), and allowed from either
      //     the floor or the coyote window. A press with neither is not thrown away — it is BUFFERED.
      const jumpNow = !!input.jump;
      const pressed = jumpNow && !jumpHeld;
      jumpHeld = jumpNow;
      if (pressed) buffered = jumpBuffer;
      else buffered = Math.max(0, buffered - dt);
      if (buffered > 0 && (grounded || coyote > 0)) {
        state.vy = jumpSpeed;
        jumpFromY = state.y; apex = state.y;
        grounded = false; coyote = 0; buffered = 0; airT = 0;
        jumps++;
      }

      /* BOOKKEEPING THE REST OF THE ENGINE READS OFF A PILOT STATE. `vx`/`vz` are mirrored from the
         walker's own horizontal velocity — not zeroed — because they are the momentum the grapple
         inherits the instant a web attaches mid-stride. Zeroing them would make every web thrown
         while running start from a dead stop, which is the "you land and keep walking" seam failing
         in the other direction. `speed` is the shared scalar the HUD and the anchor search read. */
      state.vx = walker.vx; state.vz = walker.vz;
      state.speed = Math.hypot(state.vx, state.vy, state.vz);
      if (walker.moving) state.yaw = lookYaw;    // you face where you walk; standing still keeps the last facing
      if (walker.moving && grounded) bobT += dt; else bobT *= (1 - Math.min(1, dt * 4));
    }

    /* 3) THE BODY'S ORIENTATION, for whatever mesh the project hangs on this. While roped the grapple
       already wrote pitch/bank from the arc; while free the body simply stands up and faces its walk
       direction. Written through the same quaternion either way so a consumer has one thing to read. */
    if (!swinging) {
      state.pitch = 0; state.bank = 0;
      _euler.set(0, state.yaw, 0, 'YXZ');
      state.quat.setFromEuler(_euler);
    }
    state.grounded = grounded;
    state.airborne = !grounded && !swinging;
    state.swinging = swinging;
    tickChase(dt);              // the camera's own eases, ticked exactly once per frame (see tickChase)
    return state;
  }

  /* ---- THE CAMERA ------------------------------------------------------------------------------
     Both views return a POSITION and a look DIRECTION, and the direction is the SAME in both: the look
     vector the mouse steers. That identity is what makes the crosshair honest in third person — the
     mark is at screen centre, the camera looks down `lookDir`, so `resolveAimPoint` (which reads the
     camera's own forward) marks exactly the point a web would fly at. An over-the-shoulder rig that
     toed the camera IN toward a focus point would put the mark somewhere the ray never goes.

     THE SPRING ARM is the third-person half's only real complication: a chase eye in a 0.55 u street
     canyon spends its life with a facade behind it, so the arm asks `segmentHit` how far back the eye
     may sit and pulls in when the answer is "not that far". Same query the pilot chase already uses. */
  const _pos = { x: 0, y: 0, z: 0 }, _dir = { x: 0, y: 0, z: 0 };
  /* The DESIRED arm length before the spring sweep clips it. Eased on the same horizontal-speed
     reading the FOV cue uses, so the two cues move together instead of fighting. `cameraPose` has no
     dt (a consumer may call it more than once a frame for a reflection or a probe), so the ease is
     ticked from `update` — the one place that is guaranteed to run exactly once per frame. */
  function tickChase(dt) {
    if (third.distMax == null) { chaseNow = third.dist; return; }
    const hs = Math.hypot(state.vx, state.vz);
    const k = clamp(hs / Math.max(1e-3, third.distAtSpeed), 0, 1);
    const goal = third.dist + (third.distMax - third.dist) * k;
    chaseNow += (goal - chaseNow) * (1 - Math.exp(-third.distRate * (dt > 0 ? dt : 0)));
  }
  function lookDir(out) {
    const cp = Math.cos(lookPitch);
    out.x = Math.sin(lookYaw) * cp; out.y = Math.sin(lookPitch); out.z = Math.cos(lookYaw) * cp;
    return out;
  }
  function cameraPose(outPos = _pos, outDir = _dir) {
    lookDir(outDir);
    if (view === 'first') {
      outPos.x = state.x;
      outPos.y = state.y + eyeHeight + Math.sin(bobT * first.bobRate) * first.bob * (walker.moving && grounded ? 1 : 0);
      outPos.z = state.z;
      return outPos;
    }
    /* THE ARM IS SWEPT IN TWO STAGES, AND BOTH STAGES ARE LOAD-BEARING — found by looking at a
       screenshot, not by reading. The first version swept only the BACKWARD arm from an already-offset
       pivot, and the mid-swing capture came back as a full-frame close-up of a facade's inside: a
       character hanging off a web is FLUSH WITH THE WALL IT WEBBED (a pendulum hung from a point on a
       vertical face bottoms out against that face — the same geometric fact pilot.js's A-SOLID note
       records), so the 0.14 u SHOULDER OFFSET alone had already pushed the pivot into the building
       before the backward sweep ever ran. `segmentHit` returns 0 from an enclosed origin, so the arm
       "pulled in" to `minDist` — which is 0.12 u behind a pivot that was already inside a wall.
         1) sweep the SHOULDER OFFSET out from the head, and shorten it if a wall is in the way;
         2) sweep the ARM back from the (now legal) pivot;
         3) if what survives is shorter than `minDist` there is no room for a chase at all — COLLAPSE
            to the head rather than sit in geometry. A third-person camera that briefly becomes first
            person in a tight spot is the standard, and it is strictly better than one that renders the
            inside of a building. */
    const rx = -Math.cos(lookYaw), rz = Math.sin(lookYaw);          // camera RIGHT (same basis the walker strafes on)
    const hx = state.x, hy = state.y + third.height, hz = state.z;  // the head, before any offset
    let side = third.side;
    if (world.segmentHit && side !== 0) {
      const t = world.segmentHit(hx, hy, hz, hx + rx * side, hy, hz + rz * side, third.springR);
      if (t < 1) side *= Math.max(0, t);
    }
    const px = hx + rx * side, py = hy, pz = hz + rz * side;
    let dist = chaseNow;
    if (world.segmentHit) {
      const t = world.segmentHit(px, py, pz, px - outDir.x * dist, py - outDir.y * dist, pz - outDir.z * dist, third.springR);
      if (t < 1) dist *= Math.max(0, t);
    }
    if (dist < third.minDist) {                                     // no room — sit at the head
      outPos.x = state.x; outPos.y = state.y + eyeHeight; outPos.z = state.z;
      return outPos;
    }
    outPos.x = px - outDir.x * dist;
    outPos.y = py - outDir.y * dist;
    outPos.z = pz - outDir.z * dist;
    return outPos;
  }

  /* A-LAB: the eased FOV for the CURRENT speed. Read HORIZONTAL speed, not the 3D magnitude — a
     straight drop is not the thing this cue is for, and a body that widens the frame every time it
     falls reads as panic rather than pace. Returns degrees; the caller writes it to its own camera
     (and must call updateProjectionMatrix itself, because that is the caller's camera to invalidate). */
  function cameraFov(dt) {
    const hs = Math.hypot(state.vx, state.vz);
    const k = clamp(hs / Math.max(1e-3, fov.atSpeed), 0, 1);
    const goal = fov.base + (fov.max - fov.base) * k;
    fovNow += (goal - fovNow) * (1 - Math.exp(-fov.rate * (dt > 0 ? dt : 0)));
    return fovNow;
  }

  return {
    update, addLook, cameraPose, lookDir, cameraFov,
    setPosition(x, y, z) {
      state.x = x; state.z = z;
      walker.setPosition(x, z);
      state.y = y != null ? y : groundAt(x, z, Infinity) + skim;
      state.vx = 0; state.vy = 0; state.vz = 0;
      state.anchor = null; state.rope = 0; state.refire = 0;
      grounded = false; coyote = 0; buffered = 0; airT = 0; apex = -Infinity; jumpFromY = state.y;
    },
    setYaw(r) { lookYaw = r; state.yaw = r; walker.setYaw(r); },
    recenterPitch() { lookPitch = 0; },
    setView(v) { view = v === 'first' ? 'first' : 'third'; return view; },
    toggleView() { view = view === 'first' ? 'third' : 'first'; return view; },
    setColliders(list) { walker.setColliders(list); },
    setAabbs(list) { walker.setAabbs(list); },
    state, walker,
    get view() { return view; },
    get grounded() { return grounded; },
    get airborne() { return !grounded && !swinging; },
    get swinging() { return swinging; },
    get moving() { return walker.moving; },
    get x() { return state.x; }, get y() { return state.y; }, get z() { return state.z; },
    get lookYaw() { return lookYaw; }, get lookPitch() { return lookPitch; },
    get eyeHeight() { return eyeHeight; },
    // verification handles — the probe reads these rather than re-deriving them from samples
    get jumps() { return jumps; }, get landings() { return landings; },
    get airTime() { return airT; }, get lastAirTime() { return lastAirT; },
    get lastJumpRise() { return lastJumpRise; },
    get coyote() { return coyote; },
    groundAt,
  };
}
