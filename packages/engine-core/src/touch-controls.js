/* ============================================================
   touch-controls.js — the FLOATING THUMBSTICK + look-drag, lifted to engine-core (2026-08-06).
   ------------------------------------------------------------
   WHY IT EXISTS HERE: touch input was implemented FIVE separate times in this repo (projects/city,
   office, hoard, hoard2, atlas) and never once in the engine — so metropolis, the newest project,
   shipped with NO way to move on a phone at all: its input is WASD + pointer-drag, and a phone has
   no W key. That is the wiring-drift class the project CLAUDE.md names, in its purest form. This
   module is the ability; a project supplies only the layout choice and reads the axes.

   THE PATTERN (proven in projects/city's pilot HUD, L104 P2 — a NippleJS-style dynamic stick):
   the stick has NO fixed position. It SPAWNS wherever the thumb lands inside its zone, so the user
   never has to look down to find it; the knob tracks the drag out to a max radius and the analog
   axes come from that offset. Release recentres and zeroes. The rest of the screen is a LOOK surface
   (one finger drag = look), so both hands work the way a phone player expects.

   ACCESSIBILITY carried over from the city original: the zone is aria-hidden (it is a pointer
   affordance with a keyboard parallel — WASD — already present), and both the zone and the stick
   respect safe-area insets so the notch/home-indicator never eats the control.

   C++ anchor: an input-device adapter that normalises a platform gesture stream into the same
   analog axis struct the keyboard path already produces — the consumer reads one shape either way.
   ============================================================ */

/* createTouchControls({ container, onLook, zoneWidth, zoneHeight, maxRadius, lookScale })
     container  — the element to mount into (default document.body)
     onLook(dx, dy) — called with pixel deltas for one-finger drags OUTSIDE the stick zone
     Returns { axes: {x, y, boost}, active, element, setVisible(v), dispose() }
   `axes` is a LIVE object (never reallocated — the no-hot-alloc invariant): read axes.x/axes.y each
   frame. x = steer/strafe (right positive), y = throttle/forward (up positive), each in [-1, 1].
   axes.boost ∈ [0,1] is the phone's SPRINT: push the stick past its rim (see boostAt/boostFull). */
