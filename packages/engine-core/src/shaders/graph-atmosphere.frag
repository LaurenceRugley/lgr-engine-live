// graph-atmosphere.frag — VIZ SLICE 5: a 3-octave FBM nebula at 2-6% luminance, plus a radial vignette.
//
// "The background does work." A graph on a flat black rectangle reads as a graph on a webpage; the same
// graph over a faint drifting nebula reads as something floating in space (section 8). The entire effect
// lives between 2% and 6% luminance -- if you can SEE it as a texture, it is too strong. It should only
// register when it is removed.
//
// FBM = fractal Brownian motion: sum octaves of value noise, each at double the frequency and roughly
// half the amplitude. Three octaves is plenty here because we are painting a whisper, not terrain.
// The noise is first-party (hash -> value noise -> fbm); no texture, no dependency, ~free.
//
// uDrift is scaled by the reduced-motion gate on the JS side (it goes to 0), so the nebula holds
// perfectly still for anyone who asked for that -- while the vignette and the tone remain, because
// those are composition, not motion.

precision highp float;

uniform float uTime;
uniform float uDrift;      // 0 = frozen (prefers-reduced-motion). Gates AUTONOMOUS drift only --
                           // uPan parallax stays live under reduced motion (it is camera-driven state).
uniform float uIntensity;  // peak luminance of the nebula (base band 0.02-0.06)
uniform vec3  uColorA;     // deep tone (THEME surface)
uniform vec3  uColorB;     // lift tone (THEME guide -- the muted plum from dusk's hemisphere)
uniform vec3  uColorC;     // cool counter-tone for patches/smudges (THEME jhat family, slice 9)
uniform vec3  uBg;         // the page background: what the vignette falls back to
uniform float uAspect;
uniform vec2  uPan;
uniform float uBandMul;   // slice 12: OBSERVATORY turns the sky up via params, not a shader fork
uniform float uDustMul;        // camera pan (world xz, scaled by JS) -- each layer samples it at its own
                           // RATE, faking depth parallax under an orthographic camera (real depth gives
                           // none on translation; rate-scaled domain offsets do). Rates mirror
                           // PARALLAX_RATES in graph-atmosphere.js.

varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

// Value noise: hash the four lattice corners, smoothstep-interpolate between them.
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * vnoise(p);
    p *= 2.02;      // not exactly 2.0: an irrational-ish step keeps octaves from aligning into grids
    amp *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = vUv - 0.5;
  p.x *= uAspect;                       // square the noise domain so clouds aren't stretched on wide screens

  vec2 q = p * 2.6 + vec2(uTime * 0.006 * uDrift, uTime * -0.004 * uDrift);
  float n = fbm(q + fbm(q * 1.7) * 0.35);   // domain warp: one fbm bends the other -> wispy, not blobby

  // GALAXY DUST (slice 8; slice 9 makes it TWO PARALLAX LAYERS) -- finer-octave fields drifting slower
  // than the nebula, each sampling uPan at its OWN rate: the near layer slides more than the far one as
  // the camera pans, and the depth illusion appears the moment the graph moves. Cubed: grain, not cloud.
  vec2 qd1 = p * 6.3 + uPan * 0.55 + vec2(uTime * 0.0022 * uDrift, uTime * 0.0016 * uDrift);
  vec2 qd2 = p * 10.7 + uPan * 0.25 + vec2(uTime * -0.0013 * uDrift, uTime * 0.0009 * uDrift);
  float dust = fbm(qd1);
  dust = dust * dust * dust * 0.35 * uDustMul;
  float dust2 = fbm(qd2);
  dust2 = dust2 * dust2 * dust2 * 0.22 * uDustMul;

  // NEBULA PATCHES (slice 9, owner-authorized notch-up) -- 2-3 larger soft blobs: a VERY low-frequency
  // field thresholded high, so only its rare peaks surface, tinted toward the cool counter-tone. Mid
  // parallax rate: they sit between the dust sheets.
  vec2 qp = p * 1.15 + uPan * 0.12 + vec2(uTime * 0.003 * uDrift, 0.0);
  float wisp = smoothstep(0.62, 0.85, fbm(qp)) * 0.5 * uDustMul;

  // GALAXY SMUDGES (slice 9) -- two tiny distant ellipses: rotated anisotropic gaussians with a faint
  // fbm arm texture. Fixed constants (one sky, deterministic), slow parallax (they are the far field).
  vec2 ps = p + uPan * 0.08;
  vec2 g1 = vec2((ps.x - 0.31) * 0.766 + (ps.y - 0.22) * 0.643, (ps.x - 0.31) * -0.643 + (ps.y - 0.22) * 0.766);
  float sm1 = exp(-(g1.x * g1.x * 90.0 + g1.y * g1.y * 900.0)) * (0.7 + 0.3 * fbm(g1 * 24.0));
  vec2 g2 = vec2((ps.x + 0.36) * 0.5 - (ps.y + 0.27) * 0.866, (ps.x + 0.36) * 0.866 + (ps.y + 0.27) * 0.5);
  float sm2 = exp(-(g2.x * g2.x * 140.0 + g2.y * g2.y * 1200.0)) * (0.7 + 0.3 * fbm(g2 * 24.0));
  float smudge = (sm1 + sm2) * 0.55;

  // GALACTIC BAND -- SCALES the fields (boost, not flat light). SLICE-9 CEILING: the owner asked for a
  // richer sky ("a little more... nebula and galaxies"), so the restraint cap moves ~10% -> ~18%
  // (boost <= 2.2 x the 0.06 base + patches). The judgment line stands: a beautiful telescope sky BEHIND
  // a graph, never nebula wallpaper -- the graph's quietest node must still outrank the sky's loudest px.
  float bandY = p.x * -0.342 + p.y * 0.940;      // rotate ~110 degrees: band runs lower-left -> upper-right
  float band  = exp(-bandY * bandY * 18.0);
  float boost = 1.0 + band * 1.2 * uBandMul;

  // Radial vignette: full nebula at the centre, falling to bare background at the corners.
  float r   = length(p);
  float vig = 1.0 - smoothstep(0.15, 0.95, r);

  vec3 neb = mix(uColorA, uColorB, n);
  vec3 col = uBg
           + neb * (n * n) * uIntensity * boost * vig                      // n*n biases dark: void + wisp
           + uColorB * dust  * uIntensity * boost * vig                    // near dust sheet (fast parallax)
           + mix(uColorB, uColorC, 0.5) * dust2 * uIntensity * boost * vig // far dust sheet (slow parallax)
           + mix(uColorB, uColorC, 0.7) * wisp * uIntensity * 1.6 * vig   // nebula patches, cool-leaning
           + mix(uColorC, vec3(1.0), 0.35) * smudge * uIntensity * 1.8 * vig; // distant galaxy smudges

  gl_FragColor = vec4(col, 1.0);
}
