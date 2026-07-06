/* ============================================================
   water-flow-gpu.js — Lesson 87: the GPGPU flow + EROSION backend (FBO ping-pong).
   ------------------------------------------------------------
   (L87 3/n reconcile: folds the sub-commit-3 flow+EROSION work — drafted as a separate
   water-flow-gpgpu.js while an OS file-lock held this file — back into the canonical, wired
   name. One backend module; the CPU sim in water-flow.js stays the default + reference oracle.)

   The GPU twin of the CPU virtual-pipes + hydraulic-erosion sim in water-flow.js. The CPU sim
   stays the DEFAULT + the reference ORACLE; this runs the SAME math on the GPU so it parity-
   matches. It mirrors the proven wave-sim pattern in createEngine.js (render-target ping-pong +
   a fullscreen quad whose fragment shader is the per-cell kernel + vertex-texture-fetch for the
   visible surface) — Rule 6: do NOT invent a different GPGPU style.

   ── DATA on the GPU (one texel per grid cell) ────────────────────────────────
     • STATE   ping-pong (A/B):  RGBA = (W depth, S sediment, ·, ·)
     • FLUX    ping-pong (A/B):  RGBA = (L, R, B, T outflow)
     • TERRAIN ping-pong (A/B):  R = world-Y. GPU EROSION mutates it, so it must be an RT (you
       can't write CPU-side into an RT). Seeded from the live CPU heightfield via a copy pass
       on a DIRTY flag (new world / sculpt / erosion-enable); between seeds it evolves on-GPU.

   ── A TICK (step) — no per-frame read-back ──────────────────────────────────
     flux pass → depth pass            (the flow; sub-commit 2)
     + when erosion ON:  erode-terrain ‖ erode-sediment → advect-sediment   (sub-commit 3)
   Flow reads the terrain RT; erosion writes it → the From-Dust flow↔erosion feedback stays
   entirely on the GPU (the whole point — no GPU→CPU round-trip in the hot loop). Pour/rain are
   immediate source passes. The visible surface is drawn by VTF from the state+terrain textures.

   ── TERRAIN authority (the two regimes) ──────────────────────────────────────
     • erosion OFF → terrain is CPU-authoritative: re-uploaded every step (live sculpt coupling;
       preserves the dig-a-channel headline). (The per-step re-upload is cheap vs the JS sim it replaces —
       the L87 perf win is already decisive: world+flow+erosion CPU-frame p95 9.8ms → 2.0ms. A further
       dirty-flag to skip the upload when terrain is unchanged is a future micro-opt, not needed for the win.)
     • erosion ON  → terrain is GPU-authoritative: seeded once, then erosion evolves it on-GPU.
       The throttled read-back that syncs the eroded terrain to CPU worldData.height is sub-commit 4.

   ── RENDER-TARGET TYPE (deliberate deviation from the wave-sim's HalfFloat — surfaced, Rule 6) ──
   FloatType, because flow accumulates volume + erosion deltas (half-float ~3-digit precision
   drifts) and parity needs a clean float read-back. Same architecture; precision bump. Probes
   EXT_color_buffer_float; absent → returns null and the caller keeps CPU (no regression).

   C++ anchors: each RT = a 2-D float array on the GPU; ping-pong = double-buffering; the scatter
   advect becomes a GATHER (each texel pulls its neighbours' shares — you can't scatter-write in a
   fragment shader); readRenderTargetPixels = a glReadPixels pipeline stall (test/throttle only).
   ============================================================ */
import * as THREE from 'three';

import fullscreenVert  from './shaders/fullscreen.vert';
import flowFluxFrag    from './shaders/flow-flux.frag';
import flowDepthFrag   from './shaders/flow-depth.frag';
import flowSourceFrag  from './shaders/flow-source.frag';
import flowCopyFrag    from './shaders/flow-copy.frag';
import flowErodeTFrag  from './shaders/flow-erode-terr.frag';
import flowErodeSFrag  from './shaders/flow-erode-sed.frag';
import flowAdvectFrag  from './shaders/flow-advect.frag';

