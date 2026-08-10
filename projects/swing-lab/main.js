/* ============================================================
   SWING LAB — projects/swing-lab/main.js  (ARC A-LAB, 2026-08-09)
   ------------------------------------------------------------
   WHAT THIS IS AND WHY IT IS NOT ANOTHER CITY. The owner asked, three times, for the web-swing to be
   made GOOD, and the reason it kept not being is measured and written down: swing-ledger.md OPEN #7,
   "the mechanic outruns the level". metropolis's swingable core is a disc about 3 u across, its
   MEDIAN building top is 1.14 u, and its anchors live between y 1.6 and 4.6 with essentially none
   past r≈3. The swing's own `arcClear` rule needs an anchor above `ropeMax + arcClear + skim` = 3.71 u
   before a full-length rope can swing at all — so in that city almost every line the player throws is
   demoted to a ZIP, and every tuning constant in GRAPPLE_PROFILE was fitted to that. You cannot tune a
   pendulum in a room shorter than the pendulum.

   So this is a purpose-built testbed with three properties metropolis cannot have:
     1. PROPORTIONS CHOSEN FROM THE MECHANIC'S OWN NUMBERS. `swingableHeight()` in engine-core derives
        the minimum useful tower from ropeMax/arcClear/skim; the default height is that plus half a
        rope. Nothing here is copied off a city block.
     2. THE LAYOUT IS AN ARGUMENT. Spacing, height, count, spread and a central plaza are live sliders
        AND url params, so "does the swing feel better with wider streets" is a measurement rather than
        an opinion, and a setup worth keeping is a link.
     3. A READOUT OF EVERY NUMBER THE SWING TURNS ON. Speed, rope length, attach state, grounded vs
        airborne, anchor height and rise, ground covered per swing. The ledger's whole method is
        "measure what it did, not what it should do"; this is that method with a face on it.

   ENGINE-FIRST, per the project CLAUDE.md. Nothing in this file is a capability:
     · the level                → `createBoxArena` (engine-core/src/box-arena.js)
     · walk/sprint/jump/fall    → `createCharacterController`
     · the rope                 → `createGrappleModel`
     · crosshair + pointer lock → aim.js
     · renderer/rig/resize      → `createEngineCore`
   What is here is WIRING, a key map, some DOM, and the parameter plumbing that makes it a lab.

   C++ anchor: this file is `main()` — it constructs the subsystems, owns the frame loop, and holds
   nothing but references to things it did not implement.
   ============================================================ */
import {
  THREE, createEngineCore, CAM, createBoxArena, swingableHeight,
  createCharacterController, createGrappleModel, GRAPPLE_PROFILE,
  resolveAimPoint, createAimReticle, createPointerLockAim,
} from '@lgr/engine-core';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const qNum = (k, d) => { const v = Number(Q.get(k)); return Number.isFinite(v) && Q.has(k) ? v : d; };

/* ---------------------------------------------------------------------------------------------
   1. THE ENGINE CORE — renderer, scene, camera rig, resize + context-restore backbone. No city.
   NO POST CHAIN, deliberately: a testbed's job is to show the mechanic, and every pass between the
   scene and the screen is one more thing that can be blamed for how a swing looks. Straight render.
   --------------------------------------------------------------------------------------------- */
const core = createEngineCore({ container: document.body });
const { renderer, scene, rig, frameStart, frameEnd } = core;
rig.setMode(CAM.PERSPECTIVE);
rig.camera.near = 0.02; rig.camera.far = 400; rig.camera.updateProjectionMatrix();
renderer.setClearColor(new THREE.Color('#141821'), 1);
scene.fog = new THREE.Fog('#141821', 26, 120);

/* Lights. `createEngineCore` ships NO lights (it owns the renderer, not the look), so the arena
   supplies its own: one key with shadows, a hemisphere fill so the north faces are not black, and a
   low bounce so a body in a street canyon still reads. */
