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
     • the SUN / SKY / CELESTIALS (sun+moon+stars+constellations) / CLOUDS / WEATHER / FOG are all
       INHERITED from the engine (createCityWorld builds + drives them in updateWorld; setUrbanVisible
       keeps the sky) — hoard2 only sets the day/night PHASE via sunRig.goTo. LIGHT-THE-HOARD removed the
       one-shot's project-local duplicates.
     • createTorchLight ×N + a survivor lantern — the only project-local lights: warm point pools for
       night legibility (dark-but-playable), like the city's street-lights. Plus a mobile-only fill floor.

   Determinism: all seeded rolls come from the master seed (createForest/createCity) or rng.fork('world')
   (ruins) — NEVER Math.random (weather-rig's internal cosmetic Math.random is engine-owned + un-probed).
   No per-frame allocation in update() (scratch hoisted; the daynight payload is reused).
   ============================================================ */
import {
  createCity, createForest, createTorchLight,
  generateTerrain, buildTerrainMesh,
  createTextureForge, forgeHoardMaterials, WEAPON_SKINS,
} from '@lgr/engine-core';
import { buildDecrepitProfile } from './profile.js';
import { phaseAt, resolveNight, phaseForNight, nightFactorAt } from './daynight.js';
import { scatterRuins, deriveHarvest } from './scatter.js';

export function createWorld(ctx) {
  const { THREE, engine, scene, sunRig, config, events, registry, rng, CAM, renderer } = ctx;
  const { GROUND_Y, PLAY_RADIUS, ARENA_EXTENT, SUN, DAY_LENGTH_S } = config;
  const seed = (rng && rng.masterSeed) != null ? rng.masterSeed : config.DEFAULT_SEED;

  // Hide the default baked city — the decrepit world takes its place. BEAUTY tier; the lead's coupled-
  // look pass tunes the grade on top.
  engine.setUrbanVisible?.(false);
  // B2 WORLD-TRUTH (owner's phantom-water bug): the decrepit forest arena has NO water body. The engine's
  // city bay-water plane + ripple sim was being re-shown under the map every frame by renderCityPipeline's
  // refraction grab; setWaterEnabled(false) is the contextual-water seam that keeps it off (city stays true).
  // ?water=1 forces it back ON — the before/after A/B toggle for the water-edge proof + debugging.
  const _waterOn = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('water') === '1');
  engine.setWaterEnabled?.(_waterOn);
  // B2 CLOUD-SCALE LIFT (owner's B1 "white puffs" flag): the engine cloud field's altitude band (hiY
  // 4-6.8) is CITY-scale → head-height sprites in this small arena. The decrepit forest reads better
  // BARE (a grim empty sky), so disable the field here (engine seam, city clouds untouched). The stray
  // low-sprite hide in main.js becomes redundant but harmless.
  engine.setCloudsEnabled?.(false);
  // B2 finding #6 — dial the beauty chromatic-aberration WAY down (the loud rainbow fringing on thin tree
  // trunks both B1 critics flagged). 0.3 keeps a filmic hint without the rainbow. City CA untouched (1.0).
  engine.setChromaScale?.(0.3);
  // B2 finding #5 — grade warm→cool "rot". OWNER RULING (2026-07-28): the COOL cold-rot look WINS → it is
  // now the BAKED DEFAULT (1). ?gradecool=0 is the WARM escape hatch kept for A/B; ?gradecool=<0..1> still
  // sets any blend. (City default stays 0/warm — the seam defaults to the city value; this is hoard2's wire.)
  const _gradeCool = ctx.flags && ctx.flags.q && ctx.flags.q.get('gradecool') != null
    ? Math.min(1, Math.max(0, Number(ctx.flags.q.get('gradecool')) || 0)) : 1;
  engine.setGradeCool?.(_gradeCool);
  engine.setPostMode?.(2);

  /* ---- TEXTURE FORGE (Beauty B1 GROUND TRUTH): bake seeded procedural PBR (albedo/ORM/Sobel-normal)
     for every hoard surface at boot, so the decrepit world stops being flat-coloured. Engine-first —
     the forge + recipes live in core; hoard2 only WIRES the baked materials onto its meshes.
     forge.supported === false on iOS-p0 (no highp fragment) → every material is the recipe's FLAT
     fallback colour == today's LOWP look (owner-verified), so the phone never regresses (the LOWP
     Lambert path keeps its maps=null flats). Baked once here at construction → no mid-play compiles. ---- */
  // ?forge=0 forces the flat fallback (the before/after A/B toggle for the critic panel + debugging).
  const forgeOff = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('forge') === '0');
  const forge = createTextureForge({ renderer, enabled: !forgeOff });
  const groundExtent = (ARENA_EXTENT + 6) * 2;   // ground disc diameter (m) the 4 m tile repeats across
  const surfaces = forgeHoardMaterials(forge, {
    extents: { ground: groundExtent, stone: 3.0, bark: 2.4, barkLive: 2.4, wood: 1.2, scrap: 1.0 },
    // CRITIC R1 FIX (dead bark read as BLACK VOIDS): the forest bakes a DARK per-vertex archetype colour
    // (trunk hex) into the geometry; with vertexColors:true it multiplied the already-dark bark map to
    // near-black. Force vertexColors:FALSE so only the bark MAP shows — the per-instance tint
    // (instanceColor) still modulates it (three applies instanceColor independent of vertexColors).
    // B2: barkLive KEEPS vertexColors so the conifer's GREEN CANOPY vertex colour survives; the healthy
    // bark map textures the whole live tree (green cones read as textured foliage, trunk as warm bark).
    matOpts: { bark: { vertexColors: false }, barkLive: { vertexColors: true } },
  });
  // B2 live trees: the conifer's GREEN CANOPY + warm trunk come from its baked VERTEX COLOURS; the forge
  // bark ALBEDO map would multiply the green down to dark olive, so DROP the albedo map but KEEP the forge
  // NORMAL + ROUGHNESS ("healthier bark tint via the forge" = forge RELIEF over a healthy vertex tint).
  // Guarded: the flat fallback path (iOS-p0) has no map to clear.
  if (surfaces.barkLive && surfaces.barkLive.map) { surfaces.barkLive.map = null; surfaces.barkLive.needsUpdate = true; }
  ctx.forge = forge;          // read-only engine capability (like engine/renderer)
  ctx.surfaces = surfaces;    // build reads ctx.surfaces.wood / .scrap for its barriers
  // B4 COMBAT FEEL — bake the WEAPON SKINS (forge gunmetal, fresh + worn variants). player wires the gun kit
  // onto the survivor's hand + the FP viewmodel with these. Flat fallback on iOS-p0 (makeMaterial handles it).
  ctx.weaponSkins = {
    gunmetal: forge.makeMaterial(WEAPON_SKINS.gunmetal),
    gunmetal_worn: forge.makeMaterial(WEAPON_SKINS.gunmetal_worn),
  };

  /* ---- flat arena ground (opaque disc; covers the terrain rim's centre → play area reads FLAT) ---- */
  // FORGE: decrepit forest floor (dead-leaf litter over trodden dirt), tiled ~groundExtent/4 across the
  // disc. Fallback flat colour 0x5f5a4a (recipe) on iOS-p0. receiveShadow on so the sun grounds actors.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_EXTENT + 6, 64).rotateX(-Math.PI / 2),
    surfaces.ground,
  );
  ground.position.y = GROUND_Y; ground.receiveShadow = true;
  scene.add(ground);

  // LIGHT-THE-HOARD (2026-07-27): the engine's SunRig already drives a DIRECTIONAL sun key (city.key) +
  // a hemisphere fill (city.fill) every frame via updateWorld — hoard2 INHERITS the real sun stack. The
  // one-shot had stacked a big project-local HemisphereLight (2.0) + a full-strength AmbientLight (0.8)
  // that ran MAX BY DAY — a flat wash competing head-on with the sun (ratio ~1.2:1), so the directional
  // shaping + cast shadows vanished into an even floor ("the sun isn't acting like a sun").
  // FIX — two moves that keep the sun dominant by day yet the arena playable at night:
  //  (1) DAY: only a MODEST hemisphere sky-fill (skylight, directional-ish — it does NOT flatten like a
  //      pure AmbientLight). Engine hemi (~0.46) + this (~1.0) vs the sun (~3.9) ≈ a 2.7:1 key ratio, so
  //      shadows + lit/shadow sides read while the decrepit arena still legible. Fades toward night.
  //  (2) NIGHT: the flat AmbientLight is now NIGHT-ONLY (×nightFactor) — 0 by day so it never flattens the
  //      sun, rising past dusk to a dim floor so the arena CENTRE isn't pitch black (the perimeter torch
  //      ring at r≈23 can't reach the middle; that floor was the one-shot's real job). At night there is
  //      no sun to flatten, so a flat floor is the right tool.
  // The mobile PRECISION-SAFE path (coarse pointer OR iOS-p0 LOWP, owner-verified) renders DIRECT (Lambert,
  // no beauty tonemap) and gets a STRONGER floor so the phone never goes dark (brief: keep the mobile path,
  // don't regress the owner's phone). (C++ anchor: _mobileFloor is a compile-time branch on device class.)
  const _coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const _mobileFloor = _coarse || (typeof window !== 'undefined' && !!window.__lowp);
  const _fillBase = _mobileFloor ? 3.2 : 1.0;   // daytime sky-fill (hemisphere)
  // B2 finding #6 — NIGHT LEGIBILITY: raise the desktop night flat-floor (1.3 → 2.2) so the whole arena is
  // dimly READABLE at night (you can see shapes/zombies approaching), not blind. Safe: this floor is ×nf
  // (0 by day, so the sun stays unflattened) and at night there is no sun to flatten (LIGHT-THE-HOARD).
  const _ambBase  = _mobileFloor ? 1.6 : 2.2;   // NIGHT-only flat floor (see update(): × nightFactor)
  const fill = new THREE.HemisphereLight(0x9aa7b0, 0x4a4436, _fillBase);
  scene.add(fill);
  const amb = new THREE.AmbientLight(0x9a9482, 0); // intensity driven per-frame to _ambBase × nightFactor
  scene.add(amb);

  // FOG is ENGINE-OWNED: updateWorld writes scene.fog.density (from weather) + scene.fog.color (from the
  // sun horizon) EVERY frame (createCityWorld:958-960). The one-shot's project-local fog writes ran
  // BEFORE updateWorld and were overwritten every frame — dead code, removed. hoard2 inherits the engine
  // fog. (A cooler decrepit fog TINT, if DESIGN wants it, is a grade/keyframe follow-up — flagged, not a
  // project-local stomp.) The engine already created scene.fog, so there is nothing to create here.

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
    // FORGE stone (ruin concrete/plaster) — a PLAIN MeshStandardMaterial (no engine reflection patch),
    // so the beauty reflection pass renders these distant ruins harmlessly (the crash-fix constraint
    // that required re-materialing off the engine patch still holds; we just swap flat grey → real stone).
    city.group.traverse((o) => { if (o.isMesh) { o.material = surfaces.stone; o.castShadow = true; o.receiveShadow = true; } });
    // shove the compact (~15u) city out to a corner past the play radius → a distant ruined quarter.
    city.group.position.set(-(PLAY_RADIUS + 6), 0, -(PLAY_RADIUS + 2));
    city.group.scale.setScalar(1.25);
    scene.add(city.group);
  } catch (e) { console.warn('[world] decrepit city skipped:', e && e.message); }

  /* ---- DEAD FOREST: bare trees + rocks (no green conifers), central clearing open ---- */
  // B2 finding #3 — LIVE TREES among the dead ("dying, not dead"): a FEW green conifers (weight 0.14 = the
  // mix ratio) seeded through the many dead trunks, their trunks + canopy textured by the HEALTHY forge
  // bark (barkLive, warm + lichen). rocks keep vertex-colour; dead 'bare' keep the weathered forge bark.
  const forest = createForest({
    seed, radius: ARENA_EXTENT - 2, arenaR: PLAY_RADIUS, count: 96, minSpacing: 1.9,
    clearings: [{ x: 0, z: 0, r: 6 }],
    archetypes: [
      { key: 'bare', weight: 0.62, r: 0.34 },
      { key: 'rock', weight: 0.24, r: 0.3 },
      { key: 'conifer', weight: 0.14, r: 0.38 },   // the live minority
    ],
    groundY: GROUND_Y,
    materials: { bare: surfaces.bark, conifer: surfaces.barkLive },
  });
  scene.add(forest.group);

  /* ---- INTERACTIVE RUINS: sparse primitive rubble in the play ring (seeded via the WORLD fork) ---- */
  const worldRng = rng.fork('world');
  const ruins = scatterRuins({ rng: worldRng, count: 14, innerR: 8, outerR: PLAY_RADIUS - 2, minSpacing: 3.2 });
  const ruinGroup = new THREE.Group(); ruinGroup.raycast = () => {};
  for (const rn of ruins) {
    // a crude broken mass: a low STONE box + a leaning SCRAP-metal slab (salvage). The scrap slab makes
    // the scrap surface a real second consumer, and matches the fiction (ruins yield scrap to harvest).
    const h = rn.kind === 'husk' ? 2.2 : rn.kind === 'wall' ? 1.4 : 0.6;
    const box = new THREE.Mesh(new THREE.BoxGeometry(rn.r * 1.8, h, rn.r * 1.6), surfaces.stone);
    box.position.set(rn.x, GROUND_Y + h / 2, rn.z);
    box.rotation.y = rn.yaw; box.castShadow = true; box.receiveShadow = true;
    ruinGroup.add(box);
    if (rn.kind !== 'rubble') {
      const slab = new THREE.Mesh(new THREE.BoxGeometry(rn.r * 1.4, h * 0.9, 0.18), surfaces.scrap);
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

  /* ---- CELESTIALS · SKY · CLOUDS · WEATHER — INHERITED from the engine (not project-local) ----
     LIGHT-THE-HOARD: createCityWorld already builds celestials (sun/moon/stars/constellations), the
     Preetham sky, the cloud field, and the weather rig, and DRIVES them every frame inside updateWorld
     (celestials.update with the live camera + tier; clouds/weather/fog). setUrbanVisible(false) hides the
     CITY buildings but KEEPS the sky (createCityWorld:1049 — "hide the whole city for a non-city map
     (keeps the sky)"). The one-shot built PROJECT-LOCAL duplicates — a second createCelestials plus a
     hidden weather+cloud rig it drove itself — a shadow copy of the core stack. Per the inheritance
     manifest they are REMOVED: hoard2 now inherits ONE real sky stack. Night stars/constellations come
     from the engine celestials; the additive ground-mote weather/cloud sprites are simply not created,
     so they can't fuzz the FP eyeline. */

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

  // Hoisted colours for the per-frame mobile-floor fill lerps (no per-frame alloc, engine-invariants #7).
  const _moonFill = new THREE.Color(0x5a6b86);   // cold moonlit sky fill at deep night (mobile floor only)
  const _moonGround = new THREE.Color(0x23262b); // cold dead-earth bounce at deep night (mobile floor only)

  // PLAYER LANTERN: a warm light that RIDES the survivor so their fighting area is always legible — the
  // perimeter torch ring (r≈23, dist 15) never reaches the arena centre, so in deep night the survivor
  // would otherwise stand in pitch black. Modest by day, full at night. Positioned per-frame in update().
  // B2 finding #6 — FP NIGHT LEGIBILITY (owner: "dive at night is blind"). The lantern is the survivor's
  // key light in the dive; range 13/night-4.5 wasn't enough to read the immediate fighting area against
  // the ACES night grade. Wider range + a much stronger night term so night is DARK-BUT-PLAYABLE (a warm
  // pool travels with the survivor); the arena beyond stays grim-dark. Per-frame intensity set in update().
  const lantern = new THREE.PointLight(0xffb877, 2.0, 19, 2);
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
      lantern.intensity = 1.3 + 4.6 * _nf;   // B2: warm night key pool (dive legibility) over the night floor

      // DAY sky-fill: a modest hemisphere that lifts the arena so the decrepit palette reads under the sun,
      // fading toward night as the sky darkens. Directional-ish (sky-over-ground), so the sun's shaping and
      // cast shadows survive (unlike the one-shot's big flat fill). Colour cools to moonlight at night.
      fill.intensity = _fillBase * (1 - 0.5 * _nf);
      fill.color.setHex(0x9aa7b0).lerp(_moonFill, _nf);        // warm-cool sky fill → cold moonlight at night
      fill.groundColor.setHex(0x4a4436).lerp(_moonGround, _nf);
      // Flat floor. DESKTOP: NIGHT-only (× nf) — 0 by day so the sun stays unflattened, rising past dusk so
      // the arena centre (past the perimeter torch ring) isn't pitch black. MOBILE precision-safe path: a
      // constant DAY floor too (0.55 → 1.0 × _ambBase), because that path renders direct through the iOS
      // tonemap that crushes the arena to black — the phone needs the daytime lift (owner-verified, kept).
      // Night is still HARDER via the sim (speed×1.4, count×1.5); this is legibility, not a mood-killer.
      amb.intensity = _ambBase * (_mobileFloor ? (0.55 + 0.45 * _nf) : _nf);

      // torches gutter every frame; near-OFF by day (0.04) so they don't warm-wash the daylight arena,
      // rising to full at deep night — that's when the torch pools become the legibility (dark-but-playable).
      const torchGain = 0.04 + 0.96 * _nf;
      for (let i = 0; i < torches.length; i++) {
        torches[i].update(dt);
        torches[i].light.intensity *= torchGain;
      }

      // CELESTIALS · SKY · CLOUDS · WEATHER · FOG are all driven by the engine's updateWorld (called from
      // the composition root AFTER world.update each frame) — hoard2 sets only the sun PHASE (goTo above)
      // and inherits the rest. No project-local sky/fog stepping here anymore (LIGHT-THE-HOARD).

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
