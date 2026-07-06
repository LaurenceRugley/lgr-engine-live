/* ============================================================
   JOHN'S OFFICE — standalone app (Lesson 39, E2) — deploys to /office/
   ------------------------------------------------------------
   A LEAN app on the engine API: createEngine() builds the city (it renders into the office glass),
   createOffice() builds the room, and this file boots straight INTO the office (no city→office dive
   — that crossfade lives in the city showcase) and wires the room's interactions: the laptop game
   panel (John's seam), the phone "travel" (hot-swap the window-city), fitout/skin/props, and the
   loop (engine.updateWorld keeps the glass city alive → render the room). C++ anchor: a second
   executable linking the same engine lib, wiring only the office subsystem.
   ============================================================ */
import { THREE, createEngine, PROFILES, createAppShell, readAppFlags } from '@lgr/engine-core';
import { createOffice } from './office.js';

// L114: the APP-half flags parsed ONCE by the shell helper (was a hand-rolled URLSearchParams + demo rule here).
const app = readAppFlags(window.location.search);
const DEMO = app.demo;
window.__demo = DEMO;
const citySeed = (app.q.get('city') ? Number(app.q.get('city')) : 0) || ((Math.random() * 1e9) | 0);
let profileIndex = 0;

const engine = createEngine({ demo: DEMO, citySeed, profileIndex });
const { renderer, rig, sunRig, city, cityLife, waterMaterial, fitShadowFrustum, landmarkFactory, renderCityBeautyTo } = engine;

const office = createOffice({ tier: 'corner' });
// L114 app-shell: office adopts the SHARED seam (loop brackets + pause-on-hidden + ready + footer + hints + resize).
// onResize keeps the office camera's aspect in sync after engine.resize(). Its exclusive drift items (the local
// L110 tap-pick block, ?capture verbs) stay SHELVED per the mission scope (tap-pick = its own deferred lesson).
const shell = createAppShell(engine, {
  name: 'office', flags: app,
  onResize: () => { office.camera.aspect = window.innerWidth / window.innerHeight; office.camera.updateProjectionMatrix(); },
});
if (typeof window !== 'undefined') window.__office = office;   // L58 harness handle (scene-graph probes)
// L90 H6 — governor probe (now that office brackets the frame): verify the adaptive quality ladder engages.
if (typeof window !== 'undefined') window.__quality = { get level() { return engine.governor.level; }, forceLoad: (ms) => engine.profiler.forceLoad(ms) };
office.camera.aspect = window.innerWidth / window.innerHeight;
office.camera.updateProjectionMatrix();
let shadowsOn = true; window.__shadows = shadowsOn;
const sceneMode = 'office'; window.__scene = sceneMode;   // this page is always the room

/* The WINDOW cameras + live-skyline RTs (+ the basement's vignette RT below).
   L49 TRUE CORNER: instead of ONE flat camera UV-folded across the two angled panes (a single vanishing
   point at the seam — the bug), TWO pane cameras 90° apart, each looking down its own pane's outward
   direction and rendering its OWN small RT. Each pane then samples its full own view (UV 0–1), so the
   city genuinely WRAPS the corner. Two ~half-size RTs (384×320 ≈ pane's 3.0×2.5 aspect) ≈ the old single
   640×448's fill, and the render is throttled — perf-friendly (the office RTT is the mobile path). */
