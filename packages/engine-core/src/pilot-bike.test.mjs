// pilot-bike.test.mjs — A-MOTO (2026-08-18): the dirtbike's distinguishing claims, as runnable checks.
//
// Rule 9, same shape as pilot-fish.test.mjs: a new movement model is only justified if it behaves
// differently from the bodies we already have, and every test here names its FOIL. The headline foil
// is the reuse-vs-new verdict itself made runnable: createGroundModel (the ATV) is terrain-follow BY
// CONSTRUCTION — `y = damp(y, groundY, 18, dt)`, no vertical velocity state — so over the exact same
// derived terrain at the same speed the ATV must stay glued while the bike flies. If someone later
// "simplifies" the bike back onto the ATV's follow rule, THIS is the test that goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBikeModel, BIKE_PROFILE, createGroundModel, ATV_PROFILE } from './pilot.js';
import { createMotoTerrain, launchSpeed } from './moto.js';

const P = BIKE_PROFILE, G = P.gravity;
const T = createMotoTerrain({ speed: P.maxSpeed, g: G, pitchRate: P.airPitchRate, mesh: false, seed: 7 });
const WORLD = { heightAt: T.heightAt };
const DT = 1 / 120;

const fresh = (o = {}) => ({
  x: T.spawn.x, y: 0, z: T.spawn.z, yaw: 0, speed: 0, quat: new THREE.Quaternion(), ...o,
});

/* drive a model with fixed axes for `secs`, recording per-frame receipts. */
function drive(model, state, secs, axesFn) {
  const rec = { frames: 0, jumps: 0, airFrames: 0, maxClear: -Infinity, minAboveGround: Infinity, landings: [] };
  let lastCount = state.landing ? state.landing.count : 0;
  const steps = Math.round(secs / DT);
  for (let n = 0; n < steps; n++) {
    model.step(state, axesFn ? axesFn(n * DT, state) : { throttle: 1, steer: 0, lift: 0 }, DT, WORLD);
    rec.frames++;
    const ground = T.heightAt(state.x, state.z);
    const clear = state.y - ground;
    if (clear > rec.maxClear) rec.maxClear = clear;
    if (clear < rec.minAboveGround) rec.minAboveGround = clear;
    if (state.airborne) rec.airFrames++;
    if (state.landing && state.landing.count > lastCount) { rec.landings.push({ ...state.landing }); lastCount = state.landing.count; }
  }
  rec.jumps = state.jumps || 0;
  return rec;
}

/* ── THE FOIL: the ATV cannot leave this ground; the bike is built to ──────────────────────────── */

test('over the SAME derived terrain at full throttle, the ATV stays glued and the bike flies', () => {
  const bike = drive(createBikeModel(P), fresh(), 13);
  const atvState = fresh();
  const atv = createGroundModel(ATV_PROFILE);
  let atvMaxClear = -Infinity;
  for (let n = 0; n < Math.round(13 / DT); n++) {
    atv.step(atvState, { throttle: 1, steer: 0 }, DT, WORLD);
    const clear = atvState.y - T.heightAt(atvState.x, atvState.z);
    if (clear > atvMaxClear) atvMaxClear = clear;
  }
  assert.ok(bike.jumps >= 3, `the bike must launch repeatedly on its own terrain (got ${bike.jumps} jumps)`);
  assert.ok(bike.maxClear > 0.8, `bike peak clearance ${bike.maxClear.toFixed(2)} u — real air, not skin noise`);
  assert.ok(atvMaxClear < 0.4, `the ATV's damp-follow must never read as air (max clearance ${atvMaxClear.toFixed(2)} u)`);
});

test('JUMPABLE BY CONSTRUCTION: the crossing collects airtime, and the accounting adds up', () => {
  const s = fresh();
  const rec = drive(createBikeModel(P), s, 13);
  assert.ok(s.airTotal > 1.0, `13 s at full throttle banks >1 s of air (got ${s.airTotal.toFixed(2)} s)`);
  assert.ok(rec.airFrames * DT > 0.9 * s.airTotal && rec.airFrames * DT < 1.1 * s.airTotal,
    'airTotal agrees with the per-frame airborne count');
  assert.equal(rec.landings.length, s.jumps - (s.airborne ? 1 : 0), 'every completed jump has exactly one landing verdict');
});

test('NEGATIVE CONTROL — below the STRONGEST crest\'s launch speed the same hills keep you grounded', () => {
  /* the launch line is per-crest: the field's amplitude runs [Amin, Amax], and a bigger A launches
     at a LOWER speed (launchSpeed ∝ 1/√A). "Never launches" therefore means "below the Amax line",
     which at these numbers is ~0.66 of design speed — cruise at 90% of THAT. */
  const vCruise = launchSpeed({ wavelength: T.stats.wavelength, amplitude: T.stats.amplitude, g: G }) * 0.9;
  const slow = { ...P, maxSpeed: vCruise };
  const rec = drive(createBikeModel(slow), fresh(), 13);
  assert.equal(rec.jumps, 0, `at ${vCruise.toFixed(2)} u/s (below every crest's launch line) the field must not launch (got ${rec.jumps})`);
});

