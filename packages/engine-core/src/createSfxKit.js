/* ============================================================
   @lgr/engine-core — createSfxKit (Beauty B5: AUDIO DREAD — the combat/game voice, all SYNTHESIS, zero files).
   ------------------------------------------------------------
   The reusable audio identity: a bank of Web-Audio one-shot RECIPES, one per game-event class, that a
   project fires from its event bus (the hoard wires its B4 weapon/melee hooks + game events). Every voice
   is a tiny throwaway node graph — allocate oscillators/noise + a gain envelope, connect, start, schedule
   stop; the graph frees itself when its envelope ends (no mixer bookkeeping, no per-frame alloc). ZERO
   external assets — the synth-not-sample approach the engine's ambient-bed already uses.

   Lifted + enhanced from hoard2's project-local combat-sfx (engine-first: the identity is reusable). The
   headline enhancement is the GUNSHOT — layered per the proven doctrine: TRANSIENT (sub-ms pressure click)
   + BODY (swept low thump = "punch") + CRACK (band-passed noise = caliber character) + TAIL (broadband
   decay = the room) — with per-shot pitch/level JITTER so no two rounds are the identical waveform.

   POSITIONAL: pass a { pos, listener } to the vocal voices (zombieHurt/Death/groan) and they route through
   bus.positionalDest — distance rolloff + facing-relative stereo pan, so a walker groaning behind-left is
   quieter + panned left (the "hear them flanking" beat). The rest are 2-D (they happen AT the player).

   DEGRADE: createSfxKit(bus) → null when bus is null (headless / no Web Audio). live() drops every call
   while the context is suspended (pre-gesture) so nothing queues before the mobile unlock.

   C++ anchor: each method is a fire-and-forget voice — like triggering a one-shot sampler channel that
   auto-releases; positionalDest is a per-voice send with a pan+gain the geometry computes.
   ============================================================ */

