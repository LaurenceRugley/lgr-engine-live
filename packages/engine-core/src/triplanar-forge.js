/* ============================================================
   @lgr/engine-core — triplanar-forge.js (ARC A-AERIAL, 2026-08-13): TEXTURED GEOMETRY WITHOUT UVs.
   ------------------------------------------------------------
   WHAT THIS IS. A `MeshStandardMaterial` that samples a FORGE-BAKED map set by WORLD POSITION —
   three axis projections blended by the surface normal — instead of by the mesh's UVs. It is the
   `triplanarForge` variant `docs/design/research-aaa-environments.md` §3 names as item 3 of its
   top-5, and it is the piece that closes "flat-coloured boxes → textured" for a city with ZERO
   texture downloads: the pixels come from `createTextureForge`, which bakes them on the GPU at boot.

   WHY UVs CANNOT DO THIS JOB HERE, stated as the measured constraint it is rather than as a
   preference. `createBoxArena` renders an entire skyline — towers, setbacks, cornices, roof plant,
   spires, skybridges — as ONE InstancedMesh of ONE unit `BoxGeometry`. A unit cube's UVs run 0..1 on
   every face, so a single `map` would stretch one whole tile across a 0.22 u cornice AND across a
   10 u tower face: the texel density would vary by a factor of fifty inside the same draw call, and
   the storey lines `forge-facade.frag` draws would be a different height on every building. There is
   no per-instance UV transform in that setup — instancing supplies a matrix and a colour, not a UV
   scale — so the alternatives were "one mesh per size class" (hundreds of draw calls, which is the
   regression this repo's whole city budget exists to prevent) or "no texture". Triplanar is the
   third answer: the texture coordinate is the WORLD point, so texel density is a property of the
   world and not of the mesh, and the draw-call count does not move at all.
     (Refs the research doc cites: Catlike Coding, Martin Palko and Ronja all describe the same
     three-projection blend; the novelty here is only that the maps are forge-baked, not downloaded.)

   THE BLEND, in one line: weights = normalize(pow(abs(worldNormal), sharpness)), and the X and Z
   projections read the SIDE set while the Y projection reads the TOP set. That second half is a
   biome splat with one axis instead of a biome buffer — a box's up-facing faces are ROOFS and its
   side faces are WALLS, which is the city's own material split, free, from geometry it already has.

   THE DETAIL OCTAVE (research doc §3 gap 3: "a single 6 m forge tile is soft up close"). A second,
   much higher-frequency read of one map, applied as a LUMINANCE contrast around 1.0 and faded out
   by camera distance so it costs nothing where it would only alias. Luminance and not colour, so it
   adds surface without shifting the palette the art direction picked.

   WHAT THIS DELIBERATELY DOES NOT DO: NORMAL MAPPING. `MeshStandardMaterial`'s normal map needs a
   tangent frame, and with no `map` UV to differentiate, three's derivative-based frame is undefined —
   a triplanar normal map needs a hand-rolled whiteout blend of three tangent-space normals, which is
   a shader arc of its own and would owe its own set of numbers. The ORM map's roughness / metalness /
   AO channels ARE sampled triplanarly, so the surface still varies in gloss and occlusion; only the
   per-texel slope is missing. Named here so the next person finds the decision instead of the gap.
   (`relief` in the recipes still shapes the ALBEDO and the ORM, which is where most of the close-up
   read comes from at this camera scale.)

   THE FALLBACK IS THE CURRENT LOOK, EXACTLY. `createTextureForge` returns `supported:false` on a GPU
   with no high-precision fragment float (iOS p0), and `bake()` returns null there. Hand this factory
   a null set and it returns a plain flat `MeshStandardMaterial` in `fallbackColor` — i.e. what the
   consumer renders today. Same discipline as `forge.makeMaterial`: the ability degrades to the
   status quo, it never degrades to broken.

   INSTANCE TINT SURVIVES. `<color_fragment>` multiplies `diffuseColor` by `vColor` AFTER
   `<map_fragment>`, and three defines `USE_COLOR` in the FRAGMENT stage for an InstancedMesh with an
   `instanceColor` attribute (WebGLProgram.js: `parameters.vertexColors || parameters.instancingColor`)
   — so `createBoxArena`'s height ramp composes ON TOP of the texture rather than being replaced by
   it. That is the same composition rule `applyForgeMaps` follows in citygen.

   OPT-IN, AND THEREFORE AN EXACT NO-OP FOR EVERY EXISTING CONSUMER: this is a new module that
   constructs a new material. Nothing that does not call it changes by one byte — which is what keeps
   `npm run tier-guard`'s byte-identical stylized baselines valid.

   C++ anchor: `onBeforeCompile` is a preprocessor hook — three concatenates named `#include` chunks
   into one program string and we string-replace chunk boundaries before the driver compiles, exactly
   like expanding a macro over someone else's source. `customProgramCacheKey` is the ODR key: without
   it two differently-patched materials would share one compiled program.

   CONTRACT
   --------
   createTriplanarForgeMaterial({
     side,          // a createTextureForge.bake() set for WALLS (null => the flat fallback)
     top,           // ditto for ROOFS / up-facing faces; defaults to `side`
     scale,         // TILES PER WORLD UNIT on the side projections (1/scale u per tile)
     topScale,      // ditto for the top projection; defaults to `scale`
     sharpness,     // triplanar blend exponent; higher = harder transitions at the edges
     detail,        // { set, scale, amount, near, far } — the high-frequency octave (null = none)
     aoIntensity,   // the baked ORM red channel's bite on indirect light (three's aoMapIntensity, ours)
     fallbackColor, // used when `side` is null
     ...matOpts     // anything MeshStandardMaterial takes (roughness, metalness, flatShading, …)
   }) -> THREE.MeshStandardMaterial
   ============================================================ */
