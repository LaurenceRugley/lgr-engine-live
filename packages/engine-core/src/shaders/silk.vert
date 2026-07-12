/* ============================================================
   silk.vert — Dusk Silk hero scene (K1).
   Vertex displacement for a flowing silk/wave surface.
   ------------------------------------------------------------
   Three layered displacement fields produce an organic wave surface:
     L1: long slow swells (primary fabric drape)
     L2: medium diagonal ripples (crossing weave)
     L3: smooth value-noise fine detail (silk texture)

   Passes vDisplacement (raw y-offset) to the fragment shader for
   the ink→gold→cream gradient. No lighting — color is entirely
   displacement-driven.

   HOUSE CONVENTION (ShaderMaterial): Three auto-injects `position`, `uv`,
   `projectionMatrix`, `modelViewMatrix`, and the default precision. Declaring
   them here is a REDEFINITION compile error → black canvas. We declare ONLY
   our own uniforms/varyings (see fullscreen.vert — the reference).
   ============================================================ */
uniform float uTime;

varying vec2 vUv;
varying float vDisplacement;

/* Smooth value noise — 2D hash + bilinear blend. */
float hash2(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise2(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  /* Quintic smoothstep for C2 continuity (smoother than cubic). */
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash2(i),               hash2(i + vec2(1.0, 0.0)), u.x),
    mix(hash2(i + vec2(0.0, 1.0)), hash2(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vUv = uv;
  float x = position.x;
  float z = position.z;
  float t = uTime;

  /* L1 — long slow swells: primary fabric drape (λ ≈ 25 units, T ≈ 18s). */
  float d1 = sin(x * 0.25 + t * 0.35) * cos(z * 0.18 + t * 0.26) * 1.8;

  /* L2 — medium diagonal ripple (λ ≈ 8 units, T ≈ 11s, 45° bias). */
  float d2 = sin((x * 0.55 + z * 0.40) + t * 0.57 + 1.2) * 0.9;

  /* L3 — smooth noise detail (fine silk texture). */
  float d3 = (noise2(vec2(x * 0.70 + t * 0.32, z * 0.70 + t * 0.24)) - 0.5) * 1.0;

  float disp = d1 + d2 + d3;
  vDisplacement = disp;

  vec3 displaced = position;
  displaced.y += disp;

  gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
}
