/* ============================================================
   @lgr/engine-core — world-recipe (A9 TEXT→WORLD): THE RECIPE SCHEMA — a world as plain data.
   ------------------------------------------------------------
   THE ABILITY (A9 headline): map generation stops being one hand-wired forest and becomes a LIBRARY. A
   world RECIPE is a plain, serialisable data object describing an arena — its biome/ground, tree + prop
   scatter, built-structure clusters, interactive ruins, cover buildings, contextual water, and atmosphere.
   createWorldFromRecipe (the interpreter) COMPOSES the engine modules the recipe names into a playable
   arena; recipeFromText (the front-end) maps a keyword description to a recipe. The RECIPE is the real API
   — deterministic, no AI at runtime — and it is also the future world-editor's document format.

   This module is PURE (no THREE): the schema, a documented default, and a deep-merge normaliser. The
   interpreter (createWorldFromRecipe.js) reads a NORMALISED recipe; a caller supplies only the fields that
   differ from the default and normalizeRecipe fills the rest.

   ── THE SCHEMA (every field; a recipe overrides any subset) ───
   meta:       { name, description, seed }            — seed null → the interpreter uses ctx.rng.masterSeed
   biome:      'forest' | 'swamp' | string            — a label for the front-end / debugging (not consumed)
   ground:     { material, extentPad, macro, fallbackColor }
                 material   — ctx.surfaces key for the flat arena disc ('ground')
                 extentPad  — metres added to config.ARENA_EXTENT for the disc radius (6)
                 macro      — apply the de-tiling macro field (desktop/forge only) (true)
   terrain:    { enabled, preset, size, worldSizeMul, baseYDrop, chunks, color, flatShading }
                 the hill-rim BACKDROP (bowl silhouette; the flat disc covers its centre)
   forest:     { count, mobileCount, radiusPad, arenaR, minSpacing, heightScale, clearings[], archetypes[], materials{} }
                 radiusPad  — added to config.ARENA_EXTENT for the scatter radius (-2)
                 arenaR     — null → config.PLAY_RADIUS (colliders only emit inside it)
                 archetypes — createForest archetype mix [{key,weight,r}]
                 materials  — archetypeKey → ctx.surfaces key ({ bare:'bark', conifer:'barkLive' })
                 castShadowMobile — whether trees cast on mobile (false)
   structures: { clusters:[ { profile, coastBase, seedOffset, pos:[x,y,z], scale, material, mobile, castShadow } ] }
                 profile    — 'decrepit' | 'intact' (world-profiles) | a full createCity profile object
                 backdrop skyline clusters placed beyond the play radius; the FIRST is the panic-hide backdrop
   ruins:      { count, innerR, outerR, outerRPad, minSpacing, fork, heights{husk,wall,rubble}, slab, material, slabMaterial }
                 interactive rubble in the play ring → obstacles + scrap harvest; outerR null → PLAY_RADIUS+outerRPad
   buildings:  { count, innerR, radSpan, fork, material, castShadow, scavenge:{wood,scrap} }
                 off-centre cover → obstacles + cover cylinders + a richer scavenge node at each base
   scatter:    { enabled, count, mobileCount, radius, radiusPad, clearR, minSpacing, fork, defs{} }
                 cosmetic ground props (rock/debris/stump) → NOT obstacles/harvest (raycast off)
   harvest:    { woodAmount, scrapAmount, treeKinds[] }  — node amounts over trees (wood) + ruins (scrap)
   water:      { kind:'none' } | { kind:'pond'|'lake'|'shore'|'ocean', at:[x,z], radius, y, depthPower, opacity,
                 ripple, speed, glint, segments, colors:{shallow,deep,sky},
                 // 'ocean' (A13 Gerstner) adds: waveAmp, swellDir:[x,z], wavelength, steepness, waveSpeed,
                 //   lodNear, lodFar, foam, rings — a rolling swell to the horizon with surf on the shallows.
                 // A14 GLINT (any water kind): glintDensity (0=off → byte-identical), glintRough, glintMicro, glintGain }
                 CONTEXTUAL water (B2: never a global plane), A12 createWaterSurface — analytic ripple + depth
                 ramp + soft shoreline + Fresnel sky-tint, mobile-safe. 'pond' = small centred; 'lake'/'shore'
                 = big off-centre so the rim arcs across the arena as a shoreline (play ring on the land side);
                 'ocean' = a big disc pushed off so its near rim is the beach, Gerstner swell rolling in (A13)
   atmosphere: { gradeCool, weather, clouds:{enabled,altitude}, fogTint, fogDensityMul }
                 DECLARED here, APPLIED project-side (hoard2 wires engine flags + the weather schedule from these)
                 weather: 'schedule' (the day-phase schedule) | 'clear'|'rain'|'fog'|'snow' (a pinned kind)
   playRing:   { radius }   — null → config.PLAY_RADIUS (the sim's clamp; the interpreter echoes it back)
   city:       { enabled, seedOffset, blockPattern, era, layout{}, palette{}, waterfront{}, landmarks[],
                 groundWetness, streetLife, location } — ARC A21: a full PLAYABLE city as PRIMARY content
                 (not a backdrop cluster — see `structures.clusters[]` above for that). `enabled:false`
                 (the default) means this whole field is never read — byte-identical no-op for every
                 EXISTING recipe (forest/swamp/coastal/lakeshore never touch it).
                 enabled      — build a city as the world's primary content (false)
                 seedOffset   — XOR'd into the master seed so a city recipe's seed differs from a sibling
                                forest/water pass reading the same base seed (0)
                 scale        — a uniform scale on the whole generated city (same mechanism
                                `structures.clusters[].scale` already uses for backdrop clusters) — citygen's
                                native block-grid size (~7.7 world units radius) is far smaller than a
                                typical PLAY_RADIUS; a recipe scales the WHOLE city (buildings, streets,
                                shoreline, and the derived obstacles/extent all scale together) to fit the
                                arena it's dropped into. `1` = citygen's native size, unchanged (1)
                 spawnClearR  — a walkable city (unlike the flying camera projects/city was built for) needs
                                its ORIGIN kept clear, the same way `forest.clearings` already protects the
                                natural-arena maps' spawn point — otherwise a building can land directly on
                                (0,0) and box the player's camera in on frame one. In citygen's own UNSCALED
                                units (applied before `scale` above); `0` disables clearing entirely (1.3)
                 blockPattern — 'grid' (citygen.js's existing, UNCHANGED algorithm) | 'radial' (new: towers
                                along concentric rings + spokes) | 'organic' — ACCEPTED but NOT YET
                                IMPLEMENTED (falls back to 'grid' with a console warning; see the arc's
                                honest-gaps note rather than a silently-faked pattern) ('grid')
                 era          — an optional PRESET name ('modern'|'classic'|'brutalist') that fills
                                `layout`+`palette` defaults; any field set explicitly below still wins (null)
                 key/name     — cosmetic profile labels (citygen's `key`/`name` fields); null → 'urban'/'Urban' (null / null)
                 layout       — the citygen "character knobs", renamed for the schema's own vocabulary:
                                heightMean (→ hMax), heightSpread (→ sigma), subdivisionRate (→ pSplit —
                                the literal density-of-lot-splitting knob), roofDetailRate (→ roofRate),
                                nightLitFraction (→ nightLit), streetWidth (a multiplier on the block-to-
                                block street gap — 'radial' only; 'grid' keeps citygen's own fixed layout,
                                unchanged, so the value is accepted but inert there)
                 palette      — any subset of towers[]/ground/street/sidewalk/park/water/shopfronts[]/
                                glass/winColors[]/roofTint; unset fields fall back to the era preset, then
                                a neutral default. This is DATA, not a lossy named swatch — an exact literal
                                colour set round-trips exactly (the arc's own manhattan proof relies on this)
                 waterfront   — { kind:'none'|'river'|'harbour'|'coast', base, out, in, jag } → citygen's
                                `coast{}` shape (the shoreline silhouette); `kind` is a DESCRIPTIVE label
                                only — the actual water MESH at the shore is the existing top-level `water`
                                field above (reused, per the arc's own instruction, not duplicated)
                 landmarks    — landmark factory keys (reuses the existing keys — 'empireState' etc.) ([])
                 groundWetness— 0..1 → glint density (createGlintMaterial) applied to the city's own ground/
                                street materials post-hoc; 0 = untouched, dry (0)
                 streetLife   — 0..1 → the character/crowd horde's size for this city (0 = no crowd) (0)
                 location     — { latDeg, lonDeg, label } → drives the REAL-SKY ability (createCelestial +
                                createTrueStars/createSolarSystem/createConstellations) for "the sky over
                                this city, right now"; null → the project's existing artistic sky (unchanged)
   ============================================================ */

