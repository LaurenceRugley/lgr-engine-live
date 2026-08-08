/* ============================================================
   clouds.frag — FIRST-PARTY. Raymarched volumetric clouds (fidelity C-1: Perlin-Worley cumulus).
   ------------------------------------------------------------
   The MSFS/Nubis technique (Schneider, Guerrilla). A ShaderPass between the sky RenderPass and bloom.
   For each pixel it rebuilds the world view ray, intersects the cloud SLAB (y ∈ [BOT,TOP]) and marches:
     • density   = a precomputed tiling 3D PERLIN-WORLEY texture (uNoise) — the .r billowy base carved
       by COVERAGE + a cumulus height gradient (now PER-COLUMN, see towerMask below), eroded by the
       higher-freq Worley channels (.gba). (Replaces analytic FBM: banding-free — trilinear filtering is
       smooth — and cheaper.)
     • lighting  = a short march toward the sun → self-shadow + Beer's-law transmittance, a POWDER term
       (dark sun-facing edges — the sugary look), and a DUAL-LOBE Henyey-Greenstein phase (a forward
       silver lining that blooms + a soft back glow).
   Step counts arrive as uniforms so the quality governor can drop them on weak GPUs.
   GLSL3 (WebGL2) for sampler3D; Three injects varying/texture2D compat macros but NOT gl_FragColor,
   so we declare our own out vec4 fragColor.

   ── A1 FIX (owner feedback 2026-08-01, reel #5): the slab-intersection SIGN bug ──────────────────
   The prior version computed t0=(BOT-ro.y)/rd.y, t1=(TOP-ro.y)/rd.y and assumed t1>t0 — true ONLY for
   an upward ray. A camera above the slab (or inside it) looking DOWN flips both divisions' sign, so
   t1<t0 and the shader early-returned pure sky: "clouds disappear when I'm high" / "no cloud-tops shot
   possible". Fixed below with an ORDERED slab test (min/max over both candidate t's, not an assumed
   order) that is correct for every ray direction, including the near-horizontal divide-by-~0 case. The
   OLD code also had a SECOND, compounding bug: rd.y < 0.02 in the early-out above rejected almost
   every downward ray before the slab test even ran. Both are gone now — see main().

   ── A2 — VERTICAL EXTENT: scattered TOWERS, not a uniformly taller slab ──────────────────────────
   BOT/BASE_TOP are the ORIGINAL 26-62 band — the normal cumulus profile, unchanged for most of the
   sky. TOP raises the CEILING to 150, but a column may only build that high where a separate,
   LOW-FREQUENCY 2D field (towerMask, sampled from the same tiling volume at a much coarser scale) says
   so — real skies have scattered cells that tower while their neighbours stay low; a uniformly thicker
   slab would be both expensive (A3) AND wrong (every column bloated the same amount, still reading as
   "a slab", just a taller one).

   ── A3 — EMPTY-SPACE SKIPPING ─────────────────────────────────────────────────────────────────────
   The step LENGTH is now a small, roughly-fixed distance tuned to the base noise frequency (enough
   samples across a cloud cell to avoid banding), decoupled from the total slab chord length — the OLD
   stepLen = chord/uSteps meant a taller slab either needed more steps (slower) or produced a coarser,
   banded fine-step (worse quality) even through solid cloud material. Empty samples (dens≈0, the common
   case in a mostly-empty tall column) advance by a much LARGER coarse step and skip the expensive light-
   march entirely; only once real density is found does the march drop to the fine step. Tall, mostly-
   empty sky now costs close to nothing — see main()'s loop.
   ============================================================ */
precision highp float;
precision highp sampler3D;

