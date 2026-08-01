/* ============================================================
   clouds.frag — FIRST-PARTY. Raymarched volumetric clouds (fidelity C-1: Perlin-Worley cumulus).
   ------------------------------------------------------------
   The MSFS/Nubis technique (Schneider, Guerrilla). A ShaderPass between the sky RenderPass and bloom.
   For each pixel it rebuilds the world view ray, intersects the cloud SLAB (y ∈ [BOT,TOP]) and marches:
     • density   = a precomputed tiling 3D PERLIN-WORLEY texture (uNoise) — the .r billowy base carved
       by COVERAGE + a cumulus height gradient, then eroded by the higher-freq Worley channels (.gba).
       (The texture replaces analytic FBM: banding-free — trilinear filtering is smooth — and cheaper.)
     • lighting  = a short march toward the sun → self-shadow + Beer's-law transmittance, a POWDER term
       (dark sun-facing edges — the sugary look), and a DUAL-LOBE Henyey-Greenstein phase (a forward
       silver lining that blooms + a soft back glow).
   Step counts arrive as uniforms so the quality governor can drop them on weak GPUs.
   GLSL3 (WebGL2) for sampler3D; Three injects varying/texture2D compat macros but NOT gl_FragColor,
   so we declare our own out vec4 fragColor.
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
uniform float uTime;
uniform float uCoverage;         // 0..1
uniform int   uSteps;            // primary march steps (tier)
uniform int   uLightSteps;       // light march steps (tier)

const float BOT = 26.0, TOP = 62.0;   // cloud slab altitude (world units; camera ≈ origin)
const int   MAX_STEPS = 48, MAX_LIGHT = 6;

float remap(float v, float ol, float oh, float nl, float nh) { return nl + (v - ol) * (nh - nl) / (oh - ol); }
float hash12(vec2 p) { p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }

/* cloud density at a world point, 0..~1.4 */
float cloudDensity(vec3 p, float cov) {
  float h = clamp((p.y - BOT) / (TOP - BOT), 0.0, 1.0);
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

  if (uNoiseReady < 0.5 || uCoverage < 0.01 || rd.y < 0.02) { fragColor = vec4(sky, 1.0); return; }

  float t0 = (BOT - ro.y) / rd.y, t1 = (TOP - ro.y) / rd.y;
  t0 = max(t0, 0.0); t1 = min(t1, 500.0);                 // cap the marched distance
  if (t1 <= t0) { fragColor = vec4(sky, 1.0); return; }

  // cap the step LENGTH too: at grazing angles the slab chord goes near-infinite, so a fixed step count
  // blows up step size → undersampling grain at the horizon. Capped, distant clouds just fade instead.
  float stepLen = min((t1 - t0) / float(uSteps), 10.0);
  float mu = dot(rd, uSunDir);
  float phase = dualPhase(mu);
  float T = 1.0; vec3 scatter = vec3(0.0);
  float t = t0 + stepLen * hash12(vUv + fract(uTime));   // jitter start to hide march banding

  for (int i = 0; i < MAX_STEPS; i++) {
    if (i >= uSteps || T < 0.02) break;
    vec3 p = ro + rd * t;
    float dens = cloudDensity(p, uCoverage);
    if (dens > 0.001) {
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
      float powder = 1.0 - exp(-dens * stepLen * 2.0);               // dark sun-facing edges (the sugary look)
      vec3  sunLit = uSunColor * ms * (0.7 + 0.5 * powder) * 1.5;    // brighter → sunlit cumulus read white
      vec3  amb    = uSkyTint * 0.7 + uSunColor * 0.15;              // bright sky + sun ambient fills the shadows
      float dT = exp(-dens * stepLen * 1.05);                        // view-ray transmittance
      scatter += T * (1.0 - dT) * (sunLit + amb);
      T *= dT;
    }
    t += stepLen;
  }
  fragColor = vec4(sky * T + scatter, 1.0);
}
