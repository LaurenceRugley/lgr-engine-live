/* ============================================================
   profiler.js — Lesson 78: the EngineProfiler — measure HONESTLY (not average fps).
   ------------------------------------------------------------
   The #1 self-deception in our verify so far: a single AVERAGE fps number. The average hides the
   thing you actually FEEL — the occasional long frame (a hitch). A scene can average 60 fps and
   still stutter visibly if 1 frame in 20 takes 50 ms. So this module measures the DISTRIBUTION:

     • CPU frame time → a ring buffer → PERCENTILES (p50 / p95 / p99). The p95 is "19 frames in 20
       are at least this fast" — i.e. the stutter you feel. The mean cannot show it; a long tail
       barely moves the mean but wrecks the p95/p99.
     • GPU time → `EXT_disjoint_timer_query_webgl2` when present. The CPU fps LIES about GPU load:
       DevTools' CPU throttle does NOT throttle the GPU, and a fill-rate-bound phone can be GPU-
       bound while the CPU loop looks idle. The GPU timer is the only honest GPU cost on the web.
     • renderer.info (draw calls / triangles / programs / geometries / textures) → a LEAK GATE:
       geometries/textures should plateau; if they climb unbounded over minutes, something forgot
       to .dispose() (the classic WebGL leak → eventual context loss on mobile).

   ── C++ ANCHORS (Laurence learns via C++) ────────────────────────────────────
   • Percentiles vs mean = a sorted window / histogram, not a running average. `std::nth_element`
     over the last N frame times gives p95 in O(N); the mean is one accumulator that hides the tail.
   • A GPU timer query is an ASYNC FENCE: you `beginQuery`/`endQuery` around the draw, then read the
     result N frames LATER (the GPU is a pipelined coprocessor — you can't read its clock
     synchronously without stalling the pipeline). So we keep a small QUEUE of in-flight queries.
   • The leak gate is a watchdog on an allocator's high-water mark: resident GPU objects should be
     bounded; monotonic growth = a missing free.

   Always-on + cheap: the ring buffer is fixed-size, percentiles are computed ~1×/second (not per
   frame), and the GPU query is one per frame. `frameStart()`/`frameEnd()` bracket the whole frame
   (CPU work + the GPU render the project dispatches between them).
   ============================================================ */

const RING = 120;                       // frames of history (~2 s at 60 fps) — enough for a stable p99

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return 0;
  const i = Math.min(sortedAsc.length - 1, Math.max(0, Math.round((p / 100) * (sortedAsc.length - 1))));
  return sortedAsc[i];
}

