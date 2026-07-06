/* ============================================================
   THE HOARD — standalone app (Lesson 39, E2) — deploys to /hoard/
   ------------------------------------------------------------
   A LEAN app built on the engine API (@lgr/engine-core): createEngine() builds the city/water/post
   stack, createHoard() adds the game layer, and this file owns the hoard-specific wiring — the iso
   follow-cam, the base plaza + occluder fade that keep the survivor readable, the ranged-aim/fire
   input, and the game loop (engine.updateWorld → engine.decideStyle → engine.renderCityPipeline).
   The city showcase keeps its own copy of this wiring inline (so it stays byte-identical); this is
   the slim, game-only consumer. C++ anchor: a second executable that links the same engine lib and
   wires only the subsystem it needs.
   ============================================================ */
import { THREE, createEngine, CAM, createAppShell, readAppFlags } from '@lgr/engine-core';
import { createHoard } from './hoard.js';

// L114: the APP-half flags parsed ONCE by the shell helper (was a hand-rolled URLSearchParams + demo rule here).
const app = readAppFlags(window.location.search);
const DEMO = app.demo;
window.__demo = DEMO;
const citySeed = (app.q.get('city') ? Number(app.q.get('city')) : 0) || ((Math.random() * 1e9) | 0);
const profileIndex = 0;

const engine = createEngine({ demo: DEMO, citySeed, profileIndex });
const { renderer, scene, rig, sunRig, city, landmarkFactory } = engine;
// L114 app-shell: hoard adopts only the SHARED seam (loop brackets + pause-on-hidden + ready + footer + resize).
// Its exclusive drift items (?capture verbs, tap-pick) stay SHELVED per the mission scope. No onResize needed.
const shell = createAppShell(engine, { name: 'hoard', flags: app });

const hoard = createHoard({ extent: city.extent, plinthTop: 0.3 });
scene.add(hoard.group);
window.__hoardApi = hoard;
// L90 H6 — governor probe (now that hoard brackets the frame): verify the adaptive quality ladder engages.
if (typeof window !== 'undefined') window.__quality = { get level() { return engine.governor.level; }, forceLoad: (ms) => engine.profiler.forceLoad(ms) };
if (typeof window !== 'undefined') window.__rig = rig;   // L90 H7 verify handle (like city's __rig): read camera to confirm 2-finger orbit
let shadowsOn = true; window.__shadows = shadowsOn;
const sceneMode = 'hoard'; window.__scene = sceneMode;   // this page is always the game

/* L34 ARENA READABILITY — open a base PLAZA (hide the central towers) + L33 OCCLUDER FADE (alpha-down
   buildings between the camera and the survivor). Same wiring as the city showcase's hoard mode. */
const _wp = new THREE.Vector3();
const _plazaHidden = new Set();
const PLAZA_R = 6.5;
function clearPlaza(r) {
  city.group.traverse((o) => {
    if (!o.isMesh || o.userData.ground || !o.visible) return;
    o.getWorldPosition(_wp);
    if (Math.hypot(_wp.x, _wp.z) < r) { o.visible = false; _plazaHidden.add(o); }
  });
}
function restorePlaza() { for (const o of _plazaHidden) o.visible = true; _plazaHidden.clear(); }
const hoardRay = new THREE.Raycaster();
const _camToP = new THREE.Vector3(), _chest = new THREE.Vector3();
const _faded = new Set();
function restoreOccluders() {
  for (const m of _faded) {
    if (!m.material) continue;
    m.material.opacity = 1; m.material.transparent = !!m.userData._wasT; m.material.depthWrite = m.userData._wasDW !== false;
  }
  _faded.clear();
}
function updateOccluders(P) {
  restoreOccluders();
  const cam = rig.camera;
  for (const [ox, oz] of [[0, 0], [0.7, 0.4], [-0.7, 0.4]]) {
    _chest.set(P.x + ox, 0.6, P.z + oz);
    _camToP.subVectors(_chest, cam.position);
    const dist = _camToP.length();
    hoardRay.set(cam.position, _camToP.normalize());
    hoardRay.far = dist - 0.4;
    for (const h of hoardRay.intersectObject(city.group, true)) {
      const m = h.object;
      if (!m.material || m.userData.ground || _faded.has(m)) continue;
      m.userData._wasT = m.material.transparent; m.userData._wasDW = m.material.depthWrite;
      m.material.transparent = true; m.material.opacity = 0.16; m.material.depthWrite = false;
      _faded.add(m);
    }
  }
}

/* The iso follow-cam framing, snapped onto the player (no swoop), + open the plaza. */
function enterHoard() {
  hoard.setActive(true);
  clearPlaza(PLAZA_R);
  rig.setMode(CAM.DIMETRIC);
  rig.setZoom(2.8, true);
  rig.setTarget(hoard.player.x, 0.6, hoard.player.z, true);
}

/* INPUT — left-drag/click holds the ranged weapon's fire; the cursor's ground point is the aim;
   right-drag orbits the view (the survivor's facing tracks the azimuth). Touch fire/move live in
   hoard.js (the thumbstick + FIRE/MELEE buttons). */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(0.3 + 0.02));