varying vec2 vUv;
out vec4 fragColor;              // GLSL3 has no gl_FragColor — declare our own output
uniform sampler2D tDiffuse;      // the rendered sky (ShaderPass input)
uniform sampler3D uNoise;        // tiling Perlin-Worley volume (r=base, gba=erosion detail)
uniform float uNoiseReady;       // 0 until the volume is built (built async off the boot path)
uniform vec2  uResolution;
uniform mat4  uInvProj;          // camera.projectionMatrixInverse
uniform mat4  uCamWorld;         // camera.matrixWorld
uniform vec3  uCamPos;
uniform vec3  uSunDir;
uniform vec3  uSunColor;
uniform vec3  uSkyTint;          // ambient sky colour into the shadows
uniform float uOvercast;         // weather overcast 0..1 — drives the horizon haze (0 = byte-identical clear)
uniform sampler2D uSceneDepth;   // this frame's scene depth (the grab pass, same camera) — the OCCLUSION gate
uniform float uDepthGate;        // 1 = gate on, 0 = off (byte-identical legacy behaviour)
uniform float uTime;
uniform float uCoverage;         // 0..1
uniform int   uSteps;            // primary march steps (tier)
uniform int   uLightSteps;       // light march steps (tier)

// BOT/BASE_TOP: the original 26–62 cumulus band (unchanged look for most columns). TOP: the A2 ceiling —
// only a column whose towerMask() clears the threshold below builds any higher than BASE_TOP.
/* SLAB ALTITUDE (2026-08-05, metropolis "clouds are broken" sweep): was BOT 26/62/150 — from the
   default aerial framing every visible sky ray sits within ~12° of the horizon, where a 26-high slab
   floor needs a >500-unit march (26/sin(3°) = 520) and the t1 cap killed it: coverage 0.92 rendered
   ZERO cloud in the frame the user actually boots into. 14/40/110 puts the deck inside the capped
   march for grazing rays (14/sin(3°) = 267) while staying far above the tallest towers (~5.2). */
const float BOT = 14.0, BASE_TOP = 40.0, TOP = 110.0;
const int   MAX_STEPS = 64, MAX_LIGHT = 8;   // raised from 48/6 (A3) — headroom for the CAPTURE tier (createVolumetricClouds.js)

float remap(float v, float ol, float oh, float nl, float nh) { return nl + (v - ol) * (nh - nl) / (oh - ol); }
float hash12(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

/* A2 — the low-frequency "which columns get to tower" field. A CONSTANT-Y slice of the SAME tiling
   volume the base/erosion density sampling already uses (no second texture), at a frequency ~8× coarser
   than the base cumulus scale (0.006 below) — many neighbouring cumulus cells share one tower/no-tower
   decision, which is what reads as "scattered columns" rather than per-cell noise. */
float towerMask(vec2 xz) { return texture(uNoise, vec3(xz * 0.0009, 0.15)).r; }

/* cloud density at a world point, 0..~1.4. colTop (this column's own ceiling, from towerMask) replaces
   the old constant TOP in the height-gradient normalization — a non-towering column's profile is
   BYTE-IDENTICAL to before (mix() with tower below its threshold → colTop==BASE_TOP exactly). */
float cloudDensity(vec3 p, float cov) {
  float tower = towerMask(p.xz);
  float colTop = mix(BASE_TOP, TOP, smoothstep(0.55, 0.85, tower));   // only clearly-"tower" columns extend past BASE_TOP
  float h = clamp((p.y - BOT) / (colTop - BOT), 0.0, 1.0);
  // cumulus profile: flat-ish base, quick rise, rounded top (densest in the lower-middle)
  float grad = smoothstep(0.0, 0.10, h) * smoothstep(1.0, 0.30, h);
  vec3 wind = vec3(uTime * 0.6, 0.0, uTime * 0.22);
  vec3 wp = (p + wind) * 0.006;                          // base sample scale (RepeatWrapping tiles it)
  float base = texture(uNoise, wp).r;
  float d = remap(base, 1.0 - cov, 1.0, 0.0, 1.0) * grad;   // carve by coverage, taper at slab edges
  if (d <= 0.0) return 0.0;
  vec4 dt = texture(uNoise, wp * 4.0 + 3.11);            // higher-freq erosion detail
  float erosion = dt.g * 0.6 + dt.b * 0.3 + dt.a * 0.1;
  d = remap(d, erosion * 0.5, 1.0, 0.0, 1.0);           // cauliflower edges
  return clamp(d, 0.0, 1.0) * 1.4;
}

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (12.5664 * pow(max(1e-3, 1.0 + g2 - 2.0 * g * c), 1.5)); }
float dualPhase(float c) { return mix(hg(c, 0.75), hg(c, -0.35), 0.35); }   // forward silver lining + soft back glow

