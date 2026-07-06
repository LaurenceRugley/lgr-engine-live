/* ============================================================
   vector-style.js — Lesson 11 (Part B): the FLAT-VECTOR material style.
   ------------------------------------------------------------
   John's reference (Coffee Inc 2's city map — see docs/reference/john/STYLE-ANALYSIS.md)
   is NOT a post-processed look. It's an ART DIRECTION of MATERIALS: flat per-face fills,
   no gradients, no specular, no shadows — top face brightest, one side mid, the rest dark.
   That makes "vector" a second STYLE AXIS, orthogonal to our post passes:

       POST styles (pixel, toon) — transform the rendered IMAGE.
       MATERIAL styles (standard-lit, FLAT-VECTOR) — change how SURFACES shade.

   Any combination is valid: flat-vector alone = the Coffee Inc 2 look; flat-vector + pixel
   = retro tycoon; flat-vector + toon = our cel look. (STYLE-ANALYSIS.md, "the big insight".)

   HOW WE TOGGLE IT — one uniform, not a material swap. Every diorama/agent material gets a
   tiny branch spliced into Three's built-in shader via `onBeforeCompile` (Three's hook to
   edit its GLSL without rewriting it). The branch is gated by ONE shared uniform object,
   `vectorOn`, that EVERY material binds by reference — so flipping `vectorOn.value` re-skins
   the entire city in a single assignment, with zero per-material bookkeeping and zero change
   to the lit path when it's off. (Material-swap was the other option; the uniform branch
   keeps per-instance car colours and the night-window emissive path working untouched.)

   WHY UNLIT TIERS FROM THE NORMAL. The flat look isn't "lit by a dim light" — it's a fixed
   ladder of luminance keyed off the FACE NORMAL: up-faces brightest, a fixed art-directed
   "sun-side" azimuth mid, everything else shade. With flatShading box geometry the normal is
   already per-face, so the tiers land as crisp facets — no gradient to dither against. The
   SunRig still drives a MILD day/night tint (uVecTint) so the style keeps a day/night life
   the static reference can't — night windows + headlight pools are our edge.
   ============================================================ */
import * as THREE from 'three';

/* ONE shared toggle uniform: 0 = standard lit, 1 = flat-vector. Every vectorized
   material binds THIS object, so main.js flips the whole look with `vectorOn.value = 1`. */
export const vectorOn = { value: 0.0 };
export const windowRecess = { value: 0.0 };   // L106: beauty+noon-only pane-recess darkener (0 = off → pixel/toon/vector BYTE-IDENTICAL); createEngine drives it = midK in the beauty branch so panes read at noon (the washout fix)

/* A MILD day/night tint, mutated in place by main.js each frame (by-reference, the L09
   pattern): ~white by day → dim blue at night. Multiplies every flat tier, so the
   vector city still has a sun cycle (then the emissive windows/headlights carry night). */
export const vectorTint = new THREE.Color('#ffffff');

/* L16: how dark the SUN SHADOW darkens a flat-vector surface (0 = none). Main drives it per
   frame (it fades at grazing angles + at night). In LIT mode shadows come for free via the
   light; but the vector override REPLACES the lit output, so we re-apply the shadow here. */
export const vectorShadow = { value: 0.0 };

/* L18 WEATHER hooks (shared, driven by main each frame): uSnow = white accumulation on up-faces
   (roofs/ground), uCloud = drifting cloud-shadow strength, uCloudOff = its scroll offset (wind). */
export const weatherSnow = { value: 0.0 };
export const weatherCloud = { value: 0.0 };
export const weatherCloudOff = new THREE.Vector2();

/* L20 CHARM FOG: 0 = Three's smooth FogExp2 ramp; >0 = the fog blend is ORDERED-DITHERED into
   bands (a Bayer-matrix threshold per pixel) for the 32/64-bit "charming" sky John loves. Driven
   by main = the weather rig's fog amount, so it only bands when it's actually foggy. */
export const fogCharm = { value: 0.0 };

/* L18 SEASONS (light): one shared scalar 0 spring → 1 winter. Phase 1 only recolours opted-in
   surfaces (tree leaves): green → autumn-orange → bare-brown. Driven by main (K cycles it). The
   `season:true` flag on vectorize() is what makes a material pay for this — everything else skips it. */
export const weatherSeason = { value: 0.0 };

