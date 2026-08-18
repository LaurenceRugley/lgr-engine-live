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
       *** AND THAT LAST SENTENCE WAS A CLAIM, NOT A FACT, FOR THE WHOLE OF A-CHAR — corrected in
       A-LOCK (2026-08-09), and left standing rather than quietly rewritten, because "the architecture
       makes this impossible" is precisely the confidence that stopped anyone measuring it. A shared
       state object is NOT a lossless seam if a DELEGATE keeps its own copy of a field. The walker owns
       x/z and its own vx/vz; the roped branch called `walker.setPosition` every frame to keep them in
       step, `setPosition` zeroes velocity (correctly — a teleport has none), and the free branch's
       `state.vx = walker.vx` handed that zero straight back. Measured: a body released from a swing at
       3.6 u/s horizontal covered 0.00 u over 181 frames. It is true now — see `handOff()` below. ***

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

   `input` = { x, y, sprint|boost, jump, fire, web, lift, steer, aimPoint } — the same axis vocabulary
   the rest of the engine speaks, so a project wires ONE key map for the whole character.

   TWO CONTROL SCHEMES LIVE HERE, chosen by whether `input.web` is supplied at all (A-LOCK, 2026-08-09):
     · LEGACY / hold-to-swing — pass `fire` and never `web`. The trigger IS the rope: it attaches while
       held and cuts when released, and `autoRelease` in the profile cuts it for you at the top of the
       arc. metropolis is on this path and every PROVEN row in swing-ledger.md was measured on it.
     · LATCHED / lock-and-launch — pass `web` (and keep passing `jump`). The owner's scheme: the button
       THROWS one web per press, the rope stays up on its own, and SPACE cuts it with a launch. Space
       still jumps when grounded — and, since A-WALLJUMP (2026-08-18), LEAPS OFF a wall you are
       clinging to. One verb, "get air", in EVERY state — grounded, roped, on the wall — which is the
       point of binding them together rather than to three keys. (The wall was the gap for a whole
       audit cycle: R4 recorded Space being silently eaten while clinging.)
   Nothing selects between them at runtime except the presence of that one field, so a consumer cannot
   half-adopt it and end up with a rope that answers to two masters.
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
  /* ---- A-LOCK (2026-08-09): HOW FAR ABOVE THE GROUND THE CAMERA MAY GET. -----------------------
     The audit case nobody had tested, and it was broken: the third-person spring arm asks
     `world.segmentHit`, which in every world in this repo tests the BUILDING colliders and nothing
     else — the ground is a plane or a heightfield, not a box. So aiming up (which is most of what an
     aimed swing does: the anchors are overhead) swings the arm DOWN and straight through the floor,
     and the frame fills with the underside of the world. Fixed by clamping the eye against the same
     `groundAt` every other part of this controller reads, which is also why it needs no new query.
     0.08 u ≈ 0.5 m at the metropolis scale: enough that the near plane (0.02) never sees through. */
  const camGroundClear = opts.camGroundClear != null ? opts.camGroundClear : 0.08;
  /* ---- A-CLIMB (2026-08-10): HOW MUCH ROOM THE EYE ITSELF MUST KEEP FROM A SOLID. ---------------
     THE OWNER SAID HE WAS STILL CLIPPING THROUGH BUILDINGS AND EVERY CHECK SAID HE WAS NOT. He was
     right; the checks were measuring the wrong point. `segmentHit` sweeps and `enclosed` tests are
     both about the eye POSITION, and a camera does not render from a point — it renders from a NEAR
     PLANE, a rectangle `near` in front of the eye whose corners stick out `hypot(near, near·tan(fov/2)·aspect,
     near·tan(fov/2))` from it. Measured in projects/swing-lab: through a real swing the eye was
     enclosed on 0 of 260 frames (which is what the old probe asserted, and it was true) while a
     near-plane CORNER was inside a solid on 52 — 20% of the arc — with the eye 0.0200 u off the
     facade and the corners reaching 0.0320 u. 0.032 > 0.020, so the frustum's front face was in the
     wall while the eye was outside it, and the frame filled with the inside of a building.
     WHY THE EYE GETS THAT CLOSE AT ALL is not a bug in the spring arm: it is the COLLAPSE branch
     below (no room for a chase ⇒ sit at the head) plus first person, and a body hanging off a web is
     FLUSH WITH THE FACADE IT WEBBED by construction (pilot.js's A-SOLID note) — 0.02 u off it, which
     is the grapple's own `wallStop`. So the head is a legal place for the BODY and an illegal place
     for a CAMERA, and nothing had ever measured the difference.
     THE FIX IS A CLEARANCE, NOT A SWEEP: after every branch has chosen a position, push the eye out
     of anything within `camEyeClear` along the axis that is blocking. Six rays, bounded, no state.
     DEFAULTS TO 0 (OFF) so every existing consumer is byte-identical — the same opt-in shape
     `third.distMax` and `fov` use above. A project switches it on by naming its own number, and
     `cameraNearRadius()` in camera-rig.js computes the honest one from its camera. */
  const camEyeClear = opts.camEyeClear != null ? opts.camEyeClear : 0;
  // the height up the body the horizontal collision sphere sits at (see the feet-pass note below)
  const collideYOff = opts.collideYOff != null ? opts.collideYOff : eyeHeight * 0.5;
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

  /* ---- A-CLIMB (2026-08-10): WALL CLING, LIFTED INTO THE CHARACTER. -----------------------------
     swing-ledger.md OPEN #2, closed: "the character has no wall CLING… cling lives in the `!anchor`
     branch of `createGrappleModel.step`, which this controller never runs, so it is unreachable."
     That was exactly right, and this is the lift. The RULE is pilot.js's own, term for term, because
     two climbs with two rules is how a body behaves differently depending on which integrator happens
     to own it: a short ray at arm's length says whether a facade is there, and the LIFT AXIS being
     held is the opt-in. Sticking on mere CONTACT is refuted and stays refuted (pilot.js's note: it
     shipped a swinger that touched a wall on its first fall and froze at speed 0 — most of a city is
     within arm's reach of a wall, so "near a wall" cannot be the trigger).
     WHAT IS GENUINELY NEW HERE, AND WHY THE PILOT VERSION COULD NEVER GET YOU TO A ROOF: the pilot
     cling has no TOP-OUT. Climb to the lip and the ray goes clear, cling ends, gravity resumes, and
     you fall back down the face you just climbed — the wall is climbable and the building is not.
     `mantle` is the missing half: the frame the wall runs out from under a CLIMBING body, ask whether
     there is a roof a step ahead at about the height your feet have reached, and if so put the body
     on it. It is a short deliberate move (the standard mantle), not a physics hope, so it cannot
     half-succeed — and it lands ON a solid by construction, never inside one.
     THE PROBE RAY STARTS AT THE FEET, and that is what makes the top-out land where it should: a ray
     from mid-body would go clear while the feet were still `collideYOff` BELOW the roof, and the
     mantle would be asked to step onto a surface above its own head.
     DEFAULTS OFF, like every other ability added to this file after its consumers existed. */
  /* The climb's two physical numbers come from the GRAPPLE PROFILE when there is one, so a project
     that already tuned `clingReach`/`climbRate` for its scale does not get a second, silently
     different copy of them here. Stated once, read twice. */
  const _gp = opts.grappleProfile || {};
  const cling = Object.assign({
    enabled: false,
    reach: _gp.clingReach != null ? _gp.clingReach : 0.24,     // u — how close a facade must be
    climbRate: _gp.climbRate != null ? _gp.climbRate : 1.15,   // u/s up the wall on a held lift
    probeR: 0.05,      // the cling ray's thickness — pilot.js's own number
    probeY: 0.02,      // u above the FEET the ray is cast from (see the note above)
    mantle: 0.30,      // u forward the top-out step goes — must exceed the walker's own stand-off
                       // (radius 0.09 + the resolver's 0.02 SKIN) or it steps back onto the facade
    mantleUp: 0.22,    // u above the feet a lip may still be and be mantled onto
    mantleDrop: 0.30,  // u below the feet a roof may be and still count (a lower lip is a DROP, not a top-out)
    /* ---- A-WALLJUMP (2026-08-18): SPACE ON THE WALL IS A LEAP OFF IT — audit R4's missing verb.
       "Space = get air" already meant jump on the ground and release-with-a-launch on a rope; the wall
       was the one state where the press was silently EATEN (the climb zeroed `buffered` and returned
       before the jump block ever saw it). Now it detaches and throws the body OFF the facade: UP at
       `jumpUp`×jumpSpeed, OUT along the REVERSE of the cling ray (the outward normal that ray already
       implies — you climb where you look, so you leap away from where you look) at `jumpOut`×jumpSpeed.
       BOTH halves derive from the grounded jump's own impulse rather than a new constant: at 1×/1× the
       leap is that exact hop rotated 45° off the wall — the same v²/2g rise (0.133 u at the metropolis
       scale), and the out half crosses a 0.55 u street canyon in about one hang time (2v/g ≈ 0.44 s),
       which is what makes facade-to-facade chains land. The two exits stay DISTINCT: releasing the
       lift axis is still the plain drop; Space is the leap. `rejump` blanks the cling ray briefly
       after a leap — without it the very next frame re-clings (the body is still within `reach` and
       the axis is still held) and the leap is silently deleted; 0.25 s ≈ reach / (jumpOut·jumpSpeed)
       with margin, i.e. just long enough to outrun the ray it is hiding from. */
    jumpUp: 1.0,       // × jumpSpeed, vertical half of the leap
    jumpOut: 1.0,      // × jumpSpeed, horizontal push off the facade
    rejump: 0.25,      // s the cling ray is ignored after a leap (see above for the derivation)
  }, opts.cling || {});

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
  /* ---- A-LOCK: THE LATCHED WEB. `webHeld` is the edge detector for `input.web`; `webLatched` is the
     rope's own state, and it is what makes this scheme different from the old one. Under hold-to-swing
     the TRIGGER *was* the rope: let go and the line cut, so a long swing was a button-hold endurance
     test. Here the fire button only ever throws the web, and the rope stays up until the player cuts
     it with the SAME key that jumps — "get air", one verb, both states, which is the owner's own
     framing and the reason it is one key and not two. ---- */
  let webHeld = false, webLatched = false;
  let webs = 0, releases = 0, lastReleaseSpeed = 0, lastReleaseY = 0;
  // A-CLIMB: the cling's whole state is "am I stuck to a wall this frame", plus two counters a probe
  // reads instead of inferring the ability from a y trace.
  let clinging = false, climbs = 0, mantles = 0, clingT = 0;
  // A-WALLJUMP: the leap's own counted receipt, and the post-leap blank on the cling ray (see `rejump`)
  let wallJumps = 0, clingCool = 0;
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
      ? (st, dt) => {
          world.resolveSphere(st, dt, { r: radius, yOff: collideYOff, PUSH_MAX: 6, SLIDE_FRICTION: 0.85, SKIN: 0.02 });
          /* ---- THE FEET PASS (A-LOCK, 2026-08-09) — and it is deliberately NARROW. --------------
             The horizontal resolve is ONE sphere at `collideYOff`, so its vertical reach is that
             height ±`radius`: with the defaults it sees 0.05 u to 0.23 u up the body and is BLIND to
             anything whose top lies in the bottom 5 cm. That band is not hypothetical — it is where
             the last containment failure lived, and the diagnostic printed its geometry rather than
             a count: `feet: true, mid: false, head: false, belowTop: 0.0445, vy: +1.585`. A body
             launched off a swing, rising past a roof EDGE, drifts horizontally into the footprint at
             a height where only its feet are below the roof top. Six frames in 11 527, none of them
             roped, the fastest at 4.87 u/s — so not tunnelling, and no amount of sub-stepping would
             have found it. (swing-ledger.md's guard-scope lesson, exactly: a guard's green only covers
             what its sample can SEE.)
             WHY IT IS GATED ON *RISING AND AIRBORNE* rather than run always, which is the interesting
             half. A second sphere down at the feet overlaps the roof you are STANDING on — its bottom
             sits below the surface by construction — so an ungated version would shove you off every
             rooftop perch, and one gated only on `airborne` would shove you sideways out of the
             footprint on the frame you DESCEND through the roof plane, i.e. delete the rooftop
             landing. Going up through a roof is a defect; coming down onto one is the feature. The
             sign of `vy` is exactly the difference, so it is the gate. */
          if (!grounded && state.vy > 0) {
            world.resolveSphere(st, dt, { r: radius, yOff: radius, PUSH_MAX: 6, SLIDE_FRICTION: 0.85, SKIN: 0.02 });
          }
        }
      : null,
    x: state.x, z: state.z, yaw: state.yaw,
  });

  const grapple = opts.grapple || null;
  const gProfile = opts.grappleProfile || null;
  const _gAxes = { steer: 0, lift: 0, throttle: 0, boost: 0, fire: false, aimPoint: null };

  /* ---- THE HAND-OFF (A-LOCK, 2026-08-09) — and this is the seam this module's header CLAIMED it had
     and did not. The claim: "the moment the line cuts, this controller takes the same velocity back
     and flies it as a jump… no conversion, which is exactly why the transition preserves momentum
     instead of approximating it." The measurement: a body released from a swing at 3.6 u/s horizontal
     covered 0.00 u over 181 frames. Straight up, straight down.
     THE CAUSE WAS TWO CORRECT LINES IN COMBINATION, which is why reading either one found nothing.
     While roped, this branch kept the walker's x/z in step with the arc via `walker.setPosition` —
     and `setPosition` zeroes velocity, because a teleport has none. So the walker sat at zero for the
     whole swing, and the free branch's `state.vx = walker.vx` then overwrote the arc's momentum with
     that zero on the very first frame after the cut. The state object was shared; the WALKER's copy
     was not, and it was the one that won.
     Called every roped frame rather than on the cut EDGE, deliberately: there are four ways a line
     ends (Space, `maxHang`, the floor, a zip arriving) and an edge-triggered version would have to
     know all of them. Keeping the walker continuously loaded with the arc's velocity means whichever
     frame the rope ends on, the momentum is already there — the repo's own "entry paths don't guard
     what exit paths clear" lesson, applied by removing the edge instead of enumerating it. ---- */
  function handOff() {
    walker.setPosition(state.x, state.z);        // position first — it zeroes velocity, so it goes first
    walker.setVelocity(state.vx, state.vz);      // …then the momentum the arc built
  }

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
    /* ---- A-LOCK: WHICH CONTROL SCHEME IS THIS CONSUMER SPEAKING? -------------------------------
       Decided by whether `input.web` was supplied AT ALL, not by a mode flag, so an existing consumer
       that has never heard of it is bit-for-bit unchanged (metropolis passes `fire` and only `fire`).
         · LATCHED  (`web` present): the button THROWS the web; the rope stays up until Space or a
           natural break. This is the owner's scheme.
         · LEGACY   (`fire` only):   the button IS the rope; letting go cuts it. Every PROVEN row in
           swing-ledger.md was measured on this path, so it does not move. */
    const latchedScheme = input.web !== undefined;
    /* THE JUMP EDGE IS DETECTED ONCE, AT THE TOP, and that move is load-bearing rather than tidy: it
       used to live inside the free branch, which is exactly the branch that does not run while you are
       roped — so a Space press mid-swing was literally unreachable. Space now means "get air" in both
       states, and one detector serves both. */
    const jumpNow = !!input.jump;
    const jumpPressed = jumpNow && !jumpHeld;
    jumpHeld = jumpNow;
    /* THE RE-FIRE BEAT IS TICKED HERE, and forgetting it is a real bug this seam creates. `refire` is
       normally decremented inside `grapple.step`, which now only runs while the line is UP — so after
       a cut the timer would freeze at its full value and the character could never web again. Owning
       the body means owning its clocks. */
    state.refire = Math.max(0, (state.refire || 0) - dt);
    clingCool = Math.max(0, clingCool - dt);     // A-WALLJUMP: same rule — the leap's blank is a clock too

    /* 1) THE WEB, FIRST, because attaching must be able to interrupt a walk on the very frame the
       button goes down — a web you have to be airborne to throw is a mode, and a mode is the thing
       this controller exists not to be. `attach` is a pure query+assign on the state (pilot.js's own
       section-1 block, factored out for exactly this): it either hangs a rope or does nothing, and it
       never integrates. So a fire with nothing in range costs you no movement at all. */
    const webNow = latchedScheme ? !!input.web : false;
    const webPressed = webNow && !webHeld;
    webHeld = webNow;
    /* EDGE-TRIGGERED, NOT LEVEL-TRIGGERED, and the owner's words are why: "you RIGHT CLICK to shoot a
       web". A click is one web. Auto-re-firing on a held button would quietly restore hold-to-swing
       under a different button and take the release timing back off the player — which is the whole
       thing this scheme moves to Space. */
    const wantAttach = latchedScheme ? webPressed : !!input.fire;
    if (grapple && grapple.attach && wantAttach && !state.anchor) {
      _gAxes.aimPoint = input.aimPoint || null;
      _gAxes.fire = true; _gAxes.boost = input.boost || 0;
      _gAxes.steer = input.steer || 0; _gAxes.lift = input.lift || 0; _gAxes.throttle = 0;
      if (grapple.attach(state, _gAxes, world)) { webLatched = latchedScheme; webs++; }
    }
    /* 1b) SPACE, WHILE ROPED, IS THE RELEASE — and it happens BEFORE the branch below picks an owner
       for this frame, so the launched velocity is integrated by the FREE path on the very same frame.
       That is what makes the launch instant rather than one frame of rope-constrained flight later,
       and it needs no handoff code: cutting the line simply changes which branch runs.
       The impulse is the grapple's own `releaseUp`/`releaseFwd` (pilot.js), not a number invented
       here — the model owns what a cut does to a velocity, in one place, so a player release and a
       top-out release cannot drift into two physics. */
    let pressSpent = false;                      // this press bought a release; it must not also buy a jump
    if (latchedScheme && jumpPressed && state.anchor && grapple && grapple.release) {
      lastReleaseY = state.y;
      lastReleaseSpeed = grapple.release(state, opts.release || undefined);
      webLatched = false;
      releases++;
      pressSpent = true;
      /* THE LAUNCH IMPULSE HAS TO REACH THE WALKER TOO. This frame falls through to the FREE branch,
         where the walker owns x/z — and the last hand-off it got was the previous frame's, before
         `launchFwd` was added. Without this line the forward half of the launch is silently dropped. */
      handOff();
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
      /* THE TRIGGER THE MODEL SEES IS THE LATCH, NOT THE BUTTON. `step` cuts the line the moment
         `fire` reads false (that IS hold-to-swing), so a latched rope has to keep telling it the
         trigger is down long after the click ended. The button is now an EVENT; the latch is the
         state — and this line is the whole translation between the two schemes. */
      _gAxes.fire = latchedScheme ? webLatched : !!input.fire;
      /* ONE WORD NAMES THE SCHEME, and pilot.js derives BOTH of its consequences from it — no auto
         top-out (the player owns the release) and the longer, pendulum-derived hang cap that has to
         replace it. False in the legacy scheme leaves the profile wholly in charge, so metropolis's
         held-button chain keeps its auto-release exactly as measured. */
      _gAxes.latched = latchedScheme;
      _gAxes.aimPoint = input.aimPoint || null;
      grapple.step(state, _gAxes, dt, world);
      if (!state.anchor) webLatched = false;     // a NATURAL break (maxHang, the floor, a zip arriving)
      handOff();                                 // …and the arc's momentum goes with it. See handOff.
      walker.setYaw(state.yaw);
      grounded = false; coyote = 0;
      bobT *= (1 - Math.min(1, dt * 4));
      airT += dt;
      clinging = false;                          // a rope owns the vertical; the two must never both run
      if (state.y > apex) apex = state.y;
    } else {
      /* 2b) FREE — walking, running, jumping, falling. All four are the same integrator; what changes
         is whether there is a floor under the feet and how much of the accel the air lets you use. */
      const prevY = state.y;

      /* --- 2b-i) WALL CLING + CLIMB (A-CLIMB) — BEFORE gravity, because clinging is the absence of
         falling, and after nothing, because it must be able to take the frame away from the fall.
         The ray is horizontal along the LOOK yaw rather than `state.yaw`: the body's facing is derived
         from MOTION and freezes the moment you stop (pilot.js pays for that exact fact in its steer
         fallback), and a climber is by definition not moving horizontally. You climb where you look. */
      const wasClinging = clinging;
      const liftAx = input.lift || 0;
      let wallJumped = false;                    // set by the leap below; gates the mantle this frame
      clinging = false;
      if (cling.enabled && world.segmentHit && liftAx !== 0 && clingCool <= 0) {
        const cfx = Math.sin(lookYaw), cfz = Math.cos(lookYaw);
        const cy = state.y + cling.probeY;
        const t = world.segmentHit(state.x, cy, state.z, state.x + cfx * cling.reach, cy, state.z + cfz * cling.reach, cling.probeR);
        if (t < 1) {
          /* --- A-WALLJUMP: Space, while the wall is under your hand, is the LEAP OFF IT — checked
             BEFORE the climb takes the frame, because the climb's own exit was the exact defect
             (audit R4): the press was edge-detected at the top, `buffered` was zeroed below, and the
             jump block further down never ran, so Space on a wall was silently eaten. Same shape as
             the rope's 1b: spend the press, throw the impulse, and FALL THROUGH — the free path
             integrates the launch on this very frame, so there is no one-frame cling of lag and no
             second copy of the physics. See the `jumpUp`/`jumpOut`/`rejump` block for the numbers. */
          if (jumpPressed && !pressSpent) {
            /* UP is `Math.max` rather than assignment so a body already rising faster than the hop
               (a project with climbRate > jumpSpeed) keeps its momentum — the same "never hand back
               a slower body" rule `handOff` exists for. OUT is ADDED for the same reason, though the
               climb damped the horizontal to ~0 a frame ago, so in practice it IS the impulse. */
            state.vy = Math.max(state.vy, jumpSpeed * cling.jumpUp);
            state.vx -= cfx * jumpSpeed * cling.jumpOut;
            state.vz -= cfz * jumpSpeed * cling.jumpOut;
            handOff();                           // the walker must carry the push-off, or the free
                                                 // branch reads its stale ~0 back out (the A-LOCK leak)
            clingCool = cling.rejump;            // blank the ray long enough to outrun it
            jumpFromY = state.y; apex = state.y; airT = 0;   // rise/air receipts measure THIS leap
            wallJumps++;
            pressSpent = true;                   // one press, one verb — it must not also buy a
                                                 // buffered jump off the landing (the 1b rule)
            wallJumped = true;
          } else {
            clinging = true;
            if (!wasClinging) climbs++;
            clingT += dt;
            /* Hold position against the facade and climb under the lift axis. Zeroing the horizontal
               velocity is what makes it read as ADHESION rather than a very slow slide — pilot.js's
               own wording and its own factor. The walker is told BOTH halves (position then velocity),
               because `setPosition` zeroes velocity and the free branch reads `walker.vx` back out:
               the exact leak `handOff()` exists to plug, arriving here by a second route. */
            state.vy = liftAx * cling.climbRate;
            state.y += state.vy * dt;
            state.vx *= 0.12; state.vz *= 0.12;
            walker.setPosition(state.x, state.z);
            walker.setVelocity(state.vx, state.vz);
            walker.setYaw(lookYaw);
            grounded = false; coyote = 0; airT += dt; buffered = 0;
            state.grounded = false; state.airborne = false; state.clinging = true;
            state.speed = Math.hypot(state.vx, state.vy, state.vz);
            _euler.set(0, state.yaw, 0, 'YXZ'); state.quat.setFromEuler(_euler);
            tickChase(dt);
            return state;                        // the climb owns this frame entirely
          }
        }
      }
      /* --- 2b-ii) THE TOP-OUT (MANTLE). The wall ran out from under a body that was climbing UP it.
         Without this the climb is a dead end by construction — you reach the lip, the ray goes clear,
         and gravity takes back everything you climbed. Ask whether there is a roof one step ahead at
         roughly the height the feet have reached; if there is, stand on it.
         THE THREE GATES ARE ALL NECESSARY: `wasClinging` (this is a top-out, not a jump); `liftAx > 0`
         (you were going UP — letting go of the axis must still drop you past the facade, which is the
         opt-in half of cling); and the height window, which is what stops a body that climbed off the
         SIDE of a tower being teleported down onto the street 5 u below.
         `!wallJumped` (A-WALLJUMP) is the fourth: on the leap frame the wall did not run out — we LEFT
         it. Without the gate, a Space pressed near the lip converts the leap into a free top-out (the
         mantle zeroes the velocity it teleports with), which is the wrong verb quietly winning. */
      if (wasClinging && !wallJumped && liftAx > 0 && world.surfaceAt) {
        const cfx = Math.sin(lookYaw), cfz = Math.cos(lookYaw);
        const tx = state.x + cfx * cling.mantle, tz = state.z + cfz * cling.mantle;
        const top = world.surfaceAt(tx, tz, state.y + cling.mantleUp, footR);
        if (top > -Infinity && top <= state.y + cling.mantleUp && top >= state.y - cling.mantleDrop) {
          state.x = tx; state.z = tz; state.y = top + skim;
          walker.setPosition(tx, tz); walker.setVelocity(0, 0);
          state.vx = 0; state.vy = 0; state.vz = 0;
          grounded = true; coyote = coyoteTime; airT = 0; apex = -Infinity;
          landings++; mantles++;
          state.grounded = true; state.airborne = false; state.clinging = false;
          state.speed = 0;
          _euler.set(0, state.yaw, 0, 'YXZ'); state.quat.setFromEuler(_euler);
          tickChase(dt);
          return state;
        }
      }

      // --- VERTICAL: gravity, then the floor, then the two forgiveness timers.
      state.vy -= gravity * dt;
      if (state.vy < -maxFall) state.vy = -maxFall;
      state.y += state.vy * dt;

      // --- HORIZONTAL: the walker, with the accel scaled by the air (see `airControl`).
      walker.setYaw(lookYaw);
      /* `airDrag` is the grapple's own number when there is a grapple, so a body in free flight bleeds
         at the same rate whichever integrator is holding it. Two drags would make the body feel
         heavier the instant a web cut — the same seam requirement that pins gravity to one value. */
      walker.update(dt, {
        x: input.x || 0, y: input.y || 0, sprint,
        control: grounded ? 1 : airControl,
        airDrag: opts.airDrag != null ? opts.airDrag
          : (gProfile && gProfile.airDrag != null ? gProfile.airDrag : 0.06),
      });
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

      /* --- THE JUMP. Edge-triggered (a HELD key must not re-fire on landing), and allowed from either
             the floor or the coyote window. A press with neither is not thrown away — it is BUFFERED.
             The edge itself is detected at the TOP of update() now, because the same press means
             RELEASE while roped and this branch never runs then (see 1b). */
      /* ONE PRESS, ONE VERB. A release taken at street level lands you inside the buffer window, and
         without `pressSpent` that single Space would cut the line AND fire a jump off the landing —
         a double impulse from one key, and a `jumps` counter that lies. The forgiveness timers exist
         to make a press that missed still count; they must not make a press that already counted
         count twice. */
      if (jumpPressed && !pressSpent) buffered = jumpBuffer;
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
    state.airborne = !grounded && !swinging && !clinging;
    state.swinging = swinging;
    state.clinging = clinging;
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
  /* THE GROUND CLAMP — the half of camera containment `segmentHit` structurally cannot do.
     The spring arm asks the world whether a SOLID is in the way, and in every world in this repo the
     solids are the BUILDINGS: metropolis's colliders, box-arena's towers. The ground is a plane or a
     heightfield answered by `heightAt`/`surfaceAt`, so it is invisible to the sweep — and an aimed
     swing spends its life looking UP, which swings the arm DOWN. Measured before this existed: the
     chase eye went 0.30 u under the floor of the lab just by pitching up from a standing start.
     Lifting the eye (rather than shortening the arm) is the standard answer and the right one here:
     `outDir` is the look vector the crosshair stands for and is NOT recomputed from the eye, so
     sliding the camera up the ground plane changes the framing without lying about where you are
     aiming. Applied to BOTH views — first person is nowhere near the floor today, and "nowhere near
     today" is how the next regression gets in. */
  function clampToGround(outPos) {
    const g = groundAt(outPos.x, outPos.z, outPos.y) + camGroundClear;
    if (outPos.y < g) outPos.y = g;
    return outPos;
  }
  /* THE EYE CLEARANCE — the half of camera containment that a SWEEP structurally cannot do, for the
     same reason the ground clamp was: a sweep decides where the eye may TRAVEL to, and says nothing
     about the volume the frustum then occupies once it is there. See `camEyeClear` for the
     measurement (0 eye frames enclosed, 52 near-plane-corner frames enclosed, on the same 260).
     SIX AXIS RAYS, ZERO-RADIUS, PUSHED BY THE SHORTFALL. A zero-radius ray is the honest probe here
     for the reason the ledger's REFUTED table gives: a radius INFLATES every box, so a fat ray from
     a legally-placed eye reports "blocked" in every direction and the pushes cancel. Two passes,
     because clearing an x wall can leave you short on z; a third would be chasing a corner case a
     0.04 u budget cannot produce.
     OPPOSITE FACES ARE A DEADLOCK BY DESIGN: in a gap narrower than 2·clear the two pushes cancel and
     the eye stays put, which is right — there is nowhere to go, and the alternative is a camera that
     oscillates between two walls. */
  /* ---- SIX AXES *AND THE FOUR HORIZONTAL DIAGONALS* (A-METRO-INHERIT, 2026-08-10). The four extra
     rays are a GUARD-SCOPE fix, measured, not a belt-and-braces: six axis rays are blind at a convex
     VERTICAL EDGE of a building, which is the most common camera position in a city of boxes.
     Standing off the corner of a tower the eye is outside the box in BOTH x and z, so the −x ray's
     endpoint is still outside the box's z span and the −z ray's is outside its x span — both report
     CLEAR — while a near-plane corner offset diagonally lands inside. Measured in metropolis after
     `camEyeClear` was first wired: near-plane corners inside dropped 30/260 → 1/75, and the residual
     frame was exactly this geometry. The diagonals are normalised so `r` still means "u of clearance"
     in every direction rather than 1.41× more on four of them.
     STILL BOUNDED, STILL STATELESS, STILL AN EXACT NO-OP AT `camEyeClear` 0 — the whole guard is
     skipped before this list is ever read. */
  const _D = Math.SQRT1_2;
  const _CLEAR_AXES = [
    [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
    [_D, 0, _D], [_D, 0, -_D], [-_D, 0, _D], [-_D, 0, -_D],
  ];
  function clearEye(outPos) {
    const r = camEyeClear;
    if (!(r > 0) || !world.segmentHit) return outPos;
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (let i = 0; i < _CLEAR_AXES.length; i++) {
        const a = _CLEAR_AXES[i];
        const t = world.segmentHit(outPos.x, outPos.y, outPos.z,
          outPos.x + a[0] * r, outPos.y + a[1] * r, outPos.z + a[2] * r, 0);
        if (t >= 1) continue;
        const push = r * (1 - t);
        outPos.x -= a[0] * push; outPos.y -= a[1] * push; outPos.z -= a[2] * push;
        moved = true;
      }
      if (!moved) break;
    }
    return outPos;
  }
  // one exit for every branch of cameraPose, so a new branch cannot forget either guard
  const placeEye = (outPos) => clearEye(clampToGround(outPos));
  function cameraPose(outPos = _pos, outDir = _dir) {
    lookDir(outDir);
    if (view === 'first') {
      outPos.x = state.x;
      outPos.y = state.y + eyeHeight + Math.sin(bobT * first.bobRate) * first.bob * (walker.moving && grounded ? 1 : 0);
      outPos.z = state.z;
      return placeEye(outPos);
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
      return placeEye(outPos);
    }
    outPos.x = px - outDir.x * dist;
    outPos.y = py - outDir.y * dist;
    outPos.z = pz - outDir.z * dist;
    return placeEye(outPos);
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
      // the latch is state the entry path TOOK; a teleport is an exit path, so it clears it (the
      // repo's recurring bug class — a respawn that leaves you holding a rope to nowhere).
      webLatched = false; webHeld = false;
      clinging = false;                          // …and so is a hand on a wall you have been moved off
      clingCool = 0;                             // …and the leap's blank on the ray (A-WALLJUMP)
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
    get airborne() { return !grounded && !swinging && !clinging; },
    get swinging() { return swinging; },
    // A-CLIMB verification handles — counted, not inferred from a y trace (which cannot tell a climb
    // from a zip). `mantles` is the one that matters: it is "I got ONTO the roof", not "I went up".
    get clinging() { return clinging; },
    get climbs() { return climbs; }, get mantles() { return mantles; },
    get clingTime() { return clingT; },
    // A-WALLJUMP: counted, not inferred — a y trace cannot tell a leap from a release's own coast
    get wallJumps() { return wallJumps; },
    get moving() { return walker.moving; },
    get x() { return state.x; }, get y() { return state.y; }, get z() { return state.z; },
    get lookYaw() { return lookYaw; }, get lookPitch() { return lookPitch; },
    get eyeHeight() { return eyeHeight; },
    // verification handles — the probe reads these rather than re-deriving them from samples
    get latched() { return webLatched; },
    get webs() { return webs; }, get releases() { return releases; },
    get lastReleaseSpeed() { return lastReleaseSpeed; }, get lastReleaseY() { return lastReleaseY; },
    get jumps() { return jumps; }, get landings() { return landings; },
    get airTime() { return airT; }, get lastAirTime() { return lastAirT; },
    get lastJumpRise() { return lastJumpRise; },
    get coyote() { return coyote; },
    groundAt,
  };
}
