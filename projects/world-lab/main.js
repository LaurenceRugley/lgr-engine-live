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
  generateScatter, buildScatterGroup, createTreeKit, hashTreeInstances, mulberry32,
  /* ARC A-SANDBOX — A-FLORA'S KITS FINALLY HAVE A CONSUMER. Every name on the next three lines was
     built, receipt-gated and shipped on 2026-08-21 with ZERO consumers anywhere in the repo: the
     second tree family, the sparse dead-snag accent, and the four ground-cover families. They are
     split per family ON PURPOSE (see createTreeKit.js's header) because the broadleaf:snag and
     tuft:rock ratios are the ROOM's decision, not the .glb's — handing one list of all eight
     ground-cover variants to `assignTreeVariants` would put as many boulders on a lawn as grass.
     `swayWind`/`swayTime` are the L94 breeze's drive handles — see the barrel's own note. */
  BROADLEAF_KIT_VARIANTS, DEAD_KIT_VARIANTS,
  GROUNDCOVER_BUSH_VARIANTS, GROUNDCOVER_FERN_VARIANTS,
  GROUNDCOVER_TUFT_VARIANTS, GROUNDCOVER_ROCK_VARIANTS,
  swayTime, swayWind,
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
  /* ARC A-NIGHTFALL — the night half §1c said was unfinished. Same story as the block above: all
     three already existed in engine-core and this room had never asked. `createNightSky` is the
     star/constellation/nebula layer (it was only reachable INSIDE createCelestials until this arc
     barrel-exported it); `createStreetKit` is the lamp-post + additive-glow dressing swing-lab's
     city already wears. */
  createNightSky, createStreetKit,
  /* A-SANDBOX: L18's weather rig — in engine-core since Lesson 18, asked for by this room never. */
  createWeatherRig,
  /* ARC A-GUN — the walker CARRIES something. The ability is engine-core's (carried-weapon.js:
     the carry transform, the mount-IK sockets, the shot); this room supplies the aim point, the
     world query, the body and the key. */
  createCarriedWeapon,
} from '@lgr/engine-core';
import sidearmUrl from '@lgr/engine-core/assets/models/sidearm.glb?url';   // A-GUN — build_sidearm.py
import survivorUrl from '@lgr/engine-core/assets/models/survivor.glb?url';
import treeKitUrl from '@lgr/engine-core/assets/models/tree_kit.glb?url';   // A-TREEKIT's conifer kit — the woods
/* A-SANDBOX: A-FLORA's two kits. Both were generated, committed and then imported by NOTHING —
   `broadleaf_kit.glb` carries the 4 broadleaves AND the 2 dead snags in ONE file (which is why two
   `createTreeKit` calls below share this single url), `groundcover_kit.glb` the 8 ground-cover
   variants. The `?url` import lives HERE and not in the engine for the pedestrians.js reason: a
   `?url` inside the lib base64-inlines the asset into every bundle that imports the barrel. */
import broadleafKitUrl from '@lgr/engine-core/assets/models/broadleaf_kit.glb?url';
import groundcoverKitUrl from '@lgr/engine-core/assets/models/groundcover_kit.glb?url';
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
/* A-NIGHTFALL TRIED A RAISED AMBIENT FLOOR HERE AND CUT IT, and the negative result is worth more
   than the code would have been. A `withLegibleNight()` keyframe transform (night hemisphere colours
   lifted 2.8x ground / 1.22x sky) was built, wired, and MEASURED against an otherwise identical
   build: street 90.6% vs 90.7% near-black, air 59.8% vs 60.3% — inside the noise. Sweeping the
   hemisphere fill INTENSITY instead, from 0.85 up to 7.0, moved the night street only 90.6% -> 88.4%
   with the median pixel still at luma 4. The ambient simply cannot carry this room's night: the
   canyon is 4.6 u wide under towers up to 14 u, and long before an ambient lift clears the
   legibility threshold it has washed the night's colour out — the exact failure this arc is supposed
   to avoid. What DOES work here is practicals (see buildStreetKit), which is also what the eye reads.
   NOTE the ambient is not innocent, it is just not a NIGHT problem: the same sweep at NOON goes
   91.1% -> 0.6% near-black between fill 0.85 and 6.0, i.e. this room's DAYLIGHT street is crushed
   too, and that is a separate defect this arc measured and deliberately did not widen its scope into. */
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

/* ---- A-NIGHTFALL §1c. THE NIGHT SKY. `createNightSky` is the engine's existing star field, and it
   is added as a plain scene object beside the Hillaire mesh rather than through `createCelestials` —
   this room draws its own sun disc (§1b, `sunDisc: true`) and adopting celestials wholesale would put
   a SECOND sun in a frame whose comment three lines up promises exactly one.
   It is driven by `nightK` and rides the camera (`place`), so the stars have zero translation
   parallax — the same trick the sun/moon use, and the reason a star field does not smear when the
   plane moves. Its own `update()` handles the twinkle freeze under prefers-reduced-motion. */
const nightSky = createNightSky({});
scene.add(nightSky.group);
/* WCAG 2.3.1 — the star twinkle is the only thing in this room that flashes, and a user who has
   asked the OS for less motion gets it frozen. Queried ONCE and read per frame (matchMedia's
   `.matches` is live), the same shape celestials.js uses for the same layer. */
const _RM = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;

/* THE NIGHT FLOOR'S TWO COLOURS come from the SunRig's own NIGHT keyframe (`sky` #36486e zenith,
   `horizon` #1e2942), read ONCE here rather than per frame. They are the palette the whole day/night
   cycle is already authored in, so the sky the atmosphere stops being able to compute hands over to
   the same author — one night, not two. Read once because the rig's live `sky`/`horizon` objects are
   LERP TARGETS that drift with t; sampling them at 14:00 would floor the night sky in afternoon mauve. */
const NIGHT_SKY_ZENITH = '#36486e';
const NIGHT_SKY_HORIZON = '#1e2942';
/* THE GAIN IS MEASURED, NOT CHOSEN — the same discipline as this room's `skyexp` two blocks up.
   Flooring the sky with those two hexes at gain 1 closed the inversion at deep night but LEFT IT
   STANDING through twilight: at t=0.78 the sky came out at luma 24.2 against a sea at 27.0. Solving
   the sea's response from both measured arms (water = A*uLight + B) shows why, and it is not a
   tuning failure — B, the part dimming the water CANNOT remove, is 22.9 there. That floor is the
   fresnel of a still-luminous twilight sky plus the moon's glint path, and it is CORRECT: a sea at
   civil twilight really does mirror a bright sky. So the fix belongs on the sky side — the sky has
   to out-shine the sea it is lighting — and 2.2 is the smallest gain that clears all four sampled
   elevations with margin (35.0 vs 27.0 at the worst of them).
   HYPOTHESIS for WHY the authored hex lands dim, offered as a hypothesis because it was not
   isolated: a THREE.Color built from an sRGB hex stores LINEAR components, while this shader adds
   the floor straight into a value it then writes to gl_FragColor itself, so the authored colour is
   being mixed in a different space from the one it was picked in. The gain is the compensation that
   was measured; the mechanism is not proven. */
const NIGHT_SKY_GAIN = 2.2;
/* Hoisted and scaled ONCE — engine-invariants §7 forbids allocating a Color per frame, and these
   two never change after boot. */
const _nightZen = new THREE.Color(NIGHT_SKY_ZENITH).multiplyScalar(NIGHT_SKY_GAIN);
const _nightHor = new THREE.Color(NIGHT_SKY_HORIZON).multiplyScalar(NIGHT_SKY_GAIN);

/* THE DAY, AND WHY IT DOES NOT MOVE UNLESS YOU ASK. `t` ∈ [0,1) is SunRig's one scalar: 0 night,
   0.25 dawn, 0.5 noon, 0.75 dusk. The default 0.62 is LATE AFTERNOON — chosen to preserve exactly
   what §1's original comment said this room wanted ("the key is warm and low-ish… so the city has
   something to be a silhouette against"), so the arc changes how the light is COMPUTED without
   changing what the room is lit LIKE.
   AUTO IS OFF BY DEFAULT AND THAT IS A CORRECTNESS DECISION, not a taste one: a room that drifts
   through the day is a room whose captures, whose probe phases and whose two-boot receipts all read
   a different frame every run. `?daycycle=1` opts in; `?t=` scrubs to a fixed time.

   THE NIGHT HALF — CLOSED BY ARC A-NIGHTFALL (2026-08-22). What this comment used to record as an
   OPEN was measured before it was fixed, so the defect is on the record as numbers rather than as a
   description: at every sampled elevation below the horizon the SEA WAS BRIGHTER THAN THE SKY —
   Rec.709 luma sky 15.2 vs water 36.0 at t=0.78, and 3.9 vs 18.0 at midnight (tools/night-legibility.mjs).
   TWO independent causes, and fixing either one alone would have left the inversion standing:
     · the sky had no night term at all — Hillaire has nothing left to in-scatter below the horizon,
       so `lum * uExposure` fell to ~0. Cured by `sky.setNight()` (§8b), a FLOOR added after exposure.
     · the water had no light term at all — `water.frag` wrote its shallow/deep ramp straight to the
       framebuffer with no N·L anywhere, so the sea physically could not get dark. Cured by
       `setLight()` on the same clock.
   Stars are part of the sky fix and not decoration: a floor alone is a flat blue wall, and what makes
   a night sky read as depth rather than as paint is that it has things IN it. */
