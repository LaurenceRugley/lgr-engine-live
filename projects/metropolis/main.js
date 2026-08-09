/* ============================================================
   METROPOLIS — Arc A-METRO composition root.
   ------------------------------------------------------------
   The owner's test: "everything we have in our engine — can we recreate what we did before, but
   better?" This project does NOT patch projects/city (2,451 lines, and it carries BYTE-IDENTICAL
   obligations — manhattan/paris/neoTokyo baselines must not move — which is why every new capability
   there shipped behind a `?live=1` flag and the default view never changed). Metropolis is a fresh
   project with NO baseline to preserve, so it can just boot beautiful.

   ARCHITECTURE: `createEngine()` = `createEngineCore()` (renderer/scene/camera-rig/sunRig/the full
   post pipeline) flat-merged with `createCityWorld()` (a DEFAULT procedural city + its cityLife/
   waterLife/weatherRig/clouds/collider, all driven every frame by `engine.updateWorld()`). Rather than
   hand-rolling the render pipeline from scratch, we take the proven hoard2 pattern (main.js's own
   header): boot the frozen engine, HIDE its default city (`engine.setUrbanVisible(false)` — this
   hides city.group/cityLife/waterLife/streetLights + the backdrop; it does NOT hide weatherRig/
   clouds/celestials, which is exactly "keeps the sky"), then compose OUR OWN city directly via
   `createCity()` + fresh `createCityLife()`/`createWaterLife()` instances sized to fit it, and REBUILD
   the engine's existing collider against our city's own solids rather than constructing a second one.

   COMPOSE-TABLE, what's reused vs fresh:
     REUSED AS-IS (engine.* already running, untouched by setUrbanVisible):
       engine.weatherRig, engine.clouds (setCloudsEnabled/setCloudAltitude), engine.water/planarRefl
       (the bay water plane + its reflection — WATER_SIZE=28 is a fixed constant, not tied to which
       city is shown), engine.collider (re-`rebuild()`ed against OUR city.state.solids), sunRig
       (celestials.js's ART sun/moon — engine-internal, driven by updateWorld).
     FRESH INSTANCES (tied to the default, now-hidden city — must be reconstructed for ours):
       createCity() (citygen.js), createCityLife() (agents.js — cars/peds on OUR streets),
       createWaterLife() (water-life.js — boats/gulls on the shared water plane).
     NEW LAYER, not part of createCityWorld at all (the owner's ruling: physics position + art
     appearance — see below):
       createCelestial/createTrueStars/createSolarSystem/createConstellations (the REAL astronomy
       stack) — sits ALONGSIDE the existing artistic sun/moon/sky, exactly as hoard2's own
       "ARC A21 — THE REAL SKY" block (src/world/index.js) already proved for its metropolis test map;
       this project follows that same, only-existing-precedent pattern.
     COMPOSED FRESH, no existing reusable pattern (confirmed via a full-repo grep before writing):
       "drive" — pilot.js's createPilotController/createGroundModel/ATV_PROFILE is a complete, proven
       possession system, but agents.js's street cars carry no `.pilot` descriptor (not possessable
       today). We reuse pilot.js wholesale for a simple player car (chase cam, collision push-out) —
       genuinely new wiring, not a rebuild of anything that exists.
     DEFERRED to the next arc (SCOPE — depth over breadth): scene-transition.js (dive-to-office),
     capture.js (reels), beaches/palms/parks/whales.
   ============================================================ */
import {
  THREE, createEngine, CAM, createAppShell, readAppFlags,
  createCity, makePalm, PROFILES, LAYOUT, tintTower, mulberry32, lowSunWashK,
  createCityLife, buildGraph,
  createWaterLife,
  createWeatherRig,
  createFirstPersonWalker,
  createPilotController, createGroundModel, createRoadModel, ATV_PROFILE, ROAD_PROFILE, CRAFT_PROFILE, BOAT_PROFILE, BIRD_PROFILE,
  FISH_PROFILE, GRAPPLE_PROFILE,
  carryMomentum,
  createTextureForge, forgeCityMaterials, CITY_LOOKS,
  createCelestial, createTrueStars, createSolarSystem, createConstellations,
  createDiveController, createTouchControls, createPedestrians,
  resolveAimPoint, createAimReticle, createPointerLockAim, applyLook,
} from '@lgr/engine-core';
import { createOffice } from '@lgr/office';   // A-DIVE: the proven office interior (city/main.js's own dive target)
import survivorUrl from '@lgr/engine-core/assets/models/survivor.glb?url';   // A-PEDS: the consumer pays for the model, not every lib user

/* ---------- flags ---------- */
const app = readAppFlags(window.location.search);
const seed = (app.q.get('seed') ? Number(app.q.get('seed')) : 0) || 1337;
const profileIndex = (() => { const p = app.q.get('profile'); const i = PROFILES.findIndex((x) => x.key === p); return i >= 0 ? i : 0; })();
window.__seed = seed;

/* ---------- engine boot ----------
   DECIDE-FRESH #1 — boot straight to BEAUTY, no AUTO tier ladder (createEngineCore's own
   `_computeStyle()` never returns beauty for mode 3/AUTO — projects/city inherits that ladder and
   nothing reaches beauty by default; we simply never enter it: setPostMode(2) below, once, at boot). */
const container = document.getElementById('app') || document.body;
/* MOBILE TIER (2026-08-06 — the owner's report: "broken on mobile"). Two INDEPENDENT breaks, both
   real, both documented elsewhere in this repo and neither handled here until now:
   1. THE BLACK SCREEN. metropolis boots setPostMode(2) = BEAUTY unconditionally. hoard2's ARC
      A5-BLACK recorded, from the owner's own iPhone, that the beauty path blacks that device: iOS
      is missing OES_texture_half_float_linear, so the HDR half-float render targets AND the PMREM
      env map cannot be linear-filtered — silently, with ZERO GL errors, which is why a proxy on a
      Mac never reproduces it. The cure it landed was "on mobile take the DIRECT path, no beauty
      RTs"; metropolis is the project that never inherited it. Mode 3 (the stylized ladder) is that
      path — beauty is `mode === 1 || mode === 2` in createCityWorld.
   2. NO WAY TO MOVE. The input is WASD + pointer-drag. A phone has no W key, so every mode —
      fly, walk, drive — was immovable. Fixed by createTouchControls (lifted to engine-core in this
      same commit; touch had been built five times in projects and never once in the core).
   Keyed off a coarse pointer like hoard2, with ?mobile=1/0 to force either way for testing. */
const _coarse = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
const _mobileParam = app.q.get('mobile');
const MOBILE = _mobileParam === '1' || (_mobileParam !== '0' && !!_coarse);
window.__mobile = MOBILE;
const engine = createEngine({
  demo: app.demo, citySeed: seed, profileIndex, container, shadowType: 'soft', shadowMapSize: MOBILE ? 1024 : 2048,
  // Volumetric clouds, UNCONDITIONAL (2026-08-05): the whole point of metropolis is "the city with
  // everything we built since" — city/main.js gates these behind ?live=1 and that gate is exactly how
  // the owner ended up looking at a bare city for days. coverage 0.5 = city's proven LIVE default.
  // Mobile sheds the raymarched deck entirely (it is a per-pixel march over a half-float target).
  volumetricClouds: MOBILE ? null : { coverage: 0.5 },
  // A-SKYDOME (2026-08-05): the Live Sky physically-based sky — real ozone twilight, the sunrise
  // wavefront, physical night. The backdrop plane never draws on this path at any hour.
  // The Hillaire sky is RGBA8-LUT by construction (its whole Stage-3 point was the iPhone), so it is
  // safe on mobile and stays on — the sky is not what breaks the phone.
  skyModel: 'hillaire',
});
const { renderer, scene, rig, sunRig } = engine;
const shell = createAppShell(engine, { name: 'metropolis', flags: app });

engine.setUrbanVisible(false);   // hide the DEFAULT city (+ its cityLife/waterLife/streetLights) — we build our own
/* THE CANYON FIX (art pass, 2026-08-06 — measured root cause): metropolis rendered with NO hemisphere
   fill AT ALL. The engine re-parents only the KEY out of its city group (createCityWorld:894-895);
   the fill stays inside city.group, and three's projectObject() early-returns on a hidden group
   BEFORE its isLight branch — so setUrbanVisible(false) above silently deleted the fill from the
   render state while the engine kept DRIVING it every frame (:1033, noon value 0.406). Net ambient
   on a shadowed facade was scene.environment 0.047 × envMapIntensity 0.3 = 0.014 — facades measured
   rgb(0,0,2) at noon, and the brightest thing at eye level was an unlit road stripe. Re-parenting to
   the scene restores the already-authored, already-keyframed fill: ~+100% on shadow faces, only ~9%
   on sunlit ones (key 4.6 dominates there), so the approved aerial survives. Project-local — the old
   city never calls setUrbanVisible and is untouched. */
engine.city.group.remove(engine.city.fill);
scene.add(engine.city.fill);
engine.setWaterEnabled(true);    // KEEP the bay water + its planar reflection — this IS our ocean
/* DECIDE-FRESH #1 — beauty immediately on desktop. MOBILE takes mode 8 = PINNED TOON, not the mode-3
   AUTO ladder: the ladder derives its tier from camera DISTANCE (rig.styleT), so the pulled-back phone
   framing dropped it into the gameboy/pixel tier and served a green monochrome dither instead of a
   city (caught on the WebKit lane — the exact class of thing a desktop-only check never sees). Toon is
   a lit, readable, cel-shaded city that uses NO half-float render target, which is the A5-BLACK
   constraint: iOS silently cannot linear-filter half-float, and beauty's HDR targets need exactly that. */
engine.setPostMode(MOBILE ? 8 : 2);
engine.setChromaScale(0.3);      // hoard2's own validated CA fix (Arc A-BEAUTY ported it to city too)
engine.setCloudsEnabled?.(true);
engine.setCloudAltitude?.(1.6);  // defect-3: lift the sprite band (hiY 4.0-6.8 → 6.4-10.9) clear of the tallest towers (~5.2 wu) — no more smoke rolling through the skyline, and no sprites projecting onto the ground from aerial views
engine.setEnvSegments?.(16);
engine.setDayFillBoost?.(1.9);
engine.setStylizedSea?.(true);   // A-SEA: metro's stylized tiers (the whole mobile experience) read as SEA, not sepia-refraction   // look-bible shadow floor: shaded plaster reaches the 35-40%-of-sunlit band (measured; the fill drive lives inside the render, so this is an engine seam, not a frame write)
/* Bible §4: the "seabed" under the bay is literally the LGR BUSINESS CARD (gold grid + logotype on
   brown, unlit) — showcase content that reads as a tan glow through metropolis's water. Here it
   becomes a plain sandy seabed; the new depth-tint shallows show sand through teal, as the bible
   asks. Project-local — the showcase keeps its card. */
engine.card.material.map = null;
engine.setSeabedTint?.('#5c6b66');   // NOT card.material.color.set — createCityWorld rewrites that colour EVERY frame (it forced white on stylized tiers, which is what made the bay's near band read white on mobile)
/* A-FISH (2026-08-07) — the two engine calls that make a water column real for this city.
   1. setSeabedCard(false): the legacy "seabed" is an OPAQUE full-bay plane at y = -0.35 (the demo
      business card). citygen's new `seabed` option builds a REAL floor sloping from -0.59 at the
      shore to -1.8 offshore, which is BELOW that card — so leaving the card on would hide the new
      geometry and, because the refraction grab renders it, swallow the fish the moment it swam past
      -0.35. Note this supersedes the setSeabedTint line above for this project; the tint is left in
      place so a consumer that re-enables the card still gets the corrected colour.
   2. setUnderwater(...): the submerged atmosphere. Keyed to the CAMERA's height inside the engine's
      own per-frame fog writer — the only place it CAN live, since that writer stomps any fog a
      project sets from its frame callback (two prior bugs in this file's history say so). */