const key = new THREE.DirectionalLight('#fff0dd', 2.3);
key.position.set(9, 16, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -26; key.shadow.camera.right = 26;
key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
key.shadow.camera.near = 1; key.shadow.camera.far = 70;
key.shadow.bias = -0.0006;
scene.add(key); scene.add(key.target);
scene.add(new THREE.HemisphereLight('#9fb4d8', '#2a2b30', 1.15));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* ---------------------------------------------------------------------------------------------
   2. THE LEVEL. Every parameter is a url param first, a slider second — so a probe and a human drive
   the identical world, and a bug report is a URL.
   --------------------------------------------------------------------------------------------- */
const ARENA0 = {
  cols: qNum('cols', 9), rows: qNum('rows', 9),
  spacing: qNum('spacing', 4.2),
  width: qNum('width', 1.7),
  height: qNum('height', Number(swingableHeight().toFixed(2))),
  heightVary: qNum('vary', 0.45),
  plaza: qNum('plaza', 1),
  seed: qNum('seed', 7),
  groundY: 0,
};
const arena = createBoxArena(ARENA0);
scene.add(arena.group);

/* ---------------------------------------------------------------------------------------------
   3. THE CHARACTER + THE WEB. The profile is a LOCAL COPY of GRAPPLE_PROFILE, never the shared
   export — the lab mutates it live from the dock, and mutating the module's own object would poison
   every other consumer in the bundle (the same shared-default hazard CAR_PROFILE spreads to avoid).
   --------------------------------------------------------------------------------------------- */
const SWING = { ...GRAPPLE_PROFILE, aimMode: Q.get('aim') === 'auto' ? 'auto' : 'point' };
/* EVERY tuning constant is url-addressable, including the four A-LAB assists — so an A/B is a URL
   pair and not a rebuild, and a probe can zero one knob to attribute a delta to it. */
for (const k of ['ropeMax', 'ropeMin', 'assist', 'launchUp', 'launchFwd', 'releasePitch', 'maxSpeed', 'maxVertSpeed',
  'gravity', 'pump', 'airDrag', 'maxHang', 'pivotOut', 'attachBlend', 'floorAssist', 'arcClear', 'minRise', 'zipSlopeMin']) {
  if (Q.has(k)) SWING[k] = qNum(k, SWING[k]);
}
const EYE = 0.28;
const character = createCharacterController({
  world: arena.world,
  grapple: createGrappleModel(SWING),
  grappleProfile: SWING,
  /* Locomotion numbers are metropolis's, unchanged, so a comparison between the two levels is a
     comparison of LEVELS. Gravity matches the grapple's exactly — the two integrators hand the same
     body back and forth mid-flight, so a mismatch reads as the character getting heavier when a web
     cuts (character.js's own seam note). */
  eyeHeight: EYE, radius: 0.09, footR: 0.12, collideYOff: 0.14,
  moveSpeed: 0.55, sprintSpeed: 0.95, accel: 14,
  jumpSpeed: 1.2, gravity: SWING.gravity,
  /* THE CHASE IS SIZED TO THIS LEVEL'S STREETS, and that is the kind of thing a lab exists to find.
     metropolis uses 0.9 u because its street canyon is 0.55 u wide and anything longer spends the
     whole game clipped against a facade. Here the street is 2.5 u, so the arm has room — and it needs
     it: the first mid-swing capture off this lab came back with the body FILLING the frame (the
     spring arm had clipped 0.9 down to 0.42), which is the one thing a third-person swing camera must
     not do. `distMax` opts into the engine's speed dolly on top. */
  third: { dist: 1.9, distMax: 3.0, distAtSpeed: 6, height: 0.34, side: 0.16, springR: 0.06, minDist: 0.35 },
  fov: { base: 58, max: 78, atSpeed: 7 },
});

/* The body you look at in third person, and the line you hang from. Placeholder geometry is an
   accepted stand-in — the arc is the controller, not the art (same ruling as metropolis's capsule). */
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.06, 0.16, 4, 10),
  new THREE.MeshStandardMaterial({ color: '#d8482f', roughness: 0.55, flatShading: true }),
);
body.castShadow = true;
scene.add(body);
const ropeGeo = new THREE.BufferGeometry();
ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: '#f2f4f8' }));
rope.frustumCulled = false; rope.visible = false;
scene.add(rope);
/* A MARKER ON THE ANCHOR, because "where did that web actually land" is the single most common
   question when a swing feels wrong, and a rope alone does not answer it at a distance. */
