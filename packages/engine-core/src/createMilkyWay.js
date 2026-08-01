/* ============================================================
   @lgr/engine-core — createMilkyWay (SKY LIFT §4; UPGRADED in LIFT #2): galactic band + fine star dust.
   ------------------------------------------------------------
   Lifted from lgr-live-sky. A night-gated POST-PASS: a soft galactic band along a tilted great circle
   (view-ray distance to the galactic plane), broken by FBM dust lanes (the Great Rift), plus a warm
   Sagittarius-bulge CORE and a dense fine-star field concentrated toward the band with a gentle twinkle.
   A THREE ShaderPass for a consumer's composer.

   LIFT #2 upgrade (manifest §4 + §8): the warm golden CORE (GAL_C bulge), a tight-spine + wide-halo band
   structure, patchy star CLOUDS + dark dust LANES, and — coupling with createCelestial — a uStarRot mat4
   so the whole galaxy + star field WHEELS about the celestial pole with Earth's sidereal spin. Identity
   uStarRot (the default) = no rotation = the pre-lift behaviour.

   ⛔ BYTE-IDENTICAL NO-OP DEFAULT: intensity=0 → the additive term is *0 = passthrough. The shader also
   early-outs when uNightK < 0.02 (day) or below the horizon. DESKTOP-BEAUTY-ONLY in an HDR composer.

   API: createMilkyWay({ intensity, armColor, coreColor, bandWidth }) ->
        { pass, update(camera, nightK, time, starRot?), setIntensity(v), setStarRot(mat4) }
   ============================================================ */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import vert from './shaders/sky-pass.vert';
import frag from './shaders/milkyway.frag';

export function createMilkyWay({
  intensity = 0,
  armColor = [0.40, 0.49, 0.72],    // cool blue-white outer arms
  coreColor = [0.98, 0.82, 0.58],   // warm gold galactic bulge
  bandWidth = 0.44,                 // half-width of the faint halo (spine is half of this)
} = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uNightK: { value: 0 },
      uIntensity: { value: intensity },
      uTime: { value: 0 },
      uStarRot: { value: new THREE.Matrix4() },   // identity → no sidereal spin (the no-op default)
      uArmColor: { value: new THREE.Color(armColor[0], armColor[1], armColor[2]) },
      uCoreColor: { value: new THREE.Color(coreColor[0], coreColor[1], coreColor[2]) },
      uBandWidth: { value: bandWidth },
    },
    vertexShader: vert, fragmentShader: frag,
  });
  const u = pass.uniforms;
  return {
    pass,
    setIntensity(v) { u.uIntensity.value = v; },
    setStarRot(mat4) { if (mat4) u.uStarRot.value.copy(mat4); },
    update(camera, nightK, time, starRot) {
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      if (nightK != null) u.uNightK.value = nightK;
      if (time != null) u.uTime.value = time;
      if (starRot) u.uStarRot.value.copy(starRot);   // createCelestial.starRotMatrix(t) — optional
    },
  };
}
