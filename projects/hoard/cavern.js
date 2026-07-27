/* ============================================================
   THE HOARD — cavern.js (Lesson HOARD-1: the first playable DIVE)
   ------------------------------------------------------------
   A torchlit treasure cavern in the Project-Zomboid visual language — a grounded 3/4 dimetric god-view,
   warm pools of light against deep darkness, gold heaped in the middle — with OUR twist: from the iso
   view you DIVE seamlessly into first-person and stand inside the hoard.

   This file is a LEAN APP: it owns only composition + wiring. Every real ability is inherited from
   @lgr/engine-core — the renderer/post/loop (createEngineCore), the beauty present (createBeautyPresenter),
   the iso↔FPS dive (createSceneTransition, the L60 seam), the seated free-look (createSeatedLook), the
   assembly choreography (createBuildIn), grounding shadows (createShadowRig + makeContactShadow), and the
   NEW flickering light pool this lane grew (createTorchLight). The engine owns the capability; the game
   just casts + configures it — the engine-first contract (see project CLAUDE.md).

   C++ anchor: think of this as a `main()` that links one big engine library and wires a handful of its
   subsystems together — no capability is defined here, only the scene graph and the frame loop that
   drives the borrowed machines.
   ============================================================ */
import {
  THREE, createEngineCore, CAM,
  createBeautyPresenter, createDiveController, createSeatedLook,
  createBuildIn, createShadowRig, makeContactShadow, createTorchLight,
  mulberry32,
} from '@lgr/engine-core';

/* ------------------------------------------------------------
   1) BOOT THE CORE — renderer + scene + rig + post + loop primitives, ZERO world content.
   `lean:true` skips the stylized/god-ray render targets we never use (this is a pure BEAUTY scene);
   beautyRT + bloom (which we DO use, via the presenter) are always allocated regardless. */
const core = createEngineCore({ lean: true });
const { renderer, scene, rig, sunRig } = core;
window.__cavern = { core };   // harness handle

/* Warm near-black cavern air. FogExp2 fades distant rock into black so the torch pools read as the only
   light in the dark — the "oppressive but beautiful" Zomboid mood. (Clear colour is core's 0x0e0b07.) */
scene.background = null;                                  // let the renderer clear colour show
scene.fog = new THREE.FogExp2(0x0a0806, 0.045);

/* ENVIRONMENT MAP — the make-or-break for gold. A METAL has no diffuse: with no environment to reflect it
   renders pure black except where a light glints off it. We bake a tiny warm gradient (amber overhead →
   black below) into a PMREM cube so the gold reflects a warm cavern glow and reads as GOLD everywhere, not
   just under a torch. Cheap: a 32×16 canvas, prefiltered once. C++ anchor: precomputing an irradiance probe. */
function buildEnv(stops) {
  const S = 16, c = document.createElement('canvas'); c.width = 2 * S; c.height = S;
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, S);
  for (const [at, col] of stops) g.addColorStop(at, col);
  x.fillStyle = g; x.fillRect(0, 0, 2 * S, S);
  const tex = new THREE.CanvasTexture(c); tex.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer); pmrem.compileEquirectangularShader();
  const env = pmrem.fromEquirectangular(tex).texture;
  tex.dispose(); pmrem.dispose();
  return env;
}
// MOOD: warm amber overhead → black below (torchlit dark). FULLBRIGHT: flat bright grey so metals
// reflect an even work-light and every object is visible (a metal needs a bright ENV, not more lamps).
const envMood = buildEnv([[0.0, '#4a3316'], [0.5, '#160d06'], [1.0, '#000000']]);
const envBright = buildEnv([[0.0, '#b8b2a2'], [0.5, '#8f8a7c'], [1.0, '#4a4740']]);
scene.environment = envMood;

/* Freeze the day/night rig at deep NIGHT so the engine's colour-grade + bloom read a dark mood (not
   daylight washing our torchlight). SunRig has no instant setter — we turn OFF the auto day-creep and
   aim it at t=0 (midnight); the loop's sunRig.update(dt) eases there in the first second and then holds
   (auto off ⇒ no drift). The grade/sunArc it drives are bound BY REFERENCE into the filmic + bloom passes. */
sunRig.setAuto(false);
sunRig.goTo(0.0);

/* ------------------------------------------------------------
   2) MATERIALS — gold-on-darkness. Metals have no diffuse, so away from a light they'd read pure black;
   a faint warm `emissive` gives the mass BODY in shadow while the torches supply the bright specular
   GLINTS. Shape + light carry the read (the brief's bet), so the geometry stays primitive. */
