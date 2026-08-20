/* ============================================================
   WORLD LAB — projects/world-lab/main.js  (ARC A-MARRIAGE, 2026-08-19)
   ------------------------------------------------------------
   THE MARRIAGE ROOM. Route 1 of the ratified citygen↔terrain plan
   (docs/design/research-aaa-environments.md §2): the generated city sits ON real terrain instead of
   a flat plinth. Pads carve flat under blocks, streets become grade-budgeted RAMPS between pads,
   towers stand on pads with their heights authored off their OWN pad top — and ONE world bag serves
   the married geometry to every verb this engine has: WALKING, the BIKE and the SWING each run
   their core loop here, on the same ground, in one page. That composition is the point: the node
   proofs (carve-pads.test.mjs, world-marriage.test.mjs) count the geometry; this room is where the
   verbs actually touch it (each-green-alone-broken-together is the lesson the composition probe
   exists for — tools/world-lab-probe.mjs drives THIS page).

   ENGINE-FIRST, per the project CLAUDE.md. Nothing in this file is a capability:
     · the terrain            → `generateTerrain` / `buildTerrainMesh` / `rebuildTerrainChunks`
     · THE CARVE              → `carveCityPads` + `dirtyMeshesFor` (engine-core/src/carve-pads.js)
     · the ground query       → `createTerrainSampler` (the ONE field's world-Y bilinear read)
     · the city               → `createBoxArena` with the A-MARRIAGE opt-ins
                                (`groundYAt` = pads, `heightAt` = the sampler, `ground: false`)
     · walk/jump/web/swing    → `createCharacterController` + `createGrappleModel` (+ hero body)
     · the bike               → `createBikeModel` (pilot.js) + `createBikeMesh` + `createMotoChaseCam`
   What is here is WIRING, a key map, some DOM, and the dials that make it a lab.
   C++ anchor: this file is `main()` — construct subsystems, own the frame loop, implement nothing.

   MUTATE THE ONE FIELD, ON STAGE: every rebuild runs generate → build WILD mesh → carve → refresh
   ONLY the dirty chunks (`rebuildTerrainChunks`). The carve being visible at all proves the
   dirty-chunk seam works — the ratified route's own mechanism, exercised on every boot rather than
   trusted from a comment.
   ============================================================ */
import {
  THREE, createEngineCore, CAM,
  generateTerrain, buildTerrainMesh, rebuildTerrainChunks, createTerrainSampler,
  carveCityPads, dirtyMeshesFor,
  createBoxArena, percentileOf,
  createCharacterController, createGrappleModel, GRAPPLE_PROFILE,
  resolveAimPoint, createAimReticle, createPointerLockAim,
  createTargetLock, createLockMarker, cameraNearRadius,
  createHeroBody,
  createBikeModel, BIKE_PROFILE, createBikeMesh, createMotoChaseCam,
} from '@lgr/engine-core';
import survivorUrl from '@lgr/engine-core/assets/models/survivor.glb?url';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const qNum = (k, d) => { const v = Number(Q.get(k)); return Number.isFinite(v) && Q.has(k) ? v : d; };

/* ---------------------------------------------------------------------------------------------
   1. THE ENGINE CORE. No post chain (the testbed rule): the subject is the GROUND — every pass
   between scene and screen is one more suspect when a pad step or a ramp grade looks wrong.
   --------------------------------------------------------------------------------------------- */
const core = createEngineCore({ container: document.body });
const { renderer, scene, rig, frameStart, frameEnd } = core;
rig.setMode(CAM.PERSPECTIVE);
rig.camera.near = 0.02; rig.camera.far = 420; rig.camera.updateProjectionMatrix();

/* LATE AFTERNOON, deliberately between the two parent rooms: moto-lab is noon (terrain read needs
   sun on the faces), swing-lab is dusk (silhouette). This room's subject is terrain WITH a skyline
   on it, so the key is warm and low-ish, the fog far plane past the 88 u world, and the horizon
   lifted off black so the city has something to be a silhouette against. */
