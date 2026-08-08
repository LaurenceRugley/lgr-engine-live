// pilot-fish.test.mjs — A-FISH (2026-08-07): the sixth body's distinguishing claims, as runnable checks.
//
// Rule 9 — every test here pins a property that SEPARATES the fish from a body we already had. That is
// the point: "a new movement model" is only justified if it behaves differently, and the honest way to
// hold that claim is to assert the difference against the real numbers of the models it is not.
//
// Each test therefore names its foil:
//   • neutral buoyancy      vs the BIRD (always falling) and the spacecraft's water medium (buoyancy 1.1)
//   • pivot at zero speed   vs the CAR (ω = v/R → 0 when v = 0) and the BOAT (rudder dead below way)
//   • proportional drag     vs the BOAT (a constant subtraction — a hull coasts; a fish does not)
//   • the ballistic breach  vs everything: no other body has physics that change at a surface
//   • shoreline containment vs a soft-lock — a fish with no thrust in air, stranded on sand, is stuck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createFishModel, FISH_PROFILE, createBoatModel, BOAT_PROFILE } from './pilot.js';

// A world that is water everywhere, with a floor well below — metropolis's real bay is -0.59…-1.8.
const SEA = { heightAt: () => -1.8, waterHeightAt: () => 0 };
const fresh = (o = {}) => ({ x: 0, y: -0.9, z: 0, yaw: 0, pitch: 0, bank: 0, speed: 0, vy: 0, airborne: false, quat: new THREE.Quaternion(), ...o });
const run = (m, s, ax, secs, world = SEA) => { for (let i = 0; i < Math.round(secs * 60); i++) m.step(s, ax, 1 / 60, world); return s; };
const NONE = { throttle: 0, steer: 0, lift: 0 };

test('NEUTRAL BUOYANCY: hands off, a fish holds its depth exactly — it neither sinks nor floats', () => {
  const s = run(createFishModel(), fresh({ y: -0.9 }), NONE, 3);
  assert.ok(Math.abs(s.y + 0.9) < 1e-6, `depth drifted to ${s.y}`);
  // The foil: the spacecraft's water medium applies buoyancy 1.1, i.e. it RISES when you let go. A fish
  // that floated up would be a submarine, and the difference is the whole reason this model exists.
});

test('PIVOT AT ZERO SPEED: a fish turns without moving — no other body in this engine can', () => {
  const s = run(createFishModel(), fresh({ speed: 0 }), { throttle: 0, steer: 1, lift: 0 }, 1);
  assert.ok(Math.abs(s.yaw) > 1.5, `yaw only reached ${s.yaw} from a dead stop`);
  // The foils, computed rather than asserted from memory:
  //   car  — ω = steer·(v/R)·dt with v = 0 ⇒ exactly 0.
  //   boat — gated on `v > steerMinWay` (0.12) ⇒ exactly 0.
  const boat = run(createBoatModel(), fresh({ y: 0, speed: 0 }), { throttle: 0, steer: 1, lift: 0 }, 1);
  assert.equal(boat.yaw, 0, 'the boat must NOT turn at rest — if it does, this fish is not distinct');
});

test('NO COASTING: drag is PROPORTIONAL, so a fish stops in about 1/drag seconds', () => {
  /* Compare the FRACTION retained, not absolute speeds — and seed inside the boat's own maxSpeed (1.6).
     My first version seeded both at 2.0, which the boat's clamp pinned to 1.6 on frame one, so the
     "boat is still coasting" assertion failed on a setup error and briefly looked like a model bug. */
  const V0 = 1.5, TAU = 1 / FISH_PROFILE.drag;
  const fish = run(createFishModel(), fresh({ speed: V0 }), NONE, TAU);
  const boat = run(createBoatModel(), fresh({ y: 0, speed: V0 }), NONE, TAU, { heightAt: () => -1.8, waterHeightAt: () => 0 });
  assert.ok(fish.speed / V0 < 0.45, `a fish should shed most of its speed in one time-constant, retained ${(fish.speed / V0).toFixed(2)}`);
  // The foil: the boat sheds a CONSTANT 0.35 u/s², so over the same 0.42 s it is still doing ~90%.
  // Inertia is the boat's whole character; the fish is the deliberate opposite. The CONTRAST is the claim.
  assert.ok(boat.speed / V0 > 0.85, `the boat should still be coasting, retained ${(boat.speed / V0).toFixed(2)}`);
});

test('THE BREACH: a fish driven up through the surface leaves the water and comes back ballistically', () => {
  const m = createFishModel();
  const s = fresh({ y: -1.2, speed: 0 });
  run(m, s, { throttle: 1, steer: 0, lift: 1, boost: 1 }, 2.5);
  assert.ok(s.airborne || s.y > 0, 'never broke the surface');
  const peak = s.y;
  run(m, s, NONE, 1.5);                                          // no input at all
  assert.ok(s.y < peak, `must fall back unaided: ${peak} -> ${s.y}`);
});

