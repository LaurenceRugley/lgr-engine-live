/* ============================================================
   particle-spawn.frag — Lesson M6: SPAWN new particles into a RING region of the state textures.
   ------------------------------------------------------------
   The JS restricts WHICH texels this writes with a SCISSOR rectangle (the ring cursor's slice), so this
   shader never needs a range test and never reads the target — every texel it touches is a brand-new
   particle. ONE shader, three channels (uChannel) so it can fill each state texture:
     0 → POSITION + life : the emitter point (+ a little jitter), life reset to uLife.
     1 → VELOCITY + seed : a random direction inside a cone around uEmitDir, speed uSpeed(±uSpeedVar).
     2 → COLOR + size    : the preset colour + a jittered point size (packed into .w).
   Randomness is a per-texel hash of gl_FragCoord + uSeed — stable within a frame, different per slot, and
   free (no CPU RNG, no upload). uCone in [0,1]: 0 = a tight beam along uEmitDir, 1 = a full sphere.
   ============================================================ */
precision highp float;
varying vec2 vUv;
uniform int uChannel;
uniform vec3 uEmitPos;
uniform vec3 uEmitDir;
uniform float uSpeed;
uniform float uSpeedVar;
uniform float uCone;
uniform float uLife;
uniform float uSize;
uniform vec3 uColor;
uniform float uSeed;
uniform float uPosJitter;

vec3 hash33(vec3 p3) {
  p3 = fract(p3 * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yxz + 33.33);
  return fract((p3.xxy + p3.yxx) * p3.zyx);
}

void main() {
  vec3 h = hash33(vec3(gl_FragCoord.xy, uSeed));
  if (uChannel == 0) {
    gl_FragColor = vec4(uEmitPos + (h - 0.5) * uPosJitter, uLife);
  } else if (uChannel == 1) {
    vec3 rnd = normalize(h * 2.0 - 1.0 + vec3(0.0001));           // a uniform-ish random unit vector
    vec3 dir = normalize(mix(normalize(uEmitDir), rnd, uCone));    // blend toward random by the cone width
    float sp = uSpeed * (1.0 + (h.x - 0.5) * 2.0 * uSpeedVar);
    gl_FragColor = vec4(dir * sp, h.y);
  } else {
    gl_FragColor = vec4(uColor, uSize * (0.7 + h.z * 0.6));
  }
}
