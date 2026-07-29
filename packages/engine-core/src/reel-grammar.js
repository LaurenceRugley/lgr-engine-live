/* ============================================================
   @lgr/engine-core — reel-grammar (Arc R1: the trailer/reel SHOT GRAMMAR, codified once).
   ------------------------------------------------------------
   THE ABILITY: one authoritative definition of how a reel is CUT — shot durations, the wide→medium→close
   rotation, focal cycling, the hook-first trailer rule, loop-awareness. It is PURE (no THREE, no DOM) so
   it is node-testable and shared by every consumer: `createCameraDirector.addReelSequence` (beauty-pack
   reels), the game-capture scripts (the Hoard reel), and the ffmpeg compositor (caption timing). One
   grammar, many renderers — so no reel drifts from the law.

   Law source (cite, don't re-derive): docs/reel-factory-formats-2026-07-28.md
     · §trailer-grammar — real footage from frame one, hook within the first beat, never a cinematic intro.
     · §attention-math  — the hook must land in 0–3 s; 2–3 s shots; alternate wide/close; ~7–15 s loopers
                          win reach, retention-% is the real signal.
     · §loop-design     — the final frame flows into the first; plan the loop at capture time.

   C++ anchor: a shot-list COMPILER. `buildReelPlan` is the front-end pass — it takes a loose beat list
   (the "source"), validates it against the grammar, and emits a normalized, timed shot vector (the "IR")
   that the back-ends (director / capture / compositor) all consume. Fail-loud on a malformed beat, exactly
   like a compiler rejecting bad input rather than emitting garbage.
   ============================================================ */

/* Focal cycling — full-frame-equivalent focal length → horizontal angle-of-view (degrees). The classic
   24/35/50/85 lens set: wide establishing → normal → portrait-tele detail. Standard full-frame AOV
   (2·atan(36/(2f))); consumers use it as a base fov "feel" (portrait reels then reframe to fit). */
export const FOCAL_FOV = Object.freeze({ 24: 73.7, 35: 54.4, 50: 39.6, 85: 23.9 });

/* The wide→medium→close rotation and the focal that reads each framing. Wide = establish the world,
   medium = the action, close = the payoff/detail. This is the DEFAULT ordering the grammar rotates through. */
export const FRAMING_FOCAL = Object.freeze({ wide: 24, medium: 50, close: 85 });
export const FRAMING_ORDER = Object.freeze(['wide', 'medium', 'close']);

/* Grammar constants (playbook §attention-math + §loop-design). All times in ms. */
export const GRAMMAR = Object.freeze({
  shotMinMs: 2000,        // a shot shorter than ~2 s reads as a flicker, not a beat
  shotMaxMs: 3000,        // longer than ~3 s and a static-ish shot bleeds viewers
  defaultShotMs: 2500,
  hookWindowMs: 3000,     // the OPENING beat (the hook) must land its payoff inside 3 s
  reelMinMs: 7000,        // ~7 s is the floor for a satisfying looper
  reelSoftMaxMs: 30000,   // v1 target ceiling; >30 s is a different (engagement) format, warn not fail
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/* buildReelPlan(beats, opts) — compile a beat list into a trailer-grammar shot plan.

   A beat: { id, framing?, caption?, captionSub?, focalMm?, durationMs?, move?, meta? }
     · framing  — 'wide' | 'medium' | 'close'; if omitted, rotates wide→medium→close by position.
     · caption  — the burned-in overlay line for this shot (≤10 words is the compositor's job to enforce).
     · focalMm  — 24|35|50|85; if omitted, derived from framing via FRAMING_FOCAL.
     · durationMs — clamped into [shotMinMs, shotMaxMs]; default defaultShotMs.
     · move     — an opaque hint for the renderer (e.g. 'orbit'|'push-in' for the director, or a game cue).

   opts: { loop=true }. When loop, a trailing return-beat is appended that matches beat[0]'s framing/focal
   so the last frame flows back into the first (playbook §loop-design) — the seam the critics test.

   Fail-loud (Rule 12): empty beats, or a hook beat flagged `intro:true`, throws — the grammar's whole
   point is "real footage from frame one." Returns { shots, totalMs, loop, hookMs, warnings }. */
export function buildReelPlan(beats, opts = {}) {
  const loop = opts.loop !== false;
  if (!Array.isArray(beats) || beats.length === 0) {
    throw new Error('buildReelPlan: need at least one beat (the hook) — the trailer opens on real footage.');
  }
  if (beats[0].intro) {
    throw new Error('buildReelPlan: beat[0] is flagged intro — the trailer rule forbids an intro; open on the hook (playbook §trailer-grammar).');
  }

  const warnings = [];
  const shots = beats.map((b, i) => {
    const framing = b.framing || FRAMING_ORDER[i % FRAMING_ORDER.length];
    if (!FRAMING_FOCAL[framing]) {
      throw new Error(`buildReelPlan: beat ${JSON.stringify(b.id ?? i)} has unknown framing ${JSON.stringify(framing)} (wide|medium|close).`);
    }
    const focalMm = b.focalMm ?? FRAMING_FOCAL[framing];
    if (!FOCAL_FOV[focalMm]) {
      throw new Error(`buildReelPlan: beat ${JSON.stringify(b.id ?? i)} has off-set focal ${focalMm}mm (use 24|35|50|85).`);
    }
    const rawMs = b.durationMs ?? GRAMMAR.defaultShotMs;
    const durationMs = clamp(rawMs, GRAMMAR.shotMinMs, GRAMMAR.shotMaxMs);
    if (rawMs !== durationMs) warnings.push(`beat ${b.id ?? i}: duration ${rawMs}ms clamped to ${durationMs}ms (2–3 s shots).`);
    return {
      id: b.id ?? `beat-${i}`,
      framing, focalMm, fov: FOCAL_FOV[focalMm],
      durationMs,
      caption: b.caption ?? '',
      captionSub: b.captionSub ?? '',
      move: b.move ?? null,
      meta: b.meta ?? null,
      isHook: i === 0,
    };
  });

  // The hook beat must pay off inside the 3 s window (playbook §attention-math).
  const hookMs = shots[0].durationMs;
  if (hookMs > GRAMMAR.hookWindowMs) {
    warnings.push(`hook beat is ${hookMs}ms — the payoff should land inside ${GRAMMAR.hookWindowMs}ms (§attention-math).`);
  }

  // Loop-aware tail: return to the opening framing so the last frame flows into the first (§loop-design).
  if (loop) {
    const h = shots[0];
    shots.push({
      id: `${h.id}-loopback`,
      framing: h.framing, focalMm: h.focalMm, fov: h.fov,
      durationMs: GRAMMAR.shotMinMs,      // a short return beat is enough to close the seam
      caption: '', captionSub: '',        // no caption on the loopback — it must read as the opening
      move: h.move, meta: h.meta,
      isHook: false, isLoopback: true,
    });
  }

  const totalMs = shots.reduce((s, sh) => s + sh.durationMs, 0);
  if (totalMs < GRAMMAR.reelMinMs) warnings.push(`reel is ${totalMs}ms — under the ${GRAMMAR.reelMinMs}ms looper floor; add a beat.`);
  if (totalMs > GRAMMAR.reelSoftMaxMs) warnings.push(`reel is ${totalMs}ms — over the ${GRAMMAR.reelSoftMaxMs}ms v1 ceiling (that's an engagement-format length).`);

  return { shots, totalMs, loop, hookMs, warnings };
}
