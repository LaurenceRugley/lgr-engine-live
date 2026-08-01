/* ============================================================
   @lgr/engine-core — character-rig-profiles (A9 RIG ADAPTER): the canonical bone map + the layer contract.
   ------------------------------------------------------------
   THE ABILITY (A9 rider): turn "which bone does this motion layer move?" from a scatter of `||` fallback
   chains inside the rig into ONE documented contract — a canonical bone SET, a table of exporter PROFILES
   that map their skeleton's names onto it, and a validation that FAILS LOUD when a layer targets a bone the
   active profile can't provide. This exists because it already bit us:

     A5→A8 SILENT NO-OP (the bug this encodes as a check). The procedural combat layers (lunge / hit-react)
     were written against the mixamo bone names (Spine2 / LeftArm / RightArm). The shipped Quaternius zombie
     names those Torso / UpperArmL / UpperArmR, so `boneSpine` resolved NULL and the layer block simply
     SKIPPED — the whole horde's lunge + hit-react were dead from the day they shipped until A8-4 measured
     it. A missing bone degrading to a no-op is invisible; nothing ever errors. This module makes that class
     of bug catchable: a node test validates every layer's required bones against each shipped rig's real
     skeleton, so a future layer that targets a bone a rig lacks fails RED in CI instead of silently doing
     nothing on that rig.

   ── THREE.js NAME NOTE (why the names below have no dots) ──────
   GLTFLoader assigns each node `createUniqueName(name)`, which runs `PropertyBinding.sanitizeNodeName` —
   it strips the reserved chars `[ ] . : /`. So the Quaternius GLB's `UpperArm.L` / `Foot.L` / `Shoulder.L`
   become the RUNTIME bone names `UpperArmL` / `FootL` / `ShoulderL`. The profiles map the SANITIZED runtime
   names (what `bone.name` actually is once loaded), NOT the raw glTF names. (Verified against three.core.js
   sanitizeNodeName + the two shipped GLBs; the .test.mjs pins the sanitisation so it can't drift silently.)

   ── C++ anchor ────────────────────────────────────────────────
   CANONICAL_BONES is an enum of roles; RIG_PROFILES is a per-vendor lookup table keyed by that enum
   (an alias table papering over two exporters' naming conventions); LAYER_BONES is a compile-time
   assertion list ("this subsystem needs these enum slots present"), checked by the test like a static_assert.

   ── This module is PURE (no THREE import) so it is node-testable ──
   It reasons over bone NAMES (strings). The rig (createCharacterRig) hands it the set of names present on a
   cloned skeleton and gets back the resolved profile + role→name map; it then looks up the live Bone objects.
   ============================================================ */

// The canonical bone ROLES every motion layer targets. This is the whole vocabulary — a layer may only ask
// for a role in this list, and a profile need only map these (a rig has hundreds of finger/toe/tongue bones
// the layers never touch). Kept minimal: exactly the roles the shipped layers actually move.
//   head/neck — head-look yaw · spine — the primary chest bone every torso beat bends · armL/armR — the
//   upper arms (fling, recoil, swing, aim) · foreArmR — the right forearm (aim-IK elbow bend) · footL/footR
//   — the ankle bones the foot-lock pins · hips — the body-travel reference the foot-lock releases against.
export const CANONICAL_BONES = ['head', 'neck', 'spine', 'armL', 'armR', 'foreArmR', 'footL', 'footR', 'hips'];

// The skeleton-naming PROFILES. Each maps every canonical role to the SANITISED runtime bone name for that
// exporter. `detect` identifies the profile from the set of names present (a rig carries exactly one of the
// two families, so the signatures never overlap). Order matters only for the (never-hit) ambiguous case;
// mixamo is tried first because the survivor (the aiming character that uses the most roles) is mixamo.
export const RIG_PROFILES = [
  {
    // MIXAMO convention — the survivor.glb ("Human Armature" clips: Spine/Spine1/Spine2, Left/Right limbs).
    id: 'mixamo',
    detect: (has) => has('Spine2') || has('LeftArm') || has('LeftFoot'),
    bones: {
      head: 'Head', neck: 'Neck', spine: 'Spine2',
      armL: 'LeftArm', armR: 'RightArm', foreArmR: 'RightForeArm',
      footL: 'LeftFoot', footR: 'RightFoot', hips: 'Hips',
    },
  },
  {
    // QUATERNIUS convention — the zombie.glb ("CharacterArmature" clips). Runtime names are the sanitised
    // dotted originals: Torso/Abdomen, UpperArm.L→UpperArmL, LowerArm.R→LowerArmR, Foot.L→FootL.
    id: 'quaternius',
    detect: (has) => has('Torso') || has('UpperArmL') || has('FootL'),
    bones: {
      head: 'Head', neck: 'Neck', spine: 'Torso',
      armL: 'UpperArmL', armR: 'UpperArmR', foreArmR: 'LowerArmR',
      footL: 'FootL', footR: 'FootR', hips: 'Hips',
    },
  },
];