engine.setSeabedCard?.(false);
/* Values picked by SWEEPING four combinations in a headed browser and looking, not by taste: the
   first pass (#0f4f63 / 0.50) rendered a midnight-dark column at high noon. A brighter, less dense
   water reads as lit coastal sea and keeps the fish legible against it. A day-fill lift was also
   tried and DROPPED — it changed the picture so little that it did not justify moving a global that
   the whole above-water city shares. */
engine.setUnderwater?.({ color: '#1f8fa6', density: 0.34, y: 0, blend: 0.3 });
/* MOBILE SEA (2026-08-06): on the toon tier the stylized water path's GOLD fresnel sheen + white
   spec quantize to a WHITE bay (proven pre-existing by A/B — seabed colour had zero influence).
   Mobile PINS toon, so retint the stylized layer's own uniforms to sea tones here: uInk (the flat
   absorb tint) to the beauty deep-sea blue, uGold (sheen + crest glints) to a cool slate. Beauty
   never runs on mobile, so the approved desktop golden-hour glints are untouched; the old city's
   toon baseline is untouched too (this is a metro-local uniform write, not a shader change). */
if (MOBILE) {
  engine.waterMaterial.uniforms.uInk.value.set('#1B4A66');
  engine.waterMaterial.uniforms.uGold.value.set('#4d6b7a');
  /* …and the white DIAMOND beyond it: the sea plate is a fixed 28x28, and the phone framing
     (distance 46) sees far past its rim — everything beyond rendered as fogged void. Scale the
     plate 3x on mobile so water meets the horizon; the ripple sim stretches into a broad swell,
     which reads fine on the toon tier (beauty's foam/reflection paths never run here). */
  engine.water.scale.set(2, 1, 2);   // 2x: at 3x the far plate climbed too high in the portrait frame
  /* …and the last white: the NEAR water refracts the VOID beneath the plate (the grab pass has
     nothing to sample under the camera), and the stylized path is 88% refraction. An opaque deep-sea
     FLOOR under the whole scaled plate gives the refraction something honest to return. */
  const seaFloor = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), new THREE.MeshBasicMaterial({ color: '#123a52', fog: true }));
  seaFloor.rotation.x = -Math.PI / 2;
  seaFloor.position.y = -0.75;
  seaFloor.raycast = () => {};
  scene.add(seaFloor);
}
/* …a MUTED BLUE-GREY sand, not literal sand (#8f7f5e was the first try). The stylized tiers keep the
   old flat 12% absorb, so the seabed is ~88% of their water colour — literal sand rendered the whole
   bay WHITE on the toon tier, which only the phone lane showed. This tone reads as wet sand under
   beauty's teal depth-tint AND as sea under toon. */     // A-SKY prelude: the IBL env tracks the sun in ~1.5h steps instead of 4 quarter-day buckets whose boundaries SNAP at the horizon crossings — the ability hoard2 already opts into for its smooth dusk (createCityWorld A6-0a); metro scrubs time constantly, so it needs it most

/* ---------- OUR city (fresh createCity(), sized/profiled independently of the hidden default) ---------- */
const profile = PROFILES[profileIndex];

/* ---------- MOBILE-SAFE REAL SURFACES (DECIDE-FRESH #4 — no half-float RT, no new required extension) ----------
   createTextureForge's own `supported` flag is the SAME iOS-p0-highp-fragment probe city/hoard2 already
   gate on; forgeCityMaterials falls back to each recipe's flat colour when unsupported, so a phone that
   can't bake never regresses. Baked ONCE at boot (no mid-play compiles), BEFORE createCity() so citygen's
   own `forgeMaterials` constructor option (city/main.js's own proven pattern) can wire it in directly —
   walls/roofs/roads get real baked PBR (bump/roughness/AO), not the flat per-building tint alone. */
const forge = createTextureForge({ renderer });
const cityMats = forge.supported ? forgeCityMaterials(forge, { look: 'warm' }) : null;
const forgeMaterials = cityMats ? {
  wall: cityMats[(CITY_LOOKS.warm && CITY_LOOKS.warm.wallSurface) || 'facade'],
  roof: cityMats.roof, road: cityMats.asphalt, concrete: cityMats.concrete,
} : null;

/* lights: false — THE FLAT-NOON / DAYLIGHT-MIDNIGHT-ISLAND FIX (2026-08-05, headed-browser A/B proven).
   createCity() ships a constructor key (3.0, warm, unshadowed) + hemi fill (1.0) expecting its consumer
   to drive them each frame (citygen.js's own comment). The engine drives only ITS hidden city's pair —
   ours sat frozen at noon values 24/7: at noon it double-keyed the scene flat (engine key 4.6 + static
   3.0 + fill 1.0 vs the intended 0.41), at midnight it kept the island/parks daylight-green. The scene
   already carries the engine's sunRig-driven, shadow-casting key — our city simply inherits it. */
/* windowGlow is a SHARED {value} BOX, not a number (2026-08-05, defect-2 follow-on): vector-style.js:192
   binds the object straight in as the uWindowGlow uniform, and createCityWorld drives its own box each
   frame (:328/:1103). Passing `sunRig.windowGlow` (a snapshot NUMBER) meant no window ever glowed at
   night. Same wiring-drift class as the lights — the contract lives in the engine's own consumer. */
const windowGlow = { value: sunRig.windowGlow };
const city = createCity({
  seed, profileIndex, windowGlow, forgeMaterials, lights: false,
  beach: {},                          // A-SHORE: the sand terrace ring (engine defaults)
  seabed: {},                         // A-FISH: a real water column — the floor drops away from the shore (engine defaults)
  // (the matching engine calls — hide the legacy seabed CARD, arm the underwater look — are just below
  //  the engine handle, since they live on createCityWorld rather than on citygen)
  // A-STREET (bible S6): storefpront glazing + awnings + kerbs + crosswalks. Desktop-first: ~600 extra
  // draws; the phone tier ships without until profiled on a real device (honest cap, not silent).
  streetDetail: MOBILE ? null : {},
});
scene.add(city.group);

/* KNOWN ENGINE GAP (found + confirmed in Arc A-BLACK, not fixed there): citygen.js's addBuilding()/crown
   call vectorizeTower() with a per-building tint, but that tint only feeds `uVecColor` (the flat-vector
   tier's uniform) — it never calls `.color.set()`, so every tower's `material.color` (what the BEAUTY/
   LIT tier actually reads) stays the THREE.js default white, even with forgeMaterials wired above (the
   forge supplies texture MAPS; material.color is a separate multiply that stays unset either way).
   Fixing citygen.js itself is a SHARED-module change that also repaints projects/city's `toon` tier (toon
   is a post-process over the same lit source beauty starts from) and would need an explicit, reviewed
   tier-guard rebaseline there — out of scope for THIS project to decide unilaterally. Metropolis has no
   such baseline, so it's safe to apply the same fix LOCALLY, here, without touching the shared source
   file. Not a rebuild of vectorizeTower/tintTower — both are reused verbatim; this is the one line
   citygen.js is missing, applied post-construction. */
/* THE LOOK-BIBLE PALETTE (art pass, 2026-08-06 — Fable-5's direction, verbatim targets):
   "A painted miniature harbor city… neutrals DOMINATE; saturation becomes an event, not wallpaper."
   Eight families in three tiers — 60% dominant neutrals, 30% secondary warms, 10% accents (never
   two accents adjacent is approximated by the 10% rate at this block count). Variation is VALUE
   (±8%) and HUE (±6°), with saturation CLAMPED at 0.55 — the old path (manhattan primaries through
   tintTower) darkened value 8-22% while RAISING saturation up to +18%, which is exactly the
   max-saturation-Lego read the bible bans. This tint is also the canyon's other half: the navy-
   family towers had ~0.07 effective albedo, so no fill intensity could make their shadow faces
   read — cream/plaster walls reflect ~5x more of the same light. */
const PALETTE = {
  dominant: ['#D9C9A8', '#9C948A'],               // limestone cream · warm plaster grey (60%)
  secondary: ['#B5533C', '#C98A4B', '#C9A84C'],   // brick red · terracotta · ochre (30%)
  accent: ['#5B7A99', '#4E8C82', '#7E3B34'],      // slate blue · verdigris teal · oxblood (10%)
};
const _tintRng = mulberry32(seed ^ 0x6d);
const _hsl = { h: 0, s: 0, l: 0 };
const _paletteTint = () => {
  const r = _tintRng();
  const tier = r < 0.6 ? PALETTE.dominant : r < 0.9 ? PALETTE.secondary : PALETTE.accent;
  const c = new THREE.Color(tier[Math.floor(_tintRng() * tier.length)]);
  c.getHSL(_hsl);
  _hsl.h = (_hsl.h + (_tintRng() - 0.5) * (12 / 360) + 1) % 1;        // hue ±6°
  _hsl.l = Math.min(0.92, Math.max(0.08, _hsl.l * (0.92 + _tintRng() * 0.16)));  // value ±8%
  _hsl.s = Math.min(0.55, _hsl.s);                                     // saturation is an event, capped
  return c.setHSL(_hsl.h, _hsl.s, _hsl.l);
};
city.group.traverse((o) => {
  if (o.isMesh && o.material && typeof o.material.customProgramCacheKey === 'function' && o.material.customProgramCacheKey() === 'lgr-vec-tower') {
    o.material.color.copy(_paletteTint());
  }
  // Bible: "the lawn ring drops from neon green to sage #6FA05A" — the island's own material carries
  // the neon; retint it in place (userData.groundKind tags it — the A21 metadata seam, used as intended).
  if (o.isMesh && o.userData && o.userData.groundKind === 'island' && o.material && o.material.color) {
    o.material.color.set('#6FA05A');
  }
});

