/* ============================================================
   showcase-lab / main.js — STRESS TEST 1: the scroll-driven city-flight showcase + configurator + studio polish.
   ------------------------------------------------------------
   A CONSUMER of @lgr/engine-core (Phase 3 stays showcase-local — ideally ZERO engine edits). Phases:
     P1 — scroll flies a chaptered camera path (scrollDirector, F02) + a trimmed hero→seize→possess loop (F03);
     P2 — a studio product configurator via createProductStage (renderer shared, state save/restored);
     P3 — STUDIO POLISH: poster-as-LCP + %-preloader + lazy WebGL boot (mobile CWV) · no-WebGL static-poster fallback ·
          opt-in ambient sound · per-chapter accent + scroll-progress · authored easing (damp(), no GSAP) ·
          the 6 hero chapters' COPY is now createScrollNarrative (engine-core) — a fixed, progress-driven content
          layer that CONSUMES scrollDirector's scalar (never a second scroll listener); the camera KF path below
          is untouched, so the flight itself stays byte-identical to before this lift.
   The CWV move: the engine boots BEHIND the poster (deferred past first paint) so the LCP is the poster.jpg, not the
   slow full-screen canvas (the LCP trap). Every place the engine made polish hard is logged in FRICTION.md.
   ============================================================ */
import {
  THREE, createEngine, CAM, PROFILE_KEYS,
  createAppShell, readAppFlags, fromURLParams, damp, clamp,
  createProductStage, createScrollDirector, createScrollNarrative,
  createAudioBus, createDebugOverlay, createRecorder, createTouchControls,
} from '@lgr/engine-core';

/* --- entry state (deep-linkable) + motion pref — all CHEAP (no engine, doesn't block the poster paint). --- */
const app = readAppFlags(window.location.search);
const spec = fromURLParams(new URLSearchParams(window.location.search));   // F04: fromURLParams takes URLSearchParams (readAppFlags takes a string)
const citySeed = Number.isInteger(spec.seed) ? spec.seed : ((Math.random() * 1e9) | 0);
const profileIndex = spec.profile ? Math.max(0, PROFILE_KEYS.indexOf(spec.profile)) : 0;
const _reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

/* --- PRELOADER + REVEAL (module scope so the % animates from t0, through the deferred boot + the async landmark-GLB
      load, and I own the ONE transition — the engine force-fades its own #lgr-loader stub at 2 frames, F08). The % is
      SYNTHETIC: createEngine blocks the main thread synchronously AND loaderProgress isn't exposed on the engine handle,
      so a determinate bar is impossible without an engine edit (F08). Eases toward 92%, snaps to 100 on whenReady. --- */
const posterEl = document.getElementById('lgr-poster');
const pctEl = document.getElementById('loadPct'), barEl = document.getElementById('loadBar');
let _pct = 0, _revealed = false;
function revealScene() {
  if (_revealed) return; _revealed = true;
  if (pctEl) pctEl.textContent = '100%'; if (barEl) barEl.style.width = '100%';
  document.body.classList.add('ready');                     // fade the canvas in (CSS: body.ready > canvas)
  setTimeout(() => posterEl?.classList.add('gone'), 180);   // then lift the poster → the already-flying hero
}
(function tickPreload() {
  if (_revealed) return;
  _pct = Math.min(92, _pct + (92 - _pct) * 0.02 + 0.35);
  if (pctEl) pctEl.textContent = Math.round(_pct) + '%';
  if (barEl) barEl.style.width = _pct + '%';
  requestAnimationFrame(tickPreload);
})();

/* --- OPT-IN AMBIENT SOUND (muted default; created on the first user gesture so no autoplay-block; a wind bed that
      rises with altitude + a low night pad). Honours prefers-reduced-motion by staying silent unless toggled.
      AudioContext is owned by the engine-first createAudioBus (absorbed from the inline new AudioContext() that
      lived here; the stray direct construction was the engine-first violation the library-menu flagged). --- */
