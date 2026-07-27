/* ============================================================
   silk.vert — Dusk Silk hero scene (K1) + Lesson SHADOWS (self-shadow receive).
   Vertex displacement for a flowing silk/wave surface.
   ------------------------------------------------------------
   The displacement now lives in the SHARED include silk-displace.glsl so the shadow-cast
   depth pass (silk-depth.vert) displaces the wave IDENTICALLY — see that file's header.

   SHADOW RECEIVE (Lesson SHADOWS): to sample the shadow map in the fragment shader, three
   needs the per-light shadow COORDINATE computed here — the surface point projected into the
   sun's shadow-camera clip space. Three's own chunks do exactly that, so we include them
   rather than hand-roll the projection:
     • <shadowmap_pars_vertex> declares 'directionalShadowMatrix[]' + the 'vDirectionalShadowCoord[]'
       varying (guarded by USE_SHADOWMAP / NUM_DIR_LIGHT_SHADOWS, which three #defines when the
       material has 'lights:true' and a shadow-casting DirectionalLight is in the scene).
     • <shadowmap_vertex> fills that varying: 'vDirectionalShadowCoord[i] = directionalShadowMatrix[i] * worldPosition'.
   The chunk reads two things we must provide: a 'worldPosition' (vec4) — computed from the DISPLACED
   position, not the flat plane, or the shadow lookup uses the wrong point — and (because three DOES
   define HAS_NORMAL here) a 'transformedNormal', used to offset the occlusion query along the world
   normal by 'shadowNormalBias'. Our normalBias is 0 (set in createShadowRig), so that offset is a
   no-op and the plane's up-normal is a fine stand-in; we lean on the ordinary depth 'bias' instead —
   the acne↔peter-panning tradeoff the frag header teaches. ('normal' + 'normalMatrix' are auto-
   injected by three, like 'position'.)

   '#include <chunk>' (angle brackets) is left untouched by vite-plugin-glsl and resolved by
   three at runtime; a QUOTED hash-include of a .glsl file is inlined at build. Both coexist.

   HOUSE CONVENTION (ShaderMaterial): Three auto-injects position, uv, projectionMatrix,
   modelViewMatrix, modelMatrix, and the default precision. Declaring them here is a
   REDEFINITION compile error → black canvas. We declare ONLY our own uniforms/varyings.
   ============================================================ */
#include <common>
#include <shadowmap_pars_vertex>

uniform float uTime;

varying vec2 vUv;
varying float vDisplacement;

#include './silk-displace.glsl';

void main() {
  vUv = uv;

  /* The wave height — shared with the depth pass so the cast shadow matches the surface. */
  float disp = silkDisplacement(position, uTime);
  vDisplacement = disp;

  /* 'transformed' is the displaced object-space position — the single point everything below
     (clip position, world position for the shadow coord) is derived from. */
  vec3 transformed = position;
  transformed.y += disp;

  /* World position of the DISPLACED point — three's shadow chunk projects THIS into the sun's
     shadow camera. Deriving it from the flat plane instead would make the shadow swim. */
  vec4 worldPosition = modelMatrix * vec4(transformed, 1.0);

  vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
  gl_Position = projectionMatrix * mvPosition;

  /* transformedNormal — required by <shadowmap_vertex> under HAS_NORMAL (which three defines for
     this material). The plane's up-normal is a fine stand-in: normalBias is 0, so this only has to
     exist, not be exact. 'normal'/'normalMatrix' are three-injected. */
  vec3 transformedNormal = normalMatrix * normal;

  #include <shadowmap_vertex>
}
