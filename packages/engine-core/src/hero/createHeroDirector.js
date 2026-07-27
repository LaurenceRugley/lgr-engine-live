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

   Opus-refuted invariants (MUST NOT change). #1/#2/#6 are now ENFORCED IN createBeautyPresenter (the
   shared beauty-present this director drives) — they still hold verbatim, just one file over:
     1. Scenes render into beautyRT (HalfFloat MSAA) — NEVER sceneRT (8-bit).
     2. presenter.present sets ALL filmic uniforms EVERY frame, including uRays=0
        (godrays reads the wrong camera — skip unconditionally for hero packs).
     3. ⚠️ THIS INVARIANT WAS A LIE, AND IT SHIPPED FOR SEVEN LESSONS (corrected L-U).
        It used to read: "sunRig.goTo(0.75) once at init — bloom + warm grade come free by-ref."
        THE TRUTH: `sunRig.goTo(t)` only assigns `goalT` (sun-rig.js:240). Nothing reads `goalT`
        except `sunRig.update(dt)` (sun-rig.js:246-248) — and THIS DIRECTOR NEVER CALLS update().
        So goTo() here is inert: the rig stays exactly where createEngineCore seeded it,
        `createSunRig({ t: 0.5 })` = NOON, whose gradeTint is #d6e6f4 — a COOL BLUE, not a warm dusk.
        The whole hero ring has always been graded at noon. (Verified from source AND at runtime:
        the consumer-probe prints the live rig tint, and it reads #d6e6f4.)
        Consequences that were paid without anyone knowing: Lattice fought a cold cast it couldn't
        escape (L-R), Product Moment pre-warms its sweep to compensate (createProductMoment.js:27),
        and the `sunT` option below does nothing at all (see it).
        WHAT THIS COMMENT DOES *NOT* DO: change the grade. Making the ring actually warm re-grades all
        8 scenes at once — an owner taste call, deliberately not taken here. This lesson only stops the
        file from lying about what it does.
     4. Transitions reuse createSceneTransition with uZoom=0 (calm crossfade).
     5. Each pack's dispose() owns its own geometries/materials/textures/RTs.
     6. (L-S) A pack may override the grade's INPUTS via `filmic`; the override swaps the uniform's
        pointer and must NEVER write through it — uGradeTint.value IS sunRig.grade.tint. (In
        createBeautyPresenter now; each consumer gets its own presenter instance = its own _graded.)
   ============================================================ */
import * as THREE from 'three';
import { createSceneTransition } from '../scene-transition.js';
import { createRing, shouldAutoAdvance, disposeAll } from './hero-ring.js';
import { createBeautyPresenter } from './createBeautyPresenter.js';

export function createHeroDirector(core, {
  scenes,
  dwell        = 18_000,   /* ms: how long to show each scene before auto-advancing */
  transitionMs = 1_200,    /* ms: crossfade duration */
  /* ⚠️ INERT — this option currently does NOTHING (see invariant 3, and L-U item 2).
     It was introduced in L-N as "the sun-grade the whole ring is lit + graded at", and it has never
     done that. It is passed to `sunRig.goTo()`, which only sets `goalT`; `goalT` is read ONLY by
     `sunRig.update(dt)`, which this director never calls. So every value of `sunT` — 0.0, 0.5, 0.75 —
     produces the identical result: the rig stays at the core's boot time (noon).
     It is kept (rather than deleted) because it is the exact seam that a future "pick the ring's grade"
     lesson will wire, and deleting it would just churn the two example consumers that pass it. It is NOT
     kept silently: constructing with a value that cannot take effect logs a loud warning below, and the
     dead-option rule (no silent no-ops) is satisfied by that + this comment.
     To WIRE it, the rig must be advanced to the goal (sun-rig has no snap verb — `update()` damps toward
     it) — and that re-grades all 8 scenes, which is the owner taste call this lesson is not making. */
  sunT         = 0.75,
} = {}) {
  if (!scenes || scenes.length === 0) {
    throw new Error('createHeroDirector: scenes must be a non-empty array');
  }

  const {
    sunRig,
    drawBuffer,
    runPass,           // still ours: the final crossfade composite of the two capture RTs -> screen
    registerContentResizer,
    frameStart,
    frameEnd,
  } = core;
  /* The beauty-present path (render pack -> beautyRT -> bloom -> filmic -> target, + the per-pack
     grade pointer-swap) is now the SHARED createBeautyPresenter — one instance per director (its own
     _graded dirty state, exactly as the inlined copy had). renderer/filmicMaterial/bloomPass/beautyRT
     moved with it, so they are no longer destructured here. */
  const presenter = createBeautyPresenter(core);

  /* K0.3 (corrected L-U): this SETS A GOAL THE RIG NEVER WALKS TO — see invariant 3. It is left in
     place because it is harmless and is the seam a future grade lesson wires; it is not left silent.
     FAIL LOUD (Rule 12): if a caller passes a sunT the rig will not actually adopt, say so. Reading
     `sunRig.t` gives the rig's REAL current time, so this compares intent against reality rather than
     against a hard-coded assumption — it will start passing by itself the day someone wires update(). */
  sunRig.goTo(sunT);
  if (typeof console !== 'undefined' && Math.abs(sunRig.t - sunT) > 1e-3) {
    console.warn(
      `[createHeroDirector] sunT=${sunT} has NO EFFECT: the rig is at t=${sunRig.t.toFixed(3)} and this ` +
      `director never calls sunRig.update(), so goTo() only sets a goal nothing reads. The ring is graded ` +
      `at the core's boot time. See invariant 3 in createHeroDirector.js.`);
  }

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

  /* ─── L-S: THE PER-SCENE GRADE SEAM + the beauty-present — now in createBeautyPresenter ─────
     `presenter.present(pack, target)` renders a pack through the full beauty pipeline (beautyRT ->
     bloom -> filmic -> target) and applies that pack's optional `filmic` grade override via the
     by-ref pointer-swap (invariant #6). ALL of that logic — the WHY-not-uGrade=0 reasoning, the
     by-ref trap, and the byte-identical-by-construction dirty flag — lives in createBeautyPresenter.js
     now; the director just drives it. This director owns its OWN presenter instance so its _graded
     dirty state never crosses a wipe's. Each pack is graded into its own capture RT before the
     transition shader lerps them, so a graded<->neutral crossfade is a lerp between two already-
     correct images — no shared grade state left to "pop". */

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
    presenter.present(firstPack, null);
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
      presenter.present(fp,          transA);  // from-scene → transA
      presenter.present(currentPack, transB);  // to-scene   → transB
      runPass(transition.material, null);   // crossfade  → screen
    } else {
      /* Settled (mode='a' or mode='b'): render current pack straight to screen. */
      presenter.present(currentPack, null);

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