/* The leaf recolour the season scalar drives. Pulled out so it reads as one knob, not magic mixes:
   greens hold through summer, shift orange across autumn (smoothstep 0.4→0.7), then dry to bare
   brown into winter (0.75→1.0). Only spliced when a material opts in with season:true. */
const SEASON_FN = 'vec3 seasonShift(vec3 c){\n'
  + '  c = mix(c, vec3(0.86, 0.46, 0.13), smoothstep(0.40, 0.70, uSeason));   // → autumn orange\n'
  + '  c = mix(c, vec3(0.46, 0.33, 0.20), smoothstep(0.75, 1.00, uSeason));   // → bare brown\n'
  + '  return c;\n}';

/* ---- the GLSL the splice injects (exported so diorama.js can compose it into the
        window-grid towers, which need windows AND tiers in one onBeforeCompile) ------ */

/* VERTEX: forward OBJECT-space normal + position (tiers + window grid) and the WORLD xz (so the
   cloud-shadow noise is continuous across the whole city, not per-mesh-local). */
export const VEC_VERT_PARS = 'varying vec3 vVecN;\nvarying vec3 vVecP;\nvarying vec2 vWorldXZ;';
export const VEC_VERT_MAIN = 'vVecN = normal;\n  vVecP = position;\n  vWorldXZ = (modelMatrix * vec4(position, 1.0)).xz;';

/* FRAGMENT: the shared uniforms + the tier function. THREE crisp luminance tiers:
   up-faces = 1.0 (brightest), the fixed sun-side azimuth = 0.82 (mid), the rest = 0.58
   (shade). `step` (not smoothstep) keeps them discrete — flat facets, no gradient. */
export const VEC_FRAG_PARS = `
  varying vec3 vVecN;
  varying vec3 vVecP;
  varying vec2 vWorldXZ;
  uniform float uVector;
  uniform vec3  uVecTint;
  uniform float uVecShadow;
  uniform float uSnow;        // white roof/ground accumulation
  uniform float uCloud;       // cloud-shadow strength
  uniform vec2  uCloudOff;    // cloud-shadow scroll (wind)
  uniform float uFogCharm;    // L20: 0 smooth fog → 1 ordered-dithered banded fog
  // 4x4 ORDERED (Bayer) dither, built recursively from the 2x2 base so we need no array/LUT.
  // Returns a per-pixel threshold in [0,1) — comparing/quantising against it turns a smooth ramp
  // into clean diagonal bands (the classic 8/16-bit gradient look). (C++: a const threshold matrix.)
  float bayer2(vec2 q){ return 2.0 * q.x + 3.0 * q.y - 4.0 * q.x * q.y; }   // → 0,2,3,1
  float bayer4(vec2 c){ vec2 p = floor(mod(c, 4.0));
    return (4.0 * bayer2(floor(p / 2.0)) + bayer2(mod(p, 2.0))) / 16.0; }
  // cheap value noise for the drifting cloud shadows (no texture needed).
  float vhash(vec2 p){ return fract(sin(dot(p, vec2(27.17, 113.5))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(vhash(i), vhash(i + vec2(1,0)), f.x), mix(vhash(i + vec2(0,1)), vhash(i + vec2(1,1)), f.x), f.y); }
  vec3 vecShade(vec3 base){
    vec3 n = normalize(vVecN);
    float up  = step(0.5, n.y);                         // up-facing → top tier
    vec3  sun = normalize(vec3(0.55, 0.0, -0.83));      // fixed, art-directed "sun side"
    float lit = step(0.25, dot(normalize(vec3(n.x, 0.0, n.z) + 1e-4), sun));
    float tier = mix(0.58, 0.82, lit);                  // shade vs sun-side
    tier = mix(tier, 1.0, up);                          // top overrides → brightest
    vec3 c = base * tier * uVecTint;
    c = mix(c, vec3(0.93, 0.95, 0.99), up * uSnow);     // SNOW dusts roofs + ground white
    float cl = vnoise(vWorldXZ * 0.12 + uCloudOff);     // CLOUD SHADOW drifts over the whole city
    c *= mix(1.0, 0.6 + 0.4 * cl, uCloud);
    return c;
  }
`;

/* Bind the two SHARED uniforms (the toggle + the tint) onto a compiled shader. Both are
   the same objects every material references → one write in main.js updates them all. */