/* ── NO-SINK: the terrain arc's containment analog (the zero-radius enclosed test of this world) ── */

test('the bike NEVER sinks below heightAt — grounded frames sit exactly on it, air frames above it', () => {
  const rec = drive(createBikeModel(P), fresh(), 13);
  assert.ok(rec.minAboveGround > -1e-6,
    `min(y − heightAt) across every frame = ${rec.minAboveGround.toExponential(2)} — below-ground would be a resolver hole`);
});

/* ── the air is the player's: pitch authority, and what the fish deliberately lacks ─────────────── */

test('air pitch is an exact integral of the lean axis — and with no input the attitude HOLDS', () => {
  const m = createBikeModel(P);
  const s = fresh({ airborne: true, y: 10, vy: 0, pitch: 0, vx: 0 });
  s.speed = 5;
  // 0.5 s of lean-back (lift −1): pitch must rise by exactly airPitchRate·t (it is a pure integral)
  for (let n = 0; n < Math.round(0.5 / DT); n++) m.step(s, { throttle: 0, steer: 0, lift: -1 }, DT, WORLD);
  assert.ok(Math.abs(s.pitch - P.airPitchRate * 0.5) < 1e-9, `pitch ${s.pitch.toFixed(4)} vs ${(P.airPitchRate * 0.5).toFixed(4)}`);
  const held = s.pitch;
  for (let n = 0; n < Math.round(0.3 / DT); n++) m.step(s, { throttle: 0, steer: 0, lift: 0 }, DT, WORLD);
  assert.equal(s.pitch, held, 'no passive rotation: the FISH noses over with its velocity vector; the rider holds attitude');
});

test('hang-time: a full second of air keeps ~88% of entry speed (airDrag is proportional and small)', () => {
  const m = createBikeModel(P);
  const s = fresh({ airborne: true, y: 40, vy: 2, pitch: 0 });
  s.speed = P.maxSpeed;
  for (let n = 0; n < Math.round(1.0 / DT); n++) m.step(s, { throttle: 0, steer: 0, lift: 0 }, DT, WORLD);
  const kept = s.speed / P.maxSpeed;
  assert.ok(kept > 0.85 && kept < 0.95, `kept ${(kept * 100).toFixed(1)}% through 1 s of air`);
});

/* ── the landing VERDICT — the seam neither parent model has ───────────────────────────────────── */

/* drop a bike vertically onto flat ground with a chosen attitude; return its landing record. */
function landAt(pitch, liftDuring = 0) {
  const m = createBikeModel(P);
  const FLAT = { heightAt: () => 0 };
  const s = { x: 0, y: 1.2, z: 0, yaw: 0, speed: 6, vy: -1, pitch, airborne: true, quat: new THREE.Quaternion(), airtime: 0.5, airTotal: 0.5, jumps: 1, upX: 0, upY: 1, upZ: 0, landing: { err: 0, kept: 1, clean: true, count: 0 } };
  for (let n = 0; n < Math.round(1.2 / DT) && s.airborne; n++) m.step(s, { throttle: 0, steer: 0, lift: liftDuring }, DT, FLAT);
  assert.equal(s.airborne, false, 'the drop must land inside the window');
  return { landing: s.landing, speed: s.speed };
}

test('flat landing at matched pitch is CLEAN and keeps every unit of speed', () => {
  const r = landAt(0);
  assert.equal(r.landing.clean, true);
  assert.equal(r.landing.kept, 1);
});

test('a botched landing scrubs speed toward keepMin — and never below it (phase-1 forgiving, no wreck)', () => {
  const r = landAt(Math.PI / 2);        // nose straight up on flat ground: a 90° botch
  assert.equal(r.landing.clean, false);
  assert.ok(r.landing.kept < 1 && r.landing.kept >= P.keepMin - 1e-9,
    `kept ${r.landing.kept.toFixed(2)} ∈ [keepMin ${P.keepMin}, 1)`);
});

test('THE WRAP: a completed backflip (2π of pitch) lands CLEAN — the arithmetic the whole trick hangs on', () => {
  const r = landAt(2 * Math.PI - 0.05);   // rotated all the way round, 3° from perfect
  assert.equal(r.landing.clean, true, `err ${r.landing.err.toFixed(3)} rad must wrap to ~0, not read as 6.23`);
  assert.equal(r.landing.kept, 1);
});

