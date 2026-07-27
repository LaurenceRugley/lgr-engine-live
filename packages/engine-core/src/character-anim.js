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
