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
  THREE, createEngineCore, CAM, createBoxArena, swingableHeight, swingableRope,
  createCharacterController, createGrappleModel, GRAPPLE_PROFILE,
  resolveAimPoint, createAimReticle, createPointerLockAim,
  createTargetLock, createLockMarker, cameraNearRadius,
  createFlowField, createAgentSim, createAgentRng, createCrowdTiers, createCharacterRig,
  createHeroBody,
  createTextureForge, CITY_SURFACES, createTriplanarForgeMaterial, tilesPerUnit, applyGroundMacro,
  createStreetKit, applyStreetGrid, createStreetPlaces,
} from '@lgr/engine-core';
/* A-CITIZENS: the tier-A skin. The engine deliberately does NOT inline this GLB (pedestrians.js's
   lib-size note) — the consumer that ships people pays for the model. */
import survivorUrl from '@lgr/engine-core/assets/models/survivor.glb?url';

const $ = (id) => document.getElementById(id);
const Q = new URLSearchParams(location.search);
const qNum = (k, d) => { const v = Number(Q.get(k)); return Number.isFinite(v) && Q.has(k) ? v : d; };
/* WHICH ROOM. Declared up here rather than beside the arena because the ATMOSPHERE has to know before
   the arena is built — see the fog note below. `?level=city` is the A-SKYLINE city; anything else is
   the original lab, unchanged. */
const LEVEL = Q.get('level') === 'city' ? 'city' : 'lab';
/* ---- A-DRESS (2026-08-15): THE FOUR ARMS OF THE CITY-VARIETY PASS, and they are URL params for the
   reason every ablation in this repo is one — before and after have to be two URLs of ONE build, or
   the comparison has a rebuild in it (A-AERIAL's `?mark=`, A-BODY's `?hero=capsule`, the ledger's own
   rule). Each defaults OFF, and with all four off not one statement of the new code runs: the arena is
   built from the same `silhouette: {}` A-SKYLINE measured, the ground material is the A-AERIAL one, and
   nothing is added to the scene. That is what keeps the ledger's tables, `swing-lab-probe`'s 27 checks
   and `npm run tier-guard` all still true of the default page.
     ?variety=1  the rooftop kit + district palette + per-instance facade rhythm (0 extra draw calls)
     ?street=1   lamps, trees, benches, hydrants, shelters (3 instanced meshes + 1 glow Points)
     ?roads=1    asphalt/sidewalk/kerb/lane-dashes/crossings painted into the ground (0 draw calls)
     ?night=1    the light rig at night, so the lamps can be judged on the frames they exist for */
const DRESS = {
  variety: Q.get('variety') === '1',
  street: Q.get('street') === '1',
  roads: Q.get('roads') === '1',
  night: Q.get('night') === '1',
};

/* ---------------------------------------------------------------------------------------------
   1. THE ENGINE CORE — renderer, scene, camera rig, resize + context-restore backbone. No city.
   NO POST CHAIN, deliberately: a testbed's job is to show the mechanic, and every pass between the
   scene and the screen is one more thing that can be blamed for how a swing looks. Straight render.
   --------------------------------------------------------------------------------------------- */
const core = createEngineCore({ container: document.body });
const { renderer, scene, rig, frameStart, frameEnd } = core;
rig.setMode(CAM.PERSPECTIVE);
rig.camera.near = 0.02; rig.camera.far = 400; rig.camera.updateProjectionMatrix();
/* ---- THE ATMOSPHERE IS SIZED TO THE ROOM, and this was found by LOOKING, not by a number (the
   ledger's technique #4, paying off a third time). The lab's fog band is 26–120 u against an arena
   17 u across, so it never touches anything. The city is 84.7 u across: at that band the skyline
   dissolves into the clear colour about two blocks out, and the first capture of it came back as a
   black frame with a red capsule in it — a city you cannot see is a city you cannot aim a web across,
   and `lock` range 11.7 u means the player is MEANT to be picking targets at distance.
   So the fog far plane is pushed past the arena's own extent, and the horizon is lifted off pure black
   so a silhouette has something to be a silhouette AGAINST. Gated on LEVEL: the lab keeps its numbers
   exactly, because 27 probe checks and every A-LAB/A-CLIMB capture were taken under them. */
/* A-DRESS: `?night=1` is a LIGHT RIG, not a new scene. A streetlight is a night feature — a lamp that
   has only ever been judged at noon has not been judged — and this lab has no SunRig (createEngineCore
   ships the renderer, not a sky), so the honest minimum is one alternative set of the same four numbers
   the day rig already states. Deliberately NOT a day/night CYCLE: that ability exists in the engine
   (`createSunRig`, the day-night standard) and wiring it here would be a second arc riding on this one.
   Recorded as the follow-up rather than half-built. */
const SKY = DRESS.night ? '#0a0e18' : LEVEL === 'city' ? '#1d2634' : '#141821';
renderer.setClearColor(new THREE.Color(SKY), 1);
scene.fog = LEVEL === 'city' ? new THREE.Fog(SKY, DRESS.night ? 30 : 45, DRESS.night ? 150 : 230) : new THREE.Fog(SKY, 26, 120);

/* Lights. `createEngineCore` ships NO lights (it owns the renderer, not the look), so the arena
   supplies its own: one key with shadows, a hemisphere fill so the north faces are not black, and a
   low bounce so a body in a street canyon still reads. */
/* AT NIGHT THE KEY IS THE MOON: same rig, a twentieth of the intensity and a cold cast. It stays a
   directional light with shadows on because a night city with no shadows reads as fog, and because a
   lamp's pool of light only means anything against something darker. */
