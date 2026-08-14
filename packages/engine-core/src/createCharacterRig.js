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
      return { foot, knee, upleg, articulated, lockOn: false, lx: 0, ly: 0, lz: 0, w: 0, fx: 0, fy: 0, fz: 0 };
    };
    const _ikLegL = _legChain(B.footL);   // canonical footL (Quaternius FootL / mixamo LeftFoot)
    const _ikLegR = _legChain(B.footR);   // canonical footR
    // both feet must resolve (+ have a parent to convert against) or the rig isn't one we can plant → no-op.
    const _ikLegs = (_ikLegL.foot && _ikLegL.foot.parent && _ikLegR.foot && _ikLegR.foot.parent) ? [_ikLegL, _ikLegR] : null;
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
      setFootIK(cfg) {
        if (!cfg) { _footIK = null; if (_ikLegs) for (const lg of _ikLegs) { lg.lockOn = false; lg.w = 0; } return; }
        if (!_ikLegs) return;   // not a biped we can plant — stays a no-op
        _footIK = { plantBand: cfg.plantBand != null ? cfg.plantBand : 0.14, lockRate: cfg.lockRate != null ? cfg.lockRate : 18, unlockRate: cfg.unlockRate != null ? cfg.unlockRate : 12, maxStride: cfg.maxStride != null ? cfg.maxStride : 0.55, kneeFollow: cfg.kneeFollow !== false };
      },
      // A7-2: the horde's distance LOD toggles this — foot IK only runs on near characters (skip the solver
      // + its updateWorldMatrix cost beyond the IK distance; far feet aren't legible anyway).
      setFootIKActive(on) { _footIKActive = !!on; },
      // A1: clear the anim state so a RECYCLED pool slot re-arms cleanly. The horde's setActive(i,false) calls
      // mixer.stopAllAction() (stops the loco actions) but the handle is reused — without this reset _locoOn
      // stays true and the next setLocomotion just sets weights on STOPPED actions → the respawn freezes in
      // bind pose. Resetting _locoOn makes the next setLocomotion rebuild+replay the blend from scratch.
      resetAnim() { _locoOn = false; _locoSpeed = 0; _locoShown = 0; _actActive = false; _actAction = null; _actClip = null; _actW = 0; if (_poseAction) _poseAction.stop(); _poseAction = null; _poseClip = null; _poseWant = 0; _poseW = 0; aimW = 0; _aimActive = false; _headingTarget = null; if (_ikLegs) { for (const lg of _ikLegs) { lg.lockOn = false; lg.w = 0; } _ikFloorY = null; } },
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
          const wantRelax = (!_aimActive && !_actActive && _locoSpeed < 0.08) ? 1 : 0;
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
          // leaky-min contact floor: on the flat arena it converges to the stance height; it can only rise
          // slowly (0.5 m/s) so a lifted-both-feet frame never sticks the floor high. No terrain raycast (A3: flat).
          if (_ikFloorY == null) _ikFloorY = minFootY;
          else _ikFloorY = Math.min(minFootY, _ikFloorY + 0.5 * dt);
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
