/* ============================================================
   @lgr/engine-core — forge-recipes.js — the HOARD surface recipe set + a one-call material bundle.
   ------------------------------------------------------------
   A recipe is the "source" a family shader is compiled with: which fragment program, how many px,
   how many world metres the tile covers (feature scale + normal slope), the seed (the variant knob),
   the THREE material props, and a flat fallbackColor for the no-bake path (iOS p0). Recipes live in
   CORE (engine-first: the ability AND its content parameters are reusable); the hoard project only
   wires the resulting materials onto its meshes.

   Five hoard surfaces across four families (wood + scrap share the wood-scrap shader via uMetalMix):
     ground  — the decrepit forest floor (the big read; 1024, 4 m tile)
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

export const HOARD_SURFACES = {
  ground: { frag: forgeGroundFrag, size: 1024, worldSize: 6.0, relief: 0.05, seed: 0x6d, roughness: 1.0, metalness: 0.0, fallbackColor: 0x5f5a4a },
  bark:   { frag: forgeBarkFrag,   size: 512,  worldSize: 0.9, relief: 0.11, seed: 0x2b, roughness: 0.95, metalness: 0.0, fallbackColor: 0x4b3c2c, uniforms: { uHealth: { value: 0.0 } } },
  // B2: healthy living-tree bark (warm brown + lichen) for the few live trees among the dead.
  barkLive: { frag: forgeBarkFrag, size: 512, worldSize: 0.9, relief: 0.10, seed: 0x2b, roughness: 0.9, metalness: 0.0, fallbackColor: 0x5a4a2e, uniforms: { uHealth: { value: 1.0 } } },
  stone:  { frag: forgeStoneFrag,  size: 1024, worldSize: 2.4, relief: 0.08, seed: 0x51, roughness: 0.9, metalness: 0.0, fallbackColor: 0x36322c },
  wood:   { frag: forgeWoodscrapFrag, size: 512, worldSize: 1.2, relief: 0.06, seed: 0x1f, roughness: 0.92, metalness: 0.0, fallbackColor: 0x7a5a36, uniforms: { uMetalMix: { value: 0.0 } } },
  scrap:  { frag: forgeWoodscrapFrag, size: 512, worldSize: 1.0, relief: 0.05, seed: 0x8c, roughness: 0.55, metalness: 0.85, fallbackColor: 0x4a453d, uniforms: { uMetalMix: { value: 1.0 } } },
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