const key = new THREE.DirectionalLight(DRESS.night ? '#9fb6e8' : '#fff0dd', DRESS.night ? 0.55 : 2.3);
key.position.set(9, 16, 7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -26; key.shadow.camera.right = 26;
key.shadow.camera.top = 26; key.shadow.camera.bottom = -26;
key.shadow.camera.near = 1; key.shadow.camera.far = 70;
key.shadow.bias = -0.0006;
scene.add(key); scene.add(key.target);
/* THE CITY GETS A STRONGER BOUNCE, and this is the same finding as the fog one frame earlier. The lab's
   streets are 2.5 u wide with 5 u towers; the city's are 2.7 u with towers up to 12.7 u, so its canyons
   are twice as deep and the shadowed floor came back BLACK in the first street capture — a player who
   cannot see the pavement cannot judge the height a zip just bought them, which is the one thing this
   level exists to give them. Bounce up, ground colour up, key untouched (the contrast is the look). */
/* THE NIGHT BOUNCE IS THE SAME LESSON THIS FILE ALREADY LEARNED ONCE, one rung darker. The A-SKYLINE
   note above records that the city's first street capture came back BLACK and the cure was to raise the
   bounce, not the key; the first NIGHT capture came back black for exactly the same reason, and 0.42
   was the number that did it. A night city is not an unlit city — the sky itself is a large dim source,
   and without it the buildings have no silhouette for a streetlight to be bright against. */
scene.add(DRESS.night
  ? new THREE.HemisphereLight('#4a5f8c', '#181e2c', 0.95)
  : LEVEL === 'city'
    ? new THREE.HemisphereLight('#a8bcdc', '#414755', 1.5)
    : new THREE.HemisphereLight('#9fb4d8', '#2a2b30', 1.15));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

/* ---------------------------------------------------------------------------------------------
   2. THE LEVEL. Every parameter is a url param first, a slider second — so a probe and a human drive
   the identical world, and a bug report is a URL.
   --------------------------------------------------------------------------------------------- */
/* ---- A-SKYLINE (2026-08-10): THE LAB GROWS A REAL CITY, and it is `?level=city`. ------------------
   WHY IT LIVES HERE RATHER THAN IN A NEW PROJECT. The question the city has to answer is "does the
   chain run better in this room than in the lab, on the same bot" — and the only instrument in the repo
   that can answer it is `swing-lab-probe`'s Phase 9, driving THIS page. A separate project would need
   its own copy of the harness, and two harnesses measuring one mechanic is how the lab-vs-city drift
   this arc exists to close got started. Same page, same code, same bot, one URL parameter: the LEVEL is
   then the only variable in the comparison, which is the whole experiment.

   THE CITY'S NUMBERS ARE DERIVED, NOT PICKED (the same discipline as the lab's rope):
     · `ropeMax` 4.10 is NOT a new tuning — it is the lab's own A-CLIMB-derived rope, held FIXED so the
       mechanic is identical in both rooms and any difference in the chain is the level.
     · The skyline is then generated FROM that rope: the 30th percentile tower top IS the arc-bottom
       minimum `skim + arcClear + ropeMax` = 4.61 u, so 70% of towers clear the rule BY CONSTRUCTION.
       Feed the finished level back through `swingableRope(roofAt(0.30))` and you get 4.106 back — the
       loop closes, which is a check on both derivations at once.
     · `spacing` 4.6 was SWEPT, not chosen, and the sweep is the justification for the target. Wider
       streets buy a bigger mean anchor offset and cost dead spots: measured over 220 street spots at
       +1.2 u, spacing 4.6 gives h.mean 1.85 u with 0/220 spots having no swing available, while 5.2
       gives h.mean 1.96 (and rise p50 2.27, i.e. the "offset >= 2.0" that reads nicer) at the price of
       17/220 dead spots. Stranding is swing-ledger.md OPEN #9 — the number the ledger says to drive
       DOWN next — so 0 dead spots wins over 6% more offset. Stated as a trade, with the sweep behind it.
     · 19x19 at that spacing is 84.7 u across against metropolis's ~3 u swingable core, so a chain runs
       out of time long before it runs out of city.
   `silhouette` is the "better buildings" half — see box-arena.js. Every part is a collider solid, which
   is what makes a spire an ANCHOR and not scenery. */
const CITY_ROPE = 4.10, CITY_FRAC = 0.70;
const CITY_ARENA = {
  cols: qNum('cols', 19), rows: qNum('rows', 19),
  spacing: qNum('spacing', 4.6),
  width: qNum('width', 1.9),
  plaza: qNum('plaza', 1),
  seed: qNum('seed', 11),
  groundY: 0,
  heightVary: 0,                    // unused on the skyline path — heights come from the quantile map
  height: 0,
  skyline: {
    frac: CITY_FRAC, ropeMax: CITY_ROPE,
    arcClear: GRAPPLE_PROFILE.arcClear, skim: GRAPPLE_PROFILE.skim,
    tall: qNum('tall', 2.1), low: 0.22, gamma: 1.0,
    cores: qNum('cores', 3), coreSigma: 0.30, mix: 0.45,
    /* ---- A-DRESS: THE DISTRICT PALETTE. Three families, one per Gaussian downtown, so the argmax of
       the SAME field that ranks a tower also decides what it is made of. The hues are deliberately
       close together — this is a city at dusk, not a paint chart — and the value ranges overlap, so
       the height ramp inside each family still carries depth. The whole thing is a per-instance colour
       on one InstancedMesh: three districts, zero extra draw calls.
         0.58 cool glass  · a downtown of blue-grey towers (the A-SKYLINE city's own hue, kept)
         0.09 warm stone  · a masonry district, the warmest thing in the frame
         0.47 pale green-grey · the concrete/office band that sits between them */
    palette: DRESS.variety ? [
      { hue: 0.585, hueVary: 0.020, sat: 0.13, satVary: 0.07, valMin: 0.38, valMax: 0.74 },
      { hue: 0.075, hueVary: 0.025, sat: 0.16, satVary: 0.08, valMin: 0.36, valMax: 0.68 },
      { hue: 0.465, hueVary: 0.022, sat: 0.07, satVary: 0.05, valMin: 0.40, valMax: 0.72 },
    ] : null,
    /* The per-instance facade rhythm (triplanar-forge's `perInstance`). +/-22% on the storey height,
       which is the band where buildings stop sharing a floor plan and stay the same CITY — at +/-50%
       the tall stock grows storeys a person could not stand up in. */
    facadeVary: DRESS.variety ? 0.22 : 0,
  },
  /* ---- A-DRESS: THE ROOFTOP KIT. Rates are per tower and DISTRICT-WEIGHTED inside box-arena (the
     downtown band gets masts, the middle water towers and bulkheads, the low-rise signage), so the
     numbers here are the city-wide budget rather than the per-building look. Every part is an AABB in
     the same packed buffer as the towers, so each is simultaneously an anchor, a ledge and a collider —
     which is what earned the silhouette its measured +63% net ground in A-SKYLINE, and the reason to
     add MORE of them rather than to add scenery.
     `emissiveKinds: ['sign']` moves the signs onto an unlit InstancedMesh: exactly one extra draw call,
     and the only thing above street level still emitting at night. */
  silhouette: Q.get('plain') === '1' ? null : (DRESS.variety ? {
    /* `sign` came down from 0.30 after the first wide capture: 86 lit boards over 360 towers is a
       fairground, not a city. 0.16 lands nearer 45 — enough that a swing across the skyline always has
       one in frame, few enough that each one is a landmark. */
    parapet: 0.55, penthouse: 0.42, waterTower: 0.26, mast: 0.30, sign: 0.16,
    emissiveKinds: ['sign'],
  } : {}),
  // material/groundMaterial are filled in below by cityMaterials() — the forge needs the renderer,
  // and it does not exist until createEngineCore has run.
};
const LAB_ARENA = {
  cols: qNum('cols', 9), rows: qNum('rows', 9),
  spacing: qNum('spacing', 4.2),
  width: qNum('width', 1.7),
  height: qNum('height', Number(swingableHeight().toFixed(2))),
  heightVary: qNum('vary', 0.45),
  plaza: qNum('plaza', 1),
  seed: qNum('seed', 7),
  groundY: 0,
};
/* ---- A-AERIAL (2026-08-13): THE CITY STOPS BEING FLAT-COLOURED BOXES. ---------------------------
   `docs/design/research-aaa-environments.md` §3 item 3 of its top-5: close flat-colour → textured with
   ZERO texture downloads, on `createTextureForge`, beauty-gated. This is the WIRING half; the ability
   is `createTriplanarForgeMaterial` in engine-core, and the recipes (`CITY_SURFACES.facade`, `.roof`,
   `.asphalt`, `.concrete`) already shipped with A-ART and had no consumer in this project.

   WHY TRIPLANAR AND NOT `forge.makeMaterial` + a repeat. box-arena renders the WHOLE skyline as one
   InstancedMesh of one unit BoxGeometry — a 0.22 u cornice and a 12.7 u tower share the same 0..1 UVs,
   so a UV-mapped tile would be fifty times denser on one than the other inside a single draw call, and
   there is no per-instance UV transform to fix it with. Sampling by WORLD POSITION makes texel density
   a property of the world, so every box in the buffer is textured at the same scale and the draw-call
   count does not move. See triplanar-forge.js's header for the full argument.

   THE SCALES ARE DERIVED, not typed. `tilesPerUnit` converts a recipe's `worldSize` (METRES per tile —
   forge-recipes.js's convention) through this world's ~6 m/u into tiles per unit, so the numbers below
   say what they mean:
     · facade `worldSize` 8 m holds FIVE storeys, so one tile is 1.33 u and a storey is 0.27 u ≈ 1.6 m
       at this scale. `tilesPerTile` 0.55 stretches it so a storey lands near 2.9 m — a real floor
       height — which is the one place an art number overrides the arithmetic, and it is named.
     · the roof tile is small on purpose: a roof is seen from directly above at swing height, and it is
       the ONE surface this level's camera looks straight down at.
   THE GROUND KEEPS ITS UVs (a PlaneGeometry has real ones) so it needs no triplanar — it gets the
   asphalt recipe plus `applyGroundMacro`, the engine's existing world-scale de-tiler, because a
   105 u plane at a 1 m tile is 105 repeats and the eye finds that grid instantly from the air.

   `?forge=0` IS THE A/B ARM AND THE FALLBACK IS THE OLD LOOK EXACTLY: with the forge off (or
   unsupported — iOS p0 has no high-precision fragment float, so `bake()` returns null) every factory
   here returns the same flat MeshStandardMaterial the city shipped with. Nothing else in the repo
   calls any of this, so `npm run tier-guard`'s byte-identical stylized baselines are untouched. */
const M_PER_U = 6.0;                        // this world's scale — the swing ledger's own figure
function cityMaterials() {
  if (LEVEL !== 'city' || Q.get('forge') === '0') return null;
  const forge = createTextureForge({ renderer, size: 1024 });
  const bake = (k, over) => forge.bake({ ...CITY_SURFACES[k], ...(over || {}) });
  const wall = bake('facade');
  /* THE ROOF IS CONCRETE, NOT THE `roof` RECIPE, and that is a measured swap rather than taste. The
     shipped `roof` surface is forge-gunmetal at metalness 0.8 and a 2 m tile; this level has NO
     environment map (createEngineCore ships the renderer, not an IBL — see the lights block above),
     and a metal with nothing to reflect is black. The first capture had roofs of dark aliasing
     speckle, at 0.33 u per tile, seen from directly overhead — which is the ONE surface this level's
     camera looks straight down at. The second try, `concrete` (forge-stone), was worse in a more
     interesting way: stone's voronoi crack network at any tile big enough to READ came back as
     crazy-paving, i.e. a fantasy plaza, on the one surface a swinging player spends the most time
     looking at. Asphalt is the right subject — a city roof IS a tar membrane — its grain is fine
     rather than cellular so it survives being seen from 13 u up, and it ties the roofs to the street
     they are made of. Re-seeded off the retired `roof` recipe's seed so it is not the same tile the
     ground is wearing. */
  const roof = bake('asphalt', { size: 512, seed: 0x63 });
  const road = CITY_SURFACES.asphalt;
  const tower = createTriplanarForgeMaterial({
    side: wall, top: roof,
    scale: tilesPerUnit({ worldSize: CITY_SURFACES.facade.worldSize, metresPerUnit: M_PER_U, tilesPerTile: 0.55 }),
    topScale: tilesPerUnit({ worldSize: CITY_SURFACES.asphalt.worldSize, metresPerUnit: M_PER_U, tilesPerTile: 1.2 }),
    sharpness: 6.0,
    /* THE DETAIL OCTAVE (research doc §3 gap 3: "a single 6 m forge tile is soft up close"). The
       concrete recipe re-read eight times finer, faded out past 16 u so it is only paid for where a
       player's eye is actually close to a wall — which on a swing is the moment before a cling. */
    detail: { set: bake('concrete', { size: 512 }), scale: tilesPerUnit({ worldSize: CITY_SURFACES.concrete.worldSize, metresPerUnit: M_PER_U }) * 8, amount: 0.30, near: 4, far: 16 },
    roughness: CITY_SURFACES.facade.roughness, metalness: 0,
    /* THE GRADE, AND IT IS THE WHOLE "DON'T ABANDON THE STYLIZED READ" HALF OF THIS PASS. The forge
       facade is WARM PLASTER at a linear albedo of 0.46–0.74; box-arena's flat grey is #7d8496, linear
       (0.206, 0.231, 0.305). Wiring the texture in with a white base multiplies the city's brightness
       by about 2.5x and warms it — the first capture came back as a near-WHITE city over a black
       street, which is a different game's art direction, not a textured version of this one. This
       colour is that ratio, per channel: base_linear / albedo_mean, back through sRGB. So the tower
       lands at the SAME luminance and the SAME cool cast it had, and everything the texture adds is
       DETAIL rather than exposure. The per-instance height ramp still composes on top of it. */
    color: '#a8b4d2',
    fallbackColor: 0x7d8496,          // box-arena's own flat grey — the exact no-forge look
    /* A-DRESS: read the per-instance `aLgrVar` box-arena writes when `skyline.facadeVary > 0`, so the
       storey bands land at a different height on every building. OFF unless `?variety=1`, and off means
       the A-AERIAL program compiles byte-for-byte — the fallback discipline this material was built on. */
    perInstance: DRESS.variety ? { phase: 7.31 } : false,
  });
  const ground = forge.makeMaterial(road, {
    repeat: Math.max(1, (Math.max(CITY_ARENA.cols, CITY_ARENA.rows) * CITY_ARENA.spacing + CITY_ARENA.spacing * 4) / (road.worldSize / M_PER_U) / 24),
  });
  ground.color = new THREE.Color('#8e97a8');   // the asphalt bake is near-black; the street has to stay readable
  if (forge.supported) applyGroundMacro(ground, { scale: 0.10, brightness: 0.18, tintAmt: 0.20, tint: [0.20, 0.22, 0.26] });
  /* A-DRESS: THE ROAD, PAINTED ONTO THE FLOOR THAT WAS ALREADY BEING DRAWN. `applyStreetGrid` CHAINS
     onto the macro patch above rather than replacing it (that is the whole reason it captures the
     previous `onBeforeCompile`), so the de-tiling still runs and the markings go on top of its result.
     THE PITCH MUST BE THE ARENA'S OWN `spacing` — the street kit's lamp posts stand on the same
     expression, and a road painted on a different lattice from the props standing on it is a bug you
     can see from the pavement. One number, read by both. */
  if (DRESS.roads) {
    applyStreetGrid(ground, {
      spacing: CITY_ARENA.spacing,
      /* THE CARRIAGEWAY IS SIZED OFF THE BUILDINGS, not chosen: the street is the gap between two
         footprints (spacing 4.6 less a ~2.4 u widened footprint ⇒ ~2.2 u of clear street), and the
         asphalt takes the middle 60% of it with the sidewalk either side. */
      roadHalf: CITY_ARENA.spacing * 0.235,
      walkHalf: CITY_ARENA.spacing * 0.375,
      /* Markings are wider here than a real road's, in the same spirit as the fog and the bounce being
         sized to this room: at 6 m/u a real 10 cm lane line is 0.017 u and vanishes from swing height,
         which is where this level is actually looked at from. */
      lane: 0.026, dash: 1.0, kerb: 0.05, crossW: 0.5, bar: 0.24,
      sidewalk: 1.9, kerbTone: 0.5, lot: 1.3, marking: 3.6,
    });
  }
  return { forge, tower, ground };
}
const CITY_MATS = cityMaterials();
if (CITY_MATS) { CITY_ARENA.material = CITY_MATS.tower; CITY_ARENA.groundMaterial = CITY_MATS.ground; }
else if (LEVEL === 'city') {
  const g = new THREE.MeshStandardMaterial({ color: '#3d4453', roughness: 0.95, metalness: 0 });
  /* THE ROADS SURVIVE `?forge=0` AND iOS-p0, because they are geometry-free arithmetic and not a
     texture — the one part of this pass that costs the flat-colour fallback nothing to keep. */
  if (DRESS.roads) applyStreetGrid(g, { spacing: CITY_ARENA.spacing, roadHalf: CITY_ARENA.spacing * 0.235, walkHalf: CITY_ARENA.spacing * 0.375, lane: 0.026, dash: 1.0, sidewalk: 1.5, lot: 1.2, marking: 2.2 });
  CITY_ARENA.groundMaterial = g;
}

const ARENA0 = LEVEL === 'city' ? CITY_ARENA : LAB_ARENA;
/* THE PERCENTILE THE ROPE IS DERIVED AT IS THE LEVEL'S OWN. The lab's 0.35 is A-CLIMB's; the city's is
   `1 - frac`, i.e. exactly the break the generator built its distribution around. Two rooms, one
   arithmetic, and the number that differs is a fact about the room. */
const SKYLINE_P = LEVEL === 'city' ? 1 - CITY_FRAC : 0.35;
const _buildT0 = performance.now();
const arena = createBoxArena(ARENA0);
const LEVEL_BUILD_MS = performance.now() - _buildT0;
scene.add(arena.group);

/* ---- A-DRESS: THE STREET FURNITURE. The ABILITY is `createStreetKit` (engine-core); this is wiring
   and the numbers that belong to THIS room.
   `blocked` IS THE ONE ARGUMENT THAT MATTERS and it is why the kit takes a predicate instead of a
   footprint list: the skyline path JITTERS towers off their cell centres and grows the footprint with
   the height, so where a building actually is, is a question only the collider can answer. Asking it
   through `segmentHit` (a zero-radius vertical stab, the same test every probe in this repo uses for
   "am I inside something") is the difference between a bench on the pavement and a bench inside a
   lobby. The stab is at 0.20 u — above the road, below a cornice — so an OVERHANG does not delete the
   pavement underneath it, which is exactly where a real street puts its furniture. */
const streetKit = (LEVEL === 'city' && DRESS.street) ? createStreetKit({
  extent: arena.stats.extent,
  spacing: arena.params.spacing,
  groundY: arena.params.groundY,
  seed: arena.params.seed,
  roadHalf: arena.params.spacing * 0.235,      // the same carriageway `applyStreetGrid` paints
  step: 1.15,
  /* ONE LAMP PER BLOCK PER STREET LINE, alternating sides — at this city's 4.6 u pitch and ~6 m/u that
     is a lamp roughly every 28 m, which is real streetlight spacing. Two per block came out as a
     runway. */
  lampsPerBlock: 1,
  blocked: (x, z) => arena.world.segmentHit(x, 0.20, z, x, 0.21, z, 0) === 0,
  castShadow: Q.get('propshadow') !== '0',     // the ablation arm for the shadow-pass half of the cost
}) : null;
if (streetKit) {
  scene.add(streetKit.group);
  /* The night amount is a CONSTANT here because this lab has no sun to interpolate against — see the
     `?night=1` note on the light rig. When a SunRig is wired, this becomes `sunRig.windowGlow` and
     nothing else changes: that is the signal `createStreetLights` was already written to take. */
  streetKit.update(DRESS.night ? 1 : 0);
}

/* ---------------------------------------------------------------------------------------------
   2.6 — A-CITIZENS (2026-08-12, mass-agents Phase 2): THE CITY IS INHABITED, and the outbreak runs
   in it. City only (`?level=city`); on the lab not one statement here executes and the 27-check
   probe's room is untouched.

   WHAT LIVES WHERE (engine-first): the SEIR agent sim is `createAgentSim` (engine-core — lifted from
   hoard2, which now consumes the same module), the tier A/B renderer is `createCrowdTiers`
   (engine-core). THIS block is wiring + configuration: the city's numbers at ITS OWN 6 m/u scale, the
   two flow fields and their cadence, the fixed-step sim clock, and the probe handles.

   THE SIM NEVER READS THE PLAYER — zombies hunt susceptibles (the phase-2 target set), civilians flee
   zombies, and the player is a GHOST to the population (player-agent collision and friendly fire are
   unratified owner calls, both OFF, stated). That is also what makes the outbreak DETERMINISTIC while
   a human swings through it: the sim advances on a FIXED 1/60 tick off its own seeded stream, so the
   same seed replays the same outbreak event-for-event regardless of fps or where you swing.

   THE FIELD NUMBERS ARE MEASURED, not asserted (tools/city-field-bench.mjs on this machine):
   340×340 = 115.6k cells at 0.25 u over the 84.7 u city solves in ~5.9 ms (median; flat vs source
   count — BFS is O(cells)). So a re-solve is a real frame spike and the cadence is the design: each
   field re-solves every 0.5 s of SIM time, STAGGERED by 0.25 s so the two never land on one frame.
   Worst case is +~6 ms on one frame in thirty — inside a 60 fps budget beside this city's ~3 ms
   render. The sim step itself is ~0.15 ms at 1000 agents (benched) — rendering, not simulation, is
   the density constraint, which is what the tier bench measures.
   --------------------------------------------------------------------------------------------- */
/* THE DENSITY DIAL — bench-picked default (see the A-CITIZENS bench table), owner-owned. Sparse-
   theater doctrine governs the DEFAULT; ?civs= and the dock slider are the owner's crank. */
/* RATIFIED 2026-08-15 by the owner ("density dial"), on a bench not a preference. Frame cost is FLAT
   across the whole dial on this machine: 150/400/600/900 civs all sit at p50 8.2-8.3 ms, and p95 gets
   BETTER as it rises (12.3 -> 12.6 -> 11.2 -> 10.6) because more of the population demotes to the
   instanced tier. Draws 18 -> 38, tris 88k -> 201k. So the sparse default was never paying for
   anything, and A-CITIZENS' "doctrine-sparse choice, not a limit" is now spent as intended.
   THE HONEST LIMIT, and it is not this number: 600 agents over an 84.7 u city is still only a handful
   per canyon, so raising the COUNT buys less than it looks like. What would actually read as a busy
   street is DISTRIBUTION — see §2.6's placer block below (A-CROWD, ledger OPEN #30, now closed).
   AND 600 STAYS, on evidence rather than inertia: clustered at 400 the median agents-visible from a
   standing vantage falls 10 -> 3 and the share of views that see NOBODY rises 20% -> 32%. Clustering
   makes the count matter MORE, not less, because the WALKERS — the share of the crowd permanently in
   transit — are what keep the stretches between the groups occupied, and they are a fraction of it. */
const CIVS_DEFAULT = 600;
/* A-AERIAL — which arm of the OPEN #25 cure is running. 'on' is the shipped default; the other two
   exist so the ablation in the ledger can be re-run by anyone, not just believed. */
const MARK_MODE = Q.get('mark') === '0' ? 'off' : Q.get('mark') === 'flat' ? 'flat' : 'on';
const TIERA_DEFAULT = 12;
/* The city's civilian numbers AT THIS WORLD'S SCALE (≈6 m/u — the ledger's own figure). Times are
   times (the incubation window is drama, not distance); speeds/radii are hoard2's ÷6 with two
   measured exceptions, both from createAgentSim.test.mjs: chase.speed must CLEAR fleeSpeed (ratio
   1.45, hoard2's runner/flee class) or the outbreak stalls, and biteRadius must CLEAR the separation
   shell (0.12 > 0.10) or a slow chase orbits its prey forever. */
const CIV = {
  count: CIVS_DEFAULT,
  walkSpeed: 0.23,        // ≈1.4 m/s amble
  fleeSpeed: 0.55,        // ≈3.3 m/s panic jog — the PLAYER (0.55 walk / 0.95 sprint) can outrun everything
  staggerSpeed: 0.12,     // the E-state telegraph gait
  populateRadius: 38,     // the peopled disc (city extent 42.35; the square's corners stay quiet)
  panicCells: 12,         // flee inside 3.0 u (~18 m) of the nearest infected
  calmCells: 18,          // hysteresis: calm only past 4.5 u
  biteRadius: 0.12,       // > sepRadius 0.10 (the separation-shell invariant, measured)
  pTransmitPerSec: 0.9,   // ~1 s of contact infects (hoard2's number — a rate, not a distance)
  contactCells: 4,        // bite prefilter: exact circle test only within 1.0 u of flee-field cost
  incubationS: [7, 13],   // THE PACING LEVER — unchanged from hoard2 (time is time)
  wanderIdleS: [2, 6],
  wanderRadius: 2.2,      // ~13 m wander legs
  playRadius: 41,         // rim clamp (circular, so the square city's far corners are outside the
                          // peopled disc — a default-density choice, not a sim limit)
  arriveR: 0.1, lookAhead: 0.3,
  chase: { speed: 0.8, directR: 1.2 },  // ≈4.8 m/s — catches a fleeing civ, loses to a sprinting player
};
const CIV_HEIGHT = 0.26;      // a head under the hero's 0.28 eye
const CIV_SCALE = 0.055;      // survivor.glb = 5.259 raw units tall (measured bind-pose bbox, ledger OPEN #26) → ~0.29 u at this scale
const SIM_DT = 1 / 60, SIM_MAX_SUB = 4;   // fixed tick; capped substeps (CI's 1 fps renderer must not spiral)
const FLEE_EVERY = 30, HUNT_EVERY = 30, HUNT_OFFSET = 15; // re-solve cadence in ticks (0.5 s, staggered)

let population = null;
function bootPopulation(count) {
  if (LEVEL !== 'city' || !(count > 0)) return null;
  /* GROUND-LEVEL OBSTACLES — the field is 2D and the solids are 3D: a cornice, bridge deck, spire or
     roof box is an ELEVATED AABB that must not seal the street under it. A box obstructs a street
     agent iff its underside starts below head height. (Measured on this arena: 360 of 1753 boxes.) */
  const GROUND_CLEAR = 0.4;
  const solids = arena.solids, aabbs = [];
  for (let k = 0; k < solids.length / 6; k++) {
    const o = k * 6;
    if (solids[o + 1] < GROUND_CLEAR) aabbs.push({ minX: solids[o], minZ: solids[o + 2], maxX: solids[o + 3], maxZ: solids[o + 5] });
  }
  const EXT = 42.4, fieldOpts = { bounds: { minX: -EXT, minZ: -EXT, maxX: EXT, maxZ: EXT }, cellSize: 0.25, agentRadius: 0.05, aabbs, maxAgents: Math.max(64, count) };
  const flee = createFlowField(fieldOpts);   // multi-source from the I set — susceptibles ASCEND it
  const hunt = createFlowField(fieldOpts);   // multi-source from the S set — the infected DESCEND it
  const srng = createAgentRng((qNum('seed', 11) * 2654435761 ^ 0xC1717) >>> 0); // the sim's own stream, off the level seed

  /* ---- A-CROWD (2026-08-15): THE DISTRIBUTION, which is the lever the density dial was not.
     `createStreetPlaces` is the ability (engine-core); everything here is this city's numbers.

     `count` IS THE GROUP SIZE, NOT A NUMBER OF PLACES, and that is the one parameter choice worth
     reading twice. The candidate set on this grid is ~2600 corners and mid-block stops — spreading
     600 bodies over 2600 gathering places is the uniform crowd with extra steps. Stating it as
     `civs / CIV_PER_PLACE` makes the FEEL scale-free: turn the density dial and the number of
     gathering places tracks it, so a group stays a group at 150 and at 900.

     THE PLAZA is box-arena's own: `plaza: 1` clears the centre block, so there is exactly one
     spacing-wide open patch in this city and it is at the origin. Given the biggest radius and the
     heaviest weight, because it is the only geometry here that can hold a real crowd.

     ?cluster=0 IS THE CONTROL ARM, and it is a URL param for the reason the ledger's own A-BODY entry
     gives: a before/after must be two URLs of ONE build, never two builds of two trees. With it the
     placer is null, not one statement of the clustering runs, and the sim is the A-CITIZENS crowd
     off the identical stream. */
  const CIV_PER_PLACE = qNum('perplace', 6);
  const CLUSTER = Q.get('cluster') !== '0';
  const places = CLUSTER ? createStreetPlaces({
    spacing: arena.params.spacing,
    extent: arena.stats.extent,
    radius: CIV.populateRadius,                 // the peopled disc — places outside it would strand bodies
    roadHalf: arena.params.spacing * 0.235,     // the same carriageway `applyStreetGrid` paints
    count: Math.max(4, Math.round(count / CIV_PER_PLACE)),
    placeR: qNum('placer', 0.62),               // ~3.7 m across: a knot of people, not a rally
    stay: qNum('stay', 0.72),
    dwell: qNum('dwell', 3.2),
    loiterFrac: qNum('loiter', 0.25),            // the rest are WALKERS — see the module's own note
    travelR: arena.params.spacing * 3,          // a pedestrian's next errand is three blocks, not thirty
    plaza: arena.params.plaza > 0 ? { x: 0, z: 0, r: arena.params.spacing * 0.42, w: 6 } : null,
    seed: qNum('seed', 11),
    /* the SAME blocked predicate the street kit dresses against — one description of one city. */
    blocked: (x, z) => arena.world.segmentHit(x, arena.params.groundY + 0.05, z, x, arena.params.groundY + 0.30, z, 0) < 1,
  }) : null;

  // ?noflee=1 is the flee-measurement CONTROL ARM (hoard2's lever, same name) — decided at
  // construction, one sim either way, so both arms consume the stream identically.
  const sim = createAgentSim({ ...CIV, count }, srng, { cap: count, sepRadius: 0.10, clampBlocked: true, flee: Q.get('noflee') !== '1', placer: places });
  sim.populate(flee);

  /* the outbreak's receipts: an event log the probes replay-compare (payload strings built AT emit
     time — the record objects are reused). tick is SIM time; identical across machines and fps. */
  const ob = { tick: 0, bites: 0, turns: 0, log: [] };
  const stepS = {
    field: flee, zpool: null, huntField: hunt, aabbs: null,
    onBite: (c) => { ob.bites++; ob.log.push(`${ob.tick}:bite:${c.id}:inc${c.incubDur.toFixed(4)}@${c.x.toFixed(4)},${c.z.toFixed(4)}`); },
    onTurned: (c) => { ob.turns++; ob.log.push(`${ob.tick}:turn:${c.id}@${c.x.toFixed(4)},${c.z.toFixed(4)}`); },
  };

  /* PATIENT ZEROS — seeded at a fixed tick, nearest a FIXED point (the plaza), so the outbreak's
     origin is a property of the seed, never of where the player happens to stand. */
  const ZEROS = Math.max(0, qNum('zeros', 2)), ZERO_TICK = 120;

  const _threats = [], _prey = [];
  function reseed(which) {
    _threats.length = 0; _prey.length = 0;
    sim.forEach((_i, c) => {
      if (!c.alive) return;
      if (c.state === 'i') _threats.push({ x: c.x, z: c.z });
      else if (c.state === 's') _prey.push({ x: c.x, z: c.z });
    });
    if (which === 'flee') flee.solve(_threats);
    else hunt.solve(_prey);
  }
  reseed('flee'); // zero infected at boot → an empty solve = every cell reads SAFE

  /* the tier A/B renderer (engine-core): rigs near, one capsule draw far, the same colour ramp on
     both sides of the seam. speedRef = the fastest thing in the crowd (a chaser at full tilt). */
  const civRig = createCharacterRig({ url: survivorUrl, states: { idle: 'Idle', walk: 'Walk', run: 'Run', hit: 'HitReact', death: 'Death' } });
  /* ?tiera/?tierr/?tierlod are BENCH levers (tools/city-population-bench.mjs): the rig-ceiling arm
     widens tierRadius so enough agents are in promote range to FILL the slots, and raises lodDistance
     to match so every rig mixes at FULL rate — the ceiling must measure rigs at their real cost, not
     rigs the LOD throttle is already saving. Defaults are the shipped tuning. */
  const tiers = createCrowdTiers({
    rig: civRig, size: count, tierA: Math.max(0, qNum('tiera', TIERA_DEFAULT)),
    tierRadius: qNum('tierr', 7), hysteresis: 1.5, baseScale: CIV_SCALE, groundY: 0,
    capsule: { radius: 0.03, height: CIV_HEIGHT },
    speedRef: CIV.chase.speed, lodDistance: qNum('tierlod', 6), lodHz: 3,
    castShadow: true, motionLayers: true,
    /* A-AERIAL — swing-ledger OPEN #25's cure, and the three arms are a URL param because the whole
       point is that the choice was MEASURED (see the ledger's A-AERIAL ablation table):
         ?mark=0      off — the A-CITIZENS baseline, exactly
         ?mark=flat   unlit but NOT distance-scaled (the "emissive tint on the far tier" arm)
         (default)    unlit AND constant apparent size — the shipped cure
       `angular` 0.0075 world-radii per unit of distance is ~10 device px across at this viewport and
       fov, which is the size a marker stops being a speck; `minSize` 0.05 is what it is worth up close,
       where the BODY already carries the read and the mark must not shout over it. */
    mark: MARK_MODE === 'off' ? null : {
      angular: MARK_MODE === 'flat' ? 0 : 0.0075,
      minSize: 0.05,
    },
  });
  scene.add(tiers.group);

  let acc = 0;
  return {
    sim, tiers, ob, flee, hunt, places,
    update(dt, camX, camY, camZ) {
      acc += dt;
      let sub = 0;
      while (acc >= SIM_DT && sub < SIM_MAX_SUB) {
        acc -= SIM_DT; sub++;
        ob.tick++;
        if (ob.tick === ZERO_TICK && ZEROS > 0) sim.forceExpose(ZEROS, 0, 0);
        if (ob.tick % FLEE_EVERY === 0) reseed('flee');
        if (ob.tick % HUNT_EVERY === HUNT_OFFSET) reseed('hunt');
        sim.step(SIM_DT, stepS);
      }
      if (acc > SIM_DT) acc = SIM_DT; // substep cap hit (a 1 fps CI renderer) → sim runs slow, never spirals
      tiers.update(dt, camX, camY, camZ, sim);
    },
    dispose() { scene.remove(tiers.group); tiers.dispose(); },
  };
}
population = bootPopulation(qNum('civs', CIVS_DEFAULT));

/* ---------------------------------------------------------------------------------------------
   3. THE CHARACTER + THE WEB. The profile is a LOCAL COPY of GRAPPLE_PROFILE, never the shared
   export — the lab mutates it live from the dock, and mutating the module's own object would poison
   every other consumer in the bundle (the same shared-default hazard CAR_PROFILE spreads to avoid).
   --------------------------------------------------------------------------------------------- */
const SWING = { ...GRAPPLE_PROFILE, aimMode: Q.get('aim') === 'auto' ? 'auto' : 'point' };

/* ---- A-CLIMB (2026-08-10): THE RANGE IS DERIVED FROM *THIS* ROOM, NOT INHERITED FROM A CITY. -----
   The owner's ask was "increase the distance I can shoot a web and lock on a target". The constant he
   was hitting is `GRAPPLE_PROFILE.ropeMax` = 3.2, and that number's own comment says where it comes
   from: metropolis's arithmetic, where anchors land near y 3.5 and the street near 0.3. This lab's
   towers are nothing like that — median top 5.58 u, streets 2.50 u — so the constant is fitted to the
   wrong room, which is precisely swing-ledger.md OPEN #7 ("re-fitting the constants PER LEVEL is the
   better answer") arriving as a feature request.
   SO IT IS RE-DERIVED HERE, from the arena's own measured skyline, through the engine's `swingableRope`
   — the exact inverse of the `swingableHeight` this level's towers were built with. The arc-bottom
   rule says a full-length rope needs `top > skim + arcClear + ropeMax`; invert it and the rope is
   whatever the towers afford.
   THE PERCENTILE IS THE WHOLE OF THE SAFETY MARGIN, and picking it that way is what makes the number
   defensible instead of tuned. Derive from `topAt(0.35)` and the answer states its own guarantee: the
   tower you measured IS the arc-bottom minimum, so exactly the towers ABOVE it — 65% of them —
   support a full-length swing. Deriving off the MEDIAN instead reads better and is worse: it gives
   4.46 u and leaves only 60% of the skyline swingable, which is the level's own gate sitting on its
   threshold. Measured here: topAt(0.35) = 4.61 u → rope 4.10 u (+28% on 3.2), 51/80 towers clear.
   WHAT THAT BUYS, measured off this arena rather than asserted: from the street spawn the nearest
   facade is 1.768 u away, so the highest anchor a rope of R can reach on it is sqrt(R^2 - 1.768^2) —
   2.67 u at 3.2 and 3.70 u at 4.10, i.e. +39% up the tower you are standing next to.
   THE PRICE, and it is real: this is ledger OPEN #0 ("higher and faster versus lower and steadier"),
   which was recorded as an owner call and has now been made by the owner asking for range. The chain
   trades net ground for altitude and airtime — numbers in the ledger's A-CLIMB table.
   WHY NOT RAISE THE PROFILE CONSTANT: metropolis's median building top is 1.14 u. A longer rope there
   is the exact opposite of a fix, and its two probes drive the shipped number. The ABILITY (deriving a
   rope from a skyline) is in engine-core; the NUMBER is this level's. */
/* ---- A-SKYLINE: `roofAt`, NOT `topAt`, AND THE DIFFERENCE IS THE WHOLE POINT OF THE NEW ACCESSOR.
   `topAt` is a percentile over EVERY solid. On the uniform grid those are the same set (proved in
   box-arena.test.mjs at six percentiles, so this line does not move the lab's 4.10 by a bit), but a
   silhouetted city's solids buffer is 80% cornices, roof plant and bridge decks — most of them low — so
   `topAt(0.30)` there answers a question about cornices and would hand this derivation a rope with
   nothing to do with the skyline. `roofAt` is the percentile over TOWER ROOFS: what you can stand on,
   and what the arc-bottom rule is about. */
function fitRopeToArena() {
  SWING.ropeMax = Number(swingableRope({
    towerTop: arena.roofAt(SKYLINE_P), arcClear: SWING.arcClear, skim: SWING.skim,
    groundY: arena.params.groundY, ropeMin: SWING.ropeMin,
  }).toFixed(2));
  /* THE HANG CAP IS DERIVED FROM THE ROPE AND HAS TO MOVE WITH IT — the ledger says so in as many
     words ("recompute it if you move ropeMax or gravity; this number is derived from them, not chosen
     beside them"). A latched rope's backstop is a full pendulum period plus margin: 2*pi*sqrt(L/g) is
     4.84 s at rope 3.2 and 5.71 s at 4.46, so a 6.0 s cap fitted to the SHORT rope would start cutting
     long swings on the LONG one — a clock racing a pendulum it was never sized against, which is the
     exact failure that constant's own comment warns about. */
  SWING.maxHangLatched = Number((2 * Math.PI * Math.sqrt(SWING.ropeMax / SWING.gravity) * 1.24).toFixed(2));
  return SWING.ropeMax;
}
fitRopeToArena();

/* EVERY tuning constant is url-addressable, including the four A-LAB assists — so an A/B is a URL
   pair and not a rebuild, and a probe can zero one knob to attribute a delta to it. */
for (const k of ['ropeMax', 'ropeMin', 'assist', 'launchUp', 'launchFwd', 'releasePitch', 'maxSpeed', 'maxVertSpeed',
  'gravity', 'pump', 'airDrag', 'maxHang', 'maxHangLatched', 'pivotOut', 'attachBlend', 'floorAssist', 'arcClear',
  'minRise', 'zipSlopeMin', 'climbRate', 'clingReach']) {
  if (Q.has(k)) SWING[k] = qNum(k, SWING[k]);
}
const EYE = 0.28;
/* A-BODY: the three numbers the CONTROLLER and the BODY must agree about, declared once and read by
   both. Two copies of "how fast is a walk" is how the legs end up at a cadence the physics is not
   travelling at — the same class of drift as the stale 1.2 in `aimReach` (A-CLIMB note below), which
   sat wrong for an arc because nobody had to look at two places to change one fact.
   HERO_H 0.30: a human eye sits ~93% up the body, and this controller's eye is 0.28. */
/* A-AIR adds JUMP_V to that list for the same reason the other three are on it. The airborne motion
   layer needs the vertical speed at which its shape is fully expressed, and the honest answer is this
   level's own jump speed — at launch the body is fully crunched, and anything faster (a rooftop drop)
   is fully spread. Declared once, handed to BOTH the controller and the body. */
const HERO_H = 0.30, WALK_V = 0.55, SPRINT_V = 0.95, JUMP_V = 1.2;
/* THE CHASE BLOCK IS A NAMED OBJECT because TWO things need `distMax` and the second one silently had
   a copy of it (A-CLIMB). `aimReach` below measures the aim ray from the EYE, so it has to add back the
   arm the eye sits behind — and it was adding a literal 1.2 that had been correct until A-LAB raised
   the chase to 3.0. Nobody noticed, because the wrong number is not an error, just a shorter ray. One
   object, read twice. */
const THIRD = { dist: 1.9, distMax: 3.0, distAtSpeed: 6, height: 0.34, side: 0.16, springR: 0.06, minDist: 0.35 };
const character = createCharacterController({
  world: arena.world,
  grapple: createGrappleModel(SWING),
  grappleProfile: SWING,
  /* Locomotion numbers are metropolis's, unchanged, so a comparison between the two levels is a
     comparison of LEVELS. Gravity matches the grapple's exactly — the two integrators hand the same
     body back and forth mid-flight, so a mismatch reads as the character getting heavier when a web
     cuts (character.js's own seam note). */
  eyeHeight: EYE, radius: 0.09, footR: 0.12, collideYOff: 0.14,
  moveSpeed: WALK_V, sprintSpeed: SPRINT_V, accel: 14,
  jumpSpeed: JUMP_V, gravity: SWING.gravity,
  /* THE CHASE IS SIZED TO THIS LEVEL'S STREETS, and that is the kind of thing a lab exists to find.
     metropolis uses 0.9 u because its street canyon is 0.55 u wide and anything longer spends the
     whole game clipped against a facade. Here the street is 2.5 u, so the arm has room — and it needs
     it: the first mid-swing capture off this lab came back with the body FILLING the frame (the
     spring arm had clipped 0.9 down to 0.42), which is the one thing a third-person swing camera must
     not do. `distMax` opts into the engine's speed dolly on top. */
  third: THIRD,
  fov: { base: 58, max: 78, atSpeed: 7 },
  /* ---- A-CLIMB: THE CAMERA IS NOT A POINT, so the containment budget is not a point either. -------
     The owner reported clipping through buildings that every check said was not happening, and both
     were true: the eye was never inside a solid (0/260 measured frames) while the NEAR PLANE's corners
     were, on 52 of the same 260. This is the one line that fixes it, and the radius is COMPUTED from
     this camera rather than picked — at near 0.02 and the widest FOV the speed cue reaches (78°) the
     frustum's front corner sticks out 0.036 u from the eye, which is more than the 0.020 u the eye was
     measured to have. `cameraNearRadius` is fed the MAX fov, not the current one: a clearance that
     shrinks exactly when the frame widens is a clearance that fails at speed, which is when a chase
     camera is nearest a wall. */
  camEyeClear: cameraNearRadius({ near: 0.02, fov: 78, aspect: 2, margin: 1.25 }),
  /* ---- A-CLIMB: WALL CLING, ON. The ability is engine-core's and it defaults OFF, so this line is
     the whole of "the lab has climbing" — the numbers come from the swing profile above, which is
     where `clingReach`/`climbRate` already lived. See character.js for why the top-out (mantle) is
     the half that makes it a way ONTO a roof rather than a way up a wall. */
  cling: { enabled: true },
});

/* ---- A-BODY (2026-08-13): THE PLACEHOLDER CAPSULE IS GONE. -------------------------------------
   For the whole of this arc the thing you were looking at while tuning a swing was a red capsule, and
   the file said so in as many words ("placeholder geometry is an accepted stand-in — the arc is the
   controller, not the art"). That ruling was right while the question was whether the pendulum worked;
   it stops being right the moment the ledger's own technique #4 — LOOK AT THE CAPTURE — is the method,
   because a capsule has no legs to tell you the walk is a half-run, no arm to tell you the web left
   from the wrong place, and no silhouette to judge a release by.
   THE ABILITY IS ENGINE-CORE'S (`createHeroBody`) and the wiring is these fifteen lines. Every number
   here is a fact about THIS level and nothing else:
     · height 0.30 — the controller's eye is 0.28 and a human's eye sits ~93% up the body, so 0.30 puts
       this eye where the controller already decided it goes. It also lands a head above the 0.26 u
       civilians (CIV_HEIGHT above), which is the read A-CITIZENS chose deliberately.
     · walk/sprint 0.55/0.95 — the SAME two constants passed to the controller below, so the legs and
       the physics cannot drift apart. Passed by reference to the same literals, not copied by hand:
       that copy is exactly how `aimReach` grew a stale 1.2 (see the A-CLIMB note further down).
   THE COLLIDER IS UNTOUCHED — this is a costume on a capsule, not a new collision shape. */
const hero = createHeroBody({
  url: survivorUrl,
  /* `?hero=capsule` IS THE CONTROL ARM for the perf question, and it is why the perf table in the
     ledger is trustworthy: the two rows are two URLs of ONE build, so the only thing that differs
     between them is whether the player is a skinned rig or the capsule that was here before. */
  skinned: Q.get('hero') !== 'capsule',
  height: HERO_H, walkSpeed: WALK_V, sprintSpeed: SPRINT_V,
  /* A capsule of the OLD dimensions carries the frame until the GLB lands (~1 s cold), so no capture
     and no probe phase ever sees a bodiless player — the exact frame a screenshot is likeliest to
     catch. It removes itself; nothing here has to know when. */
  fallback: { radius: 0.06, length: 0.16, color: '#d8482f' },
  /* ---- FIRST PERSON, AND THE NUMBER THAT DECIDED IT (tools/hero-fp-ab.mjs, six arms, one pose) -----
     A first-person body at THIS scale is a near-plane problem, not an art problem, and the numbers say
     so exactly. The eye is at 0.28 on a 0.30 u body — 93% up, i.e. inside the head — so with the body
     rendered at the collider's own position the NECK bone's minimum distance to the camera over a
     second of idle animation is 0.0048 u against a near plane of 0.02. The near plane is four times
     further away than the neck, so it slices the neck and shoulders and the frame fills with shards.
     Measured, all six arms, min-over-a-second (the first pass of this A/B read a single frame and got
     the OPPOSITE answer, because the idle clip breathes the neck toward and away from the eye — a
     clearance that is true on the frame you looked is not a clearance):
        body   back 0     → Neck 0.0048  ✗ inside near   · shards
        nohead back 0     → Neck 0.0102  ✗ inside near   · shards (hiding a BONE does not move the neck)
        nohead back 0.05  → Neck ~0.055  ✓ 2.7x near     · reads as a torso, an arm and legs
     So the fix is `backOff`: slide the body back along the look axis in first person only. It buys
     real clearance, and its price is stated — the rendered body is 0.05 u behind its collider in a view
     where the only thing that can show the difference is your own shadow. `nohead` on top, because at
     back-off you would otherwise be looking at the top of your own head.
     Every arm stays URL-addressable (`?fpbody=body|nohead|off&fpback=<u>`) so the next person re-judges
     this by looking rather than by believing this comment. */
  firstPerson: {
    mode: ({ body: 'body', nohead: 'nohead', off: 'off' })[Q.get('fpbody')] || 'nohead',
    backOff: qNum('fpback', 0.05),
  },
  /* ---- A-AIR (2026-08-15): THE AIR POSES STOP BEING PHOTOGRAPHS. --------------------------------
     A-BODY left this exact item open in the ledger and in its own header: jump/fall/swing/cling are a
     single frozen frame of the Jump clip, and "a held frame does not breathe". The ability is engine-
     core's (`hero-air.js` + the rig's `setAirMotion`); this is the two numbers that are facts about
     THIS level and nothing else:
       · vRef = JUMP_V — the same literal handed to the controller above, by reference. It is the
         vertical speed at which the shape is fully expressed, and jump speed is what that means here.
       · climbRate 1.15 — `SWING.climbRate`, i.e. the number the CONTROLLER climbs a wall at. While
         clinging, character.js writes `state.vy = lift * climbRate`, so |vy|/climbRate is exactly how
         hard the player is climbing and it drives the wall cycle. Read off the profile, never retyped.
     `?heroair=0` is the CONTROL ARM, and it exists so the question "is the layer actually better" is
     answered by two URLs of ONE build — the same discipline `?hero=capsule` brought to the perf table.
     With it off, cling goes back to reaching at the wall with one arm and every air pose is a still. */
  airMotion: Q.get('heroair') === '0' ? false : { vRef: JUMP_V, climbRate: SWING.climbRate },
});
scene.add(hero.group);
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
/* ---- A-CLIMB (2026-08-10): THE *LOCK* RANGE IS A SEPARATE, LONGER NUMBER THAN THE WEB RANGE, and
   the owner asked for both to go up. They are not the same question:
     · the WEB range is `ropeMax`, measured from the BODY, and `reachFromAim` is the only judge of it;
     · the LOCK range is how far this ray is cast from the EYE, and it decides what you can put a mark
       on — including things you cannot web YET. That is the useful half: lock a tower across the
       plaza, run at it, and the mark brightens the moment it comes into rope range.
   THE OLD NUMBER WAS THREE CONSTANTS, ONE OF THEM STALE: `ropeMax + 1.2 + 2.6`, where 1.2 stood for
   the chase arm — which A-LAB raised to `distMax` 3.0 without this line hearing about it, so the ray
   was 1.8 u shorter from the body than it read. Each term is now what it says it is:
     ropeMax            — everything you can actually web
   + third.distMax      — the arm the eye sits behind, so the range is measured from the BODY
   + arena spacing      — one full block beyond your web, which is the LOCK band: enough to mark the
                          next tower over (measured 5.59 u to the second ring from a street spawn) and
                          enough that the dim crosshair means "too far", never "nothing there". */
const aimReach = () => SWING.ropeMax + THIRD.distMax + arena.params.spacing;
const _aimPt = { x: 0, y: 0, z: 0 };
let aimHit = null;
const reticle = createAimReticle({ container: document.body });
reticle.setVisible(true);

/* ---- A-LOCK (2026-08-09): THE OWNER'S CONTROL SCHEME, wired. His words:
   "You left click to LOCK ONTO a place, and then you RIGHT CLICK to shoot a web and then swing… you
   can use the SPACE BAR to jump off of your swing."
     LMB → take a lock on whatever the crosshair is over. It PERSISTS and it is VISIBLE.
     RMB → throw the web at the lock. WITH NO LOCK IT FIRES AT THE CROSSHAIR ANYWAY — an assumption
           stated plainly, and made because a quick web must never be blocked by a missing ceremony;
           if the owner wants a hard lock requirement it is the one line below.
     SPACE → release + launch (and jump when grounded — one verb, both states).
   The ABILITIES are engine-core's (`createTargetLock` copies the point so a lock cannot silently
   alias the reused crosshair buffer; `createLockMarker` draws it). This file only decides the keys. */
const targetLock = createTargetLock();
const lockMark = createLockMarker({ container: document.body });
lockMark.setVisible(true);
let webPressed = false;                 // ONE frame of true per right-click — the model edge-triggers
let lockFlash = 0;
const lockAim = createPointerLockAim({
  element: renderer.domElement,
  onLook: (dx, dy) => character.addLook(dx, dy),
  onButton: (btn, down) => {
    if (!down) return;
    if (btn === 0) {                    // LEFT — lock on
      if (targetLock.lock(aimHit)) { lockFlash = 1; flash('LOCKED — right-click to web it'); }
      else flash('nothing under the crosshair to lock');
    } else if (btn === 2) {             // RIGHT — throw the web
      webPressed = true;
      /* A-CLIMB: A WEB THAT DOES NOT FIRE HAS TO SAY WHY. This is the control-feel gap the audit
         found that no latency number could: a right-click with nothing in range produced NO feedback
         whatsoever — the same silence as a dropped input — so a player cannot tell "the game ignored
         me" from "I missed". There are exactly two reasons under this scheme and the state already
         knows which, so name it. Read BEFORE the frame consumes the press, which is why it is here and
         not in the frame loop: by then `aimInRange` has been recomputed for the web that just fired. */
      if (!character.state.aimInRange) {
        flash(webTarget() ? `too far — web reaches ${SWING.ropeMax.toFixed(1)} u` : 'nothing under the crosshair');
      }
    }
  },
  /* Losing the lock (Esc, tab switch) must not leave an input latched. The ROPE is not cleared here —
     it is the character's now, not the mouse's, and Space is always available to cut it. That is the
     scheme's own answer to the bug this callback originally existed for. */
  onLockChange: (locked) => { if (!locked) webPressed = false; },
});
renderer.domElement.addEventListener('pointerdown', () => { if (!lockAim.locked) lockAim.request(); });
/* THE POINT THE WEB FLIES AT: the lock if you took one, otherwise whatever is under the crosshair.
   One function, read by the attach AND by the crosshair's range verdict, so the mark cannot promise
   something the web will not do (aim.js's own rule about one implementation of "in range"). */
const webTarget = () => (targetLock.has ? targetLock.point : aimHit);

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
/* SPACE IS AN EDGE THAT MUST SURVIVE TO THE NEXT FRAME, exactly like the web button — and this is a
   real input-fidelity fix, not probe plumbing. A tap whose keydown and keyup both land between two
   rAFs is invisible to a level-triggered `held.has(' ')` read, so the press is silently dropped. On a
   144 Hz display that window is 7 ms; a human can beat it, and a harness beats it every time (measured:
   `page.keyboard.press('Space')` produced 826 presses and ZERO releases in a 12 s chain run — the
   press was real and the read was blind). The character already edge-triggers internally, so one
   frame of `true` is exactly what it wants; this just guarantees the frame happens. */
let spacePulse = false;
addEventListener('keydown', (e) => {
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (e.repeat) return;
  held.add(k);
  if (k === ' ') spacePulse = true;
  if (k === 'v') character.toggleView();
  if (k === 'r') spawn();
  if (k === 't') { SWING.aimMode = SWING.aimMode === 'point' ? 'auto' : 'point'; flash(`aim: ${SWING.aimMode}`); }
  if (k === ' ') e.preventDefault();
});
addEventListener('keyup', (e) => held.delete(e.key.length === 1 ? e.key.toLowerCase() : e.key));
addEventListener('blur', () => { held.clear(); webPressed = false; });   // an unfocused window must not hold keys down

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
  const st = character.swinging ? 'swing' : character.clinging ? 'climb' : (character.grounded ? 'walk' : 'air');
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
  set('v-aim', s.aimInRange ? 'YES' : (webTarget() ? 'too far' : 'no target'), s.aimInRange ? 'on' : 'off');
  /* THE LOCK IS ON THE READOUT because "why did my web not fire" has exactly two answers under this
     scheme — no target, or a target out of range — and the player must be able to tell them apart
     without guessing which one the dim crosshair meant. */
  set('v-lock', targetLock.has ? `${targetLock.point.y.toFixed(2)} y  (${lockMark.onScreen ? 'on screen' : 'off screen'})` : 'none — LMB to lock',
    targetLock.has ? 'on' : 'off');
  set('v-src', targetLock.has ? 'LOCK' : (aimHit ? 'crosshair' : '—'));
  /* THE TWO RANGES, SIDE BY SIDE, because they are different numbers and "why did that not fire" has
     to be answerable without guessing which one the dim crosshair meant (A-CLIMB). */
  set('v-range', `web ${SWING.ropeMax.toFixed(2)} u · lock ${aimReach().toFixed(2)} u`);
  set('v-cling', character.clinging ? 'STUCK — W up, S down' : 'no', character.clinging ? 'on' : 'off');
  /* A-BODY: the body's own verdict, next to the physics'. `rigged` is the honest half — before the GLB
     lands this says so rather than reporting a pose the capsule cannot be in. */
  /* A-AIR appends the airborne layer's own weight, and it earns the space: it is the one number that
     distinguishes "this pose is a still" from "this pose is being driven", and on the ground it reads
     0.00 — so the row also proves the layer releases instead of quietly leaning on a walk. */
  set('v-pose', hero.rigged
    ? `${hero.pose} · ${hero.gaitLabel} (${hero.gait.toFixed(2)}) · ${(hero.bodyHeight).toFixed(2)} u`
      + (hero.airMotion ? ` · air ${hero.airWeight.toFixed(2)}` : ' · air off')
    : 'placeholder capsule — GLB loading', hero.rigged ? 'on' : 'off');
  set('v-climb', `${character.climbs} · ${character.mantles} roofs`);
  set('v-latch', character.latched ? 'HELD — space to launch' : 'no', character.latched ? 'on' : 'off');
  set('v-webs', `${stats.webs} fired · ${character.releases} launched`);
  const g = stats.groundPerSwing;
  const mean = g.length ? g.reduce((x, y) => x + y, 0) / g.length : 0;
  set('v-per', g.length ? `${mean.toFixed(2)} u (n=${g.length})` : '—');
  set('v-peak', stats.peak.toFixed(2));
  set('v-trav', stats.travel.toFixed(1));
  set('v-fps', stats.fps.toFixed(0));
  /* A-SKYLINE: THE GUARANTEE AND THE COST, SIDE BY SIDE. The fraction is what the level promises; the
     draw-call count is what it costs, and it has to sit next to the fraction because "make it taller"
     and "make it cheaper" are the two ways this generator could be wrong. One InstancedMesh carries
     every tower and every silhouette part, so the second number should barely move with the first. */
  const ar = arena.stats;
  set('v-level', `${LEVEL} · ${ar.towers} towers · ${ar.parts} parts · ${arena.stats.extent.toFixed(0)} u`);
  set('v-swingable', ar.swingable
    ? `${(100 * ar.swingable.frac).toFixed(1)}% clear ${ar.swingable.need.toFixed(2)} u (want ${(100 * ar.swingable.want).toFixed(0)}%)`
    : `median roof ${ar.roofMedian.toFixed(2)} u`, ar.swingable ? 'on' : '');
  const ri = renderer.info.render;
  set('v-draws', `${ri.calls} · ${(ri.triangles / 1000).toFixed(0)}k tris · build ${LEVEL_BUILD_MS.toFixed(1)} ms`);
  /* A-CITIZENS: S/E/I is the outbreak in three integers; rigs·capsules is what drawing it costs. */
  if (population) {
    const s = population.sim, t = population.tiers.counts;
    set('v-outbreak', `S ${s.sCount} · E ${s.eCount} · I ${s.iCount} · ${t.a} rigs + ${t.b} caps`);
  }
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
  /* RESET RESTORES THE PROFILE *AND* RE-DERIVES THE ROPE (A-CLIMB) — `GRAPPLE_PROFILE.ropeMax` is
     metropolis's 3.2, and handing that back here would silently undo the range the level affords and
     look like the slider had broken. "Reset" means the shipped tuning for THIS room. */
  $('b-reset').addEventListener('click', () => { for (const k of TUNE) SWING[k] = GRAPPLE_PROFILE[k]; fitRopeToArena(); syncDock(); flash(`swing profile reset · rope ${SWING.ropeMax.toFixed(2)} u`); });
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
  /* A PRESET CHANGES THE ROOM, SO IT RE-FITS THE ROPE (A-CLIMB). That is the lab's whole thesis
     applied to itself: the range is a function of the skyline, so switching to the METROPOLIS preset
     (median top 1.14 u) must hand back the short rope that room affords, not keep the long one this
     one earned. Before `syncDock`, so the slider shows the number actually in force. */
  /* EVERY PRESET NOW STATES `skyline`/`silhouette` EXPLICITLY, INCLUDING THE ONES THAT WANT NEITHER.
     `rebuild` is an Object.assign merge, so a preset that simply omits them would inherit whatever the
     last one set — click CITY then SWING and you would get the lab's spacing with the city's height
     distribution, which is a level nobody chose and no comment would explain. The same class of bug as
     the ledger's latched-mode entries: an entry path that does not clear what an exit path set. */
  const preset = (o, msg) => () => {
    arena.rebuild({ skyline: null, silhouette: null, ...o });
    fitRopeToArena(); syncDock(); spawn();
    flash(`${msg} · rope ${SWING.ropeMax.toFixed(2)} u`);
  };
  $('b-preset-swing').addEventListener('click', preset({ cols: 9, rows: 9, spacing: 4.2, width: 1.7, height: Number(swingableHeight().toFixed(2)), heightVary: 0.45, plaza: 1 }, 'preset: SWING'));
  /* THE CITY PRESET RE-DERIVES AT ITS OWN PERCENTILE, which `fitRopeToArena` reads from `SKYLINE_P` —
     a constant of the page, not of the preset. Clicking CITY from a lab page therefore derives the
     city's rope at 0.35 rather than 0.30 and reports whatever that is, honestly, instead of pretending.
     The measured entry point is `?level=city`, which is what the probe and the bench drive. */
  $('b-preset-city').addEventListener('click', preset({ ...CITY_ARENA }, 'preset: CITY (A-SKYLINE)'));
  $('b-preset-metro').addEventListener('click', preset({ cols: 13, rows: 13, spacing: 2.45, width: 1.9, height: 1.14, heightVary: 0.6, plaza: 0 }, 'preset: METROPOLIS (the control)'));
  $('b-preset-open').addEventListener('click', preset({ cols: 5, rows: 5, spacing: 8.0, width: 2.2, height: 9.0, heightVary: 0.3, plaza: 1 }, 'preset: OPEN (far towers)'));
  const dock = $('dock');
  $('dock-toggle').addEventListener('click', (e) => { e.stopPropagation(); dock.classList.toggle('min'); $('dock-toggle').textContent = dock.classList.contains('min') ? '+' : '–'; });

  /* A-CITIZENS: the density dial, city only (the row unhides itself below). Rebooting the population
     is the honest implementation of a density change — same seed ⇒ the new crowd is deterministic
     too, it is simply a different (larger) draw sequence than the old one. */
  if (LEVEL === 'city') {
    const row = $('row-civs'), el = $('p-civs');
    if (row && el) {
      row.style.display = '';
      el.value = String(qNum('civs', CIVS_DEFAULT));
      $('n-civs').textContent = el.value;
      el.addEventListener('input', () => {
        const v = Number(el.value);
        $('n-civs').textContent = String(v);
        if (population) population.dispose();
        population = bootPopulation(v);
      });
    }
    const ob = $('row-outbreak'); if (ob) ob.style.display = '';
  }
}
wireDock(); syncDock();

