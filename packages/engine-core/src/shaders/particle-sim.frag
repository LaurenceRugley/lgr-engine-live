/* ============================================================
   particle-sim.frag — Lesson M6: the GPU particle SIMULATION kernel (one texel = one particle).
   ------------------------------------------------------------
   Runs once per particle per frame over the ping-pong state textures (the same FBO-ping-pong pattern as
   water-flow-gpu.js — Rule 6, do NOT invent a different GPGPU style). ONE shader, two passes via uChannel:
     uChannel 0 → integrate VELOCITY: v += gravity*dt, then a light drag. (Only living particles; a dead
                  one — life <= 0 — is frozen so it can't drift toward NaN before its slot is recycled.)
     uChannel 1 → integrate POSITION + decay LIFE: p += v*dt, life -= dt.
   State packing:  uPos = (x, y, z, life)   ·   uVel = (vx, vy, vz, seed)
   The position pass reads the ALREADY-integrated velocity (the JS runs the vel pass first), so it is a
   symplectic (velocity-then-position) Euler step — the same integrator the CPU ballistics uses.
   ============================================================ */
precision highp float;
varying vec2 vUv;
uniform sampler2D uPos;
uniform sampler2D uVel;
uniform float uDt;
uniform vec3 uGravity;
uniform float uDrag;
uniform int uChannel;

void main() {
  vec4 pos = texture2D(uPos, vUv);
  vec4 vel = texture2D(uVel, vUv);
  float life = pos.w;
  if (uChannel == 0) {
    vec3 v = vel.xyz;
    if (life > 0.0) { v += uGravity * uDt; v *= (1.0 - uDrag * uDt); }
    gl_FragColor = vec4(v, vel.w);
  } else {
    vec3 p = pos.xyz;
    if (life > 0.0) { p += vel.xyz * uDt; life -= uDt; }
    gl_FragColor = vec4(p, life);
  }
}