/* ---------- diorama base: dark skirt + lit seawall rim (defect-3, Fable-5's night direction) ----------
   The island extrude wraps its bright park-green over the flank, so from any low angle the city read
   as "daylight material spilling over the edge" of a floating slab. The art direction: make the edge
   DELIBERATE — dark basalt sides + a thin continuous warm seawall line where the perimeter meets the
   drop ("a designed model base; the perimeter streetlamps become its jewelry"). We reuse the island's
   OWN coastline polygon (city.state.coast — same seed, same outline) so the skirt hugs the real shore:
   same extrude+rotation as citygen's island, scaled 1.2% in the footprint to shell OVER the green
   flank without z-fighting. Content composition, not a new ability → project-local by design; if a
   second project wants it, lift a `flank`/`seawall` option into citygen (noted in HANDOFF). */
{
  const coastShape = new THREE.Shape();
  city.state.coast.points.forEach((p, i) => (i ? coastShape.lineTo(p.x, p.y) : coastShape.moveTo(p.x, p.y)));
  coastShape.closePath();
  const skirt = new THREE.Mesh(
    new THREE.ExtrudeGeometry(coastShape, { depth: 2, bevelEnabled: false, steps: 1 }),
    new THREE.MeshStandardMaterial({ color: '#14100d', roughness: 0.95, flatShading: true, side: THREE.DoubleSide }),
  );
  skirt.rotation.x = -Math.PI / 2;
  skirt.scale.set(1.012, 1.012, 1);
  skirt.position.y = LAYOUT.PLINTH_TOP - 0.06 - 2;   // top sits a sliver below the cap — grass overhangs a dark cliff
  skirt.raycast = () => {};
  scene.add(skirt);
  const rimGeo = new THREE.BufferGeometry().setFromPoints(city.state.coast.points.map((p) => new THREE.Vector3(p.x, p.y, 0)));
  const rim = new THREE.LineLoop(rimGeo, new THREE.LineBasicMaterial({ color: '#c98a4a' }));
  rim.rotation.x = -Math.PI / 2;
  rim.scale.set(1.013, 1.013, 1);
  rim.position.y = LAYOUT.PLINTH_TOP - 0.055;        // the seawall line, right at the top of the dark skirt
  rim.raycast = () => {};
  scene.add(rim);

  /* A-SHORE: PALMS along the beach terrace. The ABILITY (makePalm) is engine-core's; the PLACEMENT
     is ours — palms ring the coast at the beach's mid-band, deterministic from the city seed, with
     organic gaps so it reads planted-by-wind, not stamped. Shape→world mapping is the island's own
     transform: (p.x, p.y) → (p.x·s, y, -p.y·s). */
  const palmRand = mulberry32(seed ^ 0x5a1);
  const PALM_S = 1.032;                              // between the grass edge (1.0) and the beach rim (1.055)
  const coastPts = city.state.coast.points;
  for (let i = 0; i < coastPts.length; i += 3) {
    if (palmRand() < 0.4) continue;                  // gaps
    const p = coastPts[i];
    const palm = makePalm({ rand: palmRand, h: 0.5 + palmRand() * 0.28, lean: 0.12 + palmRand() * 0.1 });
    palm.position.set(p.x * PALM_S, 0.12, -p.y * PALM_S);
    palm.rotation.y = palmRand() * Math.PI * 2;      // lean direction varies around the ring
    scene.add(palm);
  }
}

/* ---------- collider — REUSE the engine's own instance, rebuilt against OUR city's solids ---------- */
engine.collider.rebuild(city.state.solids);

/* ---------- agents (cars + pedestrians on OUR streets) + water-life (boats/gulls on the shared bay) ----------
   Fresh instances (Compose-table): the engine's own cityLife/waterLife are tied to the hidden default
   city and stay hidden with it. `extent`/`waterSize` match OUR city + the engine's fixed WATER_SIZE. */
const cityLife = createCityLife({ plinthTop: LAYOUT.PLINTH_TOP, extent: city.extent, profile: profile.key, carCount: 14, pedCount: 16 });

/* A-PEDS (bible §6 item 4): skinned humans strolling the block perimeters — the engine ability
   composing createCharacterRig + the promoted survivor.glb. Desktop 24 walkers; phone 10 (each is
   a live skinned rig; hoard2's own mobile budget is the precedent). */
const pedestrians = createPedestrians({
  scene, blocks: city.state.blocks, blockSize: LAYOUT.BLOCK,
  count: MOBILE ? 10 : 24, seed: seed ^ 0x9e3, url: survivorUrl,
});
window.__pedestrians = pedestrians;
scene.add(cityLife.group);
const waterLife = createWaterLife({ extent: city.extent, waterSize: engine.WATER_SIZE, plinthTop: LAYOUT.PLINTH_TOP, boatCount: 5, gullCount: 5 });
scene.add(waterLife.group);
engine.simMaterial.uniforms.uWakeDrops.value = waterLife.wakeDrops;   // bind ONCE, by reference (compose-table gotcha) — the SIM material (offscreen wave pass), not the visible waterMaterial

/* ---------- weather — REUSE the engine's own weatherRig (untouched by setUrbanVisible) ----------
   Rebind its rain-drop array into OUR water sim material (the engine's own internal binding still
   targets its own simMaterial instance the same way; both point at the same uniforms object here
   since we share engine.waterMaterial — a fresh createWeatherRig would double the rain groups, so we
   reuse engine.weatherRig exactly as the compose-table's REUSED list intends). */
const weatherRig = engine.weatherRig;

/* ---------- DECIDE-FRESH #3 — THE SKY IS BOTH: physics drives POSITION, art drives APPEARANCE ----------
   sunRig/celestials (engine-internal, driven every frame by updateWorld) stay the ARTISTIC sky — palette,
   atmosphere, exposure, grade are all art-directed and untouched. ALONGSIDE it (not replacing it) we add
   the REAL astronomy stack, exactly as hoard2's own "ARC A21 — THE REAL SKY" already proved for its own
   metropolis test map (src/world/index.js) — the only existing precedent for this stack in the repo. */
const CITY_LATLON = { latDeg: 40.7128, lonDeg: -74.0060 };   // NYC — matches the Manhattan-profile default
const celestial = createCelestial({ latitudeDeg: CITY_LATLON.latDeg });
const trueStars = createTrueStars({ celestial });
const solarSystem = createSolarSystem({ celestial });
const constellations = createConstellations();
scene.add(trueStars.group, solarSystem.group, constellations.group);
let realSkyResolved = false;
let realSkyOn = false;
Promise.all([trueStars.ready, constellations.ready]).then(() => {
  constellations.resolve(trueStars.hrToIndex);
  realSkyResolved = true;
  trueStars.setVisible(realSkyOn); solarSystem.setVisible(realSkyOn);
});
let realDate = new Date();

/* ---------- collision-stopped walking (createFirstPersonWalker + the groundY hook + the shared collider) ---------- */
/* ---------- BODY SCALE (A-FEEL, 2026-08-05) — the city's own content sets the anchor ----------
   Three independent audits converged: the CITY is coherent at 1 world unit ≈ 6 m (its AI car is
   0.74u ≈ a 4.5 m car — agents.js:153; its pedestrians are 0.18u; traffic runs 0.78-0.98 u/s ≈
   17-21 km/h), while the WALKER and PLAYER CAR were authored as if 1u ≈ 1-2 m. That mismatch —
   not any tuning value — is why walking and driving "aren't quite there": the walker was a GIANT
   (eye 2.2u = 10.6x the city's own pedestrians, 2.6x a whole car length) crossing a full city
   block every 0.45 s, out-running every car in the city by 5x.
   Fixed by scaling the BODY to the city (cheap, no shared-module change, no baseline touched) —
   NOT by scaling the city up (that path is real, hoard2 does it at CITY_SCALE 3.4, but it would
   desync metropolis's collider/coast/life/shadow wiring; recorded as the better end state if the
   city is ever rebuilt). Numbers derived from the car anchor + hoard2's PROVEN feel ratios
   (2.11 eye-heights/sec walking, 3.66 sprinting). */
const EYE = 0.28;                    // 1.70 m at 6.08 m/unit — just above the AI car's 0.26 roofline: you look OVER a car, not down at it
/* NEAR PLANE — at a 0.09 body radius the walker's own shoulder sits INSIDE the rig's default 0.1 near
   plane, so pressing against a wall would clip through it. (It never bit before only because the old
   0.30 radius happened to exceed 0.1.) 0.02 clears the new body with margin; the city's far plane is
   100, so the depth ratio stays well inside precision comfort. */
rig.camera.near = 0.02; rig.camera.updateProjectionMatrix();
let walkGroundY = LAYOUT.PLINTH_TOP;   // A-ROOF: the ground accepted last frame (see groundY below)
const walker = createFirstPersonWalker({
  // eyeHeight (NOT eyeY): with a groundY hook, eyeY is an ABSOLUTE height and PLINTH_TOP got added
  // TWICE (0.3 + (0.3 + 1.6) = 2.2 measured). eyeHeight is the above-ground knob the hook expects.
  eyeHeight: EYE,
  moveSpeed: 0.55,                   // 2.0 eye-heights/s — hoard2's proven walk feel, scale-transferred (3.4 m/s)
  sprintSpeed: 0.95,                 // was never passed at all: the default 5.0 vs moveSpeed 4.2 made shift a +19% no-op
  accel: 14,                         // accel is a RATE (1/s) in the walker's exp() integrator — scale-invariant, so match hoard2 exactly
  radius: 0.09,                      // body 0.18 wide in a 0.79 face-to-face street: 23% of the corridor (was 81% — you shouldered both walls)
  arenaRadius: city.extent + 0.8,
  /* A-SHORE: the ground is no longer one height — the walker STEPS DOWN from the grass (PLINTH_TOP)
     onto the sand terrace (0.12) using the city's own isLand() coast polygon; the tighter arena
     (was extent+6!) stops the old walk-on-open-water-at-plinth-height behavior at the beach rim. */
  /* A-ROOF: the walker can now stand on BUILDINGS, not just the street. groundY(x,z) has no height
     argument by design, so on its own it cannot tell "standing on this roof" from "standing in the
     street beside this tower" — ask for the highest solid and you teleport onto the skyline the
     moment you touch a wall. `walkGroundY` is the missing third coordinate: the ground we accepted
     last frame, used as the CEILING of the query, so a roof is reachable only if it is within a
     step of where you already are. Arrive by swinging, land on the roof, and you can walk it.
     KNOWN v1 LIMIT, stated rather than hidden: walking off a roof edge steps you DOWN to the street
     rather than dropping you — the walker has no fall model, and giving it one is its own arc. */
  groundY: (x, z) => {
    const base = city.isLand(x, z) ? LAYOUT.PLINTH_TOP : 0.12;
    const roof = engine.collider.surfaceAt ? engine.collider.surfaceAt(x, z, walkGroundY + 0.35, 0.12) : -Infinity;
    return roof > base ? roof : base;
  },
  // the collider radius must AGREE with the body radius above (they were 0.30 vs 0.32 before)
  resolveSpatial: (state, dt) => engine.collider.resolveSphere(state, dt, { r: 0.09, yOff: 0.14, PUSH_MAX: 6, SLIDE_FRICTION: 0.85, SKIN: 0.02 }),
});
walker.setPosition(0, -(city.extent * 0.55));

/* ---------- drivable car — genuinely new composition (pilot.js has no city-street-graph model; see header) ---------- */
const graph = buildGraph();
// A-FEEL: sized against the city's OWN traffic (agents.js:153 = 0.34 x 0.26 x 0.74) — a hair larger
// so the hero car reads as yours. It was 0.9 x 1.9: WIDER than the 0.89u street corridor and exactly
// one block long. No steering model can corner a car that does not fit between the buildings.
const carGeo = new THREE.BoxGeometry(0.38, 0.30, 0.82);
const carMat = new THREE.MeshStandardMaterial({ color: '#c6432f', roughness: 0.4, metalness: 0.2 });
const playerCar = new THREE.Mesh(carGeo, carMat);
playerCar.position.set(graph.nodes[graph.mid]?.x || 0, graph.y + 0.25, (graph.nodes[graph.mid]?.z || 0) + 3);
scene.add(playerCar);
const carState = { x: playerCar.position.x, y: playerCar.position.y, z: playerCar.position.z, yaw: 0, speed: 0, vy: 0, quat: new THREE.Quaternion() };
/* A-FEEL car profile. Measured first (Rule 15): the real steady-state yaw is 2.6 rad/s, matching
   turnRate — an earlier 0.977 reading was a ramp artifact (1s sample across a 0.18s steer attack,
   plus rotation.y euler-flipping at speed). So turn radius was 9.0/2.6 = 3.46u against a 0.89u
   street corridor: 3.9x too wide to make a corner, which is why driving felt wrong.
   maxSpeed 2.4 = ~2.6x the city's own traffic (0.78-0.98 u/s) — fast against the world it drives in,
   where 9 u/s was 10x traffic and faster than sound at this scale. chaseDist 1.9 ≈ 2.3 car lengths
   (6.5 was 8.8 car-lengths = 2.65 city blocks behind you). The ROAD model below supplies the
   curvature-limited steering; turnRate stays as the model's low-speed lock rate. */
