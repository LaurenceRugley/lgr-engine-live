/* ============================================================
   @lgr/engine-core — createCameraDirector (Lesson: cinematic camera moves).
   ------------------------------------------------------------
   A reusable SHOT-LIST director: cinematic camera moves over any scene pack, with createHeroWipe
   transitions between shots — a "director's cut" you can play, or step deterministically to record.
   It COMPOSES the two seams we already built: createBeautyPresenter renders a shot's pack through the
   beauty pipeline; createHeroWipe handles shot-to-shot transitions. (The point of the lesson is these
   modules composing.)

   ── WHAT MOVES A CAMERA, AND WHAT DOESN'T (the Rule-7 reconciliation — read this) ──
   Scene packs own their camera ({scene, camera, update}). Two facts decided this module's shape:
     1. NO pack moves its camera in update() — every pack sets the camera ONCE at create and animates
        only CONTENT (uniforms, group rotations). So there is NO fight: the director moves a pack's
        camera freely, and the pack never overwrites it. (No externalCamera opt-in was needed — adding
        one would have been speculative. Verified by grepping every pack's update().)
     2. The FULLSCREEN-QUAD packs (First Light, Letterpress, Cathedral, Caustics, Liquid Metal, Living
        Ink) render through fullscreen.vert, which writes gl_Position DIRECTLY and IGNORES the camera.
        So orbit/dolly/push-in are visual NO-OPS on those. Their meaningful moves are TIMELAPSE (drive
        the scene's own time scalar) and HOLD (let the scene's own animation play). Camera moves go on
        the 3D perspective packs (Dusk Silk, Product Moment, Material Study, Observatory, Aurora, ...).

   ── MOVES ──
     orbit     — circle a center at radius/height, looking at it, sweeping startDeg -> startDeg+arcDeg
     dolly     — lerp camera position from->to AND the lookAt point lookFrom->lookTo (independent paths)
     push-in   — lerp position from->to (toward a fixed lookAt); optional fov ramp (a lens zoom)
     hold      — camera static (optionally at a given pose); optional "breathing" micro-drift (3D only)
     timelapse — camera holds/drifts while the shot drives the pack's TIME scalar (First Light's sunrise)

   Transitions BETWEEN shots are createHeroWipe modes, declared per shot as `transition: {mode,duration}`.

   Contract:
     createCameraDirector(core, opts) -> {
       addShot(spec) -> this,     // chainable
       play(), pause(),
       update(dt, elapsed),        // drive from the consumer RAF (dt seconds); deterministic under fixed dt
       on('shotchange'|'end', cb),
       dispose(),
       get playing, get shotIndex, get phase
     }
   Shot spec: { pack, move, duration(ms), easing?, params, transition? }

   CONSTRAINTS honored: no hot allocation in update (all vectors hoisted); DETERMINISTIC under a fixed
   timestep (a shot list produces identical frames run-to-run — the ?capture recording contract); DPR
   cap + tier invariants are the core's (docs/engine-invariants.md — this module only moves cameras +
   drives the shared present, it touches no stylized-tier lever). Reduced motion: each shot shows one
   static "best" frame, no drift, instant cuts (WCAG 2.3.3).

   C++ anchor: a cutscene sequencer — an ordered list of camera keyframe-tracks, a transport (play/
   pause), and a compositor for the cross-shot dissolves. update(dt) is its transport tick.
   ============================================================ */
import * as THREE from 'three';
import { createBeautyPresenter } from './createBeautyPresenter.js';
import { createHeroWipe } from './createHeroWipe.js';
import { resolveEasing } from '../math/easing.js';
import { buildReelPlan } from '../reel-grammar.js';

const DEG2RAD = Math.PI / 180;
const v3 = (a, d = 0) => new THREE.Vector3(a?.[0] ?? d, a?.[1] ?? d, a?.[2] ?? d);