// The neutral DEFAULT recipe. A caller (hoard2's forest recipe, recipeFromText's swamp) overrides the
// fields that differ; normalizeRecipe deep-merges over this. Numeric positions/radii a caller resolves from
// its own config (e.g. PLAY_RADIUS) are passed in already-resolved — the recipe stays plain data.
export function defaultRecipe() {
  return {
    meta: { name: 'untitled', description: '', seed: null },
    biome: 'forest',
    ground: { material: 'ground', extentPad: 6, macro: true, fallbackColor: 0x5f5a4a },
    terrain: { enabled: true, preset: 'valley', size: 96, worldSizeMul: 2.6, baseYDrop: 6, chunks: 4, color: 0x3f3a30, flatShading: true },
    forest: {
      count: 96, mobileCount: 46, radiusPad: -2, arenaR: null, minSpacing: 1.9, heightScale: 2.5,
      castShadowMobile: false,
      clearings: [{ x: 0, z: 0, r: 6 }],
      archetypes: [
        { key: 'bare', weight: 0.62, r: 0.34 },
        { key: 'rock', weight: 0.24, r: 0.3 },
        { key: 'conifer', weight: 0.14, r: 0.38 },
      ],
      materials: { bare: 'bark', conifer: 'barkLive' },
    },
    structures: { clusters: [] },
    ruins: {
      count: 14, innerR: 8, outerR: null, outerRPad: -2, minSpacing: 3.2, fork: 'world',
      heights: { husk: 2.2, wall: 1.4, rubble: 0.6 }, slab: true, material: 'stone', slabMaterial: 'scrap',
    },
    buildings: { count: 2, innerR: 11, radSpan: 5, fork: 'buildings', material: 'stone', castShadow: true, scavenge: { wood: 14, scrap: 18 } },
    scatter: {
      enabled: true, count: 58, mobileCount: 30, radius: null, radiusPad: -0.5, clearR: 1.8, minSpacing: 1.25, fork: 'scatter',
      defs: {
        rock:   { geo: 'ico', size: 0.26, material: 'stone', y: 0.10, sink: 0.5 },
        debris: { geo: 'box', size: [0.5, 0.09, 0.34], material: 'wood', y: 0.05, sink: 0 },
        stump:  { geo: 'cyl', size: [0.15, 0.19, 0.42, 6], material: 'bark', y: 0.21, sink: 0 },
      },
    },
    harvest: { woodAmount: 6, scrapAmount: 8, treeKinds: ['bare', 'conifer'] },
    water: { kind: 'none' },
    atmosphere: { gradeCool: 1, weather: 'schedule', clouds: { enabled: true, altitude: 3.5 }, fogTint: null, fogDensityMul: 1 },
    playRing: { radius: null },
    city: {
      enabled: false, seedOffset: 0, scale: 1, spawnClearR: 1.3, blockPattern: 'grid', era: null, key: null, name: null,
      layout: { heightMean: 2.6, heightSpread: 0.6, subdivisionRate: 0.6, roofDetailRate: 0.3, nightLitFraction: 0.4, streetWidth: 1 },
      palette: { towers: null, ground: null, street: null, sidewalk: null, park: null, water: null, shopfronts: null, glass: null, winColors: null, roofTint: null },
      waterfront: { kind: 'none', base: 0.7, out: 0.7, in: 0.4, jag: 1.0 },
      landmarks: [], groundWetness: 0, streetLife: 0, location: null,
    },
  };
}

