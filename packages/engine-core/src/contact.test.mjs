/* ============================================================
   contact.test.mjs — the CONTACT ability's arithmetic, pinned without a skeleton. (ARC A-CONTACT)
   ------------------------------------------------------------
   These tests encode WHY the ability exists, not just what it computes (Rule 9): the arc's whole
   finding is that a limb solved onto a GUESSED plane can be 0.071 u out in open air while its own
   receipt reads 0.000. So the cases below are written as "a guess that is wrong by X is corrected to
   the real surface", with a synthetic world whose true surface position the test KNOWS — the one
   setup in which "did the correction actually happen" is decidable.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONTACT, surfaceAlong, planeContactTarget, groundContactTarget, heightFieldProbe } from './contact.js';

/* A synthetic world: one AABB, queried through the house `segmentHit` seam (t∈[0,1], 1 = clear).
   Slab method, un-inflated — the same arithmetic collide.js runs, small enough to read. */
function boxProbe(minX, minY, minZ, maxX, maxY, maxZ) {
  return (ox, oy, oz, ex, ey, ez) => {
    const dx = ex - ox, dy = ey - oy, dz = ez - oz;
    let tEnter = 0, tExit = 1;
    const slab = (o, d, lo, hi) => {
      if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
      if (t1 > tEnter) tEnter = t1;
      if (t2 < tExit) tExit = t2;
      return true;
    };
    if (!slab(ox, dx, minX, maxX)) return 1;
    if (!slab(oy, dy, minY, maxY)) return 1;
    if (!slab(oz, dz, minZ, maxZ)) return 1;
    if (tEnter > tExit || tExit < 0 || tEnter > 1) return 1;
    return tEnter > 0 ? tEnter : 0;
  };
}

test('surfaceAlong reports the true distance to the face, and -1 for open air', () => {
  // a wall filling z ≥ 1; probe from z = 0 travelling +z
  const p = boxProbe(-9, -9, 1, 9, 9, 9);
  assert.ok(Math.abs(surfaceAlong(p, 0, 0, 0, 0, 0, 1, 2) - 1) < 1e-6, 'face is exactly 1 away');
  assert.equal(surfaceAlong(p, 0, 0, 0, 0, 0, 1, 0.5), -1, 'too short to reach it → nothing there');
  assert.equal(surfaceAlong(p, 0, 0, 0, 0, 0, -1, 2), -1, 'pointing away → nothing there');
  assert.equal(surfaceAlong(null, 0, 0, 0, 0, 0, 1, 2), -1, 'no probe wired → nothing there (the A-CRAWL fallback)');
});

test('THE ARC IN ONE TEST: a guess 0.071 u outside the wall is pulled back onto it', () => {
  /* The measured defect, reproduced as arithmetic. The real facade is at z = 1. The controller's
     published plane — inflated by the cling ray's probe radius — sits at z = 0.929, i.e. 0.071 u out
     in the street. A-CRAWL solved the hand to that plane and reported "on plane, 0.000". */
  const L = 0.11;                      // arm chain length on the lab hero
  const inset = CONTACT.insetHand * L; // the palm's own depth: the JOINT stands off, the MESH touches
  const p = boxProbe(-9, -9, 1, 9, 9, 9);
  const out = { x: 0, y: 0, z: 0 };
  // the guess: on the WRONG plane (n = -z, i.e. the wall faces back toward the body at lower z)
  const moved = planeContactTarget(out, p, 0, 0, 0.929, 0, 0, -1, inset, L);
  // the corrected joint sits exactly one inset OUT from the true face at z = 1
  assert.ok(Math.abs(out.z - (1 - inset)) < 1e-6, `joint should sit inset off the true face, got ${out.z}`);
  /* `moved` must equal the distance the guess ACTUALLY travelled — not merely "> 0". An assertion that
     only checks a sign passes for any correction, including a wrong one, and `moved` is the receipt a
     caller uses to decide whether to trust the snap (maxSnap) — so it has to be the real number.
     guess z = 0.929, corrected z = 1 − inset, both on the same axis. */
  assert.ok(Math.abs(moved - Math.abs((1 - inset) - 0.929)) < 1e-6, `moved must BE the correction, got ${moved}`);
});

