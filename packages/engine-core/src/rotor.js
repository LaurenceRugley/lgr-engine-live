/* rotor.js — L-audio-full-layer-slice1
   Helicopter rotor synth: blade-pass pulse + filtered-noise whoosh, throttle-keyed,
   placed at the craft's world position via a PositionalAudio node (spatial pan + distance attenuation).
   PILOTING-ONLY: when getThrottle() returns 0, gain fades to 0 (silent). The oscillators keep
   running at gain=0 so there's no start-up latency when the player seizes the craft again.

   SYNTH GRAPH:
     OscillatorNode (18 Hz sawtooth)          ← blade-pass pulse (sub-tonal thump)
       → BiquadFilter (lowpass, 180 Hz)        ← shapes pulse into a chest-felt thump
       → _masterGain (throttle-controlled)
     BufferSourceNode (looped white noise)     ← rotor whoosh texture
       → BiquadFilter (bandpass, 120 Hz)       ← tunes whoosh to rotor character
       → _masterGain
     _masterGain → PositionalAudio panner → AudioListener → destination

   REFUTE CORRECTION 3 (setNodeSource API):
     pa.setNodeSource(node) sets hasPlaybackControl=false.
     You MUST call osc.start() / noiseSource.start() yourself — pa.play() is a no-op after setNodeSource.

   C++ anchor: the gain envelope ≈ a per-voice amplitude ramp; the panner ≈ a 3D audio source
   with distance-based attenuation wired to the player camera's "ear" (the AudioListener). */

import * as THREE from 'three';

const _posVec = new THREE.Vector3();   // scratch: heli world pos (reused every update — no alloc)

export function createRotor(bus, positionalField, { getThrottle, getAltitude, getWorldPos }) {
  let _pa = null, _dummy = null, _masterGain = null, _pulse = null, _noiseSource = null;

  /* init() — MUST be called after positionalField.init() so getListener() is non-null.
     Builds the synth graph, wires it into a PositionalAudio node, starts the oscillators. */
  function init() {
    const ctx      = bus.context;
    const listener = positionalField.getListener();

    // Positional audio node — wraps our synth graph in a PannerNode that tracks _dummy.
    _dummy = new THREE.Object3D();   // proxy Object3D — we set its position each frame
    _pa    = new THREE.PositionalAudio(listener);
    _pa.setRefDistance(3);          // full-gain within 3 m (very close — the pilot IS in the craft)
    _pa.setMaxDistance(30);         // beyond 30 m the rotor fades out
    _pa.panner.panningModel = 'equalpower';   // set directly on PannerNode — no setPanningModel() method in Three.js
    _dummy.add(_pa);

    // 1 — Blade-pass pulse: a sawtooth at ~18 Hz (one blade pass per ~55 ms)
    _pulse = ctx.createOscillator();
    _pulse.type = 'sawtooth';
    _pulse.frequency.value = 18;

    const lpf = ctx.createBiquadFilter();
    lpf.type = 'lowpass'; lpf.frequency.value = 180; lpf.Q.value = 2.0;
    _pulse.connect(lpf);

    // 2 — Whoosh noise: a looped white-noise buffer through a bandpass (character texture)
    const noiseLen  = ctx.sampleRate * 4;   // 4-second noise loop (long enough to hide loop seam)
    const noiseBuf  = ctx.createBuffer(1, noiseLen, ctx.sampleRate);
    const nd        = noiseBuf.getChannelData(0);
    for (let i = 0; i < noiseLen; i++) nd[i] = Math.random() * 2 - 1;
    // Fade edges ±256 samples to zero → click-free loop point.
    const FADE = 256;
    for (let i = 0; i < FADE; i++) {
      const f = i / FADE;
      nd[i]                 *= f;
      nd[noiseLen - 1 - i]  *= f;
    }

    _noiseSource = ctx.createBufferSource();
    _noiseSource.buffer = noiseBuf;
    _noiseSource.loop   = true;

    const bpf = ctx.createBiquadFilter();
    bpf.type = 'bandpass'; bpf.frequency.value = 120; bpf.Q.value = 0.8;
    _noiseSource.connect(bpf);

    // 3 — Master gain (throttle-controlled): both signal paths feed here.
    _masterGain = ctx.createGain();
    _masterGain.gain.value = 0;   // start silent — gain ramps up as player seizes and throttles
    lpf.connect(_masterGain);
    bpf.connect(_masterGain);

    // 4 — Wire to PositionalAudio via setNodeSource so the panner spatialises the synth.
    //     After this call, hasPlaybackControl=false — pa.play() / pa.stop() are no-ops.
    //     We control playback entirely via _masterGain.gain.
    _pa.setNodeSource(_masterGain);

    // 5 — Start oscillators ourselves (REFUTE CORRECTION 3).
    _pulse.start();
    _noiseSource.start();
  }

  /* update(dt) — call once per frame inside the main loop.
     • Moves the proxy Object3D to the craft's world position (PannerNode tracks it via updateMatrixWorld).
     • Keys _masterGain.gain to the throttle value (0 = silent; 1 = full rotor).
     • Nudges blade frequency slightly with throttle (pitch rises under load — a touch of realism).
     When not piloting getThrottle() returns 0, so the rotor fades to silence automatically. */
  function update(dt) {
    if (!_pa) return;

    // Move proxy to heli world position.
    getWorldPos(_posVec);
    _dummy.position.copy(_posVec);
    _dummy.updateMatrixWorld();   // cascades to _pa → PannerNode position update

    const throttle    = Math.max(0, Math.min(1, getThrottle()));
    const targetGain  = throttle > 0.005 ? 0.35 + throttle * 0.55 : 0;
    const targetFreq  = 14 + throttle * 8;   // 14 Hz idle → 22 Hz at full throttle

    const ctx = bus.context;
    if (!ctx) return;
    const now = ctx.currentTime;
    _masterGain.gain.setTargetAtTime(targetGain, now, 0.12);      // 120 ms ramp — smooth, not laggy
    _pulse.frequency.setTargetAtTime(targetFreq, now, 0.20);
  }

  /* dispose() — stop oscillators (they consume CPU even at gain=0). */
  function dispose() {
    try { if (_pulse)       _pulse.stop();       } catch (_) {}
    try { if (_noiseSource) _noiseSource.stop(); } catch (_) {}
    _pa = _dummy = _masterGain = _pulse = _noiseSource = null;
  }

  return { init, update, dispose };
}
