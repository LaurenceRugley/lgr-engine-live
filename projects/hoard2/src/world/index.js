/* ============================================================
   hoard2 · src/world — THE WORLD OWNER (replaces the scaffold stub).
   ------------------------------------------------------------
   OWNS the decrepit-forest-with-ruins map + the day/night/weather/torch atmosphere, and exposes the
   `world` facade the sim/player/build/fx read (INTEGRATION.md §Registry facades):
     { groundAt(x,z), nightFactor(), obstacles(), harvestNodes(), playRadius, update(dt,t) }
   Emits `daynight:phase { t, night }`. Attaches the probe `ctx.probe.setNight(nf)`. Sets ctx.worldReady.

   COMPOSITION (each an engine-first ability the project only WIRES + configures):
     • the default baked city stays HIDDEN (engine.setUrbanVisible(false)); in its place —
     • createCity({ profile: DECREPIT, seed })  — the ratified ruin route: a sparse/low/desat ruined
       SETTLEMENT, placed BEYOND the play radius as a grim skyline backdrop (its own key/fill lights
       stripped so it doesn't double-light the arena; the engine sun owns lighting).
     • createForest(...)   — dead trees (bare + rock, no green) across the arena; its colliders are the
       tree-trunk obstacles; a central clearing keeps the fight area open + FLAT.
     • scatterRuins(...)   — sparse primitive rubble in the play ring: the INTERACTIVE ruins (obstacles
       + scrap harvest nodes). Seeded ONLY via rng.fork('world') → never perturbs the sim trace.
     • generateTerrain + buildTerrainMesh — a hill rim BACKDROP for a bowl silhouette (play area FLAT,
       covered by the opaque ground disc; the rim only shows past the arena).
     • createCelestials (sun+moon+stars+constellations) · createWeatherRig (fog-only, cheap) ·
       createCloudField · createTorchLight ×N — the night atmosphere (dark-but-legible).

   Determinism: all seeded rolls come from the master seed (createForest/createCity) or rng.fork('world')
   (ruins) — NEVER Math.random (weather-rig's internal cosmetic Math.random is engine-owned + un-probed).
   No per-frame allocation in update() (scratch hoisted; the daynight payload is reused).
   ============================================================ */
import {
  createCity, createForest, createCelestials, createTorchLight,
  createWeatherRig, createCloudField, generateTerrain, buildTerrainMesh,
} from '@lgr/engine-core';
import { buildDecrepitProfile } from './profile.js';
import { phaseAt, resolveNight, phaseForNight, nightFactorAt } from './daynight.js';
import { scatterRuins, deriveHarvest } from './scatter.js';

