/* ============================================================
   multiscatter.frag — Hillaire Multiple-Scattering LUT (Sec 5.5) — the O(1) approximation.
   ------------------------------------------------------------
   For each (sunCosZenith, altitude) texel: integrate 2nd-order in-scattering over the sphere (64 dirs)
   AND the isotropic transfer factor fms, then sum the infinite scattering orders as a geometric series
   Ψms = L2nd / (1 − fms). This is what makes the sky/clouds bright WITHOUT an iterative N-order LUT, and
   it updates instantly (dynamic time/weather). Samples the transmittance LUT.
   ============================================================ */
precision highp float;
#include ./common.glsl
varying vec2 vUv;
uniform sampler2D uTransmittance;

const float GROUND_ALBEDO = 0.3;
const float MS_STEPS = 20.0;
const int   SQRT_SAMPLES = 8;              // 8×8 = 64 sphere directions

vec3 getSphericalDir(float theta, float phi) {
  float cosPhi = cos(phi), sinPhi = sin(phi), cosTheta = cos(theta), sinTheta = sin(theta);
  return vec3(sinPhi * sinTheta, cosPhi, sinPhi * cosTheta);
}

void getMulScattValues(vec3 pos, vec3 sunDir, out vec3 lumTotal, out vec3 fms) {
  lumTotal = vec3(0.0); fms = vec3(0.0);
  float invSamples = 1.0 / float(SQRT_SAMPLES * SQRT_SAMPLES);
  for (int i = 0; i < SQRT_SAMPLES; i++) {
    for (int j = 0; j < SQRT_SAMPLES; j++) {
      float theta = PI * (float(i) + 0.5) / float(SQRT_SAMPLES);
      float phi = safeacos(1.0 - 2.0 * (float(j) + 0.5) / float(SQRT_SAMPLES));
      vec3 rayDir = getSphericalDir(theta, phi);

      float atmoDist = rayIntersectSphere(pos, rayDir, atmosphereRadiusMM);
      float groundDist = rayIntersectSphere(pos, rayDir, groundRadiusMM);
      float tMax = (groundDist > 0.0) ? groundDist : atmoDist;

      float cosTheta = dot(rayDir, sunDir);
      float miePhase = getMiePhase(cosTheta), rayleighPhase = getRayleighPhase(-cosTheta);

      vec3 lum = vec3(0.0), lumFactor = vec3(0.0), transmittance = vec3(1.0);
      float t = 0.0;
      for (float step = 0.0; step < MS_STEPS; step += 1.0) {
        float newT = ((step + 0.5) / MS_STEPS) * tMax;
        float dt = newT - t; t = newT;
        vec3 newPos = pos + t * rayDir;
        vec3 rs; float ms; vec3 extinction;
        getScatteringValues(newPos, rs, ms, extinction);
        vec3 sampleTransmittance = exp(-dt * extinction);

        vec3 scatteringNoPhase = rs + vec3(ms);
        vec3 scatteringF = (scatteringNoPhase - scatteringNoPhase * sampleTransmittance) / max(extinction, 1e-6);
        lumFactor += transmittance * scatteringF;

        vec3 sunTransmittance = getValFromTLUT(uTransmittance, newPos, sunDir);
        vec3 rayleighInScatter = rs * rayleighPhase;
        float mieInScatter = ms * miePhase;
        vec3 inScattering = (rayleighInScatter + vec3(mieInScatter)) * sunTransmittance;
        vec3 scatteringIntegral = (inScattering - inScattering * sampleTransmittance) / max(extinction, 1e-6);
        lum += scatteringIntegral * transmittance;
        transmittance *= sampleTransmittance;
      }
      if (groundDist > 0.0) {                                        // ground bounce
        vec3 hitPos = pos + groundDist * rayDir;
        if (dot(pos, sunDir) > 0.0) {
          hitPos = normalize(hitPos) * groundRadiusMM;
          lum += transmittance * GROUND_ALBEDO * getValFromTLUT(uTransmittance, hitPos, sunDir);
        }
      }
      fms += lumFactor * invSamples;
      lumTotal += lum * invSamples;
    }
  }
}

void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(sqrt(max(0.0, 1.0 - sunCosTheta * sunCosTheta)), sunCosTheta, 0.0));
  vec3 lum, fms;
  getMulScattValues(pos, sunDir, lum, fms);
  vec3 psi = lum / max(1.0 - fms, 1e-4);                            // geometric series Σ fms^n
  gl_FragColor = vec4(sqrt(max(psi, 0.0)), 1.0);                    // sqrt-encode for the RGBA8 LUT (decoded by squaring)
}