export function createEngineProfiler({ renderer }) {
  const gl = renderer.getContext();
  // renderer.info accumulates across every renderer.render() and auto-resets each call; we total a WHOLE
  // frame (sim + grab + beauty + post) by turning auto-reset off and resetting once per frame ourselves.
  // Done LAZILY on the first frameStart() (not at construction) so a project that builds the engine but never
  // ticks the profiler — office/hoard — keeps Three's default autoReset and renders byte-identically (Rule 3).
  let _autoResetOff = false;

  // --- CPU frame-time ring buffer ---
  const ring = new Float32Array(RING);
  const _p95Scratch = new Float32Array(RING);   // L110 (audit B12): reused sort buffer for p95Now (was Array.from()+sort() every FRAME)
  let ringN = 0, ringHead = 0;
  let frameT0 = 0;
  let synthetic = 0;                    // forceLoad(ms): a synthetic per-frame cost, for headless governor tests

  // --- GPU timer query (optional; absent on software GL / Safari) ---
  const ext = gl.getExtension && gl.getExtension('EXT_disjoint_timer_query_webgl2');
  const gpuQueue = [];                  // in-flight queries: { q } read back a few frames later
  let activeQuery = null;
  let gpuMs = null;                     // last good GPU time (null = unavailable / not yet ready)
  const TIME_ELAPSED = ext && ext.TIME_ELAPSED_EXT;
  const GPU_DISJOINT = ext && ext.GPU_DISJOINT_EXT;

  // --- leak gate ---
  let leakBaseline = null, leakFrames = 0, leak = false;

  // --- cached 1-Hz readout ---
  let last = { fps: 0, cpuMs: { p50: 0, p95: 0, p99: 0 }, gpuMs: null, info: null, leak: false, gpuTimer: !!ext };
  let fpsFrames = 0, fpsT0 = (typeof performance !== 'undefined' ? performance.now() : 0);

  function frameStart() {
    if (!_autoResetOff) { renderer.info.autoReset = false; _autoResetOff = true; }   // first tick: own the per-frame reset
    frameT0 = performance.now();
    // capture the PREVIOUS frame's accumulated draw stats, then reset for this frame.
    const r = renderer.info;
    last.info = { calls: r.render.calls, tris: r.render.triangles, programs: r.programs ? r.programs.length : 0, geo: r.memory.geometries, tex: r.memory.textures };
    r.reset();
    // begin a GPU timer query around this frame's render (only one TIME_ELAPSED query may be active at once).
    if (ext && !activeQuery) { activeQuery = gl.createQuery(); gl.beginQuery(TIME_ELAPSED, activeQuery); }
  }

  function frameEnd() {
    // CPU frame time = wall-clock work this frame (+ any synthetic load for tests). This is the number whose
    // p95 is the felt stutter.
    const cpu = (performance.now() - frameT0) + synthetic;
    ring[ringHead] = cpu; ringHead = (ringHead + 1) % RING; if (ringN < RING) ringN++;

    // close + enqueue the GPU query; poll the oldest for a ready result (read back N frames later).
    if (ext && activeQuery) { gl.endQuery(TIME_ELAPSED); gpuQueue.push(activeQuery); activeQuery = null; }
    if (ext && gpuQueue.length) {
      const q = gpuQueue[0];
      const available = gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE);
      const disjoint = gl.getParameter(GPU_DISJOINT);
      if (available || disjoint) {
        gpuQueue.shift();
        if (available && !disjoint) gpuMs = gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6;   // ns → ms
        gl.deleteQuery(q);
      }
    }

    // leak gate: watch resident geometries+textures; flag sustained unbounded growth.
    if (last.info) {
      const resident = last.info.geo + last.info.tex;
      if (leakBaseline == null) { leakBaseline = resident; }
      else if (resident > leakBaseline + 200) { leakFrames++; if (leakFrames > 300) leak = true; }   // ~5 s of growth
      else { leakFrames = Math.max(0, leakFrames - 2); }
    }

    // 1-Hz percentile recompute (cheap: sort a copy of the live window once/second, not per frame).
    fpsFrames++;
    const now = performance.now();
    if (now - fpsT0 >= 1000) {
      const slice = Array.from(ring.subarray(0, ringN)).sort((a, b) => a - b);
      last.fps = fpsFrames;
      last.cpuMs = { p50: +percentile(slice, 50).toFixed(2), p95: +percentile(slice, 95).toFixed(2), p99: +percentile(slice, 99).toFixed(2) };
      last.gpuMs = gpuMs != null ? +gpuMs.toFixed(2) : null;
      last.leak = leak;
      fpsFrames = 0; fpsT0 = now;
      if (typeof window !== 'undefined') { window.__fps = last.fps; window.__perf = sample(); }
    }
  }

  // live p95 (recomputed on demand from the ring) — the governor reads THIS every frame, not the 1-Hz cache,
  // so it reacts within N frames rather than waiting up to a second.
  function p95Now() {
    if (!ringN) return 0;
    const s = _p95Scratch.subarray(0, ringN);   // reuse the scratch (no per-frame alloc)
    s.set(ring.subarray(0, ringN));
    s.sort();                                    // Float32Array.sort is numeric-ascending by default (no comparator needed)
    return percentile(s, 95);
  }

  function sample() {
    return { fps: last.fps, cpuMs: last.cpuMs, gpuMs: last.gpuMs, info: last.info, leak: last.leak, gpuTimer: !!ext };
  }

  return {
    frameStart, frameEnd, sample, p95Now,
    get gpuTimerAvailable() { return !!ext; },
    forceLoad(ms = 0) { synthetic = Math.max(0, ms); },   // test hook: synthesize per-frame cost to exercise the governor
  };
}