const rtOpts = { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false };
const WIN_POS = new THREE.Vector3(2.2, 3.4, 11.5);             // the shared corner viewpoint in CITY space
const _winFwd = new THREE.Vector3(0, 2.0, 0).sub(WIN_POS);    // base look direction (toward the city)
const _up = new THREE.Vector3(0, 1, 0);
// L58/L59: each pane camera is aimed ±PANE_DEG off the forward (the panes' half-angle), with its HORIZONTAL
// fov = 2·PANE_DEG so the two cameras' inner edges meet EXACTLY at the corner-forward ray → a continuous wrap
// (no seam gap). L59 FLATTENED the corner: PANE_DEG 45°→30°, so h-fov drops 90°→60° = much less wide-angle
// distortion. PANE_DEG MUST match office.js's CORNER_DEG (kept in lockstep); the vertical fov is derived from
// it + the RT aspect so they can't drift. (C++: derive the dependent value, don't duplicate the literal.)
const PANE_DEG = 30, PANE_ASPECT = 384 / 320;
const PANE_VFOV = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(PANE_DEG)) / PANE_ASPECT));
function makePaneCam(angleDeg) {
  const c = new THREE.PerspectiveCamera(PANE_VFOV, PANE_ASPECT, 0.1, 100);
  c.position.copy(WIN_POS);
  const dir = _winFwd.clone().applyAxisAngle(_up, THREE.MathUtils.degToRad(angleDeg));
  c.lookAt(WIN_POS.clone().add(dir));
  return c;
}
const windowCamL = makePaneCam(+PANE_DEG);   // +PANE_DEG about +Y → the LEFT pane's view
const windowCamR = makePaneCam(-PANE_DEG);   // −PANE_DEG → the RIGHT pane's view (2·PANE_DEG apart = the corner turn)
const cityWindowRT_L = new THREE.WebGLRenderTarget(384, 320, rtOpts);
const cityWindowRT_R = new THREE.WebGLRenderTarget(384, 320, rtOpts);
office.setCityTexture(cityWindowRT_L.texture, cityWindowRT_R.texture);
// L49b — the STRAIGHT-ON layout: a single flat camera + RT (perspectively correct, one view). Rendered
// only when that layout is active. fov/aspect framed for the 5.4×2.6 flat pane.
const windowCamS = new THREE.PerspectiveCamera(52, 540 / 320, 0.1, 100);
windowCamS.position.copy(WIN_POS);
windowCamS.lookAt(WIN_POS.clone().add(_winFwd));
const cityWindowRT_S = new THREE.WebGLRenderTarget(540, 320, rtOpts);
office.setStraightCityTexture(cityWindowRT_S.texture);
let _winFrame = 0;                  // L40 WIN B: throttle the glass-city re-render (it's a background)
const WIN_EVERY = 3;
const vignetteRT = new THREE.WebGLRenderTarget(512, 320, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false,
});
office.setVignetteTexture(vignetteRT.texture);

/* L22 OFFICE INTERACTIONS — the laptop GAME PANEL (an HTML overlay), the phone "TRAVEL", and a shared
   flash/toast. The panel is a DOM sibling of the canvas (z-index composited) — the seam where John
   mounts his actual game. */
