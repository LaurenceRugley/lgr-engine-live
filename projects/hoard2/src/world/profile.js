/* ============================================================
   hoard2 · src/world/profile.js — the DECREPIT city profile (pure, engine-free).
   ------------------------------------------------------------
   The ratified ruin route (prompt ⚙ (a), pre-freeze CITYGEN-PROFILE-OBJECT lesson): instead of the
   three baked PROFILES (manhattan/paris/neoTokyo, citygen.js:79-117), we hand createCity a CUSTOM
   profile OBJECT — same shape as a baked entry — that re-skins the generator into a "decrepit" place:
   SPARSE, LOW, DESATURATED, mostly-DARK (abandoned) structures. citygen consumes it (proven by
   citygen-profile.test.mjs) and the object DRIVES generation (coast.base shifts the extent, palette
   shifts the colours, the character knobs shift the massing).

   This module is PURE (no `@lgr/engine-core`, no THREE) so it stays node-testable: the freeze forbids
   importing the barrel in a node test (its index re-exports .frag/.vert → ERR_UNKNOWN_FILE_EXTENSION).
   We build a COMPLETE profile from scratch (every field createCity reads) rather than spreading a baked
   one, so the test can import THIS with zero engine cost and still diff it against the real PROFILES[0].

   C++ anchor: a `constexpr CityProfile` literal — a data table the generator reads, no behaviour here.

   The decrepit MARKERS (what the test pins as "decrepit"):
     • hMax LOW      — ruins are stumps, not towers (collapsed to a storey or two).
     • roofRate LOW  — roofs have fallen in (few intact roof details).
     • nightLit ~0   — abandoned: almost no windows glow at night (the dark the torches fight).
     • towers DESAT  — grey/brown rubble palette, low saturation (weathered concrete + rust), vs the
                       colourful baked cities.
   ============================================================ */

// The decrepit palette: weathered concrete greys + rust/mud browns. Deliberately LOW-saturation so the
// diff-vs-PROFILES[0] "desaturated" assertion holds by construction, and the ruins read grim not candy.
export const DECREPIT_TOWERS = ['#4a4640', '#3c3833', '#565049', '#463f38', '#332f2b'];

/** buildDecrepitProfile(coastBase) → a full custom profile object for createCity({ profile }).
 *  `coastBase` sets the nominal land half-size (extent = blockHalf + coastBase); the caller pins it so
 *  the ruined settlement footprint is predictable. Pure — same args ⇒ byte-identical object. */
export function buildDecrepitProfile(coastBase = 0.7) {
  return {
    key: 'decrepit',
    name: 'Decrepit',
    // bodies: weathered rubble (low-sat greys/browns). ground/street/etc: mud, cracked asphalt, dead grass.
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