const SKY = '#33405a';
renderer.setClearColor(new THREE.Color(SKY), 1);
scene.fog = new THREE.Fog(SKY, 50, 300);
const key = new THREE.DirectionalLight('#ffe6c4', 2.1);
key.position.set(12, 18, 8);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -30; key.shadow.camera.right = 30;
key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
key.shadow.camera.near = 1; key.shadow.camera.far = 80;
key.shadow.bias = -0.0006;
scene.add(key); scene.add(key.target);
scene.add(new THREE.HemisphereLight('#a9bedd', '#4a4438', 1.25));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* ---------------------------------------------------------------------------------------------
   2. THE WORLD — terrain, carve, city. Every dial is a URL param first, a slider second, so a bug
   report is a URL and the probe drives the identical world a human sees.
   The NUMBERS mirror the node proofs (carve-pads.test.mjs / world-marriage.test.mjs) — one config
   family, so what the suite counts is what this page stands on.
   --------------------------------------------------------------------------------------------- */
const WP = {
  seed: qNum('seed', 11),
  preset: Q.get('preset') === 'mountains' ? 'mountains' : 'valley',
  /* 336 texels over 104 u (cell 0.310): sized by TWO constraints, both counted in the proofs —
     the pad apron (worst base edge 1.34 + one texel ≤ pad half 1.7, carve-pads.test.mjs proof a)
     and the LOOK (the 58.6 u city needs a real ring of wild island around it — at 88 u the city
     ate the landmass; judged from the aerial capture, not assumed). */
  size: qNum('grid', 336),
  worldSize: qNum('world', 104),
  maxGrade: qNum('grade', 0.25),
  streetW: qNum('street', 1.2),
};
const AR = { cols: qNum('cols', 13), rows: qNum('cols', 13), spacing: qNum('spacing', 4.6) };
/* THE ROPE IS THE HOUSE ROPE, HELD FIXED (A-SKYLINE's own discipline): 4.10 is swing-lab's derived
   constant, and the skyline is generated FROM it (frac 0.70) — so the mechanic is identical across
   rooms and the LEVEL is the only variable. The guarantee is then counted LOCALLY: each tower
   against its own pad (box-arena's A-MARRIAGE stats), which is what this room exists to prove. */
const WORLD_ROPE = 4.10, WORLD_FRAC = 0.70;
const ARENA_SKY = {
  frac: WORLD_FRAC, ropeMax: WORLD_ROPE,
  arcClear: GRAPPLE_PROFILE.arcClear, skim: GRAPPLE_PROFILE.skim,
  tall: 2.1, low: 0.22, gamma: 1.0, cores: 3, coreSigma: 0.30, mix: 0.45,
  /* jitter/footVary CAPPED BY THE PAD: box-arena's worst base edge (wMax/2 + minStreet·jitter/2 =
     1.34 u) plus one terrain texel (0.31 u) must fit the pad plateau's half-side (1.7 u at streetW
     1.2) — the pad-flatness proof COUNTS this (100%), these numbers are why it passes. */
  footVary: 0.45, jitter: 0.2, minStreet: 2.4,
};

let T = null, terrainGroup = null, CARVE = null, HEIGHT = () => 0;
let arena = null;
let LEVEL_BUILD_MS = 0;
/* the LIVE closures the arena reads — they always point at the CURRENT carve/sampler, so an
   arena.rebuild after a dial change re-lays towers on the new pads with no re-wiring. */
const groundYAt = (x, z, i, j) => CARVE.padYOf(i, j);
const heightAt = (x, z) => HEIGHT(x, z);

