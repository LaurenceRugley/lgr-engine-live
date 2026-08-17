/* ============================================================
   audio-bus-retry.test.mjs — audit 2026-08-17 R3: one bad fetch must not poison a sample URL.
   ------------------------------------------------------------
   THE BUG THIS PINS: loadSample cached the in-flight promise by URL — correct for de-duping —
   but a REJECTED promise stayed in the cache too. One transient network failure (a phone losing
   signal for a second at boot) meant every later loadSample(url) for the whole session returned
   that same dead promise: the sample was permanently silent with no retry path. The fix evicts
   the cache entry on rejection, so the NEXT call re-fetches; successes stay cached forever.

   Rule 9 — the intent: the cache exists to collapse duplicate work, not to memoise failure.
   C++ anchor: a memo table that stores the thrown exception and rethrows it forever, versus one
   that clears the slot so the computation can be retried — only the second is a cache.

   HEADLESS RIG: audio-bus reads `window.AudioContext` at createAudioBus() CALL time (not import),
   so a stub window + AudioContext + fetch is enough — no browser, no GL, no real audio device.
   ============================================================ */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAudioBus } from './audio-bus.js';

class StubAudioContext {
  constructor() { this.state = 'running'; this.destination = {}; this.currentTime = 0; }
  createGain() { return { gain: { value: 1, setTargetAtTime() {} }, connect() {} }; }
  resume() {}
  decodeAudioData(ab) { return Promise.resolve({ decodedFrom: ab }); }
}

test('a rejected fetch is EVICTED — the next loadSample retries instead of replaying the failure', async () => {
  globalThis.window = { AudioContext: StubAudioContext };
  let fetches = 0, failNext = true;
  globalThis.fetch = () => {
    fetches++;
    return failNext
      ? Promise.reject(new Error('simulated transient network failure'))
      : Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
  };

  const bus = createAudioBus();
  assert.ok(bus, 'stub window must satisfy the SSR guard');
  bus.unlock();

  // 1. The network blips: the first load fails, and the CALLER still sees that failure.
  await assert.rejects(bus.loadSample('sfx/thud.mp3'), /transient/);
  assert.equal(fetches, 1);

  // 2. The network recovers: the same URL must be RE-FETCHED and succeed.
  //    (Old code: the rejected promise was still the cache tenant → this await rejects, no fetch #2.)
  failNext = false;
  await new Promise((r) => setTimeout(r, 0));      // let the eviction microtask run
  const buf = await bus.loadSample('sfx/thud.mp3');
  assert.ok(buf && buf.decodedFrom, 'recovered load must hand back a decoded buffer');
  assert.equal(fetches, 2, 'recovery requires a real second fetch');

  // 3. Success is still cached forever — de-duping is the reason the cache exists.
  const again = await bus.loadSample('sfx/thud.mp3');
  assert.equal(again, buf, 'a successful decode is shared, not re-fetched');
  assert.equal(fetches, 2, 'no third fetch for a cached success');
});
