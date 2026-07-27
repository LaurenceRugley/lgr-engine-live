/* ============================================================
   liquid-metal.frag — Lesson W: SDF RAYMARCHING. A different way to make a picture.
   ------------------------------------------------------------
   Every other scene in the ring is RASTERISED: we hand the GPU triangles, it fills them in. This one
   has no geometry at all. It draws a single flat quad and, for EVERY PIXEL, fires a ray into an
   imaginary space and walks it until it hits something. The "something" is defined by a function.

   ── SPHERE TRACING, THE IDEA ──────────────────────────────────────────────────
   A Signed Distance Function (SDF) answers one question: "from this point, how far is the nearest
   surface?" (negative = you're inside it). That single number is a SAFE STEP SIZE — if the nearest
   surface is 3 units away, you can march 3 units along your ray with no risk of passing through
   anything. So the loop is: ask the distance, step exactly that far, repeat. Near a surface the
   answers get small and the steps get tiny; you converge onto it. Far from everything, one step
   crosses a huge void for free. That's why it's fast enough to do per-pixel at all.
   C++ anchor: it's a while-loop doing adaptive Newton-ish stepping toward a root of f(p) = 0 — you
   never build a mesh, you just evaluate a function.

   ── WHY METABALLS ──────────────────────────────────────────────────────────────
   The min() of two distances is the union of two shapes — but a hard min gives a hard crease where
   they meet. smin (smooth minimum) blends the two distances near the seam instead, so the surfaces
   MERGE like mercury pulling together. That fusing is a thing rasterised triangles cannot do without
   re-meshing every frame, and it is the whole reason this scene exists: it shows a capability, not
   just a look.

   ── PERF (this scene is the lesson's limit-test) ──────────────────────────────
   Cost = pixels × steps × cost(SDF). The levers, all used here:
     • STEPS is a hard cap (64) with an early-out the moment we're close enough or past the far plane.
     • A BOUNDING SPHERE is tested first: rays that can't possibly hit the blobs pay ~nothing and draw
       the background immediately. On a typical frame most of the screen is background, so this is the
       single biggest win.
     • The NORMAL uses the 4-tap tetrahedron trick, not the naive 6-tap central difference — 33% fewer
       SDF evaluations, and it's only paid on rays that actually hit.
     • The pack renders this at HALF RESOLUTION into its own target and upscales (createLiquidMetal.js),
       which is a flat 4× cut in the pixel count that dominates the whole equation.
   ============================================================ */
precision highp float;

varying vec2 vUv;

uniform float uTime;
uniform vec2  uRes;      // the target's resolution (for the aspect-correct ray)
uniform vec3  uTint;     // the metal's colour (linear)
uniform vec3  uBgTop;    // backdrop gradient
uniform vec3  uBgBot;
uniform float uBlobs;    // how many metaballs are live (1..6) — the perf/appearance dial

const int   STEPS   = 64;      // hard cap. GLSL needs a constant loop bound; we break out early.
const float MAX_D   = 14.0;    // far plane: past this we've hit nothing
const float HIT_D   = 0.0022;  // "close enough" — tighter than this buys nothing at half-res
const float BOUND_R = 3.4;     // the bounding sphere the blobs never leave

/* Smooth minimum (polynomial, iq). k controls how wide the merge is: the bigger k, the more the two
   surfaces "reach" for each other before they touch. This is the mercury. */
float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

/* THE SCENE, as a function. Six drifting spheres, smooth-min'd into one body.
   Each blob rides its own slow Lissajous path, so the cluster never repeats and never quite settles. */
float sdf(vec3 p) {
  float t = uTime * 0.35;

  vec3 c0 = vec3(sin(t * 0.9) * 0.75, cos(t * 0.7) * 0.60, sin(t * 0.5) * 0.5);
  float d = length(p - c0) - 1.20;

  vec3 c1 = vec3(cos(t * 0.6) * 0.95, sin(t * 1.1) * 0.70, cos(t * 0.8) * 0.45);
  d = smin(d, length(p - c1) - 1.00, 0.75);

  vec3 c2 = vec3(sin(t * 1.3 + 2.0) * 0.85, cos(t * 0.5 + 1.0) * 0.85, sin(t * 0.9) * 0.6);
  d = smin(d, length(p - c2) - 0.90, 0.75);

  if (uBlobs > 3.5) {
    vec3 c3 = vec3(cos(t * 0.8 + 4.0) * 1.05, sin(t * 0.6 + 3.0) * 0.55, cos(t * 1.2) * 0.55);
    d = smin(d, length(p - c3) - 0.80, 0.70);
  }
  if (uBlobs > 4.5) {
    vec3 c4 = vec3(sin(t * 0.4 + 1.5) * 0.65, cos(t * 1.0 + 2.5) * 0.95, sin(t * 0.7 + 1.0) * 0.7);
    d = smin(d, length(p - c4) - 0.72, 0.68);
  }
  if (uBlobs > 5.5) {
    vec3 c5 = vec3(cos(t * 1.1 + 0.5) * 0.70, sin(t * 0.9 + 4.5) * 0.70, cos(t * 0.6 + 2.0) * 0.8);
    d = smin(d, length(p - c5) - 0.68, 0.68);
  }
  return d;
}

