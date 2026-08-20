/* ============================================================
   contact.js — THE CONTACT ABILITY: put a limb on the surface that is REALLY there. (ARC A-CONTACT, 2026-08-20)
   ------------------------------------------------------------
   WHY THIS MODULE EXISTS — the bug it was written to end, measured before a line was changed:

   A-CRAWL pinned the climbing hands and feet to a PLANE the controller published (`state.clingNx/Nz`
   + `clingDist`), and its receipt — the end joint's distance off THAT plane — read ±0.035 u and was
   believed. A-CONTACT measured the same limbs against the ACTUAL geometry (`__arena.solids`) and found
   them **0.062–0.095 u out in open air**: the published plane sits **0.0710 u OUTSIDE the facade**
   (measured two independent ways, swing-lab, 2026-08-20). Both numbers were honest; they answered
   different questions. A receipt that measures against a model can only ever prove the model was
   obeyed — it cannot notice the model is in the wrong place.

   WHERE THE 0.071 COMES FROM, since a fix that does not name its cause is a curve fit: the cling ray is
   `world.segmentHit(..., cling.probeR)`, and `segmentHit` INFLATES every AABB by that radius on all
   three axes (collide.js — the Minkowski cheat that makes a swept sphere a ray-vs-fat-box). So the ray
   stops short of the true face by at least `probeR`, and near ground clutter it can stop on the
   INFLATED top of a low kerb entirely — the ray is cast at `probeY` = 0.02 u above the FEET, while the
   hands reach a facade half a body higher. One plane, derived at ankle height from a fattened box, was
   being asked to hold four limbs spread over a body-height of wall.

   THE ABILITY, therefore, and it is deliberately not "add probeR back": DO NOT TRUST A PLANE — ASK THE
   WORLD, PER LIMB. Each limb casts its own short probe at its own reach height and lands on whatever
   solid is actually in front of it. That one change fixes three things at once and is why this is a
   module rather than a constant:
     · the FLOAT — the surface is found where it is, not where a fattened ankle-height ray guessed;
     · CORNERS and CLUTTER — four limbs on four different bits of geometry is the normal case at an
       edge, and a shared plane cannot express it (the limb round the corner is the one that clips);
     · GROUND — "find the surface along a direction and stand off it by the limb's own depth" is the
       SAME sentence with the direction pointing down, so feet on a floor and hands on a wall are one
       ability with one set of receipts, not two implementations that drift apart.

   THE INSET, kept from A-CRAWL because it was right: the target is the surface point pushed back OUT
   along the surface normal by the limb's own flesh depth (`insetHand` a palm, `insetFoot` a sole),
   expressed in LIMB-CHAIN LENGTHS so one number fits any rig at any scale. The JOINT stands off; the
   MESH touches. A joint solved exactly onto the surface would bury the whole hand in the wall.

   C++ anchor: this is a query interface (`probe`) injected into a solver, not a class hierarchy — the
   caller owns the world, this module owns the arithmetic, and nothing here allocates or keeps state.
   Every function writes into a caller-owned struct, exactly like hero-air.js's gait.
   ============================================================ */

/* The contact ability's tuned shape. Insets are in LIMB-CHAIN lengths (shoulder→wrist / hip→ankle,
   measured live by the rig), inherited verbatim from A-CRAWL's `CRAWL.insetHand/insetFoot` so the
   crawl's measured tuning is not silently re-litigated by the lift. `search` and `maxDrop` are in
   chain lengths too — how far the per-limb probe looks before it gives up and keeps the plane. */
export const CONTACT = {
  insetHand: 0.14,   // planted WRIST stands this far off the surface — the palm's own depth (A-CRAWL,
                     // measured up from 0.10: at 0.10 the planted readings straddled ZERO, i.e. fingers
                     // through the facade half the time).
  insetFoot: 0.10,   // planted ANKLE ditto — the sole's depth.
  search: 0.9,       // how far OUT along the normal a limb's probe starts, in chain lengths. Must clear
                     // the largest gap between the guessed plane and the real surface (measured 0.071 u
                     // ≈ 0.6 chain lengths on the lab hero) with margin, and stay short enough that the
                     // probe cannot start inside the NEXT solid across a narrow gap.
  reachIn: 1.6,      // how far IN past the start point the probe looks, in chain lengths. MEASURED up
                     // from 1.1: at 1.1 (0.121 u on the lab's 0.11 u arm) the probe reach landed exactly
                     // ON the residual distance to the facade and the hit FLICKERED between found and
                     // not-found frame to frame — a boundary, not a margin. `maxSnap` below is the real
                     // safety, so this only has to be generous enough to see the surface.
  maxSnap: 0.75,     // the furthest a probe hit may MOVE a target from its guessed position, in chain
                     // lengths. A hit further than this is a different piece of geometry (the building
                     // across the street through a window gap), not this limb's wall — keep the guess.
};