const matGold = new THREE.MeshStandardMaterial({ color: 0xc79338, metalness: 0.9, roughness: 0.32, emissive: 0x2a1804, emissiveIntensity: 1, envMapIntensity: 1.1 });
const matGoldBright = new THREE.MeshStandardMaterial({ color: 0xe6b255, metalness: 0.95, roughness: 0.2, emissive: 0x3a2408, emissiveIntensity: 1, envMapIntensity: 1.3 });
const matRock = new THREE.MeshStandardMaterial({ color: 0x171310, metalness: 0.0, roughness: 0.97 });
const matWood = new THREE.MeshStandardMaterial({ color: 0x2e1c0e, metalness: 0.1, roughness: 0.75 });
const GEM_COLORS = [0x9a1226, 0x0f7a3c, 0x1636b0, 0x8a1aa0];   // ruby · emerald · sapphire · amethyst
const gemMats = GEM_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, metalness: 0.1, roughness: 0.12, emissive: c, emissiveIntensity: 0.35 }));

/* ------------------------------------------------------------
   3) THE CAVERN SHELL — a rough rock floor + an enclosing wall ring drawn on its INSIDE (BackSide) so we
   stand within it. Deliberately dark; fog swallows the far side. */
const floor = new THREE.Mesh(new THREE.CircleGeometry(16, 48), matRock);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const walls = new THREE.Mesh(new THREE.CylinderGeometry(15, 17, 12, 40, 1, true), matRock);
walls.material = matRock.clone(); walls.material.side = THREE.BackSide;   // seen from inside
walls.position.y = 5.6;
scene.add(walls);

/* A few rough boulders around the rim for silhouette + to catch a torch edge. Seeded, deterministic. */
const rng = mulberry32(0x0ffee);
const boulderGeo = new THREE.IcosahedronGeometry(1, 0);
for (let i = 0; i < 9; i++) {
  const a = (i / 9) * Math.PI * 2 + rng() * 0.4;
  const r = 8.5 + rng() * 3;
  const b = new THREE.Mesh(boulderGeo, matRock);
  b.position.set(Math.cos(a) * r, rng() * 0.6, Math.sin(a) * r);
  b.scale.setScalar(0.8 + rng() * 1.6);
  b.rotation.set(rng() * 3, rng() * 3, rng() * 3);
  b.receiveShadow = true;
  scene.add(b);
}

/* ------------------------------------------------------------
   4) THE HOARD — the centrepiece. Coin piles (instanced) + three primitive-built hero objects (chest,
   goblet, crown) + a scatter of gems. Each buildable UNIT is its own Object3D so the assembly can fly
   them in independently (see §6). We record each unit for the buildIn `buildGroups` contract. */
const buildGroups = [];                       // [{ object, role }] — the assembly casting list
const heroMeshes = [];                        // meshes that cast the grounding shadow

/* A conical COIN PILE as one InstancedMesh (hundreds of coins = one draw call — the typed-array-of-
   matrices trick; C++ anchor: one VBO of per-instance transforms, drawn instanced). Placed at (x,z);
   buildIn moves the whole mesh as a unit. */
const coinGeo = new THREE.CylinderGeometry(0.11, 0.11, 0.028, 12);
function makeCoinPile(x, z, count, spread, peak, seed) {
  const r = mulberry32(seed);
  const mesh = new THREE.InstancedMesh(coinGeo, matGold, count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3(), e = new THREE.Euler();
  for (let i = 0; i < count; i++) {
    const rad = Math.sqrt(r()) * spread;                 // sqrt → even area fill, denser look
    const ang = r() * Math.PI * 2;
    const h = peak * (1 - rad / spread) * (0.5 + 0.5 * r());   // taller toward the centre → a heap
    e.set(r() * 0.5 - 0.25, r() * Math.PI * 2, r() * 0.5 - 0.25);   // coins lie mostly flat, jittered
    q.setFromEuler(e);
    p.set(Math.cos(ang) * rad, h, Math.sin(ang) * rad);
    m.compose(p, q, s);
    mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.position.set(x, 0, z);
  scene.add(mesh);
  buildGroups.push({ object: mesh, role: 'coins' });
  return mesh;
}
makeCoinPile(0.0, 0.0, 260, 2.6, 1.05, 0x1001);
makeCoinPile(-1.4, 1.1, 150, 1.6, 0.7, 0x1002);
makeCoinPile(1.6, -0.9, 150, 1.5, 0.62, 0x1003);

/* CHEST — a wooden box with a lid and two gold bands, spilling nothing yet but heavy with promise. */
function makeChest() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.6, 0.72), matWood);
  body.position.y = 0.3;
  const lid = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.22, 0.74), matWood);
  lid.position.set(0, 0.66, -0.28); lid.rotation.x = -0.9;         // thrown open
  const bandGeo = new THREE.BoxGeometry(1.16, 0.09, 0.78);
  const band1 = new THREE.Mesh(bandGeo, matGold); band1.position.y = 0.16;
  const band2 = new THREE.Mesh(bandGeo, matGold); band2.position.y = 0.46;
  for (const m of [body, lid, band1, band2]) { m.castShadow = true; g.add(m); heroMeshes.push(m); }
  g.position.set(-2.4, 0.0, 1.4);
  g.rotation.y = 0.5;
  scene.add(g);
  buildGroups.push({ object: g, role: 'hero' });
  return g;
}

