/* ============================================================
   @lgr/engine-core — createGlintMaterial / applyGlint (Arc A14 GLINT): splice the constant-time
   glinty-NDF specular term into a stock MeshStandardMaterial.
   ------------------------------------------------------------
   THE ABILITY. The glint MATH lives once in shaders/glint-ndf.glsl (own implementation from the
   SIGGRAPH-Asia-2025 paper — see that file's header for provenance + the commercial-licence
   reasoning: the authors' Shadertoy is CC BY-NC-SA non-commercial and was NOT used). This module is
   the JS wiring that injects it into Three's stock lit material via `onBeforeCompile` — the same hook
   ground-macro.js uses — so a caller gets discrete-facet sparkle (frost/mica/wet-grit) on any
   surface the sun rakes across, with NO textures, NO render targets, NO half-float.

   DESKTOP-TIER by nature, and that's honest: the mobile DIRECT path is Lambert (it drops even normal
   maps — forge-recipes.js), so there is no specular lobe for an NDF to ride there. Like ground-macro,
   a caller gates this on forge.supported; the mobile flat class is left untouched. The MOBILE payoff
   of A14 is the WATER consumer (a bespoke ShaderMaterial that DOES ride the direct path), not this.

   COMPOSES with an existing patch. A material may hold only ONE onBeforeCompile, and the forge ground
   already carries applyGroundMacro. So applyGlint CHAINS: it captures whatever handler/cache-key is
   already set and calls it first, then layers the glint injection on top — apply glint AFTER macro.

   BYTE-IDENTICAL for non-consumers: a material nobody calls applyGlint on is Three's stock program,
   untouched. The city never calls it → identical baked shader → tier-guard / present-parity hold.

   Contract: applyGlint(material, opts) -> { material, setSun(dir, color) }   (drive setSun per frame)
     opts: { density, rough, micro, gain, sunDir:[x,y,z], color:0xhex }
   C++ anchor: onBeforeCompile is a source-level hook — Three concatenates named #include chunks into
   one program string and we string-replace chunk boundaries to inject GLSL before the link, like a
   preprocessor expanding at compile time. Chaining prev() first == calling the base-class override.
   ============================================================ */
import * as THREE from 'three';
// vite-plugin-glsl returns the (include-resolved) GLSL source as a string when a .glsl is imported
// into JS — so the SAME file that water.frag #includes is injected here. One source of truth.
import glintLib from './shaders/glint-ndf.glsl';

/* Attach the glinty-NDF specular term to a lit MeshStandardMaterial. Returns a small handle whose
   setSun(dir, color) the caller drives each frame (the glint needs the live world sun direction +
   colour, exactly like createWaterSurface.setSun). density <= 0 is a no-op-safe call. */