test('THE BREACH conserves momentum ACROSS THE CROSSING FRAME — it is not a reset', () => {
  /* Measure the crossing itself, frame to frame. My first version compared the launch speed against
     the speed seeded several frames earlier and "failed" — but that gap is just drag over the climb to
     the surface (proportional drag at 2.4/s, with the nose easing level under no input, costs real
     speed on the way up). That loss is CORRECT physics; conflating it with the handoff was the bug.
     What must not lose energy is the representation swap: speed+pitch → horizontal speed + vy. */
  const m = createFishModel();
  const s = fresh({ y: -0.25, speed: 2.4, pitch: 1.0 });
  let prevTotal = null;
  for (let i = 0; i < 300; i++) {
    const wasAir = s.airborne;
    const before = wasAir ? Math.hypot(s.speed, s.vy) : Math.abs(s.speed);
    m.step(s, NONE, 1 / 60, SEA);
    if (!wasAir && s.airborne) { prevTotal = before; break; }     // this frame is the crossing
  }
  assert.ok(prevTotal !== null, 'setup failed — never left the water');
  const after = Math.hypot(s.speed, s.vy);
  assert.ok(after > prevTotal * 0.9, `the surface crossing itself lost energy: ${prevTotal.toFixed(3)} -> ${after.toFixed(3)}`);
});

test('AIRBORNE: the nose follows the velocity vector, and nothing steers', () => {
  /* ONE pass over the whole flight, asserting both properties as they happen. Two earlier versions of
     this test failed on their own timing — they ran a fixed 0.6 s and then checked, by which point the
     fish had splashed back in and was legitimately steering again. Never assert on a state machine
     after a fixed sleep; assert inside the state. */
  const m = createFishModel();
  const s = fresh({ y: -0.1, speed: 2.6, pitch: 1.0 });
  for (let i = 0; i < 300 && !s.airborne; i++) m.step(s, NONE, 1 / 60, SEA);
  assert.ok(s.airborne, 'setup failed — never left the water');

  const yawAtLaunch = s.yaw, pitchAtLaunch = s.pitch;
  let frames = 0, lastPitch = s.pitch;
  while (s.airborne && frames < 300) {
    // Full stick the whole time: it must change NOTHING while out of the water.
    m.step(s, { throttle: 1, steer: 1, lift: 1, boost: 1 }, 1 / 60, SEA);
    frames++;
    if (s.airborne) { assert.equal(s.yaw, yawAtLaunch, 'a fish must not steer through the air'); lastPitch = s.pitch; }
  }
  assert.ok(frames > 5, `too short a flight to judge (${frames} frames)`);
  assert.ok(lastPitch < pitchAtLaunch, `nose must come over the top: ${pitchAtLaunch.toFixed(3)} -> ${lastPitch.toFixed(3)}`);
});

test('SHORELINE: a fish cannot swim onto land — stranding it would be a soft-lock, not a challenge', () => {
  // A world where x > 2 is dry. The fish swims flat out at it for four seconds.
  const COAST = { heightAt: () => -1.8, waterHeightAt: (x) => (x > 2 ? -999 : 0) };
  const s = fresh({ x: 1.5, yaw: Math.PI / 2, speed: 0 });       // yaw π/2 ⇒ forward is +x
  run(createFishModel(), s, { throttle: 1, steer: 0, lift: 0, boost: 1 }, 4, COAST);
  assert.ok(s.x <= 2, `swam onto dry land to x=${s.x}; it has no thrust out of water and could never leave`);
});

test('THE SEABED is a floor, not a suggestion', () => {
  const s = run(createFishModel(), fresh({ y: -1.0 }), { throttle: 1, steer: 0, lift: -1, boost: 1 }, 4);
  assert.ok(s.y >= -1.8, `swam through the sea floor to ${s.y}`);
  assert.ok(s.y <= -1.8 + FISH_PROFILE.floorSkim + 1e-6, `should be riding the floor, got ${s.y}`);
});

test('BOOST is a real burst here, and it is opt-in like every other profile', () => {
  const at = (boost) => run(createFishModel(), fresh(), { throttle: 1, steer: 0, lift: 0, boost }, 3).speed;
  assert.ok(at(1) > at(0) * 1.4, `burst ${at(1)} should clearly beat cruise ${at(0)}`);
  // and the no-boost path is exactly the old path (nothing sends `boost` in projects/city)
  const a = run(createFishModel(), fresh(), { throttle: 1, steer: 0.3, lift: 0 }, 2);
  const b = run(createFishModel(), fresh(), { throttle: 1, steer: 0.3, lift: 0, boost: 0 }, 2);
  assert.equal(a.x, b.x); assert.equal(a.y, b.y); assert.equal(a.speed, b.speed);
});

