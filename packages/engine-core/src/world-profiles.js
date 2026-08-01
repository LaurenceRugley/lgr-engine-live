/* ============================================================
   @lgr/engine-core — world-profiles (A9): the DECREPIT / INTACT custom city profiles.
   ------------------------------------------------------------
   Lifted from hoard2 for the A9 world-recipe interpreter: custom createCity({ profile }) objects that
   re-skin the frozen citygen into a "decrepit" settlement (sparse, low, desaturated, mostly-dark) and a
   more-INTACT variant of the same dead place (taller, roofed, a few lit windows) — the "dying, not
   uniformly destroyed" read. These were born project-local in hoard2; the interpreter composes them for
   any recipe that asks for a ruined/intact structure cluster, so they belong in core (engine-first).
   hoard2's src/world/profile.js now RE-EXPORTS these (byte-identical — the same objects, moved), so its
   citygen-profile diff test is unchanged.

   PURE + engine-free (no THREE, no barrel import) so it stays node-testable: a full profile object built
   from scratch (every field createCity reads), same shape as a baked PROFILES entry.
   C++ anchor: a `constexpr CityProfile` literal — a data table the generator reads, no behaviour here.
   ============================================================ */

// The decrepit palette: weathered concrete greys + rust/mud browns. Deliberately LOW-saturation.
export const DECREPIT_TOWERS = ['#4a4640', '#3c3833', '#565049', '#463f38', '#332f2b'];

/** buildDecrepitProfile(coastBase) → a full custom profile object for createCity({ profile }).
 *  `coastBase` sets the nominal land half-size (extent = blockHalf + coastBase). Pure — same args ⇒
 *  byte-identical object (a sparse/low/desaturated/dark ruined settlement). */
export function buildDecrepitProfile(coastBase = 0.7) {
  return {
    key: 'decrepit',
    name: 'Decrepit',
    towers: [...DECREPIT_TOWERS],
    ground: '#3b3a30',      // dead, mossy earth (matches the arena ground disc)
    street: '#4a473f',      // cracked, weed-choked asphalt
    sidewalk: '#524d44',    // broken kerb
    park: '#4a4d38',        // overgrown, dying green
    water: '#3a4038',       // stagnant, algal
    shopfronts: ['#5a4030', '#4a4438', '#5c3a2c'],  // rusted, boarded fronts — muted
    glass: '#2e332e',       // dark, broken glazing (barely reflective)
    winColors: ['#6a5a3a', '#5a5030'],              // the rare dim ember behind a window
    hMax: 1.8,       // LOW — ruins are 1–2 storeys, not towers (manhattan 4.6)
    sigma: 0.75,     // broad, no dense downtown core (ruins spread thin)
    roofRate: 0.06,  // LOW — most roofs have collapsed
    pSplit: 0.8,     // fragmented lots → smaller, broken masses
    nightLit: 0.05,  // ABANDONED — almost nothing glows at night
    roofTint: '#3a352e',
    coast: { base: coastBase, out: 0.6, in: 0.35, jag: 0.7 },  // gentle, low shore — a tired, flat place
    landmarks: [],   // no icons — this place has no monuments left standing
  };
}

/** buildIntactProfile(coastBase) → a MORE-INTACT variant of the same decrepit place. Same low-sat grim
 *  palette (it's the same dead world), but towers still up / roofs intact / a few windows lit / a denser
 *  standing core — so the two clusters read as ONE settlement at different stages of ruin. Pure; seeded. */
export function buildIntactProfile(coastBase = 0.7) {
  const d = buildDecrepitProfile(coastBase);
  return {
    ...d,
    key: 'intact', name: 'Intact',
    hMax: 4.6,        // still-standing multi-storey blocks (vs the decrepit 1.8 stumps)
    sigma: 0.5,       // a denser standing core (vs 0.75 spread-thin rubble)
    roofRate: 0.62,   // roofs mostly INTACT (vs 0.06 collapsed)
    pSplit: 0.5,      // larger, whole masses (vs 0.8 fragmented)
    nightLit: 0.3,    // some windows still glow — a few holdouts (vs 0.05 abandoned)
  };
}
