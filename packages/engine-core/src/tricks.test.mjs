// tricks.test.mjs — A-TRICKS (2026-08-19): the scoring rules, pinned. Rule 9 throughout: every test
// names the RULE it defends, so a change to the business logic (what earns, what banks, what scrubs)
// goes red with the reason in the assertion message.
//
// Two layers, deliberately:
//   · SYNTHETIC streams (hand-built state frames) pin the arithmetic — wrap counting, the grounded
//     anti-exploit, one-bank-once, combo — with exact control of every input;
//   · the REAL MODEL (createBikeModel over its own derived ramp terrain) pins the integration — the
//     scorer banking the SAME kept float the physics wrote, on the same flip the probe drives — and
//     the read-only contract (a scorer that mutates the body state fails the byte-compare).
// Determinism gets the outbreak's event-hash treatment: tools/moto-score-replay.mjs is executed
// TWICE in separate node processes (two genuinely fresh boots) and must print identical receipts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import * as THREE from 'three';
import { createTrickScorer, TRICK_PROFILE } from './tricks.js';
import { createBikeModel, BIKE_PROFILE } from './pilot.js';
import { createMotoTerrain } from './moto.js';

const TAU = Math.PI * 2;
const P = TRICK_PROFILE;

/* ── the synthetic layer: a hand-cranked state stream ─────────────────────────────────────────── */

/* one mutable body that speaks the scorer's contract; frames() feeds it through update. */
function makeBody() {
  return { airborne: false, pitch: 0, lastAir: 0, landing: { err: 0, kept: 1, clean: true, count: 0 } };
}
/* fly a pitch path: launch, visit each pitch in `path` over one frame apiece, then land with the
   given verdict (count increments — the landing wrote a verdict, exactly like the model does). */
function fly(scorer, body, path, { kept = 1, clean = true, air = 1.0 } = {}) {
  const events = [];
  body.airborne = true;
  for (const p of path) { body.pitch = p; events.push(...scorer.update(body)); }
  body.airborne = false;
  body.lastAir = air;
  body.landing = { err: 0, kept, clean, count: body.landing.count + 1 };
  events.push(...scorer.update(body));
  body.pitch = 0;                                  // the model wraps + re-seats after touchdown
  return events;
}
/* a smooth ramp of pitches from a to b (the integral the model would produce) */
const sweep = (a, b, n = 60) => Array.from({ length: n }, (_, i) => a + (b - a) * ((i + 1) / n));

test('ANTI-EXPLOIT: grounded pitch wiggle scores ZERO — there is no code path from ground pitch to points', () => {
  const s = createTrickScorer();
  const body = makeBody();
  // wilder than any slope could ever be: ±10π of "pitch" while grounded, many frames
  for (let i = 0; i < 400; i++) { body.pitch = Math.sin(i * 0.3) * 10 * Math.PI; s.update(body); }
  const r = s.read();
  assert.equal(r.total, 0, 'grounded wiggle must never score');
  assert.equal(r.banks, 0);
  assert.equal(r.pending, null, 'no chain may even OPEN on the ground');
});

test('THE WRAP RULE: 1.98π banks ONE backflip; 2.54π (over-held) is still ONE; 3.92π is a DOUBLE (one trick, revs 2)', () => {
  for (const [peak, revs] of [[1.98 * Math.PI, 1], [2.54 * Math.PI, 1], [3.92 * Math.PI, 2]]) {
    const s = createTrickScorer();
    const body = makeBody();
    const evs = fly(s, body, sweep(0.5, peak));    // launch pitch 0.5 (a kicker lip) — credited, per the world-level rule
    const bank = evs.find((e) => e.type === 'bank');
    assert.ok(bank, `peak ${(peak / Math.PI).toFixed(2)}π must bank`);
    assert.equal(bank.tricks.length, 1, 'one monotonic segment = ONE trick');
    assert.equal(bank.tricks[0].name, 'backflip');
    assert.equal(bank.tricks[0].revs, revs, `peak ${(peak / Math.PI).toFixed(2)}π → ${revs} rev(s)`);
  }
});

