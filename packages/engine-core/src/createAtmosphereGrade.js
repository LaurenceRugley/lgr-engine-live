/* ============================================================
   @lgr/engine-core — createAtmosphereGrade (SKY LIFT, manifest §1): ozone twilight + aerial-perspective haze.
   ------------------------------------------------------------
   Lifted from lgr-live-sky (authored there while fresh; see docs/sky-lift-manifest.md). A cheap O(1)-per-
   pixel POST-PASS that grafts two real effects the Preetham sky lacks onto the composited image:
     • AERIAL PERSPECTIVE — the horizon band tints toward the sky colour + desaturates.
     • OZONE TWILIGHT — a violet/magenta cast in the dawn/dusk sun-altitude window.

   USAGE: it returns a THREE ShaderPass a consumer adds to its OWN EffectComposer (engine-core's beauty
   pipeline is NOT a composer — this is for projects that build one, as Live Sky does). Drive update() each
   frame with the camera (to rebuild the world ray), the sun altitude, and the live sky colour.

   ⛔ BYTE-IDENTICAL NO-OP DEFAULT (the manifest's hard gate): hazeStrength=0 AND ozoneStrength=0 → the shader
   computes mix(scene,·,0)=scene and +·*0=0 → EXACT passthrough. A project that constructs + adds this with
   defaults gets ZERO pixel change until it sets a strength. City/hub/showcase never wire it → unchanged.

   ⚠️ DESKTOP-BEAUTY-ONLY when run in an HDR composer: the shader itself samples no half-float, but the STACK
   it's designed for (HalfFloat EffectComposer + UnrealBloom that linear-samples half-float) depends on
   OES_texture_half_float_linear (MISSING on the owner's iPhone — the black-screen gap). A consumer wanting it
   on mobile must composite in an 8-bit/LDR composer (no bloom headroom). See the manifest §half-float.

   API: createAtmosphereGrade({ hazeStrength, hazeColor, ozoneColor, ozoneStrength }) ->
        { pass, update(camera, sunAltY, skyColor), setStrength({haze,ozone}) }
   ============================================================ */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import vert from './shaders/sky-pass.vert';
import frag from './shaders/atmosphere-grade.frag';

export function createAtmosphereGrade({
  hazeStrength = 0, ozoneStrength = 0,
  hazeColor = [0.52, 0.62, 0.74], ozoneColor = [0.42, 0.11, 0.52],
} = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uInvProj: { value: new THREE.Matrix4() },
      uCamWorld: { value: new THREE.Matrix4() },
      uSunAlt: { value: 0 },
      uHazeColor: { value: new THREE.Color().fromArray(hazeColor) },
      uHazeStrength: { value: hazeStrength },
      uOzoneColor: { value: new THREE.Color().fromArray(ozoneColor) },
      uOzoneStrength: { value: ozoneStrength },
    },
    vertexShader: vert, fragmentShader: frag,
  });
  const u = pass.uniforms;
  return {
    pass,
    setStrength({ haze, ozone } = {}) { if (haze != null) u.uHazeStrength.value = haze; if (ozone != null) u.uOzoneStrength.value = ozone; },
    // camera → the world-ray rebuild; sunAltY (= sunArc.y) → the twilight window; skyColor → the haze tint.
    update(camera, sunAltY, skyColor) {
      u.uInvProj.value.copy(camera.projectionMatrixInverse);
      u.uCamWorld.value.copy(camera.matrixWorld);
      u.uSunAlt.value = sunAltY;
      if (skyColor) u.uHazeColor.value.copy(skyColor);
    },
  };
}
