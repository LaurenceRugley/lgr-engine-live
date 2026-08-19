/* ============================================================
   @lgr/engine-core — hero-air (ARC A-AIR, 2026-08-15): the PURE math that makes an airborne body BREATHE.
   ------------------------------------------------------------
   THE GAP THIS CLOSES, in the previous arc's own words (docs/design/swing-ledger.md, A-BODY "honest
   gaps" #1 and #2): "jump/fall/swing/cling are HELD FRAMES. A held frame does not breathe." and "Cling
   is the weakest pose … a cling reads as 'reaching at the wall', not 'spread-eagled on it'."
   `survivor.glb` ships Idle · Walk · Run · Jump · Punch · Death · Working and NOTHING for falling,
   swinging or clinging, so A-BODY froze one frame of the Jump clip for each of those four modes. That
   was the right call for a body that must be recognisably airborne; it is a STILL, and it reads as one.

   ── WHY PROCEDURAL AND NOT AN AUTHORED CLIP, and this is a MEASUREMENT, not a preference ────────────
   The obvious cure — author the missing clips in Blender through the `extraClips` seam that already
   exists for exactly this (`tools/blender/build_reach.py`, `docs/asset-pipeline.md`) — was tried first
   and hit a real wall on THIS rig. `tools/blender/probe_rig_axes.py` (new, kept as the receipt) rotates
   each bone ±0.35 rad about its local X/Y/Z and prints the world displacement of its tail:
     · `import_rig(survivor, guess_original_bind_pose=True)`  → beautifully clean axes (arm +X lowers the
       arm, arm +Z swings it fore/aft, spine +X leans forward) — but that rest pose is a RECONSTRUCTED
       T-pose, and `pipeline_lib.import_rig`'s own docstring records the consequence measured on this
       exact model: "the Hips root bone exported ~133° off rest with the default". A clip authored
       against a rest the runtime does not share plays wrong.
     · `guess_original_bind_pose=False`  → the rig's REAL bind pose, which is what the runtime uses —
       and every bone's local axes come out oblique. Measured: `LeftUpLeg +X → (-0.003, +0.004, +0.004)`,
       `RightArm +Z → (+0.003, +0.003, -0.002)`. Nothing there is a readable "pitch" or "yaw", so a
       hand-authored `fn(u) -> (rx, ry, rz)` track is guesswork on every joint.
   The procedural route does not have that problem at all, because `_applyLayers` multiplies its offsets
   onto bones AFTER the mixer has posed them — in the RUNTIME local frame, whose conventions are already
   proven by shipped, captured layers on these same bones (idle-relax lowers an arm with +X; the zombie
   lunge pitches the spine forward with +X; hit-react splays the arms with mirrored ±Z). We are extending
   a working system rather than betting on an untested export. The leg axes, which NO shipped layer had
   ever driven, were measured on the real page instead — `tools/hero-air-axes.mjs`.
   The second, larger reason: a baked clip cannot KNOW anything. These angles are functions of `vy` and
   of the climb rate, so the body tucks on the way up and extends on the way down — a swinger's legs pump
   with the pendulum, and a faster fall spreads wider. A clip plays the same whatever the physics does.

   ── ZERO ALLOCATION ────────────────────────────────────────────────────────────────────────────────
   `airPose` writes into a caller-owned struct (`makeAirPose()` once, at spawn) and returns nothing. Same
   discipline as character-layers.js: pure functions over floats, node-testable without a GPU or a GLB.

   C++ anchor: `void air_pose(AirPose& out, Mode m, float k, float t, float clock)` — an out-parameter
   fill, no heap, no state. The caller owns the buffer; this owns only the curve.
   ============================================================ */

// The modes this layer knows. They are `hero-body-pose.js`'s HERO_POSES minus 'ground' — on the ground
// the locomotion blend is a real three-clip animation and needs no help.
export const AIR_MODES = ['jump', 'fall', 'swing', 'cling'];

/* The JOINT SET. Every field is a LOCAL-frame rotation in radians, applied additively on top of whatever
   the clip posed. Split X/Z per limb because those are the two axes the runtime rig actually reads
   legibly (see the header): X is the fore/aft-or-up/down swing, Z the outward splay, mirrored L/R.
   AIR_POSE_KEYS exists so the per-frame ease can walk the struct with an indexed `for` instead of
   `for…in`, which materialises a key array — the engine's no-hot-alloc invariant, on a loop that runs
   for every airborne frame forever. Kept beside makeAirPose so the two can never drift apart (the node
   test asserts they hold the same set). */
