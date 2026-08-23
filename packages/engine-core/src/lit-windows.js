/* ============================================================
   @lgr/engine-core — lit-windows (ARC A-LITWINDOWS, 2026-08-22): the night city is INHABITED.

   A-NIGHTFALL gave the streets lamps and the sky a floor, and left the buildings as silhouettes.
   This lights the WINDOWS: at night a fraction of the facade kit's glazing panes emit, in a warm
   office palette, so a night skyline reads as a city with people in it rather than as a cut-out.

   ── THE ONE HARD PROBLEM: TELLING GLASS FROM WALL, AT THE FRAGMENT ────────────────────────────
   `createFacadeKit`'s variants are ONE glTF primitive each — four corner piers, a stack of
   recessed glazing bands and a cornice, all collapsed by `collapse_slots_to_vertex_colour` into a
   single mesh whose only surviving record of "which slot am I" is the per-vertex COLOR_0 (the
   slot's linear albedo, MULTIPLIED by the baked ambient occlusion). There is no second UV set, no
   material split and no submesh to key off. So the shader has to recover the slot from a colour
   that has already been darkened by an unknown amount.

   THE DISCRIMINATOR IS A COLOUR RATIO, NOT A BRIGHTNESS, and that is forced rather than chosen:
   the AO bake is a SCALAR multiply (one occlusion value scaling all three channels), so `b/r`
   survives it EXACTLY while every brightness measure moves with it. Measured on the shipped
   `facade_kit.glb` — all 1584 COLOR_0 vertices, read straight out of the .glb's BIN chunk:

       slot     b/r        verts   r range          this arc's own measurement, 2026-08-22
       crown    0.9600      120    0.9850..1.0000   solid (the cornice band)
       wall     1.0000      912    0.4940..0.9500   solid (piers + spandrel courses)
       shop     1.1905      120    0.2184..0.3633   GLAZING (the ground-floor shopfront)
       glass    1.2391      432    0.2392..0.2530   GLAZING (the recessed window bands)

   FOUR distinct ratios across 1584 vertices is the AO-invariance proof itself: `wall`'s red spans
   0.494..0.950 (a 1.92x AO swing) and its ratio does not move off 1.0000 by one float. Solid tops
   out at 1.0000, glazing starts at 1.1905, so `uLwGlazeMin` sits mid-gap at 1.10 with 0.095 of
   clearance on each side. `shop` and `glass` are themselves separable at 1.215, which is how the
   ground floor gets its own (higher) lit probability without a second mask.

   HONEST CORRECTION TO THE DESIGN NOTE THIS INHERITED. A-NIGHTFALL's design claimed a LUMINANCE
   threshold "provably fails because the ranges cross", citing wall-at-AO-0.52 = 0.494 against
   glass-at-AO-1.0 = 0.490. That crossing is real in PRINCIPLE and does NOT occur in the shipped
   kit: no glass vertex is anywhere near AO 1.0 (they are all buried in a 0.062 u reveal, so their
   measured AO is 0.52..0.55), and the realized luma ranges are glazing 0.2288..0.3807 against
   solid 0.4940..0.9900 — separated, not crossing. Luminance would work TODAY. The ratio is still
   the right discriminator, for the structural reason rather than the stated one: it is exactly
   invariant under the bake, so it cannot be broken by re-baking the AO at a different floor or
   horizon, while luminance's 0.113 of headroom is one generator parameter away from vanishing.

   ── WHY A DEDICATED VARYING AND NOT `vColor` ──────────────────────────────────────────────────
   Three composes `vColor = COLOR_0 * instanceColor`, and box-arena's per-instance tint is a
   deliberately BLUE district colour (`tintFor`: hue 0.55..0.66, saturation up to 0.14). At L 0.5
   and S 0.14 that tint alone carries a b/r near 1.33 — comfortably past the 1.10 threshold — so a
   ratio read off `vColor` would call every PIER a window. `vLwRaw` carries the raw `color`
   attribute captured BEFORE the instance multiply, which is the only place the slot code is clean.

   ── HOW A BAND BECOMES WINDOWS ────────────────────────────────────────────────────────────────
   The geometry has bands, not panes: one recessed box per storey, spanning the whole facade. The
   pane grid is therefore procedural (`vectorizeTower`'s method, which is this repo's existing
   lit-window vocabulary and is deliberately reused rather than reinvented — rule 6):
     · ROW    — the storey. `floor(localY * courses)`, and it is unambiguous because a glazing band
                occupies only the BOTTOM 62% of its course (70% for the shopfront), so a band never
                straddles a row boundary. `courses` is a per-variant uniform (see `apply`).
     · COLUMN — `floor(u * cols)` along the face, `u` being the local across-axis in 0..1. Cells are
                per-FACE, so a building carries `courses x 4 x cols` panes and the count is exact.
     · FACE   — from the OBJECT normal, so the four elevations light differently. Sharing one
                wrap-around coordinate (what `vectorizeTower` does on a box) would make the +X and
                +Z faces mirror images of each other, which reads as a repeat on a real corner.
     · MULLION — `step(0.10, f) * step(f, 0.90)` inside the cell. This is what stops a lit storey
                being a glowing STRIPE, and a glowing stripe is exactly the light-up-toy read.

   ── THE HASH IS EXACTLY REPRODUCIBLE ON THE CPU, ON PURPOSE ───────────────────────────────────
   "How many windows are lit" has to be a MEASUREMENT, not an estimate, and the usual
   `fract(sin(dot(...)) * 43758.5453)` cannot be measured off the GPU because it diverges between
   float64 and float32. So the lit decision runs a small LCG over EXACT INTEGERS: every input is a
   non-negative integer below 8191 and every intermediate stays under 1.48e6, far below float32's
   2^24 exact-integer ceiling — so the GPU and `litCountFor()` below compute the identical value.
   THE CLAIM IS CHECKED, NOT ASSERTED: `lit-windows.test.mjs` re-runs the JS twin with
   `Math.fround` applied at every step (an exact float32 simulation, since IEEE-754 rounds each
   operation to nearest) and requires the two to agree over ~3,800 cells; it also checks the
   widest intermediate against 2^24 as arithmetic, so an edit that raised the multiplier would
   fail loudly instead of silently destroying countability. `tools/litwindows-probe.mjs` then
   reads the resulting counts off the running page.
   8191 is prime (2^13-1), which is why it is the modulus.

   C++ anchor: `onBeforeCompile` is a preprocessor hook — three concatenates named `#include`
   chunks into one source string and this rewrites that string before it reaches the compiler, like
   a macro expanding over someone else's code. `customProgramCacheKey` is the ODR key: without it
   two differently-patched materials would share one compiled program and the second would silently
   render with the first's uniforms.

   API
     const lw = createLitWindows({ litFrac, shopFrac, colors, cols, strength });
     lw.apply(material, { courses });     // once per kit variant — `courses` is that variant's rung
     lw.update(sunRig.windowGlow);        // once per frame, beside streetLights.update(...)
     lw.litCountFor(perVariantCounts);    // the receipt: windows that exist vs windows that light
   ============================================================ */
