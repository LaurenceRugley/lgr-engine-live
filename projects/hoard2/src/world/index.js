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
  createTorchLight, createTextureForge, forgeHoardMaterials, WEAPON_SKINS,
  createWorldFromRecipe, recipeFromText, mergeRecipes, createContactShadows,
  createIndirectField, applyGlint,
  // ARC A21 — THE REAL SKY: a generated city under the actual sky for its actual coordinates (the A20
  // astronomy lift, wired here for the FIRST time to a playable map). No-op unless a map's recipe sets
  // `city.location` (metropolisBase does; every other map's location stays null).
  createCelestial, createTrueStars, createSolarSystem, createConstellations,
} from '@lgr/engine-core';
import { phaseAt, resolveNight, phaseForNight, nightFactorAt, weatherKindAt, rainAmountAt } from './daynight.js';
import { forestRecipe, swampBase, SWAMP_DESC, lakeshoreBase, LAKESHORE_DESC, coastalBase, COASTAL_DESC, metropolisBase, METROPOLIS_DESC } from './recipes.js';

export function createWorld(ctx) {
  const { THREE, engine, scene, sunRig, config, events, registry, rng, CAM, renderer, rig } = ctx;
  const { GROUND_Y, PLAY_RADIUS, ARENA_EXTENT, SUN, DAY_LENGTH_S } = config;
  const seed = (rng && rng.masterSeed) != null ? rng.masterSeed : config.DEFAULT_SEED;
  // M1 MOBILE TRUTH — the canonical mobile-tier flag (main.js: coarse pointer OR ?mobile=1). The world owner
  // uses it to shed the v2-only load: point-light torches → emissive glow sprites, no moon directional, no
  // second (intact) city cluster, fewer trees, and characters/trees/backdrop opt out of the shadow pass so
  // the sun shadow map's caster set stays STATIC (then engine.setShadowThrottle near-freezes it — cheaply).
  const MOBILE = !!ctx.mobile;

  // Hide the default baked city — the decrepit world takes its place. BEAUTY tier; the lead's coupled-
  // look pass tunes the grade on top.
  engine.setUrbanVisible?.(false);
  // B2 WORLD-TRUTH (owner's phantom-water bug): the decrepit forest arena has NO water body. The engine's
  // city bay-water plane + ripple sim was being re-shown under the map every frame by renderCityPipeline's
  // refraction grab; setWaterEnabled(false) is the contextual-water seam that keeps it off (city stays true).
  // ?water=1 forces it back ON — the before/after A/B toggle for the water-edge proof + debugging.
  const _waterOn = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('water') === '1');
  engine.setWaterEnabled?.(_waterOn);
  // A4 CLOUDS RETURN (owner: "clouds back at proper altitude WITH drift — a living sky"). B2 disabled the
  // field because its clear band (hiY 4-6.8) sat at HEAD HEIGHT in this small arena (the "white puffs"). The
  // A4 altitude multiplier lifts that band into real SKY (≈14-24 u up), so the clouds read as a high, moving
  // overcast — visible when you dive to first-person and look up, and drifting east (the field already drifts
  // + fades at the band edges). City clouds untouched (default multiplier 1). Re-enabled + lifted:
  engine.setCloudsEnabled?.(true);
  engine.setCloudAltitude?.(3.5);
  // A6-0a: finer IBL-env cadence so the env tracks the descending sun instead of holding NOON into dusk then
  // snapping dark at the horizon (the measured dusk "flash-to-dark"). City default 4 → byte-identical; hoard2
  // opts into more buckets. ?envseg=<n> is the A/B knob while tuning.
  const _envSeg = ctx.flags?.q?.has('envseg') ? +ctx.flags.q.get('envseg') : 96;
  engine.setEnvSegments?.(_envSeg);
  // A5 FP SUN CORE (rider #3): the engine-shared celestials sun disc is a soft glow-style gradient that read as a
  // dull HOLLOW ring in the FP dive (A4 flag). setSunCore adds an opt-in solid hot-core sprite; city default 0/off
  // → byte-identical, hoard2 opts in. ?suncore=<0..1> is the A/B knob (default 0.9). Visible only in the FP dive.
  // ⚠ MEASURED CAVEAT (see HANDOFF A5 item 3): under hoard2's owner-chosen COOL beauty grade the sun sprite renders
  // at ≈sky brightness and CANNOT out-punch it (HDR push clamps to the same output; warm→muddy; cool→sky-blue), so
  // the core is currently near-INERT here. Making the FP sun read HOT needs a shared-pipeline change (post-grade
  // overlay / filmic sun-exception) entangled with the cool-grade ruling — flagged to DESIGN. The byte-identical
  // API is wired + ready; the knob stays so DESIGN/owner can A/B once that pipeline call is made.
  const _sunCore = ctx.flags?.q?.has('suncore') ? +ctx.flags.q.get('suncore') : 0.9;
  engine.setSunCore?.(_sunCore);
  // A6-0b (DESIGN ruling): the FP sun survives the cool grade as an EXCEPTION — a sprite can't out-punch the
  // grade (measured A5-item-3), so the fix is in the filmic pass: the bright+warm sun disc keeps its post-ACES
  // HOT look while the cool palette holds everywhere else. City default 0 → byte-identical. ?sunexc=<0..1> A/B.
  const _sunExc = ctx.flags?.q?.has('sunexc') ? +ctx.flags.q.get('sunexc') : 1.0;
  engine.setSunException?.(_sunExc);
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

  /* ---- A9 TEXT→WORLD: compose the arena from RECIPE #1 (the decrepit forest) via the engine interpreter ----
     Map generation is now a LIBRARY. createWorldFromRecipe composes the engine modules the recipe names —
     terrain rim · flat ground (de-tiled) · forest · createCity structure clusters · interactive ruins ·
     cover buildings · decorative scatter — and returns the sim's collision set (obstacles / buildingCylinders
     / harvest / playRadius). This REPLACES the ~250 lines of hand-wired content that used to live here; the
     atmosphere + lighting + facade below WRAP the returned content (the "project just wires it" seam).
     TRACE IDENTITY: recipe #1's params reproduce the original createForest / scatterRuins / cover-building
     calls at the same seed + fork names, in the same concat order → the sim trace is byte-identical (the
     migration proof, verified vs seed 1337). ?groundmacro=0 A/B is folded into the recipe's ground.macro
     decision (which still needs forge.supported for the desktop-only de-tiling). */
  const macroOff = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('groundmacro') === '0');
  const _scatterOff = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('scatter') === '0');   // A8-5 A/B lever (before/after)
  const _macro = forge.supported && !macroOff;
  // A14 GLINT A/B lever (?glint=0 kills the whole arc for the before/after). WATER glint rides the mobile
  // direct path (bespoke ShaderMaterial) so it is NOT forge-gated; GROUND glint is desktop-tier (needs the
  // forge's lit material — the mobile Lambert path has no specular lobe to host an NDF), gated like _macro.
  const _glintOff = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('glint') === '0');
  const _glintWater = !_glintOff;
  const _glintGround = forge.supported && !_glintOff;
  // A9 ?map — select the recipe. Default (or ?map=forest) is recipe #1, TRACE-PINNED byte-identical at seed
  // 1337. ?map=swamp runs the swamp DESCRIPTION through the TEXT front-end (recipeFromText) and merges the
  // parsed biome semantics (sparse · dead · foggy · pond) over the swamp's config scaffolding → recipe #2, a
  // genuinely different arena through the SAME interpreter (the second-consumer LIBRARY proof).
  const _map = ((ctx.flags && ctx.flags.q && ctx.flags.q.get('map')) || 'forest').toLowerCase();
  // The water maps (swamp · lakeshore) run their DESCRIPTION through the text front-end + merge it over a
  // config base (the text→world path). The default forest stays forestRecipe direct (trace-pinned).
  const _waterMaps = {
    swamp: { base: swampBase, desc: SWAMP_DESC },
    lakeshore: { base: lakeshoreBase, desc: LAKESHORE_DESC },
    coastal: { base: coastalBase, desc: COASTAL_DESC },
    // ARC A21 — THE CITY GENERATOR's own proof map: a full playable city, generated from a sentence
    // (METROPOLIS_DESC), through this SAME interpreter every other map already uses.
    metropolis: { base: metropolisBase, desc: METROPOLIS_DESC },
  };
  let recipeInput;
  if (_waterMaps[_map]) {
    const m = _waterMaps[_map];
    const parsed = recipeFromText(m.desc);
    recipeInput = mergeRecipes(m.base({ seed, playRadius: PLAY_RADIUS, macro: _macro, glintWater: _glintWater, glintGround: _glintGround }), parsed.recipe);
    recipeInput.meta = { ...(recipeInput.meta || {}), description: m.desc };
  } else {
    recipeInput = forestRecipe({ seed, playRadius: PLAY_RADIUS, macro: _macro });
  }
  if (_scatterOff) recipeInput.scatter = { enabled: false };
  const content = createWorldFromRecipe({ scene, rng, config, surfaces, mobile: MOBILE }, recipeInput);
  const _backdropGroup = content.backdropGroups[0] || null;   // M1: the governor panic tier hides this backdrop cluster
  const water = content.water;   // A12: the contextual water body (pond/lake) — driven per-frame in update()

  /* ---- ARC A21 — WET CITY STREETS (A14's glint, wired to a NEW consumer): the `groundWetness` recipe field
     applies the SAME glint mechanism that already sparkles wet sand/lake surfaces onto the city's own STREET
     mesh specifically (tagged `userData.groundKind === 'street'` — see citygen.js; sidewalks/parks/the island
     itself are untouched, keeping their own flat profile colour). Desktop-tier (needs the forge-lit material,
     matching every other glint consumer's own gate). `groundWetness` 0 (every other map; forest/swamp/etc
     never set `recipe.city`) → this block never runs. */
  let cityStreetGlint = null;
  if (content.city && forge.supported) {
    const wetness = content.recipe.city.groundWetness || 0;
    if (wetness > 0) {
      content.city.group.traverse((o) => {
        if (o.isMesh && o.userData.groundKind === 'street' && !cityStreetGlint) {
          cityStreetGlint = applyGlint(o.material, { density: wetness * 2.4, rough: 0.5, micro: 0.16, gain: 0.55 });
        }
      });
    }
  }

  /* ---- ARC A21 — THE REAL SKY: a generated city under the ACTUAL sky for its ACTUAL coordinates (the A20
     astronomy lift's first wiring into a playable map). Additive, no-op unless a map's recipe sets
     `city.location` (only metropolisBase does). Real stars/planets/constellations (createTrueStars/
     createSolarSystem/createConstellations) sit ALONGSIDE the engine's existing artistic sun/moon/cloud sky
     — this doesn't replace hoard2's day/night cycle (which stays the fast, ARTISTIC clock everything else
     reads), it adds "what's REALLY up there" as an independent layer, gated by the SAME night factor (_nf,
     defined below in the closure) so the real stars fade in/out in sync with the world's own dusk/dawn. The
     real sky's own clock is the ACTUAL wall-clock date/time — genuinely "the sky over this city, right now",
     not the sped-up game clock (which would make the stars visibly spin at an absurd rate). `rig.camera`
     (ctx.rig — added to this file's own destructure for this) rides the star/planet shell to zero parallax
     every frame, same trick the procedural night-sky dome already uses.
     HONEST GAP: constellation NAME LABELS (the projected DOM overlay `createConstellations.update()` can
     return) are not rendered anywhere — hoard2 has no such HUD layer, and building one was out of this arc's
     scope (the lines themselves still draw; only the text labels are unused). Messier objects were not
     wired either (createTrueStars + createSolarSystem + createConstellations is the combination the brief
     named; a Messier layer is a small, obvious follow-up, not attempted here to keep this addition scoped). */
  let realSky = null;
  const _cityLoc = content.city ? content.recipe.city.location : null;
  if (_cityLoc) {
    const celestial = createCelestial({ latitudeDeg: _cityLoc.latDeg });
    const trueStars = createTrueStars({ celestial });
    const solarSystem = createSolarSystem({ celestial });
    const constellations = createConstellations();
    scene.add(trueStars.group, solarSystem.group, constellations.group);
    let resolved = false;
    Promise.all([trueStars.ready, constellations.ready]).then(() => {
      constellations.resolve(trueStars.hrToIndex);
      trueStars.setVisible(true); solarSystem.setVisible(true);
      resolved = true;
    });
    realSky = { celestial, trueStars, solarSystem, constellations, get resolved() { return resolved; } };
  }

  /* ---- A11 THE LIGHT CEILING — CONTACT GROUNDING (item 1): a soft dark patch under every static object so
     trees/ruins/buildings read as PLACED, not floating (measured: contact darkening ≈ 0.02 at night = they
     float). Chosen over SSAO by cost — one InstancedMesh, no beauty-pipeline entanglement, no compile risk,
     and it grounds regardless of the sun (works at night where the directional shadow can't). DESKTOP-ONLY:
     mobile keeps its M1 direct-path scene UNTOUCHED (contact patches are basic-material and COULD ride it,
     but the invariant is mobile-untouched — a future opt-in). ?contact=0 is the A/B lever. Characters get a
     dynamic pool (survivor + horde) updated per frame from the sim positions (below, in update()). ---- */
  const _contactOff = ctx.flags && ctx.flags.q && ctx.flags.q.get('contact') === '0';
  let contactShadows = null;
  if (!MOBILE && !_contactOff) {
    contactShadows = createContactShadows({ groundY: GROUND_Y, strength: 0.42, softness: 1.5, dynamicPool: 64 });
    // GROUND THE SUBSTANTIAL FLOATERS: the big flat-bottomed objects (cover buildings + ruins) whose wide
    // footprint reads as pasted-on without a contact shadow, PLUS the moving characters (dynamic, below). We
    // deliberately do NOT patch the ~100 thin trees — their trunk is a point contact grounded by the now-
    // covered directional shadow (A11 frustum fit), and ~100 overlapping patches collectively over-darken the
    // forest FLOOR (measured: the whole arena dimmed) rather than grounding individual objects. Rocks likewise
    // sit flush + are tiny. So contact AO = buildings + ruins + characters; trees = the (fixed) sun shadow.
    const items = [];
    for (const rn of content.ruins) items.push({ x: rn.x, z: rn.z, r: rn.r * 1.1 });   // interactive ruins
    for (const b of content.buildings) items.push({ x: b.x, z: b.z, r: b.r * 0.95 });   // cover buildings
    // ARC A21: a city map's obstacles ARE its buildings (forest/ruins/cover-buildings are all zeroed in
    // metropolisBase) — ground every one so the skyline reads as PLACED, not floating, exactly like the
    // ruins/cover-buildings above. No-op for every other map (content.city is null there).
    if (content.city) for (const o of content.obstacles) items.push({ x: o.x, z: o.z, r: o.r * 0.9 });
    contactShadows.setStatic(items);
    scene.add(contactShadows.group);
  }

  /* ---- A15 BAKED RADIANCE PROBES (opt-in, default OFF) — the engine's FIRST indirect-light term.
     A build-time bake (tools/bake-probes.mjs) path-traced one bounce over the play ring and wrote a
     sparse RGBA8 irradiance volume; here we fetch it for THIS map+seed and add the bounce to the
     static receivers (ground/buildings/ruins/trees share the forge `surfaces` bundle). The ability
     lives in engine-core (createIndirectField); the project only WIRES + configures it.

     Default OFF ⇒ no fetch, no material patch ⇒ hoard2/city/hub/showcase render byte-identical. It
     rides the mobile DIRECT path by construction: the atlas is RGBA8 and we add to Three's diffuse
     `irradiance` (not a specular lobe), so both MeshStandard (desktop + mobile-direct) receive it —
     unlike glint (desktop-only). NOTE the true-LOWP iOS path swaps materials to MeshLambert at render
     (main.js _toLambert), which drops onBeforeCompile → GI is absent there; a future lift can inject
     into that swap. ?gi=1 turns it on; ?gistr=<n> overrides the master strength (A/B + taste dial). ---- */
  const _giOn = !!(ctx.flags && ctx.flags.q && ctx.flags.q.get('gi') === '1');
  let indirectField = null;
  if (_giOn) {
    const _giStr = parseFloat((ctx.flags && ctx.flags.q && ctx.flags.q.get('gistr')) || '');
    const strength = Number.isFinite(_giStr) ? _giStr : 0.5;   // subtle additive bounce over the existing hemi fill
    ctx._giReady = fetch(`./probes/${_map}-${seed}.json`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) { console.warn(`[gi] no baked atlas for ${_map}-${seed} — bake it: node tools/bake-probes.mjs ${_map} --seed ${seed}`); return; }
        indirectField = createIndirectField({ data, strength });
        // Apply to each UNIQUE MeshStandard receiver material once (dedupe — the forge bundle is shared,
        // and double-applying would chain the injection twice → duplicate-symbol compile error). Scope to
        // the play-ring content groups + forest; the distant backdrop cluster sits outside the grid.
        const seen = new Set();
        const roots = [...(content.groups || []), content.forest].filter(Boolean);
        for (const root of roots) {
          root.traverse?.((o) => {
            if (!o.isMesh || !o.material) return;
            const mats = Array.isArray(o.material) ? o.material : [o.material];
            for (const m of mats) {
              // lit receivers only (both classes use Three's `irradiance` term): MeshStandard on desktop +
              // mobile-direct-at-build; the render-time Lambert twins are re-patched via the userData tag.
              if (m && (m.isMeshStandardMaterial || m.isMeshLambertMaterial) && !seen.has(m)) { seen.add(m); indirectField.apply(m); }
            }
          });
        }
        ctx.indirectField = indirectField;   // handle for tools / future per-frame tint
      })
      .catch((e) => { console.warn('[gi] atlas load failed:', e && e.message); });
  }
  if (typeof window !== 'undefined') window.__giReady = () => (ctx._giReady || Promise.resolve());

  /* ---- A4 CLOUD SHADOWS: sell the MOVING SKY in the iso view (which never shows the sky) through its
     EVIDENCE — soft dark patches drifting across the arena floor, as if clouds were passing overhead
     (DESIGN's ruling). Cheap: ONE plane of dark soft blobs, UV-scrolled east with the cloud wind, faded
     out at night (no sun → no cloud shadow) and under fog. Drawn just above the ground, non-picking. ---- */
  const _csTex = (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 256;
    const g2 = cv.getContext('2d'); g2.clearRect(0, 0, 256, 256);
    const r2 = rng.fork ? rng.fork('cloudshadow') : Math.random;
    for (let i = 0; i < 11; i++) {
      const x = r2() * 256, y = r2() * 256, r = 42 + r2() * 74;
      const grad = g2.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(14,16,22,0.5)'); grad.addColorStop(1, 'rgba(14,16,22,0)');
      g2.fillStyle = grad; g2.beginPath(); g2.arc(x, y, r, 0, 7); g2.fill();
    }
    const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.4, 2.4); return t;
  })();
  const _csMat = new THREE.MeshBasicMaterial({ map: _csTex, transparent: true, depthWrite: false, opacity: 0, fog: true });
  const cloudShadows = new THREE.Mesh(new THREE.CircleGeometry(ARENA_EXTENT + 6, 48).rotateX(-Math.PI / 2), _csMat);
  cloudShadows.position.y = GROUND_Y + 0.02; cloudShadows.renderOrder = 2; cloudShadows.raycast = () => {};
  scene.add(cloudShadows);

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
  // LOOK-TUNE (owner playtest): DAY too dark — modest desktop day-fill lift (1.0 → 1.55). Still the
  // directional-ish hemisphere (sky-over-ground), NOT a flat fill, so the sun keeps shaping + casting.
  const _fillBase = _mobileFloor ? 3.2 : 1.55;   // daytime sky-fill (hemisphere)
  // B2 finding #6 — NIGHT LEGIBILITY: the desktop night flat-floor. LOOK-TUNE nudges it 2.2 → 2.5 (a touch)
  // so zombies read at combat range; the MOON key (below) does the directional read. ×nf → 0 by day.
  const _ambBase  = _mobileFloor ? 1.6 : 2.5;   // NIGHT-only flat floor (see update(): × nightFactor)
  const fill = new THREE.HemisphereLight(0x9aa7b0, 0x4a4436, _fillBase);
  scene.add(fill);
  const amb = new THREE.AmbientLight(0x9a9482, 0); // intensity driven per-frame to _ambBase × nightFactor
  scene.add(amb);
  // LOOK-TUNE — a real MOON KEY at night (owner: "some moonlight so zombies are seen"). A COOL directional
  // (not warm daylight) that ramps in with nightFactor and rakes the arena from a high side angle, giving
  // zombies a lit silhouette-edge at combat range — SEEN but scary, the dread stays (the lantern remains the
  // warm anchor). No shadow map (the sun owns shadows; a 2nd caster is costly). Intensity driven in update().
  // M1 MOBILE TRUTH: the moon DIRECTIONAL is DESKTOP-ONLY. On mobile it's FOLDED INTO THE HEMISPHERE — the
  // fill light already cools to _moonFill (cold moonlight) at night below, so the night stays cool + legible
  // WITHOUT a second directional light in the forward rig (one fewer light evaluated per fragment).
  const moon = MOBILE ? null : new THREE.DirectionalLight(0x7f95c4, 0);   // cool moonlight; intensity = _moonBase × nightFactor
  if (moon) { moon.position.set(-14, 20, 10); moon.target.position.set(0, 0, 0); scene.add(moon); scene.add(moon.target); }
  const _moonBase = _mobileFloor ? 0.6 : 1.1;   // enough to rake an APPROACHING zombie's silhouette at mid-range

  // FOG is ENGINE-OWNED: updateWorld writes scene.fog.density (from weather) + scene.fog.color (from the
  // sun horizon) EVERY frame (createCityWorld:958-960). The one-shot's project-local fog writes ran
  // BEFORE updateWorld and were overwritten every frame — dead code, removed. hoard2 inherits the engine
  // fog. (A cooler decrepit fog TINT, if DESIGN wants it, is a grade/keyframe follow-up — flagged, not a
  // project-local stomp.) The engine already created scene.fog, so there is nothing to create here.

  /* ---- gameplay arrays from the interpreter (the sim's collision + harvest sets) ----
     The forest · terrain rim · structure clusters · interactive ruins · cover buildings · decorative scatter
     are all built + added to the scene by createWorldFromRecipe above; these are the arrays the sim/player/
     build read via the facade. They're byte-identical to the old hand-wired arrays at seed 1337 (recipe #1). */
  const _obstacles = content.obstacles;            // tree trunks (in play radius) + ruin footprints + cover buildings
  const _buildings = content.buildingCylinders;    // A4 cover cylinders [{x,z,r,h}] — ballistics stops shots on them
  const _harvest = content.harvest;                // { wood:[{x,z,amount}], scrap:[{x,z,amount}] } (build reads this)

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
  // DESKTOP: real flickering PointLights (warm pools that light the arena floor). MOBILE: EMISSIVE GLOW
  // SPRITES — the SAME ring, but each torch is an additive warm quad instead of a PointLight. This is the
  // single largest per-fragment win on the mobile forward path (8 point lights → 0: three.js evaluates every
  // point light for every lit fragment). The glow still READS as a torch — it blooms in the beauty present
  // and glows directly in the LOWP Lambert path — it just contributes no per-fragment lighting cost. The
  // survivor's lantern (one PointLight, below) remains the single travelling warm key so night stays playable.
  const torches = [];        // desktop PointLight torches (empty on mobile)
  const torchGlows = [];     // mobile additive glow sprites (empty on desktop)
  const TORCH_N = 8, torchR = PLAY_RADIUS - 3;
  const _glowTex = MOBILE ? (() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g2 = cv.getContext('2d'); const grd = g2.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(255,205,130,1)'); grd.addColorStop(0.4, 'rgba(255,150,70,0.55)'); grd.addColorStop(1, 'rgba(255,120,50,0)');
    g2.fillStyle = grd; g2.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(cv);
  })() : null;
  for (let i = 0; i < TORCH_N; i++) {
    const a = (i / TORCH_N) * Math.PI * 2;
    const px = Math.cos(a) * torchR, py = GROUND_Y + 2.3, pz = Math.sin(a) * torchR;
    if (MOBILE) {
      const mat = new THREE.SpriteMaterial({ map: _glowTex, color: 0xffb562, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
      const sp = new THREE.Sprite(mat); sp.position.set(px, py, pz); sp.scale.setScalar(2.6); sp.raycast = () => {};
      scene.add(sp); torchGlows.push({ sprite: sp, seed: i });
    } else {
      const t = createTorchLight({
        color: 0xffb562, intensity: 5.5, distance: 15, decay: 2,
        position: [px, py, pz], seed: i, amp: 0.32,
      });
      scene.add(t.light);
      torches.push(t);
    }
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
  // A11 THE LIGHT CEILING — cover the PLAY RING with the sun shadow (desktop). The engine frustum defaults to
  // the small hidden-city extent (±~12u), so objects past r≈12 in our r=26 arena cast NO shadow at all — the
  // measured "floating" cause (4/6 sampled objects had no shadow). Fit the ortho frustum to the play ring so
  // the whole fight area grounds. DESKTOP-ONLY: mobile keeps its M1 shadow class (small frustum, 1024, frozen)
  // UNTOUCHED. ?shadowfit=0 is the A/B lever. (Resolution stays 2048; the frustum-fit is the measured win.)
  // ARC A21: content.playRadius (not the static PLAY_RADIUS constant) — a city map widens the play ring to
  // the generated city's own extent (citySolidsToObstacles/city.scale in createWorldFromRecipe.js), so the
  // shadow frustum must cover THAT, not the old fixed radius. Byte-identical for every other map
  // (content.playRadius === PLAY_RADIUS there — no recipe sets playRing.radius or city.enabled).
  if (!MOBILE && !(ctx.flags?.q?.get('shadowfit') === '0')) engine.setShadowFrustumExtent?.(content.playRadius + 4);
  engine.fitShadowFrustum?.();
  // M1 MOBILE TRUTH: near-freeze the sun shadow map on mobile. Its casters are now STATIC (only the in-arena
  // ruins + cover buildings cast — characters, trees, and the backdrop all opted out above), so a ~15 s
  // refresh keeps their shadows aligned with the visibly-moving A4 sun (≤~3° drift between updates) while
  // killing the per-frame 2048² re-render the diagnosis clocked at ~every 1.4 s. Desktop re-renders every move.
  if (MOBILE) engine.setShadowThrottle?.(15);

  // hoisted state + reusable event payload (no per-frame allocation, engine-invariants #7).
  const _dynContacts = [];   // A11: reused per-frame scratch for the contact-shadow dynamic pool (no alloc)
  let _elapsed = 0;
  let _phase = SUN.startT;
  let _override = null;                        // probe.setNight override (null → clock-driven)
  let _nf = resolveNight(_override, _phase, SUN);
  const _phasePayload = { t: _phase, night: false };
  // A6-1 SKY SHOW — weather schedule state. ?weather=<clear|rain|snow|fog> PINS a kind (A/B + capture);
  // otherwise the RECIPE's atmosphere.weather drives it: 'schedule' → the day-phase schedule (weatherKindAt),
  // or a pinned kind (A9 swamp pins 'fog' → the arena stays foggy). We only push to the engine on CHANGE.
  const _recipeWeather = content.recipe.atmosphere.weather;
  const _weatherPin = ctx.flags?.q?.has('weather') ? ctx.flags.q.get('weather')
    : (_recipeWeather !== 'schedule' ? _recipeWeather : null);
  let _weatherKind = null;                     // last kind pushed to the engine rig (null → force first push)
  // A6-1: weather GATHERS gradually in this arena — a slow ease so overcast/rain/fog roll in over several
  // seconds (atmospheric, and it keeps the real-clock cycle-smoothness gate green; a fast onset was a
  // measured discontinuity). City default 1 → byte-identical. ?weatherease=<n> tunes it while iterating.
  const _wEase = ctx.flags?.q?.has('weatherease') ? +ctx.flags.q.get('weatherease') : 0.06;
  engine.setWeatherEaseScale?.(_wEase);

  const facade = {
    groundAt: (_x, _z) => GROUND_Y,            // FLAT play area (ratified #8)
    nightFactor: () => _nf,                    // THE canonical night value (sim difficulty + fx read this)
    obstacles: () => _obstacles,               // [{x,z,r}] trees + ruins + A4 buildings (sim field + player walker)
    buildingCylinders: () => _buildings,       // A4 [{x,z,r,h}] intact cover — ballistics stops shots on them
    harvestNodes: () => _harvest,              // { wood:[{x,z,amount}], scrap:[{x,z,amount}] } (build)
    playRadius: content.playRadius,   // ARC A21: wider for a city map (see the shadow-frustum comment above); == PLAY_RADIUS elsewhere
    // M1 item 5 — governor panic shed: hide the distant backdrop ruins cluster (draw calls). Reversible;
    // purely cosmetic (it's beyond the play radius). No-op if the cluster failed to build.
    setBackdropVisible: (on) => { if (_backdropGroup) _backdropGroup.visible = !!on; },
    update(dt, _t) {
      _elapsed += dt;
      _phase = phaseAt(SUN.startT, _elapsed, DAY_LENGTH_S);
      _nf = resolveNight(_override, _phase, SUN);

      // A4 CLOUD SHADOWS drift east with the wind (matches the cloud field's +x drift) and fade with night —
      // strong by day (the sun casts them), gone at deep night. A slow scroll reads as a lazy overcast moving.
      _csTex.offset.x = (_elapsed * 0.010) % 1;
      _csTex.offset.y = (_elapsed * 0.004) % 1;
      _csMat.opacity = 0.5 * (1 - _nf);

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

      // A11 CONTACT GROUNDING (dynamic) — a soft patch under the survivor + every live zombie, so the moving
      // characters read as grounded too (esp. at night, where the directional shadow can't reach them). A
      // read-only position snapshot (contactSample) → no sim perturbation. Scratch array reused (no alloc).
      if (contactShadows) {
        _dynContacts.length = 0;
        if (registry.has('player')) { const pp = registry.get('player').player; if (pp) _dynContacts.push({ x: pp.x, z: pp.z, r: 0.5 }); }
        if (registry.has('sim')) { const zs = registry.get('sim').contactSample?.(); if (zs) for (let i = 0; i < zs.length; i++) _dynContacts.push(zs[i]); }
        contactShadows.updateDynamic(_dynContacts);
      }

      // A12 WATER — advance the ripple + feed the CURRENT sun / sky-horizon / fog so the surface sits in the
      // same atmosphere as everything else (Fresnel sky-tint + sun glint + FogExp2 match). sunRig outputs are
      // by-ref (updated by the engine's updateWorld each frame); a 1-frame lag on a cosmetic surface is moot.
      if (water) {
        water.update(_elapsed);
        water.setSun(sunRig.sunDir, sunRig.sunColor);
        water.setSky(sunRig.horizon || sunRig.sky);
        if (scene.fog) water.setFog(scene.fog.color, scene.fog.density);
        // A16 LIFT#2 RAIN-ON-WATER — couple the lifted rain-ripple ability to the SAME weather schedule that
        // drives the visible sky: dimpled impact rings dance across the sea during the afternoon-rain window
        // and calm as it clears. A ?weather pin forces it (rain → full, clear/fog → none) for A/B captures.
        // rain=0 → the water shader skips it (byte-identical to A13); non-water maps never reach here.
        water.setRain(_weatherPin === 'rain' ? 1 : _weatherPin != null ? 0 : rainAmountAt(_phase, seed));
      }

      // A14 GLINT (ground consumer) — feed the live world sun dir + colour so the wet-grit sparkle sits in
      // the sun's glare path and warms/cools with the day cycle. Desktop-tier; null when off/mobile.
      if (content.groundGlint) content.groundGlint.setSun(sunRig.sunDir, sunRig.sunColor);
      // ARC A21 — wet CITY street glint, same feed as the ground consumer above.
      if (cityStreetGlint) cityStreetGlint.setSun(sunRig.sunDir, sunRig.sunColor);

      // ARC A21 — THE REAL SKY: recompute real star/planet/constellation positions for the ACTUAL current
      // instant at the recipe's real coordinates, gated by the SAME night factor (_nf) driving everything
      // else — the real stars fade in exactly when the world's own artistic dusk says night has fallen.
      if (realSky && realSky.resolved) {
        const { celestial, trueStars, solarSystem, constellations } = realSky;
        const now = new Date();
        trueStars.update(now, _cityLoc.latDeg, _cityLoc.lonDeg, _nf, _elapsed, false, rig.camera);
        solarSystem.update(now, _cityLoc.latDeg, _cityLoc.lonDeg, _nf, _elapsed, false, rig.camera);
        constellations.update(trueStars.position, _nf, true, rig.camera);
      }

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
      // LOOK-TUNE: the cool moon key ramps in with night (0 by day → _moonBase at deep night) so zombies get
      // a directional read at combat range without daylighting the arena (modest + cool; the mood holds).
      if (moon) moon.intensity = _moonBase * _nf;   // M1: desktop-only (mobile folds the moon into the hemi)

      // torches gutter every frame; near-OFF by day (0.04) so they don't warm-wash the daylight arena,
      // rising to full at deep night — that's when the torch pools become the legibility (dark-but-playable).
      const torchGain = 0.04 + 0.96 * _nf;
      for (let i = 0; i < torches.length; i++) {
        torches[i].update(dt);
        torches[i].light.intensity *= torchGain;
      }
      // M1 MOBILE: the emissive torch GLOW sprites pulse opacity with the same night gain + a cheap flicker
      // (a couple of incommensurate sines — no allocation, no light). Off by day, glowing warm at night.
      for (let i = 0; i < torchGlows.length; i++) {
        const g = torchGlows[i];
        const fl = 0.72 + 0.28 * (0.6 * Math.sin(11.0 * _elapsed + g.seed) + 0.4 * Math.sin(17.3 * _elapsed + g.seed * 1.7));
        g.sprite.material.opacity = Math.min(1, torchGain * fl);
      }

      // CELESTIALS · SKY · CLOUDS · FOG are all driven by the engine's updateWorld (called from the
      // composition root AFTER world.update each frame) — hoard2 sets only the sun PHASE (goTo above) and
      // inherits the rest. No project-local sky/fog stepping here (LIGHT-THE-HOARD).
      // A6-1 SKY SHOW — WEATHER is the one exception hoard2 now drives: the engine builds + eases the rig,
      // but its KIND never changed (stuck 'clear'). We push the schedule's goal (or the ?weather pin) only on
      // CHANGE — the rig eases the visuals every frame, so this is one setter call per weather transition, not
      // per frame. Visual-only (nightFactor above is the sun clock, untouched) → the sim trace is unperturbed.
      const _wTarget = _weatherPin != null ? _weatherPin : weatherKindAt(_phase, seed);
      if (_wTarget !== _weatherKind) { engine.setWeatherKind?.(_wTarget); _weatherKind = _wTarget; }

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
