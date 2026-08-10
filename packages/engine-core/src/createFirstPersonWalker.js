/* ============================================================
   @lgr/engine-core — createFirstPersonWalker (Lesson M2: dive-and-WALK embodiment).
   ------------------------------------------------------------
   THE ABILITY: after the dive drops you into the survivor's eyes, WALK — full 360° mouse-look (pointer
   lock) + WASD movement AT EYE HEIGHT, relative to where you face, with the world's obstacles blocking
   you. This turns "dive-and-look-around" into "dive-and-move-through": you stand IN the arena and stride
   between the trees while the horde closes.

   WHY (settled in the brief): no first-person WALKING exists anywhere in the repo. The existing
   `createSeatedLook` (interior.js:59) is a CLAMPED-yaw head-turn for someone SEATED (a cockpit, an office
   chair, the dive's frozen stance) — it can't turn all the way around and it owns no movement. A walker
   needs the opposite: UNBOUNDED yaw (spin freely) and movement COUPLED to that yaw (W goes where you
   look). So this is a NEW module, not a `mode:'seated'` param bolted onto seated look — a seated mode
   with zero consumers would be speculative dead code (Rule 2). The existing seated consumers (office,
   cavern, pilot, city) are therefore genuinely untouched.

   COMPOSITION CHOICE (the brief left it to me): this OWNS its look state rather than composing
   createSeatedLook. Reason: seated clamps yaw to ±yawLimit and eases toward a target; a walker wants
   unbounded yaw applied DIRECTLY (1:1 pointer-lock feel), and its movement basis IS that yaw — the two
   are coupled. Wrapping seated and then fighting its clamp/ease would be more code and a worse feel than
   the ~10 lines of look state here. Pitch is still clamped (you can't somersault your neck).

   COLLISION (lifted + parameterized from the Hoard's hoard.js:117-128 circle push-out — NOT collide.js,
   which is AABB-only, city-instantiated, and absent on the forest map): the walker owns a resolve against
   `colliders:[{x,z,r}]` (tree trunks) + an optional AABB list + a circular arena bound. Each frame it
   integrates, then pushes the body OUT of anything it ended up inside — so trees block you, gently.
   (Barriers carry NO colliders today — they're an angular hold rule in the game, hoard.js:546-553 — so
   barrier-blocking for the walker is a GAME follow-up, flagged in the handoff, not silently absent.)

   C++ anchors: yaw/pitch ≈ two floats you fold into the view matrix each frame; the push-out loop ≈ the
   classic "resolve penetration" pass of a discrete collision step (move, then un-overlap) — same shape as
   the Hoard's, just parameterized. No per-frame allocation (scratch vectors reused).

   Contract: createFirstPersonWalker(opts) -> {
     setPosition(x,z), setYaw(rad), setColliders(list), setAabbs(list), recenterPitch(),
     addLook(dx,dy),                    // pointer-lock / drag delta → unbounded yaw + clamped pitch (DIRECT)
     update(dt, { x, y, sprint }),      // x=strafe(+right) y=forward(+fwd); moves + resolves collision
                                        // `boost` (0..1) is accepted as an alias for `sprint` — one word across the engine
     eyePosition(out), eyeDirection(out),
     x, z, yaw, pitch, moving,
   }

   ARC A-CAM+WALK — two ADDITIVE hooks (both null by default; every existing hoard2 call site, which
   passes neither, is byte-identical to before this arc):
     opts.groundY(x,z) / setGroundY(fn)        — eye height tracks this instead of the constant eyeY
                                                  (paired with the separate `eyeHeight` option).
     opts.resolveSpatial(state,dt,cfg) / setResolveSpatial(fn) — collide.js's OWN resolveSphere shape;
                                                  when set, runs AFTER the existing circle/aabb loop,
                                                  so a project can hand the walker a city's spatial-hash
                                                  collider (400-700 building AABBs) instead of (or
                                                  alongside) a hand-built circle/aabb list.
   ============================================================ */