/* ---------------------------------------------------------------------------------------------
   8. THE FRAME.
   --------------------------------------------------------------------------------------------- */
const _camPos = { x: 0, y: 0, z: 0 }, _camDir = { x: 0, y: 0, z: 0 };
const _hand = new THREE.Vector3();   // A-BODY: the rope's origin, refilled each frame (never re-alloc)
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
  const target = webTarget();
  character.update(dt, {
    x: side, y: fwd,
    sprint: held.has('Shift'),
    boost: held.has('Shift') ? 1 : 0,
    /* SPACE IS ONE VERB IN TWO STATES — jump on your feet, release-and-launch off a swing. The
       controller edge-triggers it internally and spends the press on exactly one of them. */
    jump: held.has(' ') || spacePulse,
    /* THE WEB IS AN EVENT, NOT A HELD AXIS: one right-click, one web. Consumed here so a press that
       arrives between frames is never lost and never counted twice. */
    web: webPressed,
    steer: side,                    // while roped, A/D steer the arc instead of strafing
    lift: fwd,                      // while roped, W/S reel the rope in and out
    /* THE LOCK IS THE TARGET WHEN THERE IS ONE. `reachFromAim` measures range from the BODY, so the
       same point drives the attach and the crosshair's verdict — no second copy of "in range". */
    aimPoint: target,
  });
  webPressed = false;
  spacePulse = false;                 // both edges are consumed by exactly one frame, then cleared
  reticle.setInRange(!!character.state.aimInRange);
  lockMark.setInRange(!!character.state.aimInRange);
  targetLock.tick(dt);
  if (lockFlash > 0) lockFlash = Math.max(0, lockFlash - dt * 2.5);

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

  /* --- the visible body (A-BODY). One call: the ability reads the controller state and poses itself.
     `lookYaw` is handed over because `state.yaw` only tracks the look while MOVING — stand still in
     first person without it and you look down at a body facing whichever way you last walked. --- */
  hero.update(dt, s, { view: character.view, lookYaw: character.lookYaw, anchor: s.anchor });
  if (s.anchor) {
    const p = ropeGeo.attributes.position;
    /* THE WEB LEAVES THE HAND, not the sternum. The body's arm is now genuinely extended at the anchor
       (the rig's aim-IK layer, driven by createHeroBody), so a rope starting at chest height reads as a
       line that missed the arm it is supposed to be coming out of — the animation and the mechanic
       visibly disagreeing. `webAnchorPoint` returns the throwing hand's world position and falls back
       to this same chest point before the GLB lands, so there is never a frame with no rope origin. */
    _hand.set(character.x, character.y + EYE * 0.6, character.z);
    hero.webAnchorPoint(_hand);
    p.setXYZ(0, _hand.x, _hand.y, _hand.z);
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

  /* A-CITIZENS: the population, AFTER rig.update so the tier promote/demote reads the camera the
     frame will actually render from. The sim inside advances on its own fixed 1/60 tick — dt here
     only decides HOW MANY ticks fire — and it never reads the character: the player is a ghost to
     the crowd (player-agent collision + friendly fire = unratified owner calls, both OFF). */
  if (population) {
    const cp = rig.camera.position;
    population.update(dt, cp.x, cp.y, cp.z);
  }

  renderer.setRenderTarget(null);
  renderer.render(scene, rig.camera);
  /* THE LOCK MARKER IS PLACED *AFTER* THE RENDER, and that is a real ordering requirement rather than
     housekeeping: it projects through `camera.matrixWorldInverse`, which is what `renderer.render`
     freshens. Place it before, and the mark trails the camera by one frame — invisible standing still
     and obvious at 7 u/s, which is precisely when a player is looking at it. */
  lockMark.place(rig.camera, targetLock.point);
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
  /* A-LOCK: THREE receipts now, not one. `fire` used to be the whole trigger; under this scheme the
     verbs are LEFT (lock), RIGHT (web) and SPACE (launch), and a probe has to be able to prove each
     one arrived — the same rule that caught three benches of nonsense, applied to three buttons.
     `lmb`/`rmb` read the pointer-lock module's OWN button state, so they cannot agree with a probe
     that merely believes it clicked. */
  get fire() { return lockAim.down(2); },        // the web button, under its old probe name
  get lmb() { return lockAim.down(0); },
  get rmb() { return lockAim.down(2); },
  get space() { return held.has(' ') || spacePulse; },
  get locked() { return lockAim.locked; },
  get keys() { return [...held]; },
};
/* THE LOCK, EXPOSED, so a probe can prove the thing the owner asked for by name: that a lock PERSISTS
   and does not silently follow the crosshair (the aliasing bug `createTargetLock` exists to prevent —
   a probe that only ever samples it on the frame it was taken could never see the difference). */