import * as THREE from 'three';

/* THE MODULUS AND THE MULTIPLIER. Every value the mixer touches is an integer in [0, 8190], and
   the widest intermediate is 8190 * 179 + 8190 = 1,474,200 — two orders of magnitude below
   float32's 16,777,216 exact-integer ceiling. That headroom is the whole reason the GPU and the
   CPU can be asserted to agree rather than hoped to. */
/* EXPORTED so the test can read the REAL numbers instead of re-typing them. The exactness test used
   to declare its own `const M = 8191` and its own literal `179`, which made its assertion a tautology
   over two literals that never touched this module — A-LITWINDOWS's refutation proved it dead by
   raising LW_A to 4096 (exactly the edit that test's comment says it guards against) and watching it
   PASS. A guard that cannot see the thing it guards is decoration. */
export const LW_M = 8191;      // 2^13 - 1, prime
export const LW_A = 179;       // the LCG multiplier
export const LW_C = 71;        // the increment on the final round
export const LW_WRAP = 32764;  // 4 * LW_M — lifts a signed world key positive before the modulus

/* The CPU twin of `lwHash` in the fragment shader below. Inputs must already be integers in
   [0, LW_M). `fr` is `Math.fround` when simulating float32 and the identity otherwise — running it
   both ways and comparing is how the "GPU and CPU agree" claim is checked instead of asserted. */
