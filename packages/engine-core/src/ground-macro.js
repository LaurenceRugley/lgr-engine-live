/* ============================================================
   @lgr/engine-core — ground-macro.js (Arc A7-1): WORLD-SCALE MACRO DE-TILING for a tiled floor.
   ------------------------------------------------------------
   THE PROBLEM this fixes (and the honest reason a shader tweak alone can't): a baked, REPEATED tile
   texture — our forge ground is one 6 m tile stamped ~13× across an 80 m disc — cannot contain any
   feature LARGER than its own tile, because anything bigger simply repeats. So no matter how good the
   tile is, at the isometric camera distance (where the floor is the biggest thing on screen) the eye
   locks onto the 6 m repeat and reads a GRID. The only real cure is a SECOND field at world scale that
   does NOT tile — large soft patches of lighter/darker/tinted earth drifting over many tiles at once,
   decorrelated from the repeat, so there is no single period for the eye to find. This is the standard
   studio "macro variation" / de-tiling trick.

   HOW: we splice a tiny branch into Three's stock MeshStandardMaterial via `onBeforeCompile` (the same
   hook vector-style.js uses for the city). The vertex stage hands the fragment the world XZ position;
   the fragment evaluates a cheap 3-octave value-noise over (worldXZ · scale) — scale chosen so one
   feature spans ~15-25 m, i.e. several tiles — and modulates the *linear* albedo brightness a little,
   plus a faint tint toward a mossy/ashen hue in the darker patches. Because the coordinate is true
   world XZ (not the tiled UV), the macro is aperiodic across the disc: the grid dissolves.

   WHY it stays byte-identical for other consumers: this is OPT-IN. A material nobody calls
   applyGroundMacro on is Three's stock program, untouched. The city never calls it → the city bakes an
   identical shader → tier-guard / present-parity hold. Only hoard2's ground opts in, on the DESKTOP
   (forge-supported) path; the mobile flat-colour fallback (M1 class) is intentionally left alone.

   Presentation-only + alloc-free: the uniforms are created once here; the per-frame cost is a handful
   of noise taps in the fragment shader (no CPU work, no allocation). No sim/determinism surface.

   C++ anchor: onBeforeCompile is a source-level "hook" — Three concatenates named #include chunks into
   one program string, and we string-replace a chunk boundary to inject our GLSL before the linker runs,
   like a preprocessor macro expanding at compile time. customProgramCacheKey namespaces the patched
   program so Three's shader cache never confuses it with the un-patched base material.
   ============================================================ */

// The injected fragment library: a cheap value-noise fbm over world XZ. Kept deliberately low-frequency
// (features are METRES across), so it is nowhere near the tile's Nyquist band — it is the OPPOSITE end
// of the spectrum from the tile detail, which is exactly why it breaks the repeat without adding grain.
const MACRO_FRAG_PARS = `
  varying vec2 vGmXZ;
  uniform float uGmScale;      // world-space frequency: 1 noise cell ~= 1/uGmScale metres
  uniform float uGmBright;     // peak brightness swing (+/-) the macro applies to albedo
  uniform float uGmTintAmt;    // how strongly the dark patches pull toward uGmTint
  uniform vec3  uGmTint;       // the hue the low (darker/damper) patches drift toward
  float gmHash(vec2 p){ return fract(sin(dot(p, vec2(27.17, 113.5))) * 43758.5453); }
  float gmNoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(gmHash(i), gmHash(i + vec2(1.0,0.0)), f.x),
               mix(gmHash(i + vec2(0.0,1.0)), gmHash(i + vec2(1.0,1.0)), f.x), f.y); }
  float gmFbm(vec2 p){ float s = 0.0, a = 0.5, n = 0.0;
    for (int i = 0; i < 3; i++){ s += a * gmNoise(p); n += a; p *= 2.03; a *= 0.5; }
    return s / max(n, 1e-4); }
`;

/* Attach the macro de-tiling layer to a baked, tiling MeshStandardMaterial.
   opts:
     scale     — world frequency (default 0.045 → ~22 m per feature; a few tiles wide)
     brightness— albedo brightness swing, ± (default 0.16)
     tintAmt   — pull of dark patches toward `tint` (default 0.22)
     tint      — [r,g,b] linear hue the damp/dark patches drift toward (default a cool moss-ash)
   Returns the material (for chaining). A no-op-safe call on a flat fallback material is possible but the
   caller should gate on forge.supported so the mobile flat class is untouched (brief A7-1). */
export function applyGroundMacro(material, opts = {}) {
  if (!material) return material;
  const scale = opts.scale != null ? opts.scale : 0.045;
  const brightness = opts.brightness != null ? opts.brightness : 0.16;
  const tintAmt = opts.tintAmt != null ? opts.tintAmt : 0.22;
  const tint = opts.tint || [0.16, 0.18, 0.14];

  // one shared uniform set per material (created once — no per-frame allocation)
  const u = {
    uGmScale: { value: scale },
    uGmBright: { value: brightness },
    uGmTintAmt: { value: tintAmt },
    uGmTint: { value: { x: tint[0], y: tint[1], z: tint[2] } },
  };

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uGmScale = u.uGmScale;
    shader.uniforms.uGmBright = u.uGmBright;
    shader.uniforms.uGmTintAmt = u.uGmTintAmt;
    shader.uniforms.uGmTint = u.uGmTint;
    // VERTEX: hand the fragment the true world XZ (a de-tiled coordinate, unlike the repeated map UV).
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n  varying vec2 vGmXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vGmXZ = (modelMatrix * vec4(position, 1.0)).xz;');
    // FRAGMENT: after the tiled albedo is sampled (map_fragment writes linear diffuseColor), modulate it
    // by the world-scale macro. Darker patches also drift toward the damp tint — decayed earth, not a
    // uniformly tinted plane. This runs in LINEAR space (map_fragment already sRGB-decoded), so a scalar
    // brightness multiply is a physically sane albedo change.
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + MACRO_FRAG_PARS)
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        float gm = gmFbm(vGmXZ * uGmScale);          // 0..1 world-scale field, aperiodic across the disc
        float swing = (gm - 0.5) * 2.0;              // -1..1 centred so the mean albedo is preserved
        diffuseColor.rgb *= (1.0 + swing * uGmBright);
        float damp = 1.0 - smoothstep(0.35, 0.65, gm);   // the low (darker) patches read damper/mossier
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uGmTint, damp * uGmTintAmt);
      }`);
  };
  // Namespace the patched program so Three's cache never shares it with an un-patched MeshStandard.
  material.customProgramCacheKey = () => 'lgr-ground-macro';
  material.needsUpdate = true;
  return material;
}