export const AIR_POSE_KEYS = [
  'spineX', 'spineZ', 'headX',
  'armLX', 'armRX', 'armLZ', 'armRZ', 'foreRX', 'foreLX',
  'upLegLX', 'upLegRX', 'upLegLZ', 'upLegRZ', 'kneeLX', 'kneeRX',
];

export function makeAirPose() {
  return {
    spineX: 0, spineZ: 0, headX: 0,
    armLX: 0, armRX: 0, armLZ: 0, armRZ: 0, foreRX: 0, foreLX: 0,
    upLegLX: 0, upLegRX: 0, upLegLZ: 0, upLegRZ: 0, kneeLX: 0, kneeRX: 0,
  };
}

/* RISE/FALL as ONE signed signal, -1 (falling at or past `vRef`) … +1 (rising at or past `vRef`).
   Smoothed with a smoothstep rather than a raw clamp so the apex — where vy crosses zero — is a gentle
   turn rather than a corner: the body does not snap from tucked to spread in the one frame vy flips
   sign. `vRef` is the caller's own "this is a fast vertical" speed, in world units/second. */
export function riseFall(vy, vRef) {
  if (!(vRef > 1e-6)) return 0;
  let u = vy / vRef;
  if (u > 1) u = 1; else if (u < -1) u = -1;
  const a = Math.abs(u);
  const s = a * a * (3 - 2 * a);            // smoothstep the MAGNITUDE, keep the sign
  return u < 0 ? -s : s;
}

/* A slow oscillation for the parts of a pose that must never be dead still. This IS the "breathe" the
   ledger says a held frame lacks: amplitude is tiny, but a limb that moves 3° over a second is the
   difference between a photograph and a person. Returns -1..1. */
export function breathe(clock, rate) { return Math.sin(clock * rate); }

/* THE CLIMB CYCLE — a -1..1 alternation driving opposite limbs, so a body on a wall reaches with one arm
   while the other holds and the opposite knee drives. `speed01` is how hard the player is actually
   climbing (0 = hanging still). The cycle's PHASE keeps advancing at a floor rate even at speed01 = 0 so
   a hanging body still shifts its weight; its AMPLITUDE is what speed01 scales, in the rig.
   (A-CRAWL 2026-08-19: the CLING no longer uses this — its alternation runs on the DISTANCE-LOCKED
   `phase` argument below, so the cycle is a function of ground covered, not of wall-clock time, and S
   runs it backwards. Kept for the breathe/oscillator family and its tests.) */
export function climbCycle(clock, rate) { return Math.sin(clock * rate); }

/* ── A-CRAWL (2026-08-19): THE WALL-CONTACT GAIT — the pure half of "the cling reads as a crawl". ────
   A-AIR gave the cling a live spread-eagle; the owner's ask is the next thing the eye wants: "hands
   grab onto the wall, and the legs as well, and you kinda crawl up the wall". Two pieces make that
   read, and BOTH are pure math over the same signed phase:
     1 · a DIAGONAL gait — opposite hand/foot pairs move together (LH+RF, then RH+LF), which is the
         trot every climbing quadruped uses because it keeps two contacts under the body at all times;
     2 · CONTACT — the moving pair lifts OFF the wall plane while it reaches and re-plants ON it, and
         the holding pair stays pressed to the plane while the body climbs past it.
   The rig turns these offsets into world-space targets on the cling ray's own wall plane and runs the
   same two-bone solver the foot-lock uses (createCharacterRig `_solveTwoBone`); this module owns only
   the WHY-shaped numbers, so the gait is node-testable without a skeleton.

   THE PHASE IS DISTANCE-LOCKED, NOT CLOCK-LOCKED, and that one choice buys three behaviours for free:
     · climbing UP   (vy > 0) — the phase advances, limbs plant high and slide low in body space,
       i.e. they hold roughly still in WORLD space while the body pulls past them: a real crawl;
     · hanging STILL (vy ≈ 0) — the phase stops, `climbEase` fades every lift to zero, and all four
       limbs settle onto the plane (a climber frozen mid-move, holding on, still breathing);
     · climbing DOWN (vy < 0, the S key) — the phase runs BACKWARDS, so limbs reach DOWN while lifted
       and slide up while planted. A down-climb is an up-climb played in reverse, with no second gait.

   C++ anchor: a phase accumulator driven by ds/dt instead of dt — the classic wheel-odometry trick
   (walk-cycle phase from distance travelled) applied to a vertical surface. */