const sun = core.sunRig;
sun.goTo(qNum('t', 0.62), true);              // snap — no easing on boot, so frame 1 is already right
/* ARC A-SANDBOX: the cycle gets DIALS, and the auto-off default is kept exactly as argued above.
   `?daycycle=1` still opts in and `?pace=` still sets the seconds-per-day; what is new is that both
   are reachable from the dock, and that pausing puts the clock back under `?t=` control — so the
   probe, the two-boot receipts and every capture can still pin time to a fixed scalar. A running
   clock that could not be stopped would break determinism for the whole room; a running clock with
   a pause button and an absolute scrub does not. */
const DAY = { auto: Q.get('daycycle') === '1', pace: qNum('pace', 90) };
sun.setPace(DAY.pace);
sun.setAuto(DAY.auto);
/* the KEY LIGHT'S OFFSET, derived from the sun instead of hard-coded. The magnitude is held at ~20 u
   because the shadow camera above is a ±30 u box with far 80 — a light placed further out than that
   drops the world out of its own shadow frustum. The y floor keeps the key above the ground even at
   dusk (SunRig already flips `sunDir` to the MOON below the horizon, so y is never negative — the
   floor is belt-and-braces against a grazing sun, not a second opinion about night). */
const SUN_OFF = { x: 9, y: 16, z: 7 };
const _fogC = new THREE.Color();
let _lastSunT = -1;                           // forces the first sky-view march (see §8b's dirty check)

/* ---------------------------------------------------------------------------------------------
   1b-bis. THE WEATHER (ARC A-SANDBOX). `createWeatherRig` is L18 and has existed in engine-core
   the whole time; this room had never asked it for anything — the same wiring drift as the flora
   and the wind. It is a SIBLING of the SunRig by design: it knows nothing about any world, owns
   its own two instanced particle pools, and exposes EASED scalars a room composes on top of its
   own lighting rather than a rewrite of it.

   TWO THINGS HAD TO BE CONFIGURED, and neither is a capability — both are this room's SCALE.
     · The rig is authored at CITY scale: a rain streak is a 0.015 × 0.5 u quad and the recycle
       band runs y 0.25 → 11. This world's hero is 0.30 u tall, so an unscaled streak would be
       1.6× the player's height and the rain would fall from 36 hero-heights up. Scaling the whole
       GROUP is the correct lever rather than new constants: a uniform scale takes the streak
       length, the column, the fall distance AND the fall speed down together, which is exactly
       what "the same weather in a smaller world" means.
     · The column is centred on the group's origin, so at world scale it would rain in one small
       patch near (0,0). The group FOLLOWS the body each frame (§8b-ter) — the standard trick for
       a local precipitation volume, and the reason `extent` is set wide rather than the group
       being huge.
   `easeScale` 0.35 makes weather GATHER over several seconds instead of snapping on in ~1 s —
   hoard2's own setting, and the module's stated reason for the parameter. */
const WEATHER_KINDS_UI = ['clear', 'rain', 'snow', 'fog'];
const WEATHER_SCALE = 0.2;
const weather = createWeatherRig({ extent: 40, easeScale: 0.35 });
weather.group.scale.setScalar(WEATHER_SCALE);
scene.add(weather.group);
{
  const w0 = String(Q.get('weather') || 'clear').toLowerCase();
  weather.setKind(WEATHER_KINDS_UI.includes(w0) ? w0 : 'clear');
}
/* the fog's CLEAR-WEATHER numbers, kept so the weather modifier is a departure FROM them rather
   than a new pair of magic constants — and so turning weather off restores the room exactly. */
const FOG_CLEAR = { near: 50, far: 300 };

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
/* A-NIGHTFALL: the street dressing. ON by default in this room — unlike swing-lab, where the whole
   A-DRESS layer is opt-in behind `?street=1` to keep its 27-check probe on a bare grid, THIS room's
   arc is "light the city", so an unlit city is the ablation arm and not the default. `?street=0`
   is that arm, and it is what the perf delta below is measured against. */
let streetKit = null;
const STREET_ON = Q.get('street') !== '0';
let LEVEL_BUILD_MS = 0;
let REG = null, SHAPED = null;                   // the region field + its shaping report
/* `seaMesh` used to live here and was dropped when A-SKYWORLD replaced the flat transparent plane
   with `createWaterSurface`; the declaration outlived its six uses. Removed 2026-08-21 after that
   arc's refutation found it — worth noting that `.oxlintrc.json` disables `no-unused-vars`, so the
   lint gate structurally cannot catch this class and a human read is the only thing that will. */
let scatterGroup = null, treeGroup = null, lakeGroup = null;
let LAKES = [], TREE_N = 0;
/* A-SANDBOX: the six kit groups this room now also plants, and the counted receipt of what went
   into them. `floraGroups` exists so the rebuild teardown has ONE list to walk — the failure mode
   it prevents is a group that is removed from the scene on rebuild but never disposed (or, worse,
   disposed but left in the scene), which is how a "rebuild" leaks a forest per slider drag. */
let floraGroups = [];
let FLORA_N = { conifer: 0, broadleaf: 0, snag: 0, bush: 0, fern: 0, tuft: 0, rock: 0, procTree: 0, procTuft: 0, procRock: 0 };

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
/* A-SANDBOX: `?flora=proc` turns off THE WHOLE KIT ARM, conifers included, and that is a defect
   this arc's own check caught rather than a design. The first cut gated only the five NEW kits, so
   `?flora=proc` left 520 conifers standing while the dock button read "kit flora: off" — a control
   that states the opposite of what the world is doing, which is the exact failure class this arc
   exists to remove. `?trees=proc` survives as the older, NARROWER alias (conifers only), because it
   predates this room's flora and A-MARRIAGE-era links use it. Two params, one of which is a strict
   subset of the other, both stated. */
const FLORA_ON = Q.get('flora') !== 'proc';
const treeKit = (!FLORA_ON || Q.get('trees') === 'proc') ? null : createTreeKit({ url: treeKitUrl });

/* ---------------------------------------------------------------------------------------------
   2c-bis. THE REST OF THE FLORA (ARC A-SANDBOX, 2026-08-22).
   ------------------------------------------------------------
   A-FLORA built a broadleaf family, a dead-snag accent and four ground-cover families, proved each
   one's generator with receipts, and then wired them into NOTHING. This block is the consumer.

   FOUR DIALS, all of them URL params first and sliders second (this room's standing rule — a
   tuning you like has to be a LINK or it is not shareable):
     ?flora=proc   every kit off; the procedural cones/rocks/tufts are the A/B control arm
     ?gc=<0..1.5>  ground-cover density multiplier (1 = plant every candidate the placer offered)
     ?snags=<0..0.3> the fraction of tree candidates that become DEAD SNAGS instead of live canopy
     ?wind=<0..0.2>  the L94 sway amplitude — see the wind note in §8b

   WHY SIX `createTreeKit` CALLS AND NOT TWO. The loader takes ONE variant list and stamps ONE
   `userData.type`, and both of those are per-FAMILY decisions here:
     · broadleaf and dead share `broadleaf_kit.glb` but must be planted at wildly different
       densities, so they cannot be one near-uniform variant list;
     · the four ground-cover families share `groundcover_kit.glb` and are keyed to DIFFERENT biomes
       (ferns in forest, grass in grassland, scrub elsewhere), which is a per-family placement, not
       a per-instance one.
   The GLB itself is fetched once per url by the browser's own HTTP cache; what is duplicated is a
   parse, at boot, of a 49–81 kB file. That is the price of the split the kit's own header asks for.

   ⚠️ THE BOULDER TRAP, and it is not hypothetical — createTreeKit.js's header names it explicitly:
   a ground-cover ROCK must be created with `type: 'rock'` AND `sway: false`.
     · `type` because `hashTreeInstances` counts every InstancedMesh whose userData.type === 'tree';
       a boulder stamped 'tree' silently joins moto-lab's placement-identity receipt.
     · `sway` because `attachVertexAO(mat, { sway: true })` splices the L94 breeze into the vertex
       stage, and a boulder that sways in the wind is not a boulder.
   Until this arc that second half was UNOBSERVABLE here (`swayWind.value` stayed 0 in every room
   outside createCityWorld), so it is verified below rather than trusted: each kit's material
   reports `customProgramCacheKey()` as 'lgr-ao-sway' or 'lgr-ao', and `window.__flora` publishes it.
   --------------------------------------------------------------------------------------------- */
const FLORA = {
  gc: Math.max(0, Math.min(1.5, qNum('gc', 1.0))),
  snags: Math.max(0, Math.min(0.3, qNum('snags', 0.06))),
  /* 0.045 sits just above createCityWorld's own calm base (0.035 + 0.05·overcast). This room is a
     third the city's scale — the hero is 0.30 u, not 1.8 — so the same amplitude reads as a
     stronger breeze on smaller foliage; it is a look, chosen by eye, and it is a slider. */
  wind: Math.max(0, Math.min(0.2, qNum('wind', 0.045))),
};
const mkKit = (url, variants, opts) => (FLORA_ON ? createTreeKit({ url, variants, ...opts }) : null);
const broadleafKit = mkKit(broadleafKitUrl, BROADLEAF_KIT_VARIANTS, {});
const deadKit = mkKit(broadleafKitUrl, DEAD_KIT_VARIANTS, {});
/* ground cover stamps `type: 'tuft'` (not 'tree') so the scatter vocabulary stays honest, and the
   ROCK family takes the two-part trap treatment the header demands. */
