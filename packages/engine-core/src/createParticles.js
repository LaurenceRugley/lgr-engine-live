/* ============================================================
   @lgr/engine-core — createParticles (Lesson M6: GPU particle system).
   ------------------------------------------------------------
   THE ABILITY: thousands of particles simulated entirely on the GPU (position + velocity live in float
   textures; a fragment-shader kernel integrates them every frame), with parameterized emitters — muzzle
   flash, blood burst, dust. This GENERALIZES the proven in-repo GPGPU pattern (water-flow-gpu.js: state
   textures ping-ponged via .reverse(), fullscreen-quad kernels, GLSL in real files) — Rule 6, same style,
   not a new one.

   ── STATE (one texel = one particle, texSize×texSize of them) ────────────────
     posRT  ping-pong : (x, y, z, life)      life>0 = alive; life<=0 = a free slot
     velRT  ping-pong : (vx, vy, vz, seed)
     colRT  single     : (r, g, b, size)      written only at spawn; read at render
   A TICK: velPass (v += gravity·dt, drag) → posPass (p += v·dt, life -= dt) → drain the spawn queue.
   No per-frame CPU readback (the whole point of GPGPU) — countAlive() reads back for TESTS only.

   ── SPAWN = a SCISSOR-restricted write into a RING region of the state textures. A CPU cursor walks the
   texture as a ring buffer; each emit writes `count` fresh particles into the next `count` texels (split
   at row ends into scissor rectangles). Because a scissor rect restricts which texels the pass touches,
   the kernel never reads the target and every touched texel becomes a brand-new particle — no CPU→GPU
   sub-texture upload, no read-modify-write. The ring means old particles are recycled oldest-first.
   (Deviation from the brief's suggested DataTexture sub-upload, surfaced Rule 6: a scissor-ring GPU write
   keeps the sim fully on-GPU like water's no-CPU-in-hot-loop ethos and dodges float sub-rect upload
   fragility — same outcome, cleaner path. planSpawn() below is the pure, node-tested ring/budget math.)

   ── BUDGET (self-contained; r1's q.particleBudget pointer was dead). The hard cap is max = texSize²
   particles alive at once (the pool size). Per-emit count is clamped to a per-preset cap. Defaults:
   texSize 64 → 4096 · texSize 128 → 16384. Pre-warm compiles every program at init so the FIRST burst
   has no shader-compile hitch. Blend is per-SYSTEM (additive by default — glowing sparks on the dark dusk
   arena, no depth sort); a second createParticles gives an alpha look (documented simplification vs a
   per-preset blend). Colour is a per-particle base × a life fade (the "colour ramp" simplified to that).

   ── FALLBACK posture (brief): HalfFloat render targets FIRST (plenty for short-lived particle pos/vel,
   and cheaper than full float). HalfFloat is color-renderable only with EXT_color_buffer_float (WebGL2);
   if that extension is absent we return null — a graceful no-particles like water does, never a silent
   break. The caller checks for null and simply runs without particles.

   C++ anchors: each RT = a 2-D float array on the GPU; ping-pong = double-buffering; the scissor spawn =
   writing a strided slice of that array; VTF at render = indexing the array from the vertex program.

   Contract: createParticles(renderer, opts) -> null | {
     points,                        // THREE.Points — add to your scene
     update(dt),                    // sim + drain spawns; call once per frame
     emitter(presetNameOrObj),      // -> { emit(x,y,z, dx,dy,dz) }
     setGravity(x,y,z), setSizeScale(px),
     countAlive(),                  // TEST-ONLY readback
     get liveEstimate(), dispose(),
   }
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert   from './shaders/fullscreen.vert';
import particleSimFrag  from './shaders/particle-sim.frag';
import particleSpawnFrag from './shaders/particle-spawn.frag';
import particleVert     from './shaders/particle.vert';
import particleFrag     from './shaders/particle.frag';
import { planSpawn } from './particle-ring.js';

export { planSpawn } from './particle-ring.js';   // pure ring/budget math (node-tested in createParticles.test.mjs)

const PRESETS = {
  // count is a per-emit particle budget; cone 0=tight beam … 1=full sphere; colour is a linear-ish RGB.
  burst:  { count: 40, life: 0.7,  speed: 4.5, speedVar: 0.5, cone: 1.0,  size: 7,  color: [0.85, 0.12, 0.07], posJitter: 0.15 },   // blood/impact spray
  muzzle: { count: 16, life: 0.12, speed: 9.0, speedVar: 0.4, cone: 0.22, size: 9,  color: [1.0, 0.86, 0.5],  posJitter: 0.05 },   // gun flash
  dust:   { count: 10, life: 1.3,  speed: 1.2, speedVar: 0.6, cone: 0.85, size: 12, color: [0.5, 0.47, 0.4],  posJitter: 0.2 },    // slow motes
};

export function createParticles(renderer, opts = {}) {
  const gl = renderer.getContext();
  const floatOk = !!(gl && gl.getExtension && gl.getExtension('EXT_color_buffer_float'));
  if (!floatOk) {
    if (typeof console !== 'undefined') console.warn('[M6] EXT_color_buffer_float unavailable — GPU particles disabled (running without).');
    return null;
  }

  const texSize = opts.texSize || 64;
  const MAX = texSize * texSize;
  const perEmitCap = opts.perEmitCap || texSize;            // a single emit can't exceed one row's worth
  let gravity = new THREE.Vector3(opts.gravity ? opts.gravity.x : 0, opts.gravity ? opts.gravity.y : -6, opts.gravity ? opts.gravity.z : 0);
  const drag = opts.drag != null ? opts.drag : 0.6;
  let sizeScale = opts.sizeScale != null ? opts.sizeScale : 300;

  const rtOpts = {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, stencilBuffer: false,
  };
  let pos = [new THREE.WebGLRenderTarget(texSize, texSize, rtOpts), new THREE.WebGLRenderTarget(texSize, texSize, rtOpts)];
  let vel = [new THREE.WebGLRenderTarget(texSize, texSize, rtOpts), new THREE.WebGLRenderTarget(texSize, texSize, rtOpts)];
  const col = new THREE.WebGLRenderTarget(texSize, texSize, rtOpts);

  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false; quadScene.add(quad);

  const simMat = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: particleSimFrag,
    uniforms: { uPos: { value: null }, uVel: { value: null }, uDt: { value: 0 }, uGravity: { value: gravity }, uDrag: { value: drag }, uChannel: { value: 0 } },
  });
  const spawnMat = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: particleSpawnFrag,
    uniforms: {
      uChannel: { value: 0 }, uEmitPos: { value: new THREE.Vector3() }, uEmitDir: { value: new THREE.Vector3(0, 1, 0) },
      uSpeed: { value: 1 }, uSpeedVar: { value: 0.3 }, uCone: { value: 1 }, uLife: { value: 1 }, uSize: { value: 8 },
      uColor: { value: new THREE.Color() }, uSeed: { value: 0 }, uPosJitter: { value: 0.1 },
    },
  });

  // A GPGPU pass. autoClear is forced OFF so a pass only writes what its (fullscreen or scissored) quad
  // covers — critical for the scissor spawn, which must leave the rest of the ring untouched. Optional
  // scissor rect restricts the write to a sub-region (set AFTER setRenderTarget, which is when three binds
  // the FBO + viewport). C++ anchor: glScissor clamps the raster to a box; without autoClear the untouched
  // texels keep their previous value (a partial write into the state array).
  function runPass(material, target, scissor) {
    quad.material = material;
    const prev = renderer.getRenderTarget(), prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(target);
    if (scissor) { renderer.setScissorTest(true); renderer.setScissor(scissor.x, scissor.y, scissor.w, scissor.h); }
    else renderer.setScissorTest(false);
    renderer.render(quadScene, quadCam);
    renderer.setScissorTest(false);
    renderer.autoClear = prevAuto; renderer.setRenderTarget(prev);
  }
  const _cc = new THREE.Color();
  function clearRT(target) {
    const prevRT = renderer.getRenderTarget(), prevA = renderer.getClearAlpha();
    renderer.getClearColor(_cc);
    renderer.setScissorTest(false);
    renderer.setRenderTarget(target); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
    renderer.setClearColor(_cc, prevA); renderer.setRenderTarget(prevRT);
  }
  clearRT(pos[0]); clearRT(pos[1]); clearRT(vel[0]); clearRT(vel[1]); clearRT(col);   // all dead (life 0) to start

  /* ---- RENDER: texSize² points, VTF from pos+col. Dummy position attr (VTF sets the real position). ---- */
  const count = MAX;
  const dummyPos = new Float32Array(count * 3);
  const aUv = new Float32Array(count * 2);
  for (let i = 0; i < count; i++) { aUv[i * 2] = ((i % texSize) + 0.5) / texSize; aUv[i * 2 + 1] = (Math.floor(i / texSize) + 0.5) / texSize; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(dummyPos, 3));
  geo.setAttribute('aUv', new THREE.BufferAttribute(aUv, 2));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e6);
  const renderMat = new THREE.ShaderMaterial({
    vertexShader: particleVert, fragmentShader: particleFrag,
    uniforms: { uPos: { value: pos[0].texture }, uCol: { value: col.texture }, uSizeScale: { value: sizeScale } },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geo, renderMat);
  points.frustumCulled = false; points.raycast = () => {}; points.renderOrder = 20;

  /* ---- SIM step ---- */
  function sim(dt) {
    simMat.uniforms.uDt.value = dt; simMat.uniforms.uGravity.value = gravity; simMat.uniforms.uDrag.value = drag;
    // velocity pass
    simMat.uniforms.uChannel.value = 0; simMat.uniforms.uPos.value = pos[0].texture; simMat.uniforms.uVel.value = vel[0].texture;
    runPass(simMat, vel[1]); vel.reverse();
    // position pass (reads the just-integrated velocity)
    simMat.uniforms.uChannel.value = 1; simMat.uniforms.uPos.value = pos[0].texture; simMat.uniforms.uVel.value = vel[0].texture;
    runPass(simMat, pos[1]); pos.reverse();
  }

  /* ---- SPAWN (scissor-ring write into the CURRENT pos/vel/col) ---- */
  let cursor = 0, _seed = 1, liveTrack = [];   // liveTrack: {n, die} spawn bookkeeping for liveEstimate
  function spawnBatch(p, wx, wy, wz, dx, dy, dz, nowT) {
    const plan = planSpawn(cursor, p.count, texSize, perEmitCap);
    cursor = plan.nextCursor;
    if (plan.spawned === 0) return;
    // set the emit uniforms once for this batch
    const u = spawnMat.uniforms;
    u.uEmitPos.value.set(wx, wy, wz); u.uEmitDir.value.set(dx, dy, dz);
    u.uSpeed.value = p.speed; u.uSpeedVar.value = p.speedVar; u.uCone.value = p.cone; u.uLife.value = p.life;
    u.uSize.value = p.size; u.uColor.value.setRGB(p.color[0], p.color[1], p.color[2]); u.uPosJitter.value = p.posJitter;
    _seed = (_seed * 1664525 + 1013904223) % 4294967296; u.uSeed.value = (_seed % 10000) / 9.61;
    for (const seg of plan.segments) {
      const box = { x: seg.x, y: seg.y, w: seg.w, h: 1 };
      u.uChannel.value = 0; runPass(spawnMat, pos[0], box);   // scissor-restricted: only these texels become new particles
      u.uChannel.value = 1; runPass(spawnMat, vel[0], box);
      u.uChannel.value = 2; runPass(spawnMat, col, box);
    }
    liveTrack.push({ n: plan.spawned, die: nowT + p.life });
  }

  /* ---- emit queue ---- */
  const queue = [];
  let clock = 0;
  function emitter(preset) {
    const p = typeof preset === 'string' ? PRESETS[preset] : preset;
    if (!p) throw new Error('[M6] unknown particle preset');
    const merged = { ...(PRESETS[preset] || {}), ...p };
    return { emit(x, y, z, dx = 0, dy = 1, dz = 0) { queue.push({ p: merged, x, y, z, dx, dy, dz }); } };
  }

  function update(dt) {
    clock += dt;
    sim(dt);
    for (let i = 0; i < queue.length; i++) { const q = queue[i]; spawnBatch(q.p, q.x, q.y, q.z, q.dx, q.dy, q.dz, clock); }
    queue.length = 0;
    // prune expired spawn bookkeeping (liveEstimate)
    if (liveTrack.length > 512) liveTrack = liveTrack.filter((s) => s.die > clock);
    renderMat.uniforms.uPos.value = pos[0].texture;
    renderMat.uniforms.uCol.value = col.texture;
    renderMat.uniforms.uSizeScale.value = sizeScale;
  }

  // pre-warm: compile every program now so the first real burst never hitches on a mid-play compile.
  (function prewarm() {
    sim(1 / 60);                                              // compiles particle-sim
    const e = emitter('muzzle'); e.emit(0, -9999, 0);         // a throwaway spawn far offscreen
    update(1 / 60);                                           // compiles particle-spawn + advances once
    const scratch = new THREE.WebGLRenderTarget(4, 4);
    const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 100); cam.position.set(0, 0, 5);
    const s = new THREE.Scene(); s.add(points);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(scratch); renderer.render(s, cam); renderer.setRenderTarget(prev);   // compiles particle.vert/frag
    s.remove(points); scratch.dispose();
    clearRT(pos[0]); clearRT(pos[1]); clearRT(col); cursor = 0; liveTrack = []; clock = 0;         // reset to empty
  })();

  // ── TEST-ONLY readback (never the hot loop): count particles with life > 0. The RTs are HALF_FLOAT, so
  // readPixels fills a Uint16Array with raw half-float bits; a particle is alive iff its life channel (.w)
  // is a POSITIVE, non-zero half-float (sign bit clear AND value bits non-zero). ──
  const _rb = new Uint16Array(texSize * texSize * 4);
  function countAlive() {
    renderer.readRenderTargetPixels(pos[0], 0, 0, texSize, texSize, _rb);
    let n = 0; for (let k = 0; k < texSize * texSize; k++) { const w = _rb[k * 4 + 3]; if ((w & 0x8000) === 0 && (w & 0x7fff) !== 0) n++; }
    return n;
  }

  return {
    points, update, emitter,
    setGravity(x, y, z) { gravity.set(x, y, z); },
    setSizeScale(px) { sizeScale = px; },
    countAlive,
    get liveEstimate() { let n = 0; for (const s of liveTrack) if (s.die > clock) n += s.n; return Math.min(n, MAX); },
    get max() { return MAX; },
    dispose() {
      for (const t of pos) t.dispose(); for (const t of vel) t.dispose(); col.dispose();
      geo.dispose(); renderMat.dispose(); simMat.dispose(); spawnMat.dispose(); quad.geometry.dispose();
    },
  };
}