const CAR_PROFILE = { ...ROAD_PROFILE, maxSpeed: 2.4, accel: 6.0, drag: 6.0, chaseDist: 1.9, chaseElev: 0.38 };
const pilotWorld = {
  // A-FEEL: a REAL ground sampler — the same isLand() coast seam the walker uses. Was a constant
  // graph.y, so the car floated at street height straight out over the ocean.
  /* A-FISH: at sea the floor is now the SEABED, not the beach cap. The old 0.12 was the beach TOP
     reused as the floor everywhere offshore — i.e. above the y=0 waterline, which is why the heli
     "landed" on the sea and medium never became 'water'. `?? 0.12` keeps the old behaviour for any
     city built without the seabed option. */
  heightAt: (x, z) => (city.isLand(x, z) ? graph.y : (city.seabedAt(x, z) ?? 0.12)),
  waterHeightAt: (x, z) => (engine.waterHeightAt ? engine.waterHeightAt(x, z) : 0),   // A-BOAT: the hull damps onto the live swell
  collide: (state, dt, cfg) => engine.collider.resolveSphere(state, dt, cfg),
  collideActive: () => engine.collider.active(),
  segmentHit: (ox, oy, oz, ex, ey, ez, r) => engine.collider.segmentHit(ox, oy, oz, ex, ey, ez, r),
  surfaceAt: (x, z, yMax, r) => engine.collider.surfaceAt(x, z, yMax, r),   // A-ROOF: what am I standing on
};
const pilotCtl = createPilotController({ rig, world: pilotWorld });
const carPilotable = {
  pilot: {
    model: 'road', profile: CAR_PROFILE, controlHints: 'W/S throttle · A/D steer',
    getWorldPos: (out) => out.copy(playerCar.position),
    getTransform: () => carState,
    setTransform: (s) => { playerCar.position.set(s.x, s.y + 0.15, s.z); playerCar.quaternion.copy(s.quat); },   // +rideHeight: the box sits ON the road, not half-sunk in it
    suspendAutonomy: () => {}, resumeAutonomy: () => {},
    setBodyVisible: (v) => { playerCar.visible = v; },
  },
};

/* ---------- THE HELICOPTER (A-HELI, 2026-08-06) — wiring an ORPHAN, not building a craft ----------
   The capability index flagged createSpacecraftModel as ORPHANED: "exists but NOTHING uses it". It is
   pilot.js's own "all-medium master rule-breaker — one craft that flows AIR <-> WATER <-> GROUND"
   (pilot.js:139), written for exactly this and never wired anywhere. Everything below is composition:
     • placed-life already HAS a 'heli' kind — rotor mesh, idle nose-hold, a cockpit, CRAFT_PROFILE.
     • createCityWorld.spawnSeizeCraft() already spawns one and reparents it OUT of the placed-life
       pool into seizeGroup — which setUrbanVisible(false) does not touch, so it survives metropolis
       hiding the default city (URBAN() is city/cityLife/waterLife/streetLights only).
     • createPilotController dispatches on the model registry; 'spacecraft' is already an entry.
   Spawned at BOOT so a heli hovers over the skyline in the default view (it reads as a living city
   and advertises the verb), seized on demand. It occupies the engine's single seize slot; the player
   car is a bespoke mesh, so the two never contend. */
/* SCALE, the A-FEEL lesson applied to the air: CRAFT_PROFILE + the medium table were authored for the
   original ~26-unit world. Measured on the first flight here: 27.5 units travelled in 2 s across an
   island only ~15 units wide — you leave the city before you can look at it. mediumScale 0.30 puts
   air cruise at 2.4 u/s (≈ the car's top speed, right for a low-flying sightseeing heli: the island
   crosses in ~6 s, not 2). chaseDist 9.5 -> 2.6 for the same reason the car's went 6.5 -> 1.9. */
const HELI_PROFILE = { ...CRAFT_PROFILE, mediumScale: 0.30, chaseDist: 2.6, chaseElev: 0.34 };
/* A-BOAT: take the helm of one of waterLife's OWN wake-carving boats — no second boat system.
   waterLife already publishes them as followables, and A-BOAT gave each a `.pilot` descriptor in
   engine-core, so this is a lookup, not a spawn. The pilotWorld below already supplies the water
   sampler the boat model rides (engine.waterHeightAt via createCityWorld's own injection). */
/* The engine ships a water-sampler INJECTION seam (setPilotWaterSampler) precisely so a project can
   say where its own sea is; metropolis never used it, so waterHeightAt returned NO_WATER everywhere
   and the boat model's fallback was silently doing the work. Inject the real answer: off the coast
   polygon is open bay at the water plane (y=0); on land there is no water.
   HONEST LIMIT: this is the MEAN water plane, not the live wave surface. The swell is a GPU
   heightfield (the sim texture) and sampling it per frame on the CPU means a readPixels stall —
   deliberately not paid. So the hull sits flat on the bay and does not bob with the ripples. */
engine.setPilotWaterSampler?.((x, z) => (city.isLand(x, z) ? null : 0));

/* A-FISH: pick the BIGGEST pilotable fish, not the first. The breachers run 0.16–0.20 (plus a 0.62
   whale); the largest is 0.40 u nose-to-tail and even that is barely half an AI car, so every bit of
   body helps it read on screen. `size` is published on the followable for exactly this. The whale is
   pilotable too — it carries the same descriptor — but `fish` mode deliberately takes a fish. */
const fishPilotable = () => (waterLife.getFollowables?.() || [])
  .filter((f) => f.pilot && f.pilot.model === 'fish' && f.label !== 'whale')
  .sort((a, b) => (b.size || 0) - (a.size || 0))[0] || null;
/* ---------- A-CROSSING (2026-08-07): THE PLUNGE — stop being the gull, start being the fish ----------
   The moment the six bodies were built for. A plunge-diving seabird hits the water and keeps going, and
   this is the one body change in the set where the player's position does NOT move — which, measured, is
   exactly why it is the smoothest switch available: every OTHER mode switch jumps the camera 3-9 u in a
   frame simply because the two bodies are metres apart, and this one jumps by nothing.

   THREE DESIGN CONSTRAINTS, each from a review that refuted an earlier version of this:
   1. EXPLICIT, NOT AUTOMATIC. The first spec sniffed for proximity + a downward pitch. That trigger is
      unreachable — verified by driving it: createBirdModel's floor clamp pins a piloted gull at exactly
      y = 0.06 over the bay AND zeroes a negative pitch in the same statement, so by the frame you could
      test "is it diving" the evidence is already gone (measured: y 2.443 -> 1.513 -> 0.555 -> 0.06 -> 0.06).
      An automatic trigger would also fire on any gull merely skimming, one-way, with no way to refuse.
   2. EDGE-TRIGGERED. Bound to the PRESS of the dive key, not to holding it, so it fires once per press
      and cannot re-arm into a loop.
   3. THROUGH setMode(). setMode is the only path that keeps `mode`, the seven aria-pressed attributes
      and refreshHint() in agreement; possessing directly would leave the UI lying about what you are. */
function plunge() {
  if (mode !== 'bird') return false;
  const g = birdPilotable(), f = fishPilotable();
  if (!g || !f) return false;
  const t = g.pilot.getTransform();
  const wy = engine.waterHeightAt ? engine.waterHeightAt(t.x, t.z) : -999;
  if (wy <= -900) return false;                                  // not over open water — nothing to enter
  const skim = BIRD_PROFILE.skim ?? 0.06;                        // the gull's own floor offset above the surface
  if (t.y > wy + skim + 0.03) return false;                      // must actually BE at the water, not just over it
  /* speedScale 0.6: a stoop carries into the water but water is not air. y just under the surface and a
     nose-down pitch so the first thing you see as the fish is the plunge continuing, not a level swim. */
  carryMomentum(g, f, { speedScale: 0.6, y: wy - 0.14, pitch: -0.55 });
  setMode('fish');
  return true;
}

const birdPilotable = () => (waterLife.getFollowables?.() || []).find((f) => f.pilot && f.pilot.model === 'bird') || null;
const boatPilotable = () => (waterLife.getFollowables?.() || []).find((f) => f.pilot && f.pilot.model === 'boat') || null;
const HELI_HOVER = 3.2;                       // world units above the plinth — clears the tallest tower (~5.2 is the crown; this hovers over the bay side)
const heliCraft = engine.spawnSeizeCraft?.('heli', 3.2, -2.4, { hover: HELI_HOVER }) || null;

/* ---------- THE SWINGER (A-SWING, 2026-08-08) — wiring engine-core's grapple model ----------
   The ABILITY is createGrappleModel in engine-core (a generic grapple-swing: raycast an anchor on
   real geometry, hang a rope constraint off it, pump to add energy, release to launch). Everything
   here is COMPOSITION: a body to look at, a rope to see, and the descriptor that hands both to the
   shared possession seam. No physics lives in this file.

   THE ROPE IS NOT DECORATION. A swing with no visible line is unreadable — you cannot tell what you
   are attached to, so you cannot time a release, which is the entire skill of the mechanic. It is a
   2-vertex Line rewritten each frame from the body to state.anchor, hidden when nothing is attached. */
const swingBody = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.035, 0.075, 4, 8),
  new THREE.MeshStandardMaterial({ color: '#232733', roughness: 0.75, flatShading: true }),
);
swingBody.castShadow = true; swingBody.visible = false;
scene.add(swingBody);

const ropeGeo = new THREE.BufferGeometry();
ropeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));   // 2 verts, rewritten per frame
const rope = new THREE.Line(ropeGeo, new THREE.LineBasicMaterial({ color: '#f2f4f8' }));
rope.frustumCulled = false;      // its endpoints move every frame; a stale bounding sphere would pop it out
rope.visible = false;
scene.add(rope);

const swingState = { x: 2.0, y: 3.4, z: 2.0, yaw: 0, pitch: 0, bank: 0, speed: 0, quat: new THREE.Quaternion() };
/* A METROPOLIS-OWNED COPY of the profile, because `aimMode` is now a runtime TOGGLE (Q) and the model
   reads the profile object live. Mutating the exported GRAPPLE_PROFILE would reach into every other
   consumer of the engine — the same shared-default hazard CAR_PROFILE spreads ROAD_PROFILE to avoid. */
const SWING_PROFILE = { ...GRAPPLE_PROFILE };
const swingPilotable = {
  pilot: {
    model: 'grapple', profile: SWING_PROFILE,
    controlHints: 'hold SPACE (or the mouse) to shoot the web · A/D steer · W/S reel in/out · release to launch · Q for aimed webs',
    getWorldPos: (out) => out.set(swingState.x, swingState.y, swingState.z),
    getTransform: () => swingState,
    setTransform: (st) => {
      swingBody.position.set(st.x, st.y, st.z);
      swingBody.quaternion.copy(st.quat);
      /* Draw the line LAST, from the body to whatever the model attached to. `anchor` is null the
         instant the model releases or lands, so visibility follows the physics rather than a
         separate flag that could drift out of sync with it. */
      if (st.anchor) {
        const a = ropeGeo.attributes.position;
        a.setXYZ(0, st.x, st.y, st.z);
        a.setXYZ(1, st.anchor.x, st.anchor.y, st.anchor.z);
        a.needsUpdate = true;
        rope.visible = true;
      } else rope.visible = false;
    },
    suspendAutonomy: () => {}, resumeAutonomy: () => {},
    setBodyVisible: (v) => { swingBody.visible = v; if (!v) rope.visible = false; },
  },
};

