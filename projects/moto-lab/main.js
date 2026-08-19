/* ============================================================
   MOTO LAB — projects/moto-lab/main.js  (ARC A-MOTO, 2026-08-18)
   ------------------------------------------------------------
   A dirtbike across procedurally generated terrain — hills, a derived big ramp, big air, flips —
   in the spirit of the owner's reference (Motocross Madness 2's baja mode: open rolling wilderness,
   generous hang-time, stunts gated on height). Phase 1: ride, launch, air-lean, land. No scoring.

   THE HOUSE LESSON THIS ROOM EXISTS TO APPLY (swing-ledger.md, paid for in full by the swing):
   "the level is part of the mechanic." So nothing here is sculpted by eye — the terrain is
   GENERATED FROM THE BIKE'S OWN NUMBERS (createMotoTerrain derives hill wavelength from
   maxSpeed/gravity so full throttle launches you BY CONSTRUCTION, and the big ramp's basin depth
   from airPitchRate so one backflip fits in the air it buys). Change the bike sliders and the
   terrain RE-DERIVES — the fitRopeToArena discipline, on wheels.

   ENGINE-FIRST, per the project CLAUDE.md. Nothing in this file is a capability:
     · the bike physics         → `createBikeModel` (engine-core/src/pilot.js, beside its 6 siblings)
     · the derived terrain      → `createMotoTerrain` (engine-core/src/moto.js)
     · the silhouette + wheels  → `createBikeMesh`
     · the ground-clamped chase → `createMotoChaseCam`
     · trees/rocks dressing     → `generateScatter`/`buildScatterGroup` (L65 — the ORPHANED terrain
                                  scatter, finally consumed by the terrain-shaped level it was built for)
     · renderer/rig/resize      → `createEngineCore`
   What is here is WIRING, a key map, some DOM, and the parameter plumbing that makes it a lab.
   C++ anchor: this file is `main()` — construct subsystems, own the frame loop, implement nothing.
   ============================================================ */
import {
  THREE, createEngineCore, CAM,
  createBikeModel, BIKE_PROFILE,
  createMotoTerrain, createBikeMesh, createBikeGlbMesh, createMotoChaseCam, launchSpeed,
  createTrickScorer,
  generateScatter, buildScatterGroup, BIOMES,
  createCharacterRig,
} from '@lgr/engine-core';
/* the ASSETS (A-MOTO-ASSET, 2026-08-19) — `?url` in the PROJECT, per pedestrians.js's rule (a ?url
   inside the lib would base64-inline them into every bundle). Vite copies both into dist/assets/
   content-hashed; they are runtime fetches, NOT entry JS (size-budget: moto_bike.glb has its own
   fixed-file budget row; survivor.glb is the same shipped asset hoard2/swing-lab already fetch). */
import motoBikeUrl from '@lgr/engine-core/assets/models/moto_bike.glb?url';
import survivorUrl from '@lgr/engine-core/assets/models/survivor.glb?url';
import survivorRideUrl from '@lgr/engine-core/assets/models/survivor_ride.glb?url';   // the (B)-path seated pose clip

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const qNum = (k, d) => { const v = Number(Q.get(k)); return Number.isFinite(v) && Q.has(k) ? v : d; };

/* ---------------------------------------------------------------------------------------------
   1. THE ENGINE CORE. No post chain (the swing-lab rule: a testbed's job is to show the mechanic;
   every pass between scene and screen is one more suspect when a landing looks wrong).
   --------------------------------------------------------------------------------------------- */
const core = createEngineCore({ container: document.body });
const { renderer, scene, rig, frameStart, frameEnd } = core;
rig.setMode(CAM.PERSPECTIVE);
rig.camera.near = 0.05; rig.camera.far = 420; rig.camera.updateProjectionMatrix();

/* DAYLIGHT DESERT, deliberately — the swing labs are dusk rooms because their subject is silhouette
   and anchor; this room's subject is TERRAIN READ (where is the next crest, how steep is the
   landing), which needs sun on the faces. Fog far plane sits past the 120 u world so the far dunes
   haze out instead of popping. */
