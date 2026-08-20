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
     · the water          → `detectLakes` + `buildLakeGroup` (L68, first consumers outside
                            createCityWorld) filtered to the lake district, plus the sea plane this
                            room lacked (A-MARRIAGE honest gap #2, closed).
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
  detectLakes, buildLakeGroup,
  createBoxArena, percentileOf,
  createCharacterController, createGrappleModel, GRAPPLE_PROFILE,
  resolveAimPoint, createAimReticle, createPointerLockAim,
  createTargetLock, createLockMarker, cameraNearRadius,
  createHeroBody,
  createBikeModel, BIKE_PROFILE, createBikeMesh, createMotoChaseCam,
} from '@lgr/engine-core';
import survivorUrl from '@lgr/engine-core/assets/models/survivor.glb?url';
import treeKitUrl from '@lgr/engine-core/assets/models/tree_kit.glb?url';   // A-TREEKIT's conifer kit — the woods

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
function regionPlan() {
  const rim = cityRimOf();
  const woods = Math.max(0.05, Math.min(0.36, WP.woods));
  const push = Math.max(1, (rim + SEED_PAD) / SEED_REACH);
  const at = (x, z) => ({ x: x * push, z: z * push });
  return [
    { key: 'sea', want: 0.22, mode: 'rim' },
    { key: 'city', want: 0.25, mode: 'rect', rect: { x0: -rim, z0: -rim, x1: rim, z1: rim } },
    { key: 'woods', want: woods, mode: 'seed', at: at(-34, 30) },
    { key: 'desert', want: 0.41 - woods, mode: 'seed', at: at(34, -32) },
    { key: 'lakes', want: 0.12, mode: 'seed', at: at(30, 34) },
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
let scatterGroup = null, treeGroup = null, lakeGroup = null, seaMesh = null;
let LAKES = [], TREE_N = 0;

/* ONE WATER MATERIAL for the sea and every lake (world-water.js's own reuse anchor): the sea is not
   a different substance from a lake, it is the same surface at a different plane, and one material
   means one place to change how water reads in this room. */
const waterMat = new THREE.MeshStandardMaterial({
  color: '#33627f', roughness: 0.18, metalness: 0.30, transparent: true, opacity: 0.86,
});
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
   2c. THE WATER — the sea plane this room never had (A-MARRIAGE honest gap #2: "the rim jump lands
   on the sub-sea ocean biome — there is no water in the room; dirt all the way down"), and the lake
   district's pools through `detectLakes` / `buildLakeGroup` (L68's FIRST consumers outside
   createCityWorld — the ability existed and only one room had ever asked it anything).
   THE FILTER is the region field doing its job: detectLakes scans the whole heightfield and will
   happily call a wild hollow a lake, so we keep only the pools whose centre stands in the lake
   DISTRICT. That is consuming the orphan, not forking it — its basin maths is untouched.
   --------------------------------------------------------------------------------------------- */
function buildWater(WORLD_MAP) {
  if (!seaMesh) {
    /* sea level is y = baseY = 0 by terrain.js's own mapping (wy(sea) = baseY). One plane, a hair
       larger than the world so the horizon has no visible edge inside the fog. */
    seaMesh = new THREE.Mesh(new THREE.PlaneGeometry(WP.worldSize * 1.6, WP.worldSize * 1.6), waterMat);
    seaMesh.rotation.x = -Math.PI / 2;
    seaMesh.position.y = 0;
    seaMesh.receiveShadow = false; seaMesh.castShadow = false; seaMesh.raycast = () => {};
    scene.add(seaMesh);
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
  lakeGroup = buildLakeGroup(LAKES, { material: waterMat });
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
  stats.webs = 0; stats.walkMinClear = Infinity; stats.bikeMinClear = Infinity; stats.t = 0;
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
  $('b-bike').addEventListener('click', () => setMode(MODE === 'walk' ? 'bike' : 'walk'));
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
wireDock(); syncDock();

/* ---------------------------------------------------------------------------------------------
   8. THE FRAME.
   --------------------------------------------------------------------------------------------- */
const _camPos = { x: 0, y: 0, z: 0 }, _camDir = { x: 0, y: 0, z: 0 };
const _bCamPos = new THREE.Vector3(), _bCamDir = new THREE.Vector3();
const _hand = new THREE.Vector3();
const AXES = { throttle: 0, steer: 0, lift: 0, boost: 0 };
spawn();
/* ---- A-LAUNCH: THE BODY IS A URL PARAM. `?mode=bike` starts you on the dirtbike instead of on foot.
   It is applied AFTER `spawn()` deliberately — spawn's own contract is "put the walker at the city
   edge facing in", and it forces walk mode, so asking for the bike first would be silently undone.
   This is what makes a launcher entry able to promise a BODY as well as a world: the menu is links,
   and a link can only carry what the room agrees to read. Anything that is not 'bike' is walk, so a
   typo lands you on foot rather than nowhere. ---- */
if (Q.get('mode') === 'bike') setMode('bike');
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
    noteRegion(bikeState.x, bikeState.z);
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
