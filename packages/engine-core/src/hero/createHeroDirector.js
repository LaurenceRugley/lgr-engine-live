/* ============================================================
   @lgr/engine-core — createHeroDirector (Lesson K0)
   ------------------------------------------------------------
   The load-bearing seam for the Hero Scenes system. Owns the RAF
   loop, the dwell timer, scene transitions, and the beauty pipeline.

   C++ anchor: a game-loop Manager that owns a ring-buffer of Scene
   objects and a Compositor for crossfading between them. The RAF is
   the game loop; packs are polymorphic scene objects.

   K0 contract:
     createHeroDirector(core, { scenes, dwell?, transitionMs? })
       → { next, prev, goTo(i), dispose, currentIndex, transitioning }
     scenes: Array of packs — each { scene, camera, update(dt,elapsed), dispose(), usesBloom? }
     dwell:        ms a scene is shown before auto-advance (default 18 000)
     transitionMs: crossfade duration in ms (default 1 200)

   Opus-refuted invariants (MUST NOT change):
     1. Scenes render into beautyRT (HalfFloat MSAA) — NEVER sceneRT (8-bit).
     2. presentBeauty sets ALL filmic uniforms EVERY frame, including uRays=0
        (godrays reads the wrong camera — skip unconditionally for hero packs).
     3. sunRig.goTo(0.75) once at init — bloom + warm grade come free by-ref.
     4. Transitions reuse createSceneTransition with uZoom=0 (calm crossfade).
     5. Each pack's dispose() owns its own geometries/materials/textures/RTs.
   ============================================================ */
import * as THREE from 'three';
import { createSceneTransition } from '../scene-transition.js';
import { createRing, shouldAutoAdvance, disposeAll } from './hero-ring.js';