const anchorDot = new THREE.Mesh(
  new THREE.SphereGeometry(0.06, 10, 8),
  new THREE.MeshBasicMaterial({ color: '#f0884a' }),
);
anchorDot.visible = false;
scene.add(anchorDot);

/* ---------------------------------------------------------------------------------------------
   4. AIM. The ray must overshoot ropeMax rather than stop at it: "there is a building there but it
   is too far" is a DIFFERENT answer from "there is nothing there", and the dim crosshair is how a
   player learns the difference (aim.js's own rule). Sized off the LIVE ropeMax plus the chase.
   --------------------------------------------------------------------------------------------- */
const aimReach = () => SWING.ropeMax + 1.2 + 2.6;    // rope + chase-arm + the "too far" readout band
const _aimPt = { x: 0, y: 0, z: 0 };
let aimHit = null, fireHeld = false;
const reticle = createAimReticle({ container: document.body });
reticle.setVisible(true);
const lockAim = createPointerLockAim({
  element: renderer.domElement,
  onLook: (dx, dy) => character.addLook(dx, dy),
  onFire: (down) => { fireHeld = down; },
  // Losing the lock (Esc, tab switch) must drop the line, or the trigger latches held and the player
  // is hanging from a web they have no way to cut. Same exit-path rule as metropolis.
  onLockChange: (locked) => { if (!locked) fireHeld = false; },
});
renderer.domElement.addEventListener('pointerdown', () => { if (!lockAim.locked) lockAim.request(); });

/* ---------------------------------------------------------------------------------------------
   5. INPUT. One key map for the whole character — the same axis vocabulary the rest of the engine
   speaks, so nothing here needs a translation layer.
   --------------------------------------------------------------------------------------------- */
const held = new Set();
const spawn = () => {
  const p = arena.openSpot(0, -arena.stats.extent * 0.7);
  character.setPosition(p.x, null, p.z);
  character.setYaw(0); character.recenterPitch();
  stats.webs = 0; stats.peak = 0; stats.travel = 0; stats.groundPerSwing = [];
  stats.lastX = character.x; stats.lastZ = character.z;
};
addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.repeat) return;
  held.add(k);
  if (k === 'v') character.toggleView();
  if (k === 'r') spawn();
  if (k === 't') { SWING.aimMode = SWING.aimMode === 'point' ? 'auto' : 'point'; flash(`aim: ${SWING.aimMode}`); }
  if (k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => { held.clear(); fireHeld = false; });   // an unfocused window must not hold keys down

/* ---------------------------------------------------------------------------------------------
   6. THE READOUT. `stats` is the lab's whole reason to exist: the numbers a tuner needs and cannot
   get from looking. GROUND PER SWING is the headline one — it is the quantity `findAnchor` claims to
   maximise, so it is the quantity a change has to move.
   --------------------------------------------------------------------------------------------- */
const stats = { webs: 0, peak: 0, travel: 0, lastX: 0, lastZ: 0, groundPerSwing: [], attachX: 0, attachZ: 0, fps: 0 };
let hadAnchor = false;
function flash(msg) { const h = $('hint'); if (!h) return; h.innerHTML = `<b>${msg}</b>`; clearTimeout(flash._t); flash._t = setTimeout(resetHint, 1600); }
const HINT = $('hint') && $('hint').innerHTML;
function resetHint() { if ($('hint')) $('hint').innerHTML = HINT; }