test('FRONTFLIP: negative rotation names the other trick, at its own base', () => {
  const s = createTrickScorer();
  const evs = fly(s, makeBody(), sweep(-0.2, -1.95 * Math.PI));
  const bank = evs.find((e) => e.type === 'bank');
  assert.equal(bank.tricks[0].name, 'frontflip');
  assert.equal(bank.tricks[0].points, P.bases.frontflip);
});

test('PARTIALS SCORE NOTHING (the stated call): 1.5π of air pitch is landing-matching, not a trick', () => {
  const s = createTrickScorer();
  const evs = fly(s, makeBody(), sweep(0.3, 1.5 * Math.PI), { kept: 0.4, clean: false });
  assert.equal(evs.find((e) => e.type === 'bank'), undefined, 'a chain with no tricks banks NOTHING (no keepMin trickle)');
  assert.equal(s.read().total, 0);
});

test('ANNOUNCE = BANK, by construction: the mid-air popup fires on the same (n − slack)·2π line the bank counts', () => {
  const s = createTrickScorer();
  const body = makeBody();
  body.airborne = true;
  let announced = 0;
  for (const p of sweep(0.5, 1.98 * Math.PI, 200)) {
    body.pitch = p;
    for (const e of s.update(body)) if (e.type === 'trick') { announced++; assert.equal(e.name, 'backflip'); assert.equal(e.points, P.bases.backflip); }
  }
  assert.equal(announced, 1, 'exactly one announcement for one rev — not one per frame past the line');
  assert.ok(s.read().pending.revs === 1 && s.read().pending.name === 'backflip', 'the pending readout carries it');
  body.airborne = false; body.lastAir = 2;
  body.landing = { err: 0.05, kept: 1, clean: true, count: 1 };
  const bank = s.update(body).find((e) => e.type === 'bank');
  assert.equal(bank.tricks[0].revs, announced, 'what was announced is what banks');
});

test('ONE TRICK BANKS ONCE: repeated grounded frames after the verdict add nothing; a count bump without air adds nothing', () => {
  const s = createTrickScorer();
  const body = makeBody();
  fly(s, body, sweep(0.5, 2 * Math.PI));
  const t0 = s.read().total;
  assert.ok(t0 > 0);
  for (let i = 0; i < 100; i++) s.update(body);                    // parked on the landing
  assert.equal(s.read().total, t0, 'no re-bank from sitting on a verdict');
  body.landing = { ...body.landing, count: body.landing.count + 1 };  // a verdict with NO flight (cannot happen live; must still not pay)
  for (let i = 0; i < 10; i++) s.update(body);
  assert.equal(s.read().banks, 1, 'a landing verdict without an air chain banks nothing');
});

test('NO VERDICT, NO BANK: a respawn mid-air (airborne drops with no landing.count bump) discards the chain', () => {
  const s = createTrickScorer();
  const body = makeBody();
  body.airborne = true;
  for (const p of sweep(0.5, 2.1 * Math.PI)) { body.pitch = p; s.update(body); }
  body.airborne = false;                            // placeAt(): no verdict written
  s.update(body);
  assert.equal(s.read().total, 0, 'a flip you bailed out of pays nothing');
  // and the NEXT real flight is unaffected
  const evs = fly(s, body, sweep(0.4, 2.0 * Math.PI));
  assert.ok(evs.find((e) => e.type === 'bank'), 'the discard must not poison the next chain');
});

test('THE KEPT MULTIPLIER IS THE PHYSICS\' OWN FLOAT — assigned, not recomputed (strict identity)', () => {
  const s = createTrickScorer();
  const body = makeBody();
  const kept = 0.6437219;                           // an arbitrary float only the "physics" knows
  const evs = fly(s, body, sweep(0.5, 2.46 * Math.PI), { kept, clean: false, air: 2.0 });
  const bank = evs.find((e) => e.type === 'bank');
  assert.equal(bank.kept, kept, 'strictly the same number — the score cannot disagree with the landing');
  // and the arithmetic through it, exactly: base 100 × revs 1 × (1 + 0.25·2.0) × combo 1 × kept
  assert.equal(bank.points, Math.round(100 * 1 * 1.5 * 1 * kept));
});

