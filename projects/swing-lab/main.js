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
const SKY = LEVEL === 'city' ? '#1d2634' : '#141821';
renderer.setClearColor(new THREE.Color(SKY), 1);
scene.fog = LEVEL === 'city' ? new THREE.Fog(SKY, 45, 230) : new THREE.Fog(SKY, 26, 120);

/* Lights. `createEngineCore` ships NO lights (it owns the renderer, not the look), so the arena
   supplies its own: one key with shadows, a hemisphere fill so the north faces are not black, and a
   low bounce so a body in a street canyon still reads. */
const key = new THREE.DirectionalLight('#fff0dd', 2.3);
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
scene.add(LEVEL === 'city'
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
  },
  silhouette: Q.get('plain') === '1' ? null : {},
  groundMaterial: new THREE.MeshStandardMaterial({ color: '#3d4453', roughness: 0.95, metalness: 0 }),
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
const ARENA0 = LEVEL === 'city' ? CITY_ARENA : LAB_ARENA;
/* THE PERCENTILE THE ROPE IS DERIVED AT IS THE LEVEL'S OWN. The lab's 0.35 is A-CLIMB's; the city's is
   `1 - frac`, i.e. exactly the break the generator built its distribution around. Two rooms, one
   arithmetic, and the number that differs is a fact about the room. */
const SKYLINE_P = LEVEL === 'city' ? 1 - CITY_FRAC : 0.35;
const _buildT0 = performance.now();
const arena = createBoxArena(ARENA0);
const LEVEL_BUILD_MS = performance.now() - _buildT0;
scene.add(arena.group);

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
const CIVS_DEFAULT = 150;
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
const CIV_SCALE = 0.055;      // survivor.glb ≈ 4.7 raw units tall → ~0.26 u at this scale
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
  // ?noflee=1 is the flee-measurement CONTROL ARM (hoard2's lever, same name) — decided at
  // construction, one sim either way, so both arms consume the stream identically.
  const sim = createAgentSim({ ...CIV, count }, srng, { cap: count, sepRadius: 0.10, clampBlocked: true, flee: Q.get('noflee') !== '1' });
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
  });
  scene.add(tiers.group);

  let acc = 0;
  return {
    sim, tiers, ob, flee, hunt,
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
  moveSpeed: 0.55, sprintSpeed: 0.95, accel: 14,
  jumpSpeed: 1.2, gravity: SWING.gravity,
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

/* The body you look at in third person, and the line you hang from. Placeholder geometry is an
   accepted stand-in — the arc is the controller, not the art (same ruling as metropolis's capsule). */
const body = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.06, 0.16, 4, 10),
  new THREE.MeshStandardMaterial({ color: '#d8482f', roughness: 0.55, flatShading: true }),
);
body.castShadow = true;
scene.add(body);
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

  /* --- the visible body --- */
  body.position.set(character.x, character.y + EYE * 0.5, character.z);
  body.quaternion.copy(s.quat);
  body.visible = character.view === 'third';
  if (s.anchor) {
    const p = ropeGeo.attributes.position;
    p.setXYZ(0, character.x, character.y + EYE * 0.6, character.z);
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
  sample() { const out = []; population.sim.forEach((_i, c) => { if (c.alive) out.push({ x: c.x, z: c.z, state: c.state }); }); return out; },
  infect: (n = 1, x = 0, z = 0) => population.sim.forceExpose(n, x, z),
} : null;
