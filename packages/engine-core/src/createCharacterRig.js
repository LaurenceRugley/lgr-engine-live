/* ============================================================
   @lgr/engine-core — createCharacterRig (Lesson M1a): skinned character + animation state machine.
   ------------------------------------------------------------
   THE ABILITY: the engine learns CHARACTERS. Load a skinned GLB (a mesh bound to a skeleton + a set of
   animation clips), then drive a six-state machine — idle / walk / run / attack / hit / death — with
   CROSS-FADE blending so states melt into each other instead of popping. Proven here on ONE character;
   M1b pools it into a horde.

   WHY (settled): there is zero SkinnedMesh/AnimationMixer anywhere in the repo, and pure-procedural
   characters were rejected (claude-of-duty's 9,400-line "mannequins"). A CC0 mesh + a first-party
   animation module is the path. The asset is the CC0 Quaternius zombie (public/models/zombie.glb, see
   LICENSES.md) whose clips map onto the six states (character-anim.js).

   ── HOW ──────────────────────────────────────────────────────
     • load  : GLTFLoader (three/addons — the in-convention loader, landmarks.js:28). Returns a `ready`
               promise; or pass a pre-loaded `gltf` to skip the fetch (the demo shares one load across
               spawns). The clips are DATA shared by every spawn.
     • spawn : SkeletonUtils.clone gives each character its OWN skeleton (so they animate independently)
               while SHARING geometry + material with the source (no per-instance GPU upload). Each spawn
               gets its own AnimationMixer + a pure state machine (character-anim.js).
     • state : setState(name) cross-fades the current action out and the new one in over `fade` seconds;
               attack/hit/death play ONCE and clamp on the last frame, idle/walk/run loop. The pure SM
               guarantees we only fade on a REAL change (re-triggering the same clip would pop).
     • update: one call steps every live mixer (M1b adds a distance LOD that throttles far mixers).

   C++ anchor: a skeleton ≈ an array of bone matrices multiplied out to skin the mesh each frame; a clip ≈
   keyframe tracks sampled into those matrices; the mixer ≈ the sampler+blender that writes the pose. The
   clone SHARES the vertex/index buffers (one upload) but owns its bone array (its own pose).

   Contract: createCharacterRig(opts) -> {
     ready: Promise, spawn(opts?) -> handle, update(dt), dispose(),
     get count(), get animations(),
   }
   handle -> { object, position, quaternion, scale, setState(name,{fade}), get state(), setTimeScale(s),
               mixer, dispose() }
   ============================================================ */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { createAnimStateMachine, ZOMBIE_STATES, ZOMBIE_LOOP_ONCE, strideTimeScale } from './character-anim.js';
import { flinchEnvelope, headYawDelta, wrapPi, swingEnvelope, dipEnvelope } from './character-layers.js';
import { makeAirPose, airPose, riseFall, AIR_POSE_KEYS, CRAWL, CRAWL_PHASE, crawlPhaseRate, crawlLimb } from './hero-air.js';
import { CONTACT, planeContactTarget, groundContactTarget } from './contact.js';
import { GROUND_CLAMP, SOLE_BONE, measureSoleBoxes, bindSoleBoxes, soleLift, clampEnvelope } from './ground-clamp.js';
import { resolveRig } from './character-rig-profiles.js';
import { applyNightFill, collectMaterials } from './character-night-fill.js';
import { damp } from './math.js';

// Beauty B3 — PROCEDURAL MOTION LAYERS. Additive rotations applied to named bones AFTER the mixer poses
// them from the clip, turning the clip-PLAYER into a motion SYSTEM. The bone names are the Quaternius /
// mixamo family (Head, Spine1/2, LeftArm/RightArm — local Y runs UP each bone, so a local-Y twist yaws the
// head and a local-X twist bends the spine). Module-level scratch — _applyLayers runs synchronously per
// handle, never re-entrant, so one shared set is safe + alloc-free (engine-invariants #7).
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _qA = new THREE.Quaternion();
const _v3 = new THREE.Vector3(), _v3b = new THREE.Vector3();
const _UPY = new THREE.Vector3(0, 1, 0);   // A1 aim-IK: a mixamo bone's local +Y runs down-bone (toward its child)
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const _AX_Y = new THREE.Vector3(0, 1, 0);
const _AX_X = new THREE.Vector3(1, 0, 0);
const _AX_Z = new THREE.Vector3(0, 0, 1);
// Default per-type layer personality. Consumers override via handle.setLayerParams / horde.setLayerParams.
export const LAYER_DEFAULTS = {
  headLook: { cone: 1.2, speed: 6, weight: 1 },      // cone rad · damp rate · how much of the turn to apply
  hitReact: { amp: 1, dur: 0.4, lean: 0.5, arm: 0.7 }, // impulse gain · seconds · spine lean rad · arm fling rad
  recoil:   { amp: 1, dur: 0.16, arm: 0.5 },          // B4 fire kick: a sharp gun-arm snap-back + slight torso
  swing:    { amp: 1, dur: 0.42, arm: 1.7 },          // B4 melee: the gun-arm swings a forward arc then back
  lunge:    { amp: 1, dur: 0.34, lean: 0.55, head: 0.35 }, // A5 zombie attack: a forward upper-body LUNGE + head thrust
  reload:   { amp: 1, dur: 0.85, arm: 1.15, off: 0.9, lean: 0.12 }, // A8-3 reload dip: gun-arm drops off aim, off-hand racks, torso settles
};

// ── A7-2 FOOT IK — a PLANT-AND-HOLD foot lock. The zombie shamble's real defect (A6-2 MEASURED: stride-rate
// scaling does NOT beat the heuristic for this clip) is foot SLIDE — the "planted" foot skates as the body
// translates. The fix the slip probe pointed at is to LOCK the support foot's world position during its
// contact phase and HOLD it while the hips move over, so its world speed → ~0 (the probe's plantRatio metric).
//
// WHY A POSITION LOCK, NOT A ROTATION 2-BONE SOLVER (the honest engineering reason): the shipped zombie is the
// Quaternius CC0 rig, and its skeleton is FLAT — the foot bone (Foot.L) is parented to the armature Root, NOT
// to the lower-leg (whose chain dead-ends at a tip). Measured directly (Foot.L.parent === 'Root'). So rotating
// the hip/knee cannot move the foot bone the metric (and the mesh's foot verts) track — a classic leg IK is a
// no-op on this rig. The topology-agnostic hold that DOES work is to override the foot bone's own transform so
// its world position stays pinned. A knee-follow bend to hide any shin stretch is a separate future polish;
// this ships the plant the metric demands. Presentation-only (bone transform after the mixer; the sim owns the
// body position) → determinism-safe. Module scratch (runs synchronously at the tail of one _applyLayers).
const _ikTgt = new THREE.Vector3(), _ikLocal = new THREE.Vector3(), _ikMat = new THREE.Matrix4();
const _mountTgt = new THREE.Vector3();   // A-WHIP mount-IK: the socket node's world position (per-limb scratch)
// A-CRAWL (2026-08-19) wall-contact scratch — module-level like every other layer's (the contact pass
// runs synchronously inside one _applyLayers, one limb at a time, so a shared pair is safe + alloc-free).
const _cR = new THREE.Vector3(), _cE = new THREE.Vector3();
// A-CONTACT (2026-08-20) — the surface-resolved target, written by contact.js's out-param convention.
// Module scratch like every other layer's: one limb is solved at a time, synchronously, so it is safe.
const _cTgt = { x: 0, y: 0, z: 0 };
// A-CLAMP (2026-08-21) — the ground clamp's scratch. Module-level like every other pass's: one character
// is clamped at a time, synchronously, inside its own `groundClampStep`, so a shared vector is safe and
// the clamp allocates nothing per frame (docs/engine-invariants.md: no-hot-alloc).
const _gcV = new THREE.Vector3();
/* A-CRAWL — a limb chain's total world length (root→mid + mid→end), measured ONCE off the live bones
   and cached on the chain (`clen`). Measured rather than configured because it is the one number every
   crawl amplitude is expressed in (hero-air.js CRAWL is all in chain-lengths), and the same rig lands
   at a different world size per consumer (createHeroBody scales the GLB to the level's own height).
   Bone-to-bone distances are pose-invariant, so when this runs within a frame does not matter; it does
   assume the object's SCALE is settled, which it is by the first frame any air layer can run (the
   consumer scales at ready-time, before its first update). Articulated chains only — a flat rig
   (Quaternius Foot→Root) has no limb length worth speaking of and returns 0. */
function _chainLenOf(ch) {
  if (ch.clen > 0) return ch.clen;
  if (!ch.articulated) return 0;
  ch.upleg.updateWorldMatrix(true, false); ch.upleg.getWorldPosition(_cR);
  ch.knee.updateWorldMatrix(true, false); ch.knee.getWorldPosition(_cE);
  let l = _cR.distanceTo(_cE);
  ch.foot.updateWorldMatrix(true, false); ch.foot.getWorldPosition(_cR);
  l += _cE.distanceTo(_cR);
  ch.clen = l > 1e-5 ? l : 0;
  return ch.clen;
}
// A8-2 two-bone knee-follow scratch (module-level, synchronous, alloc-free — one leg solved at a time).
const _kR = new THREE.Vector3(), _kM = new THREE.Vector3(), _kE = new THREE.Vector3();
const _kThigh = new THREE.Vector3(), _kShin = new THREE.Vector3(), _kAxis = new THREE.Vector3();
const _kDir = new THREE.Vector3(), _kThighDir = new THREE.Vector3(), _kShinDir = new THREE.Vector3(), _kNewM = new THREE.Vector3();
const _kAlt = new THREE.Vector3();
const _kQ = new THREE.Quaternion(), _kQw = new THREE.Quaternion(), _kQpar = new THREE.Quaternion(), _kUp = new THREE.Vector3(0, 1, 0);
const _clampN = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
// Rotate a bone by a WORLD-space delta quaternion qDelta: newWorld = qDelta·oldWorld, written back to LOCAL
// as parentWorld⁻¹·newWorld. Refreshes the bone's world first (its parents moved this frame). Alloc-free.
function _applyWorldDelta(bone, qDelta, qWorldScratch, qParentScratch) {
  bone.updateWorldMatrix(true, false);
  bone.getWorldQuaternion(qWorldScratch);          // old world orientation
  qWorldScratch.premultiply(qDelta);               // qDelta · old
  if (bone.parent) { bone.parent.getWorldQuaternion(qParentScratch); bone.quaternion.copy(qParentScratch.invert().multiply(qWorldScratch)); }
  else bone.quaternion.copy(qWorldScratch);
  bone.updateWorldMatrix(true, false);             // refresh so the child bone solves against the new pose
}

// A8-2 TWO-BONE KNEE-FOLLOW — rotate the thigh (upleg) + knee so the ANKLE reaches world (tx,ty,tz) while
// PRESERVING both bone lengths (the analytic law-of-cosines IK). This is the correct plant for an articulated
// leg: the shin never stretches (unlike shoving the foot bone's local offset). Two steps: (1) aim the thigh so
// the knee lands where a triangle of sides (thigh, shin) reaching the target puts it, keeping the knee on its
// CLIP-pose bend side (the pole); (2) point the shin at the target. All world-space, converted to local via
// _applyWorldDelta. Foot bone keeps its natural local pose, so it follows the shin. Alloc-free (module scratch).
function _solveTwoBone(lg, tx, ty, tz) {
  const R = lg.upleg, M = lg.knee, E = lg.foot;
  R.updateWorldMatrix(true, false); R.getWorldPosition(_kR);
  M.updateWorldMatrix(true, false); M.getWorldPosition(_kM);
  E.updateWorldMatrix(true, false); E.getWorldPosition(_kE);
  _kThigh.subVectors(_kM, _kR); const a = _kThigh.length();
  _kShin.subVectors(_kE, _kM); const b = _kShin.length();
  if (a < 1e-5 || b < 1e-5) return;
  _kDir.set(tx - _kR.x, ty - _kR.y, tz - _kR.z);
  let d = _kDir.length(); if (d < 1e-5) return;
  d = _clampN(d, Math.abs(a - b) + 1e-4, a + b - 1e-4);   // never over-extend or fold through
  _kDir.normalize();                                       // unit R→T
  // bend axis = normal of the CLIP-pose leg plane (keeps the knee bending its natural way).
  _kAxis.crossVectors(_kThigh, _kShin);
  if (_kAxis.lengthSq() < 1e-8) { _kAxis.crossVectors(_kDir, _kUp); if (_kAxis.lengthSq() < 1e-8) _kAxis.set(1, 0, 0); }
  _kAxis.normalize();
  const thighAngle = Math.acos(_clampN((a * a + d * d - b * b) / (2 * a * d), -1, 1));
  // thigh dir = R→T rotated by ±thighAngle around the bend axis — pick the sign whose knee lands nearer the
  // clip knee (so the pole/bend direction matches the animation, no knee-pop-through).
  _kThighDir.copy(_kDir).applyQuaternion(_kQ.setFromAxisAngle(_kAxis, thighAngle));
  _kNewM.copy(_kThighDir).multiplyScalar(a).add(_kR);
  _kAlt.copy(_kDir).applyQuaternion(_kQ.setFromAxisAngle(_kAxis, -thighAngle)).multiplyScalar(a).add(_kR);
  if (_kAlt.distanceToSquared(_kM) < _kNewM.distanceToSquared(_kM)) { _kThighDir.copy(_kDir).applyQuaternion(_kQ.setFromAxisAngle(_kAxis, -thighAngle)); _kNewM.copy(_kAlt); }
  // (1) rotate the thigh so its bone vector maps to the desired thigh dir.
  _kThigh.normalize();
  _kQ.setFromUnitVectors(_kThigh, _kThighDir);
  _applyWorldDelta(R, _kQ, _kQw, _kQpar);
  // (2) re-read the (now-moved) knee + foot, then point the shin at the target.
  M.updateWorldMatrix(true, false); M.getWorldPosition(_kM);
  E.updateWorldMatrix(true, false); E.getWorldPosition(_kE);
  _kShin.subVectors(_kE, _kM); if (_kShin.lengthSq() < 1e-8) return;
  _kShinDir.set(tx - _kM.x, ty - _kM.y, tz - _kM.z); if (_kShinDir.lengthSq() < 1e-8) return;
  _kShinDir.normalize(); _kShin.normalize();
  _kQ.setFromUnitVectors(_kShin, _kShinDir);
  _applyWorldDelta(M, _kQ, _kQw, _kQpar);
}

