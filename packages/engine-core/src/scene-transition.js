/* ============================================================
   @lgr/engine-core — scene-transition.js (Lesson 60): a reusable "dive" between two render sources.
   ------------------------------------------------------------
   Generalized out of the L19 city↔office dive. A transition between TWO render sources A and B — the
   from-scene zooms toward a focus point while the to-scene resolves, selling "I flew through that
   window" with zero camera-path code (see post-dive.frag). NOTHING here knows about city/office: any
   consumer that renders two scenes to two screen-sized targets can drive it — the city dive is just the
   first, with Hoard iso↔FPS / a showcase zoom / John's game as future consumers.

   OWNERSHIP: this module owns the eased progress `t`, the 4-state machine (a → in → b → out → a), and the
   crossfade+focus material. The CONSUMER owns the two render targets (they're screen-sized + resize with
   the canvas) and the present step: each frame it renders scene A → texA, scene B → texB, then runPass(s
   .material) to the screen during a transition (and just renders A or B straight when not transitioning).

   C++ anchor: a generic compositor template parameterized on two "scenes" instead of a hard-coded
   city/office pair; the mode machine is the same enum+transition, now owned by the module not the app.
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from './shaders/fullscreen.vert';
import postDiveFrag from './shaders/post-dive.frag';

/* createSceneTransition({ rate }) — `rate` is the exponential-ease speed (4.6 ≈ a ~1s cross, the L19 feel).
   Returns:
     • material            — the fullscreen ShaderMaterial (uA, uB, uFocus, uT); runPass it to present the mix
     • setSources(a, b)    — bind the two source TEXTURES (call once; safe across resize since RT.setSize keeps
                             the same .texture object)
     • enter(focusUv)      — begin diving A→B toward focusUv (a THREE.Vector2 in screen UV). No-op unless at A.
     • exit()              — begin diving back B→A. No-op unless at B / mid-dive-in.
     • update(dt)          — advance the ease + state machine; sets uT; returns the current mode.
     • mode / t            — getters; `transitioning` true while 'in' or 'out'.
   Modes: 'a' (fully source A) · 'in' (A→B) · 'b' (fully source B) · 'out' (B→A). */
export function createSceneTransition({ rate = 4.6 } = {}) {
  const material = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: postDiveFrag,
    uniforms: {
      uA: { value: null }, uB: { value: null },
      uT: { value: 0 }, uFocus: { value: new THREE.Vector2(0.5, 0.5) },
    },
  });
  let mode = 'a';        // 'a' | 'in' | 'b' | 'out'
  let t = 0;             // eased progress 0 (A) ↔ 1 (B) — the shader cubic-eases this further

  function setSources(texA, texB) { material.uniforms.uA.value = texA; material.uniforms.uB.value = texB; }
  function enter(focusUv) {
    if (mode !== 'a') return false;
    if (focusUv) material.uniforms.uFocus.value.copy(focusUv);
    mode = 'in'; return true;
  }
  function exit() {
    if (mode !== 'b' && mode !== 'in') return false;
    mode = 'out'; return true;
  }
  function snap(which) {
    // jump INSTANTLY to fully-A or fully-B (no transition) — for booting straight into a scene (e.g. a
    // ?office= deep-link / demo capture). 'b' → at source B, t=1; anything else → at source A, t=0.
    mode = (which === 'b') ? 'b' : 'a';
    t = (which === 'b') ? 1 : 0;
    material.uniforms.uT.value = t;
  }
  function update(dt) {
    // exponential ease toward the goal (1 while heading to/at B, 0 while heading to/at A), then snap the
    // endpoints so the state settles — IDENTICAL math + thresholds to the L19 inline dive (kept the feel).
    const goal = (mode === 'b' || mode === 'in') ? 1 : 0;
    t += (goal - t) * Math.min(1, dt * rate);
    if (mode === 'in' && t > 0.992) { t = 1; mode = 'b'; }
    if (mode === 'out' && t < 0.008) { t = 0; mode = 'a'; }
    material.uniforms.uT.value = t;
    return mode;
  }

  return {
    material, setSources, enter, exit, update, snap,
    get mode() { return mode; },
    get t() { return t; },
    get transitioning() { return mode === 'in' || mode === 'out'; },
  };
}
