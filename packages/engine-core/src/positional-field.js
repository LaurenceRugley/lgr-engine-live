/* positional-field.js — L-audio-full-layer-slice1
   Spatial audio seam: one AudioListener on the camera + a pool of THREE.PositionalAudio
   nodes that distance-attenuate registered sources (gulls, shore, boats…).

   CRITICAL INIT ORDER (per REFUTE CORRECTION 1 — fixes a hard crash):
     bus.context is null until bus.unlock(). Calling THREE.AudioContext.setContext(null)
     at boot makes new AudioListener() throw (createGain on null).
     CORRECT ORDER — all inside the unlock gesture:
       bus.unlock()
       → positionalField.init()   ← calls setContext(bus.context) FIRST, then creates listener
       → camera.add(listener)
       → build nodes (assign sources, start pool)

   POOL (per REFUTE CORRECTION 2):
     PositionalAudio nodes are EXPENSIVE (each builds a PannerNode). We pre-create MAX_CONCURRENT
     nodes and reuse them. Only the nearest-N sources play at any time; distant ones are silent.
     panningModel='equalpower' for cheap attenuation without HRTF convolution.

   NO-HOT-ALLOC: pre-allocate _posVec per source, _camVec and _sortBuf at module level.
   update() uses no heap — just position writes + in-place sort.

   C++ anchor: AudioListener ≈ the player's "ear"; PositionalAudio ≈ an AudioSource in Unity
   with distance rolloff; the pool ≈ a fixed-size voice bank. */

import * as THREE from 'three';

const MAX_CONCURRENT = 3;   // max simultaneous positional sources (3 voices → 3 PannerNodes)

export function createPositionalField(bus, camera) {
  let _listener = null;
  let _inited = false;
  const _sources  = [];          // registered source descriptors
  const _pool     = [];          // pool slots: [{dummy, pa, srcRef}]
  const _sortBuf  = [];          // scratch array for per-frame distance sort (no alloc in update)
  const _camVec   = new THREE.Vector3();   // scratch: camera world pos (reused every update)

  /* init() — MUST be called AFTER bus.unlock() so bus.context is non-null.
     Sets the shared AudioContext on Three's audio system, creates the listener,
     attaches it to the camera, and pre-creates the pool. */
  function init() {
    // THREE.AudioContext.setContext tells Three.js to use OUR context — the ONE-context rule.
    // Must happen before new THREE.AudioListener() (which calls getContext() internally).
    THREE.AudioContext.setContext(bus.context);
    _listener = new THREE.AudioListener();
    camera.add(_listener);

    for (let i = 0; i < MAX_CONCURRENT; i++) {
      const dummy = new THREE.Object3D();   // not in the scene — we call updateMatrixWorld() manually
      const pa    = new THREE.PositionalAudio(_listener);
      pa.panner.panningModel = 'equalpower';  // REFUTE CORRECTION 2: cheap vs HRTF convolution
      dummy.add(pa);                        // pa inherits dummy's world position via updateMatrixWorld
      _pool.push({ dummy, pa, srcRef: null });
    }
    _inited = true;
  }

  /* _assignSlot — find a free pool slot for src, start playback. */
  function _assignSlot(src) {
    for (let i = 0; i < _pool.length; i++) {
      const slot = _pool[i];
      if (slot.srcRef !== null) continue;   // occupied
      slot.srcRef = src;
      src._slot   = i;
      slot.pa.setRefDistance(src.refDistance);
      slot.pa.setMaxDistance(src.maxDistance);
      slot.pa.setRolloffFactor(1);
      slot.pa.setBuffer(src.buffer);
      slot.pa.setLoop(src.loop);
      slot.pa.setVolume(src.gain);
      // Seed the dummy position before play() to avoid a one-frame pop at the origin.
      slot.dummy.position.copy(src._posVec);
      slot.dummy.updateMatrixWorld();
      slot.pa.play();
      return;
    }
    // No free slot — source stays silent this frame (pool is full with closer sources).
  }

  /* _releaseSlot — stop playback and return the pool slot to free. */
  function _releaseSlot(src) {
    if (src._slot === null) return;
    const slot = _pool[src._slot];
    try { if (slot.pa.isPlaying) slot.pa.stop(); } catch (_) {}
    slot.srcRef = null;
    src._slot   = null;
  }

  /* add() — register a positional audio source.
     getPos(vec3)   : caller writes the source's world position into the provided Vector3 (no alloc).
     buffer         : decoded AudioBuffer to loop (required for now; synth via synthFactory is slice 2).
     refDistance    : full-volume radius (metres).
     maxDistance    : silence radius — beyond this the gain is effectively zero.
     loop           : whether the buffer loops (default true for ambient sources).
     gain           : linear volume at refDistance (0–1 scale).
     Returns a handle: { setActive(bool), dispose() }. */
  function add({ getPos, buffer, refDistance = 10, maxDistance = 50, loop = true, gain = 1 }) {
    const src = {
      getPos, buffer, refDistance, maxDistance, loop, gain,
      _posVec : new THREE.Vector3(),   // pre-allocated: getPos writes HERE (no alloc in update)
      _dist2  : Infinity,
      _slot   : null,
      _active : true,
    };
    _sources.push(src);

    return {
      setActive(v) {
        if (!v && src._slot !== null) _releaseSlot(src);
        src._active = !!v;
      },
      dispose() {
        if (src._slot !== null) _releaseSlot(src);
        const idx = _sources.indexOf(src);
        if (idx >= 0) _sources.splice(idx, 1);
      },
    };
  }

  /* getListener() — the AudioListener attached to the camera.
     Used by createRotor (which manages its own PositionalAudio node). */
  function getListener() { return _listener; }

  /* update() — call once per frame BEFORE rendering.
     1. Computes camera→source distances using pre-allocated vectors.
     2. Sorts sources by distance (in-place, no new array).
     3. Nearest MAX_CONCURRENT get a pool slot; the rest are released.
     4. Updates the dummy-Object3D positions so updateMatrixWorld() propagates to PannerNodes.
     No per-frame heap allocations (pre-alloc'd _posVec per source + _camVec + _sortBuf). */
  function update() {
    if (!_inited || _sources.length === 0) return;

    camera.getWorldPosition(_camVec);

    // Compute dist² for every source (writes into pre-alloc'd _posVec per source).
    for (const s of _sources) {
      s.getPos(s._posVec);
      s._dist2 = s._active ? _camVec.distanceToSquared(s._posVec) : Infinity;
    }

    // Sort by dist² ascending (nearest first). _sortBuf is reused (no new array).
    _sortBuf.length = 0;
    for (const s of _sources) _sortBuf.push(s);
    _sortBuf.sort((a, b) => a._dist2 - b._dist2);

    // Assign / release pool slots based on rank + range.
    const maxDist2 = (src) => src.maxDistance * src.maxDistance;
    for (let i = 0; i < _sortBuf.length; i++) {
      const s = _sortBuf[i];
      const inRange = s._active && i < MAX_CONCURRENT && s._dist2 < maxDist2(s);
      if (inRange  && s._slot === null) _assignSlot(s);
      if (!inRange && s._slot !== null) _releaseSlot(s);

      // Update dummy position so PannerNode tracks the source.
      if (s._slot !== null) {
        _pool[s._slot].dummy.position.copy(s._posVec);
        _pool[s._slot].dummy.updateMatrixWorld();
      }
    }
  }

  return { init, add, getListener, update };
}