export function createCharacterRig({ url, gltf, states, loopOnce, fade, extraClips = [],
  walkStride = 0, runStride = 0, strideMin = 0.4, strideMax = 2.4, locoEase = 10 } = {}) {
  const STATES = states || ZOMBIE_STATES;
  const LOOP_ONCE = loopOnce || ZOMBIE_LOOP_ONCE;
  const defaultFade = fade != null ? fade : 0.22;
  // A8-1 LOCOMOTION BLEND EASE — the rate (1/s) at which the blend scalar the weights read EASES toward the
  // speed the consumer sets. THE FLUIDITY FIX: setLocomotion(speed) can jump (the survivor stops dead, a
  // pooled zombie recycles) — feeding that raw into the idle/walk/run weight split POPS the blend on every
  // start/stop/direction change. Easing the SHOWN scalar makes every state-pair transition melt instead
  // (idle↔walk↔run all ride the one continuous scalar, so the ease covers every pair for free). ~10/s ≈ a
  // 0.1 s time-constant: still refaces a sprinting stop in a few frames, but never a single-frame snap.
  // Presentation-only (weights + playback rate; never the sim) and byte-safe for any consumer that never
  // calls setLocomotion (the city). C++ anchor: a critically-ish-damped low-pass on the gait parameter.
  const _locoEase = locoEase;
  // A6-2 STRIDE RATE — the reference world speed (m/s) at which each clip looks PLANTED at 1× (calibrated by
  // the slip probe). 0 = OFF → the rig keeps the old speed01 heuristic (byte-safe for any consumer that
  // doesn't opt in). When set AND the consumer passes a real world speed to setLocomotion, the walk/run
  // actions play at strideTimeScale(worldSpeed / refStride) so the feet grip instead of skating.
  const _walkStride = walkStride, _runStride = runStride || walkStride, _strideMin = strideMin, _strideMax = strideMax;
  let source = gltf || null;
  const recs = [];   // { mixer, rate, acc } per live character
  let _warnedRig = false;   // A9: warn once (not per-spawn) if the detected profile names a bone this rig lacks
  /* A-CENSUS (2026-08-20): warn ONCE PER RIG SOURCE if a consumer asks for the MEASURED ground floor on a
     skeleton that structurally cannot deliver one. Factory-scope like `_warnedRig` and for the same reason:
     a pooled horde spawns 96 handles off ONE createCharacterRig, and 96 identical warnings is noise nobody
     reads. One line per GLB is a finding. (See `_groundRep` in spawn() for what "cannot deliver" means.) */
  let _warnedGround = false;
  /* ── A-CLAMP (2026-08-21) THE SOLE MEASUREMENT, ONCE PER RIG SOURCE. `measureSoleBoxes` walks every
     vertex of the source's skinned meshes, so it is emphatically not a per-spawn cost: the AABBs are a
     property of the shared GEOMETRY and BIND POSE, which every SkeletonUtils clone inherits unchanged.
     Built LAZILY on the first `setGroundClamp` so a rig nobody clamps never pays for it at all (the city
     crowd, the pedestrians, every tier-guard path). Factory-scope warn-once for the same reason as
     `_warnedGround`: 96 pooled handles off one GLB must produce one line, not 96. */
  let _soleTable = null, _warnedClamp = false;
  const _soleTableOf = () => {
    if (!_soleTable) _soleTable = source ? measureSoleBoxes(source.scene, SOLE_BONE) : new Map();
    return _soleTable;
  };

  // A17 CUSTOM-CLIP SEAM (the asset-pipeline payoff). `extraClips` is a list of ADDITIONAL glTF sources
  // whose animation clips get merged into this rig's clip pool, so a Blender-authored clip (a clip we made
  // ourselves — no longer stuck with the handful a CC0 rig shipped, the A8 wall) plays through the SAME
  // setState/findClip path as any built-in state. Each entry is a URL string (loaded here) OR a pre-loaded
  // gltf-like ({ animations:[…] }, for tests). three binds a clip's tracks to the live skeleton BY NAME, so
  // a clip authored against this rig's real bone names just drops on (see docs/asset-pipeline.md + the
  // build_reach.py authoring convention). DEFAULT [] → the merge loop is a no-op → byte-identical to before.
  const _loader = (extraClips.length || !source) ? new GLTFLoader() : null;
  const _baseReady = source ? Promise.resolve(source) : _loader.loadAsync(url).then((g) => (source = g));
  const ready = _baseReady.then(async () => {
    for (const clip of extraClips) {
      const g = typeof clip === 'string' ? await _loader.loadAsync(clip) : clip;
      if (g && g.animations) for (const a of g.animations) source.animations.push(a);   // name-keyed → findClip picks it up
    }
    return source;
  });

  // Clip lookup that tolerates the two naming variants Blender/Quaternius export ('Idle' AND
  // 'CharacterArmature|Idle') — resolve by exact name, else by the '<armature>|<name>' suffix.
  function findClip(clipName) {
    const anims = source.animations;
    for (const c of anims) if (c.name === clipName) return c;
    for (const c of anims) if (c.name.endsWith('|' + clipName)) return c;
    return null;
  }

  function spawn(o = {}) {
    if (!source) throw new Error('[M1a] rig not ready — await rig.ready before spawn()');
    const object = cloneSkinned(source.scene);              // own skeleton, shared geometry/material
    object.traverse((n) => { if (n.isMesh) { n.castShadow = o.castShadow !== false; n.frustumCulled = false; } });
    const mixer = new THREE.AnimationMixer(object);
    const sm = createAnimStateMachine({ clips: STATES, loopOnce: LOOP_ONCE });
    const actions = {};                                     // clipName -> AnimationAction (built lazily)
    function actionFor(clipName) {
      if (actions[clipName]) return actions[clipName];
      const clip = findClip(clipName);
      if (!clip) return null;
      const a = mixer.clipAction(clip);
      actions[clipName] = a;
      return a;
    }
    let current = null;
    const rec = { mixer, rate: 0, acc: 0, applyLayers: null };  // rate 0 = every frame (M1b sets a LOD rate)
    recs.push(rec);

    // ---- procedural layer bones + state (resolved from the cloned skeleton by name; missing bones just
    // make the corresponding layer a no-op — a non-Quaternius rig degrades gracefully) ----
    const bones = {};
    object.traverse((n) => { if (n.isBone && !bones[n.name]) bones[n.name] = n; });
    // A9 RIG ADAPTER — resolve the procedural-layer bones through the canonical bone-map (character-rig-
    // profiles.js) instead of inline `||` fallback chains. It detects the skeleton's exporter PROFILE (the
    // survivor is mixamo: Spine2/LeftArm/LeftFoot; the Quaternius zombie is Torso/UpperArmL/FootL — the two
    // families whose name mismatch made the A5→A8 lunge + hit-react SILENT NO-OPS: boneSpine resolved null
    // → the whole block skipped) and maps both onto ONE canonical role set. The node red-test
    // (character-rig-profiles.test.mjs) fails if any layer a consumer drives targets a role its rig can't
    // provide, so that silent-no-op class can't be reintroduced. A rig matching NEITHER profile still degrades
    // to null bones (no-op) — but LOUDLY: a detected profile that names an absent bone warns once (Rule 12).
    // C++ anchor: an alias table (the profile) papering over two exporters' skeleton conventions.
    const _rig = resolveRig(bones);
    if (_rig.missing.length && !_warnedRig) { _warnedRig = true; console.warn(`[rig] profile '${_rig.profile && _rig.profile.id}' names bone(s) this skeleton lacks: ${_rig.missing.join(', ')} — those layers will no-op`); }
    const B = _rig.bones;   // canonical role → Bone|null (head/neck/spine/armL/armR/foreArmR/footL/footR/hips)
    const boneHead = B.head, boneNeck = B.neck;
    const boneSpine = B.spine;
    const boneArmL = B.armL, boneArmR = B.armR;
    let lookTarget = null;             // {x,y,z} or null (null = no head-look → layer idle, zero cost)
    let headYaw = 0;                   // the smoothed applied head-turn (rad), eased toward the desired
    let flinchT = -1, flinchSign = 0;  // hit-react timer (-1 = inactive) + which side the hit came from
    let recoilT = -1, swingT = -1, lungeT = -1, reloadT = -1;  // B4 recoil + melee-swing + A5 zombie-lunge + A8-3 reload-dip impulse timers (-1 = inactive)
    // A1 LOCOMOTION BLEND — idle/walk/run play SIMULTANEOUSLY, weights from a speed param (not state snaps);
    // one-shot actions (attack/hit/death) fade OVER the blend and restore it when the clip clamps. Legs keep
    // walking under the aim layer. All the per-frame weight work lives in _applyLayers (one place, gets dt).
    const locoActions = {};            // 'idle'/'walk'/'run' → AnimationAction (built lazily on first setLocomotion)
    let _locoOn = false, _locoSpeed = 0, _locoShown = 0, _worldSpeed = null;   // speed01 ∈ [0,1]; _locoShown = the A8-1 EASED scalar the weights read; _worldSpeed = real m/s (A6-2 stride-rate) or null
    let _actAction = null, _actClip = null, _actActive = false, _actW = 0;   // the one-shot overlay
    // ── A-BODY POSE HOLD (2026-08-13) — a clip FROZEN at one time, used as a pose. See poseHold().
    let _poseAction = null, _poseClip = null, _poseWant = 0, _poseW = 0;
    let _headingTarget = null;         // A1: smoothed body yaw (rad) or null (caller sets the yaw directly)
    const boneArmForeR = B.foreArmR;          // A1 aim-IK: the forearm (gun end of the chain; canonical foreArmR)
    let aimTarget = null, aimW = 0, _aimActive = false;       // A1 aim-IK: {x,y,z} to track + a blend weight
    let _idleRelax = false, _relaxW = 0, _relaxClock = 0;     // A2 idle-relax: opt-in softening of a braced idle
    const boneArmL2 = B.armL;                  // A2 idle-relax: the off-hand arm to lower (canonical left arm)
    // ── A7-2 FOOT IK state (opt-in via setFootIK; resolved once). plant-and-hold: each frame the LOWER foot
    // (the support) locks its world pos when near the ground; while locked, the foot bone's transform is
    // overridden to HOLD that world pos while the hips move over → the planted foot stops skating. Feet resolve
    // by the Quaternius (Foot.L → sanitised FootL) AND mixamo (LeftFoot) name families. `_footIK` null = off.
    let _footIK = null, _footIKActive = true, _ikFloorY = null;
    /* ── A-CENSUS (2026-08-20) THE MEASURED FLOOR'S RECEIPT — because "wired" is not "running". -----
       An independent refutation of arc A-GROUND established that hoard2 could report `surfaceProbedCount
       96/96` — every pooled zombie holding a probe, the config accepted, `groundProbe:true` honoured — while
       ZERO of them ever took the measured path. The Quaternius zombie is a FLAT rig (`articulated=false`,
       see `_legChain` below); `_chainLenOf` hard-returns 0 for a non-articulated chain; and the measured
       branch in _applyLayers is gated `L > 0`. So the ability was STRUCTURALLY UNREACHABLE for that rig
       and said nothing about it — the failure was invisible to every instrument pointed at it, and only a
       refutation reading the source found it. That is the exact shape CLAUDE.md rule 12 forbids.
       THIS OBJECT IS THE CURE, and it separates three things a single boolean was conflating:
         requested — the consumer asked for a measured floor (`setFootIK({groundProbe:true})`)
         probed    — a surface probe actually arrived (`setSurfaceProbe`)
         reachable — this SKELETON can take the measured branch at all. TOPOLOGY, decided once from the
                     leg chains: the branch needs a chain length, `_chainLenOf` gives one only for an
                     ARTICULATED chain, so a flat rig is `false` here forever and no amount of correct
                     wiring will change it. This is the term the refutation had to reverse-engineer.
         frames / measuredFrames — the RUNTIME truth, and the one that cannot be argued with: how many
                     frames the foot-IK block ran, and how many of those produced a measured floor.
                     `reachable:true, measuredFrames:0` is a real state (a degenerate-length chain, or a
                     probe that reports clear everywhere) and it should look as alarming as it is.
       It is a plain data receipt with no side effects, so a rig that nobody asks about is byte-identical:
       one small object per handle (like `_contactRep`), two integer increments inside an already-gated
       block, no allocation per frame. C++ anchor: an out-param status struct on an API that used to
       return void — the caller can now tell "did nothing" from "could never have done anything". */
    const _groundRep = { requested: false, probed: false, reachable: false, ok: false, measured: false, frames: 0, measuredFrames: 0, reason: 'not-requested' };
    /* ── A-CLAMP (2026-08-21) GROUND-CLAMP state. See ground-clamp.js for the mechanism and for the two
       prior measurements that ruled out the cheaper answers. Everything here is presentation: `_clampHeld`
       is a Y OFFSET applied to `object.position` after the consumer has placed the body, and it is
       re-derived from scratch every frame — the sim's own position is never read back or written.
       `_clampBaseY`/`_clampWroteY` are how the offset stays idempotent WITHOUT assuming the consumer
       places the body before or after this runs: if `position.y` is still exactly what we last wrote,
       nobody has moved the body and the remembered base is authoritative; if it differs, the consumer
       has re-placed it and that new value IS the base. Both call orders are therefore correct, and the
       broken order (a consumer that overwrites us every frame) shows up as a clamp with no visible
       effect — loud in the census, never a silent drift. */
    /* `want` vs `lift` is the receipt's whole point and the pair a bob/float probe reads: `want` is what
       THIS frame's pose requires (measured against a body carrying no offset), `lift` is what the envelope
       is actually holding. `lift - want` is the FLOAT — how far the body is above the minimum right now,
       which is the measured cost of not bobbing. Neither can be inferred from the other. */
    const _clampRep = { requested: false, boxes: 0, ok: false, frames: 0, clampedFrames: 0, want: 0, lift: 0, liftMax: 0, gen: 0, reason: 'not-requested' };
    let _clamp = null, _clampBoxes = null, _clampHeld = 0, _clampBaseY = 0, _clampWroteY = NaN;
    /* Put the body back where the consumer put it. Only if OUR value is still standing — if the consumer
       has re-placed the body since, that placement wins and there is nothing to undo. Called on disable
       and on pool recycle, so a slot never inherits the previous occupant's lift. */
    function _clampRelease() {
      if (object.position.y === _clampWroteY) object.position.y = _clampBaseY;
      _clampHeld = 0; _clampWroteY = NaN; _clampRep.lift = 0;
      /* `gen` bumps on every release, so a probe reading this slot over time can tell a RECYCLE (a new
         occupant starting from zero) from a real downward move. Without it the only signature is "lift
         hit 0", which is ALSO what a fast-release tuning does legitimately — and a probe that guessed
         from that split its series at the wrong places and under-reported the very pump it exists to
         catch. Measured: 53 phantom recycles in one 240-frame red-arm run. */
      _clampRep.gen++;
    }
    const _ikHips = B.hips;   // body-travel reference for the over-reach release (canonical hips)
    // A8-2 KNEE-FOLLOW — resolve each leg's CHAIN (foot ← knee ← upper-leg). If the foot has a real knee +
    // thigh above it (an ARTICULATED biped like the survivor's LeftFoot→LeftLeg→LeftUpLeg), the plant re-solves
    // the two upper bones to REACH the locked target with bone lengths PRESERVED (a two-bone IK) instead of
    // shoving the foot bone's local offset — which on a proper chain stretches the shin like a rubber band
    // (MEASURED +346% before this). On a FLAT rig (the Quaternius zombie, Foot→Root) there is no shin to
    // stretch, so it keeps the topology-agnostic position override (articulated=false → the A7-2 path).
    const _legChain = (foot) => {
      const knee = foot && foot.parent && foot.parent.isBone ? foot.parent : null;
      const upleg = knee && knee.parent && knee.parent.isBone ? knee.parent : null;
      const articulated = !!(knee && upleg && knee !== _ikHips && upleg !== _ikHips && knee !== foot && upleg !== knee);
      return { foot, knee, upleg, articulated, lockOn: false, lx: 0, ly: 0, lz: 0, w: 0, fx: 0, fy: 0, fz: 0, clen: 0 };
    };
    const _ikLegL = _legChain(B.footL);   // canonical footL (Quaternius FootL / mixamo LeftFoot)
    const _ikLegR = _legChain(B.footR);   // canonical footR
    // both feet must resolve (+ have a parent to convert against) or the rig isn't one we can plant → no-op.
    const _ikLegs = (_ikLegL.foot && _ikLegL.foot.parent && _ikLegR.foot && _ikLegR.foot.parent) ? [_ikLegL, _ikLegR] : null;
    /* A-CENSUS: decide `reachable` HERE, from topology, and never call `_chainLenOf` to do it. That
       function CACHES its answer on the chain (`ch.clen`) and the cache is read by the air/crawl layers,
       which measure in chain-lengths — calling it before the consumer has settled the object's SCALE
       (the horde sets baseScale at spawn, createHeroBody scales to the level's height) would freeze a
       wrong length into a layer this arc never touched. `articulated` is the same predicate `_chainLenOf`
       tests first and it is scale-independent, so the topology question is answered without the
       measurement. The runtime counters below are what catch the residue (a chain that IS articulated but
       measures degenerate still reports measuredFrames 0). */
    const _groundReachable = !_ikLegs ? false : !!(_ikLegL.articulated || _ikLegR.articulated);
    _groundRep.reachable = _groundReachable;
    if (!_ikLegs) _groundRep.reason = 'no-leg-chains — this skeleton has no resolvable foot+parent pair, so foot IK itself is a no-op';
    else if (!_groundReachable) _groundRep.reason = 'flat-rig — neither leg is an ARTICULATED foot←knee←thigh chain, so _chainLenOf returns 0 and the measured branch (gated L > 0) can never run';
    /* `ok` = the one question a caller actually asked ("will I get a measured floor?"), recomputed on every
       state change so the receipt is never stale between the two setters that populate it. Both halves are
       required by _applyLayers (`_footIK.groundProbe && _surfaceProbe`) and the skeleton has a veto. */
    function _groundOk() {
      _groundRep.ok = _groundRep.requested && _groundRep.probed && _groundRep.reachable;
      if (_groundRep.ok) _groundRep.reason = 'ok — requested, probed, and this skeleton can take the measured branch';
      else if (_groundRep.requested && !_groundRep.probed && _groundRep.reachable) _groundRep.reason = 'no-probe — groundProbe:true was accepted but setSurfaceProbe never arrived, so the floor stays INFERRED';
      else if (!_groundRep.requested && _groundRep.reachable) _groundRep.reason = 'not-requested';
      return _groundRep;
    }
    /* ── A-AIR (2026-08-15) AIRBORNE MOTION LAYER state. See hero-air.js for the curves and for the
       measurement that chose a procedural layer over an authored clip on this rig.
       THE LEGS COME FROM THE FOOT-IK CHAIN, deliberately, rather than from two new canonical roles:
       `_legChain` already walks foot → knee → upper-leg and already flags `articulated`, and it already
       degrades correctly on the FLAT Quaternius skeleton (Foot→Root, no thigh to rotate) — which is the
       exact graceful-no-op the rig-profile adapter exists to guarantee. Adding roles a shipped rig
       cannot provide would make `resolveRig` warn on every zombie spawn for a layer zombies never run.
       `_airCur` is the EASED pose actually in force and `_airWant` the target: easing the ANGLES as well
       as the weight means a jump→fall switch (which happens in one frame, at the apex) melts instead of
       snapping, with no per-transition bookkeeping — the same trick A8-1 used on the gait scalar. */
    let _airMode = null, _airW = 0, _airWant01 = 0, _airT = 0, _airVy = 0, _airVRef = 1, _airClimb = 0;
    const _airCur = makeAirPose(), _airWant = makeAirPose();
    const _airLegL = _ikLegL, _airLegR = _ikLegR;   // same chains; the air layer only ROTATES them
    /* ── A-CRAWL (2026-08-19) WALL-CONTACT state. The cling stops waving NEAR the wall and puts its
       hands and feet ON it: while `setAirMotion` reports mode 'cling' with a wall plane, the pass at
       the tail of _applyLayers solves each limb chain (the SAME `_solveTwoBone` the foot-lock trusts)
       to a target on that plane, gaited by the distance-locked crawl phase (hero-air.js CRAWL).
       THE ARM CHAINS ARE WALKED DOWN FROM THE CANONICAL UPPER ARMS (armL/armR → first Bone child →
       its first Bone child = shoulder→forearm→wrist), the mirror of how `_legChain` walks UP from the
       feet — and for the same doctrinal reason (see LAYER_BONES.air in character-rig-profiles.js): a
       canonical 'hand' role would make resolveRig warn on every rig that lacks one for a layer it
       never runs. A chain that does not resolve is a graceful no-op limb, exactly like the flat legs.
       `_airPhase` is the crawl gait's signed phase (radians; integrated from vy so it stops when the
       body hangs and runs backwards on a descent) · `_airClimbEase` the eased |climb| that settles
       lifted limbs back onto the plane when the climb stops · `_contactW` the pass's own eased weight
       (in fast — a grab is a beat; out FASTER — a wall-jump must not leave hands pinned to a wall the
       body has already left) · `_contactRep` the live receipt a probe/HUD reads: each end joint's
       measured distance OFF the plane this frame (u; -1 = that limb has no articulated chain). */
    const _armChainOf = (arm) => {
      const fore = arm ? arm.children.find((c) => c.isBone) : null;
      const hand = fore ? fore.children.find((c) => c.isBone) : null;
      return { foot: hand || null, knee: fore || null, upleg: arm || null, articulated: !!(arm && fore && hand), clen: 0 };
    };
    const _airArmL = _armChainOf(B.armL), _airArmR = _armChainOf(B.armR);
    /* ── A-WHIP (2026-08-19) MOUNT-IK state. The RIDER'S version of the crawl's wall contact: a
       seated body on a vehicle pins hands to GRIP sockets and feet to PEG sockets — world-space
       target NODES the consumer hands over once (setMountIK), typically empties exported inside
       the vehicle's own GLB (build_moto_bike.py's bike_grip_l/r under the forks — so the hands
       ride the STEERING by scene-graph parenting, no per-frame math here at all — and
       bike_peg_l/r under the body). Same four limb chains the crawl already walks, the same
       analytic `_solveTwoBone`, the same lerp-from-current-end blend; `_mountRep` is the live
       receipt (end joint's distance to its socket AFTER the solve — the number the ledger's
       hands-ON-grips claim quotes; -1 = no chain/no target). Zero cost when never enabled. */
    let _mountIK = null, _mountW = 0;
    const _mountRep = { active: false, w: 0, handL: -1, handR: -1, footL: -1, footR: -1 };
    const _mountLimbs = [
      { key: 'handL', ch: _airArmL }, { key: 'handR', ch: _airArmR },
      { key: 'footL', ch: _ikLegL }, { key: 'footR', ch: _ikLegR },
    ];
    let _airPhase = 0, _airClimbEase = 0, _contactW = 0;
    let _airWallOn = false, _airWallNx = 0, _airWallNz = 0, _airWallPx = 0, _airWallPz = 0;
    const _crawlOff = { u: 0, lift: 0 };            // crawlLimb's out-param (spawn-owned, zero-alloc per frame)
    /* A-CONTACT (2026-08-20): THE SURFACE PROBE — the world query that ends the trusted-plane bug.
       `segmentHit(ox,oy,oz, ex,ey,ez, r)`, the house world-bag seam (see contact.js for the full
       argument and the measured 0.0710 u the plane was wrong by). Null → every limb keeps its guessed
       plane target, i.e. EXACTLY A-CRAWL's shipped behaviour, so a consumer that never wires a world
       is byte-identical to before this arc. `_contactRep.snap` is the new receipt: how far the probe
       had to MOVE the guess, which is the number that would have caught A-CRAWL's blind spot. */
    let _surfaceProbe = null;
    const _contactRep = { active: false, w: 0, handL: -1, handR: -1, footL: -1, footR: -1, snap: 0, probed: false, released: 0 };
    const _crawlLimbs = [
      { ch: _airArmL, hand: true, off: CRAWL_PHASE[0], key: 'handL' },
      { ch: _airArmR, hand: true, off: CRAWL_PHASE[1], key: 'handR' },
      { ch: _airLegL, hand: false, off: CRAWL_PHASE[2], key: 'footL' },
      { ch: _airLegR, hand: false, off: CRAWL_PHASE[3], key: 'footR' },
    ];
    const lp = {
      headLook: { ...LAYER_DEFAULTS.headLook }, hitReact: { ...LAYER_DEFAULTS.hitReact },
      recoil: { ...LAYER_DEFAULTS.recoil }, swing: { ...LAYER_DEFAULTS.swing }, lunge: { ...LAYER_DEFAULTS.lunge },
      reload: { ...LAYER_DEFAULTS.reload },
    };

    const handle = {
      object,
      position: object.position, quaternion: object.quaternion, scale: object.scale,
      get state() { return sm.current; },
      // A8-1: read-only snapshot of the locomotion blend — the eased SHOWN scalar + the three actions'
      // effective weights. Presentation-only; used by the transition probe to prove the blend has no
      // single-frame pop (a snap would spike a weight's per-frame delta toward 1). Cheap, allocates one object.
      get locoBlend() {
        return { shown: +_locoShown.toFixed(4), speed: +_locoSpeed.toFixed(4),
          idle: locoActions.idle ? +locoActions.idle.getEffectiveWeight().toFixed(4) : 0,
          walk: locoActions.walk ? +locoActions.walk.getEffectiveWeight().toFixed(4) : 0,
          run: locoActions.run ? +locoActions.run.getEffectiveWeight().toFixed(4) : 0 };
      },
      // ---- B3 procedural-layer API (all opt-in; unused → the layer pass is a no-op) ----
      setLookTarget(x, y, z) { if (!lookTarget) lookTarget = { x: 0, y: 0, z: 0 }; lookTarget.x = x; lookTarget.y = y; lookTarget.z = z; },
      clearLookTarget() { lookTarget = null; },
      hitReact(dx = 0, dz = 0) {
        flinchT = 0;                                    // (re)start the impulse
        _eu.setFromQuaternion(object.quaternion, 'YXZ');
        const cy = _eu.y, side = Math.cos(cy) * dx - Math.sin(cy) * dz;  // >0 = hit came from the right
        flinchSign = side >= 0 ? 1 : -1;
      },
      setLayerParams(p = {}) { if (p.headLook) Object.assign(lp.headLook, p.headLook); if (p.hitReact) Object.assign(lp.hitReact, p.hitReact); if (p.recoil) Object.assign(lp.recoil, p.recoil); if (p.swing) Object.assign(lp.swing, p.swing); if (p.lunge) Object.assign(lp.lunge, p.lunge); if (p.reload) Object.assign(lp.reload, p.reload); },
      recoil() { recoilT = 0; },        // B4: fire kick (gun-arm snap-back)
      meleeSwing() { swingT = 0; },     // B4: melee arc (gun-arm forward swing)
      lunge() { lungeT = 0; },          // A5: zombie attack — a forward upper-body lunge + head thrust
      reloadBeat() { reloadT = 0; },    // A8-3: reload dip — gun-arm drops off aim, off-hand racks, then ready
      get reloading() { return reloadT >= 0; },   // A8-3: so the consumer can gate the aim layer during the dip
      reloadDur() { return lp.reload.dur; },
      // A1 LOCOMOTION: drive idle/walk/run by a continuous speed (0..1). Builds the 3 actions once (all
      // playing at weight 0; the per-frame blend is in _applyLayers). Supersedes setState for locomotion.
      setLocomotion(speed01, worldSpeed = null) {
        _locoSpeed = speed01 < 0 ? 0 : speed01 > 1 ? 1 : speed01;
        _worldSpeed = worldSpeed;   // A6-2: real m/s for stride-rate (null → keep the speed01 heuristic)
        if (!_locoOn) {
          for (const key of ['idle', 'walk', 'run']) {
            const clip = findClip(STATES[key]); if (!clip) continue;
            const a = mixer.clipAction(clip); a.setLoop(THREE.LoopRepeat, Infinity); a.enabled = true; a.reset().setEffectiveWeight(0).play();
            locoActions[key] = a;
          }
          if (current) { current.fadeOut(0.2); current = null; }  // release any prior single-clip state
          sm.reset();
          _locoOn = true;
        }
      },
      // A1: play a one-shot (attack/hit/death) OVER the locomotion blend; it fades in, plays once, and the
      // blend restores when it clamps. Use this instead of setState once setLocomotion is driving the legs.
      // A8-4: `timeScale` plays the clip faster/slower (per-type attack/death variety — a runner strikes fast,
      // a tank ponderously; the clamp detector reads action.time so it still fires at any rate).
      playAction(name, timeScale = 1) {
        const clip = findClip(STATES[name]); if (!clip) return;
        const a = mixer.clipAction(clip);
        a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true;
        a.reset().setEffectiveTimeScale(timeScale).setEffectiveWeight(_actW).play();
        _actAction = a; _actClip = clip; _actActive = true;
      },
      // ── A-BODY POSE HOLD — freeze a clip at a FIXED normalised time and BLEND it over the locomotion
      // blend, as a POSE rather than a motion. This is the seam that lets a rig express states its GLB has
      // no clip for, without faking a clip: the shipped survivor.glb ships Idle/Walk/Run/Jump/Punch/Death/
      // Working and NOTHING for falling, swinging or clinging to a wall — but its Jump clip passes through
      // a genuine airborne pose on the way, so holding that one frame is a real airborne body rather than a
      // walk cycle playing in mid-air. (Stated plainly, per Rule 12: this is a POSE, not an animation. A
      // held frame does not breathe. An authored clip is strictly better and is the follow-up work.)
      //   name   — a key of STATES (resolved through the same findClip path as every other state)
      //   t01    — WHERE in the clip to freeze, 0..1 of its duration
      //   weight — 0..1; 0 releases the hold and the locomotion blend fades back in
      // The action is `paused`, so the mixer evaluates it at its pinned time and never advances it; setting
      // .time each call means the pose is a pure function of the argument (no drift, no accumulated state).
      // C++ anchor: sampling one keyframe out of a track and blending it in as a static pose — a lerp
      // target, not a playhead.
      poseHold(name, t01 = 0, weight = 1) {
        if (!name || !(weight > 0)) { _poseWant = 0; return; }
        const clipName = STATES[name]; if (!clipName) { _poseWant = 0; return; }
        const clip = findClip(clipName); if (!clip) { _poseWant = 0; return; }   // absent clip → no-op, never a throw
        if (_poseClip !== clip) {
          if (_poseAction) _poseAction.stop();
          _poseAction = mixer.clipAction(clip);
          _poseAction.setLoop(THREE.LoopRepeat, Infinity);
          _poseAction.enabled = true; _poseAction.clampWhenFinished = false;
          _poseAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(_poseW).play();
          _poseClip = clip;
        }
        _poseAction.paused = true;
        const u = t01 < 0 ? 0 : t01 > 1 ? 1 : t01;
        _poseAction.time = clip.duration * u;
        _poseWant = weight > 1 ? 1 : weight;
      },
      get poseWeight() { return _poseW; },   // the EASED weight actually in force (probe/HUD receipt)
      /* ── A-AIR AIRBORNE MOTION — make a held air pose BREATHE, and give a cling a second arm.
         `poseHold` above can only ever hand you a STILL, because survivor.glb has no fall/swing/cling
         clip to play; this composes live motion on top of that still, driven by the physics the body is
         actually in. One call per frame, exactly like setLocomotion:
           mode  — 'jump' | 'fall' | 'swing' | 'cling', or null to release (the layer eases out to zero)
           vy    — the body's vertical world speed; the sign and magnitude ARE the animation (tuck on the
                   way up, spread on the way down, legs pumping the pendulum on a swing)
           vRef  — the speed at which that shape is fully expressed, in the caller's world units/second
           climb — SIGNED since A-CRAWL: -1..1, how hard a clinging body is climbing and which way
                   (+ up, − down). |climb| scales the four-limb cycle; the sign runs the crawl phase
                   forwards or backwards, so a descent is the same gait played in reverse.
           wall  — A-CRAWL, cling only: { nx, nz, px, pz } = the wall's outward unit normal (horizontal)
                   and a world point ON the plane. With it the contact pass pins hands and feet to that
                   plane; without it the cling stays the additive-only splay (the graceful degrade for a
                   consumer whose controller does not publish its cling ray).
         DEFAULT OFF AND EXACTLY NO-OP: a consumer that never calls this leaves `_airMode` null, `_airW`
         at 0, and the whole block below is one `if` that fails. The horde, the city crowd and hoard2 are
         byte-identical (`npm run tier-guard` is the check that says so, not this comment). */
      setAirMotion(mode, { vy = 0, vRef = 1, climb = 0, wall = null } = {}) {
        _airMode = mode || null;
        _airWant01 = _airMode ? 1 : 0;
        _airVy = vy; _airVRef = vRef;
        _airClimb = climb < -1 ? -1 : climb > 1 ? 1 : climb;
        _airWallOn = !!(_airMode === 'cling' && wall && wall.nx != null && wall.nz != null);
        if (_airWallOn) {
          // kept as the LAST wall while the contact weight eases out, so a wall-jump's release eases
          // AWAY FROM the plane it left instead of toward a zeroed one at the origin.
          _airWallNx = wall.nx; _airWallNz = wall.nz;
          _airWallPx = wall.px || 0; _airWallPz = wall.pz || 0;
        }
      },
      get airWeight() { return _airW; },      // the EASED weight in force — a probe/HUD receipt, not a flag
      get airMode() { return _airMode; },
      // A-CRAWL receipts. `airPhase` proves the gait is distance-locked (still while hanging, negative
      // rate on a descent); `contactReport` is the money number — each end joint's measured distance
      // off the wall plane, LIVE (read-only by contract; the layer rewrites it every contact frame).
      get airPhase() { return _airPhase; },
      get contactReport() { return _contactRep; },
      /* ── A-CONTACT (2026-08-20): THE NAMED CONTACT ABILITY — "here is the world; put the limbs on it".
         THE API, and the whole point of the lift: a surface QUERY in, planted limbs out. Every contact
         pass in this rig (the crawl's wall, and `groundContact` below) resolves its targets against
         this one probe, so "hands on a wall" and "feet on a floor" are one ability with one receipt
         rather than two implementations that drift apart.
           probe — `segmentHit(ox,oy,oz, ex,ey,ez, r) -> t∈[0,1]` (1 = clear), i.e. the world bag every
                   project already owns (`arena.world.segmentHit`, `city.world.segmentHit`). Called
                   with r = 0, because the inflated radius IS the bug this arc measured (contact.js).
           null  — release: every limb goes back to trusting its caller's plane, which is A-CRAWL's
                   exact shipped behaviour. A consumer that never calls this is byte-identical to
                   before this arc, which is what makes the lift safe for the horde/crowd paths.
         WHY IT LIVES ON THE RIG rather than in each project: engine-first (CLAUDE.md) — the ability is
         the reusable thing, the world bag is the project's content. hoard/hoard2 inherit it by passing
         their own `groundAt`-backed probe; nothing about this signature is wall-specific. */
      setSurfaceProbe(probe) { _surfaceProbe = typeof probe === 'function' ? probe : null; _groundRep.probed = !!_surfaceProbe; _groundOk(); },
      get surfaceProbed() { return !!_surfaceProbe; },
      /* A-CENSUS: the measured floor's live receipt (see `_groundRep`). Read it instead of inferring the
         ability's health from moved feet — `setFootIK` alone moves feet, so the observable cannot separate
         "the measured floor is running" from "the inferred one is, and the probe is decoration". */
      get groundReport() { return _groundRep; },
      /* ── A-CLAMP (2026-08-21) THE GROUND CLAMP — "this character may not have geometry below the floor".
         A DIFFERENT MECHANISM FROM setFootIK, deliberately and separately switched. The foot lock's only
         ground term is a plant THRESHOLD, so it decides WHEN a foot plants and never WHERE (measured:
         turning it on took the hoard2 census from 21/35 sunk to 22/35). This lifts the BODY instead, by the
         minimum that clears the floor, off the SOLE GEOMETRY rather than the foot bone — the Quaternius
         zombie has no toe bone, so a bone-driven clamp would report success on the very class the bug is
         about. See ground-clamp.js for the full argument.
           cfg.groundAt — (x,z) -> floor Y. REQUIRED: without a floor authority there is nothing to clamp to.
           cfg.release / maxLift / standoff — override GROUND_CLAMP (see there; `release` is the bob budget).
           cfg.soleBone — override the sole-bone predicate (default /foot|toe/i).
           false / null — off. The body is left exactly where the consumer put it (pre-arc behaviour).
         Returns the receipt, for the same reason setFootIK does: A-CENSUS's lesson is that a capability
         which is accepted, wired, and structurally unable to run must SAY SO rather than sit under a green
         verdict. Here that state is `boxes: 0` — a rig whose skinned geometry has no sole bone to measure. */
      setGroundClamp(cfg) {
        if (!cfg) { _clamp = null; _clampBoxes = null; _clampRep.requested = false; _clampRep.ok = false; _clampRep.reason = 'not-requested'; _clampRelease(); return _clampRep; }
        const table = _soleTableOf();
        _clampBoxes = bindSoleBoxes(object, table);
        _clamp = { groundAt: typeof cfg.groundAt === 'function' ? cfg.groundAt : null,
          release: cfg.release != null ? cfg.release : GROUND_CLAMP.release,
          maxLift: cfg.maxLift != null ? cfg.maxLift : GROUND_CLAMP.maxLift,
          standoff: cfg.standoff != null ? cfg.standoff : GROUND_CLAMP.standoff };
        _clampRep.requested = true;
        _clampRep.boxes = _clampBoxes.length;
        _clampRep.ok = !!_clamp.groundAt && _clampBoxes.length > 0;
        _clampRep.reason = _clampRep.ok ? 'ok — a floor authority and measured sole geometry'
          : !_clamp.groundAt ? 'no-ground — setGroundClamp was called without a groundAt(x,z), so there is no floor to clamp to'
            : 'no-sole-geometry — no skinned vertex on this rig is dominated by a bone matching the sole predicate, so the clamp has nothing to measure';
        /* THE FAIL-LOUD MOMENT, and it is the one A-CENSUS had to retrofit onto the measured floor. Once
           per rig SOURCE (96 pooled handles share one GLB), never per spawn. */
        if (!_clampRep.ok && !_warnedClamp) {
          _warnedClamp = true;
          console.warn(`[character-rig] ${url || 'gltf'}: setGroundClamp() was accepted but the clamp CANNOT RUN: ${_clampRep.reason}. Bodies will keep whatever Y the consumer places them at, including below the floor. Read handle.groundClampReport / horde.groundClampReport — a wired clamp is not a running one.`);
        }
        return _clampRep;
      },
      /* THE PER-FRAME STEP, and it is deliberately NOT inside _applyLayers. The layer pass is gated twice —
         by the horde's `motionLayers` (OFF on mobile, where the owner actually playtests) and by its LOD
         accumulator (far rigs step at lodHz, ~3 Hz) — while the consumer re-places the body EVERY frame. A
         clamp riding that gate would be wiped and re-applied at 3 Hz, i.e. it would itself become a 3 Hz
         bob, and would not exist at all on a phone. So the horde/consumer calls this every frame for every
         active character, and the clamp is independent of the motion-layer budget by construction.
         Cost: 8 corner transforms per sole box (~4 boxes on the shipped rigs) + one groundAt per corner. */
      groundClampStep(dt) {
        if (!_clamp || !_clamp.groundAt || !_clampBoxes || !_clampBoxes.length) return 0;
        // Recover the consumer's own Y (see the `_clampBaseY` note in the state block) — order-agnostic.
        const cur = object.position.y;
        _clampBaseY = (cur === _clampWroteY) ? _clampBaseY : cur;
        // …then measure against a body that carries NO clamp offset, so the requirement is absolute rather
        // than a correction to a correction. (Restored below either way; nothing renders in between.)
        object.position.y = _clampBaseY;
        const want = soleLift(_clampBoxes, _clamp.groundAt, _gcV, _clamp.standoff);
        _clampHeld = clampEnvelope(_clampHeld, want, dt > 0 ? dt : 0, _clamp);
        /* The write. No explicit updateMatrixWorld: `updateMatrix()` (run during the measurement above, as
           a parent walk) already left `matrixWorldNeedsUpdate` true, so the renderer's own
           `scene.updateMatrixWorld()` recomposes this node from the NEW position and force-propagates to
           every bone before the skeleton is uploaded. Forcing a subtree walk here would re-do ~50 bone
           matrices per character per frame for nothing. */
        object.position.y = _clampWroteY = _clampBaseY + _clampHeld;
        _clampRep.frames++;
        _clampRep.want = want; _clampRep.lift = _clampHeld;
        if (_clampHeld > 0) _clampRep.clampedFrames++;
        if (_clampHeld > _clampRep.liftMax) _clampRep.liftMax = _clampHeld;
        return _clampHeld;
      },
      get groundClampReport() { return _clampRep; },
      /* ── A-WHIP MOUNT-IK: pin hands/feet to a vehicle's socket NODES (see the state block).
         cfg = { handL, handR, footL, footR } — each a THREE.Object3D whose world position is the
         JOINT target (read live every frame, so steering forks carry the grips and the hands
         follow for free), or absent/null to leave that limb on the clip pose. Pass null/false to
         release (eases out 9/s — dismounting melts, never pops). Opt-in and exactly no-op when
         never called — the horde/city/crowd paths are byte-identical (tier-guard's claim). */
      setMountIK(cfg) {
        if (!cfg) { _mountIK = null; return; }
        _mountIK = { handL: cfg.handL || null, handR: cfg.handR || null, footL: cfg.footL || null, footR: cfg.footR || null };
      },
      get mountReport() { return _mountRep; },
      // A1: a SMOOTHED body heading (slerped in _applyLayers) — the caller passes the target yaw instead of
      // snapping object.rotation.y, so turns read smooth. Pass null to go back to caller-driven yaw.
      setHeading(yaw) { _headingTarget = yaw; },
      // A1 AIM-IK: the world point the gun should track (iso: the aim/target). null → the arm relaxes back to
      // the clip pose (aimW eases to 0). Distant characters: the caller clears this (skip the solver).
      setAim(t) { if (t == null) { _aimActive = false; return; } if (!aimTarget) aimTarget = { x: 0, y: 0, z: 0 }; aimTarget.x = t.x; aimTarget.y = t.y; aimTarget.z = t.z; _aimActive = true; },
      // A2: opt in to the idle-relax layer (softens a braced 'lunge' idle → a settled stand + slow sway when
      // truly idle). The survivor enables it; zombies stay braced/menacing (default off).
      setIdleRelax(on) { _idleRelax = !!on; },
      // A7-2 FOOT IK: pass a config to ENABLE plant-and-hold (or false to disable → feet follow the clip). cfg:
      //   plantBand — metres above the tracked contact floor a foot must be within to count as planted (0.14)
      //   lockRate/unlockRate — damp rates easing the hold weight in/out (18 / 12)
      //   maxStride — metres the hips may travel past a locked foot before it releases to take a step (0.55)
      // Opt-in: a rig whose consumer never calls this keeps the pure clip pose (byte-safe for city/etc).
      //   kneeFollow — on an ARTICULATED chain, re-solve the two upper bones (two-bone IK) so the shin never
      //     stretches (A8-2). Default true; false → the raw foot-position override even on a proper chain (A/B).
      //   RETURNS the ground receipt (`groundReport`) — A-CENSUS, 2026-08-20. It used to return void, which
      //     is why a caller could ask for a MEASURED floor on a rig that cannot produce one and be told
      //     nothing at all. The return value is additive: every existing call site ignores it and is
      //     byte-identical, but a call site that cares can no longer be kept in the dark by accident.
      setFootIK(cfg) {
        if (!cfg) { _footIK = null; if (_ikLegs) for (const lg of _ikLegs) { lg.lockOn = false; lg.w = 0; } _groundRep.requested = false; _groundRep.measured = false; return _groundOk(); }
        if (!_ikLegs) return _groundOk();   // not a biped we can plant — stays a no-op
        _footIK = { plantBand: cfg.plantBand != null ? cfg.plantBand : 0.14, lockRate: cfg.lockRate != null ? cfg.lockRate : 18, unlockRate: cfg.unlockRate != null ? cfg.unlockRate : 12, maxStride: cfg.maxStride != null ? cfg.maxStride : 0.55, kneeFollow: cfg.kneeFollow !== false,
          /* A-CONTACT (2026-08-20): THE GROUND HALF OF THE CONTACT ABILITY — opt-in, and deliberately
             so. Without it the contact floor is INFERRED: a leaky-min over the rig's own feet, which
             converges to whatever stance the feet are already in and therefore CANNOT notice that the
             body was placed below the real floor (it will happily lock the feet inside a slab — the
             exact shape of the hoard "characters standing in the ground" report). With it, and with a
             `setSurfaceProbe` wired, the floor is MEASURED under each foot through the same world
             query the wall contact uses. Off by default because turning it on MOVES FEET, and the
             walk/run this repo ships are liked as they are — no project inherits a gait change by
             accident (CLAUDE.md engine-first: the ability lives here, the decision stays the
             project's). */
          groundProbe: cfg.groundProbe === true };
        /* A-CENSUS: THE FAIL-LOUD MOMENT. Asking for a measured floor on a skeleton that cannot deliver one
           is now a WARNING at the moment of the ask, not a discovery three arcs later — once per rig source
           (see `_warnedGround`), naming the rig so the reader knows which GLB to look at. The call still
           succeeds and the rig still runs on the INFERRED floor: this is a report, not a behaviour change,
           because changing when a flat rig plants would move a gait the owner has ruled on. */
        _groundRep.requested = _footIK.groundProbe;
        _groundOk();
        if (_footIK.groundProbe && !_groundRep.reachable && !_warnedGround) {
          _warnedGround = true;
          console.warn(`[character-rig] ${url || 'gltf'}: setFootIK({groundProbe:true}) asked for a MEASURED ground floor, but this rig CANNOT DELIVER ONE: ${_groundRep.reason}. The foot-lock will silently use the INFERRED floor (a leaky-min over its own feet), which cannot notice a body placed below the real ground. Read handle.groundReport / horde.groundReport rather than surfaceProbedCount — holding a probe is not consuming one.`);
        }
        return _groundRep;
      },
      // A7-2: the horde's distance LOD toggles this — foot IK only runs on near characters (skip the solver
      // + its updateWorldMatrix cost beyond the IK distance; far feet aren't legible anyway).
      setFootIKActive(on) { _footIKActive = !!on; },
      // A1: clear the anim state so a RECYCLED pool slot re-arms cleanly. The horde's setActive(i,false) calls
      // mixer.stopAllAction() (stops the loco actions) but the handle is reused — without this reset _locoOn
      // stays true and the next setLocomotion just sets weights on STOPPED actions → the respawn freezes in
      // bind pose. Resetting _locoOn makes the next setLocomotion rebuild+replay the blend from scratch.
      // A-AIR: the air layer is reset here too. A pooled slot that recycled mid-fall would otherwise
      // re-arm carrying the previous occupant's spread-eagle in `_airCur` and ease OUT of it on frame one.
      resetAnim() { _locoOn = false; _locoSpeed = 0; _locoShown = 0; _actActive = false; _actAction = null; _actClip = null; _actW = 0; if (_poseAction) _poseAction.stop(); _poseAction = null; _poseClip = null; _poseWant = 0; _poseW = 0; aimW = 0; _aimActive = false; _headingTarget = null; _airMode = null; _airW = 0; _airWant01 = 0; _airT = 0; _airClimb = 0; _airPhase = 0; _airClimbEase = 0; _contactW = 0; _airWallOn = false; _contactRep.active = false; _contactRep.w = 0; _mountIK = null; _mountW = 0; _mountRep.active = false; _mountRep.w = 0; airPose(_airCur, null, 0, 0, 0); airPose(_airWant, null, 0, 0, 0); if (_ikLegs) { for (const lg of _ikLegs) { lg.lockOn = false; lg.w = 0; } _ikFloorY = null; } _groundRep.measured = false; _clampRelease(); },   // A-CLAMP: the held lift is a per-occupant fact — a recycled slot must not inherit the last body's (its own gait decides its own lift). · A-CENSUS: `measured` is a per-frame fact — a recycled slot must not inherit the last occupant's. The cumulative counters DO carry (they describe the slot's whole life, which is the honest number for a pool).
      // B4: attach an object (a weapon kit) to a named bone, NORMALISING for the skeleton's baked scale
      // (Quaternius GLBs often carry a ~100x armature scale, so a naive add makes the gun enormous). The
      // object then renders at `worldScale` world-units regardless; pos/rot are in the bone's local frame
      // (tune to seat it in the palm). Returns false if the bone is absent (caller can fall back).
      findBone(name) { return object.getObjectByName(name) || null; },
      attachToBone(boneName, obj, { worldScale = 1, pos = [0, 0, 0], rot = [0, 0, 0] } = {}) {
        const bone = object.getObjectByName(boneName);
        if (!bone) return false;
        object.updateWorldMatrix(true, true);
        bone.matrixWorld.decompose(_v3, _q2, _v3b);   // _v3b = the bone's world scale
        const bs = (_v3b.x + _v3b.y + _v3b.z) / 3 || 1;
        obj.scale.setScalar(worldScale / bs);
        obj.position.set(pos[0], pos[1], pos[2]);
        obj.rotation.set(rot[0], rot[1], rot[2]);
        bone.add(obj);
        return true;
      },
      // Run AFTER a mixer step (the mixer reset the bones to the clip pose, so we multiply ONE fresh offset
      // — never accumulating). The caller (rig.update / horde.update) only calls this when the mixer stepped.
      _applyLayers(dt) {
        // ── A-BODY POSE HOLD — eased OUTSIDE the _locoOn guard, because a consumer may hold a pose on a rig
        // that never drives locomotion at all (and because a release must keep easing after the last
        // poseHold call). 14/s in, 9/s out: a body enters an air pose fast (the leave-the-ground moment is
        // a beat) and returns to its legs a little softer, so a landing settles instead of snapping.
        if (_poseAction) {
          _poseW = damp(_poseW, _poseWant, _poseWant > 0 ? 14 : 9, dt);
          _poseAction.setEffectiveWeight(_poseW);
          if (_poseW < 0.01 && _poseWant === 0) { _poseAction.stop(); _poseAction = null; _poseClip = null; _poseW = 0; }
        }
        // ── A1 LOCOMOTION BLEND — set the idle/walk/run weights from speed, dimmed by any one-shot action.
        if (_locoOn) {
          if (_actActive && _actClip && _actAction.time >= _actClip.duration - 0.02) _actActive = false;  // clip clamped → release
          _actW = damp(_actW, _actActive ? 1 : 0, _actActive ? 20 : 9, dt);
          if (_actAction) { _actAction.setEffectiveWeight(_actW); if (_actW < 0.02 && !_actActive) { _actAction.stop(); _actAction = null; _actClip = null; } }
          // A8-1: ease the SHOWN gait scalar toward the (possibly-jumped) requested speed, then split the
          // idle/walk/run weights off the EASED value — so a dead stop or a pooled recycle melts through the
          // states instead of popping. One low-pass covers every state-pair transition (the weight fn is
          // continuous in s), so idle↔walk, walk↔run and the reverse all ease with no per-pair bookkeeping.
          _locoShown = damp(_locoShown, _locoSpeed, _locoEase, dt);
          // A-BODY: a HELD POSE steals weight from the legs on the same seam a one-shot does, so an air
          // pose at full weight leaves no walk cycle running underneath it (the "running in mid-air" read).
          const s = _locoShown, base = Math.max(0, 1 - _actW - _poseW);
          let wi = 0, ww = 0, wr = 0;
          if (s < 0.5) { wi = 1 - s * 2; ww = s * 2; } else { ww = 2 - s * 2; wr = s * 2 - 1; }
          // A6-2 STRIDE RATE — scale the leg playback so the planted foot GRIPS instead of skating. When a
          // refStride is set AND the consumer passed a real world speed, timeScale = strideTimeScale(v/ref)
          // (per clip: the run clip covers more ground, so its own refStride). Otherwise fall back to the old
          // speed01 heuristic (byte-safe). The character's world SCALE stretches its stride, so refStride is
          // scaled by object.scale — a bigger (tank) rig grips at the same v with a lower rate.
          const strideOn = _walkStride > 0 && _worldSpeed != null;
          const sc = object.scale.x || 1;
          const walkTS = strideOn ? strideTimeScale(_worldSpeed, _walkStride * sc, _strideMin, _strideMax) : (0.85 + 0.5 * s);
          const runTS = strideOn ? strideTimeScale(_worldSpeed, _runStride * sc, _strideMin, _strideMax) : 1;
          if (locoActions.idle) locoActions.idle.setEffectiveWeight(wi * base);
          if (locoActions.walk) { locoActions.walk.setEffectiveWeight(ww * base); locoActions.walk.setEffectiveTimeScale(walkTS); }
          if (locoActions.run) { locoActions.run.setEffectiveWeight(wr * base); locoActions.run.setEffectiveTimeScale(runTS); }
        }
        // ── A2 IDLE-RELAX — the survivor.glb idle is a braced 'lunge' (owner note); when TRULY idle (no aim,
        // no action, not moving) ease the arms down off the chest and add a slow weight-shift sway so it reads
        // as a person standing, not bracing. Opt-in (survivor only). Composes before aim/recoil, which override
        // the gun arm when they engage; here they don't (idle gate). Offsets never accumulate (mixer resets).
        if (_idleRelax) {
          /* `!_airMode` IS LOAD-BEARING, and it is a real bug caught before it shipped rather than a
             defensive `&&`. Idle-relax fires on "not aiming, no one-shot, and barely moving" — and an
             airborne body has a HORIZONTAL speed of nearly zero while hanging on a wall or dropping
             straight down, so without this gate the relax layer would lower both arms to the hips at
             the exact moment the air layer is raising them overhead. The two would fight every frame
             and the cling would collapse back into the reaching pose this arc exists to fix. */
          const wantRelax = (!_aimActive && !_actActive && !_airMode && _locoSpeed < 0.08) ? 1 : 0;
          _relaxW = damp(_relaxW, wantRelax, wantRelax ? 2.4 : 6, dt);
          if (_relaxW > 0.01) {
            _relaxClock += dt;
            const w = _relaxW, sway = Math.sin(_relaxClock * 0.7);
            if (boneArmL2) { _q.setFromAxisAngle(_AX_X, 0.85 * w); boneArmL2.quaternion.multiply(_q); }   // lower off-hand
            if (boneArmR)  { _q.setFromAxisAngle(_AX_X, 0.85 * w); boneArmR.quaternion.multiply(_q); }    // lower gun hand
            if (boneSpine) {
              _q.setFromAxisAngle(_AX_Z, sway * 0.04 * w); boneSpine.quaternion.multiply(_q);             // side weight-shift sway
              _q.setFromAxisAngle(_AX_X, -0.14 * w); boneSpine.quaternion.multiply(_q);                   // ease the braced forward lean upright
            }
          }
        }
        /* ── A-AIR AIRBORNE MOTION LAYER — the one that turns four held frames into four animations.
           Runs HERE on purpose: after the clip weights and idle-relax (it shapes the BASE pose, like
           they do) and BEFORE aim-IK, so on a swing the aim layer's `slerp` still wins the rope arm
           outright — the arm keeps pointing at the anchor and only the free half of the body is ours.
           Everything is a `.multiply` onto the bone the mixer just posed, so nothing accumulates: the
           next frame starts from a fresh clip pose, exactly as every layer above does. */
        if (_airMode || _airW > 0.001) {
          // Weight in fast, out slower — same 14/9 asymmetry as poseHold, and for the same reason: the
          // moment you leave the ground is a beat, the moment you land should settle rather than snap.
          _airW = damp(_airW, _airWant01, _airWant01 > 0 ? 14 : 9, dt);
          _airT += dt;
          /* A-CRAWL — the gait phase is an ODOMETER, not a clock: it integrates vy over the crawl's
             stride (in this rig's OWN measured leg length, so one tuning fits every scale), which is
             the entire mechanism behind "still while hanging, cycling while climbing, reversed on S".
             `_airClimbEase` is the eased effort that settles lifted limbs back onto the plane when the
             climb stops — eased here (10/s) rather than read raw because a keyboard lift axis is a
             square wave and the lift amplitude must not be. */
          if (_airMode === 'cling') {
            const legL = _chainLenOf(_airLegL) || _chainLenOf(_airLegR);
            if (legL > 0) _airPhase += crawlPhaseRate(_airVy, CRAWL.stride * legL) * dt;
          }
          _airClimbEase = damp(_airClimbEase, _airMode === 'cling' ? (_airClimb < 0 ? -_airClimb : _airClimb) : 0, 10, dt);
          airPose(_airWant, _airMode, riseFall(_airVy, _airVRef), _airT, _airClimb, _airPhase);
          // Ease the ANGLES too (see the state block above) — 12/s, so a jump→fall flip at the apex is
          // a fast melt rather than a pop, and a mode released mid-arc drifts home instead of cutting.
          const k = _airW;
          for (let i = 0; i < AIR_POSE_KEYS.length; i++) { const key = AIR_POSE_KEYS[i]; _airCur[key] = damp(_airCur[key], _airWant[key], 12, dt); }
          if (k > 0.004) {
            if (boneSpine) {
              _q.setFromAxisAngle(_AX_X, _airCur.spineX * k); boneSpine.quaternion.multiply(_q);
              _q.setFromAxisAngle(_AX_Z, _airCur.spineZ * k); boneSpine.quaternion.multiply(_q);
            }
            if (boneHead) { _q.setFromAxisAngle(_AX_X, _airCur.headX * k); boneHead.quaternion.multiply(_q); }
            if (boneArmL2) {
              _q.setFromAxisAngle(_AX_X, _airCur.armLX * k); boneArmL2.quaternion.multiply(_q);
              _q.setFromAxisAngle(_AX_Z, _airCur.armLZ * k); boneArmL2.quaternion.multiply(_q);
            }
            if (boneArmR) {
              _q.setFromAxisAngle(_AX_X, _airCur.armRX * k); boneArmR.quaternion.multiply(_q);
              _q.setFromAxisAngle(_AX_Z, _airCur.armRZ * k); boneArmR.quaternion.multiply(_q);
            }
            if (boneArmForeR) { _q.setFromAxisAngle(_AX_X, _airCur.foreRX * k); boneArmForeR.quaternion.multiply(_q); }
            // A-CRAWL: the LEFT elbow, reached through the arm chain (no canonical foreArmL role — same
            // doctrine as the legs). Only the cling writes foreLX; it pre-bends the elbow so the contact
            // solver's pole (nearest-current-bend) folds the arm the way a climber's folds, not backwards.
            if (_airArmL.knee) { _q.setFromAxisAngle(_AX_X, _airCur.foreLX * k); _airArmL.knee.quaternion.multiply(_q); }
            /* THE LEGS — the half no shipped layer had ever moved, and the half that carries a tuck, a
               splay and a climb. `upleg`/`knee` are null on a flat rig (the Quaternius zombie), so this
               is a no-op there rather than a throw: the same graceful degradation every layer above has. */
            if (_airLegL.upleg) {
              _q.setFromAxisAngle(_AX_X, _airCur.upLegLX * k); _airLegL.upleg.quaternion.multiply(_q);
              _q.setFromAxisAngle(_AX_Z, _airCur.upLegLZ * k); _airLegL.upleg.quaternion.multiply(_q);
            }
            if (_airLegR.upleg) {
              _q.setFromAxisAngle(_AX_X, _airCur.upLegRX * k); _airLegR.upleg.quaternion.multiply(_q);
              _q.setFromAxisAngle(_AX_Z, _airCur.upLegRZ * k); _airLegR.upleg.quaternion.multiply(_q);
            }
            if (_airLegL.knee) { _q.setFromAxisAngle(_AX_X, _airCur.kneeLX * k); _airLegL.knee.quaternion.multiply(_q); }
            if (_airLegR.knee) { _q.setFromAxisAngle(_AX_X, _airCur.kneeRX * k); _airLegR.knee.quaternion.multiply(_q); }
          }
        }
        // ── A1 HEADING — slerp the body toward the target yaw (smooth turns instead of snapping).
        if (_headingTarget != null) {
          _eu.setFromQuaternion(object.quaternion, 'YXZ');
          _eu.y += wrapPi(_headingTarget - _eu.y) * Math.min(1, dt * 11);   // ~11/s turn
          object.quaternion.setFromEuler(_eu);
        }
        // ── A1 AIM-IK (the upper-body MASK: this owns the gun arm + a chest twist; the legs keep the
        // locomotion, and the recoil/swing impulses below compose ON TOP of the aimed arm). A directional
        // 2-bone aim: point the upper-arm bone-axis at the target, twist the chest to lead, bend the elbow a
        // touch. ~1 updateWorldMatrix + a handful of quats per AIMING character (the caller skips distant ones).
        if (_aimActive && boneArmR && aimTarget) {
          aimW = damp(aimW, 1, 14, dt);
          boneArmR.updateWorldMatrix(true, false);              // refresh the parent chain (world quat is stale post-mixer)
          boneArmR.getWorldPosition(_v3);                       // the shoulder joint (upper-arm origin)
          _v3b.set(aimTarget.x - _v3.x, aimTarget.y - _v3.y, aimTarget.z - _v3.z);
          if (_v3b.lengthSq() > 1e-6) {
            _v3b.normalize();
            boneArmR.parent.getWorldQuaternion(_q2);            // parent world orientation
            _qA.setFromUnitVectors(_UPY, _v3b);                 // world: bone +Y (down-arm) → the aim dir
            _q2.invert().multiply(_qA);                         // → the bone-LOCAL target
            boneArmR.quaternion.slerp(_q2, aimW);               // blend the arm from the clip pose to the aim
            if (boneArmForeR) { _q.setFromAxisAngle(_AX_X, -0.4 * aimW); boneArmForeR.quaternion.multiply(_q); }  // slight elbow bend
            if (boneSpine) {
              _eu.setFromQuaternion(object.quaternion, 'YXZ');
              const rel = wrapPi(Math.atan2(aimTarget.x - object.position.x, aimTarget.z - object.position.z) - _eu.y);
              _q.setFromAxisAngle(_AX_Y, rel * 0.3 * aimW); boneSpine.quaternion.multiply(_q);   // chest leads the aim
            }
          }
        } else if (aimW > 0.01) { aimW = damp(aimW, 0, 8, dt); }
        if (boneHead && lookTarget) {
          _eu.setFromQuaternion(object.quaternion, 'YXZ');
          const dx = lookTarget.x - object.position.x, dz = lookTarget.z - object.position.z;
          const want = headYawDelta(_eu.y, dx, dz, lp.headLook.cone) * lp.headLook.weight;
          headYaw = damp(headYaw, want, lp.headLook.speed, dt);
          if (boneNeck) { _q.setFromAxisAngle(_AX_Y, headYaw * 0.4); boneNeck.quaternion.multiply(_q); _q.setFromAxisAngle(_AX_Y, headYaw * 0.6); boneHead.quaternion.multiply(_q); }
          else { _q.setFromAxisAngle(_AX_Y, headYaw); boneHead.quaternion.multiply(_q); }
        }
        if (flinchT >= 0) {
          flinchT += dt;
          const u = flinchT / lp.hitReact.dur;
          if (u >= 1) { flinchT = -1; }
          else {
            const env = flinchEnvelope(u) * lp.hitReact.amp;
            if (boneSpine) { _q.setFromAxisAngle(_AX_X, -env * lp.hitReact.lean); boneSpine.quaternion.multiply(_q); _q.setFromAxisAngle(_AX_Y, env * lp.hitReact.lean * 0.5 * flinchSign); boneSpine.quaternion.multiply(_q); }
            if (boneArmL) { _q.setFromAxisAngle(_AX_Z, env * lp.hitReact.arm); boneArmL.quaternion.multiply(_q); }
            if (boneArmR) { _q.setFromAxisAngle(_AX_Z, -env * lp.hitReact.arm); boneArmR.quaternion.multiply(_q); }
          }
        }
        // B4 RECOIL — a sharp gun-arm snap-back on the RIGHT arm (+ a slight torso kick), decaying fast.
        if (recoilT >= 0 && boneArmR) {
          recoilT += dt; const u = recoilT / lp.recoil.dur;
          if (u >= 1) { recoilT = -1; }
          else {
            const e = flinchEnvelope(u) * lp.recoil.amp;
            _q.setFromAxisAngle(_AX_X, -e * lp.recoil.arm); boneArmR.quaternion.multiply(_q);
            if (boneSpine) { _q.setFromAxisAngle(_AX_X, -e * lp.recoil.arm * 0.3); boneSpine.quaternion.multiply(_q); }
          }
        }
        // A5 MELEE SWING — a real strike, not one pose: wind-up (cock back) → impact (whip forward) →
        // recovery (settle), via swingEnvelope. The torso TWISTS + leans into the impact for weight, and the
        // off arm counter-swings for balance — so the whole body reads the blow, not just the forearm.
        if (swingT >= 0 && boneArmR) {
          swingT += dt; const u = swingT / lp.swing.dur;
          if (u >= 1) { swingT = -1; }
          else {
            const e = swingEnvelope(u) * lp.swing.amp;
            _q.setFromAxisAngle(_AX_X, e * lp.swing.arm); boneArmR.quaternion.multiply(_q);   // gun-arm whips down/forward
            if (boneSpine) {
              _q.setFromAxisAngle(_AX_Y, e * 0.3); boneSpine.quaternion.multiply(_q);          // twist into the strike
              _q.setFromAxisAngle(_AX_X, Math.max(0, e) * 0.22); boneSpine.quaternion.multiply(_q);  // lean forward on the forward half
            }
            if (boneArmL) { _q.setFromAxisAngle(_AX_X, -e * lp.swing.arm * 0.28); boneArmL.quaternion.multiply(_q); } // off-arm counter
          }
        }
        // A5 ZOMBIE LUNGE — a forward upper-body thrust on attack (cheap, same seam): the spine pitches
        // FORWARD and the head thrusts toward you, then settles (flinchEnvelope). Reads as the zombie lashing
        // in over its Attack clip — no root translation (the sim owns position), so it never fights the crowd sim.
        if (lungeT >= 0 && boneSpine) {
          lungeT += dt; const u = lungeT / lp.lunge.dur;
          if (u >= 1) { lungeT = -1; }
          else {
            const e = flinchEnvelope(u) * lp.lunge.amp;
            _q.setFromAxisAngle(_AX_X, e * lp.lunge.lean); boneSpine.quaternion.multiply(_q);   // pitch forward (+X)
            if (boneHead) { _q.setFromAxisAngle(_AX_X, e * lp.lunge.head); boneHead.quaternion.multiply(_q); } // head thrusts in
          }
        }
        // A8-3 RELOAD DIP — a procedural reload beat (no clip exists): the gun-arm drops off aim toward the
        // belt, the off-hand comes IN to work the magazine, and the torso settles as if glancing down at the
        // weapon — held at the bottom, then raised back to ready (dipEnvelope). The consumer drops the aim
        // layer while reloadBeat is active (handle.reloading) so the arm actually comes off target. Composes
        // on the same seam as recoil/swing; offsets never accumulate (the mixer resets to the clip each frame).
        if (reloadT >= 0 && boneArmR) {
          reloadT += dt; const u = reloadT / lp.reload.dur;
          if (u >= 1) { reloadT = -1; }
          else {
            const e = dipEnvelope(u) * lp.reload.amp;
            _q.setFromAxisAngle(_AX_X, e * lp.reload.arm); boneArmR.quaternion.multiply(_q);        // gun-arm lowers off aim
            if (boneArmL) { _q.setFromAxisAngle(_AX_X, e * lp.reload.off); boneArmL.quaternion.multiply(_q); }  // off-hand racks in
            if (boneSpine) { _q.setFromAxisAngle(_AX_X, e * lp.reload.lean); boneSpine.quaternion.multiply(_q); }  // glance down at the weapon
          }
        }
        // ── A7-2 FOOT IK (plant-and-hold) — runs LAST, after every clip + layer has posed the legs. The mixer
        // reset the foot bones to the clip pose this frame, so the hold reads a fresh pose and writes an
        // absolute local position (no accumulation). Presentation-only: it moves a bone, never the sim position.
        if (_footIK && _footIKActive && _ikLegs) {
          // The heading slew + setTransform changed object.* this frame but matrixWorld is stale mid-layer;
          // refresh each foot's world (updateParents=true walks the object→armature→root→foot chain fresh).
          let minFootY = 1e9;
          for (const lg of _ikLegs) {
            lg.foot.updateWorldMatrix(true, false);
            const fe = lg.foot.matrixWorld.elements;
            lg.fx = fe[12]; lg.fy = fe[13]; lg.fz = fe[14];   // clip-pose foot world pos (before any hold)
            if (lg.fy < minFootY) minFootY = lg.fy;
          }
          /* THE CONTACT FLOOR. Two ways to know where the ground is, and the difference is this arc's
             whole lesson (A-CONTACT, 2026-08-20):
             MEASURED (`footIK.groundProbe` + a wired `setSurfaceProbe`) — drop a probe from above the
               lower foot and take the surface it actually finds. This is the only version that can
               contradict the pose: a body standing 0.04 u inside a slab reads the slab TOP and lifts
               the feet out of it. `groundContactTarget` is the same call the wall uses, pointed down.
             INFERRED (the default, A7-2's original) — a leaky-min over the rig's own feet: it converges
               to the stance height and can only rise slowly (0.5 m/s), so a lifted-both-feet frame
               never sticks the floor high. It is self-referential BY CONSTRUCTION, so it cannot ever
               notice a wrong ground datum — it will lock the feet wherever the body was put. Kept as
               the default because it needs no world, and changing it would move every shipped gait. */
          let floorMeasured = false;
          if (_footIK.groundProbe && _surfaceProbe) {
            const lowLeg = _ikLegs[0].fy <= _ikLegs[1].fy ? _ikLegs[0] : _ikLegs[1];
            const L = _chainLenOf(lowLeg) || 0;
            if (L > 0 && groundContactTarget(_cTgt, _surfaceProbe, lowLeg.fx, lowLeg.fy, lowLeg.fz, 0, L) > 0) {
              _ikFloorY = _cTgt.y; floorMeasured = true;
            }
          }
          /* A-CENSUS: the RUNTIME half of the receipt — two integer increments, inside a block that was
             already gated, so the cost is nil and the claim "the measured floor is running" stops being an
             inference from moved feet. `frames` counts every frame this solver ran; `measuredFrames` only
             the ones that produced a probed floor. 600 and 0 is the flat-rig signature. */
          _groundRep.frames++;
          _groundRep.measured = floorMeasured;
          if (floorMeasured) _groundRep.measuredFrames++;
          if (!floorMeasured) {
            if (_ikFloorY == null) _ikFloorY = minFootY;
            else _ikFloorY = Math.min(minFootY, _ikFloorY + 0.5 * dt);
          }
          // SUPPORT is STICKY: once a foot plants it STAYS the support (held still) until it LIFTS above the band
          // or the leg OVER-REACHES (the hips walked a full stride past the lock → take a step). Only ONE foot is
          // ever locked (single support); a new plant is allowed only for the lower foot while none is locked.
          // Stickiness is the whole game — in the shamble both feet hover near the ground, so picking the
          // lower foot per-frame flickers L/R and the lock never sustains (the foot drags instead of holding).
          let hx = 0, hz = 0;
          if (_ikHips) { _ikHips.updateWorldMatrix(true, false); const he = _ikHips.matrixWorld.elements; hx = he[12]; hz = he[14]; }
          const anyLocked = _ikLegs[0].lockOn || _ikLegs[1].lockOn;
          const lower = _ikLegs[0].fy <= _ikLegs[1].fy ? _ikLegs[0] : _ikLegs[1];
          for (const lg of _ikLegs) {
            const low = (lg.fy - _ikFloorY) < _footIK.plantBand;
            const overReach = lg.lockOn && Math.hypot(lg.lx - hx, lg.lz - hz) > _footIK.maxStride;   // leg maxed → step
            const wantLock = lg.lockOn ? (low && !overReach) : (low && lg === lower && !anyLocked);
            if (wantLock && !lg.lockOn) { lg.lockOn = true; lg.lx = lg.fx; lg.ly = lg.fy; lg.lz = lg.fz; }  // pin the world pos
            else if (!wantLock && lg.lockOn) { lg.lockOn = false; }
            lg.w = damp(lg.w, lg.lockOn ? 1 : 0, lg.lockOn ? _footIK.lockRate : _footIK.unlockRate, dt);
            if (lg.w > 0.01) {
              // HOLD: blend the foot's TARGET world pos from the clip pose toward the pinned lock by the hold
              // weight (w=0 → target IS the clip pose → no move; auto-eased, no separate solver weight).
              _ikTgt.set(lg.fx + (lg.lx - lg.fx) * lg.w, lg.fy + (lg.ly - lg.fy) * lg.w, lg.fz + (lg.lz - lg.fz) * lg.w);
              if (_footIK.kneeFollow && lg.articulated) {
                // A8-2 ARTICULATED: re-solve the two-bone leg to REACH the target with the shin length kept
                // (no rubber-band stretch). The foot bone keeps its natural local pose → follows the shin.
                _solveTwoBone(lg, _ikTgt.x, _ikTgt.y, _ikTgt.z);
              } else {
                // FLAT rig (e.g. the Quaternius zombie, Foot→Root): no shin to stretch → the topology-agnostic
                // override — set the foot bone's LOCAL pos so its world lands on the target (parent⁻¹·targetWorld).
                _ikMat.copy(lg.foot.parent.matrixWorld).invert();
                _ikLocal.copy(_ikTgt).applyMatrix4(_ikMat);
                lg.foot.position.copy(_ikLocal);   // mixer re-poses this next frame → never accumulates
              }
            }
          }
        }
        /* ── A-CRAWL WALL CONTACT (2026-08-19) — hands and feet land ON the wall plane, gaited. ------
           This is the pass that turns A-AIR's "spread-eagled NEAR the wall" into "crawling ON it": for
           each of the four limb chains, build a target on the cling ray's wall plane — the chain root
           projected onto the plane, offset up/down by the crawl gait, sideways to the limb's own side,
           and off the plane by the planted inset plus the reaching limb's lift — then run the SAME
           analytic two-bone solve the A8-2 foot-lock trusts, so elbows and knees bend to reach it with
           both bone lengths preserved. All four targets read ONE signed phase through CRAWL_PHASE, so
           the diagonal pairs (LH+RF, then RH+LF) move together by construction.
           RUNS LAST, after every clip and layer (including the foot-lock: last writer wins, and while
           clinging the wall owns the feet — the floor's plant is meaningless on a vertical face).
           THE BLEND IS THE FOOT-LOCK'S OWN TRICK: the target is lerped from the limb's CURRENT posed
           end position toward the wall target by the eased weight, so weight 0 solves to where the limb
           already is (an exact no-op) and there is no second blending mechanism to keep honest.
           Weight out is FASTER than in (18 vs 14): on a wall-jump the body leaves the plane at
           jumpSpeed, and a slow-fading pin would visibly drag the hands back toward a wall the body
           has already left — the leap must not fight the crawl (the wallJumped gate's presentation
           half). The stale plane is kept during the ease-out ON PURPOSE (see setAirMotion): easing
           away from the real wall reads as the push-off; easing toward a cleared one reads as a twitch.
           COST, stated: ~10 updateWorldMatrix walks + 4 two-bone solves per CLINGING hero per frame —
           the same order as one aim-IK plus one foot-lock, and exactly zero when not clinging (the
           whole pass is one failed `if`). Measured in tools/hero-perf-ab.mjs's cling room. */
        {
          const wantContact = (_airWallOn && _airMode === 'cling' && _airW > 0.3) ? 1 : 0;
          if (wantContact || _contactW > 0.004) {
            _contactW = damp(_contactW, wantContact, wantContact ? 14 : 18, dt);
            _contactRep.active = _contactW > 0.004;
            _contactRep.w = _contactW;
            _contactRep.snap = 0;                       // per-frame worst probe correction (A-CONTACT)
            _contactRep.released = 0;                   // limbs with no surface in front of them this frame
            _contactRep.probed = !!_surfaceProbe;
            const wBase = _contactW * _airW;
            if (_contactRep.active && wBase > 0.004) {
              const nx = _airWallNx, nz = _airWallNz;    // n̂: OUT of the wall, unit, horizontal
              const tqx = nz, tqz = -nx;                 // t̂ = up × n̂ — the along-wall horizontal
              const px = _airWallPx, pz = _airWallPz;    // a world point on the plane
              for (let i = 0; i < _crawlLimbs.length; i++) {
                const d = _crawlLimbs[i], ch = d.ch;
                const L = _chainLenOf(ch);
                if (!(L > 0)) { _contactRep[d.key] = -1; continue; }
                _contactRep.chainLen = L;      // A-CONTACT receipt: the unit every CRAWL/CONTACT number is in
                crawlLimb(_crawlOff, _airPhase + d.off, _airClimbEase);
                ch.upleg.updateWorldMatrix(true, false); ch.upleg.getWorldPosition(_cR);
                ch.foot.updateWorldMatrix(true, false); ch.foot.getWorldPosition(_cE);
                // the chain root, projected onto the plane along n̂…
                const sd = (_cR.x - px) * nx + (_cR.z - pz) * nz;
                // …then stood off it by the planted inset (a palm/foot's own depth — the JOINT stays
                // off the surface so the MESH lands on it) plus the reaching limb's gait lift…
                const off = (d.hand ? CRAWL.insetHand : CRAWL.insetFoot) * L + _crawlOff.lift * CRAWL.lift * L;
                // …shifted to the limb's own side of the body (sign read off the root itself, so left
                // limbs go body-left with no handedness table)…
                const lat = (((_cR.x - object.position.x) * tqx + (_cR.z - object.position.z) * tqz) >= 0 ? 1 : -1) * CRAWL.lat * L;
                const tx = _cR.x - nx * sd + nx * off + tqx * lat;
                const tz = _cR.z - nz * sd + nz * off + tqz * lat;
                // …and up/down the wall by the limb's rest reach plus the gait's cosine travel.
                const ty = _cR.y + ((d.hand ? CRAWL.uHand : CRAWL.uFoot) + _crawlOff.u * CRAWL.uAmp) * L;
                /* ── A-CONTACT (2026-08-20): ASK THE WORLD, DO NOT TRUST THE PLANE. -----------------
                   Everything above computes the GUESS — the gait's point on the plane the controller
                   published. Measured, that plane sits 0.0710 u outside the real facade (contact.js
                   carries the derivation), so a limb solved exactly onto it hovers a quarter of a body
                   height off the wall while `contactReport` reads 0.000 and calls it planted. So the
                   guess is now resolved against the ACTUAL geometry, per limb, at that limb's OWN
                   reach height — which is also the only way four limbs can sit on four different bits
                   of geometry at a corner. `inset` is subtracted from the guess first because the
                   guess already carries it (the gait's `off`), and the resolve re-applies it against
                   the surface it actually found. No probe wired → `moved` is 0 and the guess stands,
                   i.e. A-CRAWL's exact shipped behaviour. */
                const inset = (d.hand ? CONTACT.insetHand : CONTACT.insetFoot) * L;
                const moved = planeContactTarget(_cTgt, _surfaceProbe,
                  tx - nx * inset, ty, tz - nz * inset, nx, 0, nz, inset, L);
                if (moved > _contactRep.snap) _contactRep.snap = moved;
                /* NO SURFACE IN FRONT OF THIS LIMB → DO NOT HOLD ONTO IT. `-1` means a wired probe
                   looked and found nothing: the limb has reached past the end of the wall, or the body
                   has mantled over the parapet and the facade is below it now. A-CRAWL kept pinning to
                   the stale plane through the ease-out (deliberately — on a WALL-JUMP that reads as the
                   push-off, and it still does: leaping away, the probe still finds the facade it is
                   leaving). Topping out is the other case, and there the stale pin measured 0.386 u of
                   float on the roof. Per-limb weight 0 hands the limb straight back to the air pose,
                   which is the same no-op the whole pass uses at weight 0 — no second mechanism. */
                const wLimb = moved < 0 ? 0 : wBase;
                if (wLimb <= 0) {
                  /* RELEASED. The receipt still reports WHERE THE JOINT IS (measured off the current
                     pose, un-solved) rather than a sentinel: -1 already means "this rig has no
                     articulated chain here", and a reader that cannot tell a missing limb from a
                     released one is a receipt with two meanings — exactly the ambiguity this arc was
                     sent to remove. `released` counts them so the condition is still visible. */
                  _contactRep[d.key] = (_cE.x - px) * nx + (_cE.z - pz) * nz;
                  _contactRep.released++;
                  continue;
                }
                _ikTgt.set(_cE.x + (_cTgt.x - _cE.x) * wLimb, _cE.y + (_cTgt.y - _cE.y) * wLimb, _cE.z + (_cTgt.z - _cE.z) * wLimb);
                _solveTwoBone(ch, _ikTgt.x, _ikTgt.y, _ikTgt.z);
                // the receipt: the end joint's MEASURED distance off the plane after the solve — the
                // number the ledger's acceptance quotes, computed where it cannot drift from the code.
                ch.foot.updateWorldMatrix(true, false); ch.foot.getWorldPosition(_cE);
                _contactRep[d.key] = (_cE.x - px) * nx + (_cE.z - pz) * nz;
              }
            }
          } else if (_contactRep.active) { _contactRep.active = false; _contactRep.w = 0; }
        }
        /* ── A-WHIP MOUNT-IK (2026-08-19) — hands to the grips, feet to the pegs. ----------------
           RUNS LAST (after the crawl pass, for the same last-writer-wins reason — though a body
           is never mounted AND clinging; different consumers, stated): for each limb with a
           socket target, read the node's LIVE world position (getWorldPosition walks the parent
           chain, so the bike group's transform set THIS frame — and the fork's steer yaw — are
           already in it), lerp the solve target from the limb's CURRENT posed end position by
           the eased weight (the foot-lock's own blend trick: weight 0 is an exact no-op, no
           second blending mechanism to keep honest), and run the SAME analytic two-bone solve
           every other contact pass trusts. The receipt is MEASURED after the solve — the end
           joint's remaining distance to its socket — so "hands ON grips" is a number a probe
           asserts, not an impression; a target beyond the chain's reach shows up here as a
           residual the captures tool prints (the clamp in _solveTwoBone stops at full
           extension). COST: ~8 updateWorldMatrix walks + 4 solves per mounted rider per frame,
           zero when never enabled (one failed `if`). */
        {
          const wantMount = _mountIK ? 1 : 0;
          if (wantMount || _mountW > 0.004) {
            _mountW = damp(_mountW, wantMount, wantMount ? 14 : 9, dt);
            _mountRep.active = _mountW > 0.004;
            _mountRep.w = _mountW;
            if (_mountRep.active) {
              for (let i = 0; i < _mountLimbs.length; i++) {
                const d = _mountLimbs[i];
                const tgt = _mountIK ? _mountIK[d.key] : null;
                const ch = d.ch;
                if (!tgt || !(_chainLenOf(ch) > 0)) { _mountRep[d.key] = -1; continue; }
                tgt.getWorldPosition(_mountTgt);
                ch.foot.updateWorldMatrix(true, false); ch.foot.getWorldPosition(_cE);
                _ikTgt.set(_cE.x + (_mountTgt.x - _cE.x) * _mountW,
                  _cE.y + (_mountTgt.y - _cE.y) * _mountW,
                  _cE.z + (_mountTgt.z - _cE.z) * _mountW);
                _solveTwoBone(ch, _ikTgt.x, _ikTgt.y, _ikTgt.z);
                ch.foot.updateWorldMatrix(true, false); ch.foot.getWorldPosition(_cE);
                _mountRep[d.key] = _cE.distanceTo(_mountTgt);
              }
            }
          } else if (_mountRep.active) { _mountRep.active = false; _mountRep.w = 0; }
        }
      },
      setState(name, opts = {}) {
        const t = sm.to(name);
        if (!t.changed) return;                             // unknown or same state → no re-fade (no pop)
        const a = actionFor(t.clip);
        if (!a) return;
        const f = opts.fade != null ? opts.fade : defaultFade;
        if (t.loopOnce) { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = true; }
        else { a.setLoop(THREE.LoopRepeat, Infinity); a.clampWhenFinished = false; }
        a.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).fadeIn(f).play();
        if (current && current !== a) current.fadeOut(f);
        current = a;
      },
      setTimeScale(s) { mixer.timeScale = s; },             // e.g. speed the walk cycle to match move speed
      _rec: rec, mixer,
      dispose() {
        mixer.stopAllAction(); mixer.uncacheRoot(object);
        const i = recs.indexOf(rec); if (i >= 0) recs.splice(i, 1);
        // geometry + material are SHARED with the source (SkeletonUtils clone) — never disposed per-handle.
      },
    };
    rec.applyLayers = handle._applyLayers;   // so rig.update() runs the layer pass right after its mixer step
    return handle;
  }

  // Step every live mixer. A rec.rate > 0 throttles that mixer to `rate` Hz (M1b's distance LOD): the
  // accumulated dt is applied in one lump when it crosses the interval, so far characters cost far less.
  function update(dt) {
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      // The layer pass runs ONLY right after an actual mixer step (with the SAME dt), so its additive
      // offsets never accumulate across skipped LOD ticks (it always follows a fresh clip pose).
      if (r.rate <= 0) { r.mixer.update(dt); if (r.applyLayers) r.applyLayers(dt); continue; }
      r.acc += dt;
      const interval = 1 / r.rate;
      if (r.acc >= interval) { const a = r.acc; r.mixer.update(a); if (r.applyLayers) r.applyLayers(a); r.acc = 0; }
    }
  }

  function dispose() {
    for (const r of recs) r.mixer.stopAllAction();
    recs.length = 0;
    if (source) source.scene.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) { const m = n.material; (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose()); } });
  }

  // A2 NIGHT FILL: lift this rig's characters off pure black at night (nf 0..1). Applies to the SHARED
  // source materials (every clone inherits them), so it's a handful of set-calls regardless of instance
  // count. A rig whose materials are overridden downstream (the horde's setType) uses horde.setNightFill.
  let _nfMats = null;
  function setNightFill(nf, opts) {
    if (!source) return;
    if (!_nfMats) _nfMats = collectMaterials(source.scene);
    for (const m of _nfMats) applyNightFill(m, nf, opts);
  }

  return { ready, spawn, update, dispose, setNightFill, get count() { return recs.length; }, get animations() { return source ? source.animations.map((a) => a.name) : []; } };
}
