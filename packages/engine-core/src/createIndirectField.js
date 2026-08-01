/* ============================================================
   @lgr/engine-core — createIndirectField (Arc A15 BAKED RADIANCE PROBES): the RUNTIME half.
   ------------------------------------------------------------
   THE ABILITY. Load a BAKED irradiance volume (produced offline by tools/bake-probes.mjs) and add
   its bounced light to any lit MeshStandard/MeshLambert material. The engine had NO indirect term
   at all before this — direct sun + hemisphere fill + PCF + A11 contact patches, nothing bounced.
   This adds the missing one-bounce, as a sparse grid of precomputed answers we sample per-fragment.

   The bake MATH lives once in shaders/indirect-field.glsl (the world->grid lookup + LDR decode);
   this module is the JS wiring that (1) uploads the atlas as an RGBA8 Data3DTexture and (2) splices
   the lookup into Three's stock lit shader via `onBeforeCompile` — the SAME hook ground-macro.js and
   createGlintMaterial.js use. We add the sampled irradiance to Three's own `irradiance` accumulator
   right after <lights_fragment_maps>, so Three's existing Lambert BRDF multiplies it by the surface
   albedo for free (indirect diffuse = irradiance x albedo/pi) and it tonemaps like any other light.

   MOBILE-SAFE BY CONSTRUCTION (the whole point of the arc). The atlas is RGBA8; 3D-texture LINEAR
   filtering of an 8-bit volume is core WebGL2 — no OES_texture_(half_)float_linear, the extension the
   owner's iPhone lacks (noise3d.js / createVolumetricClouds.js already ship exactly this on the
   direct path). Adding to `irradiance` (a diffuse term, not a specular lobe) means it rides the
   mobile DIRECT Lambert path too, unlike glint which needs a specular lobe and is desktop-only.

   BYTE-IDENTICAL for non-consumers. A material nobody calls apply() on is Three's stock program,
   untouched; the city/hub/showcase never build a field -> identical baked shaders -> tier-guard /
   present-parity hold. hoard2 only builds + applies a field behind the opt-in ?gi=1 (default OFF).

   Contract: createIndirectField({ data, strength, tint }) -> { texture, apply(material), setStrength(s), dispose() }
     data: the baked atlas JSON — { res:[x,y,z], min:[x,y,z], max:[x,y,z], scale, bytes:[...] | Uint8Array }
     strength: master multiplier on the bounce (default 1)
     tint: [r,g,b] linear palette nudge (default white = carry the bake's own colour untouched)
   A call with no/empty data returns an inert handle (apply is a no-op) so a caller can wire it
   unconditionally and let the data decide.

   C++ anchor: onBeforeCompile is a source-level hook — Three concatenates named #include chunks into
   one program string and we string-replace chunk boundaries to inject GLSL before the link, like a
   preprocessor macro expanding at compile time. Chaining prev() first == calling the base override,
   so this composes with a material that already carries applyGroundMacro / applyGlint.
   ============================================================ */
import * as THREE from 'three';
// vite-plugin-glsl returns the GLSL source as a string when a .glsl is imported into JS — so the
// lookup library is injected here as text (same pattern createGlintMaterial uses for glint-ndf.glsl).
import indirectLib from './shaders/indirect-field.glsl';

/* Build an RGBA8 Data3DTexture from the baked byte atlas. Data layout is x-fastest then y then z
   (Three's Data3DTexture convention), which the baker writes to match. */
