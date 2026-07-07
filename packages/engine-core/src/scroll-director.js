/* ============================================================
   scroll-director.js — native-scroll → damped [0,1] progress (the F02 lift; the F07 fix).
   ------------------------------------------------------------
   The scroll→camera seam graduated out of showcase-lab into the engine core: a project used to hand-roll "map a
   smoothed scroll scalar onto a chaptered camera path", so the ABILITY now lives here, parameterized, and a project
   only CONFIGURES it (engine-first, non-negotiable). It replaces Lenis — which, because its `raf` was never pumped,
   contributed ZERO glide (F07: dead trackpad scroll, a self-driven loop nobody ticked). This adds the easing Lenis
   promised, from the ONE loop we've proven runs.

   The ONLY moving part is `update(dt)` — the host calls it once per frame.
   C++ anchor: `update(dt)` is a kernel handed a const `dt` each tick — it owns no clock and spawns no thread; the host
   loop (the shell) is the sole scheduler, exactly like a physics `step(dt)` you call from YOUR loop rather than one that
   self-drives a timer. That single fact is why F07 (a missing pump of a self-driven loop) CANNOT recur here: there is no
   separate loop to forget — if `update` isn't called, `progress` simply doesn't change (a loud, total, every-input
   failure), never Lenis's silent-partial "scrollTo works but the wheel is dead".

   Side-effect-free at import (no listeners, no reads at construction beyond one seed measure) so `sideEffects:false`
   keeps it tree-shaken out of the city money-path bundle (F05).
   ============================================================ */
import { damp, clamp } from './math.js';

export function createScrollDirector({ el, smooth = 6, reducedMotion, onProgress, clampOverscroll = true } = {}) {
  // scroll SOURCE = the poll target (NOT a listener target). Native document scroll is the transport, so wheel /
  // trackpad / touch / keyboard (Space/PageDn/Home/End/arrows) / scrollbar / anchor jumps all drive it for free.
  const scroller = el || (typeof document !== 'undefined'
    ? (document.scrollingElement || document.documentElement) : null);
  // reduced-motion is decided in exactly ONE place. tri-state: true → always snap; false → always ease; undefined →
  // follow the LIVE matchMedia (so a user toggling the OS setting mid-session is honoured without a rebuild).
  const rm = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const wantSnap = () => reducedMotion === true || (reducedMotion === undefined && !!(rm && rm.matches));

  let _progress = 0, _target = 0;
  const EPS = 1e-4;                                   // settle threshold: once within EPS, snap to kill the asymptote tail
  const maxScroll = () => scroller ? Math.max(1, scroller.scrollHeight - scroller.clientHeight) : 1;  // Max(1,…) → no /0
  const readTarget = () => {
    if (!scroller) return 0;
    const r = scroller.scrollTop / maxScroll();
    return clampOverscroll ? clamp(r, 0, 1) : r;      // clamp kills iOS rubber-band > 1 / < 0
  };
  _target = _progress = readTarget();                 // seed sync so a deep-linked mid-page load doesn't animate from 0

  // PUMP — call once per frame from the host loop, as its first line (before any branch), with the frame dt.
  function update(dt) {
    _target = readTarget();                           // poll INSIDE the loop proven to run → live scrollTop, live resize
    if (wantSnap() || smooth <= 0) {
      _progress = _target;                            // damp(curr,goal,0,dt) freezes (===curr), NOT a snap — special-case
    } else {
      _progress = damp(_progress, _target, smooth, dt);
      if (Math.abs(_target - _progress) < EPS) _progress = _target;
    }
    if (onProgress) onProgress(_progress, _target);
    return _progress;
  }

  // programmatic scroll: move the NATIVE scrollTop (so the transport stays the single source of truth); immediate snaps
  // the eased value too (for instant test/deep-link jumps).
  function scrollTo(p, { immediate = false } = {}) {
    const t = clamp(p, 0, 1);
    if (scroller) scroller.scrollTop = t * maxScroll();
    _target = t;
    if (immediate) _progress = t;
  }

  return {
    get progress() { return _progress; },             // EASED ∈[0,1] → CONTINUOUS consumers (camera, rail, accent, sound)
    get targetProgress() { return _target; },         // RAW native ratio ∈[0,1] → DISCRETE gates (endHero/config/render)
    update, scrollTo,
    refresh() { _target = readTarget(); },            // re-measure after a layout change the poll would otherwise catch next frame anyway
    destroy() { /* no listeners were attached — idempotent no-op (kept for API symmetry with future listener paths) */ },
  };
}
