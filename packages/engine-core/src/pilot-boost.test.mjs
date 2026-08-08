// pilot-boost.test.mjs — A-SPRINT (2026-08-07): the boost axis + the bird's climb budget.
//
// Rule 9 — these encode WHY, not "it runs". Each one pins a property that a plausible future tuning
// pass would otherwise break silently, because none of them show up as an error, a crash, or a red
// build. They show up as "the seagull can't fly up", reported by the owner three weeks later.
//
//   • THE CLIMB BUDGET is the whole reason A-SPRINT exists. BIRD_PROFILE.flap shipped at 1.1 while a
//     full climb costs sin(pitchMax)·gravityTrade + glideDrag = 1.639 u/s². Flapping was WEAKER than
//     the drain, so W+Space always bled to the stall and the nose dropped: measured +0.173 u in 2 s,
//     ending STALLING. Nothing was broken — the arithmetic just didn't close. This test closes it, so
//     any future edit to flap / gravityTrade / pitchMax / glideDrag that reopens the gap fails HERE
//     instead of in the owner's hands.
//   • BYTE-IDENTICAL BY DEFAULT is the engine's standing contract (docs/engine-invariants.md): every
//     new ability is opt-in. A consumer that never sends `boost` must integrate exactly as before, or
//     projects/city's tier baselines drift for a feature city does not even use.
//   • BOOST IS ANALOG because the phone has no Shift key — touch-controls ramps it from an over-pushed
//     stick. A 0/1-only implementation would work on the desktop and quietly half-work on mobile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBirdModel, BIRD_PROFILE, createRoadModel, ROAD_PROFILE, createBoatModel, BOAT_PROFILE } from './pilot.js';

const FLAT = { heightAt: () => 0, waterHeightAt: () => -999 };
const fresh = (over = {}) => ({ x: 0, y: 20, z: 0, yaw: 0, pitch: 0, bank: 0, speed: 0, vy: 0, quat: new THREE.Quaternion(), ...over });
const drive = (model, state, axes, seconds, world = FLAT) => {
  for (let i = 0; i < Math.round(seconds * 60); i++) model.step(state, axes, 1 / 60, world);
  return state;
};

test('THE CLIMB BUDGET: flapping must out-pay what a full climb costs — the bug the owner found', () => {
  const p = BIRD_PROFILE;
  const climbDrain = Math.sin(p.pitchMax) * p.gravityTrade + p.glideDrag;
  assert.ok(p.flap > climbDrain,
    `flap ${p.flap} must exceed the ${climbDrain.toFixed(3)} u/s² a full climb costs, or W+Space always stalls out ` +
    `(this is exactly what shipped in A-BIRD: flap 1.1 vs a 1.639 drain)`);
});

test('a flapping bird CLIMBS and does not stall (the reported bug, as a runnable check)', () => {
  const m = createBirdModel();
  const s = fresh({ speed: BIRD_PROFILE.cruiseSpeed });
  const y0 = s.y;
  drive(m, s, { throttle: 1, steer: 0, lift: 1 }, 3);       // W + Space for 3 s
  assert.ok(s.y > y0 + 1, `flap+climb should gain real altitude, gained only ${(s.y - y0).toFixed(3)}`);
  assert.ok(!s.stalling, 'a bird flapping at full power must not be in a stall');
});

test('a bird that does NOT flap trades height for speed — the model still has its character', () => {
  const m = createBirdModel();
  const s = fresh({ speed: BIRD_PROFILE.cruiseSpeed });
  const y0 = s.y, v0 = s.speed;
  drive(m, s, { throttle: 0, steer: 0, lift: -1 }, 2);      // nose down, no flapping
  assert.ok(s.y < y0, 'diving must lose height');
  assert.ok(s.speed > v0, 'and that height must come back as SPEED — this is the whole model');
});