test('COMBO: back-then-front in ONE air is TWO tricks — segments, not net rotation — at ×(1 + 0.5·(k−1))', () => {
  const s = createTrickScorer();
  const body = makeBody();
  // up through a full backflip (+2.1π), then a genuine reversal all the way down to −0.5π:
  // segment 2 rotates 2.6π from the extreme → one frontflip. Net pitch is ≈ −0.5π — a net-rotation
  // scorer would pay ZERO here, which is exactly the bug this test exists to keep out.
  const path = [...sweep(0.5, 2.1 * Math.PI, 80), ...sweep(2.1 * Math.PI, -0.5 * Math.PI, 80)];
  const evs = fly(s, body, path, { kept: 1, clean: true, air: 2.0 });
  const bank = evs.find((e) => e.type === 'bank');
  assert.equal(bank.tricks.length, 2, 'two monotonic segments = two tricks');
  assert.deepEqual(bank.tricks.map((t) => t.name), ['backflip', 'frontflip']);
  assert.equal(bank.combo, 1.5);
  assert.equal(bank.points, Math.round((100 + 120) * 1.5 * 1.5 * 1));   // (Σ bases) × airFactor(2 s) × combo × kept 1
});

test('AIRTIME FACTOR: the same flip in twice the air pays more — height (via hang time) gates the payout, the MM2 read', () => {
  const hop = createTrickScorer(), ramp = createTrickScorer();
  const b1 = makeBody(), b2 = makeBody();
  const short = fly(hop, b1, sweep(0.5, 2 * Math.PI), { air: 0.5 }).find((e) => e.type === 'bank');
  const long = fly(ramp, b2, sweep(0.5, 2 * Math.PI), { air: 2.0 }).find((e) => e.type === 'bank');
  assert.equal(short.points, Math.round(100 * (1 + 0.25 * 0.5)));
  assert.equal(long.points, Math.round(100 * (1 + 0.25 * 2.0)));
  assert.ok(long.points > short.points);
});

/* ── A-WHIP (2026-08-19): the yaw stream — same segmenter, second axis, every rule restated ────── */

/* a body that speaks the WHIP vocabulary: yaw spins relative to a frozen headYaw. */
function makeWhipBody() {
  return { airborne: false, pitch: 0, yaw: 0, headYaw: 0, lastAir: 0, landing: { err: 0, yawErr: 0, kept: 1, clean: true, count: 0 } };
}
/* fly BOTH axes: per frame i, pitch[i] and spin[i] (spin = yaw − headYaw, applied onto yaw). */
function fly2(scorer, body, { pitch = null, spin = null, kept = 1, clean = true, air = 1.0 } = {}) {
  const events = [];
  const n = Math.max(pitch ? pitch.length : 0, spin ? spin.length : 0);
  body.airborne = true;
  for (let i = 0; i < n; i++) {
    if (pitch) body.pitch = pitch[Math.min(i, pitch.length - 1)];
    if (spin) body.yaw = body.headYaw + spin[Math.min(i, spin.length - 1)];
    events.push(...scorer.update(body));
  }
  body.airborne = false;
  body.lastAir = air;
  body.landing = { err: 0, yawErr: 0, kept, clean, count: body.landing.count + 1 };
  events.push(...scorer.update(body));
  body.pitch = 0; body.yaw = body.headYaw;         // the model re-unifies the lines at touchdown
  return events;
}