// Limb order used by the rig's contact pass and the CRAWL_PHASE table. Fixed and exported so the rig,
// the tests and any probe agree on which index is which limb without a second copy of the list.
export const CRAWL_LIMBS = ['handL', 'handR', 'footL', 'footR'];
/* The DIAGONAL pairing, as per-limb phase offsets: LH and RF share phase 0, RH and LF are the
   counter-pair at π. This is the table the additive cling pose below must agree with — the reaching
   ARM and the driving OPPOSITE KNEE rise together, or the silhouette pace-walks like a camel. */
export const CRAWL_PHASE = [0, Math.PI, Math.PI, 0];

/* The gait's tuned shape, all in LIMB-CHAIN LENGTHS (shoulder→wrist / hip→ankle, measured live by the
   rig) so one set of numbers fits any rig at any scale. `stride` is in LEG-chain lengths of climb per
   full cycle — the phase-rate divisor that makes the gait distance-locked. */
export const CRAWL = {
  stride: 7.0,      // world units climbed per full gait cycle, in leg-chain lengths (≈0.96 u on the 0.30 u
                    // hero → ~1.2 Hz at climbRate 1.15). MEASURED down from 4.4: that ran the cycle at
                    // 1.9 Hz, which is past the rig's own 12/s angle-ease cutoff — the additive
                    // alternation was being low-passed to mush while the pins cycled full-rate.
  uHand: 0.42,      // hands' resting reach ABOVE the shoulder, along the wall's up axis
  uFoot: -0.52,     // feet plant BELOW the hip
  uAmp: 0.30,       // how far the gait swings each contact up/down around that rest
  lat: 0.24,        // sideways offset to the limb's OWN side (hands ~shoulder-width on the wall)
  lift: 0.26,       // how far the reaching limb comes OFF the plane on its return half
  insetHand: 0.14,  // the planted WRIST stands this far off the plane — the palm's own depth. Measured
                    // up from 0.10: at 0.10 the planted readings straddled ZERO (−0.019…+0.015 u on the
                    // lab body), i.e. fingers through the facade half the time; 0.14 centres them just off it.
  insetFoot: 0.10,  // the planted ANKLE ditto — the foot's depth (the mesh touches, the joint does not)
};

/* Signed phase rate (rad/s): one full cycle per `strideU` world units climbed, sign carried straight
   from vy — this is the whole of "still while hanging, reversed when climbing down". */
export function crawlPhaseRate(vy, strideU) {
  if (!(strideU > 1e-6)) return 0;
  return (vy / strideU) * Math.PI * 2;
}

/* Per-limb gait offsets at limb phase `phi` (already offset per CRAWL_PHASE), writing into a caller-
   owned {u, lift} (zero-alloc, like everything else in this file):
     u    — −1..1 reach along the wall's UP axis. +cos: the limb PLANTS at the TOP of its travel
            (φ=0) and slides down through the stance half (sin φ > 0), which in world space is the
            limb holding roughly still while the body climbs through it.
     lift — 0..1 clearance off the plane, non-zero ONLY on the return half (sin φ < 0): the limb
            un-sticks, travels, re-plants. Scaled by `climbEase` (the rig's eased |climb|) so a body
            that stops climbing settles all four contacts back onto the plane instead of freezing one
            in mid-air — the "hanging still" read.
   Down-climb correctness falls out of the phase direction: with φ DECREASING, the stance half is
   traversed bottom-to-top (the planted limb slides UP in body space while the body descends past it)
   and the lifted half reaches DOWN. Asserted by the node tests, not just claimed here. */
export function crawlLimb(out, phi, climbEase) {
  out.u = Math.cos(phi);
  const s = Math.sin(phi);
  out.lift = s < 0 ? -s * climbEase : 0;
  return out;
}

