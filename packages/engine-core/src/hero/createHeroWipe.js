/* ============================================================
   @lgr/engine-core — createHeroWipe (Lesson: cinematic screen-space wipes).
   ------------------------------------------------------------
   A reusable TRANSITION module: cinematic wipes between two hero scene packs. Sibling to
   createSceneTransition (the L60 "dive": a 3D fly-through that zooms A into B) — this one is a 2D
   SCREEN-SPACE composite that reveals B through a moving cell pattern (fade / ash / honeycomb /
   halftone). Both are compositors over two rendered scenes, and remain deliberately NOT merged (the
   dive vs the wipe are different transitions) — but the beauty-present half they once each duplicated
   IS now shared: see below.

   ── WHAT IT OWNS vs the consumer ──
   OWNS: two half-res capture targets, the wipe material (hero-wipe.frag), the progress state
   machine (wipe-machine.js). It renders each pack through core's beauty pipeline via the SHARED
   createBeautyPresenter, so a CONSUMER never has to touch beautyRT / bloom / filmic (engine
   internals). The consumer just owns its RAF loop and calls update(dt, elapsed) once a frame.

   ── THE BEAUTY-PRESENT (now shared) ──
   Rendering a pack through beauty (beautyRT -> bloom -> filmic -> target, with the per-pack grade
   pointer-swap) used to be duplicated here and in createHeroDirector. It was EXTRACTED into
   createBeautyPresenter(core) — one seam both drive, byte-identical to the old inlined copies (proven
   by a deterministic pre/post fingerprint on both consumers). This wipe holds its own presenter
   instance so its grade dirty-state never crosses the director's. All the invariants (#1 beautyRT
   HalfFloat, #2 all filmic uniforms every call, uRays=0 for hero, #6 the by-ref grade trap) live in
   the presenter now.

   Contract:
     createHeroWipe(core, opts) -> {
       setScene(pack),                              // set the resting scene shown when idle
       transition(fromPack, toPack, opts) -> Promise,  // begin a wipe; resolves when it completes
       update(dt, elapsed),                          // drive from the consumer RAF (dt seconds)
       dispose(),
       material, get t, get mode, get transitioning   // introspection for probes/tests
     }

   C++ anchor: a Compositor object holding two off-screen framebuffers and a shader program; the
   Promise from transition() is a std::future<void> that becomes ready on the frame the wipe lands.
   ============================================================ */
import * as THREE from 'three';
import fullscreenVert from '../shaders/fullscreen.vert';
import heroWipeFrag from '../shaders/hero-wipe.frag';
import { resolveModeId, applyReducedMotion, createWipeMachine } from './wipe-machine.js';
import { createBeautyPresenter } from './createBeautyPresenter.js';