export function attachVectorUniforms(shader) {
  shader.uniforms.uVector    = vectorOn;
  shader.uniforms.uVecTint   = { value: vectorTint };
  shader.uniforms.uVecShadow = vectorShadow;
  shader.uniforms.uSnow      = weatherSnow;
  shader.uniforms.uCloud     = weatherCloud;
  shader.uniforms.uCloudOff  = { value: weatherCloudOff };
  shader.uniforms.uFogCharm  = fogCharm;
}

/* L20: replace Three's smooth FogExp2 blend with an ORDERED-DITHERED one, so fog reads as the
   charming banded sky (not a perfectly smooth ramp). We recompute the same exp² fog factor Three
   would, then — scaled by uFogCharm — quantise it into bands with a Bayer threshold before mixing
   toward fogColor. uFogCharm 0 → byte-identical to Three's fog; >0 → progressively banded. Spliced
   into every flat-vector material so vector/toon/pixel all get the look (pixel further quantises). */
function spliceCharmFog(frag) {
  return frag.replace('#include <fog_fragment>', `
    #ifdef USE_FOG
      float fF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
      // NEON PUNCHES THROUGH: bright (emissive window) fragments resist the haze, so the city's
      // lights still glow through the murk — the cheap stand-in for a bloom pass the mock fakes.
      float lum = dot(gl_FragColor.rgb, vec3(0.299, 0.587, 0.114));
      fF *= 1.0 - 0.7 * smoothstep(0.30, 0.85, lum);
      // CHARM: ordered-dither the fog factor into bands (scaled by uFogCharm) for the banded sky.
      float bands = 7.0;
      float dith  = bayer4(gl_FragCoord.xy) - 0.5;             // ordered threshold, centred
      float banded = clamp(floor(fF * bands + 0.5 + dith) / bands, 0.0, 1.0);
      fF = mix(fF, banded, uFogCharm);                          // smooth → banded by charm amount
      gl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, fF);
    #endif
  `);
}

/* Splice the vertex varyings into a Three built-in vertex shader. */
export function spliceVectorVertex(vert) {
  return vert
    .replace('#include <common>', '#include <common>\n' + VEC_VERT_PARS)
    .replace('#include <begin_vertex>', '#include <begin_vertex>\n  ' + VEC_VERT_MAIN);
}

/* L16: make `getShadowMask()` available in a meshphysical fragment. meshphysical includes
   <shadowmap_pars_fragment> (the shadow samplers + getShadow) but NOT <shadowmask_pars_fragment>
   (which defines getShadowMask — it's normally only in basic/lambert). We splice it in right
   after, so the vector override can read the sun's shadow factor. getShadowMask() safely returns
   1.0 when shadows are off (USE_SHADOWMAP undefined), so the call is unconditional. */
