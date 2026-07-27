/* ============================================================
   hoard2 · src/fx/combat-sfx.js — procedural one-shot combat SFX through the engine's audio bus.
   ------------------------------------------------------------
   The fx-audio owner's combat voice. It synthesises short one-shots (gunshot, impact tick, melee whoosh,
   zombie death growl, barrier thud) entirely with Web Audio — ZERO external assets (HOARD-CONTRACT rule 3:
   `three` + committed CC0 assets only; there are no committed audio samples). Each call builds a tiny
   throwaway voice graph, fires it, and lets it garbage-collect after its envelope — the same synth-not-
   sample approach the engine's ambient-bed uses.

   ENGINE-GAP NOTE (flagged in the report): these are 2-D (non-positional) one-shots. The frozen engine's
   `createPositionalField` is a PERSISTENT-LOOP-SOURCE distance field (its add() requires a decoded
   AudioBuffer and ranks nearest-N looping emitters) — it has no "trigger this buffer AT this world point,
   once" path, so it cannot voice transient combat SFX. Positional one-shots would need a new engine seam
   (e.g. positionalField.trigger(buffer, worldPos) or bus.playOneShotAt(...)); until then combat SFX are 2-D.

   DEGRADE: `createCombatSfx(bus)` returns null when the bus is null (headless / no Web Audio) or before
   unlock — the fx graph then simply skips every SFX call. A gain guard also drops one-shots while the
   context is suspended so nothing queues up pre-gesture.

   C++ anchor: each one-shot is a fire-and-forget voice — allocate an oscillator/noise source + a gain
   envelope, connect, start, schedule stop; no mixer bookkeeping, the node graph frees itself when it ends.
   ============================================================ */

export function createCombatSfx(bus) {
  if (!bus) return null;

  // A short white-noise buffer, decoded once and reused as the source for noisy voices (gun, melee, thud).
  let _noise = null;
  function noiseBuf(ctx) {
    if (_noise && _noise.sampleRate === ctx.sampleRate) return _noise;
    const len = (ctx.sampleRate * 0.4) | 0;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;   // cosmetic-only jitter; never a sim roll
    _noise = b;
    return b;
  }

  // Guard: no context yet, or the browser hasn't resumed it inside a gesture → stay silent (don't queue).
  function live() {
    const ctx = bus.context;
    return ctx && ctx.state === 'running' ? ctx : null;
  }

  function noiseVoice(ctx, { type, freq, q, gain, dur }) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(ctx);
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = freq; filt.Q.value = q;
    const env = ctx.createGain();
    const t0 = ctx.currentTime;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(env); env.connect(bus.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }

  function toneVoice(ctx, { f0, f1, type, gain, dur }) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, ctx.currentTime);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), ctx.currentTime + dur);
    const env = ctx.createGain();
    const t0 = ctx.currentTime;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(env); env.connect(bus.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }

  return {
    // gunshot: a bright noise crack + a low body thump.
    fire() {
      const ctx = live(); if (!ctx) return;
      noiseVoice(ctx, { type: 'highpass', freq: 1400, q: 0.7, gain: 0.5, dur: 0.09 });
      toneVoice(ctx, { f0: 180, f1: 60, type: 'sine', gain: 0.35, dur: 0.10 });
    },
    // impact: a short tick — sharper for a body hit, duller for a world hit.
    hit(_pos, isBody) {
      const ctx = live(); if (!ctx) return;
      noiseVoice(ctx, { type: 'bandpass', freq: isBody ? 900 : 500, q: 1.4, gain: 0.28, dur: 0.06 });
    },
    // melee: a filtered-noise whoosh.
    melee() {
      const ctx = live(); if (!ctx) return;
      noiseVoice(ctx, { type: 'bandpass', freq: 700, q: 0.8, gain: 0.3, dur: 0.16 });
    },
    // death: a low downward growl.
    death() {
      const ctx = live(); if (!ctx) return;
      toneVoice(ctx, { f0: 160, f1: 42, type: 'sawtooth', gain: 0.22, dur: 0.34 });
    },
    // barrier: a wood thud; breach is heavier/longer than a single damage tick.
    barrier(kind) {
      const ctx = live(); if (!ctx) return;
      const breach = kind === 'breach';
      noiseVoice(ctx, { type: 'lowpass', freq: breach ? 260 : 380, q: 0.9, gain: breach ? 0.42 : 0.26, dur: breach ? 0.22 : 0.1 });
      toneVoice(ctx, { f0: breach ? 120 : 150, f1: 50, type: 'triangle', gain: breach ? 0.3 : 0.18, dur: breach ? 0.25 : 0.12 });
    },
  };
}
