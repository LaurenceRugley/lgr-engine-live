/* ============================================================
   world-marriage.test.mjs — A-MARRIAGE proofs c · d · f: the CITY on the carved field.
   ------------------------------------------------------------
     c. THE GUARANTEE, LOCAL — ask 70% swingable and count exactly N/M off the finished tower
        records, each tower judged against ITS OWN pad ground (decision 4). Plus the negative
        control: the GLOBAL rule (the pre-marriage arithmetic) counts a DIFFERENT number on hilly
        pads — proving the local form is load-bearing, not decorative.
     d. FLAT-IN = TODAY-OUT — a flat heightfield through the married pipeline hashes BYTE-IDENTICAL
        (FNV-1a over the packed solids bytes) to the unmarried plinth path. This is the proof that
        every existing room is safe: with the opt-ins at defaults or the field flat, not one float
        moves.
     f. BIKE CLIMBABILITY, METRIC BEFORE CHANGE — the model's own numbers first: the grounded speed
        law has NO slope-gravity term (pilot.js `createBikeModel`, grounded branch: speed integrates
        from throttle/brake/drag only, y snaps to the field), so grade does not tax the powertrain
        BY CONSTRUCTION — asserted runnable (flat vs 25% incline end at the same speed to 1e-9), so
        the day someone adds slope physics this test goes red and says "re-derive the street dial".
        The binding limits are elsewhere: the crest-launch inequality (v²·κ > g) at a ramp's convex
        top — which the smoothstep profile spreads over the street width instead of a kink — and the
        walker's stepUp (0.06 u/frame at 60 Hz ⇒ climbable grade ≈ 0.06·60/0.55 ≈ 6.5 ≫ any street).
        Then the driven half in node: full throttle up the STEEPEST SHIPPED STREET reaches the high
        pad at design speed with the NO-SINK receipt intact; the walker (createCharacterController)
        climbs the same street grounded.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { generateTerrain, createTerrainSampler } from './terrain.js';
import { carveCityPads } from './carve-pads.js';
import { createBoxArena } from './box-arena.js';
import { createBikeModel, BIKE_PROFILE } from './pilot.js';
import { createCharacterController } from './character.js';

/* the world-lab family — same numbers as carve-pads.test.mjs and the room. */
const W = { seed: 11, size: 336, worldSize: 104, baseY: 0 };
const LAYOUT = { cols: 13, rows: 13, spacing: 4.6 };
const CARVE = { streetW: 1.2, maxGrade: 0.25, blend: 3.0 };
const ARENA = {
  cols: LAYOUT.cols, rows: LAYOUT.rows, spacing: LAYOUT.spacing,
  width: 1.9, plaza: 1, seed: 11, groundY: 0, height: 0, heightVary: 0,
  skyline: {
    frac: 0.70, ropeMax: 4.10, arcClear: 0.45, skim: 0.06,
    tall: 2.1, low: 0.22, gamma: 1.0, cores: 3, coreSigma: 0.30, mix: 0.45,
    footVary: 0.45, jitter: 0.2, minStreet: 2.4,
  },
  silhouette: {},
};

const fnv1a = (bytes) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) { h ^= bytes[i]; h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16);
};

function marry() {
  const t = generateTerrain({ seed: W.seed, size: W.size, preset: 'valley' });
  const carve = carveCityPads(t, { worldSize: W.worldSize, baseY: W.baseY }, LAYOUT, CARVE);
  const sample = createTerrainSampler(t, { worldSize: W.worldSize, baseY: W.baseY });
  const arena = createBoxArena({
    ...ARENA,
    groundYAt: (x, z, i, j) => carve.padYOf(i, j),
    heightAt: sample,
    ground: false,
  });
  return { t, carve, sample, arena };
}
const M = marry();

/* ---- PROOF d — FLAT-IN = TODAY-OUT, hashed not hoped. ------------------------------------------
   The flat field is built at sea = 0.5 EXACTLY (representable in f32 and f64), so the carve's pad
   means come out 0.0 to the last bit and `groundYAt` returns the very float `groundY` is — the
   branch arithmetic in box-arena then cannot round differently. If this ever fails, the married
   pipeline has stopped being a superset of the plinth and every existing room is exposed. */
