/* ============================================================
   @lgr/engine-core — urban-profile (ARC A21): urban recipe DIMENSIONS → a citygen.js profile object.
   ------------------------------------------------------------
   THE TRANSLATOR that unifies the two world-generation systems the arc names: citygen.js (a profile OBJECT
   drives generation — towers[]/ground/hMax/sigma/roofRate/pSplit/nightLit/roofTint/coast{}/landmarks[], see
   citygen.js:79-116) and the world-recipe schema (a plain, serialisable DOCUMENT a text description can
   produce). This module is the pure mapping: a recipe's `city{}` fields (world-recipe.js's own schema
   section — heightMean/heightSpread/subdivisionRate/etc, the SAME knobs renamed for the schema's document
   conventions) resolve to the flat object `createCity({ profile })` has always consumed.

   PURE + engine-free (no THREE, no barrel import) — same discipline as world-profiles.js's
   buildDecrepitProfile/buildIntactProfile (which this module's shape matches exactly), so it stays
   node-testable and composes with createWorldFromRecipe.js's existing `resolveProfile` pattern.

   THE ROUND-TRIP PROOF (urban-profile.test.mjs) is the arc's own honesty check: an urban recipe built from
   citygen.js's literal `manhattan` values round-trips through `cityProfileFromUrban` to an object that
   deep-equals `PROFILES[0]` — and, the stronger claim, produces an IDENTICAL generated city (`state.sig`/
   `extent`/`meshCount`) at the same seed. If a future profile can't round-trip this way, that's a real
   schema gap to say plainly (per the arc's own instruction), not a reason to fudge this mapping.

   ERA PRESETS are sugar, not policy: `era` fills `layout`+`palette` DEFAULTS; any field a recipe sets
   explicitly under `city.layout`/`city.palette` always wins (checked in that order in `resolveField`).
   ============================================================ */

// A neutral, era-less fallback — used only when NEITHER an `era` preset NOR an explicit palette field
// supplies a value, so `cityProfileFromUrban` never emits `null`/`undefined` into a citygen profile field.
const NEUTRAL_PALETTE = {
  towers: ['#B9C2CC', '#8FA0AE', '#5C6B78', '#3E4B57'],
  ground: '#7CC455', street: '#9AA0A6', sidewalk: '#C8CCD0', park: '#5DB347', water: '#3F9AC8',
  shopfronts: ['#C04A3A', '#3A7AC0', '#C09A2A'], glass: '#7FA8CC',
  winColors: ['#ffd27a', '#9ad6ff'], roofTint: null,
};
const NEUTRAL_LAYOUT = { heightMean: 2.6, heightSpread: 0.6, subdivisionRate: 0.6, roofDetailRate: 0.3, nightLitFraction: 0.4, streetWidth: 1 };

/* ERA PRESETS — a bundle of palette + layout defaults per architectural era, the "sugar" a text
   description's era keyword resolves to (see world-recipe-text.js's urban vocabulary). Each is a
   PARTIAL — only the fields an era actually wants to steer are set; everything else falls through to
   NEUTRAL_PALETTE/NEUTRAL_LAYOUT. */
export const URBAN_ERAS = {
  modern: {
    palette: {
      towers: ['#7FA8CC', '#A8C8E8', '#5C7A94', '#3E5468'],
      shopfronts: ['#3A7AC0', '#2A9AA0', '#C0B02A'], glass: '#9FCBEF', winColors: ['#ffe6a8', '#bfe8ff'],
      roofTint: null,
    },
    layout: { roofDetailRate: 0.5, nightLitFraction: 0.55 },   // glass towers, lots of rooftop plant, lit at night
  },
  classic: {
    palette: {
      towers: ['#E8DCC0', '#D9B98A', '#C4A874'], ground: '#8CC46A',
      shopfronts: ['#C04A3A', '#3A6B5A', '#7A5AC0'], glass: '#5A6B7A', winColors: ['#ffdca0', '#ffcaa0'],
      roofTint: '#6A7886',   // a mansard/zinc-roof accent, same device Paris uses
    },
    layout: { roofDetailRate: 0.15, nightLitFraction: 0.42 },   // low-rise, quieter roofline, sleepier at night
  },
  brutalist: {
    palette: {
      towers: ['#8A8B87', '#6E6F6B', '#57584F', '#41423B'], ground: '#6B7268', street: '#5A5D58',
      shopfronts: ['#8A3A2A', '#4A5A4A', '#6A5A2A'], glass: '#4A5052', winColors: ['#d8c890', '#a8c0c8'],
      roofTint: '#3A3B37',
    },
    layout: { heightSpread: 0.45, roofDetailRate: 0.4, nightLitFraction: 0.25 },   // dense concrete core, dim at night
  },
};