test('A-WHIP: a full 360 of relative yaw BANKS at its own base — the same wrap counting, second axis', () => {
  const s = createTrickScorer();
  const evs = fly2(s, makeWhipBody(), { spin: sweep(0, 0.99 * TAU, 80), air: 2.0 });
  const bank = evs.find((e) => e.type === 'bank');
  assert.ok(bank, 'a completed spin must bank');
  assert.equal(bank.tricks.length, 1);
  assert.equal(bank.tricks[0].name, '360');
  assert.equal(bank.tricks[0].revs, 1);
  assert.equal(bank.points, Math.round(P.bases['360'] * (1 + 0.25 * 2.0)));
  // and the announce fired mid-air on the same line the bank paid
  assert.equal(evs.filter((e) => e.type === 'trick' && e.name === '360').length, 1);
});

test('A-WHIP: spin DIRECTION does not change the trick — left and right 360s pay the same one name', () => {
  const a = createTrickScorer(), b = createTrickScorer();
  const left = fly2(a, makeWhipBody(), { spin: sweep(0, 0.99 * TAU) }).find((e) => e.type === 'bank');
  const right = fly2(b, makeWhipBody(), { spin: sweep(0, -0.99 * TAU) }).find((e) => e.type === 'bank');
  assert.equal(left.tricks[0].name, '360');
  assert.equal(right.tricks[0].name, '360');
  assert.equal(left.tricks[0].points, right.tricks[0].points, 'yaw has no gravity asymmetry to price');
});

test('A-WHIP: PARTIAL WHIPS SCORE NOTHING — the partials rule verbatim on the second axis (kick out, bring it back = riding)', () => {
  const s = createTrickScorer();
  // the styled whip: kick 0.6π out, bring it back square — full air, no full rotation
  const evs = fly2(s, makeWhipBody(), { spin: [...sweep(0, 0.6 * Math.PI, 40), ...sweep(0.6 * Math.PI, 0.02, 40)] });
  assert.equal(evs.find((e) => e.type === 'bank'), undefined, 'no full rev, no bank — landing-squaring is not a trick');
  assert.equal(s.read().total, 0);
});

test('A-WHIP: FLIP + 360 IN ONE AIR is a COMBO — two segments across two axes, ×1.5, the first DRIVABLE combo', () => {
  const s = createTrickScorer();
  const evs = fly2(s, makeWhipBody(), {
    pitch: sweep(0.4, 0.995 * TAU, 80),            // one backflip's worth of pitch…
    spin: sweep(0, 0.99 * TAU, 80),                // …and one 360's worth of yaw, the same frames
    kept: 1, clean: true, air: 2.0,
  });
  const bank = evs.find((e) => e.type === 'bank');
  assert.equal(bank.tricks.length, 2, 'two segments = two tricks, one per axis');
  assert.deepEqual(bank.tricks.map((t) => t.name).sort(), ['360', 'backflip']);
  assert.equal(bank.combo, 1.5);
  assert.equal(bank.points, Math.round((P.bases.backflip + P.bases['360']) * (1 + 0.25 * 2.0) * 1.5 * 1));
});

test('A-WHIP: the yaw stream is OPT-IN BY STATE SHAPE — a body without headYaw scores exactly as before', () => {
  const s = createTrickScorer();
  const body = makeBody();                          // no yaw, no headYaw — the pre-whip contract
  body.yaw = 0;                                     // even WITH a yaw field, no headYaw → no stream
  const evs = fly(s, body, sweep(0.5, 2 * Math.PI));
  const bank = evs.find((e) => e.type === 'bank');
  assert.equal(bank.tricks.length, 1);
  assert.equal(bank.tricks[0].name, 'backflip');
});

test('A-WHIP ANTI-EXPLOIT: grounded steering (yaw moving, headYaw moving with it) scores ZERO — both walls hold', () => {
  const s = createTrickScorer();
  const body = makeWhipBody();
  for (let i = 0; i < 400; i++) {
    body.yaw = Math.sin(i * 0.15) * 6;             // wild grounded carving…
    body.headYaw = body.yaw;                        // …but the model keeps the lines unified on dirt
    s.update(body);
  }
  const r = s.read();
  assert.equal(r.total, 0, 'grounded steer must never score');
  assert.equal(r.pending, null, 'no chain may even OPEN on the ground');
});

