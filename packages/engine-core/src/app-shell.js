/* ============================================================
   app-shell.js — L114: createAppShell() + readAppFlags() — the audit CRITIC's systemic fix.
   ------------------------------------------------------------
   THE DRIFT (docs/audit-fable5-2026-07-01.md:62): every project page (city/office/hoard) re-implements the
   same BOOT/UX plumbing by hand — the pause-on-hidden + context-loss frame skip, the frame brackets, the
   readiness flag, the footer show/hide, the resize + visibility listeners — and they DRIFT (hoard's loop
   never wired the pause skip; office/hoard never wired ?capture; the footer rule diverged). None of this is
   new capability: the engine already owns paused/contextLost/setActive/frameStart/frameEnd/resize. The shell
   is simply the ONE place that wiring lives, so a page can't forget a duty it never writes.

   C++ anchor: the shell is `crt0` + the message pump — it owns process entry (argv → flags via readAppFlags),
   the run loop (rAF keep-alive, the frame skip, the dt clamp, the profiler brackets) and the signal handlers
   (visibilitychange ≈ SIGTSTP → pause), and calls YOUR code at exactly two points: setup and per-frame. The
   engine (createEngine) is the linked library; the project is just the code in between.

   TWO exports:
     readAppFlags(search) — PURE, Node-testable. The APP half of the URL only (demo/ui/capture/coarse); the
       SCENE params (?t/?style/?cam/?weather) are L109 SceneSpec's contract, deliberately untouched here.
     createAppShell(engine, opts) — wires the per-page duties + returns { start, ready, hints, name }.
   ============================================================ */
import * as THREE from 'three';
import { createHints } from './hints.js';
import { createCapture } from './capture.js';
import { resolveProfile } from './ui-mode.js';

// The APP-half URL flags, parsed ONCE and handed to createAppShell (the same "params passed in" move L109 uses,
// so there's exactly one URLSearchParams per page). `demo` is the rule all three mains duplicated verbatim today.
// I — opts.devOn (boolean): caller reads lgr_dev_on localStorage and passes the result; keeps readAppFlags pure +
// testable. Office/hoard pass no opts → devOn=false → PRESENT (byte-identical to pre-I for them).
export function readAppFlags(search, { devOn = false } = {}) {
  const q = new URLSearchParams(search);
  const capture = q.has('capture');
  const demo = q.get('demo') === '1' || capture;   // ?demo=1 OR any ?capture → strip branding / demo framing
  const coarse = typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
  const ui = q.get('ui');                            // '0' → embed mode (hide the footer). null otherwise.
  const mode = resolveProfile(search, { devOn });   // I: PRESENT (clean default) | AUTHOR (lgr_dev_on unlock)
  return { q, demo, coarse, ui, capture, mode };
}

export function createAppShell(engine, { name, flags, capture = false, onResize } = {}) {
  if (!name) throw new Error('createAppShell: `name` is required (readiness alias · hints key · capture tag)');
  if (!flags) throw new Error('createAppShell: pass the `flags` from readAppFlags (the ONE parse)');

  // VISIBILITY → pause. The single line that proved it needed a home: hoard's loop never wired it, so a hidden
  // hoard tab burned the GPU forever. setActive(false) flips engine.paused, which the frame skip below reads.
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => engine.setActive(!document.hidden));
    engine.setActive(!document.hidden);   // L114 ckpt-6 (iii): seed from CURRENT visibility — a tab that BOOTS already-hidden never fires visibilitychange, so paused would stay false (benign: rAF throttles a hidden tab anyway, but this makes engine.paused honest at t0). No-op on the normal visible boot.
  }

  // RESIZE. engine.resize() first (canvas + all engine RTs), then the project's optional onResize(db) for any
  // per-page extras (city sizes its dive RTs; office its window cameras). hoard needs none.
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => {
      engine.resize();
      if (onResize) onResize(engine.renderer.getDrawingBufferSize(new THREE.Vector2()));
    });
  }

  // ?capture wiring. If the page opted in (capture truthy), capture MUST exist — the shell builds it from the
  // engine's renderer/rig/sunRig + the project's getState/verbs/poke. `sequences` (default false in capture.js)
  // gates the director arm so office/hoard get S-still / R-video WITHOUT the city keymap's ?capture=tour beats.
  if (capture) {
    createCapture({ renderer: engine.renderer, rig: engine.rig, sunRig: engine.sunRig, ...capture });
  }

  // FOOTER policy — city's dominant rule, standardized for all pages: hide the `.hint` bar when the page is a
  // demo, an embed (?ui=0), a capture, or on a coarse (touch) pointer. (office/hoard previously hid on coarse
  // ONLY — adopting this is an intentional, documented behavior delta so ?ui=0 embeds clean everywhere.)
  if (typeof document !== 'undefined' && (flags.demo || flags.ui === '0' || flags.capture || flags.coarse)) {
    const h = document.querySelector('.hint'); if (h) h.style.display = 'none';
  }

  return {
    name,

    // The LOOP SKELETON. The project can't forget the pause/context skip because it never writes one: the shell
    // owns rAF keep-alive + the skip + the profiler brackets + the timer + the dt clamp, and calls the project's
    // frame(dt, t) in the middle. Semantics copied byte-for-byte from city:1544-1658 (skip → rAF+return; else
    // frameStart → timer.update → clamp → BODY → frameEnd → rAF). The loop BODY stays 100% project.
    start(frame) {
      const timer = new THREE.Timer();
      timer.connect(document);
      function tick() {
        // while PAUSED (hidden tab) or the GL context is LOST, skip the whole frame but keep rAF alive to catch
        // the resume/restore; the dt clamp below absorbs the catch-up frame so time doesn't jump.
        if (engine.paused || engine.contextLost) { requestAnimationFrame(tick); return; }
        engine.frameStart();                          // bracket the frame (CPU+GPU profiling); governor ticks in frameEnd
        timer.update();
        const dt = Math.min(timer.getDelta(), 0.1);   // clamp so a long hidden-tab pause doesn't teleport the sim/camera
        frame(dt, timer.getElapsed());
        engine.frameEnd();
        requestAnimationFrame(tick);
      }
      // L114 ckpt-6 (ii): the migration preserved the CALL SITE (shell.start(frame) sits where the old tick() was)
      // but NOT the synchronicity — the old city tick() ran its first frame SYNCHRONOUSLY; this kicks the first
      // frame on the next rAF (~16ms later). Harmless (the loop was rAF-driven anyway; boot paints via the loader
      // latch on the 2nd real frame regardless), noted so nobody hunts a phantom "one frame late" difference.
      requestAnimationFrame(tick);
    },

    // Readiness. __appReady is the new canonical flag; __cityReady is a back-compat alias (harness + smoke assert
    // __cityReady today) — the alias retires once smoke/tier-guard assert __appReady. The project calls this inside
    // its OWN landmarkFactory.whenReady callback (the regen half differs per page and stays project-owned).
    ready() {
      if (typeof window !== 'undefined') { window.__appReady = true; window.__cityReady = true; }
    },

    // Hints. The storage key is DERIVED from the shell name, so a page can never borrow another page's key
    // (lgr_hints_{name}). Timing/conditions (city skips hints in ?preview) stay project-side — call it when ready.
    hints(opts) {
      return createHints({ key: name, ...opts });
    },
  };
}
