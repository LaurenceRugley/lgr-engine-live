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
import { THREE, createEngine, CAM, createAppShell, readAppFlags, createDiveController, createSeatedLook, createFirstPersonWalker, createParticles, createDecals, createCharacterRig, createCharacterHorde, makeVignette, damp, createForest, createDebugOverlay, createRecorder } from '@lgr/engine-core';
import { createHoard } from './hoard.js';

// L114: the APP-half flags parsed ONCE by the shell helper (was a hand-rolled URLSearchParams + demo rule here).
const app = readAppFlags(window.location.search);
const DEMO = app.demo;
window.__demo = DEMO;
const citySeed = (app.q.get('city') ? Number(app.q.get('city')) : 0) || ((Math.random() * 1e9) | 0);
const profileIndex = 0;

const engine = createEngine({ demo: DEMO, citySeed, profileIndex });
const { renderer, scene, rig, sunRig, city, landmarkFactory } = engine;
// A10 FIELD-DEBUG overlay — ?debug=gl, default-inert (byte-identical when off).
if (app.q.get('debug') === 'gl') createDebugOverlay({ renderer, scene, getPath: () => window.__renderPath || window.__mode });
// A10 REEL RECORDER — ?rec=1 arms the engine recorder (R toggles a video of the hoard demo); opt-in → byte-identical off.
if (app.q.get('rec') === '1') { const _rec = createRecorder({ canvas: renderer.domElement, name: 'hoard' }); window.addEventListener('keydown', (e) => { if (e.key === 'r' || e.key === 'R') { _rec.toggleRec(); e.preventDefault(); } }); }
// L114 app-shell: hoard adopts only the SHARED seam (loop brackets + pause-on-hidden + ready + footer + resize).
// Its exclusive drift items (?capture verbs, tap-pick) stay SHELVED per the mission scope. No onResize needed.
const shell = createAppShell(engine, { name: 'hoard', flags: app });

// M3: the horde uses flow-field pathing by default (streams around trees); `?ai=seek` restores v1's
// straight-line seek. The field only actually engages on a map WITH colliders (the forest) — the city
// map has none, so its horde step stays byte-identical regardless of this flag.
const AI = app.q.get('ai') === 'seek' ? 'seek' : 'field';
// M4: the gun fires real projectiles (travel + gravity drop) by default; `?gun=hitscan` restores v1.
const GUN = app.q.get('gun') === 'hitscan' ? 'hitscan' : 'proj';

// M6: GPU impact FX. createParticles owns the pool; the hoard emits semantic onImpact events (muzzle on
// fire, burst on a hit) that we turn into particle spawns. null (no float RT) → the game just runs without
// FX (graceful). Added to the scene so the additive sparks read against the dusk arena.
const particles = createParticles(renderer, { texSize: 64, gravity: { x: 0, y: -7, z: 0 }, drag: 0.3, sizeScale: 42 });
if (particles) scene.add(particles.points);
const fxBurst = particles?.emitter('burst');
const fxMuzzle = particles?.emitter('muzzle');

// M5: projected decals — bullet holes where shots hit the ground, blood splats where zombies die. The
// forest GROUND is the registered receiver (registered in buildForest; the ground doesn't move). Barriers
// deform on damage + trees are instanced, so those are a flagged receiver follow-up — the ground is the
// robust, high-value surface. On the city map nothing is registered → projects no-op (safe).
const GROUND_Y = 0.3;
const decals = createDecals({ maxVerts: 6144, life: 22 });   // pools linger ~15s then fade
scene.add(decals.mesh);

function onImpact(kind, x, y, z, nx, ny, nz, isWorld) {
  if (particles) {
    if (kind === 'muzzle') fxMuzzle.emit(x, y, z, nx, ny, nz);
    else fxBurst.emit(x, y, z, nx || 0, (ny || 0) + 0.3, nz || 0);   // bias the spray slightly upward
  }
  if (kind === 'burst' && isWorld) decals.project(x, y, z, nx, ny, nz, { kind: 'hole', size: 0.32 });   // bullet hole on the ground
}
function onDeath(x, z) {
  decals.project(x, GROUND_Y, z, 0, 1, 0, { kind: 'blood', size: 0.7 + Math.random() * 0.4 });   // a blood pool at the kill
  if (particles) fxBurst.emit(x, GROUND_Y + 0.3, z, 0, 1, 0);
}
window.__particles = () => (particles ? particles.liveEstimate : 0);   // M6 probe
window.__decals = () => decals.receiverCount;                          // M5 probe