/* ---------- A-AIM (2026-08-08) — YOU choose the anchor -------------------------------------------
   Everything here is COMPOSITION of three engine-core abilities (aim.js): a crosshair, pointer lock,
   and "what world point is under the crosshair". The rule the brief fixed and this wiring honours:
   THE MODEL DOES NOT OWN THE CAMERA. This file raycasts from the camera because this file is the one
   that knows there IS a camera; the model receives a world POINT and rules on whether it can reach it.

   WHY THE RAY STARTS AT THE EYE AND NOT AT THE BODY. The crosshair is a screen-space mark, so the only
   ray it can honestly stand for is the camera's own. Cast from the body instead and the two disagree
   by the parallax of a 1.9 u chase — you would aim at a window and web the wall beside it. The cost is
   that the first ~1.9 u of AIM_REACH is spent getting from the eye to the body, which is exactly why
   AIM_REACH is ropeMax plus the chase, not ropeMax.
   AND IT MUST OVERSHOOT ropeMax, not stop at it: "there is a building there but it is too far" is a
   DIFFERENT answer from "there is nothing there", and the dim crosshair is how the player is taught
   the difference. A ray that stopped at the limit could never report the first one. */
/* 10.0 u from the EYE, and the arithmetic matters: the eye is NOT at GRAPPLE_PROFILE.chaseDist. The
   rig's dolly floor is 4.0 u (camera-rig DIST_MIN) and the grapple declares no `chaseMin`, so the
   measured chase distance is 4.0, not 1.9. A-FLOW raised ropeMax to 3.2, so 4.0 + 3.2 = 7.2 just to
   reach the limit; 10.0 leaves ~2.8 u of "there is a building there and it is too far" past it, which
   is the band the dim crosshair is made of. This number tracks ropeMax — it was 9.0 when ropeMax was
   2.2 and would have left only 1.8 u of readout at 3.2. Sizing it off the PROFILE's chaseDist would
   have left 0.8 u. */
const AIM_REACH = 10.0;
const _aim = { x: 0, y: 0, z: 0 };           // ONE reused point — handed to the model by reference (no-hot-alloc, invariant #7)
let aimHit = null;                            // === _aim on a hit, null on clear sky
let fireHeld = false;                         // the MOUSE trigger only — the key trigger is Space (A-FIRE), read straight off heldKeys
const reticle = createAimReticle({ container: document.body });
const lockAim = createPointerLockAim({
  element: renderer.domElement,
  // Raw movement deltas turn the ORBIT through the engine's ONE look convention — the same call the
  // swing drag and touch paths make, so all three aim identically (see AIM_LOOK below).
  onLook: (dx, dy) => applyLook(rig.orbit, dx, dy, AIM_LOOK),
  onFire: (down) => { fireHeld = down; },
  /* Losing the lock (Esc, tab switch) must drop the line. Without this the trigger latches held, and
     a swinger that can never let go is the same bug class as a cling that never releases. */
  onLockChange: (locked) => { if (!locked) fireHeld = false; },
});
/* Verification probe (house convention — see docs/engine-invariants.md's __wash/__celestial pattern).
   Records the aim point and the anchor from the SAME frame the line attached, so the "did it web what
   I aimed at" delta can be MEASURED rather than eyeballed across a frame of motion. */
const __aimFire = { ax: 0, ay: 0, az: 0, hx: 0, hy: 0, hz: 0, delta: -1, n: 0 };
let _hadAnchor = false;

window.__heli = heliCraft;

/* ---------- mode switching (fly / walk / drive) — one shared camera-rig, three input routes ---------- */
let mode = 'fly';
function setMode(next) {
  if (next === mode) return;
  if (mode === 'drive' || mode === 'heli' || mode === 'boat' || mode === 'bird' || mode === 'fish' || mode === 'swing') pilotCtl.release();   // both are piloted — hand the camera back before switching
  /* A-AIM: leaving the swing gives the mouse back. Every ownership the swinger took (pointer lock, the
     held trigger, the crosshair) is released HERE, on the one path out — the repo's recurring bug is a
     mode that latches something an exit path forgot. pilotCtl.release() above clears free-look and the
     elevation clamp for the same reason, inside the engine. */
  if (mode === 'swing') { lockAim.exit(); fireHeld = false; reticle.setVisible(false); reticle.setInRange(false); }
  mode = next;
  document.getElementById('modeFly').setAttribute('aria-pressed', String(mode === 'fly'));
  document.getElementById('modeWalk').setAttribute('aria-pressed', String(mode === 'walk'));
  document.getElementById('modeDrive').setAttribute('aria-pressed', String(mode === 'drive'));
  document.getElementById('modeHeli')?.setAttribute('aria-pressed', String(mode === 'heli'));
  document.getElementById('modeBoat')?.setAttribute('aria-pressed', String(mode === 'boat'));
  document.getElementById('modeBird')?.setAttribute('aria-pressed', String(mode === 'bird'));
  document.getElementById('modeFish')?.setAttribute('aria-pressed', String(mode === 'fish'));
  document.getElementById('modeSwing')?.setAttribute('aria-pressed', String(mode === 'swing'));
  /* MOUSE-LOOK HANDOFF (A-FEEL blocker fix): the walker owns its own yaw/pitch while walking, and
     rig.orbit() is INERT in that state (camera-rig update() early-branches on fpActive and never
     reads the orbit goal) — so before this, metropolis's walk mode had NO look control at all: the
     walker's yaw sat at its 0 default and W walked along +z forever. Seed the walker's yaw from the
     camera's current azimuth on entry (a continuous handoff, not a snap) exactly as city/main.js:696
     does, and route pointer drags to walker.addLook while in walk mode. */
  if (mode === 'walk') { rig.setMode(CAM.PERSPECTIVE); walker.setYaw(rig.azimuth + Math.PI); walker.recenterPitch(); }
  else if (mode === 'drive') { rig.setMode(CAM.PERSPECTIVE); pilotCtl.possess(carPilotable); rig.setSpringArm({ segmentQuery: pilotWorld.segmentHit, radius: 0.3, enabled: true }); }
  else if (mode === 'heli') {
    /* No spring arm: an airborne chase must NOT pull in on the geometry below it (the arm exists to
       stop a ground chase clipping a wall). possess() arms its own follow; the craft model owns lift. */
    rig.setMode(CAM.PERSPECTIVE);
    if (heliCraft) { heliCraft.pilot.profile = HELI_PROFILE; pilotCtl.possess(heliCraft); }
    rig.setSpringArm(null);
  }
  else if (mode === 'boat') {
    rig.setMode(CAM.PERSPECTIVE);
    const b = boatPilotable();
    if (b) { b.pilot.profile = BOAT_PROFILE; pilotCtl.possess(b); }
    rig.setSpringArm(null);   // open water — nothing to clip against
  }
  else if (mode === 'bird') {
    rig.setMode(CAM.PERSPECTIVE);
    const g = birdPilotable();
    if (g) {
      g.pilot.profile = BIRD_PROFILE;
      pilotCtl.possess(g);
      pilotCtl.setView?.('cockpit');   // a gull is a billboard — fly it from INSIDE (see createBirdModel's POV note)
    }
    rig.setSpringArm(null);
  }
  else if (mode === 'swing') {
    rig.setMode(CAM.PERSPECTIVE);
    /* Start ABOVE the rooftops. Dropping the swinger at street level means the first anchor search
       looks along a canyon floor and finds a wall to smack into; from up here the upward-biased fan
       has towers to catch. citygen's downtown gradient puts the tall stock near the origin. */
    /* Spawn over a STREET with real air beneath you. A-ROOF made this matter: the old fixed spawn
       sat above a rooftop, so you fell half a second, LANDED, and the rope was cut before an arc
       could build (measured: attached on 1 of 16 samples, arc 0.28u). surfaceAt returning -Infinity
       IS the test for "no building under this point" — ask it rather than hand-picking coordinates
       that a different city seed would invalidate. */
    let sx = 1.6, sz = 1.6;
    for (let i = 0; i < 64; i++) {
      const a = i * 2.399963, rr = 0.5 + (i / 64) * 2.4;          // golden-angle spiral out from the core
      const tx = Math.sin(a) * rr, tz = Math.cos(a) * rr;
      if (engine.collider.surfaceAt(tx, tz, 99, 0.22) === -Infinity) { sx = tx; sz = tz; break; }
    }
    /* SPAWN INSIDE THE ANCHOR LAYER, not above it (A-FLOW). 5.0 put you over the skyline: surveying
       the city's own geometry, swingable anchors live between y 1.6 and 4.6 (below 1.6 the arcs bottom
       out in the street; above ~4.6 only the few tallest crowns are in reach). Dropped in at 5.0 the
       first web was a short line to a crown and the launch off it cleared the whole district — one
       swing and you were over the bay. 3.4 starts you in the canyon where the lines are. */
    swingState.x = sx; swingState.z = sz; swingState.y = 3.4;
    swingState.yaw = rig.azimuth + Math.PI; swingState.speed = 1.4;
    swingState.vx = undefined; swingState.vz = undefined; swingState.anchor = null; swingState.rope = 0;
    pilotCtl.possess(swingPilotable);
    /* SPRING ARM ON, and this is the opposite of heli/bird on purpose. I first copied their
       `setSpringArm(null)` reasoning ("an airborne chase must not reel in on the geometry below it")
       and driving it proved that wrong in one screenshot: half the frame was the inside of a black
       facade. Heli and bird fly in OPEN SKY, where there is nothing to clip. A swinger lives in the
       canyon BETWEEN towers by definition — it is closer to the car than to the gull, so it wants
       the car's arm, which pulls the eye in when a wall gets behind it. */
    rig.setSpringArm({ segmentQuery: pilotWorld.segmentHit, radius: 0.3, enabled: true });
    /* A-AIM. AFTER possess(), never before — possess() zeroes free-look on purpose (a stale camera
       owner surviving a body swap is the exact latch this repo keeps re-finding), so setting it first
       would be silently undone. Free-look is on for the WHOLE swing, not just under pointer lock: the
       drag path and the phone's look surface both feed rig.orbit, so all three input routes aim the
       same way and pointer lock is a comfort upgrade rather than the only way in. */
    pilotCtl.setFreeLook(true);
    /* THE CROSSHAIR BELONGS TO 'point' MODE ONLY (A-FLOW). In 'auto' the game chooses the anchor, so a
       mark that says "you will web THIS" would be a lie — and a mark that never brightens (aimInRange
       is `undefined` in auto) reads as a broken HUD. Pointer lock still engages, because turning the
       view is worth having whether or not you are aiming with it. */
    reticle.setVisible(SWING_PROFILE.aimMode === 'point');
  }
  else if (mode === 'fish') {
    rig.setMode(CAM.PERSPECTIVE);
    const f = fishPilotable();
    if (f) {
      f.pilot.profile = FISH_PROFILE;
      pilotCtl.possess(f);
      // CHASE, not cockpit: a breacher is a real Mesh, so unlike the gull it can be watched. Seeing
      // your own body bank and breach is the entire appeal of being a fish.
    }
    rig.setSpringArm(null);   // open water below the surface — nothing to clip against
  }
  else { rig.clearEye(); rig.setMode(CAM.PERSPECTIVE); rig.setTarget(0, LAYOUT.PLINTH_TOP + 3, 0, true); rig.setDistance(28, true); }
  refreshHint();   // every body announces its own controls (see HINTS below)
}
/* ---------- THE HINT BAR now says what THIS body's controls are (A-SPRINT, 2026-08-07) ------------
   The owner's report — "I don't have a way to flap and fly up" — was two bugs, and this is the second
   one. The gull's flap key HAS been documented since A-BIRD, in water-life.js's `controlHints`, and
   pilot.js publishes it as `pilotCtl.controlHints`. Nothing ever displayed it. The hint bar showed one
   frozen line about WASD and Esc no matter which of six bodies you were in, so the flap key existed
   and was unreachable. A capability nobody can find is not shipped.

   WHY NOT just print pilotCtl.controlHints: the KEY MAP is project-owned, and metropolis's now differs
   from its siblings — Shift is boost here, but still descend in projects/city and showcase-lab (both
   verified, city/main.js:656 + showcase-lab/main.js:265). Those engine strings say "Space/Shift
   climb/dive", which is still TRUE for them and would be a lie here. So the verbs come from the engine,
   the key names come from whoever owns the keys. Recorded in HANDOFF as a real seam: key-map-aware
   hints (tokenised {up}/{down}/{boost}) would let the engine own the whole string again. */
