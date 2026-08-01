/* ============================================================
   @lgr/engine-core — character-anim (Lesson M1a): the PURE animation STATE MACHINE.
   ------------------------------------------------------------
   Split out of createCharacterRig.js so it is node-testable without THREE (a GLTFLoader / AnimationMixer
   needs a GPU). This owns the bookkeeping the rig applies to real AnimationActions:
     • resolve a LOGICAL state (idle/walk/run/attack/hit/death) → the GLB's actual CLIP name;
     • track the current state + report whether a `to(name)` actually CHANGES it (so the rig only cross-
       fades on a real transition, never re-triggers the same clip);
     • mark which states play ONCE-and-hold (attack/hit/death) vs LOOP (idle/walk/run).

   C++ anchor: a tiny finite-state machine — a current-state field + a transition function that returns
   the edge taken (or a no-op). The heavy matrix work (blending bone poses) is the mixer's job; this just
   decides WHICH clip should be playing and whether a fade is due.
   ============================================================ */

// Default six-state mapping for the Quaternius zombie GLB (clip names verified in the file).
export const ZOMBIE_STATES = { idle: 'Idle', walk: 'Walk', run: 'Run', attack: 'Punch', hit: 'HitReact', death: 'Death' };
export const ZOMBIE_LOOP_ONCE = ['attack', 'hit', 'death'];

/* ============================================================
   A6-2 LOCOMOTION TRUTH — the pure STRIDE-RATE math (kills foot-slide).
   ------------------------------------------------------------
   "Foot slide" is a stride/speed mismatch: the walk/run CLIP plays at a fixed cadence while the BODY
   translates at gameplay speed, so the planted foot skates across the ground. The standard cheap fix (no IK):
   scale the clip's PLAYBACK RATE by (actual world speed ÷ the clip's reference stride speed). Then the foot's
   backward cadence matches the ground travel and the planted foot grips.

   refStride = the world m/s at which the clip looks PLANTED at timeScale 1 (its inherent "designed" travel
   speed — calibrated per rig with the measured slip probe, tools/hoard2-slip-probe.mjs). At world speed v the
   right playback rate is v/refStride: at v=refStride → 1× (natural), slower → the legs slow with the body,
   faster → they quicken. Clamped so a near-stop doesn't freeze the pose and a sprint doesn't judder.

   C++ anchor: a pure `float strideTimeScale(float v, float ref)` — no renderer, unit-tested; the rig just
   feeds the result to AnimationAction.setEffectiveTimeScale. ============================================================ */
export function strideTimeScale(worldSpeed, refStride, min = 0.4, max = 2.4) {
  const ref = refStride > 1e-4 ? refStride : 1e-4;             // guard /0
  const ts = (worldSpeed > 0 ? worldSpeed : 0) / ref;
  return ts < min ? min : ts > max ? max : ts;                // clamp: no frozen pose, no judder
}

export function createAnimStateMachine({ clips = ZOMBIE_STATES, loopOnce = ZOMBIE_LOOP_ONCE } = {}) {
  let current = null;
  return {
    get current() { return current; },
    resolve(name) { return clips[name] || null; },
    isLoopOnce(name) { return loopOnce.indexOf(name) !== -1; },
    // Attempt a transition. Returns { changed, ... }. changed=false for an unknown or same-state request
    // (so the rig does nothing). On a real change it returns the from/to + the clip + loop mode.
    to(name) {
      if (!clips[name]) return { changed: false, reason: 'unknown', name };
      if (name === current) return { changed: false, reason: 'same', name };
      const from = current;
      current = name;
      return { changed: true, from, to: name, clip: clips[name], loopOnce: loopOnce.indexOf(name) !== -1 };
    },
    reset() { current = null; },
  };
}