/* Resolve one field in priority order: an explicit recipe value → the era preset's value → the neutral
   default. `explicit` may itself hold `null`s (the schema's own default shape) — those are treated as
   "not set" so the era/neutral fallback still applies. */
function resolveField(explicit, eraValue, neutralValue) {
  if (explicit !== null && explicit !== undefined) return explicit;
  if (eraValue !== null && eraValue !== undefined) return eraValue;
  return neutralValue;
}

/** cityProfileFromUrban(city) → a full createCity({ profile }) object, same shape as a citygen.js
 *  PROFILES entry or a world-profiles.js builder's output. `city` is the NORMALISED recipe's `city` field
 *  (world-recipe.js's `defaultRecipe().city` shape — always present after `normalizeRecipe`). Pure: same
 *  `city` object ⇒ byte-identical profile object. */
export function cityProfileFromUrban(city) {
  const era = (city.era && URBAN_ERAS[city.era]) || null;
  const eraPal = era?.palette || {};
  const eraLay = era?.layout || {};
  const pal = city.palette || {};
  const lay = city.layout || {};

  const towers = resolveField(pal.towers, eraPal.towers, NEUTRAL_PALETTE.towers);
  const ground = resolveField(pal.ground, eraPal.ground, NEUTRAL_PALETTE.ground);
  const street = resolveField(pal.street, eraPal.street, NEUTRAL_PALETTE.street);
  const sidewalk = resolveField(pal.sidewalk, eraPal.sidewalk, NEUTRAL_PALETTE.sidewalk);
  const park = resolveField(pal.park, eraPal.park, NEUTRAL_PALETTE.park);
  const water = resolveField(pal.water, eraPal.water, NEUTRAL_PALETTE.water);
  const shopfronts = resolveField(pal.shopfronts, eraPal.shopfronts, NEUTRAL_PALETTE.shopfronts);
  const glass = resolveField(pal.glass, eraPal.glass, NEUTRAL_PALETTE.glass);
  const winColors = resolveField(pal.winColors, eraPal.winColors, NEUTRAL_PALETTE.winColors);
  const roofTint = resolveField(pal.roofTint, eraPal.roofTint, NEUTRAL_PALETTE.roofTint);

  const heightMean = resolveField(lay.heightMean, eraLay.heightMean, NEUTRAL_LAYOUT.heightMean);
  const heightSpread = resolveField(lay.heightSpread, eraLay.heightSpread, NEUTRAL_LAYOUT.heightSpread);
  const subdivisionRate = resolveField(lay.subdivisionRate, eraLay.subdivisionRate, NEUTRAL_LAYOUT.subdivisionRate);
  const roofDetailRate = resolveField(lay.roofDetailRate, eraLay.roofDetailRate, NEUTRAL_LAYOUT.roofDetailRate);
  const nightLitFraction = resolveField(lay.nightLitFraction, eraLay.nightLitFraction, NEUTRAL_LAYOUT.nightLitFraction);

  const wf = city.waterfront || {};
  const coast = { base: wf.base, out: wf.out, in: wf.in, jag: wf.jag };

  return {
    key: city.key || 'urban', name: city.name || 'Urban',
    towers: [...towers], ground, street, sidewalk, park, water,
    shopfronts: [...shopfronts], glass, winColors: [...winColors],
    hMax: heightMean, sigma: heightSpread, roofRate: roofDetailRate, pSplit: subdivisionRate,
    nightLit: nightLitFraction, roofTint,
    coast,
    landmarks: [...(city.landmarks || [])],
  };
}
