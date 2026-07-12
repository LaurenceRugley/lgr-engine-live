/* ============================================================
   flight-envelope.test.mjs — LESSON M: a standing check on the flight/drive integrator.
   ------------------------------------------------------------
   WHY THIS EXISTS (the capability it guards): the pilot's movement is a PURE integrator —
   `createSpacecraftModel(profile).step(state, axes, dt, world)` (pilot.js:172) advances the
   craft one frame from input. Nothing in the standing rotation exercised it: the browser
   probes fly it but assert LOOK/camera, not the physics envelope. A flight integrator that
   can produce NaN or run away to infinity is not a cosmetic bug — the camera chases the
   craft, so a NaN position blanks the whole demo and an unbounded speed makes it unflyable.

   WHY A NODE TEST, NOT A BROWSER PROBE (the brief's choice, stated): the brief offered either
   a `flight-probe.mjs` or "extract the integration step pure and node-test it." The extraction
   is ALREADY DONE in the shipped code — `createSpacecraftModel`/`createGroundModel` are pure
   exported factories (the documented STRATEGY pattern, pilot.js:15,74,172), THREE-only, no DOM.
   So there is nothing to extract: we import the REAL shipped integrator and drive it directly.
   That is strictly better than a probe — env-agnostic, zero browser flake, runs free in
   `npm test` and CI, and tests the actual physics rather than a copy.

   Each test pins an INTENT that would FAIL if a clamp or floor were removed (Rule 9), not a
   restatement of the arithmetic. The adversarial cases (huge dt, sustained max input, thrashing
   steer) are the ones a real flake would hide behind.

   C++ anchor: the model is a `struct Model { State& step(State&, const Axes&, float dt,
   const World&); }`; this file is a fuzz/bounds harness over that one method.
   ============================================================ */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  createSpacecraftModel, createGroundModel, CRAFT_PROFILE, ATV_PROFILE, NO_WATER,
} from './pilot.js';

// A flat, dry world: ground at y=0, no water anywhere. The simplest domain in which the
// envelope must still hold — if it breaks here, it breaks everywhere.
const flatWorld = { heightAt: () => 0, waterHeightAt: () => NO_WATER };

function freshAirState(y = 8) {
  // The fields step() reads/writes. `medium:'air'` starts us airborne above the ground floor.
  return { x: 0, y, z: 0, yaw: 0, speed: 0, vy: 0, medium: 'air', crossingT: 0, bank: 0, quat: new THREE.Quaternion() };
}
function freshGroundState() {
  return { x: 0, y: 0, z: 0, yaw: 0, speed: 0, vy: 0, medium: 'ground', crossingT: 0, quat: new THREE.Quaternion() };
}

// Every quantity the rest of the engine (camera, HUD, collision) reads off the craft must be a
// real finite number every single frame. One NaN here silently poisons the chase camera.
function assertStateFinite(s, ctx) {
  for (const k of ['x', 'y', 'z', 'yaw', 'speed', 'vy']) {
    assert.ok(Number.isFinite(s[k]), `${ctx}: state.${k} must be finite, got ${s[k]}`);
  }
  if ('bank' in s) assert.ok(Number.isFinite(s.bank), `${ctx}: state.bank must be finite, got ${s.bank}`);
  const q = s.quat;
  for (const k of ['x', 'y', 'z', 'w']) {
    assert.ok(Number.isFinite(q[k]), `${ctx}: quat.${k} must be finite, got ${q[k]}`);
  }
}

const AIR = { maxSpeed: 8.0 };          // MEDIUM_PARAMS.air.maxSpeed
const AIR_SPEED_LO = -AIR.maxSpeed * 0.6;  // the reverse clamp in step()
const EPS = 1e-6;