export function createWorld(ctx) {
  const { THREE, engine, scene, sunRig, config, events, registry, rng, CAM } = ctx;
  const { GROUND_Y, PLAY_RADIUS, ARENA_EXTENT, SUN, DAY_LENGTH_S } = config;
  const seed = (rng && rng.masterSeed) != null ? rng.masterSeed : config.DEFAULT_SEED;

  // Hide the default baked city — the decrepit world takes its place. BEAUTY tier; the lead's coupled-
  // look pass tunes the grade on top.
  engine.setUrbanVisible?.(false);
  engine.setPostMode?.(2);

  /* ---- flat arena ground (opaque disc; covers the terrain rim's centre → play area reads FLAT) ---- */
  // Mid grey-brown decrepit dirt: dark enough for gloom, light enough to READ under the low decay sun
  // (0x3b3a30 crushed to black — the survivor's pale material read but the ground didn't).
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_EXTENT + 6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: 0x5f5a4a, roughness: 1, metalness: 0 }),
  );
  ground.position.y = GROUND_Y; ground.receiveShadow = true;
  scene.add(ground);

  // LEAD look-pass FILL: a low hemisphere fill so the decrepit arena reads instead of crushing to black.
  // The engine's own hemi (~0.65) + the low decay sun weren't enough to lift the dark ground/trees; this
  // is a game-layer lift (hoard2 is its own project — no byte-identical tier constraint). Cool sky over a
  // dead-earth ground, kept modest so night still goes dark (it's scaled down by nightFactor in update).
  const fill = new THREE.HemisphereLight(0x9aa7b0, 0x4a4436, 0.9);
  scene.add(fill);
  const _fillBase = 0.9;

  // Ensure a distance fog exists so night + weather read (density is driven per-frame in update()). Only
  // created if the engine didn't already supply one — never stomp an engine-owned fog.
  if (!scene.fog) scene.fog = new THREE.FogExp2(0x2a2c26, 0.012);

  /* ---- terrain HILL RIM (bowl backdrop; sunk below the flat disc so only the far hills show) ---- */
  // LOOK-PASS (art critic): the 'valley' biome rim rendered LUSH GREEN — jarring against the decrepit
  // brown arena the wide cam now shows. Re-material the rim to a flat DESAT dead-earth so the horizon
  // reads as blighted hills, not a golf course. (Distant backdrop → a flat material is plenty.)
  try {
    const terrain = generateTerrain({ seed, size: 96, preset: 'valley' });
    const rim = buildTerrainMesh(terrain, { worldSize: ARENA_EXTENT * 2.6, baseY: GROUND_Y - 6, chunks: 4 });
    const rimMat = new THREE.MeshStandardMaterial({ color: 0x3f3a30, roughness: 1, metalness: 0, vertexColors: false, flatShading: true });
    rim.traverse((o) => { if (o.isMesh) o.material = rimMat; });
    scene.add(rim);
  } catch (e) { console.warn('[world] terrain rim skipped:', e && e.message); }

  /* ---- the RUINED SETTLEMENT: createCity with the DECREPIT profile (ratified route) ---- */
  // Placed as a backdrop cluster BEYOND the play radius so the arena heart stays open + flat, and its
  // buildings need no colliders (the survivor is clamped inside PLAY_RADIUS). Strip its bundled lights.
  //
  // LEAD INTEGRATION FIX (crash on the dive): createCity's buildings carry the engine's shared
  // MeshStandardMaterial patch (onBeforeCompile with the planar-REFLECTION uniform). Standalone —
  // without createCityWorld's reflection wiring — that uniform is UNBOUND, and the beauty pipeline's
  // renderReflection() pass (which does NOT hide this second, game-added city) uploads it as `undefined`
  // → "reading 'needsUpdate'" on the first dived (perspective) frame. v1's forest dive never hit this
  // because it never called createCity. FIX: keep the ratified profile-driven GEOMETRY (the ruined
  // skyline) but RE-MATERIAL it with a plain decrepit-concrete material — no engine patch, no unbound
  // reflection uniform, so the reflection pass renders it harmlessly. (Distant grey ruins read fine.)
  try {
    const city = createCity({ profile: buildDecrepitProfile(0.7), seed });
    if (city.key) city.group.remove(city.key);
    if (city.fill) city.group.remove(city.fill);
    const decrepitMat = new THREE.MeshStandardMaterial({ color: 0x36322c, roughness: 1, metalness: 0, flatShading: true });
    city.group.traverse((o) => { if (o.isMesh) { o.material = decrepitMat; o.castShadow = true; o.receiveShadow = true; } });
    // shove the compact (~15u) city out to a corner past the play radius → a distant ruined quarter.
    city.group.position.set(-(PLAY_RADIUS + 6), 0, -(PLAY_RADIUS + 2));
    city.group.scale.setScalar(1.25);
    scene.add(city.group);
  } catch (e) { console.warn('[world] decrepit city skipped:', e && e.message); }

  /* ---- DEAD FOREST: bare trees + rocks (no green conifers), central clearing open ---- */
  const forest = createForest({
    seed, radius: ARENA_EXTENT - 2, arenaR: PLAY_RADIUS, count: 96, minSpacing: 1.9,
    clearings: [{ x: 0, z: 0, r: 6 }],
    archetypes: [{ key: 'bare', weight: 0.72, r: 0.34 }, { key: 'rock', weight: 0.28, r: 0.3 }],
    groundY: GROUND_Y,
  });
  scene.add(forest.group);

  /* ---- INTERACTIVE RUINS: sparse primitive rubble in the play ring (seeded via the WORLD fork) ---- */
  const worldRng = rng.fork('world');
  const ruins = scatterRuins({ rng: worldRng, count: 14, innerR: 8, outerR: PLAY_RADIUS - 2, minSpacing: 3.2 });
  const ruinMat = new THREE.MeshStandardMaterial({ color: 0x4a453d, roughness: 1, metalness: 0, flatShading: true });
  const ruinGroup = new THREE.Group(); ruinGroup.raycast = () => {};
  for (const rn of ruins) {
    // a crude broken mass: a low box + a leaning slab. Primitive by design (degraded-tier representation).
    const h = rn.kind === 'husk' ? 2.2 : rn.kind === 'wall' ? 1.4 : 0.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(rn.r * 1.8, h, rn.r * 1.6), ruinMat);
    box.position.set(rn.x, GROUND_Y + h / 2, rn.z);
    box.rotation.y = rn.yaw; box.castShadow = true; box.receiveShadow = true;
    ruinGroup.add(box);
    if (rn.kind !== 'rubble') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(rn.r * 1.4, h * 0.9, 0.18), ruinMat);
      slab.position.set(rn.x, GROUND_Y + h * 0.45, rn.z + rn.r * 0.7);
      slab.rotation.set(0.22, rn.yaw, 0.12); slab.castShadow = true;
      ruinGroup.add(slab);
    }
  }
  scene.add(ruinGroup);

  /* ---- OBSTACLES + HARVEST NODES (built once; facade returns the cached arrays — no per-call alloc) ---- */
  // obstacles = tree trunks (within the play radius, from the forest) + interactive-ruin footprints.
  const _obstacles = forest.colliders.concat(ruins.map((r) => ({ x: r.x, z: r.z, r: r.r })));
  // wood grows on the dead trees inside the play radius; scrap salvages from the ruins.
  const treeNodes = [];
  for (const key of ['bare', 'conifer']) {
    for (const p of (forest.placements[key] || [])) {
      if (p.x * p.x + p.z * p.z <= PLAY_RADIUS * PLAY_RADIUS) treeNodes.push({ x: p.x, z: p.z });
    }
  }
  const _harvest = deriveHarvest(treeNodes, ruins, { woodAmount: 6, scrapAmount: 8 });

  /* ---- CELESTIALS (sun+moon+stars+constellations) · WEATHER (fog-only) · CLOUDS ---- */
  const celestials = createCelestials({});
  scene.add(celestials.group);
  const weather = createWeatherRig({ extent: ARENA_EXTENT });
  weather.setKind('fog');                    // DEGRADED-tier fog-only (cheap; ratified degrade ladder)
  scene.add(weather.group);
  const clouds = createCloudField({ extent: ARENA_EXTENT, count: 12 });
  scene.add(clouds.group);
  // LOOK-PASS (both critics): the weather/cloud rigs render ADDITIVE ground-level motes that read as
  // fuzzy orange/blue blobs across the FPS eyeline (the dive's worst artifact). We drive the distance
  // FOG ourselves (scene.fog, per-frame), so the mote VISUALS add nothing — hide both group meshes.
  // (Their .update() still runs, harmless.) Celestials (sky stars/moon) stay visible.
  weather.group.visible = false;
  clouds.group.visible = false;

  /* ---- TORCHES: a ring of guttering warm pools so night is DARK-BUT-LEGIBLE ---- */
  const torches = [];
  const TORCH_N = 8, torchR = PLAY_RADIUS - 3;
  for (let i = 0; i < TORCH_N; i++) {
    const a = (i / TORCH_N) * Math.PI * 2;
    const t = createTorchLight({
      color: 0xffb562, intensity: 5.5, distance: 15, decay: 2,
      position: [Math.cos(a) * torchR, GROUND_Y + 2.3, Math.sin(a) * torchR], seed: i, amp: 0.32,
    });
    scene.add(t.light);
    torches.push(t);
  }

  // Hoisted colours for the per-frame fog + fill lerps (no per-frame alloc, engine-invariants #7).
  const _nightHaze = new THREE.Color(0x0c0f12);
  const _moonFill = new THREE.Color(0x5a6b86);   // cold moonlit sky fill at deep night
  const _moonGround = new THREE.Color(0x23262b); // cold dead-earth bounce at deep night

  // PLAYER LANTERN: a warm light that RIDES the survivor so their fighting area is always legible — the
  // perimeter torch ring (r≈23, dist 15) never reaches the arena centre, so in deep night the survivor
  // would otherwise stand in pitch black. Modest by day, full at night. Positioned per-frame in update().
  const lantern = new THREE.PointLight(0xffb877, 2.0, 13, 2);
  lantern.position.set(0, GROUND_Y + 1.6, 0);
  scene.add(lantern);

  /* ---- day/night boot: manual sweep over DAY_LENGTH_S (engine eases sunRig toward our goTo target) ---- */
  sunRig.setAuto?.(false);
  sunRig.goTo?.(SUN.startT);
  engine.fitShadowFrustum?.();

  // hoisted state + reusable event payload (no per-frame allocation, engine-invariants #7).
  let _elapsed = 0;
  let _phase = SUN.startT;
  let _override = null;                        // probe.setNight override (null → clock-driven)
  let _nf = resolveNight(_override, _phase, SUN);
  const _phasePayload = { t: _phase, night: false };
  const _baseFog = scene.fog && 'density' in scene.fog ? scene.fog.density : 0.012;

  const facade = {
    groundAt: (_x, _z) => GROUND_Y,            // FLAT play area (ratified #8)
    nightFactor: () => _nf,                    // THE canonical night value (sim difficulty + fx read this)
    obstacles: () => _obstacles,               // [{x,z,r}] trees + ruins (sim field + player walker)
    harvestNodes: () => _harvest,              // { wood:[{x,z,amount}], scrap:[{x,z,amount}] } (build)
    playRadius: PLAY_RADIUS,
    update(dt, _t) {
      _elapsed += dt;
      _phase = phaseAt(SUN.startT, _elapsed, DAY_LENGTH_S);
      _nf = resolveNight(_override, _phase, SUN);

      // drive the visible sun: follow the clock, OR (when overridden) jump to the phase that matches nf
      // so a forced night also DARKENS the sky, not just the sim.
      const target = _override != null ? phaseForNight(_override, SUN, SUN.startT) : _phase;
      sunRig.goTo?.(target);

      // the lantern rides the survivor (warm key on the fight area), stronger at night when it's the light.
      if (registry.has('player')) {
        const pp = registry.get('player').player;
        if (pp) lantern.position.set(pp.x, GROUND_Y + 1.6, pp.z);
      }
      lantern.intensity = 1.2 + 3.3 * _nf;   // legible key at night, subtle warmth by day

      // the fill hemisphere lifts the day arena and KEEPS a moonlit floor at night: the torch ring (r≈23,
      // distance 15) can't reach the arena centre, so without this floor the survivor stands in pitch black.
      // Night stays HARDER via the sim (speed×1.4, count×1.5) — the darkness is mood, not a legibility wall.
      fill.intensity = _fillBase * (1 - 0.55 * _nf);
      fill.color.setHex(0x9aa7b0).lerp(_moonFill, _nf);        // warm-cool sky fill → cold moonlight at night
      fill.groundColor.setHex(0x4a4436).lerp(_moonGround, _nf);

      // torches gutter every frame; near-OFF by day (0.04) so they don't warm-wash the daylight arena,
      // rising to full at deep night — that's when the torch pools become the legibility (dark-but-playable).
      const torchGain = 0.04 + 0.96 * _nf;
      for (let i = 0; i < torches.length; i++) {
        torches[i].update(dt);
        torches[i].light.intensity *= torchGain;
      }

      // NOTE (lead integration fix): createCelestials.update's LAST arg is the CAMERA (it calls
      // cam.getWorldPosition to place the sky bodies), NOT the camera-mode enum. The owner passed
      // ctx.CAM (the {DIMETRIC,PERSPECTIVE,…} constants) here → getWorldPosition-not-a-function on frame 1.
      celestials.update(dt, _elapsed, sunRig, weather, 'realistic', ctx.rig?.camera || null);
      clouds.update(dt, _elapsed, sunRig, weather);
      weather.update(dt, _elapsed);

      // fog thickens at night + with weather (kept cheap: one density write). COLOR is overridden to a
      // DESAT decrepit-forest haze (grey-green by day → cold near-black at night), so the engine's warm
      // low-sun sky-fog doesn't read as a fire-lit dusk — this is the world "gone wrong", not golden hour.
      if (scene.fog && 'density' in scene.fog) {
        scene.fog.density = _baseFog + 0.02 * _nf + 0.03 * (weather.fog || 0);
        scene.fog.color.setHex(0x8a8f80).lerp(_nightHaze, _nf); // grey-green → cold gloom
      }

      _phasePayload.t = _phase;
      _phasePayload.night = _nf > 0.5;
      events.emit('daynight:phase', _phasePayload);
    },
  };
  registry.register('world', facade);

  // Probe hook: override the canonical nightFactor (drives BOTH sim difficulty AND visuals). Passing null
  // clears the override back to the clock. Clamped to [0,1].
  ctx.probe.setNight = (nf) => {
    _override = nf == null ? null : Math.min(1, Math.max(0, nf));
    _nf = resolveNight(_override, _phase, SUN);
  };

  // Expose the pure night curve for any harness that wants to predict nf at a phase (no side effects).
  ctx.probe.nightFactorAt = (t) => nightFactorAt(t, SUN);

  // All assets are procedural + synchronous (no GLB/texture loads) → the boot cover can drop immediately.
  ctx.worldReady = Promise.resolve();
  return facade;
}
