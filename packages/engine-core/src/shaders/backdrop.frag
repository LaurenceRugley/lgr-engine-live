/* ============================================================
   backdrop.frag — the FRAGMENT shader for the backdrop plane.
   Runs ONCE PER FRAGMENT (≈ once per pixel the plane covers). Its one
   required job: set gl_FragColor (this pixel's red/green/blue/alpha).
   ============================================================ */

// PRECISION. GLSL makes us declare how many bits floats get. `highp` = high
// precision — safe for smooth gradients and time that grows large. (Vertex
// shaders default to highp; fragment shaders don't, so we say it explicitly.)
precision highp float;

// The SAME varying we wrote in the vertex shader, received here already
// interpolated per-pixel. At the left edge vUv.x≈0, at the right edge ≈1.
varying vec2 vUv;

// UNIFORMS — values our JS pushes in, constant for the whole frame. `uTime`
// animates; `uInk`/`uGold` are the two palette ends. Driving colour from
// uniforms means we can restyle from JS without editing/recompiling GLSL.
uniform float uTime;
uniform vec3  uInk;
uniform vec3  uGold;

// L20 CHARM FOG (sky half): when it's foggy the sky melts into the same haze colour as the city,
// and an ORDERED (Bayer) dither bands the gradient — so the backdrop carries the 32/64-bit charm
// banding John loves, exactly where the reference mock shows it (the sky). uFogAmt scales the melt,
// uFogCharm scales the banding; both 0 in clear weather, so the normal sky is untouched.
uniform vec3  uFogColor;
uniform float uFogAmt;
uniform float uFogCharm;
float bayer2(vec2 q){ return 2.0 * q.x + 3.0 * q.y - 4.0 * q.x * q.y; }
float bayer4(vec2 c){ vec2 p = floor(mod(c, 4.0));
  return (4.0 * bayer2(floor(p / 2.0)) + bayer2(mod(p, 2.0))) / 16.0; }

void main() {
  // A slow diagonal wave: combine both UV axes plus time so the band drifts.
  // sin() returns -1..1; the 0.5 + 0.5* remaps it to a clean 0..1 weight.
  float wave = 0.5 + 0.5 * sin(vUv.x * 3.0 + vUv.y * 2.0 + uTime * 0.3);

  // A second, slower wave on a different frequency layered in — two sines beat
  // against each other so the motion never looks like one obvious sweep.
  wave *= 0.6 + 0.4 * sin(vUv.y * 4.0 - uTime * 0.15);

  // CHARM: quantise the gradient weight into bands with an ordered-dither threshold (fog only).
  float bands = 6.0;
  float d = bayer4(gl_FragCoord.xy) - 0.5;
  float banded = clamp(floor(wave * bands + 0.5 + d) / bands, 0.0, 1.0);
  wave = mix(wave, banded, uFogCharm);

  // The two gradient ends, melted toward the fog haze when foggy (so the sky matches the city).
  vec3 ink  = mix(uInk, uFogColor, uFogAmt);
  vec3 gold = mix(uGold * 0.5, uFogColor * 1.25, uFogAmt);   // a touch brighter at the top band
  vec3 colour = mix(ink, gold, wave * 0.45);

  gl_FragColor = vec4(colour, 1.0); // rgb + full alpha
}
