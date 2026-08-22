/* ============================================================
   WORLD LAB — projects/world-lab/main.js  (ARC A-MARRIAGE 2026-08-19 · ARC A-PATCHWORK 2026-08-20)
   ------------------------------------------------------------
   A-PATCHWORK (the second convergence keystone) turns the marriage room into ONE world made of
   REGIONS: a city district, open woods, a desert, a lake district and the surrounding sea with its
   islets — all on the SAME married heightfield, all traversable by the same three verbs through the
   SAME world bag. What A-MARRIAGE proved about the city is unchanged and re-counted inside the
   composed world; what is new is that the city is now a DISTRICT inside a legible landscape instead
   of the whole map.
     · the region field   → `generateRegions` (engine-core/src/regions.js) — a capacity-constrained
                            priority flood: contiguous by construction, coverage exact by counting.
     · the shaping        → `shapeRegionTerrain` — dunes in the desert, bowls in the lake district,
                            every offset faded to ZERO at its own seam (so the seams are provable).
     · the water          → `detectLakes` (L68, first consumer outside createCityWorld) filtered to
                            the lake district, plus the sea this room lacked (A-MARRIAGE honest gap
                            #2, closed). A-SKYWORLD swapped what DRAWS both — `createWaterSurface`,
                            the engine's own water — while leaving the detection data untouched.
     · the woods          → `generateScatter` with the new region DENSITY MASK, planted with
                            `createTreeKit` (A-TREEKIT's conifer kit) — the placer is unchanged.
   NOTHING here is a capability: this file wires, configures, and shows numbers.
   `?world=104&grid=336&regions=off` reproduces the A-MARRIAGE config family exactly, which is how
   the flat-in identity and the pre-patchwork receipts stay reachable rather than remembered.

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
     · A-DRIVE, the ROSTER    → `createRoadModel` (the cars) · `createSpacecraftModel` (the
                                helicopter and the spaceship) · `createBirdModel` (the aeroplane —
                                the bird IS fixed-wing physics) · `createVehicleGlbMesh` (every
                                modelled body, articulated rotors and all). SEVEN craft, ZERO new
                                integrators: §4 is a data table, not a physics file.
   What is here is WIRING, a key map, some DOM, and the dials that make it a lab.
   C++ anchor: this file is `main()` — construct subsystems, own the frame loop, implement nothing.

   MUTATE THE ONE FIELD, ON STAGE: every rebuild runs generate → build WILD mesh → carve → refresh
   ONLY the dirty chunks (`rebuildTerrainChunks`). The carve being visible at all proves the
   dirty-chunk seam works — the ratified route's own mechanism, exercised on every boot rather than
   trusted from a comment.
   ============================================================ */
import {
  THREE, createEngineCore, CAM,
  generateTerrain, buildTerrainMesh, rebuildTerrainChunks, createTerrainSampler, BIOMES,
  carveCityPads, dirtyMeshesFor,
  generateRegions, shapeRegionTerrain, regionAt,
  generateScatter, buildScatterGroup, createTreeKit,
  detectLakes,
  createBoxArena, percentileOf,
  createCharacterController, createGrappleModel, GRAPPLE_PROFILE,
  resolveAimPoint, createAimReticle, createPointerLockAim,
  createTargetLock, createLockMarker, cameraNearRadius,
  createHeroBody,
  createBikeModel, BIKE_PROFILE, createBikeMesh, createMotoChaseCam,
  createRoadModel, ROAD_PROFILE, createSpacecraftModel, HELI_PROFILE,
  createBirdModel, PLANE_PROFILE, CRAFT_PROFILE, scaleProfileSpeeds,
  createVehicleGlbMesh, NO_WATER,
  /* ARC A-SKYWORLD — the overhead and the waterline. Every one of these already EXISTED in
     engine-core and this room had simply never asked for them (the wiring-drift failure CLAUDE.md
     names by name). Nothing below is new capability; §1b/§2c are wiring and configuration. */
  createHillaireSky, createVolumetricClouds, CLOUD_TIERS, createWaterSurface, lowSunWashK,
} from '@lgr/engine-core';
import survivorUrl from '@lgr/engine-core/assets/models/survivor.glb?url';
import treeKitUrl from '@lgr/engine-core/assets/models/tree_kit.glb?url';   // A-TREEKIT's conifer kit — the woods
/* A-DRIVE: the roster's bodies. Six GLBs from ONE generator (tools/blender/build_vehicles.py) —
   the three road vehicles had been shipped and imported by NOTHING since 2026-08-06; these are
   their first consumers. The `?url` import lives HERE and not in the engine because a ?url inside
   the lib base64-inlines the asset into every bundle (the pedestrians.js rule). */
import sedanUrl from '@lgr/engine-core/assets/models/veh_sedan.glb?url';
import vanUrl from '@lgr/engine-core/assets/models/veh_box_van.glb?url';
import truckUrl from '@lgr/engine-core/assets/models/veh_fire_truck.glb?url';
import heliUrl from '@lgr/engine-core/assets/models/veh_heli.glb?url';
import planeUrl from '@lgr/engine-core/assets/models/veh_plane.glb?url';
import shuttleUrl from '@lgr/engine-core/assets/models/veh_shuttle.glb?url';

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
const fill = new THREE.HemisphereLight('#a9bedd', '#4a4438', 1.25);
scene.add(fill);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/* A-SKYWORLD — NO TONEMAP, AND THAT IS A DECISION I REVERSED ONCE, so it is written down rather
   than left as an absence. `skyrender.frag` emits `lum * uExposure` RAW and its own comment says the
   exposure exists "to lift the physical radiance into the shared ACES tonemap's range" — i.e. the
   sky EXPECTS a downstream tonemap, which in the city is the filmic post pass. I therefore reached
   for `renderer.toneMapping = ACESFilmic` first, and MEASURED that it does not work here: three.js
   injects the tonemapping chunk into its own materials, and the Hillaire sky is a raw ShaderMaterial
   that never includes it — so ACES tonemapped the terrain and the towers while leaving the sky
   untouched, i.e. it produced TWO tone spaces in one frame and did not fix the blown horizon at all.
   The horizon band is cured by the sky's OWN exposure instead (below), which is the dial that
   actually governs it. Keeping NoToneMapping also keeps this arc scope-precise: the room's terrain
   is its subject and it is lit exactly as it was before. */

/* ---------------------------------------------------------------------------------------------
   1b. THE SKY, THE SUN AND THE OVERHEAD (ARC A-SKYWORLD, 2026-08-21).
   ---------------------------------------------------------------------------------------------
   The owner's ask was for the Live Sky app's overhead — a real sun, a real sky, real clouds — in
   this room. The honest answer, found by reading rather than assuming, is that ENGINE-CORE ALREADY
   OWNED EVERY PIECE and world-lab had never wired ONE of them:
     · the sky      → `createHillaireSky` — Hillaire's 2020 production-ready atmospheric scattering,
                      the same model the Live Sky app runs. Not a gradient: it MARCHES the real
                      Rayleigh (air molecules, ∝1/λ⁴ — why the sky is blue and sunsets are red) and
                      Mie (aerosols, wavelength-flat — why the horizon whitens) terms through a
                      spherical atmosphere, precomputing transmittance + multiple-scattering into
                      LUTs once and re-marching only the cheap sky-view LUT per frame.
     · the sun      → `core.sunRig`, which `createEngineCore` HAS ALREADY BUILT for us (see its
                      §2b — "MOVED to core"). This room simply never read it. Constructing a second
                      SunRig here would be the canonical day/night mistake CLAUDE.md forbids: one
                      scalar `t`, one keyframe set, one source of truth for what time it is.
     · the clouds   → `createVolumetricClouds` (§8b) — a real raymarched Perlin-Worley slab.
   C++ anchor: `sunRig` hands out Colors and Vector3s BY REFERENCE and mutates them in place —
   think `const vec3&` returned from a getter, bound once and re-read, never reassigned. That is
   also why nothing below ever writes `key.color = …`; it copies INTO the existing colour.

   THE HILLAIRE MESH IS A SCENE OBJECT, NOT A POST PASS: a fullscreen quad at renderOrder -100 with
   depth-test off, so it paints behind everything and costs one draw. That is what lets this room
   keep its "no post chain" testbed rule (§1) for the SKY — only the clouds need a composite.
   `sunDisc: true` because, unlike the city, this room has no `createCelestials` sprite — so the
   atmosphere shader itself draws the disc and there is still exactly ONE sun in the frame. */
const sky = createHillaireSky({ renderer, sunDisc: true });
sky.computeStaticLUTs();                      // ONCE — the transmittance + multi-scatter LUTs are static
scene.add(sky.skyMesh);
/* EXPOSURE IS A CALIBRATION, AND IT IS MEASURED, NOT COPIED. The module's default is 18 and the
   CITY sets 220 — and NEITHER is transferable, because this number means "how many times brighter
   than 1.0 a lit sky pixel comes out BEFORE whatever chain follows it", and the chain that follows
   it here is nothing at all. Swept on the real page at this room's own late-afternoon t: 16 clipped
   the horizon to a flat white stripe, 6 holds the full gradient from a deep zenith to a pale
   horizon with nothing pinned at 1.0. `?skyexp=` keeps the number arguable rather than settled. */
sky.setExposure(qNum('skyexp', 6));
/* THE EYE, IN MEGAMETRES. The atmosphere model works in Mm from the planet centre (GROUND_MM =
   6.360), so the sky needs to know how high the viewer stands — 0.0002 Mm = 200 m, the same figure
   the city uses. HOISTED, because §7 of docs/engine-invariants.md forbids per-frame allocation:
   this is written into every frame and must never be a fresh Vector3. */
const _skyEye = new THREE.Vector3(0, 6.360 + 0.0002, 0);

/* THE DAY, AND WHY IT DOES NOT MOVE UNLESS YOU ASK. `t` ∈ [0,1) is SunRig's one scalar: 0 night,
   0.25 dawn, 0.5 noon, 0.75 dusk. The default 0.62 is LATE AFTERNOON — chosen to preserve exactly
   what §1's original comment said this room wanted ("the key is warm and low-ish… so the city has
   something to be a silhouette against"), so the arc changes how the light is COMPUTED without
   changing what the room is lit LIKE.
   AUTO IS OFF BY DEFAULT AND THAT IS A CORRECTNESS DECISION, not a taste one: a room that drifts
   through the day is a room whose captures, whose probe phases and whose two-boot receipts all read
   a different frame every run. `?daycycle=1` opts in; `?t=` scrubs to a fixed time.

   THE NIGHT HALF IS NOT FINISHED, AND IT IS SAID HERE RATHER THAN DISCOVERED. The sun is above the
   horizon for t ∈ (0.25, 0.75) and this room is correct across all of it — verified by capture at
   dawn, noon, the shipped 0.62 and a genuinely good sunset at 0.71. BELOW the horizon the Hillaire
   atmosphere has almost nothing left to scatter and returns near-black, so at t = 0.78 the sky goes
   flat black while the water — which has its own ambient floor — stays PALE, i.e. brighter than the
   sky above it. That is an inversion, not a dark scene, and it is a real defect.
   It is a defect with a known cure that is NOT this arc: engine-core already owns `night-sky.js`,
   `createCelestial` and `createTrueStars`, and wiring them is the same "the ability exists, this
   room never asked" move the rest of this section is made of. Recorded as an OPEN rather than
   half-attempted. Until then the daylight arc is the supported range and the default sits inside it. */
const sun = core.sunRig;
sun.goTo(qNum('t', 0.62), true);              // snap — no easing on boot, so frame 1 is already right
if (Q.get('daycycle') === '1') { sun.setAuto(true); sun.setPace(qNum('pace', 90)); }
/* the KEY LIGHT'S OFFSET, derived from the sun instead of hard-coded. The magnitude is held at ~20 u
   because the shadow camera above is a ±30 u box with far 80 — a light placed further out than that
   drops the world out of its own shadow frustum. The y floor keeps the key above the ground even at
   dusk (SunRig already flips `sunDir` to the MOON below the horizon, so y is never negative — the
   floor is belt-and-braces against a grazing sun, not a second opinion about night). */
const SUN_OFF = { x: 9, y: 16, z: 7 };
const _fogC = new THREE.Color();
let _lastSunT = -1;                           // forces the first sky-view march (see §8b's dirty check)

