/* ============================================================
   @lgr/engine-core — street-grid.js (ARC A-DRESS, 2026-08-15): ROADS WITHOUT GEOMETRY.
   ------------------------------------------------------------
   WHAT THIS FIXES. `createBoxArena` gives a city a grid of towers standing on ONE flat plane. There is
   no road: the gaps between the buildings are the same asphalt as the ground under the buildings, so
   at street level there is no kerb, no lane, no crossing and no junction — nothing that says which part
   of the floor is for walking and which is for driving. That is most of why the A-SKYLINE city reads as
   a proving ground rather than as a place.

   WHY A SHADER AND NOT GEOMETRY, stated as the budget decision it is. Road markings as meshes are the
   classic draw-call disaster: `citygen.js` already does exactly that (kerbs and crosswalk stripes each
   `procedural.add(...)`'d as their own Mesh — the Rule-6 conflict `docs/design/research-aaa-
   environments.md` §1 names), and its draw calls scale with the city. The whole surface treatment here
   is a FUNCTION OF WORLD XZ, evaluated in the fragment shader of a plane that is already being drawn.
   Cost: zero extra draw calls, zero extra triangles, zero extra bytes on the wire. A 19x19 city and a
   100x100 city cost the same.

   THE GRID IS THE SAME ARITHMETIC THE PROPS STAND ON. `createBoxArena` puts tower centres on a
   `spacing` lattice through the origin, so a street centreline is halfway between two of them:
   x = (k + 0.5) * spacing. `street-kit.js` derives its sidewalk from that identical expression. One
   description of one grid — a road painted on a different lattice from the lamp posts standing on it
   is a bug you can see from the pavement, and two copies of the arithmetic is how you get one.

   WHAT IT PAINTS, in the order a real street is built:
     · ASPHALT between the kerbs, and a lighter SIDEWALK outside them.
     · A KERB line at the boundary — a dark band, because the shadow in the gutter is what the eye
       actually reads as a kerb from standing height.
     · A dashed LANE line down the middle of each street, suppressed inside junctions (a centre line
       drawn through an intersection is the single most common tell of a procedural road).
     · ZEBRA CROSSINGS on each approach to a junction: bars running PARALLEL to the traffic they cross,
       which is what a real crossing looks like and is the opposite of the intuitive guess.
     · The block interiors (under and around the buildings) as a paler lot, so a building sits on
       something instead of on the road.

   ANTI-ALIASING IS NOT OPTIONAL HERE and it is the one thing that separates this from a first attempt.
   A lane line is ~3 cm wide in world units; at a swing camera's distance that is far under a pixel, and
   a hard `step()` turns every marking into crawling white noise the moment the camera moves. Every edge
   below is a `smoothstep` over `fwidth()` of its own coordinate — the standard screen-space-derivative
   band — so a marking fades out gracefully into the road instead of aliasing into sparkle.

   OPT-IN, AND IT CHAINS. Nothing calls this unless it wants it, so every existing material compiles the
   program it compiled before (`npm run tier-guard`'s byte-identical stylized baselines are untouched —
   `projects/city` runs `citygen`, which does not call this). And because the ground it is most useful on
   ALREADY has `applyGroundMacro` patched onto it, this preserves and calls any existing
   `onBeforeCompile` first rather than overwriting it: the macro's de-tiling runs, then this paints the
   road on top of the result. A patch that silently deletes the previous patch is the kind of bug that
   only shows up as "the de-tiling stopped working" three arcs later.

   C++ anchor: `onBeforeCompile` is a preprocessor hook — three concatenates named `#include` chunks
   into one program string and we string-replace a chunk boundary before the driver compiles.
   `customProgramCacheKey` is the ODR key: without it, two differently-patched materials would share one
   compiled program and the second would silently render with the first's uniforms.
   ============================================================ */

const GRID_FRAG_PARS = `
  varying vec2 vSgXZ;
  uniform float uSgPitch;       // block pitch — street centrelines every uSgPitch, offset by half
  uniform float uSgRoadHalf;    // half-width of the asphalt
  uniform float uSgWalkHalf;    // outer edge of the sidewalk (kerb sits at uSgRoadHalf)
  uniform float uSgKerb;        // thickness of the dark gutter band
  uniform float uSgLane;        // half-width of the centre lane line
  uniform float uSgDash;        // dash period along the street
  uniform float uSgCrossW;      // how far out from the junction the zebra band reaches
  uniform float uSgBar;         // zebra bar pitch
  uniform vec4  uSgTone;        // x = sidewalk, y = kerb, z = lot, w = marking brightness

  /* One antialiased band: 1 inside |v| < hw, fading over one pixel of v. All the geometry below is
     built from this, so every edge in the road gets the same treatment and none of them can be the one
     that was forgotten.
     THE PARAMETER IS hw AND NOT half, WHICH IS NOT A STYLE CHOICE: half is a RESERVED WORD in GLSL ES
     and the first version of this shader failed to LINK on it — caught only by running the page,
     exactly as the project CLAUDE.md warns ("a passing vite build does NOT prove shaders compile — the
     GPU compiles at runtime"). No backticks in this comment either: it lives inside a JS template
     literal, and a backtick here ends the string with a parse error that names the wrong line. */
  float sgBand(float v, float hw) {
    float aa = max(fwidth(v), 1e-5);
    return 1.0 - smoothstep(hw - aa, hw + aa, abs(v));
  }
`;