const hoard = createHoard({ extent: city.extent, plinthTop: 0.3, ai: AI, gun: GUN, onImpact, onDeath });
scene.add(hoard.group);

// M1b: the zombies become rigged CC0 characters. Load the rig, pool a horde (MAXZ slots, 1:1 with the sim
// array), and once the GLB lands hide the capsule InstancedMesh + mirror the sim onto the characters each
// frame. Async — capsules show until it loads. REPRESENTATION ONLY: the sim (count, positions, collision,
// damage, waves) is untouched; this only changes how a zombie is DRAWN.
let horde = null, TYPE_MAT = null;
const TYPE_SCALE = { walker: 0.82, runner: 0.66, tank: 1.2 };   // matches the ZTYPE size ordering
const ZBASE = 0.9;                                              // world scale (Quaternius zombie ~1.8 tall → ~1.6 in-game)
const zType = new Array(hoard.MAXZ).fill(null);                 // last type applied per slot (avoid re-setting material every frame)
const zRig = createCharacterRig({ url: 'models/zombie.glb' });
zRig.ready.then(() => {
  horde = createCharacterHorde(zRig, { size: hoard.MAXZ, lodDistance: 14, lodHz: 3, baseScale: ZBASE });
  scene.add(horde.group);
  let base = null; horde.get(0).object.traverse((n) => { if (n.isMesh && !base) base = n.material; });
  const mk = (hex) => { const m = base.clone(); m.color = new THREE.Color(hex); return m; };
  TYPE_MAT = { walker: mk(0xffffff), runner: mk(0xd8f0a0), tank: mk(0x8fae66) };   // subtle tint; scale does the rest
  hoard.setZombieMeshVisible(false);   // swap capsules → rigged characters
}).catch((e) => { console.warn('[M1b] zombie rig failed to load — keeping capsules:', e.message); });
window.__hordeInfo = () => (horde ? { active: horde.active } : { active: 0 });
window.__hoardApi = hoard;
window.__ai = () => hoard.fieldInfo;   // harness probe: { active, solves, cols, rows }
window.__gun = () => ({ mode: hoard.gunMode, live: hoard.liveBolts });   // M4 probe
// L90 H6 — governor probe (now that hoard brackets the frame): verify the adaptive quality ladder engages.
if (typeof window !== 'undefined') window.__quality = { get level() { return engine.governor.level; }, forceLoad: (ms) => engine.profiler.forceLoad(ms) };
if (typeof window !== 'undefined') window.__rig = rig;   // L90 H7 verify handle (like city's __rig): read camera to confirm 2-finger orbit
let shadowsOn = true; window.__shadows = shadowsOn;
const sceneMode = 'hoard'; window.__scene = sceneMode;   // this page is always the game

/* ============================================================
   THE MAP SEAM (Lesson HOARD-3) — the arena is now DATA (matching the game's enemy-table / item ethos).
   ARENAS holds the per-map knobs; ?map=forest selects the forest, `M` switches (reload with the toggle).
   The CITY map path is byte-identical to before (every forest addition is gated behind MAP === 'forest');
   the dive (createDiveController) is map-agnostic and "just works" in the forest — no new dive code.
   ============================================================ */
const ARENAS = {
  city:   { forest: false },
  forest: {
    forest: true,
    ground: 0x47523a,          // muted brown-green rural ground
    fog: { color: 0x9aa585, density: 0.034 },  // treeline haze thickening the sparse distance
    sunT: 0.72,                // golden-hour dusk — warm + readable from the iso, moody at eye level
    clearingR: 4.9,            // keep-out just outside the barrier ring (BARRIER_R 4.4) — the arena heart
    trees: 46,                 // SPARSE — long sightlines, you see the horde coming
    radius: 20,                // trees recede past the play radius for depth
    minSpacing: 1.5,
  },
};
const MAP = ARENAS[app.q.get('map')] ? app.q.get('map') : 'city';
const AR = ARENAS[MAP];
window.__map = MAP;
let forest = null;   // the createForest handle (forest map only)

/* Build the forest world: hide the city, lay a muted ground, scatter the sparse instanced trees (their
   colliders go to the game), thicken the fog, drop to dusk, and refit the sun's shadow over the arena. */
