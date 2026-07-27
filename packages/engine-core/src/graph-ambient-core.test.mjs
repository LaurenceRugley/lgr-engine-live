/* graph-ambient-core.test.mjs — VIZ SLICE 15: the ambient scheduler's two LOAD-BEARING properties.
   These tests encode WHY the scheduler exists (Rule 9), not just what it returns:
     - DETERMINISM is the repo invariant that makes the sky replayable/testable at all. If this test
       fails, every capture-probe gate that watches a comet becomes flaky by construction.
     - ONE-AT-A-TIME is the restraint contract — the difference between "a rare delight" and
       "background traffic". It must hold against BOTH the natural timers and a forced debugSpawn. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAmbientScheduler, lcg } from './graph-ambient-core.js';

const EVENTS = [
  { kind: 'comet', meanInterval: 75, jitter: 0.4, durationMin: 4, durationMax: 7 },
  { kind: 'ship', meanInterval: 210, jitter: 0.4, durationMin: 9, durationMax: 13 },
];

/* Drive a scheduler for `seconds` of simulated time in fixed steps, recording every spawn/done. */
function record(sched, seconds, step = 0.25) {
  const log = [];
  for (let t = 0; t < seconds; t += step) {
    const { spawned, done } = sched.advance(step);
    if (done) log.push(['done', done, +t.toFixed(2)]);
    if (spawned) log.push(['spawn', spawned.kind, +t.toFixed(2), +spawned.duration.toFixed(4), ...spawned.u.map((u) => +u.toFixed(6))]);
  }
  return log;
}

test('same seed → byte-identical spawn sequence (determinism is the whole point)', () => {
  const a = record(createAmbientScheduler({ seed: 0x1234, events: EVENTS }), 1200);
  const b = record(createAmbientScheduler({ seed: 0x1234, events: EVENTS }), 1200);
  assert.deepEqual(a, b);
  assert.ok(a.filter((e) => e[0] === 'spawn').length >= 5, `expected a lively 20 min, got ${a.length} entries`);
});

test('different seed → different sequence (the LCG is actually wired in)', () => {
  const a = record(createAmbientScheduler({ seed: 0x1234, events: EVENTS }), 1200);
  const b = record(createAmbientScheduler({ seed: 0x9999, events: EVENTS }), 1200);
  assert.notDeepEqual(a, b);
});

test('ONE event at a time: a forced spawn while airborne is REFUSED', () => {
  const s = createAmbientScheduler({ seed: 1, events: EVENTS });
  const first = s.spawn('comet');
  assert.ok(first && first.kind === 'comet');
  assert.equal(s.spawn('ship'), null, 'second spawn must be refused while the comet flies');
  assert.equal(s.spawn('comet'), null);
  assert.equal(s.spawnCount, 1);
  assert.equal(s.airborne, first);
});

test('ONE event at a time holds against the natural timers too — a due timer WAITS, then fires', () => {
  // ship due at ~2s but a long comet is airborne until t=10: the ship must NOT overlap, and must
  // spawn promptly once the sky frees up (holding at zero, not rescheduling a whole new interval).
  const s = createAmbientScheduler({
    seed: 7,
    events: [
      { kind: 'comet', meanInterval: 1e9, jitter: 0, durationMin: 10, durationMax: 10 },
      { kind: 'ship', meanInterval: 2, jitter: 0, durationMin: 3, durationMax: 3 },
    ],
  });
  assert.ok(s.spawn('comet'));
  let overlap = false, shipAt = null, cometDoneAt = null;
  for (let t = 0; t < 20; t += 0.1) {
    const { spawned, done } = s.advance(0.1);
    if (done === 'comet') cometDoneAt = t;
    // FIRST ship only — the 2s mean interval keeps firing afterwards, and later spawns are not the held one
    if (spawned && spawned.kind === 'ship' && shipAt == null) { shipAt = t; if (cometDoneAt == null) overlap = true; }
  }
  assert.equal(overlap, false, 'ship spawned while the comet was still airborne');
  assert.ok(shipAt != null, 'the held ship never fired');
  assert.ok(shipAt - cometDoneAt < 0.2, `held timer should fire immediately on free sky (waited ${(shipAt - cometDoneAt).toFixed(1)}s)`);
});

test('cadence honesty: intervals land inside mean±jitter, durations inside [min,max]', () => {
  const s = createAmbientScheduler({ seed: 42, events: [{ kind: 'comet', meanInterval: 60, jitter: 0.4, durationMin: 4, durationMax: 7 }] });
  const spawns = [];
  let t = 0;
  for (; t < 3600 && spawns.length < 20; t += 0.25) {
    const { spawned } = s.advance(0.25);
    if (spawned) spawns.push({ t, duration: spawned.duration });
  }
  assert.ok(spawns.length >= 10, `expected >=10 spawns in an hour at mean 60s, got ${spawns.length}`);
  for (let i = 1; i < spawns.length; i++) {
    const gap = spawns[i].t - spawns[i - 1].t;
    // gap = duration of the previous flight is a floor; the ceiling is mean*(1+jitter) + a step of slack
    assert.ok(gap <= 60 * 1.4 + 0.5, `gap ${gap.toFixed(1)}s blew past mean+jitter`);
    assert.ok(gap >= 60 * 0.6 - 0.5, `gap ${gap.toFixed(1)}s under mean-jitter — comets are becoming traffic`);
  }
  for (const sp of spawns) assert.ok(sp.duration >= 4 && sp.duration <= 7, `duration ${sp.duration}`);
});

test('lcg: deterministic, uniform-ish, in [0,1)', () => {
  const a = lcg(123), b = lcg(123);
  let sum = 0;
  for (let i = 0; i < 1000; i++) {
    const va = a(), vb = b();
    assert.equal(va, vb);
    assert.ok(va >= 0 && va < 1);
    sum += va;
  }
  assert.ok(Math.abs(sum / 1000 - 0.5) < 0.05, `mean drifted to ${(sum / 1000).toFixed(3)}`);
});
