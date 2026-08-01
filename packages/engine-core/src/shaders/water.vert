/* ============================================================
   water.vert (A12 pond/lake + A13 OCEAN) — a contextual water surface on top of the ground.
   ------------------------------------------------------------
   Pond/lake: a flat disc (uWaveAmp = 0) shaded per-fragment (ripple normal in the .frag). Ocean: the SAME
   surface, tessellated, with GERSTNER swell displacement (docs/ocean-spec.md). Gerstner is VERTEX-DOMAIN
   math — a sum of sinusoidal displacements whose surface normal is the ANALYTIC derivative of that same
   sum — so it needs NO textures and NO render targets (mobile-safe by construction, like the rest of this
   shader). LOD: swell amplitude fades with view distance so the horizon flattens (no aliasing, no
   projected-grid). Carries the shore-depth (colour ramp + soft shoreline), the wave CREST factor (analytic
   foam in the .frag), the macro NORMAL, and the view vector (fog).
   ============================================================ */
precision highp float;

attribute float aShoreDepth;

uniform float uTime;
uniform float uWaveAmp;      // 0 = flat (pond/lake). > 0 = ocean swell amplitude (world units)
uniform vec2  uSwellDir;     // primary swell direction (xz), unit-ish
uniform float uWavelength;   // base swell wavelength (world units)
uniform float uSteepness;    // 0..1 crest sharpness (Gerstner Q, clamped in-shader so peaks never loop)
uniform float uWaveSpeed;    // phase speed multiplier
uniform float uLodNear;      // full swell within this view distance
uniform float uLodFar;       // swell faded to flat beyond this (the horizon)

varying float vDepth;
varying vec3  vWorldPos;     // DISPLACED world position (ripple + fog use the real surface)
varying vec3  vView;         // camera -> fragment, un-normalised (length = view distance for fog)
varying vec3  vMacroNormal;  // the analytic Gerstner normal (up-vector when flat)
varying float vCrest;        // summed sin(phase) — high at wave crests (feeds analytic foam)

// rotate a 2D dir by angle a.
vec2 rot2(vec2 d, float a) { float c = cos(a), s = sin(a); return vec2(c * d.x - s * d.y, s * d.x + c * d.y); }

void main() {
  vDepth = aShoreDepth;
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;   // undisplaced world position
  vec3 macroN = vec3(0.0, 1.0, 0.0);
  vCrest = 0.0;

  if (uWaveAmp > 0.0001) {
    // LOD: fade the swell to flat toward the horizon (distance from the camera in XZ).
    float dist = length(cameraPosition.xz - wp.xz);
    float lod = 1.0 - smoothstep(uLodNear, uLodFar, dist);

    vec2 baseDir = normalize(uSwellDir);
    vec3 disp = vec3(0.0);
    vec3 nAccum = vec3(0.0);   // normal partials (GPU Gems Gerstner)
    // 4 waves: the main swell + 3 progressively shorter/steeper/rotated chop harmonics.
    for (int i = 0; i < 4; i++) {
      float fi = float(i);
      float wl  = uWavelength * pow(0.55, fi);                 // shorter each harmonic
      float amp = uWaveAmp * pow(0.62, fi) * lod;              // smaller each harmonic, LOD-faded
      vec2  dir = rot2(baseDir, (fi - 1.5) * 0.6);             // spread the harmonic directions
      float k   = 6.2831853 / max(wl, 0.5);                    // 2*pi / wavelength
      float w   = sqrt(9.8 * k) * uWaveSpeed;                  // deep-water dispersion, speed-scaled
      float Q   = uSteepness / max(k * amp * 4.0, 1e-3);       // steepness, clamped so crests don't loop
      float ph  = k * dot(dir, wp.xz) - w * uTime;
      float c = cos(ph), s = sin(ph);
      disp.x += Q * amp * dir.x * c;
      disp.z += Q * amp * dir.y * c;
      disp.y += amp * s;
      float wa = k * amp;
      nAccum.x += dir.x * wa * c;
      nAccum.z += dir.y * wa * c;
      nAccum.y += Q * wa * s;
      vCrest   += s * (amp / max(uWaveAmp, 1e-3));             // normalised crest contribution
    }
    wp += disp;
    macroN = normalize(vec3(-nAccum.x, 1.0 - nAccum.y, -nAccum.z));
  }

  vWorldPos = wp;
  vMacroNormal = macroN;
  vView = cameraPosition - wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