window.__lock = {
  get has() { return targetLock.has; },
  get point() { return targetLock.has ? { ...targetLock.point } : null; },
  get age() { return targetLock.age; },
  get marker() { return { visible: lockMark.visible, onScreen: lockMark.onScreen, screen: lockMark.screen }; },
  clear: () => targetLock.clear(),
};
/* A-BODY: THE BODY, AS A READABLE FACT. Same rule as `__input` and `__level` — a capture can show that
   a body is there and cannot show which pose it believes it is in, what scale the GLB was measured
   into, or whether the rope is actually leaving the hand. All four are checkable numbers, so they are
   exposed as numbers rather than left to a screenshot to imply. */
window.__hero = {
  get rigged() { return hero.rigged; },
  get pose() { return hero.pose; },
  get gait() { return hero.gait; },
  get gaitLabel() { return hero.gaitLabel; },
  get scale() { return hero.scale; },
  get height() { return hero.bodyHeight; },
  get visible() { return !!(hero.object && hero.object.visible); },
  get hasHand() { return hero.hasHand; },
  /* A-AIR RECEIPTS. "The pose is animated now" is a CLAIM, and a screenshot of one frame cannot settle
     it — a still and a moving body photograph identically. `airMode`/`airWeight` say the layer is armed
     and how far it has eased in; `bonePos` lets a harness measure the same bone across frames, which is
     what actually distinguishes an animation from a photograph. */
  get airMotion() { return hero.airMotion; },
  get airMode() { return hero.airMode; },
  get airWeight() { return +hero.airWeight.toFixed(4); },
  get poseWeight() { return +hero.poseWeight.toFixed(4); },
  /* the rope's ACTUAL origin this frame, so "does the web leave the hand" is a distance and not an
     impression. Allocates one Vector3 per CALL — a probe read, never a frame path. */
  handPoint() { const v = new THREE.Vector3(); hero.webAnchorPoint(v); return { x: v.x, y: v.y, z: v.z }; },
  /* A NAMED BONE IN THE RIG ROOT'S OWN FRAME — the ONLY frame in which "did the limb move" is a question
     about the POSE rather than about the body. The first version of this derotated by the controller's
     YAW about its origin, and was wrong on exactly the mode it mattered most for: while roped,
     `state.quat` carries the grapple's pitch and BANK (the body leans into its arc, deliberately), and a
     yaw-only derotation leaves all of that lean in the reading — a completely FROZEN pose on a banking
     body measured 0.17 u of "limb travel", which is the size of a real animation. Going through the rig
     root's inverse world matrix removes translation, yaw, pitch and bank in one step, so a held frame
     reads ~0 whatever the physics is doing. (Ledger technique #3, on this arc's own instrument.)
     Rescaled by the measured GLB scale so the numbers are WORLD units — 0.01 u is 3% of a 0.30 u body —
     rather than raw model units, which are ~17x larger and would flatter every reading.
     Probe-only (it allocates a Vector3 per call; never a frame path). */
  bonePos(name) {
    const v = new THREE.Vector3();
    v.set(NaN, NaN, NaN); hero.bonePoint(name, v);
    const o = hero.object;
    if (!Number.isFinite(v.x) || !o) return null;
    o.updateMatrixWorld(true);
    o.worldToLocal(v).multiplyScalar(hero.scale || 1);
    return { x: +v.x.toFixed(4), y: +v.y.toFixed(4), z: +v.z.toFixed(4) };
  },
  /* WHERE THE BODY IS ON SCREEN, in CSS pixels — and this is not a nicety, it is what makes a capture
     readable at all. The chase camera sits 1.9–3.0 u behind a 0.30 u body, so in a 1280x800 frame the
     player is roughly 40x60 px: the first A-AIR strip came back with a figure too small to tell a
     spread-eagle from a shrug, which would have made the whole visual acceptance test worthless. A
     harness that can ask for this can CROP to the body and upscale, and then a pose is judgeable.
     Projected from the rig's own world bounding box through the live camera, so it tracks whatever the
     spring arm is currently doing. Probe-only (it allocates). */
  screenBox(pad = 1.9) {
    const o = hero.object, cam = rig.camera; if (!o) return null;
    /* PROJECT TWO POINTS, NOT A BOUNDING BOX, and the reason is a bug this already produced. The first
       version projected the rig's 8 world-bbox corners — but `project()` on a corner BEHIND the camera
       flips its sign and returns a wildly out-of-range coordinate, so a single corner passing the near
       plane (routine when a spring arm is compressed against a wall, which is exactly what a CLING is)
       blew the box up, and the "tight crop on the body" came back centred on empty ground with the
       figure sliced off at the edge. The feet and the crown of the head are enough to frame a body and
       are both derivable from numbers we already trust: the controller's own position and the height
       this module measured the GLB into. Bail to null (→ the caller keeps the full frame) rather than
       return a crop from a point behind the lens. */
    const s = character.state, h = hero.bodyHeight;
    const W = renderer.domElement.clientWidth, H = renderer.domElement.clientHeight;
    const foot = new THREE.Vector3(s.x, s.y, s.z), head = new THREE.Vector3(s.x, s.y + h, s.z);
    cam.updateMatrixWorld();
    for (const p of [foot, head]) {
      // reject anything at or behind the near plane in VIEW space, where the test is unambiguous.
      const vz = -p.clone().applyMatrix4(cam.matrixWorldInverse).z;
      if (!(vz > cam.near)) return null;
      p.project(cam);
    }
    const fx = (foot.x * 0.5 + 0.5) * W, fy = (-foot.y * 0.5 + 0.5) * H;
    const hx = (head.x * 0.5 + 0.5) * W, hy = (-head.y * 0.5 + 0.5) * H;
    const cx = (fx + hx) / 2, cy = (fy + hy) / 2;
    // the body's apparent height sets the crop; `pad` buys room for limbs thrown wide (a spread-eagle
    // is far wider than the standing silhouette this height measures).
    const r = Math.max(40, Math.hypot(hx - fx, hy - fy) * 0.5 * pad);
    return { x: Math.round(cx - r), y: Math.round(cy - r), w: Math.round(r * 2), h: Math.round(r * 2), vw: W, vh: H };
  },
  /* THE FIRST-PERSON NEAR-PLANE CHECK, as a number. A-CLIMB's finding was that the EYE was clear on
     260/260 frames while the near plane's CORNERS were inside geometry on 52 of them — the same class
     of miss is available here, with the player's own torso as the geometry. So: how far is each named
     bone from the rendered camera, against `camera.near`. A bone nearer than `near` is a body part the
     frustum is cutting through. Probe-only (it allocates). */
  boneDist(names = ['Head', 'Neck', 'Spine2', 'Spine', 'Hips', 'LeftShoulder', 'RightShoulder', 'LeftArm', 'RightArm']) {
    const v = new THREE.Vector3(), cam = rig.camera, out = {};
    for (const n of names) {
      v.set(NaN, NaN, NaN); hero.bonePoint(n, v);
      out[n] = Number.isFinite(v.x) ? +cam.position.distanceTo(v).toFixed(4) : null;
    }
    out.near = cam.near;
    return out;
  },
  ready: hero.ready,
};
/* A-DRESS: THE DRESSING, AS READABLE FACTS. Same rule as `__input` and `__hero`: a capture can show
   that a street looks dressed and cannot show how many lamps were placed, whether the glow layer is
   actually being drawn, or what the whole pass costs in meshes. All of those are numbers, so they are
   exposed as numbers — the night captures of the first cut showed no lamps at all, and the question
   "are they missing or are they dark" is not one a screenshot can answer. */
