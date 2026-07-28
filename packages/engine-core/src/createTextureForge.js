/* ============================================================
   @lgr/engine-core — createTextureForge (Beauty Campaign B1: GROUND TRUTH).
   ------------------------------------------------------------
   A GPU texture FORGE: it bakes seeded procedural PBR material sets (albedo / ORM / normal) at BOOT,
   entirely on the GPU, so a project's world stops being flat-coloured. One fragment program per
   surface family is evaluated into render targets; nothing is read back to the CPU — the render
   targets ARE the textures. This is the engine-first ABILITY; a project supplies recipes and wires
   the resulting materials (Beauty-campaign law: forge + recipes in core, hoard2 wires only).

   Mirrors the proven GPU-bake pattern in water-flow-gpu.js (Rule 6: do NOT invent a second GPGPU
   style) — a fullscreen quad + an orthographic camera + runPass(material, target). The novelty here
   is only WHAT the passes compute (a material set) and the multi-channel routing.

   ── A BAKE (per recipe) — four fullscreen draws, no read-back ─────────────────
     pass 0: surface() -> ALBEDO   target (sRGB8)      -> material.map
     pass 1: surface() -> ORM      target (linear8)    -> roughnessMap + metalnessMap + aoMap
     pass 2: surface() -> HEIGHT   scratch (16F linear, SHARED + reused per recipe)
     pass 3: Sobel(height)-> NORMAL target (linear8)   -> material.normalMap
   uChannel selects the pass; the family shader is a plain single-output fragment program.

   ── INVARIANTS (shipped as code, per the asset-forge audit + engine-invariants.md) ──
     • sRGB DATA-MAP TRAP: ONLY albedo is sRGB; ORM + normal + height are DATA and stay LINEAR
       (NoColorSpace). An sRGB-tagged data map decodes 0.5 -> 0.21 and silently breaks the layer.
     • NYQUIST >= ~6.4 texels/feature: enforced by the recipes (period choices), documented in
       forge-common.glsl. nyquistFeatureFloor() below is the exported guard the recipes/tests use.
     • HALF-FLOAT height scratch: 8-bit height gives stair-stepped Sobel normals; the scratch is 16F
       where the GPU supports it (else it degrades to 8-bit, not a hard failure).
     • PRE-WARM, NO MID-PLAY BAKES: bake every recipe at world construction; the perf gate asserts
       renderer.info.programs does not grow during combat.
     • PRECISION FLOOR: a GPU with no high-precision FRAGMENT float (iOS p0) cannot bake reliably —
       supported=false, bake() returns null, and makeMaterial() falls back to the recipe's flat
       colour. That is exactly the LOWP phone path (owner-verified) — the forge never regresses it.

   C++ anchor: the forge is a small compiler — a recipe is source, bake() emits four GPU buffers, and
   makeMaterial() links them into a MeshStandardMaterial. The whole thing runs once at load, like a
   static initializer warming a lookup table.
   ============================================================ */
import * as THREE from 'three';

import fullscreenVert from './shaders/fullscreen.vert';
import forgeNormalFrag from './shaders/forge-normal.frag';
import forgeExampleFrag from './shaders/forge-example.frag';

// pure, node-testable guards (Nyquist floor + tiling repeat) live shader-free in forge-math.js.
import { FORGE_MIN_TEXELS, nyquistFeatureFloor, repeatFor } from './forge-math.js';
export { FORGE_MIN_TEXELS, nyquistFeatureFloor, repeatFor };