/* GOBLET — a LatheGeometry: spin a 2-D silhouette profile around Y to sweep a cup + stem + foot. */
function makeGoblet() {
  const profile = [
    [0.00, 0.00], [0.22, 0.00], [0.22, 0.04], [0.06, 0.08], [0.05, 0.34],   // foot + stem
    [0.20, 0.42], [0.30, 0.50], [0.32, 0.74], [0.30, 0.76], [0.28, 0.52], [0.0, 0.46],   // bowl (hollow lip)
  ].map(([x, y]) => new THREE.Vector2(x, y));
  const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 24), matGoldBright);
  mesh.castShadow = true; heroMeshes.push(mesh);
  mesh.position.set(2.0, 0.5, 1.0);            // perched on the pile shoulder
  mesh.rotation.z = 0.22;                      // tipped, as if dropped
  scene.add(mesh);
  buildGroups.push({ object: mesh, role: 'hero' });
  return mesh;
}

/* CROWN — the true centrepiece: a gold band with spikes, jewels set into it, resting atop the main pile. */
function makeCrown() {
  const g = new THREE.Group();
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 12, 32), matGoldBright);
  band.rotation.x = Math.PI / 2;
  g.add(band); heroMeshes.push(band);
  const spikeGeo = new THREE.ConeGeometry(0.07, 0.34, 8);
  const N = 8;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const spike = new THREE.Mesh(spikeGeo, matGoldBright);
    spike.position.set(Math.cos(a) * 0.42, 0.2, Math.sin(a) * 0.42);
    spike.castShadow = true; g.add(spike); heroMeshes.push(spike);
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.06), gemMats[i % gemMats.length]);
    gem.position.set(Math.cos(a) * 0.42, 0.06, Math.sin(a) * 0.42);
    g.add(gem);
  }
  g.position.set(0, 1.12, 0);                  // crowning the main heap
  scene.add(g);
  buildGroups.push({ object: g, role: 'hero' });
  return g;
}

/* GEMS — a loose scatter of cut stones catching the light, as one buildable unit. */
function makeGems() {
  const g = new THREE.Group();
  const geo = new THREE.IcosahedronGeometry(0.13, 0);
  const r = mulberry32(0x6e5);
  for (let i = 0; i < 22; i++) {
    const gem = new THREE.Mesh(geo, gemMats[i % gemMats.length]);
    const a = r() * Math.PI * 2, rad = 0.4 + r() * 2.4;
    gem.position.set(Math.cos(a) * rad, 0.06 + r() * 0.12, Math.sin(a) * rad);
    gem.scale.setScalar(0.6 + r() * 0.9);
    gem.rotation.set(r() * 3, r() * 3, r() * 3);
    g.add(gem);
  }
  g.position.set(0.4, 0, 1.2);
  scene.add(g);
  buildGroups.push({ object: g, role: 'gems' });
  return g;
}

makeChest(); makeGoblet(); makeCrown(); makeGems();

/* ------------------------------------------------------------
   5) LIGHT — the whole mood. Three TORCH pools (the new createTorchLight ability) flicker warm against
   the dark, each with a small emissive flame so you can SEE the source. Plus a very dim warm ambient so
   the gold mass never goes fully black, and one dim overhead KEY that casts the grounding shadows. */
const AMBIENT = new THREE.HemisphereLight(0x3a2c1a, 0x0a0705, 0.5);    // warm sky / near-black ground
scene.add(AMBIENT);