const gcBushKit = mkKit(groundcoverKitUrl, GROUNDCOVER_BUSH_VARIANTS, { type: 'tuft' });
const gcFernKit = mkKit(groundcoverKitUrl, GROUNDCOVER_FERN_VARIANTS, { type: 'tuft' });
const gcTuftKit = mkKit(groundcoverKitUrl, GROUNDCOVER_TUFT_VARIANTS, { type: 'tuft' });
const gcRockKit = mkKit(groundcoverKitUrl, GROUNDCOVER_ROCK_VARIANTS, { type: 'rock', sway: false });
/* the table the builder walks, so adding a seventh family is a row and not a branch. `bucket` is
   the key `partitionFlora` files placements under; `tintOpts` is per-family because `makeTreeTints`
   defaults to GREEN hue poles — right for foliage, wrong for a boulder (the header's own note:
   `sat: 0` drives the model to its pure-value special case, so rocks get lighter/darker rather
   than olive) and wrong for a dead snag (bark, not leaf). */
const FLORA_KITS = [
  { bucket: 'conifer', kit: treeKit, tintOpts: {} },
  { bucket: 'broadleaf', kit: broadleafKit, tintOpts: { warmHue: 0.13, coolHue: 0.33, sat: 0.42 } },
  { bucket: 'snag', kit: deadKit, tintOpts: { warmHue: 0.08, coolHue: 0.10, sat: 0.22, value: [0.70, 1.05] } },
  { bucket: 'bush', kit: gcBushKit, tintOpts: { warmHue: 0.11, coolHue: 0.36, sat: 0.34 } },
  { bucket: 'fern', kit: gcFernKit, tintOpts: { coolHue: 0.40, sat: 0.44 } },
  { bucket: 'tuft', kit: gcTuftKit, tintOpts: { warmHue: 0.14, coolHue: 0.31, sat: 0.30 } },
  { bucket: 'rock', kit: gcRockKit, tintOpts: { sat: 0, value: [0.78, 1.20] } },
];
/* ONE readiness promise over all seven kits, and it rebuilds only on FAILURE — which is exactly
   what the single conifer line it replaces did, widened to the whole set. On SUCCESS no rebuild is
   needed at all: `createTreeKit.buildGroup` called before its GLB lands stashes the plan as
   `pending` and populates the very same group object in place when the file arrives, so the first
   build is already the final one. On failure the family's placements must go BACK to the
   procedural arm (`partitionFlora` reads `kit.mode` to decide), and that decision is baked into
   the group that has already been built — hence the rebuild. Six separate `ready.then` handlers
   would have rebuilt the world up to six times at one boot.
   `Promise.all` is safe here even though a kit can fail: createTreeKit RESOLVES with 'failed'
   rather than rejecting, so the set always settles and nothing is left un-counted. */
window.__floraReady = Promise.all(FLORA_KITS.filter((f) => f.kit).map((f) => f.kit.ready))
  .then((modes) => {
    const bad = FLORA_KITS.filter((f) => f.kit).map((f, i) => [f.bucket, modes[i]]).filter(([, m]) => m !== 'kit');
    if (bad.length) {
      console.warn('[flora] kit(s) failed to load — those families fall back to the procedural arm:', bad.map(([b]) => b).join(', '));
      buildWorld();
    }
    return FLORA_KITS.filter((f) => f.kit).length - bad.length;
  });
/* the LIVE closures the arena reads — they always point at the CURRENT carve/sampler, so an
   arena.rebuild after a dial change re-lays towers on the new pads with no re-wiring. */
const groundYAt = (x, z, i, j) => CARVE.padYOf(i, j);
const heightAt = (x, z) => HEIGHT(x, z);

function buildWorld() {
  const t0 = performance.now();
  if (terrainGroup) { scene.remove(terrainGroup); terrainGroup.userData.dispose(); }
  /* A-SANDBOX: `treeGroup` is no longer named here — it is one of `floraGroups` now (the conifer
     one), and listing it in both places would call its `dispose` TWICE per rebuild. Harmless for a
     Three.js InstancedMesh today, but it is the shape of a double-free and the list exists so
     there is exactly one owner of each group. */
  for (const g of [scatterGroup, lakeGroup, ...floraGroups]) if (g) { scene.remove(g); g.userData.dispose(); }
  floraGroups = [];
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
  buildStreetKit();
  LEVEL_BUILD_MS = performance.now() - t0;
}

/* ---- A-NIGHTFALL: THE PRACTICALS. This is the half of the arc that actually makes a night city
   read, and it is worth saying why rather than treating it as decoration: raising the ambient is
   what turns night into grey daylight, whereas a lamp gives the eye an ANCHOR and, more importantly,
   a CONTRAST EDGE — a bright pool with a dark building beside it reads as a lit street, while the
   same street uniformly lifted reads as an overcast afternoon.

   `createStreetKit` is the ability (engine-core, already worn by swing-lab's city); this is wiring
   and the numbers that belong to THIS room. THE ONE ARGUMENT THAT DIFFERS FROM SWING-LAB is
   `groundYAt`: this room's ground is CARVED, so a single `groundY` plane would bury the lamp posts
   on the high pads and float them over the low ones. It is handed the very sampler the arena was
   built with — not a second copy of the same idea.
   `blocked` is swing-lab's own predicate, verbatim in shape: a zero-radius vertical stab through the
   collider at 0.20 u, because where a jittered tower actually stands is a question only the collider
   can answer. Rebuilt with the arena so a live cols/spacing slider moves the lamps with the streets. */
function buildStreetKit() {
  if (streetKit) { scene.remove(streetKit.group); streetKit.dispose(); streetKit = null; }
  if (!STREET_ON) return;
  streetKit = createStreetKit({
    extent: arena.stats.extent,
    spacing: arena.params.spacing,
    groundY: 0,
    /* HEIGHT, not `groundYAt`: this room's `groundYAt` is `CARVE.padYOf(i, j)` and takes CELL
       INDICES — it answers "how high is the pad under tower (i,j)", which is the wrong question for
       something standing in the STREET between them. `HEIGHT` is the carved terrain sampler and is
       the surface a lamp post's foot actually rests on (it is the same function `openSpot` reports
       its own `y` from, which is how this was checked rather than assumed). */
    groundYAt: (x, z) => HEIGHT(x, z),
    seed: WP.seed,
    roadHalf: arena.params.spacing * 0.235,
    step: 1.15,
    lampsPerBlock: 1,
    /* LAMPS ONLY. `createStreetKit` also places trees, benches, hydrants and shelters, and taking its
       defaults cost this room 30 draw calls and 147k triangles (47/271k -> 77/418k) for a vocabulary
       nobody asked for — the request was LIGHT. Zeroed rather than left at their defaults, so the
       cost this arc adds is the cost of the thing it was for. The rest of the kit is one edit away
       for a room that wants dressed streets. */
    tree: 0, bench: 0, hydrant: 0, shelter: 0,
    blocked: (x, z) => arena.world.segmentHit(x, HEIGHT(x, z) + 0.20, z, x, HEIGHT(x, z) + 0.21, z, 0) === 0,
    castShadow: Q.get('propshadow') !== '0',
  });
  scene.add(streetKit.group);
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
  /* A-SANDBOX: the placer's three lists are now SORTED into seven families before anything is
     built. `partitionFlora` is pure and seeded, so the same URL grows the same wood. */
  const plan = partitionFlora(sc.placements);
  /* whatever a live kit claimed leaves the procedural group; whatever it did NOT claim (a failed
     kit, or `?flora=proc`) stays in it. `plan.proc` IS that remainder — computed, not assumed. */
  scatterGroup = buildScatterGroup(plan.proc);
  scene.add(scatterGroup);
  /* TREE_N COUNTS WHAT IS STANDING, not what the kit arm claimed — and that distinction is a defect
     this arc's own check found. The first cut summed only the three kit buckets, so `?flora=proc`
     (every kit off, 520 procedural cones on screen) reported "0 trees" in the HUD and in the probe
     handle. A readout that goes to zero while the world is full of trees is worse than no readout:
     it would have made the control arm look like a broken build. */
  TREE_N = plan.buckets.conifer.length + plan.buckets.broadleaf.length + plan.buckets.snag.length
    + plan.proc.tree.length;
  for (const f of FLORA_KITS) {
    const list = plan.buckets[f.bucket];
    if (!f.kit || f.kit.mode === 'failed' || !list.length) continue;
    /* EVERY family gets its OWN seed stream (`seed ^ bucketSalt`) and not the shared world seed.
       With one seed every kit would draw the SAME variant sequence and the SAME tint sequence, so
       the fern under a broadleaf would be the same relative shade as the broadleaf, forever — a
       correlation you would see as banding long before you worked out why. */
    const g = f.kit.buildGroup(list, { seed: (WP.seed ^ BUCKET_SALT[f.bucket]) >>> 0, tint: f.tintOpts });
    g.userData.floraBucket = f.bucket;              // so the receipts can find a family by name
    scene.add(g);
    floraGroups.push(g);
    if (f.bucket === 'conifer') treeGroup = g;      // the pre-existing handle stays valid
  }
  for (const k of Object.keys(plan.buckets)) FLORA_N[k] = plan.buckets[k].length;
  /* the procedural remainder is counted TOO, and reported separately rather than folded in — the
     two arms look identical in a total and completely different on screen. */
  FLORA_N.procTree = plan.proc.tree.length;
  FLORA_N.procTuft = plan.proc.tuft.length;
  FLORA_N.procRock = plan.proc.rock.length;
}

