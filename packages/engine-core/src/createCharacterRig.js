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
import { createAnimStateMachine, ZOMBIE_STATES, ZOMBIE_LOOP_ONCE } from './character-anim.js';
import { flinchEnvelope, headYawDelta } from './character-layers.js';
import { damp } from './math.js';

// Beauty B3 — PROCEDURAL MOTION LAYERS. Additive rotations applied to named bones AFTER the mixer poses
// them from the clip, turning the clip-PLAYER into a motion SYSTEM. The bone names are the Quaternius /
// mixamo family (Head, Spine1/2, LeftArm/RightArm — local Y runs UP each bone, so a local-Y twist yaws the
// head and a local-X twist bends the spine). Module-level scratch — _applyLayers runs synchronously per
// handle, never re-entrant, so one shared set is safe + alloc-free (engine-invariants #7).
const _q = new THREE.Quaternion();
const _eu = new THREE.Euler(0, 0, 0, 'YXZ');
const _AX_Y = new THREE.Vector3(0, 1, 0);
const _AX_X = new THREE.Vector3(1, 0, 0);
const _AX_Z = new THREE.Vector3(0, 0, 1);
// Default per-type layer personality. Consumers override via handle.setLayerParams / horde.setLayerParams.
export const LAYER_DEFAULTS = {
  headLook: { cone: 1.2, speed: 6, weight: 1 },      // cone rad · damp rate · how much of the turn to apply
  hitReact: { amp: 1, dur: 0.4, lean: 0.5, arm: 0.7 }, // impulse gain · seconds · spine lean rad · arm fling rad
};

export function createCharacterRig({ url, gltf, states, loopOnce, fade } = {}) {
  const STATES = states || ZOMBIE_STATES;
  const LOOP_ONCE = loopOnce || ZOMBIE_LOOP_ONCE;
  const defaultFade = fade != null ? fade : 0.22;
  let source = gltf || null;
  const recs = [];   // { mixer, rate, acc } per live character

  const ready = source ? Promise.resolve(source) : new GLTFLoader().loadAsync(url).then((g) => (source = g));

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
    const boneHead = bones.Head || null, boneNeck = bones.Neck || null;
    const boneSpine = bones.Spine2 || bones.Spine1 || bones.Spine || null;
    const boneArmL = bones.LeftArm || null, boneArmR = bones.RightArm || null;
    let lookTarget = null;             // {x,y,z} or null (null = no head-look → layer idle, zero cost)
    let headYaw = 0;                   // the smoothed applied head-turn (rad), eased toward the desired
    let flinchT = -1, flinchSign = 0;  // hit-react timer (-1 = inactive) + which side the hit came from
    const lp = { headLook: { ...LAYER_DEFAULTS.headLook }, hitReact: { ...LAYER_DEFAULTS.hitReact } };

    const handle = {
      object,
      position: object.position, quaternion: object.quaternion, scale: object.scale,
      get state() { return sm.current; },
      // ---- B3 procedural-layer API (all opt-in; unused → the layer pass is a no-op) ----
      setLookTarget(x, y, z) { if (!lookTarget) lookTarget = { x: 0, y: 0, z: 0 }; lookTarget.x = x; lookTarget.y = y; lookTarget.z = z; },
      clearLookTarget() { lookTarget = null; },
      hitReact(dx = 0, dz = 0) {
        flinchT = 0;                                    // (re)start the impulse
        _eu.setFromQuaternion(object.quaternion, 'YXZ');
        const cy = _eu.y, side = Math.cos(cy) * dx - Math.sin(cy) * dz;  // >0 = hit came from the right
        flinchSign = side >= 0 ? 1 : -1;
      },
      setLayerParams(p = {}) { if (p.headLook) Object.assign(lp.headLook, p.headLook); if (p.hitReact) Object.assign(lp.hitReact, p.hitReact); },
      // Run AFTER a mixer step (the mixer reset the bones to the clip pose, so we multiply ONE fresh offset
      // — never accumulating). The caller (rig.update / horde.update) only calls this when the mixer stepped.
      _applyLayers(dt) {
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

  return { ready, spawn, update, dispose, get count() { return recs.length; }, get animations() { return source ? source.animations.map((a) => a.name) : []; } };
}
