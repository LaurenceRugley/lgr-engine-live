/* ============================================================
   ground-clamp.js — THE GROUND CLAMP: a character may not have geometry below the floor. (ARC A-CLAMP, 2026-08-21)
   ------------------------------------------------------------
   WHY THIS IS A NEW MECHANISM AND NOT A SETTING ON THE OLD ONE. Two prior arcs measured the same bug and
   the second one measured why the first arc's fix could not touch it (docs/design/swing-ledger.md,
   §A-GROUND FINDING 3 + §A-GROUND INDEPENDENT REFUTATION):

     · A7-2's foot lock is a PLANT-AND-HOLD. Its only ground term, `_ikFloorY`, is the plant THRESHOLD
       (`lg.fy - _ikFloorY < plantBand`), and the lock then pins the foot at `lg.fy` — wherever the clip
       already put it. So it changes WHEN a foot plants and never WHERE. Turning the measured floor on
       made grounding measurably WORSE (census verdict 21/35 → 22/35 sunk) precisely because a foot
       already under the floor passes the threshold and gets PINNED at its sunk Y.
     · The defect is a CLIP ROTATION, not a placement error. One tracked civilian: its group origin held a
       constant 0.3000 (placement exact) while its lowest toe swung +0.0004 → −0.0784 relative to it. At
       the deepest instant the ankle is +0.057 ABOVE ground while the toe end is −0.129 BELOW it. A solver
       that pins a foot's POSITION cannot fix a foot whose ROTATION is driving the toe through the floor.

   THE ABILITY, therefore: measure where the character's SOLE GEOMETRY actually is, every frame, and if
   any of it is under the floor, lift the whole body by exactly enough that it is not. Four decisions,
   each of which had a cheaper wrong answer that a prior arc already ruled out:

   1 · MESH, NEVER BONE. The refutation's C2: the Quaternius zombie's bone ruler reads `+0.0178 CLEAR`
       while its foot MESH is at `−0.0567 SUNK`, because that rig has no toe bone — the skeleton ends at
       the ankle and the foot geometry hangs ~0.075 below it. Any clamp driven by bone Y alone reports
       success on the arc's headline class while fixing nothing. So the datum is measured off the
       GEOMETRY (`measureSoleBoxes` below).

   2 · MEASURED ONCE, EVALUATED IN O(1). Scanning ~4,733 vertices per body per frame is not a render-loop
       operation. At load we compute, per (mesh, bone), the AABB of the vertices that bone DOMINATES,
       expressed in that bone's own space — `q = boneInverse_b · bindMatrix · v`, three's own skinning
       decomposition, so for a single-bone vertex the reconstruction is EXACT. At runtime we transform
       the box's 8 corners by that bone's live matrix and take the lowest. The box CONTAINS every vertex
       it was built from, so under any bone rotation the corner minimum is a LOWER BOUND on the real
       geometry: the clamp can lift slightly too much, never too little. Rotation-aware by construction —
       a scalar "sole depth" would be blind to exactly the toe-roll that causes the bug.

       ── THE TRAP IN THAT SENTENCE, AND IT COST THIS ARC A FALSE GREEN. `applyBoneTransform` reads
       `worldPos = matrixWorld · bindMatrixInverse · boneMat · bindMatrix · v`, so the obvious runtime
       matrix is `mesh.matrixWorld · mesh.bindMatrixInverse · bone.matrixWorld`. IT IS NOT, because
       `bindMatrixInverse` is not a constant: under the DEFAULT `AttachedBindMode`, three recomputes it as
       `matrixWorld⁻¹` inside `SkinnedMesh.updateMatrixWorld` (three/src/objects/SkinnedMesh.js) — i.e. the
       leading pair cancels to the identity, and it only cancels when BOTH halves are from the same
       update. `Object3D.updateWorldMatrix` — the surgical refresh every pass in this engine uses — does
       NOT go through that override, so it refreshes `matrixWorld` and leaves `bindMatrixInverse` a frame
       (or, on a never-rendered pool slot, a whole bind) behind. Pairing them produced corner positions
       ~0.25 u low, a lift that floated every body clean out of the census's 0.25 u judged band, and a
       PASS printed on 8 of 35 bodies instead of a FAIL on 35. So this module uses the CANCELLED form —
       `M = bone.matrixWorld`, exact under AttachedBindMode — and REFUSES to measure a mesh in any other
       bind mode rather than quietly returning the wrong number for it.

   3 · THE ROOT, NOT THE FEET. On a flat rig there is no shin to bend, so lifting a foot detaches it from
       the leg (that is A7-2's own reason for its topology-agnostic override). Lifting the BODY by the
       minimum that clears the floor preserves the silhouette and is ONE mechanism for both rig families —
       articulated and flat — rather than a third style beside the two that already exist.

   4 · ATTACK HARD, RELEASE LEAKY. The lift required by a walk cycle swings with the gait. Tracking it
       instantly grounds every foot and makes the body PUMP at stride frequency. Holding a constant lift
       kills the pump and floats the body at the shallow phases. The resolution is the same shape the
       foot-lock's own floor already uses (`_ikFloorY = Math.min(minFootY, _ikFloorY + 0.5 * dt)`, a leaky
       MIN): rise to the requirement immediately — so "no geometry below the floor" holds on EVERY frame,
       by construction, not on average — and bleed back down at a fixed rate. In steady state on a
       periodic gait the held lift is the cycle's own worst dip and the residual bob is bounded by
       `release × cyclePeriod`, which is a number this module's caller can state and a probe can measure.

   PRESENTATION-ONLY, and that is load-bearing. The clamp writes `object.position.y` AFTER the consumer
   has placed the body and never reports it back: the sim's authoritative position is untouched, so the
   hoard2 determinism trace must hash identical with the clamp on and off. The idempotence that keeps
   that true without assuming a call order is `_clampBaseY`/`_clampWroteY` — and they are NOT "below":
   they live in `createCharacterRig.js` (declared :342, restored :347, argued :331). This sentence used
   to say "`_baseY` below", naming a variable that exists nowhere and pointing at the wrong file; the
   A-CLAMP refutation caught it. A pointer comment that misnames its target is worse than no comment,
   because the next reader greps for a symbol that was never there.

   C++ anchor: an out-of-band presentation offset applied to a transform each frame and re-derived from
   scratch the next — like a render-thread jitter/interpolation term that never writes back into the
   simulation state it reads.

   ── WHY THIS MODULE IMPORTS THREE ITSELF INSTEAD OF BEING HANDED IT. The first cut took `THREE` as a
   PARAMETER (`measureSoleBoxes(root, THREE, …)`), which reads like the tidier, less-coupled signature and
   is a **156 KB bundle regression**. A namespace import used only for property access (`new THREE.Vector3`)
   is traceable and tree-shakes; the moment the namespace object is passed as a VALUE the bundler can no
   longer know which exports are reachable and must include all of three. Measured on moto-lab, which uses
   this rig for its rider: three chunk 610,190 -> 766,966 bytes, entry JS 232.0 KB gzip against a 203.5 KB
   budget — a project this arc never touched, failing on an argument. Import it here, keep it internal.
   ============================================================ */