/* Normal by gradient — the 4-tap tetrahedron form: 4 SDF evaluations instead of the naive 6. */
vec3 normalAt(vec3 p) {
  const vec2 k = vec2(1.0, -1.0);
  const float h = 0.0015;
  return normalize(k.xyy * sdf(p + k.xyy * h) +
                   k.yyx * sdf(p + k.yyx * h) +
                   k.yxy * sdf(p + k.yxy * h) +
                   k.xxx * sdf(p + k.xxx * h));
}

/* THE STUDIO THE METAL REFLECTS — and it is the difference between chrome and rubber.
   Metal has no colour of its own: it is a mirror with a tint. So the ONLY thing that makes a blob look
   metallic is what it reflects. The first cut of this function was a soft gradient, and the blobs came
   out looking like matte blue putty — a smooth reflection of a smooth nothing is indistinguishable from
   diffuse shading. A mirror needs something with EDGES to mirror.
   So this is a real (if cheap) studio: a HARD HORIZON, a bright overhead softbox, a dark floor, and a
   couple of soft kickers. When those slide across a curved surface you read "polished", instantly. */
vec3 env(vec3 rd) {
  /* Hard horizon — the single most important line in this shader. */
  float h = smoothstep(-0.015, 0.015, rd.y);
  vec3 floorC = uBgBot * 0.55;
  vec3 skyC   = mix(uBgTop * 1.35, uBgTop * 0.45, smoothstep(0.0, 0.9, rd.y));
  vec3 c = mix(floorC, skyC, h);

  /* The softbox: a bright, sharply-bounded overhead panel — this is the highlight that slides. */
  float box = smoothstep(0.42, 0.60, rd.y) * (1.0 - smoothstep(0.86, 0.99, rd.y));
  c += vec3(1.00, 0.98, 0.95) * box * 2.6;

  /* A bright strip just above the horizon: the classic chrome "waistline" reflection. */
  c += vec3(0.85, 0.90, 1.00) * smoothstep(0.10, 0.02, abs(rd.y - 0.06)) * 0.55;

  /* Cool kickers at the sides so the silhouette edges stay alive against the backdrop. */
  c += vec3(0.30, 0.42, 0.62) * smoothstep(0.62, 1.0, abs(rd.x)) * 0.45;
  return c;
}

void main() {
  /* Build the camera ray for this pixel. */
  vec2 uv = (vUv * 2.0 - 1.0);
  uv.x *= uRes.x / max(uRes.y, 1.0);

  vec3 ro = vec3(0.0, 0.0, 6.2);                  // eye
  vec3 rd = normalize(vec3(uv * 0.62, -1.0));     // ray direction (0.62 ≈ the lens)

  vec3 bg = mix(uBgBot, uBgTop, vUv.y);

  /* BOUNDING-SPHERE REJECT — the big perf win. Solve the ray/sphere intersection first; if the ray
     misses the volume the blobs live in, there is nothing to march and we bail immediately. Most of a
     typical frame is background, so most pixels take this path and never enter the loop at all. */
  float b = dot(ro, rd);
  float c = dot(ro, ro) - BOUND_R * BOUND_R;
  float disc = b * b - c;
  if (disc < 0.0) { gl_FragColor = vec4(bg, 1.0); return; }

  float tEnter = max(-b - sqrt(disc), 0.0);       // start marching at the shell, not at the eye
  float tExit  = min(-b + sqrt(disc), MAX_D);

  /* SPHERE-TRACE. */
  float t = tEnter;
  bool hit = false;
  for (int i = 0; i < STEPS; i++) {
    vec3 p = ro + rd * t;
    float d = sdf(p);
    if (d < HIT_D) { hit = true; break; }         // close enough — stop
    t += d;                                        // the distance IS the safe step
    if (t > tExit) break;                          // left the bounding volume — nothing here
  }

  if (!hit) { gl_FragColor = vec4(bg, 1.0); return; }

  vec3 p = ro + rd * t;
  vec3 n = normalAt(p);

  /* METAL: it's a mirror with a tint. Reflect the view ray and look up the environment; multiply by
     the metal's colour (that IS what "metallic" means — the reflection takes the metal's hue). The
     Fresnel term brightens grazing angles toward white, which is what stops it reading as plastic. */
  vec3 refl = reflect(rd, n);
  vec3 base = env(refl) * uTint;

  float fres = pow(1.0 - max(dot(n, -rd), 0.0), 4.0);
  vec3 col = mix(base, env(refl) * 1.15, fres * 0.75);

  /* A tight specular from the overhead band, so the blobs get a liquid highlight that slides as they move. */
  vec3 lightDir = normalize(vec3(0.35, 0.9, 0.35));
  float spec = pow(max(dot(refl, lightDir), 0.0), 48.0);
  col += vec3(1.0, 0.98, 0.94) * spec * 1.6;

  /* Fade the far edge of the body into the backdrop so the silhouette doesn't cut like a sticker. */
  float edge = smoothstep(MAX_D * 0.75, MAX_D, t);
  col = mix(col, bg, edge);

  gl_FragColor = vec4(col, 1.0);
}
