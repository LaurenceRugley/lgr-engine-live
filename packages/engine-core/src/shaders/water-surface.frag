/* ============================================================
   water-surface.frag — FRAGMENT shader: the water now REFRACTS (Lesson 05).
   ------------------------------------------------------------
   Lesson 04 lit the water in world space (the normal-matrix lesson — still here,
   we need the normal). Lesson 05 makes the water bend what's behind it.

   THE GRAB PASS. Real refraction (light bending as it crosses into a denser
   medium) is governed by SNELL'S LAW: n1·sinθ1 = n2·sinθ2. Doing that per-pixel
   against arbitrary geometry is expensive, so production fakes it with a "grab
   pass": first render everything BEHIND the water into a texture (uScene), then
   when drawing the water, sample that texture at the pixel's own screen position
   NUDGED by the surface tilt. Where the water slopes, the background shifts — and
   your eye reads that shift as refraction. It isn't physically correct, but it
   looks right and costs one texture read. That trade is why everyone uses it.

   The nudge is the surface normal in VIEW space (so the offset is screen-aligned):
   a crest tilting "left" pulls the background sample left. Sampling the three
   colour channels at slightly different offsets gives CHROMATIC ABERRATION — the
   faint red/blue fringing real lenses and water show at ripple edges.
   ============================================================ */
precision highp float;

uniform sampler2D uHeight;       // height texture (for the normal)
uniform sampler2D uScene;        // the GRAB PASS: everything behind the water
uniform vec2  uTexel;            // 1.0/sim-resolution — step to a neighbour texel
uniform vec2  uResolution;       // canvas size in pixels (for screen-space UV)
uniform float uNormalStrength;   // amplifies tiny slopes so the effect reads
uniform float uRefractStrength;  // how far the background shifts under a slope
uniform float uChromaScale;      // L09: scales the refraction colour-split. 1 = full;
                                 // main.js drops it (~0.5) in toon mode, where the
                                 // rainbow fringe reads loud against flat cel bands.
uniform mat3  uNormalMatrix;     // OBJECT→WORLD normal transform (Lesson 04)
uniform vec3  uLightDir;         // world-space direction toward the key light
uniform vec3  uInk;              // Deep Ink  #2A2218 — water tint
uniform vec3  uGold;             // Atelier Gold #B89968 — sheen / glints
uniform float uSkyRefl;          // L108: beauty-only sky-reflection amount (0 on pixel/toon → the mix is a no-op)
uniform vec3  uSkyReflCol;       // L108: the SunRig sky colour the sea reflects (by-ref → tracks day/night)
uniform sampler2D uReflect;      // L108 planar mirror: the mirrored skyline rendered to a half-res RT
uniform float uReflStrength;     // L108: THE mirror gate — beauty?1:0 AND governor-shed → 0 = no-op (byte-identical) + the shipped sky-tint fallback below runs instead
uniform float uReflDistortMul;   // L108: how much the sim-normal tilt wobbles the reflection sample (reuses the refraction `off`, so they ripple coherently)
uniform float uFoamStrength;     // L112: THE foam/shoreline gate — 0 on pixel/toon → the whole term is a no-op → byte-identical
uniform float uTime;             // L112: churn + lapping animation clock
uniform sampler2D uGrabDepth;    // L112: the grab pass's depth (what's behind the water) → shoreline thinness + depth tint
uniform float uNear;             // L112: active render camera near/far (linearize the grab depth — copied from the post-toon pattern)
uniform float uFar;
uniform float uIsPerspective;    // 1 = perspective, 0 = ortho
uniform float uGlintK;           // L112: THE sun-glint gate — beauty ? lowSunWashK : 0 → 0 on pixel/toon (no-op → byte-identical) AND ~0 at dawn/noon → the glitter path peaks at golden hour
uniform vec3  uSunCol;           // L112: the SunRig sun colour (by-ref → tracks day/night) — the sea catches the sun's actual hue, not just gold

// L11 Part B — the FLAT-VECTOR water preset. When uVector is on we abandon refraction and
// paint perfectly flat saturated cyan (the Coffee Inc 2 water), keeping ONLY a thin light
// crest where the height field tilts — so ripples still appear when you poke the water, a
// delight the static reference can't do. uVecTint carries the mild SunRig day/night shift.
uniform float uVector;
uniform vec3  uVecWater;         // flat cyan
uniform vec3  uVecTint;          // mild day/night multiplier (shared, by ref)

