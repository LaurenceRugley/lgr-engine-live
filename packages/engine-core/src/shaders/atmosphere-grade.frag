/* ============================================================
   atmosphere-grade.frag — FIRST-PARTY. Cheap atmosphere fidelity: ozone twilight + aerial perspective.
   ------------------------------------------------------------
   A tiny O(1)-per-pixel post-pass (no loops) that grafts two real atmospheric effects onto the Preetham
   sky, which models neither:

   • AERIAL PERSPECTIVE — distant air in-scatters skylight, so the horizon tints toward the sky colour
     and desaturates. Here (no terrain yet) it reads as a horizon-band haze; the SAME term will tint the
     water/earth layer later (that's why it's driven by the world-ray elevation, not screen y).
   • OZONE TWILIGHT — ozone absorbs the yellow/orange out of low-sun light, leaving the classic
     violet/magenta twilight band at dawn/dusk (Preetham has no ozone). A sun-altitude "twilight window"
     drives a horizon-weighted violet cast that fades out in full day AND deep night.

   ENGINE-CORE LIFT CANDIDATE (SKY LAB → core): this file + its CPU driver (sun-altitude → strengths,
   sky-colour → haze tint, in engine.js) is the reusable unit. Lift shape: createAtmosphereGrade({
   hazeStrength, ozoneColor, ozoneStrength }) → { pass, update(sunAltY, skyColor) }. Parameterised on
   purpose so a project only WIRES + tunes it (engine-first; no one-off).
   ============================================================ */
precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform mat4  uInvProj;        // camera.projectionMatrixInverse — to rebuild the world ray
uniform mat4  uCamWorld;       // camera.matrixWorld
uniform float uSunAlt;         // sun altitude = sunArc.y  (∼ -1..1)
uniform vec3  uHazeColor;      // aerial-perspective tint (fed the current sky colour → auto day/night)
uniform float uHazeStrength;   // 0..1
uniform vec3  uOzoneColor;     // twilight cast (violet/magenta)
uniform float uOzoneStrength;  // 0..1

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;

  // rebuild the world view-ray → its ELEVATION (rd.y): 0 at the horizon, →1 overhead
  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 0.5, 1.0); v /= v.w;
  vec3 rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  float horizon = clamp(1.0 - smoothstep(0.0, 0.42, abs(rd.y)), 0.0, 1.0);   // peak at the horizon line, fade both ways (so it doesn't over-haze the ocean below)

  // AERIAL PERSPECTIVE: pull the horizon band toward the (desaturated) sky colour.
  vec3 col = mix(scene, uHazeColor, horizon * uHazeStrength);

  // OZONE TWILIGHT: violet cast inside the twilight window (sun near the horizon), horizon-weighted.
  // smoothstep(0.20,-0.05) rises as the sun sets; smoothstep(-0.5,-0.12) cuts it in deep night.
  float twilight = smoothstep(0.20, -0.05, uSunAlt) * smoothstep(-0.5, -0.12, uSunAlt);
  col += uOzoneColor * (twilight * (0.35 + 0.65 * horizon)) * uOzoneStrength;

  gl_FragColor = vec4(col, 1.0);
}
