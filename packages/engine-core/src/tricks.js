/* ============================================================
   tricks.js — TRICK DETECTION + SCORING, as a pure consumer of a body's state.  (ARC A-TRICKS, 2026-08-19 · whips A-WHIP, 2026-08-19)
   ------------------------------------------------------------
   The scoring half of the moto brief ("flips earn points, clean landings bank them, botches scrub
   them"), built ENGINE-FIRST and sport-agnostic: `createTrickScorer` consumes any body that speaks
   the bike's air contract — { airborne, pitch, landing:{ kept, clean, count }, lastAir }, plus the
   OPTIONAL whip vocabulary { yaw, headYaw } (A-WHIP: present → yaw spins score too; absent → the
   scorer behaves byte-identically to its pitch-only self) — and a future skate/snowboard body
   reuses it unchanged. moto-lab only WIRES it (one update call per frame after model.step) and
   STYLES it (the popup + readout rows are project DOM).

   THE ONE RULE THAT MAKES THE SCORE HONEST: the scorer never computes a physics number. The landing
   multiplier IS `state.landing.kept` — the same float createBikeModel wrote when the wheels hit —
   assigned, not recomputed, so the physics and the score cannot disagree BY CONSTRUCTION (clean
   banks ×1.00; the ledger's over-held receipts bank ×0.64–0.71; the worst landing banks ×keepMin).
   Likewise the airtime factor reads `state.lastAir`, the model's own flight clock. One fact, one
   owner (the model); the scorer is arithmetic on top.

   WHAT A TRICK IS (every choice stated, every one pinned in tricks.test.mjs):
   · A trick exists ONLY in the air. While grounded the scorer does not read pitch AT ALL, so the
     grounded anti-exploit ("pitch wiggle on the ground scores zero") is structural, not a guard —
     there is no code path from grounded pitch to points. (Grounded pitch is slope-following anyway;
     the model never reads the lean axis on the ground — two independent walls.)
   · Rotation is read off the ACCUMULATED AIR PITCH the model already integrates (state.pitch runs
     past 2π mid-flip and only wraps at touchdown — the wrap happens on a frame this scorer never
     reads, because it stops at the last airborne frame). The FIRST segment of a flight references
     WORLD LEVEL (0), not the launch pitch: a backflip is "did you come round to level", which is
     how riders count it and exactly how the ledger's ground-truth receipts read ("timed release =
     2.00π, lands CLEAN" — 2.00π of accumulated pitch IS the backflip; the kicker's 30° is credited).
     Direction REVERSALS close the segment at its extreme and open a new one referenced there — so
     back-then-front in one air is two tricks, not a net zero.
   · revs = floor(extreme/2π + revSlack). The slack (0.08 rev ≈ 29°) forgives the release timing a
     human can actually hit plus the one partial frame of rotation the touchdown step integrates
     before the verdict (≤ airPitchRate·dt, invisible to a consumer that reads state after step).
     PARTIALS SCORE NOTHING — a stated call, not an accident: sub-full pitch in the air is landing-
     matching (nosing to the slope), i.e. RIDING, and paying it would trickle points through the
     keepMin floor on every botched half-flip.
   · The announce threshold and the bank threshold are THE SAME LINE ((n − revSlack)·2π), so a trick
     the popup announced mid-air is always the trick the landing banks — consistency by
     construction, not by hoping the HUD and the ledger agree.
   · One flight = one chain; the chain banks EXACTLY ONCE, keyed to the landing verdict's own
     count increment. An airborne→grounded edge WITHOUT a verdict (a respawn) discards the chain —
     no verdict, no bank. Double-banking is structurally impossible: the chain object is consumed
     by the bank and a new one only opens on the next launch edge.
   · WHIPS ARE IN (A-WHIP, 2026-08-19 — the seam this file named, now filled): the day came, and
     all three named pieces landed exactly where the note said they would — (1) air-yaw authority
     in createBikeModel (`airYawRate`; the body spins, the momentum doesn't), (2) the landing
     verdict's yaw term (pitch-only retired; land square = clean, wrapped exactly like the flip),
     (3) THIS scorer running a SECOND angle stream through the SAME segmenter. The yaw stream is
     OPT-IN by state shape: it flows only when the body publishes `yaw` AND `headYaw` (the travel
     heading the physics froze at the lip) — a body without the whip vocabulary scores exactly as
     before, byte for byte. The stream's angle is the RELATIVE spin (yaw − headYaw): zero at
     launch by the model's own contract, so the reference is the launch line — a 360 is "did you
     come back round SQUARE", the mirror of the flip's "did you come round to level".
   · The yaw trick is the '360', at ONE name for BOTH directions — yaw has no gravity asymmetry,
     so left-spin and right-spin are the same difficulty (unlike back/front flips, where rotating
     against the kicker's own pitch costs more). PARTIAL WHIPS SCORE NOTHING, the partials rule
     verbatim: sub-full yaw in the air is landing-SQUARING (bringing the wheels back to the line),
     i.e. riding; the styled kick-out-and-back whip is presentation vocabulary, not points.
   · Because pitch and yaw are SEPARATE HANDS (arrows vs A/D), a flip and a 360 can be held
     TOGETHER — two segments in one air, the combo multiplier's first DRIVABLE case (A-TRICKS
     honest gap #3, closed by construction rather than by a longer ramp).
   · GROUNDED STEER STAYS SILENT structurally, the same two-wall argument as grounded pitch: the
     model keeps yaw ≡ headYaw on the dirt (the relative angle cannot leave 0), AND this scorer
     only reads the stream while a chain is open, which only happens airborne.

   SCORE = (Σ per-segment base×revs) × (1 + airFactorPerSec·lastAir) × (1 + comboStep·(k−1)) × kept,
   rounded to an integer at the bank. The airtime factor is the MM2 read ("stunts gate on HEIGHT
   first") through this world's own ballistics: airtime is the height proxy (T = 2·vy/g, apex =
   vy²/2g — monotone in each other), so the same flip in ramp air (~2 s → ×1.5) outscores the same
   flip squeezed into a dune hop (~0.5 s → ×1.125). A full flip structurally NEEDS real air anyway —
   2π at airPitchRate 3.6 rad/s takes 1.75 s — so there is no minimum-air gate to tune: the physics
   is the gate.

   DETERMINISM: no rng, no clocks — the scorer is a pure function of the state stream (the
   `rng.fork` discipline is moot here and that is stated, not skipped). Every bank folds into a
   running FNV-1a hash (`read().hash`) — the outbreak's event-hash pattern — so two fixed-dt boots
   of one scripted run must print the SAME hash (tools/moto-score-replay.mjs is that receipt, run
   twice in separate node processes by the test). On the live page the hash is still a receipt of
   what banked, but wall-clock dt jitters airtime between boots, so cross-boot identity is only
   asserted where dt is fixed.

   C++ anchor: a small finite-state machine (GROUND ⇄ AIR) plus a zigzag segmenter over one float —
   a `switch` on an enum and a running extreme, not an event system. The "events" the update returns
   are a return value the caller may ignore, not a callback registry.
   ============================================================ */

