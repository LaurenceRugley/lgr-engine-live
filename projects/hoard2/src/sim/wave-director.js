/* ============================================================
   hoard2 · src/sim/wave-director.js — endless escalating wave state machine (THREE-free, node-testable).
   ------------------------------------------------------------
   A tiny state machine — lull → spawning → fighting → (clear) → lull — that reads the PINNED wave curve
   from config.WAVE (never redefines it) and drives spawns. DONE #3 rests on two facts this module
   guarantees:
     • the emitted spawn `count` is monotonic ↑ at a FIXED night phase (base curve is monotone by
       construction — core.test.mjs; the night countMul is a constant ≥1 on top of it), and
     • night makes waves bigger: count = round(base(n) · NIGHT.countMul(nf_at_wave_start)), so a night
       wave spawns strictly more than the same wave in daylight (observable in the trace).
   The night factor is sampled ONCE at wave start (via hooks.nightAt) so the wave's size is a single
   deterministic number the probe can read from wave:start {n, count, night}.

   Pure of THREE/engine: it calls injected hooks — requestSpawn(n)->actuallySpawned, onStart, onClear,
   nightAt() — so the sim wires it to the zombie pool + event bus, and a test wires it to counters.

   C++ anchor: a small `enum Phase` + switch driven by a dt accumulator; requestSpawn is a function
   pointer the owner supplies.
   ============================================================ */
export function createWaveDirector(config, hooks) {
  const W = config.WAVE;
  let wave = 0;
  let phase = 'lull';                 // 'lull' | 'spawning' | 'fighting'
  let timer = W.buildLullSeconds;     // lull countdown (a fortify/scavenge window before the first wave too)
  let toSpawn = 0;                    // zombies still owed for the current wave
  let spawnAcc = 0;                   // dt accumulator gating spawn ticks
  let curCount = 0, curNight = 0;     // this wave's total + the night factor it was sized at

  function beginWave() {
    wave++;
    const nf = hooks.nightAt ? hooks.nightAt() : 0;
    curNight = nf;
    const base = W.count(wave);
    // Night scales the wave UP (count ×1.5 at full night). max(base,…) keeps it ≥ the monotone base.
    curCount = Math.max(base, Math.round(base * config.NIGHT.countMul(nf)));
    toSpawn = curCount; spawnAcc = 0; phase = 'spawning';
    hooks.onStart(wave, curCount, nf);
  }

  // Advance the director one sim-tick. aliveCount = zombies currently alive (so we know when a wave clears).
  function step(dt, aliveCount) {
    if (phase === 'lull') {
      timer -= dt;
      if (timer <= 0) beginWave();
      return;
    }
    if (phase === 'spawning') {
      spawnAcc += dt;
      // Release bursts on the interval. If the live pool is saturated (requestSpawn returns < asked), stop
      // burning the schedule and wait for deaths to free slots (the remainder stays owed).
      while (spawnAcc >= W.spawnIntervalS && toSpawn > 0) {
        spawnAcc -= W.spawnIntervalS;
        const want = Math.min(W.spawnBurst, toSpawn);
        const got = hooks.requestSpawn(want);
        toSpawn -= got;
        if (got < want) { spawnAcc = 0; break; }
      }
      if (toSpawn <= 0) phase = 'fighting';
      return;
    }
    // 'fighting': everything is spawned; the wave clears when the arena is empty.
    if (phase === 'fighting' && aliveCount === 0) {
      hooks.onClear(wave, curCount, curNight);
      phase = 'lull'; timer = W.buildLullSeconds;
    }
  }

  // Probe hook: force-start wave n immediately (harness spawnWave(n)). Night is re-sampled for it.
  function forceWave(n) { wave = n - 1; beginWave(); }
  function reset() { wave = 0; phase = 'lull'; timer = W.buildLullSeconds; toSpawn = 0; spawnAcc = 0; curCount = 0; curNight = 0; }

  return {
    step, forceWave, reset,
    get wave() { return wave; }, get phase() { return phase; },
    get night() { return curNight; }, get count() { return curCount; }, get owed() { return toSpawn; },
  };
}
