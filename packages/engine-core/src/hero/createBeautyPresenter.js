/* ============================================================
   @lgr/engine-core — createBeautyPresenter (extracted lesson).
   ------------------------------------------------------------
   The ONE beauty-present path for hero packs, shared by createHeroDirector AND createHeroWipe. Both
   carried a byte-identical copy of "render a pack through the beauty pipeline into a target, with the
   per-pack grade override"; this extraction makes it a single seam both consume. FAITHFUL by design:
   same GPU calls, same order, same invariants — zero behaviour change (proven byte-identical in the
   extraction lesson via a deterministic pre/post fingerprint on both consumers).

   present(pack, target) renders one hero pack through the full beauty pipeline:
     1. render pack -> beautyRT           (HalfFloat MSAA — engine-invariant #1: never sceneRT/8-bit)
     2. bloom (if pack.usesBloom)          (else zero uBloomStrength so the last pack's bloom cannot leak)
     3. set ALL filmic uniforms EVERY call (engine-invariant #2), uRays=0 (godrays read the CITY camera,
        which a hero pack does not have), uGrade=1 with per-pack INPUTS via applyGrade
     4. runPass(filmicMaterial, target)    (target=null -> screen; an RT -> a transition capture buffer)

   ── THE PER-INSTANCE GRADE STATE (why this is a factory, not a free function) ──
   `_graded` is a dirty flag scoped to ONE render sequence: it says "the last pack I presented left a
   grade override in the shared filmicMaterial, so restore before presenting a neutral pack." The
   director and a wipe each drive their OWN sequence of presents, so each gets its OWN presenter
   instance (its own _graded). A single shared free function would cross-talk their dirty state.

   ── THE BY-REF TRAP (the bug this careful code avoids) ──
   createEngineCore binds these uniforms BY REFERENCE to the live SunRig grade:
       filmicMaterial.uniforms.uGradeTint.value === sunRig.grade.tint   (createEngineCore.js:201)
       filmicMaterial.uniforms.uGradeLift.value === sunRig.grade.lift
   `uGradeTint.value` IS `sunRig.grade.tint` — the same THREE.Color, not a copy. So the obvious
   `uGradeTint.value.set(packTint)` would mutate the rig's own grade in place, and every OTHER hero
   scene (and the city, if it shares the core) would silently inherit this pack's tint forever, with
   the rig lerping onward from the corrupted value. So we only ever SWAP THE POINTER (`.value =
   otherColor`) and never write through it; restoring means re-aiming the uniform back at
   `sunRig.grade.tint`, which resumes tracking the rig for free.
   C++ anchor: the uniform holds a `Color*` aimed at the rig's member. Rebind the pointer; never write
   through it. And `_graded` is a dirty bit guarding a write-back — exactly a cache's.

   BYTE-IDENTICAL BY CONSTRUCTION: `_graded` stays false until some pack actually opts in via `filmic`,
   so a sequence of packs with no override never executes a single grade write — the uniforms are
   touched exactly as they were before the grade seam existed. The restore only runs after an override
   has dirtied them (blindly restoring every pass would clobber the CITY, which writes uGradeSat/
   Contrast every frame in a combined city+hero app).
   ============================================================ */
import * as THREE from 'three';

export function createBeautyPresenter(core) {
  const { renderer, filmicMaterial, runPass, bloomPass, beautyRT, gradeRT, gradePass } = core;

  const NEUTRAL_TINT = new THREE.Color(1, 1, 1);   // shared consts — never mutated, never allocated per-frame
  const NEUTRAL_LIFT = new THREE.Color(0, 0, 0);
  const _defTint     = filmicMaterial.uniforms.uGradeTint.value;   // === sunRig.grade.tint (by-ref)
  const _defLift     = filmicMaterial.uniforms.uGradeLift.value;   // === sunRig.grade.lift (by-ref)
  const _defSat      = filmicMaterial.uniforms.uGradeSat.value;
  const _defContrast = filmicMaterial.uniforms.uGradeContrast.value;
  let _graded = false;   // has the last-presented pack overridden the grade since the last restore?

  function applyGrade(pack) {
    const f = pack.filmic;
    if (f) {
      filmicMaterial.uniforms.uGradeTint.value     = f.tint     ?? NEUTRAL_TINT;   // POINTER swap only
      filmicMaterial.uniforms.uGradeLift.value     = f.lift     ?? NEUTRAL_LIFT;
      filmicMaterial.uniforms.uGradeSat.value      = f.sat      ?? 1.0;
      filmicMaterial.uniforms.uGradeContrast.value = f.contrast ?? 1.0;
      _graded = true;
    } else if (_graded) {
      filmicMaterial.uniforms.uGradeTint.value     = _defTint;    // re-aim at sunRig.grade.tint
      filmicMaterial.uniforms.uGradeLift.value     = _defLift;
      filmicMaterial.uniforms.uGradeSat.value      = _defSat;
      filmicMaterial.uniforms.uGradeContrast.value = _defContrast;
      _graded = false;
    }
  }

  /* present(pack, target) — render one pack through the full beauty pipeline into target
     (null => screen; an RT => a transition capture buffer). Sets ALL filmic uniforms every call. */
  function present(pack, target) {
    /* 1. Render pack into beautyRT (HalfFloat MSAA — invariant #1). */
    renderer.setRenderTarget(beautyRT);
    renderer.render(pack.scene, pack.camera);

    /* 2. Bloom — brightens crests (>0.78 in HalfFloat) and patches filmicMaterial.
          bloomPass writes uBloom + uBloomStrength. Skip => set uBloomStrength = 0. */
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
    filmicMaterial.uniforms.uRays.value         = 0;  // skip godrays for hero (godraysPass reads the city camera)
    applyGrade(pack);                                 // L-S: this pack's grade inputs (or the ring's)

    /* 4. Composite (null => screen; RT => capture for a transition).
       PASS N+1 — the color grade / LOOK. When a look is active (core.gradeActive), filmic writes its SDR
       result into gradeRT and the grade pass finishes into `target`. When OFF (the default), this is the
       exact original single call `runPass(filmicMaterial, target)` — byte-identical, the grade pass never
       runs. So adding this seam did not change the default present (proven by present-parity). */
    if (core.gradeActive) {
      runPass(filmicMaterial, gradeRT);   // filmic -> SDR grade input
      gradePass(gradeRT.texture, target); // grade  -> screen / capture RT
    } else {
      runPass(filmicMaterial, target);    // unchanged default path
    }
  }

  return { present };
}