const SKY = '#8fb2d6';
renderer.setClearColor(new THREE.Color(SKY), 1);
scene.fog = new THREE.Fog(SKY, 60, 320);
const key = new THREE.DirectionalLight('#fff2dc', 2.4);
key.position.set(14, 22, 9);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -30; key.shadow.camera.right = 30;
key.shadow.camera.top = 30; key.shadow.camera.bottom = -30;
key.shadow.camera.near = 1; key.shadow.camera.far = 80;
key.shadow.bias = -0.0006;
scene.add(key); scene.add(key.target);
scene.add(new THREE.HemisphereLight('#bcd2ec', '#5a4d3b', 1.1));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* ---------------------------------------------------------------------------------------------
   2. THE BIKE PROFILE — a LOCAL COPY (the SWING-object rule: the dock mutates it live, and
   mutating the module's shared export would poison every other consumer in the bundle).
   Every constant is a URL param first, a slider second — a bug report is a URL.
   --------------------------------------------------------------------------------------------- */
const BIKE = { ...BIKE_PROFILE };
for (const k of ['maxSpeed', 'accel', 'brake', 'drag', 'turnRate', 'gravity', 'airPitchRate',
  'airDrag', 'cleanAngle', 'scrub', 'keepMin', 'bankMax']) {
  if (Q.has(k)) BIKE[k] = qNum(k, BIKE[k]);
}

/* ---------------------------------------------------------------------------------------------
   3. THE TERRAIN — derived from the bike, rebuilt whenever the DERIVATION INPUTS move.
   `TP` holds the level dials; the bike's speed/gravity/pitchRate are passed BY REFERENCE to the
   generator at build time (one fact, one owner — the profile). Scatter dressing rides along and is
   filtered off the ramp lane (a tree on the run-up would read as a hazard phase 1 doesn't have —
   scatter props carry NO colliders here, stated: dressing, not obstacles. Phase 2 decides).
   --------------------------------------------------------------------------------------------- */
const TP = {
  seed: qNum('seed', 7),
  wavelengthScale: qNum('wl', 1),
  amplitude: qNum('amp', 0.9),
  worldSize: qNum('world', 120),
  size: qNum('grid', 256),
};
const BIOME_KEYS = BIOMES.map((b) => b.key);
let T = null, scatterGroup = null;
let LEVEL_BUILD_MS = 0;

function buildTerrain() {
  const t0 = performance.now();
  if (T) { scene.remove(T.group); T.dispose(); }
  if (scatterGroup) { scene.remove(scatterGroup); scatterGroup.userData.dispose(); scatterGroup = null; }
  T = createMotoTerrain({
    seed: TP.seed, size: TP.size, worldSize: TP.worldSize,
    speed: BIKE.maxSpeed, g: BIKE.gravity, pitchRate: BIKE.airPitchRate,
    amplitude: TP.amplitude, wavelengthScale: TP.wavelengthScale,
  });
  scene.add(T.group);
  /* the dressing — generateScatter reads the terrain's own biome/height buffers, so trees sit on
     hills and rocks on the steep faces with zero extra data. Then the ramp lane is cleared: the
     approach must be honest run-up. */
  const sc = generateScatter({
    terrain: T.terrainData, seed: TP.seed, worldSize: TP.worldSize,
    baseY: T.terrainData.baseY, biomeKeys: BIOME_KEYS, density: 0.55, max: 5000,
  });
  for (const type of Object.keys(sc.placements)) {
    sc.placements[type] = sc.placements[type].filter((p) =>
      // the ramp lane stays honest run-up…
      !(T.ramp && Math.abs(p.x - T.ramp.x) < T.ramp.half + 2 && p.z > T.ramp.zRunUp - 8 && p.z < T.ramp.zBasinEnd + 14)
      // …and nothing grows ON the spawn (a canopy over the opening frame reads as a bug, not a forest)
      && Math.hypot(p.x - T.spawn.x, p.z - T.spawn.z) > 4);
  }
  scatterGroup = buildScatterGroup(sc.placements);
  scene.add(scatterGroup);
  LEVEL_BUILD_MS = performance.now() - t0;
  return T;
}
buildTerrain();

/* ---------------------------------------------------------------------------------------------
   4. THE BIKE — model + silhouette + state. The state object is the model's live movement record;
   the model self-seeds every field it owns (vy/pitch/airborne/jumps/landing/…).
   --------------------------------------------------------------------------------------------- */
const model = createBikeModel(BIKE);
/* TWO ARMS, ONE BUILD (the perf-question discipline): the Blender-pipeline GLB bike is the default;
   `?bike=box` keeps the original box bike as the control arm — same build, same physics, only the
   visual differs — and the GLB path falls back to that same box bike on a load failure (loudly,
   inside createBikeGlbMesh). The physics cannot move either way: both meshes are pure consumers of
   createBikeModel's state, and the probe's 16 checks ride the default arm as the proof. */
const bike = Q.get('bike') === 'box' ? createBikeMesh({}) : createBikeGlbMesh({ url: motoBikeUrl });
scene.add(bike.group);
/* THE RIDER — survivor.glb seated via the poseHold seam, holding OUR OWN 'Ride' clip
   (tools/blender/build_ride_clip.py, the pipeline's (B) path: authored on the survivor's real
   armature because NO shipped clip contains a straddle — measured; the Jump-frame attempt floated
   the body 0.8 u on the clip's own hips-rise). extraClips merges it into the rig's pool; poseHold
   then holds its one frame — the same seam createHeroBody uses for airborne stills. The rig mounts
   as a CHILD of the bike group, so pitch/lean/flip carry the body exactly the way the box bike's
   capsule rider tilts. Load failure degrades to a riderless bike, loudly (createCrowdTiers.js:116). */
let riderRig = null;
if (bike.setRider) {
  riderRig = createCharacterRig({
    url: survivorUrl,
    states: { idle: 'Idle', ride: 'Ride' },
    extraClips: [survivorRideUrl],
  });
  riderRig.ready.then(() => {
    bike.setRider(riderRig.spawn());
  }).catch((e) => console.error('rider rig failed to load (the bike rides riderless):', e));
}
const state = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, quat: new THREE.Quaternion() };