import * as THREE from 'three';

/* The clamp's tuned shape. All in WORLD units per second / world units — this ability's whole job is to
   compare geometry against a floor, and both are already world-space, so there is no chain-length
   normalisation to do (unlike contact.js's insets, which describe a limb's own flesh depth). */
export const GROUND_CLAMP = {
  /* How fast the held lift bleeds back down (u/s). THIS IS THE BOB BUDGET, and it is the only free
     parameter: on a periodic gait of period T the body's residual vertical travel is `release × T`.
     0.006 u/s against hoard2's ~1.2 s zombie cycle is ~0.007 u — under the census's own 0.010 u
     tolerance, i.e. the correction's wobble is smaller than the error it corrects. Slow enough to
     look still; fast enough that a character which walks off a lip recovers in a second or two. */
  release: 0.006,
  /* Safety ceiling (u). A body genuinely far under the floor is a placement bug, not a gait dip, and
     teleporting it up is worse than leaving it visible. Also bounds the damage from a `groundAt` that
     returns a wrong-but-finite answer. */
  maxLift: 0.30,
  /* Extra standoff above the floor (u). 0 = the lowest geometry just touches. Kept as a knob because a
     project with z-fighting decals on its floor may want a hair of clearance; hoard2 does not. */
  standoff: 0,
};

