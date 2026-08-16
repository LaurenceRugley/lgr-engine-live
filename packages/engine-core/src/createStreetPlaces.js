/* ============================================================
   @lgr/engine-core — createStreetPlaces (ARC A-CROWD, 2026-08-15): WHERE PEOPLE ACTUALLY ARE.
   ------------------------------------------------------------
   THE MEASURED PROBLEM THIS EXISTS FOR (swing-ledger.md OPEN #30). The civilian density dial was
   ratified 150 -> 600 on a bench showing frame cost is FLAT, and 600 STILL read as a quiet street.
   The arithmetic says why and it is not a rendering problem: 600 bodies spread uniformly over an
   84.7 u city with a 4.6 u block pitch is ~3200 u of street to stand in — one person every 5 u, i.e.
   about one every 30 metres at this world's ~6 m/u. A uniform crowd is a THIN crowd at every count you
   can afford. **The lever is DISTRIBUTION, not count**, and this module is the distribution.

   WHAT IT REFUTED ON FIRST CONTACT, which is why the module is shaped the way it is rather than the
   way the ledger entry guessed. OPEN #30 said "cluster onto sidewalks, doorways and plazas". Measured
   on the A-SKYLINE city (tools/city-visibility-bench.mjs), the crowd was ALREADY 98.3% inside the
   painted carriageway — because that is where the open ground IS. Sampling the collider on a 0.1 u
   lattice: the road band (|d| <= 0.235 * spacing from a centreline) is 99.3% open and holds 87% of all
   walkable area, while the painted SIDEWALK band (out to 0.375 * spacing) is only 40.8% open — the
   building footprints are wider than the road, so most of the pavement is drawn UNDER the towers.
   "Move them onto the sidewalk" is not a lever in this city; there is nowhere for them to move to.
   The axis that IS free is ALONG the street: which stretches of it are occupied, and how tightly.

   SO THE ABILITY IS: A SPARSE SET OF GATHERING PLACES, AND THE BEHAVIOUR THAT KEEPS BODIES IN THEM.
   Three parts, all pure number-crunching — this module imports NOTHING (no THREE, no engine), exactly
   like createFlowField and createAgentSim, so it is directly node-testable.

     1. THE CANDIDATES — every spot on a street grid where people would really stand, derived from the
        SAME arithmetic `street-grid.js` paints the road with and `street-kit.js` stands its lamp posts
        on (tower centres on a `spacing` lattice through the origin ⇒ street centrelines at
        (k + 0.5) * spacing). Three kinds:
          · CORNER  — the four kerb corners of a junction. Where a crossing queue forms, and the single
                      most reliable place to find a knot of people in any real city.
          · STOP    — mid-block, at the kerb, on the block fractions street-kit already puts its
                      shelters and benches on. A bus stop, a doorway, a bench.
          · PLAZA   — an explicitly-passed open patch (box-arena's `plaza` clears the centre block).
                      Weighted heaviest and given the biggest radius: it is the one place in the level
                      that can hold a real crowd.

     2. THE SELECTION, AND IT IS THE WHOLE DESIGN. A 19x19 city offers ~2600 candidates. Spreading 600
        bodies over 2600 gathering places is the uniform crowd again with extra steps, so the module
        keeps only the strongest `count` of them — and the consumer states `count` as
        **population / perPlace**, i.e. as the SIZE OF A GROUP rather than as a number of places. That
        makes the feel scale-free: change the civilian count and the number of gathering places tracks
        it, so a group stays a group. Selection is by a deterministic index-addressed hash score times a
        per-kind weight, then a sort — the same rule box-arena's determinism follows, so growing the
        city does not reshuffle the corner you were just looking at.

     3. THE BEHAVIOUR — this object IS a `createAgentSim` placer (`spawn` / `wander` / `dwellScale`),
        which is the seam the sim grew for it. Bodies SPAWN in places, they mostly re-target WITHIN the
        place they are in (`stay`), they occasionally walk to a NEARBY place (`travelR` — a crowd that
        teleports its intentions across the map is a crowd of commuters, not of pedestrians), and they
        LOITER when they get there: `dwellScale` multiplies the sim's own idle roll by up to
        1 + `dwell` inside a place. **The loiter is the half that actually makes a crowd**, and it is
        worth being explicit about why: if bodies only TARGET places but dwell the same everywhere, the
        steady-state occupancy is set by travel time and comes out nearly uniform. Time spent standing
        still is what accumulates a group.

   DETERMINISM. Every roll is taken off the injected stream (`srng`, e.g. rng.fork('sim')) in a FIXED
   ORDER with a BOUNDED number of tries, so a seed replays a crowd exactly. The module itself holds no
   RNG: `spawn`/`wander` are handed the sim's stream, which is what keeps one stream for one sim.

   ZERO PER-CALL ALLOCATION on the hot paths (`spawn`, `wander`, `dwellScale` all write into a caller
   `out` or return a number); the candidate list is built once at construction.

   C++ anchor: `places` is a `std::vector<Place>` built once and never resized; `nearest` is a linear
   scan with small constants over that vector (called on ARRIVAL, not per frame — a few hundred times a
   second across the whole crowd, not 600 times a frame); the returned object is a strategy interface
   the sim holds by reference, i.e. dependency injection, so the sim keeps knowing nothing about cities.

   CONTRACT
   --------
   createStreetPlaces({
     spacing,        // block pitch — street centrelines at (k + 0.5) * spacing (REQUIRED to match the level)
     extent,         // half-width of the gridded square, world units
     radius,         // keep places within this distance of the origin (defaults to extent) — the peopled disc
     roadHalf,       // half-width of the asphalt; kerb places sit just outside it
     count,          // how many gathering places to KEEP (state it as population / perPlace)
     placeR,         // radius of an ordinary place (default 0.55)
     plaza,          // { x, z, r, w } or null — an explicit open patch, weighted heaviest
     blockFracs,     // where along a block the mid-block stops go (default [0.32, 0.68])
     stay,           // P(re-target inside the place I am already in) — default 0.72
     travelR,        // how far a body will pick its NEXT place (default 3 * spacing)
     dwell,          // idle multiplier at the centre of a place (default 3.2 ⇒ up to 4.2x the base roll)
     kerb,           // how far outside roadHalf a kerb place sits (default 0.12)
     blocked,        // (x, z) => bool — the consumer's "is this inside a building" test; candidates that
                     // fail it are dropped at construction, and sampled points re-test it
     seed,
   }) -> {
     places,                 // [{ x, z, r, w, kind }] — the kept set, for a probe or a debug draw
     spawn(srng, out),       // out.x / out.z — a body's start
     wander(srng, c, out),   // out.x / out.z — a body's next target, given its record { x, z }
     dwellScale(c),          // 1 .. 1 + dwell — the idle multiplier for THIS body here (1 for walkers)
     nearest(x, z),          // the nearest place record within its own radius, else null
     stats,                  // { candidates, kept, corners, stops, plazas, perPlace? }
   }
   ============================================================ */

