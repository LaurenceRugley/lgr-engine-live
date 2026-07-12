/* ============================================================
   camera-rig.js — Lesson 07: a HAND-ROLLED camera rig.
   ------------------------------------------------------------
   Three.js ships OrbitControls (and MapControls, TrackballControls…). Like the
   post chain in Lesson 06, we DON'T use it — we build the thing the addon would
   have built for us, so the addon later is a convenience, not a mystery.

   THE BIG IDEA THIS LESSON TEACHES: "isometric" is NOT a renderer or a mode you
   flip on. It's an ORTHOGRAPHIC camera parked at two specific angles. There are
   two independent axes here, and we keep them independent on purpose:

     PROJECTION — HOW 3D flattens onto 2D. Two flavours:
        • PERSPECTIVE — rays converge to the eye; far things shrink (real cameras).
        • ORTHOGRAPHIC — rays are parallel; size is independent of distance. This
          is what makes a scene read as "isometric / blueprint / SimCity".
     RIG — HOW the camera is placed and MOVED: where it orbits, how it damps,
        how it pans and zooms. The rig is the same maths whichever projection
        you point it at.

   Hold those two apart and "isometric" stops being mysterious: it's just
   ORTHOGRAPHIC projection + a canonical orbit angle. We expose THREE modes that
   are all the SAME rig, differing only in projection + locked angle:

       4  PERSPECTIVE ORBIT — perspective projection, you orbit freely (L04 hero).
       5  TRUE ISOMETRIC    — orthographic, azimuth 45°, elevation atan(1/√2).
       6  GAME DIMETRIC 2:1  — orthographic, azimuth 45°, elevation atan(1/2).

   ── THE ISO / DIMETRIC ANGLE DERIVATIONS (why those exact elevations) ─────────
   Stand the camera on an orbit sphere around the target. AZIMUTH is the compass
   heading (spin around the vertical axis); ELEVATION is the pitch above the
   horizon. Both iso families set azimuth to 45° (look at a cube corner-on, so two
   side faces show equally). The ELEVATION is where they differ:

   TRUE ISOMETRIC — "iso-metric" means EQUAL MEASURE: a unit step along world X,
   Y and Z must project to the SAME length on screen, so no axis looks favoured.
   Look down the main diagonal of a cube. Stand the cube on its corner: the
   horizontal spread of the two visible base edges has length √2 (each edge is
   1, at 45° they fan out to a √2-wide footprint), while the cube rises 1 unit.
   The pitch that sees them equal is:

            top of cube  •
                        /|         tan(elevation) = rise / run
              rise = 1 / |                        = 1 / √2
                      /  |         elevation = atan(1/√2) ≈ 35.264°
             -------•---------  ground
              run = √2

   DIMETRIC 2:1 — retro game art (and most "isometric" pixel games, which are
   really dimetric) cheats to a CLEAN PIXEL RATIO instead of equal measure. It
   wants one step in world X to move exactly 2 pixels across for every 1 pixel
   up — so a tile is drawn 2-wide-to-1-tall and snaps perfectly to the grid with
   no anti-aliased fuzz. "2 across per 1 up" is literally a slope of 1/2:

            tan(elevation) = 1 / 2  →  elevation = atan(1/2) ≈ 26.565°

   That 26.565° is why dimetric tiles tessellate cleanly and pair so well with the
   Lesson 06 pixel pass: the projected geometry already lands on 2:1 pixel steps.
   (AXONOMETRIC is the umbrella term for all parallel-projection views like these;
   isometric and dimetric are two points under it — see GLOSSARY.)

   ── FRAME-RATE-INDEPENDENT DAMPING (why the motion feels good) ────────────────
   Raw input is robotic: snap the camera straight to the goal and every move is a
   hard cut. We instead store a GOAL for each value and ease the CURRENT value
   toward it a little each frame. The naïve ease everyone writes first is:

        x += (goal - x) * 0.1;        // ❌ fps-dependent!

   At 60 Hz that runs 60×/s; at 120 Hz it runs 120×/s and converges TWICE as fast
   — the same drag feels different on different monitors. The studio-standard fix
   makes the per-frame fraction depend on the real elapsed time dt:

        x += (goal - x) * (1 - exp(-k * dt));   // ✅ dt-correct

   This is the closed-form solution of exponential decay sampled at dt: whether you
   take one big step or many small ones, you land in the same place after the same
   wall-clock time. k is the rate (bigger = snappier); 1/k ≈ seconds to cover ~63%
   of the remaining gap. We damp azimuth, elevation, distance, zoom AND the target.
   ============================================================ */
