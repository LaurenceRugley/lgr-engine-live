/* ============================================================
   milkyway.frag — FIRST-PARTY. A Milky Way band + fine star dust (SKY LIFT §4, upgraded by LIFT #2).
   ------------------------------------------------------------
   A post-pass right after the sky render (so the CLOUDS composite over it and occlude it, and it BLOOMS
   with everything else). Only active at night (uNightK). It draws:
     • a soft galactic BAND along a tilted great circle (view-ray distance to the galactic plane), built as
       a tight bright SPINE + a wide faint HALO so the edge glows instead of ending in a hard stripe;
     • a warm galactic CORE — the Sagittarius bulge toward GAL_C is dramatically brighter + golden, the way
       the real core outshines the cool blue-white outer arms;
     • patchy STAR CLOUDS (low-freq FBM clumps) carved by dark DUST LANES (the Great Rift) so it reads as
       unresolved cloud, not paint;
     • a dense field of FINE STARS (two layers: sparse bright pinpoints + a faint field hugging the band)
       with a gentle twinkle, on top of the engine's sprite starfield.
   The star sample ray is rotated by uStarRot (Earth's sidereal spin — feed it createCelestial.starRotMatrix)
   so the whole galaxy + star field WHEELS about the celestial pole as the day advances; identity = no spin.

   ⛔ BYTE-IDENTICAL NO-OP DEFAULT: uIntensity=0 → the additive term is *0 = passthrough (the manifest
   flagged the source had no intensity uniform — one was ADDED, default 0). The shader also early-outs when
   uNightK < 0.02 (day) or below the horizon. DESKTOP-BEAUTY-ONLY in an HDR composer (half-float finding).
   ============================================================ */
precision highp float;

varying vec2 vUv;
uniform sampler2D tDiffuse;
uniform mat4  uInvProj;
uniform mat4  uCamWorld;
uniform float uNightK;     // 0 day -> 1 night
uniform float uIntensity;  // overall gain — DEFAULT 0 = byte-identical passthrough (the no-op gate)
uniform float uTime;
uniform mat4  uStarRot;    // sidereal rotation of the star sphere (Earth's spin); identity = no spin
uniform vec3  uArmColor;   // cool blue-white of the outer arms
uniform vec3  uCoreColor;  // warm gold of the dense galactic core (Sagittarius bulge)
uniform float uBandWidth;  // half-width of the faint halo band (spine is a fixed fraction of it)

// galactic plane normal (fixed tilt) — the band arcs across the sky perpendicular to this.
const vec3 GAL_N = vec3(0.34, 0.62, 0.71);
// galactic CENTRE direction (on the plane) — the bright bulge sits here; brightness peaks toward it.
const vec3 GAL_C = vec3(-0.90, 0.0, 0.43);

float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = hash13(i), n100 = hash13(i + vec3(1,0,0)), n010 = hash13(i + vec3(0,1,0)), n110 = hash13(i + vec3(1,1,0));
  float n001 = hash13(i + vec3(0,0,1)), n101 = hash13(i + vec3(1,0,1)), n011 = hash13(i + vec3(0,1,1)), n111 = hash13(i + vec3(1,1,1));
  return mix(mix(mix(n000,n100,f.x), mix(n010,n110,f.x), f.y), mix(mix(n001,n101,f.x), mix(n011,n111,f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; } return s; }

void main() {
  vec3 scene = texture2D(tDiffuse, vUv).rgb;
  if (uNightK < 0.02) { gl_FragColor = vec4(scene, 1.0); return; }

  vec4 v = uInvProj * vec4(vUv * 2.0 - 1.0, 0.5, 1.0); v /= v.w;
  vec3 rd = normalize((uCamWorld * vec4(v.xyz, 0.0)).xyz);
  if (rd.y < -0.05) { gl_FragColor = vec4(scene, 1.0); return; }   // below the horizon → keep the lit ground/clouds

  // ROTATE the star sphere with Earth's spin: sample the galaxy + fine stars along the SIDEREALLY rotated
  // ray 'rs', not the raw view ray. (Identity uStarRot = no rotation = the pre-lift-#2 behaviour.)
  vec3 rs = normalize((uStarRot * vec4(rd, 0.0)).xyz);

  vec3 gal = normalize(GAL_N);
  float toPlane = abs(dot(rs, gal));                              // 0 on the galactic great circle
  // TWO bands — a tight bright spine + a wide faint halo — give the band a soft-edged glow, not a hard stripe.
  float spine = clamp(uBandWidth * 0.5, 0.02, 0.5);
  float bandCore = 1.0 - smoothstep(0.0, spine, toPlane);
  float bandWide = 1.0 - smoothstep(0.0, uBandWidth, toPlane);
  // the galactic CORE (bulge) is dramatically brighter than the outer arms — a soft lobe toward GAL_C.
  float centre = pow(max(0.0, dot(rs, normalize(GAL_C))), 2.2);

  // structure: large clumps of star-cloud + patchy DARK DUST LANES (the Great Rift) carved through the band.
  float clump = fbm(rs * 3.0 + vec3(11.3, 4.1, 7.7));
  float lanes = smoothstep(0.30, 0.72, fbm(rs * 6.5 + vec3(3.0, 9.0, 1.0)));   // 0 = dark rift, 1 = clear

  float glow = (bandCore * (0.55 + 1.7 * centre) + bandWide * 0.30) * mix(0.22, 1.0, clump);
  glow *= mix(0.28, 1.0, lanes);                                  // dust lanes bite dark channels through it

  // colour: cool arms → warm golden bulge in the dense core
  vec3 mw = mix(uArmColor, uCoreColor, clamp(centre * 1.3 + clump * 0.25, 0.0, 1.0)) * glow;

  // STARS — two layers: sparse bright pinpoints everywhere + a denser faint dust concentrated in the band,
  // so the band reads as unresolved star clouds. Gentle twinkle.
  float sf = hash13(floor(rs * 620.0));
  float bright = smoothstep(0.9970, 1.0, sf);
  float sf2 = hash13(floor(rs * 1300.0) + 7.0);
  float faint = smoothstep(0.9955, 1.0, sf2) * (0.15 + 0.85 * bandWide);        // faint field hugs the band
  float twinkle = 0.6 + 0.4 * sin(uTime * 3.0 + sf * 6.2831);
  vec3 stars = vec3(bright * twinkle + faint * 0.6);

  vec3 add = (mw * 0.65 + stars) * uNightK * uIntensity;          // uIntensity 0 → byte-identical passthrough
  gl_FragColor = vec4(scene + add, 1.0);
}