export function createSfxKit(bus) {
  if (!bus) return null;

  let _noise = null;
  function noiseBuf(ctx) {
    if (_noise && _noise.sampleRate === ctx.sampleRate) return _noise;
    const len = (ctx.sampleRate * 0.5) | 0;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;   // audio-cosmetic jitter, never a sim roll
    _noise = b; return b;
  }
  // ctx only when actually running (post-unlock) — otherwise stay silent, don't queue.
  function live() { const ctx = bus.context; return ctx && ctx.state === 'running' ? ctx : null; }
  const jit = (c) => 1 + (Math.random() * 2 - 1) * c;   // ± jitter factor (per-shot variation)

  // a filtered-noise burst voice (crack / whoosh / thud / tail).
  function noiseVoice(ctx, dest, { type = 'bandpass', f = 1200, q = 1, gain = 0.2, dur = 0.12, f1 = null }) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf(ctx);
    const filt = ctx.createBiquadFilter(); filt.type = type; filt.frequency.value = f; filt.Q.value = q;
    if (f1 != null) filt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), ctx.currentTime + dur);
    const env = ctx.createGain(); const t0 = ctx.currentTime;
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(filt); filt.connect(env); env.connect(dest || bus.destination);
    src.start(t0); src.stop(t0 + dur + 0.02);
  }
  // a swept-oscillator voice (body thump / growl / ui blip / sting swell).
  function toneVoice(ctx, dest, { type = 'sine', f0 = 120, f1 = 60, gain = 0.2, dur = 0.14, attack = 0.004 }) {
    const o = ctx.createOscillator(); o.type = type; const t0 = ctx.currentTime;
    o.frequency.setValueAtTime(f0, t0); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t0);
    env.gain.exponentialRampToValueAtTime(gain, t0 + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(env); env.connect(dest || bus.destination);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  // resolve a positional destination for a vocal (or master when 2-D / no listener).
  function destFor(o) {
    if (o && o.pos && o.listener && bus.positionalDest) return bus.positionalDest(o.pos, o.listener) || bus.destination;
    return bus.destination;
  }

  return {
    // LAYERED GUNSHOT — transient + body + crack + tail, jittered so no two shots are identical.
    fire() {
      const ctx = live(); if (!ctx) return;
      const p = jit(0.12);
      noiseVoice(ctx, null, { type: 'highpass', f: 6000 * p, q: 0.5, gain: 0.28 * jit(0.1), dur: 0.012 }); // transient
      toneVoice(ctx, null, { type: 'triangle', f0: 190 * p, f1: 55, gain: 0.32 * jit(0.1), dur: 0.11 });      // body
      noiseVoice(ctx, null, { type: 'bandpass', f: 2400 * p, q: 1.4, gain: 0.22 * jit(0.12), dur: 0.06 });    // crack
      noiseVoice(ctx, null, { type: 'lowpass', f: 3200, f1: 500, q: 0.7, gain: 0.16, dur: 0.2 * jit(0.15) }); // tail
    },
    // IMPACT — a body hit is a soft wet thud; a world hit is a sharper tick.
    hit(isBody) {
      const ctx = live(); if (!ctx) return;
      if (isBody) { toneVoice(ctx, null, { type: 'sine', f0: 150, f1: 70, gain: 0.18, dur: 0.09 }); noiseVoice(ctx, null, { type: 'lowpass', f: 900, gain: 0.12, dur: 0.06 }); }
      else noiseVoice(ctx, null, { type: 'bandpass', f: 2600, q: 3, gain: 0.14, dur: 0.04 });
    },
    // MELEE — a whoosh on the swing; a wet thwack on connect.
    meleeWhoosh() { const ctx = live(); if (!ctx) return; noiseVoice(ctx, null, { type: 'bandpass', f: 900, f1: 2200, q: 0.7, gain: 0.14, dur: 0.16 }); },
    meleeConnect() { const ctx = live(); if (!ctx) return; noiseVoice(ctx, null, { type: 'lowpass', f: 1200, gain: 0.2, dur: 0.08 }); toneVoice(ctx, null, { type: 'sine', f0: 110, f1: 50, gain: 0.2, dur: 0.1 }); },
    // ZOMBIE vocals — positional. hurt = short pained grunt; death = a low downward growl.
    zombieHurt(o) { const ctx = live(); if (!ctx) return; const d = destFor(o); toneVoice(ctx, d, { type: 'sawtooth', f0: 210 * jit(0.15), f1: 120, gain: 0.16, dur: 0.14 }); },
    zombieDeath(o) { const ctx = live(); if (!ctx) return; const d = destFor(o); toneVoice(ctx, d, { type: 'sawtooth', f0: 170 * jit(0.2), f1: 45, gain: 0.2, dur: 0.5 }); noiseVoice(ctx, d, { type: 'lowpass', f: 700, gain: 0.1, dur: 0.4 }); },
    // GROAN — the ambient horde voice (positional), a slow low moan.
    groan(o) { const ctx = live(); if (!ctx) return; const d = destFor(o); toneVoice(ctx, d, { type: 'sawtooth', f0: 90 * jit(0.2), f1: 70, gain: 0.13, dur: 0.9, attack: 0.15 }); },
    // BARRIER — wood thud (damage), a heavier crack (breach), a lighter knock (repair).
    barrier(kind) {
      const ctx = live(); if (!ctx) return;
      if (kind === 'breach') { toneVoice(ctx, null, { type: 'triangle', f0: 130, f1: 40, gain: 0.28, dur: 0.28 }); noiseVoice(ctx, null, { type: 'lowpass', f: 1400, gain: 0.18, dur: 0.2 }); }
      else if (kind === 'repair') { toneVoice(ctx, null, { type: 'square', f0: 300, f1: 200, gain: 0.1, dur: 0.06 }); }
      else { noiseVoice(ctx, null, { type: 'lowpass', f: 1600, gain: 0.16, dur: 0.09 }); toneVoice(ctx, null, { type: 'triangle', f0: 160, f1: 90, gain: 0.14, dur: 0.08 }); }
    },
    // UI — a tiny confirmation tick (harvest / build / craft / pickup share it, pitched by kind).
    ui(kind) {
      const ctx = live(); if (!ctx) return;
      const f = kind === 'pickup' ? 880 : kind === 'craft' ? 660 : kind === 'build' ? 440 : 560;
      toneVoice(ctx, null, { type: 'sine', f0: f, f1: f, gain: 0.08, dur: 0.05, attack: 0.002 });
    },
    // STING — the death screen: a low ominous swell that resolves down.
    sting() { const ctx = live(); if (!ctx) return; toneVoice(ctx, null, { type: 'sawtooth', f0: 140, f1: 40, gain: 0.24, dur: 1.4, attack: 0.25 }); noiseVoice(ctx, null, { type: 'lowpass', f: 400, gain: 0.1, dur: 1.2 }); },
    get ready() { return !!live(); },
  };
}
