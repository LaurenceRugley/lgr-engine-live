/* ============================================================
   water-sim.frag — THE SIMULATION. This is the heart of Lesson 03.
   ------------------------------------------------------------
   It does NOT draw anything you see. It runs once per texel of a 256×256
   off-screen texture and computes the water's height at that point for the NEXT
   instant in time, from its height NOW and ONE STEP AGO. The visible water plane
   (water-surface.*) reads the texture this produces.

   WHY store the water in a texture instead of a JS array?
   Because the GPU computes all 65,536 texels in parallel, and every texel needs
   to read its neighbours' CURRENT heights. If we wrote into the same texture we
   were reading, texel A might read texel B's value before or after B updated —
   a race. So we read from one texture (uCurr/uPrev) and write to a SEPARATE one.
   The JS side rotates three such textures each frame: this is "ping-pong".

   THE MATH — the discrete 2D wave equation.
   A wave is just this rule: every point is pulled toward the average height of
   its neighbours, and it carries momentum so it overshoots (that's what makes it
   oscillate and ripple outward rather than just settling).
     • laplacian  = (left+right+up+down − 4·centre) — how far the centre sits
                    BELOW (or above) its neighbours' average. The restoring force.
     • next = 2·curr − prev + c²·laplacian   ← "Verlet" time integration.
              (2·curr − prev) is momentum: it keeps moving the way it was moving.
              c²·laplacian is the spring force that bends the surface back.
     • × damping (<1) each step bleeds a little energy so ripples eventually decay.

   STABILITY (the CFL / Courant condition): an explicit scheme like this blows up
   to infinity if the wave tries to cross more than ~one texel per step. For this
   5-point 2D stencil that means c² must stay ≲ 0.5. We use 0.25 — safely stable.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform sampler2D uCurr;          // heightfield NOW
uniform sampler2D uPrev;          // heightfield ONE STEP AGO
uniform vec2  uTexel;             // 1.0/resolution — the step to a neighbour texel
uniform vec2  uMouse;             // pointer position in 0..1 surface uv (a "drop")
uniform float uMouseStrength;     // >0 only while the pointer is poking the water
uniform float uC2;                // wave speed squared (keep ≤ 0.5 — see CFL above)
uniform float uDamping;           // <1, slow energy bleed so ripples fade

// L18 RAIN — the weather rig feeds the SAME drop path the mouse uses, but MANY at once: up to 8
// random raindrops per frame, each (uv.x, uv.y, strength). So rain genuinely stipples + ripples
// the real height field (the L03 FBO sim just gained a second input source, for free).
#define RAIN_MAX 8
uniform int  uRainCount;          // how many slots are live this frame
uniform vec3 uRainDrops[RAIN_MAX];

// L26 WAKES — water life feeds the EXACT same drop path: moving boats inject one impulse each at
// their position EVERY frame (a steady source the surface carries away → a V-wake trail), and fish/
// whale breaches inject a one-shot ring. Each slot is (uv.x, uv.y, strength). A boat displaces more
// water than a raindrop, so these get a slightly wider gaussian than the rain dimples.
#define WAKE_MAX 8
uniform int  uWakeCount;          // how many wake/breach slots are live this frame
uniform vec3 uWakeDrops[WAKE_MAX];
uniform vec4 uWash;               // L112: heli rotor DOWNWASH — (uv.x, uv.y, strength, sigma). strength<0 = a depression the sim radiates as rings; +0.10 one-shot = a splash crown on water-entry; 0 = off. PARAMETERIZED (unlike the baked-σ pools) so the radius widens with altitude.

void main() {
  // Sample the centre texel and its four neighbours from the CURRENT heightfield.
  // The render target uses ClampToEdge wrapping, so a neighbour sampled past the
  // edge returns the edge texel itself — which makes ripples REFLECT off the
  // walls (a "Neumann" / zero-slope boundary) instead of leaking away.
  float centre = texture2D(uCurr, vUv).r;
  float left   = texture2D(uCurr, vUv - vec2(uTexel.x, 0.0)).r;
  float right  = texture2D(uCurr, vUv + vec2(uTexel.x, 0.0)).r;
  float down   = texture2D(uCurr, vUv - vec2(0.0, uTexel.y)).r;
  float up     = texture2D(uCurr, vUv + vec2(0.0, uTexel.y)).r;
  float prev   = texture2D(uPrev, vUv).r;

  // The discrete laplacian: positive when the centre is in a dip (neighbours are
  // higher) → it should rise; negative when it is a peak → it should fall.
  float laplacian = left + right + up + down - 4.0 * centre;

  // Verlet step (see header) + global damping.
  float next = (2.0 * centre - prev + uC2 * laplacian) * uDamping;

  // Inject a smooth GAUSSIAN bump where the pointer is. Gaussian (a soft hill,
  // exp(−d²/2σ²)) not a single hot texel — a sharp spike would inject high
  // frequencies the grid can't represent and would destabilise the sim.
  float d = distance(vUv, uMouse);
  float sigma = 0.012;
  next += uMouseStrength * exp(-(d * d) / (2.0 * sigma * sigma));

  // RAIN: add each live raindrop as its own little gaussian dimple (tighter than the mouse).
  for (int i = 0; i < RAIN_MAX; i++) {
    if (i >= uRainCount) break;
    vec3 drop = uRainDrops[i];
    float rd = distance(vUv, drop.xy);
    next += drop.z * exp(-(rd * rd) / (2.0 * 0.006 * 0.006));
  }

  // WAKES (L26): boat impulses + breach rings, a touch wider than rain. Same gaussian-injection
  // idea — the moving boat source is laid down anew each frame, so the surface trails a wake.
  for (int i = 0; i < WAKE_MAX; i++) {
    if (i >= uWakeCount) break;
    vec3 w = uWakeDrops[i];
    float wd = distance(vUv, w.xy);
    next += w.z * exp(-(wd * wd) / (2.0 * 0.011 * 0.011));
  }

  // ROTOR DOWNWASH (L112): ONE parameterized gaussian — the craft's rotor pushes an air column onto the sea →
  // a sustained NEGATIVE depression under it (strength<0). The wave equation itself radiates the ring-train, and
  // the rebound-splash on climb-away is free. Same stencil as the pools, but strength+σ are DATA (altitude-driven).
  if (uWash.z != 0.0) {
    float washd = distance(vUv, uWash.xy);
    next += uWash.z * exp(-(washd * washd) / (2.0 * uWash.w * uWash.w));
  }

  // We only use the red channel as height; g/b unused, a=1.
  gl_FragColor = vec4(next, 0.0, 0.0, 1.0);
}
