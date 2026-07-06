/* ============================================================
   post-godrays.frag (L107) — screen-space CREPUSCULAR RAYS ("god rays"), half-res.
   ------------------------------------------------------------
   The light shafts you see when a low sun sits behind buildings. The classic Kenny-Mitchell
   (GPU Gems 3) radial-blur fake: from each output pixel, walk a fixed number of samples along the
   line TOWARD the sun's screen position, accumulating brightness from a high-threshold bright buffer
   (sun + sky only) with per-tap decay. Buildings already occlude the sun in that bright buffer, so
   the occlusion — the whole reason shafts look 3D — comes FREE.

   C++ anchor: a pure GATHER post kernel — for each pixel, a fixed-N loop stepping a `uv` iterator
   toward `uSunUv`, `sum += tex(uv) * pow(decay, i)`. No scatter, no sync; mobile-safe (fixed N).

   Beauty-tier only: the pass never RUNS outside beauty (gated in createEngine), and the composite in
   post-filmic multiplies the result by uRays=0 on stylized frames → byte-identical. Tinted warm for
   free by the existing L67 grade (Rule 2: no new colour uniform here). Governor sheds it first.
   ============================================================ */
precision highp float;

uniform sampler2D uBright;   // the high-threshold bright pass (sun + sky, half-res)
uniform vec2  uSunUv;        // the sun's position in UV space [0,1]
uniform float uDensity;      // share of the pixel→sun distance the march covers (~0.9)
uniform float uDecay;        // per-tap falloff (~0.96 → shafts fade with distance from the sun)
uniform float uWeight;       // per-tap gain (~0.05)

varying vec2 vUv;

const int STEPS = 48;        // fixed loop count — mobile-safe (no dynamic loop bound)

void main() {
  vec2 duv = (vUv - uSunUv) * (uDensity / float(STEPS));   // one step of the march, pixel→sun
  vec2 uv = vUv;
  float sum = 0.0, illum = 1.0;
  for (int i = 0; i < STEPS; i++) {
    uv -= duv;                                             // step toward the sun
    sum += texture2D(uBright, uv).r * illum * uWeight;     // gather brightness, decayed
    illum *= uDecay;
  }
  gl_FragColor = vec4(vec3(sum), 1.0);                     // grayscale shafts; the filmic grade tints them warm
}