let laptopOpen = false;
const officeUI = (() => {
  if (typeof document === 'undefined') return { showLap() {}, toast() {}, flash() {} };
  const css = document.createElement('style');
  css.textContent = `
  .lap { position: fixed; inset: 0; z-index: 5; display:flex; align-items:center; justify-content:center;
    background: rgba(6,8,12,0.55); opacity:0; pointer-events:none; transition: opacity .25s; }
  .lap.on { opacity:1; pointer-events:auto; }
  .lap-win { width:min(560px,90vw); border-radius:14px; overflow:hidden; background:#0e1016;
    border:1px solid #2a2f3a; box-shadow:0 20px 60px rgba(0,0,0,.6); font:13px/1.5 ui-monospace,monospace; color:#cdd3dc; }
  .lap-bar { display:flex; align-items:center; justify-content:space-between; padding:10px 14px; background:#161a22; border-bottom:1px solid #2a2f3a; }
  .lap-bar b { letter-spacing:.08em; color:#7fd0ff; }
  .lap-x { cursor:pointer; border:0; background:#222833; color:#cdd3dc; min-width:44px;height:44px;border-radius:8px; font:inherit; transition: transform .08s ease, background .12s; }
  .lap-body { padding:18px; }
  .lap-body .row { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
  .lap-body button.stub { padding:9px 13px; border-radius:8px; border:1px solid #2a2f3a; background:#1a1f29; color:#cdd3dc; cursor:pointer; transition: transform .08s ease, background .12s; }
  /* L42 button juice: press scale + flash on the panel buttons (paired with a guarded haptic in JS). */
  .lap-x:active, .lap-body button.stub:active { transform: scale(0.92); background:#33405a; }
  @media (prefers-reduced-motion: reduce) { .lap-x, .lap-body button.stub { transition: background .12s; } .lap-x:active, .lap-body button.stub:active { transform: none; } }
  .lap-note { opacity:.55; margin-top:16px; font-size:11px; }
  .otoast { position:fixed; left:50%; top:18px; transform:translateX(-50%); z-index:5; padding:9px 18px; border-radius:999px;
    background:rgba(16,18,24,.85); color:#e8edf4; font:600 13px/1 ui-monospace,monospace; letter-spacing:.04em;
    opacity:0; transition:opacity .3s; pointer-events:none; }
  .otoast.on { opacity:1; }
  .oflash { position:fixed; inset:0; z-index:4; background:#dfe8ff; opacity:0; pointer-events:none; }
  `;
  document.head.appendChild(css);
  const lap = document.createElement('div'); lap.className = 'lap';
  lap.innerHTML = `<div class="lap-win"><div class="lap-bar"><b>PORTFOLIO OS — John's Game</b>
    <button class="lap-x" title="Close (Esc)">✕</button></div>
    <div class="lap-body">Welcome back, Exec. <span style="opacity:.55">(placeholder — the real game UI mounts here)</span>
    <div class="row"><button class="stub">▶ Resume</button><button class="stub">📈 Portfolio</button>
    <button class="stub">🏢 Properties</button><button class="stub">⚙ Settings</button></div>
    <div class="lap-note">This panel is an HTML overlay over the WebGL canvas — the seam where John drops his game in.</div>
    </div></div>`;
  const toast = document.createElement('div'); toast.className = 'otoast';
  const flash = document.createElement('div'); flash.className = 'oflash';
  document.body.append(lap, toast, flash);
  lap.querySelector('.lap-x').addEventListener('click', () => closeLaptop());
  lap.addEventListener('click', (e) => { if (e.target === lap) closeLaptop(); });
  // L42 haptics: a guarded tap buzz on any panel button (no-ops on desktop/iOS).
  lap.addEventListener('click', (e) => { if (e.target.closest('button')) navigator.vibrate?.(10); });
  let toastT = 0;
  return {
    showLap(v) { lap.classList.toggle('on', v); },
    toast(msg) { toast.textContent = msg; toast.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toast.classList.remove('on'), 1400); },
    flash() { flash.style.transition = 'none'; flash.style.opacity = '0.85';
      requestAnimationFrame(() => { flash.style.transition = 'opacity .55s'; flash.style.opacity = '0'; }); },
  };
})();
function openLaptop() { laptopOpen = true; officeUI.showLap(true); }
function closeLaptop() { laptopOpen = false; officeUI.showLap(false); }
function travelCity() {
  profileIndex = (profileIndex + 1) % PROFILES.length;
  officeUI.flash();
  city.generate(citySeed, profileIndex);                 // hot-swap the window-city in place
  waterMaterial.uniforms.uVecWater.value.set(city.waterColor);
  cityLife.setProfile(city.state.profile);
  fitShadowFrustum();
  officeUI.toast('✈  ' + city.state.profile.name);
  window.__profile = city.state.profile.key;
}
function setFitout(t) { const tier = office.setFitout(t); officeUI.toast(tier === 'basement' ? '🏚  Basement office' : '🏙  Corner office'); window.__tier = tier; return tier; }
function toggleFitout() { return setFitout(office.tier === 'corner' ? 'basement' : 'corner'); }
window.__tier = office.tier;
const OFFICE_SKINS = ['3d', 'dressed2', 'night2', 'modern', 'charm'];   // L59: 4 ControlNet skins + stylized-3D
const SKIN_LABEL = { '3d': '🧊  Stylized 3D office', dressed2: '📚  Dressed office (day)', night2: '🌙  Night office', modern: '🏙  Modern office (day)', charm: '🎨  Charm office' };
function setOfficeSkin(s) { const skin = office.setSkin(s); window.__officeSkin = skin; officeUI.toast(SKIN_LABEL[skin]); return skin; }
function cycleOfficeSkin() { return setOfficeSkin(OFFICE_SKINS[(OFFICE_SKINS.indexOf(office.skin) + 1) % OFFICE_SKINS.length]); }
window.__officeSkin = office.skin;
const PROPS_LABEL = { painted: '🎨  Painted props (cohesive)', '3d': '🧊  Live 3D props (animated)' };
function setOfficeProps(p) { const m = office.setProps(p); window.__officeProps = m; if (office.skin !== '3d') officeUI.toast(PROPS_LABEL[m]); return m; }
function toggleOfficeProps() { return setOfficeProps(office.props === 'painted' ? '3d' : 'painted'); }
window.__officeProps = office.props;
const LAYOUT_LABEL = { corner: '🏙  Corner window', 'straight-on': '🖼  Straight-on window' };
function setOfficeLayout(l) { const m = office.setLayout(l); window.__officeLayout = m; officeUI.toast(LAYOUT_LABEL[m]); return m; }
function toggleOfficeLayout() { return setOfficeLayout(office.layout === 'corner' ? 'straight-on' : 'corner'); }
window.__officeLayout = office.layout;

