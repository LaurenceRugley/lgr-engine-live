/* ============================================================
   water-flow.js — Lesson 81: LIVE WATER FLOW (From-Dust) — a virtual-pipes shallow-water sim.
   ------------------------------------------------------------
   L68 gave STATIC lakes (flood-fill → flat discs). This is the marquee: DYNAMIC water that flows downhill,
   pools in basins, and RESPONDS to the terrain you sculpt — dig a channel between a full basin and a low
   one and the water flows through it. Nobody else's web showcase lets you sculpt land and watch real water
   react; this is the single biggest "this engine is alive" moment.

   ── THE MODEL: VIRTUAL PIPES (Mei et al. 2007) ───────────────────────────────
   A shallow-water approximation on a grid. Each cell holds a WATER DEPTH `W` and FOUR outflow FLUXES to its
   L/R/up/down neighbours (water in "pipes" between cells). Each tick:
     1. ACCELERATE each flux by the TOTAL-HEIGHT difference (terrain + water) to the neighbour — gravity
        pulls water from high total-head to low. Damp the flux a touch (friction) so it settles, not rings.
     2. CLAMP the total outflow of a cell to the water it actually has this step (you can't move more water
        than exists) — a CFL-style stability guard + exact conservation (no negative depth).
     3. UPDATE the depth: `W += dt·(inflow − outflow)`.
   Water that reaches an OCEAN cell (terrain below sea level — the island's rim) drains away (the sea
   absorbs it), so the world doesn't fill to the brim.

   ── STABILITY (the research's explicit warning) ──────────────────────────────
   Without the per-tick transfer CLAMP and flux DAMPING, a small terrain edit makes the sim oscillate and
   explode (NaN). The clamp bounds each step; the damping bleeds energy so a poured pool SETTLES (over-damped
   oscillator) instead of sloshing forever. dt is clamped too (a long frame can't over-step).

   ── COUPLING (the From-Dust magic) ───────────────────────────────────────────
   `step()` RE-READS the live terrain height every tick, so when the L69 sculpt brush mutates `worldData
   .height`, the very next flow tick sees the new shape: a dug channel lowers the head on one side → flux
   rises → water flows through. The flow reads the same single source of truth the mesh + scatter read.

   C++ anchors: a finite-difference shallow-water solver on a 2-D grid; flux = a per-edge `float` updated by
   the head gradient (gravity) and clamped by available volume (conservation); damping = a friction term
   bleeding kinetic energy (under- vs over-damped). The depth field IS the wave-sim pattern (a CPU buffer
   the render reads), one grid coarser for cost.
   ============================================================ */
import * as THREE from 'three';
import { createWaterFlowGPU } from './water-flow-gpu.js';   // L87: the GPGPU backend (FBO ping-pong), built beside this CPU oracle

/* createWaterFlow({ worldHeightAt, worldSize, grid, seaY, renderer }) — the sim + its own render surface.
   - worldHeightAt(x,z): the LIVE terrain sampler (engine's worldHeightAt → reads the sculpted heightfield).
   - grid: cells per side (96 → ~9.2k cells; coarse + cheap + stable, NOT the full 160² terrain).
   - renderer: (L87) the shared WebGLRenderer — enables the optional GPU backend (`setBackend('gpu')`). */