export function applyGlint(material, opts = {}) {
  if (!material || opts.density <= 0) return { material, setSun() {} };
  const density = opts.density != null ? opts.density : 3.0;
  const rough = opts.rough != null ? opts.rough : 0.5;
  const micro = opts.micro != null ? opts.micro : 0.14;
  const gain = opts.gain != null ? opts.gain : 1.0;
  const sd = opts.sunDir || [0.4, 0.8, 0.3];
  // Optional WATERLINE MASK — concentrate the glint in a band at a given distance-ring (the "wet sand at
  // the waterline" consumer): a whole-disc glint reads as snow on a mid-field cool-grade floor, but a band
  // right where the damp sand meets the water reads as a material property. Absent → mask is 1 everywhere.
  const wl = opts.waterline || null;   // { at:[x,z], radius, band }

  // one shared uniform set per material (created once — no per-frame allocation)
  const u = {
    uGlintDensity: { value: density },
    uGlintRough: { value: rough },
    uGlintMicro: { value: micro },
    uGlintGain: { value: gain },
    uGlintSunDir: { value: new THREE.Vector3(sd[0], sd[1], sd[2]) },
    uGlintColor: { value: new THREE.Color(opts.color != null ? opts.color : 0xffffff) },
    uGlintWaterAt: { value: new THREE.Vector2(wl ? wl.at[0] : 0, wl ? wl.at[1] : 0) },
    uGlintWaterR: { value: wl ? wl.radius : -1 },   // < 0 → mask disabled (whole surface)
    uGlintWaterBand: { value: wl && wl.band != null ? wl.band : 8 },
  };

  // CHAIN, don't clobber: keep any handler/cache-key already on the material (e.g. applyGroundMacro).
  const prevCompile = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (prevCompile) prevCompile(shader, renderer);   // run the base patch first (macro de-tiling, etc.)
    shader.uniforms.uGlintDensity = u.uGlintDensity;
    shader.uniforms.uGlintRough = u.uGlintRough;
    shader.uniforms.uGlintMicro = u.uGlintMicro;
    shader.uniforms.uGlintGain = u.uGlintGain;
    shader.uniforms.uGlintSunDir = u.uGlintSunDir;
    shader.uniforms.uGlintColor = u.uGlintColor;
    shader.uniforms.uGlintWaterAt = u.uGlintWaterAt;
    shader.uniforms.uGlintWaterR = u.uGlintWaterR;
    shader.uniforms.uGlintWaterBand = u.uGlintWaterBand;

    // VERTEX: hand the fragment the true WORLD position + WORLD normal — the glint grid lives on world
    // XZ (aperiodic, like the macro) and the angular math needs a world-space normal.
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n  varying vec3 vGlintWPos;\n  varying vec3 vGlintWN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGlintWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  vGlintWN = normalize(mat3(modelMatrix) * objectNormal);');

    // FRAGMENT: pull in the glint library + uniforms, then add the sparkle to the DIRECT SPECULAR
    // accumulator after the lights are gathered (so it tonemaps + composites like any other spec).
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\n  varying vec3 vGlintWPos;\n  varying vec3 vGlintWN;\n'
        + '  uniform float uGlintDensity;\n  uniform float uGlintRough;\n  uniform float uGlintMicro;\n'
        + '  uniform float uGlintGain;\n  uniform vec3 uGlintSunDir;\n  uniform vec3 uGlintColor;\n'
        + '  uniform vec2 uGlintWaterAt;\n  uniform float uGlintWaterR;\n  uniform float uGlintWaterBand;\n'
        + glintLib)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
      {
        float gMask = 1.0;
        if (uGlintWaterR > 0.0) {                         // waterline band: fade out away from the shore ring
          float dw = abs(length(vGlintWPos.xz - uGlintWaterAt) - uGlintWaterR);
          gMask = 1.0 - smoothstep(0.0, uGlintWaterBand, dw);
        }
        if (gMask > 0.001) {
          vec3 gN = normalize(vGlintWN);
          vec3 gV = normalize(cameraPosition - vGlintWPos);
          float gGlint = lgrGlint(vGlintWPos.xz, gN, gV, normalize(uGlintSunDir), uGlintDensity, uGlintRough, uGlintMicro);
          reflectedLight.directSpecular += uGlintColor * gGlint * uGlintGain * gMask;
        }
      }`);
  };
  // Namespace the patched program (folding in any prior key) so Three's cache never shares it.
  // prevKey MUST be called with `this` = material: Three's DEFAULT customProgramCacheKey returns
  // `this.onBeforeCompile.toString()`, so an unbound prevKey() throws on a BARE material (one with no
  // prior own key — e.g. glinting a plain material directly). Harmless today (glint is only applied
  // post-macro, whose key is an own arrow that ignores `this`, so this is byte-identical for the ground),
  // but a trap for a future consumer. Same fix as createIndirectField. (A15 follow-up.)
  material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|lgr-glint';
  material.needsUpdate = true;

  const _v = new THREE.Vector3();
  return {
    material,
    setSun(dir, color) {
      if (dir) { _v.copy(dir).normalize(); u.uGlintSunDir.value.copy(_v); }
      if (color) u.uGlintColor.value.copy(color);
    },
  };
}

/* Factory form: a fresh glinty MeshStandardMaterial (for a consumer that isn't decorating an existing
   forge material — e.g. the hero/product close-up lane the research note flagged as the ideal fit,
   or the fx/ client dividend). Returns the SAME handle shape as applyGlint. */
export function createGlintMaterial(opts = {}) {
  const { color = 0x9fb0bc, roughness = 0.35, metalness = 0.0, ...glintOpts } = opts;
  const material = new THREE.MeshStandardMaterial({ color, roughness, metalness });
  return applyGlint(material, glintOpts);
}