test('the inset is real, and it PINS the tuned depths — asserted against literals, not against itself', () => {
  /* THESE ASSERTIONS USED TO BE VACUOUS and a mutation matrix proved it: comparing the output to
     `CONTACT.insetHand * L` re-derives the expectation from the very constant under test, so
     insetHand 0.14 → 0.15, insetFoot 0.10 → 0.02 and maxSnap 0.75 → 7.5 all survived GREEN. A test that
     moves with the value it is guarding is a tautology wearing a receipt's clothes — the same class of
     error as this arc's own headline bug, one abstraction up.
     So the expected positions are LITERALS derived by hand from the tuned numbers:
       L = 0.13 → sole 0.10 × 0.13 = 0.0130 → foot joint at z = 1 − 0.0130 = 0.9870
                → palm 0.14 × 0.13 = 0.0182 → hand joint at z = 1 − 0.0182 = 0.9818
     Change a tuned inset and this test goes red, which is the entire point of pinning it. */
  const L = 0.13;
  const p = boxProbe(-9, -9, 1, 9, 9, 9);
  const foot = { x: 0, y: 0, z: 0 }, hand = { x: 0, y: 0, z: 0 };
  planeContactTarget(foot, p, 0, 0, 0.95, 0, 0, -1, CONTACT.insetFoot * L, L);
  planeContactTarget(hand, p, 0, 0, 0.95, 0, 0, -1, CONTACT.insetHand * L, L);
  assert.ok(Math.abs(foot.z - 0.9870) < 1e-6, `foot joint should sit at 0.9870 (a 0.0130 sole), got ${foot.z}`);
  assert.ok(Math.abs(hand.z - 0.9818) < 1e-6, `hand joint should sit at 0.9818 (a 0.0182 palm), got ${hand.z}`);
  assert.ok(hand.z < foot.z, 'a palm is deeper than a sole, so the hand joint sits FURTHER out');
});

test('NO PROBE keeps the guess (0) but AN EMPTY PROBE reports no-surface (-1) — the two "no"s differ', () => {
  /* This distinction is load-bearing, not pedantry. "I was never given a world" must keep A-CRAWL's
     behaviour exactly (so every un-wired consumer is byte-identical). "I looked and there is no wall
     there" must let the rig RELEASE the limb — otherwise a body that has mantled onto a roof goes on
     holding the facade underneath it, which measured 0.386 u of float on the roof. */
  const L = 0.11, inset = CONTACT.insetHand * L;
  const out = { x: 0, y: 0, z: 0 };
  // no probe at all — the pre-arc consumer
  assert.equal(planeContactTarget(out, null, 1, 2, 3, 0, 0, -1, inset, L), 0, 'un-wired → keep the guess');
  assert.deepEqual(out, { x: 1, y: 2, z: 3 }, 'the guess must survive untouched');
  // a probe, but empty space in front (reaching past the end of a wall / over a parapet)
  const empty = () => 1;
  assert.equal(planeContactTarget(out, empty, 1, 2, 3, 0, 0, -1, inset, L), -1, 'wired + empty → no surface');
  assert.deepEqual(out, { x: 1, y: 2, z: 3 }, 'and the out-param is still left alone');
});

