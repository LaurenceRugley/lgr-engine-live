/* @lgr/engine-core — audio-bus.js (L-audio-sketch 2026-07-07)
   The engine's one AudioContext owner. All project audio routes through here so we
   never create a second context (browsers cap at a handful and warn on extras).

   AUTOPLAY LAW: the AudioContext starts suspended; `unlock()` MUST be called inside
   a real user gesture (tap, click, key). Do not call it at module load or in a timer.

   Pattern: `createAudioBus()` → null if the browser lacks Web Audio (SSR-safe).
   Projects call `bus.unlock()` in their gesture handlers, then connect synthesis nodes
   to `bus.destination`. The returned `master` GainNode is the single mix bus output;
   `setMuted(true/false)` fades the whole mix in/out.

   C++ anchor: the AudioContext ≈ a DirectSound/CoreAudio device; GainNode ≈ a fader on
   the master bus; the graph of connected nodes ≈ a signal-flow patch bay. */

export function createAudioBus() {
  const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
  if (!AC) return null;

  let ctx = null, master = null, _muted = false, _unlocked = false;
  const _cache = new Map();   // url → Promise<AudioBuffer> — decode once, cache forever

  function _init() {
    if (ctx) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 1.0;
    master.connect(ctx.destination);
  }

  return {
    /* Call inside a user gesture — creates the context + resumes it. Idempotent. */
    unlock() {
      _init();
      if (ctx.state === 'suspended') ctx.resume();
      _unlocked = true;
    },

    /* Smooth mute / unmute (25 ms envelope so there are no clicks). */
    setMuted(v) {
      _muted = !!v;
      if (master) master.gain.setTargetAtTime(_muted ? 0 : 1, ctx.currentTime, 0.25);
    },

    /* Override the master fader (0–1). Avoid calling at audio rate. */
    setMasterGain(v) {
      if (!master) return;
      master.gain.setTargetAtTime(Math.max(0, v), ctx.currentTime, 0.05);
    },

    /* Load + decode an audio file by URL; cached by URL (fetch once, decode once).
       MUST be called after unlock() — ctx must exist.
       C++ anchor: think of this as async disk-read → format-decode into a PCM buffer. */
    loadSample(url) {
      if (!ctx) throw new Error('audio-bus: loadSample requires unlock() first');
      if (!_cache.has(url)) {
        _cache.set(url, fetch(url).then(r => r.arrayBuffer()).then(ab => ctx.decodeAudioData(ab)));
      }
      return _cache.get(url);
    },

    /* Play a decoded AudioBuffer one-shot or looped. Returns a {stop()} handle.
       `dest` overrides the routing target (default: master bus).
       C++ anchor: BufferSourceNode ≈ a one-shot sampler voice — connect, trigger, fire. */
    playBuffer(buf, { loop = false, gain = 1, when = 0, dest = null } = {}) {
      if (!ctx || !buf) return { stop() {} };
      const g = ctx.createGain(); g.gain.value = gain;
      g.connect(dest || master);
      const src = ctx.createBufferSource();
      src.buffer = buf; src.loop = loop;
      src.connect(g);
      src.start(when || ctx.currentTime);
      return { stop() { try { src.stop(); } catch (_) {} } };
    },

    /* Synthesis nodes route here (the master GainNode that feeds ctx.destination). */
    get destination() { return master; },

    /* The AudioContext itself — needed by synthesis code to create nodes. */
    get context()     { return ctx; },

    get muted()       { return _muted; },
    get unlocked()    { return _unlocked; },
  };
}
