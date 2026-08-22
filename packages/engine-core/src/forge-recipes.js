/* ============================================================
   @lgr/engine-core — forge-recipes.js — the HOARD surface recipe set + a one-call material bundle.
   ------------------------------------------------------------
   A recipe is the "source" a family shader is compiled with: which fragment program, how many px,
   how many world metres the tile covers (feature scale + normal slope), the seed (the variant knob),
   the THREE material props, and a flat fallbackColor for the no-bake path (iOS p0). Recipes live in
   CORE (engine-first: the ability AND its content parameters are reusable); the hoard project only
   wires the resulting materials onto its meshes.

   Five hoard surfaces across four families (wood + scrap share the wood-scrap shader via uMetalMix):
     ground  — the decrepit forest floor (the big read; 1024, 6 m tile)
     bark    — dead-tree trunks/branches (0.9 m tile up the trunk)
     stone   — ruin concrete/plaster (the ruined settlement + rubble)
     wood    — barrier planks (wood-scrap shader, uMetalMix 0)
     scrap   — salvaged sheet metal (wood-scrap shader, uMetalMix 1; rougher, metallic)

   Seeds are fixed constants so the bake is deterministic (same world every load — the capture/
   regression contract). Relief is in METRES so the Sobel normal has physical strength.
   ============================================================ */
import forgeGroundFrag from './shaders/forge-ground.frag';
import forgeBarkFrag from './shaders/forge-bark.frag';
import forgeStoneFrag from './shaders/forge-stone.frag';
import forgeWoodscrapFrag from './shaders/forge-woodscrap.frag';
import forgeGunmetalFrag from './shaders/forge-gunmetal.frag';
import forgeFacadeFrag from './shaders/forge-facade.frag';
import forgeAsphaltFrag from './shaders/forge-asphalt.frag';
import forgeGlassFrag from './shaders/forge-glass.frag';
import forgeTerrainFrag from './shaders/forge-terrain.frag';
import { createTriplanarForgeMaterial, tilesPerUnit } from './triplanar-forge.js';   // A-FLORA: UV-free ground

export const HOARD_SURFACES = {
  // A7-1: relief 0.05 → 0.09 — the ISO floor is the biggest surface on screen and was reading flat; a
  // stronger Sobel normal gives the trodden clods + mud hollows real raking-light depth (desktop-tier; the
  // mobile Lambert twin drops the normal map, so this is a desktop lift). The macro DE-TILING (world-scale
  // patches that break the ~13× repeat grid) is wired separately via applyGroundMacro in the hoard2 world.
  ground: { frag: forgeGroundFrag, size: 1024, worldSize: 6.0, relief: 0.09, seed: 0x6d, roughness: 1.0, metalness: 0.0, fallbackColor: 0x5f5a4a },
  // A5: deeper bark relief (0.11 → 0.16) so the ridged grain + plate fissures read as real bark surface
  // depth on desktop (the Sobel normal is scaled by relief). Mobile's Lambert twin drops the normal map, so
  // this is naturally a desktop-tier lift (the brief's "forge bark pass"). size 512 → 768 for finer grooves.
  bark:   { frag: forgeBarkFrag,   size: 768,  worldSize: 0.9, relief: 0.16, seed: 0x2b, roughness: 0.95, metalness: 0.0, fallbackColor: 0x4b3c2c, uniforms: { uHealth: { value: 0.0 } } },
  // B2: healthy living-tree bark (warm brown + lichen) for the few live trees among the dead.
  barkLive: { frag: forgeBarkFrag, size: 768, worldSize: 0.9, relief: 0.14, seed: 0x2b, roughness: 0.9, metalness: 0.0, fallbackColor: 0x5a4a2e, uniforms: { uHealth: { value: 1.0 } } },
  stone:  { frag: forgeStoneFrag,  size: 1024, worldSize: 2.4, relief: 0.08, seed: 0x51, roughness: 0.9, metalness: 0.0, fallbackColor: 0x36322c },
  wood:   { frag: forgeWoodscrapFrag, size: 512, worldSize: 1.2, relief: 0.06, seed: 0x1f, roughness: 0.92, metalness: 0.0, fallbackColor: 0x7a5a36, uniforms: { uMetalMix: { value: 0.0 } } },
  scrap:  { frag: forgeWoodscrapFrag, size: 512, worldSize: 1.0, relief: 0.05, seed: 0x8c, roughness: 0.55, metalness: 0.85, fallbackColor: 0x4a453d, uniforms: { uMetalMix: { value: 1.0 } } },
};