// the bodies that actually drive the lift axis — the rocker shows for these and hides otherwise.
// Declared HERE, above refreshHint(), because the boot call to refreshHint() reads it.
const USES_LIFT = new Set(['heli', 'bird', 'fish', 'swing']);   // swing: the lift rocker REELS THE ROPE IN — the pump
const HINTS = {
  fly:   'WASD pan · Shift boost · drag look · scroll zoom · click a tower to step inside',
  walk:  'WASD walk · Shift sprint · drag look',
  drive: 'W/S throttle · A/D steer · Shift boost (you cannot corner at full boost)',
  heli:  'W/S thrust · A/D steer · Space climb · C descend · Shift boost',
  boat:  'W/S throttle · A/D rudder (only steers with way on) · Shift full-ahead',
  fish:  'W/S swim · A/D turn · Space up · C dive · Shift burst — build speed and hit the surface to BREACH',
  bird:  'W flap · A/D bank · Space climb · C dive · Shift beat harder — ride the water down, then press C to PLUNGE IN',
  swing: 'HOLD SPACE (or the mouse button) to SHOOT THE WEB and swing — it aims itself, forward and up · A/D steer the arc · W/S reel in/out · let go to launch · Q = aimed webs (crosshair) · Esc frees the mouse',
  swingPoint: 'CLICK to capture the mouse, then AIM with it · HOLD SPACE (or the button) to web what the crosshair marks (dim = out of range) · A/D steer · W/S reel in/out · let go to launch · Q = back to auto-swing',
};
const MOBILE_HINTS = {
  fly:   'stick to move · push past the ring to boost · drag to look · tap a tower',
  walk:  'stick to walk · push past the ring to sprint · drag to look',
  drive: 'stick to drive · push past the ring to boost',
  heli:  'stick to fly · push past the ring to boost',
  boat:  'stick to steer · push past the ring for full ahead',
  bird:  'stick to fly · push past the ring to beat harder · tap dive at the water to plunge in',
  fish:  'stick to swim · push past the ring to burst · surface fast to breach',
  swing: 'hold the stick forward to SHOOT THE WEB and swing — it aims itself · steer the arc · rocker reels in/out · let go to launch',
  swingPoint: 'drag to aim the crosshair · hold the stick forward to web what it marks (dim = too far) · steer the arc · lift to reel in · let go to launch',
};
function refreshHint() {
  touch.setLift?.(USES_LIFT.has(mode));   // a rocker sitting inert while you drive a car is worse than none
  const h = document.getElementById('hint');
  if (!h) return;
  // the swinger has TWO control schemes behind one mode button, so the hint names the one you are in
  const key = (mode === 'swing' && SWING_PROFILE.aimMode === 'point') ? 'swingPoint' : mode;
  h.textContent = (MOBILE ? MOBILE_HINTS : HINTS)[key] || HINTS.fly;
}

document.getElementById('modeFly').addEventListener('click', () => setMode('fly'));
document.getElementById('modeWalk').addEventListener('click', () => setMode('walk'));
document.getElementById('modeDrive').addEventListener('click', () => setMode('drive'));
document.getElementById('modeHeli')?.addEventListener('click', () => setMode('heli'));
document.getElementById('modeBoat')?.addEventListener('click', () => setMode('boat'));
document.getElementById('modeBird')?.addEventListener('click', () => setMode('bird'));
document.getElementById('modeFish')?.addEventListener('click', () => setMode('fish'));
document.getElementById('modeSwing')?.addEventListener('click', () => setMode('swing'));

/* ---------- A-DIVE (2026-08-05): click a tower, step inside — the L60/HOARD-2 dive seam ----------
   Everything here is a PROVEN engine/office ability; this block is pure wiring (the engine-first
   contract): createDiveController owns the RTs + present orchestration, @lgr/office owns the room +
   the seated look, renderCityBeautyTo feeds the glass-city window at ~1/3 rate (city/main.js's own
   L40 WIN B pattern, same 640×448 + WIN_EVERY=3). */
const office = createOffice({ tier: 'corner' });
office.camera.aspect = window.innerWidth / window.innerHeight;
office.camera.updateProjectionMatrix();
window.addEventListener('resize', () => {
  office.camera.aspect = window.innerWidth / window.innerHeight;
  office.camera.updateProjectionMatrix();
});
/* Art pass 3/3 (bible §5 + the office investigator's levers): the pane is 5.4x2.6 = aspect 2.077 but
   the RT was 640x448 = 1.43 — the skyline in the glass was stretched 45% vertical. Camera + RT now
   match the pane. */
const windowCam = new THREE.PerspectiveCamera(55, 2.077, 0.1, 100);
windowCam.position.set(2.2, 3.4, 11.5);
windowCam.lookAt(0, 2.0, 0);
const cityWindowRT = new THREE.WebGLRenderTarget(832, 400, {
  minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: true, stencilBuffer: false,
});
// The #1 one-line fix from the office investigation: the city RT holds DISPLAY-REFERRED pixels
// (renderCityBeautyTo output); without tagging it sRGB the unlit glass re-encodes it — washed grey.
cityWindowRT.texture.colorSpace = THREE.SRGBColorSpace;
office.setCityTexture(cityWindowRT.texture);          // corner panes (hidden in the straight hero layout)
office.setStraightCityTexture(cityWindowRT.texture);  // the VISIBLE flat pane — without this it renders pure white (city/main.js's own L54 fix, hit again here)

const lookKeys = { left: false, right: false, up: false, down: false };
const LOOK_KEY = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
let _diveStyle = null, _diveDt = 0, _diveT = 0, _winFrame = 0;
const WIN_EVERY = 3;
const diveCtl = createDiveController(engine, {
  rate: 4.6,               // the L19 feel — byte-identical to the city's dive speed
  freezeFrom: false,       // city + office are independent scenes with independent cameras → both live
  renderFrom: (target) => engine.renderCityPipeline(_diveStyle, target),
  renderTo: (target) => {
    office.update(_diveDt, _diveT, sunRig);
    office.look.addKeys(_diveDt, lookKeys);
    if (_winFrame % WIN_EVERY === 0) engine.renderCityBeautyTo(windowCam, cityWindowRT);
    _winFrame++;
    renderer.setRenderTarget(target);
    renderer.render(office.scene, office.camera);
  },
});
function diveIn(focusUv) {
  if (diveCtl.mode !== 'a') return;
  if (mode !== 'fly') setMode('fly');            // walk/drive release their camera owners first (the possess/eye lesson)
  office.look.recenter();                         // every dive starts facing forward
  lookKeys.left = lookKeys.right = lookKeys.up = lookKeys.down = false;
  diveCtl.dive(focusUv || new THREE.Vector2(0.5, 0.5));
}
let _lastDiveMode = 'a', _arrivalT = 0, _baseTME = null;   // the arrival-beat envelope state
/* PHONE AFFORDANCES (2026-08-06): the hint told a phone user to press WASD, scroll, and hit Esc —
   none of which exist on a touch device. Swap it for the real gestures, and pull the default camera
   back: distance 28 was framed for a 16:9 desktop, and on a portrait phone it puts you inside a wall
   of towers instead of showing the city. */
if (MOBILE) {
  const h = document.getElementById('hint');
  /* class only — the TEXT is set by the boot refreshHint() further down. That call has to run after
     createTouchControls exists (refreshHint now also drives the lift rocker), and this MOBILE block
     runs well before it. Calling refreshHint() here threw `undefined (reading 'setLift')` on phones
     and phones ONLY, because desktop never enters this branch — a mobile-only boot crash that the
     desktop build could not have caught. */
  if (h) h.classList.add('mobile');
  rig.setDistance(46, true);
  /* Owner feedback (2026-08-06): "the control screen takes up nearly half the screen… it needs to
     toggle and hide so you can explore after selecting controls." The dock now BOOTS COLLAPSED
     behind a ⚙ chip; tap to open, set controls, tap ✕ to get the world back. Desktop unchanged. */
  const dock = document.getElementById('dock');
  const chip = document.getElementById('dockToggle');
  if (dock && chip) {
    dock.classList.add('hidden');
    chip.classList.add('show');
    chip.textContent = '⚙ controls';
    chip.addEventListener('click', () => {
      const open = !dock.classList.toggle('hidden');
      chip.textContent = open ? '✕ close' : '⚙ controls';
    });
  }
}
const _diveRaycaster = new THREE.Raycaster();
const _divePointer = new THREE.Vector2();
window.__office = office; window.__diveCtl = diveCtl;   // harness probes (house convention)

/* ---------- input: WASD (mode-routed) + drag-look + scroll-zoom ---------- */
const heldKeys = new Set();
window.addEventListener('keydown', (e) => {
  // A-DIVE routing: Escape surfaces; arrows turn the seated head while inside (city keys stay off).
  if (diveCtl.mode === 'b' || diveCtl.mode === 'in') {
    if (e.key === 'Escape') { diveCtl.surface(); return; }
    if (LOOK_KEY[e.key]) { lookKeys[LOOK_KEY[e.key]] = true; e.preventDefault(); return; }
    return;
  }
  const k = e.key.toLowerCase();
  // A-CROSSING: the PRESS (not the hold) of the dive key, while the gull is on the water, is the plunge.
  if (k === KEY.down && !heldKeys.has(k) && plunge()) { e.preventDefault(); return; }
  /* A-FLOW: Q swaps the two ways of choosing an anchor. 'auto' (the default) is the swing — hold the
     button and the game picks forward-and-above for a long arc. 'point' is the aimed web A-AIM built:
     a crosshair, and you web exactly what it marks. Both are real verbs and the owner wanted the aimed
     one kept for zipping to a chosen spot, so it gets a key rather than being dead code no build can
     reach. The reticle follows the mode on the same press — one switch, one place. */
  if (k === 'q' && !heldKeys.has(k) && mode === 'swing') {
    SWING_PROFILE.aimMode = SWING_PROFILE.aimMode === 'point' ? 'auto' : 'point';
    reticle.setVisible(SWING_PROFILE.aimMode === 'point');
    if (SWING_PROFILE.aimMode !== 'point') reticle.setInRange(false);
    refreshHint();
    e.preventDefault(); return;
  }
  /* A-FIRE: Space is the web trigger in swing mode, so it must stop being the BROWSER's space —
     it scrolls the page and, worse, re-activates whichever dock button still has focus from the
     click that entered this mode (a keydown default that turns into a synthetic click). Scoped to
     swing so heli/bird/fish keep the untouched behaviour they were verified with. */
  if (k === KEY.fire && mode === 'swing' && diveCtl.mode === 'a') e.preventDefault();
  heldKeys.add(k);
});
window.addEventListener('keyup', (e) => {
  if (LOOK_KEY[e.key]) lookKeys[LOOK_KEY[e.key]] = false;
  heldKeys.delete(e.key.toLowerCase());
});
let dragging = false, lastX = 0, lastY = 0, downX = 0, downY = 0, downT = 0;
const ORBIT_SPEED = 0.006;
/* A-LOOK (2026-08-09) — THE AIMED-BODY LOOK CONVENTION, hoisted so it never allocates on a mousemove
   (no-hot-alloc invariant #7) and so the three swing input routes read from ONE object.
   Owner: "the looking around is inverted — when you use the mouse up and point the crosshair at a
   building, it should correspond to moving the mouse up." It did the opposite; the derivation of why
   the un-inverted sign is `+dy` is in aim.js's applyLook header.

   WHY ONLY THE SWING ROUTES GET IT, and this is a real fork that is being declared rather than hidden
   (Rule 6). Fly mode's drag is a TURNTABLE: you are grabbing the city and rolling it, and drag-down
   lowering the eye is the convention every inspection camera in this repo already uses. Swing mode is
   an AIMED body: the crosshair is the thing you are steering and it must follow the hand. Two camera
   ROLES, two conventions, one named option saying which is which — rather than one sign silently
   meaning different things in different modes. */