// THE LAYER CONTRACT — for each procedural motion layer, the canonical bones WITHOUT WHICH it is inert (the
// primary movers; a layer may also touch OPTIONAL bones that only enrich it — those are not required). This
// is the single source of truth the test validates against every shipped rig, and the exact list whose
// silent absence was the A5→A8 bug. If you add a layer that moves a new role, add it here and the test will
// tell you which shipped rig can't run it.
//   NOTE optional (enriching, not required, so NOT listed): headLook.neck (falls back to head-only),
//   aim.foreArmR (elbow bend) + aim.spine (chest lead), lunge.head (thrust). Required = the movers below.
export const LAYER_BONES = {
  headLook: ['head'],                       // yaw the head toward a target (neck optional split)
  aim:      ['armR'],                       // point the gun arm (spine/foreArmR enrich)
  hitReact: ['spine', 'armL', 'armR'],      // the A8 bug: all three null on the zombie → fully inert
  recoil:   ['armR'],                       // fire kick — gun-arm snap-back
  swing:    ['armR'],                       // melee arc — gun-arm forward whip (spine/armL enrich)
  lunge:    ['spine'],                      // the A8 bug: boneSpine null on the zombie → the block skipped
  reload:   ['armR'],                       // reload dip — gun-arm lowers (armL/spine enrich)
  idleRelax:['armL', 'armR', 'spine'],      // settle a braced idle (survivor)
  footIK:   ['footL', 'footR', 'hips'],     // plant-and-hold foot lock
};

// The layers each shipped CONSUMER actually drives — so the test validates the RIGHT set against each rig
// (the zombie horde never aims/reloads; the survivor does). A layer a consumer never calls needn't resolve
// on that rig — but every layer a consumer DOES call MUST, or it is the silent-no-op bug again.
export const CONSUMER_LAYERS = {
  // hoard2 zombie horde (sim/zombies): head-look, hit-react on damage, the attack lunge, and the foot lock.
  zombieHorde: ['headLook', 'hitReact', 'lunge', 'footIK'],
  // hoard2 survivor (player): idle-relax, aim-IK, fire recoil, melee swing, reload dip, hit-react, foot lock.
  survivor: ['idleRelax', 'aim', 'recoil', 'swing', 'reload', 'hitReact', 'footIK'],
};

// Detect which profile a skeleton uses, given a predicate `has(name)` (true if that bone name is present).
// Returns the profile object, or null if neither family matches (an unknown rig → the rig degrades to the
// pure clip pose, exactly as before — the graceful path; the LOUD path is the test + the resolve warning).
export function detectProfile(has) {
  for (const p of RIG_PROFILES) if (p.detect(has)) return p;
  return null;
}

// Resolve the canonical role→Bone map from a live skeleton's bone dictionary (name → Bone object). Returns
// { profile, bones:{ role: Bone|null }, missing:[role...] } where `missing` lists roles the detected profile
// names but the skeleton doesn't actually have (a broken/partial rig — the rig warns on these, Rule 12). A
// role resolves to null when there is no profile or the named bone is absent. Pure over the dict's keys.
export function resolveRig(boneDict) {
  const has = (n) => Object.prototype.hasOwnProperty.call(boneDict, n) && !!boneDict[n];
  const profile = detectProfile(has);
  const bones = {};
  const missing = [];
  for (const role of CANONICAL_BONES) {
    const name = profile ? profile.bones[role] : null;
    const bone = name && has(name) ? boneDict[name] : null;
    bones[role] = bone;
    if (profile && name && !bone) missing.push(role);
  }
  return { profile, bones, missing };
}

// THE CHECK (the A8-lesson gate). Given a set of present bone names and the layers to validate, return the
// list of { layer, role, name } entries that FAIL — a required canonical bone that either the active profile
// doesn't map or the skeleton doesn't carry. Empty array = every checked layer can fully run on this rig.
// `presentNames` may be an array or a Set of the runtime bone names.
export function findMissingLayerBones(presentNames, layers = Object.keys(LAYER_BONES)) {
  const set = presentNames instanceof Set ? presentNames : new Set(presentNames);
  const has = (n) => set.has(n);
  const profile = detectProfile(has);
  const misses = [];
  for (const layer of layers) {
    const roles = LAYER_BONES[layer];
    if (!roles) throw new Error(`[rig-profiles] unknown layer '${layer}' — not in LAYER_BONES`);
    for (const role of roles) {
      const name = profile ? profile.bones[role] : null;
      if (!name || !has(name)) misses.push({ layer, role, name: name || null, profile: profile ? profile.id : null });
    }
  }
  return misses;
}

// Throwing wrapper for the node test and any dev-time guard: validate the consumer's layers against a rig's
// real bone-name set, throw a readable error listing every gap if any layer can't run. This is the line that
// turns "the lunge silently did nothing on the horde for three arcs" into a red CI failure.
export function assertLayersResolvable(presentNames, layers, label = 'rig') {
  const misses = findMissingLayerBones(presentNames, layers);
  if (misses.length) {
    const lines = misses.map((m) => `  · layer '${m.layer}' needs role '${m.role}' → bone '${m.name}' (profile ${m.profile}) — ABSENT`);
    throw new Error(`[rig-profiles] ${label}: ${misses.length} motion layer bone(s) unresolved (would be a SILENT no-op):\n${lines.join('\n')}`);
  }
}
