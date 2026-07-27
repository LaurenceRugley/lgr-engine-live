/* ============================================================
   hoard2 · src/world/scatter.js — deterministic RUIN scatter + HARVEST derivation (pure, engine-free).
   ------------------------------------------------------------
   The gameplay ruins (rubble props the survivor navigates + scavenges) are placed here as a seeded
   dart-throw in an ANNULUS around the arena heart: inside `innerR` stays open (the fight + barriers
   live there — matches createForest's central clearing), outside `outerR` is backdrop. This is the
   DEGRADED-tier "sparse primitives" representation (prompt degrade ladder) AND the always-on source of
   the ruin FOOTPRINTS the facade reports — so obstacles()/harvestNodes() are testable without a GPU
   (createCity's grid gives no per-building positions; the ratified profile city is the visual backdrop,
   these primitives are the interactive ruins).

   PURE + node-tested (Rule 9): it takes an rng FUNCTION (the caller passes ctx.rng.fork('world')), never
   Math.random and never the sim stream — so a world roll cannot perturb the sim trace (DONE #10). Same
   seed ⇒ same ruins; draining the 'sim' fork first changes NOTHING here (the forks are decorrelated).

   C++ anchor: Poisson-ish rejection sampling with an O(n²) neighbour test — trivial at these counts.
   ============================================================ */

/** scatterRuins({ rng, count, innerR, outerR, minSpacing }) → [{ x, z, r, kind }].
 *  `rng` is a () => [0,1) stream (a named fork). Rejects candidates inside innerR or within minSpacing of
 *  an already-placed ruin, so the heart stays open and the ruins never clump (long sightlines). */
export function scatterRuins({ rng, count = 14, innerR = 8, outerR = 24, minSpacing = 3.0 } = {}) {
  const kinds = ['wall', 'husk', 'rubble']; // a broken wall, a gutted building husk, a debris pile
  const radii = { wall: 1.1, husk: 1.6, rubble: 0.8 };
  const placed = [];
  const minS2 = minSpacing * minSpacing;
  const span = outerR - innerR;
  const maxAttempts = count * 40;
  for (let att = 0; att < maxAttempts && placed.length < count; att++) {
    // uniform-over-annulus: area-correct radius so ruins don't crowd the inner ring.
    const rr = Math.sqrt(innerR * innerR + rng() * (outerR * outerR - innerR * innerR));
    const ang = rng() * Math.PI * 2;
    const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
    let ok = true;
    for (const p of placed) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < minS2) { ok = false; break; } }
    if (!ok) continue;
    const kind = kinds[Math.floor(rng() * kinds.length)];
    const scl = 0.8 + rng() * 0.7;
    const yaw = rng() * Math.PI * 2;
    placed.push({ x, z, r: radii[kind] * scl, kind, scl, yaw });
  }
  void span;
  return placed;
}

/** deriveHarvest(trees, ruins, cfg) → { wood:[{x,z,amount}], scrap:[{x,z,amount}] }.
 *  wood grows on the (dead) trees, scrap is salvaged from the ruins — the two sources the fortify loop
 *  needs (DONE #4: neither alone funds a full rebuild). Pure map from positions → node amounts. */
export function deriveHarvest(trees, ruins, { woodAmount = 6, scrapAmount = 8 } = {}) {
  const wood = trees.map((t) => ({ x: t.x, z: t.z, amount: woodAmount }));
  const scrap = ruins.map((r) => ({ x: r.x, z: r.z, amount: r.kind === 'husk' ? scrapAmount + 4 : scrapAmount }));
  return { wood, scrap };
}