test('sustained full throttle never exceeds the air speed clamp — the craft cannot run away', () => {
  // If someone deleted `state.speed = clamp(...)`, speed would grow without bound and the
  // chase camera would be dragged off the map. 10 seconds of pinned throttle must plateau.
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState();
  for (let i = 0; i < 600; i++) {
    m.step(s, { throttle: 1, steer: 0, lift: 0 }, 1 / 60, flatWorld);
    assert.ok(s.speed <= AIR.maxSpeed + EPS, `frame ${i}: speed ${s.speed} exceeded max ${AIR.maxSpeed}`);
    assertStateFinite(s, `full-throttle frame ${i}`);
  }
  // And it actually reached the top of the envelope (proves throttle is wired, not a no-op).
  assert.ok(s.speed > AIR.maxSpeed * 0.9, `speed should saturate near max, got ${s.speed}`);
});

test('full reverse never passes the reverse clamp', () => {
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState();
  for (let i = 0; i < 600; i++) {
    m.step(s, { throttle: -1, steer: 0, lift: 0 }, 1 / 60, flatWorld);
    assert.ok(s.speed >= AIR_SPEED_LO - EPS, `frame ${i}: reverse speed ${s.speed} passed ${AIR_SPEED_LO}`);
  }
});

test('sustained full lift is capped at maxV and the craft never NaNs into the sky', () => {
  // maxV=5 caps vertical speed (pilot.js:242). Without that clamp, buoyancy+lift would integrate
  // unbounded. Altitude may climb, but per-frame vy stays inside the envelope and everything is finite.
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState();
  for (let i = 0; i < 600; i++) {
    m.step(s, { throttle: 0, steer: 0, lift: 1 }, 1 / 60, flatWorld);
    assert.ok(Math.abs(s.vy) <= CRAFT_PROFILE.maxV + EPS, `frame ${i}: |vy| ${s.vy} exceeded maxV ${CRAFT_PROFILE.maxV}`);
    assertStateFinite(s, `full-lift frame ${i}`);
  }
});

test('a normal full descent settles ONTO the ground and never digs in (the settle branch)', () => {
  // At real frame times the craft crosses into the `ground` medium as it nears y=0 and the settle
  // branch takes over (state.y = damp(state.y, terrainY, 14, dt), pilot.js:231) — it asymptotes to
  // the surface from ABOVE. This test guards THAT branch: a full-descend hold lands the craft and
  // holds it, never below the terrain. (NOTE: it does NOT reach the airborne floor clamp at :244 —
  // the medium reclassifies first. That clamp is guarded by the huge-dt test below, which a mutation
  // pass proved this test alone leaves unguarded. Honest scoping, not a re-label.)
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState(6);
  for (let i = 0; i < 600; i++) {
    m.step(s, { throttle: 0, steer: 0, lift: -1 }, 1 / 60, flatWorld);
    assert.ok(s.y >= 0 - EPS, `frame ${i}: craft settled to y=${s.y}, below the ground`);
  }
  assert.ok(s.y < 0.5, `craft should be resting on the floor, got y=${s.y}`);
});

test('a huge-dt airborne plunge is caught by the terrain floor clamp, not the settle branch', () => {
  // The airborne floor clamp `if (state.y < terrainY) state.y = terrainY` (pilot.js:244) is the LAST
  // line of defence against tunnelling under the world — but only a step that is still classified
  // `air` when it integrates y downward past the terrain reaches it. A backgrounded-then-refocused
  // tab hands the loop exactly that: one enormous dt. We start high (medium probed = air at y=50) and
  // take ONE dt=100 descent step — vy clamps to -maxV=-5, y integrates to 50 + (-5*100) = -450, and
  // ONLY line 244 pulls it back to 0. Removing that clamp (mutation-tested) makes THIS test fail while
  // the settle test above stays green — which is the whole point.
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState(50);
  m.step(s, { throttle: 0, steer: 0, lift: -1 }, 100, flatWorld);
  assert.ok(Number.isFinite(s.y), `y must be finite after a huge-dt plunge, got ${s.y}`);
  assert.ok(s.y >= 0 - EPS, `the terrain floor clamp must catch the plunge; y=${s.y} tunnelled under the world`);
});