import * as THREE from 'three';
import { damp as dampAt } from './math.js';   // L76: the dt-correct ease, lifted to a shared module

/* The canonical angles, derived above. Kept as named constants so the lesson is
   legible in code, not just in the comment. */
const ISO_ELEVATION      = Math.atan(1 / Math.SQRT2); // ≈ 0.6155 rad ≈ 35.264°
const DIMETRIC_ELEVATION = Math.atan(0.5);            // ≈ 0.4636 rad ≈ 26.565°
const CANONICAL_AZIMUTH  = Math.PI / 4;               // 45° — corner-on, both modes

/* Mode ids double as the keyboard keys that select them (4 / 5 / 6). */
export const CAM = { PERSPECTIVE: 4, ISOMETRIC: 5, DIMETRIC: 6 };

/* Damping rate, shared by every smoothed value. k≈8 → ~0.12 s to close 63% of the
   gap: visibly eased, never sluggish. (Tunable; reported in the handoff.) */
const K = 8;

/* Elevation clamp for FREE orbit (perspective). Keep the eye above the horizon and
   below the pole so the orbit never flips over the top. L98c: lowered EL_MIN 0.12→0.03
   so the free-orbit camera can drop near the horizon plane and LOOK UP toward the sky —
   you can now orbit low and SEE the (depth-occluded) sun/moon against open sky. Only the
   free perspective orbit (mode 4) uses this; the fixed iso/dimetric + pilot/inspect cams
   are unaffected (they set their own canonical angles). */
const EL_MIN = 0.03;  // ≈ 1.7° — near-horizon, so the sky + a low sun read in the upper frame
const EL_MAX = 1.45;  // ≈ 83°

/* Distance (perspective dolly) and zoom (ortho half-height) clamps — stop the user
   from flying through the scene or inverting the frustum. */
const DIST_MIN = 4,  DIST_MAX = 40;
const ZOOM_MIN = 1.5, ZOOM_MAX = 16;
// L108 chase spring-arm tunables (reported in HANDOFF, live-tunable):
const ARM_MIN = 1.2;        // never dolly closer than this — keeps the craft on-screen even in a 1-block alley
const ARM_SKIN = 0.15;      // sit the eye IN FRONT of the wall, not tangent to it
const ARM_OUT_K = 4;        // ease-OUT rate (slower than the main K=8 → an unhurried recovery breath); pull-IN is instant
const CAM_GROUND_SKIN = 0.4;// keep the eye this far above the street/seabed (the deck clamp)

/* STYLE-LOD normalization range (Lesson 08). styleT maps the current zoom to 0..1
   over a PRACTICAL sub-range of the hard clamps above — the band of framings where
   the diorama is actually well-composed — NOT the full safety clamps (whose extremes
   are an empty close-up and a distant speck, useless for a style transition). This
   keeps the pixel↔toon crossfade where you can see it. The safety clamps still bound
   real motion; this only shapes the style mapping. */
const STYLE_DIST_NEAR = 6,   STYLE_DIST_FAR = 22; // perspective dolly
const STYLE_ZOOM_NEAR = 3.5, STYLE_ZOOM_FAR = 11; // ortho half-height

/* exp-damp one scalar toward its goal; returns the new current value. L76: the maths now
   lives in math.js (shared with the SunRig-class ease + the pilot integrators); the rig keeps
   its rate constant K by partially applying it here, so the motion is byte-identical to before. */
const damp = (curr, goal, dt) => dampAt(curr, goal, K, dt);