/* OFFICE PICK — hit-test the room's props (laptop / phone / cat / fish tank) through the office cam. */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const setPointer = (cx, cy) => { pointer.x = (cx / window.innerWidth) * 2 - 1; pointer.y = -(cy / window.innerHeight) * 2 + 1; };
function pickOfficeRole() {
  raycaster.setFromCamera(pointer, office.camera);
  const hit = raycaster.intersectObjects(office.interactables, true)[0];
  if (!hit) return null;
  let o = hit.object;
  while (o && !o.userData.role) o = o.parent;
  return o ? o.userData.role : null;
}
function runRole(role) {
  if (role === 'laptop') openLaptop();
  else if (role === 'phone') travelCity();
  else if (role === 'cat') office.petCat();
  else if (role === 'tank') office.feedFish();
}
/* L51 — DRAG to LOOK vs CLICK to interact. A pointer that moves past DRAG_PX becomes a head-turn (fed to
   the seated free-look); a small press+release stays a click on the laptop/phone/cat. Cursor: grab (idle) /
   grabbing (dragging) / pointer (over an interactable). */
const DRAG_PX = 6;
let downX = 0, downY = 0, downT = 0, lastX = 0, lastY = 0, mouseDown = false, dragging = false;
renderer.domElement.style.cursor = 'grab';
renderer.domElement.addEventListener('mousedown', (e) => { mouseDown = true; dragging = false; downX = lastX = e.clientX; downY = lastY = e.clientY; downT = performance.now(); });
window.addEventListener('mousemove', (e) => {
  if (mouseDown) {
    if (!dragging && Math.hypot(e.clientX - downX, e.clientY - downY) > DRAG_PX) dragging = true;
    if (dragging) { office.look.addDrag(e.clientX - lastX, e.clientY - lastY); renderer.domElement.style.cursor = 'grabbing'; }
    lastX = e.clientX; lastY = e.clientY;
  } else {
    setPointer(e.clientX, e.clientY);
    renderer.domElement.style.cursor = pickOfficeRole() ? 'pointer' : 'grab';
  }
});
window.addEventListener('mouseup', (e) => {
  // L110 (audit P0-3): ignore the SYNTHETIC mouse sequence a mobile browser fires after touchend — the tap was already
  // handled there, so re-running the role here double-fires (repeat-tapping travelCity() twice per tap, etc.).
  if (performance.now() - _lastTouchRole < 700) { mouseDown = false; dragging = false; return; }
  if (mouseDown && !dragging && !laptopOpen) { setPointer(e.clientX, e.clientY); const role = pickOfficeRole(); if (role) runRole(role); }
  mouseDown = false; dragging = false; renderer.domElement.style.cursor = 'grab';
});
let tDragging = false;
// L110 (audit P0-3) — John's page is the mobile path; prop taps ARE its interaction model, and touch was broken:
// (a) touchend raycast through the shared `pointer`, which is ONLY ever set from the desktop mousemove/mouseup — never
// from touch coords, so a tap picked at screen-centre (or the previous tap's synthetic-mouse location); (b) mobile
// browsers fire a synthetic mousemove→down→up AFTER touchend, so the window mouseup ran the role a SECOND time; (c) a
// 2-finger pinch could end <350ms with tDragging=false and fire a spurious role. `_lastTouchRole` suppresses the
// synthetic double-fire; `_wasMulti` suppresses the pinch tap.
let _lastTouchRole = 0, _wasMulti = false;
renderer.domElement.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { downX = lastX = e.touches[0].clientX; downY = lastY = e.touches[0].clientY; downT = performance.now(); tDragging = false; } }, { passive: true });
renderer.domElement.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 1) return;
  const x = e.touches[0].clientX, y = e.touches[0].clientY;
  if (!tDragging && Math.hypot(x - downX, y - downY) > 8) tDragging = true;
  if (tDragging) office.look.addDrag(x - lastX, y - lastY);
  lastX = x; lastY = y;
}, { passive: true });
window.addEventListener('touchend', (e) => {
  // L110 (audit P0-3): set the raycast pointer from the TAP position first (mirrors city's setPointer-before-pick,
  // main.js:1341) — downX/downY are this tap's touchstart coords — and skip if the gesture was a pinch (`_wasMulti`).
  if (!tDragging && !_wasMulti && performance.now() - downT < 350 && (!e.touches || e.touches.length === 0) && !laptopOpen) {
    setPointer(downX, downY);
    const role = pickOfficeRole(); if (role) { runRole(role); _lastTouchRole = performance.now(); }   // stamp so the synthetic mouseup skips
  }
  tDragging = false;
});
/* L90 H7 — office PINCH-ZOOM (2-finger). The seat already turns the head on a 1-finger drag (above); this
   adds a gentle FOV pinch so phone users can zoom the room. Separate listeners → the 1-finger path is
   untouched; one finger never triggers this (length===2 guard). */