test('PROOF d — a FLAT field through the married pipeline hashes byte-identical to the plinth path', () => {
  const n = W.size * W.size;
  const flat = { size: W.size, height: new Float32Array(n).fill(0.5), biome: new Uint8Array(n), sea: 0.5, relief: 7.5, minH: 0.5, maxH: 0.5 };
  const carve = carveCityPads(flat, { worldSize: W.worldSize, baseY: W.baseY }, LAYOUT, CARVE);
  assert.equal(carve.stats.padMin, 0, 'a flat field must carve pads at exactly groundY 0');
  assert.equal(carve.stats.padMax, 0);
  const sample = createTerrainSampler(flat, { worldSize: W.worldSize, baseY: W.baseY });
  assert.equal(sample(3.17, -8.4), 0, 'the flat sampler must read exactly 0');

  const married = createBoxArena({ ...ARENA, groundYAt: (x, z, i, j) => carve.padYOf(i, j), heightAt: sample, ground: false });
  const plinth = createBoxArena({ ...ARENA });
  const hMarried = fnv1a(new Uint8Array(married.solids.buffer, 0, married.solids.length * 4));
  const hPlinth = fnv1a(new Uint8Array(plinth.solids.buffer, 0, plinth.solids.length * 4));
  assert.equal(married.boxes.length, plinth.boxes.length);
  assert.equal(hMarried, hPlinth,
    `FLAT-IN ≠ TODAY-OUT: married solids hash ${hMarried} vs plinth ${hPlinth} — a default-path float moved`);
  const sm = married.stats.swingable, sp = plinth.stats.swingable;
  assert.equal(sm.clearing, sp.clearing);
  assert.equal(sm.towers, sp.towers);
  // and the ONE world bag answers the flat question exactly as the plinth's bag does
  assert.equal(married.world.heightAt(2.2, -1.7), plinth.world.heightAt(2.2, -1.7));
  married.dispose(); plinth.dispose();
});

/* ---- PROOF c — THE GUARANTEE, LOCAL, COUNTED. --------------------------------------------------
   13×13 minus the plaza cell = 168 towers; rank t = k/167 clears at t > 0.30 ⇒ k ≥ 51 ⇒ 117 towers
   (69.6% — the exact discrete quantile, not "about 70"). Counted three ways that must agree:
   the arena's own stats, an independent recount off the records, and the record↔solids tie
   (every record's top must be a real maxY in the packed buffer, f32-rounded). */
test('PROOF c — ask 70% swingable on hilly pads → EXACTLY 117/168, each tower vs its OWN pad', () => {
  const { arena, carve } = M;
  const s = arena.stats.swingable;
  const needRel = s.need - 0;                    // groundY 0 ⇒ the relative arc-bottom minimum
  assert.equal(s.towers, 168);
  assert.equal(s.clearing, 117, `stats counted ${s.clearing}/168 — want the exact discrete quantile 117`);

  // independent recount off the finished records, against each tower's LOCAL ground
  let clearing = 0, padSpread = 0;
  for (const r of arena.towers) {
    if (r.top - r.y > needRel) clearing++;
    padSpread = Math.max(padSpread, Math.abs(r.y));
  }
  assert.equal(clearing, 117, 'independent local recount disagrees with stats.swingable');
  assert.ok(padSpread > 0.3, `pads span only ${padSpread.toFixed(3)} u — the terrain is too flat for this proof to mean anything`);
  assert.ok(carve.stats.padMax - carve.stats.padMin > 0.3);

  /* the NEGATIVE CONTROL: the pre-marriage GLOBAL rule (top > need above the one datum) counts a
     DIFFERENT number here — towers on high pads sneak over the global line with less than the local
     minimum of usable height. If these ever agree, the local form has stopped being load-bearing
     and this proof has stopped proving anything — change the seed, do not delete the control. */
  let globalCount = 0;
  for (const r of arena.towers) if (r.top > s.need) globalCount++;
  assert.notEqual(globalCount, 117,
    'the global count equals the local count on this seed — the control is inconclusive, pick a hillier seed');

  // every record's top is a REAL top in the packed buffer (record ↔ solids tie, f32 rounding only)
  const tops = new Set();
  for (let k = 0; k < arena.solids.length / 6; k++) tops.add(arena.solids[k * 6 + 4]);
  let missing = 0;
  for (const r of arena.towers) if (!tops.has(Math.fround(r.top))) missing++;
  assert.equal(missing, 0, `${missing} tower records have no matching solid top — records and buffer drifted`);
});