/* The same 32-bit index-addressed hash box-arena and street-kit use, for the same reason (see their
   headers). Copied rather than imported so this module depends on no level generator — a placement
   module that needs an arena to exist is a placement module only one project can use. */
function hash3(i, j, seed) {
  let h = (i * 0x27d4eb2d) ^ (j * 0x165667b1) ^ (seed * 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* Per-kind base weight — what makes a corner beat a mid-block bench in the selection sort, and what
   makes the plaza win outright. These are the only "art" numbers in the module and they are stated as
   one table rather than sprinkled through the generator. */
const KIND_W = { plaza: 4.0, corner: 1.0, stop: 0.62 };

export function createStreetPlaces(opts = {}) {
  const P = {
    spacing: 4.6, extent: 40, radius: null, roadHalf: null,
    count: 64, placeR: 0.55, plaza: null, blockFracs: [0.32, 0.68],
    /* the share of the kept places each kind gets — see the quota note in §2. Corners are the stronger
       gathering spot; stops are what keep a MID-BLOCK canyon from being empty, which is half of every
       street a player walks down. */
    mix: { corner: 0.55, stop: 0.45 },
    stay: 0.72, travelR: null, dwell: 3.2, kerb: 0.12,
    /* THE SPLIT, and it is the answer to the one thing pure clustering measurably makes WORSE. A crowd
       in which everybody loiters is a crowd of statues at 100 corners and a dead street everywhere
       else: measured, pure clustering took the dead-view share from 20% to 28-40% while multiplying
       group size 5-17x, because at a fixed population clustering only moves VARIANCE — the mean
       agents-in-frame barely changes (11.5 -> 12.2). `loiterFrac` is the share of bodies that gather;
       the rest are WALKERS, permanently in transit between places, which is what keeps the stretches
       BETWEEN the groups occupied. Real pavements have both, and the two failure modes are exactly the
       two arms: all-walkers is the uniform trickle, all-loiterers is a knot and a ghost town. Decided
       per agent off its own id (a hash, not a roll — it consumes no stream and never changes). */
    loiterFrac: 0.6,
    blocked: null, seed: 11,
    ...opts,
  };
  if (P.roadHalf == null) P.roadHalf = P.spacing * 0.30;
  if (P.radius == null) P.radius = P.extent;
  if (P.travelR == null) P.travelR = P.spacing * 3;
  const KERB = P.roadHalf + P.kerb;

  /* THE FOUR APPROACHES OF A JUNCTION, as offsets from its centre. One per compass point: just past
     the kerb on the street you are standing IN (`KERB`), and off to one side of that street's centre
     line (`lateral`) so the queue is not standing in the traffic lane. Built once. */
  const lateral = P.roadHalf * 0.6;
  const STOP_LAT = P.roadHalf * 0.78;   // mid-block stops sit further out — right at the road edge
  const APPROACH = [
    [lateral, -KERB],    // north approach, kerbside
    [-lateral, KERB],    // south
    [-KERB, -lateral],   // west
    [KERB, lateral],     // east
  ];

  /* ---- 1. THE CANDIDATES. -------------------------------------------------------------------- */
  const cand = [];
  const K = Math.ceil(P.extent / P.spacing) + 1;
  const push = (x, z, r, kind, i, j) => {
    if (Math.hypot(x, z) > P.radius) return;
    if (Math.abs(x) > P.extent || Math.abs(z) > P.extent) return;
    if (P.blocked && P.blocked(x, z)) return;
    cand.push({ x, z, r, kind, w: KIND_W[kind], s: hash3(i, j, P.seed) * KIND_W[kind] });
  };

  for (let li = -K; li <= K; li++) {
    const cx = (li + 0.5) * P.spacing;
    if (Math.abs(cx) > P.extent) continue;
    for (let lj = -K; lj <= K; lj++) {
      const cz = (lj + 0.5) * P.spacing;
      if (Math.abs(cz) > P.extent) continue;
      /* THE FOUR CROSSING APPROACHES OF ONE JUNCTION — a queue waiting to cross, which is the brief's
         own example and the most reliable knot of people in any real city.
         THE OFFSET IS ASYMMETRIC, AND THAT IS A MEASURED CORRECTION rather than a refinement. The first
         cut put these DIAGONALLY at the kerb on both axes (± KERB, ± KERB), which is where the pavement
         corner is on a drawing — and in this city the pavement corner is INSIDE THE TOWER. Sampling the
         collider on a 0.1 u lattice: ground at 1.15-1.25 u from a centreline is only 62% open and by
         1.7 u it is 3%, because the building footprints are wider than the road. So half the corner
         candidates were rejected outright and the survivors sat in the dead pockets between towers,
         where a group has no sightline down either street. Pulling ONE axis back into the carriageway
         (`approach` ~ 0.6 * roadHalf) puts the queue where the zebra actually meets the kerb: open
         ground by construction, and visible from both streets it serves. `q` alternates WHICH axis is
         the short one, so all four approaches of a junction are covered. */
      for (let q = 0; q < 4; q++) {
        push(cx + APPROACH[q][0], cz + APPROACH[q][1], P.placeR, 'corner', li * 977 + lj, q * 31 + 7);
      }
    }
    /* MID-BLOCK STOPS on this street line, at the block fractions street-kit dresses. `axis` runs the
       loop twice so both the north-south and the east-west lines get them. */
    for (let axis = 0; axis < 2; axis++) {
      for (let m = -K; m <= K; m++) {
        const blockStart = (m + 0.5) * P.spacing;
        for (let f = 0; f < P.blockFracs.length; f++) {
          const along = blockStart + P.blockFracs[f] * P.spacing;
          if (Math.abs(along) > P.extent) continue;
          const side = ((m + f) & 1) ? 1 : -1;
          /* KERBSIDE, BUT INSIDE THE OPEN GROUND — same correction as the approaches above. A bench or
             a shelter belongs ON the pavement, and in this city the pavement is drawn under the tower,
             so the honest spot for the body standing at it is the edge of the carriageway. */
          const x = axis === 0 ? along : cx + side * STOP_LAT;
          const z = axis === 0 ? cx + side * STOP_LAT : along;
          push(x, z, P.placeR * 0.9, 'stop', axis * 4099 + li * 71 + m, f * 13 + 3);
        }
      }
    }
  }
  if (P.plaza && P.plaza.r > 0) {
    const pl = P.plaza;
    cand.push({ x: pl.x || 0, z: pl.z || 0, r: pl.r, kind: 'plaza', w: pl.w || KIND_W.plaza, s: 1e9 });
  }

  /* ---- 2. THE SELECTION, BY A PER-KIND QUOTA — and the quota is not tidiness, it is a bug fix with a
     measurement behind it. The first cut sorted ALL candidates by `hash * kindWeight` and kept the top
     `count`: with 1170 candidates and 67 kept, every single kept place came out a CORNER, because a
     stop's score can never exceed its kind weight (0.62) while a corner's reaches 1.0. The mid-block
     vocabulary — the benches, shelters and doorways this module exists to gather people at — was
     structurally impossible to select, and `city-visibility-bench` printed it as `0 stop` in the arm
     that was supposed to have them. Worse, it put every group at a junction, so the CANYON vantages
     (half the metric's vantage set) had nothing to see and the dead-view share went 20% -> 28.5%.
     Quotas per kind, filled by each kind's own hash ranking, keep both vocabularies alive at any
     `count`. THE GENERAL LESSON, and it is one this repo keeps re-learning: a weight that is meant to
     express PREFERENCE turns into a hard EXCLUSION the moment it multiplies a score you then truncate.
     Ties broken by coordinates so the sort is deterministic regardless of engine sort stability. ---- */
  const byKind = new Map();
  for (const c of cand) {
    if (!byKind.has(c.kind)) byKind.set(c.kind, []);
    byKind.get(c.kind).push(c);
  }
  const want = Math.max(1, Math.min(cand.length, P.count | 0));
  const places = [];
  const plazas = byKind.get('plaza') || [];
  for (const p of plazas) places.push(p);           // there is at most one and it is never squeezed out
  const rest = Math.max(0, want - places.length);
  for (const [kind, list] of [['corner', byKind.get('corner') || []], ['stop', byKind.get('stop') || []]]) {
    const share = P.mix[kind] != null ? P.mix[kind] : 0.5;
    list.sort((a, b) => (b.s - a.s) || (a.x - b.x) || (a.z - b.z));
    for (const p of list.slice(0, Math.round(rest * share))) places.push(p);
  }
  const N = places.length;

  const stats = {
    candidates: cand.length, kept: N,
    corners: places.filter((p) => p.kind === 'corner').length,
    stops: places.filter((p) => p.kind === 'stop').length,
    plazas: places.filter((p) => p.kind === 'plaza').length,
  };

  /* ---- 3. THE BEHAVIOUR. ---------------------------------------------------------------------- */

  /* A point inside a place. sqrt(u) is area-uniform over the disc — the same correction `populate`'s
     own scatter uses, and without it every group would be a bullseye with a hollow rim. TWO rolls,
     always, whatever happens: a variable roll COUNT is how a deterministic stream stops being one. */
  function pointIn(srng, p, out) {
    const ang = srng.range(0, Math.PI * 2);
    const rad = Math.sqrt(srng()) * p.r;
    out.x = p.x + Math.cos(ang) * rad;
    out.z = p.z + Math.sin(ang) * rad;
  }

  /* The nearest place whose own radius contains (x,z) — "am I AT a place", not "which place is
     closest", because the second question has an answer everywhere and the first one does not.
     Linear scan over the KEPT set (tens to low hundreds), called on arrival, never per frame. */
  function nearest(x, z) {
    let best = null, bd = Infinity;
    for (let i = 0; i < N; i++) {
      const p = places[i];
      const dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd && d2 <= p.r * p.r) { bd = d2; best = p; }
    }
    return best;
  }

  /* Weighted pick over a filtered subset, on ONE roll: sum the weights, then walk the same filter
     subtracting until the draw is spent. TWO PASSES, ONE UNIFORM — and it is worth naming why it is
     not the one-pass form, because the one-pass form was written here first and the metric caught it
     within an hour. `if (u * total <= w) chosen = p` with a FIXED u is not weighted reservoir sampling
     (A-Res needs a fresh draw per item): with u fixed, "chosen" ends up being the LAST item satisfying
     u <= w_i / total_i, which for small u is simply the last item in the list. It piled most of a
     600-body crowd onto a handful of places — `city-visibility-bench` read max 514 visible from one
     vantage and a median of 1, i.e. the crowd had collapsed into a lump. A sampler that is subtly
     wrong looks exactly like a sampler that is right until something counts what came out of it. */
  function pickWeighted(srng, x, z, r2) {
    const u = srng();   // taken FIRST and unconditionally: an early return that skips the roll makes
                        // the stream depend on how many places happen to be in range.
    let total = 0;
    for (let i = 0; i < N; i++) {
      const p = places[i];
      if (r2 >= 0) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz > r2) continue; }
      total += p.w;
    }
    if (total <= 0) return null;
    let target = u * total;
    for (let i = 0; i < N; i++) {
      const p = places[i];
      if (r2 >= 0) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz > r2) continue; }
      target -= p.w;
      if (target <= 0) return p;
    }
    return places[N - 1];   // float drift only; the loop above spends the draw by construction
  }

  /* The travel pick: weighted over the places within `travelR`, falling back to the nearest place
     outright when a body is somewhere with nothing in range (a rooftop refugee, a map corner) so it
     walks home instead of standing still forever. Always ONE roll, whichever branch runs. */
  /* Is this body a walker? A pure function of its id — no roll, so the split costs the stream nothing
     and never re-rolls itself into a different crowd mid-run. */
  function isWalker(id) { return hash3(id | 0, 0x5ea1, P.seed) >= P.loiterFrac; }

  function pickNear(srng, x, z, far = false) {
    /* A WALKER RANGES FURTHER, because its whole job is to be on the stretch BETWEEN two gathering
       places; a walker with a loiterer's range just orbits the same corner from further out. */
    const r = far ? P.travelR * 2.4 : P.travelR;
    const chosen = pickWeighted(srng, x, z, r * r);
    if (chosen) return chosen;
    let best = places[0], bd = Infinity;
    for (let i = 0; i < N; i++) {
      const p = places[i], dx = p.x - x, dz = p.z - z, d2 = dx * dx + dz * dz;
      if (d2 < bd) { bd = d2; best = p; }
    }
    return best;
  }

  return {
    places, stats,
    /* THE PLACER INTERFACE `createAgentSim` consumes (opts.placer). */
    spawn(srng, out) {
      /* Weighted over the whole kept set (r2 < 0 = no distance filter), so a plaza opens with a crowd
         in it. Then RE-TRY the point against the blocked test — a corner beside a jittered tower can
         be inside it even though the corner itself was not. */
      const chosen = pickWeighted(srng, 0, 0, -1) || places[0];
      for (let t = 0; t < 4; t++) {
        pointIn(srng, chosen, out);
        if (!P.blocked || !P.blocked(out.x, out.z)) return out;
      }
      out.x = chosen.x; out.z = chosen.z;             // the centre passed the blocked test at construction
      return out;
    },
    wander(srng, c, out) {
      /* STAY vs TRAVEL, with BOTH rolls taken on BOTH branches deliberately. To be precise about what
         that does and does not buy, because the tempting claim is wrong: determinism holds EITHER way
         — the branch is a function of sim state, which is itself deterministic — so a seed replays
         regardless. What the symmetry buys is that the stream position after a wander pick no longer
         depends on the branch, which is what makes an A/B of `stay` comparable roll-for-roll instead
         of diverging into a different crowd. Constant cost: 2 rolls + 2 per point try. */
      const u = srng();
      const walker = isWalker(c.id);
      const alt = pickNear(srng, c.x, c.z, walker);
      const home = walker ? null : nearest(c.x, c.z);   // a walker is never "at" anywhere; it is going
      const target = (home && u < P.stay) ? home : alt;
      for (let t = 0; t < 3; t++) {
        pointIn(srng, target, out);
        if (!P.blocked || !P.blocked(out.x, out.z)) return out;
      }
      out.x = target.x; out.z = target.z;
      return out;
    },
    /* THE LOITER. 1 outside every place, ramping to 1 + dwell at a place's centre. Linear in the
       radius rather than a step, so the edge of a group is a soft edge — a hard one puts a visible
       ring of bodies exactly on r. A WALKER never gets it: it pauses like anyone else (the sim's own
       idle roll) and then moves on, which is the whole difference between passing through and
       standing about. Takes the RECORD, not two coordinates, so the placer can see whose dwell it is. */
    dwellScale(c) {
      if (isWalker(c.id)) return 1;
      const p = nearest(c.x, c.z);
      if (!p) return 1;
      const d = Math.hypot(p.x - c.x, p.z - c.z) / p.r;
      return 1 + P.dwell * (1 - Math.min(1, d));
    },
    nearest,
  };
}