import * as THREE from 'three';

/* The injected library. `vLgrPos`/`vLgrNrm` are the WORLD-SPACE position and normal of the fragment;
   both halves are declared from one string each so the vertex and fragment stages cannot drift. */
const PARS_VERT = `
varying vec3 vLgrPos;
varying vec3 vLgrNrm;
`;

/* WHY THE WORLD TRANSFORM IS RE-DERIVED HERE rather than read off `worldPosition`: three's
   `<worldpos_vertex>` chunk is wrapped in `#if defined(USE_ENVMAP) || defined(USE_SHADOWMAP) || …`,
   so whether that variable exists depends on lights and environment the material does not control.
   A texture coordinate that appears and disappears with the lighting rig is not a texture coordinate.
   INSTANCING IS HANDLED EXPLICITLY: `transformed` is object space, and for an InstancedMesh the
   instance matrix is what puts the box in the world — miss it and every instance samples the same
   corner of the texture. The normal goes through `mat3(instanceMatrix)` rather than its inverse
   transpose; for the axis-aligned, axis-scaled boxes this exists to texture, that is exact after the
   normalize (a non-uniform scale on a ROTATED mesh would skew it and the blend weights would be
   slightly wrong — noted, not fixed, because nothing in this engine feeds it one). */
const MAIN_VERT = `
  vec4 lgrWP = vec4( transformed, 1.0 );
  vec3 lgrON = objectNormal;
  #ifdef USE_INSTANCING
    lgrWP = instanceMatrix * lgrWP;
    lgrON = mat3( instanceMatrix ) * lgrON;
  #endif
  vLgrPos = ( modelMatrix * lgrWP ).xyz;
  vLgrNrm = normalize( mat3( modelMatrix ) * lgrON );
`;