/* ---- the steepest shipped street, found off the finished pads (used by f and the walker). ------ */
function steepestStreet() {
  const { carve } = M;
  const cx = (LAYOUT.cols - 1) / 2, cz = (LAYOUT.rows - 1) / 2;
  let best = null;
  for (let j = 0; j < LAYOUT.rows; j++) {
    for (let i = 0; i < LAYOUT.cols; i++) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        if (i + di >= LAYOUT.cols || j + dj >= LAYOUT.rows) continue;
        const a = carve.padYOf(i, j), b = carve.padYOf(i + di, j + dj);
        if (!best || Math.abs(a - b) > Math.abs(best.dY)) {
          best = {
            dY: b - a,
            ax: (i - cx) * LAYOUT.spacing, az: (j - cz) * LAYOUT.spacing,
            bx: (i + di - cx) * LAYOUT.spacing, bz: (j + dj - cz) * LAYOUT.spacing,
            aY: a, bY: b,
          };
        }
      }
    }
  }
  // orient LOW → HIGH so "climb" means climb
  if (best.dY < 0) {
    best = { dY: -best.dY, ax: best.bx, az: best.bz, bx: best.ax, bz: best.az, aY: best.bY, bY: best.aY };
  }
  best.yaw = Math.atan2(best.bx - best.ax, best.bz - best.az);   // the repo's (sin,cos) heading
  /* START and GOAL sit on the street CENTRELINE at the pads' EDGES (1.5 u from centre: on the flat
     plateau, outside every possible tower footprint — box-arena's worst base edge is 1.34 u). The
     pad CENTRES are where the towers stand; a climb proof that starts inside a building proves
     collision bugs, not climbing (found by exactly that red on the first run of this file). */
  const ux = Math.sin(best.yaw), uz = Math.cos(best.yaw), EDGE = (LAYOUT.spacing - CARVE.streetW) / 2 - 0.2;
  best.sx = best.ax + ux * EDGE; best.sz = best.az + uz * EDGE;      // start: low pad's street edge
  best.gx = best.bx - ux * EDGE; best.gz = best.bz - uz * EDGE;      // goal: high pad's street edge
  best.span = Math.hypot(best.gx - best.sx, best.gz - best.sz);
  return best;
}

test('PROOF f (metric BEFORE the carve) — the grounded bike has NO slope term: flat and 25% incline end at the same speed', () => {
  const bike = createBikeModel(BIKE_PROFILE);
  const run = (H) => {
    const st = { x: 0, y: 0, z: 0, yaw: 0, speed: 0, quat: { setFromRotationMatrix() {}, premultiply() {} } };
    const axes = { throttle: 1, steer: 0, lift: 0, boost: 0 };
    for (let k = 0; k < 240; k++) bike.step(st, axes, 1 / 120, { heightAt: H });
    return st.speed;
  };
  const flat = run(() => 0);
  const slope = run((x, z) => 0.25 * z);         // yaw 0 rides +z, straight up a 25% grade
  assert.ok(Math.abs(flat - slope) <= 1e-9,
    `grounded speed now DEPENDS on grade (flat ${flat} vs incline ${slope}) — slope physics was added; ` +
    're-derive the street maxGrade dial from the new powertrain before trusting any married room');
  assert.ok(flat > BIKE_PROFILE.maxSpeed * 0.9, `2 s of throttle should approach design speed (got ${flat})`);
});