/* Torch intensity is in CANDELA (three's physically-correct lighting) with inverse-square decay, so a
   pool a few metres wide needs a value in the DOZENS, not single digits — 7.5 at 5 m is ~0.3 lux, black.
   The flame sphere is emissive (toneMapped:false so bloom catches it) and pulses with the light. */
const TORCH_BASE = 48;
const flameGeo = new THREE.SphereGeometry(0.09, 10, 10);
const torches = [];
function addTorch(x, y, z, seed) {
  const t = createTorchLight({ intensity: TORCH_BASE, distance: 26, decay: 2, position: [x, y, z], amp: 0.34, seed });
  scene.add(t.light);
  const flame = new THREE.Mesh(flameGeo, new THREE.MeshBasicMaterial({ color: 0xffd68a, toneMapped: false }));
  flame.position.set(x, y, z);
  scene.add(flame);
  torches.push({ ...t, flame, base: TORCH_BASE });
  return t;
}
addTorch(-4.5, 2.4, -3.2, 0.0);
addTorch(4.6, 2.6, -2.6, 2.1);
addTorch(0.2, 2.2, 5.2, 4.7);

/* GROUNDING — two layers. (a) makeContactShadow blobs: cheap soft AO that anchors each hero object to
   the pile no matter the light. (b) createShadowRig: a dim warm overhead key that casts REAL shadows
   (the weekend's shadow ability), grounding the heap with a genuine cast. */
scene.add(makeContactShadow({ w: 1.8, d: 1.4, x: -2.3, z: 1.5, opacity: 0.55 }));
scene.add(makeContactShadow({ w: 0.7, d: 0.7, x: 2.0, y: 0.42, z: 1.0, opacity: 0.45 }));
scene.add(makeContactShadow({ w: 4.4, d: 4.4, x: 0, z: 0, opacity: 0.4 }));

const shadowRig = createShadowRig(core, { scene, color: 0xffd8a0, intensity: 0.4, center: [0, 0.6, 0], radius: 7, distance: 12, mapSize: 1024 });
shadowRig.setSunDir(new THREE.Vector3(0.35, 1.0, 0.25).normalize());   // steep warm key from above-front
shadowRig.update();

/* A flat top FILL used ONLY by the fullbright playtest preset (0 intensity in the mood look). */
const fillLight = new THREE.DirectionalLight(0xffffff, 0);
fillLight.position.set(2, 12, 4);
scene.add(fillLight);

/* ------------------------------------------------------------
   LIGHTING MODES — one config, two presets (NOT scattered if-statements), so a playtester can flip
   between the moody torchlit MOOD look and a flat even FULLBRIGHT work-light where everything is
   visible. Toggle at runtime (key L) or boot straight into it (?fullbright=1). MOOD is the shipping /
   capture look; FULLBRIGHT is a testing aid only.
   LIFT CANDIDATE (owner-flagged): this two-preset debug-lighting rig is a generic engine playtest tool
   — a future createLightingModes(core, { scene, lights, presets }) belongs in engine-core (see HANDOFF). */
const LIGHTING = {
  mood:       { ambient: 0.50, fog: 0.045, key: 0.40, fill: 0.0, torch: true,  clear: 0x0e0b07, env: envMood,   flame: true },
  fullbright: { ambient: 1.20, fog: 0.003, key: 0.60, fill: 1.4, torch: false, clear: 0x3a352c, env: envBright, flame: false },
};
let lighting = LIGHTING.mood;
function applyLighting(name) {
  lighting = LIGHTING[name] || LIGHTING.mood;
  AMBIENT.intensity = lighting.ambient;
  scene.fog.density = lighting.fog;
  shadowRig.light.intensity = lighting.key;
  fillLight.intensity = lighting.fill;
  renderer.setClearColor(lighting.clear, 1);
  scene.environment = lighting.env;                        // the metal work-light lever
  for (const t of torches) { t.flame.visible = lighting.flame; if (!lighting.torch) { t.light.intensity = t.base; t.flame.scale.setScalar(1); } }
  window.__cavern.lighting = name;
}
const params = new URLSearchParams(location.search);
applyLighting(params.get('fullbright') === '1' ? 'fullbright' : 'mood');
/* ?capture=1 — the deterministic recording mode (tools/capture-cavern.mjs). It SUPPRESSES the live rAF
   loop so window.__cavern.step(dt) is the sole clock (fixed-timestep frames → smooth-by-construction,
   decoupled from headless-GPU speed), mirroring the demos' capture convention. */
