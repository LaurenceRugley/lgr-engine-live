/* ============================================================
   hoard2 · src/core/time.js — THE CLOCK AUTHORITY (pause + dive dilation; core executes, owners read).
   ------------------------------------------------------------
   HOARD-CONTRACT.md pins the pause/timeScale API to core: subsystems NEVER freeze or dilate on their
   own — they ask `time` for the effective dt. Two independent controls compose here:

     · PAUSE (hard freeze) — the bag/crafting UI and the pause menu. `game:pause`/`game:resume` are
       emitted by ui; CORE executes them (main wires the bus → time.setPaused). Paused ⇒ every dt is 0.
     · DIVE DILATION (soft slow-mo) — while dived the world clock eases to DIVE_TIMESCALE (~0.5,
       ratified). The eased `scale` is the world/zombie multiplier; the first-person walker deliberately
       runs at REAL dt (the "matrix stride": you move full-speed while the horde crawls — v1 pattern,
       main.js:388).

   simDt(dt)  → the dilated world clock (zombies, waves, hunger, day/night sim-of-record advance on this).
   realDt(dt) → wall-clock while unpaused (the FP walker, decal/particle ageing — a blood pool fades on
                real seconds, not dilated ones; v1 main.js:359-360).
   Both return 0 when paused, so one `if (time.paused) return` is never needed in owners — multiplying by
   a 0 dt is a no-op step (no branching in hot loops).

   C++ anchor: a single authoritative game-clock object; systems query `clock.dt()` instead of reading a
   global wall timer, so slow-mo/pause is one place, not sprinkled through every update().
   ============================================================ */
import { DIVE_TIMESCALE } from './config.js';

// damp — frame-rate-independent exponential smoothing. VERBATIM from engine-core math.js:36 (inlined
// for the same reason as mulberry32 in rng.js: the barrel pulls shaders and dies under node --test, so
// the clock authority stays node-testable). Zero new ENGINE code — the freeze is intact.
const damp = (curr, goal, rate, dt) => curr + (goal - curr) * (1 - Math.exp(-rate * dt));

export function createTime() {
  let paused = false;
  let scale = 1; // eased dive dilation (1 = surfaced, ~0.5 = dived)
  let diveTarget = 1; // where scale is easing toward
  let elapsed = 0; // total UNPAUSED real seconds since boot (for daynight phase, wall-clock ageing)

  function setPaused(p) { paused = !!p; }
  function togglePaused() { paused = !paused; return paused; }
  // setDived(true/false): begin easing the world clock toward the dive dilation (or back to 1).
  function setDived(on) { diveTarget = on ? DIVE_TIMESCALE : 1; }

  // update(dt): ease the dilation each frame. Called by core BEFORE owners step, with the raw frame dt.
  // While paused the ease also freezes (scale holds), and elapsed does not advance.
  function update(dt) {
    if (paused) return;
    scale = damp(scale, diveTarget, 6, dt); // 6 = ease rate (v1 main.js:342), matrix-moment in/out
    elapsed += dt;
  }

  const simDt = (dt) => (paused ? 0 : dt * scale);
  const realDt = (dt) => (paused ? 0 : dt);

  return {
    setPaused, togglePaused, setDived, update, simDt, realDt,
    get paused() { return paused; },
    get scale() { return scale; },
    get elapsed() { return elapsed; },
  };
}