test('maxSnap rejects a hit that is a DIFFERENT building, not this limb`s wall', () => {
  const L = 0.11, inset = CONTACT.insetHand * L;
  // the only solid is far beyond the plausible correction distance
  const p = boxProbe(-9, -9, 5, 9, 9, 9);
  const out = { x: 0, y: 0, z: 0 };
  // give the probe enough reach to actually SEE it (start 4.4 out, look 6.6 in → reaches z = 2.2 past
  // the box face), then confirm the guard still refuses to snap that far
  const far = { ...CONTACT, search: 40, reachIn: 100 };
  const moved = planeContactTarget(out, p, 0, 0, 0, 0, 0, -1, inset, L, far);
  assert.equal(moved, 0, 'a hit past maxSnap is not this limb’s surface');
  assert.deepEqual(out, { x: 0, y: 0, z: 0 }, 'so the guess is kept');
});

test('maxSnap is PINNED at 0.75 chain lengths — the threshold, not just the behaviour', () => {
  /* The test above proves a FAR hit is refused, and a mutation matrix showed that is not enough:
     maxSnap 0.75 → 7.5 survived it green, because a hit 45 chain-lengths away is refused either way.
     What matters is WHERE the line sits, so this brackets it — a correction just inside 0.75·L is
     taken, one just outside is refused. Move the constant and one of these two flips. */
  const L = 0.10, inset = 0;                       // inset 0 → the snap distance IS the wall distance
  const out = { x: 0, y: 0, z: 0 };
  const wide = { ...CONTACT, search: 20, reachIn: 20 };
  // guess at z = 0, wall face at z = d, normal -z → the target moves exactly d. maxSnap·L = 0.075.
  const snapAt = (d) => planeContactTarget(out, boxProbe(-9, -9, d, 9, 9, 9), 0, 0, 0, 0, 0, -1, inset, L, wide);
  const inside = snapAt(0.070);                    // 0.070 < 0.075 → accepted
  assert.ok(Math.abs(inside - 0.070) < 1e-6, `a 0.070 correction is inside maxSnap and must be taken, got ${inside}`);
  const outside = snapAt(0.080);                   // 0.080 > 0.075 → refused, guess kept
  assert.equal(outside, 0, 'a 0.080 correction is outside maxSnap (0.75 × 0.10) and must be refused');
});

test('GROUND is the same ability pointed down — and it can contradict a sunken stance', () => {
  /* The hoard shape, as arithmetic: the floor slab's TOP is at y = 0.34 but the character was placed
     at 0.30, so its feet are 0.04 u INSIDE the ground. The inferred leaky-min floor cannot notice
     (it only ever averages the feet it is given); a measured probe reads the slab top and lifts. */
  const L = 0.13, inset = CONTACT.insetFoot * L;
  const p = boxProbe(-9, -9, -9, 9, 0.34, 9);   // ground slab, top face at y = 0.34
  const out = { x: 0, y: 0, z: 0 };
  const moved = groundContactTarget(out, p, 0, 0.30, 0, inset, L);
  /* LITERALS again, for the reason the inset test above spells out: slab top 0.34 + a 0.10 × 0.13 =
     0.0130 sole → the foot lands at y = 0.3530, having travelled 0.3530 − 0.30 = 0.0530 to get out of
     the ground it was buried in. Both numbers are hand-derived, so a changed `insetFoot` turns this red
     instead of quietly following it. */
  assert.ok(Math.abs(out.y - 0.3530) < 1e-6, `foot should land at 0.3530 (slab top + a 0.0130 sole), got ${out.y}`);
  assert.ok(Math.abs(moved - 0.0530) < 1e-6, `moved must BE the 0.0530 lift out of the slab, got ${moved}`);
  /* X and Z must NOT drift: a ground probe answers "how high", never "where". A solver that also slid
     the foot sideways would skate the plant, which is the bug foot-lock exists to prevent. */
  assert.equal(out.x, 0, 'ground contact must not move the foot in X');
  assert.equal(out.z, 0, 'ground contact must not move the foot in Z');
});

