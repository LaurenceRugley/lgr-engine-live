/* @lgr/engine-core — ambient-bed.js (L-audio-sketch 2026-07-07)
   Three ambient-bed PRESETS for the open-world audio layer A/B/C listening sketch.
   All three use pure Web Audio synthesis — ZERO external assets. The approach matches
   the SunRig pattern: one module, keyframed personalities; losing presets get dropped
   after Laurence picks one by ear.

   Loudness calibration: all three presets target the same perceived RMS so the choice
   is CHARACTER, not volume. Bass-heavy Preset 1 gets a slight gain boost to compensate
   for the Fletcher-Munson roll-off below 100 Hz.

   Preset 1 · DAWN CALM — warm, slow-evolving pad (3 detuned sine oscillators through a
   gentle LFO-swept lowpass). Cinematic-serene. The beautiful safe default.

   Preset 2 · OPEN AIR — nature/ethereal: filtered-noise "wind" bed + sparse high bell
   tones (sine plucks with long decay). Minimal — more air than music.

   Preset 3 · DEEP DRIFT — modern/Lusion-lean: low warm sub-drone + soft delay "space"
   + occasional quiet bell/pluck motif. Richer, more electronic.

   API:
     createAmbientBed(bus, { preset: 1|2|3 })
       → { start(), stop() }
   Call start() AFTER bus.unlock() (the AudioContext must exist before creating nodes).
   Call stop() to tear down nodes cleanly (disconnects + releases oscillators/buffers). */