export function createWaterFlowGPU({ renderer, N, cell, half, worldSize, seaY = 0,
  FLOW, DAMP, MIN_DEPTH, KC, KE, KD, KADV, MAXD, readTerrain }) {
  const gl = renderer.getContext();
  const floatOk = !!(gl && gl.getExtension && gl.getExtension('EXT_color_buffer_float'));
  if (!floatOk) {
    if (typeof console !== 'undefined') console.warn('[L87] EXT_color_buffer_float unavailable — GPU flow backend cannot run; staying on CPU.');
    return null;
  }

  const rtOpts = {
    type: THREE.FloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false,
  };
  let state = [new THREE.WebGLRenderTarget(N, N, rtOpts), new THREE.WebGLRenderTarget(N, N, rtOpts)];
  let flux  = [new THREE.WebGLRenderTarget(N, N, rtOpts), new THREE.WebGLRenderTarget(N, N, rtOpts)];
  let terr  = [new THREE.WebGLRenderTarget(N, N, rtOpts), new THREE.WebGLRenderTarget(N, N, rtOpts)];   // GPU-mutated terrain

  // CPU → GPU terrain SEED path (a DataTexture copied into terr[0] by flow-copy.frag).
  const terrData = new Float32Array(N * N * 4);
  const terrUploadTex = new THREE.DataTexture(terrData, N, N, THREE.RGBAFormat, THREE.FloatType);
  terrUploadTex.minFilter = THREE.NearestFilter; terrUploadTex.magFilter = THREE.NearestFilter;
  terrUploadTex.wrapS = terrUploadTex.wrapT = THREE.ClampToEdgeWrapping;
  const _terrScratch = new Float32Array(N * N);

  let erosionOn = false, erosionK = 1.0, _terrDirty = true;

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false; quadScene.add(quad);
  const texel = new THREE.Vector2(1 / N, 1 / N);

  const mk = (frag, extra) => new THREE.ShaderMaterial({ vertexShader: fullscreenVert, fragmentShader: frag, uniforms: extra });
  const fluxMat = mk(flowFluxFrag, {
    uState: { value: null }, uTerr: { value: null }, uFlux: { value: null },
    uTexel: { value: texel }, uN: { value: N }, uDt: { value: 0 }, uFlow: { value: FLOW }, uDamp: { value: DAMP },
  });
  const depthMat = mk(flowDepthFrag, {
    uState: { value: null }, uTerr: { value: null }, uFlux: { value: null },
    uTexel: { value: texel }, uN: { value: N }, uDt: { value: 0 }, uSeaY: { value: seaY },
  });
  const sourceMat = mk(flowSourceFrag, {
    uState: { value: null }, uTerr: { value: null }, uN: { value: N }, uSeaY: { value: seaY },
    uRain: { value: 0 }, uPourCount: { value: 0 },
    uPours: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) }, uPourR: { value: new Float32Array(8) },
  });
  const copyMat = mk(flowCopyFrag, { uSrc: { value: terrUploadTex } });
  const eUni = () => ({                                   // shared erosion uniforms
    uState: { value: null }, uTerr: { value: null }, uFlux: { value: null }, uTexel: { value: texel },
    uN: { value: N }, uDt: { value: 0 }, uCell: { value: cell }, uSeaY: { value: seaY },
    uKC: { value: KC }, uKE: { value: KE }, uKD: { value: KD }, uMaxD: { value: MAXD }, uMinDepth: { value: MIN_DEPTH }, uErosK: { value: erosionK },
  });
  const erodeTMat = mk(flowErodeTFrag, eUni());
  const erodeSMat = mk(flowErodeSFrag, eUni());
  const advectMat = mk(flowAdvectFrag, { uState: { value: null }, uTerr: { value: null }, uFlux: { value: null }, uTexel: { value: texel }, uN: { value: N }, uDt: { value: 0 }, uSeaY: { value: seaY }, uKADV: { value: KADV } });

  function runPass(material, target) {
    quad.material = material;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target); renderer.render(quadScene, quadCam); renderer.setRenderTarget(prev);
  }
  const _cc = new THREE.Color();
  function clearRT(target) {
    const prevRT = renderer.getRenderTarget(), prevA = renderer.getClearAlpha();
    renderer.getClearColor(_cc);
    renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    renderer.setClearColor(_cc, prevA); renderer.setRenderTarget(prevRT);
  }
  // seed the terrain RT from the live CPU heightfield (the dig-a-channel coupling).
  function uploadTerrain() {
    readTerrain(_terrScratch);
    for (let k = 0; k < N * N; k++) terrData[k * 4] = _terrScratch[k];
    terrUploadTex.needsUpdate = true;
    runPass(copyMat, terr[0]);
  }
  function clearWater() { clearRT(state[0]); clearRT(state[1]); clearRT(flux[0]); clearRT(flux[1]); }
  clearWater();

  /* ---- THE VISIBLE SURFACE — VTF from the state + terrain textures (MeshStandard look). ---- */
  const vCount = N * N;
  const positions = new Float32Array(vCount * 3), gridUv = new Float32Array(vCount * 2);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const c = j * N + i;
    positions[c * 3] = i * cell - half; positions[c * 3 + 1] = 0; positions[c * 3 + 2] = j * cell - half;
    gridUv[c * 2] = (i + 0.5) / N; gridUv[c * 2 + 1] = (j + 0.5) / N;
  }
  const indices = [];
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = j * N + i + 1, d = (j + 1) * N + i, e = (j + 1) * N + i + 1;
    indices.push(a, d, b, b, d, e);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('aGridUv', new THREE.BufferAttribute(gridUv, 2));
  // L110 (audit B12): a constant UP normal per vertex. Without a `normal` attribute the lit MeshStandardMaterial
  // reads zero-length normals → NaN shading (black/garbage surface). This matches the CPU water surface's flat
  // up-normals (the wave slope is a look approximation either way); every triplet is (0,1,0).
  const normals = new Float32Array(vCount * 3); for (let c = 0; c < vCount; c++) normals[c * 3 + 1] = 1;
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  geo.setIndex(indices);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), worldSize);

  const surfUniforms = { uStateTex: { value: state[0].texture }, uTerrTex: { value: terr[0].texture }, uMinDepth: { value: MIN_DEPTH } };
  const mat = new THREE.MeshStandardMaterial({ color: '#2f6f96', roughness: 0.14, metalness: 0.45, transparent: true, depthWrite: false });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uStateTex = surfUniforms.uStateTex; sh.uniforms.uTerrTex = surfUniforms.uTerrTex; sh.uniforms.uMinDepth = surfUniforms.uMinDepth;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uStateTex;\nuniform sampler2D uTerrTex;\nuniform float uMinDepth;\nattribute vec2 aGridUv;\nvarying float vDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  float _w = texture2D(uStateTex, aGridUv).r;\n  float _terr = texture2D(uTerrTex, aGridUv).r;\n  vDepth = _w;\n  transformed.y = _w > uMinDepth ? (_terr + _w) : -50.0;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vDepth;')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  if (vDepth < 0.012) discard;\n  gl_FragColor.a *= clamp((vDepth - 0.012) * 7.0, 0.16, 0.86);');
  };
  mat.customProgramCacheKey = () => 'lgr-flow-gpu';
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.raycast = () => {};
  mesh.renderOrder = 3; mesh.visible = false;

  function bindSurface() { surfUniforms.uStateTex.value = state[0].texture; surfUniforms.uTerrTex.value = terr[0].texture; }

  /* ---- ops ---- */
  function step(dt) {
    dt = Math.min(dt, 1 / 30);
    if (!erosionOn || _terrDirty) { uploadTerrain(); _terrDirty = false; }   // OFF=live CPU coupling; ON=seed once
    // FLOW — flux then depth.
    fluxMat.uniforms.uState.value = state[0].texture; fluxMat.uniforms.uTerr.value = terr[0].texture; fluxMat.uniforms.uFlux.value = flux[0].texture; fluxMat.uniforms.uDt.value = dt;
    runPass(fluxMat, flux[1]); flux.reverse();
    depthMat.uniforms.uState.value = state[0].texture; depthMat.uniforms.uTerr.value = terr[0].texture; depthMat.uniforms.uFlux.value = flux[0].texture; depthMat.uniforms.uDt.value = dt;
    runPass(depthMat, state[1]); state.reverse();
    // EROSION (opt-in) — erode/deposit (terrain ‖ sediment, same old state) then advect sediment.
    if (erosionOn) {
      erodeTMat.uniforms.uState.value = state[0].texture; erodeTMat.uniforms.uTerr.value = terr[0].texture; erodeTMat.uniforms.uFlux.value = flux[0].texture; erodeTMat.uniforms.uDt.value = dt; erodeTMat.uniforms.uErosK.value = erosionK;
      runPass(erodeTMat, terr[1]);
      erodeSMat.uniforms.uState.value = state[0].texture; erodeSMat.uniforms.uTerr.value = terr[0].texture; erodeSMat.uniforms.uFlux.value = flux[0].texture; erodeSMat.uniforms.uDt.value = dt; erodeSMat.uniforms.uErosK.value = erosionK;
      runPass(erodeSMat, state[1]);
      terr.reverse(); state.reverse();                   // commit eroded terrain + post-erode sediment
      advectMat.uniforms.uState.value = state[0].texture; advectMat.uniforms.uTerr.value = terr[0].texture; advectMat.uniforms.uFlux.value = flux[0].texture; advectMat.uniforms.uDt.value = dt;
      runPass(advectMat, state[1]); state.reverse();
    }
    bindSurface();
  }

  function _sourcePass() { sourceMat.uniforms.uState.value = state[0].texture; sourceMat.uniforms.uTerr.value = terr[0].texture; runPass(sourceMat, state[1]); state.reverse(); bindSurface(); }
  function pourAt(wxx, wzz, amount = 0.5, radius = 1.6) {
    if (_terrDirty || !erosionOn) { uploadTerrain(); _terrDirty = false; }
    const gi = (wxx + half) / cell, gj = (wzz + half) / cell, R = Math.max(1, radius / cell);
    sourceMat.uniforms.uRain.value = 0; sourceMat.uniforms.uPourCount.value = 1;
    sourceMat.uniforms.uPours.value[0].set(gi, gj, amount); sourceMat.uniforms.uPourR.value[0] = R;
    _sourcePass();
  }
  function rain(amount = 0.004) {
    if (_terrDirty || !erosionOn) { uploadTerrain(); _terrDirty = false; }
    sourceMat.uniforms.uPourCount.value = 0; sourceMat.uniforms.uRain.value = amount; _sourcePass();
  }
  function clear() { clearWater(); _terrDirty = true; bindSurface(); }   // empty water; re-seed terrain next step
  function setErosion(on, strength) { erosionOn = !!on; if (strength != null) erosionK = Math.max(0, strength); _terrDirty = true; }   // seed/re-sync terrain on the transition

  // ── read-back (test/throttle only — NEVER the hot loop) ──
  const _rb = new Float32Array(N * N * 4);
  function _read(target) { renderer.readRenderTargetPixels(target, 0, 0, N, N, _rb); return _rb; }
  function totalWater() { const b = _read(state[0]); let s = 0; for (let k = 0; k < N * N; k++) s += b[k * 4]; return s; }
  function cellAt(wxx, wzz) {
    const i = Math.round((wxx + half) / cell), j = Math.round((wzz + half) / cell);
    if (i < 0 || i >= N || j < 0 || j >= N) return 0;
    const b = _read(state[0]); return b[(j * N + i) * 4];
  }
  function totalSediment() { const b = _read(state[0]); let s = 0; for (let k = 0; k < N * N; k++) s += b[k * 4 + 1]; return s; }
  function readW() { const b = _read(state[0]); const w = new Float32Array(N * N); for (let k = 0; k < N * N; k++) w[k] = b[k * 4]; return w; }
  function readTerr() { const b = _read(terr[0]); const t = new Float32Array(N * N); for (let k = 0; k < N * N; k++) t[k] = b[k * 4]; return t; }

  function setVisible(on) { mesh.visible = !!on; }
  function dispose() {
    for (const t of state) t.dispose(); for (const t of flux) t.dispose(); for (const t of terr) t.dispose();
    terrUploadTex.dispose(); geo.dispose(); mat.dispose(); quad.geometry.dispose();
    fluxMat.dispose(); depthMat.dispose(); sourceMat.dispose(); copyMat.dispose(); erodeTMat.dispose(); erodeSMat.dispose(); advectMat.dispose();
  }

  return { mesh, step, pourAt, rain, clear, totalWater, cellAt, totalSediment, readW, readTerr, setErosion, setVisible, dispose, get grid() { return N; }, get erosion() { return erosionOn; } };
}
