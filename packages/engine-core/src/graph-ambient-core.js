/* ============================================================
   graph-ambient-core.js — VIZ SLICE 15: the AMBIENT-EVENT SCHEDULER (pure half).
   ------------------------------------------------------------
   Rare background flybys (a comet, a tiny spaceship) need a scheduler with three hard properties:

     DETERMINISTIC   seeded LCG advanced by the loop clock — never Math.random()/Date.now() (repo
                     invariant: the atlas must replay identically; a "random" sky is an untestable sky).
     ONE AT A TIME   two events airborne at once turns whimsy into traffic. A timer that comes due while
                     another event is flying HOLDS at zero and fires the moment the sky is free.
     RARE + JITTERED mean interval ± jitter, so the next comet is never predictable to the second but
                     the long-run cadence is exactly what was tuned.

   This file is the PURE half — no THREE, no shaders, no DOM — for the same hard reason heatFromAgeDays
   lives in graph-spec.js: graph-ambient.js imports raw .vert/.frag (vite-plugin-glsl), so Node's test
   loader can never touch it. Determinism and the one-event invariant are exactly the properties that
   MUST be node-testable rather than eyeballed (you cannot screenshot "the second comet was refused").

   C++ anchor: a cooperative event queue driven by a fixed-step game clock — `advance(dt)` is the
   classic `update(float dt)` tick, and the LCG is the same three uint32 lines every game shipped
   before <random>.
   ============================================================ */

/* The same numerical-recipes LCG graph-atmosphere uses (kept private there; exported here so the
   renderer half and any future ambient consumer share one implementation). */
export function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/* createAmbientScheduler({ seed, events }) → { advance(dt), spawn(kind), airborne, spawnCount }
     events: [{ kind, meanInterval, jitter=0.5, durationMin, durationMax }]  (seconds)
   advance(dt) → { spawned, done } — at most ONE spawn per call (the invariant, not a limitation).
   spawn(kind)  → the event, or null (REFUSED — something is already airborne, or the kind is unknown).
   A spawned event is { kind, t, duration, u:[u1,u2,u3] } — u are seeded uniforms the renderer maps to
   a trajectory (entry angle, chord skew, speed flavor), so the WHOLE flyby is replayable from the seed. */
export function createAmbientScheduler({ seed = 0xa3b1e47, events = [] } = {}) {
  const rnd = lcg(seed);
  const delayFor = (e) => {
    const j = e.jitter ?? 0.5;
    return e.meanInterval * (1 - j + rnd() * 2 * j);
  };
  const timers = new Map();
  for (const e of events) timers.set(e.kind, delayFor(e));   // first appearance is jittered too

  let airborne = null;
  let spawnCount = 0;

  function makeEvent(e) {
    const duration = e.durationMin + rnd() * (e.durationMax - e.durationMin);
    spawnCount++;
    return { kind: e.kind, t: 0, duration, u: [rnd(), rnd(), rnd()] };
  }

  function spawn(kind) {
    if (airborne) return null;                        // ONE event at a time — a forced spawn obeys it too
    const e = events.find((x) => x.kind === kind);
    if (!e) return null;
    airborne = makeEvent(e);
    timers.set(kind, delayFor(e));                    // the natural cadence restarts behind a forced spawn
    return airborne;
  }

  function advance(dt) {
    const out = { spawned: null, done: null };
    if (airborne) {
      airborne.t += dt;
      if (airborne.t >= airborne.duration) { out.done = airborne.kind; airborne = null; }
    }
    for (const e of events) {
      let t = timers.get(e.kind) - dt;
      if (t <= 0) {
        if (!airborne) {
          airborne = makeEvent(e);
          out.spawned = airborne;
          t = delayFor(e);
        } else {
          t = 0;   // due but the sky is busy: HOLD at zero, fire the moment it frees up
        }
      }
      timers.set(e.kind, t);
    }
    return out;
  }

  return {
    advance,
    spawn,
    get airborne() { return airborne; },
    get spawnCount() { return spawnCount; },
  };
}