/* Attach the street grid to a ground material.
   opts:
     spacing    — the block pitch the level was laid out on (REQUIRED to match, see the header)
     roadHalf   — half-width of the asphalt (default 0.30 * spacing)
     walkHalf   — outer edge of the sidewalk (default 0.46 * spacing)
     kerb       — gutter band thickness (default 0.045)
     lane       — centre-line half-width (default 0.018)
     dash       — dash period along the street (default 0.9)
     crossW     — zebra reach past the junction square (default 0.55)
     bar        — zebra bar pitch (default 0.22)
     sidewalk / kerbTone / lot / marking — the four albedo multipliers
   Returns the material, for chaining. */
export function applyStreetGrid(material, opts = {}) {
  if (!material) return material;
  const spacing = opts.spacing != null ? opts.spacing : 4.6;
  const u = {
    uSgPitch: { value: spacing },
    uSgRoadHalf: { value: opts.roadHalf != null ? opts.roadHalf : spacing * 0.30 },
    uSgWalkHalf: { value: opts.walkHalf != null ? opts.walkHalf : spacing * 0.46 },
    uSgKerb: { value: opts.kerb != null ? opts.kerb : 0.045 },
    uSgLane: { value: opts.lane != null ? opts.lane : 0.018 },
    uSgDash: { value: opts.dash != null ? opts.dash : 0.9 },
    uSgCrossW: { value: opts.crossW != null ? opts.crossW : 0.55 },
    uSgBar: { value: opts.bar != null ? opts.bar : 0.22 },
    uSgTone: {
      value: {
        x: opts.sidewalk != null ? opts.sidewalk : 1.75,
        y: opts.kerbTone != null ? opts.kerbTone : 0.55,
        z: opts.lot != null ? opts.lot : 1.25,
        w: opts.marking != null ? opts.marking : 3.4,
      },
    },
  };

  /* CHAIN, NEVER CLOBBER — see the header. The ground this is most wanted on already carries
     `applyGroundMacro`, and an assignment here would delete it silently. */
  const prev = material.onBeforeCompile;
  const prevKey = material.customProgramCacheKey;

  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\n  varying vec2 vSgXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSgXZ = (modelMatrix * vec4(position, 1.0)).xz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GRID_FRAG_PARS)
      /* AFTER `<map_fragment>`, so `diffuseColor` is the tiled asphalt in LINEAR space and every tone
         below is an honest albedo multiply rather than a colour pasted over a texture. */
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        /* sx = signed distance to the nearest N-S street centreline, sz to the nearest E-W one.
           Both are zero ON a centreline and +/- pitch/2 on a tower row. */
        float sx = mod(vSgXZ.x, uSgPitch) - uSgPitch * 0.5;
        float sz = mod(vSgXZ.y, uSgPitch) - uSgPitch * 0.5;
        float inNS = sgBand(sx, uSgRoadHalf);        // inside the north-south carriageway
        float inEW = sgBand(sz, uSgRoadHalf);        // inside the east-west carriageway
        float road = max(inNS, inEW);
        float junction = inNS * inEW;                // both at once = the crossing square

        /* SIDEWALK: outside the kerb but inside the walk band, on either axis. */
        float walkNS = sgBand(sx, uSgWalkHalf), walkEW = sgBand(sz, uSgWalkHalf);
        float walk = clamp(max(walkNS, walkEW) - road, 0.0, 1.0);
        /* LOT: everything the streets and their pavements do not claim — the ground the buildings
           stand on. Paler, so a tower sits on a plinth instead of floating on tarmac. */
        float lot = clamp(1.0 - max(road, walk), 0.0, 1.0);
        /* KERB: a dark gutter exactly at the road edge, on whichever axis owns this fragment. */
        float kerb = max(sgBand(abs(sx) - uSgRoadHalf, uSgKerb), sgBand(abs(sz) - uSgRoadHalf, uSgKerb));
        kerb *= max(walkNS, walkEW);

        vec3 tone = vec3(1.0);
        tone = mix(tone, vec3(uSgTone.x), walk);
        tone = mix(tone, vec3(uSgTone.z), lot);
        tone = mix(tone, vec3(uSgTone.y), kerb * 0.9);
        diffuseColor.rgb *= tone;

        /* ---- THE MARKINGS. Painted last, added rather than multiplied, so they read on dark asphalt
           at night as well as under a key light. ---- */
        float paint = 0.0;
        /* Dashed centre line down each carriageway, KILLED inside the junction square. */
        float dashNS = step(0.5, fract(vSgXZ.y / uSgDash));
        float dashEW = step(0.5, fract(vSgXZ.x / uSgDash));
        paint = max(paint, sgBand(sx, uSgLane) * inNS * dashNS);
        paint = max(paint, sgBand(sz, uSgLane) * inEW * dashEW);
        paint *= (1.0 - junction);

        /* ZEBRA CROSSINGS on each approach: a band just outside the junction square, barred PARALLEL
           to the traffic it crosses (see the header — this is the counter-intuitive half). */
        float apprNS = sgBand(abs(sz) - uSgRoadHalf - uSgCrossW * 0.5, uSgCrossW * 0.5) * inNS;
        float apprEW = sgBand(abs(sx) - uSgRoadHalf - uSgCrossW * 0.5, uSgCrossW * 0.5) * inEW;
        float barNS = step(0.5, fract(vSgXZ.x / uSgBar));
        float barEW = step(0.5, fract(vSgXZ.y / uSgBar));
        paint = max(paint, apprNS * barNS);
        paint = max(paint, apprEW * barEW);

        diffuseColor.rgb += vec3(paint) * uSgTone.w * 0.06;
      }`);
  };
  material.customProgramCacheKey = () => 'lgr-street-grid|' + (prevKey ? prevKey.call(material) : 'base');
  material.needsUpdate = true;
  material.userData.streetGrid = u;
  return material;
}