export function lwHash(a, b, c, d, e, fr = (x) => x) {
  let h = fr(a % LW_M);
  h = fr(fr(h * LW_A + b) % LW_M);
  h = fr(fr(h * LW_A + c) % LW_M);
  h = fr(fr(h * LW_A + d) % LW_M);
  h = fr(fr(h * LW_A + e) % LW_M);
  h = fr(fr(h * LW_A + LW_C) % LW_M);
  return h;
}

/* A building's key, from the instance's own world translation — `instanceMatrix[3].xz` in the
   shader. Quantised at 1/16 u, which is ~0.4 m at this city's 6 m/u: far finer than the ~2.4 u
   gap between two buildings, so two towers cannot collide onto one key, and coarse enough that the
   value is a stable integer rather than a float that drifts with the layout. */
export function lwKey(v) {
  return (Math.floor(v * 16) + LW_WRAP) % LW_M;
}

/* THE RECEIPT, and it is arithmetic over the SAME hash the GPU runs. `perVariant` is
   `[{ courses, instances: [{x, z}] }]` — the variant's rung and the world positions box-arena gave
   it. Returns how many panes EXIST and how many are lit at full night, which are two different
   questions: a night capture with zero lit windows and a night capture with none built look
   identical, and this repo has already shipped that exact confusion once (A-NIGHTFALL's first
   swing-lab night frame had no lamps in it at all). */
export function litCountFor(perVariant, { litFrac = 0.55, shopFrac = 0.85, cols = 4, fround = false } = {}) {
  const fr = fround ? Math.fround : (x) => x;
  const tLit = Math.floor(litFrac * LW_M);
  const tShop = Math.floor(shopFrac * LW_M);
  let panes = 0, lit = 0, shopPanes = 0, shopLit = 0;
  for (const v of perVariant) {
    for (const inst of v.instances) {
      const bx = lwKey(inst.x), bz = lwKey(inst.z);
      for (let row = 0; row < v.courses; row++) {
        const ground = row === 0;
        const thresh = ground ? tShop : tLit;
        for (let face = 0; face < 4; face++) {
          for (let col = 0; col < cols; col++) {
            const h = lwHash(col, row, face, bx, bz, fr);
            panes++;
            if (ground) shopPanes++;
            if (h < thresh) { lit++; if (ground) shopLit++; }
          }
        }
      }
    }
  }
  return {
    panes, lit, shopPanes, shopLit,
    fracRealized: panes ? lit / panes : 0,
    fracAsked: litFrac, shopFracAsked: shopFrac, cols,
    /* The two thresholds as fractions of the modulus — what the shader actually compares against,
       so a reader can see the realized fraction land where the integer threshold says it should
       rather than where the requested float did. */
    threshLit: tLit / LW_M, threshShop: tShop / LW_M,
  };
}

/* ---- THE VERTEX SPLICE. Three declares `attribute vec3 color` only under USE_COLOR (its own
   prefix does it), so the capture is guarded: without vertex colours `vLwRaw` is white, whose
   ratio is 1.0, which reads as SOLID everywhere — i.e. an unpatched-looking material with no lit
   windows at all, rather than a whole city of glowing walls. The ability degrades to a lesser
   version of itself, never to a wrong one (street-lights.js's own headless rule). */