/* Pick the representation of `target` angle nearest `ref`, so snapping the azimuth
   to 45° after the user has orbited to 730° eases the SHORT way round instead of
   unwinding several turns. */
const nearestAngle = (target, ref) =>
  target + Math.PI * 2 * Math.round((ref - target) / (Math.PI * 2));

export function createCameraRig({
  aspect,
  fov = 48,             // matches the Lesson 04 hero lens
  near = 0.1,
  far = 100,
  target = new THREE.Vector3(0, 0.8, 0),
  azimuth = CANONICAL_AZIMUTH,
  elevation = 0.52,     // ≈ 30°, a comfortable perspective start
  distance = 12,        // L13: +~9% so the bigger generated city isn't tight in dimetric
  zoom = 5.5,           // ortho half-height in WORLD units (+~10% for the city)
  /* L-N re-skin: the WORLD-SCALE clamps + the style-LOD bands are now factory options so a
     client build on a different-scale world (a room, a planet) re-frames WITHOUT editing this
     file. Every default is today's value → a default build is byte-identical. */
  elMin = EL_MIN, elMax = EL_MAX,                       // free-orbit elevation clamp (rad)
  distMin = DIST_MIN, distMax = DIST_MAX,               // perspective dolly clamp (world units)
  zoomMin = ZOOM_MIN, zoomMax = ZOOM_MAX,               // ortho half-height clamp (world units)
  styleDistNear = STYLE_DIST_NEAR, styleDistFar = STYLE_DIST_FAR,   // style-LOD dolly band
  styleZoomNear = STYLE_ZOOM_NEAR, styleZoomFar = STYLE_ZOOM_FAR,   // style-LOD ortho band
} = {}) {
  /* TWO camera objects, one of each projection. Switching mode just changes which
     one we hand back to the renderer — we never rebuild a camera mid-flight. Both
     are driven by the SAME rig state below, so the view doesn't jump on a switch
     (position/zoom are shared; only the projection maths differs). */
  const perspective = new THREE.PerspectiveCamera(fov, aspect, near, far);
  const ortho       = new THREE.OrthographicCamera(-1, 1, 1, -1, near, far);

  let mode = CAM.PERSPECTIVE;
  let aspectRatio = aspect;

  /* GOAL = where we want to be; CURR = where we are this frame. update() eases
     curr → goal. Target is a Vector3 (damped component-wise). */
  const goal = { azimuth, elevation, distance, zoom, target: target.clone() };
  const curr = { azimuth, elevation, distance, zoom, target: target.clone() };

  /* In iso/dimetric the PITCH is the definition of the view, so we lock elevation
     to its canonical value: vertical drag is ignored, only the heading orbits.
     (You CAN spin an iso camera — most games snap it 90° — without it ceasing to
     be iso; you just must not change the pitch.) Perspective leaves it unlocked. */
  let elevationLocked = false;

  /* ----- L63 FOLLOW (the inspection lens' tracking seam) ---------------------
     A FOLLOW is a live function `getWorldPos(out)` that writes the followed
     object's CURRENT world position into `out` each frame. While set, update()
     drives `goal.target` from it, so the rig's existing critically-damped target
     ease chases the moving object for free — a buttery follow with zero new maths
     (the L32 Hoard player-follow does the same by calling setTarget each frame;
     this just moves the per-frame call INTO the rig so any consumer inherits it).
     C++ anchor: a control loop chasing a moving setpoint — the damping IS the
     critically-damped spring tracking the target. orbit()/zoomBy() still work while
     following (you circle + dolly around the object); pan() is overridden each frame
     (you don't slide the target out from under what you're inspecting). */
  let followFn = null;
  const _followPos = new THREE.Vector3();

  /* L108 CHASE SPRING-ARM state (set by setSpringArm; armed only while piloting). armDist is a SEPARATE
     placement-only distance — it shortens the drawn eye when a building blocks the chase, but NEVER touches
     curr.distance (which drives styleT/the tier) or goal.distance (zoom intent) → provably tier-transparent.
     armGroundY is the DAMPED ground height under the eye (C2 — a min, not a hard step, so the deck clamp glides). */
  let armEnabled = false, armSegmentQuery = null, armGroundFn = null, armRadius = 0.25;
  let armDist = goal.distance, armGroundY = 0;

  // L-cockpit FP EYE state — set by setEye() from the pilot controller, cleared by clearEye() on exit.
  // When fpActive, update() early-branches: skips orbit + spring-arm, places cam directly at fpPos looking fpDir.
  let fpActive = false;
  const fpPos = new THREE.Vector3();
  const fpDir = new THREE.Vector3(0, 0, 1);

  const activeCamera = () => (mode === CAM.PERSPECTIVE ? perspective : ortho);

  /* ----- MODE SWITCH: snap projection, damp the rest ------------------------
     We change projection instantly (there is no cheap way to blend a perspective
     and an orthographic projection matrix — the famous Hitchcock DOLLY-ZOOM is
     the one trick that interpolates the *feel* of it, by dollying distance while
     widening FOV; out of scope, noted as future polish). Position/zoom/angles all
     keep their current values and DAMP toward the new goals, so the eye glides. */
  function setMode(next) {
    if (next === mode) {
      // L110 (audit B12): a same-mode call must still RE-ASSERT the LOCKED elevation. A chase-cam possession drives
      // setElevation() directly (below), which corrupts the locked iso/dimetric pitch; the old unconditional early-
      // return then made that corruption UNRECOVERABLE — re-selecting ISO/DIMETRIC was a no-op. Azimuth stays free
      // (it's user-orbitable in ortho, so we must not snap it back on every re-select).
      if (mode === CAM.ISOMETRIC || mode === CAM.DIMETRIC) {
        goal.elevation = mode === CAM.ISOMETRIC ? ISO_ELEVATION : DIMETRIC_ELEVATION;
        elevationLocked = true;
      }
      return;
    }
    mode = next;
    if (mode === CAM.ISOMETRIC || mode === CAM.DIMETRIC) {
      goal.elevation = mode === CAM.ISOMETRIC ? ISO_ELEVATION : DIMETRIC_ELEVATION;
      goal.azimuth   = nearestAngle(CANONICAL_AZIMUTH, curr.azimuth); // ease to 45°
      elevationLocked = true;
    } else {
      elevationLocked = false; // free orbit again; angles stay where they are
    }
  }

  /* ----- ORBIT (right-drag / two-finger drag) -------------------------------
     dAz/dEl are radians of intended change. Azimuth always responds; elevation
     only when unlocked (perspective), and clamped away from the poles. */
  function orbit(dAz, dEl) {
    goal.azimuth += dAz;
    if (!elevationLocked) {
      goal.elevation = THREE.MathUtils.clamp(goal.elevation + dEl, elMin, elMax);
    }
  }

  /* ----- ZOOM (wheel / pinch): the DOLLY-vs-ZOOM lesson ---------------------
     `factor` < 1 means "closer / bigger". The two projections need DIFFERENT
     actions for the same gesture — and that difference is the whole point:
       • PERSPECTIVE: there is no "zoom" to change; we DOLLY — physically move the
         camera in along its view ray (change distance). Closer = bigger AND the
         perspective shifts (foreshortening grows).
       • ORTHOGRAPHIC: moving the camera does NOTHING to apparent size — parallel
         rays don't care how far the eye is. To resize the image you must change
         the FRUSTUM extents (zoom = the ortho half-height). Same gesture, totally
         different mechanism. Mixing these up is the classic "why won't my iso
         camera zoom?" bug. */
  function zoomBy(factor) {
    if (mode === CAM.PERSPECTIVE) {
      goal.distance = THREE.MathUtils.clamp(goal.distance * factor, distMin, distMax);
    } else {
      goal.zoom = THREE.MathUtils.clamp(goal.zoom * factor, zoomMin, zoomMax);
    }
  }

  /* ----- PAN (arrow keys): slide the TARGET across the ground plane ----------
     We move the look-at target along the camera's screen-right and screen-forward
     directions, projected onto the world ground (XZ). Derived from azimuth:
       right   = ( cos az, 0, -sin az)   // +X when az=0 (camera on +Z looking -Z)
       forward = (-sin az, 0, -cos az)   // into the scene, on the ground
     Pan speed scales with how much world the view currently spans (distance for
     perspective, zoom for ortho), so a keypress nudges a consistent fraction of
     the frame no matter how far in you are. */
  function pan(dxRight, dyForward) {
    const az = goal.azimuth;
    const span = mode === CAM.PERSPECTIVE ? goal.distance * 0.04 : goal.zoom * 0.08;
    const right   = new THREE.Vector3(Math.cos(az),  0, -Math.sin(az));
    const forward = new THREE.Vector3(-Math.sin(az), 0, -Math.cos(az));
    goal.target.addScaledVector(right,   dxRight  * span);
    goal.target.addScaledVector(forward, dyForward * span);
  }

  /* Keep aspect current; the perspective matrix needs it now, the ortho frustum
     reads it every update() from aspectRatio. */
  function setViewport(width, height) {
    aspectRatio = width / height;
    perspective.aspect = aspectRatio;
    perspective.updateProjectionMatrix();
  }

  /* ----- PER-FRAME UPDATE: damp, then place the active camera ---------------- */
  function update(dt) {
    // L-cockpit FP EYE early-branch: when the pilot controller has set a first-person eye this frame,
    // skip ALL orbit / follow / spring-arm math and place the camera directly. The orbit state (curr.*)
    // freezes while in cockpit mode and resumes seamlessly on clearEye() + return to chase.
    // CRITICAL (Opus-refuted): gating only the spring-arm branch is insufficient — the Spherical→Cartesian
    // block at ~:290 UNCONDITIONALLY clobbers cam.position + cam.lookAt after any spring-arm branch. The
    // early-return here is the only correct fix (both branches skip entirely, one `if`, zero per-frame alloc).
    if (fpActive) {
      const cam = activeCamera();
      cam.position.copy(fpPos);
      cam.lookAt(fpPos.x + fpDir.x, fpPos.y + fpDir.y, fpPos.z + fpDir.z);
      if (cam.isOrthographicCamera) {
        const halfH = curr.zoom, halfW = halfH * aspectRatio;
        cam.left = -halfW; cam.right = halfW; cam.top = halfH; cam.bottom = -halfH;
        cam.updateProjectionMatrix();
      }
      return;
    }
    // L63: if we're FOLLOWING something, refresh the goal target from its live world
    // position BEFORE damping, so the camera eases toward where the object is NOW.
    if (followFn) { followFn(_followPos); goal.target.copy(_followPos); }
    curr.azimuth   = damp(curr.azimuth,   goal.azimuth,   dt);
    curr.elevation = damp(curr.elevation, goal.elevation, dt);
    curr.distance  = damp(curr.distance,  goal.distance,  dt);
    curr.zoom      = damp(curr.zoom,      goal.zoom,      dt);
    curr.target.x  = damp(curr.target.x,  goal.target.x,  dt);
    curr.target.y  = damp(curr.target.y,  goal.target.y,  dt);
    curr.target.z  = damp(curr.target.z,  goal.target.z,  dt);

    /* Spherical → Cartesian: the eye's offset from the target on the orbit sphere.
       y = sin(elevation)·d (height); the horizontal radius cos(elevation)·d is
       split across X/Z by the azimuth. */
    const ce = Math.cos(curr.elevation), se = Math.sin(curr.elevation);
    const ca = Math.cos(curr.azimuth),   sa = Math.sin(curr.azimuth);
    const cam = activeCamera();
    // The DESIRED eye at the FULL orbit radius (today's placement).
    let eyeX = curr.target.x + curr.distance * ce * sa;
    let eyeY = curr.target.y + curr.distance * se;
    let eyeZ = curr.target.z + curr.distance * ce * ca;

    // L108 CHASE SPRING-ARM — armed only while piloting (byte-identical everywhere else: this whole branch is
    // skipped → the eye is placed from curr.distance exactly as before, and curr.distance/styleT are untouched).
    // Order-of-ops (spec decision C1): clamp the DESIRED eye's Y FIRST, then run ONE authoritative sweep to that
    // clamped eye and shorten along THAT segment — so the placed eye can't be shoved into a wall the arm cleared.
    if (armEnabled) {
      if (armGroundFn) {                                  // (C2) damp the deck clamp so it glides, not steps
        armGroundY = dampAt(armGroundY, armGroundFn(eyeX, eyeZ), K, dt);
        const gY = armGroundY + CAM_GROUND_SKIN;
        if (eyeY < gY) eyeY = gY;                          // never let the eye sink below the street/seabed
      }
      if (armSegmentQuery) {
        const t = armSegmentQuery(curr.target.x, curr.target.y, curr.target.z, eyeX, eyeY, eyeZ, armRadius);
        const segLen = Math.hypot(eyeX - curr.target.x, eyeY - curr.target.y, eyeZ - curr.target.z);
        const hitDist = t < 1 ? Math.max(ARM_MIN, segLen * t - ARM_SKIN) : segLen;   // shorten to sit in front of the wall
        // asymmetric spring: SNAP IN instantly (never see through a wall), EASE OUT damped (no pop on clear)
        armDist = hitDist < armDist ? hitDist : dampAt(armDist, hitDist, ARM_OUT_K, dt);
        const f = segLen > 1e-4 ? armDist / segLen : 1;    // fraction along the (ground-clamped) chase segment
        eyeX = curr.target.x + (eyeX - curr.target.x) * f;
        eyeY = curr.target.y + (eyeY - curr.target.y) * f;
        eyeZ = curr.target.z + (eyeZ - curr.target.z) * f;
      }
    }
    cam.position.set(eyeX, eyeY, eyeZ);
    cam.lookAt(curr.target);

    /* ORTHO FRUSTUM ANATOMY: an orthographic camera is a BOX, not a pyramid. Its
       left/right/top/bottom are world-unit extents of that box's cross-section.
       We size it from `zoom` (half-height) and the viewport aspect so pixels stay
       square: half-width = half-height · aspect. (Perspective's frustum is a
       truncated pyramid set by fov+aspect — handled in setViewport.) */
    if (cam.isOrthographicCamera) {
      const halfH = curr.zoom;
      const halfW = halfH * aspectRatio;
      cam.left = -halfW; cam.right = halfW;
      cam.top  =  halfH; cam.bottom = -halfH;
      cam.updateProjectionMatrix();
    }
  }

  /* L32 (Hoard): let a game mode DRIVE the camera — follow a target on the ground (damped, or snap),
     set an absolute zoom, and read the live azimuth (so player movement can be camera-relative). */
  function setTarget(x, y, z, snap = false) {
    goal.target.set(x, y, z);
    if (snap) curr.target.copy(goal.target);
  }
  function setZoom(z, snap = false) {
    goal.zoom = THREE.MathUtils.clamp(z, zoomMin, zoomMax);
    if (snap) curr.zoom = goal.zoom;
  }

  /* ----- L76 CHASE-CAM seam: drive the orbit angles directly (the pilot's reactive chase) -----
     The L32 Hoard cam followed a target POSITION but kept whatever azimuth the user had orbited
     to. A piloted vehicle wants the camera to swing BEHIND its heading so "forward" reads as "away
     from the camera" (the camera-relative control frame). These are the angle twins of setTarget:
     set the GOAL, let the rig's existing K-damped curr→goal ease produce the lag/swing-on-turn feel
     for free (snap=true jumps it, e.g. the first frame of possession so the cam doesn't whip round
     the long way). Elevation respects the same goal/curr ease; it's clamped like a free orbit so a
     chase pitch never flips over the pole. Unused outside piloting → zero behaviour change elsewhere. */
  function setAzimuth(a, snap = false) {
    goal.azimuth = nearestAngle(a, curr.azimuth);   // ease the SHORT way round to the new heading
    if (snap) curr.azimuth = goal.azimuth;
  }
  function setElevation(e, snap = false) {
    goal.elevation = THREE.MathUtils.clamp(e, elMin, elMax);
    if (snap) curr.elevation = goal.elevation;
  }

  /* L63 FOLLOW API. setFollow(getWorldPos, {frame, snap}) starts tracking; `frame` (optional)
     auto-frames the object by easing the perspective DOLLY to that inspection distance (the
     ortho half-height for iso/dimetric); `snap` jumps the target there immediately (no glide-in
     from across the map). clearFollow() releases back to free control (the target stays put). */
  function setFollow(getWorldPos, { frame, snap = false } = {}) {
    followFn = getWorldPos;
    if (snap) { followFn(_followPos); goal.target.copy(_followPos); curr.target.copy(_followPos); }
    if (frame != null) {
      if (mode === CAM.PERSPECTIVE) goal.distance = THREE.MathUtils.clamp(frame, distMin, distMax);
      else goal.zoom = THREE.MathUtils.clamp(frame, zoomMin, zoomMax);
    }
  }
  function clearFollow() { followFn = null; }

  /* L108 CHASE SPRING-ARM API. setSpringArm({segmentQuery, getGroundY, radius, enabled}) arms the rig with the
     world-reading fns it needs (mirrors setFollow — the rig takes injected world queries, never owns the world).
     The PilotController calls this on possess (enabled) + with null on release (disarm). geometry is injected, so
     the rig stays world-agnostic. Passing null (or enabled:false) fully disarms → placement byte-identical. */
  function setSpringArm(opts) {
    armSegmentQuery = (opts && opts.segmentQuery) || null;
    armGroundFn     = (opts && opts.getGroundY)   || null;
    armRadius       = (opts && opts.radius != null) ? opts.radius : 0.25;
    armEnabled      = !!(opts && opts.enabled);
    if (armEnabled) { armDist = curr.distance; armGroundY = curr.target.y; }   // seed from the current framing so the first frame doesn't pop
  }

  /* L-cockpit: setEye(pos, lookDir) — pilot controller calls this every COCKPIT frame to override
     the orbit placement. lookDir is the pre-composed world-space look direction (heading + seated look
     offsets); camera-rig calls cam.lookAt(fpPos + fpDir) — no quaternion composing needed here.
     clearEye() exits fp mode so the orbit block resumes on the next update() call. */
  function setEye(pos, lookDir) { fpPos.copy(pos); fpDir.copy(lookDir); fpActive = true; }
  function clearEye() { fpActive = false; }

  return {
    get camera() { return activeCamera(); },
    get mode()   { return mode; },
    get armDist() { return armDist; },        // L108: the effective (possibly-shortened) chase distance — for the spring-arm probes
    get armed()   { return armEnabled; },
    get azimuth() { return curr.azimuth; },        // L32: live heading, for camera-relative movement
    get following() { return !!followFn; },        // L63: is the inspection lens locked onto something?
    setTarget, setZoom, setFollow, clearFollow, setSpringArm,   // L108: the chase spring-arm (pilot arms on possess, disarms on release)
    setEye, clearEye,                                          // L-cockpit: first-person eye override (pilot sets each cockpit frame, clears on exit)
    setAzimuth, setElevation,        // L76: the chase-cam angle seam (the pilot swings the cam behind the craft's heading)
    /* styleT — the rig's current zoom as a normalized 0..1 (0 = nearest, 1 =
       farthest), read off the DAMPED value so a style crossfade follows the eased
       zoom. Perspective normalizes over the style DISTANCE range, ortho over the
       style ZOOM range — the two projections measure "how far" differently, so they
       each need their own range (the Lesson 08 reason the controller can't use one
       number for both). Read-only accessor; no behaviour change. */
    get styleT() {
      return mode === CAM.PERSPECTIVE
        ? THREE.MathUtils.clamp((curr.distance - styleDistNear) / (styleDistFar - styleDistNear), 0, 1)
        : THREE.MathUtils.clamp((curr.zoom - styleZoomNear) / (styleZoomFar - styleZoomNear), 0, 1);
    },
    setMode, orbit, zoomBy, pan, setViewport, update,
  };
}