test('A-WHIP: the pending readout carries the yaw stream beside the pitch one (HUD vocabulary)', () => {
  const s = createTrickScorer();
  const body = makeWhipBody();
  body.airborne = true;
  for (const v of sweep(0, 0.8 * Math.PI, 30)) { body.yaw = body.headYaw + v; s.update(body); }
  const p = s.read().pending;
  assert.equal(p.name, null, 'no pitch segment direction yet');
  assert.equal(p.yawName, '360');
  assert.ok(p.yawProgress > 0.3 && p.yawProgress < 0.5, `live rev readout (got ${p.yawProgress.toFixed(2)})`);
});

/* ── the real-model layer: the scorer riding createBikeModel over its own derived ramp ─────────── */

const BP = BIKE_PROFILE, G = BP.gravity;
const T = createMotoTerrain({ speed: BP.maxSpeed, g: G, pitchRate: BP.airPitchRate, mesh: false, seed: 7 });
const WORLD = { heightAt: T.heightAt };
const DT = 1 / 120;

/* the probe's flip runs, at node speed: full throttle off the big ramp; lean held to `releaseAt`
   (null = never — the over-rotate arm). Returns the body and the scorer's receipts. */
function rampRun(releaseAt, { withScorer = true } = {}) {
  const m = createBikeModel(BP);
  const s = withScorer ? createTrickScorer() : null;
  const body = { x: T.spawnRamp.x, y: 0, z: T.spawnRamp.z, yaw: T.spawnRamp.yaw || 0, speed: 0, quat: new THREE.Quaternion() };
  const banks = [];
  let launched = false;
  for (let n = 0; n < Math.round(14 / DT); n++) {
    const lean = body.airborne && (releaseAt === null || body.pitch < releaseAt) ? -1 : 0;
    m.step(body, { throttle: 1, steer: 0, lift: lean }, DT, WORLD);
    if (s) for (const e of s.update(body)) if (e.type === 'bank') banks.push(e);
    if (body.airborne) launched = true;
    if (launched && !body.airborne && body.landing.count >= 1) break;
  }
  return { body, banks, read: s ? s.read() : null };
}

test('REAL MODEL, timed release: the G-ramp backflip BANKS CLEAN — kept is the landing\'s own 1, points positive', () => {
  const { body, banks, read } = rampRun(2 * Math.PI * 0.985);
  assert.equal(banks.length, 1, 'one flight, one bank');
  const b = banks[0];
  assert.equal(b.tricks.length, 1);
  assert.equal(b.tricks[0].name, 'backflip');
  assert.equal(b.tricks[0].revs, 1);
  assert.equal(b.kept, body.landing.kept, 'strictly the model\'s own float');
  assert.equal(body.landing.clean, true, 'the timed release lands clean (the ledger receipt, reproduced)');
  assert.equal(b.points, Math.round(100 * (1 + 0.25 * b.airtime) * 1 * b.kept));
  assert.equal(read.total, b.points);
});

test('REAL MODEL, over-held: the flip banks the SCRUBBED fraction — score and physics agree by construction', () => {
  const clean = rampRun(2 * Math.PI * 0.985);
  const held = rampRun(null);
  assert.equal(held.banks.length, 1);
  const b = held.banks[0];
  assert.equal(held.body.landing.clean, false, 'over-held lands dirty (the ledger receipt, reproduced)');
  assert.ok(b.kept < 1 && b.kept >= BP.keepMin - 1e-9, `kept ${b.kept.toFixed(3)} ∈ [keepMin, 1)`);
  assert.equal(b.kept, held.body.landing.kept);
  assert.ok(b.points < clean.banks[0].points, 'the botch pays less than the clean landing of the same trick');
});

