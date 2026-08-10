/* ============================================================
   aim.js — A-AIM (2026-08-08): WHERE IS THE PLAYER POINTING, and how do they say "there".
   ------------------------------------------------------------
   WHY THIS IS IN THE ENGINE AND NOT IN metropolis/main.js. Three separate abilities were about to be
   born project-local inside the swinger:
     1. "what world point is under the crosshair" — a camera-forward segment query. Every aimed verb
        needs it: a grapple, a thrown rope, a pick-at-range, a placement tool in the world editor.
     2. a CROSSHAIR that can say "the thing you are pointing at is out of reach". Any ranged ability
        wants the range fed back visually rather than in text.
     3. POINTER LOCK — capture the mouse, turn the view with raw movement deltas, release on Esc.
   None of those are grapple-specific, so none of them belong to the grapple. The project supplies the
   camera, the world queries and the layout; this module supplies the ability. (Project CLAUDE.md,
   "engine-first": the ABILITY goes in core, the project WIRES it.)

   THE ONE ARCHITECTURAL RULE THIS FILE ENFORCES: a movement MODEL never owns the camera. The model
   receives a resolved world POINT and decides whether it can reach it; it never asks where the eye is.
   That is why `resolveAimPoint` lives here, next to the reticle, and not inside pilot.js.

   WHY THE AIM IS THE CAMERA'S ACTUAL FORWARD, not a reconstructed one: because then the crosshair
   cannot lie. Whatever the rig does to the eye — a spring arm shortening it, the ground clamp lifting
   it, a damped orbit still easing — the ray we test is the ray the player is looking down, so the mark
   at screen centre always shows the point that would actually be hit.

   C++ anchor: `resolveAimPoint` is a free function taking an out-parameter (no allocation, caller owns
   the storage), and the two `create*` functions are small RAII-ish objects with an explicit dispose().
   ============================================================ */

/* ---------------------------------------------------------------------------------------------
   resolveAimPoint(camera, world, out, opts) → out | null
   ------------------------------------------------------------------------------------------
   Cast a segment from the camera along its own forward vector and return the first solid point.
     camera  — any THREE camera (we only read .position + .getWorldDirection)
     world   — the injected world query bag; needs `segmentHit(ox,oy,oz, ex,ey,ez, r) -> t∈[0,1]`
               (1 = the segment is clear). Same contract the chase spring-arm already uses.
     out     — a PLAIN {x,y,z} the caller owns and reuses (no-hot-alloc invariant #7). Deliberately
               not a THREE.Vector3, so a consumer can hand this straight to a model as `axes.aimPoint`
               without dragging the math library across the seam.
     maxDist — how far down the ray to look. Note this is measured from the EYE, so a chase camera
               spends the first `chaseDist` units of it getting to the body. Size it accordingly.
     radius  — the query's sphere radius; small, so the mark is precise rather than forgiving.

   Returns `out` on a hit and `null` on clear sky. NULL IS A FIRST-CLASS ANSWER, not an error: aiming
   at the sky is a legitimate thing a player does, and the consumer shows it as "nothing there".
   --------------------------------------------------------------------------------------------- */
export function resolveAimPoint(camera, world, out, { maxDist = 8, radius = 0.05 } = {}) {
  if (!camera || !world || !world.segmentHit || !out) return null;
  /* getWorldDirection needs a THREE.Vector3-shaped target (it writes .x/.y/.z then normalises via
     methods), so we read the camera's world matrix directly instead — the third column of a view
     matrix, negated, IS the forward vector, and doing it by hand keeps this module THREE-free. */
  const e = camera.matrixWorld.elements;
  // matrixWorld columns are [right, up, backward, position]; forward = -backward (column 2, e[8..10]).
  let fx = -e[8], fy = -e[9], fz = -e[10];
  const fl = Math.hypot(fx, fy, fz) || 1;
  fx /= fl; fy /= fl; fz /= fl;
  const ox = camera.position.x, oy = camera.position.y, oz = camera.position.z;
  const ex = ox + fx * maxDist, ey = oy + fy * maxDist, ez = oz + fz * maxDist;
  const t = world.segmentHit(ox, oy, oz, ex, ey, ez, radius);
  if (!(t < 1)) return null;                     // clear down the whole ray (also catches undefined/NaN)
  const d = t * maxDist;
  out.x = ox + fx * d; out.y = oy + fy * d; out.z = oz + fz * d;
  return out;
}

