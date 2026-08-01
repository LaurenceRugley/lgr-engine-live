/* ============================================================
   @lgr/engine-core — createVolumetricClouds (SKY LIFT, manifest §2): raymarched Perlin-Worley cumulus.
   ------------------------------------------------------------
   Lifted from lgr-live-sky. The MSFS/Nubis technique (Schneider/Guerrilla): a ShaderPass that raymarches a
   cloud SLAB, sampling a precomputed tiling 3D Perlin-Worley volume (noise3d.js) for density, lit by a
   short sun light-march (self-shadow + Beer + powder + a multiple-scattering approx that keeps sunlit
   cumulus white) with a dual-lobe Henyey-Greenstein phase. A THREE ShaderPass for a consumer's composer.

   ⛔ BYTE-IDENTICAL NO-OP DEFAULT: coverage=0 → the shader early-outs (uCoverage < 0.01) and returns the
   sky unchanged. A consumer sets coverage (or drives it from weather) to opt in.

   ⚠️ WEBGL2-REQUIRED (sampler3D), but HALF-FLOAT-FREE: the 3D noise volume is RGBA8 UnsignedByte +
   LinearFilter (8-bit linear filtering is universal — NOT the OES_texture_half_float_linear the iPhone
   lacks). So the CLOUD shader itself is iPhone-safe on a WebGL2 context; the desktop-beauty caveat is only
   the HDR composer + bloom the manifest flags (same as the other lifted passes).

   API: createVolumetricClouds({ noiseN, seed, coverage, tiers }) ->
        { pass, setCoverage(c), update({ camera, sunDir, sunColor, skyTint, time, tierName }), dispose() }
   ============================================================ */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import vert from './shaders/sky-pass.vert';
import frag from './shaders/clouds.frag';
import { buildCloudNoise } from './noise3d.js';

// [primaryMarchSteps, lightMarchSteps] per governor tier (the shader clamps to MAX_STEPS/MAX_LIGHT).
export const CLOUD_TIERS = { HIGH: [32, 5], MED: [22, 4], LOW: [14, 3] };

export function createVolumetricClouds({ noiseN = 32, seed = 1337, coverage = 0, tiers = CLOUD_TIERS } = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null }, uResolution: { value: new THREE.Vector2(1, 1) },
      uNoise: { value: null }, uNoiseReady: { value: 0 },
      uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(0xffffff) }, uSkyTint: { value: new THREE.Color(0x8a94b0) },
      uTime: { value: 0 }, uCoverage: { value: coverage }, uSteps: { value: 32 }, uLightSteps: { value: 5 },
    },
    vertexShader: vert, fragmentShader: frag,
  });
  pass.material.glslVersion = THREE.GLSL3;   // sampler3D + `out fragColor` need GLSL ES 3.00 / WebGL2
  const u = pass.uniforms;

  // Build the tiling Perlin-Worley volume. SYNCHRONOUS: at the default N=32 the volume is ~131 KB and gens
  // in a few ms; a consumer wanting a bigger volume without a boot hitch should time-slice generateVolume
  // (the manifest notes the Vite module-worker path was removed for bundle size). Half-float-free (RGBA8).
  const tex = buildCloudNoise(THREE, { N: noiseN, seed });
  u.uNoise.value = tex; u.uNoiseReady.value = 1;

  return {
    pass,
    setCoverage(c) { u.uCoverage.value = c; },
    update({ camera, sunDir, sunColor, skyTint, time, tierName } = {}) {
      if (camera) { u.uInvProj.value.copy(camera.projectionMatrixInverse); u.uCamWorld.value.copy(camera.matrixWorld); u.uCamPos.value.copy(camera.position); }
      if (sunDir) u.uSunDir.value.copy(sunDir);
      if (sunColor) u.uSunColor.value.copy(sunColor);
      if (skyTint) u.uSkyTint.value.copy(skyTint);
      if (time != null) u.uTime.value = time;
      const ts = tiers[tierName] || tiers.HIGH; u.uSteps.value = ts[0]; u.uLightSteps.value = ts[1];
    },
    dispose() { if (tex) tex.dispose(); },
  };
}
