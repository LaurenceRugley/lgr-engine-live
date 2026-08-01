/* ============================================================
   hoard2 · src/world/recipes.js — THE MAP RECIPES (A9 world content, as data).
   ------------------------------------------------------------
   The engine owns the world-recipe SCHEMA + INTERPRETER (createWorldFromRecipe); this file owns hoard2's
   concrete RECIPES — plain data objects describing each arena, with config-dependent positions resolved
   from the caller's PLAY_RADIUS. A recipe overrides only what differs from defaultRecipe(); the interpreter
   normalises the rest. `forestRecipe` is recipe #1 — the decrepit forest, reproduced BYTE/TRACE-identical
   to the hand-wired original at seed 1337 (the migration proof). `swampRecipe` (A9 phase 2) is the genuinely
   different second consumer through the same interpreter.

   WHY the positions live here, not in the engine parser: cluster placement is relative to PLAY_RADIUS (a
   hoard2 config value), so the project resolves them. The engine schema stays config-agnostic plain data.
   ============================================================ */

/** forestRecipe({ seed, playRadius, macro }) → recipe #1, the decrepit forest. Every field not set here
 *  falls back to defaultRecipe() — which IS the forest baseline — so this only carries meta + the two
 *  backdrop structure clusters (config-resolved positions) + the runtime ground-macro decision. The result,
 *  through createWorldFromRecipe at seed 1337, reproduces the original arena's obstacles/harvest exactly. */
export function forestRecipe({ seed, playRadius, macro = true } = {}) {
  const R = playRadius;
  return {
    meta: { name: 'decrepit-forest', description: 'decrepit dead forest · ruined settlement · cover buildings · scavenge', seed },
    biome: 'forest',
    ground: { macro },
    structures: {
      clusters: [
        // the ratified ruin route: a sparse/low/desat ruined settlement, a grim skyline backdrop past the
        // play radius (the panic-hide backdrop). Built on mobile too (one cluster), but doesn't cast there.
        { profile: 'decrepit', coastBase: 0.7, seedOffset: 0, pos: [-(R + 6), 0, -(R + 2)], scale: 1.25, material: 'stone', mobile: true, panicHide: true },
        // A3 "dying, not uniformly destroyed": a SECOND, more-INTACT cluster at the opposite corner — some
        // buildings still stand among the collapsed stumps. Desktop-only luxury (mobile shows one cluster).
        { profile: 'intact', coastBase: 0.7, seedOffset: 1, pos: [R + 5, 0, -(R + 4)], scale: 1.25, material: 'stone', mobile: false },
      ],
    },
  };
}

// The canonical swamp DESCRIPTION — the text the front-end (recipeFromText) parses into the biome semantics
// (sparse · dead · foggy · pond). This is what ?map=swamp feeds through the parser, so the map is genuinely
// TEXT→WORLD: the words below drive the forest sparseness/deadness, the fog, and the pond.
export const SWAMP_DESC = 'a foggy swamp with drowned ruins, sparse dead trees, and a stagnant pond at the low ground';

/** swampBase({ seed, playRadius, macro }) → the config-DEPENDENT scaffolding of recipe #2 (the drowned
 *  swamp): the single drowned structure cluster (position from PLAY_RADIUS), a touch more rubble, and the
 *  contextual POND's placement/tint. The BIOME semantics (sparse · dead · foggy · pond-kind) come from
 *  recipeFromText(SWAMP_DESC) merged over this — so the description literally shapes the arena. A genuinely
 *  different arena through the SAME interpreter = the second-consumer LIBRARY proof. Determinism is per-map:
 *  (masterSeed, this recipe) fully determines the swamp, independent of the forest. */
export function swampBase({ seed, playRadius, macro = true } = {}) {
  const R = playRadius;
  return {
    meta: { name: 'drowned-swamp', seed },
    biome: 'swamp',
    ground: { macro },
    structures: {
      // ONE drowned quarter — a drowned place has less left standing than the forest's two clusters.
      clusters: [
        { profile: 'decrepit', coastBase: 0.7, seedOffset: 0, pos: [-(R + 6), 0, -(R + 2)], scale: 1.25, material: 'stone', mobile: true, panicHide: true },
      ],
    },
    ruins: { count: 16 },   // a touch more drowned rubble than the forest's 14
    // CONTEXTUAL water (B2: never a global plane) — A12 upgrades A9's flat disc to createWaterSurface: a
    // STAGNANT, STILL, SHALLOW pond (the swamp's character). `kind` comes from the description ('drowned/
    // pond' → kind:'pond'); this supplies the config-placed geometry + the murky palette. Low ripple + low
    // glint = stagnant (not a sparkly lake); algal-green shallow easing to a dark deep, with a soft shoreline
    // so it laps the mud instead of the A9 hard-edged disc. Green-dominant so it survives the cool grade.
    water: {
      at: [7, -5], radius: 8, depthPower: 1.4, opacity: 0.92, ripple: 0.34, speed: 0.5, glint: 0.6,
      colors: { shallow: 0x577f63, deep: 0x1e3029, sky: 0x4a5f54 },
    },
  };
}