export function createHeroWipe(core, {
  transScale  = 0.5,        // capture RTs at half-res (matches the director; a wipe is transient)
  cell        = 30,         // default cell DENSITY: cells across the aspect-corrected frame
  band        = 0.35,       // width of the sweeping dither/ramp band (progress units)
  direction   = [1, 1],     // wipe direction (diagonal by default)
} = {}) {
  const { drawBuffer, runPass, registerContentResizer } = core;
  /* The beauty-present path (render pack -> beautyRT -> bloom -> filmic -> target, + the per-pack
     grade pointer-swap) is the SHARED createBeautyPresenter, one instance per wipe (its own _graded
     dirty state). runPass stays destructured — the wipe still owns the final composite of the two
     captures to screen. */
  const presenter = createBeautyPresenter(core);

  /* ── the wipe material ── a fullscreen pass sampling the two capture targets. */
  const material = new THREE.ShaderMaterial({
    vertexShader: fullscreenVert,
    fragmentShader: heroWipeFrag,
    uniforms: {
      uA:       { value: null },
      uB:       { value: null },
      uT:       { value: 0 },
      uMode:    { value: 0 },
      uDensity: { value: cell },
      uBand:    { value: band },
      uDir:     { value: new THREE.Vector2(direction[0], direction[1]) },
      uAspect:  { value: drawBuffer.x / Math.max(drawBuffer.y, 1) },
    },
    depthTest: false,
    depthWrite: false,
  });

  /* ── two half-res HalfFloat capture RTs (the transA/transB pattern) ── each holds one pack's
     beauty-graded (SDR 0..1) render; the wipe shader lerps between them. LinearFilter so the
     half-res upscale to screen is soft, not blocky. */
  const _tw = () => Math.max(1, Math.floor(drawBuffer.x * transScale));
  const _th = () => Math.max(1, Math.floor(drawBuffer.y * transScale));
  const rtOpts = {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false, type: THREE.HalfFloatType,
  };
  const capA = new THREE.WebGLRenderTarget(_tw(), _th(), rtOpts);
  const capB = new THREE.WebGLRenderTarget(_tw(), _th(), rtOpts);
  material.uniforms.uA.value = capA.texture;   // RT.setSize keeps the same .texture, so bind once
  material.uniforms.uB.value = capB.texture;

  registerContentResizer((db) => {
    capA.setSize(Math.max(1, Math.floor(db.x * transScale)), Math.max(1, Math.floor(db.y * transScale)));
    capB.setSize(Math.max(1, Math.floor(db.x * transScale)), Math.max(1, Math.floor(db.y * transScale)));
    for (const pack of [_current, _from, _to]) {
      if (pack && pack.camera && pack.camera.isPerspectiveCamera) {
        pack.camera.aspect = db.x / db.y;
        pack.camera.updateProjectionMatrix();
      }
    }
  });

  /* ── state ── */
  const machine = createWipeMachine();
  let _current = null;   // resting scene (shown when idle)
  let _from = null, _to = null;
  let _resolve = null;   // completion resolver for the in-flight transition
  let _elapsed = 0;      // seconds, forwarded to pack.update as the animation clock

  const reducedMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  function setScene(pack) { _current = pack; }

  /* transition(fromPack, toPack, opts) — begin a wipe A->B. Returns a Promise that resolves on the
     frame the wipe completes. If one is already running it is FINISHED instantly (snap to its
     destination + resolve its promise) before the new one starts — no overlap, no dropped resolver. */
  function transition(fromPack, toPack, opts = {}) {
    if (machine.active && _resolve) { _finishInto(_to); }

    const eff = applyReducedMotion(opts, reducedMotion);      // WCAG: geometric wipe -> gentle fade
    const modeId = resolveModeId(eff.mode ?? 'fade');         // throws on a bad name (fail loud)
    material.uniforms.uMode.value    = modeId;
    material.uniforms.uDensity.value = eff.cell ?? cell;
    material.uniforms.uBand.value    = eff.band ?? band;
    if (eff.direction) material.uniforms.uDir.value.set(eff.direction[0], eff.direction[1]);

    _from = fromPack;
    _to = toPack;
    _current = fromPack;
    machine.start(eff.duration ?? 1200);
    material.uniforms.uT.value = 0;

    return new Promise((res) => { _resolve = res; });
  }

  function _finishInto(pack) {
    machine.finish();
    _current = pack;
    _from = _to = null;
    const r = _resolve; _resolve = null;
    if (r) r();
  }

  /* update(dt, elapsed) — call once per frame from the consumer RAF. dt in SECONDS, elapsed the
     running clock (also seconds) forwarded to pack.update for their own animation. No allocation
     in here: all uniforms + scratch are mutated in place (invariant: no per-frame hot alloc). */
  function update(dt, elapsed) {
    _elapsed = elapsed ?? (_elapsed + dt);
    material.uniforms.uAspect.value = drawBuffer.x / Math.max(drawBuffer.y, 1);

    if (machine.active) {
      /* Mid-wipe: animate BOTH packs, render each to its capture RT, composite to screen. */
      _from.update(dt, _elapsed);
      _to.update(dt, _elapsed);
      presenter.present(_from, capA);
      presenter.present(_to, capB);
      const step = machine.advance(dt * 1000);   // machine works in ms
      material.uniforms.uT.value = step.t;
      runPass(material, null);
      if (step.justFinished) _finishInto(_to);
    } else if (_current) {
      /* Idle: just present the resting scene straight to screen. */
      _current.update(dt, _elapsed);
      presenter.present(_current, null);
    }
  }

  function dispose() {
    capA.dispose();
    capB.dispose();
    material.dispose();
    // Packs are owned by the consumer (they may outlive the wipe / be reused) — NOT disposed here.
  }

  return {
    setScene, transition, update, dispose, material,
    get t()             { return machine.t; },
    get transitioning() { return machine.active; },
    get mode()          { return material.uniforms.uMode.value; },
  };
}