window.__dress = {
  arms: { ...DRESS },
  get street() {
    if (!streetKit) return null;
    const g = streetKit.group;
    return {
      ...streetKit.stats,
      /* what the RENDERER thinks, not what the generator intended — the two disagreeing is the bug. */
      visible: g.visible,
      layers: g.children.map((c) => ({ type: c.type, visible: c.visible, count: c.count ?? null, opacity: c.material?.opacity ?? null })),
    };
  },
};
window.__spawn = spawn;
window.__setAimMode = (m) => { SWING.aimMode = m === 'auto' ? 'auto' : 'point'; return SWING.aimMode; };
/* A-SKYLINE: THE LEVEL, AS A READABLE FACT. The bench compares two rooms through one page, so it has to
   be able to prove which room it is actually in — the same rule as `__input`: a harness that cannot see
   its own configuration cannot tell a level difference from a URL typo. `buildMs` is the generator call
   only (not the renderer, not the lights), so it is comparable with metropolis's `window.__buildMs`,
   which times `createCity()` and nothing else. */
window.__level = {
  name: LEVEL,
  buildMs: LEVEL_BUILD_MS,
  ropeMax: SWING.ropeMax,
  skylineP: SKYLINE_P,
  get stats() { return arena.stats; },
  get draws() { const r = renderer.info.render; return { calls: r.calls, triangles: r.triangles }; },
  /* THE VIEW, AS A READABLE FACT (A-CROWD, 2026-08-15). `city-visibility-bench` models the frustum of
     a standing eye to count the agents a player can actually SEE, and a fov typed into the tool would
     be a second description of the camera — which is always the copy that drifts (the ledger's own
     `CHAR_AIM_REACH` carried a stale chase arm for two arcs for exactly this reason). Read LIVE, so a
     harness measuring while the speed-dolly is widening the lens sees the lens it is measuring. */
  get camera() { const c = rig.camera; return { fov: c.fov, aspect: c.aspect, near: c.near, far: c.far }; },
};
/* A-CITIZENS: THE OUTBREAK'S RECEIPTS. A probe reads the sim's OWN clock (tick — fixed 1/60, fps-
   independent) and the emit-time event log, so two boots with one seed can be compared string-for-
   string while a bot swings through the middle of the crowd. sample() is a read-only snapshot
   (never a sim roll) — the hoard2 civSample precedent. */