/* ---- WHICH FAMILY GROWS WHERE — pure, seeded, and the whole of this arc's placement policy. -----
   The rule set is deliberately small and biome-keyed, because the biome buffer is the thing that
   already knows what the ground is; inventing a second classifier here would be a second source of
   truth about the same texel (the `seabedY` lesson, one module over).
     dead snags  a flat `snags` fraction of TREE candidates, drawn FIRST so the fraction means what
                 it says (drawing them last would make it a fraction of what happened to be left).
                 Sparse by construction — this is why A-FLORA split the list from the broadleaves.
     canopy      grassland → broadleaf (a lone tree in open grass reads as deciduous)
                 hills     → conifer   (uplands)
                 forest    → MIXED 50/50, because a real wood is mixed and an all-one-species
                             forest is the single loudest tell that a scatter is procedural.
                 anything else (beach/rock/desert) → conifer, the hardy default.
     ground cover keyed to the REGION, not the biome, and that is a CORRECTION this arc's own check
                 forced. Keying it to the biome the way the canopy is keyed produced TWO ferns in the
                 whole world, because `SCATTER_TABLE` gives the `forest` biome a tree rule and a rock
                 rule and NO tuft rule — so "forest → fern" was very nearly dead code, and the two
                 ferns that did appear came from stray forest texels inside another district. Adding
                 a tuft rule to the engine's table would have fixed it and silently re-scattered
                 every other consumer of `generateScatter` (moto-lab pins a 641-instance placement
                 hash; the city has byte-identical tier baselines), so the table is left alone and
                 the ROOM decides with the field the room owns: `regionAt`.
                   woods district  → fern 70% / bush 30%   (undergrowth under a canopy)
                   desert district → bush                  (dry scrub, the desert's own table)
                   everywhere else → grass tuft 80% / bush 20%
                 The minority share in two of the three is the same anti-monotony argument the mixed
                 forest above rests on: one species per district is the loudest procedural tell there
                 is, and it costs one already-drawn RNG roll to avoid.
                 ROCK placements go to the boulder kit whole — the placer already only offers them
                 on the biomes where rock belongs (beach/forest/hills/rock/desert per SCATTER_TABLE).
   THE RNG IS DRAWN UNCONDITIONALLY, one roll per candidate per decision, BEFORE any branch tests
   it. That is what keeps the stream's position independent of the biome under a given placement,
   so moving the `snags` dial cannot shuffle which variant an unrelated tree three hills away got.
   C++ anchor: a stable_partition over a fixed input sequence with a deterministic PRNG — the
   ordering property is the point, not the randomness. */