function buildForest() {
  engine.setUrbanVisible(false);                       // hide the WHOLE city (buildings/streets/traffic/lights/water) — keep the sky
  engine.setPostMode?.(2);                             // clean BEAUTY tier (not the city's stylized zoom-ladder)
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(AR.radius + 6, 48).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: AR.ground, roughness: 1.0, metalness: 0.0 }),
  );
  ground.position.y = 0.3; ground.receiveShadow = true; ground.raycast = () => {};
  scene.add(ground);
  decals.registerReceiver(ground);                     // M5: bullet holes + blood splats land on the arena ground
  forest = createForest({
    seed: citySeed, radius: AR.radius, arenaR: city.extent - 0.7, count: AR.trees,
    minSpacing: AR.minSpacing, clearings: [{ x: 0, z: 0, r: AR.clearingR }], groundY: 0.3,
  });
  scene.add(forest.group);
  hoard.setColliders(forest.colliders);                // trees block the survivor AND the horde
  walker?.setColliders(forest.colliders);              // M2: and block the first-person walker in the dive
  window.__forest = { count: forest.count, colliders: forest.colliders };   // colliders array (harness collision probe)
  sunRig.setAuto?.(false); sunRig.goTo?.(AR.sunT);     // dusk mood (day/night sweep still available via nudge)
  engine.fitShadowFrustum();                           // refit the existing sun-shadow over the arena + trees
}

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
  if (MAP === 'forest') buildForest();                 // forest map: swap the world (city stays untouched)
  else clearPlaza(PLAZA_R);                             // city map: open the downtown plaza (byte-identical)
  rig.setMode(CAM.DIMETRIC);
  rig.setZoom(MAP === 'forest' ? 3.6 : 2.8, true);     // pull back a touch in the forest for the long sightlines
  rig.setTarget(hoard.player.x, 0.6, hoard.player.z, true);
}

/* ============================================================
   THE DIVE (Lesson HOARD-2) — press F to drop from the iso god-view INTO THE SURVIVOR'S EYES. The same
   city scene is rendered from the iso rig-cam (frozen for the descent) and then the FP eye override; the
   reusable createDiveController owns the zoom-crossfade + the two targets. In first-person you STAND in the
   arena at eye level — the horde comes at you — and a seated free-look turns your head. Time DILATES to ~12%
   while dived (the zombies still creep — dread without instant death); the wave/combat state runs on, just
   slow, and survives the round-trip untouched. ESC or F rises back to the god-view.
   ============================================================ */
const EYE_Y = 1.4;                       // survivor eye height (head local 0.66 × scale 1.6 + ground 0.32)
const EYE_PITCH0 = -0.12;                // base downward tilt so the street + the approaching horde fill frame
const DIVE_TIMESCALE = 0.12;             // game clock while dived (the ~10–15% "matrix moment")
let curStyle = null;                     // this frame's style — the render callbacks close over it
let isDived = false;                     // true while mode ≠ 'a' (read by input handlers)
let timeScale = 1;                       // eased game-time multiplier
let baseFacing = 0;                      // the survivor's facing captured at dive-in (FP look base)
let bobT = 0;                            // idle head-bob clock
const seated = createSeatedLook({ yawLimit: 120, pitchUp: 42, pitchDown: 32, sensitivity: 0.2 });
// M2: on the FOREST map the dive lands you WALKING (full 360° look + WASD + tree collision) — the walker
// REPLACES seated there. Every other dive (city-map hoard, cavern, office, city projects) stays seated,
// untouched. Colliders are wired in buildForest (once the forest exists).
const useWalker = MAP === 'forest';
const walker = useWalker ? createFirstPersonWalker({
  eyeY: EYE_Y, arenaRadius: city.extent - 0.7, radius: 0.3, pitchUp: 55, pitchDown: 55, sensitivity: 0.0022,
}) : null;
const _eyePos = new THREE.Vector3(), _eyeDir = new THREE.Vector3(), _focus = new THREE.Vector3();

// A cheap embodiment vignette — only shown while dived, fit to the FP camera each frame.
const vignette = makeVignette({ strength: 0.32 });
vignette.visible = false;
scene.add(vignette);

// The reusable dive. freezeFrom:true — the game has ONE rig (iso ↔ FP eye override), so it can't hold both
// views live in a frame: capture the iso frame at dive() and hold it through the descent while the FP eye
// renders live. Both callbacks are the same city pipeline; the RIG STATE (set in the loop) picks the view.
const diveCtl = createDiveController(engine, {
  rate: 2.0,
  freezeFrom: true,
  renderFrom: (t) => engine.renderCityPipeline(curStyle, t),
  renderTo:   (t) => engine.renderCityPipeline(curStyle, t),
});
window.__dive = diveCtl;   // harness handle