varying vec2 vUv;
varying vec3 vWorldPos;

// L112: raw window-space depth (0..1) → view-space distance (world units) — copied from the post-toon
// linearizer (GLSL has no cross-file symbols). Used to measure how THIN the water is against the shore.
float lin(float d) {
  if (uIsPerspective > 0.5) { float z = d * 2.0 - 1.0; return (2.0 * uNear * uFar) / (uFar + uNear - z * (uFar - uNear)); }
  return uNear + d * (uFar - uNear);   // ortho depth is already linear
}
// L112: a cheap hash for foam churn breakup (the post-filmic grain idiom, copied — no cross-file symbols).
float hash21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }

void main() {
  // --- surface normal from the height gradient (object → world, Lesson 04) ---
  float hL = texture2D(uHeight, vUv - vec2(uTexel.x, 0.0)).r;
  float hR = texture2D(uHeight, vUv + vec2(uTexel.x, 0.0)).r;
  float hD = texture2D(uHeight, vUv - vec2(0.0, uTexel.y)).r;
  float hU = texture2D(uHeight, vUv + vec2(0.0, uTexel.y)).r;
  vec3 nObject = normalize(vec3((hL - hR) * uNormalStrength,
                                (hD - hU) * uNormalStrength, 1.0));
  vec3 N = normalize(uNormalMatrix * nObject);          // world-space normal
  vec3 V = normalize(cameraPosition - vWorldPos);       // toward camera (world)

  // --- the grab-pass refraction ---
  // This fragment's own position on screen, 0..1.
  vec2 screenUV = gl_FragCoord.xy / uResolution;
  // Offset direction = the normal in VIEW space (screen-aligned). viewMatrix is
  // injected by three.js; w=0 so we rotate the normal without translating it.
  vec2 tilt = (viewMatrix * vec4(N, 0.0)).xy;
  vec2 off  = tilt * uRefractStrength;
  // Chromatic aberration: red pushed a hair further than blue. uChromaScale lerps
  // the R/B split toward 1.0 (no split) so we can dial the fringe down per style.
  float caR = mix(1.0, 1.08, uChromaScale);
  float caB = mix(1.0, 0.92, uChromaScale);
  vec3 refr;
  refr.r = texture2D(uScene, screenUV + off * caR).r;
  refr.g = texture2D(uScene, screenUV + off      ).g;
  refr.b = texture2D(uScene, screenUV + off * caB).b;

  // --- compose: refracted background, water tint, Fresnel sheen, glints ---
  float fres = pow(1.0 - max(dot(N, V), 0.0), 3.0);     // grazing angles → more sheen

  // FLAT-VECTOR water: flat cyan + interaction-only crests + a thin light shoreline rim.
  if (uVector > 0.5) {
    float flatness = clamp(N.y, 0.0, 1.0);              // 1 = still; < 1 where a ripple tilts
    float crest    = pow(1.0 - flatness, 1.3);          // catch a highlight on ripple slopes
    vec3  wcol = mix(uVecWater, uVecWater * 1.2 + 0.08, crest);
    wcol = mix(wcol, vec3(0.86, 0.96, 1.0), fres * 0.22); // soft light rim at grazing angles
    gl_FragColor = vec4(wcol * uVecTint, 1.0);
    return;
  }

  vec3  L    = normalize(uLightDir);
  vec3  H    = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 60.0);          // tight specular glints

  // L112 DEPTH-TINT absorption (item f, rides the foam gate): thin water = turquoise, deep = ink. Gated so stylized
  // keeps EXACTLY 0.12 (no depth sample taken there → byte-identical + cheaper).
  float absorb = 0.12;
  float waterThick = 0.0;
  if (uFoamStrength > 0.0) {
    float sceneEye = lin(texture2D(uGrabDepth, screenUV).x);   // distance to what's BEHIND the water
    float fragEye  = lin(gl_FragCoord.z);                      // this water fragment's own distance
    waterThick = sceneEye - fragEye;                           // how much water is in front of the background
    absorb = mix(0.06, 0.30, smoothstep(0.0, 1.2, waterThick));// shallow → deep
  }
  vec3 col = mix(refr, uInk, absorb);                    // water absorption (0.12 flat on stylized, depth-varying on beauty)
  col = mix(col, uGold, fres * 0.28);                    // gold reflective sheen at grazing
  col += uGold * spec * 0.8;                             // crest glints

  // L112 SUN GLINT — the studio glitter path. Beauty-only (uGlintK=0 on pixel/toon → this whole block is a no-op →
  // byte-identical; the gold spec above is UNTOUCHED so stylized keeps its exact crest glints). uGlintK also carries
  // the lowSunWashK weight, so the glitter blooms at the golden-hour open and fades at noon (an overhead sun gives
  // broad glare, not a long sparkle path). TWO lobes tinted by the sun's ACTUAL colour (uSunCol, by-ref):
  //   • the broad pow-60 sheen re-tinted sun-coloured (the existing gold spec stays for stylized; this adds the hue);
  //   • a tight pow-600 SPARKLE whose half-vector is jittered by a time-animated hash so individual facets TWINKLE in
  //     and out — reuse the foam hash21 + uTime (Rule 6: GLSL has no cross-file symbols, so the hash was copied in).
  if (uGlintK > 0.0) {
    float tw    = hash21(floor(gl_FragCoord.xy * 0.5) + floor(uTime * 10.0));   // per-facet twinkle phase (0..1)
    vec3  Hs    = normalize(H + (tw - 0.5) * 0.05 * vec3(1.0, 0.0, 1.0));       // jittered micro-normal → half-vector
    float spark = pow(max(dot(N, Hs), 0.0), 600.0) * smoothstep(0.55, 0.95, tw); // only the lit facets flash this frame
    col += uSunCol * (spec * 0.6 + spark * 2.2) * uGlintK;
  }

  // L108 REFLECTION — reconciled so the two terms NEVER double-apply:
  //   • PLANAR MIRROR (uReflStrength>0, high-quality beauty): sample the mirrored skyline at the SAME screen-space
  //     coordinate the refraction uses (screenUV + off) so ripples wobble reflection + refraction COHERENTLY, and
  //     blend by the EXISTING fresnel (:95) — strong toward the horizon, weak looking straight down. This is the
  //     rich reflection; it already contains the sky, so the flat sky-tint below is skipped.
  //   • FALLBACK SKY-TINT (Lever 5, shipped): the cheap flat sky-COLOUR lift for when the mirror is OFF — stylized
  //     tiers (uReflStrength=0 AND uSkyRefl=0 → both branches no-op → byte-identical) and beauty frames where the
  //     governor SHED the mirror pass (uReflStrength=0 but uSkyRefl>0 → the sea still isn't pure-black looking down).
  if (uReflStrength > 0.0) {
    vec3 refl = texture2D(uReflect, screenUV + off * uReflDistortMul).rgb;
    col = mix(col, refl, uReflStrength * mix(0.04, 1.0, fres));
  } else {
    float sky = mix(0.10, 1.0, fres) * clamp(N.y, 0.0, 1.0);
    col = mix(col, uSkyReflCol, sky * uSkyRefl);
  }

  // L112 FOAM — crests (negative laplacian of the height field = the sim's OWN restoring stencil → peaks) + wake
  // shoulders (slope → the L26 V-wakes get their missing white) + a soft depth-faded SHORELINE band that laps.
  // All whitened into col, gated by uFoamStrength (0 on stylized → skipped → byte-identical; vector already returned).
  if (uFoamStrength > 0.0) {
    float lap   = (hL + hR + hD + hU) - 4.0 * texture2D(uHeight, vUv).r;   // curvature; crests = peaks = negative lap
    float crest = smoothstep(0.0015, 0.006, -lap);
    float slope = length(vec2(hL - hR, hD - hU)) * 8.0;                    // wake shoulders → foam streaks
    // shoreline band: foam only where the water is genuinely THIN against the geometry behind it (the island flank
    // rising to meet the surface → waterThick→0). Tight range (0.04–0.35) so the CITY's shallow flat seabed card
    // (~0.35 deep) reads as OPEN sea (thin→0), not a uniform foam wash — only the true waterline edge foams. World
    // mode's real bathymetry gives a wider natural band for free.
    float thin  = 1.0 - smoothstep(0.04, 0.35, waterThick);
    float lapPulse = 0.75 + 0.25 * sin(uTime * 0.9 + thin * 6.0);         // gentle lapping pulse
    float foam  = max(crest + 0.6 * slope, thin * lapPulse);
    foam *= 0.75 + 0.25 * hash21(vUv * 512.0 + uTime);                    // churn breakup
    col = mix(col, vec3(0.93, 0.95, 0.94), clamp(foam, 0.0, 1.0) * uFoamStrength);
  }

  gl_FragColor = vec4(col, 1.0);
}