const BUCKET_SALT = { conifer: 0x11, broadleaf: 0x27, snag: 0x3d, bush: 0x52, fern: 0x6b, tuft: 0x74, rock: 0x8e };
function partitionFlora(placements) {
  const size = WP.size, cell = WP.worldSize / (size - 1), half = WP.worldSize / 2;
  /* the biome under a placement, read from the SAME buffer + mapping `generateScatter` used to put
     it there — so this cannot disagree with the table that chose the prop in the first place. */
  const biomeAt = (x, z) => {
    const i = Math.max(0, Math.min(size - 1, Math.round((x + half) / cell)));
    const j = Math.max(0, Math.min(size - 1, Math.round((z + half) / cell)));
    return BIOME_KEYS[T.biome[j * size + i]];
  };
  const rng = mulberry32((WP.seed ^ 0xf10a5a) >>> 0);
  const buckets = { conifer: [], broadleaf: [], snag: [], bush: [], fern: [], tuft: [], rock: [] };
  const live = (kit) => !!kit && kit.mode !== 'failed';
  /* the procedural remainder starts EMPTY and is filled only by what no live kit took. */
  const proc = { tree: [], rock: [], tuft: [] };
  const canopyKit = { conifer: treeKit, broadleaf: broadleafKit };

  for (const p of placements.tree) {
    const rSnag = rng(), rMix = rng();               // both drawn before either is read (see above)
    const b = biomeAt(p.x, p.z);
    if (rSnag < FLORA.snags && live(deadKit)) { buckets.snag.push(p); continue; }
    let want;
    if (b === 'grassland') want = 'broadleaf';
    else if (b === 'forest') want = rMix < 0.5 ? 'broadleaf' : 'conifer';
    else want = 'conifer';
    if (live(canopyKit[want])) buckets[want].push(p);
    else if (live(canopyKit[want === 'conifer' ? 'broadleaf' : 'conifer'])) buckets[want === 'conifer' ? 'broadleaf' : 'conifer'].push(p);
    else proc.tree.push(p);                          // no canopy kit at all → the procedural cones
  }
  for (const p of placements.tuft) {
    /* the GROUND-COVER DIAL is a rejection roll, so `gc=0` is bare ground, `gc=1` plants every
       candidate the placer offered, and anything above 1 is simply also "all of them" (the value
       is clamped at construction — a dial that silently does nothing past a point should say so,
       and the slider's max IS that point). */
    const rKeep = rng(), rMix = rng();               // both drawn before either is read
    if (rKeep > FLORA.gc) continue;
    /* the DISTRICT, from the same `regionAt` the mask, the lake filter, the HUD and the probe all
       share — one "which district is this" answer in the room, not a second opinion. */
    const reg = REG ? regionAt(REG, p.x, p.z) : null;
    const want = reg === 'woods' ? (rMix < 0.7 ? 'fern' : 'bush')
      : reg === 'desert' ? 'bush'
        : (rMix < 0.8 ? 'tuft' : 'bush');
    const kit = { bush: gcBushKit, fern: gcFernKit, tuft: gcTuftKit }[want];
    if (live(kit)) buckets[want].push(p); else proc.tuft.push(p);
  }
  for (const p of placements.rock) {
    if (rng() > FLORA.gc) continue;
    if (live(gcRockKit)) buckets.rock.push(p); else proc.rock.push(p);
  }
  return { buckets, proc };
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

/* ---------------------------------------------------------------------------------------------
   ARC A-GUN (2026-08-22) — THE CARRIED SIDEARM. Wiring only: the ability is `createCarriedWeapon`.
   The weapon is STOWED by default and that is a load-bearing default, not a shrug. The owner's
   walk and run are his favourite animations and the mount-IK pass necessarily moves the ARM chains
   while a weapon is held — so "carrying" is an opt-in layer (press G) and the room's resting state
   stays the gait `tools/baselines/walkrun-world-lab.json` was measured on. The LEG chains are never
   touched at all: `mountTargets` publishes hands only, and a limb with no target is skipped.
   `world` is the arena's own bag — the same one the reticle, the chase arm and the wall contact
   already query — so a shot hits the married terrain and the city, and the hit point is a measured
   world point rather than a guess. The bag goes across WHOLE: the engine owns the translation from
   `segmentHit`'s bare `t` to the projectile module's hit record, because that mismatch is a property
   of the two engine seams and not of this room. ------------------------------------------------- */
const sidearm = createCarriedWeapon({
  url: sidearmUrl,
  bodyHeight: HERO_H,
  world: arena.world,
});
scene.add(sidearm.group);
scene.add(sidearm.bullets);
let armed = false;
const _gunTgt = { x: 0, y: 0, z: 0 };
/* THE AIM TARGET, and why it is never null. `resolveAimPoint` answers null on open sky — a
   legitimate answer for a crosshair, and a useless one for a weapon, which must point SOMEWHERE
   every frame. Falling back to a point far down the SAME camera ray the reticle tested makes both
   cases one code path and keeps the two in agreement: aiming at the sky still points the gun along
   the crosshair, it just has nothing to hit. Reads `rig.camera`'s matrix directly, exactly as
   `resolveAimPoint` does, so the gun and the reticle can never disagree about which ray is "look". */
function gunTarget() {
  if (aimHit) return aimHit;
  const e = rig.camera.matrixWorld.elements;
  let fx = -e[8], fy = -e[9], fz = -e[10];
  const fl = Math.hypot(fx, fy, fz) || 1; fx /= fl; fy /= fl; fz /= fl;
  const d = aimReach();
  _gunTgt.x = rig.camera.position.x + fx * d;
  _gunTgt.y = rig.camera.position.y + fy * d;
  _gunTgt.z = rig.camera.position.z + fz * d;
  return _gunTgt;
}
/* ARM / STOW. Stowing must also RELEASE the mount, or the rig keeps solving the arms to a weapon
   that is no longer drawn — the latched-mode bug this repo has written down twice (ENTRY paths
   don't guard what EXIT paths clear). Every exit from armed goes through here. */
function setArmed(on) {
  const want = !!on && sidearm.loaded;
  armed = sidearm.setArmed(want);
  const h = hero.handle;
  if (h && h.setMountIK) h.setMountIK(armed ? sidearm.mountTargets : null);
  return armed;
}

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
      /* A-GUN: LMB is MODAL. Armed, it fires; stowed, it keeps the lock scheme this room shipped
         with, untouched. Splitting on the weapon rather than adding a third button is what keeps
         the walker's existing verbs — and the probe assertions that pin them — exactly as they
         were: with the sidearm stowed (the default) nothing below this line has changed. The
         HOLD-to-keep-firing half lives in the frame loop, gated by the weapon's own cooldown. */
      if (armed) return;
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
      /* A-SANDBOX — THE NOSE POINTED THE WRONG WAY IN THE CLIMB, and the trajectory is why nobody
         caught it: ArrowUp really does gain +16.8 u and `state.pitch` really does read +0.4, so
         every NUMBER said correct while the aeroplane visibly climbed nose-flat-to-down. It took
         looking at a frame. `createBirdModel` composes YXZ(pitch, yaw, bank) and this body's nose
         is +Z, and those two together mean a positive pitch rotates the nose DOWN (the mesh
         module's header does the arithmetic). Corrected HERE, on this one roster row, rather than
         in pilot.js's shared euler — that line also serves models whose art may be authored the
         other way, and it is already internally inconsistent about the sign. Visual only: the
         physics quaternion, the chase camera and the probe receipts are untouched. */
      pitchSign: -1,
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
    /* A-GUN: getting into a craft STOWS the sidearm — and it goes through `setArmed(false)` rather
       than just hiding the mesh, so the rig's mount-IK is released too. Hiding alone would leave
       the arms solving to an invisible weapon for the whole ride: the exact latched-mode shape of
       the walk→drive freeze this room already fixed once. */
    setArmed(false);
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
  /* A-GUN: G draws / holsters the sidearm. Walk mode only — a rider has both hands on the grips,
     and arming mid-ride would have the mount-IK solving the same two hands to two places at once. */
  if (k === 'g') {
    if (MODE !== 'walk') flash('you need both hands to ride — press B to get out first');
    else if (!sidearm.loaded) flash('sidearm did not load — see the console');
    else flash(setArmed(!armed) ? 'sidearm OUT — LMB fires' : 'sidearm stowed — LMB locks again');
  }
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
    /* A-SANDBOX: the flora row reports the SPLIT, not just a total — the whole claim of this arc is
       that a wood is now several species and a sparse accent, and a single "N trees" cannot tell a
       mixed forest from 700 identical cones. Ground cover gets its own row for the same reason. */
    set('v-flora', FLORA_ON
      ? `${TREE_N} — ${FLORA_N.conifer}con ${FLORA_N.broadleaf}bl ${FLORA_N.snag}snag`
      : `${TREE_N} procedural (?flora=proc)`, TREE_N ? 'on' : 'off');
    const gcN = FLORA_N.bush + FLORA_N.fern + FLORA_N.tuft + FLORA_N.rock;
    const procN = FLORA_N.procTuft + FLORA_N.procRock;
    set('v-groundcover', FLORA_ON
      ? `${gcN} — ${FLORA_N.bush}bush ${FLORA_N.fern}fern ${FLORA_N.tuft}tuft ${FLORA_N.rock}rock`
      : `${procN} procedural`, (gcN + procN) ? 'on' : 'off');
    set('v-wind', FLORA.wind > 0 ? `${FLORA.wind.toFixed(3)} — foliage sways` : 'still (?wind=0)', FLORA.wind > 0 ? 'on' : 'off');
    /* the clock's own readout: t, the named phase, and whether it is MOVING. "paused" is stated
       rather than implied because a still sun is this room's determinism guarantee, not an oversight. */
    set('v-day', `t ${sun.t.toFixed(3)} · ${phaseName(sun.t)} · ${DAY.auto ? `${DAY.pace.toFixed(0)}s/day` : 'paused'}`, DAY.auto ? 'on' : 'off');
    /* the weather row reports the EASED scalars, not the requested kind — the kind flips instantly
       and the world takes several seconds to agree, so a row showing only the kind would call it
       raining before a single drop fell. */
    set('v-weather', weather.kind === 'clear' && weather.overcast < 1e-3
      ? 'clear'
      : `${weather.kind} · ${(weather.intensity * 100).toFixed(0)}% · ${weather.rainDropCount} drops`,
    weather.overcast > 1e-3 ? 'on' : 'off');
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
  /* A-SANDBOX: the flora dials, so a `?gc=0.3&wind=0` link OPENS with its sliders already in that
     position. The failure this prevents is the one every URL-param-plus-slider pair has: the world
     obeys the link and the dock shows the default, so the first drag of any slider snaps the world
     back to a state the visitor never asked for. */
  for (const [id, key, dec] of [['gc', 'gc', 2], ['snags', 'snags', 2], ['wind', 'wind', 3]]) {
    const el = $('p-' + id); if (!el) continue;
    el.value = String(FLORA[key]);
    $('n-' + id).textContent = Number(FLORA[key]).toFixed(dec);
    el.disabled = !FLORA_ON && key !== 'wind';   // procedural arm: cover/snags have nothing to sort
  }
  const fb = $('b-flora');
  if (fb) { fb.textContent = FLORA_ON ? 'kit flora: on' : 'kit flora: off'; fb.setAttribute('aria-pressed', String(FLORA_ON)); }
  /* A-SANDBOX: the sky bay. `time of day` reads the LIVE sun rather than a stored request, so while
     the cycle runs the slider tracks it — the dial and the world cannot disagree about what time it
     is, which is the whole failure mode a "set-only" control has. */
  const pt = $('p-t');
  if (pt) { pt.value = String(sun.t.toFixed(3)); $('n-t').textContent = sun.t.toFixed(3); }
  const pp = $('p-pace');
  if (pp) { pp.value = String(DAY.pace); $('n-pace').textContent = String(Math.round(DAY.pace)); }
  const db = $('b-daycycle');
  if (db) { db.textContent = DAY.auto ? 'cycle: running' : 'cycle: paused'; db.setAttribute('aria-pressed', String(DAY.auto)); }
  for (const k of WEATHER_KINDS_UI) {
    const b = $('b-weather-' + k);
    if (b) b.setAttribute('aria-pressed', String(weather.kind === k));
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
  /* the sidearm button routes through the SAME branch the G key does rather than calling setArmed
     directly — one path, so the walk-mode guard and every message stay in agreement. (A dock button
     that bypasses the key handler is how two controls for one verb start disagreeing.) */
  $('b-gun').addEventListener('click', () => {
    if (MODE !== 'walk') flash('you need both hands to ride — press B to get out first');
    else if (!sidearm.loaded) flash('sidearm did not load — see the console');
    else flash(setArmed(!armed) ? 'sidearm OUT — LMB fires' : 'sidearm stowed — LMB locks again');
  });
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
  /* ---- A-SANDBOX: THE FLORA DIALS. `gc` and `snags` change WHAT IS PLANTED, so they re-run the
     build — but unlike every world dial above they do NOT respawn, because they do not move the
     ground: the heightfield, the pads and the towers come out of a deterministic rebuild
     byte-identical, so teleporting the player would be a side effect with no cause. (That identity
     is exactly what keeps the pinned terrain checksum valid while these sliders exist.)
     `wind` writes a shader uniform and needs no rebuild at all — the next frame is already windier. */
  for (const [id, key, dec, rebuild] of [['gc', 'gc', 2, true], ['snags', 'snags', 2, true], ['wind', 'wind', 3, false]]) {
    const el = $('p-' + id); if (!el) continue;
    el.addEventListener('input', () => {
      FLORA[key] = Number(el.value);
      $('n-' + id).textContent = Number(el.value).toFixed(dec);
      if (!rebuild) return;
      buildWorld();
      const gcN = FLORA_N.bush + FLORA_N.fern + FLORA_N.tuft + FLORA_N.rock;
      flash(`${TREE_N} trees (${FLORA_N.snag} snags) · ${gcN} ground cover`);
    });
  }
  /* ---- A-SANDBOX: THE SKY BAY. All live — the sun rig and the weather rig are both per-frame
     scalar machines, so nothing here rebuilds anything. ---- */
  const ptEl = $('p-t');
  if (ptEl) {
    ptEl.addEventListener('input', () => {
      /* SCRUBBING PAUSES THE CLOCK, and that is the determinism contract rather than a convenience:
         if dragging the time slider left the cycle running, the value you just chose would start
         drifting out from under you and no capture taken afterwards could be reproduced from the
         URL. Grab the handle, own the time. */
      if (DAY.auto) { DAY.auto = false; sun.setAuto(false); }
      sun.goTo(Number(ptEl.value), true);
      syncDock();
    });
  }
  const ppEl = $('p-pace');
  if (ppEl) {
    ppEl.addEventListener('input', () => {
      DAY.pace = Number(ppEl.value); sun.setPace(DAY.pace);
      /* the rig CLAMPS pace to its own bounds, so read the accepted value back rather than echoing
         the request — a dial that displays a number the engine refused is a dial that lies. */
      DAY.pace = sun.pace; syncDock();
      flash(`one world day = ${DAY.pace.toFixed(0)} s`);
    });
  }
  $('b-daycycle').addEventListener('click', () => {
    DAY.auto = !DAY.auto; sun.setAuto(DAY.auto); syncDock();
    flash(DAY.auto ? `day running · ${DAY.pace.toFixed(0)} s per day` : `day paused at t=${sun.t.toFixed(3)}`);
  });
  /* REAL-TIME IS THE SLOWEST THE ENGINE ALLOWS, AND IT IS NOT 1:1 — said out loud rather than
     quietly approximated. A true real-time day is 86400 s; sun-rig.js clamps `setPace` to
     PACE_MAX = 900 s, a bound it shares with lgr-live-sky's setTimeSpeed so the two apps' time
     controls stay one family. 900 s = a 15-minute day, i.e. 96× real time. Raising that ceiling is
     an engine change to a SHARED clamp with a second consumer, so it is reported, not taken. */
  $('b-realtime').addEventListener('click', () => {
    DAY.pace = 900; sun.setPace(900); DAY.pace = sun.pace;
    DAY.auto = true; sun.setAuto(true); syncDock();
    flash('slowest the engine allows: 900 s/day (96× real time — see the pace note)');
  });
  $('b-noon').addEventListener('click', () => {
    if (DAY.auto) { DAY.auto = false; sun.setAuto(false); }
    sun.goTo(0.5, true); syncDock(); flash('noon · t=0.500');
  });
  /* the weather chips are BUILT FROM THE RIG'S OWN VOCABULARY, the roster-bay pattern one bay down:
     a kind added to WEATHER_KINDS in the engine appears here without touching this file. */
  const wbay = $('weather-bay');
  if (wbay) {
    for (const k of WEATHER_KINDS_UI) {
      const b = document.createElement('button');
      b.id = 'b-weather-' + k;
      b.textContent = k;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', () => {
        weather.setKind(k); syncDock();
        flash(k === 'clear' ? 'weather clearing' : `weather: ${k} — it eases in over a few seconds`);
      });
      wbay.appendChild(b);
    }
  }
  /* the kit/procedural A/B is a RELOAD, honestly, because the kits are constructed once at module
     scope (moto-lab's "the GLB loads a single time" rule). Rebuilding them live would mean a second
     construction path that the URL arm does not use — two ways to reach one state is how the two
     start disagreeing. So the button goes where the link goes. */
  $('b-flora').addEventListener('click', () => {
    const p = currentParams();
    if (FLORA_ON) p.set('flora', 'proc'); else p.delete('flora');
    location.search = p.toString();
  });
  $('b-copy').addEventListener('click', () => {
    const url = location.origin + location.pathname + '?' + currentParams().toString();
    if (navigator.clipboard) navigator.clipboard.writeText(url).catch(() => {});
    flash('url copied');
  });
  const dock = $('dock');
  $('dock-toggle').addEventListener('click', (e) => { e.stopPropagation(); dock.classList.toggle('min'); $('dock-toggle').textContent = dock.classList.contains('min') ? '+' : '–'; });
}