function buildWorld() {
  const t0 = performance.now();
  if (terrainGroup) { scene.remove(terrainGroup); terrainGroup.userData.dispose(); }
  /* generate → WILD mesh → carve → dirty-chunk refresh: the ratified route's exact mechanism,
     run on stage every build (a carve you can see IS the rebuildTerrainChunks receipt). */
  T = generateTerrain({ seed: WP.seed, size: WP.size, preset: WP.preset });
  terrainGroup = buildTerrainMesh(T, { worldSize: WP.worldSize, baseY: 0, chunks: 6 });
  scene.add(terrainGroup);
  CARVE = carveCityPads(T, { worldSize: WP.worldSize, baseY: 0 },
    { cols: AR.cols, rows: AR.rows, spacing: AR.spacing },
    { streetW: WP.streetW, maxGrade: WP.maxGrade, blend: 3.0 });
  rebuildTerrainChunks(terrainGroup, T, dirtyMeshesFor(terrainGroup, CARVE.touched), true);
  HEIGHT = createTerrainSampler(T, { worldSize: WP.worldSize, baseY: 0 });

  const cfg = {
    cols: AR.cols, rows: AR.rows, spacing: AR.spacing,
    width: 1.9, plaza: 1, seed: WP.seed, groundY: 0, height: 0, heightVary: 0,
    skyline: { ...ARENA_SKY }, silhouette: {},
    groundYAt, heightAt, ground: false,
  };
  if (!arena) { arena = createBoxArena(cfg); scene.add(arena.group); }
  else arena.rebuild(cfg);
  LEVEL_BUILD_MS = performance.now() - t0;
}
buildWorld();

/* ---------------------------------------------------------------------------------------------
   3. THE WALKER + THE WEB (swing-lab's wiring, on married ground). The controller reads the ONE
   bag: heightAt = the carved field, surfaceAt/segmentHit/resolveSphere = the towers standing on it
   — groundAt = max(terrain, roof) is the controller's own line, unmodified.
   --------------------------------------------------------------------------------------------- */
const SWING = { ...GRAPPLE_PROFILE, ropeMax: WORLD_ROPE, aimMode: Q.get('aim') === 'auto' ? 'auto' : 'point' };
/* the hang cap is DERIVED from the rope (the ledger's own rule — a clock racing a pendulum it was
   never sized against): a full period plus margin at rope 4.10 / g 5.4 → 6.83 s. */
SWING.maxHangLatched = Number((2 * Math.PI * Math.sqrt(SWING.ropeMax / SWING.gravity) * 1.24).toFixed(2));
const EYE = 0.28, HERO_H = 0.30, WALK_V = 0.55, SPRINT_V = 0.95, JUMP_V = 1.2;
const THIRD = { dist: 1.9, distMax: 3.0, distAtSpeed: 6, height: 0.34, side: 0.16, springR: 0.06, minDist: 0.35 };
const character = createCharacterController({
  world: arena.world,
  grapple: createGrappleModel(SWING),
  grappleProfile: SWING,
  eyeHeight: EYE, radius: 0.09, footR: 0.12, collideYOff: 0.14,
  moveSpeed: WALK_V, sprintSpeed: SPRINT_V, accel: 14,
  jumpSpeed: JUMP_V, gravity: SWING.gravity,
  third: THIRD,
  fov: { base: 58, max: 78, atSpeed: 7 },
  camEyeClear: cameraNearRadius({ near: 0.02, fov: 78, aspect: 2, margin: 1.25 }),
  cling: { enabled: true },
});
const hero = createHeroBody({
  url: survivorUrl,
  skinned: Q.get('hero') !== 'capsule',
  height: HERO_H, walkSpeed: WALK_V, sprintSpeed: SPRINT_V,
  fallback: { radius: 0.06, length: 0.16, color: '#d8482f' },
  firstPerson: { mode: 'nohead', backOff: 0.05 },
});
scene.add(hero.group);
const ropeGeo = new THREE.BufferGeometry();
ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: '#f2f4f8' }));
rope.frustumCulled = false; rope.visible = false;
scene.add(rope);
const anchorDot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshBasicMaterial({ color: '#f0884a' }));
anchorDot.visible = false;
scene.add(anchorDot);

