/* ============================================================
   hoard2 · src/core/rng.js — SEEDED, NAMED, FORKED randomness (the determinism spine).
   ------------------------------------------------------------
   HOARD-CONTRACT.md rule 4: seeded RNG only, via NAMED forked streams — `rng.fork('sim'|'world'|'fx')`
   — so sim determinism depends ONLY on the sim stream. If the world's tree scatter and the sim's spawn
   rolls shared one stream, adding a tree would shift every spawn (a determinism landmine); forking gives
   each subsystem its own independent sequence off the same master seed. Same seed → identical sim trace
   (DONE #10) regardless of how many world/fx rolls happen.

   mulberry32 is imported from the FROZEN engine (citygen.js:33, re-exported from the barrel) — zero new
   engine code, one proven PRNG. Each fork mixes the master seed with a hash of the fork name so the
   streams are decorrelated but reproducible.

   NEVER use Math.random() in sim/world/fx (breaks determinism). Math.random() is fine ONLY for cosmetic,
   non-simulated jitter that never feeds a probe trace (and even then, prefer a fork).

   C++ anchor: one seeded engine per subsystem — like giving each system its own `std::mt19937` seeded
   from a master `seed ^ fnv1a(name)`, instead of everyone sharing one global generator.

   WHY mulberry32 is inlined here (not imported): the frozen engine exports it, but ONLY through the
   barrel (`@lgr/engine-core`), whose index re-exports `.frag`/`.vert` shaders — so a node import of the
   barrel dies with ERR_UNKNOWN_FILE_EXTENSION, and citygen.js is not in the (frozen) exports map for a
   deep import. Determinism (DONE #10) must be node-testable in CI, so this is the IDENTICAL algorithm
   (citygen.js:33, byte-for-byte) copied into the GAME layer — zero new ENGINE code; the freeze is intact.
   ============================================================ */

// mulberry32 — a 32-bit seeded PRNG. Pure function of state → same seed, same sequence forever.
// VERBATIM from packages/engine-core/src/citygen.js:33 (the canonical source; kept identical so the
// game's streams could interoperate with the engine's if ever needed).
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// FNV-1a 32-bit — a tiny, well-distributed string hash to derive a per-name seed offset.
function hashName(name) {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createRng(masterSeed) {
  const streams = new Map(); // name → mulberry32 fn (one live stream per name; fork() is idempotent)

  // fork(name): returns THE stream for `name` (created once, cached). Calling fork twice with the same
  // name returns the SAME stream — so a subsystem forks once at init and holds the handle. Returns a
  // function () => float in [0,1), plus helpers hung off it.
  function fork(name) {
    let r = streams.get(name);
    if (r) return r;
    const seed = (masterSeed ^ hashName(name)) >>> 0;
    const next = mulberry32(seed); // () => [0,1)
    // Ergonomic helpers — all deterministic, all off the same stream:
    next.range = (a, b) => a + (b - a) * next();
    next.int = (a, b) => a + Math.floor(next() * (b - a + 1)); // inclusive [a,b]
    next.pick = (arr) => arr[Math.floor(next() * arr.length)];
    next.chance = (p) => next() < p;
    next.streamName = name;
    streams.set(name, next);
    return next;
  }

  return { fork, masterSeed };
}
