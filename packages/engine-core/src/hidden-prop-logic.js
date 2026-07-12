/* ============================================================
   hidden-prop-logic.js — the PURE half of createHiddenProp (L: the hidden cardboard box).
   ------------------------------------------------------------
   THREE-free and shader-free on purpose, so node:test can drive the two pieces of real
   business logic without a GPU: WHERE the prop goes, and WHEN it fires. Same split as
   `hero/hero-ring.js` (pure ring) vs `hero/createHeroDirector.js` (the GL machinery).

   C++ anchor: this is the header-only, side-effect-free half of a translation unit — the
   geometry math and the state machine — while hidden-prop.js holds the part that touches
   the graphics context.
   ============================================================ */

/* pickStreetIntersection(layout, rnd) — a deterministic, collision-free spot for a prop.

   The city is an N×N grid of square BLOCKs separated by STREET gaps, spaced PITCH apart
   (citygen.js: PITCH = BLOCK + STREET). Buildings only ever stand ON blocks, so the street
   centre-lines BETWEEN blocks are guaranteed empty — no collision test needed, ever.

   Block centres run   (g - (N-1)/2) * PITCH   for g in [0, N-1].
   The interior street lines sit exactly halfway between adjacent block centres, which is
   the same series shifted by half a pitch:   (i - (N-2)/2) * PITCH   for i in [0, N-2].
   That is N-1 lines per axis → (N-1)² intersections. Pick one by index.

   `rnd` is a float in [0,1) supplied by the CALLER's seeded PRNG (mulberry32 lives in
   citygen.js, which imports THREE — keeping it out of here is what makes this file
   node-testable). Same seed in → same intersection out, on every machine.

   C++ anchor: `std::vector<Point> intersections; return intersections[size_t(rnd * n)];`
   with the vector never materialised — we index the lattice arithmetically. */
export function pickStreetIntersection({ PITCH, N }, rnd) {
  if (!(N >= 2)) throw new RangeError(`pickStreetIntersection: N must be >= 2, got ${N}`);
  const lines = N - 1;                       // interior street centre-lines per axis
  const at = (i) => (i - (lines - 1) / 2) * PITCH;
  // Clamp guards a caller handing us exactly 1.0 (or a hair over) from a sloppy PRNG.
  const total = lines * lines;
  const k = Math.min(total - 1, Math.max(0, Math.floor(rnd * total)));
  return { x: at(k % lines), z: at(Math.floor(k / lines)) };
}

/* createProximityLatch(radius) — "fire once when something first comes close enough."

   WHY a latch and not a plain distance test: the egg is a ONCE-PER-SESSION delight. A bare
   `d < r` would re-fire the chip every frame the craft loiters inside the radius, and again
   on every future flyby. The latch is what encodes that intent, so it is what the test pins.

   Compares SQUARED distances — `dx*dx + dz*dz < r*r` — to skip the sqrt (idiom:
   placed-life.js:431). Y is ignored: this is a top-down proximity ring, so a craft passing
   directly overhead at altitude still trips it.

   C++ anchor: a `std::once_flag` guarding a callback, with the predicate inlined. */
export function createProximityLatch(radius) {
  const r2 = radius * radius;
  let fired = false;
  return {
    /* Returns true EXACTLY ONCE — on the first call that lands inside the radius. */
    test(dx, dz) {
      if (fired) return false;
      if (dx * dx + dz * dz >= r2) return false;
      fired = true;
      return true;
    },
    get fired() { return fired; },
  };
}
