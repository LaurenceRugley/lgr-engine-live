// dust.vert — L94 ambient dust/pollen motes (extracted from dust.js inline GLSL, invariant 4).
// Drift + bob computed in the vertex kernel (zero CPU per frame); positions WRAP inside the volume box.
uniform float uTime, uHalf, uPx;
uniform float uWindOffset;       // L110 (audit B12): CPU-integrated wind displacement (∫(0.25+wind)·0.30 dt)
attribute float aPh, aSp;
varying float vSp;
void main() {
  vSp = aSp;
  vec3 p = position;
  float t = uTime * aSp;
  // gentle multi-axis bob + a steady down-wind drift on x; wrap inside the volume so the cloud persists.
  // L110 (audit B12): the drift is uWindOffset (integrated on the CPU), NOT uWind*uTime — the old product
  // slewed EVERY mote by (Δwind × elapsed) the instant the weather wind changed, teleporting the whole cloud.
  p.x += sin(t * 0.50 + aPh) * 0.55 + uWindOffset;
  p.y += sin(t * 0.35 + aPh * 1.7) * 0.22;
  p.z += cos(t * 0.45 + aPh) * 0.55;
  p.x = mod(p.x + uHalf, 2.0 * uHalf) - uHalf;
  p.z = mod(p.z + uHalf, 2.0 * uHalf) - uHalf;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = uPx * aSp * (300.0 / max(-mv.z, 0.1));   // perspective size attenuation
}
