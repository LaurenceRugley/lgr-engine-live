/* ============================================================
   forge-normal.frag — height field -> tangent-space normal map (3x3 Sobel).
   ------------------------------------------------------------
   The FOURTH bake pass. It reads the height scratch target the family shader wrote (channel 2) and
   turns its slope into a normal map so the lit surface catches raking light with real relief —
   without this the albedo alone reads as a flat painted decal.

   Sobel gives a smooth gradient (dH/du, dH/dv) from a 3x3 neighbourhood. The gradient is in
   texels, so it must be converted to a PHYSICAL slope: relief metres over world metres. A given
   height field mapped over 4 m produces a gentler normal than the same field over 0.4 m, and that
   is correct — the normal strength has to track the mapping scale or a re-tiled material looks
   wrong. That is why the pass takes uRelief and uWorldSize (same values the recipe baked with).

   Output is OpenGL convention (+Y up), packed to [0,1] the way three's normalMap sampler expects.
   C++ anchor: a discrete gradient operator over a 2-D array, then a basis change from image space
   to the surface tangent frame.
   ============================================================ */
precision highp float;

uniform sampler2D uHeight;  // the height scratch target (R = height, 0..1)
uniform vec2  uTexel;       // 1/size — one texel step in UV
uniform float uRelief;      // height amplitude in metres
uniform float uWorldSize;   // metres the tile covers

varying vec2 vUv;

float h(vec2 uv) { return texture2D(uHeight, uv).r; }

void main() {
  vec2 t = uTexel;
  // 3x3 Sobel taps around vUv (wrap is handled by the target's RepeatWrapping so the normal tiles too).
  float tl = h(vUv + vec2(-t.x,  t.y)), tc = h(vUv + vec2(0.0,  t.y)), tr = h(vUv + vec2(t.x,  t.y));
  float ml = h(vUv + vec2(-t.x, 0.0)),                                  mr = h(vUv + vec2(t.x, 0.0));
  float bl = h(vUv + vec2(-t.x, -t.y)), bc = h(vUv + vec2(0.0, -t.y)), br = h(vUv + vec2(t.x, -t.y));

  float dx = (tr + 2.0 * mr + br) - (tl + 2.0 * ml + bl);   // d height / d u  (in height units per 2 texels)
  float dy = (tl + 2.0 * tc + tr) - (bl + 2.0 * bc + br);   // d height / d v

  // Physical slope: (relief metres * dH) spread over (worldSize metres * texel span). The 8.0 is the
  // Sobel kernel weight sum for the two-sided difference; folding uTexel converts per-texel to per-UV.
  float metresPerTexelU = uWorldSize * uTexel.x;
  float metresPerTexelV = uWorldSize * uTexel.y;
  float sx = (uRelief * dx / 8.0) / max(metresPerTexelU, 1e-5);
  float sy = (uRelief * dy / 8.0) / max(metresPerTexelV, 1e-5);

  vec3 n = normalize(vec3(-sx, -sy, 1.0));   // slope -> surface normal (OpenGL +Y up)
  gl_FragColor = vec4(n * 0.5 + 0.5, 1.0);   // pack [-1,1] -> [0,1] for the normalMap sampler
}