const set = (id, v, cls) => { const e = $(id); if (!e) return; e.textContent = v; if (cls !== undefined) e.className = 'v ' + cls; };
let hudT = 0;
function updateHud(dt) {
  hudT += dt; if (hudT < 0.1) return; hudT = 0;
  const s = character.state, a = s.anchor;
  const hs = Math.hypot(s.vx, s.vz);
  const chip = $('state-chip');
  const st = character.swinging ? 'swing' : (character.grounded ? 'walk' : 'air');
  chip.className = st; chip.textContent = st.toUpperCase();
  set('v-speed', s.speed.toFixed(2), s.speed > 4 ? 'hot' : '');
  set('v-hspeed', hs.toFixed(2));
  set('v-y', character.y.toFixed(2));
  set('v-vy', s.vy.toFixed(2));
  set('v-att', a ? 'YES' : 'no', a ? 'on' : 'off');
  set('v-rope', a ? s.rope.toFixed(2) : '—');
  set('v-anchy', a ? a.y.toFixed(2) : '—');
  set('v-rise', a ? (a.y - character.y).toFixed(2) : '—');
  set('v-kind', a ? (a.zip ? 'ZIP (winch)' : 'SWING (arc)') : '—', a && a.zip ? 'hot' : '');
  set('v-aim', s.aimInRange ? 'YES' : (aimHit ? 'too far' : 'no target'), s.aimInRange ? 'on' : 'off');
  set('v-webs', String(stats.webs));
  const g = stats.groundPerSwing;
  const mean = g.length ? g.reduce((x, y) => x + y, 0) / g.length : 0;
  set('v-per', g.length ? `${mean.toFixed(2)} u (n=${g.length})` : '—');
  set('v-peak', stats.peak.toFixed(2));
  set('v-trav', stats.travel.toFixed(1));
  set('v-fps', stats.fps.toFixed(0));
}

/* ---------------------------------------------------------------------------------------------
   7. THE DOCK. Geometry sliders rebuild the arena; swing sliders write the LIVE profile object the
   model reads through `P(k)` every frame, so a tuning change takes effect on the next frame with no
   reconstruction — which is what makes "does more launchUp help" answerable in ten seconds.
   --------------------------------------------------------------------------------------------- */
