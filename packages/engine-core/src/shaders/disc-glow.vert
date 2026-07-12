/* ============================================================
   disc-glow.vert — Constellation node (K2). Billboarded soft-glow disc.
   ------------------------------------------------------------
   Drawn as an InstancedMesh: one unit quad, N instances. Each instance's
   translation (its node position) rides in the auto-injected instanceMatrix;
   per-instance SIZE and twinkle PHASE ride in custom instanced attributes.

   Billboarding: we take the instance CENTRE in view space, then add the quad
   corner offset in the view XY plane — so every disc faces the camera regardless
   of the group's slow rotation.

   HOUSE CONVENTION (ShaderMaterial): Three auto-injects position/uv/matrices +
   precision AND instanceMatrix (USE_INSTANCING). We declare ONLY our own
   per-instance attributes/uniforms/varyings — declaring instanceMatrix here would
   be the K1 redefinition trap.
   ============================================================ */
uniform float uTime;

attribute float aSize;    // per-instance disc radius (world units at the node)
attribute float aPhase;   // per-instance twinkle phase offset

varying vec2  vUv;
varying float vPulse;

void main() {
  vUv = uv;

  /* Twinkle: brightness breathes 0.55 → 1.0, staggered by aPhase so the field
     never pulses in unison. */
  vPulse = 0.55 + 0.45 * (0.5 + 0.5 * sin(uTime * 1.5 + aPhase));

  /* Instance centre in view space (instanceMatrix = node translation). */
  vec3 centerView = (modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;

  /* Quad corner (PlaneGeometry(1,1): position.xy ∈ [-0.5, 0.5]) → camera-facing offset. */
  vec2 corner = position.xy * aSize;

  gl_Position = projectionMatrix * vec4(centerView + vec3(corner, 0.0), 1.0);
}
