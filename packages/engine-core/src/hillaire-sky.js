/* ============================================================
   hillaire-sky.js — the Hillaire 2020 physically-based sky, LIFTED into engine-core (A-SKYDOME, 2026-08-05).
   ------------------------------------------------------------
   ORIGIN: first-party code from ~/dev/lgr-live-sky (src/hillaire.js + shaders/hillaire/*), where it is
   the DEFAULT sky and the reason Live Sky looks the way it does. Lifted here per the engine-first rule so
   every project inherits it; live-sky should eventually re-vendor FROM this copy (one canonical home).
   The lift direction is deliberate: the ability now lives in core, the app that born it becomes a consumer.

   WHAT IT IS: Rayleigh + Mie + OZONE scattering on a spherical planet, correct from the ground to space —
   twilight (the violet ozone window), the sunrise wavefront hugging the solar azimuth, aerial perspective
   and a horizon that melts instead of banding all come out of the physics instead of hand-tuned ramps.
   Three LUTs: Transmittance + Multiple-Scattering (computed once; recomputed only when haze changes) and
   a per-frame Sky-View LUT the fullscreen background mesh upsamples by world ray.

   MOBILE-SAFE BY DESIGN (Live Sky's own Stage 3): all LUTs are RGBA8/UnsignedByte with an encode scale
   (LUT_ENC in the shaders) — they filter linearly on EVERY device, including the iPhone that lacks
   OES_texture_half_float_linear (docs/engine-invariants.md's black-screen class). No new required extension.

   ENGINE ADAPTATIONS vs the live-sky original:
   • MULTI-CAMERA: the engine renders the sky through up to 4 cameras per frame (main, planar mirror,
     office-window RT, beauty capture). The camera matrices are therefore bound in onBeforeRender from
     WHATEVER camera is rendering — not once per frame from the main camera (live-sky has one camera).
   • sunDisc:false option — the city's sun is celestials' depth-occluded SPRITE (towers occlude it, godrays
     read it); the Preetham analytic disc was already turned off for the same one-sun reason (L98c). The
     Hillaire disc is available (sunDisc:true → live-sky's transmittance-reddened sun) for consumers
     without a sprite sun, but the city keeps ONE sun.
   C++ anchor: precomputed lookup tables + a fullscreen ray march that reads them — the classic
   "bake the integral, sample it per pixel" split.
   ============================================================ */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import transmittanceFrag from './shaders/hillaire/transmittance.frag';
import multiscatterFrag from './shaders/hillaire/multiscatter.frag';
import skyviewFrag from './shaders/hillaire/skyview.frag';
import skyrenderFrag from './shaders/hillaire/skyrender.frag';

export const GROUND_MM = 6.360, ATMOS_MM = 6.460;

