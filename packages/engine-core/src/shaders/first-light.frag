/* ============================================================
   first-light.frag — Lesson AC: "the minute before sunrise." The ring's quiet, hopeful, cool-toned
   complement to Cathedral Light's warm dark.
   ------------------------------------------------------------
   Restraint is the whole aesthetic: a big pre-dawn sky is the subject, a low minimal hill SILHOUETTE sits on
   the horizon, and the atmospheric gradient does the work. One scalar — the sun's height — sweeps the mood on
   the canonical SunRig one-scalar-t pattern (docs day/night standard): it swells from deep blue hour up to a
   single gold bloom as the limb breaks, then recedes, seamlessly, forever. A dawn that keeps almost arriving.

   ── THE ONE SCALAR (sunH) ──
   phase = fract(uTime) loops 0..1; sunH = sin(phase*PI) shaped — it is 0 at BOTH ends of the loop (deep
   night) and peaks at the middle (gold), so the loop closes with no seam. Everything reads off sunH:
     • the sky gradient warms and lifts,
     • the sun disc rises through the horizon and blooms once,
     • stars fade as the sky brightens,
     • mist over the land thickens in the blue hour and burns to gold at the peak.
   No keyframe is astronomically literal — mood over astronomy, as briefed.

   ── COLOUR ──
   Output is LINEAR (the hero packs are tonemapped/graded by the shared post-filmic pass downstream). Palette
   is authored restrained: indigo/slate night → dusty rose → pale honey gold, saturation held until the limb
   breaks. The sun core is authored past 1.0 so the director's bloom (usesBloom) gives it its one soft flare.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uResolution;   // drawBuffer px — aspect for the star field / sun roundness
uniform float uSpeed;        // loop speed (small = slow; the whole scene is slow)
uniform float uHorizon;      // horizon height in uv (the hills sit here)
uniform vec3  uNightZenith;  // LINEAR — top of sky, deep night
uniform vec3  uNightHorizon; // LINEAR — horizon band, deep night
uniform vec3  uRose;         // LINEAR — the first warming
uniform vec3  uGold;         // LINEAR — the limb-break bloom colour
uniform vec3  uDayZenith;    // LINEAR — top of sky at the gold peak (kept cool for restraint)
uniform vec3  uLand;         // LINEAR — the hill silhouette (near-black, cool)
uniform float uStarBright;   // star-field intensity — a taste knob (createFirstLight starBrightness option)

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return v;
}

const float PI = 3.14159265;

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);

  /* THE SCALAR. sin(phase*PI) is 0 at phase 0 and 1 (seamless loop) and 1 at the middle. A gentle power
     shape holds the blue hour a touch longer and makes the gold peak brief — restraint. */
  float phase = fract(uTime * uSpeed);
  float sunH  = pow(sin(phase * PI), 2.2);           // 0 = blue hour, 1 = gold peak. The high power keeps the
                                                     // scene in cool blue hour MOST of the loop and makes the
                                                     // gold a brief climax — restraint (one moment of warmth).

  /* Mood terms derived from the one scalar. Warmth kicks in LATE (only as the limb nears breaking). */
  float warm  = smoothstep(0.34, 0.95, sunH);        // 0 cool blue hour → 1 gold
  float rise  = smoothstep(0.16, 0.62, sunH);        // horizon rose warming
  float sunY  = uHorizon - 0.06 + sunH * 0.20;       // sun centre: below horizon in deep night, above at peak

  /* ── SKY ── a vertical gradient, zenith→horizon, warming + lifting with sunH. */
  float sky = smoothstep(uHorizon, 1.0, vUv.y);       // 0 at horizon, 1 at zenith
  vec3 zenith  = mix(uNightZenith, uDayZenith, sunH * 0.6);
  vec3 horizonC = mix(uNightHorizon, uRose, rise);
  horizonC = mix(horizonC, uGold, smoothstep(0.55, 1.0, sunH));
  vec3 col = mix(horizonC, zenith, pow(sky, 0.8));

  /* A soft warm glow pooled at the horizon where the light comes from — widens + warms as dawn breaks. */
  float glowBand = exp(-max(vUv.y - uHorizon, 0.0) * mix(9.0, 3.5, warm));
  col += uGold * glowBand * (0.10 + 0.9 * warm) * (0.4 + 0.6 * rise);

  /* ── STARS ── faint points high in the sky, fading as it brightens. Cheap hashed cells. */
  float starFade = (1.0 - smoothstep(0.12, 0.5, sunH)) * smoothstep(uHorizon + 0.1, 0.6, vUv.y);
  vec2 sc = vec2(vUv.x * aspect, vUv.y) * 90.0;
  vec2 si = floor(sc);
  float sh = hash(si);
  float star = step(0.985, sh) * smoothstep(0.09, 0.0, length(fract(sc) - 0.5));
  float twinkle = 0.6 + 0.4 * sin(uTime * 2.0 + sh * 40.0);
  col += vec3(0.7, 0.8, 1.0) * star * starFade * twinkle * uStarBright;   // was a hard-coded 0.6 — now the
                                                     // uStarBright taste knob (pack option, default 0.85)

  /* ── SUN ── a warm disc rising through the horizon; one soft HDR core for the bloom. Aspect-corrected
     so it stays round. Only contributes near/after the limb break. */
  vec2 sunP = vec2((vUv.x - 0.5) * aspect, vUv.y - sunY);
  float sd = length(sunP);
  float disc = smoothstep(0.045, 0.030, sd);          // the crisp limb
  float halo = exp(-sd * 7.0);                        // the soft surround
  float reveal = smoothstep(0.18, 0.5, sunH);         // it emerges as the scalar climbs
  col += uGold * halo * 0.7 * reveal;
  col += vec3(1.5, 1.05, 0.6) * disc * reveal;        // >1 core → blooms

  /* ── HILLS ── a low, minimal rolling silhouette (a couple of smooth undulations + a little noise). NOT
     dunes: gentle sine swells, not sharp crests. Everything below the profile is the dark land. */
  float hills = uHorizon
              + sin(vUv.x * 3.1 + 1.3) * 0.018
              + sin(vUv.x * 6.7 + 4.0) * 0.010
              + (fbm(vec2(vUv.x * 4.0, 0.0)) - 0.5) * 0.030;
  float land = smoothstep(hills + 0.004, hills - 0.004, vUv.y);   // 1 below the ridge
  vec3 landC = mix(uLand, uLand + uGold * 0.06, warm);            // the land warms a hair at the gold peak
  col = mix(col, landC, land);

  /* ── MIST ── a low soft band drifting just above the land; thick + cool in the blue hour, thinning and
     glowing gold as the light floods. Sits over the ridge line so the land reads as behind it. */
  float mband = exp(-abs(vUv.y - (uHorizon + 0.03)) * 16.0);
  float drift = fbm(vec2(vUv.x * 2.2 - uTime * 0.03, uTime * 0.02 + 3.0));
  float mist  = mband * (0.35 + 0.4 * drift) * mix(0.9, 0.5, warm);
  vec3 mistC  = mix(mix(uNightHorizon, uRose, rise), uGold, warm * 0.7) + vec3(0.02);
  col = mix(col, mistC, clamp(mist, 0.0, 0.85));

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