const AIM_LOOK = { speed: ORBIT_SPEED, invertY: false };   // false = mouse up looks UP
renderer.domElement.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = downX = e.clientX; lastY = downY = e.clientY; downT = performance.now();
  /* A-AIM: the FIRST click in swing mode captures the mouse; every click after that fires the web.
     Pointer lock can only be requested from inside a user gesture, so it has to live on this press
     edge. The capturing click deliberately does NOT also fire — the lock is not active yet when its
     own mousedown is dispatched, so aim.js's trigger ignores it, and you never web a wall by accident
     on the click that was really just "let me in".

     ON THE CANVAS is the right listener, and the reason is a coincidence worth writing down: the
     touch overlay (`.lgr-touch-look`, position:fixed inset:0) WOULD swallow this — but
     createTouchControls calls setVisible(coarse), so on a desktop pointer it is display:none and the
     canvas is the hit target (verified: elementFromPoint(centre) === CANVAS, display:none, and the
     canvas listener fires). On a coarse pointer the overlay does cover it and this never runs, which
     is exactly right: there is no pointer to lock on a touchscreen. */
  if (mode === 'swing' && diveCtl.mode === 'a' && !lockAim.locked) lockAim.request();
});
/* The tower pick, callable from BOTH input paths: desktop click-vs-drag AND the touch overlay's
   onTap (the overlay swallows canvas events, so without this mobile could never dive). */
