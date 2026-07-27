/* ============================================================
   caustics.frag — Lesson W: the light on the bottom of a swimming pool.
   ------------------------------------------------------------
   Caustics are what happens when a wavy surface acts as a lens. The water isn't glowing; it's
   FOCUSING sunlight, and where many rays happen to converge you get those searing bright filaments,
   with dimmer gaps between. The physically-honest way to compute that is to trace photons through a
   refracting surface and accumulate where they land — far too expensive for a hero.

   So this fakes the *structure* rather than the physics, and the trick is worth knowing:

   WORLEY (cellular) NOISE gives you a field of scattered feature points where the value is the
   DISTANCE to the nearest point. Its ridges — the places equidistant from two points — form exactly
   the branching, closed-cell web that caustics make. Take 1 - distance, raise it to a high power,
   and the soft ridge becomes a thin searing filament. Two octaves, drifting against each other and
   warped over time, and the web writhes the way a real one does.

   CHROMATIC SPLIT: real caustics fringe slightly — water refracts blue a hair more than red — so we
   sample the web at three slightly different scales for R/G/B. It costs two extra evaluations and it
   is the single detail that stops this reading as "a green pattern".

   ── DISTINCTNESS FROM AURORA (the brief required this, Rule 6) ────────────────
   Aurora is the ring's other abstract fragment scene, so the two must not collapse:
     STRUCTURE  Aurora = smooth VERTICAL CURTAINS (a 1-D vertical envelope, shimmering).
                This = a CELLULAR WEB — closed cells, branching filaments, no preferred direction.
     EDGE       Aurora is soft everywhere by design. This is SHARP: the whole point is the searing
                thin ridge (pow(...) ~14) against a dim floor.
     HUE        Aurora is gold/cream on ink. This is aqua/white on a lit blue floor.
   Soft warm bands versus a hard cyan net: same technique family, unmistakably different pictures.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uRes;
uniform vec3  uDeep;    // the water far from the light
uniform vec3  uShallow; // the lit floor
uniform vec3  uCaustic; // the filament colour
uniform float uSharp;   // ridge exponent — how thin/searing the filaments are

/* Hash a cell to a jittered feature point. */
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}

/* Worley / cellular — returning the TWO nearest distances (F1, F2), not just the nearest.
   The points DRIFT with time (that's the water moving), so the whole web is alive. */
vec2 worley2(vec2 p, float t) {
  vec2 cell = floor(p);
  vec2 f    = fract(p);
  float f1 = 1e9, f2 = 1e9;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 o = hash2(cell + g);
      /* Each feature point orbits its own little circle — the surface never stops rippling. */
      o = 0.5 + 0.5 * sin(t + 6.2831 * o);
      float d = length(g + o - f);
      if (d < f1) { f2 = f1; f1 = d; }        // keep the two smallest
      else if (d < f2) { f2 = d; }
    }
  }
  return vec2(f1, f2);
}

/* ONE OCTAVE OF THE WEB — and getting this right is the whole scene.
   The first cut brightened 1 - F1, which peaks AT each feature point. That draws glowing DOTS, and
   the scene came out looking like bokeh / plankton — pretty, and not remotely a caustic.
   A caustic filament is not a point, it is a BORDER: the set of places equidistant from two feature
   points, where light focused by neighbouring parts of the surface piles up. That set is exactly where
   F2 - F1 → 0. So the web is the CELL EDGES, and the thin searing line comes from sharpening how fast
   that gap opens up. Same noise function, opposite feature — dots become a net. */
float web(vec2 p, float t, float sharp) {
  vec2 f = worley2(p, t);
  float gap = f.y - f.x;                       // 0 on a cell border, grows toward a cell's interior
  float edge = 1.0 - clamp(gap * 2.6, 0.0, 1.0);
  return pow(edge, sharp * 0.55);
}

void main() {
  vec2 uv = vUv;
  uv.x *= uRes.x / max(uRes.y, 1.0);   // keep the cells square on any aspect

  float t = uTime * 0.55;

  /* DOMAIN WARP: push the lookup around with a slow wave before sampling. This is what turns a static
     lattice of cells into something that flows and folds like a real surface. */
  vec2 w = uv * 3.4;
  w += 0.22 * vec2(sin(w.y * 2.1 + t * 0.9), cos(w.x * 1.9 - t * 0.7));

  /* Two octaves drifting against each other — the interference is where the picture comes alive. */
  float a = web(w,                t,        uSharp);
  float b = web(w * 1.9 + 11.3,   t * 1.27, uSharp * 0.75);
  float c = a * 0.65 + b * 0.45 + a * b * 0.8;   // the product term = where the two webs COINCIDE: hotspots

  /* CHROMATIC FRINGE — sample the web at three slightly different scales for R/G/B. */
  float cr = c;
  float cg = web(w * 1.012, t, uSharp) * 0.65 + b * 0.45;
  float cb = web(w * 1.026, t, uSharp) * 0.65 + b * 0.45;

  /* The floor: lit in the middle, falling to deep water at the edges (a cheap pool vignette). */
  float floorLit = 1.0 - smoothstep(0.25, 0.95, length(vUv - 0.5) * 1.35);
  vec3 base = mix(uDeep, uShallow, floorLit);

  vec3 col = base + uCaustic * vec3(cr, cg, cb) * (0.55 + 0.75 * floorLit);

  /* A slow bright swell so the whole pool breathes, not just the filaments. */
  col += uCaustic * 0.06 * (0.5 + 0.5 * sin(t * 0.6 + vUv.y * 3.0));

  gl_FragColor = vec4(col, 1.0);
}
