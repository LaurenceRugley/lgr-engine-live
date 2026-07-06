/* ============================================================
   dust.js — Lesson 94: AMBIENT DUST / POLLEN (the second half of the "alive" pass).
   ------------------------------------------------------------
   Sway (L94 pt.1) makes the FOLIAGE breathe; this fills the AIR. A capped cloud of soft, additive motes
   drifting on the wind — pollen in a sunbeam, dust in golden light. A still scene reads as a model; a few
   hundred drifting specks read as a *place* with atmosphere.

   ONE `THREE.Points` draw call (N motes), drift done on the GPU in the VERTEX shader (zero CPU per frame —
   we upload the base positions + a per-mote phase ONCE; the shader animates from them, the same "compute in
   the vertex kernel, don't re-upload" thesis as the L94 sway). Each mote bobs on a few out-of-phase sines and
   drifts down-wind; positions WRAP inside the volume box (`mod`) so the cloud never escapes or thins out.
   Additive blending + a soft round alpha (smoothstep on the point-sprite radius) → they GLOW gently and never
   read as hard dots. depthWrite off so they don't punch holes in anything behind them.

   PERF — tier-capped + subtle (Rule: the governor stays in charge):
   - COUNT capped at creation by device: ~500 on mobile (pointer:coarse), ~2000 on desktop.
   - OPACITY is tiny (~0.09) and FADES OUT at night (pollen reads in daylight) → it can't lift the
     byte-identical maxLuma (the brightest pixel is the sky/sun, not a dim mote). World-only anyway.
   - the drawn count is throttled DOWN when the quality governor has degraded (level ≥ 2 → halve).
   C++ anchor: a particle system = N instances advanced by a field; here the "update()" is a pure function of
   time evaluated in the vertex shader, so the per-frame CPU cost is one uniform write.
   ============================================================ */
import * as THREE from 'three';
import { mulberry32 } from './citygen.js';
import dustVert from './shaders/dust.vert';   // L110 (audit B12): GLSL extracted to real files (invariant 4)
import dustFrag from './shaders/dust.frag';

export function createDust({ extent = 26, count = 2000, seed = 7, yLo = 0.4, yHi = 7.0 } = {}) {
  const rng = mulberry32((seed ^ 0xd057a11) >>> 0);
  const half = extent / 2;
  const pos = new Float32Array(count * 3);
  const aPh = new Float32Array(count);          // per-mote phase → the cloud doesn't pulse in unison
  const aSp = new Float32Array(count);          // per-mote speed + size jitter (variety)
  for (let i = 0; i < count; i++) {
    pos[i * 3]     = (rng() * 2 - 1) * half;
    pos[i * 3 + 1] = yLo + rng() * (yHi - yLo);
    pos[i * 3 + 2] = (rng() * 2 - 1) * half;
    aPh[i] = rng() * Math.PI * 2;
    aSp[i] = 0.6 + rng() * 0.8;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aPh', new THREE.BufferAttribute(aPh, 1));
  geo.setAttribute('aSp', new THREE.BufferAttribute(aSp, 1));
  geo.setDrawRange(0, count);

  const uniforms = {
    uTime:       { value: 0 },
    uWindOffset: { value: 0 },                    // L110 (audit B12): CPU-integrated down-wind displacement (was uWind, a speed multiplied by uTime in-shader)
    uHalf:       { value: half },
    uOpacity:    { value: 0.0 },                  // faded in by daytime in update() (0 → bit-exact invisible)
    uColor:      { value: new THREE.Color('#fff3d4') },
    uPx:         { value: 2.2 },                   // base point size (× size-attenuation)
  };
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
    vertexShader: dustVert, fragmentShader: dustFrag,
  });

  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;                  // the volume spans the world; never cull the whole cloud
  points.raycast = () => {};
  const group = new THREE.Group();
  group.add(points);
  group.userData.dispose = () => { geo.dispose(); mat.dispose(); };

  let _windPhase = 0;                            // L110 (audit B12): accumulated wind displacement — integrate velocity on the CPU so a mid-session wind CHANGE alters velocity, never teleports positions (uWind*uTime did the latter)
  // update(dt, elapsed, sunRig, { wind, qualityLevel }) — one uniform write; no buffer re-upload.
  function update(dt, elapsed, sunRig, { wind = 0, qualityLevel = 0 } = {}) {
    uniforms.uTime.value = elapsed;
    _windPhase += (0.25 + wind) * dt * 0.30;     // a base breeze + any weather wind, integrated (∫ v dt) — matches uWind*uTime*0.30 at constant wind, continuous across changes
    uniforms.uWindOffset.value = _windPhase;
    const day = sunRig ? (1 - sunRig.windowGlow) : 1;   // pollen reads in daylight; fade out at night
    uniforms.uOpacity.value = 0.09 * day;
    // governor throttle: thin the cloud when the engine is under load (level ≥ 2 → draw half).
    geo.setDrawRange(0, qualityLevel >= 2 ? (count >> 1) : count);
  }

  return { group, update, count };
}