const CAPTURE = params.has('capture');

/* ------------------------------------------------------------
   6) THE ASSEMBLY — on load the hoard BUILDS ITSELF: every unit CONVERGES in from a scattered start into
   its resting pose. createBuildIn captures each object's current position as HOME, so we build the scene
   at rest first (done above), then play('converge'). */
const buildIn = createBuildIn({ buildGroups });
let assemblyPlaying = true;
buildIn.play('converge', { duration: 2200, easing: 'easeOutCubic', stagger: 0.6, distance: 9 })
  .then(() => { assemblyPlaying = false; });

/* ------------------------------------------------------------
   7) TWO VIEWS + THE DIVE.
   The rig (dimetric ortho) is the ISO god-view — source A. A dedicated perspective camera is the
   first-person eye standing IN the hoard — source B (exactly as the city dive pairs the city rig with
   the office's own camera). createSceneTransition owns the eased A→B crossfade + focus push-in; we own
   the two screen-sized targets and hand their textures in once. */
rig.setMode(CAM.DIMETRIC);
rig.setTarget(0, 0.7, 0, true);
rig.setZoom(5.2, true);

const fpsCam = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.05, 100);
const FPS_EYE = new THREE.Vector3(3.0, 1.35, 4.4);       // standing at the hoard's edge
const FPS_LOOKAT = new THREE.Vector3(0, 0.7, 0);         // eyes on the crown
const _bd = FPS_LOOKAT.clone().sub(FPS_EYE).normalize();
const BASE_YAW = Math.atan2(_bd.x, _bd.z);
const BASE_PITCH = Math.asin(THREE.MathUtils.clamp(_bd.y, -1, 1));
const seated = createSeatedLook({ yawLimit: 95, pitchUp: 40, pitchDown: 35, sensitivity: 0.18 });
const _dir = new THREE.Vector3();
function placeFpsCam(dt) {
  seated.update(dt);
  const yaw = BASE_YAW + seated.yaw;
  const pitch = BASE_PITCH + seated.pitch;
  const cp = Math.cos(pitch);
  _dir.set(Math.sin(yaw) * cp, Math.sin(pitch), Math.cos(yaw) * cp);
  fpsCam.position.copy(FPS_EYE);
  fpsCam.lookAt(FPS_EYE.x + _dir.x, FPS_EYE.y + _dir.y, FPS_EYE.z + _dir.z);
}

const presenter = createBeautyPresenter(core);
const isoPack = { scene, camera: rig.camera, usesBloom: true };
const fpsPack = { scene, camera: fpsCam, usesBloom: true };

/* THE DIVE — the reusable engine seam (createDiveController, Lesson HOARD-2). It owns the two crossfade
   targets + the present orchestration; the cavern owns a SEPARATE fps camera, so both views render live
   (freezeFrom:false). We just tell it HOW to render each view (beauty-present into a target). */
const dive = createDiveController(core, {
  rate: 2.4,                                              // slow, deliberate descent (< city's 4.6)
  freezeFrom: false,
  renderFrom: (t) => presenter.present(isoPack, t),
  renderTo:   (t) => presenter.present(fpsPack, t),
});

/* Resize: the controller resizes its own targets; we only need to keep the fps camera's aspect current. */
core.registerContentResizer(() => {
  fpsCam.aspect = window.innerWidth / window.innerHeight;
  fpsCam.updateProjectionMatrix();
});
window.addEventListener('resize', () => core.resize());

/* ------------------------------------------------------------
   8) DIVE TRIGGERS — a key/click descends; a surface key returns. focusUv is the crown's on-screen
   position in the ISO view, so the push-in zooms toward the treasure, not the frame centre. */
const _fp = new THREE.Vector3();
function crownFocusUv() {
  _fp.set(0, 1.1, 0).project(rig.camera);
  return new THREE.Vector2(_fp.x * 0.5 + 0.5, _fp.y * 0.5 + 0.5);
}
function diveIn() { if (dive.mode === 'a') { seated.recenter(); dive.dive(crownFocusUv()); setHud(); } }
function surface() { if (dive.mode === 'b' || dive.mode === 'in') { dive.surface(); setHud(); } }
function toggleDive() { (dive.mode === 'a') ? diveIn() : surface(); }
window.__cavern.diveIn = diveIn; window.__cavern.surface = surface;   // harness/capture handles
window.__cavern.look = (dx, dy) => seated.addDrag(dx, dy);            // capture: nudge the FPS head-turn