export function createTouchControls({
  container = document.body,
  onLook = null,
  onTap = null,             // (clientX, clientY) — a TAP (no drag) on the look surface; the consumer's pick/dive path
  zoneWidth = '100%',       // owner feedback 2026-08-06: bottom half = MOVE (stick spawns under the thumb anywhere in it)
  zoneHeight = '50%',       //                          top half = LOOK — the split he found by feel, formalized
  maxRadius = 52,
  lookScale = 1,
  boostAt = 1.25,           // stick travel (× maxRadius) where boost STARTS ramping — past the rim, so
  boostFull = 1.75,         // ordinary full-throttle never trips it by accident; full boost by 1.75×
  lift = false,             // A-LIFT: opt-in vertical rocker (see below). Default off ⇒ byte-identical.
  onLiftPress = null,       // (dir) => {} on the PRESS EDGE of each rocker button — the touch parallel
                            // of a keydown, for verbs bound to a key PRESS rather than a hold.
  liftLabels = ['▲', '▼'],
} = {}) {
  const axes = { x: 0, y: 0, boost: 0, lift: 0 };
  const coarse = !!(typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

  const css = document.createElement('style');
  css.textContent = `
  .lgr-touch-zone { position:fixed; left:0; bottom:0; width:${zoneWidth}; height:${zoneHeight}; z-index:7;
    pointer-events:auto; touch-action:none; }
  .lgr-touch-stick { position:fixed; z-index:8; width:120px; height:120px; margin:-60px 0 0 -60px; border-radius:50%;
    background:rgba(16,18,24,.34); border:2px solid rgba(184,153,104,.5); display:none; pointer-events:none; }
  .lgr-touch-stick.on { display:block; }
  .lgr-touch-knob { position:absolute; left:50%; top:50%; width:56px; height:56px; margin:-28px 0 0 -28px; border-radius:50%;
    background:rgba(184,153,104,.9); box-shadow:0 2px 12px rgba(0,0,0,.55); will-change:transform; }
  /* BOOST state — the only signal that the over-push gesture engaged. Colour + ring, no layout shift. */
  .lgr-touch-stick.boost { border-color:rgba(255,196,92,.95); box-shadow:0 0 0 3px rgba(255,196,92,.22); }
  .lgr-touch-stick.boost .lgr-touch-knob { background:rgba(255,196,92,.98); }
  .lgr-touch-look { position:fixed; inset:0; z-index:6; pointer-events:auto; touch-action:none; }
  /* A-LIFT — the VERTICAL rocker. z-index 9 puts it above the stick zone (7) and the look surface (6),
     so a thumb on it never also spawns the stick underneath. Sized ≥44px per side for touch targets and
     parked clear of the home indicator. */
  .lgr-touch-lift { position:fixed; z-index:9; display:none; flex-direction:column; gap:10px; touch-action:none;
    right:max(14px, calc(env(safe-area-inset-right) + 10px));
    bottom:max(104px, calc(env(safe-area-inset-bottom) + 104px)); }
  .lgr-touch-lift.on { display:flex; }
  .lgr-touch-lift button { width:62px; height:56px; border-radius:15px; cursor:pointer;
    border:2px solid rgba(184,153,104,.5); background:rgba(16,18,24,.42); color:#e8dfc8;
    font:600 21px/1 system-ui, sans-serif; -webkit-tap-highlight-color:transparent; touch-action:none; }
  .lgr-touch-lift button.held { background:rgba(184,153,104,.92); color:#241a0a; border-color:rgba(184,153,104,.95); }
  @media (prefers-reduced-motion: reduce) { .lgr-touch-knob { transition:none; } }
  `;
  document.head.appendChild(css);

  // LOOK surface sits UNDER the stick zone (lower z) so the stick always wins its own corner.
  const look = document.createElement('div');
  look.className = 'lgr-touch-look';
  look.setAttribute('aria-hidden', 'true');
  const zone = document.createElement('div');
  zone.className = 'lgr-touch-zone';
  zone.setAttribute('aria-hidden', 'true');   // pointer affordance; WASD is the keyboard parallel
  const stick = document.createElement('div');
  stick.className = 'lgr-touch-stick';
  const knob = document.createElement('div');
  knob.className = 'lgr-touch-knob';
  stick.appendChild(knob);
  container.append(look, zone, stick);

  /* ── A-LIFT (2026-08-07): the VERTICAL rocker ────────────────────────────────────────────────
     WHY IT HAD TO EXIST. Three of metropolis's six bodies drive a LIFT axis — the helicopter climbs
     and descends on it, the gull's entire energy trade (climb spends speed, dive buys it) is that
     axis, and the fish uses it for the whole water column plus the breach. Every one of them was
     wired to the KEYBOARD only. Measured on a 390x844 phone before writing this: full stick forward
     for two seconds in heli, bird and fish gives Δy = 0.000, 0.000, 0.000. Not "awkward on mobile" —
     the vertical dimension simply did not exist there, so half the engine's bodies were ornaments on
     a phone. Same wiring-drift class the project CLAUDE.md names: the ability shipped, one input path
     never inherited it.

     WHY BUTTONS AND NOT A SECOND STICK. The layout is already spoken for — bottom half moves, top
     half looks (the owner's own split, formalised). A right-hand twin stick would have to steal from
     the look surface, which is the one thing that already works well by feel. Two discrete buttons
     read as verbs (climb / dive), fit the thumb that is not on the stick, and cost no look area.

     onLiftPress fires on the PRESS EDGE, which is the touch parallel of a keydown. Verbs bound to a
     press rather than a hold (metropolis's plunge — "the gull hits the water and becomes the fish")
     were otherwise unreachable on a phone no matter how the axis was exposed. */
  const liftEl = document.createElement('div');
  liftEl.className = 'lgr-touch-lift';
  liftEl.setAttribute('aria-hidden', 'true');       // pointer affordance; the keyboard parallel exists
  const mkLiftBtn = (label, dir) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.dataset.dir = String(dir);
    let pid = null;
    b.addEventListener('pointerdown', (e) => {
      if (pid !== null) return;
      pid = e.pointerId; axes.lift = dir; b.classList.add('held');
      b.setPointerCapture(e.pointerId);
      if (onLiftPress) onLiftPress(dir);
      e.preventDefault(); e.stopPropagation();      // never also spawn the stick underneath
    });
    const up = (e) => {
      if (e.pointerId !== pid) return;
      pid = null; b.classList.remove('held');
      // Only clear the axis if the OTHER button is not currently held (two-thumb mash).
      if (!liftEl.querySelector('button.held')) axes.lift = 0;
      else axes.lift = Number(liftEl.querySelector('button.held').dataset.dir);
      e.preventDefault(); e.stopPropagation();
    };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());   // long-press must not open a menu
    return b;
  };
  liftEl.append(mkLiftBtn(liftLabels[0], 1), mkLiftBtn(liftLabels[1], -1));
  container.append(liftEl);
  const setLiftVisible = (v) => {
    liftEl.classList.toggle('on', !!v);
    if (!v) { axes.lift = 0; liftEl.querySelectorAll('button.held').forEach((b) => b.classList.remove('held')); }
  };
  setLiftVisible(lift && coarse);

  let sid = null, ox = 0, oy = 0;             // stick pointer id + spawn origin
  let lid = null, lx = 0, ly = 0;             // look pointer id + last position

  function stickDown(e) {
    if (sid !== null) return;
    sid = e.pointerId; ox = e.clientX; oy = e.clientY;
    stick.style.left = `${ox}px`; stick.style.top = `${oy}px`;
    stick.classList.add('on');
    knob.style.transform = 'translate(0px, 0px)';
    zone.setPointerCapture(e.pointerId);
    e.preventDefault();
  }
  function stickMove(e) {
    if (e.pointerId !== sid) return;
    let dx = e.clientX - ox, dy = e.clientY - oy;
    const len = Math.hypot(dx, dy);
    /* BOOST (A-SPRINT, 2026-08-07) — the phone's Shift key. A phone has none, and the stick already
       clamps to maxRadius, so everything past the rim was thrown away. Now it RAMPS a boost axis:
       nothing until `boostAt`× the radius, full at `boostFull`×. The gesture is the obvious one —
       slam the stick forward — and it costs no screen real estate on a display that is mostly city.
       The knob turns hot so the state is visible; without that the axis would be undiscoverable. */
    const over = (len / maxRadius - boostAt) / (boostFull - boostAt);
    axes.boost = Math.max(0, Math.min(1, over));
    stick.classList.toggle('boost', axes.boost > 0);
    if (len > maxRadius) { dx = (dx / len) * maxRadius; dy = (dy / len) * maxRadius; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    axes.x = dx / maxRadius;
    axes.y = -dy / maxRadius;                 // screen-down is +y; forward is up
    e.preventDefault();
  }
  function stickUp(e) {
    if (e.pointerId !== sid) return;
    sid = null; axes.x = 0; axes.y = 0; axes.boost = 0;
    stick.classList.remove('on'); stick.classList.remove('boost');
    knob.style.transform = 'translate(0px, 0px)';
  }
  zone.addEventListener('pointerdown', stickDown);
  zone.addEventListener('pointermove', stickMove);
  zone.addEventListener('pointerup', stickUp);
  zone.addEventListener('pointercancel', stickUp);

  let ldx = 0, ldy = 0, ldt = 0;   // accumulated drag + start time → tap detection
  function lookDown(e) { if (lid !== null) return; lid = e.pointerId; lx = e.clientX; ly = e.clientY; ldx = 0; ldy = 0; ldt = performance.now(); look.setPointerCapture(e.pointerId); }
  function lookMove(e) {
    if (e.pointerId !== lid) return;
    ldx += Math.abs(e.clientX - lx); ldy += Math.abs(e.clientY - ly);
    if (onLook) onLook((e.clientX - lx) * lookScale, (e.clientY - ly) * lookScale);
    lx = e.clientX; ly = e.clientY;
    e.preventDefault();
  }
  function lookUp(e) {
    if (e.pointerId !== lid) return;
    lid = null;
    /* TAP → the consumer's pick path. Without this, the look overlay SWALLOWS every tap — on the
       phone, tap-a-tower-to-dive was silently dead (the canvas underneath never sees the event).
       Same 6px/400ms discrimination as the desktop click-vs-drag. */
    if (onTap && ldx + ldy < 6 && performance.now() - ldt < 400) onTap(e.clientX, e.clientY);
  }
  look.addEventListener('pointerdown', lookDown);
  look.addEventListener('pointermove', lookMove);
  look.addEventListener('pointerup', lookUp);
  look.addEventListener('pointercancel', lookUp);

  let _liftWanted = lift && coarse;   // what the consumer asked for, independent of global visibility
  const setVisible = (v) => {
    const d = v ? '' : 'none'; zone.style.display = d; look.style.display = d;
    if (!v) stick.classList.remove('on');
    setLiftVisible(v && _liftWanted);   // hiding the controls must hide the rocker too, or it floats alone
  };
  setVisible(coarse);                          // desktop: inert by default; ?touch=1 consumers call setVisible(true)

  return {
    axes, element: zone, coarse, setVisible,
    /* setLift(v) — show/hide the vertical rocker. A consumer calls this per MODE, not once at boot:
       only the bodies that USE the lift axis (heli / bird / fish) should show it, and a rocker sitting
       there inert while you drive a car is worse than no rocker at all. */
    setLift: (v) => { _liftWanted = !!v && coarse; setLiftVisible(_liftWanted); },
    get liftVisible() { return liftEl.classList.contains('on'); },
    get active() { return sid !== null; },
    dispose() { zone.remove(); stick.remove(); look.remove(); liftEl.remove(); css.remove(); },
  };
}