const PARS_FRAG = `
varying vec3 vLgrPos;
varying vec3 vLgrNrm;
uniform sampler2D uLgrSideMap;
uniform sampler2D uLgrTopMap;
uniform sampler2D uLgrSideORM;
uniform sampler2D uLgrTopORM;
uniform float uLgrScale;
uniform float uLgrTopScale;
uniform float uLgrSharp;
uniform sampler2D uLgrDetMap;
uniform float uLgrDetScale;
uniform float uLgrDetAmt;
uniform float uLgrDetNear;
uniform float uLgrDetFar;
uniform float uLgrAOInt;

vec3 lgrWeights() {
  vec3 n = abs( normalize( vLgrNrm ) );
  n = pow( n, vec3( uLgrSharp ) );
  return n / max( 1e-4, n.x + n.y + n.z );
}
/* THE THREE PROJECTIONS. X reads the ZY plane, Y the XZ plane, Z the XY plane — the standard
   assignment, so a wall's texture runs UP the wall whichever way the wall faces. */
vec4 lgrTri( sampler2D side, sampler2D top, vec3 w ) {
  return texture2D( side, vLgrPos.zy * uLgrScale ) * w.x
       + texture2D( top,  vLgrPos.xz * uLgrTopScale ) * w.y
       + texture2D( side, vLgrPos.xy * uLgrScale ) * w.z;
}
/* THE DETAIL OCTAVE, as a luminance contrast around 1.0 (see the header). The distance fade makes
   the early-out below coherent across most of a warp, and costs nothing on the far half of the frame
   — where the octave would be sub-texel aliasing anyway. */
float lgrDetail( vec3 w ) {
  if ( uLgrDetAmt <= 0.0 ) return 1.0;
  float fade = 1.0 - smoothstep( uLgrDetNear, uLgrDetFar, distance( vLgrPos, cameraPosition ) );
  if ( fade <= 0.0 ) return 1.0;
  vec3 d = texture2D( uLgrDetMap, vLgrPos.zy * uLgrDetScale ).rgb * w.x
         + texture2D( uLgrDetMap, vLgrPos.xz * uLgrDetScale ).rgb * w.y
         + texture2D( uLgrDetMap, vLgrPos.xy * uLgrDetScale ).rgb * w.z;
  float l = dot( d, vec3( 0.299, 0.587, 0.114 ) );
  return 1.0 + ( l - 0.5 ) * 2.0 * uLgrDetAmt * fade;
}
`;

