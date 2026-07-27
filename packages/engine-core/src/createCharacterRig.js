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
    const rec = { mixer, rate: 0, acc: 0 };                 // rate 0 = every frame (M1b sets a LOD rate)
    recs.push(rec);
    const handle = {
      object,
      position: object.position, quaternion: object.quaternion, scale: object.scale,
      get state() { return sm.current; },
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
    return handle;
  }

  // Step every live mixer. A rec.rate > 0 throttles that mixer to `rate` Hz (M1b's distance LOD): the
  // accumulated dt is applied in one lump when it crosses the interval, so far characters cost far less.
  function update(dt) {
    for (let i = 0; i < recs.length; i++) {
      const r = recs[i];
      if (r.rate <= 0) { r.mixer.update(dt); continue; }
      r.acc += dt;
      const interval = 1 / r.rate;
      if (r.acc >= interval) { r.mixer.update(r.acc); r.acc = 0; }
    }
  }

  function dispose() {
    for (const r of recs) r.mixer.stopAllAction();
    recs.length = 0;
    if (source) source.scene.traverse((n) => { if (n.geometry) n.geometry.dispose(); if (n.material) { const m = n.material; (Array.isArray(m) ? m : [m]).forEach((x) => x.dispose()); } });
  }

  return { ready, spawn, update, dispose, get count() { return recs.length; }, get animations() { return source ? source.animations.map((a) => a.name) : []; } };
}