test('you cannot out-flap a dive: boost raises flap but never the top speed', () => {
  assert.equal(BIRD_PROFILE.boost.speed, undefined,
    'BIRD_PROFILE.boost must not carry a `speed` key — terminal velocity is the reward for spending height, ' +
    'not something a wingbeat can buy');
  const m = createBirdModel();
  const s = fresh({ speed: BIRD_PROFILE.cruiseSpeed });
  drive(m, s, { throttle: 1, steer: 0, lift: 0, boost: 1 }, 8);
  assert.ok(s.speed <= BIRD_PROFILE.maxSpeed + 1e-9, `boosted flapping reached ${s.speed}, above maxSpeed`);
});

test('BYTE-IDENTICAL: a consumer that never sends `boost` integrates exactly as before', () => {
  // projects/city and showcase-lab pass {throttle, steer, lift} with no boost key. Same numbers, always.
  for (const [make, prof] of [[createRoadModel, ROAD_PROFILE], [createBoatModel, BOAT_PROFILE]]) {
    const a = fresh({ y: 0 }), b = fresh({ y: 0 });
    drive(make(prof), a, { throttle: 1, steer: 0.4, lift: 0 }, 4);
    drive(make(prof), b, { throttle: 1, steer: 0.4, lift: 0, boost: 0 }, 4);
    assert.equal(a.x, b.x); assert.equal(a.z, b.z); assert.equal(a.speed, b.speed);
  }
});

test('boost is ANALOG, not a toggle — the phone ramps it from an over-pushed stick', () => {
  const runAt = (boost) => {
    const s = fresh({ y: 0 });
    drive(createRoadModel(), s, { throttle: 1, steer: 0, lift: 0, boost }, 4);
    return s.speed;
  };
  const off = runAt(0), half = runAt(0.5), full = runAt(1);
  assert.ok(half > off, `half boost (${half}) must beat none (${off})`);
  assert.ok(full > half, `full boost (${full}) must beat half (${half})`);
  // and it must land where the profile says: 2.4 * 1.55 = 3.72
  assert.ok(Math.abs(full - ROAD_PROFILE.maxSpeed * ROAD_PROFILE.boost.speed) < 1e-6,
    `full boost should reach maxSpeed x boost.speed, got ${full}`);
});

test('the boosted car CANNOT corner in a city street — the cost is real, not cosmetic', () => {
  // createRoadModel's own law: R = max(rMin, v²/aLat). The city's street corridor allows ~0.905 u for
  // this car (measured in the A-FEEL pass). If boost ever stops widening the turn past that, the
  // "lift off before the junction" lesson silently disappears and boost becomes a free win.
  const CORRIDOR = 0.905;
  const vBoost = ROAD_PROFILE.maxSpeed * ROAD_PROFILE.boost.speed;
  const rBoost = Math.max(ROAD_PROFILE.turnRadiusMin, (vBoost * vBoost) / ROAD_PROFILE.latAccelMax);
  const rCruise = Math.max(ROAD_PROFILE.turnRadiusMin, (ROAD_PROFILE.maxSpeed ** 2) / ROAD_PROFILE.latAccelMax);
  assert.ok(rCruise <= CORRIDOR, `un-boosted the car must still make the turn (radius ${rCruise.toFixed(3)})`);
  assert.ok(rBoost > CORRIDOR, `boosted radius ${rBoost.toFixed(3)} must exceed the ${CORRIDOR} u corridor`);
});

test('the boat steers BETTER with boost — rudder authority rides on way', () => {
  // The opposite trade from the car, and it falls out of the boat model rather than being scripted.
  const turned = (boost) => {
    const s = fresh({ y: 0, speed: BOAT_PROFILE.maxSpeed * 0.9 });
    drive(createBoatModel(), s, { throttle: 1, steer: 1, lift: 0, boost }, 3, { heightAt: () => 0, waterHeightAt: () => 0 });
    return Math.abs(s.yaw);
  };
  assert.ok(turned(1) > turned(0), 'full ahead must turn through MORE heading, not less');
});