/* Resolve a surface along a ray, through the house world-bag seam.
     probe  — `segmentHit(ox,oy,oz, ex,ey,ez, r) -> t∈[0,1]`, 1 = clear. THE SAME function the camera
              spring-arm and the cling ray already use, called with r = 0 so it reports the TRUE face
              rather than the inflated one (that inflation is this arc's whole bug).
     returns the distance along (dx,dy,dz) to the first solid within `maxDist`, or -1 for "nothing there".
   Pure apart from the injected query; allocates nothing. */
export function surfaceAlong(probe, ox, oy, oz, dx, dy, dz, maxDist) {
  if (!probe || !(maxDist > 0)) return -1;
  const t = probe(ox, oy, oz, ox + dx * maxDist, oy + dy * maxDist, oz + dz * maxDist, 0);
  return t < 1 ? t * maxDist : -1;
}

/* THE ABILITY'S ONE SENTENCE: given a GUESSED target and the direction the surface faces, find the real
   surface and put the target an inset off it.
     out            — caller-owned {x,y,z}, overwritten.
     gx,gy,gz       — the guessed target (the gait's wall point, or the foot's current spot over ground).
     nx,ny,nz       — the surface's outward unit normal (away from the solid): (n,0) for a wall, (0,1,0)
                      for a floor. The probe is cast ALONG -n, from `search` out along +n.
     inset          — how far off the found surface the JOINT sits (world units — the caller multiplies
                      the chain length in).
     L              — the limb chain length, the unit `search`/`reachIn`/`maxSnap` are expressed in.
   RETURN VALUE, three-way, because the caller needs to tell two different "no" answers apart:
     > 0  the target was corrected onto a real surface; the number is how wrong the guess was (the
          receipt that would have caught A-CRAWL).
       0  the guess was KEPT — either no probe is wired (the pre-arc consumer) or a surface was found
          but implausibly far (`maxSnap`), which means it is a different building, not this limb's wall.
      -1  a probe IS wired and there is NO SURFACE IN FRONT OF THIS LIMB AT ALL. This is not a failure,
          it is information: the limb is reaching past the end of the wall, or the body has mantled over
          the parapet and the facade is now below it. A caller that pins to the stale plane anyway is
          holding onto a wall that is not there — measured on the roof after a top-out at 0.386 u of
          float — so the rig uses this to RELEASE that limb instead. */
export function planeContactTarget(out, probe, gx, gy, gz, nx, ny, nz, inset, L, cfg = CONTACT) {
  out.x = gx; out.y = gy; out.z = gz;
  if (!(L > 0)) return 0;
  if (!probe) return 0;                      // no world wired → trust the caller's plane (A-CRAWL)
  const start = cfg.search * L;
  const ox = gx + nx * start, oy = gy + ny * start, oz = gz + nz * start;
  const d = surfaceAlong(probe, ox, oy, oz, -nx, -ny, -nz, start + cfg.reachIn * L);
  if (d < 0) return -1;                      // nothing in front of this limb — there is no wall here
  // the surface point, then back OUT along the normal by the limb's own depth
  const sx = ox - nx * d, sy = oy - ny * d, sz = oz - nz * d;
  const tx = sx + nx * inset, ty = sy + ny * inset, tz = sz + nz * inset;
  const moved = Math.sqrt((tx - gx) * (tx - gx) + (ty - gy) * (ty - gy) + (tz - gz) * (tz - gz));
  if (moved > cfg.maxSnap * L) return 0;     // that is a different building, not this limb's wall
  out.x = tx; out.y = ty; out.z = tz;
  return moved;
}

/* GROUND IS THE SAME SENTENCE POINTED DOWN, and it exists here so that claim is code rather than a
   promise: the normal is (0,1,0), the guess is the limb where it already is, and the probe falls from
   `search` above it. Written for the biped-on-a-floor case every project has and hoard needs — a foot
   that ends `inset` above the real floor is a foot ON it (the sole has depth), and a foot solved to a
   FLAT CONSTANT while the floor is a slab 0.04 u higher is the "standing in the ground" bug. */
export function groundContactTarget(out, probe, gx, gy, gz, inset, L, cfg = CONTACT) {
  return planeContactTarget(out, probe, gx, gy, gz, 0, 1, 0, inset, L, cfg);
}
