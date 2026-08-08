/* ============================================================
   forge-asphalt.frag — ROAD SURFACE (family: asphalt). Arc A-ART.
   ------------------------------------------------------------
   Dark aggregate speckle over a near-flat matte base, a sparse worn-lane lightening down the
   travel path, and a thin hairline crack network — a city street read from a helicopter or street
   level, not a close-up. Deliberately LOW relief (roads are flat by construction; the Sobel normal
   should stay subtle, not cobblestone).
   ============================================================ */
#include './forge-common.glsl';

void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height) {
  // fine aggregate speckle — high-frequency but still >= the Nyquist floor at the recipe's chosen size.
  float speckle = fbm(uv * 30.0, 30.0, 3);
  // sparse hairline cracks — a light worley edge, much fainter than forge-stone's spalled-concrete cracks.
  vec2 w = worley(uv * 5.0, 5.0);
  float crack = 1.0 - smoothstep(0.0, 0.02, w.y - w.x);
  // a worn travel-lane band: brighter, smoother strip down the tile's long axis (tyres polish the surface).
  float laneDist = abs(fract(uv.x * 1.0 + 0.5) - 0.5) * 2.0;   // 0 at tile-centre-x, 1 at edges
  float lane = 1.0 - smoothstep(0.15, 0.55, laneDist);

  height = clamp(0.5 + 0.04 * speckle - 0.25 * crack, 0.0, 1.0);

  vec3 asphaltLo = vec3(0.045, 0.044, 0.043);
  vec3 asphaltHi = vec3(0.10, 0.098, 0.094);
  vec3 col = mix(asphaltLo, asphaltHi, clamp(0.3 + 0.6 * speckle, 0.0, 1.0));
  col = mix(col, col * 0.5, crack * 0.7);                 // cracks read as dark hairlines
  col = mix(col, vec3(0.135, 0.13, 0.122), lane * 0.35);  // the worn lane is lighter, greyer (rubber-polished)
  albedo = col;

  float ao = mix(0.75, 1.0, height);
  // the worn lane is smoother (polished by tyres); everywhere else stays rough matte asphalt.
  float rough = mix(0.72, 0.94, 1.0 - lane * 0.5);
  orm = vec3(ao, rough, 0.0);
}

#include './forge-emit.glsl';