/* ---- THE ROOM'S STATE AS A LINK, in ONE place (A-SANDBOX). This was inline in the copy-url
   handler; the flora A/B button needs the identical set, and two builders for one URL is how a
   param quietly stops being shareable from one of them (which is the exact gap the `spacing`
   comment above records A-LAUNCH paying for). Written from the LIVE objects, so what you copy is
   what is in force — not what the sliders were built with. ---- */
function currentParams() {
  const p = new URLSearchParams();
  p.set('seed', WP.seed); p.set('grade', WP.maxGrade); p.set('street', WP.streetW);
  p.set('cols', AR.cols); p.set('spacing', AR.spacing); p.set('woods', WP.woods);
  /* THE PHYSICS GOES IN THE URL TOO, which is the whole point of the copy button: a swing that felt
     right is a rope length and a gravity, and a link that carries the world but not the body is a
     link to a different experiment. */
  for (const [param, key] of PHYS) p.set(param, SWING[key]);
  /* A-SANDBOX: and so does the flora. Three dials that change what the world LOOKS like, written
     unconditionally rather than only-when-non-default, because the whole point of the link is that
     the recipient sees what the sender saw — a default that changes in a later arc would silently
     re-render every link ever copied. `flora=proc` is the one written conditionally: it is a MODE,
     not a value, and its absence is the state. */
  p.set('gc', FLORA.gc); p.set('snags', FLORA.snags); p.set('wind', FLORA.wind);
  if (!FLORA_ON) p.set('flora', 'proc');
  /* A-SANDBOX: the SKY. `t` is written from the LIVE sun, so a link copied while the cycle was
     running reopens at the moment it was copied rather than at the moment it was started — which
     is what makes "I found a beautiful dusk, here it is" a working sentence. `daycycle` is written
     only when running, on the same MODE-not-value rule as `flora=proc`. */
  p.set('t', sun.t.toFixed(3));
  if (DAY.auto) { p.set('daycycle', '1'); p.set('pace', DAY.pace); }
  if (weather.kind !== 'clear') p.set('weather', weather.kind);
  if (MODE !== 'walk') p.set('mode', MODE);
  if (WP.preset !== 'valley') p.set('preset', WP.preset);
  if (!WP.regions) p.set('regions', 'off');
  return p;
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

  /* ---- 8b-bis. THE WIND (ARC A-SANDBOX). Two assignments, and they close a five-lesson gap.
     `attachVertexAO(mat, { sway: true })` has been splicing the L94 breeze into every foliage
     material in this engine since L94 — the scatter props, the conifer kit, and now five more kits
     — and its amplitude reads the shared `swayWind` uniform object BY REFERENCE. The only code that
     ever WROTE that object was createCityWorld's own tick, and the two handles were not on the
     package barrel at all, so every room that does not boot the procedural city (this one,
     moto-lab, swing-lab) compiled the sway branch into its shaders and then left the amplitude at
     zero forever. Dead instructions on the GPU, and foliage that had never once moved.
     Cost: two scalar writes per frame into objects three.js already holds. There is no per-frame
     allocation here and no new uniform — docs/engine-invariants.md §7 stays satisfied.
     C++ anchor: `swayWind` is a `struct { float value; }` the shader holds a pointer to; this is
     the one line that was missing an assignment to it.
     `?wind=0` is a bit-exact no-sway A/B arm — vector-style.js's own note: amplitude 0 leaves
     `transformed` untouched to the bit, so the control arm is the pre-arc frame, not an approximation. */
  swayTime.value = stats.t;
  swayWind.value = FLORA.wind;

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

  /* ---- 8b-ter. THE WEATHER TICK (ARC A-SANDBOX). The rig owns its particles; the ROOM owns what
     weather does to its own light, which is the "compose, don't fork" contract in weather-rig.js's
     header. Three composed terms, each a departure from the clear-weather value rather than a
     replacement for it, so `clear` restores this room exactly (overcast eases to 0 → every line
     below collapses to the number it had before this arc — that is the byte-identical arm, and it
     is why FOG_CLEAR exists as a named pair instead of two literals inlined here):
       · the KEY dims — an overcast sky is a diffuser, so the sun loses its edge
       · the FILL lifts — that light did not vanish, it arrived from everywhere instead
       · the FOG closes in — the single strongest cue that the air has water in it
     `fog` is the rig's own separate scalar (the 'fog' KIND), added on top of the generic overcast
     haze so choosing fog reads as more than "rain without the rain". */
  weather.update(dt, stats.t);
  /* THE COLUMN FOLLOWS THE CAMERA. The rig's particles live in a box around its group origin; left
     at the world origin it would rain on one patch of the city and nowhere else.
     THE CAMERA AND NOT `_camPos`, deliberately: `_camPos` is written only inside the WALK branch
     (§8's `character.cameraPose`), so a rider would have dragged the weather column along behind
     wherever they last stood on foot — dry air in every vehicle, which is precisely the kind of
     mode-dependent hole this arc keeps finding. `rig.camera.position` is true in every mode.
     It is one frame stale here (the rig is posed later in the frame) and that is deliberate too:
     re-ordering the tick to chase a frame would put the weather ahead of the sun it composes with.
     `.set` on an existing Vector3 — no allocation (engine-invariants §7). */
  const _wc = rig.camera.position;
  weather.group.position.set(_wc.x, HEIGHT(_wc.x, _wc.z), _wc.z);
  const wOver = weather.overcast;
  if (wOver > 1e-4) {
    key.intensity *= 1 - 0.55 * wOver;
    fill.intensity += 0.35 * wOver;
    const wFog = Math.min(1, wOver * 0.55 + weather.fog * 0.45);
    scene.fog.near = FOG_CLEAR.near * (1 - 0.82 * wFog);
    scene.fog.far = FOG_CLEAR.far * (1 - 0.72 * wFog);
  } else { scene.fog.near = FOG_CLEAR.near; scene.fog.far = FOG_CLEAR.far; }

  /* THE SKY-VIEW LUT IS RE-MARCHED ONLY WHEN THE SUN ACTUALLY MOVED. It is a 200x100 raymarch and
     the city pays it every frame because the city's sun is always creeping; THIS room defaults to a
     FROZEN sun (§1b — determinism for the probe and the captures), so re-marching an unchanged LUT
     60x/s would be pure waste. `updateRender` is uniforms-only and stays unconditional because the
     CAMERA moves every frame even when the sun does not. */
  if (Math.abs(sun.t - _lastSunT) > 1e-6) { sky.updateSkyView(sun.sunArc, _skyEye); _lastSunT = sun.t; }
  sky.updateRender(sun.sunArc, _skyEye);

  /* ---- 8b-quater. NIGHT (ARC A-NIGHTFALL). ONE scalar drives all four consumers, for the same
     reason the whole day runs off one `t`: a sky, a sea, a star field and a street full of lamps
     that each decided independently when night had begun would cross over at four different times,
     and the eye reads that as four bugs.
     `nightK` is `celestials.js`'s OWN formula (`smoothstep(-arc.y, -0.05, 0.18)`), copied
     deliberately rather than invented — it is the curve the engine's existing night layers already
     fade on, and `nightSky` below is one of those layers. 0 while the sun is up, 1 once it is
     properly down, and it uses `sunArc` (the raw sun) rather than `sunDir` (which SunRig has already
     flipped to the moon) — the moon's direction cannot tell you whether it is night. */
  const nightK = THREE.MathUtils.smoothstep(-sun.sunArc.y, -0.05, 0.18);
  sky.setNight(nightK, _nightZen, _nightHor);
  nightSky.update(nightK, 'realistic', stats.t, !!(_RM && _RM.matches));
  nightSky.place(rig.camera);

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
  /* A-NIGHTFALL: `setLight` is the OTHER half of the inversion fix and it belongs here, beside the
     three lines that already hand the water this room's sun/sky/fog — the water was answering every
     part of the day except how much light there was. 0.26 at full night rather than 0 because a sea
     under a moon is dark, not black, and because the fresnel term still needs a base to tint. */
  const waterLight = 1 - 0.74 * nightK;
  if (seaWater) {
    seaWater.update(stats.t);
    seaWater.setSun(sun.sunDir, sun.sunColor);
    seaWater.setSky(sun.hemiSky);
    seaWater.setFog(_fogC, 0.0058);
    seaWater.setLight(waterLight);
  }
  for (let i = 0; i < lakeWaters.length; i++) {
    const w = lakeWaters[i];
    w.update(stats.t); w.setSun(sun.sunDir, sun.sunColor); w.setSky(sun.hemiSky); w.setFog(_fogC, 0.0058);
    w.setLight(waterLight);
  }

  /* THE LAMPS COME ON WITH THE WINDOWS. `sunRig.windowGlow` is the engine's existing night signal
     (1.00 night · 0.72 dusk · 0.30 dawn · 0.00 noon) and `createStreetKit.update` was written to
     take exactly it — so this is one call, not a schedule this room invents. At noon it is 0 and the
     glow group is not drawn at all (street-lights.js gates on `visible`), which is what keeps the
     lamps free in every daylight frame the probe and the captures measure. */
  if (streetKit) streetKit.update(sun.windowGlow);

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

    /* ---- A-GUN: AIM THE WEAPON, THEN LET THE RIG PUT THE HANDS ON IT ------------------------
       ORDER IS THE WHOLE TRICK, and it is why these four lines sit HERE and not after
       `hero.update`. The rig solves the mount-IK arms to the weapon's socket world positions
       INSIDE `hero.update`; place the weapon after that call and the hands spend every frame
       reaching for where the gun was last frame. Placed before it, aim → weapon → hands all
       resolve inside one frame with no lag to smear the angle a probe is about to measure.
       The body also turns to the LOOK while armed. `character.update` only writes
       `state.yaw = lookYaw` WHILE MOVING, so a standing player who spins the view keeps the old
       facing — and an aim 180° behind the body is then not reachable by any arm, which shows up
       as a metre of mount-IK residual rather than as a pose. Re-asserting the yaw is a one-line
       no-op on the look itself (`setYaw` writes lookYaw back to the value it already holds) and
       turns only the torso, which is what a person aiming actually does. ---- */
    if (armed) {
      character.setYaw(character.lookYaw);
      sidearm.aim(s, gunTarget(), character.lookYaw);
      if (lockAim.down(0)) sidearm.fire();
    }
    hero.update(dt, s, { view: character.view, lookYaw: character.lookYaw, anchor: s.anchor });
    /* ---- A-GUN: PRE-POSE THE ARM WITH THE RIG'S OWN AIM LAYER, and why this line is AFTER the
       update and not before it. `createHeroBody.update` ends by calling `handle.setAim(null)` for
       every pose that is not a swing or a cling, so a target set before it is wiped in the same
       call; set here, it is read by the aim layer on the NEXT frame. That one-frame stagger costs
       nothing, because this layer is only a STARTING POSE — the mount pass, which runs later in the
       very same rig update, is what actually puts the wrist on the grip, and it uses this frame's
       socket position.
       WHY IT IS NEEDED AT ALL, measured. `_solveTwoBone` picks its bend plane from the CLIP pose's
       own elbow, `cross(upperArm, foreArm)` — and the mixer rewrites the clip pose every frame, so
       an idle whose arms hang nearly straight hands the solver a degenerate cross product on EVERY
       frame, not just the first. Standing armed, the right-hand residual drifted 0.0119 → 0.0141 u
       across eight samples while the same body WALKING (arms swinging, elbow properly bent) sat at
       0.0004–0.0026 u with the identical reach ratio. The aim layer's own `-0.4 rad` elbow bend
       (createCharacterRig.js:911) is exactly the missing ingredient, and it turns the chest toward
       the target as a bonus — so this is the engine's existing answer to the problem, not a new one. */
    if (armed) { const h = hero.handle; if (h && h.setAim) h.setAim(gunTarget()); }
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

  /* A-GUN: the projectiles step EVERY frame, in the shared tail rather than inside the walk
     branch — a bullet already in the air must keep flying (and keep being able to hit something)
     if you holster mid-shot or jump into a car the moment after you fire. Cheap when nothing is
     live: the pool loop is 32 slots of a flag test. */
  sidearm.update(dt);

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
/* A-GUN (2026-08-22): this room published a THREE-FIELD `__hero`, and that was enough to keep
   `walkrun-guard` — the guard that exists precisely to protect the owner's favourite walk and run —
   from being able to run here AT ALL. It reads `bonePos`, `gaitLabel` and `contact`; world-lab had
   none of them, so the only committed baseline in the repo is swing-lab's and the guard in the
   verify gate has never once looked at THIS room's gait. That is guard-scope blindness of the exact
   kind the ledger keeps recording: the guard was green, and green covered a room this arc is not
   shipping in. The handles below are the swing-lab set, verbatim in name and meaning, so one
   instrument now measures both rooms. Read-only getters — they publish, they do not animate. */
window.__hero = {
  get rigged() { return hero.rigged; },
  get pose() { return hero.pose; },
  get gait() { return hero.gait; },
  get gaitLabel() { return hero.gaitLabel; },
  get scale() { return hero.scale; },
  get height() { return hero.bodyHeight; },
  get airMode() { return hero.airMode; },
  get airWeight() { return +hero.airWeight.toFixed(4); },
  get poseWeight() { return +hero.poseWeight.toFixed(4); },
  get contact() { const c = hero.contact; return c ? { active: c.active, w: +c.w.toFixed(3), handL: +c.handL.toFixed(4), handR: +c.handR.toFixed(4), footL: +c.footL.toFixed(4), footR: +c.footR.toFixed(4) } : null; },
  /* A-GUN: the MOUNT report — the mount-IK pass's own live receipt. `w` is the eased weight and it
     is the CONFOUND in every hand-contact reading: the pass lerps its solve target from the limb's
     current end by `w`, so a residual measured while it eases in is large on a perfectly correct
     mount. A probe must wait for w ≈ 1 before believing a distance, and it can only do that if the
     weight is published beside it. -1 on a limb means "no chain or no target", never "0 u away". */
  get mount() { const h = hero.handle, m = h && h.mountReport; return m ? { active: m.active, w: +m.w.toFixed(3), handL: +m.handL.toFixed(4), handR: +m.handR.toFixed(4), footL: +m.footL.toFixed(4), footR: +m.footR.toFixed(4) } : null; },
  /* A NAMED BONE IN THE RIG ROOT'S OWN FRAME — the only frame in which "did the limb move" asks
     about the POSE and not about the body (swing-lab's own note explains why a yaw-only derotation
     was wrong). Rescaled by the measured GLB scale so the numbers are WORLD units.
     Probe-only: allocates a Vector3 per call, never a frame path. */
  bonePos(name) {
    const v = new THREE.Vector3(NaN, NaN, NaN);
    hero.bonePoint(name, v);
    const o = hero.object;
    if (!Number.isFinite(v.x) || !o) return null;
    o.updateMatrixWorld(true);
    o.worldToLocal(v).multiplyScalar(hero.scale || 1);
    return { x: v.x, y: v.y, z: v.z };
  },
  boneWorld(name) { const v = new THREE.Vector3(NaN, NaN, NaN); hero.bonePoint(name, v); return Number.isFinite(v.x) ? { x: v.x, y: v.y, z: v.z } : null; },
  ready: hero.ready,
};
window.__aim = { pt: _aimPt, get hit() { return !!aimHit; }, get inRange() { return !!character.state.aimInRange; }, get locked() { return lockAim.locked; } };
/* A-GUN probe handles. Everything here is READ OFF THE APPLIED SCENE TRANSFORM rather than
   recomputed from the aim inputs — `forward` comes out of the weapon's own matrixWorld, the socket
   points out of the socket nodes' world positions. That distinction is the difference between a
   check and a tautology: recomputing the aim would agree with itself no matter how badly the
   transform had been applied, and would have nothing to say about a wrong Euler order, a stale
   matrix, a lost parent or an up-vector that degenerated looking straight up.
   `target` publishes the point the weapon was ACTUALLY aimed at this frame — including the
   far-ray fallback for open sky — so the probe measures against the same ray the player sees. */
window.__gun = {
  get loaded() { return sidearm.loaded; },
  get mode() { return sidearm.mode; },
  get armed() { return armed; },
  arm: (on) => setArmed(on),
  fire: () => sidearm.fire(),                 // the REAL fire path — the same call the frame loop makes
  /* `lastShot` is COPIED, not aliased — it is the module's one reused scratch object, so handing the
     live reference across the seam would give a probe a "receipt" that keeps changing under it (the
     createTargetLock lesson, which exists in this engine precisely because that bug is invisible in
     every still and wrong in every frame of motion). `aimDir` is published separately and labelled
     as live: it is where the weapon points NOW, never where a past shot went. */
  get report() { const r = sidearm.report; return { armed: r.armed, loaded: r.loaded, fired: r.fired, hits: r.hits, misses: r.misses, live: r.live, lastHit: r.lastHit ? { ...r.lastHit } : null, lastShot: r.lastShot ? { ...r.lastShot } : null, aimDirLive: r.aimDir ? { ...r.aimDir } : null }; },
  /* THE RETICLE'S OWN POINT, republished here so a check can relate the WEAPON to what the PLAYER
     sees. `__aim.pt` is filled by `resolveAimPoint` for the crosshair — a different call, on a
     different frame path, from the `gunTarget()` the weapon is aimed with. Comparing the weapon's
     forward against THIS closes the one gap a self-consistent aim check cannot see: that the weapon
     and the crosshair might both be pointing, in perfect agreement, down the wrong ray. */
  reticle() { return aimHit ? { x: _aimPt.x, y: _aimPt.y, z: _aimPt.z } : null; },
  /* IS THE WEAPON ACTUALLY IN SHOT? Projects the grip and muzzle sockets through the LIVE camera and
     reports normalised device coordinates, so a capture tool can assert its subject is in frame
     instead of trusting that it framed correctly. This arc produced two captures of empty scenery
     — one of empty sky, one of an empty meadow — and both times the fix was framing code with no
     check behind it. Probe-only: allocates a Vector3 per call, never a frame path. */
  onScreen() {
    const g = sidearm.socketPoint('grip', { x: 0, y: 0, z: 0 });
    const m = sidearm.socketPoint('muzzle', { x: 0, y: 0, z: 0 });
    if (!g || !m) return null;
    const pr = (p) => { const v = new THREE.Vector3(p.x, p.y, p.z).project(rig.camera); return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3) }; };
    const a = pr(m), b = pr(g);
    const ok = (v) => v.z > -1 && v.z < 1 && Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1;
    return { muzzle: a, grip: b, ok: ok(a) && ok(b) };
  },
  forward() { const o = { x: 0, y: 0, z: 0 }; sidearm.forward(o); return o; },
  socket(which) { const o = { x: 0, y: 0, z: 0 }; return sidearm.socketPoint(which, o) ? o : null; },
  target() { const t = MODE === 'walk' ? gunTarget() : null; return t ? { x: t.x, y: t.y, z: t.z } : null; },
};
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
/* ---- A-SANDBOX: THE FLORA RECEIPTS. Everything here is READ OFF THE SCENE — the instanced meshes
   that are actually being drawn and the materials that are actually compiled — rather than off the
   config that asked for them. That distinction is the whole reason A-FLORA could not prove its own
   tint claim: nothing had ever instanced the kits, so `makeTreeTints`' report was a number about an
   array, not about anything on screen.
     kits[]    one row per drawn InstancedMesh: family, variant, instance count, the `userData.type`
               stamp, and `customProgramCacheKey()` — which is 'lgr-ao-sway' or 'lgr-ao' and is
               therefore the DIRECT observation of the boulder trap, not an assumption about it.
     tint()    per-family: distinct colours actually written into the instanceColor buffer, and the
               realized w/v spans. Sampled from the buffer the GPU got (createTreeKit cuts it there).
     colorsOf() the first N instanceColor triples straight off the live attribute — so a checker can
               confirm neighbouring instances differ instead of trusting a "distinct" count.
   ---- */