/* ── THE POSES ──────────────────────────────────────────────────────────────────────────────────────
   `out`   — a makeAirPose() struct, overwritten in full (every field written every call: a mode that
             does not use a joint writes 0 to it, so a mode CHANGE can never leave a stale limb behind).
   `mode`  — 'jump' | 'fall' | 'swing' | 'cling' (anything else → all zeros, i.e. an exact no-op).
   `t`     — riseFall(): -1 falling … +1 rising.
   `clock` — seconds since this rig started; drives breathe/climb phase.
   `climb` — SIGNED since A-CRAWL: -1..1, how hard a clinging body is climbing and WHICH WAY (+ up,
             − down; |climb| is the effort that scales amplitudes; other modes ignore it).
   `phase` — the distance-locked crawl phase (radians; the rig integrates crawlPhaseRate). Only the
             cling reads it; it replaces the old clock-driven climbCycle so the alternation stops when
             the body stops and reverses when it descends.

   SIGN CONVENTIONS, all measured (see the header + tools/hero-air-axes.mjs):
     spineX +  = lean/curl FORWARD          · spineX −  = arch BACK
     armX   +  = lower the arm toward the hip · armX −  = raise it overhead
     armZ      = outward splay, MIRRORED: +Z on the left arm and −Z on the right both go OUT
     headX  +  = chin down                  · headX −  = chin up
     upLegX +  = knee comes UP/FORWARD      · kneeX +  = shin folds back under the thigh */
