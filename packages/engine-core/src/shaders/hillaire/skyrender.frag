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

/* ---- ARC A-NIGHTFALL: THE NIGHT FLOOR. --------------------------------------------------------
   Below the horizon this atmosphere has almost nothing left to in-scatter, so getValFromSkyLUT
   returns ~0 and the sky goes flat black — while an unlit water surface keeps emitting its base
   colour, i.e. THE SEA ENDS UP BRIGHTER THAN THE SKY ABOVE IT. That inversion is the defect this
   term exists to close, and it is a floor rather than a brightness lift because "make night
   brighter" is how a night scene turns into flat grey daylight.

   ADDED AFTER uExposure, NOT INTO lum. Two reasons and both are load-bearing: (1) it makes the
   two colours authorable directly in OUTPUT units, so they can be set from the SunRig's own night
   sky/horizon keyframes and compared against a measured water luminance without mentally
   dividing by an exposure that a consumer is free to change; (2) uExposure is a per-room dial
   (world-lab ships 6) — folding the floor through it would make the night sky a different colour
   in every room that tuned its daylight.

   uNightK = 0 -> the term is EXACTLY zero and every existing consumer is byte-identical. That is
   the same discipline as box-arena's "every new rate defaults to 0". */
uniform vec3  uNightZenith;
uniform vec3  uNightHorizon;
uniform float uNightK;

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
  vec3 outColor = lum * uExposure;

  /* THE NIGHT FLOOR — a vertical gradient, because a single flat colour reads as a painted wall
     rather than as sky. up is the planet normal under the eye (the same one getValFromSkyLUT
     derives), so el is the ray's sine-elevation: 1 at the zenith, 0 at the horizon, negative
     below it. The ramp is sqrt-shaped so most of the visible change happens in the low band a
     standing camera actually frames, and it is clamped at 0 so ground-ward rays keep the horizon
     colour instead of extrapolating to nonsense. */
  if (uNightK > 0.0) {
    vec3 up = normalize(uViewPos);
    float el = clamp(dot(rayDir, up), 0.0, 1.0);
    outColor += mix(uNightHorizon, uNightZenith, sqrt(el)) * uNightK;
  }

  gl_FragColor = vec4(outColor, 1.0);
}