// B4 WEAPON SKINS — forge bake-param sets on the gunmetal shader (skins at zero asset cost; a small tile
// since a pistol is ~0.2 m). fresh vs worn are the two side-by-side variants for the critic.
export const WEAPON_SKINS = {
  gunmetal:      { frag: forgeGunmetalFrag, size: 512, worldSize: 0.35, relief: 0.015, seed: 0x33, roughness: 0.42, metalness: 1.0, fallbackColor: 0x24262d, uniforms: { uWear: { value: 0.35 } } },
  gunmetal_worn: { frag: forgeGunmetalFrag, size: 512, worldSize: 0.35, relief: 0.025, seed: 0x77, roughness: 0.55, metalness: 0.95, fallbackColor: 0x2e2f28, uniforms: { uWear: { value: 1.0 } } },
};

// sensible default world extents (metres) each surface tile repeats across — the wiring may override.
const DEFAULT_EXTENTS = { ground: 52, bark: 2.4, barkLive: 2.4, stone: 3.0, wood: 1.2, scrap: 1.2 };

/* Bake every hoard surface and return ready MeshStandardMaterials, repeats pre-set from the extents.
   forge.supported === false => every material is the recipe's flat fallback (LOWP phone path). */
export function forgeHoardMaterials(forge, { extents = {}, matOpts = {} } = {}) {
  const ext = { ...DEFAULT_EXTENTS, ...extents };
  const out = {};
  for (const key of Object.keys(HOARD_SURFACES)) {
    const recipe = HOARD_SURFACES[key];
    const repeat = Math.max(1, ext[key] / recipe.worldSize);
    out[key] = forge.makeMaterial(recipe, { repeat, ...(matOpts[key] || {}) });
  }
  return out;
}

/* ============================================================
   ARC A-ART — CITY SURFACES. Beauty-campaign law (createTextureForge.js's own header): "forge +
   recipes in core, [project] wires only." createTextureForge's only consumer before this arc was
   hoard2 — the city wired none of it, which is why it rendered flat white/coloured boxes. Five
   surfaces, per DESIGN's brief, at three real new shaders (facade/asphalt/glass — buildings and
   streets need a genuinely different palette than hoard's ruin-grey) and two honest REUSES of an
   existing family where the fit is already exact: concrete IS forge-stone.frag's own stated subject
   ("ruin CONCRETE/plaster"), and a rooftop membrane/HVAC-box surface is the SAME dark worn metal
   forge-gunmetal.frag already bakes for weapon skins — a new .frag for either would just be
   forge-stone/forge-gunmetal with the seed changed, which is what the seed argument is FOR.
   ============================================================ */
export const CITY_SURFACES = {
  facade:   { frag: forgeFacadeFrag,  size: 1024, worldSize: 8.0,  relief: 0.03, seed: 0x4c, roughness: 0.85, metalness: 0.0, fallbackColor: 0x9a9488 },
  concrete: { frag: forgeStoneFrag,   size: 1024, worldSize: 3.0,  relief: 0.05, seed: 0x9e, roughness: 0.92, metalness: 0.0, fallbackColor: 0x6b6862 },
  asphalt:  { frag: forgeAsphaltFrag, size: 1024, worldSize: 6.0,  relief: 0.015, seed: 0x1a, roughness: 0.88, metalness: 0.0, fallbackColor: 0x2c2b29 },
  roof:     { frag: forgeGunmetalFrag, size: 512, worldSize: 2.0, relief: 0.02,  seed: 0x63, roughness: 0.6,  metalness: 0.8, fallbackColor: 0x3a3d42, uniforms: { uWear: { value: 0.6 } } },
  glass:    { frag: forgeGlassFrag,   size: 1024, worldSize: 4.0,  relief: 0.04, seed: 0x71, roughness: 0.12, metalness: 0.85, fallbackColor: 0x2b3a44 },
};