export function createHillaireSky({ renderer, sunDisc = true } = {}) {
  // RGBA8 (UnsignedByte) LUTs — 8-bit filters LINEARLY on EVERY device (the iPhone lacks the half-float-
  // linear extension the float LUTs would need). Transmittance is already [0,1]; the sky-view / multiple-
  // scattering radiance is lifted into [0,1] by an ENCODE scale in the shaders (see LUT_ENC) to use the
  // 8 bits well and avoid banding, then decoded on read.
  const rt = (w, h) => new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, colorSpace: THREE.NoColorSpace,
  });
  const tLUT = rt(256, 64), msLUT = rt(32, 32), skyLUT = rt(200, 100);

  const fsVert = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
  const mieU = { value: 1 };   // SHARED haze uniform — the same object across all 3 LUT shaders (the Haze dial)
  const tQuad = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: transmittanceFrag, uniforms: { uMie: mieU } }));
  const msQuad = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: fsVert, fragmentShader: multiscatterFrag, uniforms: { uTransmittance: { value: tLUT.texture }, uMie: mieU } }));
  const skyMat = new THREE.ShaderMaterial({
    vertexShader: fsVert, fragmentShader: skyviewFrag,
    uniforms: { uTransmittance: { value: tLUT.texture }, uMultiScatter: { value: msLUT.texture }, uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uViewPos: { value: new THREE.Vector3(0, GROUND_MM, 0) }, uMie: mieU },
  });
  const skyQuad = new FullScreenQuad(skyMat);

  function computeStaticLUTs() {                     // Transmittance + Multiple-Scattering — atmosphere is fixed → once
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(tLUT); tQuad.render(renderer);
    renderer.setRenderTarget(msLUT); msQuad.render(renderer);
    renderer.setRenderTarget(prev);
  }
  function updateSkyView(sunDir, viewPos) {          // Sky-View — cheap, per frame
    skyMat.uniforms.uSunDir.value.copy(sunDir);
    skyMat.uniforms.uViewPos.value.copy(viewPos);
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(skyLUT); skyQuad.render(renderer);
    renderer.setRenderTarget(prev);
  }

  /* full-screen background mesh — drawn behind everything, samples the Sky-View LUT by world ray */
  const bgMat = new THREE.ShaderMaterial({
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 1.0, 1.0); }',
    fragmentShader: skyrenderFrag,
    uniforms: {
      uSkyView: { value: skyLUT.texture }, uTransmittance: { value: tLUT.texture },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uViewPos: { value: new THREE.Vector3(0, GROUND_MM, 0) },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uExposure: { value: 18.0 },
      uSunSize: { value: sunDisc ? 0.015 : 0.0 },   // 0 = no analytic disc (the city's ONE-SUN rule — celestials owns the visible sun)
      /* A-NIGHTFALL night floor — see skyrender.frag's block comment. All three default to the
         no-op (uNightK 0), so a consumer that never calls setNight() renders the pre-arc frame. */
      uNightZenith: { value: new THREE.Color(0, 0, 0) },
      uNightHorizon: { value: new THREE.Color(0, 0, 0) },
      uNightK: { value: 0 },
    },
    depthTest: false, depthWrite: false,
  });
  const skyMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat);
  skyMesh.frustumCulled = false; skyMesh.renderOrder = -100;
  skyMesh.raycast = () => {};
  /* ENGINE ADAPTATION — multi-camera correctness: bind the projection/world matrices from the camera
     actually rendering this draw (mirror cam, window cam, capture cam, main cam), not a per-frame
     snapshot of the main camera. Three passes the active camera here; without this the sky in the
     water mirror / office glass would be the MAIN camera's sky (subtly wrong ray directions). */
  skyMesh.onBeforeRender = (_r, _s, camera) => {
    bgMat.uniforms.uInvProj.value.copy(camera.projectionMatrixInverse);
    bgMat.uniforms.uCamWorld.value.copy(camera.matrixWorld);
  };

  function updateRender(sunDir, viewPos) {           // per-frame sun/eye state (matrices are per-draw, above)
    const u = bgMat.uniforms;
    u.uSunDir.value.copy(sunDir); u.uViewPos.value.copy(viewPos);
  }

  return {
    skyMesh, computeStaticLUTs, updateSkyView, updateRender, tLUT, msLUT, skyLUT,
    setExposure: (v) => { bgMat.uniforms.uExposure.value = v; },
    get exposure() { return bgMat.uniforms.uExposure.value; },
    // Sun-size dial 0..1 → angular radius. Real sun ≈ 0.0047 rad; allow a stylised small→big sweep.
    setSunSize: (v) => { bgMat.uniforms.uSunSize.value = 0.006 + 0.05 * v; },
    // Haze dial → Mie multiplier. The transmittance + multiple-scattering LUTs depend on Mie, so recompute
    // them here (cheap); the per-frame sky-view LUT picks up the new value automatically.
    setHaze: (mie) => { mieU.value = mie; computeStaticLUTs(); },
    get haze() { return mieU.value; },
    /* A-NIGHTFALL — the night floor, driven by the consumer's own night palette.
         setNight(k, zenith, horizon)
       `k` is how NIGHT it is (0 = the sun is up and this whole term is off, 1 = full night); the
       two colours are the SunRig's night `sky` and `horizon` keyframes in the shipped wiring, so
       the sky the atmosphere stops being able to compute hands over to the palette the rest of the
       day/night cycle is already authored in — one source of truth for what night looks like.
       Colours are COPIED, not held by reference: they are keyframe LERP TARGETS on the rig side and
       a consumer that handed over its live `sunRig.sky` object would find this uniform drifting
       with the time of day rather than staying the night colour it asked for. */
    setNight: (k, zenith, horizon) => {
      const u = bgMat.uniforms;
      u.uNightK.value = k;
      if (zenith) u.uNightZenith.value.set(zenith);
      if (horizon) u.uNightHorizon.value.set(horizon);
    },
    get night() { return bgMat.uniforms.uNightK.value; },
    dispose() { tLUT.dispose(); msLUT.dispose(); skyLUT.dispose(); tQuad.dispose(); msQuad.dispose(); skyQuad.dispose(); bgMat.dispose(); skyMesh.geometry.dispose(); },
  };
}