/* ---------------------------------------------------------------------------------------------
   createTargetLock() → { lock, clear, has, point, age, tick }        (A-LOCK, 2026-08-09)
   ------------------------------------------------------------------------------------------
   THE OWNER'S NEW SCHEME, in one sentence of his: "you left click to LOCK ONTO a place, and then you
   right click to shoot a web". So the aim splits into two moments — CHOOSING a point and USING it —
   and the thing between them is a stored world position that outlives the frame it was picked in.

   WHY THIS IS AN ENGINE ABILITY AND NOT FOUR LINES IN THE LAB. Because those four lines contain a bug
   that is invisible until it bites, and it is a bug this repo has the shape of already:
   `resolveAimPoint` writes into a REUSED out-parameter (the no-hot-alloc invariant demands it — one
   `{x,y,z}` per consumer, rewritten every frame). Store that object as "the lock" and the lock is not
   a lock at all: it is a live alias of the crosshair, silently following your view, and every
   downstream range check answers about where you are looking NOW. It would look correct in every
   still screenshot and be wrong in every frame of motion. So the one job this module has is to COPY,
   and it exists so that job is done once, in the place the next aimed verb will also reach for.

   `age` is seconds since the lock was taken (`tick(dt)` to advance it) — a consumer that wants a lock
   to expire has the number; nothing here expires anything on its own, because a lock the game quietly
   dropped is exactly the kind of latched-state bug this repo keeps writing down.

   C++ anchor: a `std::optional<vec3>` with value semantics. The whole point is that `lock()` copies
   rather than storing a pointer to someone else's frame buffer.
   --------------------------------------------------------------------------------------------- */
export function createTargetLock() {
  const pt = { x: 0, y: 0, z: 0 };
  let has = false, age = 0;
  return {
    /* Returns true if a lock was taken. A null point (the player clicked at the sky) is NOT an error
       and is NOT a clear either — it simply takes no lock, so an existing one survives a fumbled
       click. Clearing is an explicit verb. */
    lock(p) {
      if (!p || typeof p.x !== 'number') return false;
      pt.x = p.x; pt.y = p.y; pt.z = p.z;      // COPY. See the header — this line is the module.
      has = true; age = 0;
      return true;
    },
    clear() { has = false; age = 0; },
    tick(dt) { if (has && dt > 0) age += dt; },
    get has() { return has; },
    get age() { return age; },
    /* The stored point, or null. Returned by reference for the same no-hot-alloc reason — a consumer
       hands it straight to a model as `axes.aimPoint` — and it is only ever written by `lock()`. */
    get point() { return has ? pt : null; },
  };
}

/* ---------------------------------------------------------------------------------------------
   createLockMarker({ container, size, color }) → { place, setVisible, setInRange, element, dispose }
   ------------------------------------------------------------------------------------------
   THE LOCK MADE VISIBLE — the owner asked for this by name: "it should be VISIBLE — a marker on the
   locked point — and it should persist so you can see what you are about to web".

   IT IS A DOM ELEMENT, NOT A MESH, and that is a deliberate choice with three consequences worth the
   ink. (1) It keeps this module free of THREE, which is the property that lets it sit next to
   `resolveAimPoint` — the projection below reads the camera's two matrices by hand, exactly as
   `resolveAimPoint` reads `matrixWorld` by hand. (2) A screen-space mark stays a constant, readable
   size at 1 u and at 30 u, where a world-space sphere becomes a dot you cannot find — and "where is
   my lock" is the question it exists to answer. (3) It cannot be occluded by the geometry it is
   stuck to, which for a marker ON a facade is the difference between an affordance and a peekaboo.

   AN OFF-SCREEN LOCK IS CLAMPED TO THE EDGE rather than hidden, because "I locked something and then
   looked away" must not read as "my lock is gone". It dims (`.off`) so the two cases stay distinct.
   Behind the eye it is hidden outright — a clamped mark for something behind you points the wrong
   way, which is worse than no mark.

   `place(camera, point, opts)` is called once per frame from the consumer's loop, AFTER the render,
   because `camera.matrixWorldInverse` is what the renderer freshens — calling it before renders the
   marker one frame stale, which on a fast swing is visible.
   --------------------------------------------------------------------------------------------- */