/* the SunRig's t is a bare scalar; naming its phases keeps the HUD readable without a second clock.
   Boundaries are SunRig's own documented anchors (0 night · 0.25 dawn · 0.5 noon · 0.75 dusk). */
const phaseName = (t) => (t < 0.22 || t >= 0.80 ? 'night' : t < 0.32 ? 'dawn' : t < 0.44 ? 'morning'
  : t < 0.58 ? 'noon' : t < 0.70 ? 'afternoon' : t < 0.78 ? 'dusk' : 'twilight');

/* ---- A-SANDBOX: the SKY + WEATHER receipts. Both read the RIGS, which are the things the frame
   actually renders from — not the dock's idea of what was requested. `weather.probe` reports the
   eased scalars AND the live particle counts, because "did the rig construct" and "is anything
   falling" are different questions and only the second one is the ability working. ---- */
/* ---- A-NIGHTFALL: THE DRESSING, AS READABLE FACTS. Deliberately the SAME SHAPE swing-lab's
   `__dress.street` publishes (Rule 6: one receipt shape in this repo, not two), because the question
   is identical in both rooms and it is one a screenshot cannot answer — "no lamps visible" reads the
   same whether the generator placed zero or the glow layer is simply dark. `visible`/`opacity` are
   read off the RENDERED objects rather than off the config that asked for them; those two disagreeing
   IS the bug this receipt exists to catch. */