export function createAmbientBed(bus, { preset = 1 } = {}) {
  let _teardown = null;

  /* ── PRESET BUILDERS ─────────────────────────────────────────────────────────── */

  /* 1 · DAWN CALM — warm pad.
     Architecture: 3 detuned sines (A1 55Hz + A1+10¢ 55.5Hz + E2 82.4Hz) → lowpass
     filter (cutoff LFO: 12 s period ± 200 Hz around 400 Hz) → mix gain → output. */
  function _buildDawnCalm(ctx, output) {
    const mix = ctx.createGain(); mix.gain.value = 0.22; mix.connect(output);

    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = 420; filt.Q.value = 0.65;
    filt.connect(mix);

    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 1 / 12;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 200;
    lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
    lfo.start();

    const freqs = [55, 55.5, 82.4];
    const oscs = freqs.map((f) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      o.connect(filt); o.start(); return o;
    });

    return () => { oscs.forEach((o) => o.stop()); lfo.stop(); };
  }

  /* 2 · OPEN AIR — wind + sparse bells.
     Architecture:
       • Wind  = white-noise buffer (3 s looped) → slowly-modulated lowpass → windGain → mix
       • Bells = sparse sine plucks (A5/C6/E6/G6, 2–4 s gaps) with long exp-decay → bellGain → mix */
  function _buildOpenAir(ctx, output) {
    const mix = ctx.createGain(); mix.gain.value = 0.13; mix.connect(output);

    /* Wind: a 3-second white-noise buffer looped forever */
    const bufLen = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < bufLen; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 360; lp.Q.value = 0.4;
    const windGain = ctx.createGain(); windGain.gain.value = 0.65;
    noise.connect(lp); lp.connect(windGain); windGain.connect(mix);
    noise.start();

    /* Gentle wind LFO (8 s period ± 90 Hz on the cutoff) */
    const windLFO = ctx.createOscillator(); windLFO.type = 'sine'; windLFO.frequency.value = 1 / 8;
    const windLFOGain = ctx.createGain(); windLFOGain.gain.value = 90;
    windLFO.connect(windLFOGain); windLFOGain.connect(lp.frequency); windLFO.start();

    /* Sparse bell plucks — pentatonic: A5 880 / C6 1046 / E6 1319 / G6 1568 */
    const bellGain = ctx.createGain(); bellGain.gain.value = 0.45; bellGain.connect(mix);
    const BELL_FREQS = [880, 1046, 1319, 1568];
    let _bellTimer = null;
    function _scheduleBell() {
      const idx = (Math.random() * BELL_FREQS.length) | 0;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = BELL_FREQS[idx];
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.9, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.8);
      o.connect(env); env.connect(bellGain); o.start(); o.stop(ctx.currentTime + 2.9);
      _bellTimer = setTimeout(_scheduleBell, 2500 + Math.random() * 2500);
    }
    _scheduleBell();

    return () => { noise.stop(); windLFO.stop(); clearTimeout(_bellTimer); };
  }

  /* 3 · DEEP DRIFT — sub-drone + delay space + pluck motif.
     Architecture:
       • Sub-drone: 45 Hz + 90 Hz + 90.4 Hz sines → droneGain → mix (dry)
         and → delay node (wet; creates a spacious wash via feedback)
       • Drone LFO: slow 16 s pulse (±0.2 on the drone gain) for organic breathing
       • Delay: 0.75 s × 0.50 feedback → delay → mix
       • Pluck motif: A3/D4/F#4/A4 sines with short attack → delay only (decays in space) */
  function _buildDeepDrift(ctx, output) {
    const mix = ctx.createGain(); mix.gain.value = 0.14; mix.connect(output);

    /* Delay "space" — the feedback loop is delay → fbk → delay (the delay node is the break) */
    const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.75;
    const fbk   = ctx.createGain(); fbk.gain.value = 0.50;
    delay.connect(fbk); fbk.connect(delay);   // feedback chain (valid: delay is the break node)
    delay.connect(mix);                        // wet → out

    /* Sub drone — three detuned sines for warmth */
    const droneGain = ctx.createGain(); droneGain.gain.value = 0.55;
    droneGain.connect(mix);      // dry path
    droneGain.connect(delay);    // also feeds the delay

    const DRONE_FREQS = [45, 90, 90.4];
    const DRONE_AMPS  = [1.0, 0.45, 0.45];
    const oscs = DRONE_FREQS.map((f, i) => {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const g = ctx.createGain(); g.gain.value = DRONE_AMPS[i];
      o.connect(g); g.connect(droneGain); o.start(); return o;
    });

    /* Slow volume LFO — breathes the drone over 16 s */
    const droneLFO  = ctx.createOscillator(); droneLFO.type = 'sine'; droneLFO.frequency.value = 1 / 16;
    const droneLFOG = ctx.createGain(); droneLFOG.gain.value = 0.2;
    droneLFO.connect(droneLFOG); droneLFOG.connect(droneGain.gain); droneLFO.start();

    /* Pluck motif — feeds only the delay (so it decays into the space) */
    const pluckMix = ctx.createGain(); pluckMix.gain.value = 0.38; pluckMix.connect(delay);
    const PLUCK_FREQS = [220, 293.7, 370, 440];   // A3, D4, F#4, A4 — A minor flavour
    let _pluckTimer = null;
    function _schedulePluck() {
      const idx = (Math.random() * PLUCK_FREQS.length) | 0;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = PLUCK_FREQS[idx];
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.65, ctx.currentTime);
      env.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.6);
      o.connect(env); env.connect(pluckMix); o.start(); o.stop(ctx.currentTime + 1.7);
      _pluckTimer = setTimeout(_schedulePluck, 3000 + Math.random() * 3500);
    }
    _schedulePluck();

    return () => { oscs.forEach((o) => o.stop()); droneLFO.stop(); clearTimeout(_pluckTimer); };
  }

  /* ── PUBLIC API ──────────────────────────────────────────────────────────────── */

  function start() {
    if (_teardown) return;                             // already running
    const ctx = bus && bus.context; if (!ctx) return;  // bus must be unlocked first

    /* `output` fades 0→1 over ~4 s so the bed rises silently (no autoplay startle). */
    const output = ctx.createGain(); output.gain.value = 0; output.connect(bus.destination);

    const builders = { 1: _buildDawnCalm, 2: _buildOpenAir, 3: _buildDeepDrift };
    const build = builders[preset] || _buildDawnCalm;
    const presetTeardown = build(ctx, output);

    /* Fade in: timeConstant=0.85 s → ~99% reached in 4.3 s — natural ambient rise. */
    output.gain.setTargetAtTime(1, ctx.currentTime + 0.05, 0.85);

    _teardown = () => {
      /* Fade out first, then disconnect. */
      output.gain.setTargetAtTime(0, ctx.currentTime, 0.3);
      setTimeout(() => { presetTeardown(); output.disconnect(); }, 2000);
    };
  }

  function stop() {
    if (!_teardown) return;
    _teardown(); _teardown = null;
  }

  return { start, stop };
}