function spliceShadowMask(frag) {
  return frag.replace('#include <shadowmap_pars_fragment>',
    '#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
}
const VEC_SHADOW = 'col *= mix(1.0, getShadowMask(), uVecShadow);';   // darken the flat tier by the shadow

/* Vectorize a TOWER material — flat tiers + a procedural WINDOW grid that emits at night
   (lit path) AND is drawn as flat day-glass in the vector path. This is the exact adoption
   our box towers use; Lesson 12 reuses it so imported GLTF landmarks JOIN the same system
   instead of looking pasted-in. `windowGlow` is the shared SunRig-driven night level (bind
   the SAME object the diorama owns so towers + landmarks light up together); `id` seeds the
   per-building window hash; `color` is the authored flat-vector colour.
     C++ analogy: this is like a template instantiated for two call sites (diorama boxes and
     loaded models) — one body, many concrete materials, each with its own uniforms. */
export function vectorizeTower(material, {
  color, id, windowGlow,
  // L13: per-PROFILE night windows. winColors = up to 3 lit-pane colours sampled by hash
  // (Manhattan warm+cool offices; Neo-Tokyo a neon trio); litFrac = how many panes light at
  // full glow (Paris sleepy 0.45 → Neo-Tokyo "never sleeps" 0.70). Defaults = the L09 look.
  winColors = ['#ffb852', '#8cd9ff'], litFrac = 0.55,
} = {}) {
  const wc = [0, 1, 2].map((i) => new THREE.Color(winColors[i] ?? winColors[winColors.length - 1]));
  // Towers inject the WINDOW-GRID splice (different source from vectorize()) — give them their own
  // program-cache bucket so they never share a compiled program with a plain/season material above.
  material.customProgramCacheKey = () => 'lgr-vec-tower';
  material.onBeforeCompile = (shader) => {
    attachVectorUniforms(shader);                   // shared uVector + uVecTint
    shader.uniforms.uWindowGlow = windowGlow;       // shared night-glow level
    shader.uniforms.uWinId = { value: id };         // per-building hash seed
    shader.uniforms.uVecColor = { value: new THREE.Color(color) };
    shader.uniforms.uWinA = { value: wc[0] };       // lit-window palette (per profile)
    shader.uniforms.uWinB = { value: wc[1] };
    shader.uniforms.uWinC = { value: wc[2] };
    shader.uniforms.uWinLit = { value: litFrac };
    shader.uniforms.uWinRecess = windowRecess;   // L106: shared beauty+noon pane-recess darkener (0 elsewhere → byte-identical)
    shader.vertexShader = spliceVectorVertex(shader.vertexShader);
    shader.fragmentShader = spliceCharmFog(spliceShadowMask(shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uWindowGlow;
        uniform float uWinId;
        uniform vec3  uVecColor;
        uniform vec3  uWinA; uniform vec3 uWinB; uniform vec3 uWinC;
        uniform float uWinLit;
        uniform float uWinRecess;
        ${VEC_FRAG_PARS}
        float winHash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1)) + uWinId * 7.13) * 43758.5453); }
        // Returns (paneMask, litTonight) and writes this pane's lit colour to wcol.
        vec2 winTerms(out vec3 wcol){
          float sideMask = step(abs(vVecN.y), 0.5);   // vertical faces only (skip roof/underside)
          float colCoord = (vVecP.x + vVecP.z) * 3.2;  // columns wrap the box
          float rowCoord =  vVecP.y * 3.2;             // rows up y
          vec2  cell = vec2(floor(colCoord), floor(rowCoord));
          vec2  f    = fract(vec2(colCoord, rowCoord));
          float pane = step(0.18, f.x) * step(f.x, 0.82) * step(0.22, f.y) * step(f.y, 0.80);
          float r    = winHash(cell);
          float lit  = step(r, uWindowGlow * uWinLit); // cap lit fraction → staggered skyline
          float s = fract(r * 13.0);                    // pick among the (≤3) lit-pane colours
          wcol = s < 0.34 ? uWinA : (s < 0.67 ? uWinB : uWinC);
          return vec2(sideMask * pane, lit);
        }`)
      // L88 BEAUTY/LIT FACADE — the client-preview fix. The vector path (below, uVector>0.5) already
      // draws day glass + flat tiers, but the LIT/beauty path (what the live preview shows) previously
      // rendered bare boxes: windows only EMITTED at night, so by day a light-cream tower under the
      // sky-IBL blew out to flat white. Here we fold the SAME procedural pane grid into the LIT albedo
      // so buildings read as glass-and-mullion by day, with a per-building tonal break + a base→top AO
      // gradient so masses gain depth instead of reading as one white slab. This runs BEFORE Three's
      // lighting (color_fragment sets diffuseColor), so the panes are lit naturally and stay cohesive.
      // The pure-vector tier is untouched (it overwrites gl_FragColor from uVecColor at opaque_fragment).
      // C++ anchor: winTerms() is a pure function of surface UV (vVecP/vVecN) — a checkerboard computed
      // in the kernel, no texture fetch — and the lit-vs-emissive use are two call sites of that one fn.
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          // winTerms() returns (paneMask, litTonight); we want the day pane mask here. It already
          // restricts itself to vertical faces (roofs/underside excluded), so roof caps stay clean.
          vec3 wcolL; vec2 wL = winTerms(wcolL);
          float bvar = 0.80 + 0.20 * fract(uWinId * 0.131);          // per-building tonal break (0.80..1.0)
          diffuseColor.rgb *= bvar;                                   // …pulls light creams off pure white
          // L106 NOON WINDOW FIX: uWinRecess (beauty+noon only, = midK; 0 on stylized tiers → byte-identical) makes the
          // pane ABSOLUTELY darker so the recess survives the big noon key + the ACES shoulder (was only *relatively*
          // darker via a 0.40× ratio → washed out at noon). Warmer floor so the L105 warm-balance doesn't fight it.
          vec3 dayGlass = diffuseColor.rgb * (0.40 - 0.22 * uWinRecess) + vec3(0.030, 0.045, 0.075);
          diffuseColor.rgb = mix(diffuseColor.rgb, dayGlass, wL.x * (0.85 + 0.10 * uWinRecess));   // pane commits harder at noon
        }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 wcol; vec2 w = winTerms(wcol);
          totalEmissiveRadiance += w.x * w.y * wcol * uWindowGlow * 2.6;   // L93: brighter lit windows → they GLOW + the existing bloom catches them (the "city ignites" beat)
        }`)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (uVector > 0.5) {
          vec3 col = vecShade(uVecColor);
          ${VEC_SHADOW}                                  // the sun's shadow darkens the body
          vec3 wcol; vec2 w = winTerms(wcol);
          vec3 glass = vec3(0.17, 0.23, 0.34);          // dark glass-blue panes (day)
          col = mix(col, glass, w.x * 0.85);
          col += w.x * w.y * wcol * uWindowGlow * 2.2;  // …windows EMIT (unshadowed) at night — L93: brighter ignite
          gl_FragColor = vec4(col, diffuseColor.a);
        }`)));
  };
  return material;
}

/* Vectorize a PLAIN material (no window grid): island / cap / tanks / road deck, and the
   instanced cars / pedestrians.
     - color set  → that authored hex is the flat base (towers/ground/props).
     - color null → base = diffuseColor.rgb, which for an InstancedMesh already carries the
                    per-instance colour (taxi yellow, bus red …), so cars stay themselves,
                    just flat-shaded. (Three defines USE_COLOR in the fragment whenever
                    instanceColor exists, so diffuseColor *= vColor has run by opaque_fragment.)
   The override replaces gl_FragColor ONLY when the toggle is on; the lit path is untouched. */
export function vectorize(material, { color = null, glow = null, glowDay = 0.0, glowNight = 1.0, windowGlow = null, season = false } = {}) {
  const useDiffuse = color === null;
  // L14: optional NIGHT GLOW for iconic landmarks (Tokyo Tower orange, Empire crown, neon
  // billboards). Emits `glow` scaled by intensity = mix(glowDay, glowNight, windowGlow) — so a
  // night-only landmark (glowDay 0) lights after dusk, a billboard (glowDay 0.5) shines always.
  // Works in BOTH the vector override AND the lit emissive path. Needs the shared windowGlow.
  const hasGlow = glow !== null && windowGlow !== null;
  // CRITICAL (Three program cache): materials with the same standard cache key SHARE one compiled
  // program — so two materials that splice DIFFERENT GLSL via onBeforeCompile would collide, and the
  // second silently reuses the first's program (its injected code is dropped; only uniforms differ).
  // Our flat-vector flavours inject different source (plain / glow / SEASON), so each flavour needs a
  // distinct key or e.g. tree leaves render WITHOUT their seasonShift. (Found the hard way in L18.)
  material.customProgramCacheKey = () => 'lgr-vec|' + (useDiffuse ? 'd' : 'c') + (hasGlow ? 'g' : '') + (season ? 's' : '');
  material.onBeforeCompile = (shader) => {
    attachVectorUniforms(shader);
    if (!useDiffuse) shader.uniforms.uVecColor = { value: new THREE.Color(color) };
    if (hasGlow) {
      shader.uniforms.uGlow = { value: new THREE.Color(glow) };
      shader.uniforms.uGlowDay = { value: glowDay };
      shader.uniforms.uGlowNight = { value: glowNight };
      shader.uniforms.uWindowGlow = windowGlow;
    }
    if (season) shader.uniforms.uSeason = weatherSeason;       // opt-in: only this material pays for the season knob
    shader.vertexShader = spliceVectorVertex(shader.vertexShader);
    const rawBase = useDiffuse ? 'diffuseColor.rgb' : 'uVecColor';
    const base = season ? `seasonShift(${rawBase})` : rawBase;  // recolour the flat base by season before tiering
    const decl = (useDiffuse ? '' : 'uniform vec3 uVecColor;\n')
      + (hasGlow ? 'uniform vec3 uGlow; uniform float uGlowDay; uniform float uGlowNight; uniform float uWindowGlow;\n' : '')
      + (season ? 'uniform float uSeason;\n' + SEASON_FN + '\n' : '');
    const glowExpr = hasGlow ? 'uGlow * mix(uGlowDay, uGlowNight, uWindowGlow)' : 'vec3(0.0)';
    let frag = spliceCharmFog(spliceShadowMask(shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + decl + VEC_FRAG_PARS)
      .replace('#include <opaque_fragment>', `#include <opaque_fragment>
        if (uVector > 0.5) {
          vec3 col = vecShade(${base});
          ${VEC_SHADOW}                            // the sun's shadow darkens the flat tier…
          gl_FragColor = vec4(col + ${glowExpr}, diffuseColor.a);  // …but the night glow stays lit
        }`)));
    if (hasGlow) {                                  // lit path: feed Three's emissive accumulator
      frag = frag.replace('#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\n  totalEmissiveRadiance += ${glowExpr};`);
    }
    shader.fragmentShader = frag;
  };
  return material;
}

