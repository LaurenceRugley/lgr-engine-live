/* ============================================================
   @lgr/engine-core — createBuildIn (Lesson: entrance/assembly choreography).
   ------------------------------------------------------------
   The "hero builds itself" moment: the elements of a scene ASSEMBLE into the composed frame (and can
   disassemble back out). Third module of the trio — composes with createCameraDirector (a build-in is a
   shot: drive its progress as the shot plays) and createHeroWipe (assembly as the arrival after a wipe).

   ── CORE OWNS THE CHOREOGRAPHY, PACKS OWN THE CASTING (the Rule-7 reconciliation) ──
   A generic assembly core needs per-scene knowledge of WHAT assembles. Following the camera lesson's
   pack-contract precedent, a pack OPTS IN by exposing its buildable structure:
       pack.buildGroups = [ { object: THREE.Object3D, role: 'curtain'|'hero'|... }, ... ]  (ordered)
   The core reads that list and animates each object's TRANSFORM; the pack decides which objects cast.

   ── WHAT THE CORE TOUCHES, AND WHY THAT AVOIDS FIGHTS ──
   The core animates POSITION + SCALE only — it deliberately leaves ROTATION and MATERIAL to the pack.
   That is what lets it compose without a yield-flag: a pack whose update() spins its object (Material
   Study) or morphs its material keeps doing so DURING the assembly (the sphere presses down while it
   turns). The only packs it cannot compose with are those that animate their object's POSITION in
   update() (Product Moment's bob) — those need a position-yield opt-in (noted in HANDOFF as pending).
   Fullscreen-quad packs (First Light, Letterpress, Cathedral…) have no meshes to assemble at all — the
   brand "letterpress press" needs a shader build uniform, not a transform (also in HANDOFF).

   ── CHOREOGRAPHIES ── (params from easing.js; per-element stagger)
     rise      — elements ascend into place from below           (offset −Y)
     converge  — elements fly in from a deterministic scatter     (offset scattered)
     press     — elements stamp down from above + a settle/impact (offset +Y, landing squash)
     disassemble — any of the above in REVERSE (drive progress 1→0) — exits for free.

   CONSTRAINTS honored: no hot allocation (per-element home/offset/scale Vector3s allocated ONCE at
   play()-time; set() mutates in place); DETERMINISTIC under a fixed timestep (set(t) is pure in t — the
   ?capture contract; scatter is index-hashed, never random); reduced-motion ⇒ instant assembled state;
   transform-only (position/rotation/scale) — no per-frame geometry rebuild; tier levers untouched
   (docs/engine-invariants.md). Absolute set from a captured home (not += ) so it never accumulates on a
   pack that doesn't reset its transforms.

   C++ anchor: a keyframe rig — capture rest pose, define a per-element source pose + delay, then LERP by
   an eased, staggered parameter. set(t) is the evaluator; update(dt) is the transport that advances t.
   ============================================================ */
import * as THREE from 'three';
import { resolveEasing } from '../math/easing.js';

const CHOREOS = ['rise', 'converge', 'press', 'disassemble'];

/* Deterministic per-element scatter direction (unit-ish), index-hashed — NEVER Math.random (determinism). */
function scatterDir(i, out) {
  const a = i * 2.399963;                 // golden angle → even spread
  const y = 1 - ((i % 7) / 6) * 1.6;      // vary height a little, bounded
  const r = Math.sqrt(Math.max(0, 1 - y * y * 0.25));
  return out.set(Math.cos(a) * r, y, Math.sin(a) * r);
}