const _showcaseBus = createAudioBus();   // engine-core owns the one AudioContext; showcase routes through it
const sound = (() => {
  let master = null, windGain = null, padGain = null, on = false, _intensity = 0;
  function ensure() {
    if (master) return;                  // nodes already built
    const ctx = _showcaseBus && _showcaseBus.context; if (!ctx) return;
    master = ctx.createGain(); master.gain.value = 0; master.connect(_showcaseBus.destination);
    // wind = white noise through a gently-moving lowpass
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate); const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource(); noise.buffer = buf; noise.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.6;
    windGain = ctx.createGain(); windGain.gain.value = 0.0;
    noise.connect(lp).connect(windGain).connect(master); noise.start();
    // pad = two detuned low sines
    padGain = ctx.createGain(); padGain.gain.value = 0.0; padGain.connect(master);
    [55, 82.4].forEach((f, i) => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (i ? 1.003 : 1); o.connect(padGain); o.start(); });
  }
  function setIntensity(v) { _intensity = clamp(v, 0, 1); const ctx = _showcaseBus && _showcaseBus.context; if (!ctx || !on) return; windGain.gain.setTargetAtTime(0.05 + 0.22 * _intensity, ctx.currentTime, 0.4); padGain.gain.setTargetAtTime(0.02 + 0.06 * (1 - _intensity), ctx.currentTime, 0.6); }
  function toggle() {
    if (!_showcaseBus) return false;
    _showcaseBus.unlock();               // resume ctx inside the gesture (autoplay law)
    ensure();
    const ctx = _showcaseBus.context; if (!ctx) return false;
    on = !on;
    master.gain.setTargetAtTime(on ? 0.9 : 0.0, ctx.currentTime, 0.3); setIntensity(_intensity);
    return on;
  }
  return { toggle, setIntensity };
})();
const soundBtn = document.getElementById('sound');
soundBtn?.addEventListener('click', () => { const on = sound.toggle(); soundBtn.setAttribute('aria-pressed', String(on)); soundBtn.textContent = on ? '♪' : '♪'; });

/* --- LAZY BOOT. No WebGL2 → keep the poster (static fallback), don't boot. Else defer createEngine past the first
      paints so the poster.jpg is the LCP (the canvas boots behind it). --- */
function hasWebGL2() { try { const c = document.createElement('canvas'); return !!(window.WebGL2RenderingContext && c.getContext('webgl2')); } catch (e) { return false; } }
if (!hasWebGL2()) {
  document.body.classList.add('no-webgl');            // the poster IS the experience — show the fallback copy,
  _revealed = true;                                   // freeze the preloader tick, never boot / never lift the poster
} else {
  // two rAFs → the poster has painted (LCP recorded) before the heavy createEngine runs on the main thread.
  requestAnimationFrame(() => requestAnimationFrame(boot));
}

