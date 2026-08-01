/* ============================================================
   riso.frag — FIRST-PARTY. Effect mode: RISOGRAPH (the centerpiece).
   ------------------------------------------------------------
   Emulates the five signature traits of risograph printing:
     1. SPOT INKS      — up to 3 user-picked inks from the real Riso library (uInks/uInkCount).
     2. HALFTONE       — each ink is screened as dots at its own angle (15° + i·30° → 15/45/75, 30° apart).
     3. REGISTRATION   — each layer samples the source at a small offset (uReg), in a different
                          direction per layer, so the passes don't line up — the riso "charm".
     4. MULTIPLY       — translucent inks layered over cream paper: col *= (1 − cov·(1 − ink)),
                          so overlapping dots blend into secondary colours.
     5. GRAIN          — subtle paper/ink mottle (uGrain).

   SEPARATION (which ink, how much): project the source's OPTICAL DENSITY (−log reflectance) onto
   each ink's density direction. Physically-motivated (Beer–Lambert-ish), so each ink picks up the
   part of the image its own darkening explains — not a crude luminance duotone.

   GLSL ES 1.00 so it shares the vendored fullscreen.vert; uInks[i] is indexed by a loop variable
   (a constant-index-expression, allowed). Inherits masking + motion + export like every mode.
   ============================================================ */
precision highp float;

varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2      uResolution;
uniform vec3      uInks[3];      // selected ink colours (sRGB 0..1)
uniform int       uInkCount;     // 1..3
uniform float     uDot;          // halftone cell size (px)
uniform float     uReg;          // registration offset (px)
uniform float     uGrain;        // grain amount
uniform vec3      uPaper;        // paper colour (cream)

float hash(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }

/* Dot coverage (1 = full ink) for a screen at angle 'ang', dot growing with 'density'. */
float screen(vec2 uv, float density, float ang, float cell, vec2 res) {
  float a = radians(ang);
  mat2 R = mat2(cos(a), -sin(a), sin(a), cos(a));
  vec2 p = R * (uv * res);
  vec2 c = mod(p, cell) - cell * 0.5;
  float r = sqrt(clamp(density, 0.0, 1.0)) * cell * 0.62;
  return 1.0 - smoothstep(r - 1.0, r + 1.0, length(c));
}

void main() {
  float cell = max(2.0, uDot);
  vec3 col = uPaper;
  for (int i = 0; i < 3; i++) {
    if (i >= uInkCount) break;
    vec3 ink = uInks[i];
    // registration: sample the source offset per layer (different direction each)
    float ao = radians(float(i) * 120.0);
    vec2 off = vec2(cos(ao), sin(ao)) * uReg / uResolution;
    vec3 src = texture2D(uScene, vUv + off).rgb;
    // optical-density projection → this ink's coverage
    vec3 Dsrc = -log(clamp(src, 0.02, 1.0));
    vec3 Dink = -log(clamp(ink, 0.02, 1.0));
    float density = clamp(dot(Dsrc, Dink) / (dot(Dink, Dink) + 1e-3) * 1.25, 0.0, 1.0);
    float cov = screen(vUv, density, 15.0 + float(i) * 30.0, cell, uResolution);   // A19: 15/45/75 (three screens 30° apart) — was 35° (15/50/85 → inks 1&3 only 20° apart mod 90 → moiré). doc §5.1
    col *= (1.0 - cov * (1.0 - ink));           // translucent ink over the running colour
  }
  float g = (hash(floor(vUv * uResolution / 1.5)) - 0.5) * uGrain;
  gl_FragColor = vec4(clamp(col + g, 0.0, 1.0), 1.0);
}