let _officePinch = 0;
const _pd = (e) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
renderer.domElement.addEventListener('touchstart', (e) => { if (e.touches.length === 2) { _officePinch = _pd(e); _wasMulti = true; } }, { passive: true });   // L110 (audit P0-3): flag the pinch so its release can't fire a spurious prop tap
renderer.domElement.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  e.preventDefault();
  const d = _pd(e);
  if (_officePinch > 0 && d > 0) { office.camera.fov = Math.max(32, Math.min(72, office.camera.fov * (_officePinch / d))); office.camera.updateProjectionMatrix(); }
  _officePinch = d;
}, { passive: false });
window.addEventListener('touchend', (e) => { if (!e.touches || e.touches.length < 2) _officePinch = 0; if (!e.touches || e.touches.length === 0) _wasMulti = false; });   // L110: clear the pinch flag only once ALL fingers are up (this fires after the tap-touchend above)
// L51 — arrow keys also drive the head-turn (held → continuous, applied per-frame in tick).
const lookKeys = { left: false, right: false, up: false, down: false };
const LOOK_KEY = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
window.addEventListener('keydown', (e) => {
  if (LOOK_KEY[e.key]) { lookKeys[LOOK_KEY[e.key]] = true; e.preventDefault(); return; }
  if (e.key === 'Escape') { if (laptopOpen) closeLaptop(); else office.look.recenter(); }   // L51: Esc also recenters the view
  if (e.key === 'f' || e.key === 'F') toggleFitout();
  if (e.key === 'j' || e.key === 'J') cycleOfficeSkin();
  if (e.key === 'u' || e.key === 'U') toggleOfficeProps();
  if (e.key === 't' || e.key === 'T') sunRig.cyclePreset();
  if (e.key === 'h' || e.key === 'H') { shadowsOn = !shadowsOn; window.__shadows = shadowsOn; }
  if (e.key === 'w' || e.key === 'W') toggleOfficeLayout();   // L49b: corner ↔ straight-on window
  if (e.key === 'm' || e.key === 'M') { const h = document.querySelector('.hint'); if (h) h.style.display = (h.style.display === 'none' ? '' : 'none'); }   // L110 (audit B13): the footer advertised "M hides this UI" but no handler existed — wire it (matches the city's M convention)
});
window.addEventListener('keyup', (e) => { if (LOOK_KEY[e.key]) lookKeys[LOOK_KEY[e.key]] = false; });