const GEOM = [['cols', 'cols'], ['spacing', 'spacing'], ['width', 'width'], ['height', 'height'], ['vary', 'heightVary'], ['plaza', 'plaza'], ['seed', 'seed']];
const TUNE = ['ropeMax', 'assist', 'launchUp', 'launchFwd', 'releasePitch', 'maxSpeed', 'gravity'];
function syncDock() {
  for (const [id, key] of GEOM) {
    const el = $('p-' + id); if (!el) continue;
    el.value = String(arena.params[key === 'cols' ? 'cols' : key]);
    $('n-' + id).textContent = String(arena.params[key === 'cols' ? 'cols' : key]);
  }
  for (const k of TUNE) {
    const el = $('p-' + k); if (!el) continue;
    el.value = String(SWING[k]); $('n-' + k).textContent = String(Number(SWING[k]).toFixed(2));
  }
}
function wireDock() {
  for (const [id, key] of GEOM) {
    const el = $('p-' + id); if (!el) continue;
    el.addEventListener('input', () => {
      const v = Number(el.value);
      $('n-' + id).textContent = String(v);
      // `cols` drives BOTH axes: a lab wants a square grid unless you say otherwise, and two sliders
      // that must be kept equal are two sliders that will drift apart.
      arena.rebuild(id === 'cols' ? { cols: v, rows: v } : { [key]: v });
    });
  }
  for (const k of TUNE) {
    const el = $('p-' + k); if (!el) continue;
    el.addEventListener('input', () => { SWING[k] = Number(el.value); $('n-' + k).textContent = Number(el.value).toFixed(2); });
  }
  $('b-reset').addEventListener('click', () => { for (const k of TUNE) SWING[k] = GRAPPLE_PROFILE[k]; syncDock(); flash('swing profile reset'); });
  $('b-spawn').addEventListener('click', spawn);
  $('b-copy').addEventListener('click', () => {
    const p = new URLSearchParams();
    p.set('cols', arena.params.cols); p.set('rows', arena.params.rows);
    p.set('spacing', arena.params.spacing); p.set('width', arena.params.width);
    p.set('height', arena.params.height); p.set('vary', arena.params.heightVary);
    p.set('plaza', arena.params.plaza); p.set('seed', arena.params.seed);
    for (const k of TUNE) p.set(k, SWING[k]);
    const url = location.origin + location.pathname + '?' + p.toString();
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    flash('url copied');
  });
  /* THREE PRESETS, and the middle one is the control. "METROPOLIS" reproduces the city's measured
     proportions (median top 1.14 u, 2.45 u block pitch, 0.55 u streets) so any claim that the lab
     feels better than the city can be A/B'd in one click instead of argued. */
  const preset = (o, msg) => () => { arena.rebuild(o); syncDock(); spawn(); flash(msg); };
  $('b-preset-swing').addEventListener('click', preset({ cols: 9, rows: 9, spacing: 4.2, width: 1.7, height: Number(swingableHeight().toFixed(2)), heightVary: 0.45, plaza: 1 }, 'preset: SWING'));
  $('b-preset-metro').addEventListener('click', preset({ cols: 13, rows: 13, spacing: 2.45, width: 1.9, height: 1.14, heightVary: 0.6, plaza: 0 }, 'preset: METROPOLIS (the control)'));
  $('b-preset-open').addEventListener('click', preset({ cols: 5, rows: 5, spacing: 8.0, width: 2.2, height: 9.0, heightVary: 0.3, plaza: 1 }, 'preset: OPEN (far towers)'));
  const dock = $('dock');
  $('dock-toggle').addEventListener('click', (e) => { e.stopPropagation(); dock.classList.toggle('min'); $('dock-toggle').textContent = dock.classList.contains('min') ? '+' : '–'; });
}
wireDock(); syncDock();

/* ---------------------------------------------------------------------------------------------
   8. THE FRAME.
   --------------------------------------------------------------------------------------------- */
const _camPos = { x: 0, y: 0, z: 0 }, _camDir = { x: 0, y: 0, z: 0 };
spawn();
let last = performance.now(), fpsAcc = 0, fpsN = 0;