/* ---------------------------------------------------------------------------------------------
   1c. THE VOLUMETRIC CLOUDS — a real raymarched deck, not sprites.
   ---------------------------------------------------------------------------------------------
   `createVolumetricClouds` marches a Perlin-Worley volume through a slab and shades it with a dual
   Henyey-Greenstein phase (forward silver lining + soft back glow). It is a POST PASS: it reads the
   rendered frame as a texture and composites cloud over it, so unlike the sky it cannot simply be a
   mesh in the scene.
   AND THAT WOULD HAVE BEEN THIS ROOM'S ONE ARCHITECTURAL PROBLEM — §1's "no post chain (the testbed
   rule)" — except that it isn't one, because `createEngineCore` HAS ALREADY ALLOCATED the buffers:
   `core.sceneRT` (with `core.sceneDepth` attached as its depth texture) is built for every non-lean
   consumer and this room has simply never rendered into it. So the composite below costs ZERO new
   render targets, and `core.resize()` already resizes both. It is also the SAME hand-rolled
   render-into-an-RT-then-composite shape `createCityWorld` uses — the dominant pattern in this
   repo — rather than an EffectComposer, which no project here uses.
   C++ anchor: `pass.render(renderer, dst, src)` is a kernel over a framebuffer — src texture in,
   dst framebuffer out; `renderToScreen` just means dst = the default framebuffer.

   THE DEPTH GATE IS WHY CLOUDS DO NOT PAINT OVER THE CITY. `setSceneDepth` binds the depth buffer
   and the shader skips cloud on any fragment whose depth is in front of the far plane.

   ---- THE ONE REAL DEFECT THIS ARC SHIPS, MEASURED RATHER THAN GLOSSED ----
   That gate is, in clouds.frag's own words, "a one-liner rather than a distance comparison": it
   tests `depth < 0.9999`. Whether that means "there is geometry here" depends ENTIRELY on the
   camera's depth range, and this room's is extreme — near 0.02, far 420, a ratio of 21,000:1,
   because the hero is only 0.30 u tall. Window depth for a surface at distance d is
   (f/(f−n))·(1 − n/d), so `0.9999` is reached at d ≈ 135 u. BEYOND ABOUT 135 UNITS, GEOMETRY READS
   AS SKY TO THIS GATE AND CLOUD IS PAINTED OVER IT.
   CONFIRMED, not deduced: a camera at 25 u looking straight DOWN at the city (rays ~25 u) shows no
   cloud wash at all, while the same camera looking out at the far sea shows a crisp line across the
   water with clean sea in front of it and speckled cloud wash beyond
   (docs/captures/world-lab/a-skyworld/ discussion; scratch A/B this arc).
   WHO SEES IT: long views — flying, or looking across the world at the far rim. On foot, everything
   inside 135 u is correct, which is most of what a walker's frame contains.
   THE TWO FIXES ARE BOTH OUT OF THIS ARC ON PURPOSE, and that is a STOP rather than a shrug:
     · raise `rig.camera.near` (0.05 would push the threshold past 300 u) — but `camEyeClear` above
       is derived from `cameraNearRadius({ near: 0.02, … })`, so near and the walker's camera
       clearance move TOGETHER or first-person starts clipping. That is verb/camera wiring, owned
       elsewhere right now.
     · give clouds.frag the real ray-distance compare its own comment asks for — but that shader is
       shared with the CITY, which is the tier-guard subject, so changing it is a STOP-and-report.
   Recorded as an OPEN. `?clouds=0` turns the whole pass off if a long view matters more. */
const CLOUDS_ON = Q.get('clouds') !== '0';
/* THE STEP TIER IS A DIAL BECAUSE IT IS THE DEFECT KNOB, not because more is nicer. The march
   jitters its start by a full `fineStep` to hide banding (clouds.frag), and `fineStep` is itself
   interpolated from the step budget — 4.55 u at HIGH's 32 steps, 2.2 u at CAPTURE's 64. That jitter
   IS the speckle you see on thin cloud edges, so halving the step halves the noise. Swept on the
   real page in this room and reported as a measured trade rather than chosen by taste. */
const CLOUD_TIER = String(Q.get('cloudtier') || 'CAPTURE').toUpperCase();
if (!CLOUD_TIERS[CLOUD_TIER]) console.warn(`[world-lab] unknown ?cloudtier=${CLOUD_TIER} — the pass will fall back to HIGH`);
/* THE BUNDLE COST IS REAL, IS ABOUT +41 KB GZIP, AND IS BOOKED RATHER THAN ENGINEERED AWAY — with
   the attempt written down so nobody repeats it. Adding this pass to the module graph grows the
   page's eager `three` chunk from 155.95 KB to 197.45 KB (vite's own reported gzip), which failed
   `tools/size-budget.test.mjs` ("world-lab money-path entry JS"). ISOLATED, not assumed: replacing
   only this one import with a rejected promise and rebuilding puts the chunk back to 155.95 KB.
   TWO INSTRUMENTS, AND THEY DISAGREE — worth knowing before anyone chases a discrepancy that is not
   one. Vite reports 197.45 KB for that chunk; the budget test measures `gzipSync(..., level 9)` and
   gets 194,421 bytes for the same file. Different compression settings and different KB conventions,
   not a moving target. The budget row is written in the TEST's units; this note is in vite's,
   because those are the numbers you see when you run the build.
   I TRIED THE OBVIOUS FIX FIRST AND IT DID NOT WORK. `createCityWorld` dynamically imports this same
   module "so a non-opted consumer downloads nothing", so I did the same (adding a deep entry to
   engine-core's `exports` map) and ALSO narrowed this project's rolldown `three` group to let the
   postprocessing files fall into the lazy chunk. Measured: the cloud module split out cleanly at
   5.7 KB gz, but the eager total did not move (278.2 KB dynamic vs 277.3 KB static) — excluding the
   addons merely moved GLTFLoader from the `three` chunk into the entry chunk, byte for byte.
   AND MY DIAGNOSIS WAS WRONG, which is worth recording: I assumed the weight was ShaderPass, but its
   source imports only { ShaderMaterial, UniformsUtils } and Pass.js only { BufferGeometry,
   Float32BufferAttribute, OrthographicCamera, Mesh } — all already in this page. So the 41 KB is
   NOT the addon's own code. UNATTRIBUTED, and said plainly rather than guessed at: the likeliest
   remaining explanation is that the addons' bare `three` specifier resolves to a second entry point
   and defeats some of rolldown's tree-shaking, but I did not prove that and am not claiming it.
   So the arc reverts to the SIMPLE static import — the dynamic one bought nothing here, and
   createCityWorld's stated reason for it ("a non-opted consumer") does not apply to a room where
   clouds are ON by default — and the budget is re-baselined with this measurement attached. */
const clouds = CLOUDS_ON
  /* COVERAGE 0.30, and the number is a fix rather than a preference. At the module default 0.5 (and
     at my first 0.42) the horizon showed a hard WHITE STRIPE: a ray at grazing elevation marches
     clouds.frag's full 240-unit window through the deck, so transmittance goes to ~0 and the
     scattering integral saturates — a dense deck seen edge-on IS white. The city never sees it
     because it looks DOWN from an aerial framing; a room you stand up in looks straight at it.
     Thinning the deck lets the far bank stay a bank instead of a wall. A/B'd on the real page. */
  ? createVolumetricClouds({ noiseN: 32, seed: 1337, coverage: qNum('coverage', 0.30) })
  : null;
if (clouds) {
  clouds.setSceneDepth(core.sceneDepth);
  clouds.pass.renderToScreen = true;          // the composite IS the final present in this room
}

/* ---------------------------------------------------------------------------------------------
   2. THE WORLD — terrain, carve, city. Every dial is a URL param first, a slider second, so a bug
   report is a URL and the probe drives the identical world a human sees.
   The NUMBERS mirror the node proofs (carve-pads.test.mjs / world-marriage.test.mjs) — one config
   family, so what the suite counts is what this page stands on.
   --------------------------------------------------------------------------------------------- */
const WP = {
  seed: qNum('seed', 12),
  preset: Q.get('preset') === 'mountains' ? 'mountains' : 'valley',
  /* A-PATCHWORK GREW THE WORLD, 104 u → 128 u, and the grid with it, 336 → 380. The reason is
     LEGIBILITY, and it is arithmetic rather than taste: the carve's rim rect is 61 u across at cols
     13, which is 34% of a 104 u world's AREA and only 23% of a 128 u one — so at 104 the city WAS
     the map and the other four districts were trim. The grid had to follow because the pad apron is
     a stated constraint, not a preference: A-MARRIAGE's worst tower base edge (1.34 u) plus ONE
     terrain texel must fit inside the pad plateau's half-side (1.7 u at streetW 1.2), which caps
     the cell at 0.36 u. 128/379 = 0.3377 → 1.34 + 0.338 = 1.678 ≤ 1.7, so the pad-flatness proof
     still passes for the same reason it passed before. The cost is counted and reported as a trade,
     not hidden; `?world=104&grid=336` reproduces A-MARRIAGE's exact config family.
     SEED 12 is chosen by COUNT, not by eye: it is the only seed of 30 that lands starved 0, three
     lake basins, 318 islet texels above sea, and a seam grade of 0.1733 against the 0.25 dial. */
  size: qNum('grid', 380),
  worldSize: qNum('world', 128),
  maxGrade: qNum('grade', 0.25),
  streetW: qNum('street', 1.2),
  /* the COVERAGE DIAL the arc exists to make honest: ask for X% woods, count X% off the finished
     field. Woods and desert share one budget so the plan always sums to 1 (a partition cannot have
     a spare percent lying around) — dragging the slider trades trees for sand, live. */
  woods: qNum('woods', 0.26),
  regions: Q.get('regions') !== 'off',
};
const AR = { cols: qNum('cols', 13), rows: qNum('cols', 13), spacing: qNum('spacing', 4.6) };

/* ---------------------------------------------------------------------------------------------
   2b. THE DISTRICTS. Wants sum to 1 by construction (woods + desert share 0.41). The seed POSITIONS
   were swept, not guessed: six layouts × six terrain seeds, scored on `starved` (a district enclosed
   before it reaches quota) and on the largest-connected-component fraction. This layout is the one
   that reads 0 starved and 100.00% LCC across the sweep.
   The city is a 'rect' district: the carve's own rim rect is PRE-OWNED, so "the city region IS
   carveCityPads" is true by construction and not by luck — and the region field's exchange pass is
   forbidden from taking those texels back (they are the carve's footprint, not spare capacity).
   The sea is a 'rim' district: it is not a blob, it is the OUTSIDE, so it grows inward from the
   border as a ring. Its height offset is exactly 0 — the wild field's own radial falloff already
   sinks the rim, and whatever the falloff leaves above sea level is an ISLET, counted not claimed.
   --------------------------------------------------------------------------------------------- */
const REGION_KEYS = ['sea', 'city', 'woods', 'desert', 'lakes'];
const cityRimOf = () => ((AR.cols - 1) / 2) * AR.spacing + (AR.spacing - WP.streetW) / 2 + WP.streetW;
/* ---- A-LAUNCH: THE SEEDS MUST OUTRUN THE CITY, and until now they could not. -------------------
   The three district seeds below were SWEPT, not guessed, and every one of them sits at
   max(|x|,|z|) = 34 u. The city is a 'rect' district whose half-width is `cityRimOf()` — 30.5 u at
   the shipped cols 13 / spacing 4.6, comfortably inside 34. But that rim is a FUNCTION OF THE DIALS,
   and once it passes 34 the rect PRE-OWNS all three seed texels, so all three districts start
   already-enclosed and flood nothing: woods 0%, desert 0%, lakes 0%.
   THIS IS A DEFECT THAT SHIPPED, and the shipped `city cols` slider reaches it: measured on the
   pre-arc build, `?cols=15` (rim 35.1) and `?cols=17` (rim 39.7) both report starved 3 and a world
   that is nothing but city and sea. It is arithmetic, not chance — 7.5·4.6 + 1.7 + 1.2 = 35.1 > 34.
   THE FIX IS ONE SCALE FACTOR ON ALL THREE SEEDS, so the swept layout's SHAPE is preserved exactly
   (pushing x and z independently would distort the relative geometry the sweep actually scored) and
   the seeds simply stand off the rect by `SEED_PAD` once it grows past them.
   IT IS A NO-OP AT THE SHIPPED CONFIG BY CONSTRUCTION, which is the property that lets it land in an
   arc whose first rule is "defaults must not move": (30.5 + 3.0)/34 = 0.985, and the Math.max floors
   it at 1. Verified as an identical terrain checksum, not assumed.
   HONEST LIMIT, because a guard's green only covers what it can see: this fixes seeds the rect has
   SWALLOWED, not a plan that is over-subscribed by AREA. At cols 17 the city rect alone is 38.5% of
   the world and the sea another 22%, leaving 39.5% for wants summing to 53% — no seed position can
   satisfy that, and the HUD's `starved`/coverage rows are the honest readout of it. Making the plan's
   wants adapt to the city's real footprint is a change to A-PATCHWORK's swept layout, out of this
   arc's scope, and it is written up in HANDOFF as an OPEN. ---- */
