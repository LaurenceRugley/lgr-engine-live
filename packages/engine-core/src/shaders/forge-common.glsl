/* ============================================================
   forge-common.glsl — the TEXTURE FORGE shared header + periodic-noise library.
   ------------------------------------------------------------
   INCLUDED FIRST by every surface family shader (forge-ground/bark/stone/woodscrap.frag).
   It declares the bake uniforms + varying, then a small library of noise primitives that all
   TILE SEAMLESSLY BY CONSTRUCTION. That last property is the enabling trick of the whole forge:
   a texture that will be REPEATed across a floor must have no visible seam at the wrap, and the
   cheap way to guarantee that is not to blur seams afterwards but to build the noise on a lattice
   that WRAPS. Every primitive here takes a period 'per' (in lattice cells) and folds its hash
   index with mod(i, per); sampling the same [0,1] UV the bake covers then tiles perfectly.
   (Technique mined from claude-of-duty src/materials/glsl/noise.js — MIT; re-implemented here.)

   C++ anchor: think of each noise() as a pure kernel over a 2-D integer lattice; 'per' makes the
   lattice a torus (index i and i+per are the same cell), so the field is periodic like a
   fixed-size ring buffer read modulo its length.

   THE NYQUIST RULE (the single most important lesson — ship it, obey it):
   a noise band whose smallest feature is under ~6.4 texels bakes as WHITE NOISE — salt-and-pepper
   at mip 0, flat grey once mipped ("sandpaper up close, featureless at 2 m"). So every family must
   keep its finest meaningful band at >= ~6.4 texels. At a 1024 bake that is a period <= ~160 cells
   for the finest fbm octave. Design the composition to READ at 1-2 m, not at 1 cm — that is the
   honest ceiling of generating texture from code.
   ============================================================ */

// ---- bake uniforms (set per recipe by createTextureForge.js) ----
uniform int   uChannel;     // which output this pass wants: 0 = albedo, 1 = ORM, 2 = height
uniform float uSeed;        // recipe seed — the ONLY knob that makes a distinct variant of a family
uniform float uWorldSize;   // metres this 0..1 tile covers in world space (sets feature scale + normal slope)
uniform float uRelief;      // height amplitude in metres (feeds the Sobel normal pass, physically)

varying vec2 vUv;           // 0..1 across the bake quad — the texel we are computing

// ---- hashes (cheap, deterministic; the seed rides in so a recipe reseeds the whole field) ----
float hash1(vec2 p) {
  p += uSeed;
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}
vec2 hash2(vec2 p) {
  p += uSeed;
  return fract(sin(vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)))) * 43758.5453);
}

// ---- PERIODIC value noise: hash the 4 lattice corners (each folded mod per) + smoothstep blend ----
float vnoise(vec2 x, float per) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * (3.0 - 2.0 * f);               // smoothstep — C1 continuity, no lattice creases
  float a = hash1(mod(i + vec2(0.0, 0.0), per));
  float b = hash1(mod(i + vec2(1.0, 0.0), per));
  float c = hash1(mod(i + vec2(0.0, 1.0), per));
  float d = hash1(mod(i + vec2(1.0, 1.0), per));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// ---- PERIODIC fractal brownian motion: octaves of vnoise, period doubling with frequency ----
// Returns ~[0,1]. 'oct' octaves; 'per' is the period of the BASE octave (each octave doubles it,
// so the whole stack stays periodic over the base tile).
float fbm(vec2 x, float per, int oct) {
  float sum = 0.0, amp = 0.5, nrm = 0.0;
  vec2 p = x; float pr = per;
  for (int i = 0; i < 8; i++) {
    if (i >= oct) break;
    sum += amp * vnoise(p, pr);
    nrm += amp;
    p *= 2.0; pr *= 2.0; amp *= 0.5;
  }
  return sum / max(nrm, 1e-4);
}

// ---- PERIODIC Worley (cellular) noise: distance to the nearest feature point per cell ----
// F1 = nearest, F2 = second nearest. Cracks/pebbles/plaster spall come from F2-F1 and 1-F1.
vec2 worley(vec2 x, float per) {
  vec2 i = floor(x), f = fract(x);
  float f1 = 8.0, f2 = 8.0;
  for (int oy = -1; oy <= 1; oy++)
    for (int ox = -1; ox <= 1; ox++) {
      vec2 g = vec2(float(ox), float(oy));
      vec2 o = hash2(mod(i + g, per));            // feature point jittered inside its cell
      vec2 r = g + o - f;
      float d = dot(r, r);
      if (d < f1) { f2 = f1; f1 = d; }
      else if (d < f2) { f2 = d; }
    }
  return vec2(sqrt(f1), sqrt(f2));
}

// ---- domain WARP: push the sample point by a low-freq fbm so bands bend organically (no grid look) ----
vec2 warp(vec2 x, float per, float amt) {
  return x + amt * vec2(fbm(x + 3.7, per, 3), fbm(x + 8.3, per, 3));
}

// ---- ridged noise: 1 - |signed noise|, sharpened — bark ridges, plank grain, dune crests ----
float ridge(vec2 x, float per, int oct) {
  float n = fbm(x, per, oct);
  float r = 1.0 - abs(n * 2.0 - 1.0);
  return r * r;
}

// The family shader that includes this file must define:
//   void surface(vec2 uv, out vec3 albedo, out vec3 orm, out float height);
// (orm = ambient-occlusion, roughness, metalness — the glTF ORM channel order.)
// forge-emit.glsl (included LAST) provides main() and routes the right channel to gl_FragColor.
