/* ============================================================
   createSmoothScroll.js — first-party smooth scrolling + a scroll-progress seam.
   ------------------------------------------------------------
   The engine ability that lets the showcase DELETE vendor/lenis.min.js. It smooths WHEEL + TOUCH into
   an eased glide of the REAL document scroll, and emits Lenis-shaped scroll/progress events so the
   swap is near-drop-in (see the mapping in HANDOFF).

   SIBLING, not a duplicate, of createScrollDirector: that one is HOST-PUMPED and only READS native
   scroll into a damped [0,1] progress (for in-engine scroll-linked camera); it never touches the
   wheel. THIS one CHANGES the scroll (the glide) and owns its own loop. A consumer that only wants
   progress-from-native-scroll uses createScrollDirector; a page that wants Lenis-style smoothing uses
   this.

   ── TWO FAILURE CLASSES MADE STRUCTURALLY IMPOSSIBLE (the doctrine, owner-re-ratified) ──
   1. THE UN-PUMPED-LENIS DEAD SCROLL (F07). Lenis exposed `raf(t)` and did nothing until the host
      pumped it; a forgotten pump = silent dead glide. This module is SELF-PUMPING — it owns its rAF,
      there is no external pump to forget. And because a self-driven loop can die SILENTLY (the reason
      createScrollDirector went the other way, host-pumped), we add a LIVENESS SELF-CHECK: the loop
      re-schedules itself BEFORE its body runs and wraps the body in try/catch, so a thrown error can
      never kill it; input handlers self-heal a stalled loop; and current() exposes frame liveness for
      a probe. Self-pump (kills forgotten-pump) + liveness (kills silent-death) = the synthesis.
   2. FIGHTING ACCESSIBILITY / AUDIT PROBES (F1). Everything that is NOT a wheel/touch glide stays
      100% NATIVE and RESYNCS this module, so nothing is ever hijacked:
        - reduced-motion => start() attaches NOTHING and never pumps (OFF, not "less smoothing").
        - keyboard (arrows/space/PageUp/Down/Home/End), anchor jumps, focus-driven scroll, scrollbar
          drag => native scroll moves the page; a scroll listener RESYNCS our virtual position to it,
          so the loop never overrides them.
        - nested scrollables (inner overflow, textareas) => a wheel over one that can still scroll in
          that direction is NOT preventDefault'd — native handles it.

   No hot allocation in the loop (all scalars + one hoisted event object). Side-effect-free at import.
   C++ anchor: a self-scheduling integrator with a watchdog — think a game loop that re-arms its timer
   at the top of the tick and raises a flag if a tick is ever missed.
   ============================================================ */
import { damp, clamp } from './math.js';
import { resolveEasing } from './math/easing.js';

/* ── pure math (unit-tested headless — no DOM) ── */
export const lerp = (a, b, t) => a + (b - a) * t;
export const clampScroll = (y, limit) => clamp(y, 0, Math.max(0, limit));
export const scrollProgress = (y, limit) => (limit > 0 ? clamp(y / limit, 0, 1) : 0);
/* instantaneous velocity in px/s; dt<=0 guards a divide-by-zero on a doubled/zero-dt frame. */
export const scrollVelocity = (prevY, y, dt) => (dt > 0 ? (y - prevY) / dt : 0);