// The canonical LAKESHORE description — recipe #3, exercising A9's water field BEYOND 'pond' (kind:'lake').
export const LAKESHORE_DESC = 'a dead lakeshore, foggy, with sparse dead trees and a cold still lake meeting the land at the shore';

/** lakeshoreBase({ seed, playRadius, macro }) → the config-DEPENDENT scaffolding of recipe #3 (the dead
 *  lakeshore): a BIG water body to the north (a lake, not a pond) whose near rim arcs across the arena as a
 *  SHORELINE, with the play ring on the LAND (south) side. The forest gets a north-side CLEARING so the dead
 *  trees don't stand thick in the lake (a few drowned ones at the shore read as flooded — on theme). The
 *  biome semantics (sparse · dead · foggy · lake-kind) come from recipeFromText(LAKESHORE_DESC) merged over
 *  this — a third world through the SAME interpreter, proving `water` is a real dimension of the schema. */
export function lakeshoreBase({ seed, playRadius, macro = true, glintWater = false, glintGround = false } = {}) {
  const R = playRadius;
  return {
    meta: { name: 'dead-lakeshore', seed },
    biome: 'lake',
    ground: { macro },
    // sparse dead trees, CLEARED on the north/water side so the lake reads open (central + a big north clearing).
    // The description supplies count/archetypes; this supplies the keep-out geometry.
    forest: { clearings: [{ x: 0, z: 0, r: 6 }, { x: 0, z: 40, r: 34 }] },
    structures: {
      // one decrepit quarter on the LAND side (south-west), well clear of the lake.
      clusters: [{ profile: 'decrepit', coastBase: 0.7, seedOffset: 0, pos: [-(R + 6), 0, -(R + 2)], scale: 1.25, material: 'stone', mobile: true, panicHide: true }],
    },
    ruins: { count: 12, innerR: 6, outerR: R - 4 },   // rubble on the land side (annulus stops short of the lake)
    // A LAKE (kind from the description): a big disc pushed NORTH so its near rim (~z=6) is the SHORELINE
    // right at the play area — land + the survivor spawn to the south, the lake filling the north half of the
    // view, water stretching away. Colder + more open than the swamp pond — it shimmers (higher glint/ripple),
    // a dead grey-blue-green. depthPower low so the visible near-shore band reads shallow → mid.
    water: {
      at: [0, 36], radius: 30, depthPower: 0.8, opacity: 0.94, ripple: 0.5, speed: 1.15, glint: 0.85,
      colors: { shallow: 0x4d6b6f, deep: 0x18282e, sky: 0x53666b },
      // A14 GLINT — glinty-NDF sun glitter breaking the still lake into a field of moving pinpoints in the
      // sun's glare path. Rides the MOBILE direct path (bespoke water ShaderMaterial, no textures/RTs) — so
      // it is NOT forge-gated. ?glint=0 → glintDensity 0 → the frag skips it → byte-identical A13 lake.
      glintDensity: glintWater ? 3.0 : 0, glintRough: 0.5, glintMicro: 0.15, glintGain: 1.4,
    },
  };
}

// The canonical COASTAL description — recipe #4 (A13), exercising the ocean (Gerstner kind:'ocean').
export const COASTAL_DESC = 'a dead coast, foggy, with sparse dead trees on the shore and the ocean rolling in, surf breaking on the beach';

/** coastalBase({ seed, playRadius, macro }) → recipe #4 (A13): a dead SHORELINE — the play ring on the LAND
 *  (south) side, a Gerstner OCEAN filling the north to the horizon with swell rolling toward the beach + surf
 *  foam where it meets the shallows. Config-dependent scaffolding (positions from PLAY_RADIUS); the biome
 *  semantics (sparse · dead · foggy · ocean-kind) come from recipeFromText(COASTAL_DESC) merged over this.
 *  The owner's own scope: "the edge, beach to the ocean" — a shore you stand on, so the horizon stays cheap
 *  (a faded Gerstner mesh + sky-tint, no projected-grid). See docs/ocean-spec.md. */
