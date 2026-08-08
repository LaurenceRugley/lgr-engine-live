/* ============================================================
   common.glsl — Hillaire 2020 atmosphere: shared physical model + LUT lookups.
   ------------------------------------------------------------
   "A Scalable and Production Ready Sky and Atmosphere Rendering Technique", S. Hillaire, EGSR 2020.
   Physically-based Rayleigh + Mie + OZONE media on a spherical planet, so the sky is correct from the
   GROUND to SPACE (our edge-of-space, for free + physical). Units are MEGAMETERS (Mm); the scattering
   coefficients (Hillaire Table 1, ×10⁻⁶ m⁻¹) are therefore per-Mm. Included via vite-plugin-glsl.
   ============================================================ */
const float PI = 3.141592653589793;
const float groundRadiusMM = 6.360;      // Earth ground radius
const float atmosphereRadiusMM = 6.460;  // + 100 km atmosphere shell

// scattering/absorption bases (per Mm) — Hillaire Table 1
const vec3  rayleighScatteringBase = vec3(5.802, 13.558, 33.1);
const float rayleighAbsorptionBase = 0.0;
const float mieScatteringBase = 3.996;
const float mieAbsorptionBase  = 4.40;
const vec3  ozoneAbsorptionBase = vec3(0.650, 1.881, 0.085);

uniform float uMie;   // haze/aerosol multiplier on the Mie base (1 = default clear; higher = milkier, hazier)

float safeacos(float x) { return acos(clamp(x, -1.0, 1.0)); }

/* nearest positive intersection of ray (ro,rd) with a sphere of radius rad centred at origin; -1 = miss */
float rayIntersectSphere(vec3 ro, vec3 rd, float rad) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - rad * rad;
  if (c > 0.0 && b > 0.0) return -1.0;
  float disc = b * b - c;
  if (disc < 0.0) return -1.0;
  if (disc > b * b) return (-b + sqrt(disc));
  return -b - sqrt(disc);
}

/* participating-media values at a world position (distance from planet centre → altitude) */
void getScatteringValues(vec3 pos, out vec3 rayleighScattering, out float mieScattering, out vec3 extinction) {
  float altitudeKM = (length(pos) - groundRadiusMM) * 1000.0;       // Mm → km
  float rayleighDensity = exp(-altitudeKM / 8.0);
  float mieDensity      = exp(-altitudeKM / 1.2);
  rayleighScattering = rayleighScatteringBase * rayleighDensity;
  float rayleighAbsorption = rayleighAbsorptionBase * rayleighDensity;
  mieScattering = mieScatteringBase * uMie * mieDensity;
  float mieAbsorption = mieAbsorptionBase * uMie * mieDensity;
  vec3 ozone = ozoneAbsorptionBase * max(0.0, 1.0 - abs(altitudeKM - 25.0) / 15.0);   // 30km-wide tent @ 25km
  extinction = rayleighScattering + vec3(rayleighAbsorption) + vec3(mieScattering + mieAbsorption) + ozone;
}

float getMiePhase(float cosTheta) {
  const float g = 0.8, scale = 3.0 / (8.0 * PI);
  float num = (1.0 - g * g) * (1.0 + cosTheta * cosTheta);
  float denom = (2.0 + g * g) * pow(1.0 + g * g - 2.0 * g * cosTheta, 1.5);
  return scale * num / denom;
}
float getRayleighPhase(float cosTheta) {
  const float k = 3.0 / (16.0 * PI);
  return k * (1.0 + cosTheta * cosTheta);
}

/* LUT lookups — both the transmittance and multiple-scattering LUTs are parameterised by
   (u = 0.5 + 0.5·sunCosZenith, v = normalised altitude). */
vec2 lutUV(vec3 pos, vec3 sunDir) {
  float height = length(pos);
  vec3 up = pos / height;
  float sunCosZenith = dot(sunDir, up);
  return vec2(clamp(0.5 + 0.5 * sunCosZenith, 0.0, 1.0),
              clamp((height - groundRadiusMM) / (atmosphereRadiusMM - groundRadiusMM), 0.0, 1.0));
}
vec3 getValFromTLUT(sampler2D tex, vec3 pos, vec3 sunDir) { return texture2D(tex, lutUV(pos, sunDir)).rgb; }   // transmittance is [0,1]
// the sky-view + multiple-scattering LUTs are RGBA8 (universally filterable) and SQRT-ENCODED (gamma 2)
// to spread the small radiance range across the 8 bits — decode by squaring.
vec3 getValFromMSLUT(sampler2D tex, vec3 pos, vec3 sunDir) { vec3 v = texture2D(tex, lutUV(pos, sunDir)).rgb; return v * v; }