// Deep-merge `partial` over `base` (plain objects recurse; arrays + primitives REPLACE — a recipe that sets
// `forest.archetypes` replaces the whole mix, it doesn't append). Returns a new object; inputs untouched.
function deepMerge(base, partial) {
  if (partial === undefined) return base;
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return partial;
  if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) return partial;
  const out = { ...base };
  for (const k of Object.keys(partial)) out[k] = deepMerge(base[k], partial[k]);
  return out;
}

// normalizeRecipe(partial) → a COMPLETE recipe (defaults filled). The interpreter always receives this.
export function normalizeRecipe(partial = {}) {
  return deepMerge(defaultRecipe(), partial);
}

// mergeRecipes(...partials) → one merged PARTIAL (objects merge, arrays/primitives replace, later wins).
// Use to layer a text-parser fragment over a biome base BEFORE normalising: normalizeRecipe(mergeRecipes(base, parsed)).
export function mergeRecipes(...partials) {
  return partials.reduce((acc, p) => deepMerge(acc, p || {}), {});
}

// The documented biome labels the text front-end recognises (also the schema's `biome` domain). Kept here
// so the parser and any editor share ONE list. Named RECIPE_BIOMES to avoid colliding with terrain.js's
// BIOMES (the heightfield biome palette — a different concept).
export const RECIPE_BIOMES = ['forest', 'swamp'];
