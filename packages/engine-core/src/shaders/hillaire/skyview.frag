/* ============================================================
   skyview.frag — Hillaire Sky-View LUT (Sec 5.3). Per-frame.
   ------------------------------------------------------------
   A low-res lat/long image of the distant sky, oriented to the camera up + sun. Non-linear latitude
   (v→adjV) packs detail at the horizon. Each texel ray-marches single + multiple scattering (sampling
   the transmittance + multiple-scattering LUTs). The render pass upsamples this cheaply.
   ============================================================ */
precision highp float;
#include ./common.glsl
varying vec2 vUv;
uniform sampler2D uTransmittance;
uniform sampler2D uMultiScatter;
uniform vec3 uSunDir;      // world sun direction (only its altitude vs up matters here)
uniform vec3 uViewPos;     // planet-frame camera pos = (0, groundRadiusMM + altitude, 0)

const float NUM_STEPS = 32.0;

vec3 raymarchScattering(vec3 pos, vec3 rayDir, vec3 sunDir, float tMax) {
  float cosTheta = dot(rayDir, sunDir);
  float miePhase = getMiePhase(cosTheta), rayleighPhase = getRayleighPhase(-cosTheta);
  vec3 lum = vec3(0.0), transmittance = vec3(1.0);
  float t = 0.0;
  for (float i = 0.0; i < NUM_STEPS; i += 1.0) {
    float newT = ((i + 0.3) / NUM_STEPS) * tMax;
    float dt = newT - t; t = newT;
    vec3 newPos = pos + t * rayDir;
    vec3 rs; float ms; vec3 extinction;
    getScatteringValues(newPos, rs, ms, extinction);
    vec3 sampleTransmittance = exp(-dt * extinction);
    vec3 sunTransmittance = getValFromTLUT(uTransmittance, newPos, sunDir);
    vec3 psiMS = getValFromMSLUT(uMultiScatter, newPos, sunDir);
    vec3 rayleighInScatter = rs * (rayleighPhase * sunTransmittance + psiMS);
    vec3 mieInScatter = vec3(ms) * (miePhase * sunTransmittance + psiMS);
    vec3 inScattering = rayleighInScatter + mieInScatter;
    vec3 scatteringIntegral = (inScattering - inScattering * sampleTransmittance) / max(extinction, 1e-6);
    lum += scatteringIntegral * transmittance;
    transmittance *= sampleTransmittance;
  }
  return lum;
}

void main() {
  float azimuthAngle = (vUv.x - 0.5) * 2.0 * PI;
  float adjV;
  if (vUv.y < 0.5) { float c = 1.0 - 2.0 * vUv.y; adjV = -c * c; }
  else            { float c = 2.0 * vUv.y - 1.0; adjV = c * c; }

  float height = length(uViewPos);
  vec3 up = uViewPos / height;
  float horizonAngle = safeacos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height) - 0.5 * PI;
  float altitudeAngle = adjV * 0.5 * PI - horizonAngle;
  float cosAlt = cos(altitudeAngle);
  vec3 rayDir = vec3(cosAlt * sin(azimuthAngle), sin(altitudeAngle), -cosAlt * cos(azimuthAngle));

  float sunAltitude = 0.5 * PI - safeacos(dot(uSunDir, up));
  vec3 sunDir = vec3(0.0, sin(sunAltitude), -cos(sunAltitude));

  float atmoDist = rayIntersectSphere(uViewPos, rayDir, atmosphereRadiusMM);
  float groundDist = rayIntersectSphere(uViewPos, rayDir, groundRadiusMM);
  float tMax = (groundDist < 0.0) ? atmoDist : groundDist;
  vec3 lum = raymarchScattering(uViewPos, rayDir, sunDir, tMax);
  gl_FragColor = vec4(sqrt(max(lum, 0.0)), 1.0);                    // sqrt-encode for the RGBA8 LUT (decoded by squaring in the render)
}
