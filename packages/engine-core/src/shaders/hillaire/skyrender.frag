/* ============================================================
   skyrender.frag — draws the sky background by upsampling the Sky-View LUT + a sun disc.
   ------------------------------------------------------------
   A full-screen background (behind everything). Rebuilds the world view ray, converts it into the
   Sky-View LUT's (azimuth-relative-to-sun, non-linear altitude) parameterisation and samples it, then
   adds the transmittance-attenuated sun disc. uExposure lifts the physical radiance into the shared
   ACES tonemap's range (Hillaire radiance is ~10× smaller than the old Preetham values).
   ============================================================ */
precision highp float;
#include ./common.glsl
varying vec2 vUv;
uniform sampler2D uSkyView;
uniform sampler2D uTransmittance;
uniform vec3  uSunDir;      // world
uniform vec3  uViewPos;     // planet-frame camera pos
uniform mat4  uInvProj;
uniform mat4  uCamWorld;
uniform float uExposure;
uniform float uSunSize;     // angular radius of the sun disc, radians (driven by the Sun-size dial)

vec3 getValFromSkyLUT(vec3 rayDir, vec3 sunDir) {
  float height = length(uViewPos);
  vec3 up = uViewPos / height;
  float horizonAngle = safeacos(sqrt(height * height - groundRadiusMM * groundRadiusMM) / height);
  float altitudeAngle = horizonAngle - safeacos(dot(rayDir, up));       // −π/2 .. π/2
  float azimuthAngle;
  if (abs(altitudeAngle) > (0.5 * PI - 0.0001)) {
    azimuthAngle = 0.0;
  } else {
    vec3 right = cross(sunDir, up);
    vec3 forward = cross(up, right);
    vec3 projectedDir = normalize(rayDir - up * dot(rayDir, up));
    float sinT = dot(projectedDir, right);
    float cosT = dot(projectedDir, forward);
    azimuthAngle = atan(sinT, cosT) + PI;
  }
  float v = 0.5 + 0.5 * sign(altitudeAngle) * sqrt(abs(altitudeAngle) * 2.0 / PI);
  vec3 s = texture2D(uSkyView, vec2(azimuthAngle / (2.0 * PI), v)).rgb;
  return s * s;                                                     // decode the sqrt-encoded RGBA8 sky-view LUT
}

void main() {
  vec4 clip = uInvProj * vec4(vUv * 2.0 - 1.0, 0.5, 1.0); clip /= clip.w;
  vec3 rayDir = normalize((uCamWorld * vec4(clip.xyz, 0.0)).xyz);

  vec3 lum = getValFromSkyLUT(rayDir, uSunDir);

  // sun disc — soft-edged, radius = uSunSize (the dial); only above the horizon + unoccluded by the planet
  float sunAng = safeacos(clamp(dot(rayDir, uSunDir), -1.0, 1.0));       // angle from the sun centre
  float disc = 1.0 - smoothstep(uSunSize * 0.72, uSunSize, sunAng);      // soft limb → no hard-edged circle
  if (disc > 0.0 && rayIntersectSphere(uViewPos, rayDir, groundRadiusMM) < 0.0) {
    lum += getValFromTLUT(uTransmittance, uViewPos, uSunDir) * 40.0 * disc;   // HDR sun core → blooms
  }
  gl_FragColor = vec4(lum * uExposure, 1.0);
}