const SEED_REACH = 34;      // max(|x|,|z|) of the three swept seed positions below
const SEED_PAD = 3.0;       // u — how far outside the city rect a seed must stand to survive it
/* ---- A-KEEP: THE CITY'S WANT IS NOW MEASURED, NOT DECLARED (ledger OPEN #35, closed-in-part). ----
   `city.want` was the constant 0.25 while the rect it describes GROWS with the `cols` and `spacing`
   dials. Past roughly a third of the world the declared want and the real footprint part company, and
   the four other districts are then asked to fill a remainder that no longer exists — so the flood
   reports `starved`, and, worse and much quieter, the COVERAGE DIAL STOPS MEANING WHAT IT SAYS. That
   second half is the real damage and it starts INSIDE the range the room already calls safe: at
   `?cols=15` today the worst non-city district misses its asked share by 4.96 pp while `starved` is
   still 0 and the HUD is still green. A dial that is 5 points wrong with a green light beside it is
   the exact failure A-PATCHWORK exists to prevent.
   THE FIX IS ONE MEASUREMENT AND ONE RESCALE: ask the rect how much of the world it actually covers
   (clipped to the world, because a big enough dial pushes it past the border) and give the other four
   whatever is left, in their existing ratios. `Math.max(CITY_WANT, …)` is the whole reason this can
   ship inside an arc whose first rule is "defaults must not move" — the same shape as A-LAUNCH's
   `Math.max(1, …)` seed push. At the shipped cols 13 the rect measures 22.71%, BELOW the declared
   0.25, so the floor holds, `k` is exactly 1, and the returned plan is not merely equivalent but
   JSON-IDENTICAL to the old one. Verified as identical FIELDS across all 30 terrain seeds (0 of 30
   moved), not reasoned about — A-PATCHWORK's swept layout is untouched.
   MEASURED, over a 99-configuration grid (cols 5–25 × nine spacings):
     · drift: better on 62, WORSE ON NONE — the coverage dial never becomes less honest
     · `starved`: better on 6, unchanged on 89, WORSE ON 4 (cols 11/sp 6.6 · 13/5.8 · 19/4.0 · 21/3.4)
     · the case OPEN #35 names, `?cols=17`, across 30 terrain seeds: starves on 25 of 30 seeds today
       and on 0 of 30 after, with worst drift 9.310 pp → 0.091 pp
   THE FOUR WORSE CELLS ARE A REAL TRADE AND ARE NOT SWEPT UNDER, and they were counted rather than
   characterised: in all four it is `lakes`, short of an HONEST target by 0.251–0.257 pp, where before
   it met a DISHONEST one and the non-city drift sat at 5.88–8.02 pp. `starved` flips 0→1 and the HUD
   goes red. I judge a small true shortfall better than a large false success —
   the room's own doctrine is "reporting honestly rather than a range that hides the boundary" — but
   it is a judgement, it is the owner's to overturn, and it is why OPEN #35 is only closed IN PART:
   at `cols ≥ 18` the lakes district still cannot reach even its honest share. See the ledger.
   ONE SEMANTIC CHANGE, STATED PLAINLY, because it is the price of the rescale: once the city outgrows
   its declared 0.25, the `woods` slider reads as "26% of what is NOT city" rather than "26% of the
   world" — at `?cols=17` asking 26% now yields 21.24% of the world (26% of the 81.7% that is left) and
   the HUD says exactly that. It is not a smaller promise, it is the only promise the world can keep:
   the same ask under the old plan produced 16.69%, a 9.31 pp shortfall reported as a green dial. Below
   the threshold `k` is 1 and the two readings are the same number. */
const CITY_WANT = 0.25;     // the DECLARED floor — the swept layout's own number, never gone below
const REST_WANT = 0.75;     // what the other four sum to today; they keep their ratios inside 1 − city
function cityAreaFrac(rim) {
  /* A WORLD WITH NO AREA HAS NO FRACTION, and the guard is here because I introduced the hole and
     then went looking for it: `?world=0` makes this a 0/0, `Math.max(0.25, NaN)` is NaN, and a NaN
     want propagates into `wantSum` and out through `Math.floor` into an Int32Array, where it lands as
     a silent 0 target for every district. Nonsense with no error attached is the one outcome this
     repo will not ship. Returning 0 degrades the plan to EXACTLY the pre-change constants — which is
     what the old code did at that dial anyway — so a degenerate world is no worse than it was. */
  if (!(WP.worldSize > 0)) return 0;
  const H = WP.worldSize / 2;                       // the rect is clipped to the world before measuring
  const w = Math.max(0, Math.min(rim, H) - Math.max(-rim, -H));
  return (w * w) / (WP.worldSize * WP.worldSize);
}
function regionPlan() {
  const rim = cityRimOf();
  const woods = Math.max(0.05, Math.min(0.36, WP.woods));
  const push = Math.max(1, (rim + SEED_PAD) / SEED_REACH);
  const at = (x, z) => ({ x: x * push, z: z * push });
  const city = Math.max(CITY_WANT, cityAreaFrac(rim));
  const k = (1 - city) / REST_WANT;                 // exactly 1 at the shipped config, by construction
  return [
    { key: 'sea', want: 0.22 * k, mode: 'rim' },
    { key: 'city', want: city, mode: 'rect', rect: { x0: -rim, z0: -rim, x1: rim, z1: rim } },
    { key: 'woods', want: woods * k, mode: 'seed', at: at(-34, 30) },
    { key: 'desert', want: (0.41 - woods) * k, mode: 'seed', at: at(34, -32) },
    { key: 'lakes', want: 0.12 * k, mode: 'seed', at: at(30, 34) },
  ];
}
/* the SHAPING dials. seamBlend 8 u is budgeted off the module's own bound
   |∇(offset·w)| ≤ |∇offset| + max|offset|·1.5/seamBlend: at the dune amplitude 0.45 u that second
   term is 0.084, leaving the dial's remaining 0.166 for the dune's own slope (0.45·π/12 ≈ 0.118) and
   the bowls' (0.72·1.5/5.3 ≈ 0.204 at full depth, less when the ground is shallower). Counted on the
   finished field every build and shown on the HUD — the derivation is the design, the count is the gate. */
const SHAPE = () => ({
  seamBlend: 8, seed: WP.seed,
  desert: { key: 'desert', amp: 0.45, len: 12, angle: 0.6, sharp: 1.6, warp: 0.25 },
  /* THE LAKE BOWLS ARE SIZED BY THE DIAL, and the arithmetic is the whole story of how they got
     here. A bowl's steepest wall is depth·1.5/(rimR−flatR), so the dial caps depth at
     0.25·3.4/1.5 = 0.567 u; and `detectLakes` fills only 0.045 normalised above a local minimum
     (0.3375 u at this preset's relief), so a bowl shallower than that holds nothing. Depth 0.55
     sits in that narrow window on purpose. Big deep basins were tried first and are NOT available:
     at rimR 8.5 the dial forces them so shallow their pools drain, and at rimR 5–6 with a real
     depth the wall itself reads 0.30–0.36, over the dial. Five small tarns beat one illegal lake. */
  lakes: { key: 'lakes', bowls: 5, depth: 0.55, flatR: 2.1, rimR: 5.5 },
});
/* how thickly each district is dressed — the mask `generateScatter` multiplies its densities by.
   The city is 0 because it is paved; the desert is 1 because ITS table is already an order sparser
   than grassland's; the sea is a small number so an islet can carry a couple of trees. */
const SCATTER_BY_REGION = { sea: 0.30, city: 0, woods: 1.0, desert: 1.0, lakes: 0.55 };
const BIOME_KEYS = BIOMES.map((b) => b.key);
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
let REG = null, SHAPED = null;                   // the region field + its shaping report
/* `seaMesh` used to live here and was dropped when A-SKYWORLD replaced the flat transparent plane
   with `createWaterSurface`; the declaration outlived its six uses. Removed 2026-08-21 after that
   arc's refutation found it — worth noting that `.oxlintrc.json` disables `no-unused-vars`, so the
   lint gate structurally cannot catch this class and a human read is the only thing that will. */
let scatterGroup = null, treeGroup = null, lakeGroup = null;
let LAKES = [], TREE_N = 0;

/* ONE WATER FACTORY for the sea and every lake (A-SKYWORLD keeps this room's own reuse anchor and
   only changes WHAT is being reused): the sea is not a different substance from a lake, it is the
   same surface at a different extent — so both are now `createWaterSurface`, the engine's own water,
   rather than one flat `MeshStandardMaterial` plane standing in for both. That factory's docstring
   names this exact pair as its purpose ("same geometry, different extent") and it costs no new
   capability: `kind:'ocean'` adds a Gerstner swell and a tessellated ring-disc, `kind:'lake'` is the
   flat analytic disc. Every surface is driven from the SAME sunRig every frame (§8b), which is the
   whole reason water now reads as water: a Fresnel sky-tint and a sun glint that both know where
   the sun actually is. `detectLakes` — the DATA that says where the pools are — is untouched. */
/* THE SHORE RAMP DOES NOT APPLY TO AN OPEN SEA, and pretending otherwise is what made the first
   attempt read as a black plum plane. `createWaterSurface` ramps `deep`→`shallow` by DISTANCE FROM
   THE DISC'S OWN CENTRE (aShoreDepth = (1 − r/radius)^depthPower) — which is exactly right for a
   pond whose rim IS its shoreline, and meaningless for a 300 u sea disc whose rim is out in the fog
   and whose real shoreline is wherever the TERRAIN happens to rise through y = 0. Everything the
   player can see sits near the centre, so the whole visible sea takes the `deep` colour.
   So `deep` is set to the colour the sea should actually BE, and `shallow` only a little lighter to
   keep a touch of gradient toward the horizon. Naming a near-black as `deep` and expecting the ramp
   to rescue it is the mistake; the ramp never gets there. */
const WATER_LOOK = { shallow: 0x4d8ba6, deep: 0x24576f, sky: 0x9dbdd6 };
/* ONE swell scale, stated once. This world is 128 u across but VERTICALLY tiny — the hero is 0.30 u
   tall, so 1 u ≈ 5.7 m and the module's metre-ish defaults (wavelength 14, lodNear 22) would be
   kilometre swells here. Scaled to the room: ~3 u crests ≈ 17 m, amplitude 0.03 u ≈ 17 cm of heave.
   THE AMPLITUDE IS DELIBERATELY SMALL AND THIS IS THE REASON: `waterHeightAt` answers a FLAT y = 0
   for the sea (§4) and the probe's P8b proves the bag against that plane, so the visual surface may
   only ever breathe around y = 0 by an amount too small to make the query a lie. 0.03 u is ~1/10 of
   a person's height — visible as motion, invisible as a discrepancy. A big swell would need
   `waterHeightAt` to sample the same Gerstner sum, which is a real feature and NOT this arc. */
const SWELL = { waveAmp: 0.03, wavelength: 3.0, steepness: 0.55, waveSpeed: 0.8, lodNear: 30, lodFar: 160 };
let seaWater = null, lakeWaters = [];
/* the KIT is created ONCE (moto-lab's own rule): the GLB loads a single time and every rebuild
   re-instances the cached geometry. `?trees=proc` keeps the procedural cones as the control arm, and
   a load FAILURE rebuilds the room with them, loudly — degrade whole, the house convention. */
const treeKit = Q.get('trees') === 'proc' ? null : createTreeKit({ url: treeKitUrl });
if (treeKit) treeKit.ready.then((mode) => { if (mode !== 'kit') buildWorld(); });
/* the LIVE closures the arena reads — they always point at the CURRENT carve/sampler, so an
   arena.rebuild after a dial change re-lays towers on the new pads with no re-wiring. */
const groundYAt = (x, z, i, j) => CARVE.padYOf(i, j);
const heightAt = (x, z) => HEIGHT(x, z);