/* ── ARC A-GROUND (2026-08-20): heightFieldProbe — the adapter that made the ground half REACHABLE ──
   WHY THESE TESTS EXIST (Rule 9 — intent, not behaviour): A-CONTACT shipped the ground ability
   "proven but unreachable", and the reason was a DIALECT MISMATCH, not bad arithmetic. The ability
   speaks `segmentHit`; the projects that need a floor publish `groundAt(x,z)`. So what must be pinned
   here is not "the division is right" but the three contract properties a caller depends on:
     1 · a downward cast through the floor reports the floor, in the segment's own t units;
     2 · the adapter DECLINES questions a height field genuinely cannot answer (anything not downward),
         because inventing a wall would be worse than saying "clear" — this is the property that makes
         it safe to hand to a rig whose wall path might also read the probe;
     3 · it composes with groundContactTarget to LIFT A SUNK FOOT — the whole point of the arc. */

test('A-GROUND heightFieldProbe — a downward cast reports the floor at the right t', () => {
  const probe = heightFieldProbe(() => 0.30);
  // cast from y=0.50 down to y=0.10 (span 0.40); floor at 0.30 is 0.20 along → t = 0.5
  assert.ok(Math.abs(probe(0, 0.50, 0, 0, 0.10, 0) - 0.5) < 1e-9, 'floor 0.20 into a 0.40 segment must read t = 0.5');
  assert.equal(probe(0, 0.50, 0, 0, 0.35, 0), 1, 'a segment that stops above the floor must report clear (1)');
  assert.equal(probe(0, 0.20, 0, 0, 0.00, 0), 0, 'a cast starting below the floor must report t = 0, not clear');
});

test('A-GROUND heightFieldProbe — it DECLINES the questions a height field cannot answer', () => {
  const probe = heightFieldProbe(() => 0.30);
  /* THE HONEST-NARROWNESS PROPERTY. A height field knows how high the floor is; it does not know
     whether a wall is in front of you. Answering a horizontal or upward cast with anything but
     "clear" would fabricate geometry — and the rig's WALL path reads the same probe object, so a
     fabricated answer would silently move a hand. Upward/horizontal must be 1. */
  assert.equal(probe(0, 0.50, 0, 1, 0.50, 0), 1, 'a HORIZONTAL cast has no answer in a height field → clear');
  assert.equal(probe(0, 0.10, 0, 0, 0.90, 0), 1, 'an UPWARD cast has no answer in a height field → clear');
  assert.equal(heightFieldProbe(null), null, 'given no function there is nothing to adapt → null, not a broken closure');
  const nan = heightFieldProbe(() => NaN);
  assert.equal(nan(0, 0.50, 0, 0, 0.10, 0), 1, 'a field that declines to answer (non-finite) must read clear, never NaN-propagate');
});

test('A-GROUND heightFieldProbe + groundContactTarget — the sunk foot is actually lifted out', () => {
  /* THE ARC'S OWN SENTENCE, end to end and through the real adapter rather than a hand-built probe:
     hoard2's ground authority is `groundAt: () => GROUND_Y` with GROUND_Y = 0.30, and a foot placed
     0.04 u under it must come out. The literals are hand-derived so a changed insetFoot turns this
     red instead of quietly following it (the tautology trap the A-CONTACT mutation matrix names). */
  const L = 0.13, inset = CONTACT.insetFoot * L;          // 0.10 × 0.13 = 0.0130 of sole
  const out = { x: 0, y: 0, z: 0 };
  const moved = groundContactTarget(out, heightFieldProbe(() => 0.30), 0, 0.26, 0, inset, L);
  assert.ok(Math.abs(out.y - 0.3130) < 1e-9, `foot must land at 0.3130 (floor 0.30 + a 0.0130 sole), got ${out.y}`);
  assert.ok(Math.abs(moved - 0.0530) < 1e-9, `moved must BE the 0.0530 climb out of the floor, got ${moved}`);
  assert.equal(out.x, 0, 'a ground probe answers "how high", never "where" — X must not drift');
  assert.equal(out.z, 0, 'a ground probe answers "how high", never "where" — Z must not drift');
});