export const TRICK_PROFILE = {
  /* base points per trick name. Frontflip > backflip is the genre's own hardness order (rotating
     against your launch attitude off an up-kicker needs MORE rotation under the world-level rule
     above — the arithmetic agrees with the folklore, which is why the gap is small, not 2×).
     '360' (A-WHIP) sits UNDER the backflip — the flat spin is the genre's easier full rotation
     (no gravity fights it; airYawRate 3.3 < airPitchRate 3.6 says the same thing in rad/s) —
     and one name serves both spin directions (yaw has no front/back asymmetry to price). */
  bases: { backflip: 100, frontflip: 120, '360': 90 },
  revSlack: 0.08,          // rev — the release-timing + last-frame forgiveness (≈29°)
  reverseEps: 0.05,        // rad of genuine counter-rotation that closes a segment (air pitch is an
                           // exact integral — zero input holds EXACTLY — so this only fires on a
                           // real opposite hold, never on jitter; it is a latch, not a filter)
  airFactorPerSec: 0.25,   // ×(1 + t/4): ~2 s of ramp air multiplies 1.5; a 0.5 s hop 1.125
  comboStep: 0.5,          // k segments in one air: ×(1 + 0.5·(k−1)) — 2 tricks ×1.5, 3 ×2.0
};

const TAU = Math.PI * 2;