window.__outbreak = population ? {
  get tick() { return population.ob.tick; },
  get log() { return population.ob.log; },
  get counts() {
    const s = population.sim;
    return { s: s.sCount, e: s.eCount, i: s.iCount, bites: population.ob.bites, turns: population.ob.turns };
  },
  get tiers() { return { ...population.tiers.counts }; },
  /* A-CROWD: THE DISTRIBUTION, AS A READABLE FACT. A capture can show a busy street and cannot show
     whether the crowd clustered or the camera got lucky, and `city-visibility-bench` has to be able to
     prove WHICH ARM it is measuring — the same rule as `__input` and `__level`: a harness that cannot
     see its own configuration cannot tell a distribution change from a URL typo. null = the uniform
     control arm (?cluster=0). `list` is the kept places themselves, so a probe can score occupancy per
     place rather than inferring clustering from a count. */
  get places() {
    const p = population.places;
    return p ? { ...p.stats, list: p.places.map((q) => ({ x: +q.x.toFixed(3), z: +q.z.toFixed(3), r: q.r, kind: q.kind })) } : null;
  },
  sample() { const out = []; population.sim.forEach((_i, c) => { if (c.alive) out.push({ x: c.x, z: c.z, state: c.state }); }); return out; },
  infect: (n = 1, x = 0, z = 0) => population.sim.forceExpose(n, x, z),
} : null;