test('half a flip is the WORST landing, not a wrapped-clean one (the wrap must not forgive 180°)', () => {
  const r = landAt(Math.PI * 0.98);
  assert.equal(r.landing.clean, false);
  assert.ok(r.landing.kept <= P.keepMin + 0.03, `a near-π landing scrubs to the floor (kept ${r.landing.kept.toFixed(2)})`);
});

test('STEER CONVENTION: positive steer (D, right) DECREASES yaw — the character\'s measured rule', () => {
  /* swing-ledger A-LOCK, measured on owner-verified working code: "a right turn DECREASES
     atan2(vx,vz)". The bike takes the spacecraft's sign so the uniform D−A key wiring turns the
     screen-right way behind a chase camera (world +x projects screen-LEFT — measured, not derived).
     If someone "fixes" the sign back to the ATV's, this red names the ledger line to read first. */
  const m = createBikeModel(P);
  const FLAT = { heightAt: () => 0 };
  const s = { x: 0, y: 0, z: 0, yaw: 0, speed: 5, quat: new THREE.Quaternion() };
  for (let n = 0; n < 30; n++) m.step(s, { throttle: 1, steer: 1, lift: 0 }, DT, FLAT);
  assert.ok(s.yaw < -0.05, `steer +1 (D) must decrease yaw (got ${s.yaw.toFixed(3)})`);
});

/* ── A-WHIP (2026-08-19, phase 3): the second air axis, and the verdict that retires pitch-only ── */

test('AIR YAW is an exact integral of steer — and the BODY rotates, not the momentum (the whip, not a turn)', () => {
  const m = createBikeModel(P);
  const FLAT = { heightAt: () => -50 };            // deep air: nothing to land on inside the window
  const s = { x: 0, y: 10, z: 0, yaw: 0.4, headYaw: 0.4, speed: 5, vy: 0, pitch: 0, airborne: true, quat: new THREE.Quaternion() };
  const x0 = s.x, z0 = s.z;
  for (let n = 0; n < Math.round(0.5 / DT); n++) m.step(s, { throttle: 0, steer: 1, lift: 0 }, DT, FLAT);
  assert.ok(Math.abs((s.yaw - 0.4) - (-P.airYawRate * 0.5)) < 1e-9,
    `steer +1 for 0.5 s must yaw exactly −airYawRate·t (got Δ ${(s.yaw - 0.4).toFixed(4)})`);
  // momentum's line: travel stayed on the LAUNCH heading, not the whipped body yaw
  const dist = Math.hypot(s.x - x0, s.z - z0);
  const alongHead = (s.x - x0) * Math.sin(0.4) + (s.z - z0) * Math.cos(0.4);
  assert.ok(Math.abs(dist - alongHead) < 1e-9, 'every unit of travel lies along headYaw — the whip cannot steer the flight');
  assert.equal(s.headYaw, 0.4, 'headYaw is frozen for the whole flight');
  const held = s.yaw;
  for (let n = 0; n < Math.round(0.3 / DT); n++) m.step(s, { throttle: 0, steer: 0, lift: 0 }, DT, FLAT);
  assert.equal(s.yaw, held, 'no input holds the whip attitude — an exact integral, like the pitch axis');
});

/* drop with a chosen BODY yaw against a frozen travel heading of 0; return the landing record. */
function landAtYaw(yaw, pitch = 0) {
  const m = createBikeModel(P);
  const FLAT = { heightAt: () => 0 };
  const s = { x: 0, y: 1.2, z: 0, yaw, headYaw: 0, speed: 6, vy: -1, pitch, airborne: true, quat: new THREE.Quaternion(), airtime: 0.5, airTotal: 0.5, jumps: 1, upX: 0, upY: 1, upZ: 0, landing: { err: 0, yawErr: 0, kept: 1, clean: true, count: 0 } };
  for (let n = 0; n < Math.round(1.2 / DT) && s.airborne; n++) m.step(s, { throttle: 0, steer: 0, lift: 0 }, DT, FLAT);
  assert.equal(s.airborne, false, 'the drop must land inside the window');
  return { landing: s.landing, speed: s.speed, headYaw: s.headYaw, yaw: s.yaw };
}

test('LAND SQUARE = CLEAN: yaw matching the travel line keeps every unit of speed (pitch-only retires, nothing regresses)', () => {
  const r = landAtYaw(0);
  assert.equal(r.landing.clean, true);
  assert.equal(r.landing.kept, 1);
  assert.equal(r.landing.yawErr, 0);
});