const _aimPt = new THREE.Vector3();
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
let orbiting = false, lastX = 0, lastY = 0;
const ORBIT_SPEED = 0.005;
const setPointer = (cx, cy) => { pointer.x = (cx / window.innerWidth) * 2 - 1; pointer.y = -(cy / window.innerHeight) * 2 + 1; };
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 0) { setPointer(e.clientX, e.clientY); hoard.setFiring(true); }
  if (e.button === 2) { orbiting = true; lastX = e.clientX; lastY = e.clientY; }
});
window.addEventListener('mousemove', (e) => {
  setPointer(e.clientX, e.clientY);
  if (orbiting) { rig.orbit(-(e.clientX - lastX) * ORBIT_SPEED, -(e.clientY - lastY) * ORBIT_SPEED); lastX = e.clientX; lastY = e.clientY; }
});
window.addEventListener('mouseup', () => { hoard.setFiring(false); orbiting = false; });
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); rig.zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });

/* L90 H7 — TWO-FINGER orbit + pinch-zoom (ported from city/main.js). The game owns ONE finger (move
   thumbstick / aim / fire via its own overlay); the canvas had no touch camera control, so phone players
   were locked to a single view. Two fingers orbit by their midpoint + pinch-zoom by their spread; one
   finger passes through to the game untouched. */
let pinchDist = 0;
const touchMid = (a, b) => [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
const touchDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
renderer.domElement.addEventListener('touchstart', (e) => {
  if (e.touches.length === 2) { orbiting = true; [lastX, lastY] = touchMid(e.touches[0], e.touches[1]); pinchDist = touchDist(e.touches[0], e.touches[1]); }
}, { passive: true });
renderer.domElement.addEventListener('touchmove', (e) => {
  if (e.touches.length !== 2) return;
  e.preventDefault();                                   // only claim the 2-finger gesture (1-finger stays the game's)
  const [mx, my] = touchMid(e.touches[0], e.touches[1]);
  rig.orbit(-(mx - lastX) * ORBIT_SPEED, -(my - lastY) * ORBIT_SPEED); lastX = mx; lastY = my;
  const d = touchDist(e.touches[0], e.touches[1]); if (pinchDist > 0) rig.zoomBy(pinchDist / d); pinchDist = d;
}, { passive: false });
window.addEventListener('touchend', (e) => { if (!e.touches || e.touches.length < 2) { orbiting = false; pinchDist = 0; } });
window.addEventListener('keydown', (e) => { if (e.key === 'h' || e.key === 'H') { shadowsOn = !shadowsOn; window.__shadows = shadowsOn; } });

/* Once the landmark GLBs load, regen so the heroes pop in, then re-open the plaza on the fresh meshes. */
landmarkFactory.whenReady.then(() => {
  city.generate(citySeed, profileIndex);
  engine.fitShadowFrustum();
  restorePlaza(); clearPlaza(PLAZA_R);
  shell.ready();                    // L114: __appReady (+ __cityReady alias) — was a bare window.__cityReady here
});

enterHoard();

// L114 app-shell: the shell owns the loop skeleton (rAF + pause/context skip + frameStart/timer/dt-clamp/frameEnd —
// note hoard's old hand-rolled tick was MISSING the pause/context skip, drift item #1, now fixed for free). The BODY
// below is 100% the game step, unchanged. dt + t come from the shell's timer.
shell.start((dt, t) => {
  // Game pre-step BEFORE the rig damps (smooth follow): face the azimuth, aim at the cursor's ground
  // point, advance the horde, and aim the camera at the player.
  hoard.setAzimuth(rig.azimuth);
  if (!coarse) { raycaster.setFromCamera(pointer, rig.camera); if (raycaster.ray.intersectPlane(groundPlane, _aimPt)) hoard.setAim(_aimPt.x, _aimPt.z); }
  hoard.update(dt, t, sunRig);
  rig.setTarget(hoard.player.x, 0.6, hoard.player.z);
  rig.update(dt);
  updateOccluders(hoard.player);

  engine.updateWorld(dt, t, { shadowsOn, seasonTarget: 0 });
  const style = engine.decideStyle();        // the game runs the engine's default AUTO zoom-ladder
  engine.renderCityPipeline(style, null);
});

// L42: first-run coachmark — a game is unplayable if you can't find the controls (esp. on touch). The shell derives
// the storage key from the name → `lgr_hints_hoard`, and owns the footer show/hide + resize wiring (all removed here).
shell.hints({
  title: 'The Hoard',
  tips: [
    'Move: WASD / arrows · on touch: the left thumb-stick',
    'Aim: mouse / drag · Fire: hold click / the FIRE button · Melee: the MELEE button',
    'Survive the waves · I: bag & crafting (Esc closes it)',   // L110 (audit B13): the bag key is I, not B (hoard.js:264); B does nothing here (it cycles the art era on the city page). Esc closes the bag — it doesn't "exit" the standalone game.
  ],
});