function pickTowerAt(clientX, clientY) {
  if (diveCtl.mode !== 'a' || mode !== 'fly') return;
  _divePointer.set((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
  _diveRaycaster.setFromCamera(_divePointer, rig.camera);
  const hit = _diveRaycaster.intersectObject(city.group, true)[0];
  if (hit) diveIn(new THREE.Vector2(_divePointer.x * 0.5 + 0.5, _divePointer.y * 0.5 + 0.5));
}
window.addEventListener('pointerup', (e) => {
  dragging = false;
  /* A-DIVE: a CLICK (little movement, quick) on a tower in fly mode dives in — a DRAG still orbits. */
  if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6 || performance.now() - downT > 400) return;
  pickTowerAt(e.clientX, e.clientY);
});
window.addEventListener('pointermove', (e) => {
  /* A-AIM: under pointer lock the cursor does not move, so clientX/clientY are frozen and the deltas
     below would all be zero anyway — but bail explicitly rather than relying on that, because aim.js
     is already feeding rig.orbit from movementX/Y and two look sources on one camera is how a
     double-speed turn ships. */
  if (lockAim.locked) return;
  if (!dragging) return;
  if (diveCtl.mode !== 'a') {                      // inside (or descending): drag turns the seated head
    office.look.addDrag(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    return;
  }
  if (mode === 'walk') {                           // walking: the WALKER owns look (rig.orbit is inert under fpActive)
    walker.addLook(e.clientX - lastX, e.clientY - lastY);
    lastX = e.clientX; lastY = e.clientY;
    return;
  }
  // A-LOOK: the swinger AIMS with this drag (it is the fallback whenever pointer lock is not held), so
  // it takes the aimed convention; every other mode keeps the turntable one. See AIM_LOOK.
  if (mode === 'swing') applyLook(rig.orbit, e.clientX - lastX, e.clientY - lastY, AIM_LOOK);
  else rig.orbit(-(e.clientX - lastX) * ORBIT_SPEED, -(e.clientY - lastY) * ORBIT_SPEED);
  lastX = e.clientX; lastY = e.clientY;
});
renderer.domElement.addEventListener('wheel', (e) => { rig.zoomBy(Math.exp(e.deltaY * 0.0015)); e.preventDefault(); }, { passive: false });

/* TOUCH (2026-08-06): the engine's floating thumbstick. Its look-drag routes to whoever owns look in
   the current mode — the seated head inside the office, the walker's own yaw while walking, the orbit
   rig otherwise — mirroring the pointer handler above so touch and mouse behave identically. */
const touch = createTouchControls({
  onLook: (dx, dy) => {
    if (diveCtl.mode !== 'a') { office.look.addDrag(dx, dy); return; }
    if (mode === 'walk') { walker.addLook(dx, dy); return; }
    // A-LOOK: the phone has no pointer lock, so this IS the swinger's aim on mobile — same convention.
    if (mode === 'swing') { applyLook(rig.orbit, dx, dy, AIM_LOOK); return; }
    rig.orbit(-dx * ORBIT_SPEED, -dy * ORBIT_SPEED);
  },
  onTap: (x, y) => pickTowerAt(x, y),   // owner feedback: tap-a-tower must work on the phone (the overlay swallows canvas taps)
  lift: true,                           // A-LIFT: the vertical rocker — see liftFromKeys above
  /* The plunge is bound to the PRESS of the dive verb, so on a phone it must ride the rocker's press
     edge — otherwise the whole gull->fish crossing is desktop-only. */
  onLiftPress: (dir) => { if (dir < 0) plunge(); },
});
window.__touch = touch;
refreshHint();   // boot: fly mode's own line + the correct rocker state (must run AFTER `touch` exists)

/* ---------- THE ONE KEY MAP (A-SPRINT, 2026-08-07) ------------------------------------------------
   Owner: "I need a sprint … and actually do that for all of the walk, drive, helicopter, boat".
   Granting that forced a COLLISION into the open: Shift was already sprint in fly + walk, but ALSO
   descend in heli + bird. Two verbs, one key, and the modes disagreed with each other.

   Resolved the way Rule 6 says to — follow the dominant existing pattern rather than invent a third:
   Shift is sprint in the two modes a player starts in, and sprint is what Shift means everywhere in
   this genre. So SHIFT = BOOST in all six modes, and vertical-down moves off it.

   Down is C, NOT Ctrl, and that is a deliberate call worth writing down: Ctrl+W closes the browser
   tab on Windows and Linux. "Hold descend, press throttle" would have shut the page on a recruiter's
   machine mid-demo. (macOS is Cmd+W, so this would never have reproduced on Laurence's own laptop —
   the worst kind of bug.) C is the crouch/descend convention and binds to nothing in any browser. */
/* A-FIRE (2026-08-09) — SHOOTING THE WEB IS ITS OWN BUTTON NOW.
   Owner: "we should have the space bar maybe or some other button as you shoot the web, and then you
   can swing." Fire was the THROTTLE (a held W) plus the mouse, which is why it never read as a verb:
   the same key that fires is the key that means "go" on six other bodies, so nothing announced that a
   web was a thing you SHOOT.

   SPACE, and the collision it forces is worth stating rather than dodging. Space is already KEY.up —
   climb, for heli/bird/fish — so one key now carries two verbs across bodies. That is allowed under
   the same rule the hint bar exists for (each body announces its own controls) but only if no single
   body needs both, so the SWING's vertical axis moves off Space entirely:
     · SPACE  = fire / hold the web            (this key, `fire`)
     · W / S  = reel in / pay out, and climb / descend while clinging  (the swing's lift axis)
     · C      = kept as a synonym for S, so the global "down" still descends a wall
   W and S were FREE to take precisely because fire left the throttle — a grapple has no forward gear,
   so the throttle axis was only ever a fire button wearing a movement key's clothes. Keeping the pair
   under the same hand means reeling in mid-arc does not need a thumb.

   The alternative considered and rejected was a collision-free key (F). It costs nothing technically
   and everything in discoverability: Space is where a player's thumb already is, and the owner named
   it. A binding you have to be told about twice is the bug this arc is fixing. */
const KEY = { up: ' ', down: 'c', fire: ' ' };
/* A-LIFT: the vertical axis from EITHER input. It was keyboard-only, which meant heli/bird/fish had
   no vertical dimension at all on a phone — measured Δy = 0.000 for all three under the only control
   a phone had. The rocker (engine-core/touch-controls) supplies the same [-1,1]. */
const liftFromKeys = () => {
  const k = (heldKeys.has(KEY.up) ? 1 : 0) - (heldKeys.has(KEY.down) ? 1 : 0);
  return k !== 0 ? k : (touch.axes.lift || 0);
};
/* A-FIRE: the SWING's own vertical axis, off Space because Space is now its trigger (see KEY above).
   Same [-1,1] contract as liftFromKeys and the same touch-rocker fallback, so the phone keeps the
   pump and the wall-climb exactly as it had them — only the desktop keys moved. */
const swingLiftFromKeys = () => {
  const k = (heldKeys.has('w') ? 1 : 0) - ((heldKeys.has('s') || heldKeys.has(KEY.down)) ? 1 : 0);
  return k !== 0 ? k : (touch.axes.lift || 0);
};

function axesFromKeys() {
  // keys and stick COMPOSE (clamped) so a desktop with a touchscreen can use either
  const kx = (heldKeys.has('d') ? 1 : 0) - (heldKeys.has('a') ? 1 : 0);
  const ky = (heldKeys.has('w') ? 1 : 0) - (heldKeys.has('s') ? 1 : 0);
  const x = Math.max(-1, Math.min(1, kx + touch.axes.x));
  const y = Math.max(-1, Math.min(1, ky + touch.axes.y));
  // boost: Shift on a keyboard, an over-pushed thumbstick on a phone (touch-controls owns that gesture).
  const boost = Math.max(heldKeys.has('shift') ? 1 : 0, touch.axes.boost || 0);
  return { x, y, boost, sprint: boost > 0.5 };
}

/* ---------- the REAL public control surface (Live Sky's dock pattern — id="time"/"speed"/"realdate", not
   hidden behind any AUTHOR gate). sunRig.goTo/setPace/setAuto already exist — this is UI, not engine. ---------- */
const $ = (id) => document.getElementById(id);
$('time').addEventListener('input', (e) => { sunRig.setAuto(false); $('auto').setAttribute('aria-pressed', 'false'); sunRig.goTo(+e.target.value / 1000, true); });   // snap: the sun lands under the thumb NOW (the eased chase lagged 1-2.5s — "the scrub doesn't work")
$('auto').addEventListener('click', () => { const on = $('auto').getAttribute('aria-pressed') !== 'true'; sunRig.setAuto(on); $('auto').setAttribute('aria-pressed', String(on)); });
$('speed').addEventListener('input', (e) => { const s = +e.target.value / 100; sunRig.setPace(600 * Math.pow(2 / 600, s)); });
$('weather').addEventListener('change', (e) => { weatherRig.setKind(e.target.value); });
$('realsky').addEventListener('click', () => {
  realSkyOn = !realSkyOn; $('realsky').setAttribute('aria-pressed', String(realSkyOn));
  if (realSkyResolved) { trueStars.setVisible(realSkyOn); solarSystem.setVisible(realSkyOn); }
});
$('realdate').addEventListener('change', (e) => { if (e.target.value) realDate = new Date(e.target.value + 'T20:00:00'); });
// sync the slider to sunRig's own auto-advance so a drag mid-cycle never fights the running clock —
// and ALWAYS show the clock (sunRig.clock is the engine's own HH:MM getter, built "for the hint bar"
// and never wired here until 2026-08-05 — "you don't know what time it is" was literally true).
setInterval(() => {
  if (sunRig.auto) $('time').value = Math.round(sunRig.t * 1000);
  $('clock').textContent = sunRig.clock;
}, 250);

/* ---------- the frame ---------- */
function frame(dt, t) {
  const axes = axesFromKeys();
  if (diveCtl.mode !== 'a') {
    /* inside (or mid-dive): city movement input is off — the seated look owns the head (its
       drag/arrow input feeds in via the handlers + renderTo's addKeys). The city SIM keeps
       running below: it is alive behind the office glass. */
  } else if (mode === 'walk') {
    walker.update(dt, axes);
    /* Feed the accepted ground forward: eye minus eye-height IS the surface we are standing on, so
       next frame's roof query gets a truthful ceiling instead of an assumption. */
    walkGroundY = walker.eyePosition().y - EYE;
    rig.setEye(walker.eyePosition(), walker.eyeDirection());
  } else if (mode === 'drive') {
    pilotCtl.step(dt, { throttle: axes.y, steer: axes.x, lift: 0, boost: axes.boost });
  } else if (mode === 'boat') {
    pilotCtl.step(dt, { throttle: axes.y, steer: axes.x, lift: 0, boost: axes.boost });
  } else if (mode === 'fish') {
    // A fish has no reverse gear worth having but CAN back-paddle; throttle passes through whole.
    pilotCtl.step(dt, { throttle: axes.y, steer: axes.x, lift: liftFromKeys(), boost: axes.boost });
  } else if (mode === 'swing') {
    /* WIRING DRIFT, caught by driving it (2026-08-08): setMode('swing') possessed the body and this
       dispatch had no branch for it, so every frame fell through to the free-fly `else` and the
       swinger sat frozen at its spawn — mode switched, camera followed, physics never ran. The
       ability being in core and the mode button existing proves nothing; the STEP has to be wired.
       A-FIRE (2026-08-09): the THROTTLE IS NOW TOUCH-ONLY here, and that one clamp is the whole
       rebinding. The model fires on `axes.fire` OR a held throttle (pilot.js's two-source rule, kept
       so no existing consumer loses its trigger); feeding it the STICK's y and not the keyboard's
       leaves the phone firing exactly as it did — hold the stick forward — while freeing W and S on
       the desktop to become the lift axis. Nothing in the engine had to change to rebind a key, which
       is the point of the model taking either source.

       A-AIM (2026-08-08): resolve the crosshair BEFORE stepping, so the model attaches to what the
       player is looking at THIS frame rather than last frame's view. `aimHit` is either `_aim` (the one
       reused point) or null; null is not an error, it is "you are aiming at sky". */
    aimHit = resolveAimPoint(rig.camera, pilotWorld, _aim, { maxDist: AIM_REACH, radius: 0.05 });
    pilotCtl.step(dt, {
      throttle: Math.max(0, touch.axes.y), steer: axes.x, lift: swingLiftFromKeys(), boost: axes.boost,
      aimPoint: aimHit, fire: fireHeld || heldKeys.has(KEY.fire),
    });
    /* The crosshair reads the MODEL's verdict (state.aimInRange), never its own copy of the range rule
       — one implementation, read twice. A HUD that recomputed "in range" would eventually disagree
       with the mechanic, and the player would find out by firing at a bright mark and getting nothing. */
    if (SWING_PROFILE.aimMode === 'point') reticle.setInRange(!!swingState.aimInRange);
    if (swingState.anchor && !_hadAnchor) {   // the attach frame — record both points while they are the same frame's
      __aimFire.ax = _aim.x; __aimFire.ay = _aim.y; __aimFire.az = _aim.z;
      __aimFire.hx = swingState.anchor.x; __aimFire.hy = swingState.anchor.y; __aimFire.hz = swingState.anchor.z;
      __aimFire.delta = Math.hypot(_aim.x - swingState.anchor.x, _aim.y - swingState.anchor.y, _aim.z - swingState.anchor.z);
      __aimFire.n++;
    }
    _hadAnchor = !!swingState.anchor;
  } else if (mode === 'bird') {
    // throttle is clamped ≥0: a wing has no reverse. Space climbs, C dives (see the KEY map above).
    pilotCtl.step(dt, { throttle: Math.max(0, axes.y), steer: axes.x, lift: liftFromKeys(), boost: axes.boost });
  } else if (mode === 'heli') {
    // LIFT is the third axis a flying craft needs and the car never used: Space climbs, C descends.
    pilotCtl.step(dt, { throttle: axes.y, steer: axes.x, lift: liftFromKeys(), boost: axes.boost });
  } else {
    const FLY = 9 * dt * (axes.sprint ? 2.6 : 1);
    if (axes.x || axes.y) rig.pan(axes.x * FLY, axes.y * FLY);
  }
  rig.update(dt);

  /* Drive OUR city's window emissive from the day/night clock (mirrors createCityWorld:1103) —
     SHAPED at golden hour (defect 4): the emissive constant is HDR-tuned 4.5 for NIGHT (bloom
     strength 0.27 there), but dusk runs bloom ~4x hotter (the A-DUSK golden-hour lever), and
     glow 0.66 x 4.5 under that bloom blew every pane to a 4-6x halo (Fable-5's bar: <=2x).
     lowSunWashK is the engine's own low-sun curve: windows now FADE IN through golden hour and
     take over as the sky dims — night value unchanged (curve is 0 there), noon unchanged (glow 0). */
  /* Look-bible shadow carrier (c): a faint always-on interior emissive so the window grid never dies
     on shaded faces — floor 0.10 (was 0 all day, which left daytime shadow windows clipped to black). */
  windowGlow.value = Math.max(0.10, sunRig.windowGlow * (1 - 0.55 * lowSunWashK(sunRig.sunArc.y)));
  cityLife.update(dt, t, sunRig);
  pedestrians.update(dt);
  waterLife.update(dt, t, sunRig);
  engine.simMaterial.uniforms.uWakeCount.value = waterLife.wakeCount;

  engine.updateWorld(dt, t, { shadowsOn: true, seasonTarget: 0 });
  city.update(t);

  if (realSkyOn && realSkyResolved) {
    const nightK = 1 - THREE.MathUtils.smoothstep(sunRig.sunArc.y, -0.05, 0.15);
    trueStars.update(realDate, CITY_LATLON.latDeg, CITY_LATLON.lonDeg, nightK, t, false, rig.camera);
    constellations.update(trueStars.position, nightK, realSkyOn, rig.camera);
    solarSystem.update(realDate, CITY_LATLON.latDeg, CITY_LATLON.lonDeg, nightK, t, false, rig.camera);
  }

  /* A-DIVE present: the dive controller owns the present now — settled 'a' frames call renderFrom(null)
     (exactly the old engine.renderCityPipeline(style, null) line), settled 'b' frames render the office,
     transitions render BOTH into its RTs and run the crossfade. */
  _diveStyle = engine.decideStyle(); _diveDt = dt; _diveT = t;
  /* THE ARRIVAL BEAT (bible §5, "the ONE thing"): crossing the glass threshold blooms overexposed
     for a half-second, then settles as the eye adapts — that swing is what stepping inside FEELS
     like. Driven on the dive mode edge: entering 'b' arms a 0.65 s exposure envelope on the global
     tonemap (only the office renders while settled at 'b', so the scope is exactly the room). */
  const _dm = diveCtl.update(dt);
  if (_dm === 'b' && _lastDiveMode !== 'b') { _arrivalT = 0.65; _baseTME = renderer.toneMappingExposure; }
  if (_arrivalT > 0) {
    _arrivalT = Math.max(0, _arrivalT - dt);
    const k = _arrivalT / 0.65;                                   // 1 → 0
    renderer.toneMappingExposure = _baseTME * (1 + 1.1 * k * k);  // bloom-in ×2.1 → settle
  } else if (_baseTME != null && _dm !== 'b') { renderer.toneMappingExposure = _baseTME; _baseTME = null; }
  _lastDiveMode = _dm;
}

/* ---------- readiness + boot ---------- */
function ready() {
  shell.ready();
  /* The HOUSE readiness convention (window.__loaded + #lgr-loader.gone) that tools/smoke.mjs asserts —
     lessons/main.js:9 states it explicitly. metropolis rolled its own #boot overlay and set no
     __loaded, so the gate's frame check timed out on it the moment metropolis was added to ENTRIES. */
  const boot = document.getElementById('lgr-loader');
  // KEEP the element, marked `.gone` — do NOT remove it. smoke.mjs asserts
  // `getElementById('lgr-loader')?.classList.contains('gone')`, which a REMOVED node can never
  // satisfy (optional-chaining on null is undefined = falsy), so the old `boot.remove()` made the
  // frame check time out forever. `.gone` is already opacity:0 + pointer-events:none, so keeping
  // the node costs nothing visually.
  if (boot) boot.classList.add('gone');
  window.__loaded = true;
}
setTimeout(ready, 400);   // our own content is synchronous (createCity generates at construction); no async load to await

window.__engine = engine; window.__city = city; window.__cityLife = cityLife; window.__waterLife = waterLife;
window.__setMode = setMode; window.__mode = () => mode;
window.__walker = walker; window.__pilotCtl = pilotCtl; window.__playerCar = playerCar;
window.__realSky = { trueStars, solarSystem, constellations, get on() { return realSkyOn; }, get resolved() { return realSkyResolved; } };
window.__swing = swingState;   // A-SWING probe handle (house convention — see docs/engine-invariants.md)
/* A-FLOW: the profile and the aim-mode switch, so the probe can exercise BOTH verbs in one run. The
   setter goes through the same three steps the Q key does, because a probe that flipped only the
   profile field would leave the crosshair in whatever state the other mode left it — and then it would
   be testing a HUD state no player can reach. */
window.__swingProfile = SWING_PROFILE;
window.__setAimMode = (m) => {
  SWING_PROFILE.aimMode = m === 'point' ? 'point' : 'auto';
  reticle.setVisible(mode === 'swing' && SWING_PROFILE.aimMode === 'point');
  if (SWING_PROFILE.aimMode !== 'point') reticle.setInRange(false);
  refreshHint();
  return SWING_PROFILE.aimMode;
};
// A-AIM probes: the live aim point + whether it is reachable, and the attach-frame fidelity record.
window.__aim = { pt: _aim, get hit() { return !!aimHit; }, get inRange() { return !!swingState.aimInRange; },
                 get locked() { return lockAim.locked; }, get firing() { return fireHeld; }, get reach() { return AIM_REACH; } };
window.__aimFire = __aimFire;
window.__reticle = reticle;
window.__frame = frame;   // debug/verification probe (matches house convention — see docs/engine-invariants.md)
window.__cityReady = true;

shell.start(frame);