/* A-WHIP real-model runs: same ramp, steer held in the air to `spinAt` of relative yaw. */
function whipRun(spinAt) {
  const m = createBikeModel(BP);
  const s = createTrickScorer();
  const body = { x: T.spawnRamp.x, y: 0, z: T.spawnRamp.z, yaw: T.spawnRamp.yaw || 0, speed: 0, quat: new THREE.Quaternion() };
  const banks = [];
  let launched = false;
  for (let n = 0; n < Math.round(14 / DT); n++) {
    const steer = body.airborne && (body.yaw - body.headYaw) < spinAt ? -1 : 0;   // a held A, timed release
    m.step(body, { throttle: 1, steer, lift: 0 }, DT, WORLD);
    for (const e of s.update(body)) if (e.type === 'bank') banks.push(e);
    if (body.airborne) launched = true;
    if (launched && !body.airborne && body.landing.count >= 1) break;
  }
  return { body, banks, read: s.read() };
}

test('A-WHIP REAL MODEL: the timed 360 lands SQUARE and banks CLEAN at the landing\'s own kept', () => {
  const { body, banks } = whipRun(2 * Math.PI * 0.985);
  assert.equal(banks.length, 1, 'one flight, one bank');
  const b = banks[0];
  assert.equal(b.tricks.length, 1);
  assert.equal(b.tricks[0].name, '360');
  assert.equal(b.tricks[0].revs, 1);
  assert.ok(body.landing.yawErr < BP.cleanYawAngle, `landed square (yawErr ${(body.landing.yawErr * 180 / Math.PI).toFixed(1)}°)`);
  assert.equal(b.kept, body.landing.kept, 'strictly the model\'s own float — the whip pays by the physics');
});

test('A-WHIP REAL MODEL: a PARTIAL whip held into the dirt lands SIDEWAYS — DIRTY by the yaw term, and banks NOTHING', () => {
  const { body, banks } = whipRun(Math.PI * 0.6);   // kick ~108° out and never bring it back
  assert.equal(banks.length, 0, 'a partial spin is not a trick — nothing to bank');
  assert.equal(body.landing.clean, false, 'the yaw term judged it (pitch-only would have called this clean)');
  assert.ok(body.landing.yawErr > BP.cleanYawAngle, `crossed-up at touchdown (yawErr ${(body.landing.yawErr * 180 / Math.PI).toFixed(1)}°)`);
  assert.ok(body.landing.kept < 1 && body.landing.kept >= BP.keepMin - 1e-9, `scrubbed like over-rotation (kept ${body.landing.kept.toFixed(2)})`);
});

test('READ-ONLY CONTRACT: a run with the scorer riding along leaves the body state BYTE-IDENTICAL to a run without it', () => {
  const a = rampRun(2 * Math.PI * 0.985, { withScorer: true }).body;
  const b = rampRun(2 * Math.PI * 0.985, { withScorer: false }).body;
  for (const k of ['x', 'y', 'z', 'yaw', 'speed', 'vy', 'pitch', 'airborne', 'jumps', 'airTotal', 'lastAir']) {
    assert.equal(a[k], b[k], `state.${k} moved — the scorer must not touch the physics`);
  }
  assert.deepEqual(a.landing, b.landing);
});

test('DETERMINISM ACROSS FRESH BOOTS: two separate node processes replay one scripted run to the IDENTICAL hash + score', () => {
  const replay = resolve(dirname(fileURLToPath(import.meta.url)), '../../../tools/moto-score-replay.mjs');
  const runs = [1, 2].map(() => execFileSync(process.execPath, [replay], { encoding: 'utf8' }).trim());
  assert.equal(runs[0], runs[1], 'the outbreak\'s event-hash rule: same scripted input, same receipts, every boot');
  const r = JSON.parse(runs[0]);
  assert.ok(r.total > 0 && r.banks >= 4, `the replay must score all four legs — two flips, a 360, the combo (total ${r.total}, banks ${r.banks})`);
  /* A-WHIP's strongest held-baseline receipt: the two flip legs run FIRST, with no steer ever
     sent, and their running hash must still be A-TRICKS' own constant — proof at the event-hash
     level that adding air-yaw authority left every no-whip trajectory byte-identical. */
  assert.equal(r.flipHash, '2446a3c8', 'the flip-only checkpoint moved — the A-WHIP physics touched a no-steer trajectory');
});