void main() {
  vec3 sky = texture2D(tDiffuse, vUv).rgb;

  // rebuild the world ray
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 0.5, 1.0); v /= v.w;
  vec3 rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  vec3 ro = uCamPos;

  if (uNoiseReady < 0.5 || uCoverage < 0.01) { fragColor = vec4(sky, 1.0); return; }

  /* OCCLUSION GATE (2026-08-06, A-FEEL): this pass composites OVER the rendered scene and, until now,
     had no depth information at all — so any upward ray marched to the cloud slab even with a building
     in the way, painting clouds ON TOP of the skyline. Invisible while the walk camera was a giant at
     eye 2.2 (rays toward buildings pointed DOWN and missed the slab); the moment the eye dropped to a
     human 0.58 and looked up a street canyon, cloud dithering covered every tower.
     THE WORLD FACT that makes this a one-liner rather than a distance comparison: the cloud slab floor
     is BOT (14.0) and every piece of city geometry — towers ~5.2, terrain, water — is far below it, so
     geometry ALWAYS occludes cloud. Any fragment with scene depth in front of the far plane therefore
     draws zero cloud. (A world with geometry ABOVE 14 units would need the full ray-distance compare;
     assert that here rather than discovering it silently.) uDepthGate 0 restores the old behaviour. */
  if (uDepthGate > 0.5 && texture2D(uSceneDepth, vUv).x < 0.9999) { fragColor = vec4(sky, 1.0); return; }

  // A1 FIX — ordered slab intersection, correct for ANY rd.y sign (up, down) and the near-horizontal
  // case. invDY is guarded away from a literal 0 (an epsilon floor, sign-preserving) rather than
  // branching on rd.y at all: when ro.y is INSIDE the slab and rd.y≈0, (BOT-ro.y) and (TOP-ro.y) have
  // OPPOSITE signs, so dividing both by a tiny invDY sends t0/t1 toward -/+ infinity in opposite
  // directions — exactly "march the full capped distance", which the clamps below produce for free.
  float invDY = 1.0 / (abs(rd.y) < 1e-4 ? (rd.y < 0.0 ? -1e-4 : 1e-4) : rd.y);
  float tBot = (BOT - ro.y) * invDY, tTop = (TOP - ro.y) * invDY;
  float t0 = min(tBot, tTop), t1 = max(tBot, tTop);       // ORDERED — no assumption about which boundary is "entry"
  /* MARCH WINDOW (2026-08-05, canary-proven): the absolute 500 cap meant any ray entering the slab
     past t=500 — everything below ~1.6° elevation, i.e. THE ENTIRE SKY BAND of the default aerial
     framing — early-returned with zero cloud forever. Cap at a WINDOW past the entry instead: rays
     that already fit keep the 500 (byte-identical); grazing rays march a bounded 240-unit slice of
     deck at distance, which is exactly the far cloud bank a horizon should show. */
  t0 = max(t0, 0.0); t1 = min(t1, max(500.0, t0 + 240.0));
  /* OVERCAST HORIZON HAZE at the early exit too (the canary showed these rays never reach the end
     of main): under weather, the un-marchable rays are precisely "the far horizon under the deck" —
     gray them by ray angle so a storm never leaves a clear blue stripe at the horizon. */
  if (t1 <= t0) {
    float hz = uOvercast * (1.0 - smoothstep(-0.02, 0.16, rd.y));
    if (hz > 0.001) {
      float hl0 = dot(uSkyTint, vec3(0.2126, 0.7152, 0.0722));
      sky = mix(sky, mix(uSkyTint, vec3(hl0), 0.5) * 0.95, min(hz, 0.85));
    }
    fragColor = vec4(sky, 1.0); return;
  }

  // A3 — FINE step: a small, roughly-fixed distance (NOT chord/uSteps — see header) so cloud material
  // is sampled at consistent quality regardless of how tall the ray's total slab chord is. Interpolated
  // by the tier's step budget: a low-step real-time tier gets a coarser (cheaper) fine-step, a
  // high-step tier (CAPTURE) gets finer detail — this is the "tier seam" the brief asks to preserve.
  float fineStep = mix(5.0, 2.2, smoothstep(24.0, float(MAX_STEPS), float(uSteps)));
  float coarseStep = fineStep * 6.0;   // EMPTY-SPACE SKIPPING multiplier — jump past zero-density regions

  float mu = dot(rd, uSunDir);
  float phase = dualPhase(mu);
  float T = 1.0; vec3 scatter = vec3(0.0);
  float t = t0 + fineStep * hash12(vUv + fract(uTime));   // jitter start to hide march banding

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps || t > t1 || T < 0.02) break;
    vec3 p = ro + rd * t;
    float dens = cloudDensity(p, uCoverage);
    if (dens <= 0.001) { t += coarseStep; continue; }     // empty — skip past it, no light-march spent here
    // optical depth toward the sun (self-shadow)
    float ld = 0.0; float lStep = 7.0;
    for (int j = 0; j < MAX_LIGHT; j++) { if (j >= uLightSteps) break; ld += cloudDensity(p + uSunDir * (float(j) + 1.0) * lStep, uCoverage); }
    // MULTIPLE-SCATTERING approx (Hillaire octaves): each octave penetrates deeper (smaller extinction)
    // and flattens toward isotropic. This is what keeps sunlit cumulus BRIGHT/WHITE instead of black —
    // single-scatter alone makes thick clouds render as dark blobs.
    float ms = 0.0, a = 1.0, b = 1.0, cflat = 1.0;
    for (int k = 0; k < 3; k++) {
      ms += a * exp(-ld * lStep * 0.6 * b) * mix(0.28, phase, cflat);
      a *= 0.5; b *= 0.5; cflat *= 0.5;
    }
    float powder = 1.0 - exp(-dens * fineStep * 2.0);               // dark sun-facing edges (the sugary look)
    vec3  sunLit = uSunColor * ms * (0.7 + 0.5 * powder) * 1.5;    // brighter → sunlit cumulus read white
    vec3  amb    = uSkyTint * 0.7 + uSunColor * 0.15;              // bright sky + sun ambient fills the shadows
    float dT = exp(-dens * fineStep * 1.05);                        // view-ray transmittance
    scatter += T * (1.0 - dT) * (sunLit + amb);
    T *= dT;
    t += fineStep;
  }
  /* WEATHER HORIZON HAZE (2026-08-05, metropolis storm sweep): the slab's flat underside meets the
     march cap at rd.y ≈ 14/500 = 0.028 — a RAZOR line with clear blue sky in the wedge below it,
     even at coverage 0.92 ("rain out of a clear sky"). Under overcast, gray the UN-CLOUDED remainder
     (the sky*T term) toward a haze derived from uSkyTint by ray angle — 0 above ~9°, full at the
     horizon. uOvercast is 0 in clear weather → byte-identical. Distant geometry near the horizon
     gains a touch of extra gray under storm — that is aerial perspective, not a bug. */
  float hazK = uOvercast * (1.0 - smoothstep(-0.02, 0.16, rd.y));
  if (hazK > 0.001) {
    float hl = dot(uSkyTint, vec3(0.2126, 0.7152, 0.0722));
    vec3 haze = mix(uSkyTint, vec3(hl), 0.5) * 0.95;
    sky = mix(sky, haze, min(hazK, 0.85));
  }
  fragColor = vec4(sky * T + scatter, 1.0);
}
