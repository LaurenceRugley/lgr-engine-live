/* ============================================================
   @lgr/engine-core — createWorldFromRecipe (A9 TEXT→WORLD): THE INTERPRETER.
   ------------------------------------------------------------
   THE ABILITY: read a world RECIPE (world-recipe.js — plain data) and COMPOSE the engine modules it names
   (terrain rim · flat ground · createForest · createCity structure clusters · interactive ruins · cover
   buildings · decorative scatter · contextual water) into a playable arena. No new rendering tech — this is
   COMPOSITION, parameterised. The recipe is the API; two recipes (hoard2's decrepit forest as recipe #1,
   the foggy swamp as recipe #2) through this ONE interpreter is the second-consumer proof that map
   generation is a LIBRARY, not a one-shot.

   ── CONTRACT ──────────────────────────────────────────────────
   createWorldFromRecipe(ctx, recipe) — ctx = {
     scene,                      // THREE.Scene to add the built groups to
     rng,                        // the game rng (fork(name) → a named, decorrelated, seeded stream)
     config: { GROUND_Y, PLAY_RADIUS, ARENA_EXTENT, DEFAULT_SEED },
     surfaces,                   // { ground, bark, barkLive, stone, wood, scrap } materials (forge or fallback)
     mobile,                     // M1 tier flag (thins the scatter, drops shadow casters)
   }
   returns {
     obstacles:[{x,z,r}],        // trees (in play radius) + ruins + cover buildings + city solids — the sim's collision set
     buildingCylinders:[{x,z,r,h}], harvest:{wood:[{x,z,amount}], scrap:[...]}, playRadius, groundY,
     forest, ruins, buildings, city,  // raw handles/placements for any further wiring (city is null unless recipe.city.enabled)
     groups:[Object3D...],       // everything added to the scene (for a full teardown)
     backdropGroups:[Group...],  // clusters the governor panic tier may hide (draw-call shed)
     dispose(),
   }

   ── ARC A21: THE CITY AS PRIMARY CONTENT (recipe.city.enabled) ─
   `structures.clusters[]` above has always let a recipe drop a createCity() BACKDROP beyond the play
   radius (hoard2's ruined/intact skyline) — but never registered it for collision, since a backdrop was
   never meant to be walked into. `recipe.city` (world-recipe.js's own schema section) is a DIFFERENT thing:
   a full, PLAYABLE city as the world's primary content. `cityProfileFromUrban` (urban-profile.js) resolves
   the recipe's urban DIMENSIONS (height/density/palette/era/waterfront/landmarks) into a citygen.js profile
   object; `citySolidsToObstacles` (world-scatter.js) converts citygen's own AABB solids list into the SAME
   `obstacles:[{x,z,r}]` shape forest/ruins/buildings already feed the sim — one collision set, one code
   path downstream. `city.enabled` defaults to `false`, so this whole branch is UNREACHABLE for every
   existing recipe (forest/swamp/coastal/lakeshore never touch `recipe.city`) — byte-identical by
   construction, not just by testing.

   ── DETERMINISM (the trace-identity spine) ────────────────────
   The sim reads ONLY: obstacles, buildingCylinders, harvest, playRadius, nightFactor, groundAt. Those are
   built here from createForest(seed) + scatterRuins(fork 'world') + placeCoverBuildings(fork 'buildings')
   with the recipe's exact params, in the exact concat order (forest → ruins → buildings). rng.fork(name) is
   independent of every other fork (keyed by masterSeed ^ hash(name)), so the ORDER in which this interpreter
   creates its forks cannot perturb the sim's own 'sim'/'wave' streams. Same seed + same recipe ⇒ byte-
   identical obstacles/harvest ⇒ identical sim trace (proven: recipe #1 == today's forest at seed 1337).
   ============================================================ */
import * as THREE from 'three';
import { createForest } from './createForest.js';
import { createCity } from './citygen.js';
import { generateTerrain, buildTerrainMesh } from './terrain.js';
import { applyGroundMacro } from './ground-macro.js';
import { applyGlint } from './createGlintMaterial.js';
import { scatterRuins, scatterProps, deriveHarvest, placeCoverBuildings, citySolidsToObstacles } from './world-scatter.js';
import { buildDecrepitProfile, buildIntactProfile } from './world-profiles.js';
import { normalizeRecipe } from './world-recipe.js';
import { createWaterSurface } from './createWaterSurface.js';
import { cityProfileFromUrban } from './urban-profile.js';

