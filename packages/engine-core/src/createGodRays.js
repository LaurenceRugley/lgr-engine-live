/* ============================================================
   @lgr/engine-core — createGodRays (SKY LIFT, manifest §3): screen-space crepuscular shafts.
   ------------------------------------------------------------
   Lifted from lgr-live-sky. Kenny-Mitchell (GPU Gems 3) volumetric light scattering: each pixel marches
   toward the sun's SCREEN position sampling the composited image — bright samples (sun + cloud gaps)
   scatter, dark bodies occlude → light streams through the gaps. A THREE ShaderPass for a consumer's
   composer. The CONSUMER projects the sun to screen + computes the visibility fade (below-horizon /
   off-frame / low-sun) so shafts never pop (a helper for that fade is provided).

   ⛔ BYTE-IDENTICAL NO-OP DEFAULT: intensity=0 → scene + rays*0 = scene (the shader also early-outs on
   uVisible < 0.001). DESKTOP-BEAUTY-ONLY in an HDR composer (see the manifest §half-float / atmosphere-grade).

   API: createGodRays({ intensity, samples }) ->
        { pass, update({ sunScreen, visible, color, samples }), setIntensity(v) }
   ============================================================ */
import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import vert from './shaders/sky-pass.vert';
import frag from './shaders/godrays.frag';

// A convenience fade: given the sun's NDC (project sunDir*far+camPos through the camera) + its world
// altitude (sunArc.y), return 0..1 — 0 below the horizon / off-frame / (dimmed) at high sun. Pure.
export function godRayVisibility(ndc, sunAltY) {
  const above = THREE.MathUtils.smoothstep(sunAltY, -0.02, 0.14);
  const inFront = ndc.z < 1 ? 1 : 0;
  const sx = ndc.x * 0.5 + 0.5, sy = ndc.y * 0.5 + 0.5;
  const outside = Math.max(0, -sx, sx - 1, -sy, sy - 1);
  const edge = Math.max(0, 1 - outside / 0.55);
  const lowSun = THREE.MathUtils.lerp(1.0, 0.5, THREE.MathUtils.smoothstep(sunAltY, 0.12, 0.6));
  return { visible: above * inFront * edge * lowSun, sunScreen: [sx, sy] };
}

export function createGodRays({ intensity = 0, samples = 40 } = {}) {
  const pass = new ShaderPass({
    uniforms: {
      tDiffuse: { value: null },
      uSun: { value: new THREE.Vector2(0.5, 0.6) },
      uVisible: { value: 0 },
      uColor: { value: new THREE.Color(0xffffff) },
      uIntensity: { value: intensity },
      uSamples: { value: samples },
    },
    vertexShader: vert, fragmentShader: frag,
  });
  const u = pass.uniforms;
  return {
    pass,
    setIntensity(v) { u.uIntensity.value = v; },
    update({ sunScreen, visible, color, samples: s } = {}) {
      if (sunScreen) u.uSun.value.set(sunScreen[0], sunScreen[1]);
      if (visible != null) u.uVisible.value = visible;
      if (color) u.uColor.value.copy(color);
      if (s != null) u.uSamples.value = s;
    },
  };
}
