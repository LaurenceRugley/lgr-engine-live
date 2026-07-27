// createTorchLight.test.mjs — node:test of the PURE torchFlicker (no DOM, no GPU).
// These encode WHY the flicker must behave, not just that it runs (Rule 9):
//   • it must NEVER drop to/through zero — a flame that blacks out is a lighting bug, not a flicker;
//   • it must actually VARY over time — a "flicker" that holds constant is dead;
//   • it must be DETERMINISTIC in t — the ?capture path replays a fixed timestep and must reproduce.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { torchFlicker } from './createTorchLight.js';

test('stays within [base·(1-amp), base·(1+amp)] and never reaches 0 for amp<1', () => {
  const base = 6, amp = 0.3;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < 5000; i++) {
    const v = torchFlicker(base, i * 0.017, 0, amp);   // dense sweep across the sines' beat period
    min = Math.min(min, v); max = Math.max(max, v);
  }
  // The three sine weights sum to 1, so the noise term is bounded to [-1,1] → value in [4.2, 7.8].
  assert.ok(min >= base * (1 - amp) - 1e-9, `min ${min} broke the lower bound`);
  assert.ok(max <= base * (1 + amp) + 1e-9, `max ${max} broke the upper bound`);
  assert.ok(min > 0, `flame blacked out (min ${min}) — a flicker must never hit zero`);
});

test('actually varies over time (a dead flicker is a bug)', () => {
  const a = torchFlicker(6, 0.10, 0, 0.3);
  const b = torchFlicker(6, 0.25, 0, 0.3);
  const c = torchFlicker(6, 0.60, 0, 0.3);
  assert.ok(Math.abs(a - b) > 1e-3 || Math.abs(b - c) > 1e-3, 'intensity did not change across time');
});

test('deterministic in t (same time → same intensity, for capture replay)', () => {
  assert.equal(torchFlicker(6, 1.234, 2, 0.3), torchFlicker(6, 1.234, 2, 0.3));
});

test('seed phase-shifts so two torches are out of step', () => {
  const t = 0.4;
  assert.notEqual(torchFlicker(6, t, 0, 0.3), torchFlicker(6, t, 3.1, 0.3));
});

test('amp scales the swing (0 amp ⇒ perfectly steady at base)', () => {
  for (const t of [0, 0.3, 0.9, 2.2]) assert.equal(torchFlicker(6, t, 0, 0), 6);
});
