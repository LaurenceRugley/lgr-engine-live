/* ============================================================
   loader-progress.js (L107) — one shared THREE.LoadingManager + a 0..1 progress signal.
   ------------------------------------------------------------
   The first 3 seconds are the conversion metric, but today the loader is a static "LOADING…" and the
   landmark GLBs pop in AFTER the reveal. This module is the seam for loading-v2: every real asset (the
   landmark GLBs, their textures) routes through ONE LoadingManager, and consumers subscribe to a single
   0..1 value that counts the wave-sim PREWARM as a synthetic FINAL item — so the bar reaches 100% exactly
   as the scene is ready to reveal, not when the last byte lands.

   C++ anchor: a std::latch counted down by the loader threads (the GLB fetches) plus one extra count the
   main thread releases when prewarm() finishes; the UI polls the fraction still latched.

   Engine-first: createEngine owns one instance and hands its `.manager` to the landmark factory; the app
   subscribes via onProgress() to drive the #lgr-loader UI. Zero render-path effect → tiers byte-identical.
   ============================================================ */
import * as THREE from 'three';

export function createLoaderProgress({ urlModifier } = {}) {
  const manager = new THREE.LoadingManager();
  if (urlModifier) manager.setURLModifier(urlModifier);

  const listeners = [];
  // PREWARM is a synthetic extra item (weight 1) so the bar doesn't hit 100% before shaders/RTT are warm.
  const PREWARM_WEIGHT = 1;
  let loaded = 0, total = 1, prewarmDone = 0, done = false;

  const frac = () => Math.min(1, (loaded + prewarmDone) / Math.max(1, total + PREWARM_WEIGHT));
  const emit = () => { const p = frac(); for (const l of listeners) { try { l(p, done); } catch (e) { /* a listener must not break loading */ } } };

  manager.onProgress = (url, itemsLoaded, itemsTotal) => { loaded = itemsLoaded; total = itemsTotal; emit(); };
  manager.onLoad = () => { loaded = total; emit(); };   // all real assets in; the bar holds at total/(total+1) until prewarm

  return {
    manager,
    /* subscribe to the 0..1 progress (called with (p, done)); fires immediately with the current value. */
    onProgress(cb) { listeners.push(cb); cb(frac(), done); return () => { const i = listeners.indexOf(cb); if (i >= 0) listeners.splice(i, 1); }; },
    /* the app calls this once prewarm() has finished → releases the synthetic item → progress reaches 1.0. */
    markReady() { if (done) return; prewarmDone = PREWARM_WEIGHT; done = true; emit(); },
    get value() { return frac(); },
    get done() { return done; },
  };
}