export function createSmoothScroll({
  smooth        = 9,        // damp rate for the wheel-follow glide (higher = snappier; frame-rate independent)
  wheelMultiplier = 1,      // scale raw wheel delta
  touchMultiplier = 1.4,    // touch drags feel slower 1:1, so amplify a little
  reducedMotion,            // tri-state: true=always native, false=always smooth, undefined=follow matchMedia
} = {}) {
  const hasDOM = typeof window !== 'undefined' && typeof document !== 'undefined';
  const scroller = hasDOM ? (document.scrollingElement || document.documentElement) : null;
  const rmQuery = (hasDOM && window.matchMedia) ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const wantNative = () => reducedMotion === true || (reducedMotion === undefined && !!(rmQuery && rmQuery.matches));

  let active = false;
  let targetY = 0, currentY = 0, prevY = 0, velocity = 0, direction = 0;
  let rafId = null, lastT = 0, frames = 0, lastFrameAt = 0;
  let touchY = 0;
  let tween = null;         // active scrollTo animation: { fromY, toY, elapsed, duration, ease, resolve }
  const listeners = { scroll: [], progress: [] };

  /* One hoisted event object — mutated + handed to listeners each emit (no per-frame allocation).
     Field NAMES match Lenis's event so the showcase swap is a rename-free listener body. */
  const ev = { scroll: 0, limit: 0, velocity: 0, direction: 0, progress: 0 };

  const limit = () => (scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0);
  const emit = (name) => {
    ev.scroll = currentY; ev.limit = limit(); ev.velocity = velocity;
    ev.direction = direction; ev.progress = scrollProgress(currentY, ev.limit);
    for (const cb of listeners[name]) cb(ev);
  };

  /* Does a wheel/touch at `node` land on a nested scrollable that can still scroll in `dir`? If so we
     must NOT hijack — native handles the inner scroll (and form fields / inner overflow keep working). */
  function nestedCanScroll(node, dir) {
    let n = node;
    while (n && n !== document.body && n !== document.documentElement && n.nodeType === 1) {
      const st = getComputedStyle(n);
      const oy = st.overflowY;
      if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) {
        const atTop = n.scrollTop <= 0;
        const atBottom = n.scrollTop + n.clientHeight >= n.scrollHeight - 1;
        if ((dir < 0 && !atTop) || (dir > 0 && !atBottom)) return true;
      }
      n = n.parentElement;
    }
    return false;
  }

  function onWheel(e) {
    if (!active || tween) return;
    if (nestedCanScroll(e.target, Math.sign(e.deltaY))) return;   // native inner scroll — do not hijack
    e.preventDefault();
    targetY = clampScroll(targetY + e.deltaY * wheelMultiplier, limit());
    ensureLoop();
  }
  function onTouchStart(e) { if (active && e.touches.length === 1) touchY = e.touches[0].clientY; }
  function onTouchMove(e) {
    if (!active || tween || e.touches.length !== 1) return;
    const y = e.touches[0].clientY, dy = (touchY - y) * touchMultiplier;
    touchY = y;
    if (nestedCanScroll(e.target, Math.sign(dy))) return;
    e.preventDefault();
    targetY = clampScroll(targetY + dy, limit());
    ensureLoop();
  }

  /* NATIVE ALWAYS WINS. Anything we did NOT cause (keyboard, anchor, focus, scrollbar drag) moves
     scrollTop away from currentY; if it drifts past this many px since our last write, we ADOPT it —
     so the loop can never fight native scrolling. Our own writes land within ~1px, so they never trip
     it. Checked at the TOP of every frame (structural), not via a race-prone scroll-event handler. */
  const RESYNC_PX = 3;

  function frame(now) {
    rafId = requestAnimationFrame(frame);      // RE-ARM FIRST — a throw below can never kill the loop
    try {
      const dt = lastT ? Math.min(0.05, (now - lastT) / 1000) : 0;
      lastT = now; frames++; lastFrameAt = now;

      if (tween) {                              // programmatic scrollTo animation
        tween.elapsed += dt * 1000;
        const t = tween.duration > 0 ? Math.min(1, tween.elapsed / tween.duration) : 1;
        currentY = lerp(tween.fromY, tween.toY, tween.ease(t));
        scroller.scrollTop = currentY;
        velocity = scrollVelocity(prevY, currentY, dt); direction = Math.sign(currentY - prevY); prevY = currentY;
        emit('scroll'); emit('progress');
        if (t >= 1) { targetY = currentY; const r = tween.resolve; tween = null; if (r) r(); }
        return;
      }

      /* Adopt native scroll BEFORE the glide runs — this is why keyboard/anchor/focus can never be
         stomped mid-glide (the exact bug the first cut had). */
      const nativeY = scroller.scrollTop;
      if (Math.abs(nativeY - currentY) > RESYNC_PX) { targetY = currentY = nativeY; }

      const dy = targetY - currentY;
      if (Math.abs(dy) > 0.1) {
        currentY = clampScroll(damp(currentY, targetY, smooth, dt), limit());
        scroller.scrollTop = currentY;          // scroll the REAL document (native scrollbar/anchors keep working)
      }
      /* Emit on ANY change — whether from our glide OR an adopted native scroll — so a consumer
         (motion.js) gets progress/scroll on keyboard + anchor scrolling too, exactly like it did off Lenis. */
      if (Math.abs(currentY - prevY) > 0.01) {
        velocity = scrollVelocity(prevY, currentY, dt); direction = Math.sign(currentY - prevY); prevY = currentY;
        emit('scroll'); emit('progress');
      } else if (velocity !== 0) {
        velocity = 0; direction = 0;
        emit('scroll'); emit('progress');       // one settle event at rest
      }
    } catch (err) {
      if (typeof console !== 'undefined') console.error('[createSmoothScroll] frame error (loop kept alive):', err);
    }
  }

  function ensureLoop() { if (active && rafId === null) { lastT = 0; rafId = requestAnimationFrame(frame); } }

  function onRMChange() { if (wantNative()) stop(); }   // OS toggles reduced-motion mid-session → go native

  function start() {
    if (!hasDOM || active) return api;
    if (wantNative()) {                          // reduced motion => FULL native passthrough, attach nothing
      if (rmQuery && rmQuery.addEventListener) rmQuery.addEventListener('change', onRMChange);
      return api;
    }
    active = true;
    currentY = targetY = prevY = scroller.scrollTop;
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    if (rmQuery && rmQuery.addEventListener) rmQuery.addEventListener('change', onRMChange);
    rafId = requestAnimationFrame(frame);
    return api;
  }

  function stop() {
    active = false;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    if (hasDOM) {
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchmove', onTouchMove);
    }
    return api;
  }

  /* scrollTo(target, opts) — target is a number (px), a selector, or an element. duration in ms; a
     falsy/immediate duration jumps. Returns a Promise that resolves when the glide lands. */
  function scrollTo(target, { duration = 800, easing = 'easeInOutCubic', immediate = false, offset = 0 } = {}) {
    if (!hasDOM) return Promise.resolve();
    let toY = 0;
    if (typeof target === 'number') toY = target;
    else {
      const eln = typeof target === 'string' ? document.querySelector(target) : target;
      if (eln) toY = eln.getBoundingClientRect().top + scroller.scrollTop;
    }
    toY = clampScroll(toY + offset, limit());
    if (!active || immediate || duration <= 0 || wantNative()) {
      currentY = targetY = prevY = toY;
      if (scroller) scroller.scrollTop = toY;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      tween = { fromY: currentY, toY, elapsed: 0, duration, ease: resolveEasing(easing), resolve };
      ensureLoop();
    });
  }

  function on(evt, cb) { (listeners[evt] || (listeners[evt] = [])).push(cb); return () => off(evt, cb); }
  function off(evt, cb) { const a = listeners[evt]; if (a) { const i = a.indexOf(cb); if (i >= 0) a.splice(i, 1); } }

  /* current() — Lenis-shaped snapshot + liveness. `alive` is false if the loop hasn't ticked recently
     while active (the self-check a probe reads). */
  function current() {
    return {
      scroll: currentY, limit: limit(), velocity, direction,
      progress: scrollProgress(currentY, limit()), active, frames,
      alive: !active || (typeof performance !== 'undefined' ? performance.now() - lastFrameAt < 250 : true),
    };
  }

  function dispose() {
    stop();
    if (rmQuery && rmQuery.removeEventListener) rmQuery.removeEventListener('change', onRMChange);
    listeners.scroll.length = 0; listeners.progress.length = 0;
  }

  const api = { start, stop, scrollTo, on, off, current, dispose,
    get scroll() { return currentY; }, get progress() { return scrollProgress(currentY, limit()); },
    get velocity() { return velocity; }, get direction() { return direction; },   // Lenis parity: motion.js reads .direction directly
    get limit() { return limit(); }, get active() { return active; } };
  return api;
}