/* Does this bone own geometry that can be a SOLE? The default is the same predicate the hoard2 ground
   census uses to pick its bone ruler (`/foot|toe/i`) — deliberately, so the thing being fixed and the
   thing measuring the fix name the same parts. Passed in rather than hard-coded so a rig whose exporter
   calls them something else (or a quadruped, or a body that should be clamped on more than its feet)
   can widen it without editing the engine. */
export const SOLE_BONE = /foot|toe/i;

/* ── THE ONE-TIME MEASUREMENT ────────────────────────────────────────────────────────────────────────
   Walk a rig SOURCE's skinned meshes and, for every bone the filter accepts, accumulate the AABB of the
   vertices that bone dominates — in that bone's own space.

   `q = boneInverse_b · bindMatrix · v` is not a convention chosen here; it is the middle of three's own
   skinning expansion:
       worldPos = matrixWorld · bindMatrixInverse · ( Σ w_i · bone_i.matrixWorld · boneInverse_i ) · bindMatrix · v
   For a vertex whose weight is entirely on bone b, under the default AttachedBindMode (where
   `matrixWorld · bindMatrixInverse` is the identity by construction — see the trap note in the header),
   that collapses to
       worldPos = bone_b.matrixWorld · q
   so storing q and applying ONE live matrix at runtime reproduces the vertex EXACTLY. Vertices blended
   across bones are approximated by their dominant one; those live at the ankle seam, not at the sole, and
   the box's own conservatism absorbs the difference (measured against the exact per-vertex ruler — the
   residual is in the arc's ledger entry).

   A mesh in any other bind mode is SKIPPED, loudly, rather than measured with a formula that does not
   hold for it — the resulting `boxes: 0` is a state the receipt reports and the caller warns about.

   Keyed by `mesh.name|bone.name` because the result is a property of the shared GEOMETRY + BIND POSE,
   which every SkeletonUtils clone inherits — so this runs ONCE per rig source, not once per character.
   Returns a Map (empty if the object has no skinned mesh, which is a legitimate "nothing to clamp").
   C++ anchor: precomputing a per-bone local-space bounding volume, exactly as a skinned-mesh renderer
   does for culling — same data, different question asked of it. */
export function measureSoleBoxes(root, isSoleBone = SOLE_BONE) {
  const table = new Map();
  if (!root) return table;
  const v = new THREE.Vector3(), q = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton || !o.geometry) return;
    // Only the mode the collapse above is valid for. (three's default, and what GLTFLoader produces —
    // it binds with the identity matrix, GLTFLoader.js:4232 — so this is every rig in this engine.)
    if (o.bindMode !== 'attached') return;
    const g = o.geometry, pos = g.attributes.position;
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    if (!pos || !si || !sw) return;
    for (let i = 0; i < pos.count; i++) {
      // dominant bone = the largest of the four skin weights (three's skinning is 4-influence)
      let b = si.getX(i), w = sw.getX(i);
      if (sw.getY(i) > w) { w = sw.getY(i); b = si.getY(i); }
      if (sw.getZ(i) > w) { w = sw.getZ(i); b = si.getZ(i); }
      if (sw.getW(i) > w) { w = sw.getW(i); b = si.getW(i); }
      if (!(w > 0)) continue;
      const bone = o.skeleton.bones[b];
      if (!bone || !isSoleBone.test(bone.name)) continue;
      v.fromBufferAttribute(pos, i);
      q.copy(v).applyMatrix4(o.bindMatrix).applyMatrix4(o.skeleton.boneInverses[b]);
      const key = `${o.name}|${bone.name}`;
      let bx = table.get(key);
      if (!bx) { table.set(key, { min: [q.x, q.y, q.z], max: [q.x, q.y, q.z], n: 1 }); continue; }
      if (q.x < bx.min[0]) bx.min[0] = q.x; if (q.y < bx.min[1]) bx.min[1] = q.y; if (q.z < bx.min[2]) bx.min[2] = q.z;
      if (q.x > bx.max[0]) bx.max[0] = q.x; if (q.y > bx.max[1]) bx.max[1] = q.y; if (q.z > bx.max[2]) bx.max[2] = q.z;
      bx.n++;
    }
  });
  return table;
}