window.__dress = {
  get street() {
    if (!streetKit) return null;
    const g = streetKit.group;
    return {
      ...streetKit.stats,
      windowGlow: +sun.windowGlow.toFixed(4),
      visible: g.visible,
      layers: g.children.map((c) => ({ type: c.type, visible: c.visible, count: c.count ?? null, opacity: c.material?.opacity ?? null })),
    };
  },
};
window.__sky = {
  get t() { return sun.t; },
  get phase() { return phaseName(sun.t); },
  get auto() { return DAY.auto; },
  get pace() { return sun.pace; },
  goTo: (t) => { DAY.auto = false; sun.setAuto(false); sun.goTo(t, true); syncDock(); return sun.t; },
  setAuto: (v) => { DAY.auto = !!v; sun.setAuto(DAY.auto); syncDock(); return DAY.auto; },
  setPace: (s) => { sun.setPace(s); DAY.pace = sun.pace; syncDock(); return sun.pace; },
  /* the sun's own outputs, so a check can prove the light actually MOVED with t rather than
     assuming the scalar reached the shader. */
  get light() { return { intensity: key.intensity, elevation: sun.sunArc.y, dir: { x: sun.sunDir.x, y: sun.sunDir.y, z: sun.sunDir.z } }; },
};
window.__weather = {
  get kind() { return weather.kind; },
  setKind: (k) => { weather.setKind(k); syncDock(); return weather.kind; },
  get scalars() { return { intensity: weather.intensity, overcast: weather.overcast, fog: weather.fog, snow: weather.snow, cloud: weather.cloud }; },
  get drops() { return weather.rainDropCount; },
  get fogPlanes() { return { near: scene.fog.near, far: scene.fog.far }; },
  get lights() { return { key: key.intensity, fill: fill.intensity }; },
  /* how many particles are ACTUALLY on screen, counted off the instance matrices rather than the
     pool size — an InstancedMesh with 600 slots and 0 visible is the exact failure a "constructed
     it" check would pass. The rig parks a hidden particle at y = −50 with scale 0. */
  live() {
    const out = { rain: 0, snow: 0 };
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    weather.group.traverse((o) => {
      if (!o.isInstancedMesh) return;
      const key2 = o.geometry.parameters && o.geometry.parameters.height > 0.2 ? 'rain' : 'snow';
      for (let i = 0; i < o.count; i++) {
        o.getMatrixAt(i, m); m.decompose(p, q, s);
        if (s.x > 1e-4 && p.y > -40) out[key2]++;
      }
    });
    return { ...out, pools: weather.poolCounts, groupScale: weather.group.scale.x, at: { x: weather.group.position.x, z: weather.group.position.z } };
  },
};

window.__flora = {
  get on() { return FLORA_ON; },
  get dials() { return { gc: FLORA.gc, snags: FLORA.snags, wind: FLORA.wind }; },
  get counts() { return { ...FLORA_N, trees: TREE_N }; },
  get wind() { return { time: swayTime.value, amp: swayWind.value }; },
  /* every flora InstancedMesh in the scene, found by traversal — a family that failed to attach
     simply is not here, which is what makes a count of these rows a real answer. */
  kits() {
    const rows = [];
    for (const f of FLORA_KITS) {
      const g = f.bucket === 'conifer' ? treeGroup : floraGroups.find((x) => x.userData.floraBucket === f.bucket);
      if (!g) continue;
      g.traverse((o) => {
        if (!o.isInstancedMesh) return;
        rows.push({
          family: f.bucket,
          variant: o.userData.variant,
          count: o.count,
          type: o.userData.type,
          program: o.material.customProgramCacheKey ? o.material.customProgramCacheKey() : null,
          hasColor: !!o.instanceColor,
        });
      });
    }
    return rows;
  },
  tint(bucket) {
    const f = FLORA_KITS.find((x) => x.bucket === bucket);
    return f && f.kit ? f.kit.tintReport() : null;
  },
  /* the raw per-instance colours off the LIVE buffer for one family's first mesh */
  colorsOf(bucket, n = 8) {
    const rows = [];
    const g = bucket === 'conifer' ? treeGroup : floraGroups.find((x) => x.userData.floraBucket === bucket);
    if (!g) return rows;
    g.traverse((o) => {
      if (!o.isInstancedMesh || !o.instanceColor || rows.length >= n) return;
      const a = o.instanceColor.array;
      for (let k = 0; k < o.count && rows.length < n; k++) {
        rows.push([+a[k * 3].toFixed(4), +a[k * 3 + 1].toFixed(4), +a[k * 3 + 2].toFixed(4)]);
      }
    });
    return rows;
  },
  /* the ORDER-INDEPENDENT placement receipt over the whole scene's 'tree'-stamped instances — the
     determinism check. Two boots of one URL must return the identical hash + count. */
  hash: () => hashTreeInstances(scene),
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
/* ---- A-SANDBOX: THE ATTITUDE RECEIPT. The plane's pitch defect was invisible to every number this
   room already published — `state.pitch` read +0.4 and the altitude really did climb, which is
   exactly what made it survive a measurement pass. What was missing was the nose direction OF THE
   THING ON SCREEN, so that is what this returns: the third column of the body group's world matrix,
   i.e. its local +Z (the nose, per createVehicleMesh's contract) after every transform has been
   applied. `physicsPitch` is the movement model's own euler for the same frame, so the two can be
   compared — and the pre-fix value of `nose.y` is exactly this one negated, which is what makes a
   single measurement prove both arms. ---- */
window.__attitude = () => {
  if (!ACTIVE || !ACTIVE.body || !ACTIVE.body.group) return null;
  const g = ACTIVE.body.group;
  g.updateMatrixWorld(true);
  const e = g.matrixWorld.elements;
  const L = Math.hypot(e[8], e[9], e[10]) || 1;
  const _pe2 = new THREE.Euler().setFromQuaternion(ACTIVE.state.quat, 'YXZ');
  return {
    key: MODE,
    nose: { x: e[8] / L, y: e[9] / L, z: e[10] / L },
    physicsPitch: _pe2.x,
    statePitch: ACTIVE.state.pitch,
    /* the BODY GROUP's own world position, not `state` — a capture harness needs to point a camera
       at the thing that is drawn, and finding it by traversal is how the first attempt at this
       receipt ended up reading the scene root's identity matrix and reporting a level nose. */
    x: g.position.x, y: g.position.y, z: g.position.z,
    yaw: ACTIVE.state.yaw,
  };
};
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