test('coordinated bank stays within bankMax while thrashing the steer at speed', () => {
  // bank is a damped, clamped lean (pilot.js:257). A steer that oscillates every frame must not
  // pump bank past its limit — an over-banked saucer reads as a rendering glitch, and an
  // unclamped one could feed a broken roll into the quaternion.
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState();
  for (let i = 0; i < 400; i++) m.step(s, { throttle: 1, steer: 0, lift: 0 }, 1 / 60, flatWorld); // get up to speed
  const bMax = CRAFT_PROFILE.bankMax;
  for (let i = 0; i < 400; i++) {
    const steer = (i % 2 === 0) ? 1 : -1;         // full-lock alternation every frame
    m.step(s, { throttle: 1, steer, lift: 0 }, 1 / 60, flatWorld);
    assert.ok(Math.abs(s.bank) <= bMax + EPS, `frame ${i}: |bank| ${s.bank} exceeded bankMax ${bMax}`);
    assertStateFinite(s, `steer-thrash frame ${i}`);
  }
});

test('an absurd dt cannot NaN or Infinity the state — clamps are dt-independent by construction', () => {
  // A tab that was backgrounded then refocused can hand the loop a huge dt. The speed/vy/bank
  // clamps must still bound those quantities (they clamp AFTER the +=dt integrate), and nothing
  // may become non-finite. Position may travel far, but far is not infinite.
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState();
  for (const dt of [1, 5, 20, 100]) {
    m.step(s, { throttle: 1, steer: 1, lift: 1 }, dt, flatWorld);
    assert.ok(s.speed <= AIR.maxSpeed + EPS && s.speed >= AIR_SPEED_LO - EPS, `dt=${dt}: speed ${s.speed} outside envelope`);
    assert.ok(Math.abs(s.vy) <= CRAFT_PROFILE.maxV + EPS, `dt=${dt}: |vy| ${s.vy} exceeded maxV`);
    assertStateFinite(s, `huge-dt=${dt}`);
  }
});

test('a long deterministic input storm keeps every field finite and bounded', () => {
  // No Math.random (would break reproducibility): a fixed pseudo-random-ish pattern from the
  // frame index drives all three axes through their full range for 3000 frames. This is the
  // catch-all — any interaction between medium crossings, bank, and clamps that produces a
  // NaN or an envelope break shows up here.
  const m = createSpacecraftModel(CRAFT_PROFILE);
  const s = freshAirState(4);
  for (let i = 0; i < 3000; i++) {
    const throttle = Math.sin(i * 0.11);
    const steer = Math.sin(i * 0.07 + 1);
    const lift = Math.sin(i * 0.05 + 2);
    m.step(s, { throttle, steer, lift }, 1 / 60, flatWorld);
    assert.ok(s.speed <= AIR.maxSpeed + EPS && s.speed >= AIR_SPEED_LO - EPS, `frame ${i}: speed ${s.speed} outside envelope`);
    assert.ok(Math.abs(s.vy) <= CRAFT_PROFILE.maxV + EPS, `frame ${i}: |vy| ${s.vy} exceeded maxV`);
    assertStateFinite(s, `storm frame ${i}`);
  }
});

test('the ground model holds its own speed envelope under full throttle', () => {
  // The other shipped integrator (the ATV). Same guarantee: the ground speed clamp
  // (clamp(speed, -maxSpeed*0.5, maxSpeed), pilot.js) must bound it and nothing may NaN.
  const m = createGroundModel(ATV_PROFILE);
  const s = freshGroundState();
  const max = ATV_PROFILE.maxSpeed;
  for (let i = 0; i < 600; i++) {
    m.step(s, { throttle: 1, steer: 0.5, lift: 0 }, 1 / 60, flatWorld);
    assert.ok(s.speed <= max + EPS && s.speed >= -max * 0.5 - EPS, `frame ${i}: ground speed ${s.speed} outside envelope`);
    assertStateFinite(s, `ground frame ${i}`);
  }
});