export function airPose(out, mode, t, clock, climb = 0, phase = 0) {
  const rise = t > 0 ? t : 0;            // how much of a RISE this is (0 when falling)
  const drop = t < 0 ? -t : 0;           // …and how much of a FALL
  const br = breathe(clock, 5.5);        // the always-on flutter, ~0.9 Hz

  if (mode === 'jump') {
    /* A LAUNCH IS A CRUNCH. Everything folds toward the middle: the arms drive up past the head (that
       is what actually gets a human off the ground), the knees come up under the body, the chest closes.
       Scaled by `rise`, so the pose is strongest right off the ground and relaxes toward the apex — the
       held frame could only ever be equally-jumped at every height. */
    out.spineX = 0.20 * rise;
    out.headX = -0.10 * rise;
    out.armLX = -0.85 * rise; out.armRX = -0.85 * rise;
    out.armLZ = 0.16 * rise; out.armRZ = -0.16 * rise;
    out.foreRX = -0.25 * rise; out.foreLX = 0;
    out.upLegLX = 0.60 * rise; out.upLegRX = 0.42 * rise;      // asymmetric: a jump is not a squat
    out.upLegLZ = 0; out.upLegRZ = 0;
    out.kneeLX = 0.75 * rise; out.kneeRX = 0.55 * rise;
    out.spineZ = 0.03 * br * rise;
    return;
  }

  if (mode === 'fall') {
    /* A FALL IS AN OPENING. The opposite shape to the launch and that contrast is the whole point — the
       two must not be the same silhouette one frame apart. Arms go up and OUT, the chest arches back
       into the air, the legs trail and split. `drop` scales it, so a short hop lands almost neutral
       while a rooftop drop is fully spread, and the flutter runs at full amplitude on the arms because
       the one thing a falling body never does is hold still. */
    out.spineX = -0.18 * drop;
    out.headX = -0.16 * drop;
    out.armLX = -1.00 * drop + 0.13 * br;
    out.armRX = -0.92 * drop - 0.13 * br;
    out.armLZ = 0.50 * drop; out.armRZ = -0.50 * drop;
    out.foreRX = -0.30 * drop; out.foreLX = 0;
    out.upLegLX = -0.14 * drop + 0.10 * br;
    out.upLegRX = 0.22 * drop - 0.10 * br;
    out.upLegLZ = 0.16 * drop; out.upLegRZ = -0.16 * drop;     // legs split, not scissored shut
    out.kneeLX = 0.30 * drop; out.kneeRX = 0.14 * drop;
    out.spineZ = 0.05 * br * drop;
    return;
  }

  if (mode === 'swing') {
    /* A SWING PUMPS. This is the mode where being a function of the physics earns its keep: a real
       pendulum is driven by tucking on the RISE and extending on the FALL, so the legs come up as the
       body swings up through the arc and stretch out as it drops through the bottom. Watch any of the
       reference the genre is built on and that leg pump is what your eye reads as a swing.
       THE RIGHT ARM IS NOT WRITTEN HERE beyond a token: the rig's aim-IK layer owns it and points it at
       the rope's anchor (A-BODY measured the hand 0.201 u off the body's centre line), and this layer
       runs BEFORE aim precisely so aim wins that argument. The FREE arm is ours, and it trails. */
    out.spineX = 0.22 * drop - 0.16 * rise;                    // curl through the bottom, open on the rise
    out.headX = -0.12 * rise;
    out.armLX = -0.60 - 0.28 * rise + 0.10 * br;               // free arm up and back, always alive
    out.armLZ = 0.38;
    out.armRX = 0; out.armRZ = 0; out.foreRX = 0;              // aim-IK's, deliberately untouched
    out.foreLX = 0;
    out.upLegLX = 0.62 * rise - 0.18 * drop;
    out.upLegRX = 0.44 * rise - 0.12 * drop;
    out.upLegLZ = 0.10; out.upLegRZ = -0.10;
    out.kneeLX = 0.70 * rise + 0.10 * drop;
    out.kneeRX = 0.50 * rise + 0.06 * drop;
    out.spineZ = 0.06 * br;
    return;
  }

  if (mode === 'cling') {
    /* A CRAWL, NOT A DECAL (A-CRAWL, 2026-08-19 — the owner's words: "hands grab onto the wall, and
       the legs as well, and you kinda crawl up the wall"). A-AIR's spread-eagle fixed "one reaching
       arm"; what it could not fix from the additive layer alone is CONTACT — its limbs waved in air
       near the wall. This branch is now the crawl's BASE SHAPE and its diagonal alternation; the rig's
       wall-contact pass (createCharacterRig, `_solveTwoBone` on all four limb chains) then pins the
       hands and feet to the actual wall plane on top of it, so this pose also serves as the POLE HINT
       that tells the solver which way elbows and knees bend.
       THE ALTERNATION IS THE DIAGONAL GAIT: `cyc = cos(phase)` — the SAME cosine crawlLimb uses for
       its up-the-wall reach, so the arm is at its most raised exactly when its contact target plants
       at the top of its travel (a sine here would lead the contact by 90° and the pre-pose would
       fight the pins). CRAWL_PHASE pairs it diagonally: left hand + RIGHT knee rise together
       (cyc > 0), then the counter-pair. The old clock-driven cycle
       alternated SAME-side limbs (a pace, like a camel) and never stopped when the body did; the
       distance-locked phase stops while hanging, reverses on a down-climb, and matches the contact
       targets exactly because both read the same table.
       `climb` is SIGNED now: |climb| is effort (scales the alternation), the sign only matters to the
       phase integrator outside — and to the head, which looks where it is going (up on a climb,
       levelling toward the drop on a descent, continuous in climb so the ease never pops). */
    const eff = climb < 0 ? -climb : climb;
    const cyc = Math.cos(phase);
    const amp = 0.10 + 0.45 * eff;                             // hanging still shifts only a little
    out.spineX = 0.30 + 0.04 * br * 0.5;                       // chest pressed toward the wall, breathing
    out.spineZ = 0.10 * cyc * amp + 0.03 * br * (1 - eff);     // weight-shift; breath carries it at rest
    out.headX = -0.30 + (climb < 0 ? 0.35 * -climb : 0);       // look UP the wall; level out descending
    out.armLX = -1.15 - 0.38 * amp * cyc - 0.05 * br * (1 - eff);
    out.armRX = -1.15 + 0.38 * amp * cyc + 0.05 * br * (1 - eff);
    out.armLZ = 0.45; out.armRZ = -0.45;                       // shoulder-wide on the wall, not a starfish
    out.foreRX = -0.55; out.foreLX = -0.55;                    // elbows bent — a climber hangs on bent arms
    out.upLegLX = 0.55 - 0.30 * amp * cyc; out.upLegRX = 0.55 + 0.30 * amp * cyc;   // DIAGONAL: RF with LH
    out.upLegLZ = 0.26; out.upLegRZ = -0.26;                   // knees out — the climber's frog, moderated
    out.kneeLX = 0.85 - 0.25 * amp * cyc; out.kneeRX = 0.85 + 0.25 * amp * cyc;
    return;
  }

  // Unknown / null mode — a full zero write, so releasing the layer can never strand a limb.
  out.spineX = 0; out.spineZ = 0; out.headX = 0;
  out.armLX = 0; out.armRX = 0; out.armLZ = 0; out.armRZ = 0; out.foreRX = 0; out.foreLX = 0;
  out.upLegLX = 0; out.upLegRX = 0; out.upLegLZ = 0; out.upLegRZ = 0; out.kneeLX = 0; out.kneeRX = 0;
}