export function createFirstPersonWalker(opts = {}) {
  const D = Math.PI / 180;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

  const eyeY = opts.eyeY != null ? opts.eyeY : 1.4;
  // ARC A-CAM+WALK — the groundY(x,z) HOOK (additive; createFirstPersonWalker.js:118-120's own
  // documented gap: eyePosition() returned a CONSTANT eyeY, fine for hoard2's near-flat forest arena,
  // wrong for the city where the street sits at LAYOUT.PLINTH_TOP, not 0). `groundY` is null by
  // default — every existing hoard2 call site (no groundY passed) computes out.y EXACTLY as before
  // (`eyeY` unchanged, same fallback, same constant). Only a caller that supplies `groundY` gets
  // eye-height-ABOVE-ground instead of an absolute eyeY — a different (and separately configurable)
  // knob, `eyeHeight`, so the two modes never fight over one option's meaning.
  let groundYFn = opts.groundY || null;
  const eyeHeight = opts.eyeHeight != null ? opts.eyeHeight : eyeY;
  const moveSpeed = opts.moveSpeed != null ? opts.moveSpeed : 3.0;
  const sprintSpeed = opts.sprintSpeed != null ? opts.sprintSpeed : 5.0;
  const accel = opts.accel != null ? opts.accel : 14;
  const sensitivity = opts.sensitivity != null ? opts.sensitivity : 0.0022;  // radians per pixel (pointer-lock)
  const pitchUp = (opts.pitchUp != null ? opts.pitchUp : 55) * D;            // clamp (up is +)
  const pitchDown = (opts.pitchDown != null ? opts.pitchDown : 55) * D;      // clamp (down is −)
  const radius = opts.radius != null ? opts.radius : 0.3;                    // body collision radius
  const arenaRadius = opts.arenaRadius != null ? opts.arenaRadius : Infinity;

  let colliders = opts.colliders || [];
  let aabbs = opts.aabbs || [];
  // ARC A-CAM+WALK — the SPATIAL-HASH collision hook (additive; null by default, so hoard2's own
  // circle/aabb list above is completely untouched). `resolveSpatial` is collide.js's OWN
  // `resolveSphere(state, dt, cfg)` shape (createCityWorld.js's `collider.resolveSphere`) — the SAME
  // broad-phase grid + push-out the piloted craft already uses over the city's 400-700 building
  // AABBs, reused rather than re-deriving a second collision system (per the brief: "consume
  // collide.js's spatial hash instead of its own circle list"). The walker has no speed/yaw/vy
  // concept of its own, so `_spatialState` is a throwaway per-frame adapter: x/z are the walker's
  // real position (read back after the resolve), everything else is a scratch value resolveSphere
  // needs but nothing here reads afterward (speed=0 so its friction scrub is inert; vy/yaw likewise).
  let spatialResolve = opts.resolveSpatial || null;
  const _spatialState = { x: 0, y: 0, z: 0, speed: 0, yaw: 0, vy: 0 };

  let x = opts.x || 0, z = opts.z || 0;
  let yaw = opts.yaw || 0, pitch = opts.pitch || 0;   // yaw UNBOUNDED (radians); pitch clamped
  let vx = 0, vz = 0, bobT = 0, moving = false;

  const _eye = { x: 0, y: 0, z: 0 }, _dir = { x: 0, y: 0, z: 0 };

  // DIRECT look: a pointer-lock delta turns you 1:1 (grab-the-world sign, matching createSeatedLook —
  // dragging right looks left). Yaw wraps freely; pitch is clamped so you can't break your neck.
  function addLook(dx, dy) {
    yaw -= dx * sensitivity;
    pitch = clamp(pitch - dy * sensitivity, -pitchDown, pitchUp);
  }

  // Push the body OUT of any obstacle it ended up inside this frame (arena bound, then circles, then
  // boxes, then the spatial-hash grid if one was wired in).
  function resolveCollision(dt) {
    if (arenaRadius !== Infinity) {
      const r = Math.hypot(x, z);
      if (r > arenaRadius) { const k = arenaRadius / r; x *= k; z *= k; vx = 0; vz = 0; }
    }
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i], dx = x - c.x, dz = z - c.z, rr = c.r + radius, d2 = dx * dx + dz * dz;
      if (d2 < rr * rr) {
        if (d2 > 1e-8) { const d = Math.sqrt(d2), push = (rr - d) / d; x += dx * push; z += dz * push; }
        else { x += rr; }
      }
    }
    for (let i = 0; i < aabbs.length; i++) {
      const b = aabbs[i], mnx = b.minX - radius, mxx = b.maxX + radius, mnz = b.minZ - radius, mxz = b.maxZ + radius;
      if (x > mnx && x < mxx && z > mnz && z < mxz) {
        // eject along the axis of least penetration
        const pxl = x - mnx, pxr = mxx - x, pzl = z - mnz, pzr = mxz - z;
        const m = Math.min(pxl, pxr, pzl, pzr);
        if (m === pxl) { x = mnx; } else if (m === pxr) { x = mxx; } else if (m === pzl) { z = mnz; } else { z = mxz; }
      }
    }
    if (spatialResolve) {
      _spatialState.x = x; _spatialState.y = groundYFn ? groundYFn(x, z) : 0; _spatialState.z = z;
      _spatialState.speed = 0; _spatialState.yaw = 0; _spatialState.vy = 0;
      spatialResolve(_spatialState, dt, { r: radius, yOff: 0 });
      x = _spatialState.x; z = _spatialState.z;
    }
  }

  /* ---- A-LOCK (2026-08-09): SUB-STEP WHEN THE BODY IS MOVING FASTER THAN IT IS WIDE. ------------
     `resolveCollision` is a DEPENETRATION: it lets the body overlap a solid and then pushes it out.
     That is sound while the per-frame move is small compared with the body — which was always true
     while the fastest this walker could go was a 0.95 u/s sprint (0.016 u per frame against a 0.09 u
     radius). It stopped being true the moment a swing launch could hand this body 10 u/s: 0.17 u per
     frame, nearly TWO body radii, so the body could arrive already deep inside a facade and the push
     had a whole frame of penetration to undo. Measured the day free-flight momentum started working:
     8 frames of 11 533 strictly enclosed, all of them at speed.
     THE FIX IS RESOLUTION, NOT A SECOND COLLISION MODEL. Splitting the frame into steps no longer
     than 80% of the body radius means the proven resolve never sees a move it cannot handle, and
     nothing about its behaviour changes. Capped at 8 sub-steps so a pathological dt cannot turn one
     frame into a stall; at this scale 8 covers 0.58 u of travel in a 60 Hz frame, i.e. 35 u/s.
     A body under the old speeds takes exactly ONE step and integrates byte-identically to before.
     THE CAP AND THE STEP SIZE ARE SIZED AGAINST THE WORST FRAME, not the average one. A consumer that
     clamps dt at 0.1 s (the lab and metropolis both do, so a tab-switch cannot teleport a body through
     a wall) can present a 0.885 u move at the measured 8.85 u/s peak — which 8 steps of 0.8·radius
     could not cover, and the residue showed up as exactly one enclosed frame in 11 536. Half a radius
     × 16 steps covers 0.72 u in one frame, and the cap only binds in a hitch that is already a
     rendering failure. */
  const MAX_SUBSTEPS = 16;
  function update(dt, input = {}) {
    const stepMax = radius * 0.5;
    const move = Math.hypot(vx, vz) * dt;
    const n = move > stepMax ? Math.min(MAX_SUBSTEPS, Math.ceil(move / stepMax)) : 1;
    for (let i = 0; i < n; i++) stepOnce(dt / n, input);
  }
  // Move one step. `input.x` = strafe (+right), `input.y` = forward (+forward), `input.sprint` = bool.
  function stepOnce(dt, input = {}) {
    const ix = input.x || 0, iy = input.y || 0;
    const il = Math.hypot(ix, iy);
    const nx = il > 1 ? ix / il : ix, ny = il > 1 ? iy / il : iy;   // clamp diagonal to unit
    moving = il > 0.05;
    // yaw-relative basis: forward = (sin yaw, cos yaw) in xz (the game's facing convention); strafe ⟂.
    // A3 BUG FIX (owner: "if I press right I go right"): strafe = the camera's RIGHT vector. With forward =
    // (sin,cos) and up = +y, the camera (looking along forward, three.js right-handed) has right =
    // cross(up, -forward) = (-cos yaw, sin yaw). The old basis (cos, -sin) was the NEGATION → D strafed LEFT.
    // Fixed at the source (not by flipping the input) so every consumer's D = camera-right, at any yaw.
    const fx = Math.sin(yaw), fz = Math.cos(yaw), sx = -Math.cos(yaw), sz = Math.sin(yaw);
    /* A-SPRINT (2026-08-07): `boost` is the name the PILOT seam uses for this exact concept (pilot.js's
       bk()), and one engine should not have two words for one verb. Accepted as an alias here rather
       than renamed, because four projects (city, office, hoard, hoard2) already pass `sprint`.
       Analog-tolerant: a thumbstick pushed past its rim sends a float, so anything over half counts. */
    const sp = (input.sprint || (input.boost || 0) > 0.5) ? sprintSpeed : moveSpeed;
    const desVx = (fx * ny + sx * nx) * sp, desVz = (fz * ny + sz * nx) * sp;
    /* ARC A-CHAR (2026-08-09) — `input.control` scales the ACCELERATION for this frame only, and it
       defaults to 1 so every existing call site (office, city, hoard, hoard2, metropolis — none of
       which pass it) integrates byte-identically to before. It exists for AIR CONTROL: a jumping body
       still wants full walk speed as its target, it just must not reach it instantly, or you steer in
       mid-air like a hovercraft. Scaling accel keeps the momentum and softens the turn; scaling the
       SPEED would have braked you in flight, which is the opposite of a jump. */
    const ctl = input.control != null ? input.control : 1;
    if (ctl >= 1) {
      /* GROUNDED — converge on the desired velocity. This ONE line is doing two jobs: it accelerates
         you toward what you asked for, and with no input (des = 0) it brakes you to a stop. On the
         ground that second job is friction and it is correct. */
      const k = 1 - Math.exp(-accel * ctl * dt);
      vx += (desVx - vx) * k; vz += (desVz - vz) * k;
    } else {
      /* ---- AIRBORNE (A-LOCK, 2026-08-09): THE INPUT ACCELERATES, IT NEVER BRAKES. ---------------
         MEASURED BUG, not a refinement. Converging on the desired velocity in mid-air means braking
         to a stop whenever no key is held, because the desired velocity IS zero — so a body launched
         off a swing at 3.6 u/s horizontal travelled, measured, 0.00 u over 181 frames while rising
         2.67 u and falling back. It went straight up and straight down. And holding W was no better:
         the target is WALK speed, so the convergence would have dragged 6 u/s down to 0.55.
         The fix is the classic air-acceleration rule (Quake's, and every character controller since):
         project the current velocity onto the input direction, and add acceleration only while that
         projection is BELOW the walk speed you asked for. You can always start moving, you can always
         steer, and you can never slow yourself down by holding a key. With no input at all the only
         loss is `airDrag`, which defaults to the grapple's own 0.06/s so a body in free flight bleeds
         at the same rate whichever integrator is holding it — one air, one drag.
         GATED ON `ctl < 1`, which is the caller SAYING it is airborne (the character controller passes
         `control: grounded ? 1 : airControl`). Every existing consumer omits `control` entirely, gets
         ctl = 1, and takes the branch above — byte-identical to before this existed. */
      const drag = input.airDrag != null ? input.airDrag : 0.06;
      const bleed = Math.max(0, 1 - drag * dt);
      vx *= bleed; vz *= bleed;
      const dl = Math.hypot(desVx, desVz);
      if (dl > 1e-4) {
        const dirX = desVx / dl, dirZ = desVz / dl;
        const along = vx * dirX + vz * dirZ;              // how fast you ALREADY go that way
        const add = Math.min(dl - along, accel * ctl * dt);
        if (add > 0) { vx += dirX * add; vz += dirZ * add; }
      }
    }
    x += vx * dt; z += vz * dt;
    resolveCollision(dt);
    if (moving) bobT += dt; else bobT *= (1 - Math.min(1, dt * 4));   // bob settles when you stop
  }

  function eyePosition(out = _eye) {
    const baseY = groundYFn ? groundYFn(x, z) + eyeHeight : eyeY;
    out.x = x; out.y = baseY + Math.sin(bobT * 9) * 0.03 * (moving ? 1 : 0); out.z = z;
    return out;
  }
  function eyeDirection(out = _dir) {
    const cp = Math.cos(pitch);
    out.x = Math.sin(yaw) * cp; out.y = Math.sin(pitch); out.z = Math.cos(yaw) * cp;
    return out;
  }

  return {
    addLook, update, eyePosition, eyeDirection,
    setPosition(nx, nz) { x = nx; z = nz; vx = 0; vz = 0; },
    /* A-LOCK: the WRITE half of `vx`/`vz`, and it is the other half of the momentum bug above.
       `setPosition` zeroes the velocity because a teleport has none — correct on its own, and fatal
       in combination: the character controller calls it EVERY frame while roped, to keep the walker's
       x/z in step with the arc, so the walker spent every swing pinned at zero and handed that zero
       back the instant the line cut. Position and velocity are separate facts; there was only a
       setter for one of them. Now the arc's momentum can be handed over explicitly. */
    setVelocity(nvx, nvz) { vx = nvx || 0; vz = nvz || 0; },
    setYaw(r) { yaw = r; },
    setColliders(list) { colliders = list || []; },
    setAabbs(list) { aabbs = list || []; },
    setGroundY(fn) { groundYFn = fn || null; },
    setResolveSpatial(fn) { spatialResolve = fn || null; },
    recenterPitch() { pitch = 0; },
    get x() { return x; }, get z() { return z; },
    // A-CHAR: the horizontal VELOCITY, read-only. A character controller that hands this body to a
    // grapple mid-stride needs the momentum it was carrying; before this it was internal and the
    // hand-off would have started every web from a dead stop.
    get vx() { return vx; }, get vz() { return vz; },
    get yaw() { return yaw; }, get pitch() { return pitch; },
    get moving() { return moving; },
  };
}