const CITY_DEFAULT_EXTENTS = { facade: 24, concrete: 12, asphalt: 40, roof: 10, glass: 16 };

/* ARC A-ART — DELIVER OPTIONS, DO NOT PICK (the brief, verbatim). Three DISTINCT looks, not one
   converged answer — each a small recipe override layered over CITY_SURFACES, same "seed is the
   variant knob" convention forge-recipes.js already uses for bark vs barkLive. `wallSurface` tells
   the wiring which baked surface key to put on building BODIES specifically (warm/contrast use the
   facade family; glass swaps the primary wall material to the glass family entirely — a real
   material change, not just a tint, which is what makes "cool glass and steel" actually read as
   glass rather than tinted plaster).
     warm     — the facade recipe as authored: warm plaster, moderate relief, matte roof.
     glass    — building walls forged with the GLASS family instead of facade; roof leans more
                metallic/less worn (fresher steel reads better against glass than weathered zinc).
     contrast — facade re-seeded with deeper storey/panel grooves + lower roughness (sharper
                specular pop under the sun) for a punchier, more graphic silhouette read.
   Owner picks; this arc ships all three as URL variants, not a recommendation baked as default. */
export const CITY_LOOKS = {
  warm: {
    wallSurface: 'facade',
    overrides: {},
  },
  glass: {
    wallSurface: 'glass',
    overrides: {
      roof: { seed: 0x8a, uniforms: { uWear: { value: 0.15 } } },   // fresher steel, less worn, pairs with clean glass
    },
  },
  contrast: {
    wallSurface: 'facade',
    overrides: {
      facade: { seed: 0x2f, relief: 0.05, roughness: 0.62 },   // deeper grooves read sharper, lower roughness pops the specular
    },
  },
};

/* Same one-call bundle shape as forgeHoardMaterials — bake every city surface, repeats pre-set from
   extents. A project passes its own extents (building footprint scale, road-tile width, …); the
   defaults here are reasonable city-block-scale guesses, not asserted as correct for every profile.
   `look` (a CITY_LOOKS key) layers that variant's recipe overrides over CITY_SURFACES before baking —
   omit it (or pass an unknown name) and every surface bakes at its plain CITY_SURFACES default. */
export function forgeCityMaterials(forge, { extents = {}, matOpts = {}, look = null } = {}) {
  const ext = { ...CITY_DEFAULT_EXTENTS, ...extents };
  const overrides = (look && CITY_LOOKS[look] && CITY_LOOKS[look].overrides) || {};
  const out = {};
  for (const key of Object.keys(CITY_SURFACES)) {
    const recipe = { ...CITY_SURFACES[key], ...(overrides[key] || {}) };
    const repeat = Math.max(1, ext[key] / recipe.worldSize);
    out[key] = forge.makeMaterial(recipe, { repeat, ...(matOpts[key] || {}) });
  }
  return out;
}

/* ============================================================================================
   A-FLORA (2026-08-21) — TERRAIN SURFACES: the open ground a district-based world stands on.
   --------------------------------------------------------------------------------------------
   Three parameter sets over ONE family shader (forge-terrain.frag, `uSurface` selects), sized for
   OPEN GROUND rather than for the hoard's iso floor: a 12 m tile, because these get tiled across a
   whole district and a 6 m tile at that extent shows its own repeat grid from the air.

   RELIEF IS THE REAL PER-SURFACE DIAL, and it is in METRES, so it is a physical claim rather than a
   look knob: sand ripples are centimetres deep (0.05), turf is lumpier (0.10), and a fractured rock
   shelf has real fissures (0.22). The Sobel normal pass scales by it directly, so getting these
   wrong is what makes ground read as wallpaper.

   Seeds are fixed constants — same world every load, which is the capture/regression contract the
   rest of this file already keeps.
   ============================================================================================ */