function placeAt(p) {
  state.x = p.x; state.z = p.z; state.yaw = p.yaw || 0;
  state.y = T.heightAt(p.x, p.z);
  state.speed = 0; state.vy = 0; state.pitch = 0; state.airborne = false;
  state.upX = 0; state.upY = 1; state.upZ = 0;
  cam.reset(state.yaw);
  resetStats();
}
const spawn = () => placeAt(T.spawn);
const spawnRamp = () => { if (T.spawnRamp) { placeAt(T.spawnRamp); flash('the big ramp — full throttle, hold S in the air'); } };

/* ---------------------------------------------------------------------------------------------
   5. THE CAMERA — engine ability, ground-clamped both views (the downslope lesson). V toggles.
   --------------------------------------------------------------------------------------------- */
const cam = createMotoChaseCam({});
let view = Q.get('view') === 'first' ? 'first' : 'third';
const _camPos = new THREE.Vector3(), _camDir = new THREE.Vector3();

/* ---------------------------------------------------------------------------------------------
   6. INPUT — the uniform key map (steer = D − A, the same wiring every project sends; the MODEL
   owns the sign, see createBikeModel's convention note). THROTTLE AND LEAN ARE SEPARATE HANDS,
   and that is a design decision with a reason on the record: the first draft made W/S both
   throttle and air-lean, and the flip brief broke it by inspection — "a backflip at FULL
   THROTTLE" needs both verbs at once, and holding W (the natural throttle-pinned posture) would
   have nose-dived every ordinary jump at airPitchRate. The genre solved this long ago (Trials,
   MX vs ATV: gas on one hand, lean on the other): W/S = throttle/brake, ArrowDown = lean back
   (hold it in the air for the backflip), ArrowUp = nose down.
   --------------------------------------------------------------------------------------------- */