/* aim + lock (the owner's LMB-lock / RMB-web / SPACE-launch scheme, verbatim from swing-lab) */
const aimReach = () => SWING.ropeMax + THIRD.distMax + AR.spacing;
const _aimPt = { x: 0, y: 0, z: 0 };
let aimHit = null;
const reticle = createAimReticle({ container: document.body });
reticle.setVisible(true);
const targetLock = createTargetLock();
const lockMark = createLockMarker({ container: document.body });
lockMark.setVisible(true);
let webPressed = false;
const lockAim = createPointerLockAim({
  element: renderer.domElement,
  onLook: (dx, dy) => { if (MODE === 'walk') character.addLook(dx, dy); },
  onButton: (btn, down) => {
    if (!down || MODE !== 'walk') return;
    if (btn === 0) {
      if (targetLock.lock(aimHit)) flash('LOCKED — right-click to web it');
      else flash('nothing under the crosshair to lock');
    } else if (btn === 2) {
      webPressed = true;
      if (!character.state.aimInRange) flash(webTarget() ? `too far — web reaches ${SWING.ropeMax.toFixed(1)} u` : 'nothing under the crosshair');
    }
  },
  onLockChange: (locked) => { if (!locked) webPressed = false; },
});
renderer.domElement.addEventListener('pointerdown', () => { if (!lockAim.locked) lockAim.request(); });
const webTarget = () => (targetLock.has ? targetLock.point : aimHit);

/* ---------------------------------------------------------------------------------------------
   4. THE BIKE — the second body on the SAME bag. `createBikeModel` reads only world.heightAt (the
   married sampler); tower collision is the bag's own resolveSphere run after the step — one line
   of wiring, no second collider, which is what "ONE world bag serves the married geometry" means.
   Box bike deliberately (the GLB bike is moto-lab's art arm; here the subject is the GROUND).
   --------------------------------------------------------------------------------------------- */
const BIKE = { ...BIKE_PROFILE };
const bikeModel = createBikeModel(BIKE);
const bike = createBikeMesh({});
bike.group.visible = false;
scene.add(bike.group);
const bikeState = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, quat: new THREE.Quaternion() };
const bikeCam = createMotoChaseCam({});
const BIKE_WORLD = { heightAt };                 // reused every frame (no-hot-alloc)

let MODE = 'walk';                               // 'walk' | 'bike'
let view = 'third';                              // the bike's own V toggle (walker has its own)
function setMode(m) {
  if (m === MODE) return;
  MODE = m;
  if (m === 'bike') {
    /* mount where you stand: the bike takes the walker's spot + heading, from rest. */
    bikeState.x = character.x; bikeState.z = character.z;
    bikeState.y = HEIGHT(bikeState.x, bikeState.z);
    bikeState.yaw = character.lookYaw;
    bikeState.speed = 0; bikeState.vy = 0; bikeState.pitch = 0; bikeState.airborne = false;
    bikeState.upX = 0; bikeState.upY = 1; bikeState.upZ = 0;
    bike.group.visible = true;
    hero.group.visible = false;
    rope.visible = false; anchorDot.visible = false;
    bikeCam.reset(bikeState.yaw);
    flash('the dirtbike — W throttle · ↓ leans back · B to dismount');
  } else {
    /* dismount where the ride ended — the composition loop closes on the same ground. */
    character.setPosition(bikeState.x, null, bikeState.z);
    bike.group.visible = false;
    hero.group.visible = true;
    flash('on foot — LMB lock · RMB web · SPACE launch');
  }
}

/* ---------------------------------------------------------------------------------------------
   5. INPUT — one key map, the axis vocabulary every project sends.
   --------------------------------------------------------------------------------------------- */