export const TERRAIN_SURFACES = {
  sand:  { frag: forgeTerrainFrag, size: 1024, worldSize: 12.0, relief: 0.05, seed: 0xd1, roughness: 0.97, metalness: 0.0, fallbackColor: 0xd9b775, uniforms: { uSurface: { value: 0.0 } } },
  rock:  { frag: forgeTerrainFrag, size: 1024, worldSize: 12.0, relief: 0.22, seed: 0xa7, roughness: 0.92, metalness: 0.0, fallbackColor: 0x7d7468, uniforms: { uSurface: { value: 1.0 } } },
  grass: { frag: forgeTerrainFrag, size: 1024, worldSize: 12.0, relief: 0.10, seed: 0x3e, roughness: 0.96, metalness: 0.0, fallbackColor: 0x6f9a4e, uniforms: { uSurface: { value: 2.0 } } },
};
/* The fallbackColors above are NOT decorative: they are terrain.js BIOMES' own hex values for
   desert (8), rock (5) and grassland (2). On a GPU with no high-precision fragment float the forge
   returns supported:false, every bake returns null, and the ground falls back to EXACTLY the flat
   biome colour the engine paints today — the ability degrades to the status quo, never to broken
   (triplanar-forge.js's own rule, and the reason these three numbers are copied rather than picked). */

/* Bake the three terrain surfaces as TRIPLANAR materials — textured ground with NO UVs.
   WHY TRIPLANAR AND NOT A REPEATING `map`: the terrain mesh is a chunked heightfield whose vertices
   carry position, normal and colour — and no UV attribute at all (terrain.js's fillChunk writes
   pos/nor/col/ao, full stop). Giving it UVs would mean a new attribute on every chunk, regenerated
   on every live sculpt. Sampling by WORLD POSITION needs none of that, and it has a second property
   that matters more on terrain than it did on the city: texel density becomes a property of the
   WORLD, so a steep slope and a flat plain get the same texture scale instead of the slope's
   texture being stretched by its own projection.

   `metresPerUnit` is the caller's world scale, and it is REQUIRED rather than defaulted, because a
   default here would silently produce ground at the wrong feature size in any world that disagreed
   — and "the sand looks wrong" is a much harder bug to find than a thrown error. tilesPerUnit()
   (triplanar-forge.js) does the conversion and is node-tested.

   Returns { sand, rock, grass } MeshStandardMaterials. `surfaces` narrows which get baked (baking
   costs GPU time at boot, so a world with no desert should not pay for sand).
   ============================================================================================ */
export function forgeTerrainMaterials(forge, { metresPerUnit, surfaces = null, detail = null, matOpts = {}, sharpness = 4.0 } = {}) {
  if (!(metresPerUnit > 0)) throw new Error('forgeTerrainMaterials: `metresPerUnit` is required and must be > 0 — it is how a recipe\'s worldSize in METRES becomes tiles per WORLD UNIT (see tilesPerUnit). Defaulting it would silently mis-scale the ground.');
  const keys = surfaces || Object.keys(TERRAIN_SURFACES);
  const out = {};
  for (const key of keys) {
    const recipe = TERRAIN_SURFACES[key];
    if (!recipe) throw new Error(`forgeTerrainMaterials: unknown surface '${key}' (known: ${Object.keys(TERRAIN_SURFACES).join(', ')})`);
    const scale = tilesPerUnit({ worldSize: recipe.worldSize, metresPerUnit });
    /* forge.bake() returns null when unsupported; createTriplanarForgeMaterial takes that null and
       returns the flat fallbackColor material, so the no-bake path needs no branch here. */
    const set = forge && forge.supported ? forge.bake(recipe) : null;
    out[key] = createTriplanarForgeMaterial({
      side: set,
      /* TOP AND SIDE ARE THE SAME SET, deliberately, and this is the one place terrain differs from
         the city in KIND rather than in numbers. On a box arena the top face is a roof and the side
         is a wall — two materials, which is what the top/side split exists for. On terrain both are
         the same ground seen at different slopes: a cliff face is the same rock as the shelf above
         it. Splitting them here would draw a horizon line across every hillside. */
      top: set,
      scale,
      sharpness,
      detail,
      fallbackColor: recipe.fallbackColor,
      roughness: recipe.roughness,
      metalness: recipe.metalness,
      flatShading: false,
      ...(matOpts[key] || {}),
    });
    out[key].userData.terrainSurface = { key, scale, worldSize: recipe.worldSize, metresPerUnit, relief: recipe.relief, baked: !!set };
  }
  return out;
}