test('LANDED SIDEWAYS SCRUBS like over-rotation does: 60° crossed-up is DIRTY, kept between the floor and 1', () => {
  const r = landAtYaw(Math.PI / 3);                // 60° — past the 29° cone, short of fully crossed
  assert.equal(r.landing.clean, false);
  const want = Math.max(P.keepMin, 1 - P.scrub * (Math.PI / 3 - P.cleanYawAngle) / (Math.PI / 2 - P.cleanYawAngle));
  assert.ok(Math.abs(r.landing.kept - want) < 1e-9, `kept ${r.landing.kept.toFixed(3)} must be the stated yaw law (want ${want.toFixed(3)})`);
  assert.ok(r.landing.kept < 1 && r.landing.kept > P.keepMin, 'scrubbed, not wrecked — and not clean');
});

test('THE YAW WRAP: a completed 360 (2π of body yaw) lands SQUARE — the arithmetic the whip trick hangs on', () => {
  const r = landAtYaw(2 * Math.PI - 0.05);
  assert.equal(r.landing.clean, true, `yawErr ${r.landing.yawErr.toFixed(3)} rad must wrap to ~0`);
  assert.equal(r.landing.kept, 1);
});

test('FULLY CROSSED (90°) is already the keepMin floor, and BACKWARDS (π) stays the floor — not worse than it', () => {
  const at90 = landAtYaw(Math.PI / 2);
  const at180 = landAtYaw(Math.PI * 0.999);
  assert.ok(at90.landing.kept <= P.keepMin + 1e-9, `90° crossed lands at the floor (kept ${at90.landing.kept.toFixed(2)})`);
  assert.equal(at180.landing.kept, at90.landing.kept, 'past π/2 the floor IS the verdict — the crash state is phase-4 vocabulary');
});

test('ONE LANDING, ONE NUMBER: with BOTH axes botched the WORST one governs (min, not a blend — Rule 6 in the arithmetic)', () => {
  const pitchOnly = landAtYaw(0, Math.PI / 2);     // 90° pitch botch, square yaw
  const both = landAtYaw(Math.PI / 3, Math.PI / 2); // same pitch botch + a 60° yaw botch
  const yawOnly = landAtYaw(Math.PI / 3);
  assert.equal(both.landing.kept, Math.min(pitchOnly.landing.kept, yawOnly.landing.kept),
    'kept = min(keptPitch, keptYaw) — never an average, never a product');
});

test('LANDING RE-UNIFIES THE LINES: after a sideways touchdown the wheels\' yaw IS the new travel heading', () => {
  const r = landAtYaw(Math.PI / 4);
  assert.equal(r.headYaw, r.yaw, 'headYaw snaps to the body yaw at the verdict — the wheels grip where they point');
});

test('GROUNDED STEER IS A TURN, NOT A WHIP: on the dirt yaw and headYaw stay ONE line (no yaw stream can open)', () => {
  const m = createBikeModel(P);
  const FLAT = { heightAt: () => 0 };
  const s = { x: 0, y: 0, z: 0, yaw: 0, speed: 5, quat: new THREE.Quaternion() };
  for (let n = 0; n < 60; n++) m.step(s, { throttle: 1, steer: 1, lift: 0 }, DT, FLAT);
  assert.ok(Math.abs(s.yaw) > 0.1, 'the turn happened');
  assert.equal(s.headYaw, s.yaw, 'yaw − headYaw ≡ 0 while grounded — the scorer\'s whip stream is structurally silent on the dirt');
});

test('NO-STEER AIR IS BYTE-IDENTICAL to the phase-1 frozen-yaw air (the re-baseline claim, checkable)', () => {
  /* the same full-throttle drive that anchors every A-MOTO baseline, steer 0 throughout: every
     landing must report yawErr EXACTLY 0 and kept must be the pitch law's own number — proven
     end-to-end by the replay fixture's flipHash too (tricks.test.mjs), but pinned here at the
     landing-record level so a red names the field that moved. */
  const s = fresh();
  const rec = drive(createBikeModel(P), s, 13);
  assert.ok(rec.landings.length >= 3, 'the run must land repeatedly');
  for (const L of rec.landings) assert.equal(L.yawErr, 0, 'no whip input → yawErr exactly 0, every landing');
});

/* ── Rule 7 receipt: the ATV itself is untouched by this arc ───────────────────────────────────── */

test('ATV_PROFILE still has no airborne vocabulary — the dune buggy keeps hugging the terrain', () => {
  assert.equal(ATV_PROFILE.airPitchRate, undefined);
  assert.equal(ATV_PROFILE.launchEps, undefined);
  const atv = createGroundModel(ATV_PROFILE);
  const s = fresh();
  for (let n = 0; n < 120; n++) atv.step(s, { throttle: 1, steer: 0 }, DT, WORLD);
  assert.equal(s.airborne, undefined, 'the ground model never grew an airborne flag');
});