/* ============================================================
   L80 BAKED VERTEX AO — seat objects on the ground (beauty-tier only, byte-identical on the stylized tiers).
   ------------------------------------------------------------
   An `aAo` vertex attribute (baked at build time: 0 = lit, higher = occluded — terrain valley folds, the base
   of a tree/rock) darkens the surface. It's gated by a SHARED `aoStrength` uniform the engine sets to 1 ONLY for
   the beauty scene render and 0 for the pixel/vector/toon scene render — the same per-tier-uniform pattern as
   `vectorOn`. At strength 0 the multiply is `rgb *= (1.0 - x*0.0) = rgb * 1.0`, a BIT-EXACT no-op → the stylized
   tiers stay byte-identical. A geometry WITHOUT `aAo` reads the attribute as 0 → also a no-op, so this is safe to
   attach to any standard material. C++: bake the expensive ambient-occlusion integral into a const vertex
   attribute the shader reads for free (the same "bake, don't compute" thesis as the sky-IBL). */
export const aoStrength = { value: 0.0 };   // shared tier gate: 1 on the beauty scene render, 0 on pixel/vector/toon

/* ============================================================
   L94 AMBIENT VERTEX SWAY — the cheap "alive" win (scatter foliage breathes in the wind).
   ------------------------------------------------------------
   A drift added to `transformed` in the VERTEX stage (per-vertex, on the GPU, zero CPU — like perturbing a
   position in a vertex kernel by sin(time+phase)). HEIGHT-WEIGHTED by the object-space y: a vertex at y=0
   (a trunk base, a rock's footing) gets ZERO sway → planted; the canopy at y≈0.9 gets the full drift → it
   breathes. One term handles every prop correctly — trees sway from the top, tufts flutter, rocks (max y≈0.18)
   barely move. A per-instance PHASE derived from the instance's world offset means the forest doesn't sway in
   unison. OPT-IN (scatter passes `{sway:true}`); terrain attaches the SAME AO helper WITHOUT it, so the ground
   never wobbles. Amplitude rides a shared `swayWind` uniform (a calm base breeze + a weather boost). This runs
   on ALL tiers (the vertex stage is before the per-tier fragment branch) — foliage breathes in pixel/toon too.
   ============================================================ */