const held = new Set();
addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k === 'ArrowUp' || k === 'ArrowDown') e.preventDefault();   // the lean axis must not scroll
  if (e.repeat) return;
  held.add(k);
  if (k === 'v') { view = view === 'third' ? 'first' : 'third'; flash(`view: ${view}`); }
  if (k === 'r') { spawn(); flash('respawned'); }
  if (k === 'g') spawnRamp();
});
addEventListener('keyup', (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => held.clear());   // an unfocused window must not hold keys down

/* ---------------------------------------------------------------------------------------------
   7. THE MEASUREMENTS — the feel metrics the brief names, accumulated on the live page so the
   probe and the HUD read ONE implementation (aim.js's "one implementation of in-range" rule).
     airtime/min · launches/min · clean-landing rate · top speed sustained · min clearance.
   `minClear` is the no-sink receipt: min(y − heightAt) over every frame since spawn — the terrain
   arc's analog of the zero-radius enclosed test, live on the HUD.
   --------------------------------------------------------------------------------------------- */
const stats = {
  t: 0, travel: 0, lastX: 0, lastZ: 0, top: 0, sustained: 0, susT: 0,
  minClear: Infinity, landings: 0, cleans: 0, fps: 0,
};
/* THE TRICK SCORER (A-TRICKS) — the ability lives in engine-core (createTrickScorer, sport-
   agnostic); this file only WIRES it (one update per frame, below) and STYLES it (the popup +
   two readout rows). It is a pure READER of the bike's state — the node suite pins that a run
   with it produces a byte-identical body to a run without it. */
const scorer = createTrickScorer();
function resetStats() {
  stats.t = 0; stats.travel = 0; stats.lastX = state.x; stats.lastZ = state.z;
  stats.top = 0; stats.sustained = 0; stats.susT = 0; stats.minClear = Infinity;
  stats.landings = 0; stats.cleans = 0;
  state.jumps = 0; state.airTotal = 0; state.airtime = 0;
  if (state.landing) state.landing = { err: 0, kept: 1, clean: true, count: 0 };
  /* the scorer resets WITH the landing counter it is keyed to — resetting one without the other
     would leave the scorer waiting for a count the fresh world will never reach. */
  scorer.reset();
}
let lastLandCount = 0;

/* ---------------------------------------------------------------------------------------------
   8. THE HUD (10 Hz).
   --------------------------------------------------------------------------------------------- */
const set = (id, v, cls) => { const e = $(id); if (!e) return; e.textContent = v; if (cls !== undefined) e.className = 'v ' + cls; };
function flash(msg) { const h = $('hint'); if (!h) return; h.innerHTML = `<b>${msg}</b>`; clearTimeout(flash._t); flash._t = setTimeout(() => { h.innerHTML = HINT; }, 1800); }
const HINT = $('hint') && $('hint').innerHTML;
const deg = (r) => (r * 180 / Math.PI).toFixed(0);
/* THE TRICK POPUP — project DOM over engine events (the flash() pattern, centre-stage). Two looks:
   the mid-air ANNOUNCE (gold — the trick is earned, not yet banked) and the landing BANK (green
   clean / red scrubbed — the landing's kept fraction is the popup's own number, so the HUD says
   exactly what the physics decided). Events are consumed the frame they happen; the element is
   retriggered by a class flip, not rebuilt. */
const POP = $('trick-pop');
function popTrick(ev) {
  if (!POP) return;
  if (ev.type === 'trick') {
    POP.className = 'announce';
    POP.innerHTML = `<b>${ev.name.toUpperCase()}${ev.revs > 1 ? ' ×' + ev.revs : ''}</b><span>${ev.points}</span>`;
  } else if (ev.type === 'bank') {
    POP.className = ev.clean ? 'bank-clean' : 'bank-dirty';
    POP.innerHTML = `<b>+${ev.points}</b><span>${ev.clean ? 'CLEAN — banked 100%' : `SCRUBBED — banked ${(ev.kept * 100).toFixed(0)}%`}${ev.combo > 1 ? ` · combo ×${ev.combo}` : ''}</span>`;
  }
  POP.classList.add('show');
  clearTimeout(popTrick._t);
  popTrick._t = setTimeout(() => POP.classList.remove('show'), 1500);
}
let hudT = 0;
function updateHud(dt) {
  hudT += dt; if (hudT < 0.1) return; hudT = 0;
  const chip = $('state-chip');
  chip.className = state.airborne ? 'air' : 'ride';
  chip.textContent = state.airborne ? 'AIR' : 'RIDE';
  const ground = T.heightAt(state.x, state.z);
  set('v-speed', state.speed.toFixed(2), state.speed > BIKE.maxSpeed * 0.9 ? 'hot' : '');
  set('v-vy', (state.vy || 0).toFixed(2));
  set('v-y', state.y.toFixed(2));
  set('v-clear', (state.y - ground).toFixed(2), state.airborne ? 'on' : '');
  set('v-air', state.airborne ? state.airtime.toFixed(2) + ' s' : '—', state.airborne ? 'on' : 'off');
  set('v-airtot', `${(state.lastAir || 0).toFixed(2)} · ${(state.airTotal || 0).toFixed(1)} s`);
  set('v-jumps', String(state.jumps || 0));
  set('v-pitch', `${deg(state.pitch || 0)}° · ${deg(Math.atan((T.heightAt(state.x, state.z + 0.45) - T.heightAt(state.x, state.z - 0.45)) / 0.9))}°`);
  const L = state.landing;
  /* A-WHIP: the landing row reads BOTH axes — pitch° · yaw° off (the verdict's own two errors) */
  set('v-land', L && L.count ? `${deg(L.err)}°·${deg(L.yawErr || 0)}° off · kept ${(L.kept * 100).toFixed(0)}%` : '—',
    L && L.count ? (L.clean ? 'on' : 'bad') : '');
  set('v-clean', stats.landings ? `${stats.cleans}/${stats.landings} (${(100 * stats.cleans / stats.landings).toFixed(0)}%)` : '—');
  /* the score rows read the scorer's own receipts — one implementation, HUD and probe alike.
     A-WHIP: the trick row carries both live streams (flip rev · spin rev) when both are turning. */
  const tk = scorer.read();
  let trickTxt = '—';
  if (tk.pending) {
    const parts = [];
    if (tk.pending.name) parts.push(`${tk.pending.name} ${tk.pending.progress.toFixed(2)} rev`);
    if (tk.pending.yawName) parts.push(`${tk.pending.yawName} ${tk.pending.yawProgress.toFixed(2)} rev`);
    if (parts.length) trickTxt = parts.join(' · ');
  }
  set('v-trick', trickTxt,
    tk.pending && (tk.pending.revs > 0 || tk.pending.yawRevs > 0) ? 'on' : (tk.pending && (tk.pending.name || tk.pending.yawName) ? '' : 'off'));
  set('v-score', `${tk.total} · best ${tk.best}`, tk.total > 0 ? 'on' : '');
  const mins = Math.max(1e-6, stats.t / 60);
  set('v-apm', `${((state.airTotal || 0) / mins).toFixed(1)} s/min`);
  set('v-lpm', `${((state.jumps || 0) / mins).toFixed(1)}`);
  set('v-top', `${stats.top.toFixed(2)} · ${stats.sustained.toFixed(2)}`);
  set('v-trav', stats.travel.toFixed(0) + ' u');
  set('v-sink', stats.minClear === Infinity ? '—' : stats.minClear.toExponential(1),
    stats.minClear < -1e-4 ? 'bad' : 'on');
  set('v-terr', `λ ${T.stats.wavelength.toFixed(1)} · A ${T.stats.amplitude.toFixed(2)} · seed ${T.stats.seed}`);
  const c = T.stats.crests;
  set('v-guar', `${c.launchable}/${c.crests} crests launch · need ${c.vNeedMedian.toFixed(1)} u/s`,
    c.frac >= 0.65 ? 'on' : 'bad');
  const f = T.stats.flip;
  set('v-flip', f ? `${f.predictedAir.toFixed(2)} s air vs need ${f.need.toFixed(2)} s` : 'off',
    f && f.predictedAir >= f.need ? 'on' : 'bad');
  const ri = renderer.info.render;
  set('v-draws', `${ri.calls} · ${(ri.triangles / 1000).toFixed(0)}k · ${stats.fps.toFixed(0)} fps · build ${LEVEL_BUILD_MS.toFixed(0)} ms`);
}

/* ---------------------------------------------------------------------------------------------
   9. THE DOCK. Terrain sliders rebuild; bike sliders write the LIVE profile — and the three that
   feed the DERIVATION (maxSpeed / gravity / airPitchRate) rebuild the terrain too, because the
   room is a function of the bike (the whole thesis, applied to its own dials).
   --------------------------------------------------------------------------------------------- */
const TERR_SLIDERS = [['seed', 'seed'], ['wl', 'wavelengthScale'], ['amp', 'amplitude']];
const BIKE_SLIDERS = ['maxSpeed', 'accel', 'airPitchRate', 'gravity'];
const DERIVING = new Set(['maxSpeed', 'gravity', 'airPitchRate']);
function syncDock() {
  for (const [id, key] of TERR_SLIDERS) { const el = $('p-' + id); if (el) { el.value = String(TP[key]); $('n-' + id).textContent = String(TP[key]); } }
  for (const k of BIKE_SLIDERS) { const el = $('p-' + k); if (el) { el.value = String(BIKE[k]); $('n-' + k).textContent = Number(BIKE[k]).toFixed(1); } }
}
function wireDock() {
  for (const [id, key] of TERR_SLIDERS) {
    const el = $('p-' + id); if (!el) continue;
    el.addEventListener('input', () => {
      TP[key] = Number(el.value); $('n-' + id).textContent = el.value;
      buildTerrain(); spawn();
      flash(`terrain rebuilt · λ ${T.stats.wavelength.toFixed(1)} u`);
    });
  }
  for (const k of BIKE_SLIDERS) {
    const el = $('p-' + k); if (!el) continue;
    el.addEventListener('input', () => {
      BIKE[k] = Number(el.value); $('n-' + k).textContent = Number(el.value).toFixed(1);
      if (DERIVING.has(k)) {
        buildTerrain();                        // the room follows the bike — fitRopeToArena, on wheels
        if (state.y < T.heightAt(state.x, state.z)) state.y = T.heightAt(state.x, state.z);
        flash(`re-derived · λ ${T.stats.wavelength.toFixed(1)} u · flip needs ${T.stats.flip ? T.stats.flip.need.toFixed(2) : '—'} s`);
      }
    });
  }
  $('b-spawn').addEventListener('click', spawn);
  $('b-ramp').addEventListener('click', spawnRamp);
  $('b-reset').addEventListener('click', () => {
    for (const k of BIKE_SLIDERS) BIKE[k] = BIKE_PROFILE[k];
    TP.seed = 7; TP.wavelengthScale = 1; TP.amplitude = 0.9;
    buildTerrain(); spawn(); syncDock(); flash('reset to the derived defaults');
  });
  $('b-copy').addEventListener('click', () => {
    const p = new URLSearchParams();
    p.set('seed', TP.seed); p.set('wl', TP.wavelengthScale); p.set('amp', TP.amplitude);
    for (const k of BIKE_SLIDERS) p.set(k, BIKE[k]);
    if (view === 'first') p.set('view', 'first');
    const url = location.origin + location.pathname + '?' + p.toString();
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    flash('url copied');
  });
  const dock = $('dock');
  $('dock-toggle').addEventListener('click', (e) => { e.stopPropagation(); dock.classList.toggle('min'); $('dock-toggle').textContent = dock.classList.contains('min') ? '+' : '–'; });
}
wireDock(); syncDock();

/* ---------------------------------------------------------------------------------------------
   10. THE FRAME.
   --------------------------------------------------------------------------------------------- */
if (Q.get('ramp') === '1' && T.spawnRamp) placeAt(T.spawnRamp); else spawn();
let last = performance.now(), fpsAcc = 0, fpsN = 0;
const WORLD = { get heightAt() { return T.heightAt; } };   // live-rebindable: a rebuilt terrain swaps in
const AXES = { throttle: 0, steer: 0, lift: 0, boost: 0 }; // reused every frame (no-hot-alloc invariant)

function frame() {
  requestAnimationFrame(frame);
  if (core.paused || core.contextLost) return;
  const now = performance.now();
  let dt = (now - last) / 1000; last = now;
  if (!(dt > 0)) dt = 0;
  if (dt > 0.1) dt = 0.1;                     // a tab-switch must not integrate a 4-second fall
  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) { stats.fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0; }
  stats.t += dt;

  frameStart();

  /* ONE W/S axis, two meanings the STATE decides (throttle grounded, lean airborne) — both are
     sent every frame and the model reads the one its phase owns. steer = D − A, uniform — and
     A-WHIP gives THAT axis its air meaning too (turn on dirt, whip in the air): the owner's
     "maybe a modifier button" resolved to NO modifier, because A/D was measured DEAD airborne
     (the old model never read steer in the air), so the plain keys were free and the whole key
     map stays one-axis-per-hand. The MODEL decides what each axis means; the page just sends. */
  AXES.throttle = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
  AXES.steer = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
  AXES.lift = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);   // ↓ leans back → the flip
  AXES.boost = held.has('Shift') ? 1 : 0;
  model.step(state, AXES, dt, WORLD);          // WORLD re-reads T live (a rebuild swaps in); no per-frame alloc

  /* the measurements (banked here so probe + HUD read the same numbers) */
  const ground = T.heightAt(state.x, state.z);
  const clear = state.y - ground;
  if (clear < stats.minClear) stats.minClear = clear;
  if (state.speed > stats.top) stats.top = state.speed;
  if (state.speed >= BIKE.maxSpeed * 0.95) { stats.susT += dt; if (stats.susT > 0.5 && state.speed > stats.sustained) stats.sustained = state.speed; }
  else stats.susT = 0;
  stats.travel += Math.hypot(state.x - stats.lastX, state.z - stats.lastZ);
  stats.lastX = state.x; stats.lastZ = state.z;
  if (state.landing && state.landing.count > lastLandCount) {
    lastLandCount = state.landing.count;
    stats.landings++; if (state.landing.clean) stats.cleans++;
  }
  /* the trick scorer rides along — a pure reader AFTER the step (announce mid-air, bank on the
     verdict). The returned events array is the scorer's reused scratch: consume, never retain. */
  for (const ev of scorer.update(state)) popTrick(ev);

  bike.update(state, dt);
  if (riderRig) riderRig.update(dt);          // steps the seated rider's mixer (poseHold's carrier)
  // the sun follows the bike, or a 120 u world's shadow map lands nowhere near you (swing-lab rule)
  key.position.set(state.x + 14, 22, state.z + 9);
  key.target.position.set(state.x, 0, state.z);
  key.target.updateMatrixWorld();

  /* A-WHIP probe seam: a capture harness may pin the eye — the rider close-ups need side-on
     framings the chase cannot reach (the A-CRAWL "true side-on is unreachable from the published
     seams" gap, solved here as a dev seam, not a player camera). Two shapes:
       { x,y,z,tx,ty,tz }                       — absolute world eye + aim (a still frame);
       { rel:1, bearing, dist, height, aimY }   — BIKE-RELATIVE, recomputed every frame (bearing
         is radians around the body from its own yaw), because a still eye photographs scenery
         at 7.5 u/s — the harness's first two runs proved it. Ground-clamped like the chase. */
  const ov = window.__camOverride;
  if (ov) {
    if (ov.rel) {
      /* `azimuth` (absolute world bearing) beats `bearing` (body-relative): a whip shot wants to
         hang astern of the FLIGHT line while the body spins through a full 360 under it. */
      const a = ov.azimuth != null ? ov.azimuth : state.yaw + (ov.bearing || 0);
      const ex = state.x + Math.sin(a) * (ov.dist || 1.5), ez = state.z + Math.cos(a) * (ov.dist || 1.5);
      const ey = Math.max(state.y + (ov.height || 0.55), T.heightAt(ex, ez) + 0.15);
      _camPos.set(ex, ey, ez);
      _camDir.set(state.x - ex, state.y + (ov.aimY != null ? ov.aimY : 0.42) - ey, state.z - ez).normalize();
    } else {
      _camPos.set(ov.x, ov.y, ov.z);
      _camDir.set(ov.tx - ov.x, ov.ty - ov.y, ov.tz - ov.z).normalize();
    }
  } else {
    cam.pose(state, view, dt, T.heightAt, _camPos, _camDir);
  }
  rig.setEye(_camPos, _camDir);
  rig.update(dt);

  renderer.setRenderTarget(null);
  renderer.render(scene, rig.camera);
  frameEnd();
  updateHud(dt);

  if (!window.__loaded) {
    document.getElementById('lgr-loader')?.classList.add('gone');
    window.__loaded = true;
    window.__motoReady = true;
  }
}
requestAnimationFrame(frame);