export function createHeroDirector(core, {
  scenes,
  dwell        = 18_000,   /* ms: how long to show each scene before auto-advancing */
  transitionMs = 1_200,    /* ms: crossfade duration */
  sunT         = 0.75,     /* L-N re-skin: the sun-grade the whole ring is lit + graded at.
                              Default 0.75 = dusk (byte-identical). A client build passes its own
                              (e.g. 0.5 noon for a bright product ring, 0.0 night for noir). */
} = {}) {
  if (!scenes || scenes.length === 0) {
    throw new Error('createHeroDirector: scenes must be a non-empty array');
  }

  const {
    renderer,
    sunRig,
    drawBuffer,
    filmicMaterial,
    runPass,
    bloomPass,
    beautyRT,
    registerContentResizer,
    frameStart,
    frameEnd,
  } = core;

  /* K0.3: Sun positioned once — bloom + warm grade arrive by-ref automatically
     (filmicMaterial.uniforms.uGradeTint/uGradeLift are bound to sunRig.grade at init).
     L-N: the grade point is now the `sunT` option (default 0.75 dusk → byte-identical). */
  sunRig.goTo(sunT);

  /* WCAG 2.3.3 — animation from interactions: if reduced-motion is requested,
     the director shows the first scene statically and never auto-advances.
     The API (next/prev/goTo) still works for manual navigation (no transitions). */
  const reducedMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* Ring — circular index over scenes; next/prev/goTo track the active scene. */
  const ring = createRing(scenes.length);

  /* Transition — single pairwise crossfade machine, calm (uZoom=0, no dive zoom).
     rate = ln(1/threshold) / seconds ≈ 4600ms / transitionMs (same math as the L19 feel). */
  const transition = createSceneTransition({ rate: 4600 / transitionMs });
  transition.setZoom(0);  // 0 = calm crossfade (no post-dive zoom)

  /* Director-owned RTs for transition compositing.
     These receive the filmic-processed (SDR 0-1) output of each pack.
     HalfFloat matches beautyRT quality; no MSAA needed here (post-processed input).
     L-O PERF: rendered at HALF resolution. A transition renders BOTH packs into these every frame for
     1.2 s (~2.2× fill); at half-res that fill drops ~4×. The crossfade shader samples them with LinearFilter,
     so the only visual effect is a slight softening of the 1.2 s crossfade — a taste call verified on the
     beauty tier by eye + mid-transition captures (the one deliberate visual deviation this lesson allows;
     settled frames are UNCHANGED — they present the pack straight to screen, not through transA/B). */
  const _transScale = 0.5;
  const _tw = () => Math.max(1, Math.floor(drawBuffer.x * _transScale));
  const _th = () => Math.max(1, Math.floor(drawBuffer.y * _transScale));
  const transA = new THREE.WebGLRenderTarget(_tw(), _th(), {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
    type: THREE.HalfFloatType,
  });
  const transB = new THREE.WebGLRenderTarget(_tw(), _th(), {
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    depthBuffer: false, stencilBuffer: false,
    type: THREE.HalfFloatType,
  });

  /* Bind transition sources once — RT.setSize() keeps the same .texture object
     across resize, so these refs are stable for the lifetime of the director. */
  transition.setSources(transA.texture, transB.texture);

  /* Update all pack cameras' aspect + transition RTs on resize (transition RTs stay half-res). */
  registerContentResizer((db) => {
    transA.setSize(Math.max(1, Math.floor(db.x * _transScale)), Math.max(1, Math.floor(db.y * _transScale)));
    transB.setSize(Math.max(1, Math.floor(db.x * _transScale)), Math.max(1, Math.floor(db.y * _transScale)));
    for (const pack of scenes) {
      if (pack.camera && pack.camera.isPerspectiveCamera) {
        pack.camera.aspect = db.x / db.y;
        pack.camera.updateProjectionMatrix();
      }
    }
  });

  /* ─── presentBeauty ─────────────────────────────────────────────────────────
     Renders one pack through the full beauty pipeline and composites to target.
     target = null → screen; target = transA/transB → transition capture RT.

     Invariant: sets ALL filmic uniforms EVERY call.
       uScene = beautyRT.texture   (HalfFloat HDR scene)
       uAces  = 1                  (ACES compresses HDR highlights; no clipping)
       uDither = 1                 (banding-free in HalfFloat→8-bit conversion)
       uGrade = 1                  (warm dusk grade via sunRig.grade, by-ref)
       uRays  = 0                  (godraysPass reads rig.camera — wrong camera for hero packs)
  ─────────────────────────────────────────────────────────────────────────── */
  function presentBeauty(pack, target) {
    /* 1. Render pack into beautyRT (HalfFloat MSAA — invariant #1). */
    renderer.setRenderTarget(beautyRT);
    renderer.render(pack.scene, pack.camera);

    /* 2. Bloom — brightens crests (>0.78 in HalfFloat) and patches filmicMaterial.
          bloomPass writes uBloom + uBloomStrength. Skip → set uBloomStrength = 0. */
    if (pack.usesBloom) {
      bloomPass(beautyRT);
    } else {
      filmicMaterial.uniforms.uBloomStrength.value = 0;
    }

    /* 3. Set ALL filmic uniforms (invariant #2). */
    filmicMaterial.uniforms.uScene.value        = beautyRT.texture;
    filmicMaterial.uniforms.uAces.value         = 1;
    filmicMaterial.uniforms.uDither.value       = 1;
    filmicMaterial.uniforms.uGrade.value        = 1;
    filmicMaterial.uniforms.uRays.value         = 0;  // skip godrays for hero

    /* 4. Composite (null → screen; RT → capture for crossfade). */
    runPass(filmicMaterial, target);
  }

  /* ─── Transition trigger ────────────────────────────────────────────────── */
  const centerUv = new THREE.Vector2(0.5, 0.5);  // focus center (calm; no dive point)
  let fromIdx = 0;   // source scene index during a crossfade
  let elapsed = 0;   // ms since last scene settled (for dwell auto-advance)

  function startTransition(newIdx) {
    if (newIdx === ring.current) return;  // no-op if already there
    fromIdx = ring.current;              // capture BEFORE advancing ring
    ring.goTo(newIdx);
    transition.snap('a');                // reset state machine cleanly (no stale ease)
    transition.enter(centerUv);         // mode → 'in', begin easing t 0→1
    elapsed = 0;                         // reset dwell timer for the new scene
  }

  /* ─── Public navigation API ─────────────────────────────────────────────── */
  function next() { startTransition((ring.current + 1) % scenes.length); }
  function prev() { startTransition((ring.current - 1 + scenes.length) % scenes.length); }
  function goTo(i) {
    if (i < 0 || i >= scenes.length) throw new RangeError(`goTo(${i}) out of range`);
    startTransition(i);
  }

  /* ─── Reduced-motion path: one static frame, no RAF ─────────────────────── */
  if (reducedMotion) {
    const firstPack = scenes[0];
    firstPack.update(0, 0);  // static — uTime stays 0
    presentBeauty(firstPack, null);
    /* Navigator still works — manual triggers snap-cut (no transition animation). */
    return {
      next, prev, goTo,
      dispose() { disposeAll(scenes); transA.dispose(); transB.dispose(); transition.material.dispose(); },
      get currentIndex() { return ring.current; },
      get transitioning() { return false; },
      /* L-N: the current scene's declared tone ('dark'|'bright') — lets a site drive per-scene
         chrome (e.g. text colour over the hero) off the SCENE CONTRACT, not a hard-coded index. */
      get currentTone() { return scenes[ring.current].tone; },
    };
  }

  /* ─── RAF loop ──────────────────────────────────────────────────────────── */
  let rafId    = null;
  let prevTime = null;   // null = first frame (dt = 0 to avoid spike)
  let disposed = false;

  function tick(now) {
    rafId = requestAnimationFrame(tick);

    if (core.paused || core.contextLost) {
      prevTime = null;  // discard stale timestamp so dt=0 on resume
      return;
    }

    const dt = prevTime !== null ? (now - prevTime) * 0.001 : 0;  // seconds
    prevTime = now;
    elapsed += dt * 1000;   // dwell timer in ms

    frameStart();

    const currentPack = scenes[ring.current];

    /* Always update the current (destination) pack — its uTime drives the silk wave. */
    currentPack.update(dt, now * 0.001);

    /* Advance the transition state machine (exponential ease t 0↔1). */
    const tMode = transition.update(dt);

    if (tMode === 'in' || tMode === 'out') {
      /* Mid-crossfade: both packs animate; render each to a capture RT, then composite. */
      const fp = scenes[fromIdx];
      fp.update(dt, now * 0.001);
      presentBeauty(fp,          transA);  // from-scene → transA
      presentBeauty(currentPack, transB);  // to-scene   → transB
      runPass(transition.material, null);   // crossfade  → screen
    } else {
      /* Settled (mode='a' or mode='b'): render current pack straight to screen. */
      presentBeauty(currentPack, null);

      /* Auto-advance: only when settled, single scene can't advance. */
      if (scenes.length > 1 && shouldAutoAdvance(reducedMotion, dwell, elapsed)) {
        next();
      }
    }

    frameEnd();
  }

  /* visibilitychange — pause/resume (WCAG: also prevents background tab GPU drain). */
  function onVisibilityChange() {
    core.setActive(document.visibilityState === 'visible');
    if (document.visibilityState === 'visible') prevTime = null;
  }
  document.addEventListener('visibilitychange', onVisibilityChange);

  /* Start RAF. */
  rafId = requestAnimationFrame(tick);

  /* ─── dispose ───────────────────────────────────────────────────────────── */
  function dispose() {
    if (disposed) return;
    disposed = true;
    if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
    document.removeEventListener('visibilitychange', onVisibilityChange);
    /* Director-owned RTs + transition material. */
    transA.dispose();
    transB.dispose();
    transition.material.dispose();
    /* Each pack owns its own geometries + materials (invariant #5). */
    disposeAll(scenes);
  }

  return {
    next, prev, goTo, dispose,
    get currentIndex()  { return ring.current; },
    get transitioning() { return transition.transitioning; },
    /* L-N: current scene's tone ('dark'|'bright') off the scene contract — kills index coupling. */
    get currentTone()   { return scenes[ring.current].tone; },
  };
}