const LW_PARS_VERT = `
varying vec3 vLwRaw;      // the RAW COLOR_0, before instanceColor contaminates it
varying vec3 vLwPos;      // object-space position — the unit cube the kit is authored in
varying vec3 vLwNrm;      // object-space normal — which of the four elevations this is
varying vec3 vLwInst;     // this instance's world translation — the per-building hash seed
`;
const LW_MAIN_VERT = `
#ifdef USE_COLOR
  vLwRaw = color;
#else
  vLwRaw = vec3( 1.0 );
#endif
  vLwPos = position;
  vLwNrm = normal;
#ifdef USE_INSTANCING
  vLwInst = instanceMatrix[ 3 ].xyz;
#else
  vLwInst = vec3( 0.0 );
#endif
`;

/* The SAME four varyings, declared again on the fragment side — GLSL has no shared header between
   the two stages, so a varying is two declarations that must agree or the program does not link.
   (Omitting these was the first run's shader error, and it is worth the line of narrative: the
   vertex stage compiled perfectly and the fragment stage reported eight undeclared identifiers.) */
const LW_PARS_FRAG = `
varying vec3 vLwRaw;
varying vec3 vLwPos;
varying vec3 vLwNrm;
varying vec3 vLwInst;

uniform float uLwGlow;        // the SunRig's windowGlow — 0 at noon, 1 at midnight
uniform float uLwStrength;    // emissive gain at full night
uniform float uLwCourses;     // THIS variant's storey count (see apply())
uniform float uLwCols;        // panes per face
uniform float uLwGlazeMin;    // b/r above this is glazing (measured: solid <= 1.0, glazing >= 1.19)
uniform float uLwShopMax;     // b/r below this is the ground-floor shopfront rather than office glass
uniform float uLwThreshLit;   // integer threshold in [0, 8191) — hash below it means LIT
uniform float uLwThreshShop;
uniform vec3  uLwColA;
uniform vec3  uLwColB;
uniform vec3  uLwColC;

/* The exact-integer LCG. Every argument is an integer in [0, 8191) and every intermediate stays
   under 1.48e6, so this is bit-identical to lwHash() on the CPU (see the header). */
float lwHash( float a, float b, float c, float d, float e ) {
  float h = mod( a, 8191.0 );
  h = mod( h * 179.0 + b, 8191.0 );
  h = mod( h * 179.0 + c, 8191.0 );
  h = mod( h * 179.0 + d, 8191.0 );
  h = mod( h * 179.0 + e, 8191.0 );
  h = mod( h * 179.0 + 71.0, 8191.0 );
  return h;
}
float lwKeyOf( float v ) { return mod( floor( v * 16.0 ) + 32764.0, 8191.0 ); }
`;

/* The emissive splice. It ONLY ever ADDS to totalEmissiveRadiance, and every term is multiplied by
   uLwGlow — so at noon (windowGlow exactly 0.00, sun-rig.js's noon keyframe) the contribution is
   an exact `+= 0.0` and the daylight frame is unchanged. That is the same discipline
   `vectorizeTower` uses for the city's night windows and the same one street-lights uses for the
   lamps; one signal, three consumers, and none of them can disagree about what time it is. */
