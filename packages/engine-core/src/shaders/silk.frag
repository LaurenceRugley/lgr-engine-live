/* ============================================================
   silk.frag — Dusk Silk hero scene (K1) + Lesson SHADOWS (self-shadow receive).
   Fragment shader: ink→gold→cream gradient from diagram-theme tokens, now DARKENED where the
   waves shadow themselves under a low raking sun.
   ------------------------------------------------------------
   Base colour is displacement-driven (unchanged): trough→ink, mid→gold, crest→cream, with an
   HDR brightness ramp so crests bloom.

   SELF-SHADOW (Lesson SHADOWS): 'getShadowMask()' returns 1.0 where the sun reaches this pixel
   and <1.0 where a higher part of the wave OCCLUDES the sun from it (a real cast shadow, sampled
   from the depth map three rendered from the sun's point of view). Under a low golden-hour sun,
   crests throw long shadows down their lee slopes and into the troughs — we simply MULTIPLY the
   base colour by that mask, so the occluded silk goes darker. Because the mask depends on the
   sun DIRECTION, the shadows move as the sun sweeps: a shadow is a TIME behaviour, not a texture.

   The mask's chunks (getShadowMask + getShadow + the shadow uniforms) come from three:
     • <shadowmap_pars_fragment>  — the sampler + getShadow() (PCF, since the engine sets
                                    shadowMap.type = PCFShadowMap → a hardware sampler2DShadow).
     • <shadowmask_pars_fragment> — getShadowMask(), which loops the directional shadows.
   getShadowMask() reads a 'receiveShadow' bool (declared in three's lights chunk, which a raw
   ShaderMaterial does not include) — so we declare it ourselves; three sets its value from
   mesh.receiveShadow each frame (WebGLRenderer).

   uShadow GATES the whole effect: at uShadow=0 the multiply is '* 1.0' (identity) and this is
   byte-for-byte the pre-shadows Dusk-Silk — shadows are strictly OPT-IN, and the shadow rig
   drives uShadow to 0 when the quality governor sheds shadows at low rungs.

   THE BIAS TRADEOFF (why a surface can shadow-ACNE or PETER-PAN):
     A shadow test compares "how far is this pixel from the sun" against "the nearest thing the
     sun's depth map recorded in this direction". Both are the SAME surface here (self-shadow),
     so depth-buffer precision makes a pixel occasionally test as just BEHIND itself → it shadows
     itself in a stipple of dark speckles (shadow ACNE). The cure is a 'bias': subtract a little
     depth before the compare. Too much bias and the shadow DETACHES from the caster — the wave's
     shadow starts a few millimetres away from the crest, so the object looks to float above its
     own shadow (PETER-PANNING). The right bias is the smallest that kills the acne. We tune it
     on the DirectionalLight in createShadowRig (shadow.bias), NOT here.
     C++ anchor: a depth-compare epsilon — the same fudge you add before an '<=' on floats that
     were computed two different ways.

   Colours are in linear sRGB for the HalfFloat beautyRT; crests exceed 1.0 → bloom; ACES in the
   filmic pass compresses without clipping.
   ============================================================ */
precision highp float;

#include <common>
#include <packing>

uniform bool receiveShadow;   // three sets this from mesh.receiveShadow (declared in three's
                              // lights chunk, which a raw ShaderMaterial doesn't pull in)
#include <shadowmap_pars_fragment>
#include <shadowmask_pars_fragment>

varying vec2 vUv;
varying float vDisplacement;

/* Dusk-harbor palette — linear sRGB. L-N re-skin: uniforms so a client build injects its own
   gradient without editing this shader; JS defaults them to the values below → byte-identical. */
uniform vec3 uInk;    /* trough — very dark warm near-black */
uniform vec3 uGold;   /* mid-wave — warm orange (dusk.sky linear) */
uniform vec3 uCream;  /* crest — warm cream (NEUTRAL.text linear) */

/* uShadow: self-shadow strength, 0..1. 0 = OFF and byte-identical to pre-shadows Dusk-Silk. */
uniform float uShadow;

/* uBrightness ramp — crests 2.4× to trigger bloom, troughs 0.6× to stay dark. */
const float BRIGHT_LOW  = 0.60;
const float BRIGHT_HIGH = 2.40;

void main() {
  /* Map raw displacement to [0,1] (range [-3,+3] covers >99% of wave values). */
  float t = clamp((vDisplacement + 3.0) / 6.0, 0.0, 1.0);

  /* Two-stop gradient: ink → gold → cream. */
  vec3 col;
  if (t < 0.5) {
    col = mix(uInk, uGold, t * 2.0);
  } else {
    col = mix(uGold, uCream, (t - 0.5) * 2.0);
  }

  /* HDR brightness ramp. */
  float brightness = mix(BRIGHT_LOW, BRIGHT_HIGH, t);
  col *= brightness;

  /* SELF-SHADOW: 1.0 lit, <1.0 where a crest occludes the sun. Gated by uShadow (0 → identity,
     so an un-shadowed build is unchanged). We darken toward, but not fully to, black — a real
     letterpress-flat 0 reads as a hole; 0.28 keeps a touch of ambient in the shade so the silk
     still reads as fabric in the troughs. */
  float sMask = getShadowMask();
  float shade = mix(1.0, mix(0.28, 1.0, sMask), uShadow);
  col *= shade;

  gl_FragColor = vec4(col, 1.0);
}