export function createTextureForge({ renderer, size: defaultSize = 1024, enabled = true } = {}) {
  if (!renderer) throw new Error('createTextureForge: renderer required');
  const gl = renderer.getContext();

  // PRECISION FLOOR — no high-precision fragment float (iOS p0) => cannot bake; fall back to flats.
  const fragHighp = (() => {
    try { const f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT); return f ? f.precision > 0 : false; }
    catch { return true; }   // assume ok if the query itself is unavailable (desktop path)
  })();
  // `enabled:false` is the deliberate off switch (a project's ?forge=0 A/B toggle) → flat fallbacks.
  const supported = !!fragHighp && enabled !== false;

  // half-float render support for the height scratch (else degrade to 8-bit — still functional).
  const halfOk = !!(gl.getExtension && (gl.getExtension('EXT_color_buffer_half_float') || gl.getExtension('EXT_color_buffer_float')));

  const maxAniso = renderer.capabilities.getMaxAnisotropy ? renderer.capabilities.getMaxAnisotropy() : 1;

  // ---- fullscreen-quad bake rig (mirrors water-flow-gpu.js) ----
  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
  quad.frustumCulled = false; quadScene.add(quad);

  function runPass(material, target) {
    quad.material = material;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
    renderer.setRenderTarget(prev);
  }

  // ---- a shared HEIGHT scratch RT, sized to the largest bake seen; the Sobel reads it each recipe ----
  let heightScratch = null, heightSize = 0;
  function heightRT(sz) {
    if (heightScratch && heightSize >= sz) return heightScratch;
    if (heightScratch) heightScratch.dispose();
    heightScratch = new THREE.WebGLRenderTarget(sz, sz, {
      type: halfOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,  // edge taps wrap -> the normal tiles too
      depthBuffer: false, stencilBuffer: false,
    });
    heightScratch.texture.colorSpace = THREE.NoColorSpace;
    heightSize = sz;
    return heightScratch;
  }

  // an output RT (albedo / orm / normal): mipmapped + anisotropic + repeat, for clean reads at distance.
  function outRT(sz, srgb) {
    const rt = new THREE.WebGLRenderTarget(sz, sz, {
      type: THREE.UnsignedByteType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
      generateMipmaps: true, anisotropy: maxAniso,
      depthBuffer: false, stencilBuffer: false,
    });
    // sRGB ONLY on albedo (three encodes linear->sRGB on write, decodes on read). Data maps stay linear.
    rt.texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    return rt;
  }

  const normalMat = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert, fragmentShader: forgeNormalFrag,
    uniforms: { uHeight: { value: null }, uTexel: { value: new THREE.Vector2() }, uRelief: { value: 0.1 }, uWorldSize: { value: 1 } },
  });

  const _bakedList = [];   // for dispose()

  /* ---- bake one recipe -> a material-map set (or null when unsupported) ---- */
  function bake(recipe = {}) {
    if (!supported) return null;
    const sz = recipe.size || defaultSize;
    const frag = recipe.frag || forgeExampleFrag;
    const worldSize = recipe.worldSize != null ? recipe.worldSize : 1;
    const relief = recipe.relief != null ? recipe.relief : 0.08;

    const surfMat = new THREE.ShaderMaterial({
      vertexShader: fullscreenVert, fragmentShader: frag,
      uniforms: {
        uChannel: { value: 0 },
        uSeed: { value: recipe.seed != null ? recipe.seed : 0 },
        uWorldSize: { value: worldSize },
        uRelief: { value: relief },
        ...(recipe.uniforms || {}),
      },
    });

    const albedo = outRT(sz, true);
    const orm = outRT(sz, false);
    const normal = outRT(sz, false);
    const height = heightRT(sz);

    surfMat.uniforms.uChannel.value = 0; runPass(surfMat, albedo);
    surfMat.uniforms.uChannel.value = 1; runPass(surfMat, orm);
    surfMat.uniforms.uChannel.value = 2; runPass(surfMat, height);

    normalMat.uniforms.uHeight.value = height.texture;
    normalMat.uniforms.uTexel.value.set(1 / sz, 1 / sz);
    normalMat.uniforms.uRelief.value = relief;
    normalMat.uniforms.uWorldSize.value = worldSize;
    runPass(normalMat, normal);

    surfMat.dispose();   // the program stays cached; free the JS material — the RTs hold the pixels

    const out = {
      map: albedo.texture, ormMap: orm.texture, normalMap: normal.texture,
      roughnessMap: orm.texture, metalnessMap: orm.texture, aoMap: orm.texture,
      _rts: [albedo, orm, normal],
      dispose() { for (const t of this._rts) t.dispose(); },
    };
    _bakedList.push(out);
    return out;
  }

  /* ---- bake + build a ready MeshStandardMaterial (flat-colour fallback when unsupported) ---- */
  function makeMaterial(recipe = {}, matOpts = {}) {
    const { repeat, ...std } = matOpts;
    const baked = bake(recipe);
    if (!baked) {
      // iOS-p0 / unsupported: exactly the flat look the LOWP path renders today — no regression.
      return new THREE.MeshStandardMaterial({
        color: recipe.fallbackColor != null ? recipe.fallbackColor : 0x808080,
        roughness: recipe.roughness != null ? recipe.roughness : 1,
        metalness: recipe.metalness != null ? recipe.metalness : 0,
        ...std,
      });
    }
    const mat = new THREE.MeshStandardMaterial({
      map: baked.map, normalMap: baked.normalMap,
      roughnessMap: baked.roughnessMap, metalnessMap: baked.metalnessMap, aoMap: baked.aoMap,
      roughness: recipe.roughness != null ? recipe.roughness : 1,
      metalness: recipe.metalness != null ? recipe.metalness : 0,
      ...std,
    });
    mat.aoMap.channel = 0;   // reuse the primary UV set (our geometry has no uv2) so AO actually applies
    if (repeat != null) setRepeat(mat, repeat);
    mat.userData.forgeBaked = baked;
    return mat;
  }

  // apply a tiling repeat to every map on a forge material (all maps share the same UV transform).
  function setRepeat(mat, r) {
    const rx = r.x != null ? r.x : r, ry = r.y != null ? r.y : r;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) {
      const t = mat[k]; if (t) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.needsUpdate = true; }
    }
  }

  function dispose() {
    for (const b of _bakedList) b.dispose();
    if (heightScratch) heightScratch.dispose();
    quad.geometry.dispose(); normalMat.dispose();
  }

  return { supported, bake, makeMaterial, setRepeat, dispose, get size() { return defaultSize; } };
}