const LW_MAIN_FRAG = `
{
  /* SLOT, from the AO-invariant colour ratio (header). The max() guards a black vertex; no shipped
     slot is anywhere near it, but a division that can produce inf in a shader is a hole.
     NB: no backticks below this line — this whole block is a JS template string, and a backtick in
     a GLSL comment ends it mid-shader. Same gotcha class the .frag/.vert guard exists for. */
  float lwRatio = vLwRaw.b / max( vLwRaw.r, 1e-4 );
  float lwGlaze = step( uLwGlazeMin, lwRatio );
  float lwShop  = lwGlaze * step( lwRatio, uLwShopMax );
  /* Vertical faces only. A glazing band is a box, so it has a top and a bottom face too; they are
     buried under the spandrel above, but a light leaking out of a surface nobody can see is still
     a light being paid for. */
  float lwSide = step( abs( vLwNrm.y ), 0.5 );

  /* WHICH PANE. lwU runs across whichever elevation this is, so the columns are per-face. */
  float lwXface = step( 0.5, abs( vLwNrm.x ) );
  float lwU = mix( vLwPos.x, vLwPos.z, lwXface ) + 0.5;
  float lwCol = clamp( floor( lwU * uLwCols ), 0.0, uLwCols - 1.0 );
  float lwF = fract( lwU * uLwCols );
  float lwPane = step( 0.10, lwF ) * step( lwF, 0.90 );          // the mullion between two panes
  float lwRow = clamp( floor( vLwPos.y * uLwCourses ), 0.0, uLwCourses - 1.0 );
  // 0,1 = +X,-X · 2,3 = +Z,-Z. Four elevations, four independent patterns.
  float lwFace = mix( 2.0 + step( vLwNrm.z, 0.0 ), step( vLwNrm.x, 0.0 ), lwXface );

  float lwBx = lwKeyOf( vLwInst.x ), lwBz = lwKeyOf( vLwInst.z );
  float lwH = lwHash( lwCol, lwRow, lwFace, lwBx, lwBz );
  /* THE COUNT IS DECOUPLED FROM THE GLOW (vector-style.js's L114 lesson): the same panes are lit
     at dusk and at midnight, and only their BRIGHTNESS ramps. Windows switching on one by one as
     the sun sets would be prettier and is a different arc; a fraction that changes with the clock
     makes "how many are lit" a question with no single answer. */
  float lwLit = step( lwH + 0.5, mix( uLwThreshLit, uLwThreshShop, lwShop ) );

  /* THE PALETTE. A second LCG round decorrelates the colour from the lit decision, so the lit
     panes are not all the same colour as each other. */
  float lwC = mod( mod( lwH * 179.0 + 13.0, 8191.0 ), 3.0 );
  vec3 lwCol3 = lwC < 0.5 ? uLwColA : ( lwC < 1.5 ? uLwColB : uLwColC );
  /* PER-BUILDING BRIGHTNESS, off the building key alone: two towers with the same palette still
     read as two buildings because one is dimmer. 0.72..1.0 — measured by looking, see the arc. */
  float lwB = 0.72 + 0.28 * ( lwHash( 5.0, 3.0, 1.0, lwBx, lwBz ) / 8190.0 );

  totalEmissiveRadiance += lwGlaze * lwSide * lwPane * lwLit * lwCol3 * lwB * uLwGlow * uLwStrength;
}
`;