/* ------------------------------------------------------------
   9) INPUT — drag orbits the iso view / turns the head in FPS; wheel zooms iso; keys dive + look. */
let dragging = false, lastX = 0, lastY = 0;
renderer.domElement.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; });
window.addEventListener('pointerup', () => { dragging = false; });
window.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY; lastX = e.clientX; lastY = e.clientY;
  if (dive.mode === 'b') seated.addDrag(dx, dy);          // FPS: turn your head
  else if (dive.mode === 'a') rig.orbit(-dx * 0.005, 0);  // ISO: orbit heading (dimetric locks pitch)
});
renderer.domElement.addEventListener('wheel', (e) => {
  if (dive.mode === 'a') rig.zoomBy(1 + Math.sign(e.deltaY) * 0.08);
  e.preventDefault();
}, { passive: false });
renderer.domElement.addEventListener('click', () => { if (dive.mode === 'a') diveIn(); });

const lookKeys = { left: false, right: false, up: false, down: false };
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === ' ' || k === 'enter' || k === 'f') { e.preventDefault(); toggleDive(); }
  else if (k === 'l') applyLighting(lighting === LIGHTING.mood ? 'fullbright' : 'mood');   // playtest work-light toggle
  else if (k === 'escape' || k === 'q') surface();
  else if (k === 'a' || k === 'arrowleft') lookKeys.left = true;
  else if (k === 'd' || k === 'arrowright') lookKeys.right = true;
  else if (k === 'w' || k === 'arrowup') lookKeys.up = true;
  else if (k === 's' || k === 'arrowdown') lookKeys.down = true;
});
window.addEventListener('keyup', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'a' || k === 'arrowleft') lookKeys.left = false;
  else if (k === 'd' || k === 'arrowright') lookKeys.right = false;
  else if (k === 'w' || k === 'arrowup') lookKeys.up = false;
  else if (k === 's' || k === 'arrowdown') lookKeys.down = false;
});

/* ------------------------------------------------------------
   10) HUD — one hint line that swaps by mode (matches the survivor page's .hint treatment). */
const hud = document.querySelector('.hint');
function setHud() {
  if (!hud) return;
  hud.innerHTML = (dive.mode === 'b' || dive.mode === 'in')
    ? 'INSIDE THE HOARD · drag / WASD to look around · ESC to surface'
    : 'THE HOARD · drag to orbit · scroll to zoom · CLICK / SPACE to dive in';
}
setHud();

/* ------------------------------------------------------------
   11) THE FRAME LOOP — the app owns rAF; the core lends frameStart/frameEnd (profiler + governor) and
   the present machinery. Present order mirrors the city dive: straight-to-screen when settled, two
   captures + a crossfade while diving. */
/* ONE frame of work — extracted so it can be driven by rAF (real time) OR stepped synchronously by the
   harness (`window.__cavern.step(dt)`), which matters when a hidden/automation tab suspends rAF. */
function frame(dt) {
  core.frameStart();

  sunRig.update(dt);                                      // eases to night then holds (auto off) → grade/bloom mood
  if (lighting.torch) for (const t of torches) { const iv = t.update(dt); t.flame.scale.setScalar(0.8 + 0.5 * (iv / t.base)); }   // flame pulses (mood only)
  shadowRig.update();
  if (assemblyPlaying) buildIn.update(dt);
  rig.update(dt);
  placeFpsCam(dt);
  seated.addKeys(dt, lookKeys);
  dive.update(dt);   // advances the ease AND presents: settled view → screen, or the crossfade while diving

  core.frameEnd();
  if (!window.__loaded) { window.__loaded = true; document.getElementById('lgr-loader')?.classList.add('gone'); }
  window.__cavern.mode = dive.mode;
}
window.__cavern.step = (dt = 1 / 60) => frame(Math.min(dt, 0.05));   // harness drive (rAF-independent)

const clock = new THREE.Clock();
function tick() {
  if (core.paused || core.contextLost) { requestAnimationFrame(tick); return; }
  frame(Math.min(clock.getDelta(), 0.05));
  requestAnimationFrame(tick);
}

/* pause the loop when the tab is hidden (battery + the profiler's honesty). */
document.addEventListener('visibilitychange', () => core.setActive(!document.hidden));
if (!CAPTURE) requestAnimationFrame(tick);   // capture mode: step() is the sole clock (deterministic)
window.__cavernReady = true;                 // capture harness readiness flag