export function coastalBase({ seed, playRadius, macro = true, glintWater = false, glintGround = false } = {}) {
  const R = playRadius;
  return {
    meta: { name: 'dead-coast', seed },
    biome: 'ocean',
    // A14 GLINT ground consumer — a faint wet-grit / mineral sparkle on the shore where the sun rakes the
    // damp sand near the waterline (the "wet sand at the coastal waterline" consumer). DESKTOP-tier: like the
    // macro it needs the forge's lit material — the caller folds forge.supported into glintGround. Driven per
    // frame via content.groundGlint.setSun(). Kept subtle (low gain) so it reads as damp sheen, not glitter.
    ground: { macro, glint: glintGround ? { density: 1.6, rough: 0.55, micro: 0.16, gain: 0.4, waterline: { at: [0, 50], radius: 44, band: 7 } } : undefined },
    // sparse dead trees, CLEARED on the north/ocean side so the sea reads open.
    forest: { clearings: [{ x: 0, z: 0, r: 6 }, { x: 0, z: 40, r: 40 }] },
    structures: {
      clusters: [{ profile: 'decrepit', coastBase: 0.7, seedOffset: 0, pos: [-(R + 6), 0, -(R + 2)], scale: 1.25, material: 'stone', mobile: true, panicHide: true }],
    },
    ruins: { count: 12, innerR: 6, outerR: R - 6 },   // rubble on the LAND side (annulus stops short of the sea)
    // A Gerstner OCEAN: a big disc pushed NORTH so its near rim (~z=6) is the beach/shoreline, the sea
    // stretching away to the horizon (LOD flattens the far swell). Swell rolls SOUTH toward the beach; surf
    // foam breaks in the shallows. A cold dead-sea blue-green (survives the cool grade).
    water: {
      kind: 'ocean', at: [0, 50], radius: 44, depthPower: 0.7, opacity: 0.95,
      ripple: 0.55, speed: 1.0, glint: 0.85,
      waveAmp: 0.55, swellDir: [0.22, -1.0], wavelength: 13, steepness: 0.72, waveSpeed: 1.0,
      lodNear: 24, lodFar: 82, foam: 0.8, rings: 80,
      colors: { shallow: 0x466f76, deep: 0x11242c, sky: 0x51707a },
      // A14 GLINT — sun glitter on the Gerstner swell, the single most visible payoff of the arc: the sea
      // breaks into a moving field of sparkle in the sun's glare path, anti-aliasing to smooth sheen toward
      // the horizon (the constant-time LoD). Rides the mobile direct path; ?glint=0 → 0 → byte-identical.
      glintDensity: glintWater ? 3.4 : 0, glintRough: 0.5, glintMicro: 0.13, glintGain: 1.6,
    },
  };
}

// ARC A21 — THE CITY GENERATOR's own proof: a full PLAYABLE city, generated from a SENTENCE. Every vocab
// group the arc added fires here: 'metropolis' (city trigger) · 'dense'/'grid' (a genuinely denser,
// grid-pattern urban fabric) · 'harbour' (both the city's own shoreline AND the actual Gerstner water body
// — the SAME `water` field the natural-arena maps already use) · 'modern' (glass-tower era palette).
export const METROPOLIS_DESC = 'a dense grid metropolis on a rain-slick harbour, modern glass towers';

/** metropolisBase({ seed, playRadius, macro, glintWater, glintGround }) → recipe #5 (A21): the config-
 *  DEPENDENT scaffolding — no forest/ruins/cover-buildings (the CITY is the primary content), a `city.scale`
 *  that maps citygen's native ~7.7-unit-radius island onto hoard2's actual PLAY_RADIUS (26), and the
 *  Gerstner harbour water disc centred on the city so the island reads as surrounded by water on every side
 *  (an island city, not a one-sided coastline like the natural-arena maps). The urban DIMENSIONS (block
 *  pattern/density/era/waterfront-shape) come from recipeFromText(METROPOLIS_DESC) merged over this — the
 *  arc's whole point: a city from a sentence, through the SAME interpreter every other map already uses.
 *  `location` drives the REAL SKY (createTrueStars/createSolarSystem/createConstellations, wired in
 *  world/index.js) — a real place's real stars/planets over a generated city: the combination the arc set
 *  out to prove. San Francisco: a real harbour city, matching the description's own "harbour" line. */
export function metropolisBase({ seed, playRadius, macro = true, glintWater = false, glintGround = false } = {}) {
  const CITY_SCALE = 3.4;   // citygen's native extent (~7.7u) × 3.4 ≈ 26u — matches hoard2's own PLAY_RADIUS
  return {
    meta: { name: 'metropolis', seed },
    biome: 'forest',   // unused (city.enabled makes the CITY the primary content); kept for schema completeness
    terrain: { enabled: true },   // the distant hill-rim backdrop still shows past the water, for free
    forest: { count: 0, mobileCount: 0 },
    ruins: { count: 0 },
    buildings: { count: 0 },
    scatter: { enabled: false },
    city: {
      enabled: true, scale: CITY_SCALE,
      groundWetness: glintGround ? 0.75 : 0,   // "rain-slick" — wet-street glint (A14's material, wired for city ground)
      streetLife: 0.6,                          // a real crowd, not an empty CG city
      location: { latDeg: 37.7749, lonDeg: -122.4194, label: 'San Francisco' },
    },
    // The Gerstner harbour, CENTRED on the city (not pushed to one edge like the natural maps) so the island
    // reads as surrounded by water — radius sized just past the scaled city's own shoreline (~26u + margin).
    water: {
      kind: 'ocean', at: [0, 0], radius: 46, depthPower: 0.75, opacity: 0.94,
      ripple: 0.5, speed: 1.0, glint: 0.85,
      waveAmp: 0.4, swellDir: [0.3, -1.0], wavelength: 11, steepness: 0.6, waveSpeed: 1.0,
      lodNear: 30, lodFar: 90, foam: 0.7, rings: 90,
      colors: { shallow: 0x3f6f7a, deep: 0x102028, sky: 0x4a6a76 },
      glintDensity: glintWater ? 3.2 : 0, glintRough: 0.5, glintMicro: 0.14, glintGain: 1.5,
    },
  };
}
