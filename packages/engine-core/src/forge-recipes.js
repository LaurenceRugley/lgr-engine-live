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