const held = new Set();
let spacePulse = false;
const spawn = () => {
  const p = arena.openSpot(0, -((AR.cols - 1) / 2) * AR.spacing * 0.7);
  setMode('walk');
  character.setPosition(p.x, null, p.z);
  character.setYaw(0); character.recenterPitch();
  resetStats();
};
addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'ArrowUp' || k === 'ArrowDown' || k === ' ') e.preventDefault();
  if (e.repeat) return;
  held.add(k);
  if (k === ' ') spacePulse = true;
  if (k === 'v') { if (MODE === 'walk') character.toggleView(); else { view = view === 'third' ? 'first' : 'third'; flash(`view: ${view}`); } }
  if (k === 'r') { spawn(); flash('respawned'); }
  if (k === 'b') setMode(MODE === 'walk' ? 'bike' : 'walk');
});
addEventListener('keyup', (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => { held.clear(); webPressed = false; });

/* ---------------------------------------------------------------------------------------------
   6. THE MEASUREMENTS — the receipts the probe and the HUD both read (one implementation).
   `minClear` per mode = min(y − heightAt) over frames: the NO-SINK receipt, the moto arc's
   containment analog, live on the HUD for BOTH bodies.
   --------------------------------------------------------------------------------------------- */
const stats = { webs: 0, walkMinClear: Infinity, bikeMinClear: Infinity, fps: 0, t: 0 };
let hadAnchor = false, lastLandCount = 0, landings = 0, cleans = 0;
function resetStats() {
  stats.webs = 0; stats.walkMinClear = Infinity; stats.bikeMinClear = Infinity; stats.t = 0;
  landings = 0; cleans = 0; lastLandCount = 0;
}
function flash(msg) { const h = $('hint'); if (!h) return; h.innerHTML = `<b>${msg}</b>`; clearTimeout(flash._t); flash._t = setTimeout(() => { h.innerHTML = HINT; }, 1800); }
const HINT = $('hint') && $('hint').innerHTML;
const set = (id, v, cls) => { const e = $(id); if (!e) return; e.textContent = v; if (cls !== undefined) e.className = 'v ' + cls; };
const deg = (r) => (r * 180 / Math.PI).toFixed(0);
let hudT = 0;
function updateHud(dt) {
  hudT += dt; if (hudT < 0.1) return; hudT = 0;
  const chip = $('state-chip');
  const st = MODE === 'bike' ? (bikeState.airborne ? 'air' : 'ride')
    : character.swinging ? 'swing' : character.clinging ? 'climb' : (character.grounded ? 'walk' : 'air');
  chip.className = st === 'ride' || (MODE === 'bike' && st === 'air') ? (st === 'ride' ? 'ride' : 'air') : st;
  chip.textContent = st.toUpperCase();
  const x = MODE === 'bike' ? bikeState.x : character.x, z = MODE === 'bike' ? bikeState.z : character.z;
  const y = MODE === 'bike' ? bikeState.y : character.y;
  const g = HEIGHT(x, z);
  set('v-speed', (MODE === 'bike' ? bikeState.speed : character.state.speed).toFixed(2));
  set('v-y', y.toFixed(2));
  set('v-ground', `${g.toFixed(2)} (pad Δ ${(y - g).toFixed(2)})`);
  const mc = MODE === 'bike' ? stats.bikeMinClear : stats.walkMinClear;
  set('v-sink', mc === Infinity ? '—' : mc.toExponential(1), mc < -1e-4 ? 'bad' : 'on');
  const s = character.state;
  set('v-web', s.anchor ? `YES · ${s.anchor.y.toFixed(2)}` : `${stats.webs} fired`, s.anchor ? 'on' : '');
  set('v-rope', `${SWING.ropeMax.toFixed(2)} · ${aimReach().toFixed(1)} u`);
  set('v-lock', targetLock.has ? `y ${targetLock.point.y.toFixed(2)}` : 'none — LMB to lock', targetLock.has ? 'on' : 'off');
  set('v-bike', MODE === 'bike' ? `${bikeState.airborne ? bikeState.airtime.toFixed(2) + ' s' : '—'} · ${bikeState.jumps || 0}` : '—', MODE === 'bike' ? 'on' : 'off');
  const L = bikeState.landing;
  set('v-land', L && L.count ? `${deg(L.err)}°·${deg(L.yawErr || 0)}° · kept ${(L.kept * 100).toFixed(0)}% · ${cleans}/${landings}` : '—', L && L.count ? (L.clean ? 'on' : 'bad') : '');
  const cs = CARVE.stats;
  set('v-pads', `${cs.pads} · ${(cs.padMax - cs.padMin).toFixed(2)} u`);
  set('v-grade', `${cs.steepestStreet.toFixed(3)} ≤ ${cs.maxGrade.toFixed(2)}`, cs.steepestStreet <= cs.maxGrade + 1e-9 ? 'on' : 'bad');
  const sw = arena.stats.swingable;
  set('v-guar', sw ? `${sw.clearing}/${sw.towers} (${(100 * sw.frac).toFixed(1)}% vs ${(100 * sw.want).toFixed(0)}%)` : '—',
    sw && Math.abs(sw.frac - sw.want) < 0.02 ? 'on' : 'bad');
  const ri = renderer.info.render;
  set('v-draws', `${ri.calls} · ${(ri.triangles / 1000).toFixed(0)}k · ${stats.fps.toFixed(0)} fps · build ${LEVEL_BUILD_MS.toFixed(0)} ms`);
}

/* ---------------------------------------------------------------------------------------------
   7. THE DOCK.
   --------------------------------------------------------------------------------------------- */
const DIALS = [['seed', 'seed', WP], ['grade', 'maxGrade', WP], ['street', 'streetW', WP], ['cols', 'cols', AR]];
function syncDock() {
  for (const [id, key, obj] of DIALS) {
    const el = $('p-' + id); if (!el) continue;
    el.value = String(obj[key]);
    $('n-' + id).textContent = Number(obj[key]).toFixed(key === 'seed' || key === 'cols' ? 0 : 2);
  }
}
function wireDock() {
  for (const [id, key, obj] of DIALS) {
    const el = $('p-' + id); if (!el) continue;
    el.addEventListener('input', () => {
      obj[key] = Number(el.value);
      if (key === 'cols') AR.rows = AR.cols;     // square city — two sliders that must agree will drift
      $('n-' + id).textContent = Number(el.value).toFixed(key === 'seed' || key === 'cols' ? 0 : 2);
      buildWorld(); spawn();
      flash(`world rebuilt · pads span ${(CARVE.stats.padMax - CARVE.stats.padMin).toFixed(2)} u`);
    });
  }
  $('b-valley').addEventListener('click', () => { WP.preset = 'valley'; buildWorld(); spawn(); flash('preset: valley'); });
  $('b-mountains').addEventListener('click', () => { WP.preset = 'mountains'; buildWorld(); spawn(); flash('preset: mountains'); });
  $('b-spawn').addEventListener('click', spawn);
  $('b-bike').addEventListener('click', () => setMode(MODE === 'walk' ? 'bike' : 'walk'));
  $('b-copy').addEventListener('click', () => {
    const p = new URLSearchParams();
    p.set('seed', WP.seed); p.set('grade', WP.maxGrade); p.set('street', WP.streetW);
    p.set('cols', AR.cols); if (WP.preset !== 'valley') p.set('preset', WP.preset);
    const url = location.origin + location.pathname + '?' + p.toString();
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    flash('url copied');
  });
  const dock = $('dock');
  $('dock-toggle').addEventListener('click', (e) => { e.stopPropagation(); dock.classList.toggle('min'); $('dock-toggle').textContent = dock.classList.contains('min') ? '+' : '–'; });
}
wireDock(); syncDock();

/* ---------------------------------------------------------------------------------------------
   8. THE FRAME.
   --------------------------------------------------------------------------------------------- */
const _camPos = { x: 0, y: 0, z: 0 }, _camDir = { x: 0, y: 0, z: 0 };
const _bCamPos = new THREE.Vector3(), _bCamDir = new THREE.Vector3();
const _hand = new THREE.Vector3();
const AXES = { throttle: 0, steer: 0, lift: 0, boost: 0 };
spawn();
let last = performance.now(), fpsAcc = 0, fpsN = 0;

function frame() {
  requestAnimationFrame(frame);
  if (core.paused || core.contextLost) return;
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { stats.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  stats.t += dt;

  frameStart();

  if (MODE === 'walk') {
    aimHit = resolveAimPoint(rig.camera, arena.world, _aimPt, { maxDist: aimReach(), radius: 0.05 });
    const fwd = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
    const side = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
    character.update(dt, {
      x: side, y: fwd,
      sprint: held.has('Shift'), boost: held.has('Shift') ? 1 : 0,
      jump: held.has(' ') || spacePulse,
      web: webPressed,
      steer: side, lift: fwd,
      aimPoint: webTarget(),
    });
    webPressed = false; spacePulse = false;
    reticle.setInRange(!!character.state.aimInRange);
    lockMark.setInRange(!!character.state.aimInRange);
    targetLock.tick(dt);

    const s = character.state;
    if (s.anchor && !hadAnchor) stats.webs++;
    hadAnchor = !!s.anchor;
    const clear = character.y - HEIGHT(character.x, character.z);
    if (clear < stats.walkMinClear) stats.walkMinClear = clear;

    hero.update(dt, s, { view: character.view, lookYaw: character.lookYaw, anchor: s.anchor });
    if (s.anchor) {
      const p = ropeGeo.attributes.position;
      _hand.set(character.x, character.y + EYE * 0.6, character.z);
      hero.webAnchorPoint(_hand);
      p.setXYZ(0, _hand.x, _hand.y, _hand.z);
      p.setXYZ(1, s.anchor.x, s.anchor.y, s.anchor.z);
      p.needsUpdate = true;
      rope.visible = true;
      anchorDot.position.set(s.anchor.x, s.anchor.y, s.anchor.z);
      anchorDot.visible = true;
    } else { rope.visible = false; anchorDot.visible = false; }

    key.position.set(character.x + 9, 16, character.z + 7);
    key.target.position.set(character.x, 0, character.z);
    key.target.updateMatrixWorld();
    rig.setEye(character.cameraPose(_camPos, _camDir), _camDir);
    const wantFov = character.cameraFov(dt);
    if (Math.abs(rig.camera.fov - wantFov) > 0.01) { rig.camera.fov = wantFov; rig.camera.updateProjectionMatrix(); }
  } else {
    /* THE BIKE FRAME — moto-lab's loop on the married bag: step, then the bag's OWN resolveSphere
       so towers are solid to the wheel (the one line that makes the city more than scenery). */
    AXES.throttle = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
    AXES.steer = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
    AXES.lift = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    AXES.boost = held.has('Shift') ? 1 : 0;
    bikeModel.step(bikeState, AXES, dt, BIKE_WORLD);
    arena.world.resolveSphere(bikeState, dt, BIKE.collide);
    spacePulse = false; webPressed = false;

    const clear = bikeState.y - HEIGHT(bikeState.x, bikeState.z);
    if (clear < stats.bikeMinClear) stats.bikeMinClear = clear;
    if (bikeState.landing && bikeState.landing.count > lastLandCount) {
      lastLandCount = bikeState.landing.count;
      landings++; if (bikeState.landing.clean) cleans++;
    }
    bike.update(bikeState, dt);
    key.position.set(bikeState.x + 9, 16, bikeState.z + 7);
    key.target.position.set(bikeState.x, 0, bikeState.z);
    key.target.updateMatrixWorld();
    bikeCam.pose(bikeState, view, dt, heightAt, _bCamPos, _bCamDir);
    rig.setEye(_bCamPos, _bCamDir);
  }
  /* A-MARRIAGE capture seam (moto-lab's __camOverride, absolute form only): a harness may pin the
     eye for judge shots — { x,y,z, tx,ty,tz }. A dev seam, not a player camera. */
  const ov = window.__camOverride;
  if (ov) {
    _bCamPos.set(ov.x, ov.y, ov.z);
    _bCamDir.set(ov.tx - ov.x, ov.ty - ov.y, ov.tz - ov.z).normalize();
    rig.setEye(_bCamPos, _bCamDir);
  }
  rig.update(dt);

  renderer.setRenderTarget(null);
  renderer.render(scene, rig.camera);
  if (MODE === 'walk') lockMark.place(rig.camera, targetLock.point);
  frameEnd();
  updateHud(dt);

  if (!window.__loaded) {
    document.getElementById('lgr-loader')?.classList.add('gone');
    window.__loaded = true;
    window.__worldReady = true;
  }
}
requestAnimationFrame(frame);

/* ---------------------------------------------------------------------------------------------
   9. PROBE HANDLES (house convention — docs/engine-invariants.md). The probe drives the SAME entry
   path a player does (real keys, real mouse buttons) and reads receipts, never pixels.
   --------------------------------------------------------------------------------------------- */
window.__engine = core;
window.__arena = arena;
window.__character = character;
window.__char = character.state;
window.__swingProfile = SWING;
window.__hero = { get rigged() { return hero.rigged; }, get pose() { return hero.pose; }, ready: hero.ready };
window.__aim = { pt: _aimPt, get hit() { return !!aimHit; }, get inRange() { return !!character.state.aimInRange; }, get locked() { return lockAim.locked; } };
window.__lock = {
  get has() { return targetLock.has; },
  get point() { return targetLock.has ? { ...targetLock.point } : null; },
  clear: () => targetLock.clear(),
};
window.__input = {
  get lmb() { return lockAim.down(0); },
  get rmb() { return lockAim.down(2); },
  get fire() { return lockAim.down(2); },
  get space() { return held.has(' ') || spacePulse; },
  get locked() { return lockAim.locked; },
  get keys() { return [...held]; },
};
window.__world = {
  get mode() { return MODE; },
  carve: () => ({ ...CARVE.stats }),
  padYOf: (i, j) => CARVE.padYOf(i, j),
  heightAt: (x, z) => HEIGHT(x, z),
  /* the guarantee + level facts, read live (the __level pattern) */
  get stats() { return arena.stats; },
  bike: bikeState,
  get walkMinClear() { return stats.walkMinClear; },
  get bikeMinClear() { return stats.bikeMinClear; },
  get webs() { return stats.webs; },
  get landings() { return { landings, cleans }; },
  layout: () => ({ cols: AR.cols, rows: AR.rows, spacing: AR.spacing, streetW: WP.streetW, maxGrade: WP.maxGrade, seed: WP.seed, preset: WP.preset }),
  /* rope percentile over RELATIVE tower heights — the married room's own derivation check:
     swingableRope(relRoof at 1−frac) should hand WORLD_ROPE back (the closed loop, locally). */
  relRoofAt: (p) => {
    const rel = new Float64Array(arena.towers.length);
    for (let k = 0; k < arena.towers.length; k++) rel[k] = arena.towers[k].top - arena.towers[k].y;
    return percentileOf(rel, p);
  },
  buildMs: () => LEVEL_BUILD_MS,
};
window.__spawn = spawn;
window.__setMode = (m) => { setMode(m === 'bike' ? 'bike' : 'walk'); return MODE; };
/* the determinism receipt (moto-lab's own): FNV-1a over the CARVED height buffer — two boots of one
   URL must agree byte-for-byte. */
window.__terrainChecksum = () => {
  let h = 0x811c9dc5;
  const b = new Uint8Array(T.height.buffer);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
};