function frame() {
  requestAnimationFrame(frame);
  if (core.paused || core.contextLost) return;
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;                     // a tab-switch must not teleport the body through a wall
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { stats.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }

  frameStart();

  /* THE CROSSHAIR IS RESOLVED BEFORE THE STEP, so a web attaches to what the player is looking at
     THIS frame rather than last frame's view. It is cast from `rig.camera`, whose matrix was set by
     LAST frame's setEye from this same character — so the ray the mark stands for is the ray the eye
     is actually looking down (aim.js's rule). */
  aimHit = resolveAimPoint(rig.camera, arena.world, _aimPt, { maxDist: aimReach(), radius: 0.05 });

  const fwd = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
  const side = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
  character.update(dt, {
    x: side, y: fwd,
    sprint: held.has('Shift'),
    boost: held.has('Shift') ? 1 : 0,
    jump: held.has(' '),
    fire: fireHeld,
    steer: side,                    // while roped, A/D steer the arc instead of strafing
    lift: fwd,                      // while roped, W/S reel the rope in and out
    aimPoint: aimHit,
  });
  reticle.setInRange(!!character.state.aimInRange);

  /* --- the measurements. GROUND PER SWING is banked on the attach→detach EDGE, because that is the
     unit the mechanic is scored in and an average over frames would weight a long hang the same as a
     long arc. --- */
  const s = character.state;
  if (s.anchor && !hadAnchor) { stats.webs++; stats.attachX = character.x; stats.attachZ = character.z; }
  if (!s.anchor && hadAnchor) {
    const d = Math.hypot(character.x - stats.attachX, character.z - stats.attachZ);
    stats.groundPerSwing.push(d);
    if (stats.groundPerSwing.length > 40) stats.groundPerSwing.shift();
  }
  hadAnchor = !!s.anchor;
  if (s.speed > stats.peak) stats.peak = s.speed;
  stats.travel += Math.hypot(character.x - stats.lastX, character.z - stats.lastZ);
  stats.lastX = character.x; stats.lastZ = character.z;

  /* --- the visible body --- */
  body.position.set(character.x, character.y + EYE * 0.5, character.z);
  body.quaternion.copy(s.quat);
  body.visible = character.view === 'third';
  if (s.anchor) {
    const p = ropeGeo.attributes.position;
    p.setXYZ(0, character.x, character.y + EYE * 0.6, character.z);
    p.setXYZ(1, s.anchor.x, s.anchor.y, s.anchor.z);
    p.needsUpdate = true;
    rope.visible = true;
    anchorDot.position.set(s.anchor.x, s.anchor.y, s.anchor.z);
    anchorDot.visible = true;
  } else { rope.visible = false; anchorDot.visible = false; }

  // the shadow camera follows the body, or a 9x9 arena's worth of shadow map lands nowhere near you
  key.position.set(character.x + 9, 16, character.z + 7);
  key.target.position.set(character.x, 0, character.z);
  key.target.updateMatrixWorld();

  rig.setEye(character.cameraPose(_camPos, _camDir), _camDir);
  /* THE SPEED CUE. The curve and its easing are the controller's (character.js `fov`); this is the
     one line that opts in. Without it a chase camera renders 3 u/s and 7 u/s identically, because the
     body barely moves in frame either way — which is most of why a working swing can feel slow. */
  const wantFov = character.cameraFov(dt);
  if (Math.abs(rig.camera.fov - wantFov) > 0.01) { rig.camera.fov = wantFov; rig.camera.updateProjectionMatrix(); }
  rig.update(dt);

  renderer.setRenderTarget(null);
  renderer.render(scene, rig.camera);
  frameEnd();
  updateHud(dt);

  if (!window.__loaded) {
    document.getElementById('lgr-loader')?.classList.add('gone');
    window.__loaded = true;
    window.__labReady = true;
  }
}
requestAnimationFrame(frame);

/* ---------------------------------------------------------------------------------------------
   9. PROBE HANDLES (house convention — see docs/engine-invariants.md). A probe reads these rather
   than re-deriving state from screenshots, and it drives the SAME entry path a player does.
   --------------------------------------------------------------------------------------------- */
window.__engine = core;
window.__arena = arena;
window.__character = character;
window.__char = character.state;
window.__swingProfile = SWING;
window.__labStats = stats;
window.__aim = { pt: _aimPt, get hit() { return !!aimHit; }, get inRange() { return !!character.state.aimInRange; }, get locked() { return lockAim.locked; } };
/* THE INPUT THE MODEL ACTUALLY RECEIVES — swing-ledger.md's technique #1, and it earned its place
   here immediately. Three benches of the same build disagreed about which tuning was better, with the
   sign flipping between runs; the suspect was never the physics but whether the TRIGGER was down at
   all (pointer lock is refused on an unfronted window, and `createPointerLockAim` only reports a
   mouse-down while locked — so a lost lock silently turns "hold the button and fly" into "stand
   still"). A bench that cannot see its own input cannot tell a bad tuning from a dropped click. */
window.__input = {
  get fire() { return fireHeld; },
  get locked() { return lockAim.locked; },
  get keys() { return [...held]; },
};
window.__spawn = spawn;
window.__setAimMode = (m) => { SWING.aimMode = m === 'auto' ? 'auto' : 'point'; return SWING.aimMode; };
