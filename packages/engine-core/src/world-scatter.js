/* ============================================================
   @lgr/engine-core — world-scatter (A9): deterministic play-ring scatter + harvest + cover placement.
   ------------------------------------------------------------
   THE ABILITY (lifted from hoard2 for the A9 world-recipe interpreter): the pure POSITION generators that
   populate a playable arena — sparse ruins in an annulus, decorative props across the disc, cover buildings
   off-centre, and the harvest-node derivation over them. These were born project-local in hoard2; the A9
   interpreter (createWorldFromRecipe) composes them for ANY recipe, so they belong in the core per the
   engine-first rule. hoard2's src/world/scatter.js now RE-EXPORTS these (byte-identical — this is the same
   code, moved) so its determinism trace and node tests are unchanged.

   PURE + engine-free (no THREE, no barrel import) so it is node-testable and node-safe to deep-import.
   Every generator takes an `rng` FUNCTION (a named fork, e.g. ctx.rng.fork('world')) — never Math.random,
   never the sim stream — so a world roll cannot perturb the sim trace (hoard2 DONE #10; the forks are
   decorrelated off the master seed). Same seed + same params ⇒ byte-identical placements.

   C++ anchor: Poisson-ish rejection sampling with an O(n²) neighbour test — trivial at these counts.
   ============================================================ */

/** scatterRuins({ rng, count, innerR, outerR, minSpacing }) → [{ x, z, r, kind, scl, yaw }].
 *  Sparse broken masses in an ANNULUS: inside `innerR` stays open (the fight area), outside `outerR` is
 *  backdrop. `rng` is a () => [0,1) stream (a named fork). Rejects candidates inside innerR or within
 *  minSpacing of an already-placed ruin, so the heart stays open and the ruins never clump. kind ∈
 *  {wall, husk, rubble}; r is the collider footprint (radii[kind] × per-instance scale). */
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

/** scatterProps({ rng, count, radius, clearR, minSpacing }) → [{ x, z, kind, scl, yaw, tilt }].
 *  Small DECORATIVE ground props (rock · debris · stump) across the WHOLE play disc — including the open
 *  central floor the ruins leave flat — to break the plane the iso camera stares at. Cosmetic: low +
 *  walk-over, NOT obstacles/harvest, so they never touch gameplay or the sim trace. A small central `clearR`
 *  keeps the (0,0) spawn open. Area-uniform over the disc + a min-spacing reject so they don't clump. */
export function scatterProps({ rng, count = 48, radius = 24, clearR = 1.8, minSpacing = 1.3 } = {}) {
  const kinds = ['rock', 'debris', 'stump'];
  const placed = [];
  const minS2 = minSpacing * minSpacing;
  const maxAttempts = count * 30;
  for (let att = 0; att < maxAttempts && placed.length < count; att++) {
    const rr = Math.sqrt(clearR * clearR + rng() * (radius * radius - clearR * clearR));  // area-uniform annulus
    const ang = rng() * Math.PI * 2;
    const x = Math.cos(ang) * rr, z = Math.sin(ang) * rr;
    let ok = true;
    for (const p of placed) { const dx = x - p.x, dz = z - p.z; if (dx * dx + dz * dz < minS2) { ok = false; break; } }
    if (!ok) continue;
    placed.push({ x, z, kind: kinds[Math.floor(rng() * kinds.length)], scl: 0.7 + rng() * 0.8, yaw: rng() * Math.PI * 2, tilt: (rng() - 0.5) * 0.5 });
  }
  return placed;
}

/** placeCoverBuildings({ rng, count, innerR, radSpan, wBase, wSpan, dBase, dSpan, hBase, hSpan }) →
 *  [{ x, z, w, d, h, r }]. Off-centre intact structures in the play ring: real cover the flow-field routes
 *  around, the walker pushes out of, and ballistics stops shots on. `r` is the cover cylinder (footprint ×
 *  height). Seeded via a named fork; the rng() call ORDER (ang, rad, w, d, h per building) is fixed so a
 *  given fork reproduces the same buildings — the sim (flow field + ballistics) reads these, so it is
 *  trace-critical. Defaults reproduce hoard2's original inline 2-building loop byte-for-byte. */
export function placeCoverBuildings({
  rng, count = 2, innerR = 11, radSpan = 5,
  wBase = 4.4, wSpan = 1.6, dBase = 3.6, dSpan = 1.3, hBase = 3.9, hSpan = 1.1,
} = {}) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const ang = (i / count) * Math.PI * 2 + rng() * 1.1 + 0.7;   // spread + jitter + offset
    const rad = innerR + rng() * radSpan;                        // off-centre, inside the play ring
    const x = Math.cos(ang) * rad, z = Math.sin(ang) * rad;
    const w = wBase + rng() * wSpan, d = dBase + rng() * dSpan, h = hBase + rng() * hSpan;
    out.push({ x, z, w, d, h, r: Math.max(w, d) * 0.5 });        // cover cylinder = footprint × height
  }
  return out;
}

/** deriveHarvest(trees, ruins, cfg) → { wood:[{x,z,amount}], scrap:[{x,z,amount}] }.
 *  wood grows on the (dead) trees, scrap is salvaged from the ruins — the two fortify-loop sources. Pure map
 *  from positions → node amounts (husks yield extra scrap). */
export function deriveHarvest(trees, ruins, { woodAmount = 6, scrapAmount = 8 } = {}) {
  const wood = trees.map((t) => ({ x: t.x, z: t.z, amount: woodAmount }));
  const scrap = ruins.map((r) => ({ x: r.x, z: r.z, amount: r.kind === 'husk' ? scrapAmount + 4 : scrapAmount }));
  return { wood, scrap };
}

/** citySolidsToObstacles(solids) → { obstacles:[{x,z,r}], buildingCylinders:[{x,z,r,h}] }. ARC A21: the
 *  ADAPTER that lets a full citygen.js city register for collision the same way forest/ruins/buildings
 *  already do. `solids` is citygen's own `state.solids` — a flat SoA Float32Array, 6 floats/solid
 *  (minX,minY,minZ, maxX,maxY,maxZ; see citygen.js's own L112 comment for the exact layout). Each AABB
 *  becomes a circle: centre = the AABB's XZ midpoint, radius = the horizontal HALF-DIAGONAL (a
 *  conservative approximation — never smaller than the true footprint, so the sim's circle collision never
 *  lets a player clip through a box corner). `h` (maxY-minY) is carried through for buildingCylinders so
 *  ballistics/LOS can still height-gate a shot the way it already does for cover buildings.
 *  Pure — no THREE, no rng — a deterministic function of citygen's own deterministic output. */
export function citySolidsToObstacles(solids) {
  const obstacles = [], buildingCylinders = [];
  for (let i = 0; i < solids.length; i += 6) {
    const minX = solids[i], minY = solids[i + 1], minZ = solids[i + 2];
    const maxX = solids[i + 3], maxY = solids[i + 4], maxZ = solids[i + 5];
    const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
    const r = Math.hypot((maxX - minX) / 2, (maxZ - minZ) / 2);
    obstacles.push({ x, z, r });
    buildingCylinders.push({ x, z, r, h: maxY - minY });
  }
  return { obstacles, buildingCylinders };
}