export function createWaterFlow({ worldHeightAt, applyErosion = null, syncErodedTerrain = null, worldSize = 26, grid = 96, seaY = 0, renderer = null } = {}) {
  const N = grid;
  const W = new Float32Array(N * N);                   // water depth per cell (the field the render reads)
  const fL = new Float32Array(N * N), fR = new Float32Array(N * N);   // outflow flux to left / right
  const fT = new Float32Array(N * N), fB = new Float32Array(N * N);   // outflow flux to top(+z) / bottom(−z)
  const terr = new Float32Array(N * N);               // terrain height sampled per cell (refreshed each step → live coupling)
  // L82 EROSION fields (opt-in): carried sediment per cell + a temp buffer for advecting it downstream.
  const S = new Float32Array(N * N), Sbuf = new Float32Array(N * N);
  const eros = new Float32Array(N * N);               // this-step terrain delta (world-Y) handed to applyErosion()
  let erosionOn = false, erosionK = 1.0;
  const cell = worldSize / (N - 1), half = worldSize / 2;
  const H = worldHeightAt || (() => 0);
  const wx = (i) => i * cell - half, wz = (j) => j * cell - half;
  const ix = (i, j) => j * N + i;

  // --- tuning (the research's stability levers) ---
  const G = 26.0;                // gravity-like flux acceleration (higher = water travels faster / further — visible flow)
  const FLOW = G * cell;         // pipe coefficient (cross-section·g/length folded into one constant)
  const DAMP = 0.90;             // flux damping per tick — over-damped (settles) but mobile enough to channel + drain
  const MIN_DEPTH = 0.006;       // below this a cell reads "dry" (render discards it; avoids a film everywhere)
  // --- L82 EROSION tuning (CONSERVATIVE — erosion is a positive-feedback loop; it blows up far easier than flow) ---
  const KC = 0.5;                // sediment CAPACITY coefficient (capacity ∝ speed × slope)
  const KE = 0.25;              // ERODE rate (how fast under-loaded fast water picks soil up)
  const KD = 0.30;              // DEPOSIT rate (how fast over-loaded slow water drops it)
  const KADV = 6.0;             // sediment ADVECTION rate downstream (carries it to build deltas)
  const MAXD = 0.006;          // ⭐ per-tick terrain-delta CLAMP (world-Y) — the key stability guard (no spikes/pits)
  /* L87 (C-1) GPU EROSION RATE NUDGE — the GPU erodes its 96² grid 1:1 (sharp); the CPU oracle's applyErosion splats
     each coarse delta onto an OVERLAPPING 3×3 fine block, so on re-sample it amplifies/blurs the carve (~3.5× on the
     FINE grid — a CPU upsampling ARTIFACT, not physics; see the L87 parity diagnosis + GLOSSARY "differential testing").
     Per DESIGN's parity-bar call (SHAPE + BEHAVIOUR + STABILITY, NOT bit-magnitude), we nudge the GPU erode/deposit RATE
     + per-tick clamp up so the COARSE carve roughly tracks the oracle's (harness: coarse |Δ| ratio ~0.51→~0.82,
     terrain-Δ correlation 0.81, same-sign 0.91, stable). We deliberately do NOT chase the oracle's FINE-grid
     amplification — that's the rejected option A (enshrining the artifact); the clean bilinear sync (C-2) keeps the GPU
     erosion smooth + ~0.3× the mesh PACE, which is fine (gentler, same channels). CPU rates untouched; GPU-only. 3.0
     balances pace vs the stability clamp (verified no-NaN incl. long runs). */
  const GPU_EROS_RATE = 3.0;

  function sampleTerrain() { for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) terr[ix(i, j)] = H(wx(i), wz(j)); }

  /* ── L87 SELECTABLE SIM BACKEND (the no-regression spine) ───────────────────
     The proven L81/L82 CPU sim below stays the DEFAULT + the reference ORACLE. The GPU backend (FBO ping-pong)
     is built BESIDE it and plugged in here via `_gpu`; `setBackend('gpu')` only switches once it's wired +
     parity-proven. Until then (and as the fallback) every public op runs the CPU path → behaviour byte-identical
     to L82. `setBackend` is the cutover switch; the CPU is never deleted. */
  let backend = 'cpu', _gpu = null;
  // L87 step 2 — GPU-erosion terrain sync state: the LAST-synced GPU terrain (so we push only the INCREMENTAL erosion
  // each sync) + a throttle counter. SYNC_EVERY steps ≈ 3×/sec at 60fps — the bounded read-back, NOT the hot loop.
  const gpuTerrLastSync = new Float32Array(N * N);
  let _gpuSyncTick = 0; const SYNC_EVERY = 20;
  // expose the live terrain sample to the GPU backend (it uploads this into its terrain texture each step).
  function readTerrain(out) { sampleTerrain(); for (let k = 0; k < N * N; k++) out[k] = terr[k]; }
  function ensureGpu() {
    if (_gpu || !renderer) return _gpu;
    // L87 C-1: GPU-only pace match. Scale the erode/deposit RATE *and* the per-tick clamp MAXD together — the CPU's
    // 3×3 overlap raises its EFFECTIVE per-tick budget (not just the rate), so bumping rate alone just saturates the
    // clamp; scaling MAXD too lets the GPU carve at the CPU's effective pace. 2×·MAXD = 0.012 world-Y, still well
    // inside the stable band (the CPU already runs ~0.015 effective via the overlap) — stability re-verified by harness.
    _gpu = createWaterFlowGPU({ renderer, N, cell, half, worldSize, seaY, FLOW, DAMP, MIN_DEPTH, KC, KE: KE * GPU_EROS_RATE, KD: KD * GPU_EROS_RATE, KADV, MAXD: MAXD * GPU_EROS_RATE, readTerrain });
    if (_gpu) group.add(_gpu.mesh);                      // its VTF surface joins the same group (world-mode gated)
    return _gpu;
  }
  function setBackend(name) {
    if (name === 'gpu') {
      ensureGpu();                                       // lazy: pure-CPU use never builds the GPU resources
      if (!_gpu) { if (typeof console !== 'undefined') console.info('[L87] GPU backend unavailable (no renderer / no float RT) — staying on CPU (oracle).'); backend = 'cpu'; setVisibleForBackend(); return backend; }
      backend = 'gpu';
      _gpu.setErosion(erosionOn, erosionK);              // L87: hand the GPU backend the current erosion state on cutover
      if (erosionOn) { readTerrain(gpuTerrLastSync); _gpuSyncTick = 0; }   // erosion already on at cutover → seed the sync reference
    } else backend = 'cpu';
    setVisibleForBackend();
    return backend;
  }
  // show exactly one surface for the active backend (CPU mesh self-hides when dry; GPU parks dry verts via VTF).
  function setVisibleForBackend() {
    if (_gpu) _gpu.setVisible(backend === 'gpu');
    if (backend === 'gpu') mesh.visible = false; else updateSurface();   // CPU recomputes its own wet/visible
  }

  /* L87 step 2 — the throttled GPU→CPU erosion read-back. Every SYNC_EVERY steps: read the GPU terrain RT (a glReadPixels
     stall — bounded, NOT per-frame), diff it against the last sync to get the INCREMENTAL erosion (world-Y), and hand
     that delta to the engine to upsample into worldData.height (mesh/scatter/save). We push a DELTA (not the absolute
     field) so the fine 160² base detail is preserved — the GPU only contributes its erosion, never overwrites. */
  const _gpuDelta = new Float32Array(N * N);
  function maybeSyncGpuTerrain() {
    if (++_gpuSyncTick < SYNC_EVERY) return;
    _gpuSyncTick = 0;
    const cur = _gpu.readTerr();                          // the bounded read-back (GPU terrain world-Y)
    let any = false;
    for (let k = 0; k < N * N; k++) { const d = cur[k] - gpuTerrLastSync[k]; _gpuDelta[k] = d; if (d !== 0) any = true; gpuTerrLastSync[k] = cur[k]; }
    if (any) syncErodedTerrain(_gpuDelta, N);
  }

  function step(dt) {
    if (backend === 'gpu' && _gpu) {
      _gpu.step(dt);                                        // flow (+ erosion) entirely on-GPU, no per-frame read-back
      if (erosionOn && syncErodedTerrain) maybeSyncGpuTerrain();   // L87 step 2: throttled GPU→CPU erosion read-back
      return;
    }
    dt = Math.min(dt, 1 / 30);                         // clamp the timestep (a long frame can't over-step → blow up)
    sampleTerrain();                                   // LIVE coupling: read the (possibly just-sculpted) terrain
    // 1) update the four outflow fluxes from the total-head difference (gravity), damped.
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = ix(i, j); const hc = terr[c] + W[c];
      let l = 0, r = 0, t = 0, b = 0;
      if (i > 0)     l = Math.max(0, fL[c] * DAMP + dt * FLOW * (hc - (terr[c - 1] + W[c - 1])));
      if (i < N - 1) r = Math.max(0, fR[c] * DAMP + dt * FLOW * (hc - (terr[c + 1] + W[c + 1])));
      if (j > 0)     b = Math.max(0, fB[c] * DAMP + dt * FLOW * (hc - (terr[c - N] + W[c - N])));
      if (j < N - 1) t = Math.max(0, fT[c] * DAMP + dt * FLOW * (hc - (terr[c + N] + W[c + N])));
      // 2) clamp: total outflow this step ≤ the water present (conservation; no negative depth = stability).
      const out = (l + r + t + b) * dt;
      const k = out > 1e-9 ? Math.min(1, W[c] / out) : 1;
      fL[c] = l * k; fR[c] = r * k; fB[c] = b * k; fT[c] = t * k;
    }
    // 3) apply net flux (inflow from neighbours − own outflow) to the depth.
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = ix(i, j);
      let inflow = 0;
      if (i > 0)     inflow += fR[c - 1];              // left neighbour's rightward flux enters c
      if (i < N - 1) inflow += fL[c + 1];
      if (j > 0)     inflow += fT[c - N];
      if (j < N - 1) inflow += fB[c + N];
      const outflow = fL[c] + fR[c] + fB[c] + fT[c];
      W[c] += dt * (inflow - outflow);
      if (W[c] < 0) W[c] = 0;
      if (terr[c] < seaY - 0.02) W[c] = 0;             // reached the OCEAN rim → the sea absorbs it (drains off-world)
    }
    if (erosionOn && applyErosion) erode(dt);          // L82: the flow now also RESHAPES the land (opt-in)
    updateSurface();
  }

  /* ---- L82 HYDRAULIC EROSION — fast water on a slope picks up soil (erode), slow water drops it (deposit);
     sediment advects downstream to build deltas. Carves rivers/valleys into the live terrain. Writes a per-cell
     world-Y delta to `eros[]` and hands it to applyErosion() (the engine maps it onto the 160² heightfield +
     rebuilds). STABILITY: erosion is a positive-feedback loop (deeper channel → faster flow → more erosion), so
     every terrain change is CLAMPED per tick (MAXD), sediment is kept ≥0, and the rates are conservative. ---- */
  function erode(dt) {
    eros.fill(0);
    // 1) erode / deposit from sediment CAPACITY (∝ flow speed × slope)
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = ix(i, j);
      if (W[c] <= MIN_DEPTH) { if (S[c] > 0) { const drop = Math.min(MAXD, KD * S[c] * dt); eros[c] += drop; S[c] -= drop; } continue; }   // no water → settle out
      const tf = fL[c] + fR[c] + fT[c] + fB[c];         // total throughflow (volume/time) → a flow-speed proxy
      const v = tf / (W[c] + 0.02);
      const hl = i > 0 ? terr[c - 1] : terr[c], hr = i < N - 1 ? terr[c + 1] : terr[c];
      const hd = j > 0 ? terr[c - N] : terr[c], hu = j < N - 1 ? terr[c + N] : terr[c];
      const slope = Math.min(2.0, Math.hypot(hr - hl, hu - hd) / (2 * cell));
      const cap = KC * v * Math.max(0.05, slope) * erosionK;   // sediment the flow CAN carry here
      if (cap > S[c]) { const d = Math.min(MAXD, KE * (cap - S[c]) * dt); eros[c] -= d; S[c] += d; }        // under-loaded → ERODE (terrain down)
      else            { const d = Math.min(MAXD, KD * (S[c] - cap) * dt); eros[c] += d; S[c] -= d; if (S[c] < 0) S[c] = 0; }   // over-loaded → DEPOSIT
    }
    // 2) advect sediment downstream — carry it along the outflow so it deposits where the flow SLOWS (deltas/banks)
    Sbuf.set(S);
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const c = ix(i, j); const tot = fL[c] + fR[c] + fT[c] + fB[c];
      if (tot <= 1e-9 || S[c] <= 1e-9) continue;
      const move = Math.min(S[c], S[c] * KADV * dt);
      Sbuf[c] -= move;
      if (i > 0)     Sbuf[c - 1] += move * fL[c] / tot;
      if (i < N - 1) Sbuf[c + 1] += move * fR[c] / tot;
      if (j > 0)     Sbuf[c - N] += move * fB[c] / tot;
      if (j < N - 1) Sbuf[c + N] += move * fT[c] / tot;
    }
    S.set(Sbuf);
    for (let k = 0; k < N * N; k++) { if (S[k] < 0) S[k] = 0; if (terr[k] < seaY - 0.02) S[k] = 0; }   // sediment lost to the sea
    applyErosion(eros, N);                              // the engine writes these world-Y deltas into the real heightfield
  }
  function setErosion(on, strength) {
    erosionOn = !!on; if (strength != null) erosionK = Math.max(0, strength); if (!on) S.fill(0);
    if (backend === 'gpu' && _gpu) {
      _gpu.setErosion(on, strength);                       // L87: GPU erosion runs on-GPU (coupled with flow, no per-frame read-back)
      if (on) { readTerrain(gpuTerrLastSync); _gpuSyncTick = 0; }   // seed the sync reference = the terrain the GPU is about to erode from (so the first sync's delta is correct)
    }
  }

  /* ---- a SOURCE: pour water in a disc under the cursor (the obvious interaction) ---- */
  function pourAt(wxx, wzz, amount = 0.5, radius = 1.6) {
    if (backend === 'gpu' && _gpu) return _gpu.pourAt(wxx, wzz, amount, radius);   // L87 seam
    const gi = (wxx + half) / cell, gj = (wzz + half) / cell, R = Math.max(1, radius / cell);
    const i0 = Math.max(0, Math.floor(gi - R)), i1 = Math.min(N - 1, Math.ceil(gi + R));
    const j0 = Math.max(0, Math.floor(gj - R)), j1 = Math.min(N - 1, Math.ceil(gj + R));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const d = Math.hypot(i - gi, j - gj); if (d <= R) W[ix(i, j)] += amount * (1 - d / R);
    }
  }
  function rain(amount = 0.004) { if (backend === 'gpu' && _gpu) return _gpu.rain(amount); sampleTerrain(); for (let k = 0; k < N * N; k++) if (terr[k] > seaY) W[k] += amount; }   // drizzle on land
  function clear() { if (backend === 'gpu' && _gpu) return _gpu.clear(); W.fill(0); fL.fill(0); fR.fill(0); fT.fill(0); fB.fill(0); S.fill(0); updateSurface(); }   // L82: + sediment
  function totalWater() { if (backend === 'gpu' && _gpu) return _gpu.totalWater(); let s = 0; for (let k = 0; k < N * N; k++) s += W[k]; return s; }
  function cellAt(wxx, wzz) { if (backend === 'gpu' && _gpu) return _gpu.cellAt(wxx, wzz); const i = Math.round((wxx + half) / cell), j = Math.round((wzz + half) / cell); return (i < 0 || i >= N || j < 0 || j >= N) ? 0 : W[ix(i, j)]; }

  /* ---- THE RENDER SURFACE — an N×N grid mesh; y = terrain + depth, with a per-vertex `aDepth` the material
     uses to fade thin water out + DISCARD dry cells (so there's no water film on dry land). Reuses the lit
     MeshStandard shader (so it sky-reflects on the beauty tier for free) via an onBeforeCompile splice (same
     pattern as the L80 AO) — no inline ShaderMaterial. Hidden whenever the field is empty → byte-identical
     when flow is unused. ---- */
  const positions = new Float32Array(N * N * 3), depths = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { const c = ix(i, j); positions[c * 3] = wx(i); positions[c * 3 + 1] = -50; positions[c * 3 + 2] = wz(j); }
  const indices = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = ix(i, j), b = ix(i + 1, j), d = ix(i, j + 1), e = ix(i + 1, j + 1);
    indices.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aDepth', new THREE.BufferAttribute(depths, 1));
  geo.setIndex(indices); geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#2f6f96', roughness: 0.14, metalness: 0.45, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vDepth = aDepth;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDepth;')
      // discard dry cells; fade shallow water to translucent so edges read as a thinning film, deep as solid.
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (vDepth < 0.012) discard;\n  gl_FragColor.a *= clamp((vDepth - 0.012) * 7.0, 0.16, 0.86);');
  };
  mat.customProgramCacheKey = () => 'lgr-flow';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.raycast = () => {};
  mesh.renderOrder = 3;                                // draw after the opaque terrain/scatter (it's transparent)
  const group = new THREE.Group(); group.add(mesh); group.raycast = () => {};

  function updateSurface() {
    let wet = 0;
    for (let c = 0; c < N * N; c++) {
      const d = W[c];
      depths[c] = d;
      positions[c * 3 + 1] = d > MIN_DEPTH ? (terr[c] + d) : -50;   // dry cells park far below → never seen
      if (d > MIN_DEPTH) wet++;
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aDepth.needsUpdate = true;
    mesh.visible = wet > 0;                            // empty field → hidden → byte-identical when flow is unused
    if (typeof window !== 'undefined') window.__flowWet = wet;
  }
  updateSurface();

  function totalSediment() { if (backend === 'gpu' && _gpu) return _gpu.totalSediment(); let s = 0; for (let k = 0; k < N * N; k++) s += S[k]; return s; }   // L87: route to the active backend (was CPU-only → reported 0 under GPU)

  return {
    group, step, pourAt, rain, clear, totalWater, cellAt,
    setErosion, totalSediment,                          // L82: hydraulic erosion (opt-in) + a stability probe
    setBackend, get backend() { return backend; },      // L87: selectable sim backend (cpu default+oracle; gpu plugs into _gpu)
    _debugReadW: () => (backend === 'gpu' && _gpu) ? _gpu.readW() : W.slice(),   // L87 test-only: the full W field (parity harness)
    _debugReadTerr: () => { if (backend === 'gpu' && _gpu) return _gpu.readTerr(); sampleTerrain(); return terr.slice(); },   // L87 test-only: the terrain field (GPU RT vs CPU heightfield) for erosion parity
    _debugReadS: () => (backend === 'gpu' && _gpu) ? _gpu.totalSediment() : totalSediment(),   // L87 test-only: total sediment (stability probe)
    _debugStepN: (n, dt = 1 / 60) => { for (let k = 0; k < n; k++) step(dt); },   // L87 test-only: a DETERMINISTIC fixed-dt step burst (synchronous → the rAF tick can't interleave) so CPU/GPU get identical stepping for a fair parity comparison
    get erosion() { return erosionOn; }, get grid() { return N; }, get visible() { return mesh.visible; },
  };
}