function boot() {
  /* --- BOOT the engine (F01: it appends the canvas to <body>; CSS-pin it as the fixed background). --- */
  const engine = createEngine({ demo: true, citySeed, profileIndex });
  window.__engine = engine;
  const { renderer, rig, sunRig, setPostMode } = engine;
  // A10 FIELD-DEBUG overlay — ?debug=gl, default-inert (byte-identical when off).
  if (app.q.get('debug') === 'gl') createDebugOverlay({ renderer, scene: engine.scene, getPath: () => window.__renderPath || window.__mode });
  // A10 REEL RECORDER — ?rec=1 arms the engine recorder (R toggles an MP4/WebM of the showcase for the reel
  // factory); opt-in so normal viewing is byte-identical + there's no key conflict with the flight KEYMAP.
  if (app.q.get('rec') === '1') {
    const _rec = createRecorder({ canvas: renderer.domElement, name: 'showcase' });
    window.addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') { _rec.toggleRec(); e.preventDefault(); } });
  }
  Object.assign(renderer.domElement.style, { position: 'fixed', inset: '0', zIndex: '0' });
  renderer.domElement.setAttribute('aria-hidden', 'true');
  // DPR: the engine already caps DPR (coarse 1.5 / desktop 2) + the governor sheds it under load — good enough for the
  // showcase's mobile CWV. NOTE (F07): the governor's DPR ceiling is BAKED (BOOT_DPR_CAP + the LADDER, ledger #14), so a
  // consumer CAN'T set a custom lower tier (e.g. desktop 1.0) via the API without editing the governor — left as the
  // engine default (a beauty-quality choice) rather than force an engine edit.

  const shell = createAppShell(engine, { name: 'showcase-lab', flags: { ...app, demo: true }, onResize: () => { if (productReady) product.resize(window.innerWidth, window.innerHeight); } });
  if (Number.isFinite(spec.time)) sunRig.goTo(spec.time); else sunRig.goTo(0.34);
  sunRig.setReducedMotion(_reduceMotion);   // B: honour RM for the auto-cycle we're about to enable

  engine.spawnSeizeCraft('heli', 4, 3, { hover: 11 });
  engine.setPilotWaterSampler(() => 0);     // showcase: sea surface at y=0 everywhere
  engine.setPilotGroundSampler(() => -2.4); // showcase: seabed at -2.4 (water-medium entry)
  /* Being the FISH puts the camera under the waterline, and without this the visitor gets an unfogged
     scene with the sky visible through a surface that is backface-culled from below — which reads as
     a broken renderer, not a dive. Same call metropolis makes; the ability is engine-side, so this is
     one line rather than a port. */
  engine.setUnderwater?.({ color: '#1f8fa6', density: 0.34, y: 0, blend: 0.3 });
  /* Put the VISIBLE sea floor where the physics floor is. The card ships at -0.35 and this world's
     pilot ground sampler is -2.4, so a fish swam two units UNDER its own seabed and the card cut a
     black band across the frame. Now they agree and the dive has a bottom to it. */
  engine.setSeabedCardY?.(-2.4);

  /* --- CONFIGURATOR (P2) — createProductStage sharing this renderer (state save/restored → no hero bleed). --- */
  const VARIANTS = ['midnight', 'beach', 'street'];
  let productReady = false, productLoadStarted = false, currentVariant = VARIANTS[0];
  /* autoRotate honours prefers-reduced-motion (2026-08-07). _reduceMotion was already threaded into
   sunRig, the scroll director, the narrative and the post-morph band, but this turntable was passed
   0.3 unconditionally — and the CSS reduced-motion block cannot touch it, because it is a WebGL
   orbit advanced in the render loop, not a transition. It was the one animation on the page that
   never stopped for a visitor who asked everything to stop. */
const product = createProductStage({ renderer, backdrop: '#efe9df', envIntensity: 1.1, exposure: 1.05, autoRotate: _reduceMotion ? 0 : 0.3 });
  function loadProduct() {
    if (productLoadStarted) return;   // the observer + the eager fallback below can't both fire twice
    productLoadStarted = true;
    product.load('./models/MaterialsVariantsShoe.glb').then(({ variants }) => {
      productReady = true; product.resize(window.innerWidth, window.innerHeight);
      if (variants[0]) { product.setVariant(variants[0]); currentVariant = variants[0]; }
    }).catch((e) => console.warn('[showcase-lab] product GLB failed', e));
  }
  // G-FOLLOWUP (2026-08-02 efficiency audit §6a): this model is 7.65MB gzip — bigger than the entire
  // engine lib — and used to load unconditionally on page init, so every visitor paid for it even if
  // they never scrolled past the city flight. Deferred behind an IntersectionObserver on #config; the
  // generous rootMargin starts the fetch a full viewport-height early so the model is ready by the time
  // a normal scroll speed actually reaches the section (the existing `productReady` gate below already
  // handles "not loaded yet" gracefully — the city flight just holds at its final position until it
  // resolves, no new loading UI needed). Falls back to the old eager load if IntersectionObserver or
  // #config is somehow unavailable, so this can't silently strand the configurator.
  const cfgObserverEl = document.getElementById('config');
  if (cfgObserverEl && 'IntersectionObserver' in window) {
    const productIO = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { loadProduct(); productIO.disconnect(); }
    }, { rootMargin: '100% 0px 100% 0px' });
    productIO.observe(cfgObserverEl);
  } else {
    loadProduct();
  }

  /* --- scrollDirector (F02): camera = pure fn of one smoothed scroll scalar (LERP keyframes → rig goal-setters +
        sunRig.goTo + a discrete post MORPH band). No accumulation → the 42% scrub is idempotent after the ease. --- */
  const KF = [
    { s: 0.00, t: [0, 3.0, 0], zoom: 9.0, az: 0.10, el: 0.30, sun: 0.34 },
    { s: 0.22, t: [0, 1.5, 0], zoom: 5.5, az: 0.55, el: 0.42, sun: 0.40 },
    { s: 0.45, t: [0, 1.0, 0], zoom: 3.4, az: 1.05, el: 0.52, sun: 0.62 },
    { s: 0.62, t: [0, 1.0, 0], zoom: 3.0, az: 1.45, el: 0.55, sun: 0.80 },
    { s: 0.82, t: [0, 2.0, 0], zoom: 5.0, az: 1.95, el: 0.44, sun: 0.02 },
    { s: 1.00, t: [0, 3.5, 0], zoom: 7.5, az: 2.40, el: 0.36, sun: 0.02 },
  ];
  const MORPH_BAND = [0.54, 0.70], CONFIG_START = 0.80, BEAUTY = 2, TOON = 8;
  /* ONE ACCENT, tonal (lgr-taste §3, 2026-08-07). This was six hues — gold, gold, orange, PURPLE
     (#b98cf0), BLUE (#6f9fe0), bronze — a different one per chapter. Two problems:
       1. Purple-into-blue is the single most recognisable AI-generated palette there is. Two of the
          six chapters were literally it.
       2. The per-chapter colour ENCODED NOTHING a visitor could use. On the hub, card colour tells you
          which project you are looking at, so it earns its place; here it was decoration, and a
          rainbow of decoration reads as "generated" rather than "designed".
     Now one hue (the LGR gold that the mark and favicon already use) DEEPENING as you descend, so the
     progression a visitor feels is a single considered ramp rather than five unrelated colours. */
  const ACCENTS = ['#e8b46a', '#e0a862', '#d89a58', '#cf8c50', '#c17f4a', '#a86a3c'];

  /* --- narrative copy (createScrollNarrative, engine-core) — the 6 hero chapters' TEXT, now data instead of the
        static markup index.html used to carry; accent values reuse ACCENTS 1:1 so the fixed narrative panels agree
        with the rest of the page's --accent-driven chrome (rail/hint/sound) even though they're two separate CSS
        custom properties (the narrative layer is a self-contained engine-core module — it doesn't reach into the
        page's own --accent var, see scroll-narrative.js). --- */
  const NARRATIVE_SECTIONS = [
    { id: 'intro', eyebrow: 'LGR · WebGL Engine', title: 'A city you fly by scrolling.', accent: ACCENTS[0],
      body: 'Everything here is generated: the streets, the towers, the water, the sky. Scroll to descend into it.' },
    /* RETITLED 2026-08-07. The headline said "Hand-built, to the horizon." directly above a body that
       says "No baked scenery. A seed grows the whole skyline." — the chapter contradicted itself, and
       hand-built is the opposite of the claim that makes the work impressive.
       The TAGS row carries the actual seed. Every engineering claim on this page was an adjective and
       not one was checkable; the seed is the single most falsifiable thing here, because a visitor can
       change it in the URL (?seed=) and watch a different city grow. It also finally uses the tags row
       the narrative module has always built and no section ever populated. */
    { id: 'procedural', eyebrow: 'Procedural', title: 'One seed. A whole skyline.', accent: ACCENTS[1], layout: 'bottom',
      tags: [`seed ${citySeed}`, 'change it in the URL'],
      body: "No baked scenery. A seed grows the whole skyline; the same engine drives every frame you're scrolling through." },
    { id: 'day', eyebrow: 'One continuous shot', title: 'The day rides your scroll.', accent: ACCENTS[2],
      body: 'Golden hour eases to dusk to night as you go. The sun is a function of your scroll position, not a clock.' },
    { id: 'style', eyebrow: 'The unforgeable signature', title: 'Every art style is real.', accent: ACCENTS[3], center: true,
      body: 'Watch the whole city morph, realistic to toon and back. A live re-render of the post pipeline, not a filter.' },
    { id: 'scale', eyebrow: 'Built to move', title: 'Pull back. Take it in.', accent: ACCENTS[4], layout: 'right',
      body: 'Reflections in the water, weather, a live simulation, all from the same real-time engine running the whole time.' },
    { id: 'controls', eyebrow: 'Your turn', title: 'Take the controls.', accent: ACCENTS[5], center: true,
      /* The copy is chosen at build-of-the-section time from the pointer type: telling a phone visitor
         to press Space and Escape described controls their device does not have.
         REWRITTEN 2026-08-07 for two reasons. It described ONE helicopter when the world holds four
         kinds of body, so the page undersold its own best moment. And it used em-dashes, which the
         lgr-taste ban list calls out for shipped page copy: a colon or a full stop carries the same
         beat without the tell. */
      body: (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
        ? 'Fly the helicopter, take the helm of a boat, ride the air as a gull, or drop under the surface as a fish. Four bodies, one city, no reload. The stick steers, ⤒ and ⤓ climb and dive, and ✕ drops you back to the page.'
        : 'Fly the helicopter, take the helm of a boat, ride the air as a gull, or drop under the surface as a fish. Four bodies, one city, no reload. WASD steers, Space and Shift climb and dive, and Esc drops you back to the page.',
      cta: { primary: { label: 'Take the controls', onClick: () => takeControls() } } },
  ];
  const flightT = () => clamp(scrollT / CONFIG_START, 0, 1);
  let _postNow = BEAUTY;

  function applyScroll(s) {
    s = clamp(s, 0, 1);
    let i = 0; while (i < KF.length - 2 && s > KF[i + 1].s) i++;
    const a = KF[i], b = KF[i + 1];
    const f = clamp((s - a.s) / (b.s - a.s || 1), 0, 1);
    const L = (x, y) => x + (y - x) * f;
    rig.setTarget(L(a.t[0], b.t[0]), L(a.t[1], b.t[1]), L(a.t[2], b.t[2]));
    rig.setZoom(L(a.zoom, b.zoom)); rig.setAzimuth(L(a.az, b.az)); rig.setElevation(L(a.el, b.el));
    const sunT = L(a.sun, b.sun);
    sunRig.goTo(sunT);
    /* Publish how DARK this frame is, for the narrative's legibility wash (index.html rev 3). The sun
       runs 0.25 = noon, 0.75 = midnight, so cos() around noon is a clean day factor; the wash is the
       inverse. Chapter one (sun 0.34) lands near 0.17 — imperceptible over a pale sky — and the night
       chapters (0.80 / 0.02) reach ~0.52, which is what the copy needs over lit windows.
       A CSS custom property rather than a class, so it EASES with the scroll exactly like everything
       else the keyframes drive instead of snapping at a chapter boundary. */
    const night = 1 - Math.max(0, Math.cos((sunT - 0.25) * Math.PI * 2));
    document.documentElement.style.setProperty('--lgr-wash', (0.10 + 0.42 * night).toFixed(3));
    const want = (!_reduceMotion && s >= MORPH_BAND[0] && s <= MORPH_BAND[1]) ? TOON : BEAUTY;
    if (want !== _postNow) { setPostMode(want); _postNow = want; }
  }

  /* ── TOUCH PILOTING (2026-08-07) — this page invited phone visitors into a TRAP ────────────────
     The controls card says "Seize the helicopter and fly it yourself" and the CTA is a button, so a
     phone visitor could absolutely enter pilot mode. What they could not do was fly: `axes` came only
     from `held`, which is filled by a keydown listener, so every axis stayed 0. Worse, releaseControls
     had exactly ONE caller — the Escape key — so a phone had no way BACK either. Tap the CTA on a
     phone and you were stuck watching a helicopter you could not move, on the page whose entire job is
     to impress. Nothing errored; it just quietly did nothing.

     createTouchControls has lived in engine-core since the metropolis mobile pass; this page simply
     never inherited it. Same wiring-drift class the project CLAUDE.md names. It is created LAZILY on
     first use (this page is CWV-sensitive and most visitors never take the controls) and its axes are
     COMPOSED with the keyboard, so a touch laptop can use either. */
  /* THE WAY OUT. releaseControls had exactly one caller — the Escape key — so a device without a
     keyboard could enter pilot mode and never leave it. A visible exit is not a mobile nicety here;
     it is the difference between a demo and a dead end. Shown on every device (a desktop visitor who
     never guesses Esc had the same problem, just with a way to discover it). */
  let exitBtn = null;
  function showExit(on) {
    if (on && !exitBtn) {
      exitBtn = document.createElement('button');
      exitBtn.type = 'button';
      exitBtn.className = 'lgr-pilot-exit';
      exitBtn.textContent = '✕ exit';
      exitBtn.setAttribute('aria-label', 'Exit the controls and return to the page');
      exitBtn.style.cssText = 'position:fixed;z-index:12;top:max(12px,env(safe-area-inset-top));'
        + 'right:max(12px,env(safe-area-inset-right));padding:9px 14px;border-radius:10px;cursor:pointer;'
        + 'border:1px solid rgba(255,255,255,.22);background:rgba(14,16,22,.82);color:#e8dfc8;'
        + 'font:600 13px system-ui,sans-serif;-webkit-tap-highlight-color:transparent;';
      exitBtn.addEventListener('click', () => releaseControls());
      document.body.appendChild(exitBtn);
    }
    if (exitBtn) exitBtn.style.display = on ? 'block' : 'none';
  }

  /* The in-flight HUD carried the SAME desktop-only instructions as the section copy, in a second
     place I did not know existed until a phone capture showed both on screen at once. Fixing one
     string and shipping is how half-fixes happen — set it from the same pointer test. */
  {
    const hud = document.getElementById('pilotHud');
    if (hud && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) {
      hud.textContent = 'Piloting · stick to steer · ⤒/⤓ climb · ✕ to release';
    }
  }

  /* ── THE BODY SWITCHER (2026-08-07) ────────────────────────────────────────────────────────────
     This page said "take the controls" and handed you one helicopter. Measured: the world it already
     builds contains THIRTEEN pilotable bodies — 4 boats, 4 gulls, 4 fish including a whale, and the
     heli — because water-life ships `.pilot` descriptors and the engine's own world includes water
     life. They arrived the moment those descriptors were written for metropolis; nothing here could
     REACH them, since `seizeCraft` names exactly one entity. engine.pilotables is the seam that
     exposes the rest, so this is a picker over content that already existed, not new content.

     Why it appears AFTER you take the controls rather than as four CTAs: one tap to get in is the
     low-friction path, and discovering you can also be a gull is a better beat than a menu. */
  /* NO EMOJI on the switcher or the CTA (2026-08-07). They render in a different typeface at a
     different optical weight than the label beside them, and the page has no other icon system, so
     they read as decoration bolted onto a control. The active pill's gold fill is already the
     affordance doing the work. (The touch HUD's ⤒/⤓/✕ stay: those are functional control labels
     matching projects/city's own glyphs, Rule 11.) */
  const BODIES = [
    { model: 'spacecraft', label: 'craft', lift: true },
    { model: 'boat',       label: 'boat',  lift: false },
    { model: 'bird',       label: 'gull',  lift: true },
    { model: 'fish',       label: 'fish',  lift: true },
  ];
  const USES_LIFT = new Set(BODIES.filter((b) => b.lift).map((b) => b.model));
  let switcher = null, activeModel = 'spacecraft';
  function pickBody(model) {
    const list = engine.pilotables || [];
    return list.find((f) => f.pilot && f.pilot.model === model) || null;
  }
  function showSwitcher(on) {
    if (on && !switcher) {
      switcher = document.createElement('div');
      switcher.className = 'lgr-body-switch';
      switcher.style.cssText = 'position:fixed;z-index:12;left:50%;transform:translateX(-50%);'
        + 'bottom:max(14px,calc(env(safe-area-inset-bottom) + 14px));display:flex;gap:8px;'
        + 'padding:7px;border-radius:14px;background:rgba(14,16,22,.82);border:1px solid rgba(255,255,255,.16);';
      for (const b of BODIES) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.textContent = b.label; btn.dataset.model = b.model;
        btn.style.cssText = 'padding:9px 13px;border-radius:9px;cursor:pointer;border:1px solid transparent;'
          + 'background:transparent;color:#e8dfc8;font:600 13px system-ui,sans-serif;-webkit-tap-highlight-color:transparent;';
        btn.addEventListener('click', () => becomeBody(b.model));
        switcher.appendChild(btn);
      }
      document.body.appendChild(switcher);
    }
    if (switcher) switcher.style.display = on ? 'flex' : 'none';
    markActive();
  }
  function markActive() {
    if (!switcher) return;
    for (const b of switcher.children) {
      const on = b.dataset.model === activeModel;
      b.style.background = on ? 'rgba(232,180,106,.92)' : 'transparent';
      b.style.color = on ? '#241a0a' : '#e8dfc8';
      b.setAttribute('aria-pressed', String(on));
    }
  }
  /* Swap bodies WITHOUT dropping back to the page: possess() already self-releases, so this is just a
     possess of the next one. Each body arrives at its own home position, which is the honest thing —
     a gull lives in the air and a fish lives under the sea, and teleporting either to where the
     helicopter was would put it somewhere it cannot survive. */
  function becomeBody(model) {
    const next = pickBody(model);
    if (!next || !engine.pilot.possess(next)) return false;
    activeModel = model;
    held.clear(); recomputeAxes();
    ensureTouch().setLift(USES_LIFT.has(model));
    markActive();
    return true;
  }

  let touch = null;
  function ensureTouch() {
    if (touch) return touch;
    touch = createTouchControls({
      onLook: (dx, dy) => rig.orbit(-dx * 0.006, -dy * 0.006),
      lift: true,                                   // the heli's rise/fall — its whole vertical axis
      liftLabels: ['⤒', '⤓'],                       // match projects/city's own climb/descend glyphs (Rule 11)
    });
    touch.setVisible(false);
    return touch;
  }

  /* --- trimmed hero→seize→possess (F03) --- */
  let phase = 'hero', piloting = false;
  const axes = { throttle: 0, steer: 0, lift: 0 }, held = new Set();
  const recomputeAxes = () => { axes.throttle = (held.has('up') ? 1 : 0) - (held.has('down') ? 1 : 0); axes.steer = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0); axes.lift = (held.has('rise') ? 1 : 0) - (held.has('fall') ? 1 : 0); };
  /* KEYBOARD + STICK COMPOSED, read every frame while piloting (recomputeAxes alone is edge-driven off
     key events, and a thumbstick has no edges — it is a continuously varying analog value). */
  const applyTouchAxes = () => {
    if (!touch) return;
    const t = touch.axes;
    if (t.y) axes.throttle = Math.max(-1, Math.min(1, axes.throttle + t.y));
    if (t.x) axes.steer = Math.max(-1, Math.min(1, axes.steer + t.x));
    if (t.lift) axes.lift = t.lift;
  };
  function startHero() { const heli = engine.seizeCraft; if (!heli || !heli.getWorldPos) return; setPostMode(BEAUTY); _postNow = BEAUTY; rig.setMode(CAM.PERSPECTIVE); rig.setFollow((o) => heli.getWorldPos(o), { frame: 15, snap: true }); rig.setElevation(0.5); phase = 'hero'; }
  function endHero() { if (phase !== 'hero') return; rig.clearFollow(); phase = 'scroll'; document.body.classList.add('scrolled'); }
  function takeControls() { if (piloting) return; endHero(); rig.setMode(CAM.PERSPECTIVE); const seize = engine.seizeCraft; if (seize && engine.pilot.possess(seize)) { piloting = true; window.__piloting = true; phase = 'pilot'; activeModel = 'spacecraft'; document.body.classList.add('piloting'); ensureTouch().setVisible(true); ensureTouch().setLift(true); showExit(true); showSwitcher(true); if (_postNow !== BEAUTY) { setPostMode(BEAUTY); _postNow = BEAUTY; } const t = sunRig.t; if (t < 0.15 || t > 0.85) sunRig.goTo(0.25); sunRig.setAuto(true); } }
  function releaseControls() { if (!piloting) return; engine.pilot.release(); piloting = false; window.__piloting = false; phase = 'scroll'; document.body.classList.remove('piloting'); if (touch) touch.setVisible(false); showExit(false); showSwitcher(false); held.clear(); recomputeAxes(); sunRig.setAuto(false); }
  startHero();   // frame the craft NOW so it's already flying BEHIND the poster before the reveal — the engine's own
                 // #lgr-loader latch fades after 2 rendered frames and can beat whenReady; don't reveal an unframed city.

  /* THE PRICE BAR MUST NOT FOLLOW YOU INTO THE ASK (2026-08-07). `config-open` is a scroll gate that
     stays true once passed, so the fixed price bar rode along into the closing section — putting
     "Add to cart" for a shoe that does not exist directly beneath "Work with us", larger and darker,
     at the one moment the page is asking for the business. Two CTAs at the close, and the wrong one
     winning. An IntersectionObserver on the sign section is the honest instrument here: the bar should
     retract when the sign is ON SCREEN, which is a visibility question, not a scroll-distance one. */
  {
    const sign = document.getElementById('work');
    if (sign && 'IntersectionObserver' in window) {
      new IntersectionObserver((es) => {
        for (const e of es) document.body.classList.toggle('signing', e.isIntersecting);
      }, { threshold: 0.25 }).observe(sign);
    }
  }

  /* --- SCROLL (first-party createScrollDirector, F02 lift) → damped scalar + hero-end + config-open + accent + sound.
     No Lenis, no virtual scroll, no wheel interception: NATIVE document scroll is the transport; the driver only READS
     scrollTop and damps it. Pumped from the shell loop below FIRST, before any branch (the F07 fix). --- */
  const scroll = createScrollDirector({ reducedMotion: _reduceMotion });   // module owns RM; smooth defaults 6 (house ease)
  window.__scrollDirector = scroll;   // harness handle — .scrollTo(p) / .progress (eased) / .targetProgress (raw)
  window.__product = product;         // harness handle — verifying zoom needs the camera (house convention, cf. __engine/__walker)
  let scrollT = 0;
  const rail = document.getElementById('rail');
  // The five side effects, lifted from an event callback into a per-frame reader. SPLIT: CONTINUOUS consumers read the
  // EASED progress; DISCRETE gates read the RAW target, so easing lag can NEVER strand the user just under CONFIG_START
  // (0.80) — a scroll parked at target 0.7999 would see an eased progress asymptote to 0.7999 and never cross 0.80.
  function applyScrollUI(p, target) {
    scrollT = clamp(p, 0, 1);                                                          // eased → camera/rail/accent/sound [continuous]
    const gate = clamp(target, 0, 1);                                                  // raw → discrete switches [no lag / no park-stuck]
    if (rail) rail.style.width = (scrollT * 100).toFixed(1) + '%';
    if (phase === 'hero' && gate > 0.003) endHero();                                   // discrete
    document.body.classList.toggle('config-open', gate >= CONFIG_START && !piloting);  // discrete
    document.documentElement.style.setProperty('--accent', ACCENTS[clamp(Math.floor(scrollT * ACCENTS.length), 0, ACCENTS.length - 1)]);  // continuous
    sound.setIntensity(scrollT < CONFIG_START ? Math.sin(flightT() * Math.PI) : 0);    // continuous — wind peaks mid-flight, hushes in the studio
  }
  /* --- narrative content layer mount (the new ability) — CONSUMES scroll.progress/targetProgress every frame
        below; never a second listener. Scoped to the PRE-CONFIG range via the SAME flightT() remap the camera
        uses, so a nav-dot click's local [0,1] fraction converts back to a real scrollTo via CONFIG_START.
        progressBar:false — the page already has .rail (global 0..1 across the WHOLE page incl. the configurator);
        a second, differently-scoped bar would just be confusing. Hidden during config/piloting via CSS (index.html). --- */
  const story = createScrollNarrative({
    sections: NARRATIVE_SECTIONS,
    reducedMotion: _reduceMotion,
    progressBar: false,
    nav: true,
    onJumpTo: (frac) => scroll.scrollTo(frac * CONFIG_START),
  });

  /* --- CONFIGURATOR input + variants + cart --- */
  const configActiveNow = () => scrollT >= CONFIG_START && !piloting && productReady;
  let cfgDrag = false, cfgX = 0, cfgY = 0;
  const cfgEl = document.getElementById('config');
  cfgEl?.addEventListener('pointerdown', (e) => { if (!configActiveNow() || e.target.closest('button')) return; cfgDrag = true; cfgX = e.clientX; cfgY = e.clientY; });
  window.addEventListener('pointermove', (e) => { if (!cfgDrag) return; product.orbitBy((e.clientX - cfgX) * 0.008, (e.clientY - cfgY) * 0.008); cfgX = e.clientX; cfgY = e.clientY; });
  window.addEventListener('pointerup', () => { cfgDrag = false; });

  /* ZOOM, because the copy already promised it (2026-08-07). product-stage has exported zoomBy since
     it was written and this page had ZERO call sites, so "scroll-pinch to zoom" was a promise the
     page did not keep. Wiring it is a better answer than deleting the sentence: on the one section
     pitching commercial work, a product you can actually inspect is the point.
     Wheel is passive:false because it must preventDefault — otherwise the page scrolls away from the
     configurator while you are trying to zoom into it. Both paths are gated on configActiveNow() so
     nothing is hijacked while the visitor is still flying the city. */
  cfgEl?.addEventListener('wheel', (e) => {
    if (!configActiveNow()) return;
    e.preventDefault();
    product.zoomBy(Math.exp(e.deltaY * 0.0012));
  }, { passive: false });

  /* PINCH: track live pointers and drive zoom from the change in their separation. Two fingers also
     suppress the one-finger orbit, or the gesture fights itself. */
  const cfgPts = new Map();
  let pinchD = 0;
  cfgEl?.addEventListener('pointerdown', (e) => { if (configActiveNow()) cfgPts.set(e.pointerId, e); });
  window.addEventListener('pointermove', (e) => {
    if (!cfgPts.has(e.pointerId)) return;
    cfgPts.set(e.pointerId, e);
    if (cfgPts.size !== 2) return;
    cfgDrag = false;
    const [a, b] = [...cfgPts.values()];
    const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    if (pinchD > 0 && d > 0) product.zoomBy(pinchD / d);
    pinchD = d;
  });
  const cfgDrop = (e) => { cfgPts.delete(e.pointerId); if (cfgPts.size < 2) pinchD = 0; };
  window.addEventListener('pointerup', cfgDrop);
  window.addEventListener('pointercancel', cfgDrop);
  const swatchWrap = document.getElementById('swatches'), pbVariant = document.getElementById('pbVariant');
  function selectVariant(name) { if (!VARIANTS.includes(name)) return; product.setVariant(name); currentVariant = name; if (pbVariant) pbVariant.textContent = name; swatchWrap?.querySelectorAll('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.variant === name))); }
  VARIANTS.forEach((name) => { const b = document.createElement('button'); b.className = `swatch sw-${name}`; b.type = 'button'; b.dataset.variant = name; b.setAttribute('aria-label', name); b.setAttribute('aria-pressed', String(name === currentVariant)); b.addEventListener('click', () => selectVariant(name)); swatchWrap?.appendChild(b); });
  document.getElementById('addCart')?.addEventListener('click', () => {
    const lineItem = { id: 'lgr-runner', quantity: 1, properties: { _3d_configuration: JSON.stringify({ model: 'MaterialsVariantsShoe', variant: currentVariant, engine: 'lgr-product-stage-v1' }), Colourway: currentVariant } };
    window.__cart = lineItem; const el = document.getElementById('addCart'); el.textContent = '✓ Added'; setTimeout(() => { if (el) el.textContent = 'Add to cart'; }, 1600);
    console.log('[showcase-lab] add-to-cart', JSON.stringify(lineItem));
  });

  /* --- pilot INPUT (free flight only) --- */
  const KEYMAP = { w: 'up', arrowup: 'up', s: 'down', arrowdown: 'down', a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right', ' ': 'rise', shift: 'fall' };
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') { releaseControls(); return; } if (!piloting) return; const tok = KEYMAP[e.key.toLowerCase()]; if (tok) { held.add(tok); recomputeAxes(); e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { const tok = KEYMAP[e.key.toLowerCase()]; if (tok) { held.delete(tok); recomputeAxes(); } });

  /* --- PER-FRAME BODY (city-mode slice) + the P2 configurator render switch --- */
  shell.start((dt, t) => {
    scroll.update(dt);                                      // ← PUMP FIRST, before ANY branch (the F07 fix + the §1.4 invariant)
    applyScrollUI(scroll.progress, scroll.targetProgress);  // ← continuous off eased, discrete off raw
    story.update(flightT(), clamp(scroll.targetProgress / CONFIG_START, 0, 1));  // same eased/raw split, PRE-CONFIG range
    if (!piloting && scroll.targetProgress >= CONFIG_START && productReady) { product.update(dt); product.render(); return; }  // gate on RAW target
    if (piloting) { recomputeAxes(); applyTouchAxes(); engine.pilot.step(dt, axes); }
    else if (phase === 'scroll') applyScroll(flightT());
    rig.update(dt);
    engine.updateWorld(dt, t, { shadowsOn: true, seasonTarget: 0 });
    const style = engine.decideStyle();
    engine.renderCityPipeline(style, null);
  });

  /* --- READY → the ONE authored transition (revealScene, module scope). shell.ready() sets __cityReady (smoke A). A
        safety timeout reveals anyway if a landmark GLB stalls, so the poster can never trap the user. --- */
  engine.landmarkFactory.whenReady.then(() => { shell.ready(); revealScene(); });
  setTimeout(revealScene, 8000);
}
