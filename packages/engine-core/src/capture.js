/* ============================================================
   capture.js — Lesson 15: in-engine capture (stills · video · director sequences).
   ------------------------------------------------------------
   Until now, every demo video came from an EXTERNAL Playwright harness. This lesson moves
   capture INSIDE the engine: one keypress makes any scene a deliverable.

   THE KEY IDEA: a <canvas> is a MEDIA SOURCE. `canvas.captureStream(fps)` hands the GPU's
   composited frames to a `MediaRecorder` exactly like a webcam feeds one. And the punchline:
   a canvas stream contains ONLY the canvas — the DOM hint bar / REC dot are never in it. So
   every recording is automatically clean, no matter what's overlaid on the page.

   THREE OUTPUTS:
   - `S` — a still PNG of the current frame (`canvas.toBlob`).
   - `R` — toggle video recording (captureStream → MediaRecorder → download on stop).
   - DIRECTOR — a tiny declarative sequencer that drives the existing rig/sun/key verbs through
     an authored shot list; `?capture=tour` arms recording, runs the shot list, and downloads —
     a fully hands-off deliverable.

   C++ ANALOGIES (per CLAUDE.md):
   - `MediaRecorder` ≈ an encoder pipeline you feed frames into; you don't touch the codec
     internals, you push data and it emits compressed chunks.
   - A `Blob` ≈ an opaque `std::vector<uint8_t>` with a MIME tag — a byte buffer you can hand to
     a URL or a download, not something you index into.
   - CODEC vs CONTAINER: the codec (H.264/VP9) is how frames are COMPRESSED; the container
     (.mp4/.webm) is the box that holds the compressed stream + metadata. Same codec can live in
     different containers — like an algorithm vs the file format that wraps its output.
   ============================================================ */

/* Candidate recording formats, best-first. We feature-detect because support varies by browser:
   Chrome 126+ can emit MP4/H.264 (universally playable); everything modern does WebM/VP9. */
const VIDEO_TYPES = [
  'video/mp4;codecs=avc1.42E01E',   // H.264 in MP4 — most portable (newer Chrome)
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm',
];

