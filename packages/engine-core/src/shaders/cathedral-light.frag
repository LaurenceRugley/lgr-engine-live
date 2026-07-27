/* ============================================================
   cathedral-light.frag — Lesson AB: volumetric god-ray shafts through a high window (maximum drama).
   ------------------------------------------------------------
   A dark interior with warm light pouring in from a high window and fanning DOWN into the nave as dusty
   shafts, with motes drifting in the beams. The ring's most dramatic scene and its deep-dark counterweight
   to Letterpress's bright paper.

   ── WHY THIS IS PACK-OWNED, NOT THE ENGINE'S godraysPass ──
   The engine already has a god-rays pass (createEngineCore.godraysPass), but it projects the sun to screen
   through the CITY camera (rig.camera) + the city SunRig — concepts a hero pack does not have — which is
   exactly why the hero director skips it unconditionally (createHeroDirector invariant 2). So rather than
   un-lean that city-coupled pass, this scene owns its light: the source is a fixed point in the pack's own
   screen space, and the shafts are computed here from THAT point. Lean stays lean; nothing reads the wrong
   camera.

   ── THE SHAFTS (radial scattering from one source, single pass) ──
   The light comes from uSource (a point just above the frame). For each pixel we look back along the ray to
   that source and read a noise field indexed by the RAY ANGLE — so the noise becomes streaks that fan out
   from the source, i.e. crepuscular rays. They are brightest near the window and fall off with distance
   (the beam scattering into the dark). A separate warm GLOW marks the window itself, and DUST motes drift
   down, lit only where they sit inside a shaft. Output is LINEAR and intentionally >1 in the bright core so
   the director's bloom (usesBloom:true) makes the light bleed — the drama.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uResolution;   // drawBuffer px — for aspect-correct distances
uniform vec2  uSource;       // where the light comes FROM, in uv (y>1 = above the frame)
uniform vec2  uWindow;       // the visible window centre (the warm glow), in uv
uniform vec3  uShadow;       // LINEAR dark ground
uniform vec3  uLight;        // LINEAR warm shaft colour (scaled up in-shader for HDR bloom)
uniform float uRayFreq;      // how many shafts fan out (angular frequency)
uniform float uDensity;      // overall shaft intensity
uniform float uFalloff;      // how fast the shafts fade from the source
uniform float uDust;         // dust-mote amount

/* hash + value noise + a little fbm — the inline pattern the other engine shaders use (no shared lib). */
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p *= 2.02; a *= 0.5; }
  return v;
}

void main() {
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 auv = vec2(vUv.x * aspect, vUv.y);          // aspect-corrected so shafts do not stretch
  vec2 asrc = vec2(uSource.x * aspect, uSource.y);
  vec2 awin = vec2(uWindow.x * aspect, uWindow.y);

  /* THE RAY BACK TO THE SOURCE. Its angle indexes the shaft noise; its length drives the falloff. */
  vec2 back = auv - asrc;
  float dist = length(back);
  float ang  = atan(back.y, back.x);

  /* SHAFTS — noise on the angle = streaks fanning from the source; the second axis drifts slowly along the
     beam so the shafts breathe rather than sit frozen. Two octaves at different angular scales = fine rays
     inside broad ones. */
  float s1 = fbm(vec2(ang * uRayFreq,        dist * 1.5 - uTime * 0.04));
  float s2 = fbm(vec2(ang * uRayFreq * 2.7,  dist * 2.5 + uTime * 0.02));
  float shaftNoise = s1 * 0.7 + s2 * 0.3;
  float shaft = smoothstep(0.35, 0.95, shaftNoise);

  /* FALLOFF — bright at the window, scattering away into the dark. */
  float fall = exp(-dist * uFalloff);
  float beams = shaft * fall * uDensity;

  /* DIRECTIONAL BIAS — this is what makes it CATHEDRAL light and not a sunburst. Favour rays that pour
     DOWN into the nave; dim the ones firing sideways/up. The back vector points from source to pixel, so a
     downward shaft has a negative y; -normalize(back).y is 1 straight down, 0 sideways. */
  float down = clamp(-normalize(back).y, 0.0, 1.0);
  beams *= mix(0.12, 1.0, smoothstep(0.15, 0.9, down));

  /* THE WINDOW — a warm glow where the light enters. Kept tight + mostly at the frame's top edge (the
     source sits just above the frame) so it reads as light ENTERING from a high opening, not a sun. */
  float wd = length(auv - awin);
  float glow = exp(-wd * wd * 44.0) * 1.7 + exp(-wd * 9.0) * 0.28;

  /* DUST — a few drifting motes, only visible where a shaft lights them. Cheap: hashed cells scrolled down
     slowly, a soft dot per cell, gated by the local beam intensity so they twinkle inside the light only. */
  vec2 dcell = auv * 26.0 + vec2(0.0, uTime * 0.5);
  vec2 gi = floor(dcell), gf = fract(dcell);
  float h = hash(gi);
  vec2 motePos = vec2(h, fract(h * 41.7));
  float mote = smoothstep(0.16, 0.0, length(gf - motePos)) * step(0.82, h);
  float dust = mote * (beams + glow * 0.2) * uDust;

  /* AMBIENT BOUNCE — a faint warm wash spilling from the opening into the nave. It reads as a lit interior
     rather than a black void, and (measured) it lifts the frame's MEAN warm enough to keep the scene mean-RGB
     DISTINCT from the ring's other near-black scenes (Aurora/Observatory) — a downscaled mean is blind to the
     bright-but-small shafts, so the dark scenes collapse together without this. It stays a WASH, not a fill:
     strongest near the opening, gone by the lower nave, so the drama (dark below, light above) survives. */
  float amb = exp(-dist * 0.8) * 0.16 + (1.0 - vUv.y) * 0.02;

  /* COMPOSE (LINEAR). Warm light scaled past 1 in the core so the director's bloom blooms it. */
  vec3 col = uShadow;
  col += uLight * (beams * 1.6 + glow + amb);
  col += uLight * dust * 3.0;

  gl_FragColor = vec4(max(col, 0.0), 1.0);
}