/* FNV-1a over a string — the house checksum idiom (moto-lab's __terrainChecksum, byte for byte). */
const fnv1a = (str, h = 0x811c9dc5) => {
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
};

export function createTrickScorer(profile = TRICK_PROFILE) {
  const P = (k) => (profile[k] !== undefined ? profile[k] : TRICK_PROFILE[k]);

  /* run totals (the receipts) */
  let total = 0, best = 0, banks = 0, hash = 0x811c9dc5, last = null;
  /* the open chain (null while grounded) */
  let chain = null;
  let lastLandCount = null;   // seeded from the first state seen, so a pre-scored world is not re-banked

  const newSegment = (ref) => ({ ref, dir: 0, extreme: 0, announced: 0 });
  /* the per-frame event list is a REUSED scratch (the no-hot-alloc invariant — most frames it is
     empty, and allocating an empty array 120×/s is the exact class the engine bans). Contract:
     the returned array is valid until the NEXT update() call; consume it, do not retain it. */
  const EVENTS = [];

  /* the two axes' NAMERS — the only thing that differs between the streams. Pitch names by sign
     (gravity makes back ≠ front); yaw names one trick both ways (nothing to break the symmetry). */
  const nameOfPitch = (dir) => (dir > 0 ? 'backflip' : 'frontflip');
  const nameOfYaw = () => '360';

  /* close a segment; if it rotated at least one full rev it becomes a trick on the SHARED list
     (one list is what makes flip+whip a combo — the multiplier counts segments, not axes). */
  function closeSegment(ch, seg, nameOf) {
    if (!seg) return;
    const revs = Math.floor(seg.extreme / TAU + P('revSlack'));
    if (seg.dir !== 0 && revs >= 1) {
      const name = nameOf(seg.dir);
      const base = P('bases')[name] || 0;
      ch.tricks.push({ name, revs, points: base * revs });
    }
  }

  /* ONE segmenter, stepped per axis per frame (the A-TRICKS seam's third item: "instantiate it
     per axis when the day comes" — the day came). `angle` is the stream's accumulated signed
     rotation; returns the possibly-replaced segment (a reversal closes + reopens in place). */
  function stepStream(ch, seg, angle, nameOf, events) {
    const p = angle - seg.ref;                     // progress relative to the segment's reference
    if (seg.dir === 0 && Math.abs(p) > P('reverseEps')) seg.dir = Math.sign(p);
    if (seg.dir !== 0) {
      const prog = seg.dir * p;                    // progress IN the segment's direction (rad, ≥ 0 at the extreme)
      if (prog > seg.extreme) seg.extreme = prog;
      /* ANNOUNCE — same line the bank uses ((n − slack)·2π), so mid-air popups and banked tricks
         cannot disagree. Multi-rev announces again at each rev ("BACKFLIP ×2" as you keep going). */
      while (seg.extreme >= (seg.announced + 1 - P('revSlack')) * TAU) {
        seg.announced++;
        const name = nameOf(seg.dir);
        events.push({ type: 'trick', name, revs: seg.announced, points: (P('bases')[name] || 0) * seg.announced });
      }
      /* REVERSAL — a genuine counter-rotation past the extreme closes the segment there and
         opens the next one referenced AT that extreme (so its rotation is measured from where
         the last trick actually ended, not from world level). */
      if (seg.extreme - prog > P('reverseEps')) {
        closeSegment(ch, seg, nameOf);
        return newSegment(seg.ref + seg.dir * seg.extreme);
      }
    }
    return seg;
  }

  function update(state) {
    const events = EVENTS; events.length = 0;
    const landing = state.landing;
    if (lastLandCount === null) lastLandCount = landing ? landing.count : 0;

    if (state.airborne) {
      if (!chain) {
        /* LAUNCH EDGE — open the chain. The pitch segment's reference is WORLD LEVEL (0), not the
           launch pitch: the lip's angle is credited, per the header's "come round to level" rule.
           The YAW stream (A-WHIP) opens only for a body that publishes the whip vocabulary
           (yaw + headYaw); its reference is 0 in RELATIVE angle — the launch line itself. */
        const hasYaw = typeof state.yaw === 'number' && typeof state.headYaw === 'number';
        chain = { tricks: [], seg: newSegment(0), yawSeg: hasYaw ? newSegment(0) : null };
      }
      chain.seg = stepStream(chain, chain.seg, state.pitch, nameOfPitch, events);
      if (chain.yawSeg) chain.yawSeg = stepStream(chain, chain.yawSeg, state.yaw - state.headYaw, nameOfYaw, events);
    } else if (chain) {
      /* AIRBORNE → GROUNDED edge. Bank ONLY on the landing verdict's own count increment — an
         edge without a verdict is a respawn, and a chain with no verdict banks nothing. */
      const verdict = landing && landing.count > lastLandCount;
      if (verdict) {
        closeSegment(chain, chain.seg, nameOfPitch);
        closeSegment(chain, chain.yawSeg, nameOfYaw);
        const tricks = chain.tricks;
        if (tricks.length > 0) {
          const sum = tricks.reduce((a, t) => a + t.points, 0);
          const airtime = state.lastAir || 0;                      // the model's own flight clock
          const airFactor = 1 + P('airFactorPerSec') * airtime;
          const combo = 1 + P('comboStep') * (tricks.length - 1);
          const kept = landing.kept;                               // THE physics' number, assigned not recomputed
          const points = Math.round(sum * airFactor * combo * kept);
          total += points;
          if (points > best) best = points;
          banks++;
          last = { points, kept, clean: landing.clean, airtime, combo, tricks };
          hash = fnv1a(`B|${points}|${kept.toFixed(6)}|${landing.clean ? 1 : 0}|${airtime.toFixed(3)}|${tricks.map((t) => t.name + 'x' + t.revs).join(',')}`, hash);
          events.push({ type: 'bank', ...last });
        }
      }
      chain = null;                                // consumed (or discarded) — double-banking has no path
    }
    if (landing) lastLandCount = landing.count;    // tracked every frame so a verdict is only ever counted once
    return events;
  }

  function reset() { total = 0; best = 0; banks = 0; hash = 0x811c9dc5; last = null; chain = null; lastLandCount = null; }

  /* the receipts — probe- and HUD-readable, one implementation (aim.js's "one in-range" rule). */
  function read() {
    let pending = null;
    if (chain) {
      const seg = chain.seg, ys = chain.yawSeg;
      pending = {
        tricks: chain.tricks.length,
        name: seg.dir === 0 ? null : nameOfPitch(seg.dir),
        revs: seg.announced,
        progress: seg.extreme / TAU,               // rev — the HUD's live "0.99 rev" readout
        /* A-WHIP: the yaw stream's own live readout, beside the pitch one (null-shaped when the
           body has no whip vocabulary, so pre-whip HUD code reads exactly what it always did). */
        yawName: ys && ys.dir !== 0 ? nameOfYaw(ys.dir) : null,
        yawRevs: ys ? ys.announced : 0,
        yawProgress: ys ? ys.extreme / TAU : 0,
      };
    }
    return { total, best, banks, hash: hash.toString(16), last, pending };
  }

  return { update, reset, read };
}