export function createBuildIn(pack, { } = {}) {
  const hasGroups = pack && Array.isArray(pack.buildGroups) && pack.buildGroups.length > 0;
  const hasShader = pack && typeof pack.setBuild === 'function';   // fullscreen packs cast via a shader uniform
  if (!hasGroups && !hasShader) {
    throw new Error('createBuildIn: pack must expose buildGroups ([{ object, role }]) OR a setBuild(t) hook');
  }
  const groups = hasGroups ? pack.buildGroups : [];
  const N = groups.length;

  /* Per-element state — allocated ONCE here, reused every frame (no hot alloc). */
  const els = groups.map((g) => ({
    obj: g.object,
    role: g.role,
    home: new THREE.Vector3(),       // captured rest position
    homeScale: new THREE.Vector3(),  // captured rest scale
    offset: new THREE.Vector3(),     // source-pose offset for the active choreography
    delay: 0,                        // stagger delay in [0,1]
  }));
  const _scatter = new THREE.Vector3();   // scratch

  let choreo = 'rise';
  let easeFn = resolveEasing('easeOutCubic');
  let stagger = 0.5;
  let distance = 5;
  let impact = 0.14;
  let span = 1;                            // active span = 1 - maxDelay
  let t = 1;                               // assembly progress: 1 = fully assembled (home), 0 = source pose
  let dir = 0;                             // +1 assembling, −1 disassembling, 0 idle
  let duration = 1400;                     // ms
  let resolveDone = null;

  const reducedMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : false;

  /* Recompute per-element home/scale/offset/delay for the current choreography. Called by play(). */
  function arm(name) {
    const isPress = name === 'press';
    const maxDelay = N > 1 ? stagger : 0;
    span = Math.max(1e-3, 1 - maxDelay);
    for (let i = 0; i < N; i++) {
      const el = els[i];
      el.home.copy(el.obj.position);           // capture rest pose NOW (packs don't move these — see header)
      el.homeScale.copy(el.obj.scale);
      el.delay = N > 1 ? (i / (N - 1)) * maxDelay : 0;
      if (name === 'rise')     el.offset.set(0, -distance, 0);
      else if (isPress)        el.offset.set(0,  distance, 0);
      else /* converge */      el.offset.copy(scatterDir(i, _scatter)).multiplyScalar(distance);
    }
  }

  /* set(progress) — evaluate the assembly at global progress in [0,1]. Pure in `progress`. */
  function set(progress) {
    t = progress < 0 ? 0 : progress > 1 ? 1 : progress;
    const isPress = choreo === 'press';
    for (let i = 0; i < N; i++) {
      const el = els[i];
      const p = span > 0 ? (t - el.delay) / span : t;
      const e = easeFn(p < 0 ? 0 : p > 1 ? 1 : p);   // eased local progress 0..1

      // POSITION: home + offset * (1 - e). Absolute set from captured home (never accumulates).
      el.obj.position.copy(el.home).addScaledVector(el.offset, 1 - e);

      // SCALE: grow-in for rise/converge; press stays full but SQUASHES on landing (the impact beat).
      const grow = choreo === 'converge' ? 0.12 + 0.88 * e
                 : choreo === 'rise'     ? 0.55 + 0.45 * e
                 : 1;                                         // press: no grow, just the drop
      let sxz = grow, sy = grow;
      if (isPress) {
        // a bump that rises then falls across the landing window → squash (flat+wide) then settle.
        const land = e > 0.72 ? Math.sin(((e - 0.72) / 0.28) * Math.PI) : 0;
        sy  = 1 - impact * land;
        sxz = 1 + impact * 0.72 * land;
      }
      el.obj.scale.set(el.homeScale.x * sxz, el.homeScale.y * sy, el.homeScale.z * sxz);
    }
    // SHADER path (fullscreen packs, e.g. Letterpress): drive the pack's own build uniform with the eased
    // GLOBAL progress. The shader owns its choreography (the press bite), so no per-element stagger applies.
    if (hasShader) pack.setBuild(easeFn(t < 0 ? 0 : t > 1 ? 1 : t));
  }

  /* play(choreography, opts) — assemble in (t 0→1). reduced-motion ⇒ snap assembled. Returns a Promise. */
  function play(name = 'rise', { duration: d = 1400, easing = 'easeOutCubic', stagger: s = 0.5, distance: dist = 5, impact: im = 0.14 } = {}) {
    const disassemble = name === 'disassemble';
    const actual = disassemble ? choreo : name;   // disassemble reuses the current choreography's geometry
    if (!CHOREOS.includes(name)) throw new Error(`createBuildIn: unknown choreography ${JSON.stringify(name)} (${CHOREOS.join('|')})`);
    if (!disassemble) { choreo = actual; }
    easeFn = resolveEasing(easing); stagger = s; distance = dist; impact = im; duration = Math.max(1, d);
    arm(choreo);
    if (reducedMotion) { set(disassemble ? 0 : 1); dir = 0; return Promise.resolve(); }
    t = disassemble ? 1 : 0; dir = disassemble ? -1 : 1;
    set(t);
    return new Promise((r) => { resolveDone = r; });
  }

  function reverse(opts = {}) { return play('disassemble', { duration: opts.duration ?? duration, easing: opts.easing, stagger: opts.stagger ?? stagger, distance, impact }); }

  /* update(dt) — advance the transport, then APPLY. Call once per frame AFTER pack.update(). Even when
     idle it re-applies set(t) so a held source/rest pose survives the pack rewriting other channels. */
  function update(dt) {
    if (dir !== 0) {
      t += dir * (dt * 1000) / duration;
      if (dir > 0 && t >= 1) { t = 1; dir = 0; finish(); }
      else if (dir < 0 && t <= 0) { t = 0; dir = 0; finish(); }
    }
    set(t);
  }
  function finish() { const r = resolveDone; resolveDone = null; if (r) r(); }

  function dispose() { /* restores nothing to dispose — objects are the pack's; leave them at their current pose */ }

  return {
    play, reverse, update, set, dispose,
    get t() { return t; }, get choreography() { return choreo; }, get playing() { return dir !== 0; },
  };
}