export function createCameraDirector(core, { wipe } = {}) {
  const presenter = createBeautyPresenter(core);          // renders the CURRENT shot's pack
  const _wipe = wipe || createHeroWipe(core);             // shot-to-shot transitions
  const _ownWipe = !wipe;                                 // only dispose a wipe we created

  const reducedMotion = (typeof window !== 'undefined' && window.matchMedia)
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  /* Hoisted scratch — mutated in place every frame, never re-allocated (no-hot-alloc invariant). */
  const _pos  = new THREE.Vector3();
  const _look = new THREE.Vector3();
  const _fc   = new THREE.Vector3();   // framing centre (vertical reframe)

  /* ── AUTO-VERTICAL (9:16-native) FRAMING (Lesson PIPELINE-MULTIPLIERS 2/2) ──
     A perspective camera's `fov` is VERTICAL; in a portrait (9:16) frame the HORIZONTAL field shrinks, so
     a shot composed for landscape would zoom/crop the subject sideways. The fix is a RE-FRAME, not a crop:
     using a per-scene safe-area hint (`framing:{ center, radius, fill }`) we set the fov so the subject's
     bounding sphere fits the frame's TIGHT axis (width, in portrait) with margin — the subject fills the
     tall frame, uncropped, clearing the top/bottom Reels-UI safe zones. It only ever touches the CAMERA
     (fov/aspect), never scene content, so the byte-identical-tiers invariant holds (a reframe, not a
     re-simulation). Mode: 'auto' (default) engages whenever the render is actually portrait. */
  let _vertical = 'auto';   // 'auto' | true | false
  function setVertical(m) { _vertical = (m === 'auto') ? 'auto' : !!m; return api; }

  function reframeVertical(shot) {
    const cam = shot.pack.camera;
    if (!cam.isPerspectiveCamera) return;              // fullscreen-quad packs ignore the camera
    /* Keep aspect synced to the live draw buffer. createHeroDirector/Wipe do this via a content-resizer;
       this director does not register one, so it syncs here (also what makes 'auto' detection correct). */
    const db = core.drawBuffer, aspect = db.x / Math.max(1, db.y);
    if (Math.abs(cam.aspect - aspect) > 1e-6) { cam.aspect = aspect; cam.updateProjectionMatrix(); }
    const on = _vertical === 'auto' ? aspect < 1 : _vertical;
    const fr = shot.framing || shot.pack.framing;      // per-shot overrides per-pack; both optional
    if (!on || !fr) return;                            // no reframe: keep the shot's authored fov
    _fc.set(fr.center?.[0] ?? 0, fr.center?.[1] ?? 0, fr.center?.[2] ?? 0);
    const dist = Math.max(1e-3, cam.position.distanceTo(_fc));
    const r = (fr.radius ?? 1) / (fr.fill ?? 0.85);    // fill<1 leaves margin (safe zones); bigger r => wider fov
    /* Fit radius r on the TIGHT axis. tan(hHalf) = r/dist (width); vfov from it: tan(vHalf) = tan(hHalf)/aspect.
       In portrait (aspect<1) that widens the vertical fov so the subject spans the narrow width, uncropped. */
    const vHalf = Math.atan(r / (dist * aspect));
    cam.fov = 2 * vHalf / DEG2RAD;
    cam.updateProjectionMatrix();
  }

  const shots = [];
  const listeners = { shotchange: [], end: [] };
  let idx = -1;                 // current shot index (-1 = not started)
  let phase = 'idle';           // 'idle' | 'shot' | 'transition'
  let shotElapsed = 0;          // ms into the current shot
  let clock = 0;                // director clock (s) — the continuous time passed to non-timelapse packs
  let playing = false;
  let _timelapseBase = 0;       // pack-time at the start of a timelapse shot (for continuity)

  /* normalizeShot — parse a spec once into hoisted vectors + a resolved easing fn, so update() only
     reads numbers (no per-frame parsing or allocation). Fail loud on an unknown move (Rule 12). */
  function normalizeShot(spec) {
    const p = spec.params || {};
    const s = {
      pack: spec.pack,
      move: spec.move,
      duration: spec.duration ?? 5000,
      easing: resolveEasing(spec.easing),
      transition: spec.transition || null,
      framing: spec.framing || null,           // per-shot vertical safe-area hint (overrides pack.framing)
      bestT: spec.bestT,                       // reduced-motion representative frame (see below)
      // pre-parsed, move-specific:
      center: v3(p.center), radius: p.radius ?? 10, height: p.height ?? 0,
      startDeg: p.startDeg ?? 0, arcDeg: p.arcDeg ?? 90,
      from: v3(p.from), to: v3(p.to),
      lookFrom: v3(p.lookFrom ?? p.lookAt), lookTo: v3(p.lookTo ?? p.lookAt),
      lookAt: v3(p.lookAt),
      fovFrom: p.fovFrom, fovTo: p.fovTo,
      fromT: p.fromT ?? 0, toT: p.toT ?? 0,
      drift: p.drift || null,                  // { amp, speed } subtle breathing (3D only)
      hasPose: !!(p.from || p.center || p.pos || p.lookAt),  // does this shot pose the camera at all?
      pos: v3(p.pos ?? p.from),
      offset: v3(p.offset),                    // A2 follow: fixed camera offset from the tracked subject
    };
    if (!['orbit', 'dolly', 'push-in', 'hold', 'timelapse', 'crane', 'follow'].includes(s.move)) {
      throw new Error(`createCameraDirector: unknown move ${JSON.stringify(s.move)} (orbit|dolly|push-in|hold|timelapse|crane|follow)`);
    }
    if (s.bestT == null) s.bestT = s.move === 'timelapse' ? 1 : s.move === 'hold' ? 0 : 0.5;
    return s;
  }

  function addShot(spec) { shots.push(normalizeShot(spec)); return api; }

  /* ── REEL GRAMMAR MODE (Arc R1) ──────────────────────────────────────────────────────────────────
     addReelSequence(pack, spec) expands the SHARED reel grammar (reel-grammar.js) into director shots so a
     beauty-pack reel obeys the trailer rule by construction: hook-first, 2–3 s shots, wide→medium→close
     rotation with focal cycling, loop-aware tail. It's the director-side wiring of the ability the Hoard
     capture + the ffmpeg compositor also consume — one grammar, three renderers, no drift.

     A framing maps to an ORBIT at a distance around the subject: wide = far/low arc, medium = mid, close =
     near. The beat's focal sets the fov. Every shot is real footage of the pack from frame one (the pack is
     live) — there is no intro shot to insert, so the trailer rule holds automatically.

     spec: { subject:[x,y,z], beats:[…grammar beats…], loop?, radius?, height?, arcDeg?, transition? }
       radius = the CLOSE distance (wide/medium scale it out by 2.4×/1.6×); arcDeg = per-shot orbit sweep. */
  function addReelSequence(pack, spec = {}) {
    const plan = buildReelPlan(spec.beats || [], { loop: spec.loop });
    const subject = spec.subject || [0, 0, 0];
    const rClose = spec.radius ?? 6;
    const scale = { close: 1, medium: 1.6, wide: 2.4 };
    const height = spec.height ?? 2;
    const arcDeg = spec.arcDeg ?? 24;                 // a gentle live drift per shot (not a full circle)
    let startDeg = spec.startDeg ?? -12;
    for (const sh of plan.shots) {
      const radius = rClose * (scale[sh.framing] ?? 1.6);
      addShot({
        pack,
        move: sh.move === 'push-in' ? 'push-in' : 'orbit',
        duration: sh.durationMs,
        easing: 'easeInOutSine',
        framing: { center: subject, radius: radius * 0.5, fill: 0.82 },   // vertical safe-area reframe hint
        params: {
          center: subject, radius, height,
          startDeg, arcDeg,
          fovFrom: sh.fov, fovTo: sh.fov,            // hold the beat's focal (fov cycles shot-to-shot)
          lookAt: subject, from: [subject[0] + radius, subject[1] + height, subject[2]], to: [subject[0], subject[1] + height, subject[2]],
        },
        transition: spec.transition || { mode: 'fade', duration: 350 },   // playbook: ~0.35s snappy cut
      });
      startDeg += arcDeg;                            // continue the drift so the loopback lands back near start
    }
    return { api, plan };
  }
  function on(evt, cb) { (listeners[evt] || (listeners[evt] = [])).push(cb); return api; }
  function emit(evt, payload) { for (const cb of listeners[evt] || []) cb(payload); }

  /* applyCamera — pose the pack's camera for `move` at eased progress t. A NO-OP on fullscreen packs
     (their vert ignores the camera), which is exactly why timelapse/hold don't rely on it. `driftClock`
     feeds the optional breathing so it advances even during a hold. */
  function applyCamera(shot, t, driftClock) {
    const cam = shot.pack.camera;
    switch (shot.move) {
      case 'orbit': {
        const a = (shot.startDeg + shot.arcDeg * t) * DEG2RAD;
        _pos.set(shot.center.x + shot.radius * Math.cos(a),
                 shot.center.y + shot.height,
                 shot.center.z + shot.radius * Math.sin(a));
        cam.position.copy(_pos);
        cam.lookAt(shot.center.x, shot.center.y, shot.center.z);
        break;
      }
      case 'dolly': {
        cam.position.lerpVectors(shot.from, shot.to, t);
        _look.lerpVectors(shot.lookFrom, shot.lookTo, t);
        cam.lookAt(_look.x, _look.y, _look.z);
        break;
      }
      case 'push-in': {
        cam.position.lerpVectors(shot.from, shot.to, t);
        cam.lookAt(shot.lookAt.x, shot.lookAt.y, shot.lookAt.z);
        if (shot.fovFrom != null && shot.fovTo != null && cam.isPerspectiveCamera) {
          cam.fov = shot.fovFrom + (shot.fovTo - shot.fovFrom) * t;
          cam.updateProjectionMatrix();
        }
        break;
      }
      case 'crane': {
        // A2 vertical JIB — sweep the camera position from→to (author gives a Y-dominant delta) while the
        // lens stays locked on a fixed point. A rising crane over a crowd, a descending drop onto a subject.
        cam.position.lerpVectors(shot.from, shot.to, t);
        cam.lookAt(shot.lookAt.x, shot.lookAt.y, shot.lookAt.z);
        break;
      }
      case 'follow': {
        // A2 TRACKING — hold a fixed offset from a subject that travels lookFrom→lookTo, camera always framing
        // it (a dolly that rides alongside a moving actor). Static subject (lookFrom==lookTo) → a steady hold.
        _look.lerpVectors(shot.lookFrom, shot.lookTo, t);
        cam.position.set(_look.x + shot.offset.x, _look.y + shot.offset.y, _look.z + shot.offset.z);
        cam.lookAt(_look.x, _look.y, _look.z);
        break;
      }
      case 'hold':
      case 'timelapse': {
        if (shot.hasPose) {                                // pose it once (no-op for a fullscreen pack)
          cam.position.copy(shot.pos);
          cam.lookAt(shot.lookAt.x, shot.lookAt.y, shot.lookAt.z);
        }
        if (shot.drift && cam.isPerspectiveCamera) {       // subtle breathing — 3D only
          const d = shot.drift, w = (d.speed ?? 0.3) * driftClock;
          cam.position.x += Math.sin(w) * (d.amp ?? 0.05);
          cam.position.y += Math.sin(w * 0.73 + 1.3) * (d.amp ?? 0.05) * 0.6;
          cam.lookAt(shot.lookAt.x, shot.lookAt.y, shot.lookAt.z);
        }
        break;
      }
    }
  }

  /* packTimeFor — the animation clock passed to this shot's pack.update. Timelapse REMAPS it (drive
     the scene's own time fast — the sunrise); every other move passes the continuous director clock so
     the scene's own life plays at normal speed. Continuity into a timelapse: it resumes from the pack
     time at shot start (_timelapseBase), so there is no jump at the wipe boundary. */
  function packTimeFor(shot, t) {
    if (shot.move !== 'timelapse') return clock;
    return _timelapseBase + shot.fromT + (shot.toT - shot.fromT) * t;
  }

  /* renderShot — one settled (non-transition) frame of the current shot. */
  function renderShot(shot, t, dt) {
    const pt = packTimeFor(shot, t);
    shot.pack.update(dt, pt);
    applyCamera(shot, t, clock);
    reframeVertical(shot);                 // 9:16 reframe (no-op in landscape/square or without a hint)
    presenter.present(shot.pack, null);
  }

  function startShot(i) {
    idx = i;
    phase = 'shot';
    shotElapsed = 0;
    const shot = shots[i];
    if (shot.move === 'timelapse') _timelapseBase = clock;   // resume the pack's clock from here
    emit('shotchange', { index: i, move: shot.move, pack: shot.pack });
  }

  function beginTransitionOrEnd() {
    const cur = shots[idx];
    if (idx + 1 >= shots.length) { phase = 'idle'; playing = false; emit('end', { index: idx }); return; }
    const next = shots[idx + 1];
    /* Pre-pose the incoming pack (camera at its move t=0, scene at its start time) so the wipe reveals
       the correct first framing, not a stale one. */
    if (next.move === 'timelapse') _timelapseBase = clock;
    next.pack.update(0, packTimeFor(next, 0));
    applyCamera(next, 0, clock);
    reframeVertical(next);                 // reframe the incoming pack too, so the wipe reveals the 9:16 framing
    /* Kick the wipe. reduced-motion is handled inside createHeroWipe (it downgrades to a 150ms fade). */
    const tr = cur.transition || { mode: 'fade', duration: 1200 };
    _wipe.transition(cur.pack, next.pack, { mode: tr.mode ?? 'fade', duration: tr.duration ?? 1200 });
    phase = 'transition';
  }

  /* update(dt, elapsed) — the transport tick. dt in SECONDS. Deterministic: with a fixed dt the whole
     shot list plays out to identical frames (the ?capture recording contract). */
  function update(dt, elapsed) {
    clock = elapsed ?? (clock + dt);
    if (idx < 0) return;

    if (phase === 'transition') {
      _wipe.update(dt, clock);
      if (!_wipe.transitioning) { startShot(idx + 1); }     // wipe done -> the incoming shot is live
      return;
    }

    const shot = shots[idx];
    if (reducedMotion) {
      /* One static best frame, no drift, no timelapse sweep; cut (no wipe) at the end. */
      shot.pack.update(dt, packTimeFor(shot, shot.bestT));
      applyCamera(shot, shot.bestT, 0);
      reframeVertical(shot);
      presenter.present(shot.pack, null);
      if (playing) {
        shotElapsed += dt * 1000;
        if (shotElapsed >= shot.duration) {
          if (idx + 1 >= shots.length) { phase = 'idle'; playing = false; emit('end', { index: idx }); }
          else startShot(idx + 1);                          // instant cut
        }
      }
      return;
    }

    if (!playing) { renderShot(shot, Math.min(1, shotElapsed / shot.duration), dt); return; }
    shotElapsed += dt * 1000;
    const raw = Math.min(1, shotElapsed / shot.duration);
    renderShot(shot, shot.easing(raw), dt);
    if (raw >= 1) beginTransitionOrEnd();
  }

  function play()    { if (idx < 0 && shots.length) startShot(0); playing = true; return api; }
  function pause()   { playing = false; return api; }
  function restart() { idx = -1; clock = 0; shotElapsed = 0; if (shots.length) startShot(0); playing = true; return api; }

  function dispose() {
    if (_ownWipe) _wipe.dispose();
    // Packs are the consumer's (reused across shots / outlive the director) — not disposed here.
  }

  const api = {
    addShot, addReelSequence, play, pause, restart, update, on, dispose, setVertical,
    get playing()   { return playing; },
    get shotIndex() { return idx; },
    get phase()     { return phase; },
    get vertical()  { return _vertical; },
  };
  return api;
}