// Pop the landmark heroes in once their GLBs load.
landmarkFactory.whenReady.then(() => { city.generate(citySeed, profileIndex); fitShadowFrustum(); shell.ready(); });   // L114: shell.ready() = __appReady (+ __cityReady alias)

// ?office=basement boots the basement starter fitout; ?officeskin / ?officeprops select look.
if (app.q.get('office') === 'basement') setFitout('basement');
const skinParam = app.q.get('officeskin'); if (OFFICE_SKINS.includes(skinParam)) setOfficeSkin(skinParam);
const propsParam = app.q.get('officeprops'); if (['painted', '3d'].includes(propsParam)) setOfficeProps(propsParam);
const layoutParam = app.q.get('officelayout'); if (['corner', 'straight-on'].includes(layoutParam)) setOfficeLayout(layoutParam);   // L49b

// L114 app-shell: the shell owns the loop skeleton (rAF + pause/context skip — office's old tick was MISSING it,
// drift #1 — + frameStart/timer/dt-clamp/frameEnd). The BODY below is 100% the office step, unchanged; dt + t come
// from the shell's timer.
shell.start((dt, t) => {
  rig.update(dt);
  // Keep the glass city ALIVE (sun/weather/cityLife/water/sim) even though it's only seen through the
  // window — the world-step runs every frame; the SIM PASS keeps the water moving for the skyline RT.
  engine.updateWorld(dt, t, { shadowsOn, seasonTarget: 0 });
  office.look.addKeys(dt, lookKeys);                       // L51: arrow-key head-turn (held)
  office.update(dt, t, sunRig);                            // cat sleeps at night, etc.
  window.__lookYaw = office.look.yaw; window.__lookPitch = office.look.pitch;   // L51 harness probes
  if (office.tier === 'basement') {
    renderer.setRenderTarget(vignetteRT);
    renderer.render(office.vignette.scene, office.vignette.camera);
  } else if (_winFrame % WIN_EVERY === 0) {
    // L49: render only the ACTIVE layout's camera(s). Corner = two pane views (true corner); straight-on
    // = one flat view. Two ~half RTs ≈ the old single's fill; throttled to ~1/3 rate (it's a background).
    if (office.layout === 'straight-on') {
      renderCityBeautyTo(windowCamS, cityWindowRT_S);
    } else {
      renderCityBeautyTo(windowCamL, cityWindowRT_L);
      renderCityBeautyTo(windowCamR, cityWindowRT_R);
      // L59: under a skin, glassS is the live-city BACKSTOP behind the corner panes — keep its straight RTT
      // live too (it fills the masked backplate aperture with the live city instead of painted/sky gaps).
      if (office.skin !== '3d') renderCityBeautyTo(windowCamS, cityWindowRT_S);
    }
  }
  _winFrame++;
  renderer.setRenderTarget(null);
  renderer.render(office.scene, office.camera);
});

// L42: first-run coachmark — the office props have no obvious affordance, so name them once per visitor. The shell
// derives the key (`lgr_hints_office`) from the name + owns the footer show/hide + resize wiring (all removed here).
shell.hints({
  title: 'The Office',
  tips: [
    'Drag to look around the office (or use the arrow keys)',
    'Click / tap the LAPTOP to open the game panel',
    'Tap the PHONE to travel to another city · pet the CAT · feed the FISH',
    'Esc recenters · F fitout · J skin · U props · W window · T time · M hides this',   // L110 (audit B13): Esc recenters/closes the laptop (it doesn't "exit" a standalone page); M now wired
  ],
});