export const swayTime = { value: 0.0 };     // elapsed seconds (the breeze clock)
export const swayWind = { value: 0.0 };     // amplitude: base breeze + weather; 0 → bit-exact no sway

export function attachVertexAO(material, { sway = false } = {}) {
  // distinct cache key so Three doesn't share a plain-MeshStandard program (which lacks the AO/sway splice).
  material.customProgramCacheKey = () => (sway ? 'lgr-ao-sway' : 'lgr-ao');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uAoStrength = aoStrength;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aAo;\nvarying float vAo;'
        + (sway ? '\nuniform float uSwayTime;\nuniform float uSwayWind;' : ''))
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vAo = aAo;'
        + (sway ? [
            '',
            '  // L94 sway: height-weighted drift; instanceMatrix[3].xz = the instance world offset → per-tree phase.',
            '  #ifdef USE_INSTANCING',
            '    float swPh = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.6;',
            '  #else',
            '    float swPh = 0.0;',
            '  #endif',
            '  float swAmp = max(transformed.y, 0.0) * uSwayWind;',
            '  transformed.x += sin(uSwayTime * 1.6 + swPh) * swAmp;',
            '  transformed.z += sin(uSwayTime * 1.2 + swPh * 1.3) * swAmp * 0.7;',
          ].join('\n') : ''));
    if (sway) { shader.uniforms.uSwayTime = swayTime; shader.uniforms.uSwayWind = swayWind; }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vAo;\nuniform float uAoStrength;')
      // AFTER tonemap/colorspace (dithering is the last standard chunk) so the darken lands on the final colour.
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n  gl_FragColor.rgb *= (1.0 - clamp(vAo, 0.0, 1.0) * uAoStrength);');
  };
  return material;
}