export function createCapture({ renderer, rig, sunRig, poke, getState, office = {}, world = null, sequences = false }) {
  const canvas = renderer.domElement;
  const params = new URLSearchParams(window.location.search);

  /* filename from live state: lgr-<lesson>-<clock>-<style>.<ext> (e.g. lgr-15-1830-vec-pixel.mp4). */
  const fname = (ext) => {
    const s = getState();
    return `lgr-${s.lesson}-${String(s.clock || '').replace(':', '')}-${s.style}.${ext}`;
  };
  /* Blob → download: wrap the bytes in an object URL, click a hidden <a>, then revoke the URL
     (an object URL pins the Blob in memory until revoked — a manual free, like delete[]). */
  const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  /* ---- STILL (S) — canvas → PNG -------------------------------------------------
     `toBlob` reads the drawing buffer. WebGL normally CLEARS it after compositing, so a naive
     read returns black; two fixes (we use the first): (a) `preserveDrawingBuffer: true` on the
     renderer keeps the last frame readable anytime — tiny always-on cost, dead simple; (b) zero
     cost: re-render one frame synchronously and `toBlob` in the SAME task before the browser
     composites. We chose (a) so a still always matches exactly what's on screen. */
  function still() {
    canvas.toBlob((blob) => {
      if (!blob) return;
      download(blob, fname('png'));
      window.__lastStill = blob.size;             // exposed for the verify harness
    }, 'image/png');
  }

  /* ---- VIDEO (R toggles) — captureStream → MediaRecorder ------------------------ */
  const pickType = () => VIDEO_TYPES.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
  const indicator = makeIndicator();
  let recorder = null, chunks = [], recording = false, streamFps = 60;

  function startRec() {
    if (recording) return;
    const mimeType = pickType();
    const stream = canvas.captureStream(streamFps);   // the canvas as a live video track
    recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond: 12_000_000 } : {});
    chunks = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: recorder.mimeType });
      download(blob, fname(recorder.mimeType.includes('mp4') ? 'mp4' : 'webm'));
      window.__lastVideo = blob.size;
    };
    recorder.start();
    recording = true; window.__recording = true; indicator.show();
  }
  function stopRec() {
    if (!recording) return;
    recorder.stop();                              // flushes → onstop → download
    recording = false; window.__recording = false; indicator.hide();
  }
  const toggleRec = () => (recording ? stopRec() : startRec());

  /* ---- DIRECTOR — a declarative shot list ---------------------------------------
     Each step is data: { keys, zoom, orbit, timeTo, ripple, waitMs }. We DON'T re-implement
     input — `keys` dispatches real keydown events (so every existing handler runs) and the
     camera/sun steps call the rig/sunRig verbs directly. Authoring a demo is now editing an array. */
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  /* L88: a step key may carry a Shift modifier (`'Shift+W'`) — weather moved off plain `W` to
     `Shift+W` so the city can use WASD for free-fly. We parse the prefix and set `shiftKey` on the
     synthetic event so the real handler (which now requires shift for weather) fires correctly. */
  const dispatchKey = (spec) => {
    const shiftKey = spec.startsWith('Shift+');
    const key = shiftKey ? spec.slice(6) : spec;
    window.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey }));
  };

  // a gentle ripple drag across the lower-left open water (scaled to the canvas size).
  async function rippleDrag() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const x0 = w * 0.26, y0 = h * 0.74;
    for (let i = 0; i <= 10; i++) { poke.at(x0 + i * w * 0.028, y0 + Math.sin(i * 0.7) * 16); await sleep(100); }
    poke.stop();
  }

  async function exec(step) {
    if (step.world) world?.[step.world]?.();            // L94: 'enter'/'exit' world mode (the hero plays in the world)
    if (step.keys) for (const k of step.keys) { dispatchKey(k); await sleep(70); }
    if (step.zoom) rig.zoomBy(step.zoom);
    if (step.orbit) rig.orbit(step.orbit[0], step.orbit[1]);
    if (step.timeTo !== undefined) sunRig.goTo(step.timeTo);
    if (step.pour && world?.flowPourAt) for (let i = 0; i < 10; i++) world.flowPourAt(step.pour[0], step.pour[1], step.pour[2], step.pour[3]);   // L94: a water SPLASH — the real flow sim spreads it
    if (step.office) office[step.office]?.();           // L23: a no-key office action (pet/feed/laptop/travel/…)
    if (step.ripple) await rippleDrag();
    if (step.waitMs) await sleep(step.waitMs);
  }

  /* The three authored sequences (beats taken from DESIGN's proven showcase choreography). */
  const SEQUENCES = {
    // 'tour' — the full range pitch: living city → ripples → orbit → day/night → eras → toon → 8-bit.
    tour: [
      { keys: ['6', '0'], waitMs: 600 },
      { zoom: 0.72, waitMs: 1700 },
      { ripple: true, waitMs: 2400 },
      { orbit: [0.55, 0], waitMs: 1700 },
      { timeTo: 0.0, waitMs: 3000 },                 // day → night (lights, pools)
      { timeTo: 0.5, waitMs: 1500 },                 // back to day
      { keys: ['7'], waitMs: 1000 },                 // pixel-over-vector
      { zoom: 1.5, waitMs: 1400 },
      { keys: ['B'], waitMs: 2000 }, { keys: ['B'], waitMs: 2000 }, { keys: ['B'], waitMs: 2000 },
      { keys: ['B'], waitMs: 2000 }, { keys: ['B'], waitMs: 2000 },   // cycle all eras
      { keys: ['8'], waitMs: 900 },                  // toon-over-vector
      { zoom: 0.65, waitMs: 1200 },
      { ripple: true, waitMs: 2600 },
      { keys: ['7'], waitMs: 700 }, { keys: ['B'], waitMs: 300 }, { keys: ['B'], waitMs: 900 }, // 8-bit finale
      { zoom: 1.4, waitMs: 2600 },
    ],
    // 'daycycle' — a continuous sun sweep through a full day (timeTo climbs past 1 → wraps).
    daycycle: [
      { keys: ['6', '0'], waitMs: 700 },
      { timeTo: 0.75, waitMs: 2600 }, { timeTo: 1.0, waitMs: 2600 },
      { timeTo: 1.25, waitMs: 2600 }, { timeTo: 1.5, waitMs: 2600 }, { timeTo: 1.5, waitMs: 800 },
    ],
    // 'office' (L23) — the office-dive beat, so the demo video can finally show the room: dive in →
    // pet the cat → feed the fish → phone-travel the skyline → fog past the glass → into night (the
    // tank glows, the cat sleeps) → back out. NOTE: the laptop "game" panel is a DOM overlay, NOT in
    // the canvas stream by design (L15) — the recorded beat is the 3D life; the panel is live-only.
    office: [
      { keys: ['o'], waitMs: 1700 },             // dive into the office (the ~1s portal) + settle
      { office: 'pet', waitMs: 1300 },           // pet the cat → a floating heart
      { office: 'feed', waitMs: 1700 },          // feed the fish → they dart to the dropped flake
      { office: 'travel', waitMs: 1700 },        // phone → fly to the next city (the glass swaps)
      { keys: ['Shift+W', 'Shift+W', 'Shift+W'], waitMs: 1800 },   // weather → fog (L88: Shift+W), drifting past the corner glass
      { timeTo: 0.0, waitMs: 2400 },             // into NIGHT: the fish tank glows, the cat curls asleep
      { office: 'laptop', waitMs: 800 }, { office: 'closeLaptop', waitMs: 300 },  // (panel is live-only)
      { timeTo: 0.5, waitMs: 900 },              // back to day
      { keys: ['Shift+W'], waitMs: 200 },        // weather back to clear (fog → clear) — L88: Shift+W
      { keys: ['o'], waitMs: 1500 },             // exit the office, back to the city
    ],
    // 'cities' — the multi-city showreel: hold each profile at dusk (icons lit + readable).
    cities: [
      { keys: ['6', '0'], waitMs: 500 },
      { timeTo: 0.78, waitMs: 2800 },                // dusk, Manhattan
      { keys: ['C'], waitMs: 3000 },                 // → Paris
      { keys: ['C'], waitMs: 3000 },                 // → Neo-Tokyo
      { keys: ['C'], waitMs: 2000 },                 // → back to Manhattan
    ],
    // 'water' (L26) — the water-life showpiece: pull back to the open ocean so the BOATS carve real
    // wakes, swing to the +X harbor + ferry, poke the water (our sim is real), then into NIGHT for the
    // boats' running lights, and back to day. Flat-vector so the cyan water reads the wakes crisply.
    water: [
      { keys: ['6', '0'], waitMs: 600 },             // dimetric + flat-vector (cyan water shows wakes)
      { zoom: 1.35, waitMs: 2800 },                  // pull back to the sea — boats trail V-wakes
      { orbit: [0.7, 0], waitMs: 2600 },             // swing toward the +X harbor + the ferry at the docks
      { ripple: true, waitMs: 2200 },                // drag-poke the water (the interactive sim)
      { timeTo: 0.0, waitMs: 3200 },                 // into NIGHT → warm-bow / red-stern running lights
      { timeTo: 0.5, waitMs: 1500 },                 // back to day
      { orbit: [-0.5, 0], waitMs: 2200 },            // drift back, hold on the wakes
    ],
    // 'morph' (L27) — the signature move: AUTO Style-LOD. Zoom IN → smooth toon; zoom OUT → the city
    // walks DOWN the fidelity ladder (16-bit → 8-bit → Game Boy), then snaps back. Zoom IS the style.
    morph: [
      { keys: ['6', '3'], waitMs: 700 },             // dimetric + AUTO Style-LOD (vector off → morph shows)
      { zoom: 0.55, waitMs: 1800 },                  // zoom in  → TOON (smooth, hi-fi)
      { zoom: 2.30, waitMs: 1700 },                  // out → 16-bit
      { zoom: 1.26, waitMs: 1700 },                  // further out → 8-bit
      { zoom: 1.16, waitMs: 1900 },                  // out → Game Boy (most retro)
      { zoom: 0.30, waitMs: 2200 },                  // snap back in → toon (the morph reverses)
    ],
    // 'skin' (L29/L30) — the diffusion office: dive in → cycle 3D → smooth → charm (painted props,
    // fully cohesive) → scrub day→night so the LIVE window still plays through the painted glass →
    // show the live-3D-props variant (animated cat/fish over the painting) → out.
    skin: [
      { keys: ['o'], waitMs: 1800 },                 // dive into the office (3D look)
      { keys: ['j'], waitMs: 2000 },                 // → smooth diffusion skin (painted props)
      { keys: ['j'], waitMs: 2000 },                 // → charm diffusion skin
      { timeTo: 0.0, waitMs: 2600 },                 // day → NIGHT: the live window + room dim through the painting
      { timeTo: 0.5, waitMs: 1500 },                 // back to day
      { keys: ['u'], waitMs: 2000 },                 // painted → LIVE 3D props (animated cat/fish over the painting)
      { keys: ['j'], waitMs: 1400 },                 // → back to 3D office
      { keys: ['o'], waitMs: 1500 },                 // exit to the city
    ],
  };

  // 'hero' (L94) — the SHOWCASE hero flythrough, composed (not free-cam). Plays in the WORLD at golden→dusk,
  // where L92/L93 (grade + beauty-pop + aerial fog) are most dramatic and L94's sway+dust make it ALIVE. Beats:
  // world reveal (a slow push over the swaying, dusty terrain) → a water SPLASH (the real flow sim spreads it) →
  // a day→dusk sweep → the SIGNATURE tier-MORPH (beauty → toon → 8-bit → back). The pour spot (3.2,-5.24) is a
  // flat land cell of the deterministic default world (seed 1234). DOF on the held beats is deferred (see HANDOFF).
  SEQUENCES.hero = [
    { world: 'enter', keys: ['2'], waitMs: 1400 },         // into the world, beauty tier
    { timeTo: 0.30, waitMs: 300 },                         // golden morning
    { pour: [3.2, -5.24, 0.7, 1.9], waitMs: 300 },         // L101: SPLASH EARLY → the pool SETTLES flat over the next ~9s of beats (the L94 poster caught it mid-flow = the "mound"; DESIGN proved it drains+pools in ~6s)
    { orbit: [0.5, 0.05], waitMs: 2700 },                  // slow push over the terrain (water settling; sway + dust read)
    { orbit: [-0.3, -0.04], zoom: 0.9, waitMs: 2500 },     // drift back + ease lower (the pool is flattening)
    { timeTo: 0.74, waitMs: 1400 },                        // begin the day → DUSK sweep (the now-fixed sun warms the sky)
    { orbit: [0.18, -0.42], waitMs: 3000 },                // L101: LOW orbit toward the horizon → the depth-occluded sun reads in the dusk sky + the SETTLED lake catches it ← POSTER beat
    { keys: ['8'], waitMs: 1500 },                         // → toon (the signature MORPH begins)
    { keys: ['7'], waitMs: 1500 },                         // → 8-bit pixel
    { keys: ['2'], waitMs: 2200 },                         // → back to beauty (the morph reverses)
  ];
  // L101: a CITY hero option (Laurence wants both forest AND city) — the living skyline at golden→dusk + the tier-MORPH.
  // Camera stays at the classic DIMETRIC elevation (orbit horizontally, dy=0) so it frames the skyline against the sky
  // rather than tilting INTO the dusk sun (which blew the first take out); the L100 de-wash + L92/L93 ignited windows read.
  SEQUENCES.heroCity = [
    { keys: ['6', '2'], waitMs: 1300 },                    // dimetric + beauty — the classic city hero framing
    { timeTo: 0.30, waitMs: 1900 },                        // golden morning over the skyline
    { orbit: [0.5, 0], waitMs: 2500 },                     // slow HORIZONTAL push across the skyline (no pitch → no sun glare)
    { timeTo: 0.90, waitMs: 2100 },                        // L102(2/n): retime DUSK 0.74→0.90 — the sun fully SET + the moon ridden HIGH (tucked at the central spire), so the warm celestial horizon glow-disc is GONE; capture-only → pixel/vector/toon BYTE-IDENTICAL
    { orbit: [-0.45, 0], zoom: 0.85, waitMs: 2600 },       // drift across the lit dusk skyline ← POSTER beat
    { keys: ['8'], waitMs: 1500 }, { keys: ['7'], waitMs: 1500 }, { keys: ['2'], waitMs: 2200 },   // the MORPH
  ];


  async function run(name) {
    const seq = SEQUENCES[name];
    if (!seq) return;
    window.__director = name;
    for (const step of seq) await exec(step);
    window.__director = null;
  }

  // ?capture=<name> — hands-off: settle, arm recording, run the shot list, download.
  async function captureRun(name) {
    await sleep(1600);                              // let the city + landmarks load/settle
    startRec();
    await run(name);
    await sleep(400);
    stopRec();
    window.__captureDone = true;
  }

  /* ---- keys + auto-run ----
     L88 SAFE DEFAULT (engine-first): the S=still / R=record shortcuts are now ARMED ONLY when the
     page is opened in a capture context (`?capture` present in the URL). A public visitor in the
     normal/preview view must never trigger a file download by pressing a letter — before this gate,
     `S` silently downloaded a PNG ("WASD keeps taking photos"). The director auto-run + the
     `window.__capture` API below stay available unconditionally (the verify harness drives those
     directly), so nothing about authoring/CI changes — only the unsolicited global keystrokes.
     C++ anchor: like compiling a debug-only hotkey behind `#ifdef CAPTURE` — the code ships, the
     keystroke binding only exists in the armed build. */
  const armed = params.has('capture');
  if (armed) {
    window.addEventListener('keydown', (e) => {
      if (e.key === 's' || e.key === 'S') still();
      if (e.key === 'r' || e.key === 'R') toggleRec();
    });
  }
  // L114 app-shell: the DIRECTOR auto-run is gated by `sequences` (default false). city passes sequences:true → its
  // ?capture=tour|daycycle|cities shot lists arm exactly as before. office/hoard (if they ever wire capture through
  // the shell) get S-still/R-video for free WITHOUT ?capture=<seq> dispatching the CITY keymap's keydowns into the
  // wrong page. The manual `window.__capture.run(...)` stays exposed below for the verify harness either way.
  const capParam = params.get('capture');
  if (sequences && capParam && SEQUENCES[capParam]) captureRun(capParam);

  window.__capture = { still, toggleRec, run, sequences: Object.keys(SEQUENCES) };
  return window.__capture;
}

/* a tiny DOM "● REC" badge — top-right, NOT on the canvas, so it never appears in a recording
   (that's the whole lesson). */
function makeIndicator() {
  const el = document.createElement('div');
  el.textContent = '● REC';
  el.style.cssText = 'position:fixed;top:14px;right:16px;z-index:2;font:bold 12px ui-monospace,monospace;'
    + 'color:#ff3b30;letter-spacing:.12em;text-shadow:0 1px 3px #000;display:none;';
  document.body.appendChild(el);
  return { show: () => { el.style.display = 'block'; }, hide: () => { el.style.display = 'none'; } };
}