function buildWorld() {
  const t0 = performance.now();
  if (terrainGroup) { scene.remove(terrainGroup); terrainGroup.userData.dispose(); }
  for (const g of [scatterGroup, treeGroup, lakeGroup]) if (g) { scene.remove(g); g.userData.dispose(); }
  scatterGroup = treeGroup = lakeGroup = null;
  const WORLD_MAP = { worldSize: WP.worldSize, baseY: 0 };
  /* generate → REGIONS → SHAPE → WILD mesh → carve → dirty-chunk refresh. The ORDER is the
     architecture: regions and shaping mutate the ONE heightfield BEFORE the mesh is built, the carve
     mutates it AFTER and refreshes only its dirty chunks — so the room still exercises A-MARRIAGE's
     ratified dirty-chunk seam on stage at every build (a carve you can SEE is the receipt) while the
     districts are already under it. */
  T = generateTerrain({ seed: WP.seed, size: WP.size, preset: WP.preset });
  if (WP.regions) {
    REG = generateRegions({ size: WP.size, worldSize: WP.worldSize, seed: WP.seed, plan: regionPlan() });
    SHAPED = shapeRegionTerrain(T, WORLD_MAP, REG, SHAPE());
  } else { REG = null; SHAPED = null; }
  terrainGroup = buildTerrainMesh(T, { worldSize: WP.worldSize, baseY: 0, chunks: 6 });
  scene.add(terrainGroup);
  CARVE = carveCityPads(T, WORLD_MAP,
    { cols: AR.cols, rows: AR.rows, spacing: AR.spacing },
    { streetW: WP.streetW, maxGrade: WP.maxGrade, blend: 3.0 });
  rebuildTerrainChunks(terrainGroup, T, dirtyMeshesFor(terrainGroup, CARVE.touched), true);
  HEIGHT = createTerrainSampler(T, WORLD_MAP);
  if (WP.regions) buildWater(WORLD_MAP);
  if (WP.regions) buildDressing(WORLD_MAP);

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

/* ---------------------------------------------------------------------------------------------
   2c. THE WATER — the sea this room never had (A-MARRIAGE honest gap #2: "the rim jump lands on the
   sub-sea ocean biome — there is no water in the room; dirt all the way down"), and the lake
   district's pools through `detectLakes` (L68's FIRST consumer outside createCityWorld — the
   ability existed and only one room had ever asked it anything).
   A-SKYWORLD: both are now drawn by `createWaterSurface`, so they answer the sun.
   THE FILTER is the region field doing its job: detectLakes scans the whole heightfield and will
   happily call a wild hollow a lake, so we keep only the pools whose centre stands in the lake
   DISTRICT. That is consuming the orphan, not forking it — its basin maths is untouched.
   --------------------------------------------------------------------------------------------- */
function buildWater(WORLD_MAP) {
  if (!seaWater) {
    /* sea level is y = baseY = 0 by terrain.js's own mapping (wy(sea) = baseY) — UNCHANGED, and it
       has to be: `waterHeightAt` (§4) and the probe's P8b both stand on that exact plane.
       THE RADIUS IS THE FOG'S, NOT THE WORLD'S. The old plane was worldSize·1.6 (half-extent 102 u)
       and stopped well inside `scene.fog`'s far plane at 300 — which was invisible only because a
       flat matte plane and a flat clear-colour were the same nothing. With a real sky behind it that
       edge WOULD read as a seam on the horizon, so the disc now runs to the fog's own far plane and
       fades into it instead of ending in it. `raycast` stays a no-op: the aim ray must keep finding
       terrain and towers, never the sea. */
    seaWater = createWaterSurface({
      kind: 'ocean', at: [0, 0], radius: 300, y: 0, segments: 128, rings: 48,
      ...WATER_LOOK, ...SWELL, opacity: 0.92, glint: 1.0, glintDensity: 0.8, foam: 0.35,
    });
    seaWater.mesh.raycast = () => {};
    seaWater.mesh.receiveShadow = false; seaWater.mesh.castShadow = false;
    scene.add(seaWater.group);
  }
  const found = detectLakes(T, { ...WORLD_MAP, maxLakes: 8 });
  LAKES = found.filter((lk) => regionAt(REG, lk.cx, lk.cz) === 'lakes');
  /* FIT EACH DISC TO ITS OWN POOL, using the sampler the physics reads. `detectLakes` returns an
     AREA-matched circle scaled by 0.82 — a heuristic inset for a pool that is never actually round —
     and the probe caught it costing 6.7 cm of shoreline on one lake: ground standing 0.067 u ABOVE
     the water inside the disc, which reads as a lawn floating on a pond. Rather than change that
     shared heuristic (createCityWorld's worlds would move), the ROOM shrinks each disc until the
     highest ground under it is at or below its own surface. Room-level fitting, engine untouched. */
  for (const lk of LAKES) {
    for (let guard = 0; guard < 24; guard++) {
      let worst = -Infinity;
      for (let a = 0; a < 24; a++) {
        const th = a * Math.PI / 12;
        for (const f of [0.35, 0.7, 1.0]) {
          worst = Math.max(worst, HEIGHT(lk.cx + Math.cos(th) * lk.radius * f, lk.cz + Math.sin(th) * lk.radius * f));
        }
      }
      if (worst <= lk.y) break;
      lk.radius *= 0.92;
    }
  }
  LAKES = LAKES.filter((lk) => lk.radius > 0.6);      // a disc smaller than that is a puddle, not a lake
  /* THE LAKES ARE THE SAME SUBSTANCE AS THE SEA, so they are the same factory at a smaller extent —
     `kind:'lake'` is the flat analytic disc (no Gerstner: a 2 u tarn does not carry ocean swell, and
     a flat lake keeps `waterHeightAt`'s `lk.y` exactly true rather than nearly true). The DATA is
     untouched: `detectLakes` + the room's own disc-shrink fit above still decide where and how big
     every pool is; only what draws them changed. `userData.dispose` is kept because buildWorld's
     teardown loop calls it by contract on every dial change. */
  lakeGroup = new THREE.Group();
  lakeWaters = LAKES.map((lk) => {
    const w = createWaterSurface({
      kind: 'lake', at: [lk.cx, lk.cz], radius: lk.radius, y: lk.y, segments: 64,
      ...WATER_LOOK, opacity: 0.88, ripple: 0.5, glint: 0.85, renderOrder: 2,
    });
    w.mesh.raycast = () => {};
    lakeGroup.add(w.group);
    return w;
  });
  lakeGroup.userData.dispose = () => { for (const w of lakeWaters) w.dispose(); lakeWaters = []; };
  scene.add(lakeGroup);
}

/* ---------------------------------------------------------------------------------------------
   2d. THE DRESSING — trees, rocks and scrub, placed by `generateScatter` (L65) through its new
   region DENSITY MASK. The placer is UNCHANGED: it still reads the terrain's own biome + height +
   slope buffers, so every prop sits on the surface for free. What the mask adds is district
   awareness — the woods get planted, the city gets nothing, the desert gets its own sparse table
   (reached only because `shapeRegionTerrain` painted BIOMES[8] there).
   TREES leave the scatter group for the A-TREEKIT conifer kit exactly as moto-lab does it; the
   scatter group still allocates its (empty) tree mesh, which is buildScatterGroup's contract for
   the world editor's paint brush.
   --------------------------------------------------------------------------------------------- */
function buildDressing(WORLD_MAP) {
  const size = WP.size;
  const mask = (i, j) => SCATTER_BY_REGION[REG.keys[REG.region[j * size + i]]] ?? 1;
  const sc = generateScatter({
    terrain: T, seed: WP.seed, ...WORLD_MAP, biomeKeys: BIOME_KEYS,
    density: 0.42, max: 3200, mask,
  });
  /* nothing grows ON the spawn or inside a lake's own disc (a tree standing in open water reads as
     a bug, not a forest — moto-lab's own "no canopy over the opening frame" rule). */
  for (const type of Object.keys(sc.placements)) {
    sc.placements[type] = sc.placements[type].filter((p) =>
      !LAKES.some((lk) => Math.hypot(p.x - lk.cx, p.z - lk.cz) < lk.radius + 0.4));
  }
  const useKit = treeKit && treeKit.mode !== 'failed';
  scatterGroup = buildScatterGroup(useKit ? { ...sc.placements, tree: [] } : sc.placements);
  scene.add(scatterGroup);
  TREE_N = sc.placements.tree.length;
  if (useKit) {
    treeGroup = treeKit.buildGroup(sc.placements.tree, { seed: WP.seed });
    scene.add(treeGroup);
  }
}
buildWorld();

/* ---------------------------------------------------------------------------------------------
   3. THE WALKER + THE WEB (swing-lab's wiring, on married ground). The controller reads the ONE
   bag: heightAt = the carved field, surfaceAt/segmentHit/resolveSphere = the towers standing on it
   — groundAt = max(terrain, roof) is the controller's own line, unmodified.
   --------------------------------------------------------------------------------------------- */
const SWING = { ...GRAPPLE_PROFILE, ropeMax: WORLD_ROPE, aimMode: Q.get('aim') === 'auto' ? 'auto' : 'point' };
/* ---- A-LAUNCH (2026-08-20): THE PHYSICS DIALS. --------------------------------------------------
   The owner's ask was to "change the numbers of, like, rope length and whatnot" in THIS room. The
   profile is already a LOCAL COPY of GRAPPLE_PROFILE (never the shared export — mutating the module's
   own object would poison every other consumer in the bundle), so the knobs cost nothing structural:
   they are URL params first and sliders second, exactly like the world dials above, so a tuning you
   like is a LINK and the probe drives the identical body a human does.
   EVERY DEFAULT IS THE FALLBACK ARGUMENT, i.e. today's shipped number — which is what makes "a page
   with no params is the pre-arc world" a property of the code rather than a hope.
   `rope` is spelled the owner's way in the URL; the profile key it writes (`ropeMax`) is unchanged,
   so nothing downstream learns a second name for one fact. */
const PHYS = [['rope', 'ropeMax'], ['gravity', 'gravity'], ['assist', 'assist'], ['maxSpeed', 'maxSpeed']];
for (const [param, key] of PHYS) SWING[key] = qNum(param, SWING[key]);
/* THE HANG CAP IS DERIVED FROM THE ROPE *AND* GRAVITY, and now has to be re-derivable on demand: the
   ledger's own rule is "recompute it if you move ropeMax or gravity; this number is derived from
   them, not chosen beside them", and a slider that moves either while this stayed put would leave a
   clock racing a pendulum it was never sized against — the exact failure that constant warns about.
   A full period plus margin: 2π√(L/g)·1.24 → 6.79 s at the shipped rope 4.10 / g 5.4. (The previous
   comment here said 6.83; the expression evaluates to 6.79, measured off the running page. Corrected
   rather than carried, per Rule 15 — a derived number stated wrong is the same class of stale fact as
   the `aimReach` literal this room's parent lab already paid for.) */
const deriveHang = () => {
  SWING.maxHangLatched = Number((2 * Math.PI * Math.sqrt(SWING.ropeMax / SWING.gravity) * 1.24).toFixed(2));
};
deriveHang();
const EYE = 0.28, HERO_H = 0.30, WALK_V = 0.55, SPRINT_V = 0.95, JUMP_V = 1.2;
const THIRD = { dist: 1.9, distMax: 3.0, distAtSpeed: 6, height: 0.34, side: 0.16, springR: 0.06, minDist: 0.35 };
const character = createCharacterController({
  world: arena.world,
  grapple: createGrappleModel(SWING),
  grappleProfile: SWING,
  eyeHeight: EYE, radius: 0.09, footR: 0.12, collideYOff: 0.14,
  moveSpeed: WALK_V, sprintSpeed: SPRINT_V, accel: 14,
  /* GRAVITY IS HANDED IN AS A FUNCTION, not a number, and that one character of difference is what
     makes the gravity dial honest (A-LAUNCH). The grapple model already re-reads its profile every
     frame (pilot.js `P(k)`), so a dial wired only to the profile would change how a SWING falls and
     not how a FALL falls — the body would get lighter the instant a web cut, which is precisely the
     mismatch character.js's own gravity note forbids. The seam is engine-core's and opt-in: pass a
     number and it is read once, as every other consumer still does. */
  jumpSpeed: JUMP_V, gravity: () => SWING.gravity,
  third: THIRD,
  fov: { base: 58, max: 78, atSpeed: 7 },
  camEyeClear: cameraNearRadius({ near: 0.02, fov: 78, aspect: 2, margin: 1.25 }),
  cling: { enabled: true },
});
const hero = createHeroBody({
  url: survivorUrl,
  /* A-CONTACT (2026-08-20): this room never named `airMotion`, and its DEFAULT is true — so world-lab
     has had the wall crawl (and its 0.0710 u float) all along, silently. Wired here in the same commit
     as the lab and the city precisely because that is the wiring-drift failure CLAUDE.md calls out:
     the ability living in core while a sibling entry path never inherits it. */
  surfaceProbe: Q.get('surfaceprobe') === '0' ? null : arena.world.segmentHit,
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
   4. THE ROSTER (ARC A-DRIVE, 2026-08-21) — seven bodies on the SAME bag, driven by a DATA TABLE.
   ---------------------------------------------------------------------------------------------
   A-PATCHWORK left this room with a `MODE === 'walk' ? … : bike` binary and one hard-wired craft.
   The owner asked for "cars, helicopters, planes, the spaceship, things like that so I can move
   around the world that way", and the honest answer was that the ENGINE ALREADY HAD ALL OF IT:

     ask            what it needed                                        what was built new
     ─────────────  ────────────────────────────────────────────────────  ──────────────────
     cars           createRoadModel (A-FEEL, 2026-08-05) + a numbers row   nothing
     helicopters    createSpacecraftModel + HELI_PROFILE (A-HELI proved    nothing
                    this on 2026-08-06 — a heli is a saucer with slower
                    numbers, not a second integrator)
     planes         createBirdModel — which IS fixed-wing physics: energy  PLANE_PROFILE
                    trade, stall, banked turns, thrust. See the profile's  (numbers only)
                    own derivation in pilot.js.
     the spaceship  createSpacecraftModel + CRAFT_PROFILE, shipped L77     nothing

   So this section adds NO physics. What it adds is the SEAM: adding a vehicle is a ROW plus a
   GLB, never a branch. Everything below is per-row data, and the frame loop (§8) has exactly one
   vehicle path that reads it. C++ anchor: a table of Strategy instances keyed by name — the
   controller never learns what a helicopter is.

   ── THE WORLD BAG IS THE CONTRACT. Every craft runs against the room's existing
   heightAt / surfaceAt / segmentHit / resolveSphere, the same bag walking, swinging and the bike
   already use. ONE thing had to be ADDED, and it is a fact about this room rather than a
   capability: `waterHeightAt`. The spacecraft's medium probe and the bird's floor both ask the
   world where its water is, this room has a sea plane and lake discs, and nobody had ever told
   them. metropolis solved the identical gap with engine.setPilotWaterSampler; here the bag is
   the room's own object, so it is one function. Without it the medium probe would have read
   NO_WATER everywhere and the spaceship could never have entered the sea. --------------------- */
const VEH_WORLD = {
  heightAt,
  /* WHERE THE WATER IS, answered from the room's own geometry rather than a second sampler:
     a lake disc reports its own surface, and everywhere the terrain falls below sea level the
     sea plane (y = 0, terrain.js's own baseY mapping) is overhead. Anywhere else there is no
     water, which is what NO_WATER means. Hot path — squared distance, no Math.hypot, no alloc. */
  waterHeightAt(x, z) {
    for (let i = 0; i < LAKES.length; i++) {
      const lk = LAKES[i], dx = x - lk.cx, dz = z - lk.cz;
      if (dx * dx + dz * dz <= lk.radius * lk.radius) return lk.y;
    }
    return HEIGHT(x, z) < 0 ? 0 : NO_WATER;
  },
};

/* ---- THE SPEED SCALE, and why every row states one. Every profile in pilot.js was authored
   against the ORIGINAL ~26-unit city; this world is 128 u across. A-HELI already paid for this
   lesson in the other direction (a craft tuned for a big world crossed metropolis's island in two
   seconds). The reference here is the BIKE, which this room already ships at its native 7.5 u/s
   and which crosses the world in ~17 s — so a car is scaled to sit just above it and an aircraft
   to a little over twice it. `scaleProfileSpeeds` (engine-core) scales LENGTHS/VELOCITIES/
   ACCELERATIONS and leaves RATES alone, so the craft covers more ground at the same feel. ---- */
const ROAD_KEYS = ['maxSpeed', 'accel', 'drag', 'turnRadiusMin', 'latAccelMax'];
const BIRD_KEYS = ['cruiseSpeed', 'maxSpeed', 'stallSpeed', 'flap', 'glideDrag', 'gravityTrade', 'skim'];
/* the three road vehicles are ONE profile with three MASSES. The differences are deliberately the
   ones you can feel through the wheel rather than read on a badge: a fire truck takes half again
   as long to reach a lower top speed and needs a corner twice as wide as the sedan's. */
const roadCar = (k, { top, accel, rMin, aLat, bank }) => ({
  ...scaleProfileSpeeds(ROAD_PROFILE, k, ROAD_KEYS),
  maxSpeed: top, accel, turnRadiusMin: rMin, latAccelMax: aLat, bankMax: bank,
  collide: { ...ROAD_PROFILE.collide, r: 0.30, yOff: 0.16 },
});
/* AIRCRAFT ARE BIGGER THAN CARS, and the mesh scale says so: a light helicopter is ~2.7x a car in
   the real world and the generator authored them all at road-vehicle size so ONE dial covers it.
   The scale is VISUAL ONLY — no flyer uses resolveSphere, so nothing collides at the wrong size
   (an honest limit, not a claim: a scaled ground vehicle WOULD need its collider scaled too). */
const AIR_MESH_SCALE = 1.8;

const ROSTER = [
  {
    key: 'bike', label: 'dirtbike', chip: 'B',
    hint: 'the dirtbike — W throttle · S brake · ↑↓ lean in the air',
    profile: { ...BIKE_PROFILE },
    make: (p) => createBikeModel(p),
    body: () => createBikeMesh({}),          // box bike: this room's subject is the GROUND, not the art
    cam: { dist: 2.8, height: 1.05, aheadUp: 0.45 },
    collide: true, mount: 'ground',
    where: 'land — it climbs anything, which is what a dirtbike is for',
  },
  {
    key: 'car', label: 'sedan', chip: '1',
    hint: 'the sedan — W throttle · A/D steer · it washes wide when you carry speed',
    profile: roadCar(3.4, { top: 8.6, accel: 12, rMin: 1.4, aLat: 14, bank: 0.10 }),
    make: (p) => createRoadModel(p),
    body: () => createVehicleGlbMesh({ url: sedanUrl, fallback: { w: 0.42, h: 0.4, l: 0.74 } }),
    cam: { dist: 3.0, height: 1.10, aheadUp: 0.40 },
    collide: true, mount: 'ground',
    where: 'the city district — it is a ROAD car and the curvature law says so',
  },
  {
    key: 'van', label: 'box van', chip: '2',
    hint: 'the box van — heavier than the sedan, and it leans',
    profile: roadCar(3.4, { top: 7.0, accel: 8.5, rMin: 2.0, aLat: 10, bank: 0.16 }),
    make: (p) => createRoadModel(p),
    body: () => createVehicleGlbMesh({ url: vanUrl, fallback: { w: 0.47, h: 0.8, l: 0.9 } }),
    cam: { dist: 3.4, height: 1.30, aheadUp: 0.45 },
    collide: true, mount: 'ground',
    where: 'the city district, and it will grind up a shallow hill',
  },
  {
    key: 'truck', label: 'fire truck', chip: '3',
    hint: 'the fire truck — slow to wind up, and its corner is twice the sedan\'s',
    profile: roadCar(3.4, { top: 5.8, accel: 6.0, rMin: 2.8, aLat: 7, bank: 0.13 }),
    make: (p) => createRoadModel(p),
    body: () => createVehicleGlbMesh({ url: truckUrl, fallback: { w: 0.49, h: 0.58, l: 1.3 } }),
    cam: { dist: 4.0, height: 1.40, aheadUp: 0.50 },
    collide: true, mount: 'ground',
    where: 'the city district — anywhere else it is a very large brick',
  },
  {
    key: 'heli', label: 'helicopter', chip: '4',
    /* mediumScale is the spacecraft's OWN per-world dial (pilot.js). HELI_PROFILE carries
       metropolis's 0.30, fitted to a 15-unit island; 1.15 puts air cruise at 9.2 u/s here, just
       over the bike, so the world crosses in ~14 s instead of ~53. This override IS the reason
       the profile is parameterized — see the lift note in pilot.js.
       ── ARC A-LIFT (2026-08-21): `lift` IS STATED HERE BECAUSE THE INHERITED 9.0 CANNOT TAKE OFF.
       Not a tuning preference — arithmetic. createSpacecraftModel's vertical axis is
           vy += lift·dt ;  vy -= sign(vy)·min(|vy|, vDrag·dt)
       i.e. the vertical drag is a CONSTANT-MAGNITUDE decelerator (Coulomb friction, not viscous),
       applied in the SAME frame as the lift impulse. So climbing is a THRESHOLD, not a rate: it
       needs lift > vDrag, and below that vy is pinned at exactly 0 no matter how long you hold the
       key. MEDIUM_PARAMS.ground.vDrag is 9.0 and CRAFT_PROFILE.lift is 9.0 — dead equal — so a
       grounded craft's net vertical acceleration was 0.000 and it never left the terrain. Measured
       on the shipped page: y 1.521 → 1.815 over 6.5 s with vy reading 0.000 every sample, and that
       0.29 u was not a climb at all — it was the `y < terrainY` clamp ratcheting the craft up over
       a bump and never letting it back down. The one reason this was ever flyable is a 0.6 s
       accident: on mounting, the air→ground crossing EASE lerps vDrag up from air's 2.2, so lift
       briefly wins. Press ↑ within that window and it flies; wait three seconds and it is welded
       to the ground. 15.0 = 9.0 + 6.0 u/s² of real margin — off the ground in 0.50 s from a fully
       settled start, measured, and with no dependence on when the key is pressed.
       (C++ anchor: the drag term is `v -= copysign(min(fabs(v), k*dt), v)` — a dead-band that eats
       the whole impulse when k equals the input, not a `v *= (1 - k*dt)` that only ever shrinks it.)
       The DEFAULT profile still sits on the threshold; that is an engine-level latent defect,
       reported rather than changed here, because CRAFT_PROFILE is shared with metropolis. */
    profile: { ...HELI_PROFILE, mediumScale: 1.15, lift: 15.0, chaseDist: 5.0, chaseElev: 0.34 },
    make: (p) => createSpacecraftModel(p),
    body: () => createVehicleGlbMesh({
      url: heliUrl, scale: AIR_MESH_SCALE, fallback: { w: 0.6, h: 0.6, l: 1.0 },
      /* the two rotors, as DATA. Constant rate, not speed-linked: a helicopter's rotor turns
         because the engine is running, so a hovering ship still spins. Runtime axes — main about
         +Y, tail about +X (the generator's own node names are the contract). */
      spin: [{ node: 'veh_heli_rotor', axis: 'y', rate: 26 },
             { node: 'veh_heli_tail_rotor', axis: 'x', rate: 40 }],
    }),
    cam: { dist: 5.5, height: 2.2, aheadUp: 0.8 },
    collide: false, mount: 'ground', air: true,
    hint: 'the helicopter — W forward · ↑↓ climb/descend · it hovers when you let go',
    where: 'anywhere, including over the sea and the lakes — it is the sightseeing body',
  },
  {
    key: 'plane', label: 'aeroplane', chip: '5',
    /* the bird has no mediumScale, so the room scales the dimensional keys itself. 2.7 puts
       cruise at 7.0 u/s and the dive limit at 13.5 — and because gravityTrade scales with them,
       the energy trade keeps its shape: a dive still buys speed at the same RATE per radian. */
    profile: { ...scaleProfileSpeeds(PLANE_PROFILE, 2.7, BIRD_KEYS), chaseDist: 7.0 },
    make: (p) => createBirdModel(p),
    body: () => createVehicleGlbMesh({
      url: planeUrl, scale: AIR_MESH_SCALE, fallback: { w: 0.6, h: 0.4, l: 1.15 },
      spin: [{ node: 'veh_plane_prop', axis: 'z', rate: 48 }],
    }),
    cam: { dist: 7.0, height: 2.4, aheadUp: 1.0 },
    collide: false, mount: { fly: 9 }, air: true,
    hint: 'the aeroplane — ↑ nose up (it costs speed) · ↓ dive for speed · W throttle · A/D bank to turn',
    where: 'anywhere at height; it CANNOT hover — hold the nose up without throttle and it stalls',
  },
  {
    key: 'ship', label: 'spaceship', chip: '6',
    /* CRAFT_PROFILE unscaled but for the medium dial: this is pilot.js's "all-medium master
       rule-breaker", and the point of taking it out is that AIR -> WATER -> GROUND is one craft.
       1.6 is the fastest thing in the roster (air cruise 12.8 u/s) because it is the one you take
       when you want to be somewhere else. */
    /* `submersible` is A-DRIVE's own engine finding, opted into HERE and nowhere else: the
       spacecraft model's water medium was unreachable because the surface was a hard floor (see
       pilot.js). This row is the reason the flag exists — and metropolis's helicopter, which runs
       the SAME model, deliberately does not set it. */
    /* `lift` is stated for the same arithmetic reason as the helicopter's — see that row for the
       full working. 18.0 = 9.0 + 9.0 u/s²: this row is already the fastest thing in the roster and
       it leaves the ground in 0.42 s, against NEVER on the inherited 9.0. */
    profile: { ...CRAFT_PROFILE, mediumScale: 1.6, lift: 18.0, chaseDist: 6.0, chaseElev: 0.36, submersible: true },
    make: (p) => createSpacecraftModel(p),
    body: () => createVehicleGlbMesh({
      url: shuttleUrl, scale: 2.2, fallback: { w: 1.0, h: 0.4, l: 1.25 },
    }),
    cam: { dist: 6.5, height: 2.3, aheadUp: 0.9 },
    collide: false, mount: 'ground', air: true,
    hint: 'the spaceship — ↑↓ climb/descend · hold ↓ over water and you go UNDER it',
    where: 'every district, and it is the only body that crosses AIR -> WATER -> GROUND',
  },
];
const BY_KEY = new Map(ROSTER.map((v) => [v.key, v]));

/* ---- lazily built, because a roster of seven that all load their GLB at boot would pay six
   fetches nobody asked for. First selection builds the model, the mesh and the state; after that
   the entry is cached, so re-entering a craft is free and it REMEMBERS where you left it. ---- */
function instance(spec) {
  if (spec._inst) return spec._inst;
  const body = spec.body();
  body.group.visible = false;
  scene.add(body.group);
  spec._inst = {
    model: spec.make(spec.profile),
    body,
    cam: createMotoChaseCam(spec.cam),
    state: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0, speed: 0, vy: 0, quat: new THREE.Quaternion() },
  };
  return spec._inst;
}

let MODE = 'walk';                               // 'walk' | any ROSTER key
let ACTIVE = null;                               // the live { model, body, cam, state } or null
let view = 'third';                              // the vehicle's own V toggle (walker has its own)
/* THE ONE MOUNT PATH. Every craft is entered from wherever the walker is standing, facing where
   the walker was looking, from rest — the property that makes "a vehicle you can get into from
   normal play" true for all seven rather than for the one that was wired by hand. The only
   per-row difference is HOW FAR OFF THE GROUND, and that is data (`mount`), because a plane
   cannot be entered from rest on a hillside: the bird model has no thrust-from-standstill and
   would stall on the spot. It is launched already flying, exactly as pilot.js's own gull comment
   describes ("a bird never starts from rest mid-air"). */
function setMode(m) {
  if (m === MODE) return;
  const spec = BY_KEY.get(m);
  if (m !== 'walk' && !spec) return;              // an unknown key lands you on foot, never nowhere
  if (ACTIVE) ACTIVE.body.group.visible = false;  // leaving one craft for another: park the old body
  MODE = m;
  if (spec) {
    const inst = instance(spec);
    ACTIVE = inst;
    const st = inst.state;
    st.x = character.x; st.z = character.z;
    st.yaw = character.lookYaw;
    st.speed = 0; st.vy = 0; st.pitch = 0; st.bank = 0;
    st.airborne = false; st.upX = 0; st.upY = 1; st.upZ = 0;
    st.medium = 'air'; st.crossingT = 0; st.crossFrom = null; st.stalling = false;
    const g = HEIGHT(st.x, st.z);
    st.y = g + (spec.mount && spec.mount.fly ? spec.mount.fly : 0);
    inst.body.group.visible = true;
    hero.group.visible = false;
    rope.visible = false; anchorDot.visible = false;
    inst.cam.reset(st.yaw);
    flash(spec.hint);
  } else {
    /* dismount where the ride ended — the composition loop closes on the same ground. A null Y
       makes the controller snap the walker to the surface, so stepping out of a helicopter at
       height puts you on the ground under it rather than in a fall. */
    const st = ACTIVE ? ACTIVE.state : { x: character.x, z: character.z };
    character.setPosition(st.x, null, st.z);
    ACTIVE = null;
    hero.group.visible = true;
    flash('on foot — LMB lock · RMB web · SPACE launch');
  }
}
/* the previous vehicle, so B and the dock button toggle back to what you last drove rather than
   always to the bike — the roster's own answer to "one key, seven bodies". */
let lastVehicle = 'bike';
/* THE ONE PLACE A BODY CHANGES. setMode owns the craft; `pick` owns everything that has to agree
   WITH it — the remembered vehicle and the dock's pressed chip. metropolis's own setMode comment
   names this exact trap ("setMode is the only path that keeps mode, the aria-pressed attributes
   and the hint in agreement"), and with seven chips the cost of a second path is seven lies. */
function pick(m) {
  setMode(m);
  if (MODE !== 'walk') lastVehicle = MODE;
  syncChips();
}
function syncChips() {
  for (const v of ROSTER) {
    const el = $('b-veh-' + v.key);
    if (el) el.setAttribute('aria-pressed', String(MODE === v.key));
  }
}
/* the bike's own state, for the two HUD rows and the probe handle that are ABOUT the bike (air
   time, jumps, the landing verdict). Empty until the bike has been ridden once — a receipt about
   a craft nobody has entered would be a lie with formatting (createTreeKit's tintReport rule). */
const NO_BIKE = {};
const bikeState = () => (BY_KEY.get('bike')._inst ? BY_KEY.get('bike')._inst.state : NO_BIKE);

/* ---------------------------------------------------------------------------------------------
   5. INPUT — one key map, the axis vocabulary every project sends.
   --------------------------------------------------------------------------------------------- */
const held = new Set();
let spacePulse = false;
const spawn = () => {
  const p = arena.openSpot(0, -((AR.cols - 1) / 2) * AR.spacing * 0.7);
  pick('walk');                                  // through `pick`, so respawning also un-presses the roster chip
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
  /* B is the GET IN / GET OUT key it always was, but it now returns you to the craft you last
     drove rather than always to the bike — with seven bodies, "the toggle" has to remember. */
  if (k === 'b') pick(MODE === 'walk' ? lastVehicle : 'walk');
  /* the roster on the number row: one key per craft, and pressing the one you are already in
     gets you out. Switching craft-to-craft is allowed and goes through setMode, so the parked
     body, the hint and the seven dock chips can never disagree about what you are. */
  const spec = ROSTER.find((v) => v.chip === k);
  if (spec) pick(MODE === spec.key ? 'walk' : spec.key);
});
addEventListener('keyup', (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => { held.clear(); webPressed = false; });

/* ---------------------------------------------------------------------------------------------
   6. THE MEASUREMENTS — the receipts the probe and the HUD both read (one implementation).
   `minClear` per mode = min(y − heightAt) over frames: the NO-SINK receipt, the moto arc's
   containment analog, live on the HUD for BOTH bodies.
   --------------------------------------------------------------------------------------------- */
/* A-DRIVE: the NO-SINK receipt is now PER BODY, one map instead of two fields, because seven
   bodies each need their own and a shared minimum would let a good craft launder a bad one. The
   figure means the same thing for all of them — min(y − heightAt) over the frames that body was
   driven — so a flyer's number is its lowest pass and a car's is how far it dipped into the road.
   `walkMinClear`/`bikeMinClear` survive as views onto this map (§9) because the probe reads them
   by name and this arc must not move what A-PATCHWORK proved. */
const minClear = { walk: Infinity };
for (const v of ROSTER) minClear[v.key] = Infinity;
const stats = { webs: 0, fps: 0, t: 0 };
let hadAnchor = false, lastLandCount = 0, landings = 0, cleans = 0;
/* A-PATCHWORK: the DISTRICTS this body has actually stood in, and the order it entered them. The
   composition proof is "crossed ≥3 districts in ONE session", and a claim like that has to be
   recorded WHILE the body moves — reading the end position only proves where it stopped. */
let visited = [];
function noteRegion(x, z) {
  if (!REG) return;
  const k = regionAt(REG, x, z);
  if (k && visited[visited.length - 1] !== k) visited.push(k);
}
function resetStats() {
  stats.webs = 0; stats.t = 0;
  for (const k of Object.keys(minClear)) minClear[k] = Infinity;
  landings = 0; cleans = 0; lastLandCount = 0;
  visited = [];
}
function flash(msg) { const h = $('hint'); if (!h) return; h.innerHTML = `<b>${msg}</b>`; clearTimeout(flash._t); flash._t = setTimeout(() => { h.innerHTML = HINT; }, 1800); }
const HINT = $('hint') && $('hint').innerHTML;
const set = (id, v, cls) => { const e = $(id); if (!e) return; e.textContent = v; if (cls !== undefined) e.className = 'v ' + cls; };
const deg = (r) => (r * 180 / Math.PI).toFixed(0);
let hudT = 0;
function updateHud(dt) {
  hudT += dt; if (hudT < 0.1) return; hudT = 0;
  const chip = $('state-chip');
  const A = ACTIVE, sp = A ? BY_KEY.get(MODE) : null;
  /* the state word, one expression for seven bodies. A flyer reports its MEDIUM (the spacecraft's
     own air/water/ground probe) or STALL (the bird's), because those are the words that tell you
     what the craft is about to do; a ground vehicle reports ride/air off the bike's airborne flag
     or simply RIDE. The walker keeps A-PATCHWORK's four words exactly. */
  const st = A
    ? (A.state.stalling ? 'stall'
      : A.state.medium && A.state.medium !== 'air' ? A.state.medium
        : sp.air ? 'fly'
          : A.state.airborne ? 'air' : 'ride')
    : character.swinging ? 'swing' : character.clinging ? 'climb' : (character.grounded ? 'walk' : 'air');
  chip.className = st === 'walk' || st === 'swing' || st === 'climb' || st === 'air' ? st : 'ride';
  chip.textContent = st.toUpperCase();
  const x = A ? A.state.x : character.x, z = A ? A.state.z : character.z;
  const y = A ? A.state.y : character.y;
  const g = HEIGHT(x, z);
  set('v-speed', (A ? A.state.speed : character.state.speed).toFixed(2));
  set('v-y', y.toFixed(2));
  set('v-ground', `${g.toFixed(2)} (pad Δ ${(y - g).toFixed(2)})`);
  const mc = minClear[MODE];
  set('v-sink', mc === Infinity ? '—' : mc.toExponential(1), mc < -1e-4 ? 'bad' : 'on');
  /* A-DRIVE: which craft, and where the roster says it belongs. `where` is a stated OPINION about
     districts, printed beside the district you are actually standing in so the two can disagree
     in front of you — a fire truck in the desert is allowed, it is just slow. */
  set('v-veh', sp ? `${sp.label} · ${sp.chip}` : 'on foot', sp ? 'on' : 'off');
  const s = character.state;
  set('v-web', s.anchor ? `YES · ${s.anchor.y.toFixed(2)}` : `${stats.webs} fired`, s.anchor ? 'on' : '');
  set('v-rope', `${SWING.ropeMax.toFixed(2)} · ${aimReach().toFixed(1)} u`);
  set('v-lock', targetLock.has ? `y ${targetLock.point.y.toFixed(2)}` : 'none — LMB to lock', targetLock.has ? 'on' : 'off');
  const bs = bikeState();
  set('v-bike', MODE === 'bike' ? `${bs.airborne ? bs.airtime.toFixed(2) + ' s' : '—'} · ${bs.jumps || 0}` : '—', MODE === 'bike' ? 'on' : 'off');
  const L = bs.landing;
  set('v-land', L && L.count ? `${deg(L.err)}°·${deg(L.yawErr || 0)}° · kept ${(L.kept * 100).toFixed(0)}% · ${cleans}/${landings}` : '—', L && L.count ? (L.clean ? 'on' : 'bad') : '');
  const cs = CARVE.stats;
  set('v-pads', `${cs.pads} · ${(cs.padMax - cs.padMin).toFixed(2)} u`);
  set('v-grade', `${cs.steepestStreet.toFixed(3)} ≤ ${cs.maxGrade.toFixed(2)}`, cs.steepestStreet <= cs.maxGrade + 1e-9 ? 'on' : 'bad');
  const sw = arena.stats.swingable;
  set('v-guar', sw ? `${sw.clearing}/${sw.towers} (${(100 * sw.frac).toFixed(1)}% vs ${(100 * sw.want).toFixed(0)}%)` : '—',
    sw && Math.abs(sw.frac - sw.want) < 0.02 ? 'on' : 'bad');
  /* ---- the PATCHWORK rows: which district you are standing in, and the three counted properties
     the arc turns on, read LIVE off the finished field rather than from a build-time memory. ---- */
  if (REG) {
    const here = regionAt(REG, x, z);
    set('v-region', here ? here.toUpperCase() : '—', here ? 'on' : 'off');
    const per = REG.stats.per;
    const worstLcc = Math.min(...per.map((p) => p.lccFrac));
    const worstDrift = Math.max(...per.filter((p) => p.key !== 'city').map((p) => Math.abs(p.frac - p.want)));
    set('v-partition', `${REG.stats.unassigned} loose · ${per.length} districts`, REG.stats.unassigned === 0 ? 'on' : 'bad');
    set('v-contig', `${(worstLcc * 100).toFixed(2)}% in ONE blob`, worstLcc >= 0.99 ? 'on' : 'bad');
    const w = per.find((p) => p.key === 'woods');
    set('v-cover', `woods ${(w.frac * 100).toFixed(2)}% vs ${(w.want * 100).toFixed(0)}% · drift ${(worstDrift * 100).toFixed(3)}pp`,
      REG.stats.starved === 0 ? 'on' : 'bad');
    set('v-seam', `${SHAPED.gradeMax.toFixed(4)} ≤ ${WP.maxGrade.toFixed(2)}`, SHAPED.gradeMax <= WP.maxGrade + 1e-9 ? 'on' : 'bad');
    set('v-water', `${LAKES.length} lakes · ${SHAPED.bowls.length} basins · ${SHAPED.islandTexels} islet texels`,
      LAKES.length ? 'on' : 'off');
    set('v-flora', `${TREE_N} trees · sand ${SHAPED.painted}`, TREE_N ? 'on' : 'off');
  }
  const ri = renderer.info.render;
  set('v-draws', `${ri.calls} · ${(ri.triangles / 1000).toFixed(0)}k · ${stats.fps.toFixed(0)} fps · build ${LEVEL_BUILD_MS.toFixed(0)} ms`);
}

/* ---------------------------------------------------------------------------------------------
   7. THE DOCK.
   --------------------------------------------------------------------------------------------- */
/* TWO KINDS OF DIAL, and the split is the architecture rather than tidiness.
   WORLD dials change the FIELD, so they must re-run the whole generate→shape→carve chain and respawn
   the body (a pad that moved under your feet is not a pad you are standing on). PHYSICS dials write
   the LIVE profile object the grapple model and the controller both read every frame, so they take
   effect on the NEXT FRAME with no reconstruction — which is what makes "does a longer rope actually
   reach that tower" answerable in ten seconds instead of a rebuild.
   `spacing` JOINS THE WORLD LIST here and that is a gap being closed, not a feature: it has been a
   URL param since A-MARRIAGE (`AR.spacing = qNum('spacing', 4.6)`) with no slider and no place in
   `copy url` — so a world you reached by hand-editing the URL could not be handed to anyone. A param
   the copy button cannot express is a param the room cannot share. */
const DIALS = [['seed', 'seed', WP], ['grade', 'maxGrade', WP], ['street', 'streetW', WP],
  ['cols', 'cols', AR], ['spacing', 'spacing', AR], ['woods', 'woods', WP]];
const decimals = (key) => (key === 'seed' || key === 'cols' ? 0 : 2);
function syncDock() {
  for (const [id, key, obj] of DIALS) {
    const el = $('p-' + id); if (!el) continue;
    el.value = String(obj[key]);
    $('n-' + id).textContent = Number(obj[key]).toFixed(decimals(key));
  }
  for (const [id, key] of PHYS) {
    const el = $('p-' + id); if (!el) continue;
    el.value = String(SWING[key]);
    $('n-' + id).textContent = Number(SWING[key]).toFixed(2);
  }
}
function wireDock() {
  for (const [id, key, obj] of DIALS) {
    const el = $('p-' + id); if (!el) continue;
    el.addEventListener('input', () => {
      obj[key] = Number(el.value);
      if (key === 'cols') AR.rows = AR.cols;     // square city — two sliders that must agree will drift
      $('n-' + id).textContent = Number(el.value).toFixed(decimals(key));
      buildWorld(); spawn();
      /* the WOODS dial reports itself in the units it was ASKED in — the whole point of the arc is
         that this number comes back off the finished field, not out of the request. */
      if (key === 'woods' && REG) {
        const w = REG.stats.per.find((p) => p.key === 'woods');
        flash(`asked ${(WP.woods * 100).toFixed(0)}% woods · counted ${(w.frac * 100).toFixed(2)}%`);
      } else flash(`world rebuilt · pads span ${(CARVE.stats.padMax - CARVE.stats.padMin).toFixed(2)} u`);
    });
  }
  /* THE PHYSICS DIALS write the live profile and return — no rebuild, no respawn. The ONE thing they
     must not skip is `deriveHang`: rope and gravity are the two inputs the latched-hang cap is
     computed from, so leaving it stale is how you get a rope the arc outlives. */
  for (const [id, key] of PHYS) {
    const el = $('p-' + id); if (!el) continue;
    el.addEventListener('input', () => {
      SWING[key] = Number(el.value);
      $('n-' + id).textContent = Number(el.value).toFixed(2);
      if (key === 'ropeMax' || key === 'gravity') deriveHang();
    });
  }
  /* RESET RESTORES *THIS ROOM'S* SHIPPED TUNING, which is not GRAPPLE_PROFILE's. The house rope here
     is 4.10 (swing-lab's derived constant, held fixed so the mechanic is identical across rooms and
     the LEVEL is the only variable) — handing back the profile's metropolis-fitted 3.2 would silently
     undo the range this world is generated FROM (`ARENA_SKY.ropeMax`) and read as a broken slider.
     Same trap swing-lab's own reset comment names, one room over. */
  $('b-reset').addEventListener('click', () => {
    SWING.ropeMax = WORLD_ROPE;
    for (const k of ['gravity', 'assist', 'maxSpeed']) SWING[k] = GRAPPLE_PROFILE[k];
    deriveHang(); syncDock();
    flash(`physics reset · rope ${SWING.ropeMax.toFixed(2)} u · g ${SWING.gravity.toFixed(2)} · hang ${SWING.maxHangLatched.toFixed(2)} s`);
  });
  $('b-valley').addEventListener('click', () => { WP.preset = 'valley'; buildWorld(); spawn(); flash('preset: valley'); });
  $('b-mountains').addEventListener('click', () => { WP.preset = 'mountains'; buildWorld(); spawn(); flash('preset: mountains'); });
  $('b-spawn').addEventListener('click', spawn);
  /* ---- THE ROSTER IS THE DOCK'S, TOO (A-DRIVE). The chips are BUILT FROM THE TABLE rather than
     written into index.html, so the two can never drift: an eighth craft appears in the dock the
     moment its row exists, and a removed row cannot leave a dead button behind. Each carries its
     key hint and its "where it belongs" line as the title, so the roster's stated opinion about
     districts is one hover away instead of buried in this file. ---- */
  const bay = $('veh-bay');
  if (bay) {
    for (const v of ROSTER) {
      const b = document.createElement('button');
      b.id = 'b-veh-' + v.key;
      b.textContent = `${v.label} (${v.chip})`;
      b.title = `${v.hint}\nbest in: ${v.where}`;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => pick(MODE === v.key ? 'walk' : v.key));
      bay.appendChild(b);
    }
  }
  $('b-walk').addEventListener('click', () => pick('walk'));
  $('b-copy').addEventListener('click', () => {
    const p = new URLSearchParams();
    p.set('seed', WP.seed); p.set('grade', WP.maxGrade); p.set('street', WP.streetW);
    p.set('cols', AR.cols); p.set('spacing', AR.spacing); p.set('woods', WP.woods);
    /* THE PHYSICS GOES IN THE URL TOO, which is the whole point of the copy button: a swing that felt
       right is a rope length and a gravity, and a link that carries the world but not the body is a
       link to a different experiment. Written from the LIVE profile, so what you copy is what is
       actually in force — not what the sliders were built with. */
    for (const [param, key] of PHYS) p.set(param, SWING[key]);
    if (MODE !== 'walk') p.set('mode', MODE);
    if (WP.preset !== 'valley') p.set('preset', WP.preset);
    if (!WP.regions) p.set('regions', 'off');
    const url = location.origin + location.pathname + '?' + p.toString();
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    flash('url copied');
  });
  const dock = $('dock');
  $('dock-toggle').addEventListener('click', (e) => { e.stopPropagation(); dock.classList.toggle('min'); $('dock-toggle').textContent = dock.classList.contains('min') ? '+' : '–'; });
}
wireDock(); syncDock(); syncChips();

/* ---------------------------------------------------------------------------------------------
   8. THE FRAME.
   --------------------------------------------------------------------------------------------- */
const _camPos = { x: 0, y: 0, z: 0 }, _camDir = { x: 0, y: 0, z: 0 };
const _bCamPos = new THREE.Vector3(), _bCamDir = new THREE.Vector3();
const _hand = new THREE.Vector3();
const AXES = { throttle: 0, steer: 0, lift: 0, boost: 0 };
spawn();
/* ---- A-LAUNCH: THE BODY IS A URL PARAM. `?mode=bike` starts you on the dirtbike instead of on
   foot. It is applied AFTER `spawn()` deliberately — spawn's own contract is "put the walker at
   the city edge facing in", and it forces walk mode, so asking for a craft first would be silently
   undone. This is what makes a launcher entry able to promise a BODY as well as a world: the menu
   is links, and a link can only carry what the room agrees to read.
   A-DRIVE widened the vocabulary from one key to the whole ROSTER — `?mode=heli`, `?mode=car`,
   `?mode=ship` — with no change to the rule that an unknown value lands you on foot rather than
   nowhere (setMode refuses a key it cannot find). `?mode=bike` still means exactly what it did. */
pick(Q.get('mode') || 'walk');
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

  /* ---- 8b. THE SKY TICK (A-SKYWORLD). Runs BEFORE the two body branches on purpose: both of them
     place the key light from `SUN_OFF`, so the sun has to have moved first or the shadows lag the
     sky by a frame. Everything here is a COPY INTO an existing object — SunRig hands out its Colors
     and Vector3s by reference (§1b) and docs/engine-invariants.md §7 forbids per-frame allocation,
     so there is not one `new` in this block. ---- */
  sun.update(dt);
  /* the key light's direction IS the sun's, at a fixed 20 u standoff (§1b's shadow-frustum budget).
     `sunDir` is already the MOON's direction after dusk — SunRig flips it — so the night key is
     moonlight from the right place rather than a sun buried under the world. */
  SUN_OFF.x = sun.sunDir.x * 20;
  SUN_OFF.y = Math.max(3, sun.sunDir.y * 20);
  SUN_OFF.z = sun.sunDir.z * 20;
  key.color.copy(sun.sunColor);
  key.intensity = sun.sunIntensity;
  fill.color.copy(sun.hemiSky);
  fill.groundColor.copy(sun.hemiGround);
  /* THE FOG IS THE SKY'S OWN AMBIENT COLOUR — `hemiSky`, NOT `horizon`, and the difference was
     visible the first time I looked. `sunRig.horizon` is a keyframe authored for the city's
     Preetham/stylized backdrop; at this room's 14:53 it is a mauve #8d6269, while the Hillaire
     atmosphere actually paints a PALE BLUE horizon. Fogging the terrain to a colour the sky never
     shows put a dark mauve band across the join — the ground fading out to one colour in front of
     another. `hemiSky` is by definition "the colour of the sky as a surface sees it", which is the
     same quantity atmospheric fog approximates, and it tracks correctly across the whole day
     (#9cb8cc noon, #8a7686 dawn, #7a566a dusk, #26344f night). Honest limit: it is still an
     APPROXIMATION of a horizon that really lives in a GPU LUT — the sky module exposes no CPU-side
     horizon colour, so no exact answer is available to read.
     `lowSunWashK` is the engine's OWN shared low-sun curve (sun-rig.js) — imported, never
     re-derived — and it lifts the fill a little at dawn/dusk when the key has gone red and low. */
  _fogC.copy(sun.hemiSky);
  scene.fog.color.copy(_fogC);
  renderer.setClearColor(_fogC, 1);
  fill.intensity = 0.85 + 0.55 * lowSunWashK(sun.sunArc.y);

  /* THE SKY-VIEW LUT IS RE-MARCHED ONLY WHEN THE SUN ACTUALLY MOVED. It is a 200x100 raymarch and
     the city pays it every frame because the city's sun is always creeping; THIS room defaults to a
     FROZEN sun (§1b — determinism for the probe and the captures), so re-marching an unchanged LUT
     60x/s would be pure waste. `updateRender` is uniforms-only and stays unconditional because the
     CAMERA moves every frame even when the sun does not. */
  if (Math.abs(sun.t - _lastSunT) > 1e-6) { sky.updateSkyView(sun.sunArc, _skyEye); _lastSunT = sun.t; }
  sky.updateRender(sun.sunArc, _skyEye);

  /* THE WATERLINE ANSWERS THE SAME SUN. Without these four lines the sea is a blue disc; with them
     it carries the sun's own glint, the sky's Fresnel tint and the room's fog, so the shoreline
     reads as one scene with the sky above it. FOG DENSITY, and why it is a converted number: the
     water shader fogs EXPONENTIALLY (1 − exp(−d²·dist²), water.frag) while this room's `scene.fog`
     is LINEAR (near 50, far 300). Handing it `scene.fog.density` — which a THREE.Fog does not have
     — would pass `undefined`. 0.0058 is the exp2 density that reaches ~95% opacity at the linear
     fog's own far plane (√3/300), so the sea fades out where the terrain does. */
  /* GUARDED, because `?regions=off` builds NO water at all (buildWorld only calls buildWater when
     the districts are on) — and that is the exact config the flat-in A-MARRIAGE checksum boots. An
     unguarded tick here would throw on frame 1 of the one URL this arc must not break. */
  if (seaWater) {
    seaWater.update(stats.t);
    seaWater.setSun(sun.sunDir, sun.sunColor);
    seaWater.setSky(sun.hemiSky);
    seaWater.setFog(_fogC, 0.0058);
  }
  for (let i = 0; i < lakeWaters.length; i++) {
    const w = lakeWaters[i];
    w.update(stats.t); w.setSun(sun.sunDir, sun.sunColor); w.setSky(sun.hemiSky); w.setFog(_fogC, 0.0058);
  }

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
    if (clear < minClear.walk) minClear.walk = clear;
    noteRegion(character.x, character.z);

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

    key.position.set(character.x + SUN_OFF.x, SUN_OFF.y, character.z + SUN_OFF.z);
    key.target.position.set(character.x, 0, character.z);
    key.target.updateMatrixWorld();
    rig.setEye(character.cameraPose(_camPos, _camDir), _camDir);
    const wantFov = character.cameraFov(dt);
    if (Math.abs(rig.camera.fov - wantFov) > 0.01) { rig.camera.fov = wantFov; rig.camera.updateProjectionMatrix(); }
  } else {
    /* ---- THE VEHICLE FRAME — ONE path, seven craft (A-DRIVE). This is A-PATCHWORK's bike loop
       with every `bike*` identifier replaced by the ACTIVE roster entry and two lines made
       conditional on data. Nothing here knows what a helicopter is; adding an eighth craft adds
       no code to this block, which is the entire claim the roster makes. ---- */
    const spec = BY_KEY.get(MODE), st = ACTIVE.state;
    AXES.throttle = (held.has('w') ? 1 : 0) - (held.has('s') ? 1 : 0);
    AXES.steer = (held.has('d') ? 1 : 0) - (held.has('a') ? 1 : 0);
    AXES.lift = (held.has('ArrowUp') ? 1 : 0) - (held.has('ArrowDown') ? 1 : 0);
    AXES.boost = held.has('Shift') ? 1 : 0;
    ACTIVE.model.step(st, AXES, dt, VEH_WORLD);
    /* tower collision is the bag's OWN resolveSphere run after the step — one line of wiring, no
       second collider, which is what "ONE world bag serves the married geometry" means. Flyers
       opt OUT by data: a helicopter that got pushed out of a tower would also get pushed out of
       the sky above it, because resolveSphere is a depenetration and not a ceiling test. That is
       an HONEST GAP, not a fix: an aircraft can currently fly through a tower. */
    if (spec.collide) arena.world.resolveSphere(st, dt, spec.profile.collide);
    spacePulse = false; webPressed = false;

    const clear = st.y - HEIGHT(st.x, st.z);
    if (clear < minClear[MODE]) minClear[MODE] = clear;
    noteRegion(st.x, st.z);
    if (st.landing && st.landing.count > lastLandCount) {
      lastLandCount = st.landing.count;
      landings++; if (st.landing.clean) cleans++;
    }
    ACTIVE.body.update(st, dt);
    key.position.set(st.x + SUN_OFF.x, SUN_OFF.y, st.z + SUN_OFF.z);
    key.target.position.set(st.x, 0, st.z);
    key.target.updateMatrixWorld();
    ACTIVE.cam.pose(st, view, dt, heightAt, _bCamPos, _bCamDir);
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

  /* ---- 8c. THE CLOUD TICK + THE PRESENT (A-SKYWORLD). The update sits AFTER `rig.update` on
     purpose: the pass rebuilds a world ray per pixel from the camera's inverse-projection and
     world matrix, so it must read the pose this frame will actually be RENDERED with, not last
     frame's. `skyTint` gets the same `hemiSky` the fog and the water use, so cloud, haze, sea and
     sky are all tinted by one colour and cannot drift apart across the day.
     THE TIER IS THE GOVERNOR'S, exactly as createCityWorld maps it — the engine already measures
     frame cost and steps down; a second opinion about quality here would fight it. At level ≥ 2 the
     pass is skipped ENTIRELY (city's own cutoff) and the frame presents straight to the screen. ---- */
  const cloudsLive = clouds && core.governor.level < 2;
  if (cloudsLive) {
    clouds.update({
      camera: rig.camera, sunDir: sun.sunDir, sunColor: sun.sunColor, skyTint: sun.hemiSky,
      time: stats.t, tierName: core.governor.level === 0 ? CLOUD_TIER : 'MED',
    });
    /* scene -> sceneRT -> composite -> screen. Both buffers are core's, allocated at boot. */
    renderer.setRenderTarget(core.sceneRT);
    renderer.render(scene, rig.camera);
    clouds.pass.render(renderer, null, core.sceneRT);
  } else {
    renderer.setRenderTarget(null);
    renderer.render(scene, rig.camera);
  }
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
  /* A-PATCHWORK's three handles, UNCHANGED IN NAME AND MEANING — the probe reads them and this
     arc must not move what an earlier one proved. They are now VIEWS onto the per-body map. */
  get bike() { return bikeState(); },
  get walkMinClear() { return minClear.walk; },
  get bikeMinClear() { return minClear.bike; },
  get webs() { return stats.webs; },
  /* ---- A-DRIVE receipts. `roster` is the table as SHIPPED (what a probe should assert against,
     rather than a list it carries its own copy of); `veh` is the live craft; `minClear` is every
     body's NO-SINK figure in one object so a run can prove all seven at once. `bodies` reports
     what each mesh actually RESOLVED TO — 'glb' or the 'box' fallback — because a roster that
     silently degraded to seven boxes would otherwise report a perfect drive. ---- */
  roster: () => ROSTER.map((v) => ({
    key: v.key, label: v.label, chip: v.chip, air: !!v.air, collide: !!v.collide,
    model: v.make.name || 'model', where: v.where,
    maxSpeed: v.profile.maxSpeed ?? null, mediumScale: v.profile.mediumScale ?? null,
    built: !!v._inst,
  })),
  get veh() { return ACTIVE ? ACTIVE.state : null; },
  minClear: () => ({ ...minClear }),
  bodies: () => ROSTER.map((v) => ({
    key: v.key,
    mode: v._inst && v._inst.body.mode ? v._inst.body.mode : (v._inst ? 'procedural' : 'unbuilt'),
    spins: v._inst && v._inst.body.nodes ? v._inst.body.nodes : [],
  })),
  waterHeightAt: (x, z) => VEH_WORLD.waterHeightAt(x, z),
  get visited() { return [...visited]; },
  get districts() { return [...new Set(visited)]; },
  get landings() { return { landings, cleans }; },
  layout: () => ({ cols: AR.cols, rows: AR.rows, spacing: AR.spacing, streetW: WP.streetW, maxGrade: WP.maxGrade, seed: WP.seed, preset: WP.preset, worldSize: WP.worldSize, size: WP.size, cityRim: cityRimOf() }),
  /* ---- A-PATCHWORK receipts. `regions()` is the page's OWN counted numbers (the probe never
     re-derives them from pixels); `regionAt` is the ONE "which district is this" answer the mask,
     the lake filter, the HUD and the probe all share. `crossings` lets a driven run prove it
     actually TRAVELLED across districts rather than circled inside one. ---- */
  regions: () => (REG ? {
    keys: REG.keys,
    per: REG.stats.per.map((p) => ({ ...p })),
    unassigned: REG.stats.unassigned, starved: REG.stats.starved, total: REG.stats.total,
    seamGrade: SHAPED.gradeMax, seamBlend: SHAPED.seamBlend, offMax: SHAPED.offMax,
    bowls: SHAPED.bowls.map((b) => ({ ...b })), lakes: LAKES.map((l) => ({ ...l })),
    painted: SHAPED.painted, islandTexels: SHAPED.islandTexels, clamped: SHAPED.clamped,
    trees: TREE_N, dial: WP.maxGrade, seaY: 0,
  } : null),
  regionAt: (x, z) => (REG ? regionAt(REG, x, z) : null),
  /* the offset field's grade, RE-COUNTED live off the page's own arrays — so the probe's proof (d)
     reads the thing on screen and not a number cached at build time. */
  seamSweep: () => {
    if (!SHAPED) return null;
    const size = WP.size, cell = WP.worldSize / (size - 1), off = SHAPED.offset;
    let worst = 0, boundary = 0, nonZero = 0;
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const k = j * size + i, r = REG.region[k];
        if (i < size - 1) worst = Math.max(worst, Math.abs(off[k + 1] - off[k]) / cell);
        if (j < size - 1) worst = Math.max(worst, Math.abs(off[k + size] - off[k]) / cell);
        const diff = (i > 0 && REG.region[k - 1] !== r) || (i < size - 1 && REG.region[k + 1] !== r)
          || (j > 0 && REG.region[k - size] !== r) || (j < size - 1 && REG.region[k + size] !== r);
        if (!diff) continue;
        boundary++;
        if (Math.abs(off[k]) > 1e-9) nonZero++;
      }
    }
    return { worst, boundary, nonZero };
  },
  /* rope percentile over RELATIVE tower heights — the married room's own derivation check:
     swingableRope(relRoof at 1−frac) should hand WORLD_ROPE back (the closed loop, locally). */
  relRoofAt: (p) => {
    const rel = new Float64Array(arena.towers.length);
    for (let k = 0; k < arena.towers.length; k++) rel[k] = arena.towers[k].top - arena.towers[k].y;
    return percentileOf(rel, p);
  },
  buildMs: () => LEVEL_BUILD_MS,
};
/* A-SKYWORLD: whether the deck is actually LIVE, so a capture tool can assert it rather than accept
   an empty sky as a valid frame. Reports 'on' | 'off' (?clouds=0) | 'shed' — that last one is the
   governor having stepped past level 1 and dropped the pass, which is a legitimate runtime state but
   NOT a frame you should file as a cloud capture. A boolean could not tell those apart. */