function playerFocusUv() {
  _focus.set(hoard.player.x, 0.9, hoard.player.z).project(rig.camera);   // survivor's on-screen point (iso)
  return new THREE.Vector2(_focus.x * 0.5 + 0.5, _focus.y * 0.5 + 0.5);
}
function diveInto() {
  if (diveCtl.mode !== 'a' || !hoard.active || hoard.dead || hoard.paused) return;
  baseFacing = hoard.player.facing;      // look forward from where the survivor faces
  if (useWalker) {
    // M2: hand movement to the walker, seeded at the survivor's stance; pointer-lock for full mouse-look.
    walker.setPosition(hoard.player.x, hoard.player.z);
    walker.setYaw(hoard.player.facing);
    walker.recenterPitch();
    // best-effort pointer lock (a live desktop gesture); swallow the rejection/throw in headless capture
    // ("root document not valid for pointer lock") — the capture harness drives look via window.__dive.look.
    try { const pl = renderer.domElement.requestPointerLock?.(); if (pl && pl.catch) pl.catch(() => {}); } catch { /* headless */ }
  } else {
    seated.recenter();
  }
  restoreOccluders();                    // un-fade the buildings the iso occluder-fade dimmed (clean FP view)
  curStyle = engine.decideStyle();       // fresh style for the freeze capture (rig is still iso ortho right now)
  diveCtl.dive(playerFocusUv());         // ← captures the ISO (orthographic) freeze into source A
  rig.setMode(CAM.PERSPECTIVE);          // …THEN the FP eye renders through the PERSPECTIVE camera (real depth)
  hoard.setFiring(false);                // drop any held fire as we leave the god-view
}
function surfaceDive() { if (diveCtl.mode !== 'a') { diveCtl.surface(); if (useWalker && document.pointerLockElement) { try { document.exitPointerLock?.(); } catch { /* headless */ } } } }
function toggleDive() { (diveCtl.mode === 'a') ? diveInto() : surfaceDive(); }
window.__dive.toggle = toggleDive;       // capture/harness
window.__dive.look = (dx, dy) => (useWalker ? walker.addLook(dx, dy) : seated.addDrag(dx, dy));   // capture: sweep the first-person view