/* Resolve the shared table against ONE cloned character: a flat array of {bone, min, max} the hot loop
   can walk with no lookups. Cheap (a traverse over ~2 meshes), run once per spawned handle. An empty
   result is the INERT state the receipt must report rather than hide.
   DEDUPED BY BONE: the zombie GLB carries TWO SkinnedMeshes over one bone set, so the same bone appears
   under two mesh keys. Both boxes describe geometry that really is there, so they are UNIONED rather
   than one being picked — and the runtime then transforms one box per bone, not one per (mesh, bone). */
export function bindSoleBoxes(root, table) {
  const out = [], byBone = new Map();
  if (!root || !table || !table.size) return out;
  root.traverse((o) => {
    if (!o.isSkinnedMesh || !o.skeleton || o.bindMode !== 'attached') return;
    for (const bone of o.skeleton.bones) {
      const bx = table.get(`${o.name}|${bone.name}`);
      if (!bx) continue;
      const have = byBone.get(bone);
      if (!have) { const e = { bone, min: bx.min.slice(), max: bx.max.slice(), n: bx.n }; byBone.set(bone, e); out.push(e); continue; }
      for (let i = 0; i < 3; i++) { if (bx.min[i] < have.min[i]) have.min[i] = bx.min[i]; if (bx.max[i] > have.max[i]) have.max[i] = bx.max[i]; }
      have.n += bx.n;
    }
  });
  return out;
}

/* ── THE PER-FRAME QUESTION, in O(boxes) ─────────────────────────────────────────────────────────────
   How far must this body rise so that none of its sole geometry is below the floor?
     entries  — from bindSoleBoxes
     groundAt — (x,z) -> floor Y, the authority every project with a floor already publishes. A ground
                clamp is a HEIGHT query, so it takes the height field directly rather than round-tripping
                through contact.js's `segmentHit` dialect and back (heightFieldProbe exists for the
                opposite direction, where a ray-shaped ability needed a height field). Non-finite = "no
                floor here" = that corner is not clamped, same as heightFieldProbe's own contract.
     v3       — caller-owned scratch (this module allocates nothing per frame).
     standoff — extra clearance above the floor.
   Returns >= 0: the minimum lift. Every corner is sampled at ITS OWN xz, so a body straddling a slope
   is judged against the ground under each foot rather than under its centre.
   `bone.updateWorldMatrix(true, false)` walks the bone's parents — object → armature → … → bone — so the
   matrix is fresh against whatever Y the caller has the body at right now, mid-frame. */
export function soleLift(entries, groundAt, v3, standoff = 0) {
  let lift = 0;
  if (!entries || !entries.length || typeof groundAt !== 'function') return 0;
  for (let e = 0; e < entries.length; e++) {
    const en = entries[e];
    en.bone.updateWorldMatrix(true, false);
    const mn = en.min, mx = en.max;
    for (let k = 0; k < 8; k++) {
      v3.set(k & 1 ? mx[0] : mn[0], k & 2 ? mx[1] : mn[1], k & 4 ? mx[2] : mn[2]).applyMatrix4(en.bone.matrixWorld);
      const gy = groundAt(v3.x, v3.z);
      if (!Number.isFinite(gy)) continue;
      const d = gy + standoff - v3.y;
      if (d > lift) lift = d;
    }
  }
  return lift;
}

/* THE ENVELOPE — attack hard, release leaky. Separated from the geometry so the rule is unit-testable
   without a skeleton (see ground-clamp.test.mjs), and so the one number that decides the bob is in one
   place. `held` in, `held` out. */
export function clampEnvelope(held, want, dt, cfg = GROUND_CLAMP) {
  let h = held - cfg.release * dt;          // bleed down
  if (h < 0) h = 0;
  if (want > h) h = want;                   // …but never below what THIS frame requires: the hard guarantee
  if (h > cfg.maxLift) h = cfg.maxLift;     // …and never a teleport
  return h;
}