export function createTriplanarForgeMaterial({
  side = null,
  top = null,
  scale = 0.4,
  topScale = null,
  sharpness = 4.0,
  detail = null,
  aoIntensity = 1.0,       // how hard the baked AO channel bites the indirect term
  fallbackColor = 0x808080,
  ...matOpts
} = {}) {
  /* THE FALLBACK PATH — no baked set (iOS p0, or a project's `?forge=0` A/B arm) means the exact
     flat material the consumer renders today. No patch, no uniforms, no new program. */
  if (!side || !side.map) {
    return new THREE.MeshStandardMaterial({ color: fallbackColor, ...matOpts });
  }
  const topSet = top && top.map ? top : side;
  const tScale = topScale != null ? topScale : scale;
  const det = detail && detail.set && detail.set.map ? {
    set: detail.set,
    scale: detail.scale != null ? detail.scale : scale * 6,
    amount: detail.amount != null ? detail.amount : 0.35,
    near: detail.near != null ? detail.near : 3,
    far: detail.far != null ? detail.far : 14,
  } : null;

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, ...matOpts });

  // one uniform set, created once — no per-frame allocation (the ground-macro precedent).
  const u = {
    uLgrSideMap: { value: side.map },
    uLgrTopMap: { value: topSet.map },
    uLgrSideORM: { value: side.ormMap },
    uLgrTopORM: { value: topSet.ormMap },
    uLgrScale: { value: scale },
    uLgrTopScale: { value: tScale },
    uLgrSharp: { value: sharpness },
    uLgrDetMap: { value: det ? det.set.map : side.map },
    uLgrDetScale: { value: det ? det.scale : 1 },
    uLgrDetAmt: { value: det ? det.amount : 0 },
    uLgrDetNear: { value: det ? det.near : 0 },
    uLgrDetFar: { value: det ? det.far : 1 },
    uLgrAOInt: { value: aoIntensity },
  };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${PARS_VERT}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${MAIN_VERT}`);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS_FRAG}`)
      /* ALBEDO + the shared weights and ORM read. `lgrW` / `lgrORM` are declared here and consumed by
         the roughness/metalness/AO replacements further down the SAME main() — one triplanar fetch of
         each map per fragment, not one per channel. */
      .replace('#include <map_fragment>', `
  vec3 lgrW = lgrWeights();
  vec4 lgrAlb = lgrTri( uLgrSideMap, uLgrTopMap, lgrW );
  vec4 lgrORM = lgrTri( uLgrSideORM, uLgrTopORM, lgrW );
  diffuseColor.rgb *= lgrAlb.rgb * lgrDetail( lgrW );
`)
      .replace('#include <roughnessmap_fragment>', '  float roughnessFactor = roughness * lgrORM.g;')
      .replace('#include <metalnessmap_fragment>', '  float metalnessFactor = metalness * lgrORM.b;')
      /* AO ON THE INDIRECT TERM ONLY — the same rule three's own chunk follows, minus the clearcoat
         and sheen branches this material never enables.
         `uLgrAOInt` AND NOT `aoMapIntensity`, and this cost a shader-compile red before it was
         obvious: three declares `uniform float aoMapIntensity` inside `<aomap_pars_fragment>`, which
         is itself wrapped in `#ifdef USE_AOMAP` — and this material deliberately sets NO standard map
         slots, so that define never exists and the identifier is undeclared at link time. A patch
         that borrows a name from a chunk it also replaced is borrowing from a chunk that compiled
         itself out. Own uniform, own lifetime. */
      .replace('#include <aomap_fragment>', `
  float lgrAO = ( lgrORM.r - 1.0 ) * uLgrAOInt + 1.0;
  reflectedLight.indirectDiffuse *= lgrAO;
`);
  };
  /* WITHOUT THIS, two triplanar materials with different scales share one compiled program and the
     second silently renders with the first's uniforms — three keys its shader cache on the material
     TYPE plus this string. */
  mat.customProgramCacheKey = () => `lgr-triplanar|${scale}|${tScale}|${sharpness}|${det ? `${det.scale}:${det.amount}:${det.near}:${det.far}` : 'nodetail'}`;
  mat.userData.triplanar = { scale, topScale: tScale, sharpness, detail: det, uniforms: u };
  return mat;
}

/* ---- THE TILE-SCALE DERIVATION, exported and node-testable, because "how many tiles per world unit"
   is the one number that decides whether a forge recipe reads as its own subject or as noise, and it
   is the one everybody gets upside down.
   A recipe states `worldSize` in METRES (forge-recipes.js's own convention: "how many world metres the
   tile covers"). A world states its own METRES PER UNIT — this repo's city is ~6 m/u, its own figure,
   recorded in the swing ledger. So tiles per unit = metresPerUnit / worldSize, and a caller that
   passes both numbers cannot get the conversion backwards.
   `tilesPerTile` is the deliberate art override: the facade recipe draws FIVE storeys per tile, so a
   consumer that wants a storey to be a specific height scales the whole tile rather than re-baking.
   The forge's exported Nyquist floor guards the OTHER end (texels per feature); this guards the
   mapping of a baked tile onto a world. Two different mistakes, two different guards. */
export function tilesPerUnit({ worldSize, metresPerUnit = 1, tilesPerTile = 1 } = {}) {
  if (!(worldSize > 0)) throw new Error('tilesPerUnit: worldSize must be > 0');
  return (metresPerUnit / worldSize) * tilesPerTile;
}
