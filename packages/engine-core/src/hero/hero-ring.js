/* ============================================================
   hero-ring.js — pure ring-advance logic for createHeroDirector.
   ------------------------------------------------------------
   Extracted as a standalone module so the advance/wrap logic can be
   node:test'd without WebGL or a full director instance.

   C++ anchor: a circular index into a vector<ScenePack*> with wrap-around
   semantics — same ring an audio playback queue or UI carousel uses.
   ============================================================ */

/* createRing(count) — ring state over count ≥ 1 scenes.
   Returns: current (getter), next(), prev(), goTo(i). */
export function createRing(count) {
  if (count < 1) throw new RangeError('createRing: count must be >= 1');
  let _current = 0;

  function next() {
    if (count === 1) return _current;      // single scene — no-op
    _current = (_current + 1) % count;
    return _current;
  }

  function prev() {
    if (count === 1) return _current;
    _current = (_current - 1 + count) % count;
    return _current;
  }

  function goTo(i) {
    if (i < 0 || i >= count) throw new RangeError(`goTo(${i}) out of range [0, ${count})`);
    _current = i;
    return _current;
  }

  return {
    get current() { return _current; },
    get size() { return count; },
    next, prev, goTo,
  };
}

/* shouldAutoAdvance(reducedMotion, dwell, elapsed) — pure advance policy.
   Returns true only when the dwell has elapsed AND reduced-motion is off.
   WHY: users with motion sensitivity must never see uninitiated transitions
   (WCAG 2.3.3 — animation from interactions). */
export function shouldAutoAdvance(reducedMotion, dwell, elapsed) {
  if (reducedMotion) return false;
  return elapsed >= dwell;
}

/* disposeAll(packs) — iterate and dispose each pack in index order.
   The director calls this on teardown; extracted so tests can verify
   disposal without a GPU context. */
export function disposeAll(packs) {
  for (const pack of packs) pack.dispose();
}