test('PROOF f (driven, node) — DESIGN SPEED crosses the steepest shipped street onto its high pad, NO-SINK 0', () => {
  const { sample } = M;
  const st8 = steepestStreet();
  assert.ok(st8.dY > 0.15, `steepest street climbs only ${st8.dY.toFixed(3)} u — too flat to prove climbing`);
  /* seeded AT design speed — the claim under proof is "design speed climbs the steepest shipped
     street"; run-up room is the street network's job, not this 1.2 u ramp's. The crest may legally
     LAUNCH the bike (v²·κ > g is the same physics moto-lab is built on — with Δ 0.20 over W 1.2 the
     smoothstep top's κ ≈ 6Δ/W² ≈ 0.83, so anything past ~2.5 u/s hops); the proof is that it comes
     down ON the high pad at speed, having crossed, never under the field. */
  const bike = createBikeModel(BIKE_PROFILE);
  const state = { x: st8.sx, y: sample(st8.sx, st8.sz), z: st8.sz, yaw: st8.yaw, speed: BIKE_PROFILE.maxSpeed, quat: new THREE.Quaternion() };
  const axes = { throttle: 1, steer: 0, lift: 0, boost: 0 };
  const world = { heightAt: sample };
  const ux = Math.sin(st8.yaw), uz = Math.cos(st8.yaw);
  let minClear = Infinity, crossed = false, arrivalSpeed = 0, launched = false;
  for (let k = 0; k < 120 * 6; k++) {
    bike.step(state, axes, 1 / 120, world);
    const clear = state.y - sample(state.x, state.z);
    if (clear < minClear) minClear = clear;
    if (state.airborne) launched = true;
    const progress = (state.x - st8.sx) * ux + (state.z - st8.sz) * uz;
    if (!crossed && progress >= st8.span && !state.airborne && Math.abs(state.y - st8.bY) < 0.03) {
      crossed = true; arrivalSpeed = state.speed;
      break;
    }
  }
  assert.ok(crossed, `the bike never stood on the high pad past the street (ended ${state.x.toFixed(2)}, ${state.z.toFixed(2)}, y ${state.y.toFixed(2)} vs pad ${st8.bY.toFixed(2)}, airborne ${state.airborne})`);
  assert.ok(arrivalSpeed >= BIKE_PROFILE.maxSpeed * 0.85,
    `arrived at only ${arrivalSpeed.toFixed(2)} u/s — a slope tax or a scrubbed landing ate the crossing`);
  assert.ok(minClear >= -1e-7, `NO-SINK broke: min(y − heightAt) = ${minClear} (the moto containment analog)`);
  // the crest-hop is physics, not a failure — but RECORD which shape this run took, so a future
  // profile change that flips it shows up as a diff in the test output, not a silent regime swap.
  console.log(`  [climb receipt] Δ ${st8.dY.toFixed(3)} u over ${CARVE.streetW} u · launched=${launched} · arrival ${arrivalSpeed.toFixed(2)} u/s · minClear ${minClear.toExponential(1)}`);
});

test('the WALKER climbs the same street grounded (createCharacterController on the ONE bag)', () => {
  const { arena, sample } = M;
  const st8 = steepestStreet();
  const SKIM = 0.06;      // the controller's floor clearance — grounded y sits ground + skim by design
  const character = createCharacterController({ world: arena.world, eyeHeight: 0.28, radius: 0.09, footR: 0.12, collideYOff: 0.14, moveSpeed: 0.55, sprintSpeed: 0.95, gravity: 5.4 });
  character.setPosition(st8.sx, null, st8.sz);
  character.setYaw(st8.yaw);
  let minClear = Infinity, arrived = false;
  const ux = Math.sin(st8.yaw), uz = Math.cos(st8.yaw);
  for (let k = 0; k < 60 * 30 && !arrived; k++) {
    character.update(1 / 60, { x: 0, y: 1, sprint: true });
    const clear = character.y - sample(character.x, character.z);
    if (character.grounded && clear < minClear) minClear = clear;
    const progress = (character.x - st8.sx) * ux + (character.z - st8.sz) * uz;
    if (progress >= st8.span && character.grounded && Math.abs(character.y - (st8.bY + SKIM)) < 0.03) arrived = true;
  }
  assert.ok(arrived, `the walker never reached the high pad (at ${character.x.toFixed(2)}, ${character.z.toFixed(2)}, y ${character.y.toFixed(2)} vs ${(st8.bY + SKIM).toFixed(2)})`);
  assert.ok(minClear >= -1e-4, `the walker sank ${minClear} below the married ground while grounded (skim should keep it ~+0.06)`);
});