// Resolve a structure-cluster profile spec to a createCity profile object. A named string maps to the
// world-profiles builder; a full object passes through (an editor could ship a custom profile inline).
function resolveProfile(spec, coastBase) {
  if (spec && typeof spec === 'object') return spec;
  if (spec === 'intact') return buildIntactProfile(coastBase);
  return buildDecrepitProfile(coastBase);   // 'decrepit' / default
}

// Resolve a material KEY (recipe data) to a live material from ctx.surfaces; a missing key → the ground
// material as a safe fallback (never undefined into a Mesh).
function mat(surfaces, key) { return (key && surfaces[key]) || surfaces.ground; }

export function createWorldFromRecipe(ctx, recipeInput) {
  const { scene, rng, config, surfaces, mobile } = ctx;
  const { GROUND_Y, PLAY_RADIUS, ARENA_EXTENT } = config;
  const recipe = normalizeRecipe(recipeInput);
  const seed = recipe.meta.seed != null ? (recipe.meta.seed >>> 0) : ((rng && rng.masterSeed) != null ? rng.masterSeed : config.DEFAULT_SEED);
  const groups = [];
  const backdropGroups = [];
  const add = (o) => { scene.add(o); groups.push(o); return o; };

  /* ---- URBAN CITY (ARC A21): a full PLAYABLE city as primary content — opt-in, additive. `enabled:false`
     (every existing recipe) skips this whole block: `city` stays null, obstacles/playRadius fall through
     to the untouched forest/ruins/buildings path exactly as before. Built EARLY (before the flat ground/
     terrain below) only so its `extent` can widen `playRadius` — the ground/terrain code itself is
     unmodified and unconditional, so a city recipe still gets a sea-floor disc + hill-rim backdrop for
     free beneath/around the island citygen.js builds. */
  let city = null, cityScale = 1, cityObstacles = [], cityCylinders = [];
  const cr = recipe.city;
  if (cr && cr.enabled) {
    const cityProfile = cityProfileFromUrban(cr);
    const citySeed = (seed ^ (cr.seedOffset | 0)) >>> 0;
    city = createCity({ profile: cityProfile, seed: citySeed, blockPattern: cr.blockPattern, spawnClearR: cr.spawnClearR || 0, landmarkFactory: ctx.landmarkFactory || null, windowGlow: ctx.windowGlow });
    if (city.key) city.group.remove(city.key);     // the project supplies its OWN sun/fill (matches structures.clusters' existing handling above)
    if (city.fill) city.group.remove(city.fill);
    cityScale = cr.scale != null ? cr.scale : 1;
    city.group.scale.setScalar(cityScale);
    // CRASH FIX — same documented root cause as the structures.clusters re-material below: citygen's own
    // building/ground materials carry vectorize/vectorizeTower's onBeforeCompile patch, which assumes the
    // createCityWorld wiring a standalone createCity() call here doesn't have (an unbound uniform the
    // patch reads) — crashes on first render otherwise ("wm.upload: Cannot read properties of undefined
    // (reading 'needsUpdate')"). The clusters path fixes this by discarding EVERY material for one flat
    // cluster colour; a PRIMARY city keeps its per-building tint (the point of a walkable city), so
    // re-material PER MESH instead — a fresh plain MeshStandardMaterial copying colour/roughness/metalness/
    // envMapIntensity, dropping only the vector-style shader patch (inert at beauty tier anyway — every
    // consumer of a primary city renders beauty, never the stylized pixel/toon/vector tiers).
    city.group.traverse((o) => {
      if (!o.isMesh || !o.material || o.material.isMeshBasicMaterial) return;
      const src = o.material;
      o.material = new THREE.MeshStandardMaterial({
        color: src.color, roughness: src.roughness, metalness: src.metalness,
        envMapIntensity: src.envMapIntensity, flatShading: src.flatShading, side: src.side,
      });
    });
    add(city.group);
    // solids are computed in citygen's UNSCALED local space — scale the derived obstacles/cylinders to match
    // the group's actual world scale (same number, applied consistently to position AND radius/height).
    const adapted = citySolidsToObstacles(city.state.solids);
    cityObstacles = adapted.obstacles.map((o) => ({ x: o.x * cityScale, z: o.z * cityScale, r: o.r * cityScale }));
    cityCylinders = adapted.buildingCylinders.map((c) => ({ x: c.x * cityScale, z: c.z * cityScale, r: c.r * cityScale, h: c.h * cityScale }));
  }
  const playRadius = recipe.playRing.radius != null ? recipe.playRing.radius : (city ? city.extent * cityScale : PLAY_RADIUS);

  /* ---- FLAT ARENA GROUND (opaque disc; covers the terrain rim's centre → play area reads FLAT) ---- */
  const g = recipe.ground;
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_EXTENT + g.extentPad, 64).rotateX(-Math.PI / 2),
    mat(surfaces, g.material),
  );
  ground.position.y = GROUND_Y; ground.receiveShadow = true;
  // Macro de-tiling is a static recipe decision (the caller folds in forge.supported + any A/B flag before
  // setting g.macro), so here it's a simple gate — apply the world-scale patch field over the albedo.
  if (g.macro) applyGroundMacro(mat(surfaces, g.material));
  // A14 GLINT on the ground — frost/mica/wet-grit sparkle (desktop-tier; the caller folds forge.supported
  // into g.glint before setting it, exactly like g.macro). CHAINS onto the macro patch above; driven per
  // frame via content.groundGlint.setSun(). g.glint absent/falsey → the material is untouched.
  let groundGlint = null;
  if (g.glint) groundGlint = applyGlint(mat(surfaces, g.material), g.glint);
  add(ground);

  /* ---- TERRAIN HILL RIM (bowl backdrop; sunk below the flat disc so only the far hills show) ---- */
  const tr = recipe.terrain;
  if (tr.enabled) {
    try {
      const terrain = generateTerrain({ seed, size: tr.size, preset: tr.preset });
      const rim = buildTerrainMesh(terrain, { worldSize: ARENA_EXTENT * tr.worldSizeMul, baseY: GROUND_Y - tr.baseYDrop, chunks: tr.chunks });
      const rimMat = new THREE.MeshStandardMaterial({ color: tr.color, roughness: 1, metalness: 0, vertexColors: false, flatShading: !!tr.flatShading });
      rim.traverse((o) => { if (o.isMesh) o.material = rimMat; });
      add(rim);
    } catch (e) { console.warn('[recipe] terrain rim skipped:', e && e.message); }
  }

  /* ---- STRUCTURE CLUSTERS: createCity backdrops beyond the play radius (the ruined/intact skyline) ---- */
  // Standalone createCity buildings carry the engine's reflection onBeforeCompile patch with an UNBOUND
  // uniform (no createCityWorld wiring here) → the beauty reflection pass crashes on it. Re-material every
  // mesh with a plain surface (no patch) — the proven crash-fix — then place + scale the cluster.
  for (const c of (recipe.structures.clusters || [])) {
    if (c.mobile === false && mobile) continue;   // desktop-only clusters (the 2nd/intact one on mobile)
    try {
      const city = createCity({ profile: resolveProfile(c.profile, c.coastBase), seed: (seed + (c.seedOffset | 0)) >>> 0 });
      if (city.key) city.group.remove(city.key);
      if (city.fill) city.group.remove(city.fill);
      const cast = c.castShadow !== false && !mobile;   // the distant backdrop doesn't cast on mobile
      const cmat = mat(surfaces, c.material);
      city.group.traverse((o) => { if (o.isMesh) { o.material = cmat; o.castShadow = cast; o.receiveShadow = true; } });
      city.group.position.set(c.pos[0], c.pos[1], c.pos[2]);
      city.group.scale.setScalar(c.scale != null ? c.scale : 1);
      add(city.group);
      if (c.panicHide) backdropGroups.push(city.group);
    } catch (e) { console.warn('[recipe] structure cluster skipped:', e && e.message); }
  }

  /* ---- FOREST: dead/live trees + rocks; the central clearing keeps the fight area open + FLAT ---- */
  const f = recipe.forest;
  const forestMaterials = {};
  for (const k of Object.keys(f.materials || {})) forestMaterials[k] = mat(surfaces, f.materials[k]);
  const forest = createForest({
    seed, radius: ARENA_EXTENT + f.radiusPad, arenaR: f.arenaR != null ? f.arenaR : playRadius,
    count: mobile ? f.mobileCount : f.count, minSpacing: f.minSpacing,
    clearings: f.clearings, archetypes: f.archetypes, groundY: GROUND_Y,
    materials: forestMaterials, heightScale: f.heightScale,
  });
  if (mobile && !f.castShadowMobile) forest.group.traverse((o) => { if (o.isMesh) o.castShadow = false; });
  add(forest.group);

  /* ---- INTERACTIVE RUINS: sparse rubble in the play ring (seeded via the recipe's fork) ---- */
  const rc = recipe.ruins;
  const worldRng = rng.fork(rc.fork);
  const ruins = scatterRuins({ rng: worldRng, count: rc.count, innerR: rc.innerR, outerR: rc.outerR != null ? rc.outerR : (playRadius + rc.outerRPad), minSpacing: rc.minSpacing });
  const ruinGroup = new THREE.Group(); ruinGroup.raycast = () => {};
  const ruinMat = mat(surfaces, rc.material), slabMat = mat(surfaces, rc.slabMaterial);
  for (const rn of ruins) {
    const h = rc.heights[rn.kind] != null ? rc.heights[rn.kind] : 0.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(rn.r * 1.8, h, rn.r * 1.6), ruinMat);
    box.position.set(rn.x, GROUND_Y + h / 2, rn.z);
    box.rotation.y = rn.yaw; box.castShadow = true; box.receiveShadow = true;
    ruinGroup.add(box);
    if (rc.slab && rn.kind !== 'rubble') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(rn.r * 1.4, h * 0.9, 0.18), slabMat);
      slab.position.set(rn.x, GROUND_Y + h * 0.45, rn.z + rn.r * 0.7);
      slab.rotation.set(0.22, rn.yaw, 0.12); slab.castShadow = true;
      ruinGroup.add(slab);
    }
  }
  add(ruinGroup);

  /* ---- DECORATIVE GROUND SCATTER: cosmetic props across the disc (NOT obstacles/harvest, raycast off) ---- */
  const sc = recipe.scatter;
  if (sc.enabled) {
    const propRng = rng.fork(sc.fork);
    const props = scatterProps({ rng: propRng, count: mobile ? sc.mobileCount : sc.count, radius: sc.radius != null ? sc.radius : (playRadius + sc.radiusPad), clearR: sc.clearR, minSpacing: sc.minSpacing });
    const propGroup = new THREE.Group(); propGroup.raycast = () => {};
    const _pm = new THREE.Matrix4(), _pq = new THREE.Quaternion(), _pe = new THREE.Euler(), _pp = new THREE.Vector3(), _ps = new THREE.Vector3();
    for (const kind of Object.keys(sc.defs)) {
      const list = props.filter((p) => p.kind === kind);
      if (!list.length) continue;
      const def = sc.defs[kind];
      const geo = def.geo === 'ico' ? new THREE.IcosahedronGeometry(def.size, 0)
        : def.geo === 'cyl' ? new THREE.CylinderGeometry(def.size[0], def.size[1], def.size[2], def.size[3])
          : new THREE.BoxGeometry(def.size[0], def.size[1], def.size[2]);
      const inst = new THREE.InstancedMesh(geo, mat(surfaces, def.material), list.length);
      inst.castShadow = !mobile; inst.receiveShadow = false; inst.frustumCulled = false;
      for (let i = 0; i < list.length; i++) {
        const p = list[i];
        _pe.set(p.tilt, p.yaw, p.tilt * 0.6);
        _pq.setFromEuler(_pe);
        _pp.set(p.x, GROUND_Y + def.y * p.scl - def.sink * def.y * p.scl, p.z);
        _ps.setScalar(p.scl);
        _pm.compose(_pp, _pq, _ps);
        inst.setMatrixAt(i, _pm);
      }
      inst.instanceMatrix.needsUpdate = true;
      propGroup.add(inst);
    }
    add(propGroup);
  }

  /* ---- COVER BUILDINGS: off-centre intact structures — real cover (obstacles + ballistics) + scavenge ---- */
  const bc = recipe.buildings;
  const bRng = rng.fork(bc.fork);
  const buildings = placeCoverBuildings({ rng: bRng, count: bc.count, innerR: bc.innerR, radSpan: bc.radSpan });
  const bMat = mat(surfaces, bc.material);
  for (const b of buildings) {
    const grp = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.h, b.d), bMat);
    body.position.set(0, b.h / 2, 0); body.castShadow = bc.castShadow; body.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(b.w * 1.08, 0.42, b.d * 1.08), bMat);
    roof.position.set(0, b.h + 0.21, 0); roof.castShadow = bc.castShadow; roof.receiveShadow = true;
    grp.add(body); grp.add(roof); grp.position.set(b.x, GROUND_Y, b.z);
    add(grp);
  }

  /* ---- CONTEXTUAL WATER (B2 ruling: never a global plane; A12 pond/lake + A13 Gerstner ocean) ---- */
  // A pond (small centred), a lake (big off-centre — the rim is the shoreline), or an OCEAN (a13: big,
  // tessellated, Gerstner swell + analytic foam + LOD to the horizon) via createWaterSurface — an analytic,
  // mobile-safe shader (no textures, no RTs). The caller drives water.update(t)/setSun/setSky/setFog each frame.
  let water = null;
  const w = recipe.water;
  if (w && (w.kind === 'pond' || w.kind === 'lake' || w.kind === 'shore' || w.kind === 'ocean')) {
    const c = w.colors || {};
    water = createWaterSurface({
      kind: w.kind,
      at: w.at || [0, 0], radius: w.radius != null ? w.radius : 6, y: (w.y != null ? w.y : GROUND_Y) + 0.02,
      segments: w.segments != null ? w.segments : 96, depthPower: w.depthPower != null ? w.depthPower : 1.0,
      shallow: c.shallow, deep: c.deep, sky: c.sky,
      opacity: w.opacity != null ? w.opacity : 0.9,
      ripple: w.ripple != null ? w.ripple : 0.42, speed: w.speed != null ? w.speed : 1.0,
      glint: w.glint != null ? w.glint : 0.9,
      // A13 ocean swell params (ignored by pond/lake — those leave waveAmp 0 → flat).
      rings: w.rings, waveAmp: w.waveAmp, swellDir: w.swellDir, wavelength: w.wavelength,
      steepness: w.steepness, waveSpeed: w.waveSpeed, lodNear: w.lodNear, lodFar: w.lodFar, foam: w.foam,
      // A14 GLINT sun glitter (glintDensity absent/0 → the shader skips it → byte-identical A13 water).
      glintDensity: w.glintDensity, glintRough: w.glintRough, glintMicro: w.glintMicro, glintGain: w.glintGain,
    });
    add(water.group);
  }

  /* ---- OBSTACLES + HARVEST (built once; the order matches the sim's collision set exactly) ---- */
  // obstacles = tree trunks in the play radius (from the forest) + ruin footprints + cover buildings
  // + (ARC A21) the city's own solids, converted by citySolidsToObstacles above. cityObstacles is [] unless
  // recipe.city.enabled, so this concat is a no-op for every existing recipe.
  const obstacles = forest.colliders
    .concat(ruins.map((r) => ({ x: r.x, z: r.z, r: r.r })))
    .concat(buildings.map((b) => ({ x: b.x, z: b.z, r: b.r })))
    .concat(cityObstacles);
  const buildingCylinders = buildings.map((b) => ({ x: b.x, z: b.z, r: b.r, h: b.h })).concat(cityCylinders);

  const hc = recipe.harvest;
  const treeNodes = [];
  for (const key of hc.treeKinds) {
    for (const p of (forest.placements[key] || [])) {
      if (p.x * p.x + p.z * p.z <= playRadius * playRadius) treeNodes.push({ x: p.x, z: p.z });
    }
  }
  const harvest = deriveHarvest(treeNodes, ruins, { woodAmount: hc.woodAmount, scrapAmount: hc.scrapAmount });
  // A richer scavenge node at each building's base (the good loot sits at the chokepoint).
  for (const b of buildings) {
    harvest.wood.push({ x: b.x + b.r * 0.85, z: b.z, amount: bc.scavenge.wood });
    harvest.scrap.push({ x: b.x - b.r * 0.85, z: b.z, amount: bc.scavenge.scrap });
  }

  return {
    recipe, seed, obstacles, buildingCylinders, harvest, playRadius, groundY: GROUND_Y,
    forest, ruins, buildings, city, groups, backdropGroups, water, groundGlint,
    dispose() {
      for (const o of groups) { if (o.parent) o.parent.remove(o); }
      if (forest && forest.dispose) forest.dispose();
    },
  };
}