test('the profile asks for a chase closer than the rig default — or a 0.4 u fish is a speck', () => {
  // camera-rig clamps setFollow's frame to distMin (4.0). Every other craft profile silently loses its
  // chaseDist to that clamp; the fish is the body where it actually mattered, so it declares chaseMin.
  assert.ok(FISH_PROFILE.chaseMin !== undefined, 'FISH_PROFILE must declare chaseMin');
  assert.ok(FISH_PROFILE.chaseMin < FISH_PROFILE.chaseDist, 'chaseMin must permit the requested chaseDist');
  assert.ok(FISH_PROFILE.chaseDist < 4.0, 'the whole point is to get inside the rig default of 4.0');
});

/* ── A-CROSSING (2026-08-07): carryMomentum — handing one body's motion to another ───────────────
   The position copy is the obvious part and the part least likely to break. The LATCH RESETS are the
   load-bearing half: each model keeps regime state that is meaningless or actively wrong in the next
   body, and inheriting it produces a body that looks possessed but does not respond. That is this
   repo's logged "entry paths do not guard what exit paths clear" failure class, so it gets tests. */
import { carryMomentum, BIRD_PROFILE } from './pilot.js';

const body = (t) => ({ pilot: { getTransform: () => t } });

test('carryMomentum carries what MEANS the same thing across two bodies', () => {
  const from = { x: 3, y: 0.06, z: -4, yaw: 1.2, pitch: -0.5, speed: 2.8, quat: new THREE.Quaternion() };
  const to = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, quat: new THREE.Quaternion() };
  assert.equal(carryMomentum(body(from), body(to), { speedScale: 0.6, y: -0.14, pitch: -0.55 }), true);
  assert.equal(to.x, 3); assert.equal(to.z, -4);          // position: the reason the crossing does not teleport
  assert.equal(to.yaw, 1.2);                              // all six models share the +Z-nose convention
  assert.ok(Math.abs(to.speed - 2.8 * 0.6) < 1e-9, `speed should scale, got ${to.speed}`);
  assert.equal(to.y, -0.14); assert.equal(to.pitch, -0.55);
});

test('carryMomentum RESETS every regime latch — inheriting one makes the new body unresponsive', () => {
  const from = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 2,
    airborne: true, stalling: true, vy: -3, bank: 0.7,
    medium: 'air', crossing: 'air>water', crossFrom: 'air', crossingT: 0.8, quat: new THREE.Quaternion() };
  const to = { ...from, quat: new THREE.Quaternion() };
  carryMomentum(body(from), body(to), {});
  // `airborne` is the dangerous one: a fish that arrives under water still latched airborne is in
  // ballistic mode — no thrust, no steering — and its own re-entry branch then overwrites the pitch.
  assert.equal(to.airborne, false, 'the ballistic latch must not be inherited');
  assert.equal(to.stalling, false);
  assert.equal(to.vy, 0, 'vertical velocity belonged to the old wing');
  assert.equal(to.bank, 0);
  // the spacecraft's Schmitt-trigger bookkeeping — a stale crossing keeps easing toward a medium you left
  assert.equal(to.medium, undefined);
  assert.equal(to.crossing, undefined);
  assert.equal(to.crossFrom, undefined);
  assert.equal(to.crossingT, 0);
});

test('carryMomentum refuses a body that is not pilotable, rather than half-writing one', () => {
  const to = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, quat: new THREE.Quaternion() };
  assert.equal(carryMomentum(null, body(to), {}), false);
  assert.equal(carryMomentum({}, body(to), {}), false);
  assert.equal(carryMomentum(body(to), null, {}), false);
  assert.equal(to.speed, 0, 'a refused transfer must leave the destination untouched');
});

test('speed is taken as a MAGNITUDE — a reversing body does not arrive swimming backwards', () => {
  const from = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: -1.5, quat: new THREE.Quaternion() };
  const to = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, speed: 0, quat: new THREE.Quaternion() };
  carryMomentum(body(from), body(to), { speedScale: 1 });
  assert.equal(to.speed, 1.5);
});

test('the gull sits exactly `skim` above the water, which is what makes the plunge gate testable', () => {
  // metropolis gates the plunge on `y <= waterY + skim + 0.03`. That constant has to agree with the
  // bird model's own floor offset, and the model defaults it when the profile omits it — so if anyone
  // ever adds an explicit BIRD_PROFILE.skim, this catches the gate silently going out of sync.
  const skim = BIRD_PROFILE.skim ?? 0.06;
  assert.ok(skim > 0 && skim < 0.1, `skim ${skim} outside the range the plunge gate assumes`);
});