window.__cloudsState = () => (!clouds ? 'off' : core.governor.level < 2 ? 'on' : 'shed');
window.__spawn = spawn;
/* A-DRIVE: clear the receipt counters WITHOUT moving the body. `spawn` already does this, but it
   also teleports the walker to the city edge — so a probe that wants each craft's NO-SINK figure
   to be ITS OWN run, starting from a chosen district seam, had no way to ask. Without this the
   seventh craft inherits the worst dip of the six before it and the number means nothing. */
window.__resetStats = resetStats;
/* A-DRIVE widened this from the bike-or-walk pair to the whole roster. It goes through `pick`, not
   `setMode`, so a probe-driven change moves the dock chips exactly as a human's click does — a
   handle that took a shortcut past the UI would let the probe prove a state the player cannot
   reach. An unknown key still lands on foot (setMode's own refusal), never nowhere. */
window.__setMode = (m) => { pick(m); return MODE; };
/* the body loaders' readiness, so a probe can WAIT for the GLB instead of racing it (a capture
   taken mid-fetch shows a fallback box and would be filed as an art failure). Only built craft
   have a promise — an unentered one has loaded nothing, which is the point of lazy building. */
window.__vehReady = (k) => {
  const v = BY_KEY.get(k);
  return v && v._inst && v._inst.body.ready ? v._inst.body.ready : Promise.resolve('procedural');
};
/* the determinism receipt (moto-lab's own): FNV-1a over the CARVED height buffer — two boots of one
   URL must agree byte-for-byte. */
window.__terrainChecksum = () => {
  let h = 0x811c9dc5;
  const b = new Uint8Array(T.height.buffer);
  for (let i = 0; i < b.length; i++) { h ^= b[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
};
