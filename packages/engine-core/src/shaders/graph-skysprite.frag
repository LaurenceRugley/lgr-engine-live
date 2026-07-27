// graph-skysprite.frag -- VIZ SLICE 16 (PIXEL WONDER): the four sky-sprite kinds, one branch each.
// Everything is additive over the near-black sky and drawn BEHIND the graph; colors are authored to
// land on DB32 swatches so the quantizer crisps these into pixel art instead of mushing them (the
// slice-15/16 palette discipline).
//
//   PLANET (kind 0)  an SDF disc with a day side (fake light upper-left), 3 crater blotches, a thin
//                    elliptical RING drawn with the two-arc trick -- the far arc (behind the planet)
//                    only survives OUTSIDE the disc, the near arc always -- and a 1-2 step aura.
//   MOON (kind 1)    a plain shaded disc. One pebble; deliberately boring next to the planet.
//   SPARKLE (kind 2) the pixel-art star: a hard 4-point cross that twinkles on whatever clock the
//                    consumer feeds uTime (the pixel look feeds its 10fps-quantized tick). uTwinkle=0
//                    freezes it lit (reduced motion).
//   GALAXY (kind 3)  a tilted elliptical smudge with a hot core and a two-arm spiral modulation
//                    (cos(2*theta - log(r)*k) is the whole trick -- a logarithmic spiral in one term).

precision highp float;

uniform float uTime;
uniform float uTwinkle;    // sparkle amplitude; 0 = static (reduced motion)
uniform float uIntensity;

varying vec2  vC;
varying float vKind;
varying vec3  vTint;
varying float vPhase;

void main() {
  vec2 c = vC * 2.0;               // -1..1 across the sprite
  float r = length(c);
  vec3 col = vec3(0.0);

  if (vKind < 0.5) {
    // ---- PLANET ----
    float disc = 1.0 - smoothstep(0.50, 0.53, r);
    float cr = exp(-dot(c - vec2(-0.13, 0.09), c - vec2(-0.13, 0.09)) * 55.0)
             + exp(-dot(c - vec2(0.17, -0.04), c - vec2(0.17, -0.04)) * 85.0)
             + exp(-dot(c - vec2(0.01, -0.24), c - vec2(0.01, -0.24)) * 110.0);
    float shade = clamp(0.60 + 0.55 * dot(vec2(-0.55, 0.835), c) - cr * 0.45, 0.0, 1.0);
    vec3 discCol = mix(vec3(0.188, 0.376, 0.510), vTint, shade);           // #306082 shadow -> tinted day side
    // ring frame: tilted ~28 degrees, squashed to an ellipse
    vec2 q = vec2(c.x * 0.883 - c.y * 0.469, c.x * 0.469 + c.y * 0.883);
    float er = length(vec2(q.x / 0.94, q.y / 0.28));
    float ring = 1.0 - smoothstep(0.06, 0.13, abs(er - 1.0));
    float ringVis = ring * (q.y > 0.0 ? 1.0 : step(0.53, r));              // the two-arc trick
    // ROUND-2: the full-quad aura quantized into a solid pale disc the size of the whole sprite.
    // Cage it: a tight 1-2 step halo hugging the limb, gone by r ~ 0.8.
    float aura = exp(-max(r - 0.53, 0.0) * 22.0) * 0.14 * step(0.5, r) * (1.0 - smoothstep(0.72, 0.85, r));
    col = discCol * disc + vec3(0.796, 0.859, 0.988) * ringVis * 0.8 + vTint * aura;
  } else if (vKind < 1.5) {
    // ---- MOON ----
    float disc = 1.0 - smoothstep(0.44, 0.50, r);
    float shade = clamp(0.55 + 0.5 * dot(vec2(-0.55, 0.835), c), 0.0, 1.0);
    col = mix(vec3(0.416, 0.416, 0.416), vTint, shade) * disc;             // #696a6a shadow -> tinted
  } else if (vKind < 2.5) {
    // ---- SPARKLE ----
    vec2 a = abs(c);
    float arm = max(step(a.x, 0.11) * (1.0 - smoothstep(0.45, 0.95, a.y)),
                    step(a.y, 0.11) * (1.0 - smoothstep(0.45, 0.95, a.x)));
    float core = 1.0 - smoothstep(0.10, 0.22, r);
    float w = uTime * (1.4 + vPhase * 1.3) + vPhase * 6.28318;
    float tw = 1.0 + uTwinkle * 0.5 * (sin(w) + sin(w * 1.618 + vPhase * 4.0));
    col = vTint * (arm * 0.85 + core) * clamp(tw, 0.15, 2.0);
  } else {
    // ---- GALAXY ----
    float e = length(vec2(c.x, c.y * 2.6));                                 // tilt is baked into aCorner
    float body = exp(-e * e * 2.4);
    float theta = atan(c.y * 2.6, c.x);
    float arms = 0.5 + 0.5 * cos(theta * 2.0 - log(max(e, 0.05)) * 3.5 + vPhase * 6.28318);
    float core = exp(-e * e * 28.0);
    col = vTint * body * (0.35 + 0.65 * arms * smoothstep(0.10, 0.45, e)) * 0.7
        + mix(vTint, vec3(1.0), 0.55) * core;
  }

  gl_FragColor = vec4(col * uIntensity, 1.0);   // additive: color IS the emission
}