export function createLitWindows({
  /* litFrac / shopFrac — the fraction of panes lit at full night. The NAME and the idea are
     citygen's (`PROFILES[].nightLit`, "fraction of windows lit at full night", read by
     vectorizeTower as `litFrac`); this is that vocabulary applied to modelled glazing instead of a
     painted grid. The ground floor is lit harder because a real street's retail is: citygen's own
     shopfront path pins its glow ON rather than tying it to the day/night signal (citygen.js:731).
     Here it stays tied to the signal — a shop that is lit at noon would violate this arc's
     byte-identical-daylight contract — but it lights at a higher fraction. */
  litFrac = 0.55,
  shopFrac = 0.85,
  /* Up to three lit-pane colours, sampled by hash. Two warm office whites and one cool — the
     Manhattan mix citygen ships as its default `winColors` (warm + cool offices), because a single
     colour reads as a light-up toy and a random hue reads as a fairground (A-DRESS's own finding
     about the unlit sign boxes, which is the same mistake one step along). */
  colors = ['#ffc27a', '#ffe0b0', '#a8d4ff'],
  cols = 4,
  /* The emissive gain at full night. This room renders straight to an sRGB framebuffer with NO
     tonemapping (createEngineCore sets none), so 1.0 in a channel is already clipped white — the
     value has to sit low enough that a warm pane stays WARM instead of blowing to white, which is
     the difference between a window and a hole. Tuned by looking; see the arc report. */
  strength = 0.62,
  /* Mid-gap between the measured solid max (1.0000) and glazing min (1.1905), and between shop
     (1.1905) and glass (1.2391). Exposed because they are facts about a KIT, not about this
     module: a differently-authored kit brings its own numbers. */
  glazeMin = 1.10,
  shopMax = 1.215,
} = {}) {
  const wc = [0, 1, 2].map((i) => new THREE.Color(colors[i] ?? colors[colors.length - 1]));
  /* THE THRESHOLDS ARE INTEGERS, and that is what makes `lwLit` exact on both sides: the shader
     compares two values that are both exactly representable, so there is no boundary pane whose
     lit-ness depends on which machine asked. */
  const threshLit = Math.floor(litFrac * LW_M);
  const threshShop = Math.floor(shopFrac * LW_M);

  /* ONE uniform object, SHARED by every material this handle patches — so `update()` is a single
     scalar write no matter how many variants the kit has, and two variants can never disagree
     about the time of day. `uLwCourses` is the one that is NOT shared; see `apply`. */
  const shared = {
    uLwGlow: { value: 0 },
    uLwStrength: { value: strength },
    uLwCols: { value: cols },
    uLwGlazeMin: { value: glazeMin },
    uLwShopMax: { value: shopMax },
    uLwThreshLit: { value: threshLit },
    uLwThreshShop: { value: threshShop },
    uLwColA: { value: wc[0] },
    uLwColB: { value: wc[1] },
    uLwColC: { value: wc[2] },
  };
  const applied = [];

  function apply(material, { courses } = {}) {
    if (!material) return material;
    if (!(courses > 0)) throw new Error('createLitWindows.apply: `courses` must be > 0 — it is THIS variant\'s storey count, and the row index (floor(localY * courses)) is what puts one hash per glazing band. Pass the kit\'s own courses[k].');
    /* `uLwCourses` is per-MATERIAL because it is per-VARIANT: facade_c8 has eight bands in the same
       unit height facade_c2 has two. Five materials, five values, and ONE compiled program — the
       cache key below is constant, which is the same arrangement citygen already ships (a
       vectorizeTower material per building, all sharing 'lgr-vec-tower'). It costs no draw calls:
       box-arena already draws one InstancedMesh per variant. */
    const own = { ...shared, uLwCourses: { value: courses } };

    /* CHAIN, NEVER CLOBBER — street-grid.js's rule. The material handed in may already carry
       `createTriplanarForgeMaterial`'s patch, and an assignment here would delete it silently. */
    const prev = material.onBeforeCompile;
    const prevKey = material.customProgramCacheKey;
    material.onBeforeCompile = (shader, renderer) => {
      if (prev) prev.call(material, shader, renderer);
      Object.assign(shader.uniforms, own);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + LW_PARS_VERT)
        /* AFTER `<color_vertex>`, which is where three has just built `vColor` — we want the raw
           attribute that fed it, so the capture goes next to it rather than anywhere earlier. */
        .replace('#include <color_vertex>', '#include <color_vertex>\n' + LW_MAIN_VERT);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + LW_PARS_FRAG)
        /* AFTER `<emissivemap_fragment>`, which is where `totalEmissiveRadiance` exists and before
           anything reads it. The triplanar forge replaces map/roughness/metalness/ao and never
           touches this chunk, so the two patches cannot collide. */
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n' + LW_MAIN_FRAG);
    };
    material.customProgramCacheKey = () => 'lgr-lit-windows|' + (prevKey ? prevKey.call(material) : 'base');
    material.needsUpdate = true;
    applied.push(material);
    return material;
  }

  return {
    apply,
    /* Call once per frame beside `streetLights.update(sunRig.windowGlow)` — the SAME signal, so the
       lamps and the windows cannot disagree about what time it is (the arc's own constraint).
       One scalar write, shared by every patched material: no allocation, no loop. */
    update(windowGlow) { shared.uLwGlow.value = windowGlow || 0; },
    get glow() { return shared.uLwGlow.value; },
    get materials() { return applied.length; },
    uniforms: shared,
    params: { litFrac, shopFrac, cols, strength, glazeMin, shopMax, threshLit, threshShop, colors: [...colors] },
    litCountFor: (perVariant, opts) => litCountFor(perVariant, { litFrac, shopFrac, cols, ...opts }),
  };
}