/* INPUT — left-drag/click holds the ranged weapon's fire; the cursor's ground point is the aim;
   right-drag orbits the view (the survivor's facing tracks the azimuth). Touch fire/move live in
   hoard.js (the thumbstick + FIRE/MELEE buttons). */
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(0.3 + 0.02));
const _aimPt = new THREE.Vector3();
const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
let orbiting = false, looking = false, lastX = 0, lastY = 0;
const ORBIT_SPEED = 0.005;
const setPointer = (cx, cy) => { pointer.x = (cx / window.innerWidth) * 2 - 1; pointer.y = -(cy / window.innerHeight) * 2 + 1; };
renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  // While DIVED the mouse turns your HEAD (seated look), not the gun — the god-view fire/orbit are suspended.
  if (isDived) { if (e.button === 0) { looking = true; lastX = e.clientX; lastY = e.clientY; } return; }
  if (e.button === 0) { setPointer(e.clientX, e.clientY); hoard.setFiring(true); }
  if (e.button === 2) { orbiting = true; lastX = e.clientX; lastY = e.clientY; }
});
window.addEventListener('mousemove', (e) => {
  if (isDived) {
    // M2 forest walker: pointer-lock mouse-look — the raw movement delta turns you 360° (no button hold).
    // Seated dives keep the left-drag head-turn. (Falls back to raw movement if pointer-lock was denied.)
    if (useWalker) walker.addLook(e.movementX || 0, e.movementY || 0);
    else if (looking) { seated.addDrag(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY; }
    return;
  }
  setPointer(e.clientX, e.clientY);
  if (orbiting) { rig.orbit(-(e.clientX - lastX) * ORBIT_SPEED, -(e.clientY - lastY) * ORBIT_SPEED); lastX = e.clientX; lastY = e.clientY; }
});
window.addEventListener('mouseup', () => { hoard.setFiring(false); orbiting = false; looking = false; });
renderer.domElement.addEventListener('wheel', (e) => { e.preventDefault(); if (!isDived) rig.zoomBy(Math.exp(e.deltaY * 0.0015)); }, { passive: false });

/* L90 H7 — TWO-FINGER orbit + pinch-zoom (ported from city/main.js). The game owns ONE finger (move
   thumbstick / aim / fire via its own overlay); the canvas had no touch camera control, so phone players
   were locked to a single view. Two fingers orbit by their midpoint + pinch-zoom by their spread; one
   finger passes through to the game untouched. */
let pinchDist = 0;
const touchMid = (a, b) => [(a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2];
const touchDist = (a, b) => Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
renderer.domElement.addEventListener('touchstart', (e) => {
  if (isDived) return;                                    // dived: the god-view orbit/pinch are suspended
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
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'h') { shadowsOn = !shadowsOn; window.__shadows = shadowsOn; }
  else if (k === 'f') { e.preventDefault(); toggleDive(); }          // F: dive into / rise out of the survivor
  else if (k === 'escape' && isDived) surfaceDive();                 // Esc surfaces (bag-Esc is handled in hoard when paused)
  else if (k === 'm') { const u = new URL(location.href); u.searchParams.set('map', MAP === 'city' ? 'forest' : 'city'); location.href = u.toString(); }   // switch arena
});

/* Once the landmark GLBs load, regen so the heroes pop in, then re-open the plaza on the fresh meshes.
   FOREST map: the city is hidden — skip the regen entirely (the forest owns the world). */
landmarkFactory.whenReady.then(() => {
  if (MAP !== 'city') { shell.ready(); return; }
  city.generate(citySeed, profileIndex);
  engine.fitShadowFrustum();
  restorePlaza(); clearPlaza(PLAZA_R);
  shell.ready();                    // L114: __appReady (+ __cityReady alias) — was a bare window.__cityReady here
});

enterHoard();

// L114 app-shell: the shell owns the loop skeleton (rAF + pause/context skip + frameStart/timer/dt-clamp/frameEnd —
// note hoard's old hand-rolled tick was MISSING the pause/context skip, drift item #1, now fixed for free). The BODY
// below is 100% the game step, unchanged. dt + t come from the shell's timer.
function gameStep(dt, t) {
  isDived = diveCtl.mode !== 'a';                          // in/b/out → first-person + dilated game clock
  timeScale = damp(timeScale, isDived ? DIVE_TIMESCALE : 1, 6, dt);   // ease the matrix-moment in/out
  if (isDived && hoard.dead) surfaceDive();                // dying under-dive kicks you back to the god-view
  // M2: while dived on the forest map the WALKER owns movement — suspend the game's iso move (main.js
  // drives the walker + writes the pose back below). Off-dive / other maps → the original iso move runs.
  if (useWalker) hoard.setMoveSuspended(isDived);

  // GOD-VIEW pre-step (unchanged): face the azimuth + aim at the cursor's ground point. Suspended while dived
  // (the mouse turns your head down there, not the gun).
  if (!isDived) {
    hoard.setAzimuth(rig.azimuth);
    if (!coarse) { raycaster.setFromCamera(pointer, rig.camera); if (raycaster.ray.intersectPlane(groundPlane, _aimPt)) hoard.setAim(_aimPt.x, _aimPt.z); }
  }

  // Advance the horde — DILATED while dived, so the zombies still creep (dread) without instant death.
  hoard.update(isDived ? dt * timeScale : dt, t, sunRig);
  // M6: step the GPU impact particles at the same (dilated-while-dived) clock so sparks match the sim.
  if (particles) particles.update(isDived ? dt * timeScale : dt);
  // M5: advance the decal age clock (real time — a blood pool fades on wall-clock, not the dilated sim).
  decals.update(dt);
  // M1b: mirror the sim onto the rigged horde — transform + animation state per zombie (1:1 with the sim
  // array), type scale/tint applied on a type change. Zombies face the survivor; state comes from their
  // motion + proximity + hit-flash. LOD steps far mixers at 3 Hz from the active camera.
  if (horde) {
    const p = hoard.player, cr = hoard.CONTACT_R + 0.35, zdt = isDived ? dt * timeScale : dt;
    hoard.forEachZombie((i, z) => {
      if (!z.alive) { horde.setActive(i, false); zType[i] = null; return; }
      horde.setActive(i, true);
      if (zType[i] !== z.type) { zType[i] = z.type; horde.setType(i, { scale: ZBASE * (TYPE_SCALE[z.type] || 1), material: (TYPE_MAT && TYPE_MAT[z.type]) || null }); }
      const dx = p.x - z.x, dz = p.z - z.z, d = Math.hypot(dx, dz), sp = Math.hypot(z.vx, z.vz);
      let st;
      if (z.flash > 0.06) st = 'hit';
      else if (d < cr) st = 'attack';
      else if (z.type === 'runner' || sp > 1.3) st = 'run';
      else if (sp > 0.15) st = 'walk';
      else st = 'idle';
      horde.setState(i, st);
      horde.setTransform(i, z.x, GROUND_Y, z.z, Math.atan2(dx, dz));   // face the survivor
    });
    horde.update(zdt, rig.camera.position.x, rig.camera.position.y, rig.camera.position.z);
  }

  if (isDived) {
    if (useWalker) {
      // M2 WALK: the walker moves at REAL dt (full speed) while the world stays dilated — the "matrix"
      // power fantasy: you stride the arena while the horde crawls. Full 360° look, WASD relative to it,
      // trees + rim blocking. Write the pose back so the zombies target the walker + facing follows look.
      walker.update(dt, hoard.moveInput());
      hoard.setPlayerPose(walker.x, walker.z, walker.yaw);
      walker.eyePosition(_eyePos); walker.eyeDirection(_eyeDir);
      rig.setEye(_eyePos, _eyeDir);
    } else {
      // FIRST-PERSON (seated): eye in the survivor's head; seated look turns the head on their frozen facing.
      seated.update(dt);
      const yaw = baseFacing + seated.yaw, pitch = EYE_PITCH0 + seated.pitch, cp = Math.cos(pitch);
      _eyeDir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
      bobT += dt;
      _eyePos.set(hoard.player.x, EYE_Y + Math.sin(bobT * 2.1) * 0.02, hoard.player.z);   // cheap idle head-bob
      rig.setEye(_eyePos, _eyeDir);
    }
    rig.update(dt);
    vignette.visible = true; vignette.fit(rig.camera);
  } else {
    // GOD-VIEW iso follow-cam. setMode(DIMETRIC) re-asserts iso after a surface (idempotent during normal
    // play → byte-identical); clearEye releases the FP override.
    rig.setMode(CAM.DIMETRIC);
    rig.clearEye();
    rig.setTarget(hoard.player.x, 0.6, hoard.player.z);
    rig.update(dt);
    if (MAP === 'city') updateOccluders(hoard.player);        // occluder-fade is a city ability (no buildings to fade in the forest)
    vignette.visible = false;
  }

  engine.updateWorld(dt, t, { shadowsOn, seasonTarget: 0 });   // the WORLD stays real-time (day/night, ambient)
  if (MAP === 'forest') { scene.fog.color.set(AR.fog.color); scene.fog.density = AR.fog.density; }   // re-assert the treeline haze (updateWorld drives the city's fog)
  curStyle = engine.decideStyle();                             // the game runs the engine's default AUTO zoom-ladder
  diveCtl.update(dt);   // presents: iso→screen up top · FP→screen when dived · zoom-crossfade during the descent
}

/* ?capture=1 — deterministic recording (tools/capture-game.mjs): suppress the shell's live rAF and expose
   window.__step(dt) as the sole clock (fixed-timestep frames → smooth by construction). Otherwise the shell
   owns the loop exactly as before (byte-identical un-dived play). */
const CAPTURE_MODE = new URLSearchParams(window.location.search).has('capture');
if (CAPTURE_MODE) {
  let _capT = 0;
  window.__step = (dt = 1 / 60) => {
    const d = Math.min(dt, 0.05);
    engine.frameStart && engine.frameStart();
    gameStep(d, _capT); _capT += d;
    engine.frameEnd && engine.frameEnd();
    return window.__hoard;
  };
  window.__gameReady = true;
} else {
  shell.start(gameStep);
}

// L42: first-run coachmark — a game is unplayable if you can't find the controls (esp. on touch). The shell derives
// the storage key from the name → `lgr_hints_hoard`, and owns the footer show/hide + resize wiring (all removed here).
shell.hints({
  title: 'The Hoard',
  tips: [
    'Move: WASD / arrows · on touch: the left thumb-stick',
    'Aim: mouse / drag · Fire: hold click / the FIRE button · Melee: the MELEE button',
    'F: DIVE into the survivor’s eyes — stand in the horde (Esc / F to rise). Time slows while you’re down there.',
    'Survive the waves · I: bag & crafting (Esc closes it)',   // L110 (audit B13): the bag key is I, not B (hoard.js:264); B does nothing here (it cycles the art era on the city page). Esc closes the bag — it doesn't "exit" the standalone game.
  ],
});
