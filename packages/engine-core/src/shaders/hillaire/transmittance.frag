/* ============================================================
   transmittance.frag — Hillaire Transmittance LUT (Sec 5.2).
   ------------------------------------------------------------
   For a point at altitude v and a sun at zenith-cos u, ray-marches to the atmosphere edge accumulating
   extinction → stores the RGB transmittance exp(-∫extinction). Computed ONCE (static atmosphere).
   ============================================================ */
precision highp float;
#include ./common.glsl
varying vec2 vUv;

const int STEPS = 40;

vec3 getSunTransmittance(vec3 pos, vec3 sunDir) {
  if (rayIntersectSphere(pos, sunDir, groundRadiusMM) > 0.0) return vec3(0.0);   // planet blocks the sun
  float atmoDist = rayIntersectSphere(pos, sunDir, atmosphereRadiusMM);
  float t = 0.0;
  vec3 transmittance = vec3(1.0);
  for (int i = 0; i < STEPS; i++) {
    float newT = ((float(i) + 0.3) / float(STEPS)) * atmoDist;
    float dt = newT - t; t = newT;
    vec3 newPos = pos + t * sunDir;
    vec3 rs; float ms; vec3 extinction;
    getScatteringValues(newPos, rs, ms, extinction);
    transmittance *= exp(-dt * extinction);
  }
  return transmittance;
}

void main() {
  float sunCosTheta = 2.0 * vUv.x - 1.0;
  float height = mix(groundRadiusMM, atmosphereRadiusMM, vUv.y);
  vec3 pos = vec3(0.0, height, 0.0);
  vec3 sunDir = normalize(vec3(sqrt(max(0.0, 1.0 - sunCosTheta * sunCosTheta)), sunCosTheta, 0.0));
  gl_FragColor = vec4(getSunTransmittance(pos, sunDir), 1.0);
}