let _lockStyleInjected = false;
function injectLockStyle() {
  if (_lockStyleInjected) return;
  _lockStyleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .lgr-lock {
      position: fixed; left: 0; top: 0; z-index: 44; pointer-events: none; display: none;
      width: var(--lgr-lock-size, 30px); height: var(--lgr-lock-size, 30px);
      margin-left: calc(var(--lgr-lock-size, 30px) / -2); margin-top: calc(var(--lgr-lock-size, 30px) / -2);
      opacity: 1; transition: opacity 0.12s linear;
      will-change: transform;
    }
    .lgr-lock.on { display: block; }
    .lgr-lock.off { opacity: 0.4; }
    .lgr-lock.out-of-range i { background: var(--lgr-lock-dim, #8a7a5e); }
    /* four corner brackets — the classic "target acquired" read, and the open middle keeps the
       actual locked pixel visible, same rule as the reticle. */
    .lgr-lock i { position: absolute; display: block; background: var(--lgr-lock-color, #f0884a); }
    .lgr-lock i:nth-child(1) { left: 0; top: 0; width: 34%; height: 2px; }
    .lgr-lock i:nth-child(2) { left: 0; top: 0; width: 2px; height: 34%; }
    .lgr-lock i:nth-child(3) { right: 0; top: 0; width: 34%; height: 2px; }
    .lgr-lock i:nth-child(4) { right: 0; top: 0; width: 2px; height: 34%; }
    .lgr-lock i:nth-child(5) { left: 0; bottom: 0; width: 34%; height: 2px; }
    .lgr-lock i:nth-child(6) { left: 0; bottom: 0; width: 2px; height: 34%; }
    .lgr-lock i:nth-child(7) { right: 0; bottom: 0; width: 34%; height: 2px; }
    .lgr-lock i:nth-child(8) { right: 0; bottom: 0; width: 2px; height: 34%; }
  `;
  document.head.appendChild(s);
}

/* World point → normalised screen, by hand. `matrixWorldInverse` is the VIEW matrix and
   `projectionMatrix` the projection; THREE stores both COLUMN-MAJOR, so element [row + 4*col] — i.e.
   row 0 is e[0], e[4], e[8], e[12]. Returns false when the point is at or behind the eye plane
   (clip w <= 0), which is the case a naive divide turns into a mirrored ghost on the wrong side of
   the screen. C++ anchor: this is `gl_Position = P * V * vec4(p,1)` done on the CPU. */
export function projectToScreen(camera, x, y, z, out) {
  if (!camera || !camera.matrixWorldInverse || !camera.projectionMatrix || !out) return false;
  const v = camera.matrixWorldInverse.elements, p = camera.projectionMatrix.elements;
  const ex = v[0] * x + v[4] * y + v[8] * z + v[12];
  const ey = v[1] * x + v[5] * y + v[9] * z + v[13];
  const ez = v[2] * x + v[6] * y + v[10] * z + v[14];
  const cx = p[0] * ex + p[4] * ey + p[8] * ez + p[12];
  const cy = p[1] * ex + p[5] * ey + p[9] * ez + p[13];
  const cw = p[3] * ex + p[7] * ey + p[11] * ez + p[15];
  if (!(cw > 1e-6)) return false;                       // behind the eye (also catches NaN)
  out.x = (cx / cw) * 0.5 + 0.5;                        // 0..1, left→right
  out.y = 0.5 - (cy / cw) * 0.5;                        // 0..1, top→bottom (screen y is flipped)
  return true;
}

export function createLockMarker({ container = document.body, size = 30, color = '#f0884a', margin = 26 } = {}) {
  injectLockStyle();
  const el = document.createElement('div');
  el.className = 'lgr-lock';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--lgr-lock-size', `${size}px`);
  el.style.setProperty('--lgr-lock-color', color);
  for (let i = 0; i < 8; i++) el.appendChild(document.createElement('i'));
  container.appendChild(el);
  const _s = { x: 0, y: 0 };                    // hoisted: the projection's out-param (invariant #7)
  let visible = false, onScreen = false, sx = 0, sy = 0;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  return {
    element: el,
    /* Returns true if the point projected in FRONT of the eye. The consumer needs that answer anyway
       (a HUD may want to say "behind you"), and returning it beats making the caller re-project. */
    place(camera, point) {
      if (!visible || !point) { el.classList.remove('on'); return false; }
      const w = window.innerWidth, h = window.innerHeight;
      if (!projectToScreen(camera, point.x, point.y, point.z, _s)) {
        el.classList.remove('on');
        onScreen = false;
        return false;
      }
      const px = _s.x * w, py = _s.y * h;
      onScreen = px >= 0 && px <= w && py >= 0 && py <= h;
      sx = clamp(px, margin, w - margin);
      sy = clamp(py, margin, h - margin);
      el.style.transform = `translate3d(${sx}px, ${sy}px, 0)`;
      el.classList.add('on');
      el.classList.toggle('off', !onScreen);
      return true;
    },
    setVisible(v) { visible = !!v; if (!visible) el.classList.remove('on'); },
    setInRange(v) { el.classList.toggle('out-of-range', !v); },
    get visible() { return visible; },
    get onScreen() { return onScreen; },
    get screen() { return { x: sx, y: sy }; },
    dispose() { el.remove(); },
  };
}

/* ---------------------------------------------------------------------------------------------
   applyLook(orbit, dx, dy, opts) — THE ONE PLACE THE MOUSE→ORBIT SIGN CONVENTION LIVES.
   ------------------------------------------------------------------------------------------
   WHY THIS FUNCTION EXISTS AT ALL, rather than a `-dy` at each call site. The owner's report was
   "the looking around is inverted — when you use the mouse up and point the crosshair at a building,
   it should correspond to moving the mouse up", and the bug was three bare sign flips (pointer lock,
   pointer drag, touch look) that all had to agree and had no name between them. A convention nobody
   named is a convention nobody can audit, so it is a NAMED OPTION now: `invertY`, default false =
   NOT inverted = mouse up looks up. A consumer that wants flight-sim pull-back-to-climb passes true.

   THE SIGN ITSELF IS NOT ARBITRARY, and it is worth deriving because it reads backwards. An orbit rig
   puts the eye at target + d·(azimuth, elevation) and looks AT the target, so forward.y = −d·sin(el):
   RAISING elevation lifts the eye and tilts the view DOWN. Aiming UP therefore means LOWERING
   elevation. DOM `movementY` is positive when the mouse moves DOWN. So "mouse up ⇒ aim up" is
   dEl = +dy (mouse up ⇒ dy<0 ⇒ elevation falls ⇒ forward tilts up) — the identity, not the negation
   that was there. (GRAPPLE_PROFILE.chaseElevMin = −1.05 exists for exactly this reason: it lets the
   eye swing UNDER the body so the forward vector can point up at the anchors worth taking.)

   dAz KEEPS ITS EXISTING SIGN (−dx: mouse right turns the view right). The owner reported the Y axis
   only, and this repo's rule is to change what was asked and leave what was not — but `invertX` is
   here beside it so the pair is symmetrical and neither has to be rediscovered.

   TAKES THE RIG'S `orbit` AS A CALLBACK and returns nothing, because it runs on every mousemove:
   returning a {dAz,dEl} pair would allocate on the hottest input path in the app (no-hot-alloc
   invariant #7). For the same reason a caller should HOIST the options object rather than writing an
   inline literal at the call site.

   C++ anchor: a free function taking a callable — `template<class F> void applyLook(F&& orbit, …)`.
   --------------------------------------------------------------------------------------------- */
export function applyLook(orbit, dx, dy, { speed = 1, invertY = false, invertX = false } = {}) {
  if (!orbit) return;
  orbit((invertX ? dx : -dx) * speed, (invertY ? -dy : dy) * speed);
}

/* ---------------------------------------------------------------------------------------------
   createAimReticle({ container, size, color }) → { setVisible, setInRange, element, dispose }
   ------------------------------------------------------------------------------------------
   A crosshair pinned to screen CENTRE. Two states and no text:
     IN RANGE  — bright; the thing under the mark can be reached.
     OUT       — dimmed; you are pointing at nothing, or at something too far away.
   That dimming is the entire range TUTORIAL. A player learns `ropeMax` by watching the mark go dull
   as they raise their aim, which is a thing you feel in half a second and would ignore as a number in
   a hint bar.

   It is `aria-hidden` and `pointer-events:none`: it is a pointer affordance layered over a canvas, it
   conveys nothing a screen reader can act on, and it must never eat a click meant for the world.
   --------------------------------------------------------------------------------------------- */
let _reticleStyleInjected = false;
function injectReticleStyle() {
  if (_reticleStyleInjected) return;
  _reticleStyleInjected = true;
  const s = document.createElement('style');
  s.textContent = `
    .lgr-reticle {
      position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%);
      z-index: 45; pointer-events: none; display: none;
      width: var(--lgr-reticle-size, 26px); height: var(--lgr-reticle-size, 26px);
      opacity: 0.32; transition: opacity 0.12s linear;
    }
    .lgr-reticle.on { display: block; }
    .lgr-reticle.in-range { opacity: 1; }
    .lgr-reticle i {
      position: absolute; background: var(--lgr-reticle-color, #f2f4f8); display: block;
      box-shadow: 0 0 2px rgba(0,0,0,0.85);
    }
    /* four ticks around an open centre — the open centre is the point, so the mark never hides
       the very pixel it is marking. */
    .lgr-reticle i:nth-child(1) { left: 50%; top: 0;    width: 1.5px; height: 34%; margin-left: -0.75px; }
    .lgr-reticle i:nth-child(2) { left: 50%; bottom: 0; width: 1.5px; height: 34%; margin-left: -0.75px; }
    .lgr-reticle i:nth-child(3) { top: 50%; left: 0;    height: 1.5px; width: 34%; margin-top: -0.75px; }
    .lgr-reticle i:nth-child(4) { top: 50%; right: 0;   height: 1.5px; width: 34%; margin-top: -0.75px; }
    .lgr-reticle i:nth-child(5) { left: 50%; top: 50%; width: 2px; height: 2px; margin: -1px 0 0 -1px; border-radius: 50%; }
  `;
  document.head.appendChild(s);
}

export function createAimReticle({ container = document.body, size = 26, color = '#f2f4f8' } = {}) {
  injectReticleStyle();
  const el = document.createElement('div');
  el.className = 'lgr-reticle';
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--lgr-reticle-size', `${size}px`);
  el.style.setProperty('--lgr-reticle-color', color);
  for (let i = 0; i < 5; i++) el.appendChild(document.createElement('i'));
  container.appendChild(el);
  let visible = false, inRange = false;
  return {
    element: el,
    setVisible(v) { visible = !!v; el.classList.toggle('on', visible); },
    setInRange(v) { inRange = !!v; el.classList.toggle('in-range', inRange); },
    get visible() { return visible; },
    get inRange() { return inRange; },
    dispose() { el.remove(); },
  };
}

/* ---------------------------------------------------------------------------------------------
   createPointerLockAim({ element, onLook, onFire, onLockChange }) → { request, exit, locked, dispose }
   ------------------------------------------------------------------------------------------
   POINTER LOCK is the input half of "you aim by looking": the cursor disappears, the mouse reports raw
   `movementX/Y` deltas with no screen edge to run into, and the crosshair — being pinned to centre —
   becomes the thing you steer. Esc releases it; that is the browser's own contract and we do not fight
   it (nor can we — it is a user-agent guarantee, and a good one).

   WHY FIRE IS `mousedown` AND NOT `click`: the whole feel of the swing is that RELEASE is the launch.
   A click is a press+release collapsed into one event, which cannot express "hold the line". So we
   report the press edge and the release edge separately and let the consumer hold state.

   `onLook` REPORTS RAW `movementX/Y` PIXELS and deliberately applies no sign of its own — the look
   convention is `applyLook` above, because pointer lock is only ONE of the three ways a player turns
   this view (drag and touch are the others) and a sign that lived in only one of them is exactly the
   bug the owner reported. Feed these deltas to `applyLook(rig.orbit, dx, dy, LOOK)` and the three
   routes cannot drift apart.

   TWO THINGS THIS GUARDS, both of them the latched-state failure class this repo keeps hitting:
     • Losing the lock (Esc, tab switch, the page navigating) fires onFire(false) BEFORE onLockChange,
       so a consumer can never be left holding a line it has no way to release.
     • While locked, wheel events are swallowed at CAPTURE phase. A locked aim view that dollies or
       scrolls under the wheel is a hijack: the player asked for a fixed mark and got a moving one.
   --------------------------------------------------------------------------------------------- */
export function createPointerLockAim({
  element,
  onLook = null,        // (movementX, movementY) — raw pixel deltas while locked
  onFire = null,        // (down: boolean) — the press edge and the release edge of the LEFT button
  onButton = null,      // (button: number, down: boolean) — EVERY button, including 2 (right). A-LOCK.
  onLockChange = null,  // (locked: boolean)
} = {}) {
  let locked = false, firing = false;
  /* A-LOCK (2026-08-09): THE RIGHT BUTTON IS A SECOND VERB, and `onFire` could not carry it.
     The owner's scheme binds LEFT to "lock onto a place" and RIGHT to "shoot the web", so this module
     had to stop being a one-trigger device. `onFire` is UNCHANGED — still the left button, still the
     press/release edges — because metropolis binds the web to it and this arc is not allowed to break
     that (Rule 7: the call sites were grepped; metropolis/main.js:661 is the other one). `onButton` is
     the general form beside it, and a consumer picks whichever it needs.
     `held` is the state a lost lock has to clear, and it is a SET rather than a pair of booleans so
     adding a middle-click verb later is not a third latch to remember to release. */
  const held = new Set();

  const setFiring = (v) => { if (firing === v) return; firing = v; if (onFire) onFire(v); };
  const setButton = (btn, down) => {
    if (down === held.has(btn)) return;         // edges only — a repeat is not an edge
    if (down) held.add(btn); else held.delete(btn);
    if (onButton) onButton(btn, down);
  };
  /* THE ONE EXIT PATH, and everything the entry path took goes back through it. The repo's recurring
     bug class is a latched input a lost lock forgot to clear (this file's own header names it), and
     a SECOND button doubled the surface — a right button stuck down means a rope you cannot re-fire. */
  const clearHeld = () => {
    setFiring(false);
    for (const b of [...held]) setButton(b, false);
  };

  const onMove = (e) => { if (locked && onLook) onLook(e.movementX || 0, e.movementY || 0); };
  const onDown = (e) => {
    if (!locked) return;
    if (e.button === 0) setFiring(true);
    setButton(e.button, true);
    e.preventDefault();
  };
  const onUp = (e) => {
    if (e.button === 0) setFiring(false);
    setButton(e.button, false);
  };
  /* A RIGHT-CLICK VERB AND A CONTEXT MENU CANNOT COEXIST. Chrome suppresses the menu under pointer
     lock, but the press that ACQUIRES the lock is not yet locked — so without this the very first
     right-click of a session pops the menu over the canvas and eats the web. Swallowed on the element
     rather than the document, so the rest of the page keeps its normal menu. */
  const onMenu = (e) => { e.preventDefault(); };
  const onWheel = (e) => { if (locked) { e.preventDefault(); e.stopPropagation(); } };
  const onChange = () => {
    const now = document.pointerLockElement === element;
    if (now === locked) return;
    locked = now;
    if (!locked) clearHeld();                   // exit path clears what the entry path took
    if (onLockChange) onLockChange(locked);
  };
  const onError = () => { if (locked) { locked = false; clearHeld(); if (onLockChange) onLockChange(false); } };

  document.addEventListener('pointerlockchange', onChange);
  document.addEventListener('pointerlockerror', onError);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mousedown', onDown);
  document.addEventListener('mouseup', onUp);
  if (element) element.addEventListener('contextmenu', onMenu);
  // capture:true + passive:false so the swallow beats any zoom handler already bound to the canvas.
  window.addEventListener('wheel', onWheel, { capture: true, passive: false });

  return {
    /* Must be called from inside a user gesture (a pointerdown handler) or the browser refuses.
       The promise form rejects on a too-soon re-request after an Esc; swallow that — the player just
       clicks again, and an unhandled rejection in the console is a worse outcome than a no-op. */
    request() {
      if (locked || !element || !element.requestPointerLock) return false;
      try { const p = element.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch { /* refused */ }
      return true;
    },
    exit() { if (locked && document.exitPointerLock) document.exitPointerLock(); },
    get locked() { return locked; },
    get firing() { return firing; },
    /* The live button state, for a consumer that polls rather than latching on the callback — and for
       a PROBE, which must be able to assert the trigger actually arrived (swing-ledger.md technique
       #5: any harness that synthesises input must assert the input ARRIVED). */
    down(btn) { return held.has(btn); },
    dispose() {
      document.removeEventListener('pointerlockchange', onChange);
      document.removeEventListener('pointerlockerror', onError);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('mouseup', onUp);
      if (element) element.removeEventListener('contextmenu', onMenu);
      window.removeEventListener('wheel', onWheel, { capture: true });
    },
  };
}