function buildVolumeTexture(data) {
  const [rx, ry, rz] = data.res;
  const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes);
  const tex = new THREE.Data3DTexture(bytes, rx, ry, rz);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;   // hardware trilinear — smooth the sparse grid between probes
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = THREE.ClampToEdgeWrapping; // no wrap: a receiver past the grid reads the nearest probe
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.wrapR = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function createIndirectField(opts = {}) {
  const data = opts.data;
  // Inert handle: no data -> apply() is a pass-through, so a consumer can wire unconditionally.
  if (!data || !data.bytes || !data.res) {
    return { texture: null, apply: (m) => m, setStrength() {}, setTint() {}, dispose() {} };
  }

  const tex = buildVolumeTexture(data);
  const min = data.min, max = data.max;
  const tint = opts.tint || [1, 1, 1];

  // One shared uniform set (created once — no per-frame allocation; presentation-only, no sim surface).
  const u = {
    uIndField: { value: tex },
    uIndMin: { value: new THREE.Vector3(min[0], min[1], min[2]) },
    uIndInvSize: { value: new THREE.Vector3(1 / (max[0] - min[0]), 1 / (max[1] - min[1]), 1 / (max[2] - min[2])) },
    uIndRes: { value: new THREE.Vector3(data.res[0], data.res[1], data.res[2]) },
    uIndScale: { value: data.scale != null ? data.scale : 1.0 },
    uIndStrength: { value: opts.strength != null ? opts.strength : 1.0 },
    uIndTint: { value: new THREE.Color(tint[0], tint[1], tint[2]) },
  };

  function apply(material) {
    if (!material) return material;
    // TAG the source material with this field handle. The mobile DIRECT path (hoard2 main.js) swaps lit
    // materials to fresh MeshLambertMaterial twins at render time — losing this onBeforeCompile — so the
    // twin-maker re-applies the field via this tag (that is how GI rides the mobile direct path). Also
    // marks the material idempotent-safe: a second apply() on the same instance is a no-op (double-
    // injecting the same chunk would duplicate symbols → a compile error).
    if (material.userData && material.userData.__lgrIndirectApplied) return material;
    if (material.userData) { material.userData.__lgrIndirectField = field; material.userData.__lgrIndirectApplied = true; }
    // CHAIN, don't clobber: keep any handler/cache-key already on the material (e.g. applyGroundMacro).
    const prevCompile = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;

    material.onBeforeCompile = (shader, renderer) => {
      if (prevCompile) prevCompile(shader, renderer);   // run the base patch first (macro de-tiling, etc.)
      shader.uniforms.uIndField = u.uIndField;
      shader.uniforms.uIndMin = u.uIndMin;
      shader.uniforms.uIndInvSize = u.uIndInvSize;
      shader.uniforms.uIndRes = u.uIndRes;
      shader.uniforms.uIndScale = u.uIndScale;
      shader.uniforms.uIndStrength = u.uIndStrength;
      shader.uniforms.uIndTint = u.uIndTint;

      // VERTEX: hand the fragment the true world position (the grid lookup is in world space).
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n  varying vec3 vIndWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vIndWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');

      // FRAGMENT: pull in the lookup library (it declares the uniforms + lgrIndirect), then ADD the
      // baked bounce to Three's `irradiance` right after <lights_fragment_maps> — the conventional
      // "inject custom irradiance here" site, before RE_IndirectDiffuse folds it through the Lambert
      // BRDF (so it is correctly modulated by albedo and tonemapped). uIndTint defaults to white ->
      // the bake's authored (cool-grade) colour passes through untouched.
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n  varying vec3 vIndWPos;\n' + indirectLib)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
      irradiance += lgrIndirect(vIndWPos) * uIndStrength * uIndTint;`);
    };
    // Namespace the patched program (folding in any prior key) so Three's cache never shares it.
    // prevKey MUST be called with `this` = material: Three's DEFAULT customProgramCacheKey (the one a
    // bare receiver like a building/tree still has) returns `this.onBeforeCompile.toString()`, so an
    // unbound prevKey() throws "cannot read onBeforeCompile of undefined". (applyGlint dodges this only
    // because it is applied post-macro, whose key is an own arrow — a latent trap for a bare material.)
    material.customProgramCacheKey = () => (prevKey ? prevKey.call(material) : '') + '|lgr-indirect';
    material.needsUpdate = true;
    return material;
  }

  const field = {
    texture: tex,
    uniforms: u,
    apply,
    setStrength(s) { u.uIndStrength.value = s; },
    setTint(c) { if (c) u.uIndTint.value.copy(c); },
    dispose() { tex.dispose(); },
  };
  return field;
}