/* ---------------------------------------------------------------------------------------------
   11. PROBE HANDLES (house convention — docs/engine-invariants.md). The probe drives the SAME
   entry path a player does (real keys through the same listeners) and reads receipts, never
   re-derives state from pixels. `__input.keys` is the input the page ACTUALLY holds — the
   swing-ledger's technique #5 (a harness must prove its input ARRIVED, per run).
   --------------------------------------------------------------------------------------------- */
window.__engine = core;
window.__camOverride = null;
window.__moto = {
  state, profile: BIKE, terrain: () => T.stats,
  heightAt: (x, z) => T.heightAt(x, z),
  ramp: () => T.ramp, view: () => view,
  /* A-MOTO-ASSET receipts: which visual arm is actually on screen ('glb' | 'box' | 'loading' —
     the box control arm reports 'box'), and whether the seated rider handle mounted. */
  bikeMode: () => bike.mode || 'box',
  riderMounted: () => !!(riderRig && riderRig.count > 0),
  /* A-WHIP receipts: the mount-IK's own measured joint→socket distances (engine-computed, the
     A-CRAWL contactReport pattern — the probe asserts these, never re-derives from pixels),
     and whether the GLB carried the grip/peg sockets at all. */
  mountReport: () => (bike.rider && bike.rider.mountReport ? { ...bike.rider.mountReport } : null),
  hasSockets: () => !!bike.hasSockets,
  bike,                                   // the visual object itself (pose/mount tuning, receipts)
  /* A-TRICKS receipts: the scorer's own read() — total/best/banks/hash/last{points,kept,clean,
     tricks}/pending. The probe asserts last.kept === state.landing.kept (the same float, page-side)
     rather than re-deriving anything from pixels. */
  tricks: () => scorer.read(),
};
window.__motoStats = stats;
window.__input = { get keys() { return [...held]; } };
window.__spawn = spawn;
window.__spawnRamp = spawnRamp;
window.__rebuild = (o) => { Object.assign(TP, o || {}); buildTerrain(); spawn(); syncDock(); return T.stats; };
/* the determinism receipt: a cheap FNV-1a over the height buffer — two boots of one seed must agree. */
window.__terrainChecksum = () => {
  let h = 0x811c9dc5;
  const b = new Uint8Array(T.height.buffer);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
};
